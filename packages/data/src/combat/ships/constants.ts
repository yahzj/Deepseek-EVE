import { type FoeShipDef, enemyParameterOf } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'

export const ALIEN_BEAST_SHIP_IDS: readonly string[] = ['foe-alien-maw', 'foe-alien-hiveback']

export const ALIEN_FLAGSHIP_SHIP_IDS: readonly string[] = ['foe-alien-broodmother']

export const G_FLAGSHIP_SHIP_IDS: readonly string[] = []

export const H_FLAGSHIP_SHIP_IDS: readonly string[] = ['foe-h-ink-flagship']

export const R_FLAGSHIP_SHIP_IDS: readonly string[] = ['foe-r-corona-nexus']

export const CORONA_SPEED_BAND: readonly [number, number] = [0.55, 1.45]


export const INK_SPEED_EXEMPT_SHIP_IDS: readonly string[] = ['foe-h-ink-corvette', 'foe-h-ink-battlecruiser']

export const ALIEN_SLOW_SHIP_IDS: readonly string[] = ['foe-alien-spore-hive']

export const C_FAMILY_RESISTS: Pick<FoeShipDef, 'shieldResist' | 'armorResist' | 'hullResist'> = {
  shieldResist: { explosive: enemyParameterOf(foeShipsParameters, "c-family-resists", "shieldResist_explosive") },
  armorResist: { explosive: enemyParameterOf(foeShipsParameters, "c-family-resists", "armorResist_explosive") },
  hullResist: { explosive: enemyParameterOf(foeShipsParameters, "c-family-resists", "hullResist_explosive") },
}

export const ALIEN_CHARGE_MUL_BY_TIER: Readonly<Record<number, number>> = { 1: 1.5, 2: 2, 3: 2.5, 4: 3, 5: 4 }

export const ALIEN_INVASION_CHARGE_MUL: Readonly<Record<string, number>> = {
  'foe-alien-acid-burster': 2.5, 'foe-alien-hiveback': 1.5, 'foe-alien-broodmother': 1.25,
}

export const ALIEN_FAST_SHIP_IDS: readonly string[] = ['foe-alien-acid-burster']
