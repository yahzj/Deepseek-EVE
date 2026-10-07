import type { GameState } from './state'
import type { PlanetCatalog, PlanetState, PlanetSurveyLevel, PlanetSurveyView } from './planetTypes'
import { generatePlanet } from './planetGeneration'
import { PLANET_RULES, planetEnvironmentFactors, planetRulesSupported } from './planetRules'

export type PlanetCommandResult = { ok: true } | { ok: false; reason: 'unknown-planet' | 'unknown-galaxy' | 'limit' | 'not-discovered' | 'unsupported' | 'invalid-survey' }

/** 仅供显式调用；不在新档、读取存档或引擎推进中自动创建。 */
export function discoverPlanet(state: GameState, catalog: PlanetCatalog, id: string): PlanetCommandResult {
  const def = catalog.planets.get(id)
  if (!def) return { ok: false, reason: 'unknown-planet' }
  if (!state.exploredGalaxies.includes(def.galaxyId)) return { ok: false, reason: 'unknown-galaxy' }
  if (Object.hasOwn(state.planetary?.planets ?? {}, id)) return { ok: true }
  if (Object.keys(state.planetary?.planets ?? {}).length >= PLANET_RULES.maxPlanets) return { ok: false, reason: 'limit' }
  const planet = generatePlanet(def, state.rng.seed, catalog)
  state.planetary ??= { planets: {} }
  state.planetary.planets[id] = planet
  return { ok: true }
}

export function surveyPlanet(state: GameState, catalog: PlanetCatalog, id: string, level: PlanetSurveyLevel): PlanetCommandResult {
  if (level !== 1 && level !== 2 && level !== 3) return { ok: false, reason: 'invalid-survey' }
  const planet = state.planetary?.planets[id]
  if (!planet) return { ok: false, reason: 'not-discovered' }
  if (!planetRulesSupported(planet, catalog)) return { ok: false, reason: 'unsupported' }
  planet.survey = Math.max(planet.survey, level) as PlanetSurveyLevel
  return { ok: true }
}

function revealed(id: string, planet: PlanetState, catalog: PlanetCatalog): boolean {
  const trait = catalog.traits.get(id)!
  if (planet.survey === 1) return trait.kind === 'environment' && id !== planet.hiddenTraitId
  // 生存、成本及资源条件必须在建设前明确，专项只保留非生存特殊信息。
  return planet.survey === 3 || id !== planet.hiddenTraitId || trait.kind !== 'special'
    || (trait.hazard ?? 0) !== 0 || (trait.habitability ?? 0) !== 0 || trait.deposit !== undefined
}

export function planetSurveyView(planet: PlanetState, catalog: PlanetCatalog): PlanetSurveyView | undefined {
  if (!planetRulesSupported(planet, catalog)) return undefined
  const ids = planet.traitIds.filter(id => revealed(id, planet, catalog))
  const known = new Set(ids)
  const unknown = planet.traitIds.length - ids.length
  const range = (field: 'hazard' | 'habitability', base: number): { min: number; max: number } => {
    const value = base + ids.reduce((sum, id) => sum + (catalog.traits.get(id)![field] ?? 0), 0)
    if (planet.survey >= 2) {
      const exact = planetEnvironmentFactors(field === 'hazard' ? value : 0, field === 'habitability' ? value : 0)[field]
      return { min: exact, max: exact }
    }
    // 估计只取公开目录可能的修正，不偷读未揭示条目实际值。
    const candidates = [...catalog.traits.values()].filter(t => !known.has(t.id)).map(t => t[field] ?? 0)
    const lo = candidates.filter(n => n < 0).sort((a, b) => a - b).slice(0, unknown).reduce((a, b) => a + b, 0)
    const hi = candidates.filter(n => n > 0).sort((a, b) => b - a).slice(0, unknown).reduce((a, b) => a + b, 0)
    const clamp = (v: number): number => Math.max(0, Math.min(100, v))
    return { min: clamp(value + lo), max: clamp(value + hi) }
  }
  return {
    id: planet.id, galaxyId: planet.galaxyId, size: planet.size, survey: planet.survey,
    traitIds: [...ids], unknownTraits: unknown,
    hazard: range('hazard', PLANET_RULES.baseHazard),
    habitability: range('habitability', PLANET_RULES.baseHabitability),
    ...(planet.survey >= 2 ? { cells: planet.cells.map(cell => ({
      ...cell, ...(cell.deposit ? { deposit: { ...cell.deposit } } : {}),
      ...(cell.building ? { building: { ...cell.building } } : {}),
    })) } : {}),
  }
}
