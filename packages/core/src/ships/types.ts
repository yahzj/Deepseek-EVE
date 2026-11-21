import type { DamageType, DamageResists, ShipRole, ShipSubClass, ShipSlots } from '../types'
import type { ShipCommandDef } from '../combat/command/types'

export interface ShipDef extends ShipCommandDef {
  rangeEwBonus?: number
  rangeEwEquipmentBonusPct?: number
  droneLaunchCutPct?: number
  id: string
  name: string
  tier: number
  role: ShipRole
  civilianFittingOnly?: boolean
  subClass?: ShipSubClass
  cargoM3: number
  cycleSeconds: number
  oreUnitsPerCycle: number
  priceIsk: number
  agility: number
  powerBonus?: number
  weaponFamilyBonus?: Partial<Record<DamageType, number>>
  droneDmgBonus?: number
  shieldHp?: number
  armorHp?: number
  hullHp?: number
  shieldResist?: DamageResists
  armorResist?: DamageResists
  hullResist?: DamageResists
  cpu?: number
  slots?: ShipSlots
  plugSlots?: number
  droneBayM3?: number
  maxSpeedMps?: number
  warpSpeedAus?: number
  massKg?: number
  lockRangeM?: number
  signatureM?: number
  scanResMm?: number
  evasion?: number
  hitBonus?: number
  weaponRangeBonusPct?: Partial<Record<DamageType, number>>
  fleetDamageBonusPct?: number
  wormholeScanRadiusBonus?: number
  repairOutputBonusPct?: number
  repairPulseTargetsFleet?: boolean
  stealthCpuMul?: number
  stealthIgnoresPropulsion?: boolean
  foeRangeDebuffPct?: number
  interceptorImmuneToWeb?: boolean
  description: string
  unreleased?: boolean
}
