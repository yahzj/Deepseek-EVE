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

function world() {
  const ctx = buildSimContext()
  ctx.balance = structuredClone(ctx.balance)
  ctx.balance.events.enabled = false
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  expect(startHauling(state, null, 'site-cinder', ctx, 100).ok).toBe(true)
  return { state, ctx }
}

describe('运输停止回归', () => {
  it('跨三段中断后按已走时长折返，读档/重复停止不重置，到港后不再出发', () => {
    const { state, ctx } = world()
    const f = state.hauling.fleetLeg!
    f.path = [1000, 2000, 3000].map(durationMs => ({ galaxyId: 'galaxy-hub', durationMs, progressMs: 0 }))
    state.hauling.legMs = 6000
    advanceGame(state, 4500, ctx)
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.legMs).toBe(4500)
    expect(state.hauling.fleetLeg!.loadedM3).toBe(0)
    const wallet = state.wallet.isk
    const restored = loadSaveFile(serializeSaveFile(state)).state
    for (const current of [state, restored]) {
      advanceGame(current, 1000, ctx)
      expect(stopHauling(current, ctx).ok).toBe(true)
      expect(current.hauling.phaseAccMs).toBe(1000)
      advanceGame(current, 3500, ctx)
      expect(current.hauling.active).toBe(false)
      expect(current.hauling.fleetLeg).toBeUndefined()
      expect(current.awayGalaxy).toBeNull()
      advanceGame(current, 60_000, ctx)
      expect(current.hauling.active).toBe(false)
      expect(current.wallet.isk).toBe(wallet)
    }
  })

  it('到站停止只结本段一笔，含读档和离线大步推进不再接续', () => {
    const { state, ctx } = world()
    state.hauling.fleetLeg!.stopAtArrival = true
    const duration = state.hauling.legMs
    const restored = loadSaveFile(serializeSaveFile(state)).state
    const wallet = restored.wallet.isk
    simulateOffline(restored, 0, duration + 60_000, ctx)
    expect(restored.hauling.active).toBe(false)
    expect(restored.hauling.fleetLeg).toBeUndefined()
    expect(restored.dockedSite).toBe('site-cinder')
    expect(restored.wallet.isk).toBeGreaterThan(wallet)
    expect(restored.logs.filter(row => row.textId === 'core.industrial.004')).toHaveLength(1)
  })

  it('交战中确认停止后胜利也不续运，进入真实返港', () => {
    const { state, ctx } = world()
    expect(spawnIndustrialEncounter(state, ctx, { galaxyId: 'galaxy-cinder', shipId: state.shipId, kind: '停留' })).toBe(true)
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.fleetLeg!.abortAfterBattle).toBe(true)
    const restored = loadSaveFile(serializeSaveFile(state)).state
    restored.encounter.battle!.ended = 'me'
    settleEncounterBattle(restored, ctx, restored.encounter)
    expect(restored.hauling.active).toBe(false)
    expect(restored.hauling.fleetLeg).toBeUndefined()
    expect(restored.transit.active).toBe(true)
  })

  it('折返活动不再显示正常运输或允许重复停止', () => {
    const { state, ctx } = world()
    advanceGame(state, 1000, ctx)
    stopHauling(state, ctx)
    const view = activityOverview(state, ctx).find(row => row.kind === 'hauling')!
    expect(view.labelId).toBe('ui.industrial.007')
    expect(view.stopable).toBe(false)
  })
})
