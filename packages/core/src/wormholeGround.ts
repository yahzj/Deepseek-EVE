import type { WormholeRunState } from './wormhole'
import type { SimContext } from './types'
import { holdAdd, holdAddCargo, holdCellsUsed, makeHoldState, WORMHOLE_HOLD_COLS, WORMHOLE_SLOT_M3 } from './wormholeHold'
import type { WormholeHoldState } from './wormholeHold'

export function wormholeGroundKey(run: WormholeRunState): string | undefined {
  const pos = run.grid?.pos
  return pos ? `${pos.q},${pos.r}` : undefined
}

/** 新趟每个地点独立记实物，不建立随行临时货仓或第二份数量账。 */
export function wormholeGroundBoard(run: WormholeRunState, create = false): WormholeHoldState | undefined {
  if (run.supplyVersion !== 1) return undefined
  const key = wormholeGroundKey(run)
  if (!key) return undefined
  if (!create) return run.groundCargo?.[key]
  const ground = run.groundCargo ??= {}
  return ground[key] ??= makeHoldState(WORMHOLE_HOLD_COLS / 2)
}

export function wormholeGroundPending(run: WormholeRunState): boolean {
  return (wormholeGroundBoard(run)?.placements.length ?? 0) > 0
}

/** 展示格板可以分段显示，32格不是地点实物上限。 */
export function wormholeGroundAddShape(run: WormholeRunState, itemId: string): boolean {
  const board = wormholeGroundBoard(run, true)
  if (!board) return false
  return holdAdd(board, itemId, holdCellsUsed(board) + WORMHOLE_HOLD_COLS * (board.placements.length + 2)).ok
}

export function wormholeGroundAddCargo(run: WormholeRunState, ctx: SimContext, itemId: string, units: number, supply = false): boolean {
  const volume = ctx.items.get(itemId)?.unitM3 ?? 0
  if (!Number.isSafeInteger(units) || units <= 0 || volume <= 0) return false
  const board = wormholeGroundBoard(run, true)
  if (!board) return false
  const staged = structuredClone(board)
  const per = Math.max(1, Math.floor(WORMHOLE_SLOT_M3 / volume))
  for (let left = units; left > 0;) {
    const take = Math.min(left, per)
    const added = holdAddCargo(staged, itemId, take, 1, holdCellsUsed(staged) + WORMHOLE_HOLD_COLS * (staged.placements.length + 2))
    if (!added.ok) return false
    if (added.placement && supply) added.placement.supply = true
    left -= take
  }
  board.placements = staged.placements
  return true
}
