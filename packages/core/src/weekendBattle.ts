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
  WEEKEND_FLAGSHIP_POOL_HP,
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
  WEEKEND_GAIN_CORE_WIN,
  WEEKEND_GAIN_OFFLINE_REPEL,
  WEEKEND_GAIN_PERIPHERY_WIN,
  WEEKEND_GAIN_REPEL,
  weekendWinGainOf,
  /** 2026-09-25 船长令：黑匣爆率按"输出占比 ＋ 抢没抢到最后一下"掷（结果写 `ev.flagshipBlackBox`） */
  weekendRollBlackBox,
} from './weekendEvent'
import type { WeekendEventState, WeekendResultSnapshot } from './weekendEvent'
import { WEEKEND_STANDING_MAX } from './weekendEvent'
import { flagshipBattleLedger } from './combat'
import { rareWreckItemIdOfCard, RARE_WRECK_VOLUME_M3 } from './salvage'
import { WEEKEND_CARD_PREFIX, weekendOccupiedLiveAt } from './weekendBounty'
import { DSI_FACTION_ID, noteStandingEarned } from './expedition'

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
  /** 击毁旗舰 ⇒ 黑匣（**按爆率表掷出来的结果**，可能不爆）＋ 稀有残骸（必给） */
  flagshipKilled?: { blackBox: boolean; wreck: number }
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
  /** 本场**开打前**该星系的进度读数（% —— 只给下面那条"夺回进度 a% → b%"反馈文案用；与 `weekendProgressAt` 同源） */
  const beforePct = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100
  /** 本场是否被**核心门禁**挡下（只有核心、且外围没清完、且核心读数还停在 0）——给反馈文案分流用 */
  let gatedThisBattle = false
  let gain = 0
  if (outcome === 'win') {
    /** 主动胜利的推进量：**调试模式 = +50%（两场收复，船长令）**；正常 = 外围 10% / 核心 5% */
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
       * **黑匣爆率**（船长 2026-09-25 令）：玩家**抢到最后一下** ⇒ 按输出占比掷（> 50% 必爆）；
       * **残骸照旧必给**（船长同日四答之三："残骸不变"）。掷骰走 `ev.flagshipBlackBox`（一条场次子流，
       * 读档重打同一场结果相同）。
       * ⚠ **只有 BOSS 族（有共享血池、才谈得上"输出占比"）才掷**；A/C/G 那些占位卡没有池子 ⇒
       * 保持老口径"击沉必掉"（`true`），免得把占位口径也改成掷骰。
       */
      const box = weekendIsBossFamily(ev) ? weekendRollBlackBox(state, ev, true) : true
      res.flagshipKilled = { blackBox: box, wreck: weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK) }
      res.note = bossDown
        ? `旗舰血量归零：击沉（跨场累计）${box ? '· 黑匣入手' : '· 黑匣未爆'}`
        : `旗舰被击毁：战利品归玩家${box ? '（含黑匣）' : '（黑匣未爆）'}`
      return res
    }
  }

  // 夺回：这一次越过 100% ⇒ 发一次奖励（用"打之前没满、打之后满"判据 ⇒ 天然幂等）
  if (!wasReclaimed && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1) {
    const allClear = weekendOccupiedIds(ev).every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
    res.reclaimed = {
      galaxyId: spec.galaxyId,
      wreck: weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK),
      isk: WEEKEND_RECLAIM_ISK + (allClear ? WEEKEND_ALL_CLEAR_ISK : 0),
      allClear,
    }
    res.note = allClear ? '全部占领区夺回：额外奖励入账' : '该星系夺回'
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
    const gname0 = _ctx.galaxies.get(spec.galaxyId)?.name ?? spec.galaxyId
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
     * **黑匣是否归玩家**（2026-09-25 改口径：爆率按"输出占比 ＋ 抢没抢到最后一下"掷，
     * 见 `weekendEvent.weekendBlackBoxChanceOf`）⇒ 判据改成**掷骰结果** `ev.flagshipBlackBox`
     * —— 章鱼人得手也可能爆（`25% × 输出占比`），玩家击沉也可能不爆（小幅输出那一档）。
     */
    blackBoxToPlayer: ev.flagshipBlackBox === true,
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
 */
function noteReward(
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
  const flagshipOutcome: WeekendResultSnapshot['flagshipOutcome'] =
    ev.flagshipDown === 'player' ? 'player' : ev.flagshipDown === 'octopus' ? 'octopus' : 'window'
  /**
   * `defeated` = **这面「已击沉 / 未击沉」的判据与黑匣同源**（＝`flagshipDown === 'player'`）。
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
  const flagship = hpMax !== undefined ? { hpMax, hpDone, defeated: flagshipOutcome === 'player' } : undefined
  void ctx // 目前不需要 ctx（星系名由界面现查）；保留参数位以免将来解析物品时改签名
  /**
   * **本期入侵按贡献获得的协会声望**（**2026-09-26 船长令**：「关于入侵的结算界面和结束通讯处，
   * 需要提及玩家获得了多少声望」）——**与实发同源**：同一条公式 `round(占比 × 15)`，
   * 结算那一拍（`weekendSettleAndGrant`）用它发、快照用它写 ⇒ 面板与信件上的数 = 真正加进账的数。
   */
  const standingGain = Math.round(plan.share * WEEKEND_STANDING_MAX)
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
  if (ev.prizePaidAtWallMs !== undefined) return null
  const plan = weekendSettlePlanOf(state, ev, ev.endedAtWallMs)
  const wreckItemId = weekendRareWreckIdFor(weekendFoeCardOf(ev.family, 'flagship'), ctx)
  /**
   * **这一次把"贡献奖 ＋ 待到账的夺回奖励"一起发**（2026-09-25 船长令：夺回奖励不即时发、结束统一发）。
   * ⚠ 台账 `rewardLedger` 在夺回那一刻**就已经记过**那几笔 ⇒ 这里只把 `plan`（贡献奖）记进台账，
   * 否则总数会被算两遍；`reclaimPending` 发完清零。
   */
  const pending = ev.reclaimPending ?? { isk: 0, wreck: 0 }
  /**
   * **章鱼人得手那一档的黑匣补发**（船长 2026-09-25 令 ＋ 四答之二"照发"）：
   * 玩家没抢到最后一下时，黑匣按 `25% × 输出占比` 掷（掷骰在 `weekendTick` 收口那一拍，结果写进
   * `ev.flagshipBlackBox`）；玩家击沉那一档已由 `weekendApplyBattleOutcome` 即时发过 ⇒ 这里只在
   * **台账还没有黑匣**（`led.blackBox === 0`）且掷中时补发一次（`prizePaidAtWallMs` 保证只走一遍）。
   */
  const boxAtSettle = (ev.rewardLedger?.blackBox ?? 0) === 0 && ev.flagshipBlackBox === true
  /** 补发也取**实际入账**结果（掷中但没落地 ⇒ 台账照旧 0，见 `weekendGrantRewards` 的 ⚠） */
  const boxGranted = boxAtSettle ? weekendGrantRewards(state, { blackBox: true }).blackBox : 0
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
  const standing = Math.round(plan.share * WEEKEND_STANDING_MAX)
  if (standing > 0) noteStandingEarned(state, DSI_FACTION_ID, standing)  /** 贡献奖与进度收入入账 ⇒ 记进到手台账，并**写本场战果快照**（面板与结算通讯读它） */
  noteReward(ev, undefined, { isk: plan.isk + plan.progressIsk, wreck: granted.wreck, ...(boxGranted > 0 ? { blackBox: boxGranted } : {}) })
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
   * **胜负 → 进度档**（设计稿「玩家推进」：主动胜利 外围 +10% / 核心 +5% · **主动击退遇袭 +3%** ·
   * **离线自动结算击退 +1%** · 战败只受损、进度不动）。
   *
   * ⚠ 2026-09-25 修（原式 `victory || bossDown ? 'win' : (ambush ? 'repel' : 'loss')` **两头都反了**）：
   * 遇袭打赢被记成"主动胜利"（+10% 而不是 +3%），遇袭打输却被记成"击退"（+3% 而不是 0）。
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
    /** 黑匣**按爆率表掷出来的结果**给（2026-09-25 船长令：>50% 输出抢到最后一下必爆；否则按占比衰减） */
    blackBox: r.flagshipKilled?.blackBox === true,
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
    if (r.reclaimed !== undefined) {
      noteReward(evNow, involved.galaxyId, { isk: WEEKEND_RECLAIM_ISK, wreck: r.reclaimed.wreck })
      noteReclaimPending(evNow, { isk: WEEKEND_RECLAIM_ISK, wreck: r.reclaimed.wreck })
      /** 全清那 5M 记进**全局**（不带星系）⇒ 面板的逐星系那一列不会被它撑歪 */
      if (r.reclaimed.allClear) {
        noteReward(evNow, undefined, { isk: WEEKEND_ALL_CLEAR_ISK })
        noteReclaimPending(evNow, { isk: WEEKEND_ALL_CLEAR_ISK })
      }
    }
    if (r.flagshipKilled !== undefined) {
      /**
       * 台账记的是**实际入账**的那一份（`granted`），不是"掷出来的那一份"（`r.flagshipKilled`）——
       * 2026-09-26 船长批「甲」的第②条：掷中却没发出去时**不许**记「已获得」，
       * 否则结算面板/结算通讯又会显示玩家手里没有的东西（账实分离）。
       */
      noteReward(evNow, undefined, { wreck: granted.wreck, blackBox: granted.blackBox })
    }
  }
  if (r.reclaimed !== undefined) {
    const allClearIsk = (WEEKEND_RECLAIM_ISK + (r.reclaimed.allClear ? WEEKEND_ALL_CLEAR_ISK : 0)).toLocaleString('zh-CN')
    if (r.reclaimed.allClear) {
      addLog(
        state,
        'trade',
        `✦ 全部占领区夺回：「${gname}」是最后一处 —— 夺回奖励与全清额外奖励共 稀有残骸 ×${r.reclaimed.wreck} ＋ ${allClearIsk} 信用点，待活动结束时统一发放。`,
        'core.weekend.002',
        { p1: gname, p2: r.reclaimed.wreck, p3: allClearIsk },
      )
    } else {
      addLog(
        state,
        'trade',
        `✦ 夺回「${gname}」：夺回奖励 稀有残骸 ×${r.reclaimed.wreck} ＋ ${WEEKEND_RECLAIM_ISK.toLocaleString('zh-CN')} 信用点，待活动结束时统一发放。`,
        'core.weekend.001',
        { p1: gname, p2: r.reclaimed.wreck, p3: WEEKEND_RECLAIM_ISK.toLocaleString('zh-CN') },
      )
    }
  }
  if (r.flagshipKilled !== undefined) {
    /**
     * 黑匣**爆或不爆**分两条文案（2026-09-25 船长令改爆率后，"必掉黑匣"不再成立）；
     * 件数一律取**实际入账**的 `granted`，落点写明「物品仓库」（船长 2026-09-26 批「甲」第④条：
     * 原先只说"战利品已入账"，玩家会去货舱里找）。
     */
    const box = granted.blackBox
    addLog(
      state,
      'trade',
      box
        ? `✦ 入侵旗舰击沉：母舰血量归零 —— 战利品已存入物品仓库（旗舰黑匣 ×1 ＋ 稀有残骸 ×${granted.wreck}）。`
        : `✦ 入侵旗舰击沉：母舰血量归零 —— 战利品已存入物品仓库（稀有残骸 ×${granted.wreck}；旗舰黑匣未爆）。`,
      box ? 'core.weekend.003' : 'core.weekend.016',
      { p1: granted.wreck },
    )
  }
  return { galaxyId: involved.galaxyId, kind: involved.kind, gain: r.progressGain, isk: granted.isk, wreck: granted.wreck, note: r.note }
}
