/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { aiEfficiency, aiServicingUpgradeMult } from './cores'
import { nearestStationGalaxyId } from '../location'
import { HOME_GALAXY_ID, shortestTravelMinutes } from '../expedition'
import { oneOutboundLegMs, oneLegMs, getMiningParams } from '../mining'
import { scaledReturnMs } from '../trips'
import { travelLegMs } from '../travel'
import { salvagerCyclesOf } from '../salvaging'

/** AI 任务进度视图（2026-09-08 船长：AI 展示与主控同款——阶段 + 进度 + 剩余；顶部活动栏维持小图标）。
 * 与 advanceAiMining/Salvage/Standby 同一套公式（同源不漂移）。percent=null 表示无进度概念（驻留等）。 */
export interface AiTaskView {
  kind: 'mining' | 'salvage' | 'standby' | string
  phase: string
  /** 阶段文案（与主控行同款：返航卸货/出航/采掘中/打捞中/前往 X 掩护巡逻/驻留中…）
   *  ⚠ **⟪文案调整 2026-10-02⟫ 批②**：界面**只许读 `labelId`**（按当前语言渲染）；`label` 是中文原串（甲案照写，供工具与回落用）。 */
  label: string
  /** 阶段文案的 l10n id（`packages/data/src/l10n/table.ts`；界面走 `tr(labelId)`） */
  labelId?: string
  percent: number | null
  remainingMs: number | null
}

/** 单个 AI 任务的进度视图（主控同款口径；无任务/未知 kind 返回 null） */
export function aiTaskView(state: GameState, ctx: SimContext, shipId: string): AiTaskView | null {
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return null
  const task = assignment.task
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const accMs = (): number => (task as { phaseAccMs?: number }).phaseAccMs ?? 0
  // 腿长口径（卷B2⑥ 与主控一致）：出航腿按效率拉长；返航腿只按货仓占比缩放、不 ÷效率
  const leg = (base: number, effScaled: boolean): { real: number; remain: number; percent: number } => {
    const real = Math.max(1, Math.round(effScaled ? base / eff : base))
    const remain = Math.max(0, real - accMs())
    return { real, remain, percent: Math.min(100, Math.max(0, Math.round((accMs() / real) * 100))) }
  }
  if (task.kind === 'mining') {
    const beltDef = ctx.belts.get(task.beltId)
    const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
    if (task.phase === 'returning' || task.phase === 'outbound') {
      const base =
        task.phase === 'outbound'
          ? oneOutboundLegMs(state, ctx, task.beltId, shipId, stGal)
          : scaledReturnMs(oneLegMs(state, ctx, task.beltId, shipId, stGal), state, ctx, shipId, task.fuelMul)
      const v = leg(base, task.phase === 'outbound')
      return {
        kind: 'mining',
        phase: task.phase,
        label: task.phase === 'returning' ? '返航卸货中' : '出航中',
        labelId: task.phase === 'returning' ? 'ui.aiProgress.002' : 'ui.aiProgress.003',
        percent: v.percent,
        remainingMs: v.remain,
      }
    }
    const params = getMiningParams(state, ctx, { shipId, beltId: task.beltId })
    if (!params)
      return { kind: 'mining', phase: task.phase, label: '采掘中', labelId: 'ui.aiProgress.004', percent: null, remainingMs: null }
    const servLv = Math.min(5, state.skills.trained['ai-servicing'] ?? 0)
    // 2026-09-27 船长令（R4/R5 上位技能批）：副船统合整备学走单点 aiServicingUpgradeMult（与副船整备学乘算）
    const cycleReal = Math.max(1, Math.ceil((params.cycleMs * (1 - 0.03 * servLv) * aiServicingUpgradeMult(state)) / eff))
    const acc = task.cycleAccMs ?? 0
    return {
      kind: 'mining',
      phase: task.phase,
      label: '采掘中',
      labelId: 'ui.aiProgress.004',
      percent: Math.min(100, Math.max(0, Math.round((acc / cycleReal) * 100))),
      remainingMs: Math.max(0, cycleReal - acc),
    }
  }
  if (task.kind === 'salvage') {
    const legBase = (): number => {
      if (state.debugQuick) return 1000
      const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, task.galaxyId)
      return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, Number.isFinite(mins) ? mins : 0, shipId))
    }
    if (task.phase === 'outbound' || task.phase === 'returning') {
      const base = task.phase === 'outbound' ? Math.round(legBase() / 2) : scaledReturnMs(legBase(), state, ctx, shipId, task.fuelMul)
      const v = leg(base, task.phase === 'outbound')
      return {
        kind: 'salvage',
        phase: task.phase,
        label: task.phase === 'returning' ? '返航卸货' : '出航',
        labelId: task.phase === 'returning' ? 'ui.aiProgress.005' : 'ui.aiProgress.006',
        percent: v.percent,
        remainingMs: v.remain,
      }
    }
    const reals = salvagerCyclesOf(state, ctx, shipId).map((c) => Math.max(1, Math.ceil(c / eff)))
    const stepMs = reals.length > 0 ? Math.min(...reals) : 1
    const acc = task.cycleAccMs ?? 0
    return {
      kind: 'salvage',
      phase: task.phase,
      label: '打捞中',
      labelId: 'ui.aiProgress.007',
      percent: Math.min(100, Math.max(0, Math.round((acc / stepMs) * 100))),
      remainingMs: Math.max(0, stepMs - acc),
    }
  }
  if (task.kind === 'standby') {
    if (task.phase === 'out') {
      const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
      const outMs = Math.max(1, task.outMs)
      return {
        kind: 'standby',
        phase: task.phase,
        label: '前往掩护巡逻中',
        labelId: 'ui.aiProgress.008',
        percent: Math.min(100, Math.max(0, Math.round(((outMs - remain) / outMs) * 100))),
        remainingMs: remain,
      }
    }
    return { kind: 'standby', phase: task.phase, label: '驻留中', labelId: 'ui.aiProgress.009', percent: null, remainingMs: null }
  }
  return null
}
