import type { GameState } from '../../src/state'
import type { SimContext } from '../../src/types'
import { createPlayerSpec } from '../../src/combat'
import { battleCardKey, playerFleetMaxRangeOf } from '../../src/battleRangeMemory'

/** 距离专项只安排已存在的入场记录，射程仍由本次真实规格计算。 */
export function setCardDistance(state: GameState, ctx: SimContext, cardId: string, desireM: number, ships = [state.shipId]): void {
  const maxRangeM = playerFleetMaxRangeOf(ships.map(id => createPlayerSpec(state, ctx, id)!))
  state.battleRangeByCard = { ...state.battleRangeByCard, [battleCardKey(cardId)]: { desireM, maxRangeM } }
}
