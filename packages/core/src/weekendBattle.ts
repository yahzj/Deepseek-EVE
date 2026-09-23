/**
 * **周末入侵 · 战斗与结算模块**（M1-b 第二片；船长 2026-09-23：「你继续做完成一个大模块再汇报」）。
 *
 * 这一片把"打什么、打赢了算什么、打完了发什么"全部收口在 core 的**纯函数**里，
 * 引擎/界面只做两件事：① 拿 spec 去开一场战斗（复用现有悬赏战 / 虫洞小队战入口）；
 * ② 把战斗结果（`WeekendOutcome`）交给 `weekendResolveBattle` 记账。
 *
 * 三条口径（都与设计稿一致）：
 * 1. **敌卡暂用虫洞族卡**（船长令）⇒ 卡 id 一律走 `weekendFoeCardOf`（唯一换卡点）；
 * 2. **外围/核心主动出击 = 单舰**（Q1 裁定）⇒ `squadSize = 1`；**只有旗舰是 4 波 4 艘小队战**（口径定稿 #8）；
 * 3. **伏击 = 主动 ×0.5**（Q2）⇒ 伏击 spec 走单舰 + 半威胁；**失败只受损**（第 5 条）⇒ `loss` 不改任何进度。
 */
import type { SimContext } from './types'
import type { GameState } from './state'
import {
  WEEKEND_CORE_THREAT,
  WEEKEND_PERIPHERY_THREAT,
  weekendAmbushThreatOf,
  weekendCoreProgressAt,
  weekendNoteContribution,
  weekendNoteFlagshipKilled,
  weekendOccupiedIds,
  weekendProgressAt,
  weekendContributionShareAt,
  weekendContributionTier,
  weekendFoeCardOf,
  WEEKEND_GAIN_CORE_WIN,
  WEEKEND_GAIN_OFFLINE_REPEL,
  WEEKEND_GAIN_PERIPHERY_WIN,
  WEEKEND_GAIN_REPEL,
} from './weekendEvent'
import type { WeekendEventState } from './weekendEvent'

/* ─────────────── 战斗规格 ─────────────── */

export type WeekendBattleKind = 'assault' | 'ambush' | 'flagship'

export interface WeekendBattleSpec {
  kind: WeekendBattleKind
  galaxyId: string
  /** 敌卡（**暂用该族虫洞卡**；换独立卡只改 `weekendFoeCardOf`） */
  cardId: string
  /** 威胁（主动：外围 78 / 核心 120；伏击：×0.5） */
  threat: number
  /** 波数：旗舰 4 波；其余 1 波 */
  waves: number
  /** 编队规模：旗舰 4 艘小队战；其余 1（单舰） */
  squadSize: number
  /** 赏金倍率：外围 ×1.4 · 旗舰 ×3 */
  rewardMul: number
  /** 展示名（玩家可见；「<族>舰队 · <卡名>」/「<族>旗舰」） */
  name: string
}

/** 夺回奖励（每处）与全清追加（数值表） */
export const WEEKEND_RECLAIM_WRECK = 8
export const WEEKEND_RECLAIM_ISK = 2_000_000
export const WEEKEND_ALL_CLEAR_ISK = 5_000_000
/** 旗舰奖励：必掉黑匣 ×1 ＋ 稀有残骸 ×3 · 赏金 ×3 */
export const WEEKEND_FLAGSHIP_WRECK = 3
export const WEEKEND_FLAGSHIP_REWARD_MUL = 3
/** 主动出击的赏金倍率（外围） */
export const WEEKEND_ASSAULT_REWARD_MUL = 1.4

function cardNameOf(ctx: SimContext, cardId: string): string {
  return ctx.anomalies.get(cardId)?.name ?? cardId
}

/** 主动出击某被占星系（外围单舰 78 / 核心单舰 120）；非占领区 ⇒ null */
export function weekendAssaultSpecOf(state: GameState, ctx: SimContext, galaxyId: string): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  const isCore = galaxyId === ev.coreId
  const cardId = weekendFoeCardOf(ev.family, isCore ? 'flagship' : 'assault')
  const card = cardNameOf(ctx, cardId)
  return {
    kind: 'assault',
    galaxyId,
    cardId,
    threat: isCore ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT,
    waves: 1,
    squadSize: 1,
    rewardMul: WEEKEND_ASSAULT_REWARD_MUL,
    name: `${ev.family} 族舰队 · ${card}`,
  }
}

/** 遇袭（伏击）：单舰 + **威胁 ×0.5**（Q2）· 同样只在占领区 */
export function weekendAmbushSpecOf(state: GameState, ctx: SimContext, galaxyId: string): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  const cardId = weekendFoeCardOf(ev.family, galaxyId === ev.coreId ? 'flagship' : 'assault')
  return {
    kind: 'ambush',
    galaxyId,
    cardId,
    threat: weekendAmbushThreatOf(ev, galaxyId),
    waves: 1,
    squadSize: 1,
    rewardMul: 1,
    name: `巡游小队 · ${cardNameOf(ctx, cardId)}`,
  }
}

/** 旗舰：核心条满才开（**4 波 · 4 艘小队战**）· 必掉黑匣 ×1 ＋ 稀有残骸 ×3 · 赏金 ×3 */
export function weekendFlagshipSpecOf(state: GameState, ctx: SimContext, nowWallMs: number): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (weekendCoreProgressAt(state, ev, nowWallMs) < 1) return null
  const cardId = weekendFoeCardOf(ev.family, 'flagship')
  return {
    kind: 'flagship',
    galaxyId: ev.coreId,
    cardId,
    threat: WEEKEND_CORE_THREAT,
    waves: 4,
    squadSize: 4,
    rewardMul: WEEKEND_FLAGSHIP_REWARD_MUL,
    name: `${ev.family} 族旗舰 · ${cardNameOf(ctx, cardId)}`,
  }
}

/* ─────────────── 战斗结果 → 记账与奖励 ─────────────── */

export type WeekendOutcome = 'win' | 'repel' | 'offlineRepel' | 'loss'

export interface WeekendResolveResult {
  /** 本次推进的进度增量（0 = 没推进） */
  progressGain: number
  /** 战果说明（供日志；中文原串，界面按 id 映射另接） */
  note: string
  /** 这次是否**夺回了某处**（含奖励） */
  reclaimed?: { galaxyId: string; wreck: number; isk: number; allClear: boolean }
  /** 击毁旗舰 ⇒ 黑匣 + 稀有残骸（黑匣物品 id 由引擎侧按数据表取） */
  flagshipKilled?: { blackBox: true; wreck: number }
}

/**
 * 结算一场入侵相关战斗（**唯一入口**）：
 * - `assault` + `win` ⇒ 主动推进（外围 +10% / 核心 +5%）→ 若该星系进度满 ⇒ **夺回奖励**（稀有残骸 ×8 ＋ 2M；全部夺回再 +5M）；
 * - `assault`/`ambush` + `repel` ⇒ **击退也加进度**（+3%；离线自动结算 +1%）；
 * - `loss` ⇒ **只受损、不动进度**（第 5 条）；
 * - 目标是核心且**核心条满**时打赢 ⇒ **击毁旗舰**（黑匣 ＋ 稀有残骸 ×3）并结束本场。
 */
export function weekendResolveBattle(
  state: GameState,
  /** 保留参数位：奖励发放若需 ctx（物品表/日志）时用；当前纯记账不需要 */
  _ctx: SimContext,
  spec: WeekendBattleSpec,
  outcome: WeekendOutcome,
  nowWallMs: number,
): WeekendResolveResult {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return { progressGain: 0, note: '本场入侵已结束' }

  if (outcome === 'loss') return { progressGain: 0, note: '战败：只受损，进度不动（第 5 条）' }

  const wasReclaimed = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1
  let gain = 0
  if (outcome === 'win') {
    gain = spec.galaxyId === ev.coreId ? WEEKEND_GAIN_CORE_WIN : WEEKEND_GAIN_PERIPHERY_WIN
    // 核心：门禁未解时**不给进度**（`weekendNoteContribution` 会记台账，但读数侧仍被门禁挡住 ⇒ 这里只在门禁已解时记）
    const gated = spec.galaxyId === ev.coreId && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) <= 0 && !peripheryCleared(state, ev, nowWallMs)
    if (!gated) weekendNoteContribution(ev, spec.galaxyId, gain)
    else gain = 0
  } else {
    gain = outcome === 'offlineRepel' ? WEEKEND_GAIN_OFFLINE_REPEL : WEEKEND_GAIN_REPEL
    weekendNoteContribution(ev, spec.galaxyId, gain)
  }

  const res: WeekendResolveResult = { progressGain: gain, note: '' }

  // 旗舰：核心已满 + 打赢 ⇒ 击毁（先判旗舰，因为核心满时"夺回"已是既成事实）
  if (spec.kind === 'flagship' && outcome === 'win') {
    if (weekendNoteFlagshipKilled(state, nowWallMs)) {
      res.flagshipKilled = { blackBox: true, wreck: WEEKEND_FLAGSHIP_WRECK }
      res.note = '旗舰被击毁：黑匣与战利品归玩家'
      return res
    }
  }

  // 夺回：这一次越过 100% ⇒ 发一次奖励（用"打之前没满、打之后满"判据 ⇒ 天然幂等）
  if (!wasReclaimed && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1) {
    const allClear = weekendOccupiedIds(ev).every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
    res.reclaimed = {
      galaxyId: spec.galaxyId,
      wreck: WEEKEND_RECLAIM_WRECK,
      isk: WEEKEND_RECLAIM_ISK + (allClear ? WEEKEND_ALL_CLEAR_ISK : 0),
      allClear,
    }
    res.note = allClear ? '全部占领区夺回：额外奖励入账' : '该星系夺回'
  } else if (res.note === '') {
    res.note = outcome === 'win' ? '推进进度' : '击退遇袭'
  }
  return res
}

function peripheryCleared(state: GameState, ev: WeekendEventState, nowWallMs: number): boolean {
  return ev.peripheryIds.every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

/* ─────────────── 结束时结算（贡献奖） ─────────────── */

export interface WeekendSettlePlan {
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  wreck: number
  isk: number
  /** 玩家是否击毁了旗舰（⇒ 黑匣归玩家；章鱼人得手 ⇒ 黑匣归零） */
  blackBoxToPlayer: boolean
}

/** 结束结算：按贡献占比发奖（Q5 四档）；黑匣只在"玩家击毁"时给 */
export function weekendSettlePlanOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): WeekendSettlePlan {
  const share = weekendContributionShareAt(state, ev, nowWallMs)
  const tier = weekendContributionTier(share)
  return {
    share,
    tier: tier.tier,
    wreck: tier.wreck,
    isk: tier.isk,
    blackBoxToPlayer: ev.flagshipDown === 'player',
  }
}
