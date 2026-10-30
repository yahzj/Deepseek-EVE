import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import type { BuildSpec } from './blueprints'

/** 按当前技能计算制造耗时（毫秒），开工时锁定（工业理论 −5%/级 × 批量生产学 −4%/级 乘算；
 * 2026-09-20 零件体系：基础零件再吃「零件成型工艺学」−8%/级、高级零件吃「精密装配学」−8%/级） */
export function calcBuildDurationMs(state: GameState, ctx: SimContext, spec: BuildSpec): number {
  const bal = ctx.balance.manufacturing
  const level = state.skills.trained[bal.timeSkillId] ?? 0
  const batchLv = Math.min(5, state.skills.trained['batch-production'] ?? 0)
  // 2026-09-08（船长定：移除「最多缩短 60%」下限护栏；工业理论×批量生产学乘算本身有界）
  let ratio = Math.max(0, (1 - bal.timePerLevel * level) * (1 - 0.03 * batchLv))
  // 2026-09-27 船长令（R4/R5 上位技能批）：流水线统合学 −1.5%/级（与工业理论乘算叠加）
  ratio *= Math.max(0, 1 - 0.015 * Math.min(5, state.skills.trained['industry-integration'] ?? 0))
  if (spec.partTier === 'basic') {
    const lv = Math.min(5, state.skills.trained['part-forming'] ?? 0)
    ratio *= 1 - 0.08 * lv
    // 2026-09-27 上位技能：零件成型统合学 −2.5%/级（与零件成型工艺学乘算叠加）
    ratio *= Math.max(0, 1 - 0.025 * Math.min(5, state.skills.trained['part-forming-integration'] ?? 0))
  } else if (spec.partTier === 'advanced') {
    const lv = Math.min(5, state.skills.trained['precision-assembly'] ?? 0)
    ratio *= 1 - 0.08 * lv
    // 2026-09-27 上位技能：精密装配统合学 −2.5%/级（与精密装配学乘算叠加）
    ratio *= Math.max(0, 1 - 0.025 * Math.min(5, state.skills.trained['precision-assembly-integration'] ?? 0))
  }
  /**
   * 零件流水线（2026-09-22 船长令 · 制造系 T5「缩短所有零件生产周期每级 4%」）：
   * **零件类蓝图**（`spec.partTier` 有值 = 基础/高级零件那一族，含隐式蓝图）再 ×(1−4%/级)；
   * 与上面的工业理论、批量生产学**乘算叠加**，其余蓝图（装备/舰船/弹药……）不受影响。
   */
  if (spec.partTier !== undefined) {
    const lineLv = Math.min(5, state.skills.trained['parts-line'] ?? 0)
    if (lineLv > 0) ratio *= Math.max(0, 1 - 0.04 * lineLv)
  }
  // 调试模式 debugQuick：制造固定 1 秒
  return state.debugQuick ? 1000 : Math.max(1, Math.round(spec.buildSeconds * 1000 * ratio))
}
