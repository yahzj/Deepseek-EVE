import type { GameState } from '../state'
import type { SimContext } from '../types'
import { fleetDefOf } from '../instances'
import { createPlayerSpec, desiredRangeFor, resolvedBattleAnomaly, activeFoeSpecsOf, battleMaxDistanceM } from '../combat'
import type { CommandResult } from '../engine'
import { battleCardRangeOf, battleCardKey } from '../battleRangeMemory'

export function calcPower(state: GameState, ctx: SimContext, shipId: string = state.shipId): number {
  const bal = ctx.balance.combat
  const gunnery = state.skills.trained[bal.gunnerySkillId] ?? 0
  const base = bal.basePower + bal.powerPerLevel * gunnery
  const shipDef = fleetDefOf(state, ctx, shipId)
  return Math.round(base * (1 + (shipDef?.powerBonus ?? 0)))
}

export type BattleTacticChoice = 'assault' | 'mid' | 'kite'

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

export function setBattleDesire(state: GameState, desireM: number, ctx: SimContext): CommandResult {
  const whRun = state.wormhole.run
  const whBattle = whRun?.battle ?? null
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
  const anomaly = resolvedBattleAnomaly(ctx, battle, cardId,
    !whBattle && !wkBattle ? state.expedition.lairTier : undefined,
    !whBattle && !wkBattle ? state.expedition.factionActive : undefined)
  if (!me || !anomaly) return { ok: false, error: '战斗记录缺失。', errorId: 'core.expedition.002' }
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
  if (!battle.rangeMemory && cardId) {
    const old = battleCardRangeOf(state, cardId)
    if (!whRun?.automaticBattleRanges) state.battleRangeByCard = { ...state.battleRangeByCard, [battleCardKey(cardId)]: { ...old, desireM: clamped } }
  }
  return { ok: true }
}

export function abandonChance(
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
