/**
 * @whale/data 对外出口：技能表 + 内容表 + 引擎运行上下文。
 */

export { SKILLS, SKILL_GROUPS, buildSkillCatalog } from './skills'
export { ORES, MINERALS, ITEMS, buildItemCatalog } from './items'
export { BELTS, buildBeltCatalog } from './belts'
export { SHIPS, buildShipCatalog } from './ships'
export { MODULES, buildModuleCatalog } from './modules'
// 2026-09-11 蓝图价格口径（船长裁决甲 + 同日复核补正：奇货档 ×4，系数即默认值、个例可覆盖）：
// 系数与算法单点在被导出，供 content:check 契约与重定价工具复用（避免第二份公式）
export {
  BLUEPRINTS,
  BLUEPRINT_PRICE_STEP,
  BLUEPRINT_PRICE_OVERRIDES,
  blueprintBookPriceOf,
  blueprintTierCoefOf,
  buildBlueprintCatalog,
} from './blueprints'
export { SHIP_BLUEPRINTS, buildShipBlueprintCatalog } from './shipBlueprints'
export { GALAXIES, GALAXY_EDGES, buildGalaxyCatalog } from './universe'
export { ANOMALIES, ANOMALIES_FLAVORED, buildAnomalyCatalog } from './anomalies'
// 2026-09-11 退役窝点卡白名单（船长「按方案 2 执行」）：B 族两卡字段退役后，靠显式白名单
// 保住"旧档里已获得的稀有残骸仍可识别"——详见 `./retiredLairCards.ts` 与 content:check 契约。
export { RETIRED_LAIR_CARD_IDS } from './retiredLairCards'
// 2026-09-11 敌舰配置表（舰级表）：A 族试点——绝对值口径，悬赏卡只写编成与修正
export {
  FOE_SHIPS,
  FOE_SHIP_PIRATE_SKIFF,
  FOE_SHIP_PIRATE_CORVETTE,
  FOE_SHIP_PIRATE_SNIPER,
  FOE_SHIP_PIRATE_WARLORD,
  ALIEN_BEAST_SHIP_IDS,
} from './foe-ships'
// 2026-09-11 敌机机型表（舰载机群）：舰级只登记"用哪个机型、几架"，数值全在机型表（设计稿 foe-drone-system-20260911.md）
export { FOE_DRONES, FOE_DRONE_E_ALERT } from './foe-drones'
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
// 2026-09-11 舰种表（质量分级·敌我共用）：5 档命名 + 基准速度 + 等效质量落档（本批零行为变化）
export {
  HULL_CLASS_NAME,
  HULL_CLASS_BASE_SPEED,
  HULL_CLASS_MASS_RANGE,
  equivalentMassOf,
  hullClassTierOfTier,
  hullClassOf,
  type HullClassTier,
} from './hullClass'
export { STATION_SITES, buildStationCatalog } from './stations'
export { DIALOGUES, buildDialogueCatalog } from './dialogues'
export { COMMS_MESSAGES, buildCommsCatalog } from './messages'
// 2026-09-11 通讯 v2：NPC 势力与船内系统档案（协会 8 部门 + 打捞队工会 + 信息库；发件人与立场口径的唯一权威）
export {
  COMMS_FACTIONS,
  FACTION_OCTOPUS_GLYPH,
  FACTION_CORE_GLYPH,
  FACTION_AVATARS,
  buildCommsFactionCatalog,
  buildCommsDeptCatalog,
} from './commsFactions'
// 2026-09-11 教程融入通讯：序章简报 + 七步教程的文案与跳转（唯一出处；教程通讯与顶部引导条共用）
export { BRIEFING_INTRO, TUTORIAL_STEPS, TUTORIAL_TOTAL, type TutorialStepDef } from './tutorialSteps'
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
