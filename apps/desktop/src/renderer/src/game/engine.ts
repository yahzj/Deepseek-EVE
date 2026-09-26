/**
 * 界面侧引擎封装（胶水层）——M1 版。
 *
 * 职责（中文说明）：
 * 1. 启动流程：读档（没有则开新档）→ 有旧档就结算离线时间 → 每秒把真实流逝时间
 *    交给核心引擎推进（技能训练 + 采矿并行）→ 每 15 秒自动保存；
 * 2. 把玩家动作（训练/开采/精炼/出售/买船/重置…）翻译成核心引擎指令；
 * 3. 状态一变就通知界面刷新（subscribe）。
 */
import {
  MAX_SKILL_LEVEL,
  SaveError,
  addLog,
  aiCoreName,
  advanceAutoLoopBounty,
  advanceGame,
  fightEncounter,
  fleeEncounter,
  formatDurationMs,
  itemReleased, // 2026-09-13 施工期闸门：未上线内容不进"给玩家看的"目录枚举
  assignAiExpedition,
  assignAiStandby,
  assignAiMining,
  assignAiSalvage,
  buyAtMarket,
  buyBasicAiCore,
  buyShip,
  cancelAiTask,
  cancelManufacturing,
  cancelOrder,
  /** 「第一次」任务：点「完成」推进（2026-09-21 船长令改成手动完成） */
  claimFirstTask,
  cancelStandby,
  changeShip,
  clearSkillQueue,
  createInitialState,
  enqueueSkill,
  fitModule,
  adjustDroneLoad,
  setAmmoTier, // 2026-09-09 弹药 MK2：出战前选档（装配页按弹族设基础/MK2）
  goStandbyAt,
  goodLockedReason,
  // 2026-09-11 市价买入失败原因分诊（暗市闸口径与界面同源，对玩家按声望锁措辞）
  bmGateReason,
  learnBlueprint,
  // 2026-09-19 玩家报障修：碎片 → 蓝图（逆向解锁）的兑命令与读数单点
  redeemFragments,
  fragmentRedeemRowsOf,
  listSellHolding,
  loadSaveFile,
  loadWarehouseToCargoFit,
  lockShip,
  marketQuote,
  goodName,
  marketSellHolding,
  marketSellPreview,
  newSettleStats,
  offlineSplit,
  placeBuyOrder,
  buyOrderBlockedReason,
  recallExpedition,
  refineRunViews,
  moveQueueItem,
  removeQueueAt,
  renameShip,
  migrateDeprecatedAmmo,
  repairDeprecatedModules,
  repairShip,
  useOneRepairKit,
  retreatBattle,
  retreatEncounterBattle,
  sellCargoItem,
  sellCargoItemQty,
  sellStoredShipAtMarket,
  sellWareItem,
  discardWareQty,
  sellWareItemQty,
  serializeSaveFile,
  shipDisplayName,
  // 舰船仓库（2026-09-14 船长）
  storeShip,
  unstoreShip,
  setBattleDesire,
  setMiningAutoCycle,
  setMiningStopAfterTrip,
  simulateOffline,
  setManufacturingLoop,
  startExpedition,
  startExpeditionFromMining,
  startManufacturing,
  startMining,
  startMiningFromExpedition,
  startRefineRun,
  startRecycleRun,
  startUnboxRun,
  startSalvageOp,
  setSalvageAutoCycle,
  setSalvageStopAfterTrip,
  wreckGroupStocksOf,
  wreckTargetsOf,
  startScan,
  startTransitHome,
  startSiteDeliverTrip,
  cancelSiteDeliverTrip,
  stopRefineRun,
  deliverStationResources,
  playDialogue,
  commsInbox,
  commsUnreadCount,
  commsPopupQueue,
  dismissCommsPopup,
  markCommsRead,
  markAllCommsRead,
  completeSideTask,
  sideTaskBoard,
  sideTasksMarkBountySeen,
  // 导航「任务中心」的推进提醒（2026-09-20 船长令）：判定与记账单点都在 core
  firstTaskNotice,
  firstTasksMarkSeen,
  courierTaskUnlocked,
  courierDelivering,
  startCourierDelivery,
  // 主控活动切换的单点判据（2026-09-21 船长令；见 `withActivitySwitch`）
  ACTIVITY_CONFIRM_ID,
  haltCurrentActivity,
  acceptCourierTask,
  abandonAcceptedCourierTask,
  stopMining,
  stopSalvageOp,
  stopScan,
  setAutoLoopBounty,
  /* 入侵「重复出击」（2026-09-25 船长令） */
  autoLoopInvasionGalaxy,
  setAutoLoopInvasion,
  advanceAutoLoopInvasion,
  unfitSlot,
  unfitAt,
  // 2026-09-11 协处理器：CPU 预算总额（含扩容）/ 超载预演 / 原子换装
  cpuBudgetOf,
  cpuOverloadText,
  swapModuleAt,
  // 装配方案（预设）：保存当前装配 / 套用 / 改名 / 删除 / 一键卸下（2026-09-14 船长）
  applyFitPreset,
  deleteFitPreset,
  renameFitPreset,
  saveFitPreset,
  overwriteFitPreset,
  unfitAllModules,
  unloadCargoToWarehouse,
  unloadCargoOfShipToWarehouse,
  // 「第一次」任务系列的链奖金（面板上的领奖按钮）
  claimChainReward as claimChainRewardCore,
  beginAfterAwaken,
  skipPrologue,
  ONB_AWAKEN,
  // 悬赏胜率蒙特卡洛预估（2026-09-09：玩家可见展示口径；预热缓存）
  BOUNTY_MC_RUNS,
  buildEvalState,
  estimateBountyWinOn,
  // 2026-09-09 长途运输
  startHauling,
  stopHauling,
  haulEndpoints,
  haulEndpointName,
  haulLegReward,
  haulingOccupiedM3,
  cargoCapacityM3,
  warpSpeedAus,
  HAUL_RATE_PER_M3_MIN,
  // 2026-09-10 玩家标记（收藏）
  toggleMark,
  // 终局玩法「虫洞」（E 批：入洞 / 拾取 / 推进 / 深入 / 撤离；✅ 2026-09-14 已上线，入口常驻）
  bumpIronmanSeq,
  // 2026-09-23 周末入侵（M1-b：引擎每拍推进入侵时间轴）
  weekendTick,
  // 2026-09-25 修「快进不刷新入侵」：入侵时钟 = 真实墙钟与游戏模拟墙钟取大者（见周末模块的 weekendClockOf）
  weekendClockOf,
  weekendBountyCardsOf,
  // 2026-09-25 船长裁决「甲」：板面同星系只出一条入侵悬赏（去重单点在 core）
  weekendBoardRowsOf,
  // 2026-09-25 修"串星系"：出发归属以界面上那一行为准（同 id 多星系按 id 反查会串）
  weekendLaunchGalaxyOf,
  weekendAssaultDrawOf,
  weekendNoteAssaultDispatch,
  weekendOccupiedLiveAt,
  weekendFlagshipSpecOf,
  weekendFlagshipSquadOf,
  weekendStartFlagshipBattle,
  weekendFlagshipPrepView,
  /** 2026-09-25：旗舰战的战斗宿主（心跳变速 / 分桶 / 撤退分流 / 战斗屏都用它） */
  weekendFlagshipBattleActive,
  // 2026-09-25 入侵结束结算（贡献奖四档入账；幂等由 core 侧 `prizePaidAtWallMs` 落盘标记保证）
  weekendSettleAndGrant,
  // 2026-09-25 入侵两封通讯（预警 / 结算；每场覆盖同一 id，幂等在 core）
  weekendSyncComms,
  ironmanLoadVerdict,
  ironmanOn,
  ironmanSeq,
  // 2026-09-23 铁人模式（S4b 界面口径：开关 / 转换 / 关闭 / 救援档龄）
  IRONMAN_RESCUE_MIN_AGE_MS,
  closeIronman,
  enterIronman,
  ironmanClosed,
  ironmanEver,
  // 2026-09-24 模式选择（船长令：旧档未选择者弹一次、关闭铁人走警告弹窗）
  ironmanModeChosen,
  markModeChosenAsStandard,
  wormholeEnter,
  wormholeTakePileAt,
  wormholeHoldUsage,
  wormholeDiscardToFit,
  wormholeHoldDiscard,
  wormholeDiscardCargo,
  wormholeActionBlockReason,
  wormholePendingBattleReason,
  wormholeHoldStow,
  wormholeHoldCapacityOf,
  wormholeTempUsage,
  wormholeTempStowPiece,
  wormholeTempDiscardPiece,
  wormholeTempStowAll,
  wormholeTempDiscardAll,
  wormholeTempPending,
  wormholeTempBoard,
  wormholeNormalizeLegacyTemp,
  wormholeScanStart,
  wormholeScanStop,
  wormholeScanWindowMs,
  wormholeScanBlockReason,
  // 2026-09-14 船长：「进洞自动停止」——进洞门槛 + 会被自动停掉的活动（扫描虫洞）
  wormholeEntryBlockReason,
  wormholeEntryAutoStops,
  wormholeShipEntryBusy,
  // 2026-09-14 船长：扫描虫洞要协会声望 40 才解锁（先定 35、当日改判 40；解锁发通讯 + 直接弹窗）
  wormholeScanStanding,
  wormholeScanUnlocked,
  // 自动探索（批次 3 · 2026-09-14 船长逐条定案：5 分钟 · 收益 40% 入仓库 · 绝不丢船 · 报告需确认）
  wormholeAutoRunsOf,
  wormholeAutoReportsOf,
  wormholeAutoUnconfirmedCount,
  wormholeAutoCandidates,
  wormholeAutoBlockReason,
  wormholeAutoMainHandover,
  wormholeAutoFreeCores,
  aiCoreCap,
  wormholeAutoStart,
  wormholeAutoStop,
  wormholeAutoConfirmReport,
  wormholeAutoConfirmAll,
  wormholeStockOf,
  wormholeStockTake,
  // 2026-09-19「取消固定种子」：进洞时把库存项承诺的族/原型显式带进本趟（种子改成现掷，见 freshLayerSeed）
  wormholeFamilyOfSeed,
  wormholeArchetypeOf,
  wormholeStockDiscard,
  wormholeStockMeta,
  WORMHOLE_FAMILY_CARD,
  wormholeFamilyIntel,
  WORMHOLE_STOCK_MAX,
  holdTransferTo,
  makeHoldState,
  wormholeSyncMatterTurns,
  WORMHOLE_TEMP_CELLS,
  holdCompact,
  holdDropWithGrab,
  holdSwap,
  holdMove,
  wormholeGridActivate,
  wormholeGridScan,
  wormholeScanBonusOf,
  wormholeTravelTo,
  wormholeDescend,
  wormholeExtract,
  wormholeLeave,
  wormholeResume,
  wormholeActivateAt,
  wormholeStartBattle,
  wormholeDebugReset,
  acknowledgeScanView,
  // 谜质科技（2026-09-19）：研究入口 / 洞内倍速档位
  researchMatterTech,
  matterTechCanResearch,
  matterTechLevels,
  matterTechEssenceHeld,
  matterTechNodes,
  matterTechCostAt,
  matterTechBattleSpeedTiers,
  matterTechScanCut,
  offlineCapMsOf,
  /** 技能前置按等级（2026-09-23 船长令）：一键补齐计划 ＋ 取消级联计划 */
  planPrereqChain,
  skillCancelImpact,
} from '@whale/core'
import type {
  AiCoreType,
  BountyWinMC,
  CommandResult,
  FitPresetApplyResult,
  UnfitAllResult,
  DamageType,
  GameState,
  LairTier,
  MarkKind,
  ModuleSlot,
  RackSlot,
  RefineRunView,
  FragmentRedeemRow,
  SellResult,
  SettleStats,
  SideTask,
  SimContext,
  WormholeArchetype,
  WormholeFamily,
  WormholeFamilyIntel,
  WormholeAutoCandidate,
  WormholeAutoHandover,
  WormholeAutoReport,
  WormholeAutoRun,
  WormholeHoldPlacement,
  TrainingItem,
} from '@whale/core'
import { BELTS, BLUEPRINTS, GALAXIES, GALAXY_EDGES, ANOMALIES_FLAVORED, ITEMS, MODULES, SHIP_BLUEPRINTS, SHIPS, SKILL_GROUPS, SKILLS, DIALOGUES, EN_SHIPS, buildSimContext, overlayList, EN_MODULES, EN_ITEMS_ALL, EN_SKILLS, EN_ANOMALIES, EN_BLUEPRINTS, EN_SHIP_BLUEPRINTS, EN_FOE_SHIPS, EN_GALAXIES, EN_BELTS, EN_STATIONS, EN_COMMS_FACTIONS, overlayCardFoes, overlayCardFoesList, type L10nLocale } from '@whale/data'
import { saveBridge } from './storage'
/** 存档存储体检与告警（2026-09-25 船长令：修「MacBook · Safari 关掉游戏后存档丢失」） */
import { noteSaveWriteFailed, probeSaveStorage, requestPersistentStorage, saveStorageProbe } from './saveGuard'
import { perfHub } from './perf'
import type { PerfBucket } from './perf'
import { tr, cmdText, paramText } from '../i18n/locale'

type Listener = () => void

/* ═══════════════ 离线简报（B4）：启动离线结算前后的轻量对比 ═══════════════ */

/** 离线结算前的快照（只抄需要对比的字段，避免大对象） */
interface OfflineSnapshot {
  gameMs: number
  isk: number
  trained: Record<string, number>
  warehouse: Record<string, number>
  cargo: Record<string, number>
  moduleBay: Record<string, number>
  /** 舰船仓库（组装机产出的船 2026-09-14 起入这里，不进舰队 ⇒ 舰队 diff 看不见它们） */
  shipStore: Record<string, number>
  fleetKeys: string[]
  learned: string[]
  logCount: number
}

/** 离线简报：启动时若有离线结算则生成一次，展示给玩家看 */
export interface OfflineReport {
  /** 真实离开时长（墙钟毫秒） */
  wallAwayMs: number
  /** 本次结算推进的游戏时长（毫秒） */
  settledMs: number
  /** 超出 8 小时上限未结算的时长（毫秒，0 = 无） */
  overflowMs: number
  /** 钱包变化（含市场挂单成交/远征 AI 奖励/维修支出等） */
  iskDelta: number
  /** 仓库+货仓变化（正增量为主；最多 8 条） */
  items: Array<{ name: string; delta: number }>
  /** 装备库新增 */
  modules: Array<{ name: string; delta: number }>
  /** 新入坞的舰船 */
  shipsIn: string[]
  /** 新入**舰船仓库**的舰船（组装机产出：2026-09-14 起不入舰队，故与 `shipsIn` 并列单列） */
  shipsStored: Array<{ name: string; delta: number }>
  /** 技能升级（名称 LvN） */
  skillsUp: string[]
  /** 新学会配方名 */
  learnedIn: string[]
  /** 期间新增日志条数 */
  logCount: number
  /** 期间最新 3 条 警告/交易 摘录 */
  highlights: Array<{ kind: string; text: string }>
  /** AI 核心作业行（2026-09-08：各核心类型离线完成的作业 + 预估收入；空 = 无 AI 核心活动） */
  coreJobs: string[]
}

function snapshotBasics(state: GameState): OfflineSnapshot {
  const cur = state.fleet[state.shipId]
  return {
    gameMs: state.gameMs,
    isk: state.wallet.isk,
    trained: { ...state.skills.trained },
    warehouse: { ...state.warehouse.items },
    cargo: { ...(cur?.cargo ?? {}) },
    moduleBay: { ...state.moduleBay },
    shipStore: { ...(state.shipStore ?? {}) },
    fleetKeys: Object.keys(state.fleet),
    learned: [...state.learnedRecipes],
    logCount: state.logs.length,
  }
}

function positiveDeltas(before: Record<string, number>, after: Record<string, number>): Array<{ id: string; delta: number }> {
  const out: Array<{ id: string; delta: number }> = []
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const id of ids) {
    const delta = (after[id] ?? 0) - (before[id] ?? 0)
    if (delta > 0) out.push({ id, delta })
  }
  return out.sort((a, b) => b.delta - a.delta)
}

/** 结算前后 diff，产出可展示的简报；离线太短（<60 秒）返回 null */
function buildOfflineReport(
  before: OfflineSnapshot,
  state: GameState,
  ctx: SimContext,
  wallAwayMs: number,
  overflowMs: number,
  stats?: SettleStats,
): OfflineReport | null {
  const settledMs = state.gameMs - before.gameMs
  if (settledMs < 60_000) return null

  const itemDeltas = positiveDeltas(before.warehouse, state.warehouse.items)
  // 当前船货仓也可能有离线进账（远征战利品入舱）
  const cur = state.fleet[state.shipId]
  const cargoNow = cur?.cargo ?? {}
  for (const d of positiveDeltas(before.cargo, cargoNow)) {
    const hit = itemDeltas.find((x) => x.id === d.id)
    if (hit) hit.delta += d.delta
    else itemDeltas.push(d)
  }
  itemDeltas.sort((a, b) => b.delta - a.delta)
  const items = itemDeltas.slice(0, 8).map((d) => ({ name: ctx.items.get(d.id)?.name ?? d.id, delta: d.delta }))

  const modules = positiveDeltas(before.moduleBay, state.moduleBay)
    .slice(0, 5)
    .map((d) => ({ name: ctx.modules.get(d.id)?.name ?? d.id, delta: d.delta }))

  const newShips: string[] = []
  const beforeShips = new Set(before.fleetKeys)
  for (const id of Object.keys(state.fleet)) {
    if (!beforeShips.has(id)) newShips.push(shipDisplayName(state, ctx, id))
  }

  // 组装机产出的舰船 2026-09-14 起**直接进舰船仓库**（不再进舰队）⇒ 舰队 diff 看不见它们，
  // 单列一份「入舰船仓库」清单，否则离线简报说不出船去了哪（船长 2026-09-14「补」）
  const shipsStored = positiveDeltas(before.shipStore, state.shipStore ?? {}).map((d) => ({
    name: ctx.ships.get(d.id)?.name ?? d.id,
    delta: d.delta,
  }))

  const skillsUp: string[] = []
  for (const [id, lv] of Object.entries(state.skills.trained)) {
    if (lv > (before.trained[id] ?? 0)) {
      skillsUp.push(`${ctx.skills.get(id)?.name ?? id} Lv${lv}`)
    }
  }

  const learnedIn: string[] = []
  for (const id of state.learnedRecipes) {
    if (!before.learned.includes(id)) {
      learnedIn.push(ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
    }
  }

  const newLogs = state.logs.slice(before.logCount)
  const highlights: Array<{ kind: string; text: string }> = []
  for (let i = newLogs.length - 1; i >= 0 && highlights.length < 3; i--) {
    const l = newLogs[i]!
    if (l.kind === 'warn' || l.kind === 'trade') highlights.push({ kind: l.kind, text: l.text })
  }
  highlights.reverse()

  // AI 核心作业（2026-09-08 船长：离线报告按核心类型列出作业 + 预估收入）
  const coreJobs: string[] = []
  if (stats) {
    const order: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']
    for (const t of order) {
      const s = stats[t]
      if (!s) continue
      const acts: string[] = []
      if (s.miningTrips > 0) acts.push(tr("ui.engine.001", { p1: s.miningTrips }))
      if (s.salvageDone > 0) acts.push(tr("ui.engine.002", { p1: s.salvageDone }))
      if (s.refineBatches > 0) acts.push(tr("ui.engine.003", { p1: s.refineBatches }))
      if (s.recycleBatches > 0) acts.push(tr("ui.engine.004", { p1: s.recycleBatches }))
      if (s.makeDone > 0) acts.push(tr("ui.engine.005", { p1: s.makeDone }))
      // 2026-09-14 船长「补」：舰船产出入舰船仓库 ⇒ 单列一条，免得玩家以为船丢了
      if (s.shipsDone > 0) acts.push(tr("ui.engine.006", { p1: s.shipsDone }))
      if (acts.length === 0) continue
      coreJobs.push(
        tr("ui.engine.048", { p1: aiCoreName(t), p2: acts.join(' · '), p3: s.income > 0 ? tr("ui.engine.007", { p1: s.income.toLocaleString('zh-CN') }) : '' }),
      )
    }
  }

  return {
    wallAwayMs,
    settledMs,
    overflowMs,
    iskDelta: state.wallet.isk - before.isk,
    items,
    modules,
    shipsIn: newShips,
    shipsStored,
    skillsUp,
    learnedIn,
    logCount: newLogs.length,
    highlights,
    coreJobs,
  }
}

/**
 * 离线结算报告 → 事件日志单条汇总（2026-09-08 船长定：日志会话级不落盘，
 * 但离线报告本体要进入本局事件日志，供关闭简报后查证）。
 *
 * 🔴 **级别 = `system`**（**2026-09-26 船长令**：「**离线报告应该放进系统里**」）——
 * 原先是 `info`（与日常噪声同级、混在"信息"页签里）⇒ 离线报告整条挪到「**系统**」类，
 * 玩家能按类筛出来查（`LOG_KINDS` 的 `system` 这一档本来就存在，只改归类的 kind，文案与简报弹窗一字未动）。
 */
function offlineReportLogText(r: OfflineReport): string {
  const parts: string[] = [tr("ui.engine.008", { p1: formatDurationMs(r.wallAwayMs), p2: formatDurationMs(r.settledMs) })]
  if (r.overflowMs > 0) parts.push(tr("ui.engine.009", { p1: formatDurationMs(r.overflowMs) }))
  parts.push(tr("ui.engine.010", { p1: r.iskDelta >= 0 ? '+' : '−', p2: Math.abs(r.iskDelta).toLocaleString('zh-CN') }))
  if (r.items.length > 0) parts.push(tr("ui.engine.011", { p1: r.items.map((i) => `${i.name}×${i.delta.toLocaleString('zh-CN')}`).join(tr("ui.MatterTechTab.017")) }))
  if (r.modules.length > 0) parts.push(tr("ui.engine.012", { p1: r.modules.map((m) => `${m.name}×${m.delta}`).join(tr("ui.MatterTechTab.017")) }))
  if (r.shipsIn.length > 0) parts.push(tr("ui.engine.013", { p1: r.shipsIn.join(tr("ui.MatterTechTab.017")) }))
  if (r.shipsStored.length > 0)
    parts.push(tr("ui.engine.014", { p1: r.shipsStored.map((s) => `${s.name}×${s.delta}`).join(tr("ui.MatterTechTab.017")) }))
  if (r.skillsUp.length > 0) parts.push(tr("ui.engine.015", { p1: r.skillsUp.join(tr("ui.MatterTechTab.017")) }))
  if (r.learnedIn.length > 0) parts.push(tr("ui.engine.016", { p1: r.learnedIn.join(tr("ui.MatterTechTab.017")) }))
  if (r.coreJobs.length > 0) parts.push(tr("ui.engine.017", { p1: r.coreJobs.join('；') }))
  return tr("ui.engine.018", { p1: parts.join('；') })
}

/**
 * **活动切换"再点一次即确认"的时间窗**（2026-09-21 统一批）：首击弹警告（`ui.Hauling.033` 那句手感），
 * 同一颗按钮在这个窗口内再点一下才算确认；超时/换按钮 ⇒ 重新警告（别让玩家隔一分钟误触执行）。
 */
const SWITCH_ASK_MS = 6000

/**
 * **洞内倍速的"记忆"**（船长 2026-09-19：「倍速采用记忆形式，记住玩家上次选择的倍速」）：
 * 存 `localStorage`（键空间 `whale-idle:*`，与语言 `whale-idle:locale`、打捞排序同款口径）；
 * **不进存档** ⇒ 存档保持中立，导出/导入不带着显示偏好走；取不到或越界一律当"还没选过"（`0`）。
 */
const WH_SPEED_KEY = 'whale-idle:wh-speed'

/** 读上次选的倍速档位（`0` = 没选过 ⇒ 跟随已解锁最高档） */
function loadWormholeSpeedPick(): number {
  try {
    const v = Number(localStorage.getItem(WH_SPEED_KEY))
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 0
  } catch {
    return 0 // 无 localStorage（浏览器策略/降级）⇒ 当没选过
  }
}

/** 记住这次选的档位 */
function saveWormholeSpeedPick(x: number): void {
  try {
    localStorage.setItem(WH_SPEED_KEY, String(x))
  } catch {
    /* 忽略：存不上只是不记忆，不影响本局生效 */
  }
}

export class GameEngine {
  /**
   * 引擎规则计算需要的静态内容（技能/舰船/矿带/物品 + 平衡数值）。
   * ⚠ 2026-09-19 英语本地化：`ctx` 与下面几张目录表**不再是 readonly** —— `setLocale()` 会按语言重建
   * （只换 `name` / `description`，id 与数值不动；未登记的目录原样回退中文）。缺省中文 ⇒ 行为与改动前一致。
   */
  ctx: SimContext = buildSimContext()
  /** 当前语言（`setLocale` 维护；缺省中文） */
  private locale: L10nLocale = 'zh'
  /** 界面目录数据（**施工期闸门**：标了 `unreleased` 的内容不进这些"给玩家看的"枚举
   *  —— 与下面 `anomalies` 的 `hidden` 过滤同款，2026-09-13 船长铁律） */
  skills = SKILLS
  readonly groups = SKILL_GROUPS
  ships = SHIPS.filter((d) => itemReleased(d))
  belts = BELTS
  items = ITEMS
  modules = MODULES.filter((d) => itemReleased(d))
  blueprints = BLUEPRINTS.filter((d) => itemReleased(d))
  shipBlueprints = SHIP_BLUEPRINTS.filter((d) => itemReleased(d))
  galaxies = GALAXIES
  readonly galaxyEdges = GALAXY_EDGES
  anomalies = ANOMALIES_FLAVORED.filter((a) => !a.hidden) // B1：遭遇战模板（hidden）不进悬赏目录；含 B3.1 回收特色

  /**
   * **周末入侵**（2026-09-23 船长令）：刷新界面用的悬赏列表——**被占星系整池换成入侵舰队派生卡**
   * （只覆盖 id / 名字 / 威胁 / 奖励；夺回或活动结束即恢复原卡）。引擎每拍在 `weekendTick` 之后调一次。
   */
  private refreshAnomaliesView(): void {
    const base = ANOMALIES_FLAVORED.filter((a) => !a.hidden)
    const ev = this.state.weekendEvent
    if (!ev || ev.endedAtWallMs !== undefined) {
      this.anomalies = base
      return
    }
    const now = Date.now()
    /** 逐星系取一次（同星系多张卡共用同一份替换结果 ⇒ 与 `weekendBountyCardsOf` 的"同序"契约一致） */
    const byGalaxy = new Map<string, (typeof base)[number][]>()
    for (const a of base) {
      const list = byGalaxy.get(a.galaxyId)
      if (list) list.push(a)
      else byGalaxy.set(a.galaxyId, [a])
    }
    const replaced = new Map<string, readonly (typeof base)[number][]>()
    for (const [gid, list] of byGalaxy) {
      replaced.set(gid, weekendBountyCardsOf(this.state, this.ctx, list, gid, now))
    }
    const cursor = new Map<string, number>()
    const out: (typeof base)[number][] = []
    for (const a of base) {
      const list = replaced.get(a.galaxyId)!
      const i = cursor.get(a.galaxyId) ?? 0
      cursor.set(a.galaxyId, i + 1)
      out.push(list[i] ?? a)
    }
    /**
     * **同一被占星系只出一条**（**2026-09-25 船长裁决「甲」**）：H 族是"每星系抽一支驻留舰队"，
     * 同星系的多个悬赏槽位会换出**同一张卡**（真档实测：红环航道 2 个槽位 = 两条一模一样的入侵悬赏）。
     * 去重在 core 单点（`weekendBoardRowsOf`：只对被占星系生效、A/C/G 的派生卡不受影响）。
     */
    this.anomalies = weekendBoardRowsOf(out, (gid) => weekendOccupiedLiveAt(this.state, gid, now))
    return
  }
  /** 全部异常目录（含 hidden 遭遇模板——星图/任务中心过滤展示用） */
  allAnomalies = ANOMALIES_FLAVORED
  /**
   * **全目录**（含未上线）——只给"玩家已持有 / 已在跑"的解析路径用：装备库按持有数筛、
   * 组装机按 `run.blueprintId` 反查蓝图等。**别的用途一律用上面的可见目录**
   * （口径与 `allAnomalies` 同款；未上线内容在施工期不可能被玩家持有，故这些路径不会漏）。
   */
  allShips = SHIPS
  allModules = MODULES
  allBlueprints = BLUEPRINTS
  allShipBlueprints = SHIP_BLUEPRINTS
  /** 通讯剧本目录（T9） */
  readonly dialogues = DIALOGUES

  /** 当前游戏状态（每秒被推进；界面直接读它渲染） */
  state: GameState = createInitialState({ prologue: true })

  /** 本次启动的离线简报（没有离线结算时为 null；读完界面手动关闭） */
  offlineReport: OfflineReport | null = null

  /** 引擎侧系统通知（2026-09-08 交付循环终止弹窗）：App 注入 toast；见 drainSystemNotice */
  onSystemNotice: ((msg: string) => void) | null = null

  private listeners = new Set<Listener>()
  private lastRealMs = 0
  private intervalId: number | null = null
  private saveIntervalId: number | null = null
  /** 甲：启动体检不通（存储不可写）⇒ 本局所有写入短路；界面在设置里显示状态 */
  private saveUnavailable = false
  /** 丁：旧档读取失败 ⇒ 挂起写入，等玩家放行；防"把读不出来的旧档盖掉" */
  private savePaused = false
  /** 非战斗期推进余额（累计满 1s 才推进一次，保持旧节奏；战斗中改 100ms 切片实时推进） */
  private pendingMs = 0
  /** 心跳周期毫秒（2026-09-08 降频优化：挂机 500ms；战斗/教学加速/远征去程边界保持 100ms） */
  private pumpMs = 100
  /** 优化：本场远征是否由"重复清剿"自动发起（期间战斗界面默认最小化，不自动弹全屏战场） */
  private autoSortie = false
  /**
   * **洞内战斗倍速的选择**（2026-09-19 谜质科技「时间压缩矩阵」）：
   * `0` = **还没选过**（跟随"已解锁的最高档"）；`≥1` = 玩家上次选的档位（**含 ×1** ——
   * 船长 2026-09-19：「倍速采用记忆形式，记住玩家上次选择的倍速」）。
   * **记忆进本地偏好**（`localStorage`，与语言 / 打捞排序同款口径，**不进存档** ⇒ 存档保持中立）；
   * 生效值仍由引擎每拍夹到"洞内 + 已解锁档位"内（离线结算根本不传 ⇒ 一律 1×）。
   */
  private wormholeSpeedPick = loadWormholeSpeedPick()

  /* ═══ 悬赏胜率蒙特卡洛缓存（2026-09-09 船长确认 N=21：战力指纹变化 → 分帧全板预热） ═══ */
  private winCache = new Map<string, BountyWinMC>() // anomalyId → 当前指纹下的预估结果
  private winFpCur = ''
  private winEval: { ev: GameState; uid: string } | null = null // 战力评估快照（fp 变化时重建）
  private winQueue: string[] = []
  private winLastPumpAt = 0

  /**
   * **主控活动切换：首击警告、二击执行**（**2026-09-21 船长令**：「统一为能够直接切换（自动取消当前
   * 活动），像长途运输这种高收益高周期的才加一个警告」）。
   *
   * core 的 `activityGate` 在"当前占着主控的是长途运输、而这条指令会中断它"时返回
   * `core.activityGate.002`（一句写清代价的警告，**不执行**）；界面**同一颗按钮再点一次**即确认 ——
   * 先按统一单点把当前活动停掉（`haltCurrentActivity`：停机 + 统一日志），再原样重跑一次指令。
   *
   * ⚠ 不新造交互、每颗按钮也不需要各自写确认态（沿用 2026-09-20 那套"再点一次"的手感）；
   * 记录的是**哪一颗按钮**＋时间窗（`SWITCH_ASK_MS`），换一颗按钮会重新走一次警告。
   */
  private switchAsk: { key: string; at: number } | null = null

  /** 活动切换的两段确认外包装（见 `switchAsk` 的说明）；`key` = 发起切换的那颗按钮 */
  private withActivitySwitch(key: string, run: () => CommandResult): CommandResult {
    const first = run()
    if (first.ok || first.errorId !== ACTIVITY_CONFIRM_ID) return first
    const now = Date.now()
    const armed = this.switchAsk !== null && this.switchAsk.key === key && now - this.switchAsk.at <= SWITCH_ASK_MS
    if (!armed) {
      this.switchAsk = { key, at: now }
      return first // 首击：把警告交给调用点照旧 toast 出来
    }
    this.switchAsk = null
    if (haltCurrentActivity(this.state) !== null) {
      void this.persist()
      this.notify()
    }
    return run() // 二击：当前活动已停 ⇒ 原指令重跑一次
  }

  /**
   * 战力指纹：驾驶船 + 装配 + 无人机清单 + 技能 + 当前耐久（任一变化 → 全板胜率失效重算）。
   * **2026-09-24 补三项**（船长令重做预估口径后，这三样都会改变评估结果，漏掉就会吃到过期缓存）：
   * ① **弹药档位**（`ammoPref`，「弹药采用玩家当前选择弹药」）· ② **取用开关**（`resupplyFromWarehouse`，
   * 决定评估把补给料放进仓库还是货仓）· ③ **实战胜利记录**（`winRecord`：有记录的卡改用记录距离，
   * 打完一场回来必须重算）· ④ 窝点档位/派系活跃（`buildEvalState` 会带进快照 ⇒ 同一把尺子）。
   */
  private winFingerprint(): string {
    const st = this.state
    const uid = st.shipId
    const f = st.fleet[uid]
    const tr = st.skills.trained
    let sk = ''
    for (const k of Object.keys(tr).sort()) sk += `${k}:${tr[k]};`
    return `${uid}|${f?.defId}|${f?.armorPct ?? 1}|${f?.durability ?? 1}|${JSON.stringify(f?.fitted ?? {})}|${JSON.stringify(f?.droneLoad ?? null)}|${JSON.stringify(f?.ammoPref ?? null)}|${st.resupplyFromWarehouse !== false ? 1 : 0}|${JSON.stringify(st.winRecord ?? null)}|${st.expedition.lairTier ?? 0}|${st.expedition.factionActive === true ? 1 : 0}|${sk}`
  }

  /**
   * 悬赏胜率 MC 预热泵（挂在每秒心跳尾；战斗交火期跳过避免挤占实时推进）：
   * 指纹变化 → 重建评估快照 + 全板入队；每批预算 + 节流 + 每批条数上限，批完成 notify 一次，
   * 悬赏卡数字随批从旧口径变准（全板约几秒）。评估用独立快照/种子，不消耗真实存档 rng。
   *
   * 2026-09-10 船长反馈"击毁敌人后画面明显卡顿"定位（perfHub 快照：adv ≤0.7ms、commit ≤6.4ms，
   * 但 long = 1×63ms、FPS min 19.8，且恰好落在战斗结束那一刻）：原单批预算 60ms 会把
   * 全板重算（真档实测 26 条共 ~70ms）**塞进同一个任务** → 一次 ~60ms 的可见卡顿。
   * 现改：单批预算 8ms + 每批最多 2 条 → 同样工作量摊到十几拍（每拍 ≤10ms，肉眼无感）。
   */
  private pumpWinCache(now: number): void {
    // 洞内交火同样跳过（2026-09-13）：实时推进优先，别让胜率预热抢帧；旗舰战同款（2026-09-25）
    if (this.inLiveBattle()) return
    if (now - this.winLastPumpAt < 400) return
    const fp = this.winFingerprint()
    if (fp !== this.winFpCur) {
      this.winFpCur = fp
      this.winCache.clear()
      this.winEval = buildEvalState(this.state, this.state.shipId)
      this.winQueue = this.anomalies.map((a) => a.id)
    }
    if (this.winQueue.length === 0) return
    const snap = this.winEval
    if (!snap) {
      this.winQueue = []
      return
    }
    this.winLastPumpAt = now
    const until = now + 8 // 单批预算 8ms（原 60ms：会在战斗结束那一下形成一次长任务）
    let done = 0
    while (this.winQueue.length > 0 && done < 2 && Date.now() < until) {
      const id = this.winQueue.shift()!
      const a = this.ctx.anomalies.get(id)
      if (!a) continue
      this.winCache.set(id, estimateBountyWinOn(snap.ev, this.ctx, a, snap.uid, BOUNTY_MC_RUNS))
      done += 1
    }
    if (done > 0) this.notify()
  }

  /** 悬赏卡读胜率缓存（2026-09-09）；未就绪返回 null → 调用方临时回退旧口径显示，预热完成后随 notify 变准 */
  winEstimateOf(anomalyId: string): BountyWinMC | null {
    return this.winCache.get(anomalyId) ?? null
  }

  /** UI 查询：当前是否处于"自动讨伐发起的远征"（战斗界面不自动弹出） */
  autoSortieNow(): boolean {
    return this.autoSortie
  }

  /**
   * 是否需要 100ms 快速心跳（否则用 500ms 低频挂机心跳——玩家反馈主机高占用后优化）：
   * - 交火中（含已分胜负的击杀慢镜窗口）：战斗按 100ms 实时推进 → 必须保持；

   * - 远征去程（phase 'out'）：到港边界切割守卫依赖心跳颗粒度，降频后开战弹出延迟 ≤0.5s（原 ≤0.1s）。
   */
  private wantsFastPump(): boolean {
    const exp = this.state.expedition
    // 交火中一律 100ms 心跳（远征 / 虫洞 / 入侵旗舰战三个宿主，判据单点 `inLiveBattle`）
    if (this.inLiveBattle()) return true
    if (exp.active && exp.phase === 'out') return true
    return false
  }

  /** 按当前局面重排心跳周期（只在需要变速时才重建定时器，避免每拍 clearInterval 抖动） */
  private ensurePump(): void {
    const want = this.wantsFastPump() ? 100 : 500
    if (want === this.pumpMs) return
    this.pumpMs = want
    if (this.intervalId !== null) window.clearInterval(this.intervalId)
    this.intervalId = window.setInterval(() => this.tick(), this.pumpMs)
    // 变速瞬间重新锚定墙钟，避免 dt 大跳影响余额累计节奏
    this.lastRealMs = Date.now()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * **切语言**（2026-09-19 船长令「希望对游戏进行英语本地化处理」）：
   * 用当前语言**重建**运行上下文与全部目录表（`buildSimContext(locale)` + 覆盖层），
   * **只换 `name` / `description`** —— id、数值、存档一字不动；重建后 `notify()` 让界面整体刷新。
   * ⚠ 未登记的目录（尚无英文覆盖表）会**原样回退中文**，可分批推进（见 `docs/glossary-en.md`）。
   */
  setLocale(locale: L10nLocale): void {
    if (locale === this.locale) return
    this.locale = locale
    this.ctx = buildSimContext(locale)
    this.ships = overlayList(SHIPS, EN_SHIPS, locale).filter((d) => itemReleased(d))
    this.allShips = overlayList(SHIPS, EN_SHIPS, locale)
    this.modules = overlayList(MODULES, EN_MODULES, locale).filter((d) => itemReleased(d))
    this.allModules = overlayList(MODULES, EN_MODULES, locale)
    this.items = overlayList(ITEMS, EN_ITEMS_ALL, locale)
    this.skills = overlayList(SKILLS, EN_SKILLS, locale)
    this.blueprints = overlayList(BLUEPRINTS, EN_BLUEPRINTS, locale).filter((d) => itemReleased(d))
    this.shipBlueprints = overlayList(SHIP_BLUEPRINTS, EN_SHIP_BLUEPRINTS, locale).filter((d) => itemReleased(d))
    this.allBlueprints = overlayList(BLUEPRINTS, EN_BLUEPRINTS, locale)
    this.allShipBlueprints = overlayList(SHIP_BLUEPRINTS, EN_SHIP_BLUEPRINTS, locale)
    // 卡片名 + **卡片内嵌敌舰**（敌舰名嵌在 anomaly.ships[].ship 里 ⇒ 走嵌套覆盖）
    const locCards = overlayCardFoesList(overlayList(ANOMALIES_FLAVORED, EN_ANOMALIES, locale), EN_FOE_SHIPS, locale)
    this.anomalies = locCards.filter((a) => !a.hidden)
    this.allAnomalies = locCards
    this.galaxies = overlayList(GALAXIES, EN_GALAXIES, locale)
    this.belts = overlayList(BELTS, EN_BELTS, locale)
    this.notify()
  }

  /**
   * **现在有没有"要在战场里看"的战斗**（2026-09-25 收口）：远征 / 虫洞 / **入侵旗舰战**三个宿主。
   *
   * 第三个宿主是船长报障「旗舰战无法进入战斗画面」时补的：旗舰战是**编队战**、承载在**遭遇槽**
   * （`state.encounter.battle`）⇒ 原先只认前两个宿主的四处判据（心跳变速 / 性能分桶 / 胜率预热让路 /
   * 100ms 实时切片）全都把它当成"没在打"：战场数据一秒才来一次、动画一跳一跳。
   * 判据收在这里一处，宿主解析仍归 core（`weekendFlagshipBattleActive`）。
   */
  private inLiveBattle(): boolean {
    const s = this.state
    return (
      (s.expedition.phase === 'battle' && !!s.expedition.battle) ||
      !!s.wormhole.run?.battle ||
      weekendFlagshipBattleActive(s)
    )
  }

  /** 当前心跳所属计量桶：交火中 = battle，其余 = idle（性能监测分桶用） */
  private currentBucket(): PerfBucket {
    // 洞内交火同算 battle 桶（2026-09-13：心跳分支已认洞内，分桶同步）；旗舰战同款（2026-09-25）
    return this.inLiveBattle() ? 'battle' : 'idle'
  }

  /** 推进一小片游戏时间（包装：激活性能监测时记录引擎侧耗时；未激活零开销）。
   *  nowWallMs = 现实墙钟：赏金日板按它对齐"每天本地 0 点"整板替换（游戏内时间泵变速不影响）。 */
  private advanceSlice(ms: number): void {
    const rec = perfHub.recording
    const t0 = rec ? performance.now() : 0
    const bucket = this.currentBucket()
    advanceGame(this.state, ms, this.ctx, {
      nowWallMs: this.wallNowOf(),
      // 洞内倍速：**只有前台心跳传**（离线结算走 simulateOffline，不经这里 ⇒ 恒 1×）
      battleSpeedX: this.requestedWormholeSpeed(),
    })
    this.drainSystemNotice()
    if (rec) perfHub.recordAdvance(bucket, performance.now() - t0)
  }

  /* ═══ 洞内战斗倍速（2026-09-19 谜质科技「时间压缩矩阵」）═══
   * 引擎侧只认"想要几倍"，实际生效值由 `combat.advanceBattleFor` 夹到"洞内 + 已解锁档位"内。 */

  /** **已解锁的倍速档位**（含 1×；未解锁 = `[1]`）——战斗窗口的控件按它渲染 */
  wormholeSpeedOptions(): number[] {
    return matterTechBattleSpeedTiers(this.state, this.ctx)
  }

  /** 本会话玩家选的档位（`0` = 还没选过） */
  wormholeSpeedPickValue(): number {
    return this.wormholeSpeedPick
  }

  /**
   * **本拍实际生效的档位**（界面高亮同一把尺）：玩家选过且仍解锁 ⇒ 用选的；否则 = 已解锁最高档；
   * 一级没解锁 ⇒ 1。⚠ 哨兵值口径：`0` = 没选过，`1` = **玩家明确选了 ×1**（两者不可混——`×1` 要记得住）。
   */
  wormholeSpeedActive(): number {
    const opts = this.wormholeSpeedOptions()
    const max = opts[opts.length - 1] ?? 1
    return opts.includes(this.wormholeSpeedPick) ? this.wormholeSpeedPick : max
  }

  /** 设置本会话的倍速档位（只接受已解锁档位；**记住这次选择**，下次开游戏沿用） */
  setWormholeSpeed(x: number): void {
    const opts = this.wormholeSpeedOptions()
    this.wormholeSpeedPick = opts.includes(x) ? x : 0
    saveWormholeSpeedPick(this.wormholeSpeedPick)
    this.notify()
  }

  /**
   * **研究一级谜质科技**（船长 2026-09-19：「消耗谜质和信用点。**不消耗时间**」）：
   * 判据与扣款全在 core（`matterTechCanResearch` 同一把尺），这里只负责点完通知界面刷新。
   */
  researchMatterTech(id: string): { ok: boolean; error?: string } {
    const r = researchMatterTech(this.state, this.ctx, id)
    this.notify()
    return r
  }

  /** **本拍要交给引擎的倍速**：玩家选过就用选的（**含 ×1**），否则用已解锁的最高档（未解锁 = 1） */
  private requestedWormholeSpeed(): number {
    return this.wormholeSpeedActive()
  }

  /** 一次性系统提示（2026-09-08 交付循环终止弹窗）：引擎写入 state.deliveryNotice →
   * 心跳/离线结算后读取 → toast 一次并清除（不落档，重启后由新触发点重新写入）
   * 2026-09-10 追加：重复清剿停环提示 state.autoLoopStopNotice（船长定：除日志外在线弹窗告知，
   * 文案自带 装甲/结构 百分比）——同一通道，各自清空 */
  private drainSystemNotice(): void {
    const n = this.state.deliveryNotice
    if (n) {
      this.state.deliveryNotice = null
      if (this.onSystemNotice) this.onSystemNotice(n)
    }
    const loopStop = this.state.autoLoopStopNotice
    if (loopStop) {
      this.state.autoLoopStopNotice = null
      if (this.onSystemNotice) this.onSystemNotice(loopStop)
    }
    // 2026-09-10 追加：机群战损提示 state.droneLossNotice（无人机可被击落·永久损失制；
    // 战斗结算扣清单后写入，同一通道 toast 一次）
    const droneLoss = this.state.droneLossNotice
    if (droneLoss) {
      this.state.droneLossNotice = null
      if (this.onSystemNotice) this.onSystemNotice(droneLoss)
    }
    // 2026-09-13 追加：星云机制一次性提示 state.nebulaHintNotice（船长：「这个机制在玩家第一次下到四层时
    // 提示玩家」）——由 `wormholeDescend` 在该次深入时写入，同一通道提示一次；跨趟只给一次由随档的
    // `wormhole.nebulaHintShown` 保证（通讯那封信也读同一个标记）。
    const nebula = this.state.nebulaHintNotice
    if (nebula) {
      this.state.nebulaHintNotice = null
      if (this.onSystemNotice) this.onSystemNotice(nebula)
    }
  }

  private notify(): void {
    // 任何状态变更通知后重排心跳：交火中/教学加速/远征去程 = 100ms，普通挂机 = 500ms（2026-09-08 降频）
    this.ensurePump()
    const rec = perfHub.recording
    const t0 = rec ? performance.now() : 0
    const bucket = this.currentBucket()
    for (const fn of this.listeners) fn()
    if (rec) perfHub.recordNotify(bucket, performance.now() - t0)
  }

  /** 启动引擎：读档 → 离线结算 → 每秒推进 + 自动保存 */
  async start(): Promise<void> {
    let lastSavedWall: number | null = null
    /** 甲：启动体检结果（`main.tsx` 在 start 之前 await 过一次）——不通 ⇒ 本局所有写入直接短路 */
    const guard = saveStorageProbe()
    this.saveUnavailable = guard !== null && !guard.ok
    try {
      const raw = await saveBridge.load()
      if (raw !== null) {
        const parsed = loadSaveFile(raw)
        this.state = parsed.state
        // V18 口径取消：旧重型弹 1:1 并入通用弹（含挂单撤销）；见 core/equipment.migrateDeprecatedAmmo
        migrateDeprecatedAmmo(this.state)
        // 临时空间换账本（2026-09-14）：老档 `run.temp`（一种物品一条的列表）→ `run.tempGrid`（4×8 格子）
        wormholeNormalizeLegacyTemp(this.state, this.ctx)
        lastSavedWall = parsed.savedAtWallMs
      }
    } catch (err) {
      console.error(tr("ui.engine.019"), err)
      this.state = createInitialState({ prologue: true })
      // 2026-09-11：玩家可见文案不带技术细节（JSON / 版本号 / 异常字符串）——技术原因只进控制台
      const why =
        err instanceof SaveError
          ? err.code === 'PARSE'
            ? tr("ui.engine.020")
            : err.code === 'FORMAT'
              ? tr("ui.engine.021")
              : tr("ui.engine.022")
          : tr("ui.engine.023")
      addLog(this.state, 'warn', tr("ui.engine.024", { why: why }))
      /**
       * **丁 · 读档抛错 ⇒ 挂起写入**（2026-09-25 船长令）：抛错 ≠"没有档"——旧档很可能还在、
       * 只是这一次读不出来（权限/存储一时不可用/文件损坏）。挂起后 15 秒心跳与首次落盘都不写，
       * 等玩家在「设置 → 存档」里点「允许写入存档」（`allowSaveAfterLoadError`）再写，
       * 免得新档把旧档盖掉。存储本来就不可写（甲）时不挂起——挂起没意义，设置里会显示"不可写"。
       */
      if (!this.saveUnavailable) this.savePaused = true
    }

    // V17/V18 装备修复：下架型号迁移 + 每船位数组与船型布局对齐（须在离线结算前完成，
    // 让离线战斗直接按新参数结算）；见 core/equipment.repairDeprecatedModules。
    // 2026-09-12：**新档也跑**（原先只在"读到存档"分支里跑）——新造/新买的船走
    // `emptyShipState → emptyFitted()` = 1/1/1 位数组，不补齐就会出现
    // "界面按船型布局画出第 2/3/4 格、引擎只认第 1 位"（玩家实测「该低槽位不可用（第 2 位）」）。
    repairDeprecatedModules(this.state, this.ctx)

    const now = Date.now()
    if (lastSavedWall !== null) {
      // B4：离线结算前后对比，生成启动简报（离线 ≥1 分钟才展示）；stats 收集 AI 核心作业
      const before = snapshotBasics(this.state)
      const stats = newSettleStats()
      const { overflowMs } = offlineSplit(now - lastSavedWall, offlineCapMsOf(this.state))
      simulateOffline(this.state, lastSavedWall, now, this.ctx, undefined, { stats })
      this.drainSystemNotice()
      this.offlineReport = buildOfflineReport(before, this.state, this.ctx, now - lastSavedWall, overflowMs, stats)
      // 2026-09-08 船长定：日志会话级（写盘剥离 logs）；启动不做强制清空——
      // 离线补时产生的日志照常显示，另补一条报告汇总单条（钱包/收获明细，关闭简报后仍可查证）
      if (this.offlineReport !== null) {
        addLog(this.state, 'system', offlineReportLogText(this.offlineReport))
      }
    }

    this.lastRealMs = Date.now()
    this.pumpMs = 0
    // 心跳周期按当前局面启动：战斗/教学加速/远征去程 100ms，普通挂机 500ms（低负载；2026-09-08 降频优化）
    this.ensurePump()
    /**
     * **自动落盘心跳（15 秒）**——但**存储不可写**（甲：启动体检不通）或**写入已挂起**（丁：旧档读取失败）时
     * 一律不启动：写进去也没用，更不该把读不出来的旧档盖掉。放行入口 = 设置 → 存档 →「允许写入存档」
     * （`allowSaveAfterLoadError()`），或换一个能写存储的窗口重开。
     */
    if (this.saveWriteState() === 'ok') this.ensureSaveInterval()

    await this.persist()
    this.notify()
  }

  /** 启动自动落盘心跳（幂等） */
  private ensureSaveInterval(): void {
    if (this.saveIntervalId !== null) return
    this.saveIntervalId = window.setInterval(() => {
      void this.persist()
    }, 15_000)
  }

  /**
   * **存档写入状态**（界面与告警用；2026-09-25 船长令）：
   * - `unavailable` = 启动体检就没通（浏览器不给写存储）⇒ 写也白写，不去动它；
   * - `paused` = 旧档**读取失败**（丁）⇒ 挂起写入，等玩家在设置里放行，免得把旧档盖掉；
   * - `ok` = 正常。
   */
  saveWriteState(): 'ok' | 'paused' | 'unavailable' {
    if (this.saveUnavailable) return 'unavailable'
    if (this.savePaused) return 'paused'
    return 'ok'
  }

  /**
   * **丁 · 玩家放行**（设置 → 存档 →「允许写入存档」）：解除挂起、恢复心跳并立刻落一次盘。
   * 语义 = 玩家已知晓"读不出来的旧档会被新档取代"。
   */
  async allowSaveAfterLoadError(): Promise<boolean> {
    this.savePaused = false
    this.ensureSaveInterval()
    return await this.persist()
  }

  /**
   * 时间泵（2026-09-08 降频：交火/教学加速/远征去程 = 100ms 一响；普通挂机 = 500ms 一响，
   * 低负载——玩家反馈主机高占用后的优化）：
   * - 玩家交火中：按 100ms 粒度切片推进并即时通知 → 战斗动画接近实时（数据 10Hz，无整秒跳变）；
   * - 其余时间（挂机 500ms 心跳）：余额累计满 1s 再整体推进一次（训练/采矿/市场等节奏与旧版一致，
   *   界面通知保持 1Hz）。
   * - 到港边界切分（2026-09-05 探针 ageMs=1002 实证）：去程到港若落在这 1s 整片内，旧实现会在
   *   同一次推进里把“开战后剩余时间”一并打完才通知 UI——导弹等远程武器能在画面弹出前就已开火
   *   一轮（战场首帧敌舰残血/武器已冷却）。现改为只推进到开战瞬间即通知，战场以 age≈0 弹出，
   *   随后交火按 100ms 实时泵推进（积压余额同样按 100ms 分片追平，无整秒隐藏推进）。
   * 切分只是把同一段游戏时间分成多小份送进核心引擎，各系统均按时间推进，总量不变。
   *
   * ⚠ **2026-09-20**：交火分支的记账修过一次（本拍 dt 丢帧 ⇒ 进战斗时欠着的现实时间永不补回），
   * 详见下面那段的注释与 `docs/roadmap.md` 2026-09-20「外部审查报告逐条核对与处置」那条。
   */
  /**
   * **入侵时钟**（2026-09-25 修船长报障「打开调试模式，快进后不会刷新入侵」）：入侵原先读 `Date.now()`
   * 真实墙钟，而"快进"推进的是游戏自己的模拟墙钟（`state.savedAtWallMs`）⇒ 快进对入侵完全无效。
   * 现统一走 `weekendClockOf`（取两者较大者）：正常在线=真实墙钟（逐字不变），快进后=模拟墙钟（不倒回）。
   */
  private wallNowOf(): number {
    return weekendClockOf(this.state)
  }

  /**
   * **周末入侵：一拍的全部动作**（2026-09-25 抽出，供**心跳**与**调试快进**共用）：
   * 补发贡献奖 → `weekendTick`（开局面/倒计时 anchor/结束）→ 三条日志 → 结束结算入账 → 两封通讯。
   * `wallNow` = 这一拍该用的墙钟；`lastSeenWallMs` = 上一次"玩家在"的墙钟（离线保护与 Q3 的锚点）。
   */
  private pumpWeekendAt(wallNow: number, lastSeenWallMs: number): void {
    /**
     * **上一场"已结束但没结"的贡献奖补发**：必须**在 `weekendTick` 之前** —— 它内部会 `ensureWeekendEvent`
     * 开新场、把旧场覆盖掉。core 侧按 `prizePaidAtWallMs` 落盘标记判重 ⇒ 每拍调也只会发一次。
     */
    this.settleWeekendPrize(wallNow)
    const weekend = weekendTick(this.state, this.ctx, wallNow, lastSeenWallMs)
    this.refreshAnomaliesView() // 被占星系在界面侧换成入侵舰队（每拍刷新，开销极小）
    if (weekend.started) {
      addLog(this.state, 'system', tr('ui.weekend.001'), 'ui.weekend.001')
      /** **入侵警报演出**（船长 2026-09-25 令）：开局立一次性待办 ⇒ 界面放红灯闪烁，演完再弹通讯 */
      this.invasionAlarmPending = 'start'
      void this.persist()
    }
    /**
     * **旗舰现身**：只记**一次**（2026-09-25 修船长报障「事件日志会一直刷『入侵核心已被打通：旗舰现身。』」）——
     * 原先判据是 `flagshipShown`（现身之后**每拍都真**）⇒ 日志每拍刷一条；现按 `flagshipAnchored`
     * （**首次落盘 anchor 的那一拍**）来；同时立起"一次性弹窗"待办（`flagshipPopupPending`，界面读它弹一次）。
     */
    if (weekend.flagshipAnchored) {
      addLog(this.state, 'system', tr('ui.weekend.002'), 'ui.weekend.002')
      this.flagshipPopupPending = true
      /** **旗舰现身也闪一次警报**（船长 2026-09-25 定「开局 ＋ 旗舰现身各闪一次」） */
      this.invasionAlarmPending = 'flagship'
      void this.persist()
    }
    if (weekend.ended) {
      const octopus = weekend.flagshipDown === 'octopus'
      /**
       * **章鱼人得手那一条按黑匣结果分文案**（**船长 2026-09-25 令**改爆率后："章鱼人摧毁 ⇒ 黑匣归零"
       * 不再成立：玩家没抢到最后一下时按 `25% × 输出占比` 掷，掷中照发）⇒
       * 掷中 = `ui.weekend.102`（残骸里寻获黑匣）· 没掷中 = `ui.weekend.003`（黑匣归零，原句）。
       * ⚠ 窗口到点（`ui.weekend.004`：旗舰撤走）不掷黑匣，照旧。
       */
      const box = this.state.weekendEvent?.flagshipBlackBox === true
      const id = octopus ? (box ? 'ui.weekend.102' : 'ui.weekend.003') : 'ui.weekend.004'
      addLog(this.state, 'system', tr(id), id)
      void this.persist()
    }
    /** **结束结算入账**：本拍刚结束的那一场立刻结；上一拍结束而没结的由开头那句兜（同一幂等口） */
    this.settleWeekendPrize(wallNow)
    /** **两封通讯**：每场一封预警（开局）＋ 一封结算（入账后），固定 id 覆盖上一封；判据在 core */
    weekendSyncComms(this.state, this.ctx, wallNow)
  }

  private tick(): void {
    const now = Date.now()
    const dt = Math.max(1, now - this.lastRealMs)
    this.lastRealMs = now
    // 序章·苏醒：演出阶段（step 0）冻结游戏时间——不推进/不累计余额，界面由演出组件驱动
    if (this.state.onboarding.step === ONB_AWAKEN) {
      this.pendingMs = 0
      return
    }
    /**
     * **周末入侵**（2026-09-23 船长令；设计见 `docs/design/weekend-invasion-20260923.md`）：
     * 每拍调一次（开局面 · 旗舰倒计时 anchor 落盘 · 章鱼人得手 / 窗口到点结束 · 结算入账 · 两封通讯）。
     * ⚠ 墙钟走 `wallNowOf()`（= 真实墙钟与游戏模拟墙钟取大者）⇒ **调试快进之后不会倒回去**；
     * `lastSeenWallMs` 传"上一拍"（now − dt）⇒ 离线保护与 Q3 的">24h 自满 24h 起算"都有正确锚点。
     */
    this.pumpWeekendAt(this.wallNowOf(), this.wallNowOf() - dt)
    const exp = this.state.expedition
    /**
     * 含已分胜负的"击杀慢镜窗口"：窗口内保持 100ms 切片推进 + 通知，让击杀动画/战报演出有稳定画面。
     *
     * ⚠ **洞内战斗必须同款**（2026-09-13 修船长报的"舰船移动约一秒跳一次，不顺滑"）：
     * 洞内宿主是 `state.wormhole.run.battle`（**不占** `expedition.battle`），首版这里只认远征 ⇒
     * 洞内交火掉进下面的**挂机分支**（`pendingMs >= 1000` 才推进并 `notify()` 一次）⇒
     * 战场每约 1 秒才收到一帧数据，船自然一秒跳一次（与帧率、与 33ms 插值都无关——插值再密，
     * 数据 1 秒才来一次也白搭）。
     *
     * ⚠ **2026-09-25 同款第三个宿主：入侵旗舰战**（承载在遭遇槽）——同上，判据收在 `inLiveBattle`。
     */
    const inBattle = this.inLiveBattle()
    if (inBattle) {
      /**
       * ⚠ **2026-09-20 修（外部审计报告点名 + 探针复算证实）：本拍的现实时间必须先并进余额再切片。**
       *
       * 旧写法是 `if (pendingMs > 0) { step = min(pendingMs, 100); advanceSlice(step); pendingMs -= step }
       * else advanceSlice(dt)` —— 走上面那一支时**本拍的 `dt` 既没进余额、也没被推进，直接丢掉**；
       * 而余额（进战斗前挂机攒下的那点，或窗口被后台节流攒下的一大段）会被一路消耗到 0
       * ⇒ **进战斗那一刻"欠着"的这段现实时间，本会话里再也不会被补上**。
       *
       * 探针读数（`tools/_probe-battle-pump.ts`，复刻两支记账、同一串现实时钟）：
       * - 进战斗时带 500ms 余额、打 10 拍再回挂机：旧写法**最终仍落后现实 1000ms**，新写法 **0**；
       * - 战斗中窗口被节流 20 秒：旧写法**最终落后 20.9 秒**（那一拍的 20s 被丢），新写法 **0**
       *   （20s 留进余额、战后按挂机分支一次性补上——与"后台时间照常在回到挂机时补"的既有口径一致）。
       *
       * 另一处顺带修正：旧写法在"余额 = 0"时会把一个被节流出来的巨大 `dt` **整段推进**（正是本段注释
       * 想避免的"整段隐藏推进"）；新写法无论余额多少都按 100ms 切片，大段只会留在余额里等战后补。
       */
      this.pendingMs += dt
      const step = Math.min(this.pendingMs, 100)
      if (step > 0) {
        this.advanceSlice(step)
        this.pendingMs -= step
      }
      this.notify()
      return
    }
    const pumpDt = dt
    this.pendingMs += pumpDt
    // 去程将在这片余额内到港：推进到“越过到港边界 1ms”，确保核心在本片内触发开战（引擎在
    // 跨过 finishAt 的推进中才执行开战——精确停在边界会留到下一片，且下一片 toArrival=0 使
    // 守卫失效、被整秒泵吞掉，复现暗推 ~1s，探针 ageMs=1108），随后立即通知战场以 age≈0 弹出
    if (exp.phase === 'out' && exp.active) {
      const toArrival = Math.max(0, exp.finishAtGameMs - this.state.gameMs)
      if (this.pendingMs >= toArrival) {
        const slice = Math.min(this.pendingMs, toArrival + 1)
        if (slice > 0) {
          this.advanceSlice(slice)
          this.pendingMs -= slice
        }
        this.notify()
        return // 下一拍起进入 inBattle 泵，余额按 100ms 分片追平
      }
    }
    if (this.pendingMs >= 1000) {
      this.advanceSlice(this.pendingMs)
      this.pendingMs = 0
      this.notify()
    }
    // T8 重复清剿（落档开关）：整秒心跳后检查自动再出发/暂停条件
    if (this.state.autoLoopAnomalyId !== null) {
      const wasActive = this.state.expedition.active
      const reason = advanceAutoLoopBounty(this.state, this.ctx)
      if (!wasActive && this.state.expedition.active) this.autoSortie = true // 本次由讨伐自动发起
      if (reason !== null || (!wasActive && this.state.expedition.active)) this.notify()
    }
    // 入侵「重复出击」（2026-09-25 船长令）：同一拍推进；出发走手动出击那条路（每场重抽 ＋ 星系覆写）
    if (autoLoopInvasionGalaxy(this.state) !== null) {
      const wasActive = this.state.expedition.active
      const reason = advanceAutoLoopInvasion(this.state, this.ctx)
      if (!wasActive && this.state.expedition.active) this.autoSortie = true
      if (reason !== null || (!wasActive && this.state.expedition.active)) this.notify()
    }
    // 讨伐远征结束后复位标记（下一场手动出击照常自动弹战场）
    if (this.autoSortie && !this.state.expedition.active) this.autoSortie = false
    // 悬赏胜率 MC 预热（2026-09-09：指纹变化时分帧重算；节流+预算防卡 UI）
    this.pumpWinCache(now)
  }

  /** 保存存档（2026-09-08 船长定：事件日志不落盘——写盘前剥离 logs，
   * 每次开启游戏日志空白；logs 仅作本局内存滚动展示）
   *
   * 2026-09-25 加（船长令 · 甲/乙）：写失败**不再只是控制台一行** —— 交给 `game/saveGuard` 每局提醒一次；
   * 落盘成功后顺手再申请一次持久化存储（乙）。挂起/不可写时直接返回 false（丁）。 */
  async persist(): Promise<boolean> {
    if (this.saveWriteState() !== 'ok') return false
    try {
      bumpIronmanSeq(this.state) // 铁人档：每次落盘代次 +1（普通档/已关闭 ⇒ 冻结）
      const out: GameState = this.state.logs.length > 0 ? { ...this.state, logs: [] } : this.state
      const ok = await saveBridge.save(serializeSaveFile(out))
      if (ok) void requestPersistentStorage()
      else noteSaveWriteFailed()
      return ok
    } catch (err) {
      console.error(tr("ui.engine.025"), err)
      noteSaveWriteFailed()
      return false
    }
  }

  /* ─────────────── 存档备份 / 恢复（B5） ─────────────── */

  /** 先落盘最新进度，再把存档复制成时间戳备份 */
  async backupNow(): Promise<{ ok: boolean; name?: string; error?: string }> {
    await this.persist()
    try {
      return await saveBridge.backup()
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /** 列出全部备份（时间倒序） */
  async listSaveBackups(): Promise<SaveBackupInfo[]> {
    try {
      const r = await saveBridge.listBackups()
      return r.ok ? r.backups : []
    } catch {
      return []
    }
  }

  /**
   * **铁人模式状态读数**（S4b 界面用）：模式开关 / 代次 / 是否开过 / 是否已关闭 / 救援档龄门槛。
   * 代次取「存档内」的那一份（`state.ironman.seq`）；账本高度另给一份供界面核对（正常 = 与存档同步）。
   */
  async ironmanStatus(): Promise<{
    on: boolean
    seq: number
    ever: boolean
    closed: boolean
    sinceWallMs?: number
    ledgerSeq: number
    rescueMinAgeMs: number
    /** **模式选择是否已做过**（2026-09-24 船长令）：false ⇒ 进游戏后要弹一次模式选择框 */
    modeChosen: boolean
  }> {
    let ledgerSeq = 0
    try {
      const ledger = await saveBridge.ironmanLedger()
      if (ledger.ok) ledgerSeq = ledger.seq
    } catch {
      ledgerSeq = 0
    }
    return {
      on: ironmanOn(this.state),
      seq: ironmanSeq(this.state),
      ever: ironmanEver(this.state),
      closed: ironmanClosed(this.state),
      sinceWallMs: this.state.ironman?.sinceWallMs,
      ledgerSeq,
      rescueMinAgeMs: IRONMAN_RESCUE_MIN_AGE_MS,
      modeChosen: ironmanModeChosen(this.state),
    }
  }

  /**
   * **是否该弹模式选择框**（**2026-09-24 船长令**「对至今未选择的旧档进行模式选择弹窗」）。
   *
   * 同步读**内存档**（不查账本）⇒ 界面每帧直接问；引擎 `notify()` 后判据自动翻转、弹层自动卸载。
   */
  modeChoiceNeeded(): boolean {
    return !ironmanModeChosen(this.state)
  }

  /**
   * **选「普通模式」**（**2026-09-24 船长令**：模式选择弹窗＝一次机会）。
   *
   * 写下 `state.modeChosen` ⇒ 那条记录意味着：这次选择机会用掉了，存档页不再提供"转铁人"入口。
   * ⚠ 与 `enterIronmanNow` 是**二选一的两条路**：选铁人走那边（`sinceWallMs` 本身就是记录），
   * 只有选普通要调本方法。已经选过（铁人或普通）⇒ 空操作返回成功，不覆盖任何东西。
   */
  async chooseStandardMode(): Promise<CommandResult> {
    if (ironmanModeChosen(this.state)) return { ok: true }
    markModeChosenAsStandard(this.state)
    await this.persist()
    this.notify()
    return { ok: true }
  }

  /**
   * **开启（或把现有旧档一次性转换为）铁人模式**（2026-09-23 船长：「新档可选，现有旧档允许进行一次转换」）。
   *
   * 代次起点 = `max(当前档代次, 账本高度)`——账本在存档之外，所以「重置档案」后再开铁人也不会从 0 重新起算。
   * 落盘一次即把账本顶到同一高度（`save:save` 顺带推代次），此后每次落盘 +1。
   */
  async enterIronmanNow(): Promise<CommandResult> {
    if (ironmanOn(this.state)) return { ok: false, error: tr('ui.Ironman.016') }
    // 单向门：关闭过就不能再开（core `enterIronman` 也会拒，这里先给一句人话）
    if (ironmanClosed(this.state)) return { ok: false, error: tr('ui.Ironman.018') }
    let ledgerSeq = 0
    try {
      const ledger = await saveBridge.ironmanLedger()
      if (ledger.ok) ledgerSeq = ledger.seq
    } catch {
      ledgerSeq = 0
    }
    if (!enterIronman(this.state, Date.now(), ledgerSeq)) return { ok: false, error: tr('ui.Ironman.018') }
    await this.persist()
    this.notify()
    return { ok: true }
  }

  /**
   * **关闭铁人模式**（单向门：关了不能再开，代次就此冻结）。
   * 福利同时失效、两枚隐藏徽章里的「铁人 · 已关闭」到此才可见。
   */
  async closeIronmanNow(): Promise<CommandResult> {
    if (!ironmanOn(this.state)) return { ok: false, error: tr('ui.Ironman.017') }
    closeIronman(this.state, Date.now())
    await this.persist()
    this.notify()
    return { ok: true }
  }

  /**
   * 恢复某份备份：先校验可解析 → 主进程覆盖 → 热替换内存状态。
   *
   * ⚠ **2026-09-17 船长**：「**导入或者恢复存档时，不要备份现有存档**」⇒ 覆盖前**不再**自动备份当前档
   * （桌面主进程与网页分支两处一起删）。要留退路请先用「备份当前档」手动备一份。
   */
  /**
   * **铁人档装载闸门**（**2026-09-23 船长令**：「如果导入一个铁人存档的版本号比当前存档的版本号更靠前
   * 则会导入失败」＋「允许玩家读取至少两天前的存档作为救援」）。
   *
   * 判据收口在 core 的 `ironmanLoadVerdict`（唯一实现）；本方法只负责取三样东西：
   * 待装载档的 `ironman` 面、**当前档**的代次、以及主进程里那份**存档之外的账本**最高代次。
   * - 普通档：一律放行（含"当前普通 + 载入普通"）；
   * - **铁人档 = 来档本身是铁人**（2026-09-24 船长裁定：只看当前档会把普通旧档一起拦掉）：
   *   但**存档年龄 ≥48 小时** ⇒ 救援放行（记一次账）。
   * 放行后会把内存档的代次**顶到账本高度**（否则"救援回来的旧档"下次导出再导入会被自己拦）。
   */
  private async ironmanLoadCheck(
    text: string,
    incomingSavedAtWallMs: number,
  ): Promise<{ ok: true; rescue: boolean } | { ok: false; error: string }> {
    /**
     * ⚠ **账本拿不到 ⇒ 只少一层高度，判据照走**（**2026-09-23 船长实测报障**：「实机测试，铁人模式
     * 并没有拦截备份存档和导入存档」）。原实现把"读账本"与"判闸门"写在同一个 try 里 ⇒ 旧主进程
     * 没有 `ironman:ledger` 这个 IPC 时 `invoke` reject，被下面的 catch 当成"闸门自身出错"**静默放行**，
     * 于是**整个闸门失效**（档内代次那层明明能判，却一起被跳过了）。
     * 现口径：**账本单独 try**，拿不到就 `ledgerSeq = 0` 继续判；只有"待装载档解析不了"才放行。
     */
    let ledgerSeq = 0
    try {
      const ledger = await saveBridge.ironmanLedger()
      if (ledger.ok) ledgerSeq = ledger.seq
    } catch (err) {
      console.warn('ironman ledger unavailable, gate degrades to in-save generations', err)
    }
    try {
      const incoming = loadSaveFile(text).state
      const now = Date.now()
      const verdict = ironmanLoadVerdict({
        /**
         * **只按"来档"判**（**2026-09-24 船长裁定**：「铁人为什么导入普通档会拒绝才是问题，
         * 不应该导入铁人存档才拒绝吗」）：
         * - 来档**是铁人档** + 代次落后 ⇒ **拒绝**（这才是闸门要防的"读档回滚"，也顺带挡住
         *   「关掉铁人 → 把关闭前的旧铁人档导回来」这条路）；
         * - 来档**是普通档** ⇒ **放行**，哪怕当前这局是铁人档（旧实现写成 `当前 || 来档`，
         *   于是普通档代次恒 0 一定小于阈值 ⇒ 玩家永远导不进自己的普通旧档 = 玩家报障的那个 bug）。
         * ⚠ 随之而来的语义：**导入普通档即离开铁人状态**（铁人标记以来档为准）——这是船长要的口子。
         */
        ironman: ironmanOn(incoming),
        incomingSeq: ironmanSeq(incoming),
        currentSeq: ironmanSeq(this.state),
        ledgerSeq,
        incomingSavedAtWallMs,
        nowWallMs: now,
      })
      if (!verdict.ok) {
        return { ok: false, error: tr('ui.engine.051', { p1: String(verdict.threshold) }) }
      }
      if (verdict.rescue) void saveBridge.ironmanNoteRescue()
      return { ok: true, rescue: verdict.rescue }
    } catch (err) {
      // 待装载档解析不了 ⇒ **不拦人**（宁可放行，也不要把玩家锁在自己的档外面；真正的解析错误后面会照常报）
      console.warn('ironman gate skipped (incoming save unreadable)', err)
      return { ok: true, rescue: false }
    }
  }

  /** 装载成功后把代次顶到"账本高度"（保持当前档永远处在账本头部） */
  private async syncIronmanHead(s: GameState): Promise<void> {
    /**
     * ⚠ **账本读不到不许拦人，也不许把原始英文报错抛给玩家**——2026-09-23 船长实测报障：
     * 旧主进程没有 `ironman:ledger` 这个 IPC ⇒ `invoke` 直接 reject，异常从这里冒到
     * `restoreBackup` 的错误分支，玩家看到一串
     * 「Error: Error invoking remote method 'ironman:ledger': No handler registered…」。
     * 口径：**退化为"只看两侧档内代次"**——闸门仍然生效，只是少了账本这一层高度。
     */
    try {
      const ledger = await saveBridge.ironmanLedger()
      const head = Math.max(ironmanSeq(s), ironmanSeq(this.state), ledger.ok ? ledger.seq : 0)
      s.ironman = { ...(s.ironman ?? { on: false, seq: 0 }), seq: head }
    } catch (err) {
      console.warn('ironman ledger unavailable, sync degraded', err)
      const head = Math.max(ironmanSeq(s), ironmanSeq(this.state))
      s.ironman = { ...(s.ironman ?? { on: false, seq: 0 }), seq: head }
    }
  }
  /**
   * **战前准备视图**（2026-09-25 船长令做「旗舰战入口和准备界面」）：界面渲染准备面板读它。
   * `null` = 现在不该出现入口（旗舰没现身 / 已落定局 / 不是 BOSS 族）。
   */
  weekendFlagshipPrep(): ReturnType<typeof weekendFlagshipPrepView> {
    return weekendFlagshipPrepView(this.state, this.ctx, Date.now())
  }

  /**
   * **"旗舰现身"一次性弹窗**（2026-09-25 船长令：「希望当核心星系收复敌人旗舰现身时，出现一次弹窗，
   * 玩家可以通过弹窗直接前往准备」）：
   * 引擎在**首次落盘 anchor 的那一拍**立起待办；界面读这里弹一次、玩家点「战前准备」或「知道了」即清。
   * ⚠ 只在内存里（不随档）：读档时若旗舰已在场，就不必再弹一遍（该看的信息活动框与星系详细里都有）。
   */
  get flagshipPopupPending(): boolean {
    return this.flagshipPopup
  }
  private set flagshipPopupPending(v: boolean) {
    this.flagshipPopup = v
  }
  private flagshipPopup = false
  /** 关掉那枚一次性弹窗（点「战前准备」或「知道了」都调它） */
  dismissFlagshipPopup(): void {
    if (!this.flagshipPopup) return
    this.flagshipPopup = false
    this.notify()
  }
  /**
   * **入侵警报演出的一次性待办**（**船长 2026-09-25 令**：「**当入侵发生时，游戏屏幕的正上方和正下方
   * 出现警告式的红灯闪烁**……警告灯闪烁数次后，再弹出通讯」＋「**开局 ＋ 旗舰现身各闪一次**」）。
   *
   * 形态照 `flagshipPopupPending`：引擎在**那一拍**立起待办（内存、不随档），界面**读一次即消费**
   * （`takeInvasionAlarm()`），拿到的就是该放哪一档演出：
   * - `'start'` = 入侵开局（`weekend.started`）· `'flagship'` = 旗舰现身（`weekend.flagshipAnchored`）。
   *
   * ⚠ 只在内存里：读档时若入侵早已在跑，不再补演一遍（该看的信息在活动框/星图/星系详细里都有）。
   */
  takeInvasionAlarm(): 'start' | 'flagship' | null {
    const v = this.invasionAlarm
    if (v === null) return null
    this.invasionAlarm = null
    return v
  }
  private get invasionAlarmPending(): 'start' | 'flagship' | null {
    return this.invasionAlarm
  }
  private set invasionAlarmPending(v: 'start' | 'flagship' | null) {
    this.invasionAlarm = v
  }
  private invasionAlarm: 'start' | 'flagship' | null = null
  /**
   * **挑战入侵旗舰**（M1-b 收尾 · 2026-09-23）：核心条满才成立（`weekendStartFlagshipBattle` 内部判）。
   *
   * 复用**遭遇槽**承载这一场（`state.encounter`）：这样「应战 / 战报 / 收尾结算」全走既有路径，
   * 战后由 `encounters.settleFight` 调 `weekendApplyBattleOutcome` ⇒ 击毁旗舰、黑匣、贡献结算自动闭环。
   */
  challengeWeekendFlagship(squad?: readonly string[]): CommandResult {
    const now = Date.now()
    const spec = weekendFlagshipSpecOf(this.state, this.ctx, now)
    if (!spec) return { ok: false, error: tr('ui.weekend.015') }
    /** squad = 战前准备界面选的编队（core 侧净化 + 落盘）；缺省 ⇒ 回落落盘编队或自动编队 */
    const battle = weekendStartFlagshipBattle(this.state, this.ctx, now, squad)
    if (!battle) return { ok: false, error: tr('ui.weekend.015') }
    const ev = this.state.weekendEvent!
    this.state.encounter = {
      active: true,
      shipId: weekendFlagshipSquadOf(this.state)[0] ?? this.state.shipId,
      galaxyId: ev.coreId,
      name: spec.name,
      threat: spec.threat,
      anomalyId: spec.cardId,
      origin: tr('ui.weekend.016'),
      invitedAtGameMs: this.state.gameMs,
      deadlineGameMs: this.state.gameMs + this.ctx.balance.encounter.inviteWaitMs,
      battle,
    }
    this.notify()
    void this.persist()
    return { ok: true }
  }

  /**
   * **周末入侵 · 结束后的贡献奖入账**（设计稿 ⑥「结束与结算」；2026-09-25 接上）。
   *
   * 设计原文：「结束时：① 统计贡献占比 → 发贡献奖（Q5 四档）② 玩家击毁 ⇒ 另发黑匣 ＋ 稀有残骸」。
   * ② 的黑匣与旗舰残骸**在击沉那一刻**已由 `weekendApplyBattleOutcome` 发过 ⇒ 这里只发 ① 的贡献四档。
   *
   * - **幂等**：core 侧 `weekendSettleAndGrant` 用 `ev.prizePaidAtWallMs` 落盘标记判重 ⇒ 每拍调也只发一次；
   * - **占比按结束时刻评估**（不是"这几拍"）：玩家离线几天后再上线补结，读数与结束时一致（不会少发）；
   * - 三档文案：有 ISK / 只有残骸（参与档）/ 零贡献（无奖，标记照写）。
   */
  private settleWeekendPrize(now: number): void {
    const r = weekendSettleAndGrant(this.state, this.ctx, now)
    if (!r) return
    const pct = (r.share * 100).toFixed(1)
    if (r.isk > 0) {
      const params = { p1: pct, p2: r.wreck, p3: r.isk.toLocaleString('zh-CN') }
      addLog(this.state, 'system', tr('ui.weekend.022', params), 'ui.weekend.022', params)
    } else if (r.wreck > 0) {
      const params = { p1: pct, p2: r.wreck }
      addLog(this.state, 'system', tr('ui.weekend.023', params), 'ui.weekend.023', params)
    } else {
      addLog(this.state, 'system', tr('ui.weekend.024'), 'ui.weekend.024')
    }
    this.notify()
    void this.persist()
  }

  async restoreBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const read = await saveBridge.readBackup(name)
      if (!read.ok || read.text === undefined) return { ok: false, error: read.error ?? tr('ui.engine.049') }
      let parsed: ReturnType<typeof loadSaveFile>
      try {
        parsed = loadSaveFile(read.text)
      } catch (err) {
        return { ok: false, error: tr("ui.engine.026", { p1: err instanceof Error ? err.message : String(err) }) }
      }
      const gate = await this.ironmanLoadCheck(read.text, parsed.savedAtWallMs)
      if (!gate.ok) return { ok: false, error: gate.error }
      await this.syncIronmanHead(parsed.state)
      const restore = await saveBridge.restore(name)
      if (!restore.ok) return { ok: false, error: restore.error ?? tr('ui.engine.050') }
      // 2026-09-09（船长定）：恢复备份与导入/启动同口径——按"档内保存墙钟 → 现在"补算离线进度
      // （≥60 秒且简报非空则弹出离线简报卡；墙钟在未来则跳过）。日志仍会话级不落盘。
      const now = Date.now()
      const wallFrom = parsed.savedAtWallMs
      if (wallFrom > 0 && now > wallFrom) {
        const before = snapshotBasics(parsed.state)
        const stats = newSettleStats()
        const { overflowMs } = offlineSplit(now - wallFrom, offlineCapMsOf(parsed.state))
        simulateOffline(parsed.state, wallFrom, now, this.ctx, undefined, { stats })
        this.offlineReport = buildOfflineReport(before, parsed.state, this.ctx, now - wallFrom, overflowMs, stats)
        if (this.offlineReport !== null) {
          addLog(parsed.state, 'system', offlineReportLogText(this.offlineReport))
        }
      } else {
        this.offlineReport = null
      }
      this.state = parsed.state
      // 2026-09-08 船长定：日志会话级（写盘剥离）——恢复备份不做强制清空，本局日志接续显示
      const saved = await this.persist() // 落盘（墙钟锚 = 现在 → 下次启动不会重复结算）
      if (!saved) return { ok: false, error: tr("ui.engine.027") }
      this.notify()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /* ─────────────── 存档导入 / 导出（外部文件；2026-09-08 船长定） ─────────────── */

  /** 当前进度序列化文本（与 persist 同口径：写盘前剥离会话日志） */
  private currentSaveText(): string {
    const out: GameState = this.state.logs.length > 0 ? { ...this.state, logs: [] } : this.state
    return serializeSaveFile(out)
  }

  /** 导出当前进度：桌面 = 系统保存对话框选位置；手机网页 = 优先系统分享、回落浏览器下载。
   *  ⚠ **顺序要紧：先调桥、后落盘**——网页端的分享/下载必须在**用户手势内**发起，
   *  若先 `await persist()` 再调桥，iOS Safari 会因"已不是用户手势"静默拦掉（表现为点了没反应）。 */
  async exportSaveToFile(): Promise<{ ok: boolean; path?: string; shared?: boolean; canceled?: boolean; error?: string }> {
    try {
      const r = await saveBridge.exportSaveToFile(this.currentSaveText())
      void this.persist() // 落盘最新进度（与备份同口径）；不阻塞导出
      return r
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /** 导出指定备份：桌面 = 系统对话框选位置；手机网页 = 优先系统分享、回落浏览器下载 */
  async exportBackupToFile(name: string): Promise<{ ok: boolean; path?: string; shared?: boolean; canceled?: boolean; error?: string }> {
    try {
      const read = await saveBridge.readBackup(name)
      if (!read.ok || read.text === undefined) return { ok: false, error: read.error ?? tr('ui.engine.049') }
      return await saveBridge.exportSaveToFile(read.text)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /** 从外部文件导入存档：**不备份当前档**（2026-09-17 船长）→ 校验可解析 → 按时间差补齐离线进度
   * （与正常启动同口径：repair 迁移 + simulateOffline + 离线简报）→ 落盘 → 热替换内存 */
  async importSaveFromFile(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    try {
      const picked = await saveBridge.pickImportSave()
      if (!picked.ok) return { ok: false, canceled: picked.canceled === true, error: picked.error }
      const text = picked.text ?? ''
      let parsed: ReturnType<typeof loadSaveFile>
      try {
        parsed = loadSaveFile(text)
      } catch (err) {
        return { ok: false, error: tr("ui.engine.028", { p1: err instanceof Error ? err.message : String(err) }) }
      }
      const imported = parsed.state
      /**
       * ⚠ **2026-09-17 船长**：「**导入或者恢复存档时，不要备份现有存档**」⇒ 原先这里会
       * `persist()` ＋ `saveBridge.backup()` 给当前档留一份"防误操作"备份，现已删除（与恢复那条同口径）。
       * 要留退路请在导入前点「备份当前档」——手动备份与备份列表功能照旧。
       */
      // 与正常启动同口径的载入修复链（须在离线结算前完成，让离线按新参数结算）
      repairDeprecatedModules(imported, this.ctx)
      migrateDeprecatedAmmo(imported)
      /**
       * ⚠ **2026-09-20（三号，船长「先修复」）**：**导入外部档一律不带入它的会话日志**。
       * 为什么：2026-09-08 那条口径「载入不做强制清空」是为**同会话的"恢复备份"**设计的
       * （本局日志接续显示，见下面 `restoreBackupFromFile` 那条注释）；导入是**换了一整份档**，
       * 旧档里的日志（实存于 2026-09-08 之前的真档与 `docs/test-saves` 的造档）会混进当前面板。
       * 与本地化也相关：那些旧日志只有中文正文、没有文案 id ⇒ 英文界面下会半中半英。
       */
      imported.logs = []
      // 铁人档：装载闸门（见 `ironmanLoadCheck`）
      const gate = await this.ironmanLoadCheck(text, parsed.savedAtWallMs)
      if (!gate.ok) return { ok: false, error: gate.error }
      await this.syncIronmanHead(imported)
      // 按时间差补齐离线进度：档内墙钟 → 现在（上限与正常离线一致；墙钟在未来则跳过）
      const now = Date.now()
      const wallFrom = parsed.savedAtWallMs
      if (wallFrom > 0 && now > wallFrom) {
        const before = snapshotBasics(imported)
        const stats = newSettleStats()
        const { overflowMs } = offlineSplit(now - wallFrom, offlineCapMsOf(imported))
        simulateOffline(imported, wallFrom, now, this.ctx, undefined, { stats })
        this.offlineReport = buildOfflineReport(before, imported, this.ctx, now - wallFrom, overflowMs, stats)
        if (this.offlineReport !== null) {
          addLog(imported, 'system', offlineReportLogText(this.offlineReport))
        }
      }
      this.state = imported
      const saved = await this.persist() // 落盘（写盘剥离日志；墙钟锚 = 现在 → 下次启动不会重复结算）
      if (!saved) return { ok: false, error: tr("ui.engine.027") }
      this.notify()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /** 删除某份备份（只删备份文件，不影响当前档） */
  async deleteSaveBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      return await saveBridge.deleteBackup(name)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /* ─────────────── 玩家动作（成功后自动存档 + 通知界面） ─────────────── */

  /** 训练某技能到"队列里应排的下一级"（T2 连锁：已学 + 1 + 已排同技能条数） */
  trainNextLevel(skillId: string): CommandResult {
    const current = this.state.skills.trained[skillId] ?? 0
    if (current >= MAX_SKILL_LEVEL) return { ok: false, error: tr("ui.engine.029") }
    const queued = this.state.skills.queue.filter((q) => q.skillId === skillId).length
    const target = current + 1 + queued
    if (target > MAX_SKILL_LEVEL) return { ok: false, error: tr("ui.engine.030") }
    const result = enqueueSkill(this.state, skillId, target, this.ctx.skills)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 从训练队列移除第 index 项（0 = 队首）——2026-09-23 起带**依赖级联**（core 侧按 catalog 判） */
  dequeueAt(index: number): boolean {
    const ok = removeQueueAt(this.state, index, this.ctx.skills)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /**
   * **取消这一项会连带取消哪些**（**2026-09-23 船长令**：「训练队列内取消一个技能的同时会取消所有依赖其
   * 前置的后续技能的训练」＋裁定甲「会连带取消时先弹确认条列出」）：纯计划，界面拿它渲染确认条；
   * 真正的取消仍走 `dequeueAt`（core 用同一把尺执行）。
   */
  skillCancelImpactAt(index: number): { target: TrainingItem; also: TrainingItem[] } | null {
    return skillCancelImpact(this.state, this.ctx.skills, index)
  }

  /**
   * **一键补齐前置（含目标本级）**（**2026-09-23 船长令**：「玩家选择某个技能后，如果该技能有前置技能，
   * 可以直接添加前置技能到训练队列。」＋同日追加「**「一并加入前置」要练目标一起排**」）：
   * 按 core `planPrereqChain(..., { includeTarget: true })` 的计划**逐条入队**（拓扑序、逐级、
   * 已在队列里的前置复用不重复，**末尾排上目标技能自己的下一级**）。返回排了几项，供界面回话。
   */
  enqueuePrereqChain(skillId: string): { ok: boolean; added: number; error?: string } {
    const def = this.ctx.skills.get(skillId)
    if (!def) return { ok: false, added: 0, error: tr('core.engine.005', { p1: skillId }) }
    const steps = planPrereqChain(this.state, def, this.ctx.skills, { includeTarget: true })
    let added = 0
    for (const step of steps) {
      const r = enqueueSkill(this.state, step.skillId, step.targetLevel, this.ctx.skills)
      if (!r.ok) return { ok: false, added, error: cmdText(r) }
      added += 1
    }
    if (added > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, added }
  }

  /** 2026-09-08（船长）：调整训练队列顺序（前移到顶 = 交换式顶替当前训练，原训练退位保留进度） */
  moveQueueAt(fromIndex: number, toIndex: number): boolean {
    // 2026-09-23：带 catalog ⇒ 挪完校验"没有哪一项排在它要的前置之前"（破了整单回滚）
    const ok = moveQueueItem(this.state, fromIndex, toIndex, this.ctx.skills)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /** 清空训练队列 */
  clearQueue(): number {
    const count = clearSkillQueue(this.state)
    if (count > 0) {
      void this.persist()
      this.notify()
    }
    return count
  }

  /** 开始在矿带开采（`withActivitySwitch`：会中断长途运输时首击只警告） */
  startMiningAt(beltId: string): CommandResult {
    return this.withActivitySwitch('mining', () => {
      const result = startMining(this.state, beltId, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** T4 延后项：远征中直接转开采（UI 两步确认后调用；取消远征并停止清剿） */
  startMiningFromExpeditionAt(beltId: string): CommandResult {
    const result = startMiningFromExpedition(this.state, beltId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 停止开采（返回是否真的在采） */
  stopMiningNow(): boolean {
    const ok = stopMining(this.state, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /** 该星系当前可选**打捞对象**与各自存量（界面下拉用；2026-09-26 船长令） */
  salvageTargetsAt(
    galaxyId: string,
    /** **只读**（渲染期用）：缺分组账时现算均分、不写档 */
    readOnly = false,
  ): Array<{ groupKey: string; stockM3: number }> {
    return readOnly ? wreckGroupStocksOf(this.state, this.ctx, galaxyId, true) : wreckTargetsOf(this.state, this.ctx, galaxyId)
  }


  /**
   * B3：开始打捞作业（采矿式自动循环，默认卸货后续捞；需高槽打捞器）。
   *
   * ⚠ **2026-09-26 船长令**：「**玩家打捞时，让玩家选择打捞对象……之后残骸也要分开算。**」
   * `targetGroup` = `undefined`（全部，现状）/ 组 key（如 `h-hi`）/ `WEEKEND_WRECK_TARGET`（只捞入侵残骸）。
   */
  startSalvageOpAt(galaxyId: string, targetGroup?: string): CommandResult {
    return this.withActivitySwitch('salvaging', () => {
      const result = startSalvageOp(this.state, galaxyId, this.ctx, targetGroup)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** B3：停止打捞作业 */
  stopSalvageOpNow(): boolean {
    const ok = stopSalvageOp(this.state, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /** 启动精炼炉运转（worker：'pilot' = 主控亲自运转（全局限 1 台）/ AI 核心类型 = 核心驱动自动化，每闲置核心 1 台） */
  startRefineRunAt(itemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('refine', () => {
      const result = startRefineRun(this.state, itemId, worker, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** 停指定台号的炉（v20 按台号定位；同资源多台互不影响）：已完成批保留，原料未锁定无需退回；AI 核心自动归还 */
  stopRefineRunAt(runId: number | string): CommandResult {
    const result = stopRefineRun(this.state, this.ctx, Number(runId))
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** B3：启动残骸回收（开箱批：10 m³/25s；残骸计数 = 体积；多工位并行） */
  /** 虫洞：**拆解一件遗迹安全货柜**（F4d · 与精炼/回收同一条产线机器；90 秒/件） */
  startUnboxRunAt(boxItemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('refine', () => {
      const result = startUnboxRun(this.state, this.ctx, boxItemId, worker)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }
  startRecycleRunAt(wreckItemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('refine', () => {
      const result = startRecycleRun(this.state, wreckItemId, worker, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** 全部精炼炉工位运行视图（v19 多工位：工业页卡片逐台 / 活动栏逐条） */
  refineRunViews(): RefineRunView[] {
    return refineRunViews(this.state, this.ctx)
  }

  /**
   * **逆向解锁**（2026-09-19 玩家报障修：碎片集齐后无处可换）。
   * 消耗该装备的蓝图碎片（货仓 + 仓库），永久学会对应配方；需停靠空间站。
   * 按钮状态读数走 core 的单点 `fragmentRedeemRowsOf`（本方法与它同一口径）。
   */
  redeemFragmentsAt(moduleId: string): CommandResult {
    const result = redeemFragments(this.state, this.ctx, moduleId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 「逆向解锁」逐条读数（物品页「蓝图碎片」行用：现有 / 门槛 / 已掌握 / 可兑） */
  fragmentRedeemRows(): FragmentRedeemRow[] {
    return fragmentRedeemRowsOf(this.state, this.ctx)
  }

  /** 卖当前船货仓里的物品（旧名兼容） */
  sellItem(itemId: string): SellResult {
    return this.sellCargo(itemId)
  }

  /** 购买新舰船 */
  buyShipAt(shipId: string): CommandResult {
    const result = buyShip(this.state, shipId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 学习蓝图书（消耗一本 → 永久学会配方） */
  learnBlueprintAt(blueprintId: string): CommandResult {
    const result = learnBlueprint(this.state, this.ctx, blueprintId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 市价买入商品（默认 1 件；矿石/矿物传数量）。
   *  2026-09-11 船长实测反馈修复：买不到时**按真实原因分别报错**（此前一律报「供应簿只剩 0 件」，
   *  实测钱包不足时 141 个有货商品里 104 个会这样说、声望不足时 3 个 MK3 会这样说——全是误导）；
   *  部分成交时改报"已买多少、还剩多少"，不再说"无法购买"。 */
  buyGoodAt(goodKey: string, qty = 1): CommandResult {
    const res = buyAtMarket(this.state, this.ctx, goodKey, qty)
    if (res.bought > 0) {
      void this.persist()
      this.notify()
    }
    if (res.bought >= qty) return { ok: true }
    const def = this.ctx.marketGoods.get(goodKey)
    const name = def ? goodName(this.ctx, goodKey) : goodKey
    if (res.bought > 0) {
      // 部分成交：货已入库，只提示"只够这些"
      return {
        ok: false,
        error: tr("ui.engine.031", { p1: res.bought.toLocaleString('zh-CN'), name: name, p3: res.bought.toLocaleString('zh-CN') }),
      }
    }
    switch (res.blocked) {
      case 'insufficient-isk': {
        const quote = marketQuote(this.state, this.ctx, goodKey)
        const unit = quote.sell ?? 0
        return {
          ok: false,
          error: tr("ui.engine.032", { p1: unit.toLocaleString('zh-CN'), p2: Math.floor(this.state.wallet.isk).toLocaleString('zh-CN') }),
        }
      }
      case 'standing':
        return {
          ok: false,
          error: tr('ui.engine.033', {
            p1: def
              ? (bmGateReason(this.state, def) ?? goodLockedReason(this.state, def) ?? tr('ui.engine.034'))
              : tr('ui.engine.034'),
          }),
        }
      case 'not-buyable':
        return { ok: false, error: tr("ui.engine.035", { name: name }) }
      default:
        return {
          ok: false,
          error: tr("ui.engine.036", { name: name }),
        }
    }
  }

  /** 挂限价买单（等 NPC 补给/降价自动成交）；返回新订单 id（失败返回 null）
   *  2026-09-10 起挂单瞬间会先与现有卖单簿面对冲成交，回执带回成交量（filled / resting）。
   *  2026-09-11 船长裁决「甲」：**预扣冻结**——挂单即扣 `挂价 × 实际挂量`，余额不足按余额缩量，
   *  回执带 `escrow`（本次预扣额）与 `placed`（实际挂了多少件，可能因缩量 < want）。 */
  placeBuyOrderAt(
    goodKey: string,
    price: number,
    qty: number,
  ): { orderId: number; want: number; placed: number; filled: number; resting: number; escrow: number } | null {
    const order = placeBuyOrder(this.state, this.ctx, goodKey, price, qty)
    if (!order) return null
    void this.persist()
    this.notify()
    // 全部即时成交的单已移出挂单表，但返回的订单对象仍带成交量（filled / 剩余 qty）
    return {
      orderId: order.id,
      want: qty,
      placed: order.filled + order.qty,
      filled: order.filled,
      resting: order.qty,
      escrow: order.escrowIsk ?? 0,
    }
  }

  /** 挂买单能不能挂（不能则给玩家可读原因）——界面门控与回执共用 core 单点口径 */
  buyOrderBlocked(goodKey: string, price: number, qty: number): string | null {
    return buyOrderBlockedReason(this.state, this.ctx, goodKey, price, qty)
  }

  /** 挂限价卖单（货从自然库存锁定：物品→仓库、装备→装备库、蓝图→蓝图书架）
   *  2026-09-10 起挂单瞬间会先与现有收购单簿面对冲成交，回执带回成交量（filled / resting） */
  placeSellOrderAt(
    goodKey: string,
    price: number,
    qty: number,
  ): { ok: boolean; error?: string; orderId?: number; price?: number; filled?: number; resting?: number } {
    const res = listSellHolding(this.state, this.ctx, goodKey, price, qty)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  /**
   * **「第一次」任务：点「完成」**（**2026-09-21 船长令**：「第一次任务不要自动完成。要让玩家回到任务中心
   * 点击完成才开始下一步，这样给予任务开始前道具的时间点就很明确」）。
   *
   * 一次点击做完：写 `done` → 发完成奖励 → 发**下一条的起手道具**（全部在 core 的 `claimFirstTask` 里）；
   * 情报信在下一拍由 `advanceComms` 送达（触发器照旧读 `done`）。返回失败原因时界面直接 toast。
   */
  claimFirstTaskAt(id: string): { ok: boolean; error?: string } {
    const res = claimFirstTask(this.state, this.ctx, id)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  /** 撤销自己的挂单（货物退回对应库存） */
  cancelOrderAt(orderId: number): boolean {
    const ok = cancelOrder(this.state, this.ctx, orderId)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /** 市价卖出持有的商品（市场页按钮；数量省略 = 全部） */
  sellHoldingAt(
    goodKey: string,
    qty?: number,
  ): { ok: boolean; error?: string; sold?: number; total?: number; remaining?: number } {
    const res = marketSellHolding(this.state, this.ctx, goodKey, qty)
    if (res.ok && res.sold > 0) {
      void this.persist()
      this.notify()
    }
    // 2026-09-14：舰船也走这条（可卖 = 舰船仓库艘数）⇒ 回执带上 sold/total/remaining，
    // 界面才能把"即时成交几艘、留簿几艘"说清楚（物品侧忽略这三个字段）
    if (res.ok) return { ok: true, sold: res.sold, total: res.total, remaining: res.remaining }
    return { ok: false, error: res.error ?? tr('core.market.007') }
  }

  /** 市价卖出预览（只读）：全部卖出确认框用——可成交件数/毛额/税/税后到账/剩余 */
  sellPreviewAt(goodKey: string, qty?: number): ReturnType<typeof marketSellPreview> {
    return marketSellPreview(this.state, this.ctx, goodKey, qty)
  }

  /** 市价出售机库里的舰船（须空仓、无装配、非驾驶）
   *  ⚠ **自 2026-09-14 起没有界面入口**（船长：「之后移除我的舰队内舰船的出售按钮」——
   *  出售统一走舰船仓库）；core 出口与用例保留（老档 escrow 撤单与后续复用），界面改调 `sellStoredShipAt`。 */

  /** 移入舰船仓库（2026-09-14 船长）：`clearName` = 已在确认弹层同意清掉自定义名 */
  storeShipAt(uid: string, clearName = false): CommandResult {
    const res = storeShip(this.state, uid, this.ctx, { clearName })
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  /** 从舰船仓库转入舰队（生成全新实例） */
  unstoreShipAt(defId: string): CommandResult {
    const res = unstoreShip(this.state, defId, this.ctx)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  /** 舰船仓库市价出售（吃收购簿即时成交；未成交转限价卖单，撤单退回舰船仓库） */
  sellStoredShipAt(defId: string): CommandResult {
    const res = sellStoredShipAtMarket(this.state, this.ctx, defId)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res.ok ? { ok: true } : { ok: false, error: res.reason ?? tr('core.market.007') }
  }

  /** 开始制造（2026-09-08 劳动者制与精炼炉同款：worker='pilot' 主控亲自（全局限 1 条、占主控）/ AI 核心类型 = 一枚核心驱动一条线；
   * 扣材料（制造费已取消），时间到自动完成；AI 线完成/取消核心自动归还） */
  startManufacturingAt(blueprintId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('manufacturing', () => {
      const result = startManufacturing(this.state, blueprintId, worker, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** 把装备库里的装备装到对应槽位 */
  fitModuleAt(moduleId: string): CommandResult {
    const result = fitModule(this.state, moduleId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 卸下某槽位的装备（放回装备库；旧六槽语义的兼容入口） */
  unfitSlotAt(slot: ModuleSlot): boolean {
    const ok = unfitSlot(this.state, slot)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /** V18：把装备装到 指定槽类+位序（shipId 缺省 = 当前驾驶船；2026-09-05 装配页可装配非驾驶船） */
  fitModuleTo(moduleId: string, rack: RackSlot, index: number, shipId?: string): CommandResult {
    const result = fitModule(this.state, moduleId, this.ctx, { rack, index, shipId })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** V18：卸下 指定槽类+位序 的装备（放回装备库；shipId 缺省 = 当前驾驶船）。
   *  2026-09-10 船长：传 ctx——卸下甲板扩展后机舱变小，超出容量的无人机随之自动卸下退回仓库。
   *  2026-09-11 协处理器：**CPU 双向校验**——卸下会收回该件的扩容，超载时拒绝并回报原因
   *  （返回值由 boolean 改 CommandResult，让装配页能把「为什么卸不掉」直接弹给玩家）。 */
  unfitAtAt(rack: RackSlot, index: number, shipId?: string): CommandResult {
    const uid = shipId ?? this.state.shipId
    const why = cpuOverloadText(this.state, this.ctx, uid, { remove: { rack, index } })
    if (why !== null) return { ok: false, error: why }
    const ok = unfitAt(this.state, rack, index, shipId, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
      return { ok: true }
    }
    return { ok: false, error: tr("ui.engine.037") }
  }

  /** V18：**换装**（某位旧件 → 装备库里的新件）——一次成型、按最终状态校验 CPU。
   *  2026-09-11：装配页原先"先卸后装"，在 CPU 双向校验下会把「换协处理器」这类
   *  最终态合法、中间态非法的换装卡住；改走本命令（core swapModuleAt）。 */
  swapModuleTo(moduleId: string, rack: RackSlot, index: number, shipId?: string): CommandResult {
    const result = swapModuleAt(this.state, moduleId, this.ctx, { rack, index, shipId })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  // ── 装配方案（预设）：保存当前装配 / 套用 / 重命名 / 删除 / 一键卸下（2026-09-14 船长，装配页入口） ──

  /** 保存当前装配为方案（按**船型**归口；默认「方案 N」；同名覆盖；满 `FIT_PRESET_MAX`（现 10）套且无同名时拒绝） */
  saveFitPresetFor(shipId: string, name?: string): CommandResult {
    const result = saveFitPreset(this.state, this.ctx, shipId, name)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **用当前装配覆盖指定方案**（船长 2026-09-19：装配方案加「替换」按钮）——名称与位置保持原样，
   * 只换内容；界面侧负责"覆盖前确认"。
   */
  overwriteFitPresetAt(shipId: string, index: number): CommandResult {
    const result = overwriteFitPreset(this.state, this.ctx, shipId, index)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 套用方案（先卸光再装 · 尽力装 + 逐条提示；`summary` 直接弹给玩家） */
  applyFitPresetAt(shipId: string, index: number): FitPresetApplyResult {
    const result = applyFitPreset(this.state, this.ctx, shipId, index)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 重命名方案（船型 + 序号；同名拒绝） */
  renameFitPresetAt(defId: string, index: number, name: string): CommandResult {
    const result = renameFitPreset(this.state, defId, index, name)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 删除方案（船型 + 序号；删空则连键一起清掉） */
  deleteFitPresetAt(defId: string, index: number): CommandResult {
    const result = deleteFitPreset(this.state, defId, index)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 一键卸下目标船的全部装备（放回装备库）；进洞/自动探索中的船拒绝（锁判定在 core 内） */
  unfitAllFor(shipId: string): UnfitAllResult {
    const result = unfitAllModules(this.state, this.ctx, shipId)
    if (result.ok && result.removed > 0) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-08 无人机舱：清单调整（delta>0 装入/δ<0 卸下；shipId 缺省 = 当前驾驶船） */
  adjustDroneLoadAt(droneId: string, delta: number, shipId?: string): CommandResult {
    const result = adjustDroneLoad(this.state, this.ctx, droneId, delta, shipId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-09 弹药 MK2：设置弹族档位（itemId = null 恢复基础弹；shipId 缺省 = 当前驾驶船） */
  setAmmoTierAt(type: DamageType, itemId: string | null, shipId?: string): CommandResult {
    const result = setAmmoTier(this.state, this.ctx, type, itemId, shipId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **这一场出征的"打的哪个星系"**——随远征落盘，供战后归属 / 残骸注入用。
   *
   * ⚠ **2026-09-25 修"串星系"**（玩家报障「打红环的常驻悬赏，不加红环的进度条」）：
   * 原来只按卡 id 反查（`anomalies.find(a => a.id === id)`），而 H 族"每星系抽一支驻留舰队"只在
   * 本族那几张独立卡里抽 ⇒ **多个被占星系会抽到同一张卡**（真档：深渊之门/暗星坟场/红环航道都是
   * `ink-raid`）⇒ 反查**永远命中列表第一个**同 id 行：点核心或坟场的行，归属被写成红环（反之亦然，
   * 玩家那边"第一个"若是核心，点红环就一分进度都不给）。
   *
   * 现在：**界面上被点的那一行的星系**（`hintGalaxyId`）优先 —— 它确实是活的占领区就采信；
   * 没传 hint（老调用方 / 非入侵卡）⇒ 逐字回落老口径。
   */
  private foeGalaxyOf(anomalyId: string, hintGalaxyId?: string): string | undefined {
    const cardGalaxyId = this.anomalies.find((a) => a.id === anomalyId)?.galaxyId
    return weekendLaunchGalaxyOf(this.state, hintGalaxyId, cardGalaxyId, Date.now())
  }

  /**
   * **出击被占星系时的"每场重抽"**（2026-09-25 船长令：「主动出击也要每场重抽」）：
   * 出发那一刻从该区域池里重新抽一支（`weekendAssaultDrawOf`，盐 = 本场已出发次数），
   * 并把**奖励基底**钉在"该星系原卡 ×1.4"（抽到哪支都一样价）。出击**成功**才记一次计数 ⇒ 下一场换一支。
   * 非占领区 / 活动已结束 ⇒ 原样返回（老路径零变化）。
   */
  private weekendDispatchOf(anomalyId: string, hintGalaxyId?: string): { cardId: string; rewardIskOverride?: number } {
    const galaxyId = this.foeGalaxyOf(anomalyId, hintGalaxyId)
    if (galaxyId === undefined) return { cardId: anomalyId }
    const drawn = weekendAssaultDrawOf(this.state, this.ctx, galaxyId, Date.now())
    if (drawn === null) return { cardId: anomalyId }
    return { cardId: drawn.cardId, rewardIskOverride: drawn.rewardIsk }
  }

  /**
   * 出发远征（去程取消：下达即进入实时交火 → 结算/返航自动执行）。
   * `foeGalaxyId` = **界面上被点的那一行的星系**（常驻悬赏/星图列表都要传；不传 = 老口径按卡 id 反查）。
   */
  startExpeditionAt(anomalyId: string, foeGalaxyId?: string): CommandResult {
    return this.withActivitySwitch('expedition', () => {
      const galaxyId = this.foeGalaxyOf(anomalyId, foeGalaxyId)
      const dispatch = this.weekendDispatchOf(anomalyId, foeGalaxyId)
      const result = startExpedition(this.state, dispatch.cardId, this.ctx, {
        ...(galaxyId !== undefined ? { foeGalaxyId: galaxyId } : {}),
        ...(dispatch.rewardIskOverride !== undefined ? { rewardIskOverride: dispatch.rewardIskOverride } : {}),
      })
      if (result.ok) {
        /** 抽过才计数（`weekendDispatchOf` 是纯的、不改计数）⇒ 下一次出击换一支 */
        if (dispatch.cardId !== anomalyId) weekendNoteAssaultDispatch(this.state)
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** T4 延后项：采矿中直接转战悬赏（UI 两步确认后调用；采矿终止、货随船、从矿带星系出发） */
  startExpeditionFromMiningAt(anomalyId: string, foeGalaxyId?: string): CommandResult {
    const result = startExpeditionFromMining(this.state, anomalyId, this.ctx, {
      foeGalaxyId: this.foeGalaxyOf(anomalyId, foeGalaxyId),
    })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 赏金任务·窝点出击（2026-09-10 船长定）：目标 = 派生窝点，档位随任务锁定
   *  （威胁/波次/僚机按档位强化、胜利后按窝点口径结算酬金与稀有残骸）。 */
  startLairExpeditionAt(anomalyId: string, lairTier: LairTier, fromMining = false): CommandResult {
    return this.withActivitySwitch('expedition', () => {
      const result = fromMining
        ? startExpeditionFromMining(this.state, anomalyId, this.ctx, { lairTier, foeGalaxyId: this.foeGalaxyOf(anomalyId) })
        : startExpedition(this.state, anomalyId, this.ctx, { lairTier, foeGalaxyId: this.foeGalaxyOf(anomalyId) })
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** V13 探索：对星图剪影星系发起扫描探索（完成回港点亮该星系） */
  startScanAt(galaxyId: string): CommandResult {
    const result = startScan(this.state, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** V14 探索：召回扫描艇（就地扫描窗口进度会保存，下次续扫） */
  stopScanNow(): CommandResult {
    const result = stopScan(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **玩家进「星图」看过 ⇒ 收掉扫描完成的高亮**（船长 2026-09-15：完成后进度条依旧存在并高亮，
   * 直到玩家进入星图界面查看后才移除）。本来就没有待查看的 ⇒ 什么都不做（不落档、不通知）。
   */
  ackScanView(): void {
    if (acknowledgeScanView(this.state)) {
      void this.persist()
      this.notify()
    }
  }

  /**
   * **主控活动「扫描虫洞」**（2026-09-14 船长）：只能在「扫描虫洞」界面里开始/停止。
   * 进度保留（停扫不清零）；满一个窗口由 `advanceWormholeScan` 在推进里发现一处虫洞。
   */
  wormholeScanStart(): CommandResult {
    return this.withActivitySwitch('wormholeScan', () => {
      const r = wormholeScanStart(this.state, this.ctx)
      if (r.ok) {
        void this.persist()
        this.notify()
      }
      return r
    })
  }

  /** 停「扫描虫洞」（进度保留） */
  wormholeScanStop(): CommandResult {
    const r = wormholeScanStop(this.state)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /** v21：取消指定制造线（按线号；材料全额退回仓库；制造费已取消无退费一说） */
  cancelManufacturingAt(runId: number | string): CommandResult {
    const result = cancelManufacturing(this.state, this.ctx, Number(runId))
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 组装机「循环制造」开关（2026-09-10 船长定：挂在**整张生产卡**上——按蓝图 id 定位，
   *  作用于该卡全部制造线（含主控亲自那条），打开后新开的线自动继承；
   *  目标件数 = 全卡合计（0/缺省 = 直到材料不足）；「关→开」= 开一批新循环，合计清零）
   *  @param blueprintId 蓝图 id（= 生产卡） */
  setManufacturingLoopAt(blueprintId: string, on: boolean, goal?: number | null): CommandResult {
    const result = setManufacturingLoop(this.state, blueprintId, on, goal ?? null)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T1：召回远征（仅去程/返航；交火中拒绝） */
  recallExpeditionNow(): CommandResult {
    const result = recallExpedition(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /* ─────────────── 终局玩法「虫洞」（E 批 · ✅ 2026-09-14 已上线） ─────────────── */

  /**
   * **"新开一层"用的现掷种子**（船长 2026-09-19：「**虫洞建议取消固定种子，玩家会采用恢复存档的方法
   * 搞清楚地图**」·裁定「甲」）。
   *
   * 为什么要**离开存档**取种：原先进洞取 `item.seed`（库存项里存着）、深入取 `state.rng.seed`
   * （存档里存着）⇒ 都是"读档能重现"的值 ⇒ 玩家存档 → 进洞/深入看一眼 → 读档 → 再来一次，
   * 地图一模一样，等于把整层免费看光。现在改成**墙钟 + 随机混合**（两者都不在存档里）
   * ⇒ 读档重现不出同一张图。
   *
   * ⚠ 只改"新开一层"的那一刻：种子照样写进 `run.seed` **随档保存** ⇒ **同一趟之内**（临时离开再回来、
   * 读档续玩）地图依旧稳定、不会自己变；工具与用例走低层 API 传显式种子 ⇒ 可复现性一字不动。
   * ⚠ **战斗结果本来就不受本改动影响**：掷骰走随档的 `state.rng`，读档重打结果一样（既有口径）。
   */
  private freshLayerSeed(): number {
    const s = (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0
    return s === 0 ? 1 : s
  }

  /** 虫洞：跃入（编队校验 + 建副本）。种子**现掷**（见 `freshLayerSeed`），不再是存档里的可复现值 */
  wormholeEnter(shipIds: readonly string[]): CommandResult {
    const r = wormholeEnter(this.state, this.ctx, shipIds, this.freshLayerSeed())
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /**
   * **从库存进洞**（2026-09-14 船长：发现的虫洞囤在「扫描虫洞」页，玩家在那里选一处开始探索）。
   * 起始层取该项的 `depth`；进洞成功即**消耗**这一处。
   *
   * ⚠ 2026-09-19（船长「取消固定种子」·裁定「甲」）：**种子现掷**（不再用 `item.seed` ⇒ 同一处虫洞
   * 每次进去都是新图），但**该处承诺的"族 + 原型"照旧兑现**——用 `origin` 把
   * `item.family / item.archetype`（老档没有这些字段时按 `item.seed` 现算）显式写进本趟
   * ⇒ 进洞前「敌情行」看到的族与原型不变，与 2026-09-14「一处虫洞一族、整趟同族」不冲突。
   */
  wormholeEnterFromStock(stockId: string, shipIds: readonly string[]): CommandResult {
    const item = wormholeStockOf(this.state).find((x) => x.id === stockId)
    if (!item) return { ok: false, error: tr("ui.engine.038") }
    const r = wormholeEnter(this.state, this.ctx, shipIds, this.freshLayerSeed(), {
      depth: item.depth,
      archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
      family: item.family ?? wormholeFamilyOfSeed(item.seed),
    })
    if (!r.ok) return { ok: false, error: r.error }
    const run = this.state.wormhole.run
    if (run) run.depth = Math.max(1, Math.min(9, item.depth))
    wormholeStockTake(this.state, stockId)
    void this.persist()
    this.notify()
    return { ok: true }
  }

  /** 虫洞扫描：库存读数（界面用） */
  wormholeStock(): Array<{
    id: string
    seed: number
    depth: number
    archetype: WormholeArchetype
    family: WormholeFamily
    foundAtGameMs: number
  }> {
    /** 老档缺 原型/族 ⇒ 这里按种子补全（与 `wormholeStockMeta` 同口径），界面只认完整口径 */
    return wormholeStockOf(this.state).map((x) => ({ ...x, ...wormholeStockMeta(x) }))
  }

  /** 虫洞：放弃一处已发现的虫洞（船长 2026-09-14：「玩家要能够放弃已经探索出的虫洞」） */
  wormholeStockDiscard(id: string): CommandResult {
    const r = wormholeStockDiscard(this.state, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /**
   * 族名（取该族那张洞内敌卡的卡名：劫掠支队 / 星髓游猎群 / 守墓巡哨 / 巨构残响 / 亡军封锁）。
   *
   * ⚠ **必须走 `ctx.anomalies` 全表**：五张洞内卡都带 `hidden: true`（**虫洞专用遭遇，不进悬赏目录**），
   * 而 `this.anomalies` 是**过滤掉 hidden 的目录** ⇒ 早先在这里查不到、界面直接漏出内部 id
   * （船长 2026-09-14 报障看到的是 `wh-alien-swarm`）。改成查全表，查不到才退回 id。
   */
  wormholeFamilyName(family: WormholeFamily): string {
    const cardId = WORMHOLE_FAMILY_CARD[family]
    return this.ctx.anomalies.get(cardId)?.name ?? this.anomalies.find((a) => a.id === cardId)?.name ?? cardId
  }

  /**
   * **一族的"敌情"摘要**（船长 2026-09-16：「扫描虫洞界面…给虫洞卡片添加更多信息
   * （虫洞内是什么敌人，以什么类型伤害为主）」）：族称 + 浅层卡名 + **主系一句话** + 三档「卡名 + 火力构成」。
   *
   * 与 `wormholeFamilyName` 同一把尺（**走 `ctx.anomalies` 全表**，洞内卡都是 hidden）；
   * 构成取 core 单点 `foeDamageComposition` ⇒ 与战斗结算同源，卡面不会与实战脱节。
   */
  wormholeFamilyIntel(family: WormholeFamily): WormholeFamilyIntel {
    return wormholeFamilyIntel(family, this.ctx)
  }

  /** 虫洞扫描：本趟窗口（毫秒；12 小时 × 三技能乘算 × 星际奇遇学 × **谜质科技「谐振信号滤波阵列」削减**）
   *  ⚠ 2026-09-19 报障排查补：读数必须与 `advanceWormholeScan` 的实际窗口同尺（原先没带科技削减 ⇒ 显示偏长） */
  wormholeScanWindow(): number {
    return wormholeScanWindowMs(this.state, matterTechScanCut(this.state, this.ctx))
  }

  /**
   * **进洞门槛（核心同一把尺）**：主控 + 编队各船必须空闲；`null` = 可以进洞。
   * ⚠ 「扫描虫洞 / 开采 / 打捞」**不算拦**（船长 2026-09-14「进洞自动停止」＋「同样落实到采矿/打捞」：
   * 进洞那一步会把它们停掉）⇒ 界面据此置灰，并用 `wormholeEntryAutoStopText()` 预告"会先自动停掉哪些"。
   */
  wormholeEntryGate(shipIds: readonly string[]): string | null {
    return wormholeEntryBlockReason(this.state, this.ctx, shipIds)
  }

  /**
   * 进洞时会自动停掉的活动名（「扫描虫洞、开采、打捞」这类短名；没有则 null）——准备页预告条用它。
   *
   * ⚠ 2026-09-26：取词改走 `a.nameId`（`paramText` 那套：`core.` 前缀的 id 先翻好再用），
   * `a.name` 只作中文兜底 ⇒ 英文界面下不再是中文短名。
   */
  wormholeEntryAutoStopText(): string | null {
    return wormholeEntryAutoStops(this.state).map((a) => paramText(a.nameId)).join(tr("ui.MatterTechTab.017")) || null
  }

  /**
   * 进洞时会自动停掉的活动（**带 `warn` 标记**）——准备页据此把「长途运输」这类**有可见后果**的
   * 单独摆成警告条（船长 2026-09-14：「长途运输发出警告」）。
   */
  wormholeEntryAutoStopList(): Array<{ kind: string; name: string; warn: boolean }> {
    return wormholeEntryAutoStops(this.state).map((a) => ({ kind: a.kind, name: paramText(a.nameId), warn: a.warn }))
  }

  /**
   * **准备页"这张卡能不能编入"用的忙态**（与进洞门槛同一把尺，核心单点 `wormholeShipEntryBusy`）：
   * 泛用徽标 `shipBusyLabel` 会把「扫描虫洞」报成忙，而进洞那一步会自动停扫 ⇒ 主控那一档放行。
   */
  wormholeShipEntryBusy(shipId: string): string | null {
    return wormholeShipEntryBusy(this.state, shipId)
  }

  /** 虫洞扫描：现在能不能开扫（不许时给理由，界面据此置灰） */
  wormholeScanBlockReason(): string | null {
    return wormholeScanBlockReason(this.state)
  }

  /** 虫洞扫描：是否已达解锁声望（船长 2026-09-14：需要协会声望 40） */
  wormholeScanUnlocked(): boolean {
    return wormholeScanUnlocked(this.state)
  }

  /** 虫洞扫描：当前协会声望（解锁进度读数） */
  wormholeScanStanding(): number {
    return wormholeScanStanding(this.state)
  }

  /* ─────────────── 自动探索（批次 3 · 2026-09-14 船长逐条定案） ─────────────── */

  /** 自动探索：在跑的趟（界面进度用） */
  wormholeAutoRuns(): WormholeAutoRun[] {
    return wormholeAutoRunsOf(this.state)
  }

  /** 自动探索：报告队列（新的在前；含待确认与已确认） */
  wormholeAutoReports(): WormholeAutoReport[] {
    return wormholeAutoReportsOf(this.state)
  }

  /** 自动探索：待确认报告条数（页签角标用） */
  wormholeAutoPending(): number {
    return wormholeAutoUnconfirmedCount(this.state)
  }

  /** 自动探索：候选参与舰（自动配置 + 每条的可派性；`exclude` = 本次已手选的） */
  wormholeAutoCandidates(exclude?: readonly string[]): WormholeAutoCandidate[] {
    return wormholeAutoCandidates(this.state, this.ctx, exclude)
  }

  /**
   * 自动探索：现在能不能派（不许时给理由，界面据此置灰）。
   * `mainMayJoin`（2026-09-14 船长「选主控就把主控换到别的船上」）⇒ 校验时**放行主控船**
   * （调用方须已确认交接可行，见 `wormholeAutoMainHandover`）。
   */
  wormholeAutoBlockReason(stockId: string, shipIds?: readonly string[], mainMayJoin = false): string | null {
    return wormholeAutoBlockReason(this.state, this.ctx, stockId, shipIds, { mainMayJoin })
  }

  /**
   * 自动探索：**主控交接**（船长 2026-09-14「如果选择了主控船，就将主控换到其他船上」）——
   * 准备页用它写确认弹窗（「主控将由 X 换到 Y」）与卡片置灰理由；派队命令层照它落。
   */
  wormholeAutoMainHandover(shipIds: readonly string[]): WormholeAutoHandover {
    return wormholeAutoMainHandover(this.state, this.ctx, shipIds)
  }

  /** 自动探索：当前可派的 AI 核心数 / 共用上限（准备页读数用） */
  wormholeAutoCores(): { free: number; cap: number } {
    return { free: wormholeAutoFreeCores(this.state, this.ctx), cap: aiCoreCap(this.state, this.ctx) }
  }

  /** 自动探索：开始一趟（消耗该处库存、按参与舰数占 AI 名额、参与舰锁定到返航） */
  wormholeAutoStart(stockId: string, shipIds: readonly string[]): CommandResult {
    const r = wormholeAutoStart(this.state, this.ctx, stockId, shipIds)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /** 自动探索：召回一趟（无收益无损伤；虫洞不退还） */
  wormholeAutoStop(runId: string): CommandResult {
    const r = wormholeAutoStop(this.state, runId)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /** 自动探索：确认一份报告（船长：报告**需要确认**） */
  wormholeAutoConfirm(reportId: string): CommandResult {
    const r = wormholeAutoConfirmReport(this.state, reportId)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /** 自动探索：全部标为已读 */
  wormholeAutoConfirmAll(): number {
    const n = wormholeAutoConfirmAll(this.state)
    if (n > 0) {
      void this.persist()
      this.notify()
    }
    return n
  }

  /** 虫洞：临时离开（活动停止、进度保存；主控随即释放，可去做别的） */
  wormholeLeave(): void {    wormholeLeave(this.state)
    void this.persist()
    this.notify()
  }

  /** 虫洞：返回（要求主控空闲——忙着就拒绝并把忙态回报给界面） */
  wormholeResume(): CommandResult {
    const r = wormholeResume(this.state, this.ctx)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }
  /** 虫洞：**确认结算单**（清掉 `lastSettle` ⇒ 结算层不再弹；由结算界面的「确认」按钮调用） */
  wormholeAckSettle(): void {
    if (this.state.wormhole.lastSettle === undefined) return
    delete this.state.wormhole.lastSettle
    void this.persist()
    this.notify()
  }

  /** 虫洞：拾取当前节点的一堆（进包前做容量预检，放不下就拒绝） */
  /**
   * 虫洞：**逐堆拾取**（**只服务老档线性层**）。
   *
   * ⚠ F5 收口（船长 2026-09-13 裁定 A）：**网格层没有逐堆拾取** —— 残骸走「打捞」、母矿走「采集」，
   * 装备门槛（打捞器 / 采集器）与回合口径（⌈堆数 ÷ 台数⌉）因此只有一份实现；
   * 网格层调本方法一律被拒（提示改用打捞/采集）。老档线性层（`run.grid` 不存在）照旧可用。
   */
  wormholeTakePile(pileIndex: number): CommandResult {
    const r = wormholeTakePileAt(this.state, this.ctx, pileIndex)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**扫描**（1 回合，揭开当前格周围一圈；顺带**驱散圈内的星云**——船长 2026-09-13 星云机制） */
  wormholeScan(): CommandResult {
    const r = wormholeGridScan(this.state)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return {
      ok: r.ok,
      error: r.error,
      code: r.code,
      dispersed: r.dispersed?.length ?? 0,
      newlyFogged: r.newlyFogged ?? 0,
      // **扫到下一层入口**（船长 2026-09-16 甲案）：界面据此补一句提示（地图上已由 core 标出入口）
      exitScanned: r.exitScanned === true,
    }
  }

  /**
   * 虫洞：**前往**某一格（1 回合；未扫描的格必须先带 `confirmUnknown`，这就是"警告"的落点）。
   * ⚠ 走 `wormholeTravelTo`（不是 core 的 `wormholeGridTravel`）：**到达"舰船信号"那一格就地开打**
   * （船长 2026-09-13「战斗节点到达即开打」）——开战失败整趟移动回滚，玩家留在原格。
   *
   * **路径拦截**（船长 2026-09-16）：直线路径上挡着没清掉的敌人 ⇒ 这次移动**截断在那一格**并就地开战
   * （未扫描格也拦）；界面须先弹确认、再带 `confirmIntercept = true` 重来，否则核心回 `path-blocked`
   * 且**不扣回合**。界面侧画路径/描红走的是同一个 `wormholePathInterceptAt`（同一把尺）。
   *
   * **踩中埋伏**（船长 2026-09-16）：走到一个**出发前没扫描过**的地点、发现里面是敌人 ⇒ 界面传
   * `deferAmbush: true` ⇒ **这一场先挂起**（`run.pendingNodeBattle`），回执带 `pendingBattle: 'node'`，
   * 玩家点「开战」才进战斗（与遗迹守备同一套确认语言）。工具/用例不传 ⇒ 到达即开打（原行为）。
   */
  wormholeTravel(q: number, r: number, confirmUnknown = false, confirmIntercept = false): CommandResult {
    const res = wormholeTravelTo(
      this.state,
      this.ctx,
      { q, r },
      { confirmUnknown, confirmIntercept, deferAmbush: true },
    )
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return {
      ok: res.ok,
      error: res.error,
      code: res.code,
      ...(res.autoBattle ? { autoBattle: true } : {}),
      ...(res.beacon ? { beacon: true } : {}),
      ...(res.intercepted ? { intercepted: res.intercepted } : {}),
      ...(res.ambush ? { ambush: true } : {}),
      ...(res.pendingBattle ? { pendingBattle: res.pendingBattle } : {}),
    }
  }

  /**
   * 虫洞：**激活当前地点**（1 回合；舰船信号/入口会就地开战）。
   * ⚠ 墓场/遗迹的"激活"在 core 侧**分流到打捞**（`wormholeActivateAt` → `wormholeSalvageAt`）——
   * 要打捞器台数与背包容量，还要掷遗迹收尾战 ⇒ 界面**只留这一个入口**（不再单开"打捞"方法，
   * 免得两条路各写一遍回合/回滚规则）。返回值里的 `taken` = 本次回收了几堆。
   */
  wormholeActivate(): CommandResult {
    // 遗迹收尾战**先提示、玩家确认后再开打**（船长 2026-09-13）⇒ 界面这条走 defer
    const r = wormholeActivateAt(this.state, this.ctx, undefined, { deferRuinsBattle: true })
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return {
      ok: r.ok,
      error: r.error,
      ...(r.taken !== undefined ? { taken: r.taken } : {}),
      ...(r.pendingBattle ? { pendingBattle: r.pendingBattle } : {}),
    }
  }

  /** 虫洞：**整理货仓格**（把所有形状件按首次适应递减重排；只重排、不丢件） */
  wormholeHoldCompact(): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdCompact(run.hold, wormholeHoldCapacityOf(this.state, this.ctx))
    if (r.moved > 0 || r.unplaced.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, error: r.unplaced.length > 0 ? tr("ui.engine.040", { p1: r.unplaced.length }) : undefined }
  }

  /** 虫洞：**移动一件形状件**（拖拽落点；非法落点 ⇒ 拒绝、位置不变） */
  wormholeHoldMove(id: string, x: number, y: number): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdMove(run.hold, id, x, y, wormholeHoldCapacityOf(this.state, this.ctx))
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /**
   * 虫洞：**按抓取偏移落件**（界面拖拽的真正入口）。
   *
   * 玩家抓的是件内第 `(dx,dy)` 格（`pointerdown` 时记下）⇒ 落点按"**抓着的那一格跟着光标走**"换算，
   * **越界就夹回网格内**（船长 2026-09-14 报障：件在第一排时抓下面那格往第一排拖会被白报"放不下"）。
   * 详见 core `holdDropWithGrab`。
   */
  wormholeHoldDropAt(id: string, x: number, y: number, grab: { dx: number; dy: number }): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdDropWithGrab(run.hold, id, x, y, wormholeHoldCapacityOf(this.state, this.ctx), grab)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }
  /** 虫洞：**两件互换位置**（船长 2026-09-13：「物品之间无法交换位置」；形状对不上则拒绝并回滚） */
  wormholeHoldSwap(idA: string, idB: string): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdSwap(run.hold, idA, idB, wormholeHoldCapacityOf(this.state, this.ctx))
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }
  /** 虫洞：**抛弃一件形状件**（货仓格 · 手动抛货，船长裁定 8） */
  wormholeDiscardHold(placementId: string, units?: number): CommandResult {
    const r = wormholeHoldDiscard(this.state, this.ctx, placementId, units)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**抛弃散货**（可给数量；不给 = 整条记录丢） */
  wormholeDiscardCargo(itemId: string, units?: number): CommandResult {
    const r = wormholeDiscardCargo(this.state, this.ctx, itemId, units)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**一键抛到容量内**（玩家点按钮才跑；只动散货、按每格价值从低到高） */
  wormholeDiscardToFit(): CommandResult {
    const r = wormholeDiscardToFit(this.state, this.ctx)
    if (r.dropped.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: r.dropped.length > 0, error: r.dropped.length > 0 ? undefined : tr("ui.engine.041") }
  }

  /** 虫洞：**货仓读数**（已用格 / 总格 / 超载；界面与按钮置灰共用） */
  wormholeHoldInfo(): {
    used: number
    capacity: number
    cargoCells: number
    shapeCells: number
    unplacedCells: number
    overload: boolean
  } {
    return wormholeHoldUsage(this.state, this.ctx)
  }

  /**
   * 虫洞：**当前能不能继续探索**（不许时的理由；可以时 null）。
   *
   * 两条闸（船长 2026-09-14 追加第二条）：
   * ① **临时空间里有东西** ⇒ 必须先去背包页「放回货仓」或「丢弃」（「临时空间内有物品就不允许进行
   *    其他操作，和之前的超载类似」）；
   * ② 货仓超载 ⇒ 必须先抛货（船长裁定 8）。
   * 界面据此把扫描/前往/打捞/采集/开战/撤离/深入一起置灰，并把这句理由摆出来。
   */
  wormholeActionBlocked(): string | null {
    return wormholeActionBlockReason(this.state, this.ctx)
  }

  /**
   * 虫洞：**"欠着一场战斗"这一条单独给**（**2026-09-20 玩家报障**：「惊动敌人后有时候需要继续打捞，
   * 把残骸清空才能对敌」）。
   *
   * 为什么不并进 `wormholeActionBlocked()`：那条闸同时管着**撤离**，而船长 2026-09-16 定过
   * 「确认期间层内动作全被拦，**但撤离照走**（逃生门）」⇒ 并把这条（撤离按钮会一起置灰）。
   * 面板的用法：**扫描/打捞/激活/深入**读"动作闸 ?? 本条"，**撤离**只读动作闸。
   */
  wormholeLayerBlocked(): string | null {
    return wormholePendingBattleReason(this.state)
  }

  /**
   * 虫洞：**临时空间读数**（船长 2026-09-14：4 列 × 8 行 = 32 格的格子区，挂在货仓 8 列右侧）。
   * 不占货仓容量、不算超载；**离开背包页前必须清空**。
   */
  wormholeTempInfo(): { cells: number; capacity: number; placements: WormholeHoldPlacement[]; full: boolean } {
    return wormholeTempUsage(this.state, this.ctx)
  }

  /** 虫洞：临时空间里还有多少件要处理（离页/撤离前必须清零） */
  wormholeTempPending(): { count: number; cells: number; placements: WormholeHoldPlacement[] } {
    return wormholeTempPending(this.state, this.ctx)
  }

  /** 虫洞：**把临时空间里的一件放进货仓**（腾得出位置才成功；失败原样留在临时空间） */
  wormholeTempStow(id: string): CommandResult {
    const r = wormholeTempStowPiece(this.state, this.ctx, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**丢弃临时空间里的一件**（手动；与货仓抛货同一把尺） */
  wormholeTempDiscard(id: string): CommandResult {
    const r = wormholeTempDiscardPiece(this.state, this.ctx, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**临时空间全部放回货仓**（逐件尝试 ⇒ 报告放不下的那几件） */
  wormholeTempStowAll(): { ok: boolean; moved: number; stuck: string[] } {
    const r = wormholeTempStowAll(this.state, this.ctx)
    if (r.moved > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: r.stuck.length === 0, moved: r.moved, stuck: r.stuck }
  }

  /** 虫洞：**临时空间全部丢弃**（离页确认条的「丢掉这些」） */
  wormholeTempDiscardAll(): { ok: boolean; moved: number } {
    const r = wormholeTempDiscardAll(this.state, this.ctx)
    if (r.moved > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, moved: r.moved }
  }

  /**
   * 虫洞：**一件在两块格板之间搬**（货仓 ↔ 临时空间；界面跨板拖拽的唯一入口）。
   * `to` 给不出落点（`x/y` 省略）⇒ 目标板找第一个放得下的空位。
   */
  wormholeBoardTransfer(
    from: 'hold' | 'temp',
    to: 'hold' | 'temp',
    id: string,
    x?: number,
    y?: number,
    grab?: { dx: number; dy: number },
  ): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: tr("ui.engine.042") }
    run.hold = run.hold ?? makeHoldState()
    const holdCap = wormholeHoldCapacityOf(this.state, this.ctx)
    const src = from === 'hold' ? run.hold : wormholeTempBoard(run)
    const dst = to === 'hold' ? run.hold : wormholeTempBoard(run)
    if (src === dst) return { ok: false, error: tr("ui.engine.043") }
    const r = holdTransferTo(src, dst, id, to === 'hold' ? holdCap : WORMHOLE_TEMP_CELLS, x, y, grab)
    if (r.ok) {
      // 谜质装置挪动 ⇒ 增益实时派生（进货仓生效 / 出仓失效并**夹紧回合**）
      wormholeSyncMatterTurns(this.state, this.ctx)
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**整理临时空间**（与货仓的「整理」同一把尺：按件大小重排，只重排不丢件） */
  wormholeTempCompact(): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.tempGrid) return { ok: false, error: tr("ui.engine.044") }
    const r = holdCompact(run.tempGrid, WORMHOLE_TEMP_CELLS)
    if (r.moved > 0 || r.unplaced.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, error: r.unplaced.length > 0 ? tr("ui.engine.045", { p1: r.unplaced.length }) : undefined }
  }
  /** 虫洞：深入下一层（只在层末可用） */
  wormholeDescend(): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: tr("ui.engine.042") }
    const blocked = wormholeActionBlockReason(this.state, this.ctx)
    if (blocked) return { ok: false, error: blocked }
    /**
     * ⚠ **新层也要带上扫码加成**（2026-09-13 二号接线单）：`wormholeDescend` 的第三个入参是
     * "新盘的扫描半径加成"，不传就默认 0 ⇒ 侦察舰/电子舰的「扫码范围 +1 圈」**只在第 1 层生效**。
     * 口径与入洞同源（`wormholeScanBonusOf` 对编队求和），故这里现算一次传进去。
     * ⚠ **第一入参是 `state`**（2026-09-13 星云批改的）：星云机制的"第一次下到层 4"提示要写进 `state`。
     * ⚠ 2026-09-19（船长「取消固定种子」·裁定「甲」）：**第二入参改成现掷**（原 `state.rng.seed` 随档
     * ⇒ 读档深入能预览同一张下层图）。现掷 ⇒ 每一层的盘面只在**真正下去的那一刻**才生成。
     */
    const r = wormholeDescend(this.state, this.freshLayerSeed(), wormholeScanBonusOf(this.ctx, run.fleet))
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：发起撤离（进入 `extracting` 相位；**下一拍直接结算入港** —— 2026-09-15 起撤离不触发战斗） */
  wormholeExtract(): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: tr("ui.engine.042") }
    // **超载不许撤离**（船长裁定 8）：先把货抛到容量内（抛货本身任何时候都能做 ⇒ 不会软锁）
    const blocked = wormholeActionBlockReason(this.state, this.ctx)
    if (blocked) return { ok: false, error: blocked }
    /**
     * **临时空间没清空也不许撤离**（船长 2026-09-14：「撤离前必须清空（丢掉或放回）」）：
     * 界面在离开背包页时就强制二选一，这里是引擎侧的第二道闸（坏档 / 界面漏判都拦得住）。
     * ⚠ 仍然**不软锁**：丢弃与放回都在背包页做得到，且丢弃永远可用。
     */
    const pending = wormholeTempPending(this.state, this.ctx)
    if (pending.count > 0) {
      return {
        ok: false,
        error: tr("ui.engine.046", { p1: pending.count }),
      }
    }
    const r = wormholeExtract(run)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /**
   * 虫洞：**迎战**（`node` = 当前节点 / `boss` = 层末守卫 / `ruins` = 遗迹收尾战）。
   * ⚠ `'extract'`（撤离战）已于 2026-09-15 退役 ⇒ 类型里不再接受它（新趟不会再有撤离战；
   * 老档里**已经在打**的那一场由 `settleWormholeBattle` 收口，不需要重新开战）。
   */
  wormholeFight(kind: 'node' | 'boss' | 'ruins'): CommandResult {
    const r = wormholeStartBattle(this.state, this.ctx, kind)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /** 虫洞：⚠ 施工期调试用——放弃本趟（正式结算路径在 F 批） */
  wormholeDebugReset(): void {
    wormholeDebugReset(this.state)
    void this.persist()
    this.notify()
  }

  /* ─────────────── 调试模式（V15 开发工具；对正常玩家不可见） ─────────────── */

  /** 调试：切换"1 秒化"（存档标记 debugQuick；进行中作业按 1 秒完成） */
  setDebugQuick(on: boolean): void {
    this.state.debugQuick = on
    void this.persist()
    this.notify()
  }

  /**
   * 调试：离线快进 awayMs（毫秒，8 小时上限）。
   * 复用离线结算管线推进游戏时间，并把墙钟基准同步前移（避免下次真实离线重复结算）；生成离线简报。
   */
  debugFastForward(awayMs: number): void {
    const ms = Math.floor(awayMs)
    if (!Number.isFinite(ms) || ms <= 0) return
    const wallBase = this.state.savedAtWallMs > 0 ? this.state.savedAtWallMs : Date.now()
    const before = snapshotBasics(this.state)
    const { overflowMs } = offlineSplit(ms, offlineCapMsOf(this.state))
    // 调试快进：冻结进行中的战斗（低安遭遇战 + 主控远征），不随快进时间跳变而瞬结（船长 2026-09-05）
    const stats = newSettleStats()
    simulateOffline(this.state, wallBase, wallBase + ms, this.ctx, undefined, { freezeBattle: true, stats })
    this.state.savedAtWallMs = wallBase + ms
    /**
     * **把入侵一并推到快进后的时刻**（2026-09-25 修船长报障「打开调试模式，快进后不会刷新入侵」）：
     * `simulateOffline` 只推游戏时间，而入侵那条时间线原先**完全没接进来** ⇒ 快进 8 小时也不开新场、铺底不动。
     *
     * 口径：**按 1 小时一步补跑入侵拍**（1h 正是调试模式的"上一场结束 + 1h 刷新"粒度）——
     * 中途该结束的结束、该刷新的刷新，快进结束时手上就是**当下该有的那一场**；
     * 若只在末尾补一拍，跨过结束点的那次快进会留下"没有活着的入侵"（要再等 1h）。
     * `lastSeenWallMs` 传上一步 ⇒ 离线保护与 Q3 的锚点照常成立。
     */
    const stepMs = 3_600_000
    const endAt = wallBase + ms
    for (let at = Math.min(wallBase + stepMs, endAt); ; at = Math.min(at + stepMs, endAt)) {
      this.pumpWeekendAt(at, at - stepMs)
      if (at >= endAt) break
    }
    this.offlineReport = buildOfflineReport(before, this.state, this.ctx, ms, overflowMs, stats)
    void this.persist()
    this.notify()
  }

  /** 战斗中调整期望距离（距离条拖动/战术按钮；写入并记忆偏好） */
  battleSetDesireAt(desireM: number): CommandResult {
    const result = setBattleDesire(this.state, desireM, this.ctx)
    if (result.ok) {
      /**
       * **只重绘、不写盘**（2026-09-13 性能修）：拖距离条时每 160ms 提交一次，若每次都整档
       * `persist()`（大档 JSON + localStorage 写）会把主线程顶出顿挫——船长："依旧还是有顿挫感"。
       * 偏好不是易失数据：**15 秒自动存盘**与其它任何动作都会把它落盘（`ensurePump` 里的定时器）。
       */
      this.notify()
    }
    return result
  }

  /** 切换到船坞里的另一艘船 */
  changeShipAt(shipId: string): CommandResult {
    const result = changeShip(this.state, shipId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-09 长途运输：开始（任选一条两端点航线；不要求当前停靠在端点——引擎先飞就位段） */
  startHaulingAt(aSiteId: string | null, bSiteId: string | null): CommandResult {
    const result = startHauling(this.state, aSiteId, bSiteId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-09 长途运输：停止（立即响应：中止当前航段并自动返航出发站，无惩罚） */
  stopHaulingNow(): CommandResult {
    const result = stopHauling(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T5：锁定/解锁舰船（防误售，跨会话持久化） */
  lockShipAt(shipId: string, locked: boolean): CommandResult {
    const result = lockShip(this.state, shipId, locked, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-10 玩家标记（收藏）：切换一条标记（市场商品 / 精炼资源 / 蓝图 / 舰船）。 */
  toggleMarkAt(kind: MarkKind, id: string): CommandResult {
    const result = toggleMark(this.state, this.ctx, kind, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T5-B：舰船自由改名（v17；name = null 恢复默认名） */
  renameShipAt(shipId: string, name: string | null): CommandResult {
    const result = renameShip(this.state, shipId, name)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T8：从野外停留点即时返航空间站（去程取消：下达即到站） */
  flyHomeNow(): CommandResult {
    const result = startTransitHome(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }



  /** B1.5：前往指定星系掩护巡逻（原"待命"；即时就位，无去程等待） */
  goStandbyAt(galaxyId: string): CommandResult {
    return this.withActivitySwitch('standby', () => {
      const result = goStandbyAt(this.state, galaxyId, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** B1.5：取消主控掩护巡逻去程（旧档在途；召回回母港） */
  recallStandbyNow(): CommandResult {
    const result = cancelStandby(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** B1.5：指派副船前往星系掩护巡逻（占名额，可取消召回） */
  assignAiStandbyAt(shipId: string, coreType: string, galaxyId: string): CommandResult {
    const result = assignAiStandby(this.state, shipId, coreType as never, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
  /** B1 低安遭遇：迎战（进入实时战斗，自动打完） */
  fightEncounterNow(): CommandResult {
    const result = fightEncounter(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** B1 低安遭遇：快速脱离（立即按文字三档结算） */
  fleeEncounterNow(): CommandResult {
    const result = fleeEncounter(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
  /**
   * 战斗中撤退：轻损脱离并即刻回港（同时停止重复清剿）。
   *
   * ⚠ **2026-09-25 分流**：旗舰战（编队战 · 承载在遭遇槽）不占 `expedition` 槽 ⇒
   * `retreatBattle` 会以"当前不在交火中"拒绝；那一场走遭遇系统的主动脱离
   * （`retreatEncounterBattle`：同样退弹药/修理组件、逐舰落盘承伤，且**照记对母舰的伤害**）。
   */
  retreatNow(): CommandResult {
    const result = weekendFlagshipBattleActive(this.state)
      ? retreatEncounterBattle(this.state, this.ctx)
      : retreatBattle(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T8：悬赏重复清剿开关（落档）；null = 停止 */
  bountyLoopAt(anomalyId: string | null): CommandResult {
    const result = setAutoLoopBounty(this.state, this.ctx, anomalyId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **入侵「重复出击」开关**（2026-09-25 船长令：「入侵活动的悬赏，允许玩家开启自动重复，照常计算返回时间」）：
   * `galaxyId = null` ⇒ 停；否则 = 被占星系 id。与 `bountyLoopAt` **互斥**（开一边顶掉另一边）。
   */
  invasionLoopAt(galaxyId: string | null): CommandResult {
    const result = setAutoLoopInvasion(this.state, this.ctx, galaxyId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T9：在副站提交建材（从物品仓库 + 驾驶船货仓扣取） */
  deliverSiteAt(siteId: string, itemId: string, units: number): CommandResult {
    const result = deliverStationResources(this.state, this.ctx, siteId, itemId, units)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-08：一键「前往工地交付」——从当前停靠空间站按真实航程出发，到点自动交付并自动返航 */
  deliverTripAt(siteId: string): CommandResult {
    const result = startSiteDeliverTrip(this.state, this.ctx, siteId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 2026-09-08：取消进行中的建站交付航线（无惩罚；立即返航停靠最近已建成站） */
  cancelDeliverTripNow(): CommandResult {
    const result = cancelSiteDeliverTrip(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T9：播放/重看通讯剧本（逐句镜像进事件日志 + 标记已读 + 清待播） */
  openDialogue(scriptId: string): CommandResult {
    const script = DIALOGUES.find((d) => d.id === scriptId)
    if (!script) return { ok: false, error: tr("ui.engine.047", { scriptId: scriptId }) }
    playDialogue(this.state, scriptId, this.ctx, script.lines)
    void this.persist()
    this.notify()
    return { ok: true }
  }

  /* ─────────────── 2026-09-11 通讯（收件箱：NPC 消息 + 剧本镜像） ─────────────── */

  /** 收件箱视图（全部已送达消息，按送达时间倒序；含未读标记与跳转提示） */
  commsInboxView(): ReturnType<typeof commsInbox> {
    return commsInbox(this.state, this.ctx)
  }

  /* ─────────────── 2026-09-14 需要弹窗的通讯（船长：「解锁时发送通讯给玩家（同时也要直接弹窗）」） ─────────────── */

  /** 需要弹窗的通讯 id 队列（队首那封才弹） */
  commsPopups(): string[] {
    return commsPopupQueue(this.state)
  }

  /** 关掉一封弹窗（幂等；关掉不丢信——收件箱里还有） */
  dismissCommsPopup(id: string): void {
    if (!dismissCommsPopup(this.state, id)) return
    void this.persist()
    this.notify()
  }

  /** 未读条数（导航图标闪烁与数字徽标） */
  commsUnread(): number {
    return commsUnreadCount(this.state, this.ctx)
  }

  /** 点开一封通讯 → 标记已读（幂等；没有该消息时返回失败） */
  markCommsReadAt(id: string): CommandResult {
    const r = markCommsRead(this.state, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /** 全部标记已读（收件箱头部按钮；返回本次标记条数，0 = 本来就没有未读） */
  markAllCommsReadNow(): number {
    const n = markAllCommsRead(this.state, this.ctx)
    if (n > 0) {
      void this.persist()
      this.notify()
    }
    return n
  }

  /* ─────────────── v24 任务中心·时效任务（资源 / 快递，定时刷新限时有效） ─────────────── */

  /** 任务板只读视图：资源/快递（20 分钟整点）+ 赏金（每天本地 0 点）两套倒计时一并返回 */
  sideTasksView(): ReturnType<typeof sideTaskBoard> {
    return sideTaskBoard(this.state, this.ctx, Date.now())
  }

  /**
   * **任务中心徽标**（船长 2026-09-14：「当任务中心有新的赏金任务时，提示玩家，玩家进入后消除提示」）：
   * 未看过这一板赏金任务 ⇒ 返回该板条数（徽标数字）；看过 / 未开板 ⇒ 0。
   * 判定与记账的单点都在 core（`sideTaskBoard().bountyNewCount` / `sideTasksMarkBountySeen`）。
   */
  bountyNewCount(): number {
    return sideTaskBoard(this.state, this.ctx, Date.now()).bountyNewCount
  }

  /** 记一笔"玩家已看过这一板赏金任务"（进「任务中心」页时调用；幂等）⇒ 徽标灭 */
  markBountyBoardSeen(): void {
    sideTasksMarkBountySeen(this.state)
  }

  /**
   * **「第一次」推进提醒**（**2026-09-20 船长令**：「每推进一阶段第一次任务时，在导航栏的任务中心选项处
   * 进行提醒」）：当前那一条 ≠ 玩家看过的这一条 ⇒ 返回 `{ taskId, title }`（徽标 +1、悬停写标题）；
   * 看过 / 13 条全做完 ⇒ null。判定单点在 core（`firstTaskNotice`）。
   */
  firstTaskNotice(): { taskId: string; title: string; ready: boolean } | null {
    return firstTaskNotice(this.state)
  }

  /** 记一笔"这一条「第一次」看过了"（进「任务中心」页时调用；幂等）⇒ 推进提醒灭 */
  markFirstTaskSeen(): void {
    firstTasksMarkSeen(this.state)
  }

  /** 快递任务当前是否解锁（已建成任一副空间站——stage ≥ 档位数） */
  courierTasksUnlocked(): boolean {
    return courierTaskUnlocked(this.state, this.ctx)
  }

  /**
   * **领取次数链奖金**（任务中心「第一次」卡片上的领奖；2026-09-17 教程重做批）。
   * 记账在引擎每拍的 `advanceFirstChains`（已达成第几档），**发钱只在这一处点击时**（返回本次发出额）。
   */
  claimChainRewardAt(chainId: string): number {
    const isk = claimChainRewardCore(this.state, chainId)
    if (isk > 0) {
      void this.persist()
      this.notify()
    }
    return isk
  }

  /** 完成一条资源时效任务（物品仓库足量 → 扣货 → 现金入账 → 该条下板，其余不受影响） */
  completeSideTaskAt(kind: SideTask['kind'], id: number): CommandResult {
    const result = completeSideTask(this.state, this.ctx, kind, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 快递任务「出发投送」（虚拟货物：只占货舱体积 → 挂入在途 → 到站引擎自动结算运费） */
  startCourierDeliveryAt(id: number): CommandResult {
    return this.withActivitySwitch('deliver', () => {
      const result = startCourierDelivery(this.state, this.ctx, id)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  /** 当前驾驶船的货舱容量（m³；快递卡判断"装不装得下"用） */
  cargoCapacityM3(): number {
    return cargoCapacityM3(this.state, this.ctx)
  }

  /** 当前驾驶船的有效跃迁速度（AU/s，含跃迁计算机加成；限时快递门槛判定用） */
  warpSpeedOfCurrent(): number {
    return warpSpeedAus(this.state, this.ctx, this.state.shipId)
  }

  /** 快递「接单」（船长 2026-09-18：接取后不再随整板刷新消失） */
  acceptCourierAt(id: number): CommandResult {    const result = acceptCourierTask(this.state, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 快递「放弃已接单」（腾出接单名额） */
  abandonAcceptedCourierAt(id: number): CommandResult {
    const result = abandonAcceptedCourierTask(this.state, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 是否正在快递投送（在途；其余出航作业在此期间被拒绝） */
  isCourierDelivering(): boolean {
    return courierDelivering(this.state)
  }

  /**
   * 2026-09-10 修复（船长定位：重复清剿中"退出战场"会打断连击）：
   * 「← 最小化」（原按钮文字「← 退出战场」，2026-09-26 船长令改）= 仅关闭全屏观看界面——
   * 战斗后台照常推进、连击照常继续。
   * 原实现在"连击自动发起的战斗"中退出即清 autoLoopAnomalyId（视为收手），
   * 导致玩家只是最小化观看就被停环；如需中止请用战场内「⚑ 撤退」（撤退才停环）。
   * autoSortie 仅保留"连击自动发起的战斗默认最小化界面"用途，不再参与停环。
   */

  /* ─────────────── v7 操作（自动循环 / 装卸 / 维修 / AI 核心） ─────────────── */

  /** 切换自动循环开关 */
  setAutoCycleAt(autoCycle: boolean): void {
    setMiningAutoCycle(this.state, autoCycle)
    void this.persist()
    this.notify()
  }

  /** 勾选/取消"本次返航后停止" */
  setStopAfterTripAt(stop: boolean): void {
    setMiningStopAfterTrip(this.state, stop)
    void this.persist()
    this.notify()
  }

  /** 打捞自动循环开关（2026-09-09：与采矿同款） */
  setSalvageAutoCycleAt(autoCycle: boolean): void {
    setSalvageAutoCycle(this.state, autoCycle)
    void this.persist()
    this.notify()
  }

  /** 打捞"本次返航卸货后停止" */
  setSalvageStopAfterTripAt(stop: boolean): void {
    setSalvageStopAfterTrip(this.state, stop)
    void this.persist()
    this.notify()
  }

  /** 把当前船货仓全部卸入物品仓库；返回卸入数量 */
  unloadAllToWarehouse(): number {
    const moved = unloadCargoToWarehouse(this.state)
    if (moved > 0) {
      void this.persist()
      this.notify()
    }
    return moved
  }

  /** 2026-09-08（船长定）：把指定（非驾驶、空闲停靠）舰船货仓全部卸入物品仓库；返回卸入数量 */
  unloadShipAllToWarehouse(shipId: string): number {
    if (!this.state.fleet[shipId]) return -1 // 船不存在
    if (shipId in this.state.aiAssignments) return -2 // AI 作业中
    if (shipId in this.state.shipReturns) return -3 // 善后返航中
    const moved = unloadCargoOfShipToWarehouse(this.state, shipId)
    if (moved > 0) {
      void this.persist()
      this.notify()
    }
    return moved
  }

  /** 2026-09-09（船长口径 A）：卸下货仓里指定条目（物品 → 物品仓库；模块 → 装备库分流）；返回卸入数量 */
  unloadCargoItem(itemId: string): number {
    const moved = unloadCargoToWarehouse(this.state, itemId)
    if (moved > 0) {
      void this.persist()
      this.notify()
    }
    return moved
  }

  /** 把仓库里的某种物品尽量装到当前船（受容量限制）；返回装入数量 */
  loadWareToCargoFit(itemId: string): number {
    const loaded = loadWarehouseToCargoFit(this.state, itemId, this.ctx)
    if (loaded > 0) {
      void this.persist()
      this.notify()
    }
    return loaded
  }

  /** 卖当前船货仓里的物品 */
  sellCargo(itemId: string, qty?: number): SellResult {
    const result =
      qty === undefined ? sellCargoItem(this.state, itemId, this.ctx) : sellCargoItemQty(this.state, itemId, qty, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 卖物品仓库里的物品 */
  sellWare(itemId: string, qty?: number): SellResult {
    const result =
      qty === undefined ? sellWareItem(this.state, itemId, this.ctx) : sellWareItemQty(this.state, itemId, qty, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **丢弃仓库物品（任意数量）**（船长 2026-09-15：「仓库添加丢弃按钮，允许玩家丢弃任意数量已有物品」）。
   * 纯销毁：不给钱、不进回收链；数量由 core 夹在 [1, 持有量]（超出按持有量丢）。
   */
  discardWare(itemId: string, qty: number): { ok: boolean; dropped: number; error?: string } {
    const result = discardWareQty(this.state, itemId, qty, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 维修指定船（满血） */
  repairShipAt(shipId: string): CommandResult {
    const result = repairShip(this.state, shipId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 手动使用一枚修理组件（驾驶船货仓；恢复结构+装甲各自上限百分比） */
  useRepairKitNow(): CommandResult {
    const result = useOneRepairKit(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /* ─────────────── AI 核心 / 副船任务（v8） ─────────────── */

  /** 购买基础 AI 核心 */
  buyBasicCoreAt(): CommandResult {
    const result = buyBasicAiCore(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 指派 AI 采矿任务 */
  assignAiMiningAt(shipId: string, coreType: AiCoreType, beltId: string): CommandResult {
    const result = assignAiMining(this.state, shipId, coreType, beltId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 指派 AI 远征任务（软下线 2026-09-05 船长定：引擎一律拒绝；UI 入口已于 2026-09-08 隐藏——
   * 本方法保留供恢复；恢复 = 加回 ShipPage 指派选项即可） */
  assignAiExpeditionAt(shipId: string, coreType: AiCoreType, anomalyId: string): CommandResult {
    const result = assignAiExpedition(this.state, shipId, coreType, anomalyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** B3：指派 AI 打捞任务（自动循环：出航→打捞→满仓返港卸货→同星系再出航，取消才结束） */
  assignAiSalvageAt(shipId: string, coreType: AiCoreType, galaxyId: string): CommandResult {
    const result = assignAiSalvage(this.state, shipId, coreType, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 取消 AI 任务（核心归还） */
  cancelAiTaskAt(shipId: string): boolean {
    const ok = cancelAiTask(this.state, shipId, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /**
   * 重置档案（开新档）。
   *
   * **S4b**：新档可选铁人（2026-09-23 船长：「新档可选」）——`ironman = true` 时开局即入铁人模式；
   * 代次起点取 `max(0, 账本高度)`，因此**重置档案不清账本**、新铁人档接着账本往前走。
   * ⚠ 关闭铁人后不能再开：`on` 已为真时 `enterIronman` 是空操作（新档是全新状态，不受此限）。
   */
  async resetGame(ironman = false): Promise<void> {
    this.state = createInitialState({ prologue: true })
    if (ironman) {
      let ledgerSeq = 0
      try {
        const ledger = await saveBridge.ironmanLedger()
        if (ledger.ok) ledgerSeq = ledger.seq
      } catch {
        ledgerSeq = 0
      }
      enterIronman(this.state, Date.now(), ledgerSeq)
    }
    this.offlineReport = null
    void this.persist()
    this.notify()
  }

  /** 序章·苏醒：自检/起名完成 → 写入呼号并结束序章（教程七步已退场，改由任务中心「第一次」承载） */
  prologueAwaken(name: string): CommandResult {
    const n = (name ?? '').trim()
    this.state.character.name = n.length > 0 ? n.slice(0, 12) : 'PRTS'
    const result = beginAfterAwaken(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 序章·苏醒：跳过（含演出阶段）——全额结算奖励 + 鲣鱼修满，教程结束 */
  prologueSkip(): CommandResult {
    const result = skipPrologue(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
}
