import type { PlanetCatalog, PlanetState } from './planetTypes'
import { PLANET_RULES, planetEnvironmentOf, planetRulesSupported } from './planetRules'
import { planetSurveyView } from './planetSurvey'

export function planetNeighborIndices(size: number, index: number): number[] {
  if (![4, 5, 6].includes(size) || !Number.isSafeInteger(index) || index < 0 || index >= size * size) return []
  const out: number[] = []
  if (index >= size) out.push(index - size)
  if (index % size > 0) out.push(index - 1)
  if (index % size < size - 1) out.push(index + 1)
  if (index < size * (size - 1)) out.push(index + size)
  return out
}

export type PlanetConstructionCheck = { ok: true } | { ok: false; reason: 'unsupported' | 'survey-required' | 'invalid-cell' | 'unknown-building' | 'obstacle' | 'occupied' | 'unique' | 'resource-required' | 'trait-required' }

export function planetConstructionCheck(planet: PlanetState, index: number, buildingId: string, catalog: PlanetCatalog): PlanetConstructionCheck {
  if (!planetRulesSupported(planet, catalog)) return { ok: false, reason: 'unsupported' }
  if (planet.survey < 2) return { ok: false, reason: 'survey-required' }
  if (!Number.isSafeInteger(index) || index < 0 || index >= planet.size ** 2 || planet.cells[index]?.index !== index) return { ok: false, reason: 'invalid-cell' }
  const def = catalog.buildings.get(buildingId)
  if (!def) return { ok: false, reason: 'unknown-building' }
  const cell = planet.cells[index]!
  if (cell.obstacle) return { ok: false, reason: 'obstacle' }
  if (cell.building) return { ok: false, reason: 'occupied' }
  if (def.unique && planet.cells.some(c => c.building?.id === buildingId)) return { ok: false, reason: 'unique' }
  if (def.requiredResource && cell.deposit?.resource !== def.requiredResource) return { ok: false, reason: 'resource-required' }
  if (def.requiredTraitId && !planetSurveyView(planet, catalog)!.traitIds.includes(def.requiredTraitId)) return { ok: false, reason: 'trait-required' }
  return { ok: true }
}

export function planetClearanceCheck(planet: PlanetState, index: number, catalog: PlanetCatalog): { ok: boolean } {
  return { ok: planetRulesSupported(planet, catalog) && planet.survey >= 2
    && Number.isSafeInteger(index) && index >= 0 && index < planet.size ** 2
    && planet.cells[index]?.obstacle !== undefined && planet.cells[index]?.building === undefined }
}

export function planetBuildingOperational(planet: PlanetState, index: number, catalog: PlanetCatalog): boolean {
  if (!planetRulesSupported(planet, catalog) || !Number.isSafeInteger(index) || index < 0 || index >= planet.size ** 2) return false
  const cell = planet.cells[index]
  const building = cell?.building
  const def = building ? catalog.buildings.get(building.id) : undefined
  return !!building && !!def && !cell?.obstacle && building.status === 'ready' && building.powered
    && building.enabled !== false && (building.condition ?? 1) > 0
    && (def.worker === 'automatic' || building.staffed)
    && (!def.requiredResource || cell.deposit?.resource === def.requiredResource)
    && (!def.requiredTraitId || (planet.survey >= 2 && planetSurveyView(planet, catalog)?.traitIds.includes(def.requiredTraitId) === true))
}

export function planetAdjacencyOf(planet: PlanetState, index: number, catalog: PlanetCatalog): { outputAdd: number; wearCut: number; sourceIndices: number[] } {
  const result = { outputAdd: 0, wearCut: 0, sourceIndices: [] as number[] }
  if (!planetRulesSupported(planet, catalog) || !planetBuildingOperational(planet, index, catalog)) return result
  const target = catalog.buildings.get(planet.cells[index]!.building!.id)!
  for (const neighbor of planetNeighborIndices(planet.size, index)) {
    if (!planetBuildingOperational(planet, neighbor, catalog)) continue
    const source = catalog.buildings.get(planet.cells[neighbor]!.building!.id)!
    // 同一来源对一个目标最多一次；重复配置不放大支援。
    const rules = source.adjacency?.filter(a => a.target === target.kind) ?? []
    const output = Math.max(0, ...rules.map(a => a.outputAdd ?? 0))
    const wear = target.kind === 'maintenance' ? 0 : Math.max(0, ...rules.map(a => a.wearCut ?? 0))
    if (output === 0 && wear === 0) continue
    result.outputAdd += output
    result.wearCut = Math.max(result.wearCut, wear)
    result.sourceIndices.push(neighbor)
  }
  result.outputAdd = Math.min(PLANET_RULES.adjacencyMax, result.outputAdd)
  result.wearCut = Math.min(1, result.wearCut)
  return result
}

/** 只读能力倍率，不生产资源，不从仓库扣材料。 */
export function planetBuildingOutputMul(planet: PlanetState, index: number, catalog: PlanetCatalog): number {
  if (!planetRulesSupported(planet, catalog) || !planetBuildingOperational(planet, index, catalog)) return 0
  const environment = planetEnvironmentOf(planet, catalog)
  if (!environment) return 0
  const cell = planet.cells[index]!
  const def = catalog.buildings.get(cell.building!.id)!
  const depositAdd = def.usesResource && cell.deposit?.resource === def.usesResource ? cell.deposit.bonus : 0
  return (1 + depositAdd + planetAdjacencyOf(planet, index, catalog).outputAdd)
    * (def.worker === 'human' ? environment.humanWorkMul : 1)
}
