import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { deployedCombatEscorts } from './locks'

export function detachExpeditionReturn(state: GameState): void {
  const exp = state.expedition, sortie = exp.sortie
  if (exp.active || !sortie) return
  const returning = state.shipReturns[sortie.leaderShipId]
  if (!returning) return
  for (const id of sortie.shipIds) {
    if (state.fleet[id] && !state.shipReturns[id]) state.shipReturns[id] = { ...returning, reason: 'expedition' }
  }
  delete exp.sortie
  if (state.combatEscort?.leaderShipId === sortie.leaderShipId) delete state.combatEscort
}

export function detachWorkReturn(state: GameState): void {
  const escort = state.combatEscort
  if (!escort || escort.leaderShipId !== state.shipId) return
  const returning = state.shipReturns[escort.leaderShipId]
  if (!returning || !['miningStop', 'salvageStop', 'salvage'].includes(returning.reason ?? '')) return
  for (const id of escort.shipIds) {
    if (state.fleet[id] && !state.shipReturns[id]) state.shipReturns[id] = { ...returning }
  }
  delete state.combatEscort
}

export function settleCommandEscortsAtPort(state: GameState, ctx: SimContext): void {
  const escort = state.combatEscort
  if (!escort || deployedCombatEscorts(state).length || state.expedition.active || state.encounter.active || state.expedition.sortie) return
  if (state.wormhole.run?.fleet.some(id => escort.shipIds.includes(id))) return
  delete state.combatEscort
}

export function finishDestroyedSortie(state: GameState, battle: NonNullable<GameState['expedition']['battle']>): boolean {
  if (!battle.myFleet?.length || battle.myFleet.some(row => state.fleet[row.shipId])) return false
  const exp = state.expedition
  exp.active = false
  exp.battle = null
  exp.anomalyId = null
  exp.phase = 'out'
  exp.finishAtGameMs = 0
  delete exp.sortie
  delete state.combatEscort
  exp.lairTier = undefined
  exp.factionActive = undefined
  exp.eventId = null
  exp.returnReason = undefined
  state.autoLoopAnomalyId = null
  if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  state.awayGalaxy = null
  state.dockedSite = null
  return true
}
