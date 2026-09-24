/**
 * **周末入侵 · 悬赏替换与遇袭判定**（M1-b 第三片；2026-09-23/24 船长令「继续」）。
 *
 * 两件事收口在这里，引擎/界面只需换调用点：
 * 1. **被占星系的悬赏替换**：`weekendBountyCardsOf` —— 被占 ⇒ 返回**派生卡**（只覆盖
 *    id / 名字 / 威胁 / 奖励，**不改数据表**），夺回或活动结束 ⇒ 原样返回原卡；
 * 2. **遇袭判定**：`weekendEncounterRollOf` —— 传一个 [0,1) 的掷骰值，命中就返回**伏击 spec**
 *    （单舰 · 威胁 ×0.5 · 敌卡暂用虫洞族卡）；安全等级**破例**：占领区里**中安/高安一样会遇袭**
 *    （设计稿口径定稿 #4），这条判据由 `weekendEncounterAllowedIn` 单点给出。
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
 * **遇袭是否允许**（设计稿口径定稿 #4：被占星系**一律高频遇袭**，**中安、高安都破例**）。
 * ⇒ 判据只有"是不是活的占领区"，**不看安全等级**（与常驻遭遇系统的"只低安"是两套）。
 */
export function weekendEncounterAllowedIn(state: GameState, galaxyId: string, nowWallMs: number): boolean {
  return weekendOccupiedLiveAt(state, galaxyId, nowWallMs)
}

/** 把一张原卡派生成入侵舰队卡（**只覆盖 id / 名字 / 威胁 / 奖励**；其余字段原样） */
export function weekendDerivedCardOf(
  card: AnomalyDef,
  family: string,
  opts?: { threat?: number; rewardMul?: number; isCore?: boolean },
): AnomalyDef {
  // 核心用 120、外围 78（Q1 裁定后的绝对值；opts.threat 显式给值时优先）
  const threat = opts?.threat ?? (opts?.isCore ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT)
  const mul = opts?.rewardMul ?? WEEKEND_BOUNTY_REWARD_MUL
  return {
    ...card,
    // ⚠ **保留原卡 id**（2026-09-23 船长报障后改）：出发/开战/情报各路径都按 `ctx.anomalies.get(id)` 取卡，
    //   改了 id 就会被判成「未知目标」；入侵的差异只体现在名字/威胁/奖励上，威胁由开战入口用覆写口传。
    id: card.id,
    name: `${family} 族舰队 · ${card.name}`,
    threat,
    rewardIsk: Math.max(1, Math.round((card.rewardIsk ?? 0) * mul)),
  }
}

/**
 * **某星系当前该显示的悬赏卡**（引擎/界面的唯一取数口）：
 * - 不在占领区（或已夺回 / 活动结束）⇒ **原卡原样**；
 * - 在占领区 ⇒ **派生卡**（该星系全部可见悬赏都替换成入侵舰队；核心的威胁用 120，外围 78）。
 * `cards` 传"该星系原本的可见悬赏"（可见性规则仍归调用方），返回同序的替换结果。
 */
export function weekendBountyCardsOf(
  state: GameState,
  cards: readonly AnomalyDef[],
  galaxyId: string,
  nowWallMs: number,
): readonly AnomalyDef[] {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return cards
  if (!weekendOccupiedLiveAt(state, galaxyId, nowWallMs)) return cards
  const isCore = galaxyId === ev.coreId
  return cards.map((c) => weekendDerivedCardOf(c, ev.family, { isCore }))
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
  return weekendAmbushSpecOf(state, ctx, galaxyId) ?? undefined
}
