/**
 * @whale/data 对外出口：技能表 + 内容表 + 引擎运行上下文。
 */

export { SKILLS, SKILL_GROUPS, buildSkillCatalog } from './skills'
export { ORES, MINERALS, ITEMS, buildItemCatalog } from './items'
export { BELTS, buildBeltCatalog } from './belts'
export { SHIPS, buildShipCatalog } from './ships'
export { MODULES, buildModuleCatalog } from './modules'
export { BLUEPRINTS, buildBlueprintCatalog } from './blueprints'
export { SHIP_BLUEPRINTS, buildShipBlueprintCatalog } from './shipBlueprints'
export { GALAXIES, GALAXY_EDGES, buildGalaxyCatalog } from './universe'
export { ANOMALIES, buildAnomalyCatalog } from './anomalies'
export { TRAVEL_EVENTS, buildTravelEvents } from './travelEvents'
export { MARKET_GOODS, buildMarketGoodsCatalog } from './marketCatalog'
export { STATION_SITES, buildStationCatalog } from './stations'
export { DIALOGUES, buildDialogueCatalog } from './dialogues'
export { ANNOUNCEMENTS, buildAnnouncementCatalog, type AnnouncementDef } from './announcements'
export { buildSimContext } from './context'

export type {
  SkillDef,
  SkillCatalog,
  ItemDef,
  BeltDef,
  ShipDef,
  RefineRow,
  ModuleDef,
  ModuleSlot,
  MaterialNeed,
  BlueprintDef,
  ShipBlueprintDef,
  TravelEventDef,
  TravelEventEffect,
  GalaxyDef,
  GalaxyEdgeDef,
  LootRow,
  AnomalyDef,
  MarketRarity,
  MarketGoodKind,
  MarketGoodDef,
  SimContext,
  StationSiteDef,
  DialogueScriptDef,
  DialogueLineDef,
} from '@whale/core'
