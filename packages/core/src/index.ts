/**
 * @whale/core 对外统一出口。
 * 其他包（data / ui / desktop / 未来服务端）只允许从这里 import。
 */

export type {
  SkillDef,
  SkillCatalog,
  ItemDef,
  ItemKind,
  DamageType,
  DamageResists,
  DroneDefense,
  BeltDef,
  ShipDef,
  ShipRole,
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
  StationSiteDef,
  StationTierDef,
  DialogueScriptDef,
  DialogueLineDef,
  AiCoreType,
  BalanceConfig,
  MarketRarity,
  MarketGoodKind,
  MarketGoodDef,
  MarketBalance,
  BattleBalance,
  FoeTactic,
  DefProfile,
  SimContext,
} from './types'

export {
  CURRENT_STATE_VERSION,
  MAX_SKILL_LEVEL,
  MAX_AI_CORE_LEVEL,
  DEFAULT_LOG_CAP,
  DEFAULT_PILOT_NAME,
  DEFAULT_START_ISK,
  DEFAULT_START_SHIP_ID,
  addLog,
  createInitialState,
} from './state'
export type {
  LogKind,
  LogEntry,
  RngState,
  TrainingItem,
  SkillsState,
  CharacterState,
  WalletState,
  WarehouseState,
  FittedModules,
  FleetShipState,
  MiningState,
  ManufacturingState,
  ExpeditionState,
  MarketPoolState,
  MarketDigestEntry,
  MarketState,
  PlayerOrder,
  NpcMarketOrder,
  GameStateV1,
  GameStateV2,
  GameStateV3,
  GameStateV4,
  GameStateV5,
  GameStateV6,
  GameStateV7,
  GameStateV8,
  GameStateV9,
  GameStateV10,
  GameStateV11,
  GameStateV12,
  BattleFx,
  EventsState,
  GameState,
} from './state'

export {
  ITEM_KIND_ORDER,
  ITEM_KIND_LABELS,
  itemKindLabel,
  SHIP_ROLE_LABELS,
  shipRoleLabel,
  MINEABLE_KINDS,
  isMineableItem,
  emptyFitted,
  SLOT_LABELS,
  // V18 槽类
  RACK_SLOTS,
  RACK_LABELS,
  rackLabel,
  shipSlotsOf,
  rackOf,
  allFittedIds,
} from './labels'
export type { RackSlot, ShipSlots } from './types'

export { hashSeed, nextRandom, nextInt } from './rng'

export {
  DEFAULT_TRAIN_BASE_MS,
  skillLevelTimeMs,
  totalTimeToLevel,
  totalQueueTimeMs,
} from './training'

export { DEFAULT_BALANCE } from './balance'

export {
  advanceGame,
  enqueueSkill,
  removeQueueAt,
  clearSkillQueue,
  skillQueueStatus,
} from './engine'
export type { CommandResult, HeadTrainingInfo, QueueView } from './engine'

export {
  currentShipState,
  cargoOfShip,
  cargoItemsOf,
  countItem,
  addItem,
  removeItem,
  countWare,
  addWare,
  removeWare,
  cargoUsedM3Of,
  cargoCapacityM3Of,
  cargoUsedM3,
  cargoCapacityM3,
  freeCargoM3,
  unloadCargoToWarehouse,
  loadWarehouseToCargo,
  loadWarehouseToCargoFit,
} from './inventory'

export {
  MODULE_SLOTS,
  slotLabel,
  countModule,
  addModule,
  removeModule,
  fitModule,
  unfitSlot,
  unfitAt,
  fittedBonuses,
  fittedCpuUsed,
  V17_MODULE_MIGRATIONS,
  repairDeprecatedModules,
  migrateDeprecatedAmmo,
} from './equipment'

export {
  ownsShip,
  addShipToFleet,
  allocateShipUid,
  changeShip,
  loseShip,
  durabilityOf,
  repairCostIsk,
  repairShip,
  isShipLocked,
  lockShip,
  repairWithKits,
  renameShip,
} from './shipyard'

export { fleetDefOf, shipDisplayName } from './instances'

export {
  getMiningParams,
  oneLegMs,
  oneOutboundLegMs,
  rollBeltOutput,
  startMining,
  startMiningFromExpedition,
  stopMining,
  advanceMining,
  miningStatus,
  setMiningAutoCycle,
  setMiningStopAfterTrip,
  shipInReturn,
} from './mining'
export type { MiningParams, MiningView } from './mining'

export { warpSpeedAus, travelTimeFactor, travelLegMs, travelMinutesEff, shortestTravelMinutes } from './travel'

export {
  isExplored,
  markExplored,
  frontierGalaxyIds,
  actionBlockReason,
  ensureTransitExplored,
  startScan,
  stopScan,
  scanStatus,
  advanceScanning,
  SCAN_WINDOW_MS,
} from './explore'

export {
  refineRate,
  oreAvailable,
  refineRunActive,
  refineManualActive,
  startRefineRun,
  stopRefineRun,
  refineRunStatus,
  sellCargoItem,
  sellWareItem,
  sellAll,
  sellPriceMultiplier,
  buyShip,
} from './industry'
export type { RefineRunView, SellResult } from './industry'

export {
  ownsBlueprint,
  calcBuildDurationMs,
  missingMaterials,
  materialFactor,
  matNeedCount,
  startManufacturing,
  advanceManufacturing,
  manufacturingStatus,
  findBuildable,
} from './manufacturing'
export type { BuildSpec, ManufacturingView } from './manufacturing'

export {
  ensureMarket,
  advanceMarket,
  marketGoodOf,
  levelOf,
  marketQuote,
  marketHistory,
  marketTrend,
  goodName,
  salesTaxRate,
  goodLockedReason,
  marketLockedReason,
  placeSellOrder,
  placeBuyOrder,
  cancelOrder,
  sellAtMarket,
  buyAtMarket,
  shipSellable,
  sellShipAtMarket,
  placeShipSellOrder,
  learnBlueprint,
  naturalHoldings,
  marketSellHolding,
  listSellHolding,
  refundToStorage,
} from './market'

export {
  EVENT_TAG,
  advanceEvents,
  fireOneEvent,
  fireMarketShockEvent,
  fireMarketOrderEvent,
} from './events'

export {
  HOME_GALAXY_ID,
  DSI_FACTION_ID,
  standingOf,
  calcPower,
  winChance,
  calcExpeditionDurationMs,
  startExpedition,
  startExpeditionFromMining,
  advanceExpedition,
  abandonChance,
  beginBattleAt,
  setBattleDesire,
  battleTacticDesire,
  resolveBattleOutcome,
  expeditionStatus,
  expeditionFeasibility,
  retreatBattle,
} from './expedition'
export type { ExpeditionView, BattleTacticChoice } from './expedition'

export { recallExpedition } from './expedition'
export {
  setAutoLoopBounty,
  advanceAutoLoopBounty,
  bountyCooldownMsFor,
  bountyCooldownRemainingMs,
  BOUNTY_COOLDOWN_BASE_MS,
} from './expedition'
export { cancelManufacturing } from './manufacturing'
export { activityOverview, shipBusyLabel } from './activity'
export type { ActivityKind, ActivityStopKind, ActivityView } from './activity'
export {
  stationGalaxyIds,
  nearestStationGalaxyId,
  isAtStation,
  isAtHome,
  originGalaxyOf,
  isIdleField,
  startTransitHome,
  advanceTransit,
  transitStatus,
  goStandbyAt,
  advanceStandby,
  cancelStandby,
  standbyStatus,
} from './location'
export type { TransitView, StandbyView } from './location'
export {
  siteProgress,
  isSiteBuilt,
  tierRemaining,
  deliverStationResources,
  onArriveAtGalaxy,
  playDialogue,
} from './station'
export type { StationSiteProgress } from './state'

export {
  battleWinPreview,
  aiWinPreview,
  aiFavorAdv,
  battleOpenM,
  battleZonesFor,
  battleArcsFor,
  spreadWinChance,
  desiredRangeFor,
  foeDesiredRange,
  mergeResist,
  foeMainDamageType,
  foeLayerSplit,
  createPlayerSpec,
  playerAmmoType,
  BATTLE_STEP_MS,
  BATTLE_MAX_STEPS,
} from './combat'
export type { WeaponSpec, UnitSpec, Hp3 } from './combat'

export {
  AI_CORE_ORDER,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  gainAiCore,
  maxAiSlots,
  aiSlotsUsed,
  idleAiShipIds,
  buyBasicAiCore,
  assignAiMining,
  assignAiExpedition,
  assignAiStandby,
  cancelAiTask,
  advanceAi,
  advanceAiExpedition,
} from './ai'

export {
  DEFAULT_OFFLINE_CAP_MS,
  offlineSplit,
  formatDurationMs,
  simulateOffline,
} from './simulation'

export {
  SAVE_FORMAT,
  SaveError,
  serializeSaveFile,
  loadSaveFile,
} from './save'

export { advanceEncounterWatch, fightEncounter, fleeEncounter } from './encounters'
