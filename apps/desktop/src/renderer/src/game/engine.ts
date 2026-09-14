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
  sellCargoItem,
  sellCargoItemQty,
  sellStoredShipAtMarket,
  sellWareItem,
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
  runCommsAction,
  completeSideTask,
  sideTaskBoard,
  courierTaskUnlocked,
  courierDelivering,
  startCourierDelivery,
  stopMining,
  stopSalvageOp,
  stopScan,
  setAutoLoopBounty,
  unfitSlot,
  unfitAt,
  // 2026-09-11 协处理器：CPU 预算总额（含扩容）/ 超载预演 / 原子换装
  cpuBudgetOf,
  cpuOverloadText,
  swapModuleAt,
  unloadCargoToWarehouse,
  unloadCargoOfShipToWarehouse,
  beginTutorialAfterAwaken,
  skipTutorial,
  finishTutorial,
  deliverTutorialOre,
  onTutorialSkillPageOpened,
  tutorialAccelWait,
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
  HAUL_RATE_PER_M3_MIN,
  // 2026-09-10 玩家标记（收藏）
  toggleMark,
  // 终局玩法「虫洞」（E 批：入洞 / 拾取 / 推进 / 深入 / 撤离；施工期入口在调试开关后面）
  wormholeEnter,
  wormholeTakePileAt,
  wormholeHoldUsage,
  wormholeDiscardToFit,
  wormholeHoldDiscard,
  wormholeDiscardCargo,
  wormholeActionBlockReason,
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
  wormholeStockDiscard,
  wormholeStockMeta,
  WORMHOLE_FAMILY_CARD,
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
} from '@whale/core'
import type {
  AiCoreType,
  BountyWinMC,
  CommandResult,
  CommsActionCommand,
  DamageType,
  GameState,
  LairTier,
  MarkKind,
  ModuleSlot,
  RackSlot,
  RefineRunView,
  SellResult,
  SettleStats,
  SideTask,
  SimContext,
  WormholeArchetype,
  WormholeFamily,
  WormholeAutoCandidate,
  WormholeAutoHandover,
  WormholeAutoReport,
  WormholeAutoRun,
  WormholeHoldPlacement,
} from '@whale/core'
import { BELTS, BLUEPRINTS, GALAXIES, GALAXY_EDGES, ANOMALIES_FLAVORED, ITEMS, MODULES, SHIP_BLUEPRINTS, SHIPS, SKILL_GROUPS, SKILLS, DIALOGUES, buildSimContext } from '@whale/data'
import { saveBridge } from './storage'
import { perfHub } from './perf'
import type { PerfBucket } from './perf'

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
      if (s.miningTrips > 0) acts.push(`采矿 ×${s.miningTrips} 趟`)
      if (s.salvageDone > 0) acts.push(`打捞 ×${s.salvageDone} 次`)
      if (s.refineBatches > 0) acts.push(`精炼 ×${s.refineBatches} 批`)
      if (s.recycleBatches > 0) acts.push(`回收 ×${s.recycleBatches} 批`)
      if (s.makeDone > 0) acts.push(`制造完成 ×${s.makeDone}`)
      if (acts.length === 0) continue
      coreJobs.push(
        `${aiCoreName(t)}核心：${acts.join(' · ')}${s.income > 0 ? ` · 预估收入 ≈+${s.income.toLocaleString('zh-CN')} 信用点` : ''}`,
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
    skillsUp,
    learnedIn,
    logCount: newLogs.length,
    highlights,
    coreJobs,
  }
}

/** 离线结算报告 → 事件日志单条汇总（2026-09-08 船长定：日志会话级不落盘，
 * 但离线报告本体要进入本局事件日志，供关闭简报后查证） */
function offlineReportLogText(r: OfflineReport): string {
  const parts: string[] = [`离开 ${formatDurationMs(r.wallAwayMs)}，结算 ${formatDurationMs(r.settledMs)}`]
  if (r.overflowMs > 0) parts.push(`另有 ${formatDurationMs(r.overflowMs)} 超出上限未结算`)
  parts.push(`钱包 ${r.iskDelta >= 0 ? '+' : '−'}${Math.abs(r.iskDelta).toLocaleString('zh-CN')} 信用点`)
  if (r.items.length > 0) parts.push(`收获 ${r.items.map((i) => `${i.name}×${i.delta.toLocaleString('zh-CN')}`).join('、')}`)
  if (r.modules.length > 0) parts.push(`装备入库 ${r.modules.map((m) => `${m.name}×${m.delta}`).join('、')}`)
  if (r.shipsIn.length > 0) parts.push(`新船入坞 ${r.shipsIn.join('、')}`)
  if (r.skillsUp.length > 0) parts.push(`技能 ${r.skillsUp.join('、')}`)
  if (r.learnedIn.length > 0) parts.push(`学会配方 ${r.learnedIn.join('、')}`)
  if (r.coreJobs.length > 0) parts.push(`AI 核心作业 ${r.coreJobs.join('；')}`)
  return `离线结算报告：${parts.join('；')}。`
}

export class GameEngine {
  /** 引擎规则计算需要的静态内容（技能/舰船/矿带/物品 + 平衡数值） */
  readonly ctx: SimContext = buildSimContext()
  /** 界面目录数据（**施工期闸门**：标了 `unreleased` 的内容不进这些"给玩家看的"枚举
   *  —— 与下面 `anomalies` 的 `hidden` 过滤同款，2026-09-13 船长铁律） */
  readonly skills = SKILLS
  readonly groups = SKILL_GROUPS
  readonly ships = SHIPS.filter((d) => itemReleased(d))
  readonly belts = BELTS
  readonly items = ITEMS
  readonly modules = MODULES.filter((d) => itemReleased(d))
  readonly blueprints = BLUEPRINTS.filter((d) => itemReleased(d))
  readonly shipBlueprints = SHIP_BLUEPRINTS.filter((d) => itemReleased(d))
  readonly galaxies = GALAXIES
  readonly galaxyEdges = GALAXY_EDGES
  readonly anomalies = ANOMALIES_FLAVORED.filter((a) => !a.hidden) // B1：遭遇战模板（hidden）不进悬赏目录；含 B3.1 回收特色
  /** 全部异常目录（含 hidden 遭遇模板——星图/任务中心过滤展示用） */
  readonly allAnomalies = ANOMALIES_FLAVORED
  /**
   * **全目录**（含未上线）——只给"玩家已持有 / 已在跑"的解析路径用：装备库按持有数筛、
   * 组装机按 `run.blueprintId` 反查蓝图等。**别的用途一律用上面的可见目录**
   * （口径与 `allAnomalies` 同款；未上线内容在施工期不可能被玩家持有，故这些路径不会漏）。
   */
  readonly allShips = SHIPS
  readonly allModules = MODULES
  readonly allBlueprints = BLUEPRINTS
  readonly allShipBlueprints = SHIP_BLUEPRINTS
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
  /** 非战斗期推进余额（累计满 1s 才推进一次，保持旧节奏；战斗中改 100ms 切片实时推进） */
  private pendingMs = 0
  /** 心跳周期毫秒（2026-09-08 降频优化：挂机 500ms；战斗/教学加速/远征去程边界保持 100ms） */
  private pumpMs = 100
  /** 优化：本场远征是否由"重复清剿"自动发起（期间战斗界面默认最小化，不自动弹全屏战场） */
  private autoSortie = false

  /* ═══ 悬赏胜率蒙特卡洛缓存（2026-09-09 船长确认 N=21：战力指纹变化 → 分帧全板预热） ═══ */
  private winCache = new Map<string, BountyWinMC>() // anomalyId → 当前指纹下的预估结果
  private winFpCur = ''
  private winEval: { ev: GameState; uid: string } | null = null // 战力评估快照（fp 变化时重建）
  private winQueue: string[] = []
  private winLastPumpAt = 0

  /** 战力指纹：驾驶船 + 装配 + 无人机清单 + 技能 + 当前耐久（任一变化 → 全板胜率失效重算） */
  private winFingerprint(): string {
    const st = this.state
    const uid = st.shipId
    const f = st.fleet[uid]
    const tr = st.skills.trained
    let sk = ''
    for (const k of Object.keys(tr).sort()) sk += `${k}:${tr[k]};`
    return `${uid}|${f?.defId}|${f?.armorPct ?? 1}|${f?.durability ?? 1}|${JSON.stringify(f?.fitted ?? {})}|${JSON.stringify(f?.droneLoad ?? null)}|${sk}`
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
    // 洞内交火同样跳过（2026-09-13）：实时推进优先，别让胜率预热抢帧
    if (this.state.expedition.phase === 'battle' && !!this.state.expedition.battle) return
    if (this.state.wormhole.run?.battle) return
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
   * - 教学加速等待段：时间泵 ×6，保持原颗粒度；
   * - 远征去程（phase 'out'）：到港边界切割守卫依赖心跳颗粒度，降频后开战弹出延迟 ≤0.5s（原 ≤0.1s）。
   */
  private wantsFastPump(): boolean {
    const exp = this.state.expedition
    if (exp.phase === 'battle' && !!exp.battle) return true
    // 虫洞战斗（F 批）同款：洞内战斗也按 100ms 实时推进（否则 500ms 心跳下战斗画面一顿一顿）
    if (this.state.wormhole.run?.battle) return true
    if (tutorialAccelWait(this.state)) return true
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

  /** 当前心跳所属计量桶：交火中 = battle，其余 = idle（性能监测分桶用） */
  private currentBucket(): PerfBucket {
    const exp = this.state.expedition
    // 洞内交火同算 battle 桶（2026-09-13：心跳分支已认洞内，分桶同步）
    return (exp.active && exp.phase === 'battle' && !!exp.battle) || !!this.state.wormhole.run?.battle
      ? 'battle'
      : 'idle'
  }

  /** 推进一小片游戏时间（包装：激活性能监测时记录引擎侧耗时；未激活零开销）。
   *  nowWallMs = 现实墙钟：赏金日板按它对齐"每天本地 0 点"整板替换（游戏内时间泵变速不影响）。 */
  private advanceSlice(ms: number): void {
    const rec = perfHub.recording
    const t0 = rec ? performance.now() : 0
    const bucket = this.currentBucket()
    advanceGame(this.state, ms, this.ctx, { nowWallMs: Date.now() })
    this.drainSystemNotice()
    if (rec) perfHub.recordAdvance(bucket, performance.now() - t0)
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
      console.error('读档失败，将开启新档：', err)
      this.state = createInitialState({ prologue: true })
      // 2026-09-11：玩家可见文案不带技术细节（JSON / 版本号 / 异常字符串）——技术原因只进控制台
      const why =
        err instanceof SaveError
          ? err.code === 'PARSE'
            ? '存档文件已损坏'
            : err.code === 'FORMAT'
              ? '存档文件无法识别（不是本游戏的档案）'
              : '档案制式过旧，无法读取'
          : '存档文件无法读取'
      addLog(this.state, 'warn', `${why}——已为你开启新档案。`)
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
      const { overflowMs } = offlineSplit(now - lastSavedWall)
      simulateOffline(this.state, lastSavedWall, now, this.ctx, undefined, { stats })
      this.drainSystemNotice()
      this.offlineReport = buildOfflineReport(before, this.state, this.ctx, now - lastSavedWall, overflowMs, stats)
      // 2026-09-08 船长定：日志会话级（写盘剥离 logs）；启动不做强制清空——
      // 离线补时产生的日志照常显示，另补一条报告汇总单条（钱包/收获明细，关闭简报后仍可查证）
      if (this.offlineReport !== null) {
        addLog(this.state, 'info', offlineReportLogText(this.offlineReport))
      }
    }

    this.lastRealMs = Date.now()
    this.pumpMs = 0
    // 心跳周期按当前局面启动：战斗/教学加速/远征去程 100ms，普通挂机 500ms（低负载；2026-09-08 降频优化）
    this.ensurePump()
    this.saveIntervalId = window.setInterval(() => {
      void this.persist()
    }, 15_000)

    await this.persist()
    this.notify()
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
   */
  private tick(): void {
    const now = Date.now()
    const dt = Math.max(1, now - this.lastRealMs)
    this.lastRealMs = now
    // 序章·苏醒：演出阶段（step 0）冻结游戏时间——不推进/不累计余额，界面由演出组件驱动
    if (this.state.onboarding.step === ONB_AWAKEN) {
      this.pendingMs = 0
      return
    }
    const exp = this.state.expedition
    /**
     * 含已分胜负的"击杀慢镜窗口"：窗口内保持 100ms 切片推进 + 通知，让击杀动画/战报演出有稳定画面。
     *
     * ⚠ **洞内战斗必须同款**（2026-09-13 修船长报的"舰船移动约一秒跳一次，不顺滑"）：
     * 洞内宿主是 `state.wormhole.run.battle`（**不占** `expedition.battle`），首版这里只认远征 ⇒
     * 洞内交火掉进下面的**挂机分支**（`pendingMs >= 1000` 才推进并 `notify()` 一次）⇒
     * 战场每约 1 秒才收到一帧数据，船自然一秒跳一次（与帧率、与 33ms 插值都无关——插值再密，
     * 数据 1 秒才来一次也白搭）。
     */
    const inBattle = (exp.phase === 'battle' && !!exp.battle) || !!this.state.wormhole.run?.battle
    if (inBattle) {
      if (this.pendingMs > 0) {
        // 交火期积压（切页/后台节流等产生）按 100ms 分片追平，避免整段隐藏推进
        const step = Math.min(this.pendingMs, 100)
        this.advanceSlice(step)
        this.pendingMs -= step
      } else {
        this.advanceSlice(dt)
      }
      this.notify()
      return
    }
    // 序章·苏醒：教学等待段（采集/返航途中）时间泵 ×6（船长 2026-09-05 照准）；交火期不加速
    const pumpDt = tutorialAccelWait(this.state) ? dt * 6 : dt
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
    // 讨伐远征结束后复位标记（下一场手动出击照常自动弹战场）
    if (this.autoSortie && !this.state.expedition.active) this.autoSortie = false
    // 悬赏胜率 MC 预热（2026-09-09：指纹变化时分帧重算；节流+预算防卡 UI）
    this.pumpWinCache(now)
  }

  /** 保存存档（2026-09-08 船长定：事件日志不落盘——写盘前剥离 logs，
   * 每次开启游戏日志空白；logs 仅作本局内存滚动展示） */
  async persist(): Promise<boolean> {
    try {
      const out: GameState = this.state.logs.length > 0 ? { ...this.state, logs: [] } : this.state
      return await saveBridge.save(serializeSaveFile(out))
    } catch (err) {
      console.error('保存失败：', err)
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

  /** 恢复某份备份：先校验可解析 → 主进程覆盖（自动备份当前档）→ 热替换内存状态 */
  async restoreBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const read = await saveBridge.readBackup(name)
      if (!read.ok || read.text === undefined) return { ok: false, error: read.error ?? '读取备份失败。' }
      let parsed: ReturnType<typeof loadSaveFile>
      try {
        parsed = loadSaveFile(read.text)
      } catch (err) {
        return { ok: false, error: `备份无法解析（${err instanceof Error ? err.message : String(err)}）。` }
      }
      const restore = await saveBridge.restore(name)
      if (!restore.ok) return { ok: false, error: restore.error ?? '写回存档失败。' }
      // 2026-09-09（船长定）：恢复备份与导入/启动同口径——按"档内保存墙钟 → 现在"补算离线进度
      // （≥60 秒且简报非空则弹出离线简报卡；墙钟在未来则跳过）。日志仍会话级不落盘。
      const now = Date.now()
      const wallFrom = parsed.savedAtWallMs
      if (wallFrom > 0 && now > wallFrom) {
        const before = snapshotBasics(parsed.state)
        const stats = newSettleStats()
        const { overflowMs } = offlineSplit(now - wallFrom)
        simulateOffline(parsed.state, wallFrom, now, this.ctx, undefined, { stats })
        this.offlineReport = buildOfflineReport(before, parsed.state, this.ctx, now - wallFrom, overflowMs, stats)
        if (this.offlineReport !== null) {
          addLog(parsed.state, 'info', offlineReportLogText(this.offlineReport))
        }
      } else {
        this.offlineReport = null
      }
      this.state = parsed.state
      // 2026-09-08 船长定：日志会话级（写盘剥离）——恢复备份不做强制清空，本局日志接续显示
      const saved = await this.persist() // 落盘（墙钟锚 = 现在 → 下次启动不会重复结算）
      if (!saved) return { ok: false, error: '写回存档失败（存储空间不足或文件被占用）。' }
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
      if (!read.ok || read.text === undefined) return { ok: false, error: read.error ?? '读取备份失败。' }
      return await saveBridge.exportSaveToFile(read.text)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /** 从外部文件导入存档：覆盖前自动备份当前档 → 校验可解析 → 按时间差补齐离线进度
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
        return { ok: false, error: `所选文件无法解析为本游戏存档（${err instanceof Error ? err.message : String(err)}）。` }
      }
      const imported = parsed.state
      // 防误操作：覆盖前先把"当前档"备份一份（与恢复同口径）
      await this.persist()
      try {
        await saveBridge.backup()
      } catch {
        // 备份失败不阻断导入（尽力而为）
      }
      // 与正常启动同口径的载入修复链（须在离线结算前完成，让离线按新参数结算）
      repairDeprecatedModules(imported, this.ctx)
      migrateDeprecatedAmmo(imported)
      // 按时间差补齐离线进度：档内墙钟 → 现在（上限与正常离线一致；墙钟在未来则跳过）
      const now = Date.now()
      const wallFrom = parsed.savedAtWallMs
      if (wallFrom > 0 && now > wallFrom) {
        const before = snapshotBasics(imported)
        const stats = newSettleStats()
        const { overflowMs } = offlineSplit(now - wallFrom)
        simulateOffline(imported, wallFrom, now, this.ctx, undefined, { stats })
        this.offlineReport = buildOfflineReport(before, imported, this.ctx, now - wallFrom, overflowMs, stats)
        if (this.offlineReport !== null) {
          addLog(imported, 'info', offlineReportLogText(this.offlineReport))
        }
      }
      this.state = imported
      const saved = await this.persist() // 落盘（写盘剥离日志；墙钟锚 = 现在 → 下次启动不会重复结算）
      if (!saved) return { ok: false, error: '写回存档失败（存储空间不足或文件被占用）。' }
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
    if (current >= MAX_SKILL_LEVEL) return { ok: false, error: '该技能已是满级。' }
    const queued = this.state.skills.queue.filter((q) => q.skillId === skillId).length
    const target = current + 1 + queued
    if (target > MAX_SKILL_LEVEL) return { ok: false, error: '该技能已排队到满级，无法再追加。' }
    const result = enqueueSkill(this.state, skillId, target, this.ctx.skills)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 从训练队列移除第 index 项（0 = 队首） */
  dequeueAt(index: number): boolean {
    const ok = removeQueueAt(this.state, index)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  /** 2026-09-08（船长）：调整训练队列顺序（前移到顶 = 交换式顶替当前训练，原训练退位保留进度） */
  moveQueueAt(fromIndex: number, toIndex: number): boolean {
    const ok = moveQueueItem(this.state, fromIndex, toIndex)
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

  /** 开始在矿带开采 */
  startMiningAt(beltId: string): CommandResult {
    const result = startMining(this.state, beltId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
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

  /** B3：开始打捞作业（采矿式自动循环，默认卸货后续捞；需高槽打捞器） */
  startSalvageOpAt(galaxyId: string): CommandResult {
    const result = startSalvageOp(this.state, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
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
    const result = startRefineRun(this.state, itemId, worker, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
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
    const result = startUnboxRun(this.state, this.ctx, boxItemId, worker)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
  startRecycleRunAt(wreckItemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    const result = startRecycleRun(this.state, wreckItemId, worker, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 全部精炼炉工位运行视图（v19 多工位：工业页卡片逐台 / 活动栏逐条） */
  refineRunViews(): RefineRunView[] {
    return refineRunViews(this.state, this.ctx)
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
        error: `供应簿只够 ${res.bought.toLocaleString('zh-CN')} 件（已买入 ${name}×${res.bought.toLocaleString('zh-CN')}）——其余可挂「挂买单」等 市场补给后自动成交。`,
      }
    }
    switch (res.blocked) {
      case 'insufficient-isk': {
        const quote = marketQuote(this.state, this.ctx, goodKey)
        const unit = quote.sell ?? 0
        return {
          ok: false,
          error: `信用点不足：最低一张 ${unit.toLocaleString('zh-CN')} 信用点，钱包 ${Math.floor(this.state.wallet.isk).toLocaleString('zh-CN')} 信用点——减少数量，或用「挂买单」低价排队等成交。`,
        }
      }
      case 'standing':
        return {
          ok: false,
          error: `暂不能买入：${def ? (bmGateReason(this.state, def) ?? goodLockedReason(this.state, def) ?? '声望未达') : '声望未达'}。`,
        }
      case 'not-buyable':
        return { ok: false, error: `${name}只收不卖：市场不出售现货（可等玩家二手挂单，或自己制造）。` }
      default:
        return {
          ok: false,
          error: `${name}当前没有现货：市场供应簿为空——用「挂买单」等 市场补给后自动成交，或过一会儿再来（常驻 20 分钟一轮补给）。`,
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
  sellHoldingAt(goodKey: string, qty?: number): CommandResult {
    const res = marketSellHolding(this.state, this.ctx, goodKey, qty)
    if (res.ok && res.sold > 0) {
      void this.persist()
      this.notify()
    }
    if (res.ok) return { ok: true }
    return { ok: false, error: res.error ?? '出售失败。' }
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
    return res.ok ? { ok: true } : { ok: false, error: res.reason ?? '出售失败。' }
  }

  /** 开始制造（2026-09-08 劳动者制与精炼炉同款：worker='pilot' 主控亲自（全局限 1 条、占主控）/ AI 核心类型 = 一枚核心驱动一条线；
   * 扣材料（制造费已取消），时间到自动完成；AI 线完成/取消核心自动归还） */
  startManufacturingAt(blueprintId: string, worker: AiCoreType | 'pilot'): CommandResult {
    const result = startManufacturing(this.state, blueprintId, worker, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
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
    return { ok: false, error: '该位没有可卸下的装备。' }
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

  /** 出发远征（去程取消：下达即进入实时交火 → 结算/返航自动执行） */
  startExpeditionAt(anomalyId: string): CommandResult {
    const result = startExpedition(this.state, anomalyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T4 延后项：采矿中直接转战悬赏（UI 两步确认后调用；采矿终止、货随船、从矿带星系出发） */
  startExpeditionFromMiningAt(anomalyId: string): CommandResult {
    const result = startExpeditionFromMining(this.state, anomalyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 赏金任务·窝点出击（2026-09-10 船长定）：目标 = 派生窝点，档位随任务锁定
   *  （威胁/波次/僚机按档位强化、胜利后按窝点口径结算酬金与稀有残骸）。 */
  startLairExpeditionAt(anomalyId: string, lairTier: LairTier, fromMining = false): CommandResult {
    const result = fromMining
      ? startExpeditionFromMining(this.state, anomalyId, this.ctx, { lairTier })
      : startExpedition(this.state, anomalyId, this.ctx, { lairTier })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
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

  /** V14 探索：终止扫描探索（就地扫描窗口进度会保存，下次续扫） */
  stopScanNow(): CommandResult {
    const result = stopScan(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **主控活动「扫描虫洞」**（2026-09-14 船长）：只能在「扫描虫洞」界面里开始/停止。
   * 进度保留（停扫不清零）；满一个窗口由 `advanceWormholeScan` 在推进里发现一处虫洞。
   */
  wormholeScanStart(): CommandResult {
    const r = wormholeScanStart(this.state, this.ctx)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
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

  /* ─────────────── 终局玩法「虫洞」（E 批 · 施工期入口在调试开关后面） ─────────────── */

  /** 虫洞：跃入（编队校验 + 建副本；`seed` 取游戏随机种子，保证节点/拾取堆可复现） */
  wormholeEnter(shipIds: readonly string[]): CommandResult {
    const r = wormholeEnter(this.state, this.ctx, shipIds, this.state.rng.seed)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /**
   * **从库存进洞**（2026-09-14 船长：发现的虫洞囤在「扫描虫洞」页，玩家在那里选一处开始探索）。
   * 与调试入口的区别只有两处：种子取**该库存项**（本趟内容确定性）、起始层取该项的 `depth`；
   * 进洞成功即**消耗**这一处。
   */
  wormholeEnterFromStock(stockId: string, shipIds: readonly string[]): CommandResult {
    const item = wormholeStockOf(this.state).find((x) => x.id === stockId)
    if (!item) return { ok: false, error: '这处虫洞不在了（可能已经探索过）。' }
    const r = wormholeEnter(this.state, this.ctx, shipIds, item.seed)
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
   * 族名（取该族那张洞内敌卡的卡名：劫掠支队 / 巢群游猎 / 守墓巡哨 / 巨构残响 / 亡军封锁）。
   *
   * ⚠ **必须走 `ctx.anomalies` 全表**：五张洞内卡都带 `hidden: true`（施工期不进悬赏目录），
   * 而 `this.anomalies` 是**过滤掉 hidden 的目录** ⇒ 早先在这里查不到、界面直接漏出内部 id
   * （船长 2026-09-14 报障看到的是 `wh-alien-swarm`）。改成查全表，查不到才退回 id。
   */
  wormholeFamilyName(family: WormholeFamily): string {
    const cardId = WORMHOLE_FAMILY_CARD[family]
    return this.ctx.anomalies.get(cardId)?.name ?? this.anomalies.find((a) => a.id === cardId)?.name ?? cardId
  }

  /** 虫洞扫描：本趟窗口（毫秒；220 分钟 × 三技能乘算） */
  wormholeScanWindow(): number {
    return wormholeScanWindowMs(this.state)
  }

  /**
   * **进洞门槛（核心同一把尺）**：主控 + 编队各船必须空闲；`null` = 可以进洞。
   * ⚠ 「扫描虫洞 / 开采 / 打捞」**不算拦**（船长 2026-09-14「进洞自动停止」＋「同样落实到采矿/打捞」：
   * 进洞那一步会把它们停掉）⇒ 界面据此置灰，并用 `wormholeEntryAutoStopText()` 预告"会先自动停掉哪些"。
   */
  wormholeEntryGate(shipIds: readonly string[]): string | null {
    return wormholeEntryBlockReason(this.state, this.ctx, shipIds)
  }

  /** 进洞时会自动停掉的活动名（「扫描虫洞、开采、打捞」这类中文短名；没有则 null）——准备页预告条用它 */
  wormholeEntryAutoStopText(): string | null {
    return wormholeEntryAutoStops(this.state).map((a) => a.name).join('、') || null
  }

  /**
   * 进洞时会自动停掉的活动（**带 `warn` 标记**）——准备页据此把「长途运输」这类**有可见后果**的
   * 单独摆成警告条（船长 2026-09-14：「长途运输发出警告」）。
   */
  wormholeEntryAutoStopList(): Array<{ kind: string; name: string; warn: boolean }> {
    return wormholeEntryAutoStops(this.state).map((a) => ({ kind: a.kind, name: a.name, warn: a.warn }))
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
    }
  }

  /**
   * 虫洞：**前往**某一格（1 回合；未扫描的格必须先带 `confirmUnknown`，这就是"警告"的落点）。
   * ⚠ 走 `wormholeTravelTo`（不是 core 的 `wormholeGridTravel`）：**到达"舰船信号"那一格就地开打**
   * （船长 2026-09-13「战斗节点到达即开打」）——开战失败整趟移动回滚，玩家留在原格。
   */
  wormholeTravel(q: number, r: number, confirmUnknown = false): CommandResult {
    const res = wormholeTravelTo(this.state, this.ctx, { q, r }, { confirmUnknown })
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
    if (!run?.hold) return { ok: false, error: '货仓里没有形状件。' }
    const r = holdCompact(run.hold, wormholeHoldCapacityOf(this.state, this.ctx))
    if (r.moved > 0 || r.unplaced.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, error: r.unplaced.length > 0 ? `有 ${r.unplaced.length} 件放不回格子里（货仓超载）：先抛货。` : undefined }
  }

  /** 虫洞：**移动一件形状件**（拖拽落点；非法落点 ⇒ 拒绝、位置不变） */
  wormholeHoldMove(id: string, x: number, y: number): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: '货仓里没有形状件。' }
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
    if (!run?.hold) return { ok: false, error: '货仓里没有形状件。' }
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
    if (!run?.hold) return { ok: false, error: '货仓里没有形状件。' }
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
    return { ok: r.dropped.length > 0, error: r.dropped.length > 0 ? undefined : '货仓没有超载，不用抛货。' }
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
    if (!run) return { ok: false, error: '不在虫洞内。' }
    run.hold = run.hold ?? makeHoldState()
    const holdCap = wormholeHoldCapacityOf(this.state, this.ctx)
    const src = from === 'hold' ? run.hold : wormholeTempBoard(run)
    const dst = to === 'hold' ? run.hold : wormholeTempBoard(run)
    if (src === dst) return { ok: false, error: '两边是同一块板。' }
    const r = holdTransferTo(src, dst, id, to === 'hold' ? holdCap : WORMHOLE_TEMP_CELLS, x, y, grab)
    if (r.ok) {
      // 谜质装置挪动 ⇒ 增益实时派生（进货仓生效 / 出仓失效并**夹紧回合**）
      wormholeSyncMatterTurns(this.state)
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**整理临时空间**（与货仓的「整理」同一把尺：按件大小重排，只重排不丢件） */
  wormholeTempCompact(): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.tempGrid) return { ok: false, error: '临时空间里没有东西。' }
    const r = holdCompact(run.tempGrid, WORMHOLE_TEMP_CELLS)
    if (r.moved > 0 || r.unplaced.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, error: r.unplaced.length > 0 ? `有 ${r.unplaced.length} 件放不回格子里。` : undefined }
  }
  /** 虫洞：深入下一层（只在层末可用） */
  wormholeDescend(): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: '不在虫洞内。' }
    const blocked = wormholeActionBlockReason(this.state, this.ctx)
    if (blocked) return { ok: false, error: blocked }
    /**
     * ⚠ **新层也要带上扫码加成**（2026-09-13 二号接线单）：`wormholeDescend` 的第三个入参是
     * "新盘的扫描半径加成"，不传就默认 0 ⇒ 侦察舰/电子舰的「扫码范围 +1 圈」**只在第 1 层生效**。
     * 口径与入洞同源（`wormholeScanBonusOf` 对编队求和），故这里现算一次传进去。
     * ⚠ **第一入参是 `state`**（2026-09-13 星云批改的）：星云机制的"第一次下到层 4"提示要写进 `state`。
     */
    const r = wormholeDescend(this.state, this.state.rng.seed, wormholeScanBonusOf(this.ctx, run.fleet))
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：发起撤离（进入撤离战相位；撤离战本体在 F 批） */
  wormholeExtract(): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: '不在虫洞内。' }
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
        error: `临时空间里还有 ${pending.count} 件没处理：到「背包」页「放回货仓」或「丢弃」后再撤离。`,
      }
    }
    const r = wormholeExtract(run)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  /** 虫洞：**迎战**（`node` = 当前节点 / `boss` = 层末守卫 / `extract` = 撤离战） */
  wormholeFight(kind: 'node' | 'boss' | 'extract' | 'ruins'): CommandResult {
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
    const { overflowMs } = offlineSplit(ms)
    // 调试快进：冻结进行中的战斗（低安遭遇战 + 主控远征），不随快进时间跳变而瞬结（船长 2026-09-05）
    const stats = newSettleStats()
    simulateOffline(this.state, wallBase, wallBase + ms, this.ctx, undefined, { freezeBattle: true, stats })
    this.state.savedAtWallMs = wallBase + ms
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
    const result = goStandbyAt(this.state, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
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
  /** 战斗中撤退：轻损脱离并即刻回港（同时停止重复清剿） */
  retreatNow(): CommandResult {
    const result = retreatBattle(this.state, this.ctx)
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
    if (!script) return { ok: false, error: `未知通讯剧本：${scriptId}。` }
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

  /**
   * 通讯消息自带动作（2026-09-11 教程融入通讯）：序章简报那封的「按单开工：采集橄榄岩」。
   * 点了才从简报态推进到采集步骤；成功后落盘并通知刷新。
   */
  runCommsActionAt(command: CommsActionCommand): CommandResult {
    const r = runCommsAction(this.state, command)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  /* ─────────────── v24 任务中心·时效任务（资源 / 快递，定时刷新限时有效） ─────────────── */

  /** 任务板只读视图：资源/快递（20 分钟整点）+ 赏金（每天本地 0 点）两套倒计时一并返回 */
  sideTasksView(): ReturnType<typeof sideTaskBoard> {
    return sideTaskBoard(this.state, this.ctx, Date.now())
  }

  /** 快递任务当前是否解锁（已建成任一副空间站——stage ≥ 档位数） */
  courierTasksUnlocked(): boolean {
    return courierTaskUnlocked(this.state, this.ctx)
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

  /** 快递任务「出发投送」（真实航行：仓库锁定扣货 → 挂入在途 → 到站引擎自动结算） */
  startCourierDeliveryAt(id: number): CommandResult {
    const result = startCourierDelivery(this.state, this.ctx, id)
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
   * 「退出战场」= 仅关闭全屏观看界面——战斗后台照常推进、连击照常继续。
   * 原实现在"连击自动发起的战斗"中退出即清 autoLoopAnomalyId（视为收手），
   * 导致玩家只是退出观看就被停环；如需中止请用战场内「⚑ 撤退」（撤退才停环）。
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

  /** 重置档案（开新档） */
  resetGame(): void {
    this.state = createInitialState({ prologue: true })
    this.offlineReport = null
    void this.persist()
    this.notify()
  }

  /** 序章·苏醒：自检/起名完成 → 写入呼号并进入采集步骤（教程 S1） */
  prologueAwaken(name: string): CommandResult {
    const n = (name ?? '').trim()
    this.state.character.name = n.length > 0 ? n.slice(0, 12) : 'PRTS'
    const result = beginTutorialAfterAwaken(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 序章·苏醒：跳过（含演出阶段）——全额结算奖励 + 鲣鱼修满，教程结束 */
  prologueSkip(): CommandResult {
    const result = skipTutorial(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 序章·苏醒：收尾演出播完 → 教程完成（step 99，全解锁） */
  prologueFinishShow(): CommandResult {
    const result = finishTutorial(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 重要任务①「补给协议·首批矿物」：交付橄榄岩（仓库扣取）→ 4,000 信用点 + 基础 AI 核心 */
  deliverTutorialOreAt(): CommandResult {
    const result = deliverTutorialOre(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 序章·苏醒 S5：玩家到达技能页 → 特典即时归档（AI 核心操作学 Lv1，免训练等待）并进入分身步骤 */
  prologueSkillOpened(): CommandResult {
    const result = onTutorialSkillPageOpened(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
}
