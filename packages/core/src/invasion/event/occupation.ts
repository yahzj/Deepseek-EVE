/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import { weekendDebugOn } from './time'
import { WEEKEND_MIN_STANDING, WEEKEND_FINISHED_FAMILIES } from './constants'
import type { SimContext } from '../../types'
import { securityZoneOf } from '../../securityZone'
import { streamOf, weekendLockedFamilyOf } from './family'

/**
 * 协会（DSI）声望取数。
 *
 * ⚠ **2026-09-26 船长令**：「**修改原先的所有声望门槛，改为根据玩家的累计声望**」⇒ 读**累计获得**
 * 那一本（`standingsEarned`），**不是**可支配那本（章鱼人兑换会扣它）。与唯一入口
 * `expedition.standingOf` 逐字同口径。
 *
 * ⚠ **刻意不 import `expedition`**：`expedition` 反过来 import 本文件（`weekendFoeCardOf`）⇒
 * 引进来会成环（同本文件头注那条"依赖方向"纪律）。id 与 `expedition.DSI_FACTION_ID` 同值；
 * `firstTasks` 里也有一处同样的本地写法（既有做法）。
 */
export function dsiStandingOf(state: Pick<GameState, 'standings' | 'standingsEarned'>): number {
  return state.standingsEarned?.['dsi'] ?? state.standings['dsi'] ?? 0
}

/**
 * **这一刻允许开新场吗**（声望前提的唯一判据；`ensureWeekendEvent` 正常模式那一段读它）。
 * 调试模式恒真（船长四答之三）⇒ 调试不受门槛影响；其余情形 = 协会**累计**声望 ≥ `WEEKEND_MIN_STANDING`。
 */
export function weekendInvasionAllowedFor(
  state: Pick<GameState, 'debugQuick' | 'standings' | 'standingsEarned'>,
): boolean {
  if (weekendDebugOn(state)) return true
  return dsiStandingOf(state) >= WEEKEND_MIN_STANDING
}

/** 核心候选：已探索 · **中安/低安**（非高安）· **无已建副站** */
export function weekendCoreCandidates(state: GameState, ctx: SimContext): string[] {
  const out: string[] = []
  for (const id of state.exploredGalaxies ?? []) {
    if (securityZoneOf(ctx, id) === '高安') continue
    if (weekendHasBuiltStation(state, ctx, id)) continue
    out.push(id)
  }
  return out.sort() // 排序 ⇒ 与探索顺序无关，选取可复现
}

/** 该星系是否已有**建成**的副站（在建/未开工不算 ⇒ 与 `builtStationCount` 同口径）
 *  ⚠ **2026-09-30 起对外导出**：信号发射器的"指定星系"那条禁令＝**目标星系不能有空间站**
 *  （船长：「主动对某个星系使用，**只有不能对有空间站的星系使用这一条禁令**」）——那条判据除了
 *  已建成副站，还要算上**母港所在星系**（母港自带空间站），两处共用本函数。 */
export function weekendHasBuiltStation(state: GameState, ctx: SimContext, galaxyId: string): boolean {
  for (const site of ctx.stations.values()) {
    const anySite = site as unknown as { galaxyId?: string; tiers?: readonly unknown[] }
    if (anySite.galaxyId !== galaxyId) continue
    const p = state.stationSites?.[site.id]
    if (p && anySite.tiers && p.stage >= anySite.tiers.length) return true
  }
  return false
}

/** 核心的全部邻居（不封顶；**含高安**） */
export function weekendPeripheryOf(ctx: SimContext, coreId: string): string[] {
  const out = new Set<string>()
  for (const e of ctx.galaxyEdges) {
    if (e.from === coreId) out.add(e.to)
    else if (e.to === coreId) out.add(e.from)
  }
  out.delete(coreId)
  return [...out].sort()
}

/** 按 (种子, 编号) 抽核心与族（纯函数，可复现） */
export function weekendRollOccupation(
  state: GameState,
  ctx: SimContext,
  seq: number,
  /**
   * **本期该跑哪一族**（**船长 2026-10-02 令**的循环/特意设置；缺省 = 走旧口径 `weekendLockedFamilyOf`）
   * —— 由调用方按**本期窗口 T0** 算好传进来（`weekendFamilyForWindow(t0)`）。
   */
  familyOfWindow?: string | null,
): { coreId: string; peripheryIds: string[]; family: string } | null {
  const candidates = weekendCoreCandidates(state, ctx)
  if (candidates.length === 0) return null
  const rng = streamOf(state.rng.seed, seq)
  const coreId = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]!
  /**
   * 族：**照旧消费一次随机数**（保持子流形状不变），但若"本期族"有值就判成它
   * —— 优先序：**本期族（循环/特意设置）** → **调试族/全线硬锁**（`weekendLockedFamilyOf`）→ 随机。
   *
   * ⚠ **随机兜底池 = "做完了的族"**（`WEEKEND_FINISHED_FAMILIES`，**2026-10-02 改**）——原为
   * `WEEKEND_FAMILIES`（含 A/C/G 三个**占位族**）⇒ 那时随机兜底会把玩家送进"打不到真舰队"的场。
   * 现口径与船长 2026-10-02 令「**信号发射器召唤的敌人是随机的（目前只有R和H）**」同一把尺。
   */
  const familyRoll = rng()
  const family =
    familyOfWindow ??
    weekendLockedFamilyOf(state) ??
    WEEKEND_FINISHED_FAMILIES[
      Math.min(WEEKEND_FINISHED_FAMILIES.length - 1, Math.floor(familyRoll * WEEKEND_FINISHED_FAMILIES.length))
    ]!
  return { coreId, peripheryIds: weekendPeripheryOf(ctx, coreId), family }
}

/**
 * **随机抽一支"做完了的族"**（**船长 2026-10-02 令**：「**信号发射器召唤的敌人是随机的
 * （目前只有R和H）**」）—— 信号发射器专用：**星系**照旧（随机 / 玩家指定），**势力随机**。
 *
 * - 池 = `WEEKEND_FINISHED_FAMILIES`（现 R/H）⇒ **绝不吐占位族 A/C/G**；
 * - **纯函数**：只读 `state.rng.seed`（同一 (种子, 场次) 恒得同一族，可复现），不写档 ⇒
 *   在"料不够 / 已有入侵"这类拒绝路径上提前调用也**无副作用**；
 * - 与 `weekendRollOccupation` **各自独立抽**（那条路是"第 2 次抽签"，这里是"第 1 次"）——
 *   两条路的产物都只依赖 (种子, 场次)，不共享流位置。
 */
export function weekendRandomFamilyOf(state: Pick<GameState, 'rng'>, seq: number): string {
  const pool = WEEKEND_FINISHED_FAMILIES
  const rng = streamOf(state.rng.seed, seq)
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!
}

/**
 * 🔴 **本期是不是已经"封盘"了**（**船长 2026-10-02 令「甲」**）—— **本期击杀过旗舰 ⇒ 本期不再开新场**。
 *
 * ## 为什么要有这条（一号当日的玩家报障取证）
 *
 * 玩家报障：「**击败旗舰打空血量后，被弹出战斗，且旗舰血量全满**」。一号用真实函数跑了一整条链路，
 * 结论不是"同一场血量被重置"（全仓只有 `weekendNoteFlagshipDamage` 一个写入点、只做加法；换场即全新对象），
 * 而是：**击杀旗舰 ⇒ 本场入侵结束 ⇒ 下一拍立刻又开了一场新的入侵**（＝ 2026-10-02「甲」令
 * 「只看当前有没有正在进行」那条的**已知后果**：窗口内可连开）⇒ 新一场的旗舰在**首次接战**那一刻
 * 锁成满血 150,000 ⇒ 玩家看到的就是「**旗舰血量全满**」。
 * 战利品**没丢**（探针读数：`flagshipKilled = { blackBox: true, wreck: 90 }` ✓），丢的是观感：
 * 「刚把入侵打穿，立刻又冒出一场满血旗舰」。
 *
 * ## 口径（船长 2026-10-02 令「甲」）
 *
 * - **只有"玩家击杀旗舰"这一种结束方式封盘**：章鱼人得手（`'octopus'`）与到点收场（`'window'`）
 *   **照旧可连开**（那两种不是"玩家打赢了"）；
 * - **封盘只封本期**：下一期 T0 一到，照常开新场（判据拿"本期 T0"比）；
 * - ⚠ **不封玩家召唤场**：信号发射器点火走的是 `useInvasionBeacon`（不经本函数）——玩家自己花道具
 *   点的入侵是**主动选择**，不在"自动连开"的治理范围内；
 * - 玩家召唤场由玩家使用信号发射器主动开启，本期封盘不拦截。
 *
 * ## 判据（**不新增存档字段**）
 *
 * 读**最近一场留档**（`state.weekendLastResult`，结算时写）：`flagshipOutcome === 'player'`
 * （= `weekendFlagshipOutcomeOf` 的"留档优先"口径：玩家亲手击沉）**且**它**结束在本期 T0 之后**。
 * 换期后 `endedAtWallMs < 新的本期 T0` ⇒ 自动解封（无需回收/迁移）。
 */
export function weekendPeriodSealedByKill(
  state: Pick<GameState, 'weekendLastResult'>,
  t0WallMs: number,
): boolean {
  const snap = state.weekendLastResult
  return snap !== undefined && snap.flagshipOutcome === 'player' && snap.endedAtWallMs >= t0WallMs
}
