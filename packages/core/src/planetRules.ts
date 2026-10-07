import type { PlanetCatalog, PlanetEnvironment, PlanetState, PlanetTraitDef } from './planetTypes'

export const PLANET_GENERATION_VERSION = 1
export const PLANET_RULES = {
  baseHazard: 30, baseHabitability: 60,
  wearPerHazard: 0.01, constructionPerHazard: 0.008, repairPerHazard: 0.012,
  consumptionPerMissingHabitability: 0.01, humanWorkBase: 0.4, humanWorkPerHabitability: 0.006,
  adjacencyMax: 0.6, obstacleMinShare: 0.2, obstacleMaxShare: 0.35, minFreeCells: 6,
  maxPlanets: 64,
} as const

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

export function planetEnvironmentFactors(hazard: number, habitability: number): PlanetEnvironment {
  const d = bounded(hazard)
  const h = bounded(habitability)
  return {
    hazard: d, habitability: h,
    wearMul: 1 + d * PLANET_RULES.wearPerHazard,
    constructionMul: 1 + d * PLANET_RULES.constructionPerHazard,
    repairMul: 1 + d * PLANET_RULES.repairPerHazard,
    consumptionMul: 1 + (100 - h) * PLANET_RULES.consumptionPerMissingHabitability,
    humanWorkMul: PLANET_RULES.humanWorkBase + h * PLANET_RULES.humanWorkPerHabitability,
  }
}

export function planetTraitsCompatible(trait: PlanetTraitDef, selected: readonly PlanetTraitDef[]): boolean {
  return selected.every(other => other.id !== trait.id
    && !(trait.exclusiveGroup && trait.exclusiveGroup === other.exclusiveGroup)
    && !trait.conflicts?.includes(other.id) && !other.conflicts?.includes(trait.id))
}

export function planetEnvironmentOf(planet: Pick<PlanetState, 'traitIds'>, catalog: PlanetCatalog): PlanetEnvironment | undefined {
  let hazard: number = PLANET_RULES.baseHazard
  let habitability: number = PLANET_RULES.baseHabitability
  for (const id of new Set(planet.traitIds)) {
    const trait = catalog.traits.get(id)
    if (!trait) return undefined
    hazard += trait.hazard ?? 0
    habitability += trait.habitability ?? 0
  }
  return planetEnvironmentFactors(hazard, habitability)
}

/** 未知内容或未来生成规则不回落到另一个随机世界。 */
export function planetRulesSupported(planet: PlanetState, catalog: PlanetCatalog): boolean {
  return planet.generationVersion === PLANET_GENERATION_VERSION
    && [4, 5, 6].includes(planet.size)
    && [1, 2, 3].includes(planet.survey)
    && planet.cells.length === planet.size ** 2
    && planet.traitIds.includes(planet.hiddenTraitId)
    && new Set(planet.traitIds).size === planet.traitIds.length
    && planet.traitIds.every(id => catalog.traits.has(id))
    && planet.traitIds.every(id => planetTraitsCompatible(catalog.traits.get(id)!, planet.traitIds.filter(other => other !== id).map(other => catalog.traits.get(other)!)))
    && planet.cells.every((cell, index) => {
      if (cell.index !== index || (cell.building && !catalog.buildings.has(cell.building.id))) return false
      if (!cell.deposit) return true
      const source = catalog.traits.get(cell.deposit.sourceTraitId)?.deposit
      return planet.traitIds.includes(cell.deposit.sourceTraitId) && source?.resource === cell.deposit.resource
        && Number.isFinite(cell.deposit.bonus) && cell.deposit.bonus >= 0 && cell.deposit.bonus <= 1
    })
}
