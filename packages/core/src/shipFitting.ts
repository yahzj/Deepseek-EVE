import type { ModuleDef, ShipDef } from './types'

const DRONE_SLOTS = new Set<ModuleDef['slot']>(['drone-rack', 'drone-tac', 'drone-relay', 'drone-deck', 'drone-shield'])
const COMBAT_FIELDS: readonly (keyof ModuleDef)[] = [
  'droneBayBonusM3', 'droneDmgBonus', 'droneRangeBonusPct', 'droneHullHpBonusPct',
  'droneShieldHpBonusPct', 'droneHitGapPct', 'droneReviveCycleMs', 'droneCycleCutPct',
  'captureWebCycleMs', 'captureWebRangeM', 'foeRangeDebuffPct', 'rangeEwStrength', 'lockDmgBonus',
  'shieldFieldPct', 'shieldFieldMs', 'secondaryDamagePct', 'hitsAllFoes', 'overlayDrive', 'burst',
  'droneLaunchCutPct', 'laserFalloffBonus',
  'crisisOverload', 'railCharge',
]

export function moduleAllowedOnShip(ship: ShipDef | undefined, mod: ModuleDef): boolean {
  if (ship?.civilianFittingOnly !== true) return true
  if (DRONE_SLOTS.has(mod.slot) || mod.slot === 'target-lock') return false
  const work = mod.slot === 'miner' || mod.slot === 'salvager' || mod.salvageCycleMs !== undefined
  if (!work && (mod.slot === 'turret' || mod.slot === 'missile' || mod.slot === 'laser')) return false
  if (mod.reloadMs !== undefined || mod.dmgMult !== undefined || mod.antiDrone !== undefined) return false
  if (COMBAT_FIELDS.some((field) => mod[field] !== undefined)) return false
  if (mod.slot !== 'plug' && (
    mod.damageBonusPct !== undefined || mod.damageTypeBonusPct !== undefined ||
    mod.reloadCutPct !== undefined || mod.hitBonusPct !== undefined || mod.rangeTypeBonusPct !== undefined
  )) return false
  return true
}

export const LEGACY_HAULER_STATS: Readonly<Record<string, Partial<ShipDef>>> = {
  'sh-flyingfish': { slots: { high: 1, mid: 2, low: 2 }, cpu: 105, shieldHp: 52, armorHp: 66, hullHp: 189, droneBayM3: 40 },
  'sh-sailfish': { slots: { high: 1, mid: 3, low: 3 }, cpu: 135, shieldHp: 88, armorHp: 119, hullHp: 333, droneBayM3: 50 },
  'sh-swordfish': { slots: { high: 2, mid: 2, low: 3 }, cpu: 175, shieldHp: 170, armorHp: 226, hullHp: 622, droneBayM3: 60 },
  'sh-bowhead': { slots: { high: 3, mid: 2, low: 3 }, cpu: 160, shieldHp: 111, armorHp: 343, hullHp: 564, droneBayM3: 0 },
}
