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
import { addItem } from './inventory'
import {
  WEEKEND_CORE_THREAT,
  WEEKEND_PERIPHERY_THREAT,
  weekendAmbushPickOf,
  weekendFoeCardsSelfPriced,
  weekendGarrisonFoeCardId,
  weekendCoreProgressAt,
  weekendFlagshipDefeated,
  weekendIsBossFamily,
  weekendIsFlagshipShipId,
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
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
import { flagshipBattleLedger } from './combat'
import { rareWreckItemIdOfCard } from './salvage'
import { WEEKEND_CARD_PREFIX, weekendOccupiedLiveAt } from './weekendBounty'

/* ─────────────── 战斗规格 ─────────────── */

export type WeekendBattleKind = 'assault' | 'ambush' | 'flagship'

export interface WeekendBattleSpec {
  kind: WeekendBattleKind
  galaxyId: string
  /** 敌卡（**抽签**取该区域池里的一支：外围 {骚扰, 袭击} · 核心 {袭击, 主力}；旗舰战 = 旗舰部队卡） */
  cardId: string
  /** 威胁（主动：H 族 = 卡面实测价；A/C/G = 占位口径 78 / 120。遇袭：按缩放后实测价反解） */
  threat: number
  /**
   * 波数：旗舰 = 4（口径定稿 #8）；其余 = **该卡自身的波数**（新池卡里有 2 波的：袭击 / 主力）。
   * ⚠ 开战并不读本字段（舰级路径按卡的 `ships[].wave` 跑波），它只服务展示与记账。
   */
  waves: number
  /** 编队规模：旗舰 4 艘小队战；其余 1（单舰） */
  squadSize: number
  /** 赏金倍率：外围 ×1.4 · 旗舰 ×3 */
  rewardMul: number
  /** 展示名（玩家可见；「<族>舰队 · <卡名>」/「<族>旗舰」） */
  name: string
  /**
   * **敌群真·强度倍率**（2026-09-25 船长令「遇袭的时候遭遇的敌人按强度\*0.75算」）：
   * 只有遇袭非空 ⇒ 开战时传进 `FoeOverride.strengthMul`；主动出击 / 旗舰战不传（缺省 = 不缩放）。
   */
  foeStrengthMul?: number
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

/**
 * 主动出击某被占星系（**敌卡 = 该星系"驻留"的那支**：按 (存档种子, 本场入侵 seq, 星系位序) 抽签）。
 * 船长 2026-09-25：「**外围玩家主动出击和被动遇袭都是从骚扰和袭击舰队中抽取。核心区，则是抽取袭击和主力舰队。**」
 * ＋「**旗舰卡单独**」⇒ 核心的主动出击**不再挂旗舰部队卡**。非占领区 ⇒ null。
 */
export function weekendAssaultSpecOf(state: GameState, ctx: SimContext, galaxyId: string): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  const isCore = galaxyId === ev.coreId
  const cardId = weekendGarrisonFoeCardId(state, ev, galaxyId)
  const card = ctx.anomalies.get(cardId)
  return {
    kind: 'assault',
    galaxyId,
    cardId,
    // H 族（独立卡）：威胁 = **卡面自身**（已按定价式落值）；A/C/G：仍按入侵占位口径 78 / 120
    threat: weekendFoeCardsSelfPriced(ev.family)
      ? Math.max(1, Math.round(card?.threat ?? 1))
      : isCore
        ? WEEKEND_CORE_THREAT
        : WEEKEND_PERIPHERY_THREAT,
    waves: Math.max(1, card?.waves?.length ?? 1),
    squadSize: 1,
    rewardMul: WEEKEND_ASSAULT_REWARD_MUL,
    name: `${ev.family} 族舰队 · ${cardNameOf(ctx, cardId)}`,
  }
}

/**
 * 遇袭（巡游小队）：单舰 ＋ **每场从池里重抽** ＋ **强度 ×`WEEKEND_AMBUSH_STRENGTH_MUL`（0.75）**
 * （船长 2026-09-25；旧口径"威胁标签 ×0.5"已删除——它只改数字、改不了强度）。
 * 威胁标签由 `weekendAmbushPickOf` 给出（H 族 = 缩放后**实测价**反解；A/C/G = 主动威胁 × 倍率）。
 * 同样只在占领区成立。
 */
export function weekendAmbushSpecOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  const pick = weekendAmbushPickOf(state, ctx, galaxyId, nowWallMs)
  if (!pick) return null
  const card = ctx.anomalies.get(pick.cardId)
  return {
    kind: 'ambush',
    galaxyId,
    cardId: pick.cardId,
    threat: pick.threat,
    waves: Math.max(1, card?.waves?.length ?? 1),
    squadSize: 1,
    rewardMul: 1,
    name: `巡游小队 · ${cardNameOf(ctx, pick.cardId)}`,
    foeStrengthMul: pick.strengthMul,
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
    // H 族（独立卡）：威胁 = **卡面自身**（170，已按小队 ×10 定价）；A/C/G：仍按占位口径 120
    threat: weekendFoeCardsSelfPriced(ev.family)
      ? Math.max(1, Math.round(ctx.anomalies.get(cardId)?.threat ?? WEEKEND_CORE_THREAT))
      : WEEKEND_CORE_THREAT,
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
  /**
   * **BOSS 池：这一场对母舰造成的原始伤害**（2026-09-24 第二轮令；缺省 0 = 该场没打到母舰 ⇒ 0 进度）。
   * 由引擎用 `combat.flagshipBattleLedger` 量出来（"按对母舰造成的伤害决定"）。
   */
  flagshipDmg = 0,
  /** **这一场战斗的身份**（`battle.startedAtGameMs`）——同一场被结算两次时保证幂等 */
  flagshipRunId?: number,
): WeekendResolveResult {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return { progressGain: 0, note: '本场入侵已结束' }

  /**
   * **旗舰 BOSS 池先记账**（跨场累计；撤退/战败**照样记**——船长口径："按对母舰造成的伤害决定"）。
   * 归类不按胜负：`win` = 打赢（BOSS 口径下"打空池子"才算击沉），`repel`/`loss` = 没打赢但伤害照记。
   */
  if (spec.kind === 'flagship' && weekendIsBossFamily(ev)) {
    // 幂等键 = 这一场战斗的身份（同一场被结算两次时不会记两遍）
    weekendNoteFlagshipDamage(ev, flagshipDmg, flagshipRunId)
  }
  /** **BOSS 口径下的"成了"**：这一场把池子打空了（单场不死 ⇒ 不看战斗本身的胜负） */
  const bossDown = spec.kind === 'flagship' && weekendIsBossFamily(ev) && weekendFlagshipDefeated(ev)

  if (outcome === 'loss' && !bossDown) return { progressGain: 0, note: '战败：只受损，进度不动（第 5 条）' }

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

  // 旗舰：**BOSS 口径 ⇒ 池子打空才算击沉**（单场不死）；老口径 ⇒ 核心已满 + 打赢即击毁
  if (spec.kind === 'flagship' && (bossDown || (outcome === 'win' && !weekendIsBossFamily(ev)))) {
    if (weekendNoteFlagshipKilled(state, nowWallMs)) {
      res.flagshipKilled = { blackBox: true, wreck: WEEKEND_FLAGSHIP_WRECK }
      res.note = bossDown ? '旗舰血量归零：击沉（跨场累计）' : '旗舰被击毁：黑匣与战利品归玩家'
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

/* ─────────────── 奖励入账（M1-b 第五片） ─────────────── */

/**
 * **入侵旗舰黑匣的物品 id**（船长 2026-09-25：「**黑匣先做壳**」）——
 * 先做成一件**真实物品**（可存、可回收、可售予回收商），**用途留待"改装/特殊装备"那批**。
 * 定义在 `data/items.ts` 的 `WEEKEND_TROPHIES`（与残骸同一条注册链路）。
 */
export const WEEKEND_BLACKBOX_ITEM_ID = 'blackbox-h'

/**
 * **这一场该发的稀有残骸物品 id**（2026-09-25 修）：按**"打的那张卡"所属残骸组**取
 * （H 族独立卡 ⇒ `wreck-rare-h-hi`；A/C/G 占位卡 ⇒ 它们那张虫洞卡所属组）。
 *
 * ⚠ 原实现写死 `WEEKEND_RARE_WRECK_ID = 'wreck-rare'` —— 那个 id **在物品目录里不存在**
 * （真实形态是 `wreck-rare-<组key>`），实测 `ctx.items.has('wreck-rare') === false`，
 * 发出去就是一件「未知物品」（回收画像 null ⇒ 不能回收、不能卖）。现已删除该常量。
 * 契约保证"每张敌卡都登记进某一残骸组" ⇒ 正常路径必有值；解析不到就不发（不造假物品）。
 */
export function weekendRareWreckIdFor(cardId: string, ctx: SimContext): string | undefined {
  return rareWreckItemIdOfCard(cardId, ctx) ?? undefined
}

/**
 * **把结算结果真正发下去**（引擎在拿到 `weekendResolveBattle` / `weekendSettlePlanOf` 的结果后调用）：
 * - ISK 直接进钱包；
 * - 稀有残骸走 `addItem` 进物品仓库（与战利品同一条入库路径），**物品 id 由调用方按卡解析**
 *   （`weekendRareWreckIdFor`；缺省 = 不发，绝不发不存在的 id）；
 * - **黑匣暂不发物品**（数据表里还没有这件，M4「黑匣入库与定价」一起做）⇒ 只在返回值里带回数量。
 *
 * ⚠ 幂等由调用方保证（`weekendResolveBattle` 的"夺回只发一次"已在那一层判过）。
 */
export function weekendGrantRewards(
  state: GameState,
  reward: { isk?: number; wreck?: number; blackBox?: boolean; wreckItemId?: string },
): { isk: number; wreck: number; blackBox: number } {
  const isk = Math.max(0, Math.round(reward.isk ?? 0))
  const wreck = Math.max(0, Math.round(reward.wreck ?? 0))
  if (isk > 0) state.wallet.isk += isk
  if (wreck > 0 && reward.wreckItemId !== undefined) addItem(state, reward.wreckItemId, wreck)
  // **黑匣**（2026-09-25「先做壳」）：真物品入库（船长 2026-09-24 口径 = 击毁旗舰必掉 ×1）
  if (reward.blackBox) addItem(state, WEEKEND_BLACKBOX_ITEM_ID, 1)
  return { isk, wreck, blackBox: reward.blackBox ? 1 : 0 }
}

/* ─────────────── 战斗结束 → 入侵结算（M1-b 第六片） ─────────────── */

/**
 * **这一场战斗属于入侵吗**（引擎战后调一次即可，不用自己判断占领区）：
 * - 卡 id 带 `wk-` 前缀（界面/悬赏侧拿到的派生卡）⇒ 还原成原卡再看星系；
 * - 否则按原卡的 `galaxyId` 看是不是**活的占领区**；
 * - 都没有 ⇒ 再看 `state.encounter`（遇袭遭遇的星系）。
 * 返回 `{ galaxyId, kind }`：`assault` = 主动出击（悬赏/旗舰）· `ambush` = 遇袭。
 */
export function weekendBattleInvolvedOf(
  state: GameState,
  ctx: SimContext,
  anomalyId: string | null | undefined,
  nowWallMs: number,
): { galaxyId: string; kind: WeekendBattleKind } | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return undefined
  const rawId = typeof anomalyId === 'string' && anomalyId.length > 0 ? anomalyId : undefined
  if (rawId !== undefined) {
    const baseId = rawId.startsWith(WEEKEND_CARD_PREFIX) ? rawId.slice(WEEKEND_CARD_PREFIX.length) : rawId
    const card = ctx.anomalies.get(baseId)
    const galaxyId = card?.galaxyId
    if (galaxyId !== undefined && weekendOccupiedLiveAt(state, galaxyId, nowWallMs)) {
      const flagship = galaxyId === ev.coreId && weekendCoreProgressAt(state, ev, nowWallMs) >= 1
      return { galaxyId, kind: flagship ? 'flagship' : 'assault' }
    }
  }
  const enc = state.encounter
  if (enc.active && enc.galaxyId) {
    /**
     * **旗舰战**（2026-09-25 修）：核心条满时核心星系**不再算"被占"**（`weekendOccupiedLiveAt` 要求进度 < 1）
     * ⇒ 原先这条恒假、旗舰战打完全都不结算（探针实测：归属 undefined / 结算 null / 池子从未立起）。
     * 判据改成"遭遇槽里挂的正是该族**旗舰卡** + 星系 = 本场核心"——旗舰战就是引擎「挑战旗舰」写进遭遇槽的那一场。
     */
    if (enc.anomalyId !== null && enc.anomalyId === weekendFoeCardOf(ev.family, 'flagship') && enc.galaxyId === ev.coreId) {
      return { galaxyId: ev.coreId, kind: 'flagship' }
    }
    if (weekendOccupiedLiveAt(state, enc.galaxyId, nowWallMs)) {
      return { galaxyId: enc.galaxyId, kind: 'ambush' }
    }
  }
  return undefined
}

/**
 * **战后一口气结算**（引擎在"这一场打完了"那一拍调用）：
 * 判归属 → 取 spec → `weekendResolveBattle` → **奖励真正入账**（ISK 进钱包、稀有残骸进仓库）。
 * 返回 null = 这一场与入侵无关（引擎什么都不用做）。
 */
export function weekendApplyBattleOutcome(
  state: GameState,
  ctx: SimContext,
  anomalyId: string | null | undefined,
  victory: boolean,
  nowWallMs: number,
  /**
   * **打出这一场胜负的 `BattleState`**（2026-09-24 加；缺省 = 老调用方 ⇒ 台账恒 0）：
   * 旗舰 BOSS 要用它量"这一场对母舰造成了多少原始伤害"（`combat.flagshipBattleLedger`）。
   */
  battle?: import('./state').BattleState | null,
): { galaxyId: string; kind: WeekendBattleKind; gain: number; isk: number; wreck: number; note: string } | null {
  const involved = weekendBattleInvolvedOf(state, ctx, anomalyId, nowWallMs)
  if (!involved) return null
  const spec =
    involved.kind === 'flagship'
      ? weekendFlagshipSpecOf(state, ctx, nowWallMs)
      : involved.kind === 'ambush'
        ? weekendAmbushSpecOf(state, ctx, involved.galaxyId, nowWallMs)
        : weekendAssaultSpecOf(state, ctx, involved.galaxyId)
  if (!spec) return null
  /**
   * **旗舰 BOSS：这一场对母舰的原始伤害**（船长 2026-09-24 第二轮令）。
   * 从 `battle.units` 的 `hpMax − hp` 量（`flagshipBattleLedger`；认舰靠单位上的 `foeShipId`）。
   * ⚠ 2026-09-25：池子总量改成**固定常量**（船长「BOSS 血条 15 万来算」）⇒ 不再算"下限"。
   */
  let flagshipDmg = 0
  if (involved.kind === 'flagship' && weekendIsBossFamily(state.weekendEvent)) {
    const card = ctx.anomalies.get(spec.cardId)
    const flagshipIds = (card?.ships ?? [])
      .map((s) => s.ship.id)
      .filter((id) => weekendIsFlagshipShipId(id))
    if (battle) {
      const led = flagshipBattleLedger(battle, flagshipIds)
      flagshipDmg = led.rawDmg
    }
  }
  /**
   * ⚠ **BOSS 口径下"战斗打赢"不再等于"击沉旗舰"**（单场不死）：这一场把池子打空才算。
   * 其余情形（没打空）照常按胜负记进度 —— 撤退/战败的伤害也已经记进池子了。
   */
  const bossDown =
    involved.kind === 'flagship' && weekendIsBossFamily(state.weekendEvent) && weekendFlagshipDefeated(state.weekendEvent)
  const outcome: WeekendOutcome = victory || bossDown ? 'win' : involved.kind === 'ambush' ? 'repel' : 'loss'
  const r = weekendResolveBattle(state, ctx, spec, outcome, nowWallMs, flagshipDmg, battle?.startedAtGameMs)
  const isk = (r.reclaimed?.isk ?? 0)
  const wreck = (r.reclaimed?.wreck ?? 0) + (r.flagshipKilled?.wreck ?? 0)
  // **稀有残骸的真实物品 id**：按这一场打的那张卡所属残骸组取（H 族 ⇒ `wreck-rare-h-hi`）
  const wreckItemId = weekendRareWreckIdFor(spec.cardId, ctx)
  const granted = weekendGrantRewards(state, {
    isk,
    wreck,
    blackBox: r.flagshipKilled !== undefined,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  return { galaxyId: involved.galaxyId, kind: involved.kind, gain: r.progressGain, isk: granted.isk, wreck: granted.wreck, note: r.note }
}
