import { WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS, WEEKEND_LOCKED_FAMILY, WEEKEND_FAMILY_OVERRIDE, WEEKEND_FAMILY_ROTATION, WEEKEND_DEBUG_FAMILY, WEEKEND_FAMILY_NAME_ZH, UNKNOWN_FAMILY_ZH, WEEKEND_FAMILY_NAME_ID, H_FOE_POOL_CORE, H_FOE_POOL_PERIPHERY, R_FOE_POOL_CORE, R_FOE_POOL_PERIPHERY, D_FOE_POOL_CORE, D_FOE_POOL_PERIPHERY, WEEKEND_FAMILIES, weekendOccupiedIds } from './constants'
import type { GameState, WormholeFamily } from '../../state'
import { wormholeCardPoolAt } from '../../wormholeFoes'
import type { WeekendEventState } from './model'

export function weekendPeriodIndexOf(windowT0WallMs: number): number {
  const week = 7 * 24 * 3_600_000
  return Math.max(0, Math.floor((windowT0WallMs - WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS) / week))
}

export function weekendFamilyForWindow(windowT0WallMs: number): string | null {
  if (WEEKEND_LOCKED_FAMILY !== null) return WEEKEND_LOCKED_FAMILY
  const period = weekendPeriodIndexOf(windowT0WallMs)
  if (WEEKEND_FAMILY_OVERRIDE !== null && WEEKEND_FAMILY_OVERRIDE.periodIndex === period) {
    return WEEKEND_FAMILY_OVERRIDE.family
  }
  return WEEKEND_FAMILY_ROTATION.length > 0 ? WEEKEND_FAMILY_ROTATION[period % WEEKEND_FAMILY_ROTATION.length]! : null
}

export function weekendLockedFamilyOf(state: Pick<GameState, 'debugQuick'>): string | null {
  return state.debugQuick === true && WEEKEND_DEBUG_FAMILY !== null
    ? WEEKEND_DEBUG_FAMILY
    : WEEKEND_LOCKED_FAMILY
}

export function weekendFamilyNameZh(family: string): string {
  return WEEKEND_FAMILY_NAME_ZH[family] ?? UNKNOWN_FAMILY_ZH
}

export function weekendFamilyNameId(family: string): string | undefined {
  return WEEKEND_FAMILY_NAME_ID[family] ?? 'core.weekend.025'
}

export function weekendFoeFleetNameOf(family: string, cardName: string): string {
  const fam = weekendFamilyNameZh(family)
  return cardName.includes(fam) ? cardName : `${fam}舰队 · ${cardName}`
}

export function weekendFoeCardsSelfPriced(family: string): boolean {
  return family === 'H' || family === 'R' || family === 'C' || family === 'D'
}

export function weekendFoePoolOf(family: string, isCore: boolean): readonly string[] {
  if (family === 'C') return isCore ? ['alien-escort', 'alien-main'] : ['alien-vanguard', 'alien-escort']
  if (family === 'H') return isCore ? H_FOE_POOL_CORE : H_FOE_POOL_PERIPHERY
  if (family === 'R') return isCore ? R_FOE_POOL_CORE : R_FOE_POOL_PERIPHERY
  if (family === 'D') return isCore ? D_FOE_POOL_CORE : D_FOE_POOL_PERIPHERY
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  return [wormholeCardPoolAt(fam, isCore ? 9 : 5)[0]!.id]
}

export function weekendDrawFoeCardId(
  family: string,
  isCore: boolean,
  seq: number,
  galaxyIdx: number,
  salt: number,
): string {
  const pool = weekendFoePoolOf(family, isCore)
  if (pool.length <= 1) return pool[0]!
  const r = hash32(hash32(seq, galaxyIdx), salt) / 4294967296
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]!
}

export function weekendGarrisonFoeCardId(
  _state: Pick<GameState, 'rng'>,
  ev: WeekendEventState,
  galaxyId: string,
): string {
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  return weekendDrawFoeCardId(ev.family, galaxyId === ev.coreId, ev.seq, idx, 0)
}

export function weekendFoeCardOf(family: string, kind: 'assault' | 'flagship'): string {
  if (family === 'C') return kind === 'flagship' ? 'alien-broodmother' : 'alien-vanguard'
  if (family === 'H') return kind === 'flagship' ? 'ink-flagship' : H_FOE_POOL_PERIPHERY[0]!
  if (family === 'R') return kind === 'flagship' ? 'corona-nexus' : R_FOE_POOL_PERIPHERY[0]!
  if (family === 'D') return kind === 'flagship' ? 'gravekeeper-flagship' : D_FOE_POOL_PERIPHERY[0]!
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  const pool = wormholeCardPoolAt(fam, kind === 'flagship' ? 9 : 5)
  return pool[0]!.id
}

export function hash32(a: number, b: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export function streamOf(seed: number, seq: number): () => number {
  let s = hash32(seed, seq * 2654435761) || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
