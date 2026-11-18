import type { FoeFamily, DamageType, FoeTactic, DamageResists, DroneClass, DroneDefense } from './damage'
import type { EnergyForm } from '../../types'
import type { FoeMountId, FoeSupportBranch } from './mounts'

export interface FoeShipDef {
  rangeEwBonus?: number
  rangeEwEquipmentBonusPct?: number
  acidBurst?: { attackRangeM: number; deathRangeM: number; corrosionPct: number; damage?: number; hitRate?: number }
  id: string
  name: string
  family: FoeFamily
  hullClassTier: 1 | 2 | 3 | 4 | 5
  speedRatio: number
  hp: number
  split: { s: number; a: number; h: number }
  shotDmg: number
  gunCount?: number
  hitRate: number
  reloadMs: number
  burst?: { shots: number; gapMs: number }
  rangeMinM: number
  rangeMaxM: number
  falloff: number
  blindDmgMul?: number
  dmgMix?: Partial<Record<DamageType, number>>
  energyForm?: EnergyForm
  tactic: FoeTactic
  repairPct?: number
  elite?: boolean;
  evasion?: number;
  foeRangeDebuffPct?: number
  foeCanCharge?: boolean;
  foeChargeMul?: number;
  mounts?: readonly FoeMountId[];
  desireRangeM?: number;
  drones?: readonly FoeDroneSlot[]
  droneRangeMulOnHit?: number
  gunRangeMulOnHit?: number
  droneFireShare?: number
  droneLaunch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean }
  droneReserve?: { count: number; respawnMs: number }
  shieldResist?: DamageResists
  armorResist?: DamageResists
  hullResist?: DamageResists
}

export interface FoeDroneDef {
  id: string;
  name: string;
  family: FoeFamily;
  role: DroneClass;
  defense: DroneDefense;
  dmg: number;
  damageType: DamageType;
  hitRate: number;
  falloff: number;
  maxRangeM: number;
  reloadMs: number
}

export interface FoeDroneSlot {
  drone: FoeDroneDef;
  count: number
}

export interface FoeShipSlot {
  ship: FoeShipDef;
  shieldResist?: DamageResists;
  hpOverride?: { s: number; a: number; h: number };
  shieldRegenMax?: number;
  shieldRegenCap?: number;
  desireRangeM?: number;
  droneFireShare?: number;
  firepowerAnchor?: number;
  count?: number
  mounts?: readonly FoeMountId[]
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  enterBranch?: FoeSupportBranch
  wave?: number
  escort?: boolean
  hpMul?: number
  dmgMul?: number
  speedMul?: number
  rangeMul?: number
  split?: { s: number; a: number; h: number }
  tactic?: FoeTactic
  rangeMinM?: number
  rangeMaxM?: number
  dmgMix?: Partial<Record<DamageType, number>>
  hitRate?: number
  falloff?: number
  energyForm?: EnergyForm
  enterAt?: FoeReinforceTrigger
}

export interface FoeReinforceTrigger {
  sec?: number
  afterKills?: number
  hpBelow?: number
}
