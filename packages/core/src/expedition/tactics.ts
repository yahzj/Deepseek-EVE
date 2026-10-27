/** 战斗域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { fleetDefOf } from '../instances'
import { createPlayerSpec, desiredRangeFor, wormholeDerivedAnomaly, activeFoeSpecsOf, battleMaxDistanceM } from '../combat'
import type { CommandResult } from '../engine'
import { battleCardRangeOf, battleCardKey } from '../battleRangeMemory'

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
  const encounterBattle = state.encounter.active ? state.encounter.battle : null
  const cardId = anomalyId ?? (whBattle ? (whBattle.wormhole?.cardId ?? null) : encounterBattle ? state.encounter.anomalyId : state.expedition.anomalyId)
  const anomaly = cardId ? ctx.anomalies.get(cardId) : undefined
  const anchorShipId = whBattle ? (whRun?.fleet[0] ?? state.shipId) : encounterBattle ? (encounterBattle.myFleet?.[0]?.shipId ?? state.encounter.shipId ?? state.shipId) : state.shipId
  const me = createPlayerSpec(state, ctx, anchorShipId)
  if (!anomaly || !me) return 0
  return desiredRangeFor(me, tactic, ctx.balance.battle)
}

/** 玩家选距：三种战斗宿主共用，按实际卡ID写回；旧在途场次不编造入场射程。 */
export function setBattleDesire(state: GameState, desireM: number, ctx: SimContext): CommandResult {
  const whRun = state.wormhole.run
  const whBattle = whRun?.battle ?? null
  /** 第三宿主（遭遇槽 —— 旗舰战与普通伏击战都走这里）：只要那场还在打就认 */
  const wkBattle = state.encounter.active && state.encounter.battle !== null ? state.encounter.battle : null
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
  const maxD = battleMaxDistanceM(battle, me, waveFoes, ctx.balance.battle) * (battle.wormhole?.desireRangeMul ?? 1)
  const minD = ctx.balance.battle.minDistanceM
  const clamped = Math.round(Math.min(maxD, Math.max(minD, desireM)))
  battle.myDesireM = clamped
  if (battle.rangeMemory) {
    battle.rangeMemory.desireM = clamped
    const key = battle.rangeMemory.cardId
    const previous = battleCardRangeOf(state, key) ?? { maxRangeM: battle.rangeMemory.maxRangeM }
    state.battleRangeByCard = { ...state.battleRangeByCard, [key]: { ...previous, desireM: clamped } }
  }
  // 已在途旧战斗没有入场射程证据，只补距离；下一次真正入场再建立射程记录。
  if (!battle.rangeMemory && cardId) {
    const old = battleCardRangeOf(state, cardId)
    if (!whRun?.automaticBattleRanges) state.battleRangeByCard = { ...state.battleRangeByCard, [battleCardKey(cardId)]: { ...old, desireM: clamped } }
  }
  return { ok: true }
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
