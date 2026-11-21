import type { GameState } from '../../state'
import { weekendDebugOn } from './time'
import { WEEKEND_MIN_STANDING, WEEKEND_FINISHED_FAMILIES } from './constants'
import type { SimContext } from '../../types'
import { securityZoneOf } from '../../securityZone'
import { streamOf, weekendLockedFamilyOf } from './family'

export function dsiStandingOf(state: Pick<GameState, 'standings' | 'standingsEarned'>): number {
  return state.standingsEarned?.['dsi'] ?? state.standings['dsi'] ?? 0
}

export function weekendInvasionAllowedFor(
  state: Pick<GameState, 'debugQuick' | 'standings' | 'standingsEarned'>,
): boolean {
  if (weekendDebugOn(state)) return true
  return dsiStandingOf(state) >= WEEKEND_MIN_STANDING
}

export function weekendCoreCandidates(state: GameState, ctx: SimContext): string[] {
  const out: string[] = []
  for (const id of state.exploredGalaxies ?? []) {
    if (securityZoneOf(ctx, id) === '高安') continue
    if (weekendHasBuiltStation(state, ctx, id)) continue
    out.push(id)
  }
  return out.sort()
}

export function weekendHasBuiltStation(state: GameState, ctx: SimContext, galaxyId: string): boolean {
  for (const site of ctx.stations.values()) {
    const anySite = site as unknown as { galaxyId?: string; tiers?: readonly unknown[] }
    if (anySite.galaxyId !== galaxyId) continue
    const p = state.stationSites?.[site.id]
    if (p && anySite.tiers && p.stage >= anySite.tiers.length) return true
  }
  return false
}

export function weekendPeripheryOf(ctx: SimContext, coreId: string): string[] {
  const out = new Set<string>()
  for (const e of ctx.galaxyEdges) {
    if (e.from === coreId) out.add(e.to)
    else if (e.to === coreId) out.add(e.from)
  }
  out.delete(coreId)
  return [...out].sort()
}

export function weekendRollOccupation(
  state: GameState,
  ctx: SimContext,
  seq: number,
  familyOfWindow?: string | null,
): { coreId: string; peripheryIds: string[]; family: string } | null {
  const candidates = weekendCoreCandidates(state, ctx)
  if (candidates.length === 0) return null
  const rng = streamOf(state.rng.seed, seq)
  const coreId = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]!
  const familyRoll = rng()
  const family =
    familyOfWindow ??
    weekendLockedFamilyOf(state) ??
    WEEKEND_FINISHED_FAMILIES[
      Math.min(WEEKEND_FINISHED_FAMILIES.length - 1, Math.floor(familyRoll * WEEKEND_FINISHED_FAMILIES.length))
    ]!
  return { coreId, peripheryIds: weekendPeripheryOf(ctx, coreId), family }
}

export function weekendRandomFamilyOf(state: Pick<GameState, 'rng'>, seq: number): string {
  const pool = WEEKEND_FINISHED_FAMILIES
  const rng = streamOf(state.rng.seed, seq)
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!
}

export function weekendPeriodSealedByKill(
  state: Pick<GameState, 'weekendLastResult'>,
  t0WallMs: number,
): boolean {
  const snap = state.weekendLastResult
  return snap !== undefined && snap.flagshipOutcome === 'player' && snap.endedAtWallMs >= t0WallMs
}
