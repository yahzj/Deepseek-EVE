import { type GameState, shipLockedInWormhole, addLog } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { withBattleRangeCheck } from '../battleRangeMemory'
import { weekendBattleInvolvedOf, weekendApplyBattleOutcome } from '../weekendBattle'
import { startBattleFor } from '../combat'
import { foeKeyOf } from './presence'
import { weekendKindOfEncounter } from './return'
import { settleEscape } from './outcome'
import { commandBudgetOf } from '../combat/command/rules'
import { startFleetBattleFor } from '../combat/startFleet'
import { combatEscortBlock, encounterCombatRosterOf } from '../combat/command/locks'

export function fightEncounter(state: GameState, ctx: SimContext): CommandResult {
  if (state.encounter.pirate && state.encounter.battle) return { ok: true }
  return withBattleRangeCheck(state, { kind: 'encounter', invitedAtGameMs: state.encounter.invitedAtGameMs }, staged => fightEncounterMutable(staged, ctx))
}

export function fightEncounterMutable(state: GameState, ctx: SimContext): CommandResult {
  const enc = state.encounter
  if (!enc.active || enc.battle) return { ok: false, error: '当前没有可应战的遭遇。', errorId: 'core.encounters.003' }
  if (shipLockedInWormhole(state, enc.shipId ?? state.shipId)) {
    return { ok: false, error: '这艘船在虫洞里（已锁定）：换一艘应战，或先撤离本趟。', errorId: 'core.encounters.004' }
  }
  const weekendFoe = weekendBattleInvolvedOf(state, ctx, enc.anomalyId ?? null, Date.now())
  const squad = encounterCombatRosterOf(state)
  const budget = commandBudgetOf(state, ctx, squad)
  if (!budget.ok) return budget
  const blocked = combatEscortBlock(state, squad)
  if (blocked) return { ok: false, ...blocked }
  const battle = squad.length > 1 ? startFleetBattleFor(state, ctx, squad, foeKeyOf(enc), state.gameMs, undefined, undefined,
    weekendFoe ? { threat: enc.threat, patrolFormation: true, ...(enc.foeStrengthMul !== undefined ? { strengthMul: enc.foeStrengthMul } : {}) } : undefined) : startBattleFor(
    state,
    ctx,
    enc.shipId ?? state.shipId,
    foeKeyOf(enc),
    state.gameMs,
    undefined,
    weekendFoe
      ? { threat: enc.threat, patrolFormation: true, ...(enc.foeStrengthMul !== undefined ? { strengthMul: enc.foeStrengthMul } : {}) }
      : undefined,
  )
  if (!battle) return { ok: false, error: '遭遇异常，无法开战。', errorId: 'core.encounters.005' }
  battle.hullEscapeFrac = ctx.balance.encounter.retreatHullFrac
  enc.battle = battle
  addLog(state, 'combat', '已应战：遭遇战打响（引擎自动推演，战报稍后）。', 'core.encounters.006')
  return { ok: true }
}

export function retreatEncounterBattle(state: GameState, ctx: SimContext): CommandResult {
  if (state.departure?.kind === 'flagship') return { ok: false, errorId: 'core.departure.001' }
  const enc = state.encounter
  if (!enc.active || !enc.battle) {
    return { ok: false, error: '当前不在交火中，无法脱离。', errorId: 'core.encounters.009' }
  }
  if (enc.battle.ended !== null) {
    return { ok: false, error: '战斗已分出胜负，正在结算——无法脱离。', errorId: 'core.encounters.010' }
  }
  weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, false, Date.now(), enc.battle, {
    kind: weekendKindOfEncounter(state, enc),
    galaxyId: enc.galaxyId ?? '',
    source: 'battle',
  })
  settleEscape(state, ctx, 'manual')
  return { ok: true }
}
