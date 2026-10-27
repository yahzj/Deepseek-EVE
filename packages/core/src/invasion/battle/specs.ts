/** 功能域职责拆分，保持原计算与顺序。 */
import type { SimContext } from '../../types'
import type { GameState } from '../../state'
import { weekendGarrisonFoeCardId, weekendFoeCardsSelfPriced, WEEKEND_CORE_THREAT, WEEKEND_PERIPHERY_THREAT, weekendFoeFleetNameOf, weekendAmbushPickOf, weekendCoreProgressAt, weekendFoeCardOf, type WeekendEventState, weekendIsBossFamily, weekendZoneLiveAt, WEEKEND_CARD_PREFIX } from '../../weekendEvent'

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

export const WEEKEND_FLAGSHIP_REWARD_MUL = 3

/** 主动出击的赏金倍率（外围） */
export const WEEKEND_ASSAULT_REWARD_MUL = 1.4

export function cardNameOf(ctx: SimContext, cardId: string): string {
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
  battle: import('../../state').BattleState,
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
 * **"出击"这一场算哪一类场次**（＝结算走哪一套奖励）——**单点**，`weekendBattleInvolvedOf` 两条路读它。
 *
 * 🔴 **2026-10-02 本批改写**（船长令：「我希望的是 **100% 后能够继续刷**，但是掉落残骸数量需要减半作为惩罚」）：
 * 改前判据是 `该星系 = 核心 && 核心进度满 ⇒ 'flagship'`。入口放开（`weekendZoneLiveAt` 不再看进度）之后，
 * 那条会把"**已夺回的核心继续刷**"整批误判成**旗舰战** ⇒ 每场按旗舰掉落发（`WEEKEND_FLAGSHIP_WRECK = 3` 件
 * 稀有残骸），而船长的另一半令是"**不给其他奖励**"（继续刷只有半量残骸）。
 * ⇒ 现口径：
 *  · **BOSS 族**（`weekendIsBossFamily`：母舰走共享血池那一族，现 H／将 R）⇒ 出击**一律 `'assault'`**
 *    （旗舰战只认"遭遇槽里挂的正是该族旗舰卡"那一条，见 `weekendBattleInvolvedOf` 的 `enc` 分支）；
 *  · **非 BOSS 族**（A/C/G 的占位口径）⇒ **老口径逐字保留**（核心满 ⇒ 旗舰战），不动未上线族的行为。
 */
export function expeditionKindAt(
  state: GameState,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): WeekendBattleKind {
  if (weekendIsBossFamily(ev)) return 'assault'
  return galaxyId === ev.coreId && weekendCoreProgressAt(state, ev, nowWallMs) >= 1 ? 'flagship' : 'assault'
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
  if (expGalaxy !== undefined && weekendZoneLiveAt(state, expGalaxy, nowWallMs)) {
    return { galaxyId: expGalaxy, kind: expeditionKindAt(state, ev, expGalaxy, nowWallMs) }
  }
  const rawId = typeof anomalyId === 'string' && anomalyId.length > 0 ? anomalyId : undefined
  if (rawId !== undefined) {
    const baseId = rawId.startsWith(WEEKEND_CARD_PREFIX) ? rawId.slice(WEEKEND_CARD_PREFIX.length) : rawId
    const card = ctx.anomalies.get(baseId)
    const galaxyId = card?.galaxyId
    if (galaxyId !== undefined && weekendZoneLiveAt(state, galaxyId, nowWallMs)) {
      return { galaxyId, kind: expeditionKindAt(state, ev, galaxyId, nowWallMs) }
    }
  }
  const enc = state.encounter
  if (enc.active && enc.galaxyId) {
    /**
     * **旗舰战**：判据 = "遭遇槽里挂的正是该族**旗舰卡** + 星系 = 本场核心"——旗舰战就是引擎
     * 「挑战旗舰」写进遭遇槽的那一场。
     * ⚠ 2026-09-25 修过一次：当时 `weekendZoneLiveAt`（旧名 `weekendOccupiedLiveAt`）要求进度 < 1，
     * 而**核心条满正是旗舰现身的前提** ⇒ 这条恒假、旗舰战打完全都不结算。
     * ⚠ 2026-10-02 起"看进度"那一句已从谓词里删掉（夺回不再关门）⇒ 本分支照旧成立，且与"已夺回
     * 的核心去刷普通舰队算 assault"互不干扰（后者走上面两条远征/卡面路径）。
     */
    if (enc.anomalyId !== null && enc.anomalyId === weekendFoeCardOf(ev.family, 'flagship') && enc.galaxyId === ev.coreId) {
      return { galaxyId: ev.coreId, kind: 'flagship' }
    }
    if (weekendZoneLiveAt(state, enc.galaxyId, nowWallMs)) {
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
