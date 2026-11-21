import type { ShipDef } from './types'
import type { DamageType } from '../types'

export const SHIP_TIER_RANGE_BONUS: Readonly<Record<number, number>> = { 1: 0, 2: .05, 3: .1, 4: .15, 5: .2 }

export function shipWeaponRangeBonusesOf(ship: Pick<ShipDef, 'tier' | 'weaponRangeBonusPct'>): Partial<Record<DamageType, number>> {
  const tierBonus = SHIP_TIER_RANGE_BONUS[ship.tier] ?? 0
  const bonuses: Partial<Record<DamageType, number>> = { ...ship.weaponRangeBonusPct }
  if (tierBonus > 0) {
    for (const type of ['kinetic', 'explosive', 'plasma'] as const) bonuses[type] = (bonuses[type] ?? 0) + tierBonus
  }
  return bonuses
}
