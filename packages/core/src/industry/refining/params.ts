import { ceilFinalQuantity } from '../../quantity'
import { matterTechVoidYield } from '../../matterTech'
import type { GameState } from '../../state'
import type { ItemDef, SimContext } from '../../types'
import { countItem, countWare } from '../../inventory'
import { stationActivityStartState } from '../../location'
import { shipActuallyDocked } from '../../shipActionPolicy'
import { RECYCLE_BATCH_M3, isRareWreck, RARE_WRECK_VOLUME_M3 } from '../../salvage'

export function refineRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.refining
  const level1 = state.skills.trained[bal.rateSkillId] ?? 0
  const level2 = state.skills.trained[bal.secondRateSkillId] ?? 0
  const smeltUpLv = Math.min(5, state.skills.trained['smelting-mastery'] ?? 0)
  const rate = bal.baseRate + bal.ratePerLevel * level1 + bal.secondRatePerLevel * level2 + 0.01 * smeltUpLv
  return Math.max(0, rate)
}

export const REFINE_SKILL_MAX_LEVEL = 5

export function refineRateMax(ctx: SimContext): number {
  const bal = ctx.balance.refining
  const perLevel = bal.ratePerLevel + bal.secondRatePerLevel + 0.01
  return Math.max(0, bal.baseRate + perLevel * REFINE_SKILL_MAX_LEVEL)
}

export interface RefineOutputRow {
  mineralId: string
  units: number
}

export function refineBatchOutputOf(
  state: GameState,
  ctx: SimContext,
  def: ItemDef,
  perBatchUnits: number,
): RefineOutputRow[] {
  const rate = refineRate(state, ctx)
  const out: RefineOutputRow[] = []
  for (const row of def.refine ?? []) {
    const mineral = ctx.items.get(row.mineralId)
    if (!mineral || mineral.kind !== 'mineral') continue
    const rowMul = row.mineralId === 'min-voidcrystal' ? 1 + matterTechVoidYield(state, ctx) : 1
    const units = ceilFinalQuantity(perBatchUnits * row.perOre * rate * rowMul)
    if (units > 0) out.push({ mineralId: row.mineralId, units })
  }
  return out
}

export function oreAvailable(state: GameState, oreId: string): number {
  return countItem(state, oreId) + countWare(state, oreId)
}

export function industryAvailable(state: GameState, ctx: SimContext, itemId: string, worker?: 'pilot'): number {
  const readable = worker === 'pilot' ? stationActivityStartState(state, 'refine', ctx) : state
  return countWare(state, itemId) + (shipActuallyDocked(readable, ctx) ? countItem(state, itemId) : 0)
}

const FALLBACK_BATCH_UNITS = 10

const FALLBACK_CYCLE_MS = 6_000

export function refineBaseParamsOf(def: ItemDef): { batchUnits: number; cycleMs: number } {
  const batchUnits =
    def.refineBatchUnits !== undefined && def.refineBatchUnits > 0 ? ceilFinalQuantity(def.refineBatchUnits) : FALLBACK_BATCH_UNITS
  const cycleMs =
    def.refineCycleMs !== undefined && def.refineCycleMs > 0 ? Math.floor(def.refineCycleMs) : FALLBACK_CYCLE_MS
  return { batchUnits, cycleMs }
}

export function recycleBatchM3Of(wreckItemId: string): number {
  return isRareWreck(wreckItemId) ? RARE_UNIT_M3 : RECYCLE_BATCH_M3
}

export const RARE_UNIT_M3 = RARE_WRECK_VOLUME_M3

export const UNBOX_CYCLE_MS = 90_000
