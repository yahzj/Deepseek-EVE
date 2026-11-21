

export type DamageType = 'kinetic' | 'explosive' | 'plasma'

export type DamageResists = Partial<Record<DamageType, number>>

export interface DroneDefense {
  shieldHp: number
  armorHp: number
  hullHp: number
  shieldResist?: DamageResists
  armorResist?: DamageResists
  hullResist?: DamageResists
  evasion?: number
}

export type DroneClass = 'scout' | 'combat' | 'assault' | 'sentry' | 'repair'

export type FoeTactic = 'brawl' | 'orbit' | 'kite'

export type FoeTargetingMode = 'random' | 'top-output' | 'smallest' | 'largest' | 'noncombat'

export type FoeFamily = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'R'
