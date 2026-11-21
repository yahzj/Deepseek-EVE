import { describe, expect, it } from 'vitest'
import { addShipToFleet } from '../src/fleetBook'
import { advanceGame } from '../src/engine'
import { advanceMining, advanceShipReturns, startMining, stopMining } from '../src/mining'
import { advanceSalvageOp, startSalvageOp, stopSalvageOp } from '../src/salvaging'
import { applyActivityGate } from '../src/activityGate'
import { commandShipDeployed } from '../src/combat/command/locks'
import { shipOperationBlockReason } from '../src/shipActionPolicy'
import { changeShip } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createCommandReadyState } from './helpers/command-ready'
import { finishDeparture } from './helpers/departure-ready'
import { anomaly, galaxy, makeTestCtx, moduleDef } from './helpers'

function world(kind: 'mining' | 'salvaging') {
  const ctx = makeTestCtx({ quietEvents: true, marketGoods: [],
    galaxies: [galaxy('galaxy-scrap', '废场')],
    edges: [{ from: 'galaxy-hub', to: 'galaxy-scrap', travelMinutes: 2 }],
    anomalies: [anomaly('ano-scrap', 'galaxy-scrap', { threat: 40 })],
    modules: [moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 })],
  })
  const state = createCommandReadyState({ nowWallMs: 0, seed: 42 })
  const leader = state.shipId
  const escort = addShipToFleet(state, 'sandcat')
  const idle = addShipToFleet(state, 'sandcat')
  state.preparationSquads = { combat: [leader, escort] }
  state.exploredGalaxies.push('galaxy-scrap')
  state.fleet[leader]!.fitted.high = ['mod-salvager-1']
  const result = kind === 'mining' ? startMining(state, 'belt-a', ctx) : startSalvageOp(state, 'galaxy-scrap', ctx)
  expect(result.ok).toBe(true)
  finishDeparture(state, ctx)
  state.fleet[leader]!.cargo = { 'ore-a': 7 }
  state.fleet[escort]!.cargo = { 'ore-b': 13, 'mod-salvager-1': 2 }
  state.fleet[idle]!.cargo = { 'ore-a': 19 }
  return { state, ctx, leader, escort, idle }
}

describe('采掘编队返航卸货', () => {
  for (const kind of ['mining', 'salvaging'] as const) {
    it(`${kind}自动返航卸完整出勤队，不动港内闲船，且不重复发货`, () => {
      const { state, ctx, leader, escort, idle } = world(kind)
      if (kind === 'mining') {
        state.mining.phase = 'returning'
        state.mining.stopAfterTrip = true
      } else {
        state.salvaging.phase = 'returning'
        state.salvaging.stopAfterTrip = true
      }
      const advance = () => kind === 'mining' ? advanceMining(state, 600_000, ctx) : advanceSalvageOp(state, 600_000, ctx)
      advance()
      expect(state.fleet[leader]!.cargo).toEqual({})
      expect(state.fleet[escort]!.cargo).toEqual({})
      expect(state.warehouse.items['ore-a']).toBe(7)
      expect(state.warehouse.items['ore-b']).toBe(13)
      expect(state.moduleBay['mod-salvager-1']).toBe(2)
      expect(state.fleet[idle]!.cargo).toEqual({ 'ore-a': 19 })
      const after = structuredClone(state.warehouse)
      advance()
      expect(state.warehouse).toEqual(after)
    })

    it(`${kind}手动停止返航存读档后，随行货到港才卸`, () => {
      const { state, ctx, leader, escort } = world(kind)
      expect(kind === 'mining' ? stopMining(state, ctx) : stopSalvageOp(state, ctx)).toBe(true)
      const restored = loadSaveFile(serializeSaveFile(state, 0)).state
      const ret = restored.shipReturns[leader]!
      const left = ret.legMs - ret.phaseAccMs
      advanceShipReturns(restored, left - 1, ctx)
      expect(restored.fleet[escort]!.cargo['ore-b']).toBe(13)
      advanceShipReturns(restored, 1, ctx)
      expect(restored.fleet[escort]!.cargo).toEqual({})
      expect(restored.warehouse.items['ore-b']).toBe(13)
    })

    it(`${kind}换驾驶后旧编队到港卸货，不卸新驾驶船`, () => {
      const { state, ctx, leader, escort, idle } = world(kind)
      expect(changeShip(state, idle, ctx).ok).toBe(true)
      expect(state.shipReturns[leader]).toBeDefined()
      expect(state.fleet[escort]!.cargo['ore-b']).toBe(13)
      advanceGame(state, 600_000, ctx)
      expect(state.fleet[escort]!.cargo).toEqual({})
      expect(state.warehouse.items['ore-b']).toBe(13)
      expect(state.fleet[idle]!.cargo).toEqual({ 'ore-a': 19 })
    })

    it(`${kind}换驾驶后新活动快照不覆盖旧队返航，不提前解锁`, () => {
      const { state, ctx, leader, escort, idle } = world(kind)
      expect(changeShip(state, idle, ctx).ok).toBe(true)
      expect(state.shipReturns[escort]).toEqual(state.shipReturns[leader])
      expect(shipOperationBlockReason(state, ctx, escort, 'cargo')).not.toBeNull()
      state.preparationSquads = { combat: [idle] }
      expect(applyActivityGate(state, 'standby', ctx)).toBeNull()
      advanceShipReturns(state, 600_000, ctx)
      expect(state.fleet[escort]!.cargo).toEqual({})
      expect(state.warehouse.items['ore-b']).toBe(13)
      expect(state.fleet[idle]!.cargo).toEqual({ 'ore-a': 19 })
      expect(shipOperationBlockReason(state, ctx, escort, 'cargo')).toBeNull()
    })

    it(`${kind}自动循环卸货后保留原随行快照与出勤锁`, () => {
      const { state, ctx, leader, escort } = world(kind)
      const sortie = structuredClone(state.combatEscort)
      if (kind === 'mining') {
        state.mining.phase = 'returning'
        advanceMining(state, 600_000, ctx)
      } else {
        state.salvaging.phase = 'returning'
        advanceSalvageOp(state, 600_000, ctx)
      }
      expect(state.fleet[escort]!.cargo['ore-b']).toBeUndefined()
      expect(state.warehouse.items['ore-b']).toBe(13)
      expect(state.combatEscort).toEqual(sortie)
      expect(state.combatEscort?.leaderShipId).toBe(leader)
      expect(commandShipDeployed(state, escort)).toBe(true)
    })

    it(`${kind}旧在途无出勤快照不按准备名单卸港内舰`, () => {
      const { state, ctx, escort } = world(kind)
      delete state.combatEscort
      if (kind === 'mining') {
        state.mining.phase = 'returning'
        state.mining.stopAfterTrip = true
        advanceMining(state, 600_000, ctx)
      } else {
        state.salvaging.phase = 'returning'
        state.salvaging.stopAfterTrip = true
        advanceSalvageOp(state, 600_000, ctx)
      }
      expect(state.fleet[escort]!.cargo['ore-b']).toBe(13)
      expect(state.warehouse.items['ore-b']).toBeUndefined()
    })
  }

  it('离港等待中取消采矿，原地货物不因出勤快照被卸走', () => {
    const { state, ctx, leader, escort } = world('mining')
    expect(stopMining(state, ctx)).toBe(true)
    advanceShipReturns(state, 600_000, ctx)
    state.fleet[leader]!.cargo = { 'ore-a': 7 }
    state.fleet[escort]!.cargo = { 'ore-b': 13 }
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.departure).toBeDefined()
    expect(stopMining(state, ctx)).toBe(true)
    advanceGame(state, 600_000, ctx)
    expect(state.fleet[leader]!.cargo).toEqual({ 'ore-a': 7 })
    expect(state.fleet[escort]!.cargo).toEqual({ 'ore-b': 13 })
  })
})
