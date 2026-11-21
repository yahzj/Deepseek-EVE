
import { DEFAULT_BALANCE } from '@whale/core'

export type HullClassTier = 1 | 2 | 3 | 4 | 5

export const HULL_CLASS_NAME: Record<HullClassTier, string> = {
  1: '护卫舰',
  2: '驱逐舰',
  3: '巡洋舰',
  4: '战列舰',
  5: '泰坦',
}

export const HULL_CLASS_BASE_SPEED: Record<HullClassTier, number> = DEFAULT_BALANCE.battle.hullClassBaseSpeedMps

export const HULL_CLASS_MASS_RANGE: Record<HullClassTier, readonly [number, number]> = {
  1: [400_000, 2_400_000],
  2: [2_400_000, 5_800_000],
  3: [5_800_000, 13_000_000],
  4: [13_000_000, 29_000_000],
  5: [29_000_000, Infinity],
}

const ARMORED_MASS_FACTOR = 0.65

export function equivalentMassOf(ship: { massKg?: number; role?: string }): number {
  const mass = typeof ship.massKg === 'number' && Number.isFinite(ship.massKg) ? ship.massKg : 0
  return mass * (ship.role === 'armored' ? ARMORED_MASS_FACTOR : 1)
}

export function hullClassTierOfTier(tier: number): HullClassTier {
  if (!Number.isFinite(tier)) return 1
  const rounded = Math.round(tier)
  if (rounded <= 1) return 1
  if (rounded >= 5) return 5
  return rounded as HullClassTier
}

export function hullClassOf(ship: { tier?: number }): string {
  return HULL_CLASS_NAME[hullClassTierOfTier(ship.tier ?? 1)]
}
