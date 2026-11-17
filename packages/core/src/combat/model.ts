import type { DamageType, FoeFamily, ShipRole, DamageResists, FoeReinforceTrigger, FoeSupportBranch, FoeDroneSlot, FoeTactic } from '../types'
import type { Hp3 } from './combatMath'

export interface BattleSimulationOptions {
  distanceM: number
  layer: 's' | 'a' | 'h'
  onShot?: (shot: { index: number; weapon: WeaponSpec; hit: boolean; damage: number }) => void
}

export type WeaponSrc = 'turret' | 'missile' | 'laser' | 'drone' | 'base'

export interface WeaponSpec {
  acidOnHit?: import('../types').ModuleDef['acidOnHit']
  foeDroneRangeBonusPct?: number
  moduleId?: string
  repairDrone?: { armor: number; hull: number; kitId: string }
  label: string
  kind: 'gun' | 'beam' | 'fixed'
  src?: WeaponSrc
  artId?: string
  reserve?: boolean
  fixedType?: DamageType
  shotDmg?: number
  shotsByType?: Partial<Record<DamageType, number>>
  overlayDrive?: { stepMs: number; floorMs: number }
  railCharge?: import('../types').ModuleDef['railCharge']
  burst?: { shots: number; gapMs: number }
  count?: number
  gunCount?: number
  allFoes?: boolean
  secondaryDamagePct?: number
  secondaryDamageType?: DamageType
  ammoPerShot?: number
  eqHitMul?: number
  blindDmgMul?: number;
  disabled?: boolean
  canHitDrones?: boolean
  antiDroneMul?: number
  maxRangeM: number
  minRangeM: number
  hitRate: number
  falloff: number
  reloadMs: number
}

export interface UnitSpec {
  foeFormationAdded?: boolean
  shieldArmorHp?: number
  repairCapacityMul?: { a: number; h: number }
  shieldPassiveBonusPct?: number
  armorRegenPerSec?: number
  droneDamageBonusPct?: number
  droneCommand?: { sharePct: number; targetWeightPerM3: number }
  shieldRegenMax?: number
  shieldRegenCap?: number
  droneHpMul?: number
  rebirthRepair?: import('../types').ModuleDef['rebirthRepair']
  crisisOverload?: { rangeMul: number; damageMul: number; speedMul: number; droneInitialMul: number; droneCycleMul: number }
  speedBonusModules?: Array<Pick<import('../types').ModuleDef, 'slot' | 'speedBonusPct' | 'speedRamp'>>
  droneLaunchGapMs?: number
  droneReviveGapMs?: number
  acidBurst?: import('../types').FoeShipDef['acidBurst'] & { shieldDamageMul?: number }
  foeHatchery?: import('../types').FoeMountDef['hatchery']
  foeFleetSpeedRamp?: import('../types').FoeMountDef['fleetSpeedRamp']
  corrosionAppliedPct?: number
  tag: string
  name: string
  hullClassTier?: number
  family?: FoeFamily
  shipTier?: number
  shipRole?: ShipRole
  shipId?: string
  targetWeightMul?: number
  hullSaveKit?: string
  repairOutputBonusPct?: number
  logistics?: boolean
  repairPct?: number
  side: 'me' | 'foe'
  hp: Hp3
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
  droneHullBonusPct?: number
  droneShieldBonusPct?: number
  droneHitGapPct?: number
  evasion: number
  hitBonus: number
  hitMul?: number
  signatureM: number
  scanResMm: number
  speedMps: number
  agility: number
  weapons: WeaponSpec[]
  thrusterBoost?: number
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
  lockedDmgBonus?: number;
  lockTargetChance?: number
  lockOwnDmgBonus?: number
  lockOwnTargetChance?: number
  stealthMs?: number;
  foeCanCharge?: boolean;
  foeChargeMul?: number;
  foeChargeCooldownMs?: number;
  foeBlink?: { distanceM: number; cooldownMs: number };
  foeOverlayDrive?: { stepMs: number; floorMs: number; dmgMul: number };
  foeFlashOverload?: { healShield: true; hullCostPct: number };
  foeStandbyShield?: import('../types').FoeMountDef['standbyShield'];
  foeFocusArray?: { rampMs: number; rangeBonusPct?: number; antiDroneBonusPct?: number };
  foeRebirthProtocol?: import('../types').FoeMountDef['rebirthProtocol'];
  foeMausoleumArmor?: import('../types').FoeMountDef['mausoleumArmor'];
  foeCoatingArmor?: import('../types').FoeMountDef['coatingArmor'];
  foeShieldCapacitor?: import('../types').FoeMountDef['shieldCapacitor'];
  foeChargeWebImmune?: true;
  interceptorImmuneToWeb?: boolean;
  meBlink?: { distanceM: number; cooldownMs: number }
  foeMountNames?: readonly string[]
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  foeReinforceAt?: FoeReinforceTrigger
  foeReinforceBranch?: FoeSupportBranch
  foeSupportCall?: { delaySec: number; threatMul: number }
  foeRangeBand?: { min: number; max: number };
  foeDesireRangeM?: number;
  foeDrones?: readonly FoeDroneSlot[]
  foeDroneRangeMulOnHit?: number
  foeGunRangeMulOnHit?: number
  foeGunRangeNoticeId?: string
  foeCaptureWeb?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  myCaptureWeb?: { cycleMs: number; rangeM: number; breakM: number; slowMul: number }
  foeDroneLaunch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean }
  foeDroneReserve?: { count: number; respawnMs: number }
  foeRangeDebuffPct?: number
  rangeEwStrength?: number
  rangeEwBonus?: number
  rangeEwEquipmentBonusPct?: number
  foeEvasionBonusAdd?: number
  foeRepairPulse?: { everyMs: number; armor: number; hull: number; k: number }
  foePointDefenseEnabled?: boolean
  foeReviveEscort?: import('../types').FoeMountDef['reviveEscort']
  foeSummonEscort?: import('../types').FoeMountDef['summonEscort']
  foeSummonTemplate?: UnitSpec
  foeTactic: FoeTactic | null
  foeShipId?: string
}

export interface FoeOverride {
  generatedCard?: import('../types').AnomalyDef
  patrolFormation?: true
  threat?: number
  waves?: ReadonlyArray<{ units: number; hpShare: number }>
  keepCardWaves?: boolean
  strengthMul?: number
  bossHp?: number
  bossHpMax?: number
  bossHpLayers?: { s: number; a: number; h: number }
  bossMaxLayers?: { s: number; a: number; h: number }
  bossShipId?: string
}
