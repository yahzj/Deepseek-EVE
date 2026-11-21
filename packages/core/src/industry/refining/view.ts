import type { GameState, RefineRunState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { aiCoreName } from '../../ai'
import { RARE_UNIT_M3, refineRate } from './params'

export function refineRunActive(state: GameState): boolean {
  return state.refineRuns.length > 0
}

export function refineManualActive(state: GameState): boolean {
  return state.refineRuns.some((r) => r.active && r.worker === 'pilot')
}

export interface RefineRunView {
  active: boolean
  id: number
  itemId: string | null
  itemName: string
  recipe: 'refine' | 'recycle' | 'unbox'
  worker: 'pilot' | AiCoreType
  workerLabel: string
  rate: number
  batchUnits: number
  cycleMs: number
  batchesDone: number
  claimedUnits?: number
  rareUnitsLeft?: number
  percent: number
  remainingMs: number
}

function unitsLeftOf(r: RefineRunState, batchesPerUnit: number): number {
  void batchesPerUnit
  if (r.rareUnits !== undefined) return Math.max(0, r.rareUnits)
  if (r.claimedUnits === undefined) return 0
  if (r.rareBoxEligible !== false) return 1
  return (r.lockUnits ?? 0) >= RARE_UNIT_M3 ? 1 : 0
}

function refineRunViewOf(state: GameState, ctx: SimContext, r: RefineRunState): RefineRunView {  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  const base = {
    active: r.active,
    id: r.id,
    itemId: r.itemId,
    itemName: def?.name ?? '—',
    recipe: r.recipe,
    worker: r.worker,
    workerLabel: r.worker === 'pilot' ? '主控' : aiCoreName(r.worker),
    rate: refineRate(state, ctx),
    batchUnits: r.batchUnits,
    cycleMs: r.cycleMs,
    batchesDone: r.batchesDone,
    claimedUnits: r.claimedUnits,
    ...(r.claimedUnits !== undefined
      ? { rareUnitsLeft: unitsLeftOf(r, Math.max(1, Math.round(RARE_UNIT_M3 / Math.max(1, r.batchUnits)))) }
      : {}),
  }
  if (!r.active || r.itemId === null || r.cycleMs <= 0) {
    return { ...base, percent: 0, remainingMs: 0 }
  }
  const remainCur = Math.max(0, r.finishAtGameMs - state.gameMs)
  const percent = Math.min(100, Math.max(0, Math.round(((r.cycleMs - remainCur) / r.cycleMs) * 100)))
  return { ...base, percent, remainingMs: remainCur }
}

export function refineRunViews(state: GameState, ctx: SimContext): RefineRunView[] {
  return state.refineRuns.map((r) => refineRunViewOf(state, ctx, r))
}
