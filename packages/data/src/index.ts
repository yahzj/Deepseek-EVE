
export { SKILLS, SKILL_GROUPS, SKILL_BRANCHES, buildSkillCatalog } from './skills'
export { ORES, MINERALS, ITEMS, DRONES, buildItemCatalog } from './items'
export { BELTS, buildBeltCatalog } from './belts'
export { SHIPS, buildShipCatalog } from './ships'
export { MODULES, buildModuleCatalog } from './modules'
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
export { PLANET_DEFS, PLANET_TRAITS, PLANET_BUILDINGS, buildPlanetCatalog } from './planets'
export { ANOMALIES, ANOMALIES_FLAVORED, buildAnomalyCatalog } from './anomalies'
export { RECYCLE_FLAVOR, RECYCLE_LOOT_PILOT } from './salvageFlavors'
export type { RecycleFlavor } from './salvageFlavors'
export { RETIRED_LAIR_CARD_IDS } from './retiredLairCards'
export { WORMHOLE_FOE_CARDS, WORMHOLE_FOE_CARD_IDS, WORMHOLE_RARE_WRECK_CARD_IDS } from './wormholeFoes'
export {
  FOE_SHIPS,
  FOE_SHIP_PIRATE_SKIFF,
  FOE_SHIP_PIRATE_CORVETTE,
  FOE_SHIP_PIRATE_SNIPER,
  FOE_SHIP_PIRATE_WARLORD,
  FOE_D_INVASION_CRUISER,
  FOE_D_INVASION_BASTION,
  FOE_D_INVASION_OATHKEEPER,
  FOE_D_INVASION_ETERNAL_TOMB,
  ALIEN_BEAST_SHIP_IDS,
  ALIEN_FLAGSHIP_SHIP_IDS,
  G_FLAGSHIP_SHIP_IDS,
  H_FLAGSHIP_SHIP_IDS,
  INK_SPEED_EXEMPT_SHIP_IDS,
  R_FLAGSHIP_SHIP_IDS,
  CORONA_SPEED_BAND,
  ALIEN_CHARGE_MUL_BY_TIER,
  ALIEN_SLOW_SHIP_IDS,
  FOE_SHIP_MIX_AUTHORITY_IDS,
  FOE_G_REMNANT_TENDER,
} from './foe-ships'
export { FOE_DRONES, FOE_DRONE_E_ALERT, FOE_DRONE_C_SPORE, FOE_DRONE_C_JAWCLAW } from './foe-drones'
export { ALIEN_INVASION_CHARGE_MUL, ALIEN_FAST_SHIP_IDS } from './foe-ships'
export { TRAVEL_EVENTS, buildTravelEvents } from './travelEvents'
export { MARKET_GOODS, WRECK_BUY_GOODS, buildMarketGoodsCatalog } from './marketCatalog'
export { RARITY_TIER, rarityTierOf, itemRarityTierOf } from './rarityTier'
export {
  DRONE_ROLE_SPECS,
  DRONE_ROLE_ANCHORS,
  droneTotalHp,
  droneRoleIssues,
  droneRoleLadderIssues,
  type DroneRoleSpec,
} from './droneRoles'
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
export { LAB_RECIPES, buildLabRecipeCatalog } from './labRecipes'
export { DIALOGUES, buildDialogueCatalog } from './dialogues'
export { COMMS_MESSAGES, buildCommsCatalog } from './messages'
export {
  COMMS_FACTIONS,
  FACTION_OCTOPUS_GLYPH,
  FACTION_CORE_GLYPH,
  FACTION_AVATARS,
  buildCommsFactionCatalog,
  buildCommsDeptCatalog,
} from './commsFactions'
export { FIRST_TASK_MESSAGES } from './firstTaskMessages'
export { SKILL_TREE_POSITIONS } from './skillTreePositions'
export { ANNOUNCEMENTS, buildAnnouncementCatalog, type AnnouncementDef } from './announcements'
export { buildSimContext } from './context'
export { MATTER_TECH_NODES, buildMatterTechCatalog } from './matterTech'
export { FACTION_CODEX, FACTION_CODEX_ORDER, FACTION_CODEX_COUNT, buildFactionCards, factionOfExclusive } from './factionCodex'
export type { FactionCard, FactionEnemy } from './factionCodex'
export type { FactionCodexEntry } from './factionCodex'
export { ACHIEVEMENTS, achievementOf, achievementsOfChain } from './achievements'
export { L10N, l10nEntryText, type L10nEntry } from './l10n/table'
export {
  localizeCtx,
  firstChainText,
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
  EN_WRECK_GROUPS,
  wreckGroupText,
  overlayWreckGroups,
  EN_STATION_TIERS,
  stationTierText,
  EN_COMMS_FACTIONS,
  EN_TRAVEL_EVENTS,
  EN_MATTER_TECH,
  EN_MATTER_TECH_NOTES,
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
