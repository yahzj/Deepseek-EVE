/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import type { WeekendEventState, WeekendAmbushPick } from './model'
import { weekendDebugOn, weekendNpcTimelineMs } from './time'
import { WEEKEND_DEBUG_WIN_GAIN, WEEKEND_GAIN_CORE_WIN, WEEKEND_GAIN_PERIPHERY_WIN, weekendOccupiedIds, WEEKEND_AMBUSH_STRENGTH_MUL, WEEKEND_NPC_PERIPHERY_MS, clamp01, WEEKEND_NPC_CORE_MS, WEEKEND_ENCOUNTER_CAP, WEEKEND_ENCOUNTER_P, WEEKEND_CORE_THREAT, WEEKEND_PERIPHERY_THREAT } from './constants'
import type { SimContext } from '../../types'
import { weekendDrawFoeCardId, weekendFoeCardsSelfPriced } from './family'
import { foeThreatOfAnomaly, applyFoeOverride } from '../../combat'
import { FOE_DESIGN_STRENGTH_MUL } from '../../wormholeFoes'

/** 主动胜利的推进量：调试模式 = `WEEKEND_DEBUG_WIN_GAIN`；正常 = 外围 5% / 核心 5% */
export function weekendWinGainOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
): number {
  if (weekendDebugOn(state)) return WEEKEND_DEBUG_WIN_GAIN
  return galaxyId === ev.coreId ? WEEKEND_GAIN_CORE_WIN : WEEKEND_GAIN_PERIPHERY_WIN
}

/**
 * **遇袭取卡**（船长 2026-09-25：遇袭**每场从池里重抽** ＋ 强度 ×`WEEKEND_AMBUSH_STRENGTH_MUL`）。
 *
 * - 抽签：与"驻留"同一套哈希，但**盐取时刻档**（粒度 = `balance.encounter.zoneCooldownMs`，
 *   与区域冷却同粒度）⇒ 同一星系连续两次遇袭会抽到不同编成；
 * - 标签：H 族按**缩放后的实测建档价**反解（`combat.foeThreatOfAnomaly`）——
 *   敌属性是绝对值，只有这样才能保证"标签 = 战力"；A/C/G 三族仍按 78/120 × 倍率的占位口径。
 */
export function weekendAmbushPickOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendAmbushPick | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  // ⚠ 等价于 `weekendBounty.weekendZoneLiveAt`（那边 import 本文件 ⇒ 这里不能反向引，避免循环）
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  if (weekendProgressAt(state, ev, galaxyId, nowWallMs) >= 1) return null
  const isCore = galaxyId === ev.coreId
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  const bucketMs = Math.max(1, ctx.balance.encounter.zoneCooldownMs)
  const cardId = weekendDrawFoeCardId(ev.family, isCore, ev.seq, idx, Math.floor(nowWallMs / bucketMs) + 1)
  const mul = WEEKEND_AMBUSH_STRENGTH_MUL
  const card = ctx.anomalies.get(cardId)
  const threat =
    card && weekendFoeCardsSelfPriced(ev.family)
      ? foeThreatOfAnomaly(applyFoeOverride(card, { strengthMul: mul }), FOE_DESIGN_STRENGTH_MUL.solo, ctx.balance.battle)
      : Math.max(1, Math.round(weekendAssaultThreatOf(ev, galaxyId) * mul))
  return { cardId, strengthMul: mul, threat }
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

/**
 * **该星系此刻还能不能打入侵**（＝「活动未结束 且 它是本次入侵的核心或外围」）——**唯一判据**。
 *
 * 🔴 **2026-10-02 船长令改写**（原话：「我希望的是 **100% 后能够继续刷**，但是掉落残骸数量需要减半作为惩罚」）：
 * **删掉了"进度必须 < 1"那一句**。改前叫 `weekendZoneLiveAt`（"仍被占"），夺回那一刻起
 * 板面换卡 / 遇袭破例 / 主动出击 / 重复出击 / 星图那行**全部关闭** ⇒ 100% 之后只剩旗舰战可打。
 * 新口径：**夺回不再关门**，占领区一直可打**到活动结束**；代价见 `weekendWreckPenaltyFracOf`
 * （已夺回的星系继续打 ⇒ **残骸半量**，且不给任何其他奖励）。
 * ⚠ **遇袭概率公式不动**（`weekendEncounterChanceAt` 仍是 `60%×(1−进度)`）⇒ 100% 的星系不会被动挨打，
 * "继续刷"= 玩家**主动**去打（船长 2026-10-02 三答之甲）。
 * ⚠ 观感随之：100% 的星系照旧发光、进度条满格挂着，直到活动结束（同日三答之甲）。
 * ⚠ 名字一并改：语义已经不是"被占"（含已夺回）⇒ 叫 `weekendZoneLiveAt` 会撒谎。
 */
export function weekendZoneLiveAt(state: GameState, galaxyId: string, _nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  return galaxyId === ev.coreId || ev.peripheryIds.includes(galaxyId)
}

/**
 * **入侵战斗的残骸注入折扣**（＝船长说的"惩罚"）——**单点**，出征那条路读它。
 *
 * 口径（**2026-10-02 船长令**）：**该星系已夺回**（收复进度满）⇒ `0.5`（半量）；否则 `1.0`。
 * ⚠ 另两条路本来就是半量、**不读本函数**（各自的口径照旧）：
 *   · 遇袭 / 旗舰挑战走**遭遇**结算 ⇒ `salvage.WRECK_ENCOUNTER_INJECT_FRAC = 0.5`；
 *   · 于是"100% 之后"三种入口一律半量 —— 这正是船长要的"掉落残骸数量减半作为惩罚"。
 * ⚠ **不给任何其他奖励**（船长的另一半令）：不读本函数的地方也别顺手补钱 ——
 *   入侵卡赏金恒 0、进度台账 `clamp01`（满档不再涨、结算没有额外进度收入）、夺回奖一次性、声望只首胜。
 */
export function weekendWreckPenaltyFracOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  return weekendProgressAt(state, ev, galaxyId, nowWallMs) >= 1 ? 0.5 : 1
}

/**
 * **核心进度读数**（给界面：进度值 ＋ 是否正被门禁卡住 ＋ 还差几个外围）。
 *
 * 2026-09-26 船长令：「入侵活动中，被入侵的星系的星系详细内，在'击退入侵舰队'卡片处显示该星系的
 * **收复进度**。当核心星系无法收复时，在对应的击退入侵舰队卡片**提示玩家**」＋ 提示文案
 * 「**至少需要夺回一个外围星系**」。
 *
 * 为什么做成一个函数而不是让界面自己拼：**门禁的真相源只有一个**
 * （`weekendCoreProgressAt` 里那句 `weekendPeripheryClearedAt`）——界面若自己判断"外围清完没"，
 * 两处一旦漂移就会出现"条在涨却写着打不动"这种自相矛盾的读数。
 * `missing` 供界面把提示写准：一个都没夺回时说"至少需要夺回一个"，已夺回几个时说"还需夺回 N 个"。
 */
export function weekendCoreGateView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): { progress: number; gated: boolean; missing: number; total: number } {
  const total = ev.peripheryIds.length
  const missing = ev.peripheryIds.filter((id) => weekendPeripheryProgressAt(state, ev, id, nowWallMs) < 1).length
  return {
    progress: weekendCoreProgressAt(state, ev, nowWallMs),
    gated: !weekendPeripheryClearedAt(state, ev, nowWallMs),
    missing,
    total,
  }
}

/** 已夺回（进度满）的星系 */
export function weekendReclaimedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): string[] {
  return weekendOccupiedIds(ev).filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

/**
 * **外围推进领先的那一处**（**2026-09-25 船长批「乙」**）：外围里进度最高的一处 + 它的进度。
 *
 * 起因（船长真档实测 · 玩家报障「从常驻悬赏重复清缴不加进度条」）：活动栏那条只有
 * 「外围夺回 X/Y · 核心 Z% · 已夺回 N/M 处」三块读数——**前两块都是"满 100% 才 +1"的计数**、
 * 核心那格又被门禁锁死 ⇒ 玩家连清同一处时活动栏**一个会动的数都没有**
 * （实测：暗星坟场 23% → 33% → 43% → 53%，活动栏三块一动不动）。
 *
 * ⇒ 补一条**随单场胜利增长**的读数：外围里最高的那一处 + 它的百分比（名称由界面按 id 查）。
 * 全部夺回（每处都满）⇒ 返回 `null`（那时"外围夺回 X/Y"本身已经在报满了）。
 */
export function weekendPeripheryLeadOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): { galaxyId: string; progress: number } | null {
  let best: { galaxyId: string; progress: number } | null = null
  for (const id of ev.peripheryIds) {
    const progress = weekendProgressAt(state, ev, id, nowWallMs)
    if (progress >= 1) continue
    if (best === null || progress > best.progress) best = { galaxyId: id, progress }
  }
  return best
}

/**
 * **外围平均进度**（0~1；**2026-09-25 船长批「乙」的补正**）。
 *
 * 为什么还要一个"平均"：上面那条"最高"只在**清领先的那一处**时才会动 ——
 * 实测（`npm run weekend:board`）：红环已 74% 时连清暗星坟场 3 场（23% → 53%），
 * 活动栏那行"外围进度最高 74%（红环航道）"**一个数都没变**，玩家照样看不到反馈。
 * 平均值对"任何一处的前进"都响应（3 处外围时每场 +3.3%），与"最高"互补：一个证明在动、一个指明打到哪了。
 */
export function weekendPeripheryAverageOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  if (ev.peripheryIds.length === 0) return 0
  const sum = ev.peripheryIds.reduce((acc, id) => acc + weekendProgressAt(state, ev, id, nowWallMs), 0)
  return sum / ev.peripheryIds.length
}

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

/** 主动出击的威胁（被占星系的悬赏替换卡；外围 78 / 核心 120）——**A/C/G 三族的占位口径**，H 族用卡面威胁 */
export function weekendAssaultThreatOf(ev: WeekendEventState, galaxyId: string): number {
  return galaxyId === ev.coreId ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT
}
