import type { GameState } from './state'
import type { SimContext } from './types'
import { fleetDefOf } from './instances'
import { allFittedModules, curveMult } from './equipment'

export function shortestTravelMinutes(ctx: SimContext, fromGalaxyId: string, toGalaxyId: string): number {
  return shortestTravelPath(ctx, fromGalaxyId, toGalaxyId).minutes
}

export function shortestTravelPath(
  ctx: SimContext,
  fromGalaxyId: string,
  toGalaxyId: string,
): { minutes: number; galaxies: string[]; hopMinutes: number[] } {
  const empty = { minutes: Infinity, galaxies: [] as string[], hopMinutes: [] as number[] }
  if (fromGalaxyId === toGalaxyId) return { minutes: 0, galaxies: [fromGalaxyId], hopMinutes: [] }
  const adjacency = new Map<string, Array<{ to: string; minutes: number }>>()
  const ensure = (id: string): void => {
    if (!adjacency.has(id)) adjacency.set(id, [])
  }
  for (const edge of ctx.galaxyEdges) {
    ensure(edge.from)
    ensure(edge.to)
    adjacency.get(edge.from)!.push({ to: edge.to, minutes: edge.travelMinutes })
    adjacency.get(edge.to)!.push({ to: edge.from, minutes: edge.travelMinutes })
  }
  if (!adjacency.has(fromGalaxyId) || !adjacency.has(toGalaxyId)) return empty
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const prevEdgeMinutes = new Map<string, number>()
  const visited = new Set<string>()
  dist.set(fromGalaxyId, 0)
  let reached = false
  for (;;) {
    let current: string | null = null
    let best = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d
        current = id
      }
    }
    if (current === null) break
    if (current === toGalaxyId) {
      reached = true
      break
    }
    visited.add(current)
    for (const next of adjacency.get(current)!) {
      if (visited.has(next.to)) continue
      const alt = best + next.minutes
      if (alt < (dist.get(next.to) ?? Infinity)) {
        dist.set(next.to, alt)
        prev.set(next.to, current)
        prevEdgeMinutes.set(next.to, next.minutes)
      }
    }
  }
  if (!reached) return empty
  const galaxies: string[] = []
  const hopMinutes: number[] = []
  let cur: string | undefined = toGalaxyId
  while (cur !== undefined) {
    galaxies.unshift(cur)
    const step = prevEdgeMinutes.get(cur)
    if (step !== undefined) hopMinutes.unshift(step)
    cur = prev.get(cur)
  }
  return { minutes: dist.get(toGalaxyId) ?? Infinity, galaxies, hopMinutes }
}

export function warpSpeedAus(state: GameState, ctx: SimContext, shipId?: string | null): number {
  const bal = ctx.balance.travel
  const def = fleetDefOf(state, ctx, shipId ?? state.shipId) ?? ctx.ships.get(shipId ?? state.shipId)
  const raw = def?.warpSpeedAus
  const base =
    typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 ? bal.warpRefAus : Math.max(0.5, raw)
  return base * warpBonusMult(state, ctx, shipId)
}

export function warpBonusMult(state: GameState, ctx: SimContext, shipId?: string | null): number {
  const fitted = state.fleet[shipId ?? state.shipId]?.fitted
  if (!fitted) return 1
  const bonuses = allFittedModules(fitted, ctx)
    .map((d) => d.warpSpeedBonusPct ?? 0)
    .filter((p) => p > 0)
  return bonuses.length > 0 ? curveMult(bonuses) : 1
}

export function travelTimeFactor(state: GameState, ctx: SimContext, shipId?: string | null): number {
  const bal = ctx.balance.travel
  if (!bal || typeof bal.warpRefAus !== 'number' || !Array.isArray(bal.skillIds)) return 1
  let f = bal.warpRefAus / warpSpeedAus(state, ctx, shipId)
  for (const skillId of bal.skillIds) {
    const lv = state.skills.trained[skillId] ?? 0
    if (lv > 0) f *= 1 - bal.cutPerLevel * lv
  }
  const cmdLv = Math.min(5, state.skills.trained['spaceship-command'] ?? 0)
  if (cmdLv > 0) f *= 1 - 0.02 * cmdLv
  return f
}

export function travelLegMs(state: GameState, ctx: SimContext, travelMinutes: number, shipId?: string | null): number {
  if (!Number.isFinite(travelMinutes) || travelMinutes <= 0) return 0
  if (state.debugQuick) return 1000
  return Math.max(1, Math.round(travelMinutes * 60_000 * travelTimeFactor(state, ctx, shipId)))
}

export function travelMinutesEff(
  state: GameState,
  ctx: SimContext,
  travelMinutes: number,
  shipId?: string | null
): number {
  if (!Number.isFinite(travelMinutes) || travelMinutes <= 0) return travelMinutes
  if (state.debugQuick) return 1
  return Math.max(1, Math.round(travelMinutes * travelTimeFactor(state, ctx, shipId)))
}
