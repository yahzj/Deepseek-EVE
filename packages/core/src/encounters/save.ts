import type { AnomalyDef } from '../types'
import type { PirateEncounterSnapshot } from './riskTypes'

function finiteTree(value: unknown, depth = 0): boolean {
  if (depth > 30) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 512 && value.every(row => finiteTree(row, depth + 1))
  if (value && typeof value === 'object') return Object.keys(value).length <= 256 && Object.values(value).every(row => finiteTree(row, depth + 1))
  return value === null || ['string', 'boolean', 'undefined'].includes(typeof value)
}

/** 仅恢复有固定规格的普通海盗快照；未知或损坏配置不能退回随机抽卡。 */
export function cleanPirateCard(raw: unknown): AnomalyDef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const card = raw as AnomalyDef
  const generation = card.pirateGeneration
  if (generation && (generation.version !== 2 || !Number.isFinite(generation.statMultiplier) || generation.statMultiplier < 1 || generation.statMultiplier > 2)) return undefined
  const multiplier = generation?.statMultiplier ?? 1
  const maxWaves = generation ? 3 : 1
  if (card.id !== 'enc-pirate-generated' || card.foeFamily !== 'A' || !Number.isSafeInteger(card.threat) || card.threat < 1 || !Array.isArray(card.ships) || !card.ships.length || card.ships.length > 12 * maxWaves) return undefined
  if (!finiteTree(raw) || JSON.stringify(raw).length > 750_000) return undefined
  const formation = card.foeFormation
  if (!formation || formation.units?.length !== card.ships.length || formation.layout?.length !== card.ships.length) return undefined
  if (!Array.isArray(card.waves) || !card.waves.length || card.waves.length > maxWaves) return undefined
  for (let wave = 0; wave < card.waves.length; wave++) {
    const count = card.ships.filter(slot => slot && (slot.wave ?? 0) === wave).length
    if (!count || count > 12 || card.waves[wave]?.units !== count || card.waves[wave]?.hpShare !== 1) return undefined
  }
  for (let i = 0; i < card.ships.length; i++) {
    const slot = card.ships[i], layout = formation.layout[i], fixed = formation.units[i]
    if (!slot || !layout || !fixed) return undefined
    const wave = slot.wave ?? 0
    if (!slot.ship || slot.ship.family !== 'A' || slot.ship.hullClassTier === 5 || slot.ship.id !== layout.ship?.id || slot.count !== 1 || !Number.isSafeInteger(wave) || wave < 0 || wave >= card.waves.length || (layout.wave ?? 0) !== wave || fixed.hpMul !== multiplier || fixed.dmgMul !== multiplier || (slot.hpMul ?? 1) !== multiplier || (slot.dmgMul ?? 1) !== multiplier) return undefined
    for (const spec of [fixed.spec, fixed.rawSpec]) {
      if (!spec?.hp || !['s', 'a', 'h'].every(key => typeof spec.hp[key as 's'] === 'number' && spec.hp[key as 's'] >= 0) || !Array.isArray(spec.weapons) || !spec.weapons.length || spec.weapons.some(w => !(w.reloadMs > 0))) return undefined
      if (spec.foeShipId !== slot.ship.id || spec.foeSummonEscort || spec.foeReviveEscort || spec.foeSupportCall || spec.foeHatchery) return undefined
    }
  }
  const copy = structuredClone(card)
  copy.foeFormation = { ...copy.foeFormation!, layout: copy.ships! }
  return copy
}

export function cleanPirateEncounter(raw: unknown): PirateEncounterSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as PirateEncounterSnapshot
  const card = cleanPirateCard(value.card)
  if (!card || value.version !== 1 || !Number.isSafeInteger(value.seed) || !Number.isSafeInteger(value.targetThreat) || value.targetThreat < card.threat || value.realizedThreat !== card.threat || !['mining', 'hauling'].includes(value.activity)) return undefined
  const fleet = value.fleet
  if (!fleet || !Array.isArray(fleet.shipIds) || !fleet.shipIds.length || fleet.shipIds.length > 64 || new Set(fleet.shipIds).size !== fleet.shipIds.length || fleet.shipIds.some(id => typeof id !== 'string' || !id.length || id.length > 128)) return undefined
  if (![fleet.industrialMassKg, fleet.combatMassKg, fleet.cargoM3].every(n => Number.isFinite(n) && n >= 0)) return undefined
  return { version: 1, seed: value.seed, targetThreat: value.targetThreat, realizedThreat: value.realizedThreat, activity: value.activity, fleet: structuredClone(fleet), card }
}
