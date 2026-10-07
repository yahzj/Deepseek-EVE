import type { GameState } from './state'
import { HOME_GALAXY_ID, shipLockedReason } from './state'
import type { SimContext } from './types'
import type { PlanetActionResult, PlanetCatalog } from './planetTypes'
import { cargoCapacityM3Of, cargoUsedM3Of } from './inventory'
import { shipBusyLabel } from './activity'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { preparePlanetBase } from './planetConstruction'
import { planetColonyView } from './planetColony'

const LOCAL_INPUTS: Readonly<Record<string, { resource: 'food' | 'water' | 'medicine' | 'parts'; units: number }>> = {
  'repairkit-civ': { resource: 'medicine', units: 1 },
  'part-coolant': { resource: 'water', units: 2 },
  'min-tritanium': { resource: 'parts', units: 0.1 },
}

/** 原料实体先到星球库，再由命令转换为明确的本地补给，不隔空借仓库。 */
export function convertPlanetSupplies(state: GameState, planetId: string, itemId: string, count: number): PlanetActionResult {
  const c = state.planetary?.planets[planetId]?.colony
  if (!c || !Number.isSafeInteger(count) || count < 1 || (c.items[itemId] ?? 0) < count) return { ok: false, reason: 'materials' }
  const rule = LOCAL_INPUTS[itemId]
  if (!rule) return { ok: false, reason: 'unsupported' }
  c.items[itemId] = (c.items[itemId] ?? 0) - count
  c.supplies[rule.resource] = (c.supplies[rule.resource] ?? 0) + count * rule.units
  return { ok: true }
}

export function dispatchPlanetDelivery(state: GameState, ctx: SimContext, catalog: PlanetCatalog,
  planetId: string, shipUid: string, items: Record<string, number>, credits: number, humans: number): PlanetActionResult {
  const p = state.planetary?.planets[planetId]
  if (state.planetary?.runtimeVersion !== 1 || !p || p.survey < 2 || !ctx.galaxies.has(p.galaxyId)) return { ok: false, reason: 'not-ready' }
  const ship = Object.hasOwn(state.fleet, shipUid) ? state.fleet[shipUid] : undefined
  if (!ship || shipUid === state.shipId || shipBusyLabel(state, ctx, shipUid) || shipLockedReason(state, shipUid) || ship.durability <= 0) return { ok: false, reason: 'ship-busy' }
  if ((state.planetary.deliveries ?? []).some(d => d.shipUid === shipUid)) return { ok: false, reason: 'ship-busy' }
  if ((state.planetary.deliveries ?? []).length >= 64) return { ok: false, reason: 'delivery-limit' }
  if (!Number.isSafeInteger(credits) || credits < 0 || credits > state.wallet.isk || !Number.isSafeInteger(humans) || humans < 0 || humans > (state.planetary.humans?.sleeping ?? 0)) return { ok: false, reason: 'materials' }
  const source = items && typeof items === 'object' && !Array.isArray(items) ? Object.entries(items) : []
  if (source.length > 32 || source.some(([id, n]) => !ctx.items.has(id) || !Number.isSafeInteger(n) || n <= 0 || (state.warehouse.items[id] ?? 0) < n)) return { ok: false, reason: 'materials' }
  if (source.length === 0 && credits === 0 && humans === 0) return { ok: false, reason: 'materials' }
  if (Object.keys(ship.cargo).length > 0) return { ok: false, reason: 'ship-busy' }
  if (source.some(([id]) => ctx.items.get(id)!.holdForbidden)) return { ok: false, reason: 'cargo-full' }
  const volume = source.reduce((n, [id, count]) => n + ctx.items.get(id)!.unitM3 * count, 0) + humans * 50
  if (volume + cargoUsedM3Of(state, ctx, shipUid) > cargoCapacityM3Of(state, ctx, shipUid)) return { ok: false, reason: 'cargo-full' }
  if (humans > 0 && (!p.colony || planetColonyView(p, catalog).cryoCapacity < p.colony.awake + p.colony.sleeping + humans
    + (state.planetary.deliveries ?? []).filter(d => d.planetId === planetId).reduce((n, d) => n + d.humans, 0))) return { ok: false, reason: 'housing' }
  const minutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, p.galaxyId)
  if (!Number.isFinite(minutes)) return { ok: false, reason: 'unreachable' }
  const check = preparePlanetBase(p, catalog)
  if (!check.ok) return check
  for (const [id, count] of source) state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) - count
  state.wallet.isk -= credits
  if (humans > 0) state.planetary.humans!.sleeping -= humans
  const durationMs = Math.max(10_000, 2 * travelLegMs(state, ctx, minutes, shipUid))
  const deliveries = state.planetary.deliveries ??= []
  deliveries.push({ seq: Math.max(0, ...deliveries.map(d => d.seq)) + 1, planetId, shipUid,
    items: Object.fromEntries(source), credits, humans, remainingMs: durationMs, durationMs })
  return { ok: true }
}

export function advancePlanetDeliveries(state: GameState, deltaMs: number): void {
  if (state.planetary?.runtimeVersion !== 1) return
  const pending = state.planetary.deliveries ?? []
  for (const delivery of pending) {
    if (delivery.remainingMs <= 0) continue
    delivery.remainingMs = Math.max(0, delivery.remainingMs - deltaMs)
    if (delivery.remainingMs > 0) continue
    const c = state.planetary.planets[delivery.planetId]?.colony
    if (!c || !Object.hasOwn(state.fleet, delivery.shipUid)) { delivery.remainingMs = 1; continue }
    for (const [id, units] of Object.entries(delivery.items)) c.items[id] = (c.items[id] ?? 0) + units
    c.credits += delivery.credits
    c.sleeping += delivery.humans
  }
  state.planetary.deliveries = pending.filter(d => d.remainingMs > 0)
}
