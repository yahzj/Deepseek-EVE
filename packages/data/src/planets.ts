import type { PlanetDef, PlanetTraitDef, PlanetBuildingDef, PlanetCatalog, PlanetBuildingKind, PlanetOperationDef, PlanetProjectDef } from '@whale/core'

// 隐藏验收目录；完整建设规则已接线，公开入口、物品与市场条目不开放。
export const PLANET_DEFS: readonly PlanetDef[] = [
  { id: 'planet-prototype-small', galaxyId: 'galaxy-hub', size: 4 },
  { id: 'planet-prototype-medium', galaxyId: 'galaxy-kor', size: 5 },
  { id: 'planet-prototype-large', galaxyId: 'galaxy-cinder', size: 6 },
]
export const PLANET_TRAITS: readonly PlanetTraitDef[] = [
  { id: 'managed-ecology', kind: 'environment', weight: 0, exclusiveGroup: 'artificial-ecology', hazard: -5, habitability: 5 },
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
  { id: 'controlled-corrosion', kind: 'environment', weight: 0, exclusiveGroup: 'atmosphere', hazard: 10, habitability: -5 },
  { id: 'shielded-radiation', kind: 'environment', weight: 0, conflicts: ['radiation'], hazard: 5, habitability: -5 },
  { id: 'moderated-cold', kind: 'environment', weight: 0, exclusiveGroup: 'temperature', hazard: 5, habitability: -5 },
  { id: 'moderated-hot', kind: 'environment', weight: 0, exclusiveGroup: 'temperature', hazard: 5, habitability: -5 },
  { id: 'restored-dome', kind: 'special', weight: 0, conflicts: ['old-dome'], habitability: 10 },
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
  { id: 'rare-extractor', kind: 'mine', worker: 'automatic', requiredResource: 'rare', usesResource: 'rare' },
  { id: 'industry', kind: 'industry', worker: 'human' },
  { id: 'research', kind: 'research', worker: 'human', usesResource: 'research' },
  { id: 'maintenance', kind: 'maintenance', worker: 'automatic', adjacency: [...OUTPUT_KINDS, 'base', 'cryo', 'housing', 'logistics'].map(target => ({ target: target as PlanetBuildingKind, wearCut: 0.15 })) },
  { id: 'logistics', kind: 'logistics', worker: 'automatic', adjacency: [{ target: 'industry', outputAdd: 0.1 }] },
]

// 建设账只使用现有物品；运营输入和产出为每小时本地资源，power 正数耗电、负数发电。
export const PLANET_OPERATIONS: readonly PlanetOperationDef[] = [
  { buildingId: 'base', bill: { items: { 'min-tritanium': 100 }, credits: 3000, durationMs: 120000 }, power: 1, priority: 2 },
  { buildingId: 'cryo', bill: { items: { 'min-tritanium': 150 }, credits: 5000, durationMs: 180000 }, power: 1, priority: 0, cryoCapacity: 6 },
  { buildingId: 'power', bill: { items: { 'min-tritanium': 150 }, credits: 4000, durationMs: 180000 }, power: -12, priority: 0 },
  { buildingId: 'water', bill: { items: { 'min-tritanium': 80 }, credits: 2500, durationMs: 120000 }, power: 1, priority: 3, output: { water: 8 } },
  { buildingId: 'nutrition', bill: { items: { 'min-tritanium': 100 }, credits: 3000, durationMs: 120000 }, power: 3, priority: 3, output: { food: 6 } },
  { buildingId: 'housing', bill: { items: { 'min-tritanium': 100 }, credits: 3000, durationMs: 120000 }, power: 1, priority: 1, housing: 4, lifeSupport: true },
  { buildingId: 'farm', bill: { items: { 'min-tritanium': 100 }, credits: 3500, durationMs: 180000 }, power: 2, priority: 5, output: { food: 10 } },
  { buildingId: 'mine', bill: { items: { 'min-tritanium': 150 }, credits: 4000, durationMs: 180000 }, power: 2, priority: 6, output: { metal: 8 } },
  { buildingId: 'rare-extractor', bill: { items: { 'min-tritanium': 250 }, credits: 6000, durationMs: 300000 }, power: 3, priority: 7, output: { rare: 1 } },
  { buildingId: 'industry', bill: { items: { 'min-tritanium': 200 }, credits: 6000, durationMs: 300000 }, power: 3, priority: 7, inputs: { metal: 4 }, output: { parts: 2, medicine: 2 } },
  { buildingId: 'research', bill: { items: { 'min-tritanium': 150 }, credits: 5000, durationMs: 240000 }, power: 2, priority: 8, output: { research: 2 } },
  { buildingId: 'maintenance', bill: { items: { 'min-tritanium': 80 }, credits: 2500, durationMs: 120000 }, power: 1, priority: 4 },
  { buildingId: 'logistics', bill: { items: { 'min-tritanium': 50 }, credits: 2000, durationMs: 60000 }, power: 1, priority: 4 },
]

export const PLANET_PROJECTS: readonly PlanetProjectDef[] = [
  { id: 'ecology-management', toTraitId: 'managed-ecology', requiredResearch: 40, bill: { items: { 'min-tritanium': 800 }, credits: 16000, durationMs: 2400000 } },
  { id: 'detox-corrosive', fromTraitId: 'corrosive', toTraitId: 'controlled-corrosion', requiredResearch: 30, bill: { items: { 'min-tritanium': 800 }, credits: 16000, durationMs: 2700000 } },
  { id: 'screen-radiation', fromTraitId: 'radiation', toTraitId: 'shielded-radiation', requiredResearch: 20, bill: { items: { 'min-tritanium': 700 }, credits: 14000, durationMs: 2400000 } },
  { id: 'climate-cold', fromTraitId: 'cold', toTraitId: 'moderated-cold', requiredResearch: 10, bill: { items: { 'min-tritanium': 500 }, credits: 10000, durationMs: 1200000 } },
  { id: 'climate-hot', fromTraitId: 'hot', toTraitId: 'moderated-hot', requiredResearch: 15, bill: { items: { 'min-tritanium': 600 }, credits: 12000, durationMs: 1800000 } },
  { id: 'repair-dome', fromTraitId: 'old-dome', toTraitId: 'restored-dome', requiredResearch: 40, bill: { items: { 'min-tritanium': 1000 }, credits: 20000, durationMs: 3600000 } },
]

export function buildPlanetCatalog(): PlanetCatalog {
  return {
    planets: new Map(PLANET_DEFS.map(p => [p.id, p])),
    traits: new Map(PLANET_TRAITS.map(t => [t.id, t])),
    buildings: new Map(PLANET_BUILDINGS.map(b => [b.id, b])),
    operations: new Map(PLANET_OPERATIONS.map(o => [o.buildingId, o])),
    projects: new Map(PLANET_PROJECTS.map(p => [p.id, p])),
  }
}
