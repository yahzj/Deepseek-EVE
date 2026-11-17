import { ceilFinalQuantity } from '../../quantity'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOfCard } from '../../salvage'
import { type WeekendEventState, weekendOccupiedIds, weekendPlayerContribution, weekendProgressAt } from '../../weekendEvent'
import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { blackBoxItemIdForFamily } from '../../blackbox'
import { addWare } from '../../inventory'

export const WEEKEND_RECLAIM_WRECK = 8

export const WEEKEND_RECLAIM_ISK = 2_000_000

export const WEEKEND_ALL_CLEAR_ISK = 5_000_000

export const WEEKEND_FLAGSHIP_WRECK = 3

export function weekendRareWreckUnits(pieces: number): number {
  return Math.max(0, ceilFinalQuantity(pieces)) * RARE_WRECK_VOLUME_M3
}

export function weekendReclaimAwardOf(ev: WeekendEventState, galaxyId: string): { wreck: number; isk: number } {
  const put = ev.contributed[galaxyId] ?? 0
  const ratio = Number.isFinite(put) ? Math.min(1, Math.max(0, put)) : 0
  return {
    wreck: weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK * ratio),
    isk: ceilFinalQuantity(WEEKEND_RECLAIM_ISK * ratio),
  }
}

export function weekendAllClearAwardOf(ev: WeekendEventState): number {
  const ids = weekendOccupiedIds(ev)
  if (ids.length === 0) return 0
  const total = weekendPlayerContribution(ev)
  if (!Number.isFinite(total) || total <= 0) return 0
  return ceilFinalQuantity(WEEKEND_ALL_CLEAR_ISK * Math.min(1, total / ids.length))
}

export function noteReward(
  ev: WeekendEventState,
  galaxyId: string | undefined,
  add: { isk?: number; wreck?: number; blackBox?: number },
): void {
  const led = (ev.rewardLedger ??= { isk: 0, wreck: 0, blackBox: 0, byGalaxy: {} })
  const isk = Math.max(0, ceilFinalQuantity(add.isk ?? 0))
  const wreck = Math.max(0, ceilFinalQuantity(add.wreck ?? 0))
  const blackBox = Math.max(0, ceilFinalQuantity(add.blackBox ?? 0))
  led.isk += isk
  led.wreck += wreck
  led.blackBox += blackBox
  if (galaxyId !== undefined && (isk > 0 || wreck > 0)) {
    const g = (led.byGalaxy[galaxyId] ??= { isk: 0, wreck: 0 })
    g.isk += isk
    g.wreck += wreck
  }
}

export function noteReclaimPending(ev: WeekendEventState, add: { isk?: number; wreck?: number }): void {
  const cur = (ev.reclaimPending ??= { isk: 0, wreck: 0 })
  cur.isk += Math.max(0, ceilFinalQuantity(add.isk ?? 0))
  cur.wreck += Math.max(0, ceilFinalQuantity(add.wreck ?? 0))
}

export function weekendSyncReclaimRewards(
  state: GameState,
  ev: WeekendEventState,
  nowWallMs: number,
): { galaxies: string[]; allClear: boolean } {
  const paid = (ev.reclaimPaid ??= [])
  const all = weekendOccupiedIds(ev)
  const reclaimed = all.filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
  const fresh = reclaimed.filter((id) => !paid.includes(id))
  if (fresh.length === 0) return { galaxies: [], allClear: false }
  for (const id of fresh) {
    const award = weekendReclaimAwardOf(ev, id)
    noteReward(ev, id, award)
    noteReclaimPending(ev, award)
    paid.push(id)
  }
  const allClear = paid.length >= all.length && all.length > 0
  if (allClear) {
    const bonus = weekendAllClearAwardOf(ev)
    noteReward(ev, undefined, { isk: bonus })
    noteReclaimPending(ev, { isk: bonus })
  }
  return { galaxies: fresh, allClear }
}

export const WEEKEND_BLACKBOX_ITEM_ID = 'blackbox-h'

export function weekendBlackBoxItemIdOf(ev: WeekendEventState | undefined, ctx: SimContext): string {
  const family = ev?.family
  if (family === undefined || family.length === 0) return WEEKEND_BLACKBOX_ITEM_ID
  return blackBoxItemIdForFamily(family, (id) => ctx.items.has(id))
}

export function weekendRareWreckIdFor(cardId: string, ctx: SimContext): string | undefined {
  return rareWreckItemIdOfCard(cardId, ctx) ?? undefined
}

export function weekendGrantRewards(
  state: GameState,
  reward: { isk?: number; wreck?: number; blackBox?: boolean; wreckItemId?: string; blackBoxItemId?: string },
): { isk: number; wreck: number; blackBox: number } {
  const isk = Math.max(0, ceilFinalQuantity(reward.isk ?? 0))
  const wreckWant = Math.max(0, ceilFinalQuantity(reward.wreck ?? 0))
  if (isk > 0) state.wallet.isk += isk
  let wreck = 0
  if (wreckWant > 0) {
    if (reward.wreckItemId !== undefined) {
      if (addWare(state, reward.wreckItemId, wreckWant)) wreck = wreckWant
    } else {
      addLog(state, 'warn', '⚠ 入侵战利品未能入库：本场奖励未发放。', 'core.weekend.038')
    }
  }
  let blackBox = 0
  if (reward.blackBox && addWare(state, reward.blackBoxItemId ?? WEEKEND_BLACKBOX_ITEM_ID, 1)) blackBox = 1
  return { isk, wreck, blackBox }
}
