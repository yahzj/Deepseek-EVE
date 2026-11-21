import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import type { SettleStats } from '../settleStats'
import { gainAiCore, aiCoreName, cancelAiTask } from '../aiCores'
import { shipDisplayName } from '../instances'
import { advanceAiMining } from './mining'
import { advanceAiSalvage } from './salvage'
import { advanceAiExpedition } from './expedition'

export function advanceAi(state: GameState, deltaMs: number, ctx: SimContext, stats?: SettleStats): void {
  if (deltaMs <= 0) return
  for (const shipId of Object.keys(state.aiAssignments)) {
    const assignment = state.aiAssignments[shipId]
    if (!assignment) continue
    if (!state.fleet[shipId]) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI] ${shipId} 已不在舰队中，任务中断（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.016', {
        p1: shipId,
        p2: aiCoreName(assignment.coreType),
      })
      continue
    }
    if (shipId === state.shipId) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(
        state,
        'warn',
        `[AI] ${shipDisplayName(state, ctx, shipId)} 已是驾驶船——原 AI 任务自动召回（${aiCoreName(assignment.coreType)} 已归还核心库）。`,
        'core.ai.017',
        { p1: shipDisplayName(state, ctx, shipId), p2: aiCoreName(assignment.coreType) },
      )
      continue
    }
    if (assignment.task.kind === 'standby') {
      cancelAiTask(state, shipId, ctx)
      continue
    }
    if (assignment.task.kind === 'mining') {
      advanceAiMining(state, shipId, assignment, deltaMs, ctx, stats)
    } else if (assignment.task.kind === 'salvage') {
      advanceAiSalvage(state, shipId, assignment, deltaMs, ctx, stats)
    } else if (assignment.task.kind === 'expedition') {
      advanceAiExpedition(state, shipId, assignment, ctx)
    }
  }
}
