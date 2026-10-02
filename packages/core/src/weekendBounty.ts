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
  weekendFoeFleetNameOf,
  weekendFoeCardsSelfPriced,
  weekendDrawFoeCardId,
  weekendGarrisonFoeCardId,
  weekendOccupiedIds,
} from './weekendEvent'
import { weekendAmbushSpecOf } from './weekendBattle'
import type { WeekendBattleSpec } from './weekendBattle'

/**
 * **2026-10-02 破环搬家**：`WEEKEND_CARD_PREFIX` / `weekendOccupiedLiveAt` 原定义搬进 `weekendEvent.ts`
 * （它们只读 `state.weekendEvent`，是活动态读数；weekendEvent 不 import 本件与 weekendBattle ⇒
 * weekendBattle 改从那边读后，`weekendBattle ↔ weekendBounty` 的运行期边清零）。这里**原样再导出**
 * 保持 encounters / expedition / index 的既有引用不动。
 */
export { WEEKEND_CARD_PREFIX, weekendOccupiedLiveAt } from './weekendEvent'
import { weekendOccupiedLiveAt } from './weekendEvent'

/** 外围入侵舰队的赏金倍率（数值表：奖励 = 该星系原卡 ×1.4） */
export const WEEKEND_BOUNTY_REWARD_MUL = 1.4

/**
 * **（已作废）曾有一条「收复星系的常驻悬赏押后到活动结束」的判据 —— 2026-09-28 船长令撤销。**
 *
 * 沿革：**船长 2026-09-25 令**「入侵期间，被占领星系的所有被收复的星系的常驻悬赏依旧处于隐藏状态，
 * 要等到入侵活动结束」⇒ 当时加了 `weekendStandingBountyHeldAt`，界面侧据此整区藏起悬赏卡。
 * **2026-09-28 船长令**：「**入侵期间，赏金任务照常发放（只有势力活跃关闭）。**」
 * ⇒ 该判据连同界面那两处调用、状态占位文案（`ui.weekend.100`）与相应用例**一并删除**：
 * 收复后照常列常驻悬赏，**入侵期间关掉的只有「敌对派系活跃」**（`sideTasks.factionSuppressedByInvasion`，那条不变）。
 *
 * ⚠ 与本函数无关的两件事**照旧**（船长只说了"赏金任务照常发放"）：
 * - **仍被占**的星系照旧由**入侵舰队卡**替换（`weekendBountyCardsOf`，2026-09-23 设计口径）；
 * - 入侵舰队卡**不给赏金**（收入按进度在结算时发，2026-09-25 口径）。
 */

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
    name: weekendFoeFleetNameOf(family, card.name),
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
    name: weekendFoeFleetNameOf(family, drawn.name),
    rewardIsk: 0,
  }
}

/**
 * **某星系当前该显示的悬赏卡**（引擎/界面的唯一取数口）：
 * - 不在占领区（或已夺回 / 活动结束）⇒ **原卡原样**
 *   （⚠ 2026-09-28 船长令后"已夺回"这一支**界面也照常列**——那条押后判据已删，见 `weekendOccupiedLiveAt` 上方注。
 *   本函数只管"取哪张卡"，遇袭敌群池与残骸打捞池都读它 ⇒ 不在这里清空）；
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
 * **板面行去重**（**2026-09-25 船长裁决「甲」**：「同一被占星系只出一条，不分族」）。
 *
 * 起因（船长真档实测 · 2026-09-25）：悬赏替换是**按槽位逐个**做的（`weekendBountyCardsOf` 就是
 * `cards.map(...)`），而 H 族改判成"每星系抽一支驻留舰队"后，**同一星系的多个槽位换出来的是同一张卡**
 * —— 红环航道（2 个槽位）在常驻悬赏页面上出现**两条一模一样**的「击退入侵舰队」，两条指向同一场战斗。
 *
 * 口径：**只给"板面 / 星图列表"这一层**去重（同一星系的多条**同一张**入侵卡只留第一条）；
 * - **不动** `weekendBountyCardsOf` 的"同序整池"契约 —— 遇袭敌群池、残骸打捞池、冷却判据照旧读整池；
 * - **只对被占（活的）星系生效**：非占领区的原卡一行都不动（同星系两张不同原卡照旧各列一行）；
 * - A/C/G 三族的派生卡**保留各自原卡 id**（`weekendDerivedCardOf`）⇒ 天然各不相同，本函数不会误删。
 */
export function weekendBoardRowsOf<T extends { id: string; galaxyId: string }>(
  rows: readonly T[],
  /** 该星系此刻是否"活的占领区"（调用方传 `weekendOccupiedLiveAt` 绑定 now 的闭包） */
  isOccupiedLive: (galaxyId: string) => boolean,
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (isOccupiedLive(row.galaxyId)) {
      const key = `${row.galaxyId}|${row.id}`
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(row)
  }
  return out
}

/**
 * **出发那一场的归属星系**（**2026-09-25 修"串星系"**；船长真档实测）。
 *
 * 起因（玩家报障「打红环的常驻悬赏，不加红环的进度条」）：H 族是"每星系抽一支驻留舰队"，
 * 而抽签只在**本族那几张独立卡**里抽 ⇒ **多个被占星系会抽到同一张卡**（真档：深渊之门/暗星坟场/
 * 红环航道三处都是 `ink-raid`）。原来的出发路径是**按卡 id 反查星系**（`anomalies.find(a => a.id === id)`）
 * ⇒ 永远命中**列表里第一个**同 id 行：真档读数 = 点深渊之门或暗星坟场的行，`foeGalaxyId` 都被写成
 * **红环航道** ⇒ 威胁覆写/进度记账/残骸注入/结算星系名**全部串到那一处**（玩家那边若"第一个"恰是核心，
 * 点红环就一分进度都不给 —— 正是报障原文）。
 *
 * 口径：**以"界面上那一行的星系"为准**（`hintGalaxyId`）——那一行确实是活的占领区就采信它；
 * 否则逐字回落卡面自带星系（结算/打捞/遭遇这些**没有界面行**的老路径零变化）。
 */
export function weekendLaunchGalaxyOf(
  state: GameState,
  /** 界面上被点的那一行的星系（没有就传 undefined ⇒ 老路径） */
  hintGalaxyId: string | undefined,
  /** 卡面自带星系（= 老口径的反查结果） */
  cardGalaxyId: string | undefined,
  nowWallMs: number,
): string | undefined {
  if (hintGalaxyId !== undefined && hintGalaxyId.length > 0 && weekendOccupiedLiveAt(state, hintGalaxyId, nowWallMs)) {
    return hintGalaxyId
  }
  return cardGalaxyId
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

/**
 * **该星系"这一场"会抽到哪张卡** —— 主动出击抽签的**唯一落点**（纯函数；**不做占领校验**，调用方各自校验）。
 *
 * 盐 = `WEEKEND_ASSAULT_SALT_BASE + assaultDraws`（每出击一次换一支、随档、不消费主随机序列）。
 * 单独抽出来是因为**界面也要用同一把尺**：`weekendAssaultDrawOf`（出发那一刻）与
 * `weekendFoeCardIdToFightOf`（界面判"能不能点"）必须得到**同一张卡**，否则冷却判据会不同源。
 */
export function weekendAssaultCardIdOfDrawnAt(state: GameState, galaxyId: string): string | null {
  const ev = state.weekendEvent
  if (!ev) return null
  const isCore = galaxyId === ev.coreId
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  const salt = WEEKEND_ASSAULT_SALT_BASE + Math.max(0, Math.floor(ev.assaultDraws ?? 0))
  return weekendDrawFoeCardId(ev.family, isCore, ev.seq, idx, salt)
}

/**
 * **界面上那一行「点下去会打哪张卡」**（**判据单点 · 2026-10-02 甲案 · 船长令「按你推荐」**）。
 *
 * 为什么必须有它：界面上那一行显示的是**驻留卡**（`weekendBountyCardsOf` 换出来的，抽签盐 0、
 * 一场入侵内固定），而**出发那一刻**引擎会 `weekendAssaultDrawOf` **当场重抽**（盐 10000 ＋ 次数）
 * ⇒ 两张 id 不同；而 T8 冷却（`state.bountyCooldowns`）是**按卡 id** 记的。
 * 若界面拿**板面卡**去判冷却 ⇒ 出现两种错：**该拒没拒**（按钮亮着、点下去才被告知"重抽到的那张冷却中"）
 * 与**该放没放**（按钮灰着、其实这一场会抽到另一张没冷却的卡）。本函数把界面拉到与引擎同源。
 *
 * ⚠ 非占领区 / 活动已结束 / 星系解析不出（常驻悬赏那类**没有重抽**的行）⇒ **原样返回**
 * `displayedCardId`（老路径逐字零变化）。
 *
 * @param displayedCardId 界面上那一行的卡 id（= 驻留卡/原卡 id）
 * @param displayedGalaxyId 那一行的星系（→ `foeGalaxyId`；被占且活的才采信）
 */
export function weekendFoeCardIdToFightOf(
  state: GameState,
  displayedCardId: string,
  displayedGalaxyId: string | undefined,
  nowWallMs: number = Date.now(),
): string {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return displayedCardId
  /** 星系解析口径与 `engine.startExpeditionAt` 的 `foeGalaxyOf` 同源（界面上那一行的星系优先） */
  const galaxyId = weekendLaunchGalaxyOf(state, displayedGalaxyId, displayedGalaxyId, nowWallMs)
  if (galaxyId === undefined || !weekendOccupiedLiveAt(state, galaxyId, nowWallMs)) return displayedCardId
  return weekendAssaultCardIdOfDrawnAt(state, galaxyId) ?? displayedCardId
}

export function weekendAssaultDrawOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendAssaultDispatch | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (!weekendOccupiedLiveAt(state, galaxyId, nowWallMs)) return null
  /** 卡 id 走**单点**（与界面判"能不能点"用的是同一把尺） */
  const cardId = weekendAssaultCardIdOfDrawnAt(state, galaxyId)
  if (cardId === null) return null
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
