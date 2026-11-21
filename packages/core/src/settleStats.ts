import { ceilFinalQuantity } from './quantity'
import type { AiCoreType } from './types'

export interface CoreSettleStats {
  miningTrips: number
  salvageDone: number
  refineBatches: number
  recycleBatches: number
  makeDone: number
  shipsDone: number
  labBatches: number
  income: number
}

export type SettleStats = Partial<Record<AiCoreType, CoreSettleStats>> & { combat?: import('./offlineCombatStats').OfflineCombatStats }

export function newSettleStats(): SettleStats {
  return {}
}

function rec(stats: SettleStats | undefined, type: AiCoreType): CoreSettleStats | null {
  if (!stats) return null
  let s = stats[type]
  if (!s) s = stats[type] = { miningTrips: 0, salvageDone: 0, refineBatches: 0, recycleBatches: 0, makeDone: 0, shipsDone: 0, labBatches: 0, income: 0 }
  return s
}

export function addAiMiningTrip(stats: SettleStats | undefined, type: AiCoreType): void {
  const s = rec(stats, type)
  if (s) s.miningTrips += 1
}

export function addAiSalvageDone(stats: SettleStats | undefined, type: AiCoreType): void {
  const s = rec(stats, type)
  if (s) s.salvageDone += 1
}

export function addAiRefineBatch(stats: SettleStats | undefined, type: AiCoreType, isRecycle: boolean): void {
  const s = rec(stats, type)
  if (!s) return
  if (isRecycle) s.recycleBatches += 1
  else s.refineBatches += 1
}

export function addAiMakeDone(stats: SettleStats | undefined, type: AiCoreType): void {
  const s = rec(stats, type)
  if (s) s.makeDone += 1
}

export function addAiLabBatch(stats: SettleStats | undefined, type: AiCoreType): void {
  const s = rec(stats, type)
  if (s) s.labBatches += 1
}

export function addAiShipDone(stats: SettleStats | undefined, type: AiCoreType): void {
  const s = rec(stats, type)
  if (s) s.shipsDone += 1
}

export function addAiIncome(stats: SettleStats | undefined, type: AiCoreType, isk: number): void {
  const s = rec(stats, type)
  if (!s) return
  s.income += Math.max(0, ceilFinalQuantity(isk))
}
