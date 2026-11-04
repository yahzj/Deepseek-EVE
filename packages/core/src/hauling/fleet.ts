import { addLog, HOME_GALAXY_ID } from '../state'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { applyActivityGate } from '../activityGate'
import { stationActivityStartBlockReason, stationActivityStartState } from '../location'
import { queueStationActivity } from '../stationActivityPending'
import { combatRosterOf } from '../combat/command/roster'
import { commandBudgetOf } from '../combat/command/rules'
import { combatEscortBlock } from '../combat/command/locks'
import { shortestTravelPath, travelLegMs } from '../travel'
import { haulFleetLoadOf } from './load'
import type { HaulFleetLeg } from './types'
import { haulEndpoints, haulEndpointName, haulLegMinutesOf, haulBaseReward, haulEffectiveMinutes, HAUL_TRIP_MUL_MIN, HAUL_TRIP_MUL_MAX } from './routes'
import { ceilFinalQuantity } from '../quantity'
import { nextRandom } from '../rng'
import { bumpFirst } from '../firstTasks'
import { beginDeparture, consumeDeparture, cancelDeparture } from '../departure'
import { noteOfflineDelivery, noteOfflineTransportStop } from '../offlineCombatStats'

function galaxy(ctx: SimContext, site: string | null): string {
  return site === null ? HOME_GALAXY_ID : ctx.stations.get(site)?.galaxyId ?? ''
}

/** 路段采用更危险一端的位置，展示和袭击均读该冻结路径。 */
export function haulFleetPathOf(state: GameState, ctx: SimContext, ids: readonly string[], from: string, to: string): HaulFleetLeg['path'] {
  const route = shortestTravelPath(ctx, from, to)
  if (route.galaxies.length < 2) return []
  const total = route.hopMinutes.reduce((sum, n) => sum + n, 0)
  const duration = Math.max(...ids.map(id => travelLegMs(state, ctx, haulLegMinutesOf(total), id)))
  let assigned = 0
  return route.hopMinutes.map((minutes, index) => {
    const a = route.galaxies[index]!, b = route.galaxies[index + 1]!
    const durationMs = index === route.hopMinutes.length - 1 ? Math.max(1, duration - assigned) : Math.min(Math.max(1, duration - assigned - (route.hopMinutes.length - index - 1)), Math.max(1, Math.round(duration * minutes / total)))
    assigned += durationMs
    return { galaxyId: (ctx.galaxies.get(a)?.security ?? 1) < (ctx.galaxies.get(b)?.security ?? 1) ? a : b, durationMs, progressMs: 0 }
  })
}

function trip(state: GameState): void {
  state.hauling.tripMul = Math.round((HAUL_TRIP_MUL_MIN + nextRandom(state.rng) * (HAUL_TRIP_MUL_MAX - HAUL_TRIP_MUL_MIN)) * 10) / 10
  state.hauling.tripLegsLeft = 2
}

function setFleetLeg(state: GameState, ctx: SimContext, from: string | null, to: string | null, ids: string[], targetM3: number, positioning: boolean): boolean {
  const h = state.hauling
  const path = haulFleetPathOf(state, ctx, ids, galaxy(ctx, from), galaxy(ctx, to))
  if (!path.length) return false
  let load
  try { load = haulFleetLoadOf(state, ctx, ids, positioning ? 0 : targetM3) } catch { return false }
  h.fromSiteId = from
  h.toSiteId = to
  h.legMs = path.reduce((sum, row) => sum + row.durationMs, 0)
  h.legMinutes = haulLegMinutesOf(shortestTravelPath(ctx, galaxy(ctx, from), galaxy(ctx, to)).hopMinutes.reduce((sum, n) => sum + n, 0))
  h.phaseAccMs = 0
  beginDeparture(state, ctx, 'hauling', galaxy(ctx, to), { galaxy: galaxy(ctx, from), site: from, docked: true })
  const baseRewardIsk = positioning ? 0 : haulBaseReward(ctx, load.loadedM3, haulEffectiveMinutes(ctx, galaxy(ctx, from), galaxy(ctx, to)))
  h.fleetLeg = { version: 1, targetM3, shipIds: [...ids], loadedByShip: load.byShip.map(row => ({ shipId: row.shipId, loadedM3: row.loadedM3 })), loadedM3: load.loadedM3, baseRewardIsk,
    positioning, stopAtArrival: false, returning: false, path, pathIndex: 0 }
  state.awayGalaxy = path[0]!.galaxyId
  state.dockedSite = null
  return true
}

/** 校验全部完成后才占出勤名单，不自动清空实体货物。 */
export function startFleetHauling(state: GameState, aSiteId: string | null, bSiteId: string | null, ctx: SimContext, requestedM3?: number): CommandResult {
  if (state.hauling.active) return { ok: false, errorId: 'core.hauling.001', error: 'hauling-active' }
  const endpoints = haulEndpoints(state, ctx)
  const a = endpoints.find(row => row.siteId === aSiteId), b = endpoints.find(row => row.siteId === bSiteId)
  if (!a || !b) return { ok: false, errorId: 'core.hauling.003', error: 'hauling-endpoint' }
  if (aSiteId === bSiteId) return { ok: false, errorId: 'core.hauling.004', error: 'hauling-same-endpoint' }
  const ids = combatRosterOf(state)
  const budget = commandBudgetOf(state, ctx, ids)
  if (!budget.ok) return { ...budget, error: budget.error! }
  const blocked = combatEscortBlock(state, ids) ?? stationActivityStartBlockReason(state, ctx, 'hauling')
  if (blocked) return { ok: false, ...blocked }
  let load
  try { load = haulFleetLoadOf(state, ctx, ids, requestedM3) } catch { return { ok: false, errorId: 'core.industrial.001', error: 'hauling-load-invalid' } }
  if (load.loadedM3 < 1) return { ok: false, errorId: 'core.industrial.001', error: 'hauling-load-empty' }
  const projected = stationActivityStartState(state, 'hauling', ctx)
  const from = projected.dockedSite
  const fromGalaxy = galaxy(ctx, from)
  const positioning = from !== aSiteId && from !== bSiteId
  const pathA = haulFleetPathOf(state, ctx, ids, fromGalaxy, a.galaxyId)
  const pathB = haulFleetPathOf(state, ctx, ids, fromGalaxy, b.galaxyId)
  const ms = (path: HaulFleetLeg['path']) => path.length ? path.reduce((sum, row) => sum + row.durationMs, 0) : Infinity
  const to = positioning ? ms(pathA) <= ms(pathB) ? aSiteId : bSiteId : from === aSiteId ? bSiteId : aSiteId
  if (!haulFleetPathOf(state, ctx, ids, a.galaxyId, b.galaxyId).length || !haulFleetPathOf(state, ctx, ids, fromGalaxy, galaxy(ctx, to)).length) return { ok: false, errorId: 'core.hauling.005', error: 'hauling-no-route' }
  const queued = queueStationActivity(state, ctx, { kind: 'hauling', aSiteId, bSiteId, ...(requestedM3 === undefined ? {} : { requestedM3 }) })
  if (queued) return queued
  const gated = applyActivityGate(state, 'hauling', ctx)
  if (gated) return gated
  state.hauling.active = true
  state.hauling.routeA = aSiteId
  state.hauling.routeB = bSiteId
  if (!setFleetLeg(state, ctx, from, to, ids, load.loadedM3, positioning)) { state.hauling.active = false; return { ok: false, errorId: 'core.hauling.005', error: 'hauling-no-route' } }
  if (!positioning) trip(state)
  addLog(state, 'fleet', '', 'core.industrial.002', { p1: ids.length, p2: load.loadedM3, p3: haulEndpointName(ctx, to) })
  return { ok: true }
}

export function stopFleetHauling(state: GameState, ctx: SimContext, atArrival = false): CommandResult {
  const h = state.hauling, f = h.fleetLeg
  if (!h.active || !f) return { ok: false, errorId: 'core.hauling.018', error: 'hauling-inactive' }
  if (atArrival) { f.stopAtArrival = true; return { ok: true } }
  if (cancelDeparture(state, 'hauling')) {
    state.dockedSite = h.fromSiteId
    h.active = false
    delete h.fleetLeg
    delete state.combatEscort
    return { ok: true }
  }
  if (state.encounter.active) { f.abortAfterBattle = true; return { ok: true } }
  if (f.returning) return { ok: true }
  const reverse = f.path.slice(0, f.pathIndex + 1).reverse().flatMap(row => row.progressMs > 0 ? [{ galaxyId: row.galaxyId, durationMs: row.progressMs, progressMs: 0 }] : [])
  const origin = h.fromSiteId
  f.loadedM3 = 0
  f.loadedByShip.forEach(row => { row.loadedM3 = 0 })
  f.returning = true
  f.positioning = false
  f.stopAtArrival = true
  h.toSiteId = origin
  h.phaseAccMs = 0
  f.path = reverse.length ? reverse : [{ galaxyId: state.awayGalaxy ?? galaxy(ctx, origin), durationMs: 1, progressMs: 0 }]
  f.pathIndex = 0
  h.legMs = f.path.reduce((sum, row) => sum + row.durationMs, 0)
  state.awayGalaxy = f.path[0]!.galaxyId
  addLog(state, 'fleet', '', 'core.industrial.003', { p1: haulEndpointName(ctx, origin) })
  return { ok: true }
}

/** 正常推进只消费本段时间；战斗暂停由引擎共同时间轴保证。 */
export function advanceFleetHauling(state: GameState, deltaMs: number, ctx: SimContext): void {
  const h = state.hauling, f = h.fleetLeg
  if (!h.active || !f || state.encounter.active) return
  deltaMs = consumeDeparture(state, 'hauling', deltaMs)
  if (deltaMs <= 0) return
  const row = f.path[f.pathIndex]
  if (!row) { h.active = false; return }
  const step = Math.min(deltaMs, Math.max(0, row.durationMs - row.progressMs))
  row.progressMs += step
  h.phaseAccMs += step
  if (row.progressMs < row.durationMs) return
  if (f.pathIndex + 1 < f.path.length) { f.pathIndex++; state.awayGalaxy = f.path[f.pathIndex]!.galaxyId; return }
  state.awayGalaxy = null
  state.dockedSite = h.toSiteId
  const rosterIntact = f.shipIds.every(id => state.fleet[id] && state.fleet[id]!.durability > 0)
  if (!f.positioning && !f.returning && rosterIntact) {
    const reward = ceilFinalQuantity(f.baseRewardIsk * (h.tripMul > 0 ? h.tripMul : HAUL_TRIP_MUL_MIN))
    state.wallet.isk += reward
    noteOfflineDelivery(state, f.loadedM3, reward)
    h.tripLegsLeft--
    addLog(state, 'trade', '', 'core.industrial.004', { p1: haulEndpointName(ctx, h.toSiteId), p2: f.loadedM3, p3: reward })
    if (h.tripLegsLeft <= 0) bumpFirst(state, 'haulTrips')
  }
  if (!rosterIntact || f.returning || f.stopAtArrival) {
    noteOfflineTransportStop(state, !rosterIntact ? 'loss' : f.returning ? 'interrupted' : 'arrival')
    h.active = false; delete h.fleetLeg; return
  }
  const from = h.toSiteId, to = from === h.routeA ? h.routeB : h.routeA
  if (f.positioning || h.tripLegsLeft <= 0) trip(state)
  if (!setFleetLeg(state, ctx, from, to, f.shipIds, f.targetM3, false)) {
    noteOfflineTransportStop(state, 'capacity')
    h.active = false
    delete h.fleetLeg
    addLog(state, 'warn', '', 'core.industrial.005')
  }
}
