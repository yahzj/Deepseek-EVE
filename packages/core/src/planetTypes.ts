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
}
export interface PlanetaryState {
  planets: Record<string, PlanetState>
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
