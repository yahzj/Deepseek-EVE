/**
 * **周末入侵活动**（2026-09-23 船长令：设计定稿 → 「**Q1，威胁降低，依旧是单舰。其他按你推荐。**」⇒ M1 开工）。
 *
 * 设计全文（口径 16 条 ＋ 机制蓝图 ＋ 数值表 ＋ 已裁决 7 条）见
 * `docs/design/weekend-invasion-20260923.md`；**本文件只放机制骨架的第一块（纯函数）**：
 * 时间轴 / 占领（核心 ＋ 外围）/ 进度（玩家推进 ＋ NPC 反攻铺底 ＋ 核心门禁）/
 * 高频遇袭概率与伏击强度 / 贡献台账 / 旗舰状态。战斗接线（派生卡、小队战入口、日志与界面）在下一块。
 *
 * 三条设计原则（都为了"零迁移 + 可离线结算 + 可测"）：
 * 1. **进度不落盘逐格 tick**：`进度 = NPC 铺底(时间函数) + 玩家投入(台账)` ⇒ 离线一样能算、读档即自洽；
 * 2. **随机全走独立子流**（`hash32(存档种子, 入侵编号)`）⇒ **不消费主随机序列**，老档读数一字不动；
 * 3. **一切判据纯函数**（给 `nowWallMs` 就出结果）⇒ 用例可对任意时刻断言，不依赖 tick。
 */
import type { SimContext } from './types'
import type { GameState, WormholeFamily } from './state'
import { securityZoneOf } from './sideTasks'
import { wormholeCardPoolAt } from './wormholeFoes'

/* ─────────────── 常量（数值表 · 2026-09-23 Q1 定档后锁） ─────────────── */

/** 外围入侵舰队威胁（**Q1 裁定：单舰 · 威胁降低** ⇒ 78；落在"单船现实上限 ≈84"之下、比虫洞层 6≈72 略高） */
export const WEEKEND_PERIPHERY_THREAT = 78
/** 核心 T5 旗舰威胁（口径定稿 #13：**核心 120**；4 波 · 4 艘小队战） */
export const WEEKEND_CORE_THREAT = 120
/** 伏击（巡游小队）强度倍率：**主动出击才是 78 / 120**（Q2 裁定 ×0.5） */
export const WEEKEND_AMBUSH_MUL = 0.5
/** 遇袭概率：`p = 60% × (1 − 进度)`，封顶 0.9（口径定稿 #4） */
export const WEEKEND_ENCOUNTER_P = 0.6
export const WEEKEND_ENCOUNTER_CAP = 0.9
/** 玩家推进：主动胜利（外围 / 核心）· 击退遇袭 · 离线自动结算击退（第 6 条） */
export const WEEKEND_GAIN_PERIPHERY_WIN = 0.1
export const WEEKEND_GAIN_CORE_WIN = 0.05
export const WEEKEND_GAIN_REPEL = 0.03
export const WEEKEND_GAIN_OFFLINE_REPEL = 0.01
/** NPC 反攻保底推进（第 9 条）：外围 T0+48h 必满 · 核心 T0+72h 必满 */
export const WEEKEND_NPC_PERIPHERY_MS = 48 * 3_600_000
export const WEEKEND_NPC_CORE_MS = 24 * 3_600_000
/** 旗舰倒计时（第 8 条）：核心条满后 2 小时内未击毁 ⇒ 章鱼人摧毁 */
export const WEEKEND_FLAGSHIP_DEADLINE_MS = 2 * 3_600_000
/** 离线保护（第 10 条）：离线 ≤24h ⇒ 倒计时挂起，上线第一拍起算（Q3：离线满 24h 那一刻起算） */
export const WEEKEND_OFFLINE_SHIELD_MS = 24 * 3_600_000
/** 活动窗口（第 1/15 条）：T0 = 每周五 20:00（本地墙钟）→ 74h */
export const WEEKEND_START_WEEKDAY = 5 // 5 = 周五（JS getDay）
export const WEEKEND_START_HOUR = 20
export const WEEKEND_WINDOW_MS = 74 * 3_600_000
/**
 * **只有调试模式可见/可开**（**船长 2026-09-23 令**：「**目前入侵只有调试模式可见**」）。
 * ⇒ 非调试模式**永不开局**（周五 20:00 那套排期代码留着，等船长解除限制即生效）；
 * 引擎/界面/用例都读这一个开关，不做第二处判断。
 */
export const WEEKEND_DEBUG_ONLY = true

/** 调试模式（`debugQuick`）：上一场结束 + 1 小时刷新（第 15 条）· NPC 时间轴 ÷60（Q6）· 关掉离线保护（Q7） */
export const WEEKEND_DEBUG_RESTART_MS = 3_600_000
export const WEEKEND_DEBUG_TIME_DIVISOR = 60

/* ─────────────── 存档结构（`state.weekendEvent`，可选 ⇒ 零迁移） ─────────────── */

export interface WeekendEventState {
  /** 本次入侵编号（自增；随机子流的盐） */
  seq: number
  /** T0（墙钟；正常 = 周五 20:00，调试 = 上一场结束 + 1h） */
  startedAtWallMs: number
  /** 结束墙钟（未结束 = 缺省） */
  endedAtWallMs?: number
  /** 核心星系（已探索 · 中安/低安 · 无已建副站） */
  coreId: string
  /** 外围 = 核心的全部邻居（不封顶；**含高安**） */
  peripheryIds: string[]
  /** 本周入侵族 id */
  family: string
  /** 玩家推进台账：galaxyId → 累计投入比例（0~1 的加数） */
  contributed: Record<string, number>
  /** 核心条满（旗舰现身）的墙钟 */
  flagshipAtWallMs?: number
  /** 旗舰结局：玩家击毁 / 章鱼人摧毁 */
  flagshipDown?: 'player' | 'octopus'
}

/**
 * 入侵族池（口径定稿：**A 变种 / C / G / 新族×2**）。
 * ⚠ **M1 只放"虫洞已有的族"**（A/C/G）——因为**敌卡暂用虫洞族卡**（船长 2026-09-23：
 * 「入侵战斗采用独立设计的卡（之后设计），我们暂时先试用虫洞的」）；两个新族随 M3（独立卡/新族）一起进池。
 */
export const WEEKEND_FAMILIES: readonly string[] = ['A', 'C', 'G']

/* ─────────────── 敌卡：暂用虫洞族卡（独立卡后续批次再换） ─────────────── */

/**
 * **入侵舰队的敌卡**（**船长 2026-09-23**：「入侵战斗采用独立设计的卡（之后设计），**我们暂时先试用虫洞的**」）。
 *
 * 口径：① 数据全用**该族的虫洞卡**（`wormholeCardPoolAt`：外围取中层池、旗舰取最深池 ⇒ 与该族在虫洞里的编成一致）；
 * ② **威胁 / 名字 / 奖励由入侵覆盖**（78 / 120，名「<族>舰队 · <卡名>」，奖励 ×1.4）；
 * ③ 独立设计的入侵卡与各族 T5 旗舰留到 M2/M3 ⇒ 本函数是**唯一换卡点**（换卡只改这里）。
 */
export function weekendFoeCardOf(family: string, kind: 'assault' | 'flagship'): string {
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  // 外围 ⇒ 中层池（层 5）· 旗舰 ⇒ 最深池（层 9）：两者都靠 `wormholeCardPoolAt` 的缺档兜底
  const pool = wormholeCardPoolAt(fam, kind === 'flagship' ? 9 : 5)
  return pool[0]!.id
}

/* ─────────────── 小工具：独立随机子流（不碰主 RNG） ─────────────── */

function hash32(a: number, b: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** 由 (存档种子, 入侵编号) 派生一个确定性序列；**不动 `state.rng`** */
function streamOf(seed: number, seq: number): () => number {
  let s = hash32(seed, seq * 2654435761) || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ─────────────── 时间轴 ─────────────── */

/** 调试模式判定（与全仓同口径：`state.debugQuick`） */
export function weekendDebugOn(state: Pick<GameState, 'debugQuick'>): boolean {
  return state.debugQuick === true
}

/** NPC 时间轴的实际时长（调试模式 ÷60，Q6） */
export function weekendNpcTimelineMs(state: Pick<GameState, 'debugQuick'>, baseMs: number): number {
  return weekendDebugOn(state) ? Math.max(1, Math.round(baseMs / WEEKEND_DEBUG_TIME_DIVISOR)) : baseMs
}

/** 倒计时的实际时长（调试模式同样 ÷60） */
export function weekendDeadlineMs(state: Pick<GameState, 'debugQuick'>): number {
  return weekendNpcTimelineMs(state, WEEKEND_FLAGSHIP_DEADLINE_MS)
}

/** 某一时刻所在"周"的 T0（正常模式：该时刻之前最近的周五 20:00 本地墙钟） */
export function weekendT0Of(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  const day = d.getDay()
  let back = (day - WEEKEND_START_WEEKDAY + 7) % 7
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WEEKEND_START_HOUR, 0, 0, 0).getTime()
  if (back === 0 && nowWallMs < at) back = 7 // 本周五 20:00 还没到 ⇒ 用上一周
  return at - back * 86_400_000
}

/** 窗口是否还开着（T0 ~ T0+74h） */
export function weekendWindowOpen(nowWallMs: number, t0: number): boolean {
  return nowWallMs >= t0 && nowWallMs < t0 + WEEKEND_WINDOW_MS
}

/* ─────────────── 占领：核心选取 ＋ 外围 ─────────────── */

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

/** 该星系是否已有**建成**的副站（在建/未开工不算 ⇒ 与 `builtStationCount` 同口径） */
function weekendHasBuiltStation(state: GameState, ctx: SimContext, galaxyId: string): boolean {
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
): { coreId: string; peripheryIds: string[]; family: string } | null {
  const candidates = weekendCoreCandidates(state, ctx)
  if (candidates.length === 0) return null
  const rng = streamOf(state.rng.seed, seq)
  const coreId = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]!
  const family = WEEKEND_FAMILIES[Math.min(WEEKEND_FAMILIES.length - 1, Math.floor(rng() * WEEKEND_FAMILIES.length))]!
  return { coreId, peripheryIds: weekendPeripheryOf(ctx, coreId), family }
}

/* ─────────────── 进度（纯函数：给 now 就出结果） ─────────────── */

/** 该星系是不是本次入侵的占领区（核心或外围） */
export function weekendOccupiedIds(ev: WeekendEventState | undefined): string[] {
  if (!ev) return []
  return [ev.coreId, ...ev.peripheryIds]
}

/**
 * **外围进度** = NPC 铺底（`t/48h`，调试 ÷60）＋ 玩家投入（台账），相加封顶 1。
 * `t` 自 T0 起算。
 */
export function weekendPeripheryProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  // ⚠ 铺底先钳 ≥0：T0 之前（或调试口径下时间未到）不许出现"负铺底"把玩家投入一起拉回 0
  const npc = Math.max(0, (nowWallMs - ev.startedAtWallMs) / weekendNpcTimelineMs(state, WEEKEND_NPC_PERIPHERY_MS))
  const put = ev.contributed[galaxyId] ?? 0
  return clamp01(npc + put)
}

/** 外围是否全部夺回（核心门禁的判据） */
export function weekendPeripheryClearedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): boolean {
  return ev.peripheryIds.every((id) => weekendPeripheryProgressAt(state, ev, id, nowWallMs) >= 1)
}

/**
 * **核心进度** = NPC 铺底（自 T0+48h 起 `(t−48h)/24h`）＋ 玩家投入，封顶 1；
 * **门禁**（第 7 条）：外围未全部夺回 ⇒ 核心条不涨（返回**玩家投入那部分的下限**，即 0 与投入的较小者）。
 */
export function weekendCoreProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const put = ev.contributed[ev.coreId] ?? 0
  if (!weekendPeripheryClearedAt(state, ev, nowWallMs)) return clamp01(Math.min(put, 0))
  const npcStart = ev.startedAtWallMs + weekendNpcTimelineMs(state, WEEKEND_NPC_PERIPHERY_MS)
  const npc = Math.max(0, (nowWallMs - npcStart) / weekendNpcTimelineMs(state, WEEKEND_NPC_CORE_MS))
  return clamp01(npc + put)
}

/** 任一占领区进度（外围 / 核心自动分流） */
export function weekendProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  if (galaxyId === ev.coreId) return weekendCoreProgressAt(state, ev, nowWallMs)
  if (!ev.peripheryIds.includes(galaxyId)) return 0
  return weekendPeripheryProgressAt(state, ev, galaxyId, nowWallMs)
}

/** 已夺回（进度满）的星系 */
export function weekendReclaimedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): string[] {
  return weekendOccupiedIds(ev).filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

/* ─────────────── 遇袭（高频 · 中安高安破例 · 失败只受损） ─────────────── */

/** 遇袭概率：`60% × (1 − 进度)`，封顶 0.9（夺回后 = 0） */
export function weekendEncounterChanceAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  const p = weekendProgressAt(state, ev, galaxyId, nowWallMs)
  if (p >= 1) return 0
  return Math.min(WEEKEND_ENCOUNTER_CAP, WEEKEND_ENCOUNTER_P * (1 - p))
}

/** 主动出击的威胁（被占星系的悬赏替换卡；外围 78 / 核心 120） */
export function weekendAssaultThreatOf(ev: WeekendEventState, galaxyId: string): number {
  return galaxyId === ev.coreId ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT
}

/** 伏击（遇袭）强度 = 主动 ×0.5（Q2） ⇒ 外围 39 · 核心 60 */
export function weekendAmbushThreatOf(ev: WeekendEventState, galaxyId: string): number {
  return Math.round(weekendAssaultThreatOf(ev, galaxyId) * WEEKEND_AMBUSH_MUL)
}

/* ─────────────── 旗舰与倒计时 ─────────────── */

export interface WeekendFlagshipView {
  /** 是否已现身（核心条满） */
  shown: boolean
  /** 现身时刻 */
  atWallMs?: number
  /** 击毁时限（含离线保护后的实际起算点） */
  deadlineWallMs?: number
  /** 结局：player = 玩家击毁 · octopus = 章鱼人摧毁 */
  down?: 'player' | 'octopus'
}

/**
 * **旗舰视图（含离线保护）**（第 8/10 条 ＋ Q3/Q7）：
 * - 核心条满 ⇒ 现身，倒计时 `2h`（调试 ÷60）；
 * - **离线保护**：核心条满时玩家离线 ⇒ 倒计时**自上线那一刻起算**；离线**满 24h** 即视为保护失效
 *   （Q3：从离线满 24h 那一刻起算 ⇒ 上线时若已过期，旗舰已被章鱼人摧毁）；
 * - 调试模式**关掉离线保护**（Q7）。
 */
export function weekendFlagshipView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
  lastSeenWallMs: number,
): WeekendFlagshipView {
  if (ev.flagshipDown) return { shown: true, atWallMs: ev.flagshipAtWallMs, down: ev.flagshipDown }
  const full = weekendCoreProgressAt(state, ev, nowWallMs) >= 1
  if (!full) return { shown: false }
  const deadline = weekendDeadlineMs(state)
  const offline = Math.max(0, nowWallMs - lastSeenWallMs)
  /**
   * **倒计时起算点 anchor**——**只在"首次满分且玩家在线"那一拍落盘**（`flagshipAtWallMs`），落盘后不再变：
   * - 已落盘 ⇒ 直接用它；
   * - 未落盘 ＋ 调试模式 ⇒ 此刻（**Q7：关掉离线保护**）；
   * - 未落盘 ＋ 离线 ≤60 秒（视为在线，tick 会落盘）⇒ 此刻；
   * - 未落盘 ＋ 离线 ≤24h（**离线保护**，第 10 条）⇒ **上线第一拍**起算；
   * - 未落盘 ＋ 离线 >24h（**Q3**）⇒ **自"离线满 24h"那一刻**起算 ⇒ 上线时若已过期，旗舰已被章鱼人摧毁。
   */
  let anchor = ev.flagshipAtWallMs
  if (anchor === undefined) {
    if (weekendDebugOn(state) || offline <= 60_000 || offline <= WEEKEND_OFFLINE_SHIELD_MS) anchor = nowWallMs
    else anchor = lastSeenWallMs + WEEKEND_OFFLINE_SHIELD_MS
  }
  const deadlineWallMs = anchor + deadline
  const down = nowWallMs >= deadlineWallMs ? ('octopus' as const) : undefined
  return { shown: true, atWallMs: anchor, deadlineWallMs, ...(down !== undefined ? { down } : {}) }
}

/* ─────────────── 贡献台账与结算 ─────────────── */

/** 记一笔玩家推进（主动胜利 / 击退遇袭 / 离线击退） */
export function weekendNoteContribution(ev: WeekendEventState, galaxyId: string, gain: number): void {
  ev.contributed[galaxyId] = clamp01((ev.contributed[galaxyId] ?? 0) + gain)
}

/** 玩家累计投入的进度合计（贡献占比的分子） */
export function weekendPlayerContribution(ev: WeekendEventState): number {
  return Object.values(ev.contributed).reduce((a, b) => a + b, 0)
}

/**
 * **贡献占比** = 玩家累计投入 ÷（玩家投入 ＋ NPC 铺底总量）。
 * NPC 铺底总量按"结算时刻各占领区的铺底之和"计 ⇒ 抢得越多、占比越高（第 11 条）。
 */
export function weekendContributionShareAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const ids = weekendOccupiedIds(ev)
  const npc = ids.reduce((sum, id) => {
    const p = weekendProgressAt(state, ev, id, nowWallMs)
    const put = ev.contributed[id] ?? 0
    return sum + Math.max(0, p - put)
  }, 0)
  const mine = weekendPlayerContribution(ev)
  const total = npc + mine
  return total <= 0 ? 0 : clamp01(mine / total)
}

/** 贡献奖档位（Q5 四档） */
export function weekendContributionTier(share: number): { tier: 'A' | 'B' | 'C' | 'D' | 'none'; wreck: number; isk: number } {
  if (share >= 0.8) return { tier: 'A', wreck: 12, isk: 8_000_000 }
  if (share >= 0.5) return { tier: 'B', wreck: 8, isk: 5_000_000 }
  if (share >= 0.2) return { tier: 'C', wreck: 4, isk: 2_000_000 }
  if (share > 0) return { tier: 'D', wreck: 1, isk: 0 }
  return { tier: 'none', wreck: 0, isk: 0 }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ─────────────── 开局 / 结束（幂等；下一步接引擎 tick 与派生卡） ─────────────── */

/**
 * **确保当前时刻有一场该有的入侵**（幂等）：
 * - 正常模式：窗口（周五 20:00 ~ +74h）内若 `startedAtWallMs` 不是本周 T0 ⇒ 开新一场（编号 +1）；
 * - 调试模式：上一场结束 + 1h 后刷新（无历史 ⇒ 首次调用即开）；
 * - 返回是否发生了变化（供调用方决定是否落盘/记日志）。
 */
export function ensureWeekendEvent(state: GameState, ctx: SimContext, nowWallMs: number): boolean {
  // 船长 2026-09-23：「目前入侵只有调试模式可见」⇒ 非调试模式不开局（也不结束、不推进）
  if (WEEKEND_DEBUG_ONLY && !weekendDebugOn(state)) return false
  const ev = state.weekendEvent
  if (weekendDebugOn(state)) {
    if (ev && ev.endedAtWallMs === undefined) return false
    if (ev && nowWallMs - ev.endedAtWallMs! < WEEKEND_DEBUG_RESTART_MS) return false
    const seq = (ev?.seq ?? 0) + 1
    const rolled = weekendRollOccupation(state, ctx, seq)
    if (!rolled) return false
    state.weekendEvent = { seq, startedAtWallMs: nowWallMs, ...rolled, contributed: {} }
    return true
  }
  const t0 = weekendT0Of(nowWallMs)
  if (!weekendWindowOpen(nowWallMs, t0)) return false // 窗口外：入侵不存在
  if (ev && ev.startedAtWallMs === t0 && ev.endedAtWallMs === undefined) return false
  const seq = (ev?.seq ?? 0) + 1
  const rolled = weekendRollOccupation(state, ctx, seq)
  if (!rolled) return false
  state.weekendEvent = { seq, startedAtWallMs: t0, ...rolled, contributed: {} }
  return true
}

/** 结束本场（旗舰被摧毁 / 章鱼人摧毁 / T0+74h）：清占领、留编号与台账（结算由调用方做） */
export function endWeekendEvent(state: GameState, nowWallMs: number): WeekendEventState | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return ev
  ev.endedAtWallMs = nowWallMs
  return ev
}

/* ─────────────── 引擎 tick（M1-b：只做必须落盘的事） ─────────────── */

/** tick 结果：引擎据它记日志/弹卡/掷遇袭骰 */
export interface WeekendTickResult {
  /** 本次 tick 是否新开了一场 */
  started: boolean
  /** 旗舰是否已现身 */
  flagshipShown: boolean
  /** 旗舰结局（本 tick 新发生） */
  flagshipDown?: 'player' | 'octopus'
  /** 本 tick 是否结束（旗舰被摧毁 / 章鱼人得手 / 窗口到点） */
  ended: boolean
  /** 该掷遇袭骰的星系（未夺回）与各自概率 —— **掷骰在引擎**（随机源在那边） */
  encounterRolls: Array<{ galaxyId: string; chance: number }>
}

/**
 * **引擎每拍调用一次**（M1-b）：
 * 1. `ensureWeekendEvent` 开局面（**仅调试模式**，见 `WEEKEND_DEBUG_ONLY`）；
 * 2. 旗舰 anchor **落盘**（首次满分且在线那一拍 ⇒ 倒计时从此稳定，不再随 tick 漂移）；
 * 3. 章鱼人得手（`view.down === octopus`）⇒ 写 `flagshipDown` 并结束本场；
 * 4. 正常模式的窗口到点（T0+74h）⇒ 结束本场；
 * 5. 交出"该掷遇袭骰的星系与概率"（**不在本函数里掷**：随机源归引擎）。
 *
 * ⚠ 纯函数（除改 `state.weekendEvent` 的落盘字段外不碰别处）⇒ 用例可对任意时刻断言。
 */
export function weekendTick(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
  lastSeenWallMs: number,
): WeekendTickResult {
  const started = ensureWeekendEvent(state, ctx, nowWallMs)
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return { started, flagshipShown: false, ended: false, encounterRolls: [] }

  // ② 旗舰 anchor 落盘（只在"未落盘 + 未过期"时写）
  const view = weekendFlagshipView(state, ev, nowWallMs, lastSeenWallMs)
  if (view.shown && ev.flagshipAtWallMs === undefined && view.down === undefined) ev.flagshipAtWallMs = view.atWallMs ?? nowWallMs

  // ③ 章鱼人得手 ⇒ 结束本场（黑匣归零，贡献奖照给——结算由调用方做）
  let ended = false
  let flagshipDown: WeekendTickResult['flagshipDown']
  if (view.down === 'octopus' && ev.flagshipDown === undefined) {
    ev.flagshipDown = 'octopus'
    flagshipDown = 'octopus'
    endWeekendEvent(state, nowWallMs)
    ended = true
  }

  // ④ 正常模式窗口到点（调试模式不定长，不按窗口收）
  if (!ended && !weekendDebugOn(state) && nowWallMs >= ev.startedAtWallMs + WEEKEND_WINDOW_MS) {
    endWeekendEvent(state, nowWallMs)
    ended = true
  }

  // ⑤ 交出遇袭候选（未夺回的占领区）
  const encounterRolls = weekendOccupiedIds(ev)
    .map((id) => ({ galaxyId: id, chance: weekendEncounterChanceAt(state, ev, id, nowWallMs) }))
    .filter((x) => x.chance > 0)

  return { started, flagshipShown: view.shown, ...(flagshipDown !== undefined ? { flagshipDown } : {}), ended, encounterRolls }
}

/** 主动打赢一场：外围 +10% · 核心 +5%（第 6 条；核心同样受门禁约束，门禁在读数侧生效） */
export function weekendNotePlayerWin(state: GameState, galaxyId: string): void {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return
  const gain = galaxyId === ev.coreId ? WEEKEND_GAIN_CORE_WIN : WEEKEND_GAIN_PERIPHERY_WIN
  if (galaxyId === ev.coreId || ev.peripheryIds.includes(galaxyId)) weekendNoteContribution(ev, galaxyId, gain)
}

/** 击退一次遇袭：+3%（离线自动结算的 +1% 由调用方传 `offline = true`） */
export function weekendNoteRepel(state: GameState, galaxyId: string, offline = false): void {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return
  weekendNoteContribution(ev, galaxyId, offline ? WEEKEND_GAIN_OFFLINE_REPEL : WEEKEND_GAIN_REPEL)
}

/** 玩家击毁旗舰：记结局并结束本场（黑匣与贡献奖由调用方结算） */
export function weekendNoteFlagshipKilled(state: GameState, nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  if (weekendCoreProgressAt(state, ev, nowWallMs) < 1) return false
  ev.flagshipDown = 'player'
  endWeekendEvent(state, nowWallMs)
  return true
}

/** 活动总时长（正常 = 74h；调试模式按 NPC 压缩口径无固定上限，取 74h÷60 供测试参考） */
export function weekendWindowMsOf(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? Math.round(WEEKEND_WINDOW_MS / WEEKEND_DEBUG_TIME_DIVISOR) : WEEKEND_WINDOW_MS
}
