/** 运输公共入口；费率、全队装载和推进分别归域内单点。 */
import { addLog, HOME_GALAXY_ID, haulingHalt } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { cargoCapacityM3Of } from './inventory'
import { startFleetHauling, advanceFleetHauling, stopFleetHauling } from './hauling/fleet'
import { haulLegReward, haulEffectiveMinutes, haulEndpointName, HAUL_TRIP_MUL_MIN } from './hauling/routes'
import { noteOfflineDelivery, noteOfflineTransportStop } from './offlineCombatStats'
import { consumeDeparture } from './departure'
export { HAUL_RATE_PER_M3_MIN, HAUL_LEG_TIME_MUL, HAUL_TRIP_MUL_MIN, HAUL_TRIP_MUL_MAX, haulLegMinutesOf, haulSecurityMulOf, haulExposureAt, haulEffectiveMinutes, haulBaseReward, haulLegReward, haulRewardRange, haulUnitRewardRange, haulEndpoints, haulEndpointName, dockedHaulEndpoint } from './hauling/routes'
export type { HaulEndpoint } from './hauling/routes'

export function startHauling(state: GameState, aSiteId: string | null, bSiteId: string | null, ctx: SimContext, requestedM3?: number): CommandResult {
  return startFleetHauling(state, aSiteId, bSiteId, ctx, requestedM3)
}

export function stopHauling(state: GameState, ctx: SimContext): CommandResult {
  if (state.hauling.fleetLeg) {
    return stopFleetHauling(state, ctx)
  }
  const info = haulingHalt(state)
  if (!info) return { ok: false, errorId: 'core.hauling.018', error: 'hauling-inactive' }
  addLog(state, 'fleet', '', 'core.hauling.019', { p1: haulEndpointName(ctx, info.fromSiteId) })
  return { ok: true }
}

export function advanceHauling(state: GameState, deltaMs: number, ctx: SimContext): void {
  const h = state.hauling
  if (!h.active || deltaMs <= 0 || state.encounter.active) return
  if (h.fleetLeg) { advanceFleetHauling(state, deltaMs, ctx); return }
  deltaMs = consumeDeparture(state, 'hauling', deltaMs)
  if (deltaMs <= 0) return
  h.phaseAccMs += Math.min(deltaMs, Math.max(0, h.legMs - h.phaseAccMs))
  if (h.phaseAccMs < h.legMs) return
  const g = (id: string | null) => id === null ? HOME_GALAXY_ID : ctx.stations.get(id)?.galaxyId ?? ''
  const amount = cargoCapacityM3Of(state, ctx, state.shipId)
  const reward = haulLegReward(ctx, amount, haulEffectiveMinutes(ctx, g(h.fromSiteId), g(h.toSiteId)), h.tripMul > 0 ? h.tripMul : HAUL_TRIP_MUL_MIN)
  state.wallet.isk += reward
  noteOfflineDelivery(state, amount, reward)
  noteOfflineTransportStop(state, 'arrival')
  state.awayGalaxy = null
  state.dockedSite = h.toSiteId
  h.active = false
  addLog(state, 'trade', '', 'core.industrial.004', { p1: haulEndpointName(ctx, h.toSiteId), p2: amount, p3: reward })
}

export function cancelHaulingOnSwitch(state: GameState, ctx: SimContext): void {
  if (!state.hauling.active) return
  if (state.hauling.fleetLeg) { stopFleetHauling(state, ctx); return }
  stopHauling(state, ctx)
}

export function haulingOccupiedM3(state: GameState, ctx: SimContext, shipId = state.shipId): number {
  if (!state.hauling.active) return 0
  if (state.hauling.fleetLeg) return state.hauling.fleetLeg.loadedByShip.find(row => row.shipId === shipId)?.loadedM3 ?? 0
  return shipId === state.shipId ? cargoCapacityM3Of(state, ctx, shipId) : 0
}
