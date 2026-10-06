import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLUEPRINTS, SHIP_BLUEPRINTS } from '../../../packages/data/src/index'
import { DataEditorRepository, type DataEditorRepositoryOptions } from '../../../tools/data-editor-repository'
import { TABLE_FILES } from '../../../tools/data-editor-schema'
import type { DataDocument, DataRow, DataTable, NumericEdit } from '../../../tools/data-editor-contract'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const tables: DataTable[] = ['ships', 'modules', 'plugs', 'items', 'market']
let base: string
let primary: string
let root: string
let repo: DataEditorRepository

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=disabled-hooks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true,
  }).trim()
}
async function write(cwd: string, file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(join(cwd, file, '..'), { recursive: true })
  await fs.writeFile(join(cwd, file), data)
}
const bytes = (table: DataTable): Promise<Buffer> => fs.readFile(join(root, TABLE_FILES[table]))
const edits: NumericEdit[] = [{ table: 'ships', id: 'ship-a', path: 'priceIsk', value: 120 }]
function service(options: DataEditorRepositoryOptions = {}): DataEditorRepository {
  return new DataEditorRepository({ trustedRepository: primary, checker: async () => undefined, ...options })
}
async function preview(instance = repo) {
  const project = await instance.openProject(root)
  const plan = await instance.preview(root, project.fingerprint, edits)
  expect(plan.issues).toEqual([])
  return plan
}
async function allBytes(): Promise<Buffer[]> { return Promise.all(tables.map(bytes)) }
async function journals(): Promise<Array<{ file: string; value: Record<string, any> }>> {
  const folder = join(root, 'tools/_data-editor/backups')
  const result = []
  for (const id of await fs.readdir(folder)) {
    const file = join(folder, id, 'journal.json')
    try { result.push({ file, value: JSON.parse(await fs.readFile(file, 'utf8')) }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return result
}
async function removeTemporary(path: string): Promise<void> {
  const parent = await fs.realpath(tmpdir())
  const actual = await fs.realpath(path)
  const rel = relative(parent, actual)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !rel.startsWith('whale-editor-')) throw new Error('拒绝清理非测试目录')
  const links = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = join(dir, entry.name)
      const stat = await fs.lstat(target)
      if (stat.isSymbolicLink()) await fs.unlink(target)
      else if (stat.isDirectory()) await links(target)
    }
  }
  await links(actual)
  await fs.rm(actual, { recursive: true, force: true })
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'whale-editor-'))
  primary = join(base, '项目主树')
  root = join(base, '零号 ; & 仓库')
  await fs.mkdir(primary)
  git(primary, 'init', '-q', '-b', 'main')
  git(primary, 'config', 'user.email', 'data-editor-test@example.invalid')
  git(primary, 'config', 'user.name', 'Data Editor Test')
  git(primary, 'config', 'core.autocrlf', 'false')
  await write(primary, '.gitignore', 'node_modules/\nout/\n*.tmp\ndocs/test-saves/save-*.json\n')
  await write(primary, 'package.json', JSON.stringify({ name: 'whale-eve-idle', scripts: { 'content:check': 'must-not-run', build: 'must-not-run' } }))
  await write(primary, 'packages/core/package.json', '{"name":"@whale/core"}')
  await write(primary, 'packages/data/package.json', '{"name":"@whale/data"}')
  const rows: Record<DataTable, DataRow[]> = {
    ships: [{ id: 'ship-a', tier: 1, role: 'industrial', cargoM3: 800, cycleSeconds: 12, oreUnitsPerCycle: 10, agility: 0.6, shieldHp: 10, priceIsk: 100 }],
    modules: [{ id: 'mod-a', slot: 'miner', cpuUse: 10 }],
    plugs: [{ id: 'plug-a', slot: 'plug', cpuUse: 1 }],
    items: [{ id: 'item-a', kind: 'mineral', unitM3: 1, baseSellPriceIsk: 50 }],
    market: [{ key: 'ship-a', kind: 'ship', refId: 'ship-a', rarity: 'common', basePrice: 100 }],
  }
  for (const table of tables) {
    const document: DataDocument = { format: 'whale-static-data', version: 1, table, groups: { test: rows[table] } }
    await write(primary, TABLE_FILES[table], JSON.stringify(document, null, 2) + '\n')
    const text = table === 'market' ? 'marketCatalog' : table
    await write(primary, `packages/data/src/${text}.ts`, `export const ${table.toUpperCase()}_TEXT_BINDINGS = { '${rows[table][0].id ?? rows[table][0].key}': { name: '测试${table}' } } as const\n`)
  }
  await write(primary, 'packages/core/src/wip.ts', 'export const original = 1\n')
  await write(primary, 'docs/test-saves/user-backup-secret.json', '{"private":"do not copy"}')
  await write(primary, 'docs/test-saves/test-save-fixture.json', '{"fixture":true}')
  git(primary, 'add', '.')
  git(primary, 'commit', '-qm', 'fixture')
  git(primary, 'worktree', 'add', '-qb', 'editor/test', root)
  repo = service()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await removeTemporary(base)
})

describe('JSON仓库服务 · 身份与计划', () => {
  it('读真实JSON与AST名称，主树或main分支只读，未知仓库和非Git目录拒绝', async () => {
    const project = await repo.openProject(root)
    expect(project.writable).toBe(true)
    expect(project.branch).toBe('editor/test')
    expect(project.rows.find(row => row.id === 'ship-a' && row.table === 'ships')!.name).toBe('测试ships')
    const main = await repo.openProject(primary)
    expect(main.writable).toBe(false)
    expect((await repo.check(primary)).ok).toBe(false)
    expect((await repo.restore(primary)).ok).toBe(false)
    git(root, 'branch', 'main-copy')
    git(primary, 'symbolic-ref', 'HEAD', 'refs/heads/main-copy')
    git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    expect((await repo.openProject(root)).writable).toBe(false)
    const unknown = join(base, 'unknown')
    await fs.mkdir(unknown)
    await expect(repo.openProject(unknown)).rejects.toThrow(/非Git|未知仓库/)
    git(unknown, 'init', '-q')
    await expect(repo.openProject(unknown)).rejects.toThrow(/未知仓库/)
  })

  it('fingerprint包含JSON原文、HEAD和文本绑定，外部修改后preview/save拒绝', async () => {
    const project = await repo.openProject(root)
    const plan = await repo.preview(root, project.fingerprint, edits)
    await write(root, 'packages/data/src/ships.ts', "const SHIPS_TEXT_BINDINGS = { 'ship-a': { name: '外部改名' } }\n")
    await expect(repo.preview(root, project.fingerprint, edits)).rejects.toThrow('外部修改')
    expect((await repo.save(root, plan.token)).ok).toBe(false)
    const changed = await repo.openProject(root)
    expect(changed.fingerprint).not.toBe(project.fingerprint)
    git(root, 'commit', '--allow-empty', '-qm', 'new head')
    expect((await repo.openProject(root)).fingerprint).not.toBe(changed.fingerprint)
  })

  it('商品key与refId不同仍显示引用内容名，价格计划按refId联动', async () => {
    const doc = JSON.parse((await bytes('market')).toString())
    doc.groups.test[0].key = 'good-ship-a'
    await fs.writeFile(join(root, TABLE_FILES.market), JSON.stringify(doc))
    await write(root, 'packages/data/src/marketCatalog.ts', 'const MARKET_TEXT_BINDINGS = {}\n')
    const project = await repo.openProject(root)
    expect(project.rows.find(row => row.table === 'market')!.name).toBe('测试ships')
    const plan = await repo.preview(root, project.fingerprint, [{ table: 'market', id: 'good-ship-a', path: 'basePrice', value: 130 }])
    expect(plan.issues).toEqual([])
    expect(plan.changes).toContainEqual(expect.objectContaining({ table: 'ships', id: 'ship-a', value: 130, linked: true }))
  })

  it('装备/舰船蓝图按refId显示原名称，支持本地化绑定，不执行名称表达式', async () => {
    const doc = JSON.parse((await bytes('market')).toString())
    doc.groups.test.push(
      { key: 'good-blueprint-a', kind: 'blueprint', refId: 'bp-a', rarity: 'common', basePrice: 100 },
      { key: 'good-ship-blueprint', kind: 'blueprint', refId: 'sbp-a', rarity: 'common', basePrice: 100 },
      { key: 'good-local-blueprint', kind: 'blueprint', refId: 'sbp-local', rarity: 'common', basePrice: 100 },
      { key: 'good-unsafe-blueprint', kind: 'blueprint', refId: 'bp-unsafe', rarity: 'common', basePrice: 100 },
    )
    await fs.writeFile(join(root, TABLE_FILES.market), JSON.stringify(doc))
    await write(root, 'packages/data/src/blueprints.ts', `
      export const BLUEPRINTS = [
        { id: 'bp-a', name: '强化采集器蓝图', priceIsk: 100 },
        { id: 'bp-unsafe', name: (() => { throw new Error('must never execute') })() }
      ] as const
    `)
    await write(root, 'packages/data/src/shipBlueprints.ts', `
      export const SHIP_BLUEPRINTS = [
        { id: 'sbp-a', name: '舰船制造蓝图', priceIsk: 100 },
        { id: 'sbp-local', name: (L10N['ship.blueprint.name']!.zh) }
      ] as const
    `)
    await write(root, 'packages/data/src/l10n/table.ts', "export const L10N = { 'ship.blueprint.name': { zh: '海牛级舰船蓝图', en: 'Manatee Blueprint' } }\n")
    const project = await repo.openProject(root)
    const market = new Map(project.rows.filter(row => row.table === 'market').map(row => [row.id, row]))
    expect(market.get('good-blueprint-a')!.name).toBe('强化采集器蓝图')
    expect(market.get('good-ship-blueprint')!.name).toBe('舰船制造蓝图')
    expect(market.get('good-local-blueprint')!.name).toBe('海牛级舰船蓝图')
    expect(market.get('good-unsafe-blueprint')!.name).toBe('good-unsafe-blueprint')
    expect(project.rows).toHaveLength(9)
    const plan = await repo.preview(root, project.fingerprint, [{ table: 'market', id: 'good-blueprint-a', path: 'basePrice', value: 120 }])
    expect(plan.issues.some(issue => issue.message.includes('蓝图书价'))).toBe(true)
  })

  it.each(['blueprints', 'shipBlueprints'])('%s名称来源参与指纹，外部改名后旧预览不能保存', async file => {
    const source = `packages/data/src/${file}.ts`
    const symbol = file === 'blueprints' ? 'BLUEPRINTS' : 'SHIP_BLUEPRINTS'
    await write(root, source, `export const ${symbol} = [{ id: 'bp-name-only', name: '旧名称' }]\n`)
    const project = await repo.openProject(root)
    const plan = await repo.preview(root, project.fingerprint, edits)
    expect(plan.issues).toEqual([])
    const before = await allBytes()
    await write(root, source, `export const ${symbol} = [{ id: 'bp-name-only', name: '新名称' }]\n`)
    expect((await repo.openProject(root)).fingerprint).not.toBe(project.fingerprint)
    await expect(repo.preview(root, project.fingerprint, edits)).rejects.toThrow('外部修改')
    expect((await repo.save(root, plan.token)).ok).toBe(false)
    expect(await allBytes()).toEqual(before)
  })

  it('当前商品目录中的全部蓝图名称与两类权威蓝图目录一致，JSON字节不变', async () => {
    const source = (file: string) => fs.readFile(new URL(`../../../${file}`, import.meta.url))
    const market = await source(TABLE_FILES.market)
    await write(root, TABLE_FILES.market, market)
    for (const file of ['blueprints.ts', 'shipBlueprints.ts', 'l10n/table.ts']) {
      const path = `packages/data/src/${file}`
      await write(root, path, await source(path))
    }
    await write(root, 'packages/data/src/marketCatalog.ts', 'const MARKET_TEXT_BINDINGS = {}\n')
    const expected = new Map([...BLUEPRINTS, ...SHIP_BLUEPRINTS].map(row => [row.id, row.name]))
    const project = await repo.openProject(root)
    const blueprints = project.rows.filter(row => row.table === 'market' && row.category === 'blueprint')
    expect(blueprints.length).toBeGreaterThan(100)
    for (const row of blueprints) {
      expect(expected.has(String(row.values.refId)), row.id).toBe(true)
      expect(row.name, row.id).toBe(expected.get(String(row.values.refId)))
      expect(row.name, row.id).not.toBe(row.id)
    }
    expect(await bytes('market')).toEqual(market)
  })

  it('schema拒绝非法数值、重复字段、结构字段和未知表，服务端令牌不可伪造', async () => {
    const project = await repo.openProject(root)
    for (const bad of [
      [{ table: 'ships', id: 'ship-a', path: 'shieldHp', value: -1 }],
      [{ table: 'ships', id: 'ship-a', path: 'tier', value: 3 }],
      [edits[0], edits[0]],
    ] as NumericEdit[][]) expect((await repo.preview(root, project.fingerprint, bad)).issues.length).toBeGreaterThan(0)
    await expect(repo.preview(root, project.fingerprint, [{ table: 'unknown', id: 'ship-a', path: 'priceIsk', value: 9 }] as unknown as NumericEdit[])).rejects.toThrow('合法表名')
    expect((await repo.save(root, 'made-up-token')).ok).toBe(false)
    const before = await allBytes()
    const plan = await preview()
    plan.changes[0]!.value = 999999
    expect((await repo.save(root, plan.token)).ok).toBe(true)
    expect(JSON.parse((await bytes('ships')).toString()).groups.test[0].priceIsk).toBe(120)
    expect((await repo.save(root, plan.token)).ok).toBe(false)
    expect(await bytes('modules')).toEqual(before[1])
  })

  it('严格UTF8、嵌套重复键和转义后重复键都拒绝，不用JSON.parse静默覆盖', async () => {
    const original = await bytes('ships')
    await fs.writeFile(join(root, TABLE_FILES.ships), Buffer.from([0xff, 0xfe, 0x41]))
    await expect(repo.openProject(root)).rejects.toThrow('严格UTF-8')
    await fs.writeFile(join(root, TABLE_FILES.ships), '{"format":"whale-static-data","format":"whale-static-data"}')
    await expect(repo.openProject(root)).rejects.toThrow('重复键')
    await fs.writeFile(join(root, TABLE_FILES.ships), original.toString().replace('"shieldHp": 10', '"shieldHp": 10, "shield\\u0048p": 20'))
    await expect(repo.openProject(root)).rejects.toThrow('重复键')
  })

  it.each(['"prototype": {}', '"__proto__": {}', '"unknownCpu": 10', '"shieldHp": "10"'])('严格shape拒绝未知字段或类型：%s', async extra => {
    const original = await bytes('ships')
    await fs.writeFile(join(root, TABLE_FILES.ships), original.toString().replace('"shieldHp": 10', extra))
    await expect(repo.openProject(root)).rejects.toThrow('数据契约失败')
  })

  it('TS字面量和二元算术仅安全解读为只读展示值，调用表达式不执行也不物化JSON', async () => {
    await write(root, 'packages/data/src/marketCatalog.ts', `
      const MARKET_TEXT_BINDINGS = {
        'ship-a': { name: '安全表达式', limitedSupplyEveryMs: 6 * 60_000, multiplier: (2 + 3) / 2,
          negative: -(2 ** 3), nested: { ratio: 10 % 3 }, invalid: 1 / 0,
          arbitrary: (() => { throw new Error('must never execute') })(), identifier: UNKNOWN_VALUE }
      } as const
    `)
    const original = await bytes('market')
    const project = await repo.openProject(root)
    const row = project.rows.find(row => row.table === 'market')!
    expect(row.name).toBe('安全表达式')
    expect(row.values).toMatchObject({ limitedSupplyEveryMs: 360_000, multiplier: 2.5, negative: -8, nested: { ratio: 1 } })
    expect(row.values.invalid).toBeUndefined()
    expect(row.values.arbitrary).toBeUndefined()
    expect(row.values.identifier).toBeUndefined()
    expect(row.fields.find(field => field.path === 'limitedSupplyEveryMs')).toMatchObject({ writable: false, readonlyReason: 'readonly code expression' })
    const plan = await repo.preview(root, project.fingerprint, [{ table: 'market', id: 'ship-a', path: 'limitedSupplyEveryMs', value: 1 }])
    expect(plan.issues[0].message).toContain('readonly code expression')
    expect(await bytes('market')).toEqual(original)
  })

  it('拒绝JSON父目录junction逸出，外部文件保持不变', async () => {
    const outside = join(base, 'outside')
    await fs.mkdir(outside)
    const original = await bytes('ships')
    await fs.writeFile(join(outside, 'ships.json'), original)
    await fs.rename(join(root, 'packages/data/src/static'), join(root, 'packages/data/src/static-local'))
    await fs.symlink(outside, join(root, 'packages/data/src/static'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(repo.openProject(root)).rejects.toThrow(/链接|普通文件/)
    expect(await fs.readFile(join(outside, 'ships.json'))).toEqual(original)
  })
})

describe('JSON仓库服务 · 隔离检查与落盘', () => {
  it('复制tracked+WIP+JSON，不复制ignored产物或个人档，check/build只在候选运行', async () => {
    await write(root, 'packages/core/src/wip.ts', 'export const original = 2\n')
    await write(root, 'packages/core/tests/new-wip.test.ts', '// untracked WIP\n')
    await write(root, 'node_modules/ignored.txt', 'do not copy')
    await write(root, 'out/game.txt', 'do not copy')
    await write(root, 'docs/test-saves/save-private.json', 'do not read')
    const seen: string[] = [], modes: string[] = []
    const instance = service({ checker: async request => {
      seen.push(request.root); modes.push(request.mode)
      expect(request.root).not.toBe(root)
      expect(await fs.readFile(join(request.root, 'packages/core/src/wip.ts'), 'utf8')).toContain('= 2')
      expect(await fs.readFile(join(request.root, 'packages/core/tests/new-wip.test.ts'), 'utf8')).toContain('WIP')
      expect(JSON.parse(await fs.readFile(join(request.root, TABLE_FILES.ships), 'utf8')).groups.test[0].priceIsk).toBe(100)
      for (const path of ['node_modules/ignored.txt', 'out/game.txt', 'docs/test-saves/save-private.json', 'docs/test-saves/user-backup-secret.json']) {
        await expect(fs.stat(join(request.root, path))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(await fs.readFile(join(request.root, 'docs/test-saves/test-save-fixture.json'), 'utf8')).toContain('fixture')
      if (request.mode === 'build') {
        for (const path of ['apps/desktop/out/main/index.js', 'apps/desktop/out/preload/index.js', 'apps/desktop/out/renderer/index.html', 'web/dist/index.html']) {
          await write(request.root, path, `built:${path}`)
        }
      }
    } })
    const before = await allBytes()
    expect((await instance.check(root)).ok).toBe(true)
    const build = await instance.build(root)
    expect(build.ok).toBe(true)
    expect(build.output).toBeDefined()
    expect(build.message).toContain(build.output!)
    expect(await fs.readFile(join(build.output!, 'desktop/out/main/index.js'), 'utf8')).toContain('built:')
    expect(await fs.readFile(join(build.output!, 'web/dist/index.html'), 'utf8')).toContain('built:')
    expect(JSON.parse(await fs.readFile(join(build.output!, 'build.json'), 'utf8')).files).toHaveLength(4)
    expect(modes).toEqual(['check', 'build'])
    expect(await allBytes()).toEqual(before)
    for (const path of seen) await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('缺失双端产物的构建不能宣称成功，不保留空包', async () => {
    const before = await allBytes()
    expect((await repo.build(root)).ok).toBe(false)
    expect(await allBytes()).toEqual(before)
    expect(await fs.readdir(join(root, 'tools/_data-editor/builds'))).toEqual([])
  })

  it('候选冻结测试失败时一个目标也不写，返回原因且临时目录收尾', async () => {
    let candidate = ''
    const instance = service({ checker: async request => {
      candidate = request.root
      expect(request.documents.ships.groups.test[0].priceIsk).toBe(120)
      return { ok: false, message: '冻结数值断言失败，不允许强制通过', issues: [{ table: 'ships', id: 'ship-a', path: 'priceIsk', message: '固定检查失败' }] }
    } })
    const original = await allBytes()
    const result = await instance.save(root, (await preview(instance)).token)
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('冻结数值') })
    expect(result.issues).toEqual([{ table: 'ships', id: 'ship-a', path: 'priceIsk', message: '固定检查失败' }])
    expect(await allBytes()).toEqual(original)
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('检查期间外部JSON、TS、WIP或分支变化均阻挡保存', async () => {
    const instance = service({ checker: async () => { await write(root, 'packages/core/src/wip.ts', 'external WIP\n') } })
    const original = await allBytes()
    expect((await instance.save(root, (await preview(instance)).token)).message).toContain('源码发生变化')
    expect(await allBytes()).toEqual(original)
    expect(await fs.readFile(join(root, 'packages/core/src/wip.ts'), 'utf8')).toBe('external WIP\n')
  })

  it('多实例并发保存被锁拒绝，检查结束后锁释放', async () => {
    let release!: () => void, entered!: () => void
    const wait = new Promise<void>(accept => { release = accept })
    const start = new Promise<void>(accept => { entered = accept })
    const first = service({ checker: async () => { entered(); await wait } })
    const token = (await preview(first)).token
    const second = service()
    const secondToken = (await preview(second)).token
    const saving = first.save(root, token)
    await start
    try { expect((await second.save(root, secondToken)).message).toContain('操作进行中') }
    finally { release() }
    expect((await saving).ok).toBe(true)
    await expect(fs.stat(join(root, 'tools/_data-editor/lock.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('备份保存前原文含WIP，BOM/CRLF/制表缩进保留，restore逐字恢复', async () => {
    const doc = JSON.parse((await bytes('ships')).toString())
    doc.groups.test[0].shieldHp = 17
    const original = Buffer.from('\uFEFF' + JSON.stringify(doc, null, '\t').replace(/\n/g, '\r\n') + '\r\n')
    await fs.writeFile(join(root, TABLE_FILES.ships), original)
    const result = await repo.save(root, (await preview()).token)
    expect(result.ok).toBe(true)
    expect(await fs.readFile(join(result.backup!, '0.before'))).toEqual(original)
    const saved = await bytes('ships')
    expect(saved.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(saved.toString()).toContain('\r\n\t"format"')
    expect(saved.toString()).not.toMatch(/(?<!\r)\n/)
    expect((await repo.restore(root)).ok).toBe(true)
    expect(await bytes('ships')).toEqual(original)
    expect(JSON.parse((await bytes('market')).toString()).groups.test[0].basePrice).toBe(100)
  })

  it('写入第二文件失败则按日志回滚本次写入，不回滚HEAD或原有WIP', async () => {
    const original = await allBytes()
    const head = git(root, 'rev-parse', 'HEAD')
    const instance = service({ fault: point => { if (point === 'afterWrite') throw new Error('模拟磁盘写失败') } })
    const result = await instance.save(root, (await preview(instance)).token)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('已恢复本次原文')
    expect(await allBytes()).toEqual(original)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    expect((await journals())[0].value.state).toBe('rolled-back')
  })

  it('半写之后外部修改另一目标，自动回滚完整preflight失败，不先恢复无冲突文件', async () => {
    const external = (await bytes('market')).toString().replace('100', '888')
    const instance = service({ fault: async (point, file) => {
      if (point === 'afterWrite' && file === TABLE_FILES.ships) {
        await fs.writeFile(join(root, TABLE_FILES.market), external)
        throw new Error('模拟并行编辑')
      }
    } })
    const result = await instance.save(root, (await preview(instance)).token)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('恢复冲突')
    expect(JSON.parse((await bytes('ships')).toString()).groups.test[0].priceIsk).toBe(120)
    expect((await bytes('market')).toString()).toBe(external)
    await expect(service().openProject(root)).rejects.toThrow('恢复冲突')
  })

  it('显式restore先核对全部tool-after哈希，任一外部修改阻挡全部恢复', async () => {
    expect((await repo.save(root, (await preview()).token)).ok).toBe(true)
    const shipsAfter = await bytes('ships')
    await fs.writeFile(join(root, TABLE_FILES.market), (await bytes('market')).toString().replace('120', '777'))
    expect((await repo.restore(root)).message).toContain('恢复冲突')
    expect(await bytes('ships')).toEqual(shipsAfter)
    expect(JSON.parse((await bytes('market')).toString()).groups.test[0].basePrice).toBe(777)
  })
})

describe('JSON仓库服务 · 崩溃恢复与生产限制', () => {
  it('可信同仓工作树依赖可复用，固定CLI解析workspace仍取候选JSON和WIP', async () => {
    const trusted = join(base, '可信零号')
    git(primary, 'worktree', 'add', '-qb', 'editor/trusted', trusted)
    const cli = `const fs = require('node:fs'); const path = require('node:path');
      const resolved = require.resolve('@whale/data');
      if (!resolved.includes('_data-editor' + path.sep + 'candidates')) throw new Error('workspace resolved outside candidate: ' + resolved);
      const data = JSON.parse(fs.readFileSync(path.join(path.dirname(resolved), 'src/static/ships.json'), 'utf8'));
      if (data.groups.test[0].priceIsk !== 120) throw new Error('candidate JSON not loaded');
      const wip = fs.readFileSync(path.join(path.dirname(resolved), '../core/src/wip.ts'), 'utf8');
      if (!wip.includes('= 88')) throw new Error('candidate WIP not loaded');
    `
    await write(root, 'packages/data/package.json', '{"name":"@whale/data","main":"index.cjs"}')
    await write(root, 'packages/data/index.cjs', 'module.exports = {}\n')
    await write(root, 'packages/core/src/wip.ts', 'export const original = 88\n')
    for (const [pkg, file] of [['typescript', 'bin/tsc'], ['tsx', 'dist/cli.mjs'], ['vitest', 'vitest.mjs']]) {
      await write(trusted, `node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, type: 'commonjs' }))
      const body = file.endsWith('.mjs') ? `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); ${cli}` : cli
      await write(trusted, `node_modules/${pkg}/${file}`, body)
    }
    await fs.symlink(join(trusted, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    const production = new DataEditorRepository({ trustedRepository: trusted, runtime: { execPath: process.execPath } })
    const plan = await preview(production)
    const result = await production.save(root, plan.token)
    expect(result.ok, result.message).toBe(true)
    expect(JSON.parse((await bytes('ships')).toString()).groups.test[0].priceIsk).toBe(120)
    expect((await production.restore(root)).ok).toBe(true)
    expect(JSON.parse((await bytes('ships')).toString()).groups.test[0].priceIsk).toBe(100)
  })

  it('依赖junction指向未授权目录时拒绝执行，目标保持原文', async () => {
    const outside = join(base, '未知依赖')
    await fs.mkdir(outside)
    await fs.symlink(outside, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    const before = await allBytes()
    const production = new DataEditorRepository({ trustedRepository: primary })
    const result = await production.save(root, (await preview(production)).token)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('已验证的工作树依赖目录')
    expect(await allBytes()).toEqual(before)
  })

  it.each(['afterJournal', 'afterWrite', 'beforeCommit'] as const)('%s中断后新服务按durable journal恢复，重复打开幂等', async point => {
    const original = await allBytes()
    const instance = service({ fault: at => { if (at === point) return 'crash' } })
    expect((await instance.save(root, (await preview(instance)).token)).ok).toBe(false)
    const recovered = service()
    expect((await recovered.openProject(root)).writable).toBe(true)
    expect(await allBytes()).toEqual(original)
    await recovered.openProject(root)
    expect(await allBytes()).toEqual(original)
    expect((await journals())[0].value.state).toBe('rolled-back')
  })

  it('restore中断后恢复日志完整preflight，继续恢复而不是丢弃备份', async () => {
    const original = await allBytes()
    expect((await repo.save(root, (await preview()).token)).ok).toBe(true)
    const interrupted = service({ fault: at => { if (at === 'afterRestoreWrite') return 'crash' } })
    expect((await interrupted.restore(root)).ok).toBe(false)
    await service().openProject(root)
    expect(await allBytes()).toEqual(original)
  })

  it('损坏或注入任意目标的journal拒绝恢复，不读写白名单外文件', async () => {
    const instance = service({ fault: at => { if (at === 'afterJournal') return 'crash' } })
    await instance.save(root, (await preview(instance)).token)
    const [{ file, value }] = await journals()
    value.files[0].file = '../outside.json'
    await fs.writeFile(file, JSON.stringify(value))
    const original = await allBytes()
    await expect(service().openProject(root)).rejects.toThrow('白名单')
    expect(await allBytes()).toEqual(original)
  })

  it('生产不允许checker注入；默认检查缺依赖明确失败，未知npm脚本不执行', async () => {
    vi.stubEnv('VITEST', 'false')
    expect(() => service()).toThrow('禁止注入')
    const production = new DataEditorRepository({ trustedRepository: primary, runtime: { execPath: process.execPath, electronRunAsNode: true } })
    const before = await allBytes()
    expect((await production.check(root)).message).toContain('缺少项目node_modules')
    expect(await allBytes()).toEqual(before)
  })
})
