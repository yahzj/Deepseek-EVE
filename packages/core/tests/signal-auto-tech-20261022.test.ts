import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import * as core from '../src/index'
import { wormholeAutoDescend } from '../src/wormholeAutoSim'
import { ceilFinalQuantity } from '../src/quantity'

const ctx = buildSimContext()
const TECH = 'mt-explore-signal-auto-t3'
function world(level = 0, seed = 19) {
  const state = core.createInitialState({ nowWallMs: 0, seed })
  state.research!.levels[TECH] = level
  const ships = Array.from({ length: 8 }, () => core.addShipToFleet(state, 'sh-nautilus'))
  for (const id of ships) state.fleet[id]!.fitted = { high: ['mod-laser-3', 'mod-miner-3', 'mod-salvager-3'], mid: [], low: [] }
  state.wormholeStock = [0, 1, 2].map(i => ({ id: `signal-${i}`, seed: seed + i, depth: 1, family: 'A' as const, archetype: 'balanced' as const, foundAtGameMs: 0 }))
  return { state, ships }
}
function loaded(state: core.GameState) { return core.loadSaveFile(core.serializeSaveFile(state, 0)).state }
function finish(state: core.GameState) {
  state.gameMs = core.WORMHOLE_AUTO_DURATION_MS
  core.advanceWormholeAuto(state, ctx)
  return core.wormholeAutoReportsOf(state)[0]!
}

describe('信号空间T3科技研究与收益单点', () => {
  it('独立三级节点，费用/前置/即时扣款，旧T1/T4扫描科技保持', () => {
    const { state } = world()
    const node = ctx.matterTech!.get(TECH)!
    expect(node).toMatchObject({ name: '信号空间探索', tier: 3, branch: 'explore', maxLevel: 3, per: .1,
      effect: 'signalAutoYield', prereq: { 'mt-explore-signal-radius-t1': 1 }, essence: [10, 20, 30], isk: [10000000, 20000000, 30000000] })
    state.wallet.isk = 60000000
    state.warehouse.items['mat-wh-essence'] = 60
    expect(core.researchMatterTech(state, ctx, TECH).ok).toBe(false)
    state.research!.levels['mt-explore-signal-radius-t1'] = 1
    for (const [index, rate] of [.6, .7, .8].entries()) {
      const beforeMs = state.gameMs
      const cost = core.matterTechCostAt(node, index)
      const before = [state.wallet.isk, state.warehouse.items['mat-wh-essence'] ?? 0]
      expect(core.researchMatterTech(state, ctx, TECH)).toMatchObject({ ok: true, level: index + 1 })
      expect(core.matterTechSignalAutoYield(state, ctx)).toBe(rate)
      expect(state.wallet.isk).toBe(before[0]! - cost.isk)
      expect(state.warehouse.items['mat-wh-essence'] ?? 0).toBe(before[1]! - cost.essence)
      expect(state.gameMs).toBe(beforeMs)
    }
    const snapshot = structuredClone(state)
    expect(core.researchMatterTech(state, ctx, TECH).ok).toBe(false)
    expect(state).toEqual(snapshot)
    expect(ctx.matterTech!.get('mt-explore-signal-radius-t4')).toMatchObject({ effect: 'whScanRadius', maxLevel: 1, prereq: { 'mt-explore-signal-radius-t1': 1 } })
  })

  it.each([0, 1, 2, 3, 99])('等级%s解锁与系数一致，旧档不赠送研究', level => {
    const { state } = world(level)
    const expected = level === 0 ? 0 : [0, .6, .7, .8][Math.min(3, level)]!
    expect(core.matterTechSignalAutoYield(state, ctx)).toBe(expected)
    expect(core.signalAutoResearchBlock(state, ctx) === null).toBe(level > 0)
    if (level === 0) {
      const before = structuredClone(state)
      expect(core.wormholeAutoStart(state, ctx, 'signal-0', Object.keys(state.fleet).slice(1, 3)))
        .toMatchObject({ ok: false, errorId: 'core.signalAuto.001' })
      expect(state).toEqual(before)
      expect(loaded(state).research!.levels[TECH] ?? 0).toBe(0)
    }
  })

  it('不按节点ID硬编码效果，研究失败不扣钱或谜质', () => {
    const { state } = world()
    const original = ctx.matterTech!.get(TECH)!
    const custom = { ...ctx, matterTech: new Map(ctx.matterTech).set('alias-auto', { ...original, id: 'alias-auto' }) }
    state.research!.levels['alias-auto'] = 2
    expect(core.matterTechSignalAutoYield(state, custom)).toBe(.7)
    state.research!.levels['mt-explore-signal-radius-t1'] = 1
    state.wallet.isk = 10000000
    state.warehouse.items['mat-wh-essence'] = 9
    const before = structuredClone(state)
    expect(core.researchMatterTech(state, ctx, TECH).ok).toBe(false)
    expect(state).toEqual(before)
  })
})

describe('自动探索派队与在途兼容', () => {
  it('零AI技能及库存可同时派两队，任务仍锁船，AI账与实体核心库不变', () => {
    const { state, ships } = world(1)
    const beforeCore = structuredClone(state.aiCores)
    expect(core.aiCoreCap(state, ctx)).toBe(0)
    expect(core.wormholeAutoStart(state, ctx, 'signal-0', ships.slice(0, 4)).ok).toBe(true)
    expect(core.wormholeAutoStart(state, ctx, 'signal-1', ships.slice(4, 8)).ok).toBe(true)
    expect(core.aiCoreShipUsed(state)).toBe(0)
    expect(core.aiCoreUsed(state)).toBe(0)
    expect(state.aiCores).toEqual(beforeCore)
    expect(core.shipLockedReason(state, ships[0]!, '驾驶它')).toContain('自动探索')
    const busy = core.wormholeAutoStart(state, ctx, 'signal-2', ships.slice(0, 2))
    expect(busy.ok).toBe(false)
    expect(state.wormholeStock).toHaveLength(1)
    expect(state.wormholeAuto!.every(run => run.yieldMul === .6)).toBe(true)
    const rows = core.activityOverview(state, ctx).filter(row => row.kind === 'whauto')
    expect(rows.every(row => row.subId === 'ui.signalAuto.003' && !row.sub.includes('核心'))).toBe(true)
  })

  it('AI副船占满共享名额也不拦信号派队，实验任务继续占原名额', () => {
    const { state, ships } = world(1)
    state.skills.trained['ai-expert'] = 1
    state.aiAssignments[ships[7]!] = { coreType: 'basic', startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 } }
    expect(core.aiCoreShipUsed(state)).toBe(1)
    expect(core.wormholeAutoStart(state, ctx, 'signal-0', ships.slice(0, 4)).ok).toBe(true)
    expect(core.aiCoreShipUsed(state)).toBe(1)
    const future = { ...state.wormholeAuto![0]!, id: 'future', expeditionRules: 2, shipIds: [ships[6]!] }
    state.wormholeAuto!.push(future)
    expect(core.aiCoreShipUsed(state)).toBe(2)
    expect(core.wormholeAutoCoreBlock(state, ctx, 1)).not.toBeNull()
  })

  it.each([.6, .7, .8])('本趟%s出发锁定，升级/重载后不变，报告不伪称释放核心', rate => {
    const level = [.6, .7, .8].indexOf(rate) + 1
    const { state, ships } = world(level)
    expect(core.wormholeAutoStart(state, ctx, 'signal-0', ships.slice(0, 4)).ok).toBe(true)
    expect(state.wormholeAuto![0]!.yieldMul).toBe(rate)
    const baseline = structuredClone(state)
    state.research!.levels[TECH] = 3
    const reloaded = loaded(loaded(state))
    expect(reloaded.wormholeAuto![0]!.yieldMul).toBe(rate)
    const report = finish(reloaded)
    const beforeReport = finish(baseline)
    expect(report.gains).toEqual(beforeReport.gains)
    expect(report.damage).toEqual(beforeReport.damage)
    expect(report.cores).toEqual(beforeReport.cores)
    expect(report.coresReleased).toBe(0)
    expect(loaded(reloaded).wormholeAutoReports![0]!.coresReleased).toBe(0)
    expect(reloaded.logs.find(row => row.textId === 'core.signalAuto.003')!.textParams!.p5).toBe(4)
    const once = structuredClone(reloaded)
    core.advanceWormholeAuto(reloaded, ctx)
    expect(reloaded).toEqual(once)
  })

  it('旧任务缺收益字段仍以80%完成，无研究也不取消或补核心，坏比例按旧兼容', () => {
    const { state, ships } = world(3)
    expect(core.wormholeAutoStart(state, ctx, 'signal-0', ships.slice(0, 4)).ok).toBe(true)
    const baseline = structuredClone(state)
    delete state.wormholeAuto![0]!.yieldMul
    state.research!.levels[TECH] = 0
    expect(core.aiCoreShipUsed(state)).toBe(0)
    const old = loaded(loaded(state))
    const report = finish(old)
    expect(report.gains).toEqual(finish(baseline).gains)
    expect(report.coresReleased).toBe(0)
    expect(core.signalAutoResearchBlock(old, ctx)).not.toBeNull()
    for (const value of [-1, 0, 1, '0.6', null]) {
      const file = JSON.parse(core.serializeSaveFile(baseline, 0))
      file.state.wormholeAuto = [{ ...state.wormholeAuto![0], yieldMul: value }]
      const clean = core.loadSaveFile(JSON.stringify(file)).state
      expect(clean.wormholeAuto![0]!.yieldMul).toBeUndefined()
    }
  })

  it('收益级别不改独立AI核心掉落和损伤，200种子各级单调且满级与旧80%一致', () => {
    const totals = [0, 0, 0]
    for (let seed = 1; seed <= 200; seed++) {
      let last: core.WormholeAutoReport | undefined
      for (const level of [1, 2, 3]) {
        const { state, ships } = world(level, seed)
        expect(core.wormholeAutoStart(state, ctx, 'signal-0', ships.slice(0, 4)).ok).toBe(true)
        const result = finish(state)
        totals[level - 1]! += result.gains.reduce((n, row) => n + row.units, 0)
        if (last) { expect(result.damage).toEqual(last.damage); expect(result.cores).toEqual(last.cores) }
        last = result
      }
    }
    expect(totals[0]).toBeLessThan(totals[1]!)
    expect(totals[1]).toBeLessThan(totals[2]!)
    console.log(JSON.stringify({ samples: 200, rates: [.6, .7, .8], aggregateUnits: totals,
      note: '各物品单位合计只用于同种子单调性对照，不代表货币价值或每条线的连续精确比例' }))
  })
})

describe('同路线的科技收益系数', () => {
  it('五条收益线各只折算一次，路线/回合/交战统计不受系数影响', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const options = { seed, startDepth: 1, totalMass: 0, holdM3: 100000, oreUnitM3: 1, miners: 4, salvagers: 4, scanRadius: 4,
        power: { dps: 1e9, ehp: 1e9 }, guardPowerOf: () => ({ dps: 1, ehp: 1 }), tech: { wreck: 1, ore: 1 } }
      const full = wormholeAutoDescend({ ...options, yieldMul: 1 })
      for (const rate of [.6, .7, .8]) {
        const result = wormholeAutoDescend({ ...options, yieldMul: rate })
        for (const field of ['cellsExplored', 'depthReached', 'fightsWon', 'turnsOnScan', 'turnsOnMove', 'holdFull', 'outOfTurns'] as const) expect(result[field]).toBe(full[field])
        expect(result.wreckM3).toBe(ceilFinalQuantity(full.wreckM3 * rate))
        expect(result.oreUnits).toBe(ceilFinalQuantity(full.oreUnits * rate))
        for (const field of ['rareItems', 'relicBoxes', 'matterDevices'] as const) expect(result[field]).toBeCloseTo(full[field] * rate, 10)
      }
      expect(wormholeAutoDescend(options)).toEqual(wormholeAutoDescend({ ...options, yieldMul: .8 }))
    }
  })
})

type UiNode = { type: unknown; props: Record<string, any>; children: unknown[] }
function flatten(value: unknown): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(flatten)
  if (!value || typeof value !== 'object' || !('children' in value)) return []
  const node = value as UiNode
  return [node, ...flatten(node.children)]
}
const uiText = (value: unknown): string => Array.isArray(value) ? value.map(uiText).join('')
  : value && typeof value === 'object' && 'children' in value ? uiText((value as UiNode).children) : value == null || typeof value === 'boolean' ? '' : String(value)

describe('自动探索按钮实际组件', () => {
  it.each(['zh', 'en'] as const)('%s零级灰色可点击提示，一级恢复，不打开准备页或改账', locale => {
    const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/panels/WormholeScan.tsx', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('WormholeScan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const body = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n')
    const { state } = world(0)
    const translated = (id: string, params?: Record<string, unknown>) => l10nEntryText(L10N[core.signalSpaceTextId(id)] ?? { zh: id, en: id }, locale)
      .replace(/\{(\w+)\}/g, (whole, key) => String(params?.[key] ?? whole))
    const scope: Record<string, any> = { ...core, exports: {}, tr: translated, futureTr: translated,
      cmdText: (r: { errorId: string }) => translated(r.errorId),
      useState: (initial: unknown) => [initial, () => {}], useEffect: () => {}, futureWormholeEnabled: () => false,
      archetypeText: () => '均衡', aiCoreText: () => '核心', wormholeIntelLine: () => '', wormholeIntelTip: () => '', fmtDuration: (n: number) => String(n),
      Panel: 'Panel', Glyph: 'Glyph', HintIcon: 'HintIcon', ICO_TONES: {},
      React: { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    }
    runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
    const engine = { state, ctx, wormholeStock: () => state.wormholeStock, wormholeAutoRuns: () => [], wormholeAutoReports: () => [], wormholeAutoPending: () => 0,
      wormholeScanWindow: () => 1000, wormholeScanBlockReason: () => null, wormholeScanUnlocked: () => true, wormholeScanStanding: () => 100,
      wormholeFamilyName: () => '劫掠者' }
    const onAutoExplore = vi.fn(), onToast = vi.fn()
    const props = { engine, onAutoExplore, onToast, onExplore: vi.fn() }
    const render = () => flatten(scope.exports.WormholeScanTab(props))
    const button = () => render().find(n => n.type === 'button' && uiText(n.children) === translated('ui.Wormhole.002'))!
    const before = structuredClone(state)
    expect(button().props.disabled).toBe(false)
    expect(button().props['aria-disabled']).toBe('true')
    button().props.onClick()
    expect(onToast).toHaveBeenCalledWith(translated('core.signalAuto.001'), true)
    expect(onAutoExplore).not.toHaveBeenCalled()
    expect(state).toEqual(before)
    state.research!.levels[TECH] = 1
    expect(button().props['aria-disabled']).toBeUndefined()
    button().props.onClick()
    expect(onAutoExplore).toHaveBeenCalledWith('signal-0')
  })
})
