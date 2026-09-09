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
  ManufacturingRunState,
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
  SHIP_SIZE_CLASS,
  shipSizeLabel,
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
  trainingTimeFactor,
  totalTimeToLevel,
  totalQueueTimeMs,
} from './training'

export { DEFAULT_BALANCE } from './balance'

export {
  advanceGame,
  enqueueSkill,
  removeQueueAt,
  moveQueueItem,
  clearSkillQueue,
  skillQueueStatus,
  HIDDEN_SKILL_IDS,
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
  unloadCargoOfShipToWarehouse,
  loadWarehouseToCargo,
  loadWarehouseToCargoFit,
} from './inventory'

export {
  MODULE_SLOTS,
  slotLabel,
  effectiveCpu,
  countModule,
  addModule,
  removeModule,
  fitModule,
  unfitSlot,
  unfitAt,
  adjustDroneLoad,
  fittedBonuses,
  fittedCpuUsed,
  // 2026-09-08 无人机舱大改：装载清单 CPU/体积（装配页预算条、装配校验、战斗装载同源）
  droneCpuUsed,
  droneLoadM3,
  V17_MODULE_MIGRATIONS,
  repairDeprecatedModules,
  migrateDeprecatedAmmo,
  // V18.1 多件收敛（取消同类唯一后的防超模机制；UI 标签与装配提示用）
  stackingOf,
  stackWeight,
  curveMult,
  gapCombine,
  sameKindCount,
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
  useOneRepairKit,
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
  SCAN_LOWSEC_PENALTY,
  scanWindowMsOf,
  scanWindowMsFor,
} from './explore'

export {
  refineRate,
  oreAvailable,
  refineRunActive,
  refineManualActive,
  startRefineRun,
  startRecycleRun,
  stopRefineRun,
  refineRunViews,
  redeemFragments,
  sellCargoItem,
  sellCargoItemQty,
  sellWareItem,
  sellWareItemQty,
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
  setManufacturingLoop,
  advanceManufacturing,
  manufacturingRunViews,
  manufacturingManualActive,
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
  bmGateLocked,
  bmGateReason,
  acquisitionFactorOf,
  buyLineOf,
  askLineOf,
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
  marketSellPreview,
  listSellHolding,
  refundToStorage,
  snatchSellFill,
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
  bountyRewardFactor,
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
  WRECK_FLOOR,
  WRECK_INJECT_PER_THREAT,
  WRECK_DRAIN_SHARE,
  WRECK_DECAY_MS,
  WRECK_RECOVER_MS,
  WRECK_VOLUME_PER_THREAT,
  wreckItemIdOf,
  anomalyIdOfWreck,
  wreckItemDefOf,
  wreckBaseDensity,
  wreckDensityOf,
  injectWreckDensity,
  advanceWreckDrift,
  salvageRoundPull,
  RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS,
  RECYCLE_YIELD_PER_M3,
  RECYCLE_POOL_AVG_ISK,
  RECYCLE_TIER_LABELS,
  RECYCLE_BASE_MODULES,
  RECYCLE_MK2_MODULES,
  RECYCLE_CHANCE,
  FRAGMENT_RECIPES,
  fragmentItemIdOf,
  fragmentItemDefOf,
  recycleTierOf,
  recycleProfileOf,
  rollRecycleGuarantee,
  rollRecycleLoot,
} from './salvage'
export type { RecycleTier, RecycleProfile } from './salvage'
export { advanceSalvageOp, startSalvageOp, stopSalvageOp, retireSalvageShip, setSalvageAutoCycle, setSalvageStopAfterTrip, salvagerCyclesOf, pullOneWreck, legMsFor, outboundLegMsFor } from './salvaging'
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
  builtSiteAtGalaxy,
  isAtStation,
  isAtHome,
  isAtHomeLike,
  originGalaxyOf,
  isIdleField,
  startTransitHome,
  advanceTransit,
  transitStatus,
  goStandbyAt,
  advanceStandby,
  cancelStandby,
  standbyStatus,
  startSiteDeliverTrip,
  cancelSiteDeliverTrip,
  reconcileDockSanity,
} from './location'
export type { TransitView, StandbyView } from './location'
export {
  siteProgress,
  isSiteBuilt,
  tierNeedOf,
  tierRemaining,
  tierBillOf,
  billNeedOf,
  billDeliveredOf,
  billRemainingOf,
  stationBillView,
  stationBillText,
  tierFulfilled,
  deliverStationResources,
  onArriveAtGalaxy,
  playDialogue,
  playerAtSite,
} from './station'
export type { StationBillRow } from './station'
export type { StationSiteProgress } from './state'

export {
  startHauling,
  stopHauling,
  advanceHauling,
  cancelHaulingOnSwitch,
  haulEndpoints,
  dockedHaulEndpoint,
  haulEndpointName,
  haulLegReward,
  haulingOccupiedM3,
  HAUL_RATE_PER_M3_MIN,
} from './hauling'
export type { HaulEndpoint } from './hauling'

export {
  battleWinPreview,
  bountyDamageForecast,
  bountyWinPercentGuarded,
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
  foeClassName,
  foeMainTagOf,
  foeUnitNameOf,
  FOE_LIGHT_WORD,
  createPlayerSpec,
  playerAmmoType,
  typeLayerMult,
  layerMultText,
  BATTLE_STEP_MS,
  BATTLE_MAX_STEPS,
} from './combat'
export type { WeaponSpec, UnitSpec, Hp3 } from './combat'

// 悬赏胜率蒙特卡洛预估（2026-09-09：玩家可见展示口径；旧稳态 bountyWinPercentGuarded 仅兼容遗留调用）
export { BOUNTY_MC_RUNS, buildEvalState, estimateBountyWinOn, estimateBountyWinMC } from './winEstimate'
export type { BountyWinMC } from './winEstimate'

export {
  AI_CORE_ORDER,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  gainAiCore,
  aiCoreCap,
  aiCoreUsed,
  aiCoreShipUsed,
  aiCoreIndustryUsed,
  aiCoreCapBlock,
  industryAiBonus,
  idleAiShipIds,
  buyBasicAiCore,
  assignAiMining,
  assignAiExpedition,
  assignAiSalvage,
  assignAiStandby,
  cancelAiTask,
  advanceAi,
  advanceAiExpedition,
  aiTaskView,
} from './ai'
export type { AiTaskView } from './ai'

export {
  DEFAULT_OFFLINE_CAP_MS,
  offlineSplit,
  formatDurationMs,
  simulateOffline,
} from './simulation'

export {
  newSettleStats,
  addAiMiningTrip,
  addAiSalvageDone,
  addAiRefineBatch,
  addAiMakeDone,
  addAiIncome,
} from './settleStats'
export type { CoreSettleStats, SettleStats } from './settleStats'

export {
  SAVE_FORMAT,
  SaveError,
  serializeSaveFile,
  loadSaveFile,
} from './save'

export {
  ONB_OFF,
  ONB_AWAKEN,
  ONB_MINE,
  ONB_DELIVER,
  ONB_SELL,
  ONB_REPAIR,
  ONB_TRIAL,
  ONB_SKILL,
  ONB_DIVIDE,
  ONB_EPILOGUE,
  ONB_DONE,
  TUTORIAL_DELIVER_ITEM,
  TUTORIAL_DELIVER_N,
  TUTORIAL_MINE_GOAL,
  TUTORIAL_REWARD_ISK,
  TUTORIAL_REWARD_TURRET,
  TUTORIAL_REWARD_AMMO,
  TUTORIAL_REWARD_AMMO_N,
  TUTORIAL_SKILL_ID,
  TUTORIAL_BATTLE_HIT_BONUS,
  TUTORIAL_BATTLE_EVASION_BONUS,
  TASK_ORE_DELIVER,
  TASK_TRIAL_WIN,
  TASK_FIND_HUMANS,
  publishFindHumans,
  tutorialActive,
  tutorialAccelWait,
  isTutorialBattle,
  applyTutorialBuff,
  beginTutorialAfterAwaken,
  deliverTutorialOre,
  claimTutorialTrialReward,
  grantTutorialSkill,
  onTutorialSkillPageOpened,
  advanceOnboardingAuto,
  finishTutorial,
  skipTutorial,
} from './onboarding'
export type { OnboardingState, ImportantTaskState } from './state'

export { advanceEncounterWatch, fightEncounter, fleeEncounter } from './encounters'

export {
  advanceSideTasks,
  sideTaskBoard,
  sideTaskCandidateGoods,
  completeSideTask,
  courierTaskUnlocked,
  courierDelivering,
  startCourierDelivery,
  RESOURCE_TASK_MARGIN,`n  SPAWN_SUPPLY_CUT,
  COURIER_TASK_MARGIN,
} from './sideTasks'
export type { SideTaskBoardView, SideTaskDeliveryView } from './sideTasks'
export type { SideTask, SideTasksState, CourierDeliveryState, GameStateV24 } from './state'
