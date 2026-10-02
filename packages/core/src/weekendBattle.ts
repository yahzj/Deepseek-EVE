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
import { addWare } from './inventory'
import { addLog } from './state'
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
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
  weekendNoteFlagshipKilled,
  weekendOccupiedIds,
  weekendPlayerContribution,
  weekendProgressAt,
  weekendProgressIncomeIsk,
  weekendContributionShareAt,
  weekendContributionTier,
  weekendFoeCardOf,
  WEEKEND_GAIN_OFFLINE_REPEL,
  WEEKEND_GAIN_REPEL,
  weekendWinGainOf,
  /** 2026-09-28 船长令「击杀BOSS就能获得黑匣」：击杀判据（**留档优先**的单点）＋ 结清标记 */
  weekendLastHitByPlayer,
  weekendBlackBoxSettledOf,
  /** 2026-09-27 船长令：占比按**玩家优先**口径取（玩家允许挤掉章鱼人的输出） */
  weekendFlagshipSharesOf,
  /** 2026-09-27 整理：归属判据收口（**留档优先**）——结算快照与引擎结束日志共用同一个它 */
  weekendFlagshipOutcomeOf,
} from './weekendEvent'
import type { WeekendEventState, WeekendResultSnapshot } from './weekendEvent'
import { weekendFoeFleetNameOf, weekendStandingGainOf } from './weekendEvent'
import { flagshipBattleLedger } from './combat'
import { rareWreckItemIdOfCard, RARE_WRECK_VOLUME_M3 } from './salvage'
/** 2026-09-27 船长令：主力舰队打赢 ⇒ 往该星系**入侵残骸场**里放箱子（稀有残骸） */
import { injectWeekendRareWreck } from './salvage'
import { WEEKEND_CARD_PREFIX, weekendOccupiedLiveAt } from './weekendEvent'
/** 2026-10-02 破环搬家：声望账本从 expedition 拆到 standing.ts，这里改读 standing（断 expedition↔weekendBattle） */
import { DSI_FACTION_ID, noteStandingEarned } from './standing'

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
/**
 * **稀有残骸的「件 → 单位(m³)」换算**（**船长 2026-09-25 令**：周末奖励按**件**补足）。
 *
 * 全仓口径 = **1 件 = `RARE_WRECK_VOLUME_M3`(30) 单位 = 30 m³**（打捞侧同口径：捞到 1 件入库 30 单位，
 * 回收炉稀有批也是 30 m³/批 ⇒ **一炉一件**）。
 *
 * ⚠ 病根（2026-09-25 船长问「H 族残骸现在有精炼炉回收吗」时查出来的）：本文件那几张表
 * （旗舰掉落 ×3 · 夺回 ×8 · 贡献四档 ×12/×8/×4/×1）按**件**写（设计稿原文「×8 **件**」），
 * 但落到入库口（`addItem`/`addWare`）时直接发了 **n 个单位 = n m³** ⇒ **少了 30 倍**，
 * 玩家拿着「稀有残骸 ×8」连 30 m³ 的起炉线都够不到（拆不了）。
 * ⇒ 现在在**换算点**一次换算成单位；台账 / 结算面板 / 通讯 / 日志**一律按 m³ 读数**
 * （与仓库计数、回收炉批数同一个数）。
 */
export function weekendRareWreckUnits(pieces: number): number {
  return Math.max(0, Math.round(pieces)) * RARE_WRECK_VOLUME_M3
}

/**
 * **夺回奖按"玩家在该处的投入比例"缩水**（**2026-09-29 船长令 · 乙案**）。
 *
 * 病根（船长报障原话：「**玩家在入侵中完全0贡献，但是却有每个星系240残骸+200万**」）：
 * 夺回奖原先**只看"进度 ≥ 1"**，而进度 = `NPC 铺底(时间函数) ＋ 玩家投入` —— 外围 T0+48h、
 * 核心 T0+72h 之后**时间自己就把条推满** ⇒ 一次都不打的玩家照样每处拿 240 m³ ＋ 200 万
 * （同一批的贡献四档奖与进度收入本来就有 0 贡献保护，只有这条漏了）。实测：4 处占领区、
 * 一次不打 ⇒ 1,300 万 ＋ 960 m³。
 *
 * 新口径（船长三答）：**每处 = 全额 × 玩家在该处的投入比例**（比例 = `contributed[星系]`，
 * 0~1，NPC 铺底那一份不算）；**全清追加 = 全额 × 平均参与度**（见 `weekendAllClearAwardOf`）。
 * - **残骸按"件"四舍五入**（1 件 = 30 m³ ⇒ 记的永远是 30 的整数倍，不会往仓库塞 2 m³ 碎渣）；
 * - **ISK 四舍五入到 1 元**；
 * - 0 贡献 ⇒ **两笔都记 0**（挂机不再产生任何收入）。
 *
 * ⚠ **算的是"最终"投入比例**：调用点只有一个 —— 结算那一拍（`weekendSettleAndGrant` 的幂等早退
 * **之前**，传的是 `ev.endedAtWallMs`）。**不许**改回"夺回那一刻按当时比例记"：那样同一处
 * "先被 NPC 铺满、玩家事后才去清缴"会被记成 0，且结果取决于他当时恰好在别处打过没打过一场
 * （同一行为算出不同奖励）；挂到结算拍后与 `contributed` 台账（随档）同源、与出手顺序无关、
 * 与进度收入（同样在结算拍按台账算）同一把尺。
 */
export function weekendReclaimAwardOf(ev: WeekendEventState, galaxyId: string): { wreck: number; isk: number } {
  const put = ev.contributed[galaxyId] ?? 0
  const ratio = Number.isFinite(put) ? Math.min(1, Math.max(0, put)) : 0
  return {
    wreck: weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK * ratio),
    isk: Math.round(WEEKEND_RECLAIM_ISK * ratio),
  }
}

/**
 * **全清追加（5,000,000 ISK）按"平均参与度"缩水**（**2026-09-29 船长令 · 甲案**）：
 * `全额 × (玩家总投入 ÷ 占领区数)`，封顶 1 ⇒ 处处打满 = 全额，一处没碰过就摊薄，完全挂机 = 0。
 * 与 `weekendReclaimAwardOf` 同拍、同一把尺（都读 `contributed` 台账）。
 */
export function weekendAllClearAwardOf(ev: WeekendEventState): number {
  const ids = weekendOccupiedIds(ev)
  if (ids.length === 0) return 0
  const total = weekendPlayerContribution(ev)
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.round(WEEKEND_ALL_CLEAR_ISK * Math.min(1, total / ids.length))
}

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
    name: weekendFoeFleetNameOf(ev.family, cardNameOf(ctx, cardId)),
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
  /**
   * 这次是否**夺回了某处**（只记"这件事发生了" —— **不带金额**）。
   *
   * ⚠ **2026-09-29 船长令（乙案）后金额要按"最终投入比例"算**（`weekendReclaimAwardOf`），
   * 夺回那一刻算不出最终值 ⇒ 金额一律归**结算拍**（`weekendSettleAndGrant`）。
   */
  reclaimed?: { galaxyId: string; allClear: boolean }
  /** 击毁旗舰 ⇒ 黑匣（**按爆率表掷出来的结果**，可能不爆）＋ 稀有残骸（必给） */
  flagshipKilled?: { blackBox: boolean; wreck: number }
}

/**
 * 结算一场入侵相关战斗（**唯一入口**）：
 * - `assault` + `win` ⇒ 主动推进（外围 +5% / 核心 +5%；外围 2026-10-01 由 10% 降至 5%）→ 若该星系进度满 ⇒ **夺回奖励**（稀有残骸 ×8 ＋ 2M；全部夺回再 +5M）；
 * - `assault`/`ambush` + `repel` ⇒ **击退也加进度**（+3%；离线自动结算 +1%）；
 * - `loss` ⇒ **只受损、不动进度**（第 5 条）；
 * - 目标是核心且**核心条满**时打赢 ⇒ **击毁旗舰**（黑匣 ＋ 稀有残骸 ×3）并结束本场。
 */
export function weekendResolveBattle(
  state: GameState,
  /** 保留参数位：奖励发放若需 ctx（物品表/日志）时用；当前纯记账不需要 */
  ctx: SimContext,
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
  /** 本场**开打前**该星系的进度读数（% —— 只给下面那条"夺回进度 a% → b%"反馈文案用；与 `weekendProgressAt` 同源） */
  const beforePct = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100
  /** 本场是否被**核心门禁**挡下（只有核心、且外围没清完、且核心读数还停在 0）——给反馈文案分流用 */
  let gatedThisBattle = false
  let gain = 0
  if (outcome === 'win') {
    /** 主动胜利的推进量：**调试模式 = +50%（两场收复，船长令）**；正常 = 外围 5% / 核心 5%（外围 2026-10-01 由 10% 降至 5%） */
    gain = weekendWinGainOf(state, ev, spec.galaxyId)
    // 核心：门禁未解时**不给进度**（`weekendNoteContribution` 会记台账，但读数侧仍被门禁挡住 ⇒ 这里只在门禁已解时记）
    const gated = spec.galaxyId === ev.coreId && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) <= 0 && !peripheryCleared(state, ev, nowWallMs)
    gatedThisBattle = gated
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
      /**
       * **击杀 BOSS ⇒ 黑匣必给 1 枚**（**2026-09-28 船长令**：「让玩家击杀BOSS就能获得黑匣，
       * 取消之前的复杂判定」）—— 这里**不再掷骰**；残骸照旧必给 ×3（船长 2026-09-25 四答之三"残骸不变"）。
       * 走到这里 = 玩家把共享血池打空（或非 BOSS 族的老口径取胜）⇒ 击杀成立。
       */
      res.flagshipKilled = { blackBox: true, wreck: weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK) }
      res.note = bossDown ? '旗舰血量归零：击沉（跨场累计）· 黑匣入手' : '旗舰被击毁：战利品归玩家（含黑匣）'
      return res
    }
  }

  // 夺回：这一次越过 100% ⇒ 只记下"这处刚夺回"这件事（**金额不在这里算**：按最终投入比例，见 `weekendReclaimAwardOf`）
  if (!wasReclaimed && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1) {
    const allClear = weekendOccupiedIds(ev).every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
    res.reclaimed = { galaxyId: spec.galaxyId, allClear }
    res.note = allClear ? '全部占领区夺回：全清追加待结算' : '该星系夺回：奖励待结算'
  } else if (res.note === '') {
    res.note = outcome === 'win' ? '推进进度' : '击退遇袭'
  }
  /**
   * **每场入侵战斗的进度反馈**（**2026-09-25 船长批「甲」**）。
   *
   * 起因（船长真档实测）：主动出击胜利**原来一句日志都没有**（`expedition.ts` 丢弃本函数的返回值，
   * 只有"夺回/旗舰"才写日志）⇒ 玩家连清同一处时，除了星图上该星系那条细进度条**没有任何反馈**，
   * 而活动栏那三块读数（外围夺回 X/Y · 核心 % · 已夺回 N/M）都是"满 100% 才 +1"的计数 ⇒
   * 观感就是「重复清缴不加进度条」（玩家报障原话）。
   *
   * 口径：
   * - **夺回**那一场不写本行（上面已有 `✦ 夺回…` 那条，说了更重要的信息）；
   * - **战败**（gain = 0 且非门禁）不写（进度本来就没动，避免噪声）；
   * - **核心门禁**未解 ⇒ 写"本次不计进度"那一行（`core.weekend.036`），把白打讲明白；
   * - 读数取**该星系自己的进度**（与星图/星系详细同源 `weekendProgressAt`，含 NPC 铺底）。
   *
   * 🔴 **级别 = `combat`**（**船长 2026-09-26 裁决**：「**「事件日志重新分类」以一号为优先。**」）——
   * 本条曾按同日另一条令（「**包括玩家夺回进度的更新**」）从 `info` 提为 `warn`，现按本条裁决**改回
   * `combat`**：与"事件日志重新分类"那批（战斗/工业/舰队/打捞四类）保持同一分类口径，不让同一类
   * 日志分在两个页签里。⚠ 两条令的先后与取舍见 `docs/development-conventions-changelog.md`。
   */
  if (res.reclaimed === undefined) {
    const gname0 = ctx.galaxies.get(spec.galaxyId)?.name ?? spec.galaxyId
    if (gain > 0) {
      const pctBefore = Math.round(beforePct)
      const pctAfter = Math.round(weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100)
      /**
       * ⚠ **合并解冲突（2026-09-26）**：两边改的是**同一格的档位**，只能取一个 ——
       * **取我方 `warn`**（船长 2026-09-26 明令「**包括玩家夺回进度的更新**」⇒ 提到警告档、要醒目）；
       * main 侧（一号「事件日志重新分类」）把这两条归入 `combat`。**两条裁定不同源、待船长确认**：
       * 按「新令压旧令」先落 warn；若船长要跟一号的分类走，把下面两处 `'warn'` 改回 `'combat'` 即可。
       */
      /**
       * 🔴 **档位 = `combat`**（**船长 2026-09-26 裁决**：「**「事件日志重新分类」以一号为优先。**」）——
       * 与本文件里其余战斗类日志同一档；原先我曾按同日另一条令提为 `warn`，现按本条裁决改回 `combat`。
       */
      addLog(state, 'combat', `✦ ${gname0}：夺回进度 ${pctBefore}% → ${pctAfter}%`, 'core.weekend.035', {
        p1: gname0,
        p2: pctBefore,
        p3: pctAfter,
      })
    } else if (gatedThisBattle) {
      /** 同上：`combat`（与 `.035` 那条同一裁决） */
      addLog(state, 'combat', `✦ ${gname0}：外围未清完，本次不计夺回进度`, 'core.weekend.036', { p1: gname0 })
    }
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
  /**
   * **进度收入**（2026-09-25 船长令「在结算时候直接按进度获取收入」；单价 20 万/1%，
   * 只结玩家投入那一份 —— 见 `weekendEvent.WEEKEND_PROGRESS_ISK_PER_PCT`）。
   * 与贡献四档奖**并列**、一起在结束那一刻发放。
   */
  progressIsk: number
  /** 玩家参与度（玩家投入合计 ÷ 该场"打满一处"的进度量）*/
  progressPct: number
  /** 玩家是否击毁了旗舰（⇒ 黑匣归玩家；章鱼人得手 ⇒ 黑匣归零） */
  blackBoxToPlayer: boolean
}

/** 结束结算：按贡献占比发奖（Q5 四档）＋ 进度收入；黑匣只在"玩家击毁"时给 */
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
    wreck: weekendRareWreckUnits(tier.wreck),
    isk: tier.isk,
    progressIsk: weekendProgressIncomeIsk(ev),
    progressPct: weekendPlayerContribution(ev),
    /**
     * **黑匣是否归玩家**（**2026-09-28 船长令改口径**）＝ **玩家击杀了 BOSS 就给**，
     * 判据取单点 `weekendEvent.weekendLastHitByPlayer`（留档优先）。
     * ⚠ 旧口径是"掷骰结果 `ev.flagshipBlackBox`"（章鱼人得手也可能爆、玩家击沉也可能不爆）——已作废。
     */
    blackBoxToPlayer: weekendLastHitByPlayer(ev),
  }
}

/** 贡献奖实发结果（`weekendSettleAndGrant` 的返回值） */
export interface WeekendSettleGrant {
  /** 贡献占比（0~1，按**结束时刻**评估） */
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  /** 实发（已入账）数量 */
  isk: number
  wreck: number
  /** 其中属于**进度收入**的那一部分（2026-09-25；面板/汇报要能分开说） */
  progressIsk: number
}

/**
 * **记一笔到手台账**（2026-09-25 加）：三处入账（夺回 / 贡献奖 / 旗舰掉落）各调一次，全是**累加**。
 * 用途 = 结算面板与结算通讯里的奖励清单**不再另算一遍**（说的与发的逐值一致）。
 * `galaxyId` 给了才记逐星系那一栏（旗舰掉落与贡献奖是全局的）。
 *
 * ⚠ **对外导出只为补发工具**（`weekendComms.reconcileWeekendBlackBox`，2026-09-28 船长令）：
 * 它补的黑匣同样要进这本台账，否则结算面板又会显示玩家手里没有/少一件的东西（账实分离）。
 * 游戏内其余入账一律走本文件内的调用点，别在外面新开入口。
 */
export function noteReward(
  ev: WeekendEventState,
  galaxyId: string | undefined,
  add: { isk?: number; wreck?: number; blackBox?: number },
): void {
  const led = (ev.rewardLedger ??= { isk: 0, wreck: 0, blackBox: 0, byGalaxy: {} })
  const isk = Math.max(0, Math.round(add.isk ?? 0))
  const wreck = Math.max(0, Math.round(add.wreck ?? 0))
  const blackBox = Math.max(0, Math.round(add.blackBox ?? 0))
  led.isk += isk
  led.wreck += wreck
  led.blackBox += blackBox
  if (galaxyId !== undefined && (isk > 0 || wreck > 0)) {
    const g = (led.byGalaxy[galaxyId] ??= { isk: 0, wreck: 0 })
    g.isk += isk
    g.wreck += wreck
  }
}

/**
 * **记一笔"待到账的夺回奖励"**（2026-09-25 船长令：夺回奖励不即时发、改在活动结束结算时发）。
 * 每夺回一处调一次（含全清追加那 5M），结束时由 `weekendSettleAndGrant` 一次发清。
 */
function noteReclaimPending(ev: WeekendEventState, add: { isk?: number; wreck?: number }): void {
  const cur = (ev.reclaimPending ??= { isk: 0, wreck: 0 })
  cur.isk += Math.max(0, Math.round(add.isk ?? 0))
  cur.wreck += Math.max(0, Math.round(add.wreck ?? 0))
}

/**
 * 🔴 **夺回奖的逐拍同步**（**2026-09-27 玩家报障修复** · 船长令「按你推荐来」）。
 *
 * 病根：夺回奖原先只在 `weekendApplyBattleOutcome` 里记（`if (r.reclaimed !== undefined)`）——
 * 可"夺回"在本作里是**按进度判**的（`weekendReclaimedAt` = 进度 ≥ 1），多数场次是**逐拍推满**
 * （NPC 铺底 ＋ 玩家投入）、根本没经过"战斗结算"那一拍 ⇒ 那段代码从未执行 ⇒
 * 面板每处都显示「—」、`reclaimPending` 也是空的 ⇒ **4/4 夺回却 32 件残骸 ＋ 1,300 万一分没发**
 * （船长截图实测：稀有残骸 450 = 360 贡献奖 ＋ 90 旗舰，夺回的 960 m³ 不在内；
 *  8,800 万 = 800 万贡献奖 ＋ 8,000 万进度收入，夺回 800 万与全清 500 万不在内）。
 *
 * 修法：**唯一判据** = 「已夺回 ∧ 不在 `ev.reclaimPaid`」⇒ 记台账 ＋ 记待到账 ＋ 打标记。
 * - 幂等：标记随档落盘 ⇒ 重复调用不会重复记；老档（已夺回却没记过）进来即被补齐（**补发靠这条判据，
 *   不需要一次性补丁脚本、不碰存档**）；
 * - 全清那 5M 用 `reclaimPaid.length === 总处数` 判 ⇒ 首达那一刻记一次，天然不重复；
 * - 战斗结算路径也调它（见 `weekendApplyBattleOutcome`）⇒ 全仓**只有一份**夺回奖口径。
 *
 * 🔴 **2026-09-29 船长令（乙案）改口径：金额按"玩家在该处的投入比例"缩水** —— 见
 * `weekendReclaimAwardOf` / `weekendAllClearAwardOf`。三条随之而来的变化：
 * 1. **调用点只剩一个** = 结算那一拍（`weekendSettleAndGrant` 的幂等早退**之前**，传 `ev.endedAtWallMs`）
 *    —— 战斗那一拍**不再调它**（那时算不出"最终投入比例"，见 `weekendReclaimAwardOf` 的 ⚠）；
 * 2. **比例的时间基准 = 结算时刻**：传进来的 `nowWallMs` 只用来判"哪几处已夺回"（进度 ≥ 1），
 *    而比例一律读 `contributed` 台账（随档、封顶 1）⇒ 与出手顺序无关；
 * 3. **0 贡献照样"记账"但数额是 0**：标记照打（幂等靠它），台账/待到账两笔都记 0
 *    ⇒ 面板那处显示 0，而不是显示"应得 240 m³"。
 */
export function weekendSyncReclaimRewards(
  state: GameState,
  ev: WeekendEventState,
  nowWallMs: number,
): { galaxies: string[]; allClear: boolean } {
  const paid = (ev.reclaimPaid ??= [])
  const all = weekendOccupiedIds(ev)
  const reclaimed = all.filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
  const fresh = reclaimed.filter((id) => !paid.includes(id))
  if (fresh.length === 0) return { galaxies: [], allClear: false }
  for (const id of fresh) {
    const award = weekendReclaimAwardOf(ev, id)
    noteReward(ev, id, award)
    noteReclaimPending(ev, award)
    paid.push(id)
  }
  /** 全清追加（**记进全局**，不带星系 ⇒ 面板逐星系那一列不会被它撑歪）：首达"全处夺回"时记一次 */
  const allClear = paid.length >= all.length && all.length > 0
  if (allClear) {
    const bonus = weekendAllClearAwardOf(ev)
    noteReward(ev, undefined, { isk: bonus })
    noteReclaimPending(ev, { isk: bonus })
  }
  return { galaxies: fresh, allClear }
}

/**
 * **战果快照**（结束时写一次 · 每场覆盖）：结算面板与结算通讯读它。
 * 逐处占领区的读数**按结束时刻**取（与贡献占比同一把尺）⇒ 面板上的"贡献 x%"与档位算得对得上。
 */
export function weekendResultSnapshotOf(
  state: GameState,
  ctx: SimContext,
  ev: WeekendEventState,
  atWallMs: number,
  plan: WeekendSettlePlan,
  wreckItemId?: string,
): WeekendResultSnapshot {
  const led = ev.rewardLedger ?? { isk: 0, wreck: 0, blackBox: 0, byGalaxy: {} }
  const galaxies = weekendOccupiedIds(ev).map((galaxyId) => {
    const put = ev.contributed[galaxyId] ?? 0
    const progress = weekendProgressAt(state, ev, galaxyId, atWallMs)
    const g = led.byGalaxy[galaxyId] ?? { isk: 0, wreck: 0 }
    return { galaxyId, put, progress, reclaimed: progress >= 1, isk: g.isk, wreck: g.wreck }
  })
  const hpMax = ev.flagshipHpMax
  const hpDone = Math.max(0, ev.flagshipHpDone ?? 0)
  /**
   * **归属 = 一处判据**（`weekendEvent.weekendFlagshipOutcomeOf`，**留档优先**）：
   * 有"玩家亲手击沉"的留档 ⇒ 一律玩家击沉（与池子算术无关）；否则读 `flagshipDown`；
   * 都没有 ⇒ 窗口到点。引擎结束那一刻的日志读**同一个**它（免得界面一处、报告一处各判一遍）。
   */
  const playerKill = ev.flagshipPlayerKill
  const flagshipOutcome: WeekendResultSnapshot['flagshipOutcome'] = weekendFlagshipOutcomeOf(ev)
  /**
   * `defeated` = **这面「已击沉 / 未击沉」的判据与黑匣同源**（代码见下面 `flagshipOutcome === 'player'`）。
   * ⚠ **2026-09-28 更正注释**：这里原先写「＝`flagshipDown === 'player'`」——那是**半套判据**
   * （2026-09-28 报障那一场正是"留档说玩家打爆了、`flagshipDown` 却是 `octopus`"），
   * 代码读的是**单点**`weekendFlagshipOutcomeOf`（留档优先），面板才不会与结算信打架。
   *
   * ⚠ **2026-09-25 船长报障修**：原判据写的是 `hpDone >= hpMax`（**玩家自己打的那份 ≥ 池子总量**）——
   * 那是"共享血条"落地**之前**的口径。改共享血条后，血条 = `池子 −（玩家 ＋ 章鱼人）`，
   * 船长的规则是「**玩家的这一击把血条打空**（哪怕前面已被章鱼削掉一半）就算**玩家击沉**」（见
   * `weekendEvent.weekendFlagshipDefeated` 的注释）。船长实录：`hpDone = 149,385` ＋ 章鱼 `615.25`
   * ⇒ 血条清零、`flagshipDown = 'player'`、**黑匣照发**，可面板照旧算 `149,385 < 150,000` ⇒
   * 打出「**未击沉**」＋ 奖励里却有旗舰黑匣 —— 一句话自相矛盾（船长原话：
   * 「入侵结算内，显示我未击沉，且给了我一个旗舰黑匣」）。
   * ⇒ 判据改为**读结局**（与 `weekendSettlePlanOf.blackBoxToPlayer` 同一把尺），面板与实发从此一致。
   */
  const flagship =
    hpMax !== undefined
      ? (() => {
          /** 两份占比走**玩家优先**口径（船长 2026-09-27：玩家允许挤掉章鱼人的输出） */
          const shares = weekendFlagshipSharesOf(ev)
          return {
            hpMax,
            hpDone,
            defeated: flagshipOutcome === 'player',
            playerFrac: shares.player,
            octopusFrac: shares.octopus,
          }
        })()
      : undefined
  void ctx // 目前不需要 ctx（星系名由界面现查）；保留参数位以免将来解析物品时改签名
  /**
   * **本期入侵按贡献获得的协会声望**（**2026-09-26 船长令**：「关于入侵的结算界面和结束通讯处，
   * 需要提及玩家获得了多少声望」）——**与实发同源**：同一条公式 `round(占比 × 15)`，
   * 结算那一拍（`weekendSettleAndGrant`）用它发、快照用它写 ⇒ 面板与信件上的数 = 真正加进账的数。
   */
  const standingGain = weekendStandingGainOf(ev, plan.share)
  return {
    seq: ev.seq,
    family: ev.family,
    coreId: ev.coreId,
    endedAtWallMs: atWallMs,
    flagshipOutcome,
    share: plan.share,
    tier: plan.tier,
    galaxies,
    ...(flagship !== undefined ? { flagship } : {}),
    /** 玩家亲手击沉的留档（换场即随事件对象消失；面板/通讯读它说"谁打沉的"） */
    ...(playerKill !== undefined
      ? { flagshipPlayerKill: { atWallMs: playerKill.atWallMs, ...(playerKill.waveIdx !== undefined ? { waveIdx: playerKill.waveIdx } : {}) } }
      : {}),
    // **进度收入**（2026-09-25）：读数与实发同源（同一对纯函数）⇒ 面板上的数与到账的数一致
    progressPct: weekendPlayerContribution(ev),
    progressIsk: plan.progressIsk,
    ...(standingGain > 0 ? { standing: standingGain } : {}),
    isk: led.isk,
    wreck: led.wreck,
    blackBox: led.blackBox,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  }
}

/**
 * **活动结束 ⇒ 贡献奖结算 ＋ 真正入账**（设计稿 ⑥「结束与结算」· M1-b 收尾 · 2026-09-25）。
 *
 * 设计稿原文：「结束时：① 统计贡献占比 → 发贡献奖 ② 玩家击毁 ⇒ 另发黑匣 ＋ 稀有残骸 ③ 所有占领恢复」。
 * 其中 ② 的**黑匣与旗舰残骸在"击沉那一刻"就发了**（`weekendApplyBattleOutcome` 的 `flagshipKilled`）
 * ⇒ 这里**不重复发**，只发 ① 的贡献四档奖（Q5：≥80% ⇒ ×12＋8M · 50~80% ⇒ ×8＋5M ·
 * 20~50% ⇒ ×4＋2M · <20% ⇒ ×1 · **0% ⇒ 无**）。
 *
 * 三条口径：
 * - **按结束时刻评估**（`ev.endedAtWallMs`）：NPC 铺底是**时间函数**，玩家离线几天后再结算会把铺底算高
 *   ⇒ 占比被算低、奖励少发；锁在结束那一刻则与"结束时统计"逐字一致，且**重复调用读数恒定**；
 * - **幂等**：`ev.prizePaidAtWallMs` 随档落盘 ⇒ 引擎每拍调、离线跨过结束点后补调，都只会发一次
 *   （0% 也算"已结"：标记照写，免得每拍重算）；
 * - **残骸物品 id** 取本族**旗舰卡**所属残骸组（`wreck-rare-h-hi` 一类；与旗舰掉落同一件）——
 *   解析不到就**不发**（绝不发不存在的 id，见 `weekendRareWreckIdFor` 的旧账）。
 *
 * 返回 `null` = 什么都不用做（没有入侵 / 还没结束 / 已经结过）。
 */
export function weekendSettleAndGrant(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
): WeekendSettleGrant | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs === undefined) return null
  /**
   * **先做一次夺回奖同步**（2026-09-27 修）：本函数**引擎每拍都会调**（幂等靠 `prizePaidAtWallMs`）
   * ⇒ 把同步放在 early-return **之前**，「已夺回却漏记」的场次（含已结算过的老档，如船长报障的第 1 场）
   * 会在下一次调用时被补记，再由下面的迟到补发真正入账。
   *
   * 🔴 **2026-09-29 船长令（乙案）后，这里成了全仓唯一的夺回奖记账点**：金额 = 全额 × 玩家在**该处**的
   * **最终**投入比例（`weekendReclaimAwardOf`），而"最终"只有结算拍才知道 ⇒ 战斗那一拍不再记账。
   * 传 `ev.endedAtWallMs` 保证比例取的是**结束时刻**的台账（与贡献占比/进度收入同一把尺）。
   */
  weekendSyncReclaimRewards(state, ev, ev.endedAtWallMs)
  if (ev.prizePaidAtWallMs !== undefined) {
    /**
     * **迟到补发**（幂等）：本场已经结算过，但上面那次同步又补记出了新的待到账（老档/报障场次）
     * ⇒ 立刻发掉并清零，玩家下次进游戏自动补齐。已记过标记的场次 `lateSync` 为空 ⇒ 直接返回。
     */
    const latePending = ev.reclaimPending ?? { isk: 0, wreck: 0 }
    if (latePending.isk > 0 || latePending.wreck > 0) {
      const wreckItemId = weekendRareWreckIdFor(weekendFoeCardOf(ev.family, 'flagship'), ctx)
      weekendGrantRewards(state, {
        isk: latePending.isk,
        wreck: latePending.wreck,
        ...(wreckItemId !== undefined ? { wreckItemId } : {}),
      })
      ev.reclaimPending = { isk: 0, wreck: 0 }
      state.weekendLastResult = weekendResultSnapshotOf(
        state,
        ctx,
        ev,
        ev.endedAtWallMs,
        weekendSettlePlanOf(state, ev, ev.endedAtWallMs),
        wreckItemId,
      )
    }
    return null
  }
  const plan = weekendSettlePlanOf(state, ev, ev.endedAtWallMs)
  const wreckItemId = weekendRareWreckIdFor(weekendFoeCardOf(ev.family, 'flagship'), ctx)
  /**
   * **这一次把"贡献奖 ＋ 待到账的夺回奖励"一起发**（2026-09-25 船长令：夺回奖励不即时发、结束统一发）。
   * ⚠ 台账 `rewardLedger` 在夺回那一刻**就已经记过**那几笔 ⇒ 这里只把 `plan`（贡献奖）记进台账，
   * 否则总数会被算两遍；`reclaimPending` 发完清零。
   */
  const pending = ev.reclaimPending ?? { isk: 0, wreck: 0 }
  /**
   * **结算时的"迟到补发"**（**2026-09-28 船长令改口径**）：本场**玩家已经击杀 BOSS**
   * （判据 = 单点 `weekendLastHitByPlayer`，留档优先）却**还没结清** ⇒ 在这里补上那一枚。
   * 之所以可能"击杀却没结清"：击沉那一刻的入账走 `weekendApplyBattleOutcome`，
   * 而活动可能在别的路径上先结束（章鱼人收尾 / 窗口到点）⇒ 结算这条路兜住它。
   * ⚠ 只走一遍：`prizePaidAtWallMs` 保证结算只发生一次。
   * ⚠ 旧判据是「台账里没有黑匣 ∧ 掷骰掷中了」——它依赖台账随档（2026-09-28 甲案才修好）；
   * 新判据只看**击杀 ＋ 未结清**，不再依赖台账，也就没有了"读档双发"那条老账。
   */
  const boxAtSettle = weekendLastHitByPlayer(ev) && !weekendBlackBoxSettledOf(ev)
  /** 补发也取**实际入账**结果（契约破损没落地 ⇒ 0，见 `weekendGrantRewards` 的 ⚠） */
  const boxGranted = boxAtSettle ? weekendGrantRewards(state, { blackBox: true }).blackBox : 0
  /** 真发出去了才写"已结清"（`flagshipBlackBox` 的新语义，见 `weekendBlackBoxSettledOf`） */
  if (boxGranted > 0) ev.flagshipBlackBox = true
  /**
   * **这一笔发三样**：贡献四档奖（`plan`）＋ 待到账的夺回奖励（`pending`）＋ **进度收入**（`plan.progressIsk`，
   * 船长 2026-09-25「按进度获取收入」）。
   */
  const granted = weekendGrantRewards(state, {
    isk: plan.isk + pending.isk + plan.progressIsk,
    wreck: plan.wreck + pending.wreck,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  ev.prizePaidAtWallMs = nowWallMs
  ev.reclaimPending = { isk: 0, wreck: 0 }
  /**
   * **按贡献占比发协会声望**（**2026-09-26 船长令**：「**玩家完成入侵后根据贡献获得一定量声望**」）。
   *
   * 口径 = `round(占比 × 15)`（单场 **0~15 点**）：占比 100% ⇒ 15 · 83% ⇒ 12 · 50% ⇒ 8 · 10% ⇒ 2 · 0% ⇒ 0。
   * 走 `noteStandingEarned` 唯一入口 ⇒ **两条账同时加**（可支配 ＋ 累计）。
   * ⚠ 与"贡献四档奖"同在一处（`prizePaidAtWallMs` 保证只走一遍）⇒ 声望也跟着**只发一次**。
   */
  const standing = weekendStandingGainOf(ev, plan.share)
  if (standing > 0) noteStandingEarned(state, DSI_FACTION_ID, standing)  /** 贡献奖与进度收入入账 ⇒ 记进到手台账，并**写本场战果快照**（面板与结算通讯读它） */
  /**
   * ⚠ **残骸只记"贡献奖那一份"**（`granted.wreck − pending.wreck`）——
   * 上面那两行注释早就警告过"总数会被算两遍"，只因以前 `pending` 恒为 0 从未暴露；
   * **2026-09-27 修夺回奖后 pending 真有钱了**，再写 `granted.wreck` 就会让台账多出夺回那一份
   * （实测：快照 1410 m³ vs 仓库实数 930 m³，差的就是夺回那 480）。
   * ISK 那半本来就只记 `plan`，无需改。
   */
  noteReward(ev, undefined, {
    isk: plan.isk + plan.progressIsk,
    wreck: Math.max(0, granted.wreck - pending.wreck),
    ...(boxGranted > 0 ? { blackBox: boxGranted } : {}),
  })
  state.weekendLastResult = weekendResultSnapshotOf(state, ctx, ev, ev.endedAtWallMs, plan, wreckItemId)
  return { share: plan.share, tier: plan.tier, isk: granted.isk, wreck: granted.wreck, progressIsk: plan.progressIsk }
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
 * - **稀有残骸与旗舰黑匣一律进「物品仓库」**（`addWare`）——**物品 id 由调用方按卡解析**
 *   （`weekendRareWreckIdFor`；缺省 = 不发，绝不发不存在的 id）；
 * - 返回值 = **实际入账的数量**（不是"想发的数量"）。
 *
 * ⚠ **2026-09-26 修（船长报障「报告显示拿到黑匣、玩家手里却没有」· 船长批「甲」）**：
 * 原先这两件走 `addItem` ⇒ 落进**当时驾驶的那条船的货舱**，而「物品」页只列仓库
 * （`ItemsPage` 只读 `state.warehouse.items`）⇒ 玩家在物品页**永远看不到**；货舱又只在"远征返航进港"
 * 那一刻才自动卸货（`unloadCargoOfShipToWarehouse`）⇒ 返航途中换船/损船就再也回不来。同 id 的黑匣
 * 从打捞回收那条路（`salvaging.ts` 的 `addWare`）本来就在仓库里 ⇒ 同一件东西两个落点，纯属实现走偏
 * （设计稿 Q4 的口径一直是「**黑匣入库**」）。现在统一入库，且**按真实结果记账**。
 *
 * ⚠ 幂等由调用方保证（`weekendResolveBattle` 的"夺回只发一次"已在那一层判过）。
 */
export function weekendGrantRewards(
  state: GameState,
  reward: { isk?: number; wreck?: number; blackBox?: boolean; wreckItemId?: string },
): { isk: number; wreck: number; blackBox: number } {
  const isk = Math.max(0, Math.round(reward.isk ?? 0))
  const wreckWant = Math.max(0, Math.round(reward.wreck ?? 0))
  if (isk > 0) state.wallet.isk += isk
  /** 稀有残骸：解析不到物品 id（契约破损）⇒ **不发也不记账**，并留一条 warn（原先静默吞掉） */
  let wreck = 0
  if (wreckWant > 0) {
    if (reward.wreckItemId !== undefined) {
      if (addWare(state, reward.wreckItemId, wreckWant)) wreck = wreckWant
    } else {
      addLog(state, 'warn', '⚠ 入侵战利品未能入库：本场奖励未发放。', 'core.weekend.038')
    }
  }
  /** **黑匣**（2026-09-25「先做壳」）：真物品入库（船长 2026-09-24 口径 = 击毁旗舰必掉 ×1） */
  let blackBox = 0
  if (reward.blackBox && addWare(state, WEEKEND_BLACKBOX_ITEM_ID, 1)) blackBox = 1
  return { isk, wreck, blackBox }
}

/* ─────────────── 战斗结束 → 入侵结算（M1-b 第六片） ─────────────── */

/**
 * **这一场遭遇是不是"旗舰挑战"**（遭遇槽里挂的正是该族**旗舰卡**、且星系 = 本场核心）——
 * **唯一判据点**：遭遇系统的归属提示（`weekendKindOfEncounter`）与战斗界面的宿主解析
 * （`weekendLaunch.weekendFlagshipBattleViewOf`）都读它，免得两处各写一份判据。
 *
 * ⚠ 判据**不含**"活动是否已结束"：入侵结束那一刻若玩家正打得兴起，这一场照常打完
 * （战斗界面也得继续认它，否则会变成一场"看不见的战斗"）。
 */
export function weekendFlagshipEncounterOf(
  state: Pick<GameState, 'weekendEvent' | 'encounter'>,
  enc: Pick<GameState['encounter'], 'galaxyId' | 'anomalyId'>,
): boolean {
  const ev = state.weekendEvent
  if (!ev) return false
  return (
    enc.galaxyId === ev.coreId &&
    enc.anomalyId !== null &&
    enc.anomalyId === weekendFoeCardOf(ev.family, 'flagship')
  )
}

/**
 * **记下"玩家亲手击沉旗舰"这一事实**（**2026-09-27 船长令**：「开关不能挂旗舰身上吗？旗舰爆炸开启。」
 * ＋「和入侵结束的报告一样，留档玩家的旗舰战记录。直到下一次入侵开始时覆盖清空。」）。
 *
 * **触发制**（同日船长问「为什么不能使用触发制」的落点）：不在这里判血、不在这里扫层——
 * 事实由 `combat.applyFoeUnitDamage`（敌舰伤害唯一收口）在**母舰单位三层血清零那一发**落进
 * `BattleState.bossDownAtMs`；本函数只是把它**抄进场次记录**（读一个标记）。
 *
 * 幂等：同一场只写一次；已有记录不覆盖。换场清空靠事件对象本身（新的一场是全新对象）。
 *
 * @returns 真的新记了一笔才 `true`
 */
export function weekendNoteFlagshipPlayerKill(
  state: GameState,
  battle: import('./state').BattleState,
  nowWallMs: number,
): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  const down = battle.bossDownAtMs
  if (down === undefined || !Number.isFinite(down)) return false
  if (ev.flagshipPlayerKill !== undefined) return false
  ev.flagshipPlayerKill = {
    atWallMs: nowWallMs,
    runId: battle.startedAtGameMs,
    ...(battle.waveIdx !== undefined ? { waveIdx: battle.waveIdx } : {}),
    downAtGameMs: down,
  }
  return true
}

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
  /**
   * **这一场远征记下的"打的哪个星系"**（2026-09-25 · 周末入侵接线）：
   * H 族独立卡自带母港 `galaxyId` ⇒ 只看卡认不出被占区（会让战后归属与**残骸注入**算到母港）。
   * 引擎出发时把界面上那张卡的星系写进 `expedition.foeGalaxyId` ⇒ 这里优先读它；
   * 缺省/不合法（非活的占领区）⇒ 逐字回落老口径（卡的 `galaxyId` + 遭遇槽）。
   */
  const expGalaxy = state.expedition?.foeGalaxyId
  if (expGalaxy !== undefined && weekendOccupiedLiveAt(state, expGalaxy, nowWallMs)) {
    const flagship = expGalaxy === ev.coreId && weekendCoreProgressAt(state, ev, nowWallMs) >= 1
    return { galaxyId: expGalaxy, kind: flagship ? 'flagship' : 'assault' }
  }
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
 * **归属提示**（调用方"自己知道这一场是什么"时显式传入，免得靠状态反推）：
 *
 * 起因（2026-09-25 实测）：遭遇槽在收尾时**先被 `settleFight` 清掉**，`weekendBattleInvolvedOf`
 * 再去读 `state.encounter` 就什么都读不到 ⇒ **迎战打赢的遇袭一分进度都不给**（注释却写着 +3%）。
 * 而"主动出击"走远征（远征槽里可能残留上一趟的 `foeGalaxyId`）⇒ 只靠状态反推既漏又可能串。
 */
export interface WeekendOutcomeHint {
  /** 这一场是哪一类（遭遇槽 = 伏击 / 旗舰挑战；远征 = 主动出击） */
  kind: WeekendBattleKind
  /** 这一场打的是哪个星系 */
  galaxyId: string
  /**
   * 结算来源：`battle` = **迎战打完**（缺省）· `text` = **文字三档结算**（无人应答超时 / 快速脱离 / 离线自动）。
   * 遇袭击退的进度按设计稿分两档：**主动击退 +3% · 离线自动结算击退 +1%**。
   */
  source?: 'battle' | 'text'
}

/**
 * **战后一口气结算**（引擎在"这一场打完了"那一拍调用）：
 * 判归属 → 取 spec → `weekendResolveBattle` → **奖励真正入账**（ISK 进钱包、稀有残骸进仓库）。
 * 返回 null = 这一场与入侵无关（引擎什么都不用做）。
 *
 * `hint` 给了 `kind` + `galaxyId` ⇒ **直接采信**（遭遇系统与远征系统都准确地知道自己在打什么）；
 * 不给 ⇒ 按 `weekendBattleInvolvedOf` 从状态反推（老调用方逐字不变）。
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
  hint?: WeekendOutcomeHint,
): { galaxyId: string; kind: WeekendBattleKind; gain: number; isk: number; wreck: number; note: string } | null {
  const involved: { galaxyId: string; kind: WeekendBattleKind } | undefined = (() => {
    const ev = state.weekendEvent
    if (hint === undefined || ev === undefined || ev.endedAtWallMs !== undefined || hint.galaxyId.length === 0) {
      return weekendBattleInvolvedOf(state, ctx, anomalyId, nowWallMs)
    }
    /**
     * 提示的**有效性闸门**：伏击要求该星系是活的占领区；旗舰要求"星系 = 本场核心"。
     * ⚠ 旗舰**不能**套"活的占领区"这条 —— 核心条满正是旗舰现身的前提，那一刻 `weekendOccupiedLiveAt`
     * 已经为假（进度 = 1）⇒ 套上去会把旗舰战打回"什么都不结算"（2026-09-24 那个 bug 的翻版）。
     */
    if (hint.kind === 'flagship') {
      return hint.galaxyId === ev.coreId ? { galaxyId: hint.galaxyId, kind: 'flagship' } : undefined
    }
    return weekendOccupiedLiveAt(state, hint.galaxyId, nowWallMs)
      ? { galaxyId: hint.galaxyId, kind: hint.kind }
      : undefined
  })()
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
  /**
   * **胜负 → 进度档**（设计稿「玩家推进」：主动胜利 外围 +5% / 核心 +5% · **主动击退遇袭 +3%** ·
   * **离线自动结算击退 +1%** · 战败只受损、进度不动）。
   *
   * ⚠ 2026-09-25 修（原式 `victory || bossDown ? 'win' : (ambush ? 'repel' : 'loss')` **两头都反了**）：
   * 遇袭打赢被记成"主动胜利"（+5% 而不是 +3%），遇袭打输却被记成"击退"（+3% 而不是 0）。
   * 现在按 `kind` 分流：**伏击**看 `victory`（赢 = 击退 · 输 = 战败），**主动出击**赢 = 胜利、输 = 战败；
   * 文字结算（`hint.source === 'text'`）的击退走 **+1%** 那一档。
   */
  const outcome: WeekendOutcome = bossDown
    ? 'win'
    : involved.kind === 'ambush'
      ? victory
        ? hint?.source === 'text'
          ? 'offlineRepel'
          : 'repel'
        : 'loss'
      : victory
        ? 'win'
        : 'loss'
  const r = weekendResolveBattle(state, ctx, spec, outcome, nowWallMs, flagshipDmg, battle?.startedAtGameMs)
  /**
   * **卡的稀有残骸掉落**（**2026-09-27 船长令**：「**主力舰队添加一个稀有残骸掉落**」＋追问落点答
   * 「**进残骸场**」）。
   *
   * 落点 = **该星系的入侵残骸场**（`weekendWrecks.rare/rareBy`）⇒ 打捞时**稀有池优先、本轮必出一件**
   * （物品 = 该卡所属组的稀有残骸，主力舰队即 `wreck-rare-h-hi`）。
   *
   * 口径（本次一并定下）：
   * - **认"这一场实际打的那张卡"**（`anomalyId`，`wk-` 前缀先剥掉），**不是** `spec.cardId` ——
   *   出击/遇袭的 spec 是按池子**另抽**的，只有 `anomalyId` 才是玩家真正打赢的那支舰队；
   * - **只有战斗打赢算**：主动出击全歼（`win`）与迎袭击退（`repel`）都算；
   *   **文字结算**（`offlineRepel`：离线 / 无人应答自动结算）与失利（`loss`）**不算**；
   * - **不设每场上限**（船长同日令）；
   * - 落账按**打它的那张卡**记账 ⇒ 打捞时据此归族取箱子。
   */
  const foughtCardId =
    typeof anomalyId === 'string' && anomalyId.startsWith(WEEKEND_CARD_PREFIX)
      ? anomalyId.slice(WEEKEND_CARD_PREFIX.length)
      : typeof anomalyId === 'string'
        ? anomalyId
        : ''
  const rareDrop = foughtCardId.length > 0 ? (ctx.anomalies.get(foughtCardId)?.rareWreckDrop ?? 0) : 0
  if (rareDrop > 0 && (outcome === 'win' || outcome === 'repel')) {
    injectWeekendRareWreck(state, involved.galaxyId, foughtCardId, rareDrop)
    const gnameDrop = ctx.galaxies.get(involved.galaxyId)?.name ?? involved.galaxyId
    addLog(
      state,
      'trade',
      `✦ 击退「${gnameDrop}」的入侵舰队：残骸场里留下 ${rareDrop} 具稀有残骸 —— 可前往该星系打捞（回站用回收炉解体可得额外战利品）。`,
      'core.weekend.043',
      { p1: gnameDrop, p2: rareDrop },
    )
  }
  /**
   * **即时发放的只有"旗舰掉落"**（2026-09-25 船长令：「**夺回星区的奖励不要即时发放，放入结束后结算发放**」）：
   * 夺回奖励（逐处 ×8 ＋ 2M · 全清追加 5M）**只记台账**，等 `weekendSettleAndGrant` 在活动结束时连贡献奖一起发
   * （⇒ 玩家在结算通讯/结算面板里一次看清全部到手；见 `ev.reclaimPending`）。
   * ⚠ 旗舰击沉发生在**活动结束那一刻**，它的掉落仍即时入账（那之后玩家已经没有"下一次"可言）。
   */
  const isk = 0
  const wreck = r.flagshipKilled?.wreck ?? 0
  // **稀有残骸的真实物品 id**：按这一场打的那张卡所属残骸组取（H 族 ⇒ `wreck-rare-h-hi`）
  const wreckItemId = weekendRareWreckIdFor(spec.cardId, ctx)
  const granted = weekendGrantRewards(state, {
    isk,
    wreck,
    /** 黑匣：**这一场是"击沉旗舰"那一支 ⇒ 必给 1 枚**（2026-09-28 船长令「击杀BOSS就能获得黑匣」） */
    blackBox: r.flagshipKilled !== undefined,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  /**
   * **入账日志**（2026-09-25 补 · id 制）：只记**里程碑** —— 夺回 / 全部夺回 / 旗舰击沉。
   * ⚠ 2026-09-25 船长改口径后，夺回那两条日志**不再说"已入账"**（钱要到活动结束才发）——
   * 它们改说「待结算时统一发放」，措辞见 `core.weekend.001/002`。
   */
  const gname = ctx.galaxies.get(involved.galaxyId)?.name ?? involved.galaxyId
  /**
   * 到手台账（夺回按星系记、旗舰掉落记全局）——结算面板与结算通讯的奖励清单读它，不另算一遍；
   * **夺回那部分另记进 `reclaimPending`**，等 `weekendSettleAndGrant` 一次性发放（船长令：不即时发）。
   */
  const evNow = state.weekendEvent
  if (evNow !== undefined) {
    /**
     * **夺回奖不在这里记**（**2026-09-29 船长令 · 乙案**）：金额 = 全额 × 玩家在**该处**的最终投入比例，
     * 而"最终"要到结算才知道 ⇒ 记账收口在**结算那一拍**（`weekendSettleAndGrant` 的幂等早退之前）。
     * ⚠ 这里原先那次 `weekendSyncReclaimRewards` 调用已删除：它会在"打完这一拍"按**当时**比例记账，
     * 之后玩家再为该处出力也补不回来（同一行为算出不同奖励），且与结算拍的口径会打架。
     */
    if (r.flagshipKilled !== undefined) {
      /**
       * 台账记的是**实际入账**的那一份（`granted`），不是"应该发的那一份"（`r.flagshipKilled`）——
       * 2026-09-26 船长批「甲」的第②条：没真发出去时**不许**记「已获得」，
       * 否则结算面板/结算通讯又会显示玩家手里没有的东西（账实分离）。
       */
      noteReward(evNow, undefined, { wreck: granted.wreck, blackBox: granted.blackBox })
      /** 真发出去了 ⇒ 写"已结清"（`flagshipBlackBox` 的新语义；结算与补发工具都靠它幂等） */
      if (granted.blackBox > 0) evNow.flagshipBlackBox = true
    }
  }
  if (r.reclaimed !== undefined) {
    /**
     * **夺回那两条日志不再报金额**（**2026-09-29 船长令 · 乙案**）：金额 = 全额 × 玩家在该处的
     * **最终**投入比例，夺回这一刻算不出（他后面还能继续为这处出力）⇒ 文案只写规格，数额到
     * **结算面板 / 结算通讯**里逐处列明（那两处读的是实发台账）。⚠ 旧的 `p2/p3` 参数已删除。
     */
    if (r.reclaimed.allClear) {
      addLog(
        state,
        'trade',
        `✦ 全部占领区夺回：「${gname}」是最后一处 —— 夺回奖励与全清额外奖励按玩家的投入比例结算，活动结束时统一发放。`,
        'core.weekend.002',
        { p1: gname },
      )
    } else {
      addLog(
        state,
        'trade',
        `✦ 夺回「${gname}」：夺回奖励按玩家在该星系的投入比例结算，活动结束时统一发放。`,
        'core.weekend.001',
        { p1: gname },
      )
    }
  }
  if (r.flagshipKilled !== undefined) {
    /**
     * 黑匣**爆或不爆**分两条文案（2026-09-25 船长令改爆率后，"必掉黑匣"不再成立）；
     * 件数一律取**实际入账**的 `granted`，落点写明「物品仓库」（船长 2026-09-26 批「甲」第④条：
     * 原先只说"战利品已入账"，玩家会去货舱里找）。
     *
     * 🔴 **2026-09-27 船长令（措辞分档）**：「**只记录作为判定，根据不同情况改变措辞**（玩家只抢最后一下
     * 但是没多少输出就说玩家参与度过低……）」⇒ 两条文案都点明**是玩家击沉的**；未爆那一条**把占比写出来**
     * （`{p2}`，走 `weekendFlagshipSharesOf` 的玩家优先口径），让玩家明白是"输出占比未过半"而不是被系统吞了。
     */
    const box = granted.blackBox
    const sharePct = Math.round(weekendFlagshipSharesOf(evNow).player * 100)
    addLog(
      state,
      'trade',
      box
        ? `✦ 玩家击沉入侵旗舰：母舰血量归零 —— 旗舰黑匣 ×1 ＋ 稀有残骸 ×${granted.wreck} 已存入物品仓库。`
        : `✦ 玩家击沉入侵旗舰：母舰血量归零 —— 稀有残骸 ×${granted.wreck} 已存入物品仓库；玩家输出占比 ${sharePct}% 未过半，旗舰黑匣未爆。`,
      box ? 'core.weekend.003' : 'core.weekend.016',
      { p1: granted.wreck, p2: sharePct },
    )
  }
  return { galaxyId: involved.galaxyId, kind: involved.kind, gain: r.progressGain, isk: granted.isk, wreck: granted.wreck, note: r.note }
}
