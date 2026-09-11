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
export { ANOMALIES, ANOMALIES_FLAVORED, buildAnomalyCatalog } from './anomalies'
export { TRAVEL_EVENTS, buildTravelEvents } from './travelEvents'
export { MARKET_GOODS, WRECK_BUY_GOODS, buildMarketGoodsCatalog } from './marketCatalog'
// 2026-09-09 数字稀有度表（物品本体属性；市场/图鉴/未来掉落统一查）
export { RARITY_TIER, rarityTierOf } from './rarityTier'
// 2026-09-10 无人机四型定位契约（新增机型受 content:check 与 core 测试双重守卫）
export {
  DRONE_ROLE_SPECS,
  DRONE_ROLE_ANCHORS,
  droneTotalHp,
  droneRoleIssues,
  droneRoleLadderIssues,
  type DroneRoleSpec,
} from './droneRoles'
export { STATION_SITES, buildStationCatalog } from './stations'
export { DIALOGUES, buildDialogueCatalog } from './dialogues'
export { COMMS_MESSAGES, buildCommsCatalog } from './messages'
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
  CommsMessageDef,
  CommsTrigger,
  CommsReplyDef,
  CommsJumpPage,
} from '@whale/core'
