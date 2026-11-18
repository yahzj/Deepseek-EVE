import type { GameState, ManufacturingRunState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { aiCoreName } from '../../ai'
import { findBuildable, productNameOf } from './blueprints'
import { manufacturingLoopOf } from './loop'

export function manufacturingManualActive(state: GameState): boolean {
  return state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')
}

export interface ManufacturingView {
  active: boolean
  id: number
  blueprintId: string | null
  productName: string
  kind: 'module' | 'ship' | 'item' | null
  worker: 'pilot' | AiCoreType | null
  workerLabel: string
  remainingMs: number
  durationMs: number
  percent: number
  loopOn: boolean
  loopGoal: number
  loopProduced: number
}

function viewOf(state: GameState, ctx: SimContext, mf: ManufacturingRunState): ManufacturingView {
  const buildable = mf.blueprintId ? findBuildable(ctx, mf.blueprintId) : null
  const productName = buildable ? productNameOf(ctx, buildable, mf.blueprintId ?? '') : (mf.blueprintId ?? '')
  const remainingMs = Math.max(0, mf.finishAtGameMs - state.gameMs)
  const percent =
    mf.durationMs > 0 ? Math.min(100, Math.max(0, Math.round(((mf.durationMs - remainingMs) / mf.durationMs) * 100))) : 0
  const worker = mf.worker ?? null
  const loop = manufacturingLoopOf(state, mf.blueprintId)
  return {
    active: mf.active,
    id: mf.id,
    blueprintId: mf.blueprintId,
    productName,
    kind: buildable ? buildable.kind : null,
    worker,
    workerLabel: worker === null ? '旧作业' : worker === 'pilot' ? '主控' : aiCoreName(worker),
    remainingMs,
    durationMs: mf.durationMs,
    percent,
    loopOn: loop.on,
    loopGoal: loop.goal,
    loopProduced: loop.produced,
  }
}

export function manufacturingRunViews(state: GameState, ctx: SimContext): ManufacturingView[] {
  return state.manufacturingRuns.map((r) => viewOf(state, ctx, r))
}
