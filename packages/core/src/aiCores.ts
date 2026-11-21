import { ceilFinalQuantity } from './quantity'
import { peakFirst } from './firstTasks'
import { shipDisplayName } from './instances'
import { addLog } from './state'
import type { GameState } from './state'
import type { AiCoreType, SimContext } from './types'

export const AI_CORE_ORDER: readonly AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

export function aiCoreName(type: AiCoreType): string {
  return type === 'basic' ? '基础 AI 核心' : type === 'gamma' ? '伽马 AI 核心' : type === 'beta' ? '贝塔 AI 核心' : '阿尔法 AI 核心'
}

export const AI_CORE_IDS: Readonly<Record<AiCoreType, string>> = {
  basic: 'ui.labelsText.009',
  gamma: 'ui.labelsText.010',
  beta: 'ui.labelsText.011',
  alpha: 'ui.labelsText.012',
}

export function countAiCore(state: GameState, type: AiCoreType): number {
  return state.aiCores[type] ?? 0
}

export function gainAiCore(state: GameState, type: AiCoreType, count = 1): void {
  if (!Number.isFinite(count) || count <= 0) return
  state.aiCores[type] = (state.aiCores[type] ?? 0) + ceilFinalQuantity(count)
  let kinds = 0
  for (const t of AI_CORE_ORDER) if ((state.aiCores[t] ?? 0) > 0) kinds += 1
  peakFirst(state, 'aiCoreKinds', kinds)
}

export function spendAiCore(state: GameState, type: AiCoreType): boolean {
  const current = state.aiCores[type] ?? 0
  if (current <= 0) return false
  state.aiCores[type] = current - 1
  return true
}

export function spendAiCores(state: GameState, type: AiCoreType, count: number): boolean {
  count = ceilFinalQuantity(count)
  const current = state.aiCores[type] ?? 0
  if (!Number.isFinite(count) || count <= 0 || current < count) return false
  state.aiCores[type] = current - count
  return true
}

export function cancelAiTask(state: GameState, shipId: string, ctx: SimContext): boolean {
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return false
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(state, 'fleet', `[AI] 已召回 ${shipName}（${aiCoreName(assignment.coreType)} 归还核心库）。`, 'core.ai.015', {
    p1: shipName,
    p2: aiCoreName(assignment.coreType),
  })
  return true
}
