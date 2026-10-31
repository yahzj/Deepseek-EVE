import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { unloadCargoOfShipToWarehouse } from '../../inventory'
import { deployedCombatEscorts } from './locks'

/** 主控作业或旧船善后均已到港后，再释放随行快照并卸下各舰货物。 */
export function settleCommandEscortsAtPort(state: GameState, ctx: SimContext): void {
  const escort = state.combatEscort
  if (!escort || deployedCombatEscorts(state).length || state.expedition.active || state.encounter.active || state.expedition.sortie) return
  if (state.wormhole.run?.fleet.some(id => escort.shipIds.includes(id))) return
  delete state.combatEscort
  for (const id of escort.shipIds) if (state.fleet[id]) unloadCargoOfShipToWarehouse(state, ctx, id)
}

/** 全损后补发的驾驶船留在港内，不继承旧队航程和货仓结算。 */
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
