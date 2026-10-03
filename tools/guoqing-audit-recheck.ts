/**
 * 国庆节审查续接复核：只建立合成状态和隔离夹具，不修业务、不碰个人存档。
 * 运行：tsx tools/guoqing-audit-recheck.ts
 * C01/C08 已修行为加确定性断言；其余已知问题只诊断。退出 0 不能当全报告修复通过。
 * 版本自检：游戏 v0.1.0、存档结构 v31；核对/运行日期 2026-10-03。
 */
import assert from 'node:assert/strict'
import { constants, readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildSimContext } from '@whale/data'
import { advanceGame, bumpIronmanSeq, createInitialState, ironmanLoadVerdict, loadSaveFile, serializeSaveFile } from '@whale/core'
import { addItem } from '../packages/core/src/inventory'
import { advanceLab, labOutputStockOf, startLabRun } from '../packages/core/src/lab'
import { syncBoostRenew } from '../packages/core/src/consumables'
import { wreckUnitsOf } from '../packages/core/src/salvaging'
import { createSaveQueue } from '../apps/desktop/src/shared/saveQueue'

const ROOT = resolve(process.cwd())
const ctx = buildSimContext()
const fresh = () => createInitialState({ nowWallMs: 0, seed: 7 })
const rows: Array<{ id: string; result: unknown }> = []
const report = (id: string, result: unknown) => rows.push({ id, result })

function sourceOf(relative: string): ts.SourceFile {
  const path = join(ROOT, relative)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function nodeOf(source: ts.SourceFile, match: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined
  function visit(node: ts.Node): void {
    if (found) return
    if (match(node)) found = node
    else ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found) throw new Error(`复现入口在当前源码中不存在：${source.fileName}`)
  return found
}

function execute<T>(text: string, bindings: Record<string, unknown>): T {
  const js = ts.transpileModule(`${text}\nglobalThis.result = result`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context: Record<string, unknown> = { exports: {}, console, ...bindings }
  runInNewContext(js, context, { timeout: 2000 })
  return context.result as T
}

function saveHandler(bindings: Record<string, unknown>): (event: unknown, text: string) => Promise<boolean> {
  const source = sourceOf('apps/desktop/src/main/index.ts')
  const call = nodeOf(source, (node) => ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle'
    && ts.isStringLiteral(node.arguments[0]!) && node.arguments[0]!.text === 'save:save') as ts.CallExpression
  const atomicSource = sourceOf('apps/desktop/src/main/atomicSaveWrite.ts')
  const atomicNode = nodeOf(atomicSource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'atomicSaveWrite')
  const atomicSaveWrite = execute(`${atomicNode.getText(atomicSource)}\nconst result = atomicSaveWrite`, {
    fs: bindings.fs, constants, randomUUID,
  })
  return execute(`const result = ${call.arguments[1]!.getText(source)}`, {
    ...bindings, saveOperations: createSaveQueue(), atomicSaveWrite,
  })
}

function gameMethods(names: string[]): string {
  const source = sourceOf('apps/desktop/src/renderer/src/game/engine.ts')
  return names.map((name) => nodeOf(source, (node) => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source)).join('\n')
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`复现超时，入口可能已变更，请复核：${label}`)), 5000)
    })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  // C01：阻塞 A 后立即提交 B；修复后 B 必须等待 A，不再等旧的并发交错入口。
  const aWritten = deferred()
  const releaseA = deferred()
  const releaseB = deferred()
  let bStarted = false
  const files = new Map<string, string>()
  const save = saveHandler({
    savePath: () => '/isolated/save.json',
    ironmanInfoOfSaveText: () => null,
    ledger: { bumpLedger: async () => {} },
    fs: {
      writeFile: async (path: string, text: string) => {
        files.set(path, text)
        if (text === 'A') { aWritten.release(); await releaseA.promise }
        else { bStarted = true; await releaseB.promise }
      },
      rename: async (from: string, to: string) => {
        if (!files.has(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        files.set(to, files.get(from)!)
        files.delete(from)
      },
      unlink: async (path: string) => { files.delete(path) },
    },
  })
  const a = save(null, 'A')
  await bounded(aWritten.promise, '保存 A 写入')
  const b = save(null, 'B').then((ok) => ({ ok, error: null }), (err: Error) => ({ ok: false, error: err.message }))
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const bStartedBeforeA = bStarted
  releaseA.release()
  const aReceipt = await bounded(a, '保存 A 回执')
  const textAtAReceipt = files.get('/isolated/save.json')
  releaseB.release()
  const bReceipt = await bounded(b, '保存 B 回执')
  assert.equal(bStartedBeforeA, false)
  assert.equal(aReceipt, true)
  assert.equal(textAtAReceipt, 'A')
  assert.equal(bReceipt.ok, true)
  assert.equal(files.get('/isolated/save.json'), 'B')
  report('C01', { fixed: true, bStartedBeforeA, aReceipt, textAtAReceipt, bReceipt, finalText: files.get('/isolated/save.json'), evidence: '真实处理器 + 模拟文件系统，非真实玩家坏档证据' })

  const ledgerGate = deferred()
  const ledgerEntered = deferred()
  let ledgerFinished = false
  let receiptReceived = false
  const ironSave = saveHandler({ savePath: () => '/isolated/save.json',
    fs: { writeFile: async () => {}, rename: async () => {}, unlink: async () => {} },
    ironmanInfoOfSaveText: () => ({ seq: 7 }),
    ledger: { bumpLedger: async () => { ledgerEntered.release(); await ledgerGate.promise; ledgerFinished = true } },
  })
  const ironReceipt = ironSave(null, '{}').then((ok) => { receiptReceived = true; return ok })
  await bounded(ledgerEntered.promise, '账本事务开始')
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const receiptBeforeLedger = receiptReceived
  ledgerGate.release()
  const receipt = await bounded(ironReceipt, '铁人保存回执')
  assert.equal(receiptBeforeLedger, false)
  assert.equal(ledgerFinished, true)
  report('C01账本回执', { fixed: true, receipt, receiptBeforeLedger, ledgerFinishedAtReceipt: ledgerFinished })

  // C02：运行当前重连函数，统计权限之后是否触达读取/冲突入口。
  const fileSource = sourceOf('apps/desktop/src/renderer/src/game/saveFileHandle.ts')
  const reconnectNode = nodeOf(fileSource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'reconnectSaveFile')
  let reads = 0
  let permissionRequests = 0
  const reconnect = execute<() => Promise<unknown>>(`${reconnectNode.getText(fileSource)}\nconst result = reconnectSaveFile`, {
    loadHandle: async () => ({ name: 'synthetic.json', requestPermission: async () => { permissionRequests++; return 'granted' },
      getFile: async () => { reads++; return { text: async () => 'NEWER' } } }), tr: (id: string) => id,
  })
  const reconnectResult = await bounded(reconnect(), '绑定文件重连')
  report('C02', { reconnectResult, permissionRequests, fileReads: reads, evidence: '真实函数 + 模拟句柄，未实测浏览器授权界面' })

  const long = fresh()
  long.skills.trained['cruiser-ops'] = 4
  long.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
  long.warehouse.items['synaptic-accelerant'] = 10
  long.boostAutoRenew = true
  long.skillBoostUntilMs = 86_400_000
  advanceGame(long, 1000, ctx)
  const firstStock = long.warehouse.items['synaptic-accelerant']
  syncBoostRenew(long, ctx)
  syncBoostRenew(long, ctx)
  report('C03', { firstStock, afterSameTimeChecks: long.warehouse.items['synaptic-accelerant'], remain: long.skillBoostUntilMs - long.gameMs,
    renewLogs: long.logs.filter((row) => row.textId === 'core.consumable.013').length })

  const big = fresh()
  delete big.skills.trained.mining
  big.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 231_500 }]
  big.skillBoostUntilMs = 5000
  big.boostAutoRenew = false
  const small = structuredClone(big)
  advanceGame(big, 10_000, ctx)
  for (let i = 0; i < 10; i++) advanceGame(small, 1000, ctx)
  report('C04', { big: { level: big.skills.trained.mining ?? 0, queue: big.skills.queue }, small: { level: small.skills.trained.mining ?? 0, queue: small.skills.queue } })

  const frac = fresh()
  frac.fleet[frac.shipId]!.cargo = {}
  const accepted = addItem(frac, 'wreck-a-hi', 0.3)
  const added = frac.fleet[frac.shipId]!.cargo['wreck-a-hi'] ?? 0
  frac.fleet[frac.shipId]!.cargo['wreck-a-hi'] = 0.9
  const fracBack = loadSaveFile(serializeSaveFile(frac, 0)).state
  report('C05', { accepted, added, afterRoundtrip: fracBack.fleet[fracBack.shipId]!.cargo['wreck-a-hi'] ?? 0,
    currentTenRounds03: Array.from({ length: 10 }, () => wreckUnitsOf(0.3)).reduce((sum, n) => sum + n, 0),
    note: '作业已改统一整数保底，报告要求的十轮 0.3 = 3 尚不成立，不能为重现擅改已确认单位政策' })

  const lab = fresh()
  for (const site of ctx.stations.values()) lab.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  lab.aiCores.basic = 2
  lab.skills.trained[ctx.balance.aiCore.skillId] = 5
  lab.warehouse.items['jump-fuel'] = 59_400
  const recipe = ctx.labRecipes.get('jump-fuel')!
  for (const material of recipe.materials) lab.warehouse.items[material.itemId] = material.units * 10
  const starts = [startLabRun(lab, ctx, recipe.id, 'basic'), startLabRun(lab, ctx, recipe.id, 'basic')]
  if (lab.labRuns?.length) { lab.gameMs = Math.max(...lab.labRuns.map((run) => run.finishAtGameMs)); advanceLab(lab, ctx) }
  report('C06', { starts, result: labOutputStockOf(lab, recipe) })

  // C07：真实导出、persist 与序列化方法，桥用合成对象替代。
  const exported: string[] = []
  const saves: string[] = []
  const exportProbe = execute<{ state: ReturnType<typeof fresh>; exportSaveToFile(): Promise<unknown> }>(
    `class Probe { ${gameMethods(['persistSnapshot', 'persist', 'currentSaveText', 'exportSaveToFile'])}\n saveWriteState() { return 'ok' } }\nconst result = new Probe`, {
      bumpIronmanSeq, serializeSaveFile, saveBridge: { save: async (text: string) => { saves.push(text); return true },
        exportSaveToFile: async (text: string) => { exported.push(text); return { ok: true } } },
      requestPersistentStorage: async () => {}, noteSaveWriteFailed: () => {}, tr: (id: string) => id,
    })
  exportProbe.state = fresh()
  exportProbe.state.ironman = { on: true, seq: 7, sinceWallMs: 1000 }
  await bounded(exportProbe.exportSaveToFile(), '导出快照')
  const exportSeq = JSON.parse(exported[0]!).state.ironman.seq as number
  const saveSeq = JSON.parse(saves[0]!).state.ironman.seq as number
  report('C07', { exportSeq, saveSeq, verdict: ironmanLoadVerdict({ ironman: true, incomingSeq: exportSeq, currentSeq: saveSeq, ledgerSeq: saveSeq,
    incomingSavedAtWallMs: 1000, nowWallMs: 1001 }), evidence: '真实导出方法 + 模拟桥；用户手势/真实对话框未验证' })

  let backups = 0
  const backupProbe = execute<{ persistSnapshot(): Promise<string | null>; backupNow(): Promise<{ ok: boolean }> }>(
    `class Probe { ${gameMethods(['backupNow'])} }\nconst result = new Probe`, {
      saveBridge: { backup: async () => { backups++; return { ok: true, name: 'synthetic-old.json' } } },
      tr: (id: string) => id,
    })
  backupProbe.persistSnapshot = async () => null
  const backupResult = await backupProbe.backupNow()
  assert.equal(backupResult.ok, false)
  assert.equal(backups, 0)
  report('C08', { fixed: true, persistResult: false, backupResult, backupCalls: backups })

  const hist = fresh()
  hist.market.priceHistory = { 'ore-olivine': Array.from({ length: 48 }, (_, i) => 100 + i) }
  const histBack = loadSaveFile(serializeSaveFile(hist, 0)).state
  report('C09', { before: 48, after: histBack.market.priceHistory['ore-olivine']?.length, retained: histBack.market.priceHistory['ore-olivine'] })

  // C10：在自建目录里只放一份无效夹具，看正式工具是否正确传播失败。
  const dir = mkdtempSync(join(tmpdir(), 'whale-guoqing-recheck-'))
  try {
    const fixtures = join(dir, 'docs', 'test-saves')
    mkdirSync(fixtures, { recursive: true })
    writeFileSync(join(fixtures, 'synthetic-invalid.json'), 'not json', 'utf8')
    const tsxCli = require.resolve('tsx/cli')
    const run = spawnSync(process.execPath, [tsxCli, join(ROOT, 'tools/save-roundtrip-audit.ts')], { cwd: dir, encoding: 'utf8', timeout: 10_000 })
    if (run.error) throw run.error
    report('C10', { exitCode: run.status, falsePass: run.stdout.includes('✅ 存档往返体检通过'), output: run.stdout.trim() })
  } finally {
    const absolute = resolve(dir)
    assert(absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes('whale-guoqing-recheck-'))
    rmSync(absolute, { recursive: true, force: true })
  }
  const baseline = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  console.log(JSON.stringify({ baseline, evidence: '合成复核，不是修复通过，不读取个人档', rows }, null, 2))
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
