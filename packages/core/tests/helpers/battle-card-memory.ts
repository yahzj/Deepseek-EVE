import type { GameState } from '../../src/state'
import type { SimContext } from '../../src/types'
import { battleCardKey } from '../../src/battleRangeMemory'

/** 仅注入合法旧距离记录；首次真实入场补齐电子战、旗舰覆写及编队后的射程快照。 */
export function setCardDistance(state: GameState, _ctx: SimContext, cardId: string, desireM: number, ships = [state.shipId]): void {
  state.battleRangeByCard = { ...state.battleRangeByCard, [battleCardKey(cardId)]: { desireM, shipIds: [...ships] } }
}
