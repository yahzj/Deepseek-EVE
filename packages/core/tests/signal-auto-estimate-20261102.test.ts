import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule, cpuOverloadText, adjustDroneLoad } from '../src/equipment'
import { createPlayerSpec } from '../src/combat/player/create'
import { signalAutoEstimateOf, signalAutoOrdinaryHoldShareOf } from '../src/signalAuto/estimate'
import { signalAutoCombatRatio } from '../src/signalAuto/combat'
import { cleanSignalAutoEstimate } from '../src/signalAuto/save'
import { wormholeAutoTechFactors, wormholeAutoHoldM3Of, wormholeAutoStart, advanceWormholeAuto,
  WORMHOLE_AUTO_DURATION_MS, wormholeAutoStop } from '../src/wormholeAuto'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { simulateOffline } from '../src/simulation'
import * as grids from '../src/wormholeGrid'
import * as oldSim from '../src/wormholeAutoSim'
import * as guard from '../src/signalAuto/guard'
import { signalAutoFixture } from '../../../tools/signal-auto-estimate-fixture'

const ctx = buildSimContext()
afterEach(() => vi.restoreAllMocks())

function world(weapons = true, rigs = true) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  state.modeChosen = true
  state.standingsEarned = { dsi: 100 }
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 5]))
  state.research!.levels['mt-explore-signal-auto-t3'] = 3
  const ids = Array.from({ length: 4 }, () => addShipToFleet(state, 'sh-nautilus'))
  for (const uid of ids) {
    for (const id of [...(weapons ? ['mod-laser-3'] : []), ...(rigs ? ['mod-miner-3', 'mod-salvager-3'] : []), 'mod-cargo-3']) {
      state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
      expect(fitModule(state, id, ctx, { shipId: uid }).ok).toBe(true)
    }
    expect(cpuOverloadText(state, ctx, uid)).toBeNull()
  }
  state.wormholeStock = [{ id: 'signal-test', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0 }]
  return { state, ids }
}
function estimate(w: ReturnType<typeof world>, seed = 19, hold?: number, rate = .8) {
  const tech = wormholeAutoTechFactors(w.state, ctx, w.ids)
  return signalAutoEstimateOf(w.state, ctx, w.ids, { seed, depth: 1, family: 'A', archetype: 'balanced' }, rate, tech, hold ?? wormholeAutoHoldM3Of(tech))
}
const reload = (state: ReturnType<typeof world>['state']) => loadSaveFile(serializeSaveFile(state, 0)).state
function finish(state: ReturnType<typeof world>['state']) {
  state.gameMs = WORMHOLE_AUTO_DURATION_MS
  advanceWormholeAuto(state, ctx)
  return state.wormholeAutoReports![0]!
}

describe('信号自动估算：能力推进与有界收成', () => {
  it('普通作业目标从浅层四分之一随层深或剩余回合放宽', () => {
    expect(signalAutoOrdinaryHoldShareOf(1, 100, 100)).toBe(.25)
    expect(signalAutoOrdinaryHoldShareOf(5, 100, 100)).toBe(.625)
    expect(signalAutoOrdinaryHoldShareOf(1, 50, 100)).toBe(.625)
    expect(signalAutoOrdinaryHoldShareOf(9, 100, 100)).toBe(1)
    expect(signalAutoOrdinaryHoldShareOf(1, 0, 100)).toBe(1)
  })

  it('不生成地图或运行旧模拟器，不改变状态和全局随机流', () => {
    const w = world(), before = structuredClone(w.state)
    const map = vi.spyOn(grids, 'wormholeMakeGrid'), sim = vi.spyOn(oldSim, 'wormholeAutoDescend')
    const result = estimate(w)
    expect(result.layers.length).toBeGreaterThan(0)
    expect(map).not.toHaveBeenCalled(); expect(sim).not.toHaveBeenCalled()
    expect(w.state).toEqual(before)
  })
  it('固定守卫结果时非满仓普通物量仍只小幅波动，收益随机流不改进度', () => {
    vi.spyOn(guard, 'signalAutoGuardBattleOf').mockReturnValue({ cardId: 'guard-test', outcome: 'victory', durationMs: 1000 })
    const w = world(), samples = Array.from({ length: 20 }, (_, i) => estimate(w, i + 1, 1e9))
    const volume = samples.map(row => row.ordinaryUsedM3)
    for (const row of samples) expect(row.layers).toEqual(samples[0]!.layers)
    expect(Math.max(...volume)).toBeGreaterThan(Math.min(...volume))
    expect(Math.max(...volume) / Math.min(...volume)).toBeLessThanOrEqual(1.225)
  })
  it('无武器不突破守卫，但本层仍可采集；不会绕过失败进入下一层', () => {
    const result = estimate(world(false))
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0]).toMatchObject({ depth: 1, guardPassed: false, guardBattle: { outcome: 'defeat' } })
    expect(result.layers[0]!.combatRatio).toBeUndefined()
    expect(result.gains.some(row => row.itemId === 'ore-voidmother')).toBe(true)
    expect(result.report?.returnReason).toBe('guard')
  })
  it('逐层报告回合总和吻合，逐项收益与全程结算完全一致', () => {
    const result = estimate(world(), 19)
    expect(result.report).toBeDefined()
    expect(result.report!.spentTurns).toBeCloseTo(result.report!.layers.reduce((sum, layer) => sum + layer.turns, 0), 10)
    expect(result.report!.spentTurns).toBeLessThanOrEqual(result.report!.availableTurns)
    const totals = new Map<string, number>()
    for (const layer of result.report!.layers) for (const gain of layer.gains)
      totals.set(gain.itemId, (totals.get(gain.itemId) ?? 0) + gain.units)
    expect([...totals].sort()).toEqual(result.gains.map(gain => [gain.itemId, gain.units]).sort())
    expect(cleanSignalAutoEstimate(result)).toEqual(result)
  })
  it('逐层报告保留估算停止原因：回合不足与到达第九层', () => {
    const w = world(false)
    const tech = wormholeAutoTechFactors(w.state, ctx, w.ids)
    const short = signalAutoEstimateOf(w.state, ctx, w.ids,
      { seed: 19, depth: 9, family: 'A', archetype: 'balanced' }, .8, tech, 1e9)
    expect(short.report?.returnReason).toBe('budget')
    expect(short.report?.layers.at(-1)?.completion).toBeLessThan(1)
    expect(short.report?.spentTurns).toBe(short.report?.availableTurns)
  })
  it('无作业设备不产矿和地点打捞物，战斗残骸与谜质仍分流', () => {
    const result = estimate(world(true, false))
    expect(result.capability).toMatchObject({ miners: 0, salvagers: 0 })
    expect(result.gains.some(row => row.itemId === 'ore-voidmother' || row.itemId.startsWith('box-') || row.itemId.startsWith('wreck-rare-'))).toBe(false)
  })
  it('实际物品体积共同约束普通资源，折扣在容量裁切后只应用一次', () => {
    const w = world(), samples = [.6, .7, .8].map(rate => estimate(w, 19, 100, rate))
    for (const row of samples) {
      const ordinary = row.gains.filter(gain => gain.itemId === 'ore-voidmother' || gain.itemId === 'wreck-a-wh')
        .reduce((n, gain) => n + gain.units * (ctx.items.get(gain.itemId)?.unitM3 ?? 1), 0)
      expect(ordinary).toBeCloseTo(row.ordinaryUsedM3, 8)
      expect(ordinary).toBeLessThanOrEqual(100)
      expect(cleanSignalAutoEstimate(row)).toEqual(row)
    }
    expect(samples[0]!.ordinaryUsedM3).toBeLessThan(samples[1]!.ordinaryUsedM3)
    expect(samples[1]!.ordinaryUsedM3).toBeLessThan(samples[2]!.ordinaryUsedM3)
  })
  it('普通作业省下的回合实际用于深层探索，不是只削减返航普通收成', () => {
    vi.spyOn(guard, 'signalAutoGuardBattleOf').mockReturnValue({ cardId: 'guard-test', outcome: 'victory', durationMs: 1000 })
    const { state, ctx: fixtureCtx, roster } = signalAutoFixture('guns', true)
    const tech = wormholeAutoTechFactors(state, fixtureCtx, roster)
    const hold = wormholeAutoHoldM3Of(tech)
    const run = (capacity: number) => signalAutoEstimateOf(state, fixtureCtx, roster,
      { seed: 19, depth: 1, family: 'A', archetype: 'balanced' }, .8, tech, capacity)
    const prioritized = run(hold)
    // 无限容量不会触发普通作业限额，作为逐层全量作业的控制组。
    const allSites = run(1e9)
    const completed = (row: typeof prioritized) => row.layers.reduce((n, layer) => n + layer.completion, 0)
    expect(completed(prioritized)).toBeGreaterThan(completed(allSites))
    expect(prioritized.ordinaryUsedM3).toBeGreaterThan(hold * .79)
    expect(prioritized.ordinaryUsedM3).toBeLessThanOrEqual(hold * .8)
    expect(prioritized.gains.find(gain => gain.itemId === 'mat-wh-essence')!.units)
      .toBeGreaterThanOrEqual(allSites.gains.find(gain => gain.itemId === 'mat-wh-essence')!.units)
  })
  it('被守卫挡住的队伍继续本层采集，不因为下潜预留而再次减少普通收成', () => {
    const w = world(false)
    const small = estimate(w, 19, 100), unlimited = estimate(w, 19, 1e9)
    expect(small.layers).toEqual(unlimited.layers)
    expect(small.layers).toHaveLength(1)
    expect(small.ordinaryUsedM3).toBeGreaterThanOrEqual(78)
    expect(small.ordinaryUsedM3).toBeLessThanOrEqual(80)
    expect(small.gains.find(gain => gain.itemId === 'mat-wh-essence'))
      .toEqual(unlimited.gains.find(gain => gain.itemId === 'mat-wh-essence'))
  })
  it('无人机按本舰真实装载计入估算，仓库有机体不等于自动参战', () => {
    const w = world(false, false)
    const baseline = signalAutoCombatRatio(w.state, ctx, w.ids, 'A', 1)
    expect(baseline).toBe(0)
    w.state.warehouse.items['drone-scout'] = 100
    expect(signalAutoCombatRatio(w.state, ctx, w.ids, 'A', 1)).toBe(baseline)
    for (const id of w.ids) {
      expect(adjustDroneLoad(w.state, ctx, 'drone-scout', 2, id).ok).toBe(true)
      const loaded = createPlayerSpec(w.state, ctx, id)!.weapons.filter(weapon => weapon.src === 'drone')
      expect(loaded).toHaveLength(2)
    }
    const armed = signalAutoCombatRatio(w.state, ctx, w.ids, 'A', 1)
    expect(armed).toBeGreaterThan(baseline)
    for (const id of w.ids) expect(adjustDroneLoad(w.state, ctx, 'drone-scout', -1, id).ok).toBe(true)
    expect(signalAutoCombatRatio(w.state, ctx, w.ids, 'A', 1)).toBeLessThan(armed)
  })
  it('武器升级提高解析战斗能力，出发残血降低承伤', () => {
    const w = world(), ratio = signalAutoCombatRatio(w.state, ctx, w.ids, 'A', 1)
    const weak = structuredClone(w.state)
    for (const id of w.ids) weak.fleet[id]!.fitted.high = weak.fleet[id]!.fitted.high.map(mod => mod === 'mod-laser-3' ? 'mod-laser-1' : mod)
    expect(signalAutoCombatRatio(weak, ctx, w.ids, 'A', 1)).toBeLessThan(ratio)
    for (const id of w.ids) { w.state.fleet[id]!.armorPct = .2; w.state.fleet[id]!.durability = .2 }
    expect(signalAutoCombatRatio(w.state, ctx, w.ids, 'A', 1)).toBeLessThan(ratio)
  })
  it('扫描和回合科技只改善完成度，不重复放大相同货仓', () => {
    const w = world(), base = estimate(w, 19, 1e9)
    for (const node of ctx.matterTech!.values()) if (['whScanRadius', 'whTurnBonus'].includes(node.effect)) w.state.research!.levels[node.id] = node.maxLevel
    const better = estimate(w, 19, 1e9)
    expect(better.layers.reduce((n, row) => n + row.completion, 0)).toBeGreaterThanOrEqual(base.layers.reduce((n, row) => n + row.completion, 0))
    expect(better.capability.holdM3).toBe(base.capability.holdM3)
  })
  it('作业升级不改推进，谜质独立流不受货柜抽取次数影响', () => {
    vi.spyOn(guard, 'signalAutoGuardBattleOf').mockReturnValue({ cardId: 'guard-test', outcome: 'victory', durationMs: 1000 })
    const w = world()
    for (const node of ctx.matterTech!.values()) w.state.research!.levels[node.id] = node.maxLevel
    const base = estimate(w, 27, 1e9)
    for (const id of w.ids) w.state.fleet[id]!.fitted.high = w.state.fleet[id]!.fitted.high.map(mod => mod === 'mod-salvager-3' ? 'mod-salvager-1' : mod)
    const changed = estimate(w, 27, 1e9)
    expect(changed.layers).toEqual(base.layers)
    expect(changed.gains.find(row => row.itemId === 'mat-wh-essence')).toEqual(base.gains.find(row => row.itemId === 'mat-wh-essence'))
    expect(changed.cores).toEqual(base.cores)
  })
  it.each(['balanced', 'wreck', 'ruins', 'vein', 'combat'] as const)('%s原型跨种子推进固定，奖励来自当前合法物品池', archetype => {
    vi.spyOn(guard, 'signalAutoGuardBattleOf').mockReturnValue({ cardId: 'guard-test', outcome: 'victory', durationMs: 1000 })
    const w = world(), tech = wormholeAutoTechFactors(w.state, ctx, w.ids)
    const results = Array.from({ length: 10 }, (_, seed) => signalAutoEstimateOf(w.state, ctx, w.ids,
      { seed: seed + 1, depth: 1, family: 'A', archetype }, .8, tech, 5000))
    for (const result of results) {
      expect(result.layers).toEqual(results[0]!.layers)
      for (const gain of result.gains) expect(ctx.items.has(gain.itemId)).toBe(true)
    }
  })
})

describe('新任务冻结与旧任务版本边界', () => {
  it('出发锁定、两轮读档保真、途中升级科技不改奖励及损伤，一次领取后不重发', () => {
    const { state, ids } = world()
    expect(wormholeAutoStart(state, ctx, 'signal-test', ids).ok).toBe(true)
    const snapshot = structuredClone(state.wormholeAuto![0]!.estimate)
    const base = structuredClone(state), loaded = reload(reload(state))
    for (const node of ctx.matterTech!.values()) loaded.research!.levels[node.id] = node.maxLevel
    expect(loaded.wormholeAuto![0]!.estimate).toEqual(snapshot)
    const a = finish(base), b = finish(loaded)
    expect(b.gains).toEqual(a.gains); expect(b.cores).toEqual(a.cores); expect(b.damage).toEqual(a.damage)
    expect(a.signalAuto).toEqual(snapshot!.report)
    expect(reload(base).wormholeAutoReports![0]!.signalAuto).toEqual(a.signalAuto)
    const before = structuredClone(loaded)
    advanceWormholeAuto(loaded, ctx)
    expect(loaded).toEqual(before)
  })
  it('出发推演后，在线分段和离线一次结算奖励、损伤相同且不再运行战斗', () => {
    const { state, ids } = world()
    expect(wormholeAutoStart(state, ctx, 'signal-test', ids).ok).toBe(true)
    const simulation = vi.spyOn(guard, 'signalAutoGuardBattleOf')
    const offline = reload(state)
    for (let ms = 1000; ms <= WORMHOLE_AUTO_DURATION_MS; ms += 1000) { state.gameMs = ms; advanceWormholeAuto(state, ctx) }
    simulateOffline(offline, 0, WORMHOLE_AUTO_DURATION_MS, ctx)
    const a = state.wormholeAutoReports![0]!, b = offline.wormholeAutoReports![0]!
    expect(b.gains).toEqual(a.gains); expect(b.damage).toEqual(a.damage); expect(b.cores).toEqual(a.cores)
    expect(offline.encounter.active).toBe(false)
    expect(simulation).not.toHaveBeenCalled()
  })
  it('版本1在途快照两轮读档后仍领取原奖励，绝不补跑新守卫战', () => {
    const { state, ids } = world()
    const tech = wormholeAutoTechFactors(state, ctx, ids)
    const legacy = {
      version: 1 as const, tech,
      capability: { turns: 43, scanRadius: 2, miners: 4, salvagers: 4, holdM3: 3000 },
      layers: [{ depth: 1, completion: 1, combatRatio: .9, guardPassed: false }],
      depthReached: 1, ordinaryUsedM3: 12,
      gains: [{ itemId: 'ore-voidmother', units: 12 }], cores: [],
    }
    state.wormholeAuto = [{ id: 'v1-in-flight', stockId: 'old-signal', seed: 19, depth: 1,
      estimateRules: 1, estimate: legacy, yieldMul: .8, shipIds: ids,
      startedAtGameMs: 0, finishAtGameMs: WORMHOLE_AUTO_DURATION_MS }]
    expect(cleanSignalAutoEstimate(legacy)).toEqual(legacy)
    const loaded = reload(reload(state))
    expect(loaded.wormholeAuto![0]!.estimate).toEqual(legacy)
    const simulation = vi.spyOn(guard, 'signalAutoGuardBattleOf')
    expect(finish(loaded).gains).toEqual(legacy.gains)
    expect(simulation).not.toHaveBeenCalled()
  })
  it('缺失版本的旧在途仍调原模拟器，不会自动注入新快照', () => {
    const { state, ids } = world()
    expect(wormholeAutoStart(state, ctx, 'signal-test', ids).ok).toBe(true)
    delete state.wormholeAuto![0]!.estimateRules; delete state.wormholeAuto![0]!.estimate
    const old = reload(state), sim = vi.spyOn(oldSim, 'wormholeAutoDescend')
    expect(old.wormholeAuto![0]!.estimate).toBeUndefined()
    finish(old)
    expect(sim).toHaveBeenCalledOnce()
  })
  it('返航核心直接入核心库，报告两轮读档不丢明细、不重复发核心', () => {
    const { state, ids } = world()
    expect(wormholeAutoStart(state, ctx, 'signal-test', ids).ok).toBe(true)
    // 固定奖励事件夹具，不依赖某颗种子恰好出核心。
    state.wormholeAuto![0]!.estimate!.cores = [{ type: 'beta', n: 1 }]
    const before = state.aiCores.beta
    const report = finish(state)
    expect(state.aiCores.beta).toBe(before + 1)
    expect(state.warehouse.items['ai-core-beta'] ?? 0).toBe(0)
    const read = reload(reload(state))
    expect(read.wormholeAutoReports![0]!.cores).toEqual(report.cores)
    advanceWormholeAuto(read, ctx)
    expect(read.aiCores.beta).toBe(before + 1)
  })
  it('没有逐层字段的旧报告照常读档且不补造详情', () => {
    const { state, ids } = world()
    expect(wormholeAutoStart(state, ctx, 'signal-test', ids).ok).toBe(true)
    const report = finish(state)
    delete report.signalAuto
    expect(reload(state).wormholeAutoReports![0]!.signalAuto).toBeUndefined()
  })
  it.each(['unknown', 'missing', 'bad-layer', 'bad-gain', 'bad-report', 'bad-battle', 'unknown-version'] as const)('%s损坏/未知快照保留锁定不重抽，仍可召回', kind => {
    const { state, ids } = world()
    expect(wormholeAutoStart(state, ctx, 'signal-test', ids).ok).toBe(true)
    const raw = JSON.parse(serializeSaveFile(state, 0)), run = raw.state.wormholeAuto[0]
    if (kind === 'unknown') run.estimateRules = 99
    if (kind === 'missing') delete run.estimate
    if (kind === 'bad-layer') run.estimate.layers[0].completion = 2
    if (kind === 'bad-gain') run.estimate.gains[0].units = -1
    if (kind === 'bad-report') run.estimate.report.layers[0].gains[0].units += 1
    if (kind === 'bad-battle') run.estimate.layers[0].guardBattle.outcome = 'guaranteed-win'
    if (kind === 'unknown-version') run.estimate.version = 99
    const loaded = loadSaveFile(JSON.stringify(raw)).state, ware = structuredClone(loaded.warehouse)
    loaded.gameMs = WORMHOLE_AUTO_DURATION_MS
    advanceWormholeAuto(loaded, ctx)
    expect(loaded.wormholeAuto).toHaveLength(1)
    expect(loaded.warehouse).toEqual(ware)
    expect(wormholeAutoStop(loaded, loaded.wormholeAuto![0]!.id, ctx).ok).toBe(true)
    expect(loaded.wormholeAuto).toHaveLength(0)
    expect(loaded.warehouse).toEqual(ware)
  })
})
