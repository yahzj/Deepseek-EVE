import type { GameState } from './state'
import { combatRosterOf } from './combat/command/roster'
import type { SimContext } from './types'
import { scaledReturnMs } from './trips'

export function workFleetShipIds(state: GameState, preview = false): string[] {
  const ids = preview ? combatRosterOf(state)
    : state.combatEscort?.leaderShipId === state.shipId ? state.combatEscort.shipIds : [state.shipId]
  return [...new Set(ids)].filter(id => state.fleet[id] !== undefined && !state.aiAssignments[id])
}

export function workFleetReturnMs(state: GameState, ctx: SimContext, fullMsOf: (id: string) => number, fuelMul = 1): number {
  return Math.max(1, ...workFleetShipIds(state).map(id => scaledReturnMs(fullMsOf(id), state, ctx, id, fuelMul)))
}
