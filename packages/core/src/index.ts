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
  // 虫洞内敌方选靶模式（船长 2026-09-13 定；`FoeTargetingMode` + 中文名表见 types.ts）
  FoeTargetingMode,
  FoeShipDef,
  FoeShipSlot,
  FoeDroneDef, // 2026-09-11 敌机机型表（舰载机群；设计稿 foe-drone-system-20260911.md）
  FoeDroneSlot, // 舰级上的机群登记条目（引用机型 + 架数）
  FoeReinforceTrigger,
  SimContext,
} from './types'

// 虫洞内敌方选靶模式的中文名（界面/战报/工具读数用；施工期仅调试面板可见）
export { FOE_TARGETING_LABELS } from './types'

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
  // 虫洞锁定判据（洞外开战要避开锁在洞里的锚点船；放 state.ts 避免依赖环）
  shipLockedInWormhole,
  // 主控活动位判据（人在洞里 ⇒ 别的活动开不了）
  wormholePilotHoldReason,
  // 停掉「扫描虫洞」的状态单点（手动停扫与「进洞自动停扫」共用；进度保留）
  wormholeScanHalt,
  // 同款单点：进洞前自动停掉「开采 / 打捞 / 长途运输」与手动停止共用（船长 2026-09-14）
  miningHalt,
  salvageHalt,
  haulingHalt,
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
  // 战报改造（2026-09-14 船长定）：结构化战报的类型
  BattleReportRecord,
  BattleReportSource,
  BattleBreakReason,
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
  // 2026-09-13：未上线闸门（给玩家看的物品目录 vs 引擎全目录）
  itemReleased,
  visibleItemDefs,
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
  repairWithKitsFor,
  useOneRepairKit,
  renameShip,
  hullLayerCaps,
  // 舰船仓库（2026-09-14 船长：舰队页「舰船市场」→「舰船仓库」，组装机产出先入仓、可堆叠）
  shipStoredCount,
  shipOwnedCount,
  shipStorable,
  storeShip,
  unstoreShip,
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

export { warpSpeedAus, travelTimeFactor, travelLegMs, travelMinutesEff, shortestTravelMinutes, shortestTravelPath } from './travel'

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
  // F4d：拆解安全货柜（与精炼/回收同一条产线机器；船长 2026-09-13 定案）
  startUnboxRun,
  UNBOX_CYCLE_MS,
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
  // 组装机卡片排序（2026-09-14 船长「一次性图纸应该和原图纸放在一起」⇒ 纯函数单点）
  MANU_KIND_ORDER,
  sortManuRows,
} from './manufacturing'
export type {
  BuildSpec,
  ManufacturingView,
  ManufacturingLoopView,
  RecipeCapability,
  ManuOrderRow,
} from './manufacturing'

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
  // 舰船仓库出售（2026-09-14 船长「舰船仓库是用于方便市场出售舰船的」）；上面三条是舰队实例版
  // （**自本批起没有界面入口**：舰队出售按钮已撤——保留给老档 escrow 与后续复用）
  sellStoredShipAtMarket,
  placeStoredShipSellOrder,
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
  RECYCLE_POOLS,
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
  recycleRefiningMultiplier,
  recyclePoolMeanIsk,
  recycleBatchValueFromYield,
  recycleBatchValueIsk,
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
  // 2026-09-14 船长：「解锁时发送通讯给玩家（同时也要直接弹窗）」⇒ 弹窗队列两件套
  commsPopupQueue,
  dismissCommsPopup,
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
  haulSecurityMulOf,
  haulExposureAt,
  haulEffectiveMinutes,
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
  // 多舰编队开战（虫洞 D 批 · 船长 2026-09-13「4 艘同时参战」）——既有单船路径并列的第二条入口
  startFleetBattleFor,
  // 敌方选靶模式（虫洞内专属；单船路径一次随机数都不消费）
  pickMyUnitTarget,
  aliveMyUnits,
  myUnitOutputScore,
  isNonCombatShipRole,
  typeLayerMult,
  layerMultText,
  BATTLE_STEP_MS,
  BATTLE_MAX_STEPS,
  // **入场窗口**（船长 2026-09-14「动画没结束不开火」）：界面飞入动画与引擎"不可选中窗口"的
  // **同一个出处**——界面直接 import 这两个数当 `--arrive-ms`，不许再各写一份。
  BATTLE_ARRIVAL_FLY_MS,
  BATTLE_ARRIVAL_STAGGER_MS,
  // 机群战损（2026-09-10 船长「无人机可被击落」+ 永久损失制）
  pdEnabledFor,
  droneLostCount,
  settleDroneLosses,
  // 战报改造（2026-09-14 船长定）：唯一构造点 + 四档判定纯函数
  captureBattleReport,
  battleVerdictOf,
  // 推进器周期爆发（2026-09-10 船长定）：引擎与战斗界面同源读这一个函数
  thrusterPhase,
  effectiveHitMul,
  // 维修脉冲周期（2026-09-11：内容体检「产物说明契约」按它核对说明里的「每 N 秒」）
  REPAIR_PULSE_MS,
  // 护盾充能脉冲周期（2026-09-14 船长新增件：同上，说明里的「每 30 秒」与它同源）
  SHIELD_PULSE_MS,
  shieldPulsePctOf,
  // 无人机技能每级参数（2026-09-11：内容体检「技能说明契约」按它核对技能说明里的每级值）
  DRONE_SKILL,
  // 激光"威力随距离"系数（2026-09-11：属性面板「威力衰减」行改由**引擎同一函数**算，
  // 此前面板用 (1+falloff)/2 自算——旧口径下引擎实际是 ×0.44/×0.48、面板却写 ×0.65/×0.68，属显示值与实战值漂移）
  beamPowerFactor,
} from './combat'
export type { WeaponSpec, WeaponSrc, UnitSpec, Hp3, BattleVerdict } from './combat'

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

// **金额显示单点**（2026-09-13 船长：「更换金钱单位为信用点」＋「希望考虑到钱位数过多时的处理」）：
// 单位名 / 万·亿分级 / 精确值提示 —— 玩家可见金额文案一律走这里（引擎内部字段仍叫 `isk`）。
export {
  MONEY_LARGE_DECIMALS,
  MONEY_UNIT,
  MONEY_WAN_DECIMALS,
  MONEY_WAN_THRESHOLD,
  MONEY_YI_THRESHOLD,
  moneyAmount,
  moneyDelta,
  moneyExact,
  moneyExactText,
  moneyFitCandidates,
  moneyFormatCandidates,
  moneyText,
} from './money'

export {
  newSettleStats,
  addAiMiningTrip,
  addAiSalvageDone,
  addAiRefineBatch,
  addAiMakeDone,
  addAiShipDone,
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
  // 赏金新板提示（船长 2026-09-14：换板未看 ⇒ 导航徽标；进任务中心即记账）
  sideTasksMarkBountySeen,
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

/* ═══ 终局玩法「虫洞」（2026-09-13 开工；施工期对玩家不可见 —— 见 wormhole.ts 头注释） ═══ */
export {
  WORMHOLE_ADMISSION_TEXT,
  WORMHOLE_MAX_SHIPS,
  WORMHOLE_MAX_TIER,
  WORMHOLE_MASS_BY_TIER,
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  WORMHOLE_TURN_BASE,
  WORMHOLE_TURN_MASS_COEF,
  WORMHOLE_TURN_PER_EXTRA_WAVE,
  WORMHOLE_TURN_PER_NODE,
  WORMHOLE_TURN_PER_PICKUP,
  // 临时空间的格数上限（大件货缓冲）
  WORMHOLE_TEMP_CELLS,
  WORMHOLE_TEMP_COLS,
  WORMHOLE_TEMP_ROWS,
  wormholeAdmission,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeShipAllowed,
  wormholeShipMass,
  wormholeSlotsUsed,
  wormholeStepCost,
  wormholeTurnBudget,
  wormholeUnitsPerSlot,
  // C 批：副本状态机（层/节点/回合/撤离）与层曲线
  EMPTY_WORMHOLE_STATE,
  WORMHOLE_THREAT_BASE,
  WORMHOLE_THREAT_PER_LAYER,
  WORMHOLE_REWARD_GROWTH,
  wormholeStartRun,
  wormholeMakeNode,
  // E 批（界面接线）：入洞 / 拾取 / 背包格现算 / 调试放弃
  wormholeEnter,
  wormholeNodePiles,
  wormholeFleetCargoM3,
  wormholeBagSlotsOfFleet,
  wormholeDebugReset,
  WORMHOLE_ORE_ITEM_ID,
  WORMHOLE_PILE_UNITS_BASE,
  wormholeAdvanceNode,
  wormholeDescend,
  // 2026-09-13 船长：侦察舰/电子舰「虫洞扫码 +1 圈（编队即生效、可叠加）」⇒ 编队加成求和
  // 2026-09-14 船长：一处虫洞锁一族（丁 · 族徽）——族表 / 取卡 / 色调
  WORMHOLE_FAMILY_ORDER,
  WORMHOLE_FAMILY_CARD,
  WORMHOLE_FAMILY_GLYPH,
  wormholeFamilyOfSeed,
  wormholeCardIdOfFamily,
  wormholeScanBonusOf,
  wormholeExtract,
  wormholeGridScan,
  wormholeGridTravel,
  wormholeGridActivate,
  WORMHOLE_PLACE_TEXT,
  // 撤离战从第几层起生效（船长 2026-09-13：「撤离战只从第二层开始生效」）
  WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH,
  // 逃生门判据（回合走不动了 ⇒ 撤离放行；撤离与界面按钮共用）
  wormholeOutOfTurns,
  // 进洞门槛与锁定（船长 2026-09-13：主控闲置 / 进洞的船锁定；洞外开战要避开锁定的锚点）
  wormholeEntryBlockReason,
  // 船长 2026-09-14：「进洞自动停止」——扫描虫洞 / 开采 / 打捞 三项会在进洞那一刻自动停掉
  wormholeEntryAutoStops,
  wormholeShipEntryBusy,
  shipBusyForWormhole,
  // 议案 A（船长 2026-09-13 批准）：临时离开 = 活动停止（进度保存）/ 返回要主控空闲 / 忙态判据
  wormholeLeave,
  wormholeResume,
  shipActivityBusy,
  // 沉船扣格：背包超格时按每格价值从低到高丢货（船长 2026-09-13 裁定）
  wormholeTrimBag,
  // F 批：敌卡按层派生
  wormholeFoeThreat,
  wormholeAnomalyOf,
  wormholeCardIdFor,
  WORMHOLE_FOE_CARD_IDS,
  WORMHOLE_BOSS_THREAT_MUL,
  WORMHOLE_EXTRACT_THREAT_MUL,
  // 层末守卫的选靶倾向概率（船长 2026-09-14「挨个定为 60%」）
  WORMHOLE_BOSS_TARGETING_CHANCE,
  WORMHOLE_EXTRACT_THREAT_BASE,
  WORMHOLE_EXTRACT_THREAT_PER_LAYER,
  wormholeExtractThreat,
  wormholeLayerThreat,
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
} from './wormhole'
// 网格探索（F3a · 2026-09-13 船长确认）：几何 / 生成 / 信号遮蔽 / 回合成本
export {
  HEX_DIRS,
  WORMHOLE_EMPTY_MIN_SHARE,
  WORMHOLE_EMPTY_SHARE_FLOOR,
  WORMHOLE_EMPTY_SHARE_PER_DEPTH,
  WORMHOLE_NEBULA_MAX_SHARE,
  WORMHOLE_NEBULA_MIN_DEPTH,
  WORMHOLE_NEBULA_SHARE,
  WORMHOLE_RUINS_SHARE,
  WORMHOLE_SIGNAL_WEIGHTS,
  WORMHOLE_SCAN_RADIUS_BASE,
  WORMHOLE_TURN_PER_ACTIVATE,
  WORMHOLE_TURN_PER_MOVE,
  WORMHOLE_TURN_PER_SCAN,
  disperseNebulae,
  gridCellAt,
  gridContentIndex,
  gridNebulaTargets,
  gridScanTargets,
  gridTally,
  hexDiskAround,
  hexDiskCells,
  hexDiskCount,
  hexDistance,
  hexKey,
  hexNeighbors,
  hexRingAround,
  isExitCell,
  isNebulaFogged,
  parseHexKey,
  revealOf,
  signalOfPlace,
  wormholeEmptyShareFor,
  wormholeGridRadiusFor,
  wormholeMakeGrid,
  wormholeRuinsFloorFor,
  // 2026-09-14 船长：内容原型（丙）——五档 + 权重 + 按原型重分配信号权重/遗迹占比/遗迹下限
  WORMHOLE_ARCHETYPES,
  WORMHOLE_ARCHETYPE_WEIGHTS,
  WORMHOLE_ARCHETYPE_LABELS,
  wormholeArchetypeOf,
  wormholeSignalWeightsFor,
  wormholeRuinsShareFor,
  wormholeRuinsFloorBonusFor,
} from './wormholeGrid'
export type {
  HexCell,
  WormholeCellPile,
  WormholeCellReveal,
  WormholeGridCell,
  WormholeGridState,
  WormholePlace,
  WormholeSignal,
} from './wormholeGrid'

// F 批：洞内战斗（开战 / 每拍推进收口）——单开模块，避免 state→wormhole→shipyard→hauling→state 的循环初始化
export { wormholeStartBattle, wormholeActivateAt, wormholeTravelTo, advanceWormhole, wormholeBattleViewOf } from './wormholeBattle'
// F3b：层内产出与打捞（打捞器门槛 / 墓场·遗迹打捞 / 专属掉落 / 舰船信号战果 / 矿脉）
export {
  WORMHOLE_FAMILIES,
  WORMHOLE_GRAVEYARD_COMMONS_MAX,
  WORMHOLE_GRAVEYARD_COMMONS_MIN,
  WORMHOLE_RARE_JUDGE_CHANCE,
  WORMHOLE_RARE_JUDGE_PER_COMMONS,
  WORMHOLE_RELIC_CHANCE_BASE,
  WORMHOLE_RELIC_CHANCE_CAP,
  WORMHOLE_RELIC_CHANCE_GROWTH,
  WORMHOLE_RELIC_MIN_DEPTH,
  wormholeRelicChanceOf,
  WORMHOLE_RUINS_BATTLE_CHANCE,
  WORMHOLE_RUINS_RARES_MAX,
  WORMHOLE_RUINS_RARES_MIN,
  WORMHOLE_SHIP_SPOIL_COMMONS,
  WORMHOLE_SHIP_SPOIL_RARES,
  WORMHOLE_VEIN_PILES_MAX,
  WORMHOLE_VEIN_PILES_MIN,
  WORMHOLE_WRECK_PILE_M3_BASE,
  wormholeCellCardIdOf,
  wormholeDeliverRelics,
  wormholeEnsureSalvagePiles,
  wormholeEnsureVeinPiles,
  // F5（船长 2026-09-13）：到达即铺堆（不用激活）+ 采集器门槛（虚空母矿）——打捞/采集同构
  wormholeEnsureArrivalPiles,
  wormholeMinersOf,
  wormholeCollectOreAt,
  wormholeFamilyPoolGaps,
  wormholeFamilyPoolOf,
  // 稀释池（2026-09-13 船长：「将新增的一次性蓝图放入虫洞的专属奖池内作为稀释」，70:30 + 按层分档）
  WORMHOLE_DILUTION_SHARE,
  WORMHOLE_DILUTION_MIN_DEPTH,
  wormholeDilutionPoolOf,
  /** F4d：拆解货柜用的层档（一律最低档） */
  WORMHOLE_DILUTION_MIN_DEPTH_FLOOR,
  wormholeUnboxRoll,
  wormholeFamilyOfBox,
  wormholeLootShares,
  // 图纸货柜（2026-09-14 船长：遗迹打捞新增 · 占 2 格 · 一次性图纸 + 5% 永久图纸）
  WORMHOLE_BP_BOX_SHALLOW,
  WORMHOLE_BP_BOX_MID,
  WORMHOLE_BP_BOX_DEEP,
  WORMHOLE_BP_BOX_IDS,
  WORMHOLE_BP_BOX_DEPTH,
  WORMHOLE_BPBOX_SHARE,
  WORMHOLE_BPBOX_PERMANENT_CHANCE,
  WORMHOLE_PERMANENT_MIN_DEPTH,
  wormholeBpBoxIdOf,
  wormholeBpBoxDepthOf,
  // AI 核心（2026-09-14 船长：遗迹打捞 10% 掉落 · 60/30/10 权重 · 各占 1 格 · 撤离后入核心账）
  WORMHOLE_CORE_GAMMA,
  WORMHOLE_CORE_BETA,
  WORMHOLE_CORE_ALPHA,
  WORMHOLE_CORE_ITEM_IDS,
  WORMHOLE_CORE_TYPE,
  WORMHOLE_CORE_SHARE,
  WORMHOLE_CORE_WEIGHTS,
  wormholeCoreItemIdOf,
  wormholeCoreTypeOfItemId,
  wormholeRollCore,
  wormholePermanentPoolOf,
  // 池内一件"一次到手几个"（族专属无人机 ×10；货柜 1）——拆解批与入库共用一份口径
  wormholePoolGrantUnitsOf,
  wormholeGrantShipSpoils,
  // F4：货仓格（超载 / 装舱 / 抛弃 / 拾取入口）——住在 wormholeSalvage
  wormholeHoldCapacityOf,
  wormholeHoldDiscard,
  wormholeHoldOverloaded,
  wormholeHoldStow,
  wormholeHoldUsage,
  wormholeDiscardCargo,
  wormholeDiscardToFit,
  wormholeOverloadBlockReason,
  wormholeTempBlockReason,
  wormholeActionBlockReason,
  wormholeTakePileAt,
  // 临时空间（船长 2026-09-13：大件货先进临时空间，让玩家协调 → 2026-09-14：4×8 = 32 格的格子区）
  wormholeTempUsage,
  wormholeTempPending,
  wormholeTempAddShape,
  wormholeTempStowPiece,
  wormholeTempDiscardPiece,
  wormholeTempStowAll,
  wormholeTempDiscardAll,
  wormholeTempBoard,
  wormholeNormalizeLegacyTemp,
  wormholeSyncMatterTurns,
  wormholeStowOrTemp,
  // 散货占格（船长 2026-09-13：「必须是矩形」⇒ 全仓唯一一把尺）
  wormholeCargoCellsOf,
  wormholeCargoSlotsOf,

  wormholeRelicWeightsOf,
  wormholeRollRelicBox,
  wormholeRelicBoxIdOf,
  wormholeSalvageAt,
  wormholeSalvagersOf,
} from './wormholeSalvage'
// 虫洞扫描（发现线 · 2026-09-14 船长：主控活动「扫描虫洞」+ 最多囤 5 个未探索虫洞）
export {
  WORMHOLE_SCAN_BASE_MS,
  WORMHOLE_SCAN_UNLOCK_STANDING,
  // 2026-09-14 船长：内容原型（丙）+ 敌族锁定（丁）+ 放弃已发现的虫洞
  wormholeStockDiscard,
  wormholeStockMeta,
  WORMHOLE_STOCK_MAX,
  WORMHOLE_STOCK_DEPTHS,
  wormholeScanStanding,
  wormholeScanUnlocked,
  wormholeScanWindowMs,
  wormholeScanBlockReason,
  wormholeScanStart,
  wormholeScanStop,
  wormholeStockOf,
  wormholeStockFull,
  wormholeStockPush,
  wormholeStockTake,
  advanceWormholeScan,
} from './wormholeScan'
export type { WormholeScanState, WormholeStockItem, WormholeArchetype, WormholeFamily } from './state'
// 自动探索（发现线批次 3 · 2026-09-14 船长：最多 4 条副船各占 1 枚 AI 核心 · 5 分钟 · 收益 40% 入仓库 · 绝不丢船）
export {
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_MAX_SHIPS,
  WORMHOLE_AUTO_YIELD_MUL,
  WORMHOLE_AUTO_MANUAL,
  WORMHOLE_AUTO_HULL_FLOOR,
  WORMHOLE_AUTO_DAMAGE_MIN,
  WORMHOLE_AUTO_DAMAGE_MAX,
  WORMHOLE_AUTO_REPORT_MAX,
  wormholeAutoRunsOf,
  wormholeAutoReportsOf,
  wormholeAutoUnconfirmedCount,
  shipInWormholeAuto,
  wormholeAutoRunOfStock,
  wormholeAutoShipBlockReason,
  wormholeAutoCandidates,
  wormholeAutoDefaultShips,
  wormholeAutoCoreBlock,
  wormholeAutoBlockReason,
  wormholeAutoFreeCores,
  wormholeAutoMainHandover,
  wormholeAutoStart,
  wormholeAutoStop,
  wormholeAutoStopByShip,
  advanceWormholeAuto,
  wormholeAutoConfirmReport,
  wormholeAutoConfirmAll,
  wormholeAutoArchetypeMul,
  WORMHOLE_AUTO_ARCHETYPE_WEIGHTS,
  wormholeRunMeta,
  shipNameOf,
} from './wormholeAuto'
export type { WormholeAutoRun, WormholeAutoReport } from './state'
export type { WormholeAutoCandidate, WormholeAutoHandover } from './wormholeAuto'
// F4：货仓格管理（船长 2026-09-13：货仓直接代表背包大小 + 背包英雄式格管理）
export {
  WORMHOLE_HOLD_COLS,
  WORMHOLE_CARGO_BAR_MAX,
  WORMHOLE_SHAPE_CONTAINER,
  WORMHOLE_SHAPE_STACK,
  // AI 核心（1×1 = 1 格 · 2026-09-14 船长「AI 核心单独占 1 格」）
  WORMHOLE_SHAPE_CORE,
  WORMHOLE_HOLD_SHAPES,
  canPlace,
  cargoBlockArea,
  cargoShapeFits,
  cargoShapesFor,
  findFreeSpot,
  holdAdd,
  holdCellsUsed,
  holdCompact,
  holdDropWithGrab,
  holdTransferTo,
  pickDropSpot,
  holdMove,
  holdRemove,
  holdSwap,
  holdRows,
  makeHoldState,
  placementCells,
  placementCellsCount,
  wormholeIsShapedItem,
  wormholeShapeOf,
} from './wormholeHold'
// F3c：谜质储存器（A 批 = 探索与作业类 7 台；效果一律从货仓现算，随趟消失）
export {
  WORMHOLE_MATTER_DEVICES,
  WORMHOLE_MATTER_DEVICE_IDS,
  WORMHOLE_MATTER_BUFFS_NONE,
  wormholeMatterDeviceOf,
  wormholeIsMatterDevice,
  wormholeMatterCounts,
  wormholeMatterBuffs,
  wormholeMatterDeviceAt,
  wormholeMatterTurnDeltaOf,
  wormholeMatterApplyTurnDelta,
  wormholeMatterDiscardHint,
  wormholeMatterThreatMul,
  WORMHOLE_MATTER_THREAT_FLOOR_MUL,
  WORMHOLE_MATTER_EVASION_CAP,
  WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP,
  WORMHOLE_MATTER_RESIST_CAP,
} from './wormholeMatter'
export type { WormholeMatterDevice, WormholeMatterEffectKind, WormholeMatterBuffs } from './wormholeMatter'

export type { WormholeFamilyPool, WormholeSalvageResult } from './wormholeSalvage'
export type { WormholeHoldPlacement, WormholeHoldShape, WormholeHoldState } from './wormholeHold'
export type {
  WormholeActivateEffect,
  WormholeAdmission,
  WormholeAdmissionCode,
  WormholeBagSlot,
  WormholeTempSlot,
  WormholeGridActionResult,
  WormholePile,
  WormholeFoeKind,
  WormholeState,
  WormholeRunState,
  WormholeNode,
  WormholeNodeKind,
  WormholePhase,
  WormholeSettleRecord,
  WormholeStartResult,
  WormholeAdvanceResult,
} from './wormhole'

