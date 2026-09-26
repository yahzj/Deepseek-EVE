/**
 * 远征（M3 + V12 两阶段 + 2026-09-06"完成即返航"语义）：派舰船去远方星系的异常点。
 * 流程 = 去程取消（定稿：下达即开战，无出航等待）→ 实时交火(battle) →
 * （胜利 = 结算后自动返航 back，返航 = 目标星系↔母港 2×单程、不可召回；
 *   失利/撤退 = 自动返航 back，返航时长 = 出发地往返 2×单程、可召回）。
 * 交火由 V12 战斗引擎（combat.ts）确定性推进；离线大步长与在线小步同引擎。到点语义：
 * - out：仅兼容旧档/遗留状态（历史去程相位；finishAtGameMs = 到港时刻）；
 * - battle：无固定结束时刻；结束由战斗引擎判定（battle.ended），结算后：
 *   胜 → 奖金/战利品/声望入账 + 悬赏冷却开始，随即转 back（returnReason='victory'）；
 *   负 → 转 back 自动返航（维修/弃船按既有惩罚在结算时发生，returnReason='defeat'）
 * - back：finishAtGameMs = 到家时刻（去程并入返航），到点 active=false；
 *   胜利返航不可召回（召回入口拒绝），失利/撤退返航可召回（即时回港）
 */
import { weekendApplyBattleOutcome, weekendBattleInvolvedOf, weekendFlagshipEncounterOf } from './weekendBattle'
import { weekendFoeCardOf } from './weekendEvent'
import { weekendAssaultThreatOf, weekendFoeCardsSelfPriced } from './weekendEvent'
/** 入侵「重复出击」（2026-09-25 船长令）：每场重抽一支 ＋ 目标星系覆写（去程/返航照常算） */
import { weekendAssaultDrawOf, weekendBountyCardsOf, weekendNoteAssaultDispatch, weekendOccupiedLiveAt } from './weekendBounty'
import { rewardMulOf } from './tuning'
import { bumpFirst } from './firstTasks'
import { addLog, HOME_GALAXY_ID, shipLockedInWormhole } from './state'
import { applyActivityGate } from './activityGate'
import type { CommandResult } from './engine'
import type { GameState, BattleState } from './state'
import type { AnomalyDef, SimContext, TravelEventDef } from './types'
import { nextInt, nextRandom, pickOne, pickWeighted } from './rng'
import { addItem, cargoUnitM3, freeCargoM3, unloadCargoOfShipToWarehouse } from './inventory'
import { applyArmorFirstDamage, firepowerHitHp, hitDamageText, type HullHit } from './hullDamage'
import { loseShip, pilotUnavailableReason, repairWithKits } from './shipyard'
import { fleetDefOf, shipDisplayName } from './instances'
import { formatDurationMs } from './time'
import { originGalaxyOf, nearestStationGalaxyId, builtSiteAtGalaxy } from './location'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { RETURN_LEG_MUL } from './balance'
import { asFoeFamily, bountyEnemyCount, bountyWreckInjection, injectWeekendWreck, injectWreckDensity, weekendWreckDensityOf, weekendWreckInjectionOf, wreckDensityOf, wreckInjectThreatOf } from './salvage'
import {
  activeFoeSpecsOf,
  advanceBattleFor,
  battleClockNowMs,
  battleMaxDistanceM,
  battleOpenM,
  battleShowWindowMs,
  bountyWinPercentGuarded,
  createFoeSpecs,
  createPlayerSpec,
  desiredRangeFor,
  foeDesiredRange,
  foeRangeDebuffOf,
  meFoeRangeDebuffOf,
  persistFleetHullDamage,
  refundAmmo,
  refundRepairKitsAll,
  repairUsageText,
  dcUsageText,
  setDesirePrefOf,
  settleDroneLosses,
  startBattleFor,
  // 战报改造（2026-09-14 船长定）：结构化战报的唯一构造点
  captureBattleReport,
  // 洞内战：距离上限与开战同源（2026-09-13 修洞内距离被锁死）
  wormholeDerivedAnomaly,
} from './combat'
import { actionBlockReason, markExplored } from './explore'
import { familyModules } from './equipment'
import {
  FACTION_RARE_DROP_CHANCE,
  FACTION_RARE_DROP_COUNT,
  FACTION_RARE_DROP_PITY_ROLLS,
  factionAnomalyOf,
  factionBaseRewardIsk,
  /** 2026-09-24：掷骰与**卡面/工具读数**共用这一处口径（含限时倍率与铁人 ×1.2） */
  factionRareDropChanceOf,
  isLairCandidate,
  lairAnomalyOf,
  lairBaseRewardIsk,
  lairNameOf,
  LAIR_RARE_WRECK_GAIN,
} from './lairs'
import type { LairTier } from './lairs'
import { injectRareWreck } from './salvage'
import { isFactionBounty, settleBountyTaskVictory } from './sideTasks'

/** 母港星系 id（内容层约定；与 state.HOME_GALAXY_ID 同值，经此转发保持既有 import 面不变） */
export { HOME_GALAXY_ID }

/** 本地悬赏返航段（2026-09-08 船长定）：目标星系 = 返航基准（母港本地/建成站本地）时，
 * 返港固定 120s（= balance.mining.localLegMs 本地满载单程，对齐矿工本地返航成本；防零航程白刷）。
 * 2026-09-10 修复：调试模式（debugQuick）下与采矿/打捞/返航空间站的本地腿同口径压到 1 秒——
 * 此前写死 120s，调试时"战斗后的返航"永远 2 分钟，改不动。 */
const LOCAL_RETURN_MS = 120_000

/** 本地段时长的调试快进（与 travelLegMs / miningReturnLegMs / legMsFor 的 debugQuick 口径一致） */
function localLegMs(state: GameState, fullMs: number): number {
  return state.debugQuick ? 1_000 : fullMs
}

/** 自动返航基准（2026-09-08 船长定：所有自动返航一律选"最近已建成空间站"，无建成副站 = 母港） */
function returnBaseGalaxy(state: GameState, ctx: SimContext, fromGalaxy: string): string {
  return nearestStationGalaxyId(state, ctx, fromGalaxy)
}

/** 从"战场星系"转入返航段的统一时长：基准 = 目标星系最近已建成站；
 * 目标星系即基准（母港本地 / 建成站本地）→ 固定 LOCAL_RETURN_MS（调试模式 1 秒）；
 * 否则 **单程 × `RETURN_LEG_MUL`**（2026-09-14 船长「修正倍率回1倍」⇒ 现值 1×；旧值 2× 作废）。
 * 航路不可达时返回 0（调用方用 `outMs × RETURN_LEG_MUL` 兜底）。 */
function returnBackMs(state: GameState, ctx: SimContext, targetGalaxy: string): { ms: number; base: string } {
  const base = returnBaseGalaxy(state, ctx, targetGalaxy)
  if (base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) return { ms: localLegMs(state, LOCAL_RETURN_MS), base }
  const mins = shortestTravelMinutes(ctx, base, targetGalaxy)
  const ms = Number.isFinite(mins) ? travelLegMs(state, ctx, mins) * RETURN_LEG_MUL : 0
  return { ms, base }
}

/** 返航到港落点（2026-09-08：基准星系有已建成副站 → 停靠该站；否则母港） */
function landAtReturnBase(state: GameState, ctx: SimContext, baseGalaxy: string): void {
  state.awayGalaxy = null
  state.dockedSite = builtSiteAtGalaxy(state, ctx, baseGalaxy)
}
/** 主要势力 id（声望绑定方） */
export const DSI_FACTION_ID = 'dsi'

/** 星系间最短航程（分钟）——定义在 travel.ts（V12.1），此处转发保持既有调用面 */
export { shortestTravelMinutes }

/**
 * **新档初始声望 = 0**（**2026-09-26 船长裁定**：初始赠送一律清理）。
 * ⚠ **权威定义在 `state.ts`**（本模块已经 import 它，反向引会成环）⇒ 这里只转发。
 */
export { INITIAL_STANDING } from './state'

/**
 * **查询某势力的声望**（**2026-09-26 起 = 累计获得**）。
 *
 * 船长令：「**其他所有的声望门槛都改为看获得了多少声望总数**」⇒ 本函数（全仓 40 余处门槛的唯一入口）
 * 改读**累计获得**那一本账；**可支配**那一本另走 {@link spendableStandingOf}（只有兑换扣它）。
 *
 * ⚠ **兼容**：老档 / 合成状态没有 `standingsEarned` 时**回退读旧值** ⇒ 判定口径与改动前逐字一致
 * （读档路径由 `save.normalizeState` 回填，见那里的说明）。
 */
export function standingOf(state: GameState, factionId: string): number {
  return state.standingsEarned?.[factionId] ?? state.standings[factionId] ?? 0
}

/** **可支配声望**（只有「章鱼人兑换」扣它；**不能**拿它当门槛读——门槛一律走 `standingOf`） */
export function spendableStandingOf(state: GameState, factionId: string): number {
  return state.standings[factionId] ?? 0
}

/**
 * **记一笔声望获得**（唯一入口）：**两条账同时加**。
 *
 * - 可支配那本 +v（日后能被兑换扣掉）；
 * - 累计那本 +v（**只增不减**，所有门槛读它）。
 *
 * 调用点两处：完成远征/悬赏卡（`anomaly.standingGain`）与**入侵结束按贡献占比**
 * （`weekendBattle.weekendSettleAndGrant`）。v ≤ 0 时只保证累计那本不回退（幂等补账用）。
 */
export function noteStandingEarned(state: GameState, factionId: string, v: number): void {
  const add = Math.max(0, Math.round(v))
  state.standings[factionId] = Math.max(0, (state.standings[factionId] ?? 0) + add)
  state.standingsEarned = state.standingsEarned ?? {}
  state.standingsEarned[factionId] = Math.max(0, (state.standingsEarned[factionId] ?? 0) + add)
}

/**
 * **花掉声望**（唯一入口；目前只有「章鱼人兑换」调它）：只扣**可支配**那本，**累计那本一分不动**
 * ⇒ 兑换不会把已经解锁的门槛重新锁上（正是船长"门槛改看累计"要的效果）。
 * 不够扣 ⇒ 返回 false、两本账都不动。
 */
export function spendStanding(state: GameState, factionId: string, v: number): boolean {
  const need = Math.max(0, Math.round(v))
  const have = state.standings[factionId] ?? 0
  if (have < need) return false
  state.standings[factionId] = have - need
  return true
}

/**
 * **本次回正的适用门槛**：只有"按悬赏进度算**本来就不达标**"的档才回正。
 *
 * 船长原话：「**去掉原本声望不达标玩家获得的额外声望（根据悬赏进度来判断）**」＋
 * 「**声望都没到40的玩家不可能打得过入侵**」⇒ 判据就是这条 40 线。
 *
 * ⚠ 与 `WEEKEND_MIN_STANDING` / `WORMHOLE_SCAN_UNLOCK_STANDING` **同值**（都是 40），但那两个模块都
 * import 本文件 ⇒ 不能反向引，就地写一份；用例里钉住三者同值。
 * ⚠ **为什么必须带这个门槛**（不然会伤到正常玩家）：达标的档会**合法地**靠入侵贡献继续涨声望
 * （每场 0~15 点），而诚实值 `H` 只算悬赏 ⇒ 无条件"削到 H"会把他们的入侵声望**每次读档都削一遍**。
 */
export const STANDING_CLAWBACK_THRESHOLD = 40

/**
 * **按"悬赏进度"回正累计声望**（**2026-09-26 船长裁定**：见 `INITIAL_STANDING` 的沿革与
 * `save.ts` 老档回填那段）——读档后调一次，**只降不升**、幂等。
 *
 * 船长原话：「**去掉原本声望不达标玩家获得的额外声望（根据悬赏进度来判断）**」＋
 * 「**1算（初始 40 也算额外声望），…所以要清理，并且还要削减累计声望**」＋
 * 「**2 …（入侵贡献）不含**（声望都没到 40 的玩家不可能打得过入侵）」。
 *
 * 口径（四条，都可证）：
 * - **只对"本来就不达标"的档动手**：`H < STANDING_CLAWBACK_THRESHOLD`（= 40）。
 *   达标的档**一字不动**——他们的累计里可能含**合法的**入侵贡献声望，无条件削到 `H` 会把它削掉。
 *   而且达标档本来也没有赠送可清：老档回填只在"旧值 < 40"时才抬高，新档开在今天、几小时内
 *   靠悬赏攒到 40 在实际进度里做不到。
 * - **诚实值 `H` = Σ 已首胜悬赏卡的 `standingGain`**（`state.completedBounties` × 卡表，逐卡可查）。
 *   ⚠ **不含**入侵贡献声望（船长明令）——被抬起来的档根本不该打得了入侵。
 *   卡表里查不到的 id（已退役卡）按 0 计，宁可少算不多算。
 * - `累计 > H` ⇒ **削减为 `H`**（赠送的 40、老档回填的 40 下界、以及靠它们挣到的部分都在这里面）。
 * - `累计 < H` ⇒ **不动**（不做"补发"，免得又造出一次"数值突然上涨"；这类档只可能是数据缺失）。
 *
 * 附带把**可支配**夹到 `≤ 累计`（`可支配 > 累计` 只可能来自初始赠送那一笔）——
 * 否则兑换窗口会拿着"从没挣过的声望"换书。已换到手的图纸不回滚。
 *
 * @returns 真的改动了账本才 `true`（调用方按需记日志）
 */
export function repairStandingFromBountyProgress(state: GameState, ctx: SimContext): boolean {
  let honest = 0
  for (const id of state.completedBounties ?? []) {
    honest += Math.max(0, Math.round(ctx.anomalies.get(id)?.standingGain ?? 0))
  }
  let changed = false
  const earned = state.standingsEarned?.[DSI_FACTION_ID] ?? state.standings[DSI_FACTION_ID] ?? 0
  /** 达标的档不碰（理由见函数头注：他们的累计里可能有合法的入侵贡献声望） */
  if (honest < STANDING_CLAWBACK_THRESHOLD && earned > honest) {
    state.standingsEarned = { ...(state.standingsEarned ?? {}), [DSI_FACTION_ID]: honest }
    changed = true
  }
  const after = state.standingsEarned?.[DSI_FACTION_ID] ?? state.standings[DSI_FACTION_ID] ?? 0
  const spendable = state.standings[DSI_FACTION_ID] ?? 0
  if (spendable > after) {
    state.standings[DSI_FACTION_ID] = after
    changed = true
  }
  return changed
}

/**
 * 火力指数（V17 口径：基础 + 炮术学 + 船型加成；仅展示/弃船率叙事用）。
 * 装备不再乘入——炮台等装备的真实表现由 battleWinPreview（期望推演，含武器参数）评估，
 * 指数只反映"技能 + 船体"的骨架战力，避免旧口径把模块百分比冒充实时强度。
 */
export function calcPower(state: GameState, ctx: SimContext, shipId: string = state.shipId): number {
  const bal = ctx.balance.combat
  const gunnery = state.skills.trained[bal.gunnerySkillId] ?? 0
  const base = bal.basePower + bal.powerPerLevel * gunnery
  const shipDef = fleetDefOf(state, ctx, shipId)
  return Math.round(base * (1 + (shipDef?.powerBonus ?? 0)))
}

/**
 * 胜率（旧口径保留：仅展示兼容；预估请用 battleWinPreview / 带伤预警口径 bountyWinPercentGuarded）。
 * 新口径下 AI 门槛与远征面板一律使用 battleWinPreview。
 */
export function winChance(power: number, threat: number, ctx: SimContext): number {
  const bal = ctx.balance.combat
  if (threat <= 0) return bal.maxWinChance
  const raw = power / (power + threat)
  return Math.min(bal.maxWinChance, Math.max(bal.minWinChance, raw))
}

/** 远征去程耗时估算（展示用；T8：按当前位置出发的单程 + 参考交火时长；完成后停留，返航另计） */
export function calcExpeditionDurationMs(state: GameState, ctx: SimContext, anomaly: AnomalyDef): number {
  const outMinutes = shortestTravelMinutes(ctx, originGalaxyOf(state, ctx), anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return 0
  return travelLegMs(state, ctx, outMinutes) + anomaly.combatSeconds * 1000
}

/** 玩家战术选择 */
export type BattleTacticChoice = 'assault' | 'mid' | 'kite'

/** 按战术算期望距离（出发前/战斗中改战术均用；目标未指明时用当前目标）。
 * ⚠ **中距档与星图/洞内无关**（2026-09-15 船长更正「洞内维持中段」为口误、取消分档）：
 * 一律走 `desireBandMid`（射程带 **0.8** 高位）；洞内只有**近战怪的开局距离**另走
 * `wormholeBrawlOpenBand`（0.5，见 `startFleetBattleFor`），与本函数的"战术期望"无关。
 *
 * ⚠ **2026-09-14 修（船长报障「虫洞内的战斗…战斗开始位置似乎不对」的连带）**：默认卡此前只取
 * `state.expedition.anomalyId` ⇒ **洞内交火时取不到卡 ⇒ 本函数直接返回 0** ⇒ 战场里点
 * 「突击/中距/风筝」按钮会把期望距离设成 0（被 `setBattleDesire` 钳到最近）＝**整队贴脸**。
 * 现与 `setBattleDesire` **同一口径**解析：洞内用本趟的敌卡（`run.battle.wormhole.cardId`）与
 * **编队首舰**当主视角；洞外照旧用远征卡与 `state.shipId`。 */
export function battleTacticDesire(
  state: GameState,
  ctx: SimContext,
  tactic: BattleTacticChoice,
  anomalyId?: string | null,
): number {
  const whRun = state.wormhole.run
  const whBattle = whRun?.battle ?? null
  const cardId = anomalyId ?? (whBattle ? (whBattle.wormhole?.cardId ?? null) : state.expedition.anomalyId)
  const anomaly = cardId ? ctx.anomalies.get(cardId) : undefined
  const anchorShipId = whBattle ? (whRun?.fleet[0] ?? state.shipId) : state.shipId
  const me = createPlayerSpec(state, ctx, anchorShipId)
  if (!anomaly || !me) return 0
  return desiredRangeFor(me, tactic, ctx.balance.battle)
}

/**
 * 玩家指令：战斗中调整期望距离（手动拖距离条/战术切换共用）。
 * **按星系记忆**（船长 2026-09-11：「玩家每个星系设定的目标距离独立保存」）——
 * 写入的是**本场战斗所在星系**（= 远征目标卡的星系）的目标距离；下次在该星系开战、
 * 以及该星系的胜率预估都会沿用它。
 *
 * ⚠ **洞内战（2026-09-13 修）**：洞内战斗宿主在 `run.battle`（不占 `expedition.battle`），
 * 首版这里只认远征 ⇒ 洞内拖距离条会被拒（「当前不在交火中」）＝**看着像"距离被锁死"**。
 * 现在两条路都认：洞内用**编队首舰**当主视角、敌卡走引擎同源的 `wormholeDerivedAnomaly`
 * （开战距离上限与开战那一刻同一把尺），偏好**记在本趟 `run.desireM`**（后续节点沿用）——
 * **不写星系偏好**：虫洞不属于任何星系，写进去会污染那个星系的设定。
 *
 * ⚠ **入侵旗舰战（2026-09-25 修 · 船长报障「可以斩杀敌方母舰的战斗进入后，无法改变距离，
 * 改变时显示'不在交火中'」）**：它是**第三个宿主**（编队战 · 承载在遭遇槽 `state.encounter.battle`），
 * 前两版判据都不认它 ⇒ 距离条与战术按钮在这里被拒。现在一并认：
 * - 主视角 / 敌卡 = 遭遇槽那条（`enc.anomalyId` = 该族旗舰卡，**不做派生**）；
 * - 偏好写**该场战斗所在星系**（`enc.galaxyId` = 本场核心）——⚠ **不能**写 `anomaly.galaxyId`：
 *   旗舰卡是隐藏卡、它自带的母港是 `galaxy-hub`，照抄会把偏好写到母港去。
 */
export function setBattleDesire(state: GameState, desireM: number, ctx: SimContext): CommandResult {
  const whRun = state.wormhole.run
  const whBattle = whRun?.battle ?? null
  /** 第三宿主（入侵旗舰战）：遭遇槽里挂着旗舰卡 + 那场还在（判据单点，与界面/引擎各处同源） */
  const wb = state.encounter.active && state.encounter.battle !== null && weekendFlagshipEncounterOf(state, state.encounter)
  const wkBattle = wb ? state.encounter.battle : null
  const battle = state.expedition.battle ?? whBattle ?? wkBattle
  if (!battle) return { ok: false, error: '当前不在交火中。', errorId: 'core.expedition.001' }
  const anchorShipId = whBattle
    ? (whRun?.fleet[0] ?? state.shipId)
    : wkBattle
      ? (wkBattle.myFleet?.[0]?.shipId ?? state.encounter.shipId ?? state.shipId)
      : state.shipId
  const me = createPlayerSpec(state, ctx, anchorShipId)
  const cardId = whBattle
    ? whBattle.wormhole?.cardId
    : wkBattle
      ? state.encounter.anomalyId
      : state.expedition.anomalyId
  const baseCard = cardId ? ctx.anomalies.get(cardId) : undefined
  if (!me || !baseCard) return { ok: false, error: '战斗记录缺失。', errorId: 'core.expedition.002' }
  const anomaly =
    whBattle && whBattle.wormhole ? wormholeDerivedAnomaly(ctx, baseCard, whBattle.wormhole) : baseCard
  /**
   * **钳制上界 = 界面滑条的那个"远端"**（`battleArcsFor` 的 `maxM` = `battleMaxDistanceM`：
   * 按**当前波**双方有效射程现算、含技能/科技增程与敌方受击增程）⇒ **拖到最远就真的站到最远**，
   * 界面与引擎同一把尺。
   *
   * ⚠⚠ **2026-09-25 修（船长报障「旗舰第二波鱼雷艇，敌方试图远离、我方也在拉远距离，
   * 但是实际距离在缩短」）**：旧写法是
   * `battleOpenM(me, createFoeSpecs(anomaly, bal))` —— **恒定第 0 波**的**开战距离**：
   * 旗舰战第 2 波（墨潮鱼雷舰 · 射程 12 km）里滑条远端是 **13,200**，可引擎把玩家的期望距离
   * 一律夹回**第 1 波**的 9,702 ⇒ 玩家把滑条拖到底也"拉不远"，而敌方那一侧按本波 10,350 往外走
   * ⇒ 双方**看起来**都想拉开、距离反而一路缩（缩到玩家的被夹值附近）。
   * 单波场次两者同值 ⇒ **常规战斗一字不变**（只有多波卡与带增程的场次会变）。
   */
  const waveFoes = activeFoeSpecsOf(anomaly, ctx.balance.battle, battle.waveIdx)
  const maxD = battleMaxDistanceM(battle, me, waveFoes, ctx.balance.battle)
  const minD = ctx.balance.battle.minDistanceM
  const clamped = Math.round(Math.min(maxD, Math.max(minD, desireM)))
  battle.myDesireM = clamped
  // 记忆：远征收口写"该星系的目标距离"（跨会话沿用）；**洞内写在本趟上**、**旗舰战写本场核心星系**（见函数头注释）
  if (whBattle) {
    if (whRun) whRun.desireM = clamped
  } else if (wkBattle) {
    const gid = state.encounter.galaxyId
    if (gid !== null && gid.length > 0) setDesirePrefOf(state, gid, clamped)
  } else {
    setDesirePrefOf(state, anomaly.galaxyId, clamped)
  }
  return { ok: true }
}

/** 出发抽"途中事件"（沿用 M5；去程取消后在出发瞬间触发） */
function rollTravelEvent(state: GameState, ctx: SimContext): string | null {
  if (ctx.travelEvents.length === 0) return null
  // 星际奇遇学（galactic-happenings）：途中事件触发率 ×1.15/级
  const luckLv = Math.min(5, state.skills.trained['galactic-happenings'] ?? 0)
  const chance = ctx.balance.travelEventChance * (1 + 0.15 * luckLv)
  if (nextRandom(state.rng) >= chance) return null
  const total = ctx.travelEvents.reduce((sum, e) => sum + e.weight, 0)
  if (total <= 0) return ctx.travelEvents[0]!.id // ⚠ 与改前一致：total ≤ 0 时**在抽随机数之前**早退
  // 2026-09-12 审计 B3：改走单点 `pickWeighted`（与原先手写扣减循环 `roll -= w; roll < 0` 逐位一致）；
  // 无中选兜底 = 首个事件（与改前末尾 return 相同）
  return pickWeighted(state.rng, ctx.travelEvents, (e) => e.weight)?.id ?? ctx.travelEvents[0]!.id
}

function maybeFireTravelEvent(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  if (!exp.active || !exp.eventId || exp.eventFired) return
  // 旧档/遗留去程相位在此按"中点时刻"触发；新指令（去程取消）由 startExpedition 出发瞬间直接触发
  if (state.gameMs < exp.finishAtGameMs - Math.floor(exp.outMs / 2)) return
  const eventDef = ctx.travelEvents.find((e) => e.id === exp.eventId)
  exp.eventFired = true
  if (!eventDef) return
  applyTravelEvent(state, ctx, eventDef)
}

function applyTravelEvent(state: GameState, ctx: SimContext, eventDef: TravelEventDef): void {
  const effect = eventDef.effect
  if (effect.kind === 'none') {
    addLog(state, 'event', eventDef.text)
    return
  }
  if (effect.kind === 'isk') {
    const span = Math.max(0, effect.max - effect.min)
    const amount = effect.min + nextInt(state.rng, span + 1)
    state.wallet.isk += amount
    addLog(state, 'trade', `${eventDef.text}（+${amount.toLocaleString('zh-CN')} 信用点）`)
    return
  }
  if (effect.kind === 'mineral') {
    const def = ctx.items.get(effect.itemId)
    if (!def) {
      addLog(state, 'warn', '途中事件出了岔子，本次事件落空。', 'core.expedition.025')
      return
    }
    addItem(state, effect.itemId, effect.units)
    addLog(state, 'event', `${eventDef.text}（获得 ${def.name}×${effect.units}）`)
  }
}

/** 漂流物打捞学（salvage-diving）：远征缴获物资数量系数，每级 +12%（主控与 AI 同享） */
export function lootFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  return 1 + 0.12 * lv
}

/** 赏金猎手学（bounty-hunting，2026-09-04 补全）：悬赏奖金加成系数，每级 +8%（满级 ×1.4） */
export function bountyRewardFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['bounty-hunting'] ?? 0)
  return 1 + 0.08 * lv
}

/**
 * 出征通用前置检查（startExpedition 与"采矿转战"入口共用）：
 * 目标数据 / 舰队 / 声望 / 星系探索 / 重复冷却 / 扫描 / 返港行程。
 * 不含"采矿/远征进行中"互斥（由各入口自己裁决）与起点可达性（由各入口按自身起点检查）。
 */
function expeditionPreflight(state: GameState, ctx: SimContext, anomalyId: string): CommandResult {
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。`, errorId: 'core.expedition.003' }
  /** ⚠ `wormholePilotHoldReason` 已撤（2026-09-21 统一批）：扫描虫洞 = 可自动停、人在洞里 = 拒，都归 `activityGate` */
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  const standing = standingOf(state, DSI_FACTION_ID)
  if (standing < anomaly.standingReq) {
    return { ok: false, error: `需要「深空工业协会」声望 ${anomaly.standingReq}（当前 ${standing}），多完成低级目标攒声望。` }
  }
  // V13 探索封锁：目标星系未点亮（且非母港）→ 拒绝出发
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, error: block }
  // T8 重复冷却：同悬赏连续完成需要间隔（受该船扫描属性影响）
  const cd = bountyCooldownRemainingMs(state, anomalyId)
  if (cd > 0) {
    return { ok: false, error: `「${anomaly.name}」冷却中：重复出击需等待约 ${Math.max(1, Math.round(cd / 1000))} 秒。` }
  }
  return { ok: true }
}

/** 玩家指令：出发远征（V12：out → battle → back；opts.desireM = 期望距离偏好；
 *  opts.lairTier = 赏金任务·窝点档位（非空 = 本次打的是派生窝点，威胁/波次/僚机按档位强化、
 *  奖金与稀有残骸按窝点口径结算，见 lairs.ts）。 */
export function startExpedition(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number },
): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId)
  if (!pre.ok) return pre
  const anomaly = ctx.anomalies.get(anomalyId)!
  // 窝点校验：目标必须可作窝点（有核心词、非隐藏、非 B 族）。
  // 2026-09-10 船长定：档位不再由声望封顶（改由日板席位决定），接取门槛只看卡自身声望要求
  // ——后者已在 expeditionPreflight 里把关。
  if (opts?.lairTier !== undefined && !isLairCandidate(anomaly)) {
    return { ok: false, error: '该目标不是敌人窝点，无法作为赏金任务目标。', errorId: 'core.expedition.010' }
  }
  // 敌对派系活跃（2026-09-10 船长定）：目标正是当日选中星系的**常驻悬赏** → 本场吃 +10% 奖金/+10% 威胁
  // （与窝点互斥：派系只针对普通悬赏，带着档位出击窝点时不叠加）
  const factionHit = opts?.lairTier === undefined && isFactionBounty(state, anomaly)
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  // 虫洞锁定（船长 2026-09-13：「已经进洞的船将被锁定」＋「洞内战斗时，洞外可以开新战斗」）：
  // 洞外这场战斗的锚点只能是**洞外的船**——主控若在洞里，先暂停并召回整队再出击。
  if (shipLockedInWormhole(state, state.shipId)) {
    return { ok: false, error: '主控在虫洞里（已锁定）：先暂停并召回整队，才能出击。', errorId: 'core.expedition.013' }
  }
  /**
   * **其余主控活动 ⇒ 走统一判据**（**2026-09-21 船长令**：能直接切就自动取消当前活动，只有长途运输
   * 那一档先警告；远征/快递/战斗中/洞里/返航途中一律拒）——原先这里散着 6 条硬拒，现已收进
   * `activityGate.applyActivityGate`。⚠ 放在**本入口自己的前置校验之后**（目标/声望/探索/冷却）。
   */
  const gateSkip = applyActivityGate(state, 'expedition')
  if (gateSkip) return gateSkip
  /**
   * T8：出发地 = 当前位置（野外停留点或空间站）——⚠ **算在判据之后**：掩护巡逻那类可自动停的活动
   * 停下时舰船已即时归位（`awayGalaxy` 归零）⇒ 出发地要按"停机之后"的位置算，免得出现
   * "按巡逻星系的航路校验、却从母港出发"的错位。`awayGalaxy` 复位同样放在**全部校验之后**
   * （2026-09-21 统一批顺手修正：原先它在航路校验之前清标记，校验失败也照清）。
   */
  const from = originGalaxyOf(state, ctx)
  const outMinutes = shortestTravelMinutes(ctx, from, anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。', errorId: 'core.expedition.024' }
  const fromName = ctx.galaxies.get(from)?.name ?? from
  state.awayGalaxy = null
  // V12.1：按出发时的船跃迁与航行技能锁定单程耗时（途中升级不影响本次）；用于失利返航腿并入
  const outMs = travelLegMs(state, ctx, outMinutes)
  const now = state.gameMs
  const exp = state.expedition
  exp.active = true
  exp.anomalyId = anomalyId
  /**
   * **本场远征实际打的是哪个星系**（2026-09-25：周末入侵接线）——只在调用方显式给出时写，
   * 其余情形**清掉**（防上一场的残留把归属算错）。`weekendBattleInvolvedOf` 优先读它。
   */
  if (opts?.foeGalaxyId !== undefined && opts.foeGalaxyId.length > 0) exp.foeGalaxyId = opts.foeGalaxyId
  else delete exp.foeGalaxyId
  /**
   * **奖励基底覆写**（2026-09-25 船长令「主动出击也要每场重抽」配套）：周末入侵的**敌舰每场重抽**，
   * 但**价钱不变**——奖励恒 = 该星系原卡 ×1.4（由 `weekendBounty.weekendAssaultDrawOf` 算好传进来）。
   * 缺省清掉（老路径逐字不变）。
   */
  if (opts?.rewardIskOverride !== undefined && Number.isFinite(opts.rewardIskOverride)) {
    exp.rewardIskOverride = Math.max(0, Math.round(opts.rewardIskOverride))
  } else delete exp.rewardIskOverride
  exp.phase = 'out' // 占位：本函数内随即转入 battle（去程取消：开战时刻 = 现在）
  exp.battle = null
  exp.finishAtGameMs = now // 开战时刻 = 下达时刻（不再有去程等待）
  exp.outMs = outMs
  exp.combatMs = anomaly.combatSeconds * 1000
  exp.durationMs = outMs + exp.combatMs
  exp.power = calcPower(state, ctx)
  exp.eventId = rollTravelEvent(state, ctx)
  exp.eventFired = false
  exp.returnReason = undefined
  exp.lairTier = opts?.lairTier // 赏金任务·窝点档位（普通悬赏 = undefined）
  exp.factionActive = factionHit // 派系活跃目标（当日选中星系的常驻悬赏 = true）
  // 目标距离：本次显式传入 → 写进**目标星系**的设定；否则开战时读该星系的已有设定，
  // 该星系没设过则回落"主武器有效射程中点"（船长 2026-09-11：「如果没有，采用射程中段距离」）
  if (opts?.desireM !== undefined) {
    setDesirePrefOf(state, anomaly.galaxyId, Math.max(ctx.balance.battle.minDistanceM, Math.round(opts.desireM)))
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const outName = opts?.lairTier ? lairNameOf(anomaly, opts.lairTier) : anomaly.name
  addLog(
    state,
    'combat',
    `⚔ 远征开始（${outName}）：${shipName} 自「${fromName}」起航，立即抵达目标空域进入交火。胜利后自动返航最近空间站（母港或已建成副站，含去返全程，不可召回）；失利/撤退同样自动返航。`,
  )
  // 途中事件（若有）在出发瞬间触发一次（不再有去程中段等待）
  if (exp.eventId) maybeFireTravelEvent(state, ctx)
  // 去程取消：立即开战（beginBattleAt 会点亮目标星系并写"进入交火"日志）
  const opened = beginBattleAt(state, ctx, anomalyId, state.shipId, now)
  if (!opened) {
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    return { ok: false, error: '目标已不存在，无法开战。', errorId: 'core.expedition.014' }
  }
  return { ok: true }
}

/**
 * T4 延后项（船长 2026-09-04 定稿）：采矿中直接转战悬赏。
 * 前置校验全部通过后：采矿作业终止（同手动停止——停哪算哪、已采的货随船带走），
 * 远征从「当前矿带所在星系」出发（矿带无星系 = 本地，从母港出发）。
 * 直接调用 startExpedition 在采矿中仍会被拒绝——本入口是确认后的唯一转场路径。
 */
export function startExpeditionFromMining(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number },
): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId)
  if (!pre.ok) return pre
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  /** ⚠ 掩护巡逻那条硬拒已撤（2026-09-21 统一批）：它是**可自动停**那一档，由内层 `startExpedition` 的 gate 停掉 */
  const m = state.mining
  if (!m.active) return startExpedition(state, anomalyId, ctx, opts) // 无采矿作业 → 普通出发
  const anomaly = ctx.anomalies.get(anomalyId)!
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  // 从矿带所在星系出发（本地矿带 = 母港停靠出发）
  const from = belt?.galaxyId ?? null
  if (from !== null) {
    const reach = shortestTravelMinutes(ctx, from, anomaly.galaxyId)
    if (!Number.isFinite(reach)) return { ok: false, error: '目标星系不在矿带所在星系的已知航路内。', errorId: 'core.expedition.015' }
  }
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const trip = m.tripUnits
  const beltName = belt ? belt.name : '矿带'
  // 终止采矿（同手动停止语义：进度清零、货随船）
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0 // 转战悬赏即离开矿带作业：红利窗口清零
  // 矿带在异星系：以"野外停泊"表达起点（startExpedition 会读取并清空）
  if (from !== null) state.awayGalaxy = from
  const shipName = shipDisplayName(state, ctx, state.shipId)
  addLog(
    state,
    'industry',
    `采矿已结束（${shipName} 转战悬赏「${opts?.lairTier ? lairNameOf(anomaly, opts.lairTier) : anomaly.name}」）：离开「${beltName}」${trip > 0 ? `——本趟采得的 ${trip} 单位${ore?.name ?? ''}仍在船上` : '（本趟尚无收获）'}，记得回港卸货。`,
  )
  return startExpedition(state, anomalyId, ctx, opts)
}

/** 到港开战（主控）：开战时刻 = 到港时刻；目标距离 = **该星系**的设定，没设过则射程中段
 *  （2026-09-11 船长：按星系独立保存；`startBattleFor` 内单点解析，此处不再传全局偏好） */
export function beginBattleAt(state: GameState, ctx: SimContext, anomalyId: string, shipId: string, arrivalGameMs: number): boolean {
  /**
   * **周末入侵**：被占星系的悬赏战要打**入侵强度** ⇒ 用覆写口传进去。
   * ⚠ H 族（独立卡）**不传**：它的卡面威胁就是实测价（90 / 108 / 129），覆写 78/120 只会把标签写假
   * （船长 2026-09-25「按照新规对 H 族调整」）；A/C/G 三族仍走 78 / 120 的占位口径。
   */
  const weekendAssault = weekendBattleInvolvedOf(state, ctx, anomalyId, Date.now())
  const weekendEv = state.weekendEvent
  const weekendThreat =
    weekendAssault && weekendEv && !weekendFoeCardsSelfPriced(weekendEv.family)
      ? weekendAssaultThreatOf(weekendEv, weekendAssault.galaxyId)
      : undefined
  const battle = startBattleFor(
    state,
    ctx,
    shipId,
    anomalyId,
    arrivalGameMs,
    undefined,
    weekendThreat !== undefined ? { threat: weekendThreat } : undefined,
  )
  if (!battle) return false
  const exp = state.expedition
  exp.phase = 'battle'
  exp.battle = battle
  // 连续作战保险（2026-09-08 船长定）：巡回场次挂撤退阈值——本场结构剩余 <50%（损失过半）
  // 时战斗步进自动中止（advanceBattleFor 置 autoEscaped），随后走轻损撤退结算，绝不拖到弃船
  /**
   * ⚠ **2026-09-25 扩到"入侵重复出击"**（船长批：「**入侵「重复出击」也挂 0.5 撤退保险**」）：
   * 原来只有"常驻悬赏那条循环 ＋ 本场打的就是那张卡"才挂，而入侵循环**两头都不成立**
   * （开循环时会把 `autoLoopAnomalyId` 清空；入侵每场打的是**抽出来的卡**，id ≠ 循环目标）
   * ⇒ 入侵循环的场次会一路打到结构归零 → 判负 → 掷弃船骰（3%~50%）⇒ **可能丢船**。
   * 现按同口径补上：**循环开着 ＋ 本场打的是被占星系**（`foeGalaxyId` = 出征时落的那个）即挂。
   */
  const loopOnThisCard = state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === anomalyId
  const invasionLoopOn = autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined
  if (loopOnThisCard || invasionLoopOn) {
    exp.battle.hullEscapeFrac = 0.5
  }
  const anomaly = ctx.anomalies.get(anomalyId)
  // V13 探索：实际到港 → 点亮该星系（去程结束进入交火 = 已抵达）
  if (anomaly?.galaxyId) markExplored(state, anomaly.galaxyId)
  const loaded = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  // V18B-1：武器形态分家——炮台（turret）与导弹架（missile）都算"已装武器"
  const hasTurret =
    familyModules(state, ctx, shipId, 'turret').length > 0 || familyModules(state, ctx, shipId, 'missile').length > 0
  const targetName = anomaly ? (exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name) : ''
  addLog(
    state,
    'combat',
    `⚔ 抵达目标（${targetName}）：进入交火。${hasTurret ? (loaded > 0 ? `预载弹药 ${loaded} 发。` : '警告：未携带弹药，武器无法开火（基础舰炮可还击）。') : '未装配武器：仅基础舰炮还击。'}` +
      (exp.lairTier ? '（赏金任务目标：窝点守备强于常驻悬赏，注意弹药与修理件。）' : ''),
  )
  return true
}

/** 交火结束结算（主控）：奖励/惩罚 → 转返航 */
export function resolveBattleOutcome(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  const battle = exp.battle
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  if (!battle || !anomaly) {
    exp.active = false
    exp.battle = null
    exp.lairTier = undefined
    exp.factionActive = undefined
    return
  }
  const won = battle.ended === 'me'
  const galaxy = ctx.galaxies.get(anomaly.galaxyId)
  // 赏金任务·窝点（2026-09-10）：本场是否打的是派生窝点，档位来自出击时锁定的 exp.lairTier。
  // 战报/奖金/残骸投放/失利维修费统一按"本场实际目标卡"走（窝点 = 主题悬赏按档位强化），
  // 避免"打了窝点却按主题悬赏报账"。普通悬赏 battleCard === anomaly，行为与旧版一致。
  const lairTier = exp.lairTier
  // 敌对派系活跃（2026-09-10 船长定）：本场打的是当日选中星系的常驻悬赏 → 威胁已 ×1.1（battleAnomalyOf），
  // 这里把奖金也 ×1.1（展示=到账口径），并在胜利后按概率掉稀有残骸。
  const factionActive = exp.factionActive === true
  const card0 = lairTier ? lairAnomalyOf(anomaly, lairTier) : anomaly
  const battleCard = factionActive ? factionAnomalyOf(card0) : card0
  const displayName = battleCard.name
  /**
   * **这一场是不是入侵战斗**（2026-09-25 船长令「**入侵舰队不应该有赏金**」）——
   * 判据走既有单点 `weekendBattleInvolvedOf`（远征落盘 `foeGalaxyId` 优先）；
   * 入侵场次**当场一分钱都不给**：收入改在活动结束时按进度统一结算
   * （`WEEKEND_PROGRESS_ISK_PER_PCT`），残骸也改记**独立池**（见下面的注入分支）。
   */
  const weekendInvolved = weekendBattleInvolvedOf(state, ctx, anomaly.id, Date.now())
  const isInvasion = weekendInvolved !== undefined
  const baseRewardIskRaw = isInvasion
    ? 0
    : lairTier
      ? lairBaseRewardIsk(anomaly, lairTier)
      : factionActive
        ? factionBaseRewardIsk(anomaly)
        : /**
           * **入侵"主动出击每场重抽"的价钱口径**（2026-09-25）：敌舰每场换，但奖励恒 = 该星系原卡 ×1.4
           * ⇒ 出发时算好写进 `exp.rewardIskOverride`，这里优先用它；老路径（没写）逐字不变。
           * ⚠ 2026-09-25 当日晚些时候船长令「入侵舰队不应该有赏金」⇒ 入侵场次走上面的 `0` 分支，
           * 本式只服务非入侵的普通悬赏（`rewardIskOverride` 于是不再有调用方，保留不删以免动到老档路径）。
           */
          (exp.rewardIskOverride ?? anomaly.rewardIsk)
  // 限时倍率（2026-09-15）：`rewardIsk` 乘在悬赏结算基底上（窝点/派系/普通三支共用这一处）
  const baseRewardIsk = Math.max(0, Math.round(baseRewardIskRaw * rewardMulOf(state)))
  // 机群战损（2026-09-10 船长「无人机可被击落」+ 永久损失制）：胜负/撤退一律照扣，
  // 且要在战报文案之前落账（战报要引用损失摘要）
  const droneLostText = settleDroneLosses(state, ctx, state.shipId, battle)
  // 机群战损过大 → 停重复清剿（永久损失制安全阀：2026-09-10 船长拍板）；读数与判定走单点（见下）
  const {
    before: droneBefore,
    after: droneAfter,
    attrition: droneAttritionRaw,
  } = droneBattleOutcome(state, battle)
  const droneAttrition = droneAttritionRaw && state.autoLoopAnomalyId === exp.anomalyId
  if (droneAttrition) {
    /** 补货**之后**的实载（用于文案：自动补足了没有；货源不足时差多少） */
    const droneNow = Object.values(state.fleet[state.shipId]?.droneLoad ?? {}).reduce((s, n) => s + n, 0)
    stopAutoLoopReason(
      state,
      droneNow >= droneBefore
        ? `机群战损过半（${droneBefore} → ${droneAfter} 架）——机群已自动补充到 ${droneNow} 架，确认配装后可重新开启重复清剿。`
        : `机群战损过半（${droneBefore} → ${droneAfter} 架）——货仓与物品仓库存货不足以补满（现 ${droneNow} 架），补充无人机后可重新开启重复清剿。`,
      droneAfter, // 记下停环时的机群架数（**补货前**）⇒ 再开前必须"确实补过货"（船长 2026-09-18）
    )
  }
  refundAmmo(state, battle.ammo, battle.ammoIds) // 弹药 MK2：按本场实装弹 id 退回
  refundRepairKitsAll(state, battle) // 船体维修装置（2026-09-09）：未用修理组件退回仓库
  // P0 承伤持久化：先落装甲/结构残余（结构=耐久），失利附加扣损在其后叠加
  persistFleetHullDamage(state, ctx, state.shipId, battle)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)

  if (won) {
    /**
     * **实战胜利记录**（2026-09-24 船长令：「**③按敌卡。记录残血最多的一次，如果都是满血则不覆盖。
     * 夹回当前射程内。**」）——胜率预估"打过的卡按打过的距离算"那一支的**唯一写入点**：
     * 只在**真打赢**这一支写（模拟评估是只读克隆、根本不进本函数 ⇒ 不会自证）；
     * 键 = **本场目标卡 id**（窝点/派系是本卡的派生强化，按同一张卡记账，与星图卡片列表一致）；
     * 距离 = **本场实际期望距离**（`battle.myDesireM`，开战处已夹进当次射程），消费时再按现射程夹一道；
     * 剩余比例 = **（装甲 + 结构）÷ 满值**（护盾每场满值重建、不进分子；满值 = `hpMax`，即该舰未受损的值）。
     * **只在更高时覆盖**：`>` 严格比较 ⇒ 等值（含"两次都满血"）不写 ⇒ 记录稳定、不会来回抖。
     */
    const recNow = ((): number => {
      const u = battle.units['player']
      if (!u) return 0
      const cur = Math.max(0, u.hp.a) + Math.max(0, u.hp.h)
      // 老档/异常缺 `hpMax` ⇒ 回落当前值（当次读作满血，与视图血条的兜底同口径）
      const fullRef = u.hpMax ?? u.hp
      const full = Math.max(1, fullRef.a + fullRef.h)
      // 取到万分位：存档里不留浮点尾数（也让"两次几乎一样"的胜利稳定地判为等值、不来回改写）
      return Math.round(Math.min(1, Math.max(0, cur / full)) * 10_000) / 10_000
    })()
    const recPrev = state.winRecord?.[anomaly.id]
    if (battle.myDesireM > 0 && recNow > (recPrev?.remainPct ?? -1)) {
      state.winRecord = { ...(state.winRecord ?? {}), [anomaly.id]: { desireM: battle.myDesireM, remainPct: recNow } }
    }
    // ── 胜利：奖金（**无浮动 = 卡片展示值**，2026-09-10 船长）+ 情报彩蛋 + 战利品 + 声望 ──
    // rewardJitter 现为 0 → roll 恒为 1，展示口径（卡片 `rewardIsk × bountyRewardFactor`）即到账口径；
    // 保留本式以便将来需要时一行调回（唯一随机奖励 = 情报彩蛋 +10%，会在日志里说明）
    const jitter = ctx.balance.rewardJitter
    const roll = 1 - jitter + 2 * jitter * nextRandom(state.rng)
    let reward = Math.max(0, Math.round(baseRewardIsk * roll * bountyRewardFactor(state)))
    if (nextRandom(state.rng) < 0.15) {
      const texts = [
        '舰队返航时打捞到一枚漂流信标，协会收购了上面的航路情报',
        '编队顺手清理了一块导航浮标，空间站维修部发来感谢金',
        '舰载传感器捕获一段加密信号，协会情报处兑换了报酬',
      ] as const
      const text = pickOne(state.rng, texts)!
      const bonus = Math.round(reward * 0.1)
      reward += bonus
      addLog(state, 'trade', `◆ ${text}（+${bonus.toLocaleString('zh-CN')} 信用点）`)
    }
    const lootText: string[] = []
    const lootMul = lootFactor(state)
    for (const row of anomaly.loot) {
      const units = Math.max(1, Math.round(row.units * lootMul))
      addItem(state, row.itemId, units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${units}`)
    }
    state.wallet.isk += reward
  bumpFirst(state, 'bountyWins') // 第一次任务/链：讨伐胜场
    // B3 击杀注入（2026-09-10 船长定）：注入口径体量（`wreckThreat` ?? 威胁）×0.4 × (1 + 0.2×敌人数)，
    //   无上限（窝点按强化后威胁算）；**体量走 `wreckInjectThreatOf`** ⇒ 2026-09-25「冻结残骸经济」后
    //   改 `threat` 不再牵动回收线（见 `AnomalyDef.wreckThreat`）
    /**
     * **注入目标 = 这一场所在的星系**（2026-09-25 修）：入侵战斗的卡可能"不属于"它被打的那片星域
     * （H 族独立卡自带母港 `galaxy-hub`）⇒ 先问入侵归属（上面算好的 `weekendInvolved`），问到就用它的星系；
     * 非入侵战斗回落卡的星系（既有口径，逐字不变）。
     */
    const wreckGalaxyId = weekendInvolved?.galaxyId ?? anomaly.galaxyId
    /**
     * **残骸注入：入侵走独立池，普通悬赏走星系池**（船长 2026-09-25）：
     * 「入侵……添加的残骸是原星系的残骸密度，**需要独立的残骸条**（入侵残骸没有星系的残骸保底，
     * 因为随时间消减到最后会消失）」＋「**按照击败卡的威胁注入**」⇒ 注入量公式一字不改
     * （`weekendWreckInjectionOf` = 悬赏那条唯一公式），只是**记到另一个池子**里去。
     */
    const wreckInjected = isInvasion
      ? weekendWreckInjectionOf(battleCard)
      : bountyWreckInjection(wreckInjectThreatOf(battleCard), bountyEnemyCount(battleCard))
    // 来源族（2026-09-26 玩家报障）：击败的是哪一族就记哪一族 —— 打捞型号池据此在该星系
    // **即使已夺回 / 活动已结束**也并入那一族的独立入侵卡（残骸场比占领活得久）
    if (isInvasion) {
      injectWeekendWreck(
        state,
        wreckGalaxyId,
        wreckInjected,
        asFoeFamily(battleCard.foeFamily) ?? asFoeFamily(state.weekendEvent?.family),
      )
    }
    else injectWreckDensity(state, ctx, wreckGalaxyId, wreckInjected, battleCard.id)
    const wreckNow = isInvasion
      ? weekendWreckDensityOf(state, wreckGalaxyId)
      : wreckDensityOf(state, wreckGalaxyId, ctx)
    // 声望仅首胜发放（防低威胁目标被无限重复白刷声望；重复完成只拿 ISK/战利品）
    const firstBlood = !state.completedBounties.includes(anomaly.id)
    if (firstBlood) {
      // 声望获得走唯一入口（2026-09-26 起：**两条账同时加**——可支配 ＋ 累计）
      noteStandingEarned(state, DSI_FACTION_ID, anomaly.standingGain)
      state.completedBounties.push(anomaly.id)
    }
    const stats = `交火 ${durTxt}（开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}，我方护盾余 ${Math.round(battle.units['player']?.hp.s ?? 0)}/甲 ${Math.round(battle.units['player']?.hp.a ?? 0)}/结构 ${Math.round(battle.units['player']?.hp.h ?? 0)}）`
    const lootPart = lootText.length > 0 ? `，缴获 ${lootText.join('、')}` : ''
    const standPart = firstBlood ? `协会声望 +${anomaly.standingGain}` : '该悬赏已首胜过：本次无额外声望'
    const dronePart = droneLostText ? `，机群战损 ${droneLostText}` : ''
    // 船体维修装置：消耗数只进战报（2026-09-11 船长：不单独显示日志）
    const repairPart = (() => {
      const t = repairUsageText(battle, ctx)
      return t.length > 0 ? `，船体维修装置${t}` : ''
    })()
    /** 损伤管制装置：本场启动过就进战报（2026-09-25 船长令：战报单列一条） */
    const dcPart = (() => {
      const t = dcUsageText(battle, ctx)
      return t.length > 0 ? `，${t}` : ''
    })()
    // **结构化战报**（2026-09-14 船长定）：先把那句日志文案落到变量、再同时写日志与本记录
    // ⇒ 卡片正文与事件日志**逐字同源**（不再靠"找含『战报』二字的日志"那条脆弱做法）。
    /**
     * ⚠ **入侵场次另写一句**（2026-09-25 船长令「入侵舰队不应该有赏金……在结算时候直接按进度获取收入」）：
     * 旧文案里「奖金 N 信用点」在入侵场次恒为 0，照写就是"打了半天没钱还写个 0" ⇒ 换口径说明；
     * 残骸那一栏也改成**独立池**的读数（`入侵残骸沉积 X（本场 +Y）`），与星图上那条独立残骸条同源。
     */
    const winText = isInvasion
      ? `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：大捷！击退入侵舰队。${stats}${lootPart}${dronePart}${repairPart}${dcPart}，` +
        `本场无赏金：进度收入与夺回奖励在活动结束时统一发放。` +
        `入侵残骸沉积 ${wreckNow.toFixed(1)}（本场 +${wreckInjected.toFixed(1)}）`
      : `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：大捷！${stats}，奖金 ${reward.toLocaleString('zh-CN')} 信用点${lootPart}${dronePart}${repairPart}${dcPart}，${standPart}` +
        `。战场残骸密度 ${wreckNow.toFixed(1)}（本场 +${(battleCard.threat * 0.4).toFixed(1)}）`
    addLog(state, 'combat', winText)
    captureBattleReport(state, battle, { source: 'expedition', outcome: 'win', summary: winText })
    // 赏金任务·窝点结算（2026-09-10 船长定，排在战报之后）：①稀有残骸投放该星系残骸场
    // （按敌群记账、打捞必得）②命中本板该条赏金任务 → 酬金入账 + 下板 + 引导文案。
    // 投放不依赖任务是否还在板上：任务已过期也照样算窝点战果（打都打了，战利品不能吞）。
    if (lairTier) {
      injectRareWreck(state, anomaly.galaxyId, anomaly.id, LAIR_RARE_WRECK_GAIN[lairTier])
      settleBountyTaskVictory(state, ctx, anomaly.id, LAIR_RARE_WRECK_GAIN[lairTier])
    }
    // 敌对派系活跃（2026-09-10 船长定）：胜利后**按概率**掉稀有残骸（该星系残骸场、打捞必得）。
    // 这条**不因打赢而下板**（当天可反复刷），故只在命中时写一条日志说明掉了几件。
    // **保底（2026-09-11 船长定的机制；2026-09-20 船长把数值收紧为「每 10 次必出一个」）**：
    // 连续 9 次掷骰未出 ⇒ 第 10 次必掉（阈值走常量 `FACTION_RARE_DROP_PITY_ROLLS`，文案里的次数同源）。
    // 掷骰恒消耗一次随机数（保底触发时也掷、只取 `||`）——保持 rng 时序与未保底时一致，避免别的系统读数漂移。
    if (factionActive) {
      const streak = Math.max(0, Math.floor(state.rareWreckDryStreak ?? 0)) + 1
      // 限时倍率（2026-09-15）＋ 铁人 ×1.2（2026-09-23）：**两口乘区都走 `factionRareDropChanceOf`**
      // —— 读数（卡面 / `faction:audit`）与这里**同一函数**（2026-09-24 收口，见 `lairs.ts` 该函数注释）
      const hit = nextRandom(state.rng) < factionRareDropChanceOf(state)
      const pity = streak >= FACTION_RARE_DROP_PITY_ROLLS
      if (hit || pity) {
        injectRareWreck(state, anomaly.galaxyId, anomaly.id, FACTION_RARE_DROP_COUNT) // 内部清零空手计数
        addLog(
          state,
          'trade',
          `✦ 敌对派系活跃战果：${displayName} 的残骸里翻出稀有残骸 ×${FACTION_RARE_DROP_COUNT}` +
            `${pity && !hit ? `（连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出，本次保底）` : ''}` +
            `——可前往「${galaxy?.name ?? ''}」打捞（回站用回收炉解体可得额外战利品）。`,
        )
      } else {
        state.rareWreckDryStreak = streak // 空手：累计（下次掷骰时判保底）
      }
    }
    // T8 悬赏冷却：结算时刻开始计时（与自动返航并行）
    setBountyCooldown(state, ctx, anomaly.id)
    exp.battle = null
    exp.lairTier = undefined
    exp.factionActive = undefined // 窝点一次性：结算完清档位，重复清剿回到主题悬赏（否则会无限复打窝点）
    exp.eventId = null
    exp.eventFired = false
    const ret = returnBackMs(state, ctx, anomaly.galaxyId)
    const backMs = ret.ms > 0 ? ret.ms : exp.outMs * RETURN_LEG_MUL
    const baseName =
      ret.base === HOME_GALAXY_ID
        ? '母港'
        : ctx.galaxies.get(ret.base)?.name ?? ret.base
    exp.phase = 'back'
    exp.returnReason = 'victory'
    // 返航计时起点 = 战斗停表时刻（击杀/超时拍；2026-09-09 修复：此前按结算时的 state.gameMs
    // 起算——离线大步长下战斗结束即结算，离线剩余时间全部浪费，"上线才刚开始返航"）
    const endAt = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
    exp.returnAtGameMs = endAt
    exp.finishAtGameMs = endAt + backMs
    if (ret.base === anomaly.galaxyId || anomaly.galaxyId === HOME_GALAXY_ID) {
      // 本地悬赏（2026-09-08 船长定）：目标星系即返航基准 → 固定返港段 120s，防零航程白刷
      addLog(
        state,
        'combat',
        '战果已入账：舰队返港中（本地悬赏返航段约 2 分钟，胜利返航不可召回）。',
        'core.expedition.026',
      )
    } else {
      addLog(
        state,
        'combat',
        `战果已入账：舰队自动返航「${baseName}」（去程并入返航 · 约 ${Math.max(1, Math.round(backMs / 60_000))} 分钟，胜利返航不可召回）——到站自动卸货入仓库，可维修或让重复清剿自动续打。`,
      )
    }
    return
  } else {
    // 失利：扣耐久 + 弃船骰 + 维修费（沿用旧机制）；若正处于重复清剿环 → 停环
    if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
      stopAutoLoopReason(state, '本次出击失利，舰队自动返航（可修整后再开）。')
    }
    const bal = ctx.balance.combat
    const loss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const fleetShip = state.fleet[state.shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 1
    let abandoned = false
    if (durabilityAfter <= 0) {
      abandoned = true
    } else if (nextRandom(state.rng) < abandonChance(state, battleCard.threat, ctx)) {
      abandoned = true
    }
    if (abandoned) {
      // 弃船：无维修费，船+货仓+装备全损
      const abandonRepair = repairUsageText(battle, ctx)
      const abandonDc = dcUsageText(battle, ctx)
      const abandonText = `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：遭重创（交火 ${durTxt}${abandonRepair.length > 0 ? `，船体维修装置${abandonRepair}` : ''}${abandonDc.length > 0 ? `，${abandonDc}` : ''}）……`
      addLog(state, 'combat', abandonText)
      // 战报（2026-09-14）：弃船 = 我方全灭那一档 ⇒ `lose`；沉船名单走推导（三层血已归零）
      captureBattleReport(state, battle, { source: 'expedition', outcome: 'lose', summary: abandonText })
      loseShip(
        state,
        state.shipId,
        ctx,
        `远征失利（${galaxy?.name ?? ''}·${displayName}）后遭追击`,
        // 2026-09-26：正常星系损毁 ⇒ 在这一格留「<船名>的残骸」（`foeGalaxyId` 优先 =
        // 打的是被占星系的驻留舰队时落在那个星系；缺省回落到本场目标卡所在星系）
        exp.foeGalaxyId ?? anomaly.galaxyId,
      )
      exp.active = false
      exp.battle = null
      exp.anomalyId = null
      exp.lairTier = undefined
    exp.factionActive = undefined
      return
    }
    if (fleetShip && loss > 0) {
      fleetShip.durability = Math.max(0, Math.round((fleetShip.durability - loss) * 1000) / 1000)
    }
    // 维修费按本场目标强度计（窝点 = 强化后奖金 × 比例）：越硬的窝点打输越贵，与"酬金跟强度"同口径
    const repair = Math.min(state.wallet.isk, Math.floor(baseRewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const shipName = shipDisplayName(state, ctx, state.shipId)
    const dronePartLose = droneLostText ? ` 机群战损 ${droneLostText}（永久损失）。` : ''
    const loseRepair = repairUsageText(battle, ctx)
    const loseDc = dcUsageText(battle, ctx)
    const loseText = `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：失利（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）……${shipName} 耐久 -${Math.round(loss * 100)}%，维修花去 ${repair.toLocaleString('zh-CN')} 信用点。${loseRepair.length > 0 ? `船体维修装置${loseRepair}。` : ''}${loseDc.length > 0 ? `${loseDc}。` : ''}${dronePartLose}练练炮术学，记得给船做保养。`
    addLog(state, 'combat', loseText)
    // 战报（2026-09-14）：走到这里就是"打输了、船没沉"⇒ `lose`（沉船那一支在上面 return 了）
    captureBattleReport(state, battle, { source: 'expedition', outcome: 'lose', summary: loseText })
  }
  // 转返航（2026-09-08：基准 = 目标星系最近已建成站；本地 = 固定 120s；失利返航可召回）
  exp.battle = null
  exp.lairTier = undefined
    exp.factionActive = undefined // 窝点档位随本场结束作废（含失利；任务仍在板上可再打一次）
  exp.phase = 'back'
  exp.returnReason = 'defeat'
  // 返航计时起点 = 战斗停表时刻（2026-09-09 修复：同胜利路径——离线大步长下不让离线剩余浪费）
  const endAtD = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
  exp.returnAtGameMs = endAtD
  const retD = returnBackMs(state, ctx, anomaly.galaxyId)
  exp.finishAtGameMs = endAtD + (retD.ms > 0 ? retD.ms : exp.outMs * RETURN_LEG_MUL)
  addLog(state, 'fleet', '舰队开始返航（去程时间并入返航）。', 'core.expedition.027')
}

/**
 * 玩家指令：战斗中主动撤退（Q1乙 轻损：只损失少量舰船耐久、无弃船骰；**维修费已于 2026-09-15 按船长「删除撤离费」整条删除**）；
 * 耐久结算带下限保护——不足 0 时压到 5% 并显著告警，绝不因撤退直接弃船）。
 * 实现口径：扣损 = 战败扣损骰 ×0.5（约 8%~15%，最低 1%）——数值小，玩家侧只描述"少量损失"。
 * 仅"正在交火且未分胜负"时可撤；撤退即手动收手 → 同时停止重复清剿（Q3甲）。
 */
export function retreatBattle(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active || exp.phase !== 'battle' || !exp.battle) {
    return { ok: false, error: '当前不在交火中，无法撤退。', errorId: 'core.expedition.016' }
  }
  if (exp.battle.ended !== null) {
    return { ok: false, error: '战斗已分出胜负，正在结算——无法撤退。', errorId: 'core.expedition.017' }
  }
  settleBattleRetreat(state, ctx, 'manual')
  return { ok: true }
}

/**
 * 撤退结算核心（2026-09-08：手动撤退与巡回自动撤退共用）：
 * 承伤写回 → 脱身那一口（按敌火扣装甲/结构，下限 5% 保护、绝不弃船）→ 停清剿 → 转返航。
 * **不收维修费**（船长 2026-09-15「删除撤离费」，旧 Q1乙 的"按比例维修费"整条作废）。
 * mode 四档：'manual' 玩家主动撤退；'auto' 连续作战保险（本场结构损失过半）；
 * 'timeout' **战斗打满上限判负**（2026-09-10 船长定：超时不再按残血比判胜，视同被迫撤退）；
 * 'cannot-engage' 够不着（一炮未发，2026-09-11 裁定）。
 */
function settleBattleRetreat(
  state: GameState,
  ctx: SimContext,
  mode: 'manual' | 'auto' | 'timeout' | 'cannot-engage',
): void {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  /**
   * **本次交火实际用的那张卡**（2026-09-14 船长裁定「顺手对齐」）：
   * 窝点的界面胜率/威胁、以及开战时的敌编成（见本文件开战路径的 `card0`）**一律按档位派生后的卡**
   * （`lairAnomalyOf`：威胁 ×1.3/1.6/2.0），唯独撤退/无法交战这里的取数原先读**基础卡** ⇒ 窝点档被少算。
   * 派生卡只放大威胁与条目的 hp/dmg 锚点，单发/射程/编成/战术一律不动 ⇒ 交距读数不受影响。
   * ⚠ **奖赏与命名那条链仍走基础卡 + `exp.lairTier`**（`lairBaseRewardIsk` / `lairNameOf`），
   * 换成派生卡会把档位倍率二次乘上 ⇒ 奖金虚高，务必别顺手改。
   */
  const threatCard = anomaly && exp.lairTier ? lairAnomalyOf(anomaly, exp.lairTier) : anomaly
  const battle = exp.battle
  if (!battle) return
  /**
   * **入侵结算也要走一遍**（2026-09-25 补 · 由船长「撤退会重抽吗」一问查出）：
   * 母舰伤害是在**战斗收尾**那一步量进血池的，而**撤退 / 超时 / 无法交战走的是这条路径** ⇒
   * 原先这一场对母舰打出的伤害白打；设计稿写的是「按对母舰造成的伤害决定」（撤退 / 战败照记）。
   * 按"没打赢"结算：**只记伤害 · 不给进度 · 不判击沉**（`victory: false`；非入侵战斗内部直接 no-op）。
   */
  {
    const ev = state.weekendEvent
    const galaxyId = exp.foeGalaxyId
    if (ev !== undefined && ev.endedAtWallMs === undefined && galaxyId !== undefined) {
      const isFlagship =
        exp.anomalyId !== null && exp.anomalyId === weekendFoeCardOf(ev.family, 'flagship') && galaxyId === ev.coreId
      weekendApplyBattleOutcome(state, ctx, exp.anomalyId ?? null, false, Date.now(), battle, {
        kind: isFlagship ? 'flagship' : 'assault',
        galaxyId,
        source: 'battle',
      })
    }
  }
  // 机群战损（2026-09-10 船长「无人机可被击落」）：撤退也照扣——被打掉的飞机不会飞回来
  settleDroneLosses(state, ctx, state.shipId, battle)
  refundAmmo(state, battle.ammo, battle.ammoIds) // 弹药 MK2：按本场实装弹 id 退回
  refundRepairKitsAll(state, battle) // 船体维修装置（2026-09-09）：未用修理组件退回仓库
  // P0 承伤持久化：撤退也保留本场已损装甲/结构（脱身那一口在其后叠加）
  persistFleetHullDamage(state, ctx, state.shipId, battle)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)
  // 「无法交战」战报要用的两个数字（**与引擎同源、不手写**）：我方主武器最远射程 + 敌编队典型交距
  const meSpec = createPlayerSpec(state, ctx, state.shipId)
  const myTopRangeM = meSpec ? meSpec.weapons.reduce((m, w) => Math.max(m, w.maxRangeM), 0) : 0
  const foesNow = threatCard ? createFoeSpecs(threatCard, ctx.balance.battle) : []
  const foeTypicalRangeM =
    meSpec && foesNow.length > 0
      ? // 电子舰削减后敌人会主动压近（船长 2026-09-18）⇒ 战报这条读数与引擎同源
        foeDesiredRange(meSpec, foesNow, ctx.balance.battle, meFoeRangeDebuffOf(state, ctx, [state.shipId]))
      : 0

  // 脱身那一口（2026-09-11 船长：「希望能将其应用到战斗中撤退」）：
  // 一口 = 敌群火力（威胁 × foeDpsPerThreat）× combat.retreatHitFirepowerSec，
  // **先扣装甲、吸完再进结构**，结构 5% 底线（算法单点 hullDamage.ts，与低安遇袭受损档同一套）。
  // 取代旧口径「轻损 = 失利扣损骰 ×0.5 = 结构 −7.5%~15%（与敌人强弱无关、装甲不动）」；
  // 旧档/异常无 anomalyId 时无从取敌群火力 ⇒ 退回旧半损骰兜底（有日志说明）。
  // ⚠ **2026-09-14 船长改判：「玩家撤离战斗按照 10 秒算」⇒ 旧值 1 秒作废**；**2026-09-26 再改判
  // 「甲：单纯削减时间」⇒ 10 → 5 秒**（与低安遇袭那口同口径）。四档（主动撤退 /
  // 结构<50% 自动脱离 / 超时 / 无法交战）**同一 K**；虫洞撤离战不在此列（走真实战斗损伤）；
  // **不计玩家抗性**（船长令「之前没有抗性就算了」，见 `balance.combat.retreatHitFirepowerSec`）。
  const bal = ctx.balance.combat
  const threat = threatCard ? Math.max(1, threatCard.threat) : 0
  let hit: HullHit | null = null
  let legacyLossPct = 0
  if (threat > 0) {
    hit = applyArmorFirstDamage(state, ctx, state.shipId, firepowerHitHp(ctx, threat, bal.retreatHitFirepowerSec))
    if (hit?.floored) {
      addLog(
        state,
        'combat',
        mode === 'timeout'
          ? '⚠ 超时撤退后船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。'
          : mode === 'auto'
            ? '⚠ 自动撤退后船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。'
            : '⚠ 撤退时船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。',
      )
    }
  } else {
    const fleetShipLegacy = state.fleet[state.shipId]
    const baseLoss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const loss = Math.max(0.01, Math.round(baseLoss * 500) / 1000)
    legacyLossPct = Math.round(loss * 100)
    if (fleetShipLegacy) fleetShipLegacy.durability = Math.min(1, Math.max(0.05, fleetShipLegacy.durability - loss))
  }
  const fleetShip = state.fleet[state.shipId]
  /**
   * **撤退不收维修费**（船长 2026-09-15：「**删除撤离费**」）。
   *
   * 旧口径（2026-09-04 Q1乙）：撤退 = 轻损 + 无弃船骰 + **按比例维修费**
   * （`min(钱包, 该卡期望奖励 × defeatCostRatio(0.5) × 0.5)` = 奖励的 25%，四档——手动撤退 /
   * 结构<50% 自动脱离 / 打满上限超时 / 无法交战——**一起收**）⇒ 已**整条删除**：
   * 现在撤退**只损失舰船耐久（脱身那一口）**，钱包一个信用点不动。
   * ⚠ **失利的维修费不受影响**（那条是"打输了"的惩罚，`× defeatCostRatio` 全额，见上面失利分支）；
   * 本函数里 `retreatBaseIsk` 随收费一起删除（它只服务这两行）。
   */
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const targetName = anomaly ? (exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name) : exp.anomalyId ?? '目标'
  const dmgTxt = hit ? hitDamageText(hit) : `结构 -${legacyLossPct}%（旧档兜底）`
  const retreatText =
    mode === 'timeout'
      ? `⏱ 战斗超时（${targetName}）：舰船被迫撤退，正在返航——${dmgTxt}。`
      : mode === 'cannot-engage'
        ? // 无法交战（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：写明**我方射程 × 敌站位**，
          // 让玩家看懂"不是打不过，是够不着"，并知道该换装配（推进器/更远的武器）。
          `⚔ 无法交战（${targetName}）：我方主武器最远射程 ${myTopRangeM.toLocaleString('zh-CN')} m，` +
          `敌编队停在约 ${foeTypicalRangeM.toLocaleString('zh-CN')} m 外（交火 ${durTxt}，一炮未发）——` +
          `${shipName} 已脱离交火并返航。${dmgTxt}。`
        : mode === 'auto'
          ? `⚔ 自动撤退（${targetName}）：结构损失过半，${shipName} 自动脱离交火（交火 ${durTxt}）——${dmgTxt}，正在返航。`
          // 2026-09-12 合并：主树「手动撤退 = **立刻回港**」的新文案（本块两侧各改一处 ⇒ 并集）
          // 2026-09-15 船长「删除撤离费」⇒ 四档文案一律去掉「维修花去 N 信用点」（钱包不再变动）
          : `⚔ 撤退（${targetName}）：${shipName} 主动脱离交火（交火 ${durTxt}）——${dmgTxt}，即刻回港。`
  addLog(state, 'combat', retreatText)
  /**
   * 战报（2026-09-14 船长定）：**四档里的「脱离」那一档** —— 这四种都是"没分出胜负就收场"
   * （结构撤退 / 打满上限超时 / 无法交战 / 玩家主动撤退），故 `outcome: 'break'`，
   * 只在 `breakReason` 上区分原因（判定词不变）。⚠ 超时在本引擎里"按被迫撤退处理"是**结算口径**
   * （轻损、不弃船），与这里给的**判定词**是两件事。
   */
  captureBattleReport(state, battle, {
    source: 'expedition',
    outcome: 'break',
    breakReason: mode === 'timeout' ? 'timeout' : mode === 'cannot-engage' ? 'cannot-engage' : mode === 'auto' ? 'hull' : 'manual',
    summary: retreatText,
  })
  // 收手 → 停清剿（若有；手动撤退与自动撤退都会终止重复清剿）
  if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
    state.autoLoopAnomalyId = null
    const armorPct = Math.round((fleetShip?.armorPct ?? 1) * 100)
    const structPct = Math.round((fleetShip?.durability ?? 1) * 100)
    const text =
      mode === 'manual'
        ? `重复清剿已停止（手动撤退）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
        : mode === 'timeout'
          ? `重复清剿已停止（战斗超时）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
          : mode === 'cannot-engage'
            ? `重复清剿已停止（无法交战，已脱离）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
            : `重复清剿已停止（本场结构损失过半，自动撤退）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
    addLog(state, 'combat', text)
    // 2026-09-10 船长定：除事件日志外，玩家在线时弹窗告知（心跳读取即清）
    if (mode === 'auto' || mode === 'cannot-engage') state.autoLoopStopNotice = text
  }
  // 转返航（2026-09-08：基准 = 目标星系最近已建成站；本地 = 固定 120s；沿用失利返回流程）
  exp.battle = null
  exp.lairTier = undefined
    exp.factionActive = undefined // 撤退/自动撤退：本场作废，窝点档位不带到下一场
  exp.phase = 'back'
  exp.returnReason = 'retreat'
  // 返航计时起点 = 战斗停表时刻（2026-09-09 修复：自动撤退由大步长推进触发时,离线剩余时间
  // 应计入返航,而不是从结算时（=离线末）才起步）
  const endAtR = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
  exp.returnAtGameMs = endAtR
  // **手动撤退 = 立刻回港**（2026-09-11 船长：「玩家战斗手动撤退后应该是立刻回港，现在战斗撤退有返港时间」）：
  // 玩家主动收手不再走返航航程（到港时刻 = 停表时刻，下一拍即入港卸货）；
  // 自动撤退（结构损失过半）与超时判负仍按原口径返航（"被迫撤离，正在返航"）。
  if (mode === 'manual') {
    exp.finishAtGameMs = endAtR
    addLog(state, 'combat', '舰队脱离战场，即刻返回最近的空间站。', 'core.expedition.028')
    return
  }
  const retR = anomaly ? returnBackMs(state, ctx, anomaly.galaxyId) : { ms: 0, base: HOME_GALAXY_ID }
  exp.finishAtGameMs = endAtR + (retR.ms > 0 ? retR.ms : exp.outMs * RETURN_LEG_MUL)
  addLog(state, 'combat', '舰队脱离战场，自动返航（去程时间并入返航）。', 'core.expedition.029')
}

/** 弃船概率（沿用旧公式；power 用火力指数） */export function abandonChance(
  state: GameState,
  threat: number,
  ctx: SimContext,
  shipId: string = state.shipId,
): number {
  const bal = ctx.balance.combat
  const exp = state.expedition
  const power = exp.power || calcPower(state, ctx, shipId)
  const base = threat > 0 ? threat / (threat + 2 * power) : 0
  const clamped = Math.min(bal.maxAbandonChance, Math.max(bal.minAbandonChance, base))
  const fleetShip = state.fleet[shipId]
  const durability = fleetShip?.durability ?? 1
  const shipDef = fleetDefOf(state, ctx, shipId)
  const agility = shipDef?.agility ?? 0.4
  const durabilityPenalty = bal.durabilityFactor + (1 - bal.durabilityFactor) * durability
  const agilityEscape = 1 - bal.agilityEscapeFactor * agility
  return clamped * durabilityPenalty * agilityEscape
}

/** 引擎内部：按阶段推进远征（时间已由 gameMs 表达；同帧内阶段可连续跨越，离线大推进亦然） */
export function advanceExpedition(state: GameState, ctx: SimContext, freezeBattle = false): void {
  const exp = state.expedition
  for (let guard = 0; guard < 6; guard++) {
    if (!exp.active) return
    if (exp.phase === 'out') {
      maybeFireTravelEvent(state, ctx)
      if (state.gameMs < exp.finishAtGameMs) return
      const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, exp.finishAtGameMs)
      if (!ok) {
        exp.active = false
        exp.anomalyId = null
        exp.battle = null
        exp.lairTier = undefined
    exp.factionActive = undefined
        addLog(state, 'warn', '远征目标已不存在，舰队无功而返（异常）。', 'core.expedition.030')
        return
      }
      continue // 同一帧继续处理交火（离线大推进直接打到结束）
    }
    if (exp.phase === 'battle') {
      if (!exp.battle) {
        // 防御：存档里 battle 丢失 → 用当前时刻开战
        const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, state.gameMs)
        if (!ok) {
          exp.active = false
          exp.anomalyId = null
          exp.lairTier = undefined
    exp.factionActive = undefined
          addLog(state, 'warn', '远征目标已不存在，舰队无功而返（异常）。', 'core.expedition.030')
          return
        }
        continue
      }
      // 调试快进冻结主控战斗（船长 2026-09-05：方便测试战斗系统）——快进期间不推进/瞬结主控远征战斗
      if (freezeBattle) {
        const now = state.gameMs
        const owed = Math.max(0, now - (exp.battle.lastTickGameMs ?? now))
        if (owed > 0) {
          exp.battle.lastTickGameMs = now
          exp.battle.startedAtGameMs += owed
        }
        return
      }
      advanceBattleFor(state, ctx, exp.battle, state.shipId, exp.anomalyId, null, exp.lairTier)
      // 撤离请求两个来源（都走同一轻损撤退结算，只在文案上区分）：
      // ①连续作战保险——巡回场次结构损失过半；②**战斗超时判负**（2026-09-10 船长定）。
      // 来源见 battle.escapeReason，缺省 = 'hull'（旧档/旧口径零迁移）。
      if (exp.battle.autoEscaped) {
        settleBattleRetreat(
          state,
          ctx,
          exp.battle.escapeReason === 'timeout'
            ? 'timeout'
            : exp.battle.escapeReason === 'cannot-engage'
              ? 'cannot-engage'
              : 'auto',
        )
        if (!exp.active) return
        continue // 已转 back：若返航已到点则同帧回家
      }
      if (exp.battle.ended) {
        // V12.3 击杀慢镜：分出胜负后延迟 killcamMs 再结算，让最后一击动画与爆炸演出播完；
        // 计时基准 = 战斗停表时刻（lastTickGameMs 冻结于击杀拍）。离线/大步长推进下差值立即达标，行为与旧版一致。
        // ⚠ 倍速批（2026-09-19）：判据改走**战斗时钟**并把窗口按倍速放大（洞外战斗 `speedX` 缺省 = 1 ⇒ 逐字等价）。
        const bal = ctx.balance.battle
        if (battleClockNowMs(state, exp.battle) - exp.battle.lastTickGameMs < battleShowWindowMs(exp.battle, bal.killcamMs)) return
        /** **周末入侵**：被占星系的悬赏战打完 ⇒ 走入侵结算（主动胜利 +10%（外围）/ +5%（核心）· 夺回发奖 · 旗舰击沉） */
        weekendApplyBattleOutcome(
          state,
          ctx,
          state.expedition.anomalyId ?? null,
          state.expedition.battle?.ended === 'me',
          Date.now(),
          state.expedition.battle, // 2026-09-24：旗舰 BOSS 要按它量"这一场对母舰的伤害"
        )
        resolveBattleOutcome(state, ctx)
        continue // resolve 后转 back；若返航也已到点则同帧回家
      }
      return
    }
    // back：到港结束（2026-09-08：落点 = 返航基准星系——有已建成副站则停靠该站，否则母港；
    // 2026-09-08 船长再定：任何进港时刻自动整仓卸货入仓库）
    if (state.gameMs < exp.finishAtGameMs) return
    const wasVictoryReturn = exp.returnReason === 'victory'
    const targetGal = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId)?.galaxyId ?? null : null
    const base = targetGal !== null ? returnBaseGalaxy(state, ctx, targetGal) : HOME_GALAXY_ID
    landAtReturnBase(state, ctx, base)
    const moved = unloadCargoOfShipToWarehouse(state, state.shipId) // 进港自动卸货（战利品/残货）
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    exp.returnReason = undefined
    exp.lairTier = undefined
    exp.factionActive = undefined
    const siteName = state.dockedSite !== null ? ctx.stations.get(state.dockedSite)?.name ?? state.dockedSite : null
    const unloadedNote = moved > 0 ? `货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : ''
    addLog(
      state,
      'combat',
      wasVictoryReturn
        ? siteName
          ? `悬赏战果已携回「${siteName}」并自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）——可维修或补给后再次出击。`
          : `悬赏战果已携回母港并自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）——可维修或补给后再次出击。`
        : siteName
          ? `远征结束，舰队已停靠「${siteName}」（副空间站）。${unloadedNote}`
          : `远征结束，舰队已停靠母港。${unloadedNote}`,
    )
    return
  }
}

/** 玩家指令：召回远征（T1 活动窗口统一停止）。仅去程/返航可召回——召回即直接回港、无战果；交火中禁止（避免绕过战斗结算）。
 * 2026-09-06：胜利自动返航（returnReason='victory'）不可召回——路程成本必付，防止"打完立即召回免费回家"。 */
export function recallExpedition(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active) return { ok: false, error: '当前没有进行中的远征。', errorId: 'core.expedition.018' }
  if (exp.phase === 'battle') {
    return { ok: false, error: '交火中无法撤离——请先让战斗分出胜负。', errorId: 'core.expedition.019' }
  }
  if (exp.phase === 'back' && exp.returnReason === 'victory') {
    return {
      ok: false,
      error: '胜利返航中不可召回——战果已结算，返航（去程并入返航）是本次悬赏的必付航程。',
      errorId: 'core.expedition.020',
    }
  }
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const name = anomaly
    ? exp.lairTier
      ? lairNameOf(anomaly, exp.lairTier)
      : anomaly.name
    : exp.anomalyId ?? '目标'
  exp.active = false
  exp.anomalyId = null
  exp.battle = null
  exp.lairTier = undefined
    exp.factionActive = undefined
  exp.phase = 'out'
  exp.finishAtGameMs = 0
  exp.eventId = null
  exp.eventFired = false
  state.awayGalaxy = null
  // 2026-09-08：召回 = 立即回到母港停靠——进港自动整仓卸货
  const moved = unloadCargoOfShipToWarehouse(state, state.shipId)
  addLog(
    state,
    'fleet',
    `远征已召回：舰队中止前往「${name}」并返回母港（无战果）${moved > 0 ? `；货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : '。'}`,
  )
  return { ok: true }
}

/* ───────── T8 悬赏重复冷却与重复清剿 ───────── */

/** 冷却基础 10 秒（船长定稿：较原方案大幅缩减）；分辨率越高冷却越短 */
export const BOUNTY_COOLDOWN_BASE_MS = 10_000
export const BOUNTY_COOLDOWN_REF_RES = 500

/** 按当前驾驶船扫描属性计算一次冷却时长 */
export function bountyCooldownMsFor(state: GameState, ctx: SimContext): number {
  const res = fleetDefOf(state, ctx, state.shipId)?.scanResMm ?? BOUNTY_COOLDOWN_REF_RES
  const factor = Math.pow(BOUNTY_COOLDOWN_REF_RES / Math.max(1, res), 0.5)
  return Math.max(1000, Math.round(BOUNTY_COOLDOWN_BASE_MS * factor))
}

/** 悬赏完成结算时调用：以当时出击船属性锁定冷却结束时刻 */
export function setBountyCooldown(state: GameState, ctx: SimContext, anomalyId: string): void {
  state.bountyCooldowns[anomalyId] = state.gameMs + bountyCooldownMsFor(state, ctx)
}

/** 剩余冷却毫秒（≤0 = 已冷却，顺带清理过期条目） */
export function bountyCooldownRemainingMs(state: GameState, anomalyId: string): number {
  const until = state.bountyCooldowns[anomalyId]
  if (typeof until !== 'number' || !Number.isFinite(until)) return 0
  const remain = until - state.gameMs
  if (remain <= 0) {
    delete state.bountyCooldowns[anomalyId]
    return 0
  }
  return remain
}

/**
 * **本场机群战损读数**（单点；永久损失制安全阀：2026-09-10 船长拍板「战损过半自动停环提示补货」）。
 *
 * 返回 `{ before, after, attrition }`：`before` = 出发架数 · `after` = **补货前**的存活架数 ·
 * `attrition` = `after / before < 50%`（`before = 0` 时恒 false）。
 *
 * ⚠ **必须读补货前的存活架数**：2026-09-20 起 `settleDroneLosses` 会在扣账之后**立刻按本场出发编制
 * 自动补足机群** ⇒ 直接读 `state.fleet[...].droneLoad` 拿到的是**补满后**的架数，这条安全阀会**静默失效**。
 * 故读战损报告里的 `survivors`（结算时在补货前记下），并与本场 `startedAtGameMs` 配对，避免读到上一场
 * 或 AI 副船留下的旧报告；报告缺失（老档/异常）时回落到"出发架数 − 净损失"。
 */
export function droneBattleOutcome(
  state: GameState,
  battle: BattleState,
): { before: number; after: number; attrition: boolean } {
  const before = Object.values(battle.droneLoadAtStart ?? {}).reduce((s, n) => s + n, 0)
  const rep =
    state.droneLossReport && state.droneLossReport.battleStartedAtGameMs === battle.startedAtGameMs
      ? state.droneLossReport
      : null
  const after = Math.max(0, rep?.survivors ?? before - (rep?.gone ?? 0))
  return { before, after, attrition: before > 0 && after / before < 0.5 }
}

/**
 * **机群缺额**（船长 2026-09-20：战斗结束会自动补足机群 ⇒ 若还缺就是"货源不够"，装配页要看得见还差几架）。
 *
 * 返回 `null` = 没被机群门槛拦着。判据 = 停环记账 `autoLoopDroneFloor` 存在且当前装载**没超过它**
 * （与 `autoLoopReopenBlockReason` 第②条同一把尺，本函数是该判据的**单点**）。
 * `shipId` 可传非驾驶船（装配页支持给别的船装配）。
 */
export function autoLoopDroneShortfall(
  state: GameState,
  shipId: string = state.shipId,
): { now: number; floor: number; need: number } | null {
  const floor = state.autoLoopDroneFloor
  if (typeof floor !== 'number') return null
  const now = Object.values(state.fleet[shipId]?.droneLoad ?? {}).reduce((s, n) => s + n, 0)
  return now <= floor ? { now, floor, need: floor + 1 } : null
}

/**
 * **再开重复清剿的前置**（船长 2026-09-18：「**战损/耐久未恢复则先挡住**」）——返回 null = 放行。
 *
 * 两条都是"可恢复"的前置，且都复用既有那把尺：
 * ① **装甲或结构 < 50%**：与出发门槛、自动停环同一档（`advanceAutoLoopBounty` 里那条）。
 * ② **机群战损未补**：停环那一刻记下的架数 `state.autoLoopDroneFloor`（只有"机群战损过半"那一路会写）
 *    ⇒ 再开要求**当前装载严格大于它**（判据单点 = `autoLoopDroneShortfall`）。
 *
 * ⚠ 2026-09-20 起战斗结束会**立刻按本场出发编制自动补足机群**（货仓 → 仓库）⇒ 第②条实际只在
 * **货仓与物品仓库都没货**时才拦人；文案据此改写（说清缺多少、要补到几架），不再写"请手动补装"。
 */
export function autoLoopReopenBlockReason(state: GameState): string | null {
  const fs = state.fleet[state.shipId]
  if (!fs) return '舰队里找不到当前驾驶舰船。'
  if ((fs.armorPct ?? 1) < 0.5 || fs.durability < 0.5) {
    return '装甲或结构低于 50%：先修回 50% 以上，或装上船体维修装置并带够组件。'
  }
  const short = autoLoopDroneShortfall(state)
  if (short) {
    return short.floor <= 0
      ? '机群已全灭：货仓与物品仓库都没有可补充的无人机——先在装配页装入（购买或制造）再开启重复清剿。'
      : `机群尚未补充（现 ${short.now} 架 · 停环时 ${short.floor} 架）：需补到 ${short.need} 架以上才可再开——先在装配页装入无人机。`
  }
  return null
}

/** 重复清剿开关（落档：重启后自动恢复）；null = 关闭。⚠ **关闭一律放行**；开启过 `autoLoopReopenBlockReason` */
export function setAutoLoopBounty(state: GameState, ctx: SimContext, anomalyId: string | null): CommandResult {
  if (anomalyId !== null) {
    const block = autoLoopReopenBlockReason(state)
    if (block !== null) return { ok: false, error: block }
  }
  state.autoLoopAnomalyId = anomalyId
  if (anomalyId === null) {
    state.autoLoopDroneFloor = null
    addLog(state, 'combat', '重复清剿已停止。', 'core.state.008')
  } else {
    state.autoLoopDroneFloor = null // 重新开环 ⇒ 清掉上一轮的机群前置记账
    const def = ctx.anomalies.get(anomalyId)
    const name = def?.name ?? anomalyId
    addLog(
      state,
      'combat',
      `重复清剿已开启：「${name}」完成后冷却结束会自动再次出发（货仓/耐久不满足时自动暂停）。`,
      'core.expedition.031',
      { p1: name },
    )
  }
  return { ok: true }
}

/** 停环并记录原因（日志+清开关；2026-09-10 船长定：文案带当前 装甲/结构 数字，
 * 并写入一次性提示 autoLoopStopNotice——玩家在线时由心跳读取弹窗告知） */
function stopAutoLoopReason(state: GameState, reason: string, droneFloor: number | null = null): void {
  state.autoLoopAnomalyId = null
  // 只有"机群战损过半"那一路传 `droneFloor`（再开前须补货，见 `autoLoopReopenBlockReason`）；其余原因清除记账
  state.autoLoopDroneFloor = droneFloor
  const fs = state.fleet[state.shipId]
  const armorPct = Math.round((fs?.armorPct ?? 1) * 100)
  const structPct = Math.round((fs?.durability ?? 1) * 100)
  const text = `重复清剿已暂停：${reason}（当前 装甲 ${armorPct}% / 结构 ${structPct}%）`
  addLog(state, 'combat', text)
  state.autoLoopStopNotice = text
}

/**
 * **重复清剿当前在等哪一类作业**（`null` = 没有别的作业挡路，继续走冷却/门槛检查）。
 *
 * ⚠ **引擎与活动栏必须共用这一份**（2026-09-17 玩家报障「自动清缴一直处于『即将自动再出击』的状态」）：
 * 原先引擎等 **5 类**（远征 · 采矿 · **星图扫描** · 残骸打捞 · 航行），而活动栏那行只认 **3 类**（采矿 · 航行 · 待命）
 * ⇒ 两者漂移：那两种情况下引擎在等、行文案却一路写「即将自动再出击」。现收成这一份：**增删等待项只改这里**。
 *
 * 🔴 **「星图扫描」已从等待表删除**（2026-09-17 船长追问「星图扫描不是已经不占用主控活动了？」）——
 * 船长 2026-09-15 定案：「**进行修正，玩家扫描星系将不再占用玩家的主控活动**」⇒ 星系扫描改成**无人扫描艇**：
 * **不占主控、不牵动舰船、不阻断任何别的活动**（双向放行，当时把双向互斥判据全删了）。
 * 而这条等待判据是那批**漏掉的一处旧闸** ⇒ 扫描在跑时清剿一直"等"、而扫描可以无限期跑
 * ⇒ 玩家看到的"卡死"**根因就在这里**（只把行文案改诚实是不够的，等待表本身必须跟着改）。
 * `state.salvaging`（残骸打捞）**仍在**表里：打捞要用主控船与打捞器，确实占着主控。
 * ⚠ 掩护巡逻（`standby`）**不在等待表里**：它不挡 `startExpedition` 的资格判定 ⇒ 引擎会真的试一次出发、
 * 失败即按既有口径**停环**（带日志与在线弹窗），所以这行不需要为它显示"等待"。
 */
export function autoLoopWaitLabel(state: GameState): string | null {
  if (state.expedition.active) return '本次出击'
  if (state.mining.active) return '采矿'
  if (state.salvaging.active) return '残骸打捞'
  if (state.transit.active) return '航行'
  /**
   * **亲自开炉 / 亲自开线也要等**（**2026-09-24 修 · 玩家报障**）。
   *
   * 判据用上面那条老尺：**这一项是否真的占着主控**——`refine` / `manufacturing` 的 `worker === 'pilot'`
   * 两档都占（`activityGate.mainActivityOf` 里就是它们），与采矿/打捞同性质 ⇒ 本表原本漏了它们。
   *
   * 漏掉的后果（船长转述的玩家报障）：重复清剿在跑时，它到点就 `startExpedition` ⇒ 活动闸门
   * 把主控手上的**造船线**当成"当前活动"掐掉（`haltActivityForSwitch`）⇒ 一条 4.8 小时的
   * 一次性舰船蓝图连进度带材料一起没了；**存档实证**：三张一次性舰船图全"已消耗"、舰船仓库一艘都没有。
   * 现在改为**等**（活动栏照既有口径显示"等待：亲自开炉 / 亲自开线"），手工作业跑完自然再出发。
   *
   * ⚠ 只管**主控亲自**那两档：AI 核心驱动的炉/线不占主控（`worker !== 'pilot'`）⇒ 不挡清剿。
   */
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开炉'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开线'
  return null
}

/**
 * 重复清剿推进（在线心跳调用；落档开关在重开档后从可出发条件自动恢复）：
 * 忙（远征/采矿/星图扫描/打捞/航行）或冷却中 → 等待；条件不满足 → 停环并记原因。
 * 返回 null = 继续等待/已再出发；否则 = 停止原因。
 */
export function advanceAutoLoopBounty(state: GameState, ctx: SimContext): string | null {
  const id = state.autoLoopAnomalyId
  if (id === null) return null
  // 别的作业在跑：等（**判据单点 = `autoLoopWaitLabel`**，与活动栏那行同源）
  if (autoLoopWaitLabel(state) !== null) return null
  const anomaly = ctx.anomalies.get(id)
  if (!anomaly) {
    stopAutoLoopReason(state, '目标已不存在。')
    return '目标已不存在'
  }
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) {
    stopAutoLoopReason(state, block)
    return block
  }
  if (bountyCooldownRemainingMs(state, id) > 0) return null // 冷却中：等
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) {
    stopAutoLoopReason(state, '舰队里找不到当前舰船。')
    return '舰队里找不到当前舰船'
  }
  // 装甲/结构 + 货仓两道门槛（**与入侵「重复出击」共用同一份**，见 `autoLoopPreflight`）
  const lootM3 = anomaly.loot.reduce((sum, row) => {
    const def = ctx.items.get(row.itemId)
    return sum + row.units * (def ? cargoUnitM3(state, def) : 0)
  }, 0)
  const pre = autoLoopPreflight(state, ctx, anomaly.name, lootM3)
  if (pre !== null) {
    stopAutoLoopReason(state, pre.notice)
    return pre.reason
  }
  // 出发（内部含声望/冷却/探索/位置全部校验）
  const r = startExpedition(state, id, ctx)
  if (!r.ok) {
    stopAutoLoopReason(state, r.error ?? '无法再出发。')
    return r.error ?? '无法再出发'
  }
  return null
}

/**
 * **循环出发前的两道硬门槛**（装甲/结构 ＋ 货仓）——常驻悬赏的「重复清剿」与入侵的「重复出击」**共用这一份**。
 * 返回 `null` = 通过；否则 **`notice`**（长文案，写日志与在线提示）＋ **`reason`**（短理由，作为函数返回值）。
 * ⚠ 两个字段**都要保留原契约别合并**：既有用例与活动栏都按"返回值 = 短理由"断言
 * （第一版合并成一条 ⇒ `expedition.test.ts` / `t8.test.ts` 三处当场转红）。
 *
 * 口径来源（勿改）：
 * - 耐久（2026-09-08 船长定：装甲或结构 <50% 即自动修补到 60%，为战斗内"结构损失过半自动撤退"留缓冲；
 *   **2026-09-16 船长改判**：改成需要玩家**携带船体维修装置**，消耗的组件类型跟着装置走）；
 * - 货仓（B 甲：无远程入库，回港卸货是玩家的决定；体积按压缩技术折算）。
 */
function autoLoopPreflight(
  state: GameState,
  ctx: SimContext,
  cardName: string,
  lootM3: number,
): { notice: string; reason: string } | null {
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) return { notice: '舰队里找不到当前舰船。', reason: '舰队里找不到当前舰船' }
  if ((fleetShip.armorPct ?? 1) < 0.5 || fleetShip.durability < 0.5) {
    const rep = repairWithKits(state, ctx, 0.6)
    const fs = state.fleet[state.shipId]
    if (!fs || (fs.armorPct ?? 1) < 0.5 || fs.durability < 0.5) {
      if (!rep.hasDevice) {
        return {
          notice:
            '装甲或结构低于 50%：自动修补需要该船装着船体维修装置（中槽）——装上装置并带够对应组件，或先到空间站付费维修。',
          reason: '耐久不足（装甲或结构低于 50%）且未装船体维修装置',
        }
      }
      return {
        notice: '装甲或结构低于 50% 且货仓修理组件不足——请先到空间站付费维修（或补充修理组件）再开启。',
        reason: '耐久不足（装甲或结构低于 50%）且修理组件耗尽',
      }
    }
  }
  if (freeCargoM3(state, ctx) < lootM3) {
    return {
      notice: `货仓剩余空间不足以装载「${cardName}」的缴获——舰船已在母港，请卸货后重新开启讨伐。`,
      reason: '货仓空间不足',
    }
  }
  return null
}

/* ─────────────── 入侵「重复出击」（2026-09-25 船长令） ───────────────
 * 船长原话：「**入侵活动的悬赏，允许玩家开启自动重复，照常计算返回时间。**」
 *
 * 与常驻悬赏的「重复清剿」**同源但不同路**：
 * - 同源：等待表（`autoLoopWaitLabel`）、两道门槛（`autoLoopPreflight`）、停环记账与在线提示
 *   （`autoLoopStopNotice`）全部复用 ⇒ 不会出现"两套循环口径漂移"；
 * - 不同路：**出发走手动出击那条路**（`weekendAssaultDrawOf` 每场重抽 ＋ 把被占星系当 `foeGalaxyId`
 *   传给 `startExpedition`）⇒ **去程/返航时间照目标星系正常计算**（即船长那句"照常计算返回时间"），
 *   赏金按入侵口径为 0。
 *
 * 落档：目标存在 `state.weekendEvent.autoLoopGalaxyId`（可选字段，**不动存档结构版本**）；
 * 活动结束/换周时整个 `weekendEvent` 被换掉 ⇒ 循环天然结束。
 */

/** 入侵「重复出击」的循环目标（= 被占星系 id；null = 没开） */
export function autoLoopInvasionGalaxy(state: GameState): string | null {
  const gid = state.weekendEvent?.autoLoopGalaxyId
  return typeof gid === 'string' && gid.length > 0 ? gid : null
}

/** 停环并记录原因（与 `stopAutoLoopReason` 同款：日志 ＋ 在线一次性提示） */
function stopAutoLoopInvasion(state: GameState, reason: string): void {
  if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  const fs = state.fleet[state.shipId]
  const armorPct = Math.round((fs?.armorPct ?? 1) * 100)
  const structPct = Math.round((fs?.durability ?? 1) * 100)
  const text = `重复出击已暂停：${reason}（当前 装甲 ${armorPct}% / 结构 ${structPct}%）`
  addLog(state, 'combat', text)
  state.autoLoopStopNotice = text
}

/**
 * 开关：`galaxyId = null` ⇒ 停；否则要求该星系**当前仍被入侵**（活动未结束）。
 * 开启时**清掉常驻悬赏那条环**——两者都要占主控，同一时间只跑一条。
 */
export function setAutoLoopInvasion(state: GameState, ctx: SimContext, galaxyId: string | null): CommandResult {
  const ev = state.weekendEvent
  if (galaxyId === null) {
    if (ev) delete ev.autoLoopGalaxyId
    addLog(state, 'combat', '重复出击已停止。', 'core.weekend.034')
    return { ok: true }
  }
  if (!ev || ev.endedAtWallMs !== undefined) {
    return { ok: false, error: '入侵活动已结束。', errorId: 'core.weekend.030' }
  }
  if (!weekendOccupiedLiveAt(state, galaxyId, Date.now())) {
    return { ok: false, error: '该星系当前没有被入侵。', errorId: 'core.weekend.031' }
  }
  if (state.autoLoopAnomalyId !== null) {
    state.autoLoopAnomalyId = null
    state.autoLoopDroneFloor = null
    addLog(state, 'combat', '已停止常驻悬赏的重复清剿——改跑入侵重复出击。', 'core.weekend.032')
  }
  ev.autoLoopGalaxyId = galaxyId
  const name = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  addLog(
    state,
    'combat',
    `重复出击已开启：「${name}」的入侵舰队，每场重抽一支；该星系被夺回或活动结束时自动停止。`,
    'core.weekend.033',
    { p1: name },
  )
  return { ok: true }
}

/**
 * 推进（在线心跳调用）。返回 `null` = 继续等待/已再出发；否则 = 停止原因。
 * 顺序与常驻悬赏那条一致：活动/占领态 → 等待表 → 冷却 → 两道门槛 → 出发。
 */
export function advanceAutoLoopInvasion(state: GameState, ctx: SimContext): string | null {
  const galaxyId = autoLoopInvasionGalaxy(state)
  if (galaxyId === null) return null
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) {
    stopAutoLoopInvasion(state, '入侵活动已结束。')
    return '入侵活动已结束'
  }
  if (!weekendOccupiedLiveAt(state, galaxyId, Date.now())) {
    stopAutoLoopInvasion(state, '该星系已被夺回。')
    return '该星系已被夺回'
  }
  // 别的作业占着主控 ⇒ 等（判据单点与常驻悬赏那条同源）
  if (autoLoopWaitLabel(state) !== null) return null
  /**
   * 冷却与缴获体积都按**该星系板面上那张卡**（`weekendBountyCardsOf` 换出来的那张）判 ——
   * 与手动「出击」按钮的禁用口径同源（手动能点 ⇔ 循环能出发）。
   */
  const visible = [...ctx.anomalies.values()].filter((a) => a.galaxyId === galaxyId && a.hidden !== true)
  const displayed = weekendBountyCardsOf(state, ctx, visible, galaxyId, Date.now())[0]
  if (displayed && bountyCooldownRemainingMs(state, displayed.id) > 0) return null
  const lootM3 = (displayed?.loot ?? []).reduce((sum, row) => {
    const def = ctx.items.get(row.itemId)
    return sum + row.units * (def ? cargoUnitM3(state, def) : 0)
  }, 0)
  const pre = autoLoopPreflight(state, ctx, displayed?.name ?? galaxyId, lootM3)
  if (pre !== null) {
    stopAutoLoopInvasion(state, pre.notice)
    return pre.reason
  }
  // 出发：每场重抽一支 ＋ 星系覆写（与 `engine.startExpeditionAt` 同一条路）
  const dispatch = weekendAssaultDrawOf(state, ctx, galaxyId, Date.now())
  if (dispatch === null) {
    stopAutoLoopInvasion(state, '该星系已被夺回。')
    return '该星系已被夺回'
  }
  const r = startExpedition(state, dispatch.cardId, ctx, {
    foeGalaxyId: galaxyId,
    ...(dispatch.rewardIsk > 0 ? { rewardIskOverride: dispatch.rewardIsk } : {}),
  })
  if (!r.ok) {
    stopAutoLoopInvasion(state, r.error ?? '无法再出发。')
    return r.error ?? '无法再出发'
  }
  weekendNoteAssaultDispatch(state) // 抽过才计数 ⇒ 下一场换一支
  return null
}

/** 远征状态快照（界面用；battle 阶段显示交火信息） */
export interface ExpeditionView {
  active: boolean
  anomalyId: string | null
  anomalyName: string
  galaxyName: string
  remainingMs: number
  totalMs: number
  percent: number
  /** 阶段：out 航行 / combat 交火 / back 返航 */
  phase: 'out' | 'combat' | 'back' | null
  phaseLabel: string
  /** 可否召回（去程可；返航仅失利/撤退可——胜利自动返航不可召回） */
  recallable: boolean
  threat: number
  power: number
  /** 预估胜率（百分比，带伤预警口径 bountyWinPercentGuarded——预计伤及装甲/结构会下调显示；0 = 无法评估） */
  winPercent: number
  /** 交火信息（phase=combat 时） */
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    /** 锁定装置集火目标 tag（2026-09-09：驾驶船装配含 target-lock 件时为存活编队首位；否则 null） */
    lockTag: string | null
  } | null
  /** 赏金任务·窝点档位（1/2/3；null = 本趟打的是常驻悬赏） */
  lairTier: 1 | 2 | 3 | null
}

export function expeditionStatus(state: GameState, ctx: SimContext): ExpeditionView {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const galaxy = anomaly ? ctx.galaxies.get(anomaly.galaxyId) : undefined
  const base = {
    active: false,
    anomalyId: null as string | null,
    anomalyName: '',
    galaxyName: '',
    remainingMs: 0,
    totalMs: 0,
    percent: 0,
    phase: null as 'out' | 'combat' | 'back' | null,
    phaseLabel: '',
    recallable: false,
    threat: 0,
    power: 0,
    winPercent: 0,
    combat: null,
    lairTier: null as 1 | 2 | 3 | null,
  }
  if (!exp.active || exp.anomalyId === null) return base

  // 窝点（赏金任务目标）：展示名/威胁/胜率估算一律按档位强化后的卡（与战斗、结算同口径）
  const card = anomaly && exp.lairTier ? lairAnomalyOf(anomaly, exp.lairTier) : anomaly
  const threat = card?.threat ?? 0
  const power = exp.power
  const phase: 'out' | 'combat' | 'back' = exp.phase === 'battle' ? 'combat' : exp.phase
  const phaseLabel =
    phase === 'out' ? '航行中（去程）' : phase === 'combat' ? '交火中' : '返航中'
  // 进度：out（仅旧档兼容）按单程；back 去程并入返航按 2×单程；combat 按已交战时间/最大上限
  let percent = 0
  let remainingMs = 0
  let totalMs = 1
  if (exp.phase === 'out') {
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    totalMs = exp.outMs
    percent = Math.min(100, Math.max(0, ((totalMs - remainingMs) / Math.max(1, totalMs)) * 100))
  } else if (exp.phase === 'back') {
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    // 2026-09-08：进度分母 = 返航段实际时长（returnAtGameMs 兼容字段；
    // 本地 120s / 异星系 2×单程均正确；旧档在途 back 无该字段 → 回退旧口径 outMs×2）
    const totalBack =
      exp.returnAtGameMs !== undefined && Number.isFinite(exp.returnAtGameMs)
        ? Math.max(1, exp.finishAtGameMs - exp.returnAtGameMs)
        : exp.outMs * RETURN_LEG_MUL
    totalMs = Math.max(1, totalBack)
    percent = Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100))
  } else if (exp.battle) {
    const b = exp.battle
    // 2026-09-09：进度按"战斗时钟"（lastTick−startedAt）而非墙钟——多波次演出窗口与击杀慢镜
    // 期间战斗时钟冻结（不计 maxBattleMs 超时），进度条随之停走，避免间隙空耗把进度顶满
    const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
    totalMs = ctx.balance.battle.maxBattleMs
    remainingMs = Math.max(0, totalMs - elapsed)
    percent = Math.min(100, (elapsed / totalMs) * 100)
  }
  let winPercent = 0
  if (card && exp.phase !== 'battle') {
    // 2026-09-08：悬赏展示胜率走"带伤预警"口径（预计伤及装甲/结构 → 显示下调，结算不变）
    winPercent = Math.round(bountyWinPercentGuarded(state, ctx, card, state.shipId) * 100)
  }
  const combat =
    exp.phase === 'battle' && exp.battle
      ? (() => {
          // 2026-09-09 锁定装置：集火目标 = 存活编队首位（装配含 target-lock 件才显示；无锁定 = null）
          let lockTag: string | null = null
          if (familyModules(state, ctx, state.shipId, 'target-lock').length > 0) {
            for (const [tag, u] of Object.entries(exp.battle!.units)) {
              if (u.side !== 'foe') continue
              if (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0) {
                lockTag = tag
                break
              }
            }
          }
          return {
            distanceM: Math.round(exp.battle!.distanceM),
            myDesireM: Math.round(exp.battle!.myDesireM),
            meHp: { ...(exp.battle!.units['player']?.hp ?? { s: 0, a: 0, h: 0 }) },
            foeHp: Object.fromEntries(
              Object.entries(exp.battle!.units)
                .filter(([, u]) => u.side === 'foe')
                .map(([tag, u]) => [tag, { s: Math.round(u.hp.s), a: Math.round(u.hp.a), h: Math.round(u.hp.h), name: u.name }]),
            ),
            shots: exp.battle!.stats.meShots,
            hits: exp.battle!.stats.meHits,
            lockTag,
          }
        })()
      : null

  return {
    active: true,
    anomalyId: exp.anomalyId,
    anomalyName: card?.name ?? exp.anomalyId,
    galaxyName: galaxy?.name ?? '',
    remainingMs,
    totalMs,
    percent,
    phase,
    phaseLabel,
    recallable: exp.phase === 'out' || (exp.phase === 'back' && exp.returnReason !== 'victory'),
    threat,
    power,
    winPercent,
    combat,
    lairTier: exp.lairTier ?? null,
  }
}

/** 目标可否出发的说明（界面禁用提示用；V13 含探索封锁） */
export function expeditionFeasibility(state: GameState, anomaly: AnomalyDef, ctx: SimContext): { ok: boolean; reason: string } {
  if (state.mining.active) return { ok: false, reason: '采矿中' }
  if (state.salvaging.active) return { ok: false, reason: '打捞中' }
  if (state.expedition.active) return { ok: false, reason: '远征中' }
  if (state.sideTasks.deliver !== null) return { ok: false, reason: '快递投送中' }
  const standing = standingOf(state, DSI_FACTION_ID)
  if (standing < anomaly.standingReq) return { ok: false, reason: `需声望 ${anomaly.standingReq}` }
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, reason: '星系未探索' }
  const minutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, anomaly.galaxyId)
  if (!Number.isFinite(minutes)) return { ok: false, reason: '无航路' }
  return { ok: true, reason: `去程即时 · 失利返航约 ${minutes * 2} 分钟` }
}
