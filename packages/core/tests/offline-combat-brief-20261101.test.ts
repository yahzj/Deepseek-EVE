import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { createPlayerSpec } from '../src/combat/player/create'
import { createBattleState } from '../src/combat/foes/state'
import { beginOfflineCombatStats, newOfflineCombatStats, observeOfflineBattle, noteOfflineEncounter, noteOfflineEncounterOutcome } from '../src/offlineCombatStats'
import { simulateOffline } from '../src/simulation'
import { newSettleStats } from '../src/settleStats'
import { startHauling } from '../src/hauling'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { spawnIndustrialEncounter } from '../src/encounters/industrial'
import { settleEncounterBattle } from '../src/encounters/outcome'

const ctx = buildSimContext()
describe('离线战斗单份简报统计', () => {
  it('只计本次离线的增量，重复观察和结算不重复入账，结束统计后无副作用', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const battle = createBattleState(spec, [], 0, 1000)
    battle.ammoLoaded = { kin: 100, exp: 0, pla: 0 }
    battle.ammo.kin = 90
    battle.repairDroneBy = { player: { pulses: 2, kitsUsed: 2, kitsUsedByType: { 'repairkit-mil': 2 } } }
    state.encounter = { ...state.encounter, active: true, battle }
    const stats = newOfflineCombatStats()
    const end = beginOfflineCombatStats(state, stats)
    battle.ammo.kin = 85
    battle.repairDroneBy.player!.kitsUsed = 3
    battle.dcKitsUsed = 1
    observeOfflineBattle(state, battle)
    observeOfflineBattle(state, battle)
    noteOfflineEncounterOutcome(state, battle, 'break', 1)
    noteOfflineEncounterOutcome(state, battle, 'break', 1)
    expect(stats).toMatchObject({ encounters: 1, escapes: 1, shipsLost: 1, ammoUsed: 5, kitsUsed: 2 })
    end()
    battle.ammo.kin = 0
    observeOfflineBattle(state, battle)
    expect(stats.ammoUsed).toBe(5)
    expect(JSON.stringify(state)).not.toContain('transportIncome')
  })

  it('多场结果不依赖最后战报或裁剪日志，不保存逐场数组', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const stats = newOfflineCombatStats(), end = beginOfflineCombatStats(state, stats)
    for (const outcome of ['win', 'lose', 'break'] as const) {
      const battle = createBattleState(spec, [], 0, 1000)
      noteOfflineEncounter(state, battle)
      noteOfflineEncounterOutcome(state, battle, outcome, outcome === 'lose' ? 1 : 0)
      state.logs = []
    }
    end()
    expect(stats).toMatchObject({ encounters: 3, wins: 1, defeats: 1, escapes: 1, shipsLost: 1 })
    expect(Object.values(stats).some(Array.isArray)).toBe(false)
  })

  it('正式离线运输计交付体积与实际运费，读档后的到站停运不重复续单', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 17 })
    const local = { ...ctx, balance: structuredClone(ctx.balance) }
    local.balance.events.enabled = false
    for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    expect(startHauling(state, null, 'site-cinder', local, 100).ok).toBe(true)
    state.hauling.fleetLeg!.stopAtArrival = true
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    const before = loaded.wallet.isk, duration = loaded.hauling.legMs + loaded.departure!.undockMs
    const stats = newSettleStats()
    simulateOffline(loaded, 0, duration + 1000, local, undefined, { stats })
    expect(stats.combat).toMatchObject({ deliveries: 1, deliveredM3: 100, transportIncome: loaded.wallet.isk - before, stopReason: 'arrival' })
    expect(loaded.hauling.active).toBe(false)
    expect(loaded.hauling.fleetLeg).toBeUndefined()
    const next = newSettleStats()
    simulateOffline(loaded, duration + 1000, duration + 61000, local, undefined, { stats: next })
    expect(next.combat!.deliveries).toBe(0)
  })

  it('正式遇袭结算在日志裁剪后仍记录胜负和停止原因', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    expect(startHauling(state, null, 'site-cinder', ctx, 100).ok).toBe(true)
    const stats = newOfflineCombatStats(), end = beginOfflineCombatStats(state, stats)
    expect(spawnIndustrialEncounter(state, ctx, { galaxyId: 'galaxy-cinder', shipId: state.shipId, kind: '停留' })).toBe(true)
    state.logs = []
    state.hauling.fleetLeg!.abortAfterBattle = true
    state.encounter.battle!.ended = 'me'
    settleEncounterBattle(state, ctx, state.encounter)
    end()
    expect(stats).toMatchObject({ encounters: 1, wins: 1, stopReason: 'interrupted' })
    expect(state.hauling.active).toBe(false)
  })
})
