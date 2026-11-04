import type { AnomalyDef } from '../types'

export type IndustrialActivity = 'mining' | 'hauling'

export interface IndustrialThreatProfile {
  baseThreatScale: number
  baseThreatOffset: number
  industrialFreeMassKg: number
  industrialMassScaleKg: number
  industrialThreatWeight: number
  cargoVolumeScaleM3: number
  cargoThreatWeight: number
  minimumThreat: number
}

export interface IndustrialFrequencyConfig {
  industrialFreeMassKg: number
  industrialMassScaleKg: number
  industrialChanceMaxBonus: number
  industrialChanceHalfPoint: number
  escortChanceMaxReduction: number
  escortMassHalfPointKg: number
  maximumChance: number
}

export interface PirateFormationConfig {
  version: number
  maxShips: number
  maxWaves: number
  maxStatMultiplier: number
  designStrengthMul: number
  specialShipLimits: { minThreat: number; maxCount: number }[]
  pool: { shipId: string; weight: number; special?: boolean; mounts?: string[] }[]
}

export interface IndustrialEncounterConfig {
  version: number
  threat: { profiles: Record<IndustrialActivity, IndustrialThreatProfile> }
  frequency: IndustrialFrequencyConfig
  formation: PirateFormationConfig
  postBattleProtectionMs: number
  entryProtectionRestoreDockMs: number
}

export interface IndustrialFleetSnapshot {
  shipIds: string[]
  industrialMassKg: number
  combatMassKg: number
  cargoM3: number
}

export interface IndustrialThreatView {
  targetThreat: number
  baseThreat: number
  industrialThreat: number
  cargoThreat: number
}

export interface PirateEncounterSnapshot {
  version: number
  seed: number
  targetThreat: number
  realizedThreat: number
  fleet: IndustrialFleetSnapshot
  activity: IndustrialActivity
  card: AnomalyDef
}
