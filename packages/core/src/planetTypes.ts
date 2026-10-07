/** 星球规则原型；参数注入，不依赖玩家入口或现有经济。 */
export type PlanetSize = 4 | 5 | 6
export type PlanetTraitKind = 'environment' | 'resource' | 'special'
export type PlanetResource = 'metal' | 'water' | 'food' | 'research' | 'rare' | 'energy'
export type PlanetObstacle = 'rough' | 'ice' | 'corrosion' | 'rubble'
export type PlanetSurveyLevel = 1 | 2 | 3
export type PlanetBuildingKind = 'base' | 'cryo' | 'power' | 'water' | 'nutrition' | 'housing' | 'farm' | 'mine' | 'industry' | 'research' | 'maintenance' | 'logistics'

export interface PlanetDef {
  id: string
  galaxyId: string
  size: PlanetSize
}
export interface PlanetTraitDef {
  id: string
  kind: PlanetTraitKind
  weight: number
  exclusiveGroup?: string
  conflicts?: readonly string[]
  hazard?: number
  habitability?: number
  obstacle?: PlanetObstacle
  deposit?: { resource: PlanetResource; minCells: number; maxCells: number; bonus: number }
}
export interface PlanetAdjacencyDef {
  target: PlanetBuildingKind
  outputAdd?: number
  wearCut?: number
}
export interface PlanetBuildingDef {
  id: string
  kind: PlanetBuildingKind
  worker: 'automatic' | 'human'
  unique?: boolean
  requiredResource?: PlanetResource
  requiredTraitId?: string
  usesResource?: PlanetResource
  adjacency?: readonly PlanetAdjacencyDef[]
}
export interface PlanetCatalog {
  planets: ReadonlyMap<string, PlanetDef>
  traits: ReadonlyMap<string, PlanetTraitDef>
  buildings: ReadonlyMap<string, PlanetBuildingDef>
  operations?: ReadonlyMap<string, PlanetOperationDef>
  projects?: ReadonlyMap<string, PlanetProjectDef>
}
export interface PlanetDeposit {
  resource: PlanetResource
  sourceTraitId: string
  bonus: number
}
export interface PlanetBuildingState {
  id: string
  status: 'construction' | 'ready' | 'stopped'
  powered: boolean
  staffed: boolean
  condition?: number
  enabled?: boolean
}
export interface PlanetGridCell {
  index: number
  deposit?: PlanetDeposit
  obstacle?: PlanetObstacle
  building?: PlanetBuildingState
}
export interface PlanetState extends PlanetDef {
  generationVersion: number
  seed: number
  traitIds: string[]
  hiddenTraitId: string
  survey: PlanetSurveyLevel
  cells: PlanetGridCell[]
  colony?: PlanetColonyState
  originalTraitIds?: string[]
  projectHistory?: string[]
}
export interface PlanetaryState {
  planets: Record<string, PlanetState>
  runtimeVersion?: 1
  tickRemainderMs?: number
  humans?: { discoveredAtGameMs: number; sourcePlanetId: string; sleeping: number }
  deliveries?: PlanetDelivery[]
}

export type PlanetLocalResource = 'food' | 'water' | 'medicine' | 'metal' | 'parts' | 'research' | 'rare'
export interface PlanetBill { items: Record<string, number>; credits: number; durationMs: number }
export interface PlanetOperationDef {
  buildingId: string
  bill: PlanetBill
  power: number
  priority: number
  housing?: number
  cryoCapacity?: number
  lifeSupport?: boolean
  output?: Partial<Record<PlanetLocalResource, number>>
  inputs?: Partial<Record<PlanetLocalResource, number>>
}
export interface PlanetProjectDef {
  id: string
  fromTraitId?: string
  toTraitId?: string
  removeTraitId?: string
  requiredResearch: number
  bill: PlanetBill
}
export interface PlanetJob {
  seq: number
  kind: 'build' | 'clear' | 'move' | 'project'
  cellIndex?: number
  targetIndex?: number
  buildingId?: string
  projectId?: string
  remainingMs: number
  totalMs: number
  spentItems: Record<string, number>
  spentCredits: number
  spentResearch?: number
  paused: boolean
}
export interface PlanetEvent {
  seq: number
  kind: 'equipment' | 'weather' | 'resources' | 'health' | 'ruins'
  atMs: number
  cellIndex?: number
}
export interface PlanetColonyState {
  runtimeVersion: 1
  items: Record<string, number>
  credits: number
  supplies: Partial<Record<PlanetLocalResource, number>>
  awake: number
  sleeping: number
  jobs: PlanetJob[]
  jobSeq: number
  clockMs: number
  tickRemainderMs: number
  crisis: 'none' | 'sheltered' | 'rescue'
  event?: PlanetEvent
  eventSeq: number
  nextEventMs: number
  eventRngCount: number
  pauseEvents?: boolean
}
export interface PlanetDelivery {
  seq: number
  planetId: string
  shipUid: string
  items: Record<string, number>
  credits: number
  humans: number
  remainingMs: number
  durationMs: number
}
export interface PlanetActionResult {
  ok: boolean
  reason?: string
}
export interface PlanetEnvironment {
  hazard: number
  habitability: number
  wearMul: number
  constructionMul: number
  repairMul: number
  consumptionMul: number
  humanWorkMul: number
}
export interface PlanetSurveyView {
  id: string
  galaxyId: string
  size: PlanetSize
  survey: PlanetSurveyLevel
  traitIds: string[]
  unknownTraits: number
  hazard: { min: number; max: number }
  habitability: { min: number; max: number }
  cells?: PlanetGridCell[]
}
