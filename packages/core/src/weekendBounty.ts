/**
 * **周末入侵 · 悬赏替换与遇袭判定**（M1-b 第三片；2026-09-23/24 船长令「继续」）。
 *
 * 两件事收口在这里，引擎/界面只需换调用点：
 * 1. **被占星系的悬赏替换**：`weekendBountyCardsOf` —— 被占 ⇒ 返回**入侵舰队卡**（H 族 = 抽签抽到的
 *    **独立卡**（真实 id，覆写星系/名字/奖励）；A/C/G 三族 = **原卡派生**（只覆盖名字/威胁/奖励，**不改数据表**）；
 *    夺回或活动结束 ⇒ 原样返回原卡；
 * 2. **遇袭判定**：`weekendEncounterRollOf` —— 传一个 [0,1) 的掷骰值，命中就返回**伏击 spec**
 *    （单舰 · 每场从该区域池里重抽 · **强度 ×0.75**，见 `weekendEvent.WEEKEND_AMBUSH_STRENGTH_MUL`）；
 *    安全等级**破例**：占领区里**中安/高安一样会遇袭**（设计稿口径定稿 #4），这条判据由
 *    `weekendEncounterAllowedIn` 单点给出。
 *
 * ⚠ 派生卡**不进** `completedBounties` 台账（首胜台账只认原卡 id）⇒ 派生的 id 统一加前缀
 * `wk-`，界面/引擎拿到的派生卡天然与原卡区分开。
 */
import type { AnomalyDef, SimContext } from './types'
import type { GameState } from './state'
import {
  WEEKEND_CORE_THREAT,
  WEEKEND_PERIPHERY_THREAT,
  weekendEncounterChanceAt,
  weekendFoeCardsSelfPriced,
  weekendDrawFoeCardId,
  weekendGarrisonFoeCardId,
  weekendOccupiedIds,
  weekendProgressAt,
} from './weekendEvent'
import { weekendAmbushSpecOf } from './weekendBattle'
import type { WeekendBattleSpec } from './weekendBattle'

/** 派生卡 id 前缀（与原卡区分；**永不写入首胜台账**） */
export const WEEKEND_CARD_PREFIX = 'wk-'
/** 外围入侵舰队的赏金倍率（数值表：奖励 = 该星系原卡 ×1.4） */
export const WEEKEND_BOUNTY_REWARD_MUL = 1.4

/** 该星系当前是否处于占领区（核心或外围）且**尚未夺回** */
export function weekendOccupiedLiveAt(state: GameState, galaxyId: string, nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return false
  return weekendProgressAt(state, ev, galaxyId, nowWallMs) < 1
}

/**
 * **该星系的常驻悬赏是否"押后到活动结束"**（**船长 2026-09-25 令**：「**入侵期间，被占领星系的
 * 所有被收复的星系的常驻悬赏依旧处于隐藏状态，要等到入侵活动结束。**」）。
 *
 * 判据 = 活动**未结束** ＋ 该星系 ∈ 占领集（核心或外围）＋ **已被夺回**（进度 ≥ 1）。
 *
 * ⚠ **只管"板面/详细页列不列"这一层**，**不动** `weekendBountyCardsOf` 那份取数：
 * - `weekendBountyCardsOf` 仍按设计稿给"夺回 ⇒ 原卡"（遇袭敌群池、残骸打捞取卡池都读它）——
 *   若在那一层清空，会把打捞池也一起清掉（收复后的星系就不能打捞了）；
 * - 仍被占的星系**不归本判据管**：那一边照旧由入侵舰队卡替换（既有口径不变）。
 *
 * ⚠ **与旧设计稿的冲突已由船长裁决**（`docs/design/weekend-invasion.md` 2026-09-25 改判那两行）：
 * 旧口径「夺回 ⇒ 悬赏恢复」作废一轮，改成"收复后仍隐藏到活动结束"。
 */
export function weekendStandingBountyHeldAt(
  state: GameState,
  galaxyId: string,
  nowWallMs: number,
): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return false
  return weekendProgressAt(state, ev, galaxyId, nowWallMs) >= 1
}

/**
 * **遇袭是否允许**（设计稿口径定稿 #4：被占星系**一律高频遇袭**，**中安、高安都破例**）。
 * ⇒ 判据只有"是不是活的占领区"，**不看安全等级**（与常驻遭遇系统的"只低安"是两套）。
 */
export function weekendEncounterAllowedIn(state: GameState, galaxyId: string, nowWallMs: number): boolean {
  return weekendOccupiedLiveAt(state, galaxyId, nowWallMs)
}

/**
 * 把一张**原卡**派生成入侵舰队卡（**只覆盖 id / 名字 / 威胁 / 奖励**；其余字段原样）——
 * ⚠ 这是 **A/C/G 三族的占位口径**（"暂用虫洞卡"）：它们还没有独立入侵卡，只能拿该星系原卡换名字/威胁。
 * H 族走 `weekendIndependentFoeOf`（换成自家独立卡）。
 *
 * ⚠ **2026-09-25 船长令「入侵舰队不应该有赏金」** ⇒ 派生卡的 `rewardIsk` 一律 **0**（原本是原卡 ×1.4）；
 * 界面在赏金那一栏改显「赏金：结算时按进度发放」（`ui.weekend.096`）。
 */
export function weekendDerivedCardOf(
  card: AnomalyDef,
  family: string,
  opts?: { threat?: number; isCore?: boolean },
): AnomalyDef {
  // 核心用 120、外围 78（Q1 裁定后的绝对值；opts.threat 显式给值时优先）
  const threat = opts?.threat ?? (opts?.isCore ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT)
  return {
    ...card,
    // ⚠ **保留原卡 id**（2026-09-23 船长报障后改）：出发/开战/情报各路径都按 `ctx.anomalies.get(id)` 取卡，
    //   改了 id 就会被判成「未知目标」；入侵的差异只体现在名字/威胁/奖励上，威胁由开战入口用覆写口传。
    id: card.id,
    name: `${family} 族舰队 · ${card.name}`,
    threat,
    rewardIsk: 0,
  }
}

/**
 * **H 族：把该星系的悬赏位换成"驻留"的那支独立入侵舰队**（船长 2026-09-25：
 * 「外围玩家主动出击和被动遇袭都是**从骚扰和袭击舰队中抽取**。核心区，则是抽取袭击和主力舰队。」）。
 *
 * - 卡 = 抽签结果（`weekendGarrisonFoeCardId`）**用真实 id** ⇒ 开战能按 id 解析到卡；
 * - **`galaxyId` 覆写成被占星系**：H 独立卡自带母港星系（`galaxy-hub`），不覆写会串残骸密度与归属；
 * - 奖励 = **0**（船长同日令「**入侵舰队不应该有赏金**」；收入改在活动结束时按进度结算）；
 * - 威胁 = **卡面自身**（独立卡已按定价式落值）；
 * - 名字 = 「<族>舰队 · <卡名>」。
 */
function weekendIndependentFoeOf(base: AnomalyDef, drawn: AnomalyDef, family: string, galaxyId: string): AnomalyDef {
  void base // 原卡只作"这一槽原本是谁"的上下文（赏金取消后不再参与定价）
  return {
    ...drawn,
    galaxyId,
    name: `${family} 族舰队 · ${drawn.name}`,
    rewardIsk: 0,
  }
}

/**
 * **某星系当前该显示的悬赏卡**（引擎/界面的唯一取数口）：
 * - 不在占领区（或已夺回 / 活动结束）⇒ **原卡原样**；
 *   ⚠ 已夺回的那些**在界面上仍被押后到活动结束**（`weekendStandingBountyHeldAt` 单点判据；本函数
 *   只管"取哪张卡"，遇袭敌群池与残骸打捞池都读它 ⇒ 不在这里清空）；
 * - 在占领区 ⇒ **换成入侵舰队**：H 族 = 抽到的那张**独立卡**（真实 id · 覆写星系/名字）；
 *   A/C/G 三族 = 该星系**原卡的派生版**（占位口径，只换族名/威胁 78·120）；
 *   ⚠ 两条路的**赏金都是 0**（船长 2026-09-25「入侵舰队不应该有赏金」；界面改显「结算时按进度发放」）。
 * `cards` 传"该星系原本的可见悬赏"（可见性规则仍归调用方），返回同序的替换结果。
 */
export function weekendBountyCardsOf(
  state: GameState,
  ctx: SimContext,
  cards: readonly AnomalyDef[],
  galaxyId: string,
  nowWallMs: number,
): readonly AnomalyDef[] {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return cards
  if (!weekendOccupiedLiveAt(state, galaxyId, nowWallMs)) return cards
  const isCore = galaxyId === ev.coreId
  if (weekendFoeCardsSelfPriced(ev.family)) {
    const drawn = ctx.anomalies.get(weekendGarrisonFoeCardId(state, ev, galaxyId))
    if (drawn) {
      return cards.map((c) => weekendIndependentFoeOf(c, drawn, ev.family, galaxyId))
    }
  }
  return cards.map((c) => weekendDerivedCardOf(c, ev.family, { isCore }))
}

/**
 * **主动出击"每场重抽"**（2026-09-25 船长令：「**主动出击也要每场重抽**」）：
 * 出发那一刻从该区域池里**重新抽一支**（与"驻留卡/板面显示"解耦），并给出**奖励基底**。
 *
 * 三条口径：
 * 1. **每场一支**：抽签盐 = `WEEKEND_ASSAULT_SALT_BASE + 本场已出发次数`（`ev.assaultDraws` 随档）——
 *    每按一次出击就换一次盐 ⇒ 遇袭那样"每场重抽"，且**不消费主随机序列**；
 * 2. **价钱**（**2026-09-25 退役**）：原口径 = 该星系原卡 × `WEEKEND_BOUNTY_REWARD_MUL`（1.4），
 *    写进 `expedition.rewardIskOverride`；船长同日令「**入侵舰队不应该有赏金**」后，**入侵场次一律不发**
 *    （`expedition.resolveBattleOutcome` 里按 `weekendBattleInvolvedOf` 直接走 0 分支）。
 *    本字段与那条覆写口**保留不删**（老档形态不变）；它如今的唯一用处 = "入侵刚结束、这一场已不算入侵"
 *    的边角情形仍按原卡价钱结算；
 * 3. **只对活的占领区**成立；非占领区 / 活动已结束 ⇒ `null`（调用方按原卡照旧走）。
 */
export interface WeekendAssaultDispatch {
  /** 这一场遇到的入侵舰队卡（真实 id；H 族 = 独立卡，A/C/G = 该星系原卡派生 id） */
  cardId: string
  /** 奖励基底（该星系原卡 × 1.4；**已退役** —— 入侵场次不再发放，见上面的口径 2） */
  rewardIsk: number
}

/** 主动出击抽签盐的基数（与"驻留卡"的 0、遇袭的"时间档"错开，纯为可读性） */
export const WEEKEND_ASSAULT_SALT_BASE = 10_000

export function weekendAssaultDrawOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendAssaultDispatch | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (!weekendOccupiedLiveAt(state, galaxyId, nowWallMs)) return null
  const isCore = galaxyId === ev.coreId
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  const salt = WEEKEND_ASSAULT_SALT_BASE + Math.max(0, Math.floor(ev.assaultDraws ?? 0))
  const cardId = weekendDrawFoeCardId(ev.family, isCore, ev.seq, idx, salt)
  const drawn = ctx.anomalies.get(cardId)
  /** 该星系**原卡**（用于钉住奖励；非 H 族时抽签结果就是它的 id ⇒ 奖励口径与老路径一致） */
  const base = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId === galaxyId)
  const rewardIsk =
    base !== undefined
      ? Math.max(1, Math.round((base.rewardIsk ?? 0) * WEEKEND_BOUNTY_REWARD_MUL))
      : Math.max(1, Math.round(drawn?.rewardIsk ?? 1))
  return { cardId, rewardIsk }
}

/** 记一次"已出发"（出击成功后才调）⇒ 下一场换一支 */
export function weekendNoteAssaultDispatch(state: GameState): void {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return
  ev.assaultDraws = Math.max(0, Math.floor(ev.assaultDraws ?? 0)) + 1
}

/**
 * **遇袭掷骰**（引擎把掷骰值传进来 ⇒ 本函数保持纯函数、可测）：
 * 命中返回**伏击 spec**（单舰 · 威胁 ×0.5），否则 undefined。
 * ⚠ 冷却/节流（5 分钟区域冷却、单遭遇不叠）由引擎侧按既有遭遇系统管；这里只管"该不该出、出什么"。
 */
export function weekendEncounterRollOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  roll: number,
  nowWallMs: number,
): WeekendBattleSpec | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return undefined
  if (!weekendEncounterAllowedIn(state, galaxyId, nowWallMs)) return undefined
  const chance = weekendEncounterChanceAt(state, ev, galaxyId, nowWallMs)
  if (chance <= 0 || roll >= chance) return undefined
  return weekendAmbushSpecOf(state, ctx, galaxyId, nowWallMs) ?? undefined
}
