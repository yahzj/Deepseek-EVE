import type { PlanetDef, PlanetTraitDef, PlanetBuildingDef, PlanetCatalog, PlanetBuildingKind } from '@whale/core'

// ⟪未完成 2026-10-07⟫ 仅规则原型目录；不接星图或玩家入口，命名和文案在隐藏界面批审定。
export const PLANET_DEFS: readonly PlanetDef[] = [
  { id: 'planet-prototype-small', galaxyId: 'galaxy-hub', size: 4 },
  { id: 'planet-prototype-medium', galaxyId: 'galaxy-kor', size: 5 },
  { id: 'planet-prototype-large', galaxyId: 'galaxy-cinder', size: 6 },
]
export const PLANET_TRAITS: readonly PlanetTraitDef[] = [
  { id: 'temperate', kind: 'environment', weight: 3, exclusiveGroup: 'temperature', hazard: -10, habitability: 20 },
  { id: 'cold', kind: 'environment', weight: 2, exclusiveGroup: 'temperature', hazard: 10, habitability: -15, obstacle: 'ice' },
  { id: 'hot', kind: 'environment', weight: 2, exclusiveGroup: 'temperature', hazard: 15, habitability: -15 },
  { id: 'low-gravity', kind: 'environment', weight: 2, exclusiveGroup: 'gravity', hazard: 5, habitability: -5 },
  { id: 'high-gravity', kind: 'environment', weight: 2, exclusiveGroup: 'gravity', hazard: 15, habitability: -10, obstacle: 'rough' },
  { id: 'corrosive', kind: 'environment', weight: 2, exclusiveGroup: 'atmosphere', hazard: 20, habitability: -15, obstacle: 'corrosion' },
  { id: 'radiation', kind: 'environment', weight: 2, hazard: 15, habitability: -20 },
  { id: 'active-geology', kind: 'environment', weight: 2, hazard: 20, habitability: -5, obstacle: 'rough' },
  { id: 'metal-veins', kind: 'resource', weight: 3, deposit: { resource: 'metal', minCells: 1, maxCells: 2, bonus: 0.2 } },
  { id: 'ice-deposits', kind: 'resource', weight: 2, deposit: { resource: 'water', minCells: 1, maxCells: 2, bonus: 0.2 } },
  { id: 'fertile-soil', kind: 'resource', weight: 2, deposit: { resource: 'food', minCells: 1, maxCells: 2, bonus: 0.2 } },
  { id: 'rare-crystals', kind: 'resource', weight: 1, deposit: { resource: 'rare', minCells: 1, maxCells: 1, bonus: 0.2 } },
  { id: 'underground-ruins', kind: 'special', weight: 1, obstacle: 'rubble', deposit: { resource: 'research', minCells: 1, maxCells: 1, bonus: 0.2 } },
  { id: 'geothermal', kind: 'special', weight: 2, deposit: { resource: 'energy', minCells: 1, maxCells: 1, bonus: 0.2 } },
  { id: 'old-dome', kind: 'special', weight: 1 },
]
const OUTPUT_KINDS: readonly PlanetBuildingKind[] = ['power', 'water', 'nutrition', 'farm', 'mine', 'industry', 'research']
export const PLANET_BUILDINGS: readonly PlanetBuildingDef[] = [
  { id: 'base', kind: 'base', worker: 'automatic', unique: true, adjacency: OUTPUT_KINDS.map(target => ({ target, outputAdd: 0.1 })) },
  { id: 'cryo', kind: 'cryo', worker: 'automatic' },
  { id: 'power', kind: 'power', worker: 'automatic', usesResource: 'energy' },
  { id: 'water', kind: 'water', worker: 'automatic', usesResource: 'water', adjacency: [{ target: 'farm', outputAdd: 0.15 }] },
  { id: 'nutrition', kind: 'nutrition', worker: 'automatic' },
  { id: 'housing', kind: 'housing', worker: 'automatic' },
  { id: 'farm', kind: 'farm', worker: 'human', usesResource: 'food' },
  { id: 'mine', kind: 'mine', worker: 'automatic', requiredResource: 'metal', usesResource: 'metal' },
  { id: 'industry', kind: 'industry', worker: 'human' },
  { id: 'research', kind: 'research', worker: 'human', usesResource: 'research' },
  { id: 'maintenance', kind: 'maintenance', worker: 'automatic', adjacency: [...OUTPUT_KINDS, 'base', 'cryo', 'housing', 'logistics'].map(target => ({ target: target as PlanetBuildingKind, wearCut: 0.15 })) },
  { id: 'logistics', kind: 'logistics', worker: 'automatic', adjacency: [{ target: 'industry', outputAdd: 0.1 }] },
]

export function buildPlanetCatalog(): PlanetCatalog {
  return {
    planets: new Map(PLANET_DEFS.map(p => [p.id, p])),
    traits: new Map(PLANET_TRAITS.map(t => [t.id, t])),
    buildings: new Map(PLANET_BUILDINGS.map(b => [b.id, b])),
  }
}
