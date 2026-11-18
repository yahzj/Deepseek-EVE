import type { GameState, RefineRunState } from '../../state'
import { addWare } from '../../inventory'

export function refundClaimedUnits(state: GameState, r: RefineRunState): number {
  const left = Math.max(0, r.claimedUnits ?? 0)
  if (left <= 0 || !r.itemId) {
    r.claimedUnits = 0
    return 0
  }
  addWare(state, r.itemId, left)
  r.claimedUnits = 0
  return left
}
