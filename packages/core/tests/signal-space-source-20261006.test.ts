import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_HULL_FLOOR,
  addShipToFleet,
  advanceWormhole,
  advanceWormholeAuto,
  aiCoreUsed,
  createInitialState,
  loadSaveFile,
  serializeSaveFile,
  wormholeAutoStart,
  wormholeEnter,
  wormholeExtract,
  wormholeGridScan,
  wormholeLeave,
  wormholeResume,
  wormholeTempAddShape,
} from '../src/index'

// 船长 2026-10-06 指定：旧玩法取 verify 的 c5f8be83，不取二号旧版本或零号新模式。
const SOURCE_COMMIT = 'c5f8be8346e2bde9b1e738e7ddbfd5ca4740d519'
const SOURCE_BLOB = '98012b1a55ece1473e226f7bb499887b5b628ce5'
const SOURCE_PATH = 'apps/desktop/src/renderer/src/panels/Wormhole.tsx'
const panelUrl = new URL('../../../apps/desktop/src/renderer/src/panels/SignalSpace.tsx', import.meta.url)
const source = readFileSync(panelUrl, 'utf8')
const original = execFileSync('git', ['show', `${SOURCE_COMMIT}:${SOURCE_PATH}`], {
  cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  encoding: 'utf8',
})
const ast = ts.createSourceFile('SignalSpace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const originalAst = ts.createSourceFile('Wormhole.tsx', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const printer = ts.createPrinter({ removeComments: true })

function collect<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = []
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function declaration(root: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const node = collect(root, ts.isFunctionDeclaration).find((fn) => fn.name?.text === name)
  if (!node) throw new Error(`缺少函数：${name}`)
  return node
}

function normalized(root: ts.SourceFile, name: string): string {
  return printer.printNode(ts.EmitHint.Unspecified, declaration(root, name), root).replace(/\r\n/g, '\n')
}

function engineCalls(root: ts.SourceFile): string[] {
  return collect(root, ts.isCallExpression)
    .map((call) => call.expression)
    .filter(ts.isPropertyAccessExpression)
    .filter((call) => ts.isIdentifier(call.expression) && call.expression.text === 'engine')
    .map((call) => call.name.text)
    .sort()
}

function translationIds(root: ts.SourceFile): string[] {
  return [...new Set(collect(root, ts.isStringLiteral).map((node) => node.text).filter((text) => /^(ui|core)\./.test(text)))].sort()
}

function classOf(node: ts.JsxElement): string | undefined {
  const attr = node.openingElement.attributes.properties.find(
    (prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'className',
  )
  return attr?.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : undefined
}

function elementWithClass(name: string): ts.JsxElement {
  const element = collect(ast, ts.isJsxElement).find((node) => classOf(node) === name)
  if (!element) throw new Error(`缺少布局节点：${name}`)
  return element
}

describe('信号空间 · 旧面板来源与隔离', () => {
  it('记录固定提交与原始 blob，导出 SignalSpacePanel，相对依赖仍在同级路径', () => {
    const blob = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex')
    expect(blob).toBe(SOURCE_BLOB)
    expect(source).toContain(SOURCE_COMMIT)
    expect(source).toContain(SOURCE_BLOB)
    const exported = declaration(ast, 'SignalSpacePanel')
    expect(exported.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true)
    expect(collect(ast, ts.isFunctionDeclaration).some((fn) => fn.name?.text === 'WormholePanel')).toBe(false)
    for (const node of ast.statements.filter(ts.isImportDeclaration)) {
      const path = (node.moduleSpecifier as ts.StringLiteral).text
      if (!path.startsWith('.')) continue
      const target = resolve(dirname(fileURLToPath(panelUrl)), path)
      expect(['.ts', '.tsx', '/index.ts', '/index.tsx'].some((suffix) => existsSync(target + suffix)), path).toBe(true)
    }
  })

  it('只调用来源的 legacy 命令，不引入整备、有限物资、事件、目标或精英分支，不新增文案 ID', () => {
    expect(engineCalls(ast)).toEqual(engineCalls(originalAst))
    expect(engineCalls(ast)).toContain('wormholeEnterFromStock')
    expect(engineCalls(ast)).toContain('wormholeAutoStart')
    const forbidden = /^(preparedEntry|newRun|debugEnabled|WhPreparation|WhSupplies|WhAlert|WhGroundList|WhExtraction|WhEventChoices|WhEncounterIntel|WhObjectiveProgress|WhGoals|WORMHOLE_EVENT_IDS|wormholeGroundBoard|WormholePreparationPlan|expeditionRules|supplyVersion|expeditionGoal|pendingEvent|eventKey|elite)$/
    expect(collect(ast, ts.isIdentifier).map((node) => node.text).filter((name) => forbidden.test(name))).toEqual([])
    expect(ast.statements.filter(ts.isImportDeclaration).map((node) => (node.moduleSpecifier as ts.StringLiteral).text))
      .not.toContain('./WormholeExpedition')
    expect(translationIds(ast)).toEqual(translationIds(originalAst))
  })

  it('旧准备、地图动作、敌人渲染、tempGrid 货仓和结算实现与固定来源一致', () => {
    const unchanged = [
      'handleEnter', 'startAuto', 'handleAutoStart', 'pickCell', 'travelTo',
      'doScan', 'doActivate', 'doDescend', 'doExtract', 'leaveBagPage',
      'tempDiscardAndContinue', 'tempStowAndContinue', 'renderHereNode',
      'WhHold', 'WhGridMap', 'SettleView',
    ]
    for (const name of unchanged) expect(normalized(ast, name), name).toBe(normalized(originalAst, name))
    expect(normalized(ast, 'WhHold')).toContain('run.tempGrid')
    expect(normalized(ast, 'WhHold')).toContain('WORMHOLE_TEMP_CELLS')
  })

  it('地图与固定命令区平级，四种旧确认挂在 priority 中，地点详情单独内滚', () => {
    expect(elementWithClass('app-wh-explore').children.filter(ts.isJsxElement).map(classOf))
      .toEqual(['app-wh-map-pane', 'app-wh-ops'])
    expect(elementWithClass('app-wh-map-pane').children.filter(ts.isJsxElement).map(classOf))
      .toEqual(['app-wh-head', 'app-wh-maprow', 'app-wh-map-info'])
    expect(elementWithClass('app-wh-ops').children.filter(ts.isJsxElement).map(classOf))
      .toEqual(['app-wh-ops-fixed', 'app-wh-details'])
    expect(elementWithClass('app-wh-ops-fixed').children.filter(ts.isJsxElement).map(classOf))
      .toEqual(['app-wh-status', 'app-wh-priority'])
    const priority = elementWithClass('app-wh-priority')
    expect(priority.children.filter(ts.isJsxElement).map(classOf)).toEqual(['app-wh-commands'])
    expect(priority.children.filter(ts.isJsxExpression).some((node) => node.expression?.getText(ast) === 'renderExploreConfirmations()')).toBe(true)
    const confirmations = normalized(ast, 'renderExploreConfirmations')
    for (const condition of ['extractAsk', 'pendingRuinsBattle', 'pendingNodeBattle', 'pendingCell']) expect(confirmations).toContain(condition)
    expect(confirmations).not.toContain('onClose')
    expect(source).toContain("tab === 'map' && run ? ' is-exploring' : ''")
  })

  it('关闭先置 closingRef，leave 同步通知也不能被恢复 effect 抢回活动位，自动准备不碰旧趟', () => {
    const resume = collect(declaration(ast, 'SignalSpacePanel'), ts.isCallExpression).find(
      (call) => ts.isIdentifier(call.expression) && call.expression.text === 'useEffect' && call.getText(ast).includes('engine.wormholeResume()'),
    )?.arguments[0]
    if (!resume) throw new Error('缺少恢复 effect')
    const state = { wormhole: { run: { attending: true, battle: null as object | null } } }
    const scope = {
      state, auto: false, closingRef: { current: false },
      engine: { wormholeLeave: vi.fn(), wormholeResume: vi.fn(() => ({ ok: true })) },
      onClose: vi.fn(), onToast: vi.fn(), setResumeNote: vi.fn(), tr: (id: string) => id,
    }
    const script = `${declaration(ast, 'handleClose').getText(ast)}\nconst resumeEffect = ${resume.getText(ast)}\n({ handleClose, resumeEffect })`
    const compiled = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const callbacks = runInNewContext(compiled, scope) as { handleClose: () => void; resumeEffect: () => void }
    scope.engine.wormholeLeave.mockImplementation(() => {
      state.wormhole.run.attending = false
      callbacks.resumeEffect()
    })
    callbacks.handleClose()
    expect(scope.closingRef.current).toBe(true)
    expect(scope.engine.wormholeLeave).toHaveBeenCalledOnce()
    expect(scope.engine.wormholeResume).not.toHaveBeenCalled()
    expect(scope.onClose).toHaveBeenCalledOnce()
    scope.engine.wormholeLeave.mockClear()
    scope.closingRef.current = false
    state.wormhole.run.attending = true
    scope.auto = true
    callbacks.handleClose()
    callbacks.resumeEffect()
    expect(scope.engine.wormholeLeave).not.toHaveBeenCalled()
    expect(scope.engine.wormholeResume).not.toHaveBeenCalled()
    expect(state.wormhole.run.attending).toBe(true)
  })
})

const ctx = buildSimContext()
function legacyFleet() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const fleet = Array.from({ length: 2 }, () => addShipToFleet(state, 'sh-thresher'))
  state.warehouse.items['repairkit-mil'] = 200
  state.skills.trained['ai-expert'] = 2
  return { state, fleet }
}

describe('信号空间 · legacy 核心集成', () => {
  it('旧入场不扣母港物资、不创建新模式字段，扫描仍只扣一回合且保留旧地点与敌人', () => {
    const { state, fleet } = legacyFleet()
    state.shipId = fleet[0]!
    const warehouse = structuredClone(state.warehouse)
    expect(wormholeEnter(state, ctx, fleet, 19, { depth: 1, archetype: 'balanced', family: 'A' }).ok).toBe(true)
    const run = state.wormhole.run!
    expect(run.expeditionRules).toBeUndefined()
    expect(run.supplyVersion).toBeUndefined()
    expect(run.supplies).toBeUndefined()
    expect(run.expeditionGoal).toBeUndefined()
    expect(state.warehouse).toEqual(warehouse)
    expect(run.grid!.cells.some((cell) => cell.place === 'ship')).toBe(true)
    expect(run.grid!.cells.some((cell) => cell.eventKey || cell.elite)).toBe(false)
    const turns = run.turnsLeft
    expect(wormholeGridScan(state)).toMatchObject({ ok: true, spent: 1 })
    expect(run.turnsLeft).toBe(turns - 1)
  })

  it('旧 tempGrid 阻挡扫描，关闭与读档完整保留，恢复后撤离丢弃临时货', () => {
    const { state, fleet } = legacyFleet()
    state.shipId = fleet[0]!
    expect(wormholeEnter(state, ctx, fleet, 19).ok).toBe(true)
    expect(wormholeTempAddShape(state, ctx, 'ai-core-gamma').ok).toBe(true)
    const run = state.wormhole.run!
    const temporary = structuredClone(run.tempGrid)
    const turns = run.turnsLeft
    expect(wormholeGridScan(state).ok).toBe(false)
    expect(run.turnsLeft).toBe(turns)
    expect(run.groundCargo).toBeUndefined()
    wormholeLeave(state)
    expect(run.attending).toBe(false)
    expect(run.tempGrid).toEqual(temporary)
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(restored.wormhole.run!.tempGrid).toEqual(temporary)
    expect(wormholeResume(restored, ctx).ok).toBe(true)
    expect(restored.wormhole.run!.tempGrid).toEqual(temporary)
    expect(wormholeExtract(restored.wormhole.run!).ok).toBe(true)
    advanceWormhole(restored, ctx)
    expect(restored.wormhole.run).toBeNull()
    expect(restored.wormhole.lastSettle?.kind).toBe('extract')
    expect(restored.warehouse.items['ai-core-gamma'] ?? 0).toBe(0)
  })

  it('旧自动按原时长与一队一核结算，不扣携入物资、保留不丢船保险且不重复入账', () => {
    const { state, fleet } = legacyFleet()
    state.wormholeStock = [{ id: 'legacy-signal', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0 }]
    const used = aiCoreUsed(state)
    const cargo = fleet.map((id) => structuredClone(state.fleet[id]!.cargo))
    expect(wormholeAutoStart(state, ctx, 'legacy-signal', fleet).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(used + 1)
    expect(state.wormholeAuto![0]!.expeditionRules).toBeUndefined()
    expect(state.wormholeAuto![0]!.expeditionSnapshot).toBeUndefined()
    expect(state.warehouse.items['repairkit-mil']).toBe(200)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS - 1
    advanceWormholeAuto(state, ctx)
    expect(state.wormholeAuto).toHaveLength(1)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
    advanceWormholeAuto(state, ctx)
    expect(state.wormholeAuto).toEqual([])
    expect(aiCoreUsed(state)).toBe(used)
    const report = state.wormholeAutoReports![0]!
    expect(report.expeditionRules).toBeUndefined()
    expect(report.shipsLost).toBeUndefined()
    expect(report.confirmed).toBe(false)
    expect(report.damage).toHaveLength(fleet.length)
    for (const id of fleet) {
      expect(state.fleet[id]).toBeDefined()
      expect(state.fleet[id]!.durability).toBeGreaterThanOrEqual(WORMHOLE_AUTO_HULL_FLOOR)
    }
    expect(fleet.map((id) => state.fleet[id]!.cargo)).toEqual(cargo)
    const settled = structuredClone(state)
    advanceWormholeAuto(state, ctx)
    expect(state).toEqual(settled)
  })
})
