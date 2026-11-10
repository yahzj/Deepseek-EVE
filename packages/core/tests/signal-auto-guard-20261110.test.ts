import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalAutoGuardBattleOf } from '../src/signalAuto/guard'
import { signalAutoCombatRatio } from '../src/signalAuto/combat'
import { signalAutoEstimateOf } from '../src/signalAuto/estimate'
import { signalAutoFixture } from '../../../tools/signal-auto-estimate-fixture'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { advanceBattleFor } from '../src/combat/advance'
import { stampFoeArrivalFx } from '../src/combat/combatFx'
import { wormholeGuardCardOf } from '../src/wormholeFoes'
import { hashSeed } from '../src/rng'
import { wormholeAutoTechFactors, wormholeAutoHoldM3Of } from '../src/wormholeAuto'
import { cleanSignalAutoEstimate } from '../src/signalAuto/save'
import * as fleetBattle from '../src/combat/startFleet'

afterEach(() => vi.restoreAllMocks())

describe('自动探索使用正式守卫战', () => {
  it.each(['A', 'C', 'D', 'E', 'G'] as const)('%s族结果与同条件正式逐拍战斗相同，不改原状态或使用玩家射程记忆', family => {
    const { state, ctx, roster } = signalAutoFixture('mixed', true)
    const depth = 3, seed = 19, cardId = wormholeGuardCardOf(family, depth)
    state.battleRangeByCard = { [cardId]: { desireM: 1 } }
    const before = structuredClone(state)
    const result = signalAutoGuardBattleOf(state, ctx, roster, family, depth, seed)
    const sim = structuredClone(before)
    sim.shipId = roster[0]!
    sim.gameMs = 0
    sim.rng = { seed: hashSeed(`signal-auto-guard-2/${seed}/${family}/${depth}`), count: 0 }
    sim.wormhole.run = null
    const battle = startFleetBattleFor(sim, ctx, roster, cardId, 0, null, { depth, kind: 'boss', waves: 1 })!
    stampFoeArrivalFx(battle)
    while (!battle.ended && sim.gameMs < ctx.balance.battle.maxBattleMs + 60_000) {
      sim.gameMs += 1000
      advanceBattleFor(sim, ctx, battle, sim.shipId, cardId)
    }
    expect(result.outcome).toBe(battle.ended === 'me' ? 'victory' : battle.escapeReason === 'timeout' || !battle.ended ? 'timeout' : 'defeat')
    expect(result.durationMs).toBe(battle.lastTickGameMs - battle.startedAtGameMs)
    expect(state).toEqual(before)
    expect(signalAutoGuardBattleOf(state, ctx, roster, family, depth, seed)).toEqual(result)
    delete state.battleRangeByCard
    expect(signalAutoGuardBattleOf(state, ctx, roster, family, depth, seed)).toEqual(result)
  })

  it('原战斗比低于1.15时，只要正式模拟胜利就允许下潜', () => {
    const { state, ctx, roster } = signalAutoFixture('guns', true)
    const family = 'D', depth = 4
    const ratio = signalAutoCombatRatio(state, ctx, roster, family, depth)
    expect(ratio).toBeLessThan(1.15)
    const won = signalAutoGuardBattleOf(state, ctx, roster, family, depth, 19)
    expect(won.outcome).toBe('victory')
    const tech = wormholeAutoTechFactors(state, ctx, roster)
    const estimate = signalAutoEstimateOf(state, ctx, roster,
      { seed: 19, depth, family, archetype: 'balanced' }, .8, tech, wormholeAutoHoldM3Of(tech))
    expect(estimate.version).toBe(2)
    expect(estimate.layers[0]!.guardBattle?.outcome).toBe('victory')
    expect(estimate.layers[0]!.combatRatio).toBeUndefined()
    expect(estimate.layers[0]!.guardPassed).toBe(true)
    expect(estimate.layers.length).toBeGreaterThan(1)
    expect(cleanSignalAutoEstimate(estimate)).toEqual(estimate)
    console.log(JSON.stringify({ formerRatio: ratio, family, depth, battleMs: won.durationMs }))
  })

  it('无武装守卫失败；缺少舰船或敌卡时不放行', () => {
    const { state, ctx, roster } = signalAutoFixture('unarmed', false)
    const before = structuredClone(state)
    expect(signalAutoGuardBattleOf(state, ctx, roster, 'A', 1, 19).outcome).toBe('defeat')
    expect(signalAutoGuardBattleOf(state, ctx, [], 'A', 1, 19).outcome).toBe('unavailable')
    expect(signalAutoGuardBattleOf(state, { ...ctx, anomalies: new Map() }, roster, 'A', 1, 19).outcome).toBe('unavailable')
    expect(state).toEqual(before)
  })

  it('只使用真实补给建弹药账，不给缺弹队补货，也不修改正在进行的其他战斗', () => {
    const { state, ctx, roster } = signalAutoFixture('guns', true)
    for (const [id, item] of ctx.items) if (item.kind === 'ammo' || id.startsWith('repairkit-')) delete state.warehouse.items[id]
    for (const id of roster) state.fleet[id]!.cargo = {}
    state.expedition.active = true
    state.expedition.anomalyId = 'ano-training'
    state.expedition.phase = 'back'
    const before = structuredClone(state)
    const start = vi.spyOn(fleetBattle, 'startFleetBattleFor')
    signalAutoGuardBattleOf(state, ctx, roster, 'D', 4, 19)
    const battle = start.mock.results[0]!.value as NonNullable<ReturnType<typeof startFleetBattleFor>>
    expect(battle.ammoLoaded).toEqual({ kin: 0, exp: 0, pla: 0 })
    expect(Object.values(battle.expeditionAmmo?.loaded ?? {}).reduce((sum, n) => sum + n, 0)).toBe(0)
    expect(state).toEqual(before)
  })

  it('战斗到达正式时限仍未获胜则按超时失败，不用剩余血量判胜', () => {
    const { state, ctx, roster } = signalAutoFixture('guns', true)
    const local = { ...ctx, balance: { ...ctx.balance, battle: { ...ctx.balance.battle, maxBattleMs: 10 } } }
    expect(signalAutoGuardBattleOf(state, local, roster, 'D', 4, 19)).toMatchObject({ outcome: 'timeout' })
  })
})
