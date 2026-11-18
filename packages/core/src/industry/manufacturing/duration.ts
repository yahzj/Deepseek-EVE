import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import type { BuildSpec } from './blueprints'

export function calcBuildDurationMs(state: GameState, ctx: SimContext, spec: BuildSpec): number {
  const bal = ctx.balance.manufacturing
  const level = state.skills.trained[bal.timeSkillId] ?? 0
  const batchLv = Math.min(5, state.skills.trained['batch-production'] ?? 0)
  let ratio = Math.max(0, (1 - bal.timePerLevel * level) * (1 - 0.03 * batchLv))
  ratio *= Math.max(0, 1 - 0.015 * Math.min(5, state.skills.trained['industry-integration'] ?? 0))
  if (spec.partTier === 'basic') {
    const lv = Math.min(5, state.skills.trained['part-forming'] ?? 0)
    ratio *= 1 - 0.08 * lv
    ratio *= Math.max(0, 1 - 0.025 * Math.min(5, state.skills.trained['part-forming-integration'] ?? 0))
  } else if (spec.partTier === 'advanced') {
    const lv = Math.min(5, state.skills.trained['precision-assembly'] ?? 0)
    ratio *= 1 - 0.08 * lv
    ratio *= Math.max(0, 1 - 0.025 * Math.min(5, state.skills.trained['precision-assembly-integration'] ?? 0))
  }
  if (spec.partTier !== undefined) {
    const lineLv = Math.min(5, state.skills.trained['parts-line'] ?? 0)
    if (lineLv > 0) ratio *= Math.max(0, 1 - 0.04 * lineLv)
  }
  return state.debugQuick ? 1000 : Math.max(1, Math.round(spec.buildSeconds * 1000 * ratio))
}
