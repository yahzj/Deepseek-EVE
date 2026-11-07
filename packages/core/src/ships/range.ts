import type { ShipDef } from './types'
import type { DamageType } from '../types'

/** 舰级额外战前射程：只进舰载武器按系加算池，不影响无人机、基础炮或支援装置。 */
export const SHIP_TIER_RANGE_BONUS: Readonly<Record<number, number>> = { 1: 0, 2: .05, 3: .1, 4: .15, 5: .2 }

/** 舰级与原船体特性同池相加，实战和舰船详情共用；不改静态舰船定义。 */
export function shipWeaponRangeBonusesOf(ship: Pick<ShipDef, 'tier' | 'weaponRangeBonusPct'>): Partial<Record<DamageType, number>> {
  const tierBonus = SHIP_TIER_RANGE_BONUS[ship.tier] ?? 0
  const bonuses: Partial<Record<DamageType, number>> = { ...ship.weaponRangeBonusPct }
  if (tierBonus > 0) {
    for (const type of ['kinetic', 'explosive', 'plasma'] as const) bonuses[type] = (bonuses[type] ?? 0) + tierBonus
  }
  return bonuses
}
