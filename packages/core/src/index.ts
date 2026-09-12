/**
 * @whale/core 对外统一出口。
 * 其他包（data / ui / desktop / 未来服务端）只允许从这里 import。
 */

export type {
  SkillDef,
  SkillCatalog,
  ItemDef,
  ItemKind,
  DroneClass, // 2026-09-10 无人机分类（侦察机/战斗机/攻坚机/哨戒机）
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
  CommsMessageDef,
  CommsTrigger,
  CommsReplyDef,
  CommsJumpPage,
  CommsEntryView,
  CommsFactionDef,
  CommsDeptDef,
  CommsFactionAlignment,
  CommsKind,
  CommsActionDef,
  CommsActionCommand,
  AiCoreType,
  BalanceConfig,
  MarketRarity,
  MarketGoodKind,
  MarketGoodDef,
  MarketBalance,
  BattleBalance,
  FoeTactic,
  DefProfile,
  FoeShipDef,
  FoeShipSlot,
  FoeDroneDef, // 2026-09-11 敌机机型表（舰载机群；设计稿 foe-drone-system-20260911.md）
  FoeDroneSlot, // 舰级上的机群登记条目（引用机型 + 架数）
  FoeReinforceTrigger,
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
  ManufacturingLoopState,
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
  DroneLossReport,
} from './state'

export {
  ITEM_KIND_ORDER,
  ITEM_KIND_LABELS,
  itemKindLabel,
  // 2026-09-10 无人机分类并入「种类」显示（无人机 · 侦察机；市场/仓库/图鉴/手册单点）
  DRONE_CLASS_LABELS,
  itemKindText,
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
  // 推进器周期口径文案（与 balance.battle 同源）
  thrusterCycleSeconds,
  thrusterCycleText,
  thrusterCycleFullText,
} from './labels'
export type { RackSlot, ShipSlots } from './types'

export { hashSeed, nextRandom, nextInt, pickOne, pickWeighted } from './rng'

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
  freeCargoM3Of,
  unloadCargoToWarehouse,
  unloadCargoOfShipToWarehouse,
  loadWarehouseToCargo,
  loadWarehouseToCargoFit,
} from './inventory'

export {
  MODULE_SLOTS,
  slotLabel,
  effectiveCpu,
  // 2026-09-11 协处理器：CPU 预算总额（船体 + 协处理器）与超载预演、换装
  cpuBudgetOf,
  cpuOverloadText,
  swapModuleAt,
  countModule,
  addModule,
  removeModule,
  fitModule,
  unfitSlot,
  unfitAt,
  adjustDroneLoad,
  setAmmoTier, // 2026-09-09 弹药 MK2：出战前选档（装配页按弹族设基础/MK2）
  fittedBonuses,
  fittedCpuUsed,
  // 2026-09-08 无人机舱大改：装载清单 CPU/体积（装配页预算条、装配校验、战斗装载同源）
  droneCpuUsed,
  droneLoadM3,
  // 2026-09-10 船长：卸下甲板扩展等导致机舱变小 → 超出容量的无人机自动卸下并退回仓库
  trimDroneLoadToBay,
  // 2026-09-10 船长（G 族专属无人机）：物品持有总数（仓库 + 各船机舱）——「集齐前不重复掉落」判定口径
  ownedItemCount,
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
  hullLayerCaps,
} from './shipyard'

export { fleetDefOf, shipDisplayName } from './instances'

/** 承伤口径单点（按敌火扣装甲/结构；低安遇袭与战斗撤退共用——见 hullDamage.ts） */
export {
  HULL_FLOOR_FRAC,
  foeFirepowerDps,
  firepowerHitHp,
  applyArmorFirstDamage,
  hitDamageText,
  pctOf as hullPctOf,
} from './hullDamage'
export type { HullHit } from './hullDamage'

export { markedIds, isMarked, markTargetExists, toggleMark, clearMarks, pruneMarks, MARK_KIND_TEXT } from './marks'
export type { MarkKind } from './marks'

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
  SEC_FLOOR,
  maxScanWindowMs,
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
  manufacturingLoopOf,
  advanceManufacturing,
  manufacturingRunViews,
  manufacturingManualActive,
  findBuildable,
  // 一次性图纸（2026-09-12 船长）：可用性判定 / 是否一次性 / 蓝图定义 / 开工可行性
  recipeCapability,
  isSingleUseBlueprint,
  blueprintDefOf,
  canStartBlueprint,
  oneTimeBookInUse,
} from './manufacturing'
export type { BuildSpec, ManufacturingView, ManufacturingLoopView, RecipeCapability } from './manufacturing'

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
  // 2026-09-11 挂买单预扣：能不能挂（原因给界面用）
  buyOrderBlockedReason,
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
  // 赏金任务·稀有残骸（窝点战果：必得 + 高级箱额外掉落）
  RARE_WRECK_VOLUME_M3,
  rareWreckItemIdOf,
  rareWreckItemDefOf,
  isRareWreck,
  injectRareWreck,
  rareWreckCountOf,
  pullRareWreck,
  RARE_BOX_GEAR_CHANCE,
  RARE_BOX_DRONE_UNITS,
  RARE_BOX_MINERAL_UNITS,
  recycleMineralPoolOf,
  rollRareBoxExtra,
  wreckItemDefOf,
  wreckBaseDensity,
  wreckDensityOf,
  injectWreckDensity,
  // 2026-09-10 残骸注入按敌人数加成 / 基础密度按各星系悬赏 20 次 / 遇袭按最强卡 0.5（船长拍板）
  bountyEnemyCount,
  bountyWreckInjection,
  strongestBountyInjection,
  WRECK_INJECT_ENEMY_BONUS,
  WRECK_BASE_BOUNTY_RUNS,
  WRECK_ENCOUNTER_INJECT_FRAC,
  RECYCLE_TIER_COEF,
  RECYCLE_TIER_RISKY,
  RECYCLE_TIER_DIRE,
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
  fragmentPoolOf,
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
  stationSiteAtGalaxy,
  isGalaxyStationBuilt,
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
/* 通讯收件箱（2026-09-11 船长定：NPC 发消息补充剧情与任务提示） */
export {
  COMMS_DAY_MS,
  COMMS_REPLIES_ENABLED,
  advanceComms,
  commsDialogueKey,
  commsGameClock,
  commsInbox,
  commsTriggerMet,
  commsUnreadCount,
  deliverDialogueToComms,
  markAllCommsRead,
  markCommsRead,
  runCommsAction,
} from './comms'
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
  haulLegMinutesOf,
  haulBaseReward,
  haulRewardRange,
  HAUL_TRIP_MUL_MIN,
  HAUL_TRIP_MUL_MAX,
  haulingOccupiedM3,
  HAUL_RATE_PER_M3_MIN,
  HAUL_LEG_TIME_MUL,
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
  // 主武器（战术距离口径；船长 2026-09-12 裁定「甲」= 射程最远的武器）——三按钮/发射前战术/界面射程带共用
  mainWeaponOf,
  // 2026-09-11 船长：目标距离按星系独立保存——单点读写（实战开战 / 胜率预估 / 界面共用）
  desirePrefOf,
  setDesirePrefOf,
  foeDesiredRange,
  // 敌机有效射程（2026-09-11 船长「受击后大幅提高无人机射程（提高 400%）」）——开火判定与界面同源
  foeDroneRangeOf,
  // 敌舰炮台有效射程（2026-09-12 船长：D 族静滞卫舰「挨打后射程增加 50%」，仅该型舰）——同上，开火判定与界面同源
  foeGunMaxRangeOf,
  foeGunRangeMulOf,
  mergeResist,
  foeMainDamageType,
  // 2026-09-10 船长（窝点混伤）：敌方火力构成单点（战斗 / 胜率预估 / 任务卡文案同源）
  foeDamageComposition,
  splitShotByComposition,
  applyFoeShot,
  createFoeSpecs,
  foeLayerSplit,
  foeClassName,
  foeMainTagOf,
  foeUnitNameOf,
  foeShipTierOf,
  foeShipEliteOf,
  FOE_LIGHT_WORD,
  FOE_ELITE_WORD,
  createPlayerSpec,
  playerAmmoType,
  typeLayerMult,
  layerMultText,
  BATTLE_STEP_MS,
  BATTLE_MAX_STEPS,
  // 机群战损（2026-09-10 船长「无人机可被击落」+ 永久损失制）
  pdEnabledFor,
  droneLostCount,
  settleDroneLosses,
  // 推进器周期爆发（2026-09-10 船长定）：引擎与战斗界面同源读这一个函数
  thrusterPhase,
  effectiveHitMul,
  // 维修脉冲周期（2026-09-11：内容体检「产物说明契约」按它核对说明里的「每 N 秒」）
  REPAIR_PULSE_MS,
  // 无人机技能每级参数（2026-09-11：内容体检「技能说明契约」按它核对技能说明里的每级值）
  DRONE_SKILL,
  // 激光"威力随距离"系数（2026-09-11：属性面板「威力衰减」行改由**引擎同一函数**算，
  // 此前面板用 (1+falloff)/2 自算——旧口径下引擎实际是 ×0.44/×0.48、面板却写 ×0.65/×0.68，属显示值与实战值漂移）
  beamPowerFactor,
} from './combat'
export type { WeaponSpec, WeaponSrc, UnitSpec, Hp3 } from './combat'

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
  ONB_BRIEFING,
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
  startTutorialFromBriefing,
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
  settleBountyTaskVictory,
  BOUNTY_ZONE_PLAN,
  securityZoneOf,
  factionGalaxyId,
  isFactionBounty,
  factionPoolOf,
  BOUNTY_BOARD_PERIOD_MS,
  bountyDayStartWallMs,
  bountyBoardRemainingMs,
  RESOURCE_TASK_MARGIN,
  SPAWN_SUPPLY_CUT,
  COURIER_TASK_MARGIN,
  BOUNTY_TASKS_PER_ROUND,
} from './sideTasks'
export type { SideTaskBoardView, SideTaskDeliveryView, SecurityZone } from './sideTasks'
export type { SideTask, SideTasksState, CourierDeliveryState, GameStateV24, MarksState } from './state'
export { emptyMarks } from './state'

/* 赏金任务 · 敌人窝点（2026-09-10）：档位派生、名称、酬金与稀有残骸件数常量 */
export {
  FOE_LAIR_TIERS,
  FOE_LAIR_GEAR,
  lairGearOf,
  LAIR_THREAT_MUL,
  LAIR_REWARD_MUL,
  LAIR_ESCORT_BONUS,
  LAIR_WAVES,
  LAIR_TASK_REWARD_MUL,
  LAIR_RARE_WRECK_GAIN,
  LAIR_TIER_LABELS,
  FACTION_BOUNTY_REWARD_MUL,
  FACTION_BOUNTY_THREAT_MUL,
  FACTION_RARE_DROP_CHANCE,
  FACTION_RARE_DROP_COUNT,
  FACTION_RARE_DROP_PITY_ROLLS,
  factionRareDropEffectiveRate,
  factionAnomalyOf,
  factionBaseRewardIsk,
  hasLairCore,
  isLairCandidate,
  lairCoreOf,
  lairTierWordOf,
  lairNameOf,
  LAIR_LEVEL_DEFAULT,
  lairLevelOf,
  lairTiersOf,
  lairBaseRewardIsk,
  lairTaskRewardIsk,
  lairAnomalyOf,
  // 2026-09-10 船长（混伤）：窝点副系与配比常量（内容体检 / 界面 / 测试同源）
  LAIR_SUB_DMG_SHARE,
  // 2026-09-11 船长「E 族单独调整，包括 E 族赏金任务的伤害比例」：逐族副系份额覆写（E = 5:5）
  LAIR_SUB_DMG_SHARE_BY_FAMILY,
  FOE_SUB_DMG,
  foeMainDamageTypeOf,
  subDamageTypeOf,
} from './lairs'
export type { LairTier } from './lairs'
