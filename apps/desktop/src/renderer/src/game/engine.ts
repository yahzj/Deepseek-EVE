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
  advanceAutoLoopBounty,
  advanceGame,
  fightEncounter,
  fleeEncounter,
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
  goStandbyAt,
  goodLockedReason,
  learnBlueprint,
  levelOf,
  listSellHolding,
  loadSaveFile,
  loadWarehouseToCargoFit,
  lockShip,
  marketQuote,
  marketSellHolding,
  offlineSplit,
  placeBuyOrder,
  recallExpedition,
  refineRunViews,
  removeQueueAt,
  renameShip,
  migrateDeprecatedAmmo,
  repairDeprecatedModules,
  repairShip,
  useOneRepairKit,
  retreatBattle,
  sellCargoItem,
  sellCargoItemQty,
  sellShipAtMarket,
  sellWareItem,
  sellWareItemQty,
  serializeSaveFile,
  shipDisplayName,
  setBattleDesire,
  setMiningAutoCycle,
  setMiningStopAfterTrip,
  simulateOffline,
  startExpedition,
  startExpeditionFromMining,
  startManufacturing,
  startMining,
  startMiningFromExpedition,
  startRefineRun,
  startRecycleRun,
  startSalvageOp,
  startScan,
  startTransitHome,
  stopRefineRun,
  deliverStationResources,
  playDialogue,
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
  unloadCargoToWarehouse,
  beginTutorialAfterAwaken,
  skipTutorial,
  finishTutorial,
  deliverTutorialOre,
  onTutorialSkillPageOpened,
  tutorialAccelWait,
  ONB_AWAKEN,
} from '@whale/core'
import type {
  AiCoreType,
  CommandResult,
  GameState,
  ModuleSlot,
  RackSlot,
  RefineRunView,
  SellResult,
  SideTask,
  SimContext,
} from '@whale/core'
import { BELTS, BLUEPRINTS, GALAXIES, GALAXY_EDGES, ANOMALIES, ITEMS, MODULES, SHIP_BLUEPRINTS, SHIPS, SKILL_GROUPS, SKILLS, DIALOGUES, buildSimContext } from '@whale/data'
import { saveBridge } from './storage'

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
  }
}

export class GameEngine {
  /** 引擎规则计算需要的静态内容（技能/舰船/矿带/物品 + 平衡数值） */
  readonly ctx: SimContext = buildSimContext()
  /** 界面目录数据 */
  readonly skills = SKILLS
  readonly groups = SKILL_GROUPS
  readonly ships = SHIPS
  readonly belts = BELTS
  readonly items = ITEMS
  readonly modules = MODULES
  readonly blueprints = BLUEPRINTS
  readonly shipBlueprints = SHIP_BLUEPRINTS
  readonly galaxies = GALAXIES
  readonly galaxyEdges = GALAXY_EDGES
  readonly anomalies = ANOMALIES.filter((a) => !a.hidden) // B1：遭遇战模板（hidden）不进悬赏目录
  /** 全部异常目录（含 hidden 遭遇模板——星图/任务中心过滤展示用） */
  readonly allAnomalies = ANOMALIES
  /** 通讯剧本目录（T9） */
  readonly dialogues = DIALOGUES

  /** 当前游戏状态（每秒被推进；界面直接读它渲染） */
  state: GameState = createInitialState({ prologue: true })

  /** 本次启动的离线简报（没有离线结算时为 null；读完界面手动关闭） */
  offlineReport: OfflineReport | null = null

  private listeners = new Set<Listener>()
  private lastRealMs = 0
  private intervalId: number | null = null
  private saveIntervalId: number | null = null
  /** 非战斗期推进余额（累计满 1s 才推进一次，保持旧节奏；战斗中改 100ms 切片实时推进） */
  private pendingMs = 0
  /** 优化：本场远征是否由"连续出击"自动发起（期间战斗界面默认最小化，不自动弹全屏战场） */
  private autoSortie = false

  /** UI 查询：当前是否处于"自动连击发起的远征"（战斗界面不自动弹出） */
  autoSortieNow(): boolean {
    return this.autoSortie
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  /** 启动引擎：读档 → 离线结算 → 每秒推进 + 自动保存 */
  async start(): Promise<void> {
    let lastSavedWall: number | null = null
    try {
      const raw = await saveBridge.load()
      if (raw !== null) {
        const parsed = loadSaveFile(raw)
        this.state = parsed.state
        // V17 装备改版修复：旧"通用全系"增强器迁移为分系专精款（须在离线结算前完成，
        // 让离线战斗直接按新参数结算）；见 core/equipment.repairDeprecatedModules
        repairDeprecatedModules(this.state, this.ctx)
        // V18 口径取消：旧重型弹 1:1 并入通用弹（含挂单撤销）；见 core/equipment.migrateDeprecatedAmmo
        migrateDeprecatedAmmo(this.state)
        lastSavedWall = parsed.savedAtWallMs
      }
    } catch (err) {
      console.error('读档失败，将开启新档：', err)
      this.state = createInitialState({ prologue: true })
      const reason = err instanceof SaveError ? err.message : String(err)
      addLog(this.state, 'warn', `存档读取失败（${reason}），已为你开启新档案。`)
    }

    const now = Date.now()
    if (lastSavedWall !== null) {
      // B4：离线结算前后对比，生成启动简报（离线 ≥1 分钟才展示）
      const before = snapshotBasics(this.state)
      const { overflowMs } = offlineSplit(now - lastSavedWall)
      simulateOffline(this.state, lastSavedWall, now, this.ctx)
      this.offlineReport = buildOfflineReport(before, this.state, this.ctx, now - lastSavedWall, overflowMs)
    }

    this.lastRealMs = Date.now()
    this.intervalId = window.setInterval(() => this.tick(), 100)
    this.saveIntervalId = window.setInterval(() => {
      void this.persist()
    }, 15_000)

    await this.persist()
    this.notify()
  }

  /**
   * 时间泵（每 100ms 一响）：
   * - 玩家交火中：按 100ms 粒度切片推进并即时通知 → 战斗动画接近实时（数据 10Hz，无整秒跳变）；
   * - 其余时间：余额累计满 1s 再整体推进一次（训练/采矿/市场等节奏与旧版一致，界面通知保持 1Hz）。
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
    // 含已分胜负的"击杀慢镜窗口"（battle.ended 非空但尚未结算）：
    // 窗口内保持 100ms 切片推进 + 通知，让击杀动画/战报演出有稳定的实时画面
    const inBattle = exp.phase === 'battle' && !!exp.battle
    if (inBattle) {
      if (this.pendingMs > 0) {
        // 交火期积压（切页/后台节流等产生）按 100ms 分片追平，避免整段隐藏推进
        const step = Math.min(this.pendingMs, 100)
        advanceGame(this.state, step, this.ctx)
        this.pendingMs -= step
      } else {
        advanceGame(this.state, dt, this.ctx)
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
          advanceGame(this.state, slice, this.ctx)
          this.pendingMs -= slice
        }
        this.notify()
        return // 下一拍起进入 inBattle 泵，余额按 100ms 分片追平
      }
    }
    if (this.pendingMs >= 1000) {
      advanceGame(this.state, this.pendingMs, this.ctx)
      this.pendingMs = 0
      this.notify()
    }
    // T8 连续出击（落档开关）：整秒心跳后检查自动再出发/暂停条件
    if (this.state.autoLoopAnomalyId !== null) {
      const wasActive = this.state.expedition.active
      const reason = advanceAutoLoopBounty(this.state, this.ctx)
      if (!wasActive && this.state.expedition.active) this.autoSortie = true // 本次由连击自动发起
      if (reason !== null || (!wasActive && this.state.expedition.active)) this.notify()
    }
    // 连击远征结束后复位标记（下一场手动出击照常自动弹战场）
    if (this.autoSortie && !this.state.expedition.active) this.autoSortie = false
  }

  /** 保存存档 */
  async persist(): Promise<boolean> {
    try {
      return await saveBridge.save(serializeSaveFile(this.state))
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
      this.state = parsed.state
      this.offlineReport = null
      this.notify()
      return { ok: true }
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

  /** T4 延后项：远征中直接转开采（UI 两步确认后调用；取消远征并停连击） */
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

  /** B3：开始打捞作业（采矿式单趟；需高槽打捞器） */
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

  /** 获取蓝图：市场有货 → 买下蓝图书并自动学习；无货 → 挂收购单（到货后手动学习） */
  acquireBlueprintAt(blueprintId: string): { ok: boolean; error?: string; pending?: boolean } {
    // 找该蓝图的市场商品
    let goodKey: string | null = null
    for (const def of this.ctx.marketGoods.values()) {
      if (def.kind === 'blueprint' && def.refId === blueprintId) {
        goodKey = def.key
        break
      }
    }
    if (!goodKey) return { ok: false, error: '该蓝图不在市场流通目录中。' }
    if (this.state.learnedRecipes.includes(blueprintId)) return { ok: false, error: '该配方已学会，无需重复获取。' }
    const lock = goodLockedReason(this.state, this.ctx.marketGoods.get(goodKey)!)
    if (lock) return { ok: false, error: `暂不能购买蓝图书：${lock}。` }
    const res = buyAtMarket(this.state, this.ctx, goodKey, 1)
    if (res.bought > 0) {
      const learn = learnBlueprint(this.state, this.ctx, blueprintId)
      void this.persist()
      this.notify()
      if (learn.ok) return { ok: true }
      return { ok: false, error: learn.error ?? '购买成功但学习失败（数据异常）。' }
    }
    // 簿上无书：按均衡价挂收购单（到货后手动学习）
    const quote = marketQuote(this.state, this.ctx, goodKey)
    const ask = quote.sell !== undefined ? Math.round(quote.sell * 1.02) : Math.round(levelOf(this.state, this.ctx, goodKey) * 1.03)
    const order = placeBuyOrder(this.state, this.ctx, goodKey, ask, 1)
    if (!order) return { ok: false, error: 'ISK 不足或挂单失败：先攒够购书款。' }
    void this.persist()
    this.notify()
    return { ok: true, pending: true }
  }

  /** 市价买入商品（默认 1 件；矿石/矿物传数量）；无现货时报错并提示改挂单 */
  buyGoodAt(goodKey: string, qty = 1): CommandResult {
    const res = buyAtMarket(this.state, this.ctx, goodKey, qty)
    if (res.bought > 0) {
      void this.persist()
      this.notify()
    }
    if (res.bought >= qty) return { ok: true }
    return {
      ok: false,
      error: `市场供应簿只剩 ${res.bought.toLocaleString('zh-CN')} 件可即时成交——可用「挂单买入」等 NPC 补给后自动成交。`,
    }
  }

  /** 挂限价买单（等 NPC 补给/降价自动成交）；返回新订单 id（失败返回 null） */
  placeBuyOrderAt(goodKey: string, price: number, qty: number): number | null {
    const order = placeBuyOrder(this.state, this.ctx, goodKey, price, qty)
    if (order) {
      void this.persist()
      this.notify()
    }
    return order ? order.id : null
  }

  /** 挂限价卖单（货从自然库存锁定：物品→仓库、装备→装备库、蓝图→蓝图书架） */
  placeSellOrderAt(goodKey: string, price: number, qty: number): CommandResult {
    const res = listSellHolding(this.state, this.ctx, goodKey, price, qty)
    if (res.ok) {
      void this.persist()
      this.notify()
      return { ok: true }
    }
    return { ok: false, error: res.error ?? '挂单失败。' }
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

  /** 市价出售机库里的舰船（须空仓、无装配、非驾驶） */
  sellShipAt(shipId: string): CommandResult {
    const res = sellShipAtMarket(this.state, this.ctx, shipId)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res.ok ? { ok: true } : { ok: false, error: res.reason ?? '出售失败。' }
  }

  /** 开始制造（扣材料与制造费，时间到自动完成） */
  startManufacturingAt(blueprintId: string): CommandResult {
    const result = startManufacturing(this.state, blueprintId, this.ctx)
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

  /** V18：卸下 指定槽类+位序 的装备（放回装备库；shipId 缺省 = 当前驾驶船） */
  unfitAtAt(rack: RackSlot, index: number, shipId?: string): boolean {
    const ok = unfitAt(this.state, rack, index, shipId)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
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

  /** v21：取消指定制造线（按线号；材料全额退回仓库、制造费不退） */
  cancelManufacturingAt(runId: number | string): CommandResult {
    const result = cancelManufacturing(this.state, this.ctx, Number(runId))
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
    simulateOffline(this.state, wallBase, wallBase + ms, this.ctx, undefined, { freezeBattle: true })
    this.state.savedAtWallMs = wallBase + ms
    this.offlineReport = buildOfflineReport(before, this.state, this.ctx, ms, overflowMs)
    void this.persist()
    this.notify()
  }

  /** 战斗中调整期望距离（距离条拖动/战术按钮；写入并记忆偏好） */
  battleSetDesireAt(desireM: number): CommandResult {
    const result = setBattleDesire(this.state, desireM, this.ctx)
    if (result.ok) {
      void this.persist()
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

  /** T5：锁定/解锁舰船（防误售，跨会话持久化） */
  lockShipAt(shipId: string, locked: boolean): CommandResult {
    const result = lockShip(this.state, shipId, locked, this.ctx)
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
  /** 战斗中撤退：轻损脱离并自动返航（同时停止连续出击） */
  retreatNow(): CommandResult {
    const result = retreatBattle(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** T8：悬赏连续出击开关（落档）；null = 停止 */
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

  /** T9：播放/重看通讯剧本（逐句镜像进事件日志 + 标记已读 + 清待播） */
  openDialogue(scriptId: string): CommandResult {
    const script = DIALOGUES.find((d) => d.id === scriptId)
    if (!script) return { ok: false, error: `未知通讯剧本：${scriptId}。` }
    playDialogue(this.state, scriptId, this.ctx, script.lines)
    void this.persist()
    this.notify()
    return { ok: true }
  }

  /* ─────────────── v24 任务中心·时效任务（资源 / 快递，定时刷新限时有效） ─────────────── */

  /** 任务板只读视图：资源/快递任务列表 + 到期倒计时（未开盘/未解锁状态一并返回） */
  sideTasksView(): ReturnType<typeof sideTaskBoard> {
    return sideTaskBoard(this.state, this.ctx)
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
   * 优化：玩家手动退出全屏战场时的兜底——若本场战斗由"连续出击"自动发起且尚未结束，
   * 视为玩家想收手：停连击（避免冷却结束后又自动进入战斗）。
   */
  onBattleViewClosed(): void {
    const exp = this.state.expedition
    if (this.autoSortie && exp.active && exp.phase === 'battle') {
      this.state.autoLoopAnomalyId = null
      this.autoSortie = false
      addLog(this.state, 'info', '连续出击已停止（手动退出战场）。')
      void this.persist()
      this.notify()
    }
  }

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

  /** 把当前船货仓全部卸入物品仓库；返回卸入数量 */
  unloadAllToWarehouse(): number {
    const moved = unloadCargoToWarehouse(this.state)
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

  /** 指派 AI 远征任务 */
  assignAiExpeditionAt(shipId: string, coreType: AiCoreType, anomalyId: string): CommandResult {
    const result = assignAiExpedition(this.state, shipId, coreType, anomalyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** B3：指派 AI 打捞任务（单趟：出航→打捞→满仓返港卸货→结束） */
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

  /** 序章·苏醒：跳过（含演出阶段）——全额结算奖励 + 隼枭修满，教程结束 */
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

  /** 重要任务①「补给协议·首批矿物」：交付富凡晶石（仓库扣取）→ 4,000 ISK + 基础 AI 核心 */
  deliverTutorialOreAt(): CommandResult {
    const result = deliverTutorialOre(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /** 序章·苏醒 S5：玩家到达技能页 → 特典即时归档（人工智能专家 Lv1，免训练等待）并进入分身步骤 */
  prologueSkillOpened(): CommandResult {
    const result = onTutorialSkillPageOpened(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
}
