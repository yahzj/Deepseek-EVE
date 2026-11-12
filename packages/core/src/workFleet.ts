import type { GameState } from './state'
import { combatRosterOf } from './combat/command/roster'
import type { SimContext } from './types'
import { scaledReturnMs } from './trips'

/** 在途只认出发快照；预览才读取准备名单，不从基地临时补船。 */
export function workFleetShipIds(state: GameState, preview = false): string[] {
  const ids = preview ? combatRosterOf(state)
    : state.combatEscort?.leaderShipId === state.shipId ? state.combatEscort.shipIds : [state.shipId]
  return [...new Set(ids)].filter(id => state.fleet[id] !== undefined && !state.aiAssignments[id])
}

/** 同队同返，按每艘船真实航速和载货比例取最长腿；预览不扣燃料。 */
export function workFleetReturnMs(state: GameState, ctx: SimContext, fullMsOf: (id: string) => number, fuelMul = 1): number {
  return Math.max(1, ...workFleetShipIds(state).map(id => scaledReturnMs(fullMsOf(id), state, ctx, id, fuelMul)))
}
