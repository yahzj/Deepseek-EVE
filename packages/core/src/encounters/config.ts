import type { IndustrialEncounterConfig, IndustrialThreatProfile } from './riskTypes'

const profile = (): IndustrialThreatProfile => ({
  baseThreatScale: 1,
  baseThreatOffset: 0,
  industrialFreeMassKg: 5_000_000,
  industrialMassScaleKg: 5_000_000,
  industrialThreatWeight: 10,
  cargoVolumeScaleM3: 10_000,
  cargoThreatWeight: 12,
  minimumThreat: 1,
})

/** 船长2026-11-01批准先实现后调参；kg、m³和威胁点分别标定。 */
export const INDUSTRIAL_ENCOUNTER_DEFAULTS: IndustrialEncounterConfig = {
  version: 1,
  threat: { profiles: { mining: profile(), hauling: profile() } },
  frequency: {
    industrialFreeMassKg: 5_000_000,
    industrialMassScaleKg: 5_000_000,
    industrialChanceMaxBonus: 0.25,
    industrialChanceHalfPoint: 4,
    escortChanceMaxReduction: 0.70,
    escortMassHalfPointKg: 20_000_000,
    maximumChance: 0.9,
  },
  formation: {
    version: 2,
    maxShips: 12,
    maxWaves: 3,
    maxStatMultiplier: 2,
    designStrengthMul: 3,
    specialShipLimits: [{ minThreat: 60, maxCount: 1 }, { minThreat: 100, maxCount: 2 }],
    pool: [
      { shipId: 'foe-pirate-skiff', weight: 4 },
      { shipId: 'foe-pirate-corvette', weight: 3 },
      { shipId: 'foe-pirate-sniper', weight: 2 },
      { shipId: 'foe-pirate-warlord', weight: 1 },
      { shipId: 'foe-pirate-raider', weight: 1, special: true, mounts: ['foe-mount-capture-web'] },
    ],
  },
  postBattleProtectionMs: 300_000,
  entryProtectionRestoreDockMs: 900_000,
}
