import type { BattleUnitRt, BattleFx, BattleWebDebuff, BattleFoeWebDebuff, BattleRepairLedger, BattleShieldChargeLedger, BattleShieldFieldLedger, DronePoolEntry } from './units'
import type { DamageType } from '../../types'
import type { BlinkSeg, LogParams } from '../../state'

export interface BattleState {
  enemyFormationVersion?: 1
  droneCommandVolumeM3?: number
  rangeMemory?: import('../../battleRangeMemory').BattleRangeSnapshot
  foeAcidLayers?: Record<string, Array<{ cutPct: number; untilMs: number }>>
  foeRebirths?: Record<string, { lockUntilMs: number; startedAtMs: number; repairUntilMs: number; lastRepairAtMs: number; armorHealed: number; hullHealed: number }>
  foeCoatingLayers?: Record<string, Array<{ untilMs: number }>>
  foeShieldCapacitorActive?: Record<string, true>
  foeShieldCapacitorAttacks?: Record<string, number>
  alienCorrosion?: number
  acidBursts?: Record<string, { cause: 'attack' | 'killed'; atMs: number; resolved?: boolean }>
  foeHatcheries?: Record<string, { left: number | 'unlimited'; revived: number; queue: Array<number | { tag: string; index: number }>; nextAtMs?: number }>
  foeAbilityClocks?: Record<string, number>
  startedAtGameMs: number
  lastTickGameMs: number
  distanceM: number
  myDesireM: number
  units: Record<string, BattleUnitRt>
  ammo: { kin: number; exp: number; pla: number }
  ammoCreditByWeapon?: Record<string, number>
  ammoLoaded?: { kin: number; exp: number; pla: number }
  ammoIds?: Partial<Record<DamageType, string>>
  repairDroneBy?: Record<string, import('./units').BattleRepairDroneLedger>
  expeditionAmmo?: {
    stock: Record<string, number>
    loaded: Record<string, number>
    idsByTag: Record<string, Partial<Record<DamageType, string>>>
    revivesSettled?: boolean
  }
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  fx: BattleFx[]
  fxSeq: number
  ended: 'me' | 'foe' | null
  hullEscapeFrac?: number
  waveIdx?: number
  foeOverride?: {
    generatedCard?: import('../../types').AnomalyDef
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
  bossDownAtMs?: number
  waveClearAt?: number
  foeWaveStartMs?: number
  foeBurstFired?: Record<string, number>
  foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  speedX?: number
  speedAxis?: { anchor: number; clock: number }
  autoEscaped?: boolean;
  escapeReason?: 'hull' | 'timeout' | 'cannot-engage';
  myFleet?: Array<{ tag: string; shipId: string }>
  wormhole?: {
    cardId: string
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    desireRangeMul?: number
    threatMul?: number
    foeMainType?: DamageType
    foeHitDown?: number
    blindReduce?: number
    volleyOverflow?: boolean
  }
  meWebDebuffs?: Record<string, BattleWebDebuff>;
  foeWebFired?: Record<string, true>;
  foeWebDebuffs?: Record<string, BattleFoeWebDebuff>;
  myWebs?: Record<string, { targetTag?: string; cooldownUntilMs: number }>
  meSpeedMps?: number;
  foeSpeedMps?: number;
  foeMounts?: string[];
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>;
  foeCharges?: Record<string, { on?: boolean; cdUntilMs?: number }>;
  foeBlinks?: Record<string, number>;
  foeBlinkJumps?: Record<string, { from: number; moved: number; dir: -1 | 0 | 1 }>;
  foeOverlayReload?: Record<string, { r: number; f: number; bs: number }>;
  foeBlinkQueue?: Record<string, BlinkSeg>;
  meBlinkQueue?: Record<string, BlinkSeg>;
  meVolleyDmg?: Record<string, number>;
  meVolleyWindow?: number
  meOverlayReload?: Record<string, { r: number; f: number }>;
  meBurstFired?: Record<string, number>;
  meBlinks?: Record<string, number>;
  dc?: Record<string, { lockUntilMs?: number; used?: boolean }>;
  meRebirths?: Record<string, { repairUntilMs: number; lastRepairAtMs: number; armorHealed: number; hullHealed: number }>
  meCrisisActive?: Record<string, true>
  meRailStacks?: Record<string, number>
  dcKitsUsed?: number;
  foeChargeEnteredAtMs?: number;
  repair?: BattleRepairLedger
  repairBy?: Record<string, BattleRepairLedger>
  shieldCharge?: BattleShieldChargeLedger
  shieldChargeBy?: Record<string, BattleShieldChargeLedger>
  shieldFieldBy?: Record<string, BattleShieldFieldLedger>
  foeRepair?: { nextPulseAtMs?: number; pulses: number; healed: number }
  foeRepairPulses?: Record<string, { nextPulseAtMs?: number; pulses: number; healed: number }>
  foeReviveAtMs?: number
  foeReviveCount?: number
  foeSummonAtMs?: Record<string, number>
  foeFocusArrays?: Record<string, NonNullable<import('../../types').FoeMountDef['focusArray']>>
  dronePools?: Record<string, DronePoolEntry>;
  droneLaunchBy?: Record<string, { q: string[]; nextAtMs: number; gapMs: number; reviveGapMs?: number }>
  foeDronePools?: Record<string, DronePoolEntry[]>;
  droneHitAt?: { me?: number; foe?: number };
  droneHitAtMeBy?: Record<string, number>;
  foeDroneRangeBuff?: number;
  foeGunRangeBuff?: number;
  meFoeRangeDebuff?: number;
  rangeEwVersion?: 1
  rangeEw?: import('../rangeEw').RangeEwContest
  notices?: Array<{ atMs: number; text: string; textId?: string; textParams?: LogParams }>;
  droneLost?: Record<string, number>
  droneLostBy?: Record<string, Record<string, number>>
  droneRevive?: Record<
    string,
    { q: string[]; t: Array<number | undefined>; c: number[]; v: Record<string, number>; shipId: string; printing?: boolean }
  >
  droneReviveStock?: Record<string, number>
  pdCd?: number[]
  pdFocus?: Array<string | undefined>
  mePdFocus?: Array<{ tag: string; idx: number } | undefined>
  mePdFocusBy?: Record<string, { tag: string; idx: number }>
  mePdAnsweredBy?: Record<string, number>
  droneLoadAtStart?: Record<string, number>
  droneLoadAtStartBy?: Record<string, Record<string, number>>
}
