/**
 * @whale/data 对外出口：技能表 + 内容表 + 引擎运行上下文。
 */

export { SKILLS, SKILL_GROUPS, buildSkillCatalog } from './skills'
export { ORES, MINERALS, ITEMS, DRONES, buildItemCatalog } from './items'
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
// 2026-09-19 残骸合并：卡级特色池/主题件表退居**构建依据与体检输入**（运行时一律走 core 的 13 组表）
export { RECYCLE_FLAVOR, RECYCLE_LOOT_PILOT } from './salvageFlavors'
export type { RecycleFlavor } from './salvageFlavors'
// 2026-09-11 退役窝点卡白名单（船长「按方案 2 执行」）：B 族两卡字段退役后，靠显式白名单
// 保住"旧档里已获得的稀有残骸仍可识别"——详见 `./retiredLairCards.ts` 与 content:check 契约。
export { RETIRED_LAIR_CARD_IDS } from './retiredLairCards'
// 2026-09-13 洞内敌卡表（五族各一张 = 按族掉落池的来源）：卡表与轮换顺序对外出口，
// 供 `content:check` 的三处同序契约与 core 侧的轮换表对齐（少一张/换序会让掉落物取错族）。
export { WORMHOLE_FOE_CARDS, WORMHOLE_FOE_CARD_IDS, WORMHOLE_RARE_WRECK_CARD_IDS } from './wormholeFoes'
// 2026-09-11 敌舰配置表（舰级表）：A 族试点——绝对值口径，悬赏卡只写编成与修正
export {
  FOE_SHIPS,
  FOE_SHIP_PIRATE_SKIFF,
  FOE_SHIP_PIRATE_CORVETTE,
  FOE_SHIP_PIRATE_SNIPER,
  FOE_SHIP_PIRATE_WARLORD,
  ALIEN_BEAST_SHIP_IDS,
  // 2026-09-16 船长「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」：C 族冲锋倍率的**按档契约基准**
  // （T1 1.5 · T2 2 · T3 2.5 · T4 3 · T5 4；`content:check` 与用例都按它核对舰级实挂值）
  ALIEN_CHARGE_MUL_BY_TIER,
  // 2026-09-16 船长「孢群异虫速度削减到300」：C 族「允许慢」白名单（豁免族格速带三条断言）
  ALIEN_SLOW_SHIP_IDS,
  // 2026-09-15 船长「撞到的契约开白名单」：构成口径由舰级说了算的舰级（D 战列舰 6:4 · E 导弹残段纯爆炸）
  FOE_SHIP_MIX_AUTHORITY_IDS,
  // 2026-09-16 船长：敌方后勤舰「残军补给舰」（T3 · 备用壳体，暂不进卡；带 repairPct 修理能力）
  FOE_G_REMNANT_TENDER,
} from './foe-ships'
// 2026-09-11 敌机机型表（舰载机群）：舰级只登记"用哪个机型、几架"，数值全在机型表（设计稿 foe-drone-system-20260911.md）
export { FOE_DRONES, FOE_DRONE_E_ALERT, FOE_DRONE_C_SPORE } from './foe-drones'
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
export { FIRST_TASK_MESSAGES } from './firstTaskMessages'
export { ANNOUNCEMENTS, buildAnnouncementCatalog, type AnnouncementDef } from './announcements'
export { buildSimContext } from './context'
// 2026-09-19 英语本地化（船长令）：按 id 索引的英文覆盖层 + 语言类型（口径见 docs/glossary-en.md）
export {
  localizeCtx,
  overlayMap,
  overlayList,
  EN_SHIPS,
  EN_MODULES,
  EN_ITEMS,
  EN_SKILLS,
  EN_WRECKS,
  EN_ANOMALIES,
  EN_ITEMS_ALL,
  EN_BLUEPRINTS,
  EN_SHIP_BLUEPRINTS,
  EN_FOE_SHIPS,
  EN_GALAXIES,
  EN_BELTS,
  EN_STATIONS,
  EN_COMMS_FACTIONS,
  overlayCardFoes,
  overlayCardFoesList,
  type Locale as L10nLocale,
  type EnText,
  type EnTable,
} from './l10n'

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
