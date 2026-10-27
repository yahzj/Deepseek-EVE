/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import type { SettleStats } from '../settleStats'
import { gainAiCore, aiCoreName, cancelAiTask } from '../aiCores'
import { shipDisplayName } from '../instances'
import { advanceAiMining } from './mining'
import { advanceAiSalvage } from './salvage'
import { advanceAiExpedition } from './expedition'

/** 引擎内部：推进所有 AI 副船任务（stats = 离线结算统计器，可选；见 settleStats.ts） */
export function advanceAi(state: GameState, deltaMs: number, ctx: SimContext, stats?: SettleStats): void {
  if (deltaMs <= 0) return
  for (const shipId of Object.keys(state.aiAssignments)) {
    const assignment = state.aiAssignments[shipId]
    if (!assignment) continue
    // 船没了（弃船等）→ 清理任务并归还核心
    if (!state.fleet[shipId]) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI] ${shipId} 已不在舰队中，任务中断（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.016', {
        p1: shipId,
        p2: aiCoreName(assignment.coreType),
      })
      continue
    }
    // 2026-09-09（修复自愈）：作业船已被切换为驾驶船（换船入口漏召回的历史坏态/竞态残留）——
    // AI 面板只列副船、该任务不可见也无法取消，核心会被永久占用（玩家反馈"伽玛核心不见了"）。
    // 引擎每拍检测并召回：任务终止、核心归还核心库（与"船没了/矿带缺失"同级清理）。
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
