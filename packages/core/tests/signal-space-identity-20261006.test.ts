import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { addLog, createInitialState } from '../src/state'
import { signalSpaceTextId, SIGNAL_SPACE_TEXT_IDS } from '../src/explorationText'
import { wormholeEnter } from '../src/wormhole'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import { activityOverview } from '../src/activity'

const ctx = buildSimContext()
describe('信号空间旧来源与未来虫洞身份隔离', () => {
  it('旧ID历史词不改，新ID正确命名，参数集合守恒', () => {
    expect(L10N['ui.Expedition.005']!.zh).toBe('虫洞')
    expect(L10N[signalSpaceTextId('ui.Expedition.005')]!.zh).toBe('信号空间')
    for (const [oldId, newId] of Object.entries(SIGNAL_SPACE_TEXT_IDS)) {
      expect(signalSpaceTextId(oldId, 2)).toBe(oldId)
      const old = L10N[oldId]!, next = L10N[newId]!
      expect(next).toBeTruthy()
      const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
      expect(params(next.zh)).toEqual(params(old.zh))
      expect(params(next.en)).toEqual(params(old.en))
    }
  })

  it('只开启debug仍旧入口；显式本机实验或验收标记才允许新入口', () => {
    const path = 'apps/desktop/src/renderer/src/game/debugFlag.ts'
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
    const body = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n')
    const store = new Map([['whale-idle:debug', '1']])
    const scope: Record<string, any> = { exports: {}, location: { protocol: 'http:', hostname: '127.0.0.1' }, isLocalDebugOrigin: (protocol: string, host: string) => protocol !== 'file:' && ['127.0.0.1', 'localhost'].includes(host), localStorage: { getItem: (key: string) => store.get(key) ?? null } }
    runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
    expect(scope.exports.futureWormholeEnabled()).toBe(false)
    store.set('whale-idle:future-wormhole', '1')
    expect(scope.exports.futureWormholeEnabled()).toBe(true)
    store.delete('whale-idle:future-wormhole'); store.set('whale-idle:wh-expedition-test', '1')
    expect(scope.exports.futureWormholeEnabled()).toBe(true)
    scope.location.hostname = 'example.com'
    expect(scope.exports.futureWormholeEnabled()).toBe(false)
    scope.location.protocol = 'file:'
    expect(scope.exports.futureWormholeEnabled()).toBe(false)
  })

  it('新运行日志归入正确ID，历史存储日志不重写，扫描仍信号空间', () => {
    const state = createInitialState({ nowWallMs: 0 })
    state.logs.push({ id: 100, atGameMs: 0, kind: 'combat', text: '历史虫洞', textId: 'core.wormhole.025' })
    const history = structuredClone(state.logs[0])
    addLog(state, 'combat', '旧运行', 'core.wormhole.025')
    expect(state.logs.at(-1)!.textId).toBe(signalSpaceTextId('core.wormhole.025'))
    expect(wormholeEnter(state, ctx, [state.shipId], 19, { expeditionRules: 2 }).ok).toBe(true)
    addLog(state, 'combat', '新运行', 'core.wormhole.025')
    expect(state.logs.at(-1)!.textId).toBe('core.wormhole.025')
    addLog(state, 'info', '扫描来源', 'core.wormholeScan.002')
    expect(state.logs.at(-1)!.textId).toBe(signalSpaceTextId('core.wormholeScan.002'))
    expect(state.logs[0]).toEqual(history)
  })

  it('旧坐标扫描/研究/模板/旧在途及物品ID往返不变，不升级新规则', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    state.wormholeStock = [{ id: 'old-coordinate', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0 }]
    state.wormholeScan = { active: false, progressMs: 12345 }
    state.research = { levels: { 'mt-explore-turn': 2 } }
    state.warehouse.items['mat-wh-essence'] = 8
    state.warehouse.items['wreck-a-wh'] = 300
    expect(wormholeEnter(state, ctx, [state.shipId], 19).ok).toBe(true)
    const before = { stock: state.wormholeStock, scan: state.wormholeScan, research: state.research, ware: state.warehouse.items, run: state.wormhole.run }
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.wormhole.run?.expeditionRules).toBeUndefined()
    expect(loaded.wormhole.run?.supplyVersion).toBeUndefined()
    expect(loaded.wormholeStock).toEqual(before.stock)
    expect(loaded.wormholeScan).toEqual(before.scan)
    expect(loaded.research).toEqual(before.research)
    expect(loaded.warehouse.items).toEqual(before.ware)
    expect(loaded.wormhole.run?.depth).toBe(before.run?.depth)
    expect(loaded.wormhole.run?.turnsLeft).toBe(before.run?.turnsLeft)
    expect(loaded.wormhole.run?.grid?.pos).toEqual(before.run?.grid?.pos)
    expect(loaded.wormhole.run?.grid?.cells).toEqual(before.run?.grid?.cells)
    expect(loaded.wormhole.run?.grid?.exitKnown ?? false).toBe(before.run?.grid?.exitKnown ?? false)
    expect(loadSaveFile(serializeSaveFile(loaded, 0)).state.wormhole.run).toEqual(loaded.wormhole.run)
  })

  it('合成实验库存标记读写保留，普通及坏标记不转为实验', () => {
    const state = createInitialState({ nowWallMs: 0 })
    state.wormholeStock = [
      { id: 'legacy', seed: 19, depth: 1, foundAtGameMs: 0 },
      { id: 'future', seed: 29, depth: 1, foundAtGameMs: 0, expeditionRules: 2 },
      { id: 'unknown', seed: 31, depth: 1, foundAtGameMs: 0, expeditionRules: 999 },
    ]
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.wormholeStock?.map(s => [s.id, s.expeditionRules])).toEqual([['legacy', undefined], ['future', 2], ['unknown', 999]])
    expect(loadSaveFile(serializeSaveFile(loaded, 0)).state.wormholeStock).toEqual(loaded.wormholeStock)
  })

  it('旧有限补给趟与结算仍叫信号空间，仅新规则叫虫洞', () => {
    const path = 'apps/desktop/src/renderer/src/panels/Wormhole.tsx'
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const panel = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'WormholePanel') as ts.FunctionDeclaration
    const naming = panel.body!.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'futureName'))!
    const code = ts.transpileModule(`${naming.getText(ast)}; exports.futureName = futureName`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const evaluate = (run: unknown, lastSettle?: unknown, auto = false) => {
      const scope = { exports: {} as { futureName?: boolean }, run, state: { wormhole: { lastSettle } }, auto }
      runInNewContext(code, scope)
      return scope.exports.futureName
    }
    expect(evaluate({ supplyVersion: 1 })).toBe(false)
    expect(evaluate({ supplyVersion: 1, expeditionRules: 2 })).toBe(true)
    expect(evaluate(undefined, { suppliesReturned: {} })).toBe(false)
    expect(evaluate(undefined, { expeditionProgress: {} })).toBe(true)
    expect(evaluate(undefined, undefined, true)).toBe(true)
  })

  it.each([undefined, 2] as const)('规则%s的活动/沉船/全损新记录锁定名称且损失不变', rules => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    const originalShip = state.shipId
    expect(wormholeEnter(state, ctx, [originalShip], 19, { expeditionRules: rules }).ok).toBe(true)
    const run = state.wormhole.run!
    if (rules === 2) run.supplyVersion = 1
    const activity = activityOverview(state, ctx).find(a => a.kind === 'wormhole')!
    expect(activity.stopReasonId).toBe(rules === 2 ? 'ui.explorationName.022' : 'ui.explorationName.021')
    run.grid!.pos = { q: run.grid!.exit.q, r: run.grid!.exit.r }
    expect(wormholeStartBattle(state, ctx, 'boss').ok).toBe(true)
    const battle = run.battle!
    for (const unit of Object.values(battle.units)) if (unit.side === 'me') unit.hp = { s: 0, a: 0, h: 0 }
    battle.ended = 'foe'
    state.gameMs = battle.lastTickGameMs + 10_000
    advanceWormhole(state, ctx)
    expect(state.wormhole.run).toBeNull()
    expect(state.fleet[originalShip]).toBeUndefined()
    expect(state.wormhole.lastSettle?.kind).toBe('lost')
    const expectedId = rules === 2 ? 'core.explorationStatus.009' : 'core.explorationStatus.008'
    expect(state.logs.find(l => l.textId === expectedId)?.textParams?.p1).toBe(1)
    expect(state.logs.find(l => l.textId === 'core.shipyard.020')?.textParams?.p1Id).toBe(signalSpaceTextId('ui.WreckLog.018', rules))
    expect(state.battleReport?.summaryId).toBe(expectedId)
  })

  it.each(['zh', 'en'] as const)('%s 历史嵌套日志不改名，指令错误及嵌套参数按各自规则命名', locale => {
    const path = 'apps/desktop/src/renderer/src/i18n/locale.tsx'
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const body = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n')
    const scope: Record<string, any> = { exports: {}, L10N, l10nEntryText, signalSpaceTextId,
      localStorage: { getItem: () => locale }, navigator: { languages: [locale], language: locale },
      createContext: () => ({}), useContext: () => ({}), window: {} }
    runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, scope)
    const api = scope.exports
    expect(api.cmdText({ errorId: 'core.wormhole.003' })).toBe(L10N[signalSpaceTextId('core.wormhole.003')]![locale])
    expect(api.futureCmdText({ errorId: 'core.wormhole.003' })).toBe(L10N['core.wormhole.003']![locale])
    const params = { p1Id: 'ui.Expedition.005' }
    const error = { errorId: 'ui.Wormhole.046', errorParams: params }
    expect(api.futureCmdText(error)).toContain(L10N['ui.Expedition.005']![locale])
    expect(api.cmdText(error)).toContain(L10N[signalSpaceTextId('ui.Expedition.005')]![locale])
    expect(api.paramText('ui.Expedition.005', 2)).toBe(L10N['ui.Expedition.005']![locale])
    expect(api.paramText('ui.Expedition.005')).toBe(L10N[signalSpaceTextId('ui.Expedition.005')]![locale])
    const historical = { text: '', textId: 'ui.Wormhole.046', textParams: params }
    expect(api.logText(historical)).toContain(L10N['ui.Expedition.005']![locale])
  })

  it.each(['zh', 'en'] as const)('%s 有限补给旧结算的补给来源不混用新虫洞名', locale => {
    const path = 'apps/desktop/src/renderer/src/panels/Wormhole.tsx'
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const settleFn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'SettleView')!
    const text = (id: string, params?: Record<string, string | number>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (raw, key) => String(params?.[key] ?? raw))
    const scope: Record<string, any> = { exports: {}, futureTr: text, signalTr: (id: string, p?: Record<string, string | number>) => text(signalSpaceTextId(id), p),
      useCountUp: (n: number) => n, n: String, CORE_LABEL: {}, WhObjectiveProgress: 'Record', WhItemCounts: 'Items',
      React: { createElement: (_type: unknown, _props: unknown, ...children: unknown[]) => children } }
    runInNewContext(ts.transpileModule(`${settleFn.getText(ast)}\nexports.view = SettleView`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
    const settle = { kind: 'extract', depth: 1, oreUnits: 0, oreIsk: 0, wreckIsk: 0, boxes: [], relics: [], shipsLost: [], lostIsk: 0, suppliesReturned: {}, suppliesUsed: {}, suppliesFound: {} }
    const render = (record: object) => JSON.stringify(scope.exports.view({ engine: {}, settle: record, onConfirm: () => {} }))
    expect(render(settle)).toContain(L10N['ui.explorationName.023']![locale])
    expect(render(settle)).not.toMatch(/虫洞|Wormhole/)
    expect(render({ ...settle, expeditionProgress: {} })).toContain(L10N['ui.whExpedition.099']![locale])
  })
})
