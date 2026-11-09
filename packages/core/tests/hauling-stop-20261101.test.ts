import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { startHauling, stopHauling } from '../src/hauling'
import { advanceGame } from '../src/engine'
import { activityOverview } from '../src/activity'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { spawnIndustrialEncounter } from '../src/encounters/industrial'
import { settleEncounterBattle } from '../src/encounters/outcome'
import { simulateOffline } from '../src/simulation'
import { finishDeparture } from './helpers/departure-ready'

function world() {
  const ctx = buildSimContext()
  ctx.balance = structuredClone(ctx.balance)
  ctx.balance.events.enabled = false
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  expect(startHauling(state, null, 'site-cinder', ctx, 100).ok).toBe(true)
  finishDeparture(state, ctx)
  return { state, ctx }
}

describe('运输停止回归', () => {
  it('运输中断立即回到本段出发站，读档/重复停止不产生折返和运费', () => {
    const { state, ctx } = world()
    const f = state.hauling.fleetLeg!
    f.path = [1000, 2000, 3000].map(durationMs => ({ galaxyId: 'galaxy-hub', durationMs, progressMs: 0 }))
    state.hauling.legMs = 6000
    state.fleet[state.shipId]!.cargo['min-a'] = 12
    const cargo = structuredClone(state.fleet[state.shipId]!.cargo)
    const wallet = state.wallet.isk
    advanceGame(state, 4500, ctx)
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(false)
    expect(state.hauling.fleetLeg).toBeUndefined()
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBeNull()
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    expect(state.transit.active).toBe(false)
    expect(state.wallet.isk).toBe(wallet)
    const restored = loadSaveFile(serializeSaveFile(state)).state
    expect(restored.hauling.active).toBe(false)
    advanceGame(restored, 60_000, ctx)
    expect(restored.hauling.active).toBe(false)
    expect(restored.wallet.isk).toBe(wallet)
  })

  it('副站航段中断后即时停靠原副站，不返母港、不入账', () => {
    const { state, ctx } = world()
    state.stationSites['site-cinder'] = { stage: ctx.stations.get('site-cinder')!.tiers.length, delivered: {} }
    state.hauling.fleetLeg!.stopAtArrival = true
    advanceGame(state, state.hauling.legMs, ctx)
    expect(state.hauling.active).toBe(false)
    expect(state.dockedSite).toBe('site-cinder')
    expect(startHauling(state, 'site-cinder', null, ctx, 100).ok).toBe(true)
    finishDeparture(state, ctx)
    expect(state.hauling.active).toBe(true)
    state.hauling.fromSiteId = 'site-cinder'
    const wallet = state.wallet.isk
    advanceGame(state, 1000, ctx)
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBe('site-cinder')
    expect(state.wallet.isk).toBe(wallet)
    expect(state.departure).toBeUndefined()
  })

  it('运输中停止不结本段运费，含读档后也不再推进', () => {
    const { state, ctx } = world()
    const wallet = state.wallet.isk
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(false)
    const restored = loadSaveFile(serializeSaveFile(state)).state
    simulateOffline(restored, 0, 60_000, ctx)
    expect(restored.hauling.active).toBe(false)
    expect(restored.hauling.fleetLeg).toBeUndefined()
    expect(restored.dockedSite).toBeNull()
    expect(restored.wallet.isk).toBe(wallet)
    expect(restored.logs.filter(row => row.textId === 'core.industrial.004')).toHaveLength(0)
  })

  it('交战中提出停止，战斗正常结算后即停靠原出发站', () => {
    const { state, ctx } = world()
    expect(spawnIndustrialEncounter(state, ctx, { galaxyId: 'galaxy-cinder', shipId: state.shipId, kind: '停留' })).toBe(true)
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.fleetLeg!.abortAfterBattle).toBe(true)
    const restored = loadSaveFile(serializeSaveFile(state)).state
    const wallet = restored.wallet.isk
    restored.encounter.battle!.ended = 'me'
    settleEncounterBattle(restored, ctx, restored.encounter)
    expect(restored.hauling.active).toBe(false)
    expect(restored.hauling.fleetLeg).toBeUndefined()
    expect(restored.transit.active).toBe(false)
    expect(restored.encounter.active).toBe(false)
    expect(restored.awayGalaxy).toBeNull()
    expect(restored.dockedSite).toBeNull()
    expect(restored.wallet.isk).toBeGreaterThanOrEqual(wallet)
    expect(restored.logs.some(row => row.textId === 'core.industrial.004')).toBe(false)
    expect(restored.logs.some(row => row.textId === 'core.industrial.008')).toBe(false)
  })

  it('到站后运输循环可以停止且已结算运费保留', () => {
    const { state, ctx } = world()
    const wallet = state.wallet.isk
    state.hauling.fleetLeg!.stopAtArrival = true
    advanceGame(state, state.hauling.legMs, ctx)
    expect(state.hauling.active).toBe(false)
    expect(state.dockedSite).toBe('site-cinder')
    expect(state.wallet.isk).toBeGreaterThan(wallet)
    expect(state.logs.filter(row => row.textId === 'core.industrial.004')).toHaveLength(1)
    expect(activityOverview(state, ctx).some(row => row.kind === 'hauling')).toBe(false)
  })
})
