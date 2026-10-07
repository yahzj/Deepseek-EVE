import type { PlanetCatalog, PlanetBuildingKind, PlanetObstacle, PlanetResource } from './planetTypes'
import { PLANET_RULES } from './planetRules'

const RESOURCES: readonly PlanetResource[] = ['metal', 'water', 'food', 'research', 'rare', 'energy']
const OBSTACLES: readonly PlanetObstacle[] = ['rough', 'ice', 'corrosion', 'rubble']
const KINDS: readonly PlanetBuildingKind[] = ['base', 'cryo', 'power', 'water', 'nutrition', 'housing', 'farm', 'mine', 'industry', 'research', 'maintenance', 'logistics']
const idValid = (id: string): boolean => typeof id === 'string' && /^[a-z][a-z0-9-]{0,127}$/.test(id) && !['constructor', 'prototype'].includes(id)
const finite = (n: unknown, min: number, max: number): boolean => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max

/** 核心生成入口与内容工具共用，拒绝不完整的注入目录。 */
export function planetCatalogIssues(catalog: PlanetCatalog): string[] {
  const issues: string[] = []
  if (catalog.planets.size > PLANET_RULES.maxPlanets) issues.push('planet-count')
  for (const [key, def] of catalog.planets) {
    if (key !== def.id || !idValid(key) || !idValid(def.galaxyId) || ![4, 5, 6].includes(def.size)) issues.push(`planet:${key}`)
  }
  for (const [key, trait] of catalog.traits) {
    if (key !== trait.id || !idValid(key) || !['environment', 'resource', 'special'].includes(trait.kind)
      || !finite(trait.weight, 0, 1000) || (trait.hazard !== undefined && !finite(trait.hazard, -100, 100))
      || (trait.habitability !== undefined && !finite(trait.habitability, -100, 100))) issues.push(`trait:${key}`)
    if (trait.exclusiveGroup !== undefined && !idValid(trait.exclusiveGroup)) issues.push(`exclusive:${key}`)
    if (trait.obstacle !== undefined && !OBSTACLES.includes(trait.obstacle)) issues.push(`obstacle:${key}`)
    for (const conflict of trait.conflicts ?? []) if (!catalog.traits.has(conflict) || conflict === key) issues.push(`conflict:${key}/${conflict}`)
    const d = trait.deposit
    if (d && (!RESOURCES.includes(d.resource) || !Number.isSafeInteger(d.minCells) || !Number.isSafeInteger(d.maxCells)
      || d.minCells < 1 || d.maxCells < d.minCells || d.maxCells > 2 || !finite(d.bonus, 0, 1))) issues.push(`deposit:${key}`)
  }
  for (const [key, def] of catalog.buildings) {
    if (key !== def.id || !idValid(key) || !KINDS.includes(def.kind) || !['automatic', 'human'].includes(def.worker)) issues.push(`building:${key}`)
    if (def.requiredTraitId && !catalog.traits.has(def.requiredTraitId)) issues.push(`building-trait:${key}`)
    for (const r of [def.requiredResource, def.usesResource]) if (r !== undefined && !RESOURCES.includes(r)) issues.push(`building-resource:${key}`)
    const targets = new Set<PlanetBuildingKind>()
    for (const rule of def.adjacency ?? []) {
      if (!KINDS.includes(rule.target) || targets.has(rule.target)
        || (rule.outputAdd !== undefined && !finite(rule.outputAdd, 0, 1))
        || (rule.wearCut !== undefined && !finite(rule.wearCut, 0, 1))) issues.push(`adjacency:${key}/${rule.target}`)
      targets.add(rule.target)
    }
  }
  for (const [key, op] of catalog.operations ?? []) {
    if (!catalog.buildings.has(key) || op.buildingId !== key || !finite(op.power, -1000, 1000)
      || !finite(op.priority, 0, 100) || !finite(op.bill.credits, 0, 1e12)
      || !finite(op.bill.durationMs, 1, 7 * 86400000)) issues.push(`operation:${key}`)
    for (const [id, count] of Object.entries(op.bill.items)) if (!idValid(id) || !Number.isSafeInteger(count) || count < 1) issues.push(`bill:${key}/${id}`)
    for (const rates of [op.inputs, op.output]) for (const [resource, rate] of Object.entries(rates ?? {})) {
      if (!['food', 'water', 'medicine', 'metal', 'parts', 'research', 'rare'].includes(resource) || !finite(rate, 0, 10000)) issues.push(`rate:${key}/${resource}`)
    }
  }
  for (const [key, project] of catalog.projects ?? []) {
    if (key !== project.id || !idValid(key) || !finite(project.requiredResearch, 0, 1e6)) issues.push(`project:${key}`)
    for (const id of [project.fromTraitId, project.toTraitId, project.removeTraitId]) if (id && !catalog.traits.has(id)) issues.push(`project-trait:${key}/${id}`)
    if (!finite(project.bill.durationMs, 1, 7 * 86400000) || !finite(project.bill.credits, 0, 1e12)) issues.push(`project-bill:${key}`)
    for (const [id, count] of Object.entries(project.bill.items)) if (!idValid(id) || !Number.isSafeInteger(count) || count < 1) issues.push(`project-item:${key}/${id}`)
  }
  return issues
}
