/**
 * 离线结算统计（2026-09-08 船长定：离线报告按 AI 核心列出离线作业 + 预估收入）。
 * 只存在于离线结算期间的内存中（不透传/不落盘，正常推进零开销）；
 * 由 advanceGame 的 opts.settleStats 分发给各完成点计数。
 *
 * 计数单位：
 * - AI 采矿：每次满载自动返港并卸货 = 1 趟；
 * - AI 打捞：每趟任务完成卸货 = 1 次；
 * - AI 精炼炉/回收炉：每完成 1 批 = 1 批；
 * - AI 制造线：每条线到点完成 = 1 件；
 * - income：预估收入（ISK）——资源/矿物按站内收价（baseSellPriceIsk）、装备与舰船按市场
 *   基准价（basePrice）粗估；残骸与蓝图碎片不计（不可直接变现）。
 */
import type { AiCoreType } from './types'

export interface CoreSettleStats {
  miningTrips: number
  salvageDone: number
  refineBatches: number
  recycleBatches: number
  makeDone: number
  /** 预估收入（ISK，累计） */
  income: number
}

/** 核心类型 → 该类型核心的离线作业统计（只统计有活动的类型） */
export type SettleStats = Partial<Record<AiCoreType, CoreSettleStats>>

/** 结算开始前创建空统计（传给 simulateOffline/advanceGame 的 opts） */
export function newSettleStats(): SettleStats {
  return {}
}

/** 取（或创建）某核心类型的统计记录；未启用统计（undefined）时返回 null，调用点无开销 */
function rec(stats: SettleStats | undefined, type: AiCoreType): CoreSettleStats | null {
  if (!stats) return null
  let s = stats[type]
  if (!s) s = stats[type] = { miningTrips: 0, salvageDone: 0, refineBatches: 0, recycleBatches: 0, makeDone: 0, income: 0 }
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

export function addAiIncome(stats: SettleStats | undefined, type: AiCoreType, isk: number): void {
  const s = rec(stats, type)
  if (!s) return
  s.income += Math.max(0, Math.round(isk))
}
