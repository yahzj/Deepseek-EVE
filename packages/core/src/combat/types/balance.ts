import type { FoeTactic, FoeFamily, DamageType } from './damage'

export interface BattleBalance {
  hitMin: number
  hitMax: number
  shieldRegenPerSec: number
  waveReopenFrac: number
  waveReopenEnabled: boolean
  waveEnterGapMs: number
  foeBlinkProcessMs: number
  foeBlinkGapMs: number
  gunneryDmgPerLevel: number
  familySkillIds: Record<'turret' | 'missile' | 'laser', string>
  familySkillPerLevel: number
  cpuSkillId: string
  cpuPerLevel: number
  speedSkillId: string
  speedPerLevel: number
  evasionSkillId: string
  evasionPerLevel: number
  hitSkillId: string
  hitPerLevel: number
  minDistanceM: number
  openRangeFactor: number
  openRangePadM: number
  openRangePadShare: number
  desireBandMid: number
  wormholeBrawlOpenBand: number
  speedFactor: number
  agilitySpeedBonus: number
  foeHpCurveDMin: number
  foeHpCurveDSpan: number
  foeHpCurveExp: number
  foeHpCurveFloorThreat: number
  foeHpCurveSpanThreat: number
  foeRefFire: ReadonlyArray<{ upToThreat: number; dps: number }>
  foeDpsPerThreat: number
  foeDpsCap?: number
  foeDpsOverCapDiscount?: number
  foeHitRate: number
  foeHitCompMul: number
  foeReloadMs: number
  foeFalloff: number
  hullClassBaseSpeedMps: Record<1 | 2 | 3 | 4 | 5, number>
  foeRefSpeedTable: ReadonlyArray<{ upToThreat: number; maxSpeedMps: number }>
  foeSpeedAtThreat10: number
  foeSpeedAtThreat100: number
  foeSpeedTacticMul: Record<FoeTactic, number>
  foeSpeedCapMul: number
  foeRangeGrowMul: Record<FoeTactic, number>
  foeRangeCapM: number
  tacticDesireFactor: Record<FoeTactic, number>
  ammoTimeCapMs: number
  ammoMargin: number
  maxBattleMs: number;
  cannotEngageMs: number;
  thrusterBoostMs: number
  thrusterCooldownMs: number
  foeChargeEnabled: boolean
  foeChargeMul: number
  foeChargeTriggerMarginM: number
  foeChargeMaxHoldMs: number
  foeChargeCooldownMs: number
  foeChargeThreatFloor: number
  foeReinforceEnabled: boolean
  foeReinforceReopenFrac: number
  foeReviveEnabled: boolean
  winSpread: number
  aiFavorStrength: number
  killcamMs: number
  winPenaltyArmorPerFull: number
  winPenaltyHullPerFull: number
  pdThreatFloor: number
  pdJudgementMs: number
  pdAcc: number
  pdHitFloor: number
  pdTierMul: readonly number[]
  pdDmg: number
  pdFamilyOverride?: Partial<
    Record<FoeFamily, { dmgMul?: number; accAdd?: number; dmgType?: DamageType; autoHit?: boolean }>
  >
}
