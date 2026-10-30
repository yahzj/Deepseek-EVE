import type { GameState, ManufacturingRunState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { aiCoreName } from '../../ai'
import { findBuildable, productNameOf } from './blueprints'
import { manufacturingLoopOf } from './loop'

/**
 * 主控此刻是否正亲自开着一条制造线（主控忙判定：AI 核心驱动 / 旧作业不占主控）
 */
export function manufacturingManualActive(state: GameState): boolean {
  return state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')
}

/** 制造作业进度（界面显示用；v21 每条制造线一个 view） */
export interface ManufacturingView {
  active: boolean
  /** 稳定线号 */
  id: number
  blueprintId: string | null
  /** 产物显示名（装备/舰船/弹药等物品） */
  productName: string
  /** 产物类别（界面图标/说明用；2026-09-05 起含 item = 弹药等物品蓝图） */
  kind: 'module' | 'ship' | 'item' | null
  /** 劳动者：'pilot' = 主控亲自 / AiCoreType = AI 核心驱动；null = 旧作业（老档遗留，免占用跑到完） */
  worker: 'pilot' | AiCoreType | null
  /** 劳动者显示名（'主控' / 核心中文名 / '旧作业'） */
  workerLabel: string
  /** 剩余毫秒（到点前由引擎完成；显示端每秒刷新） */
  remainingMs: number
  /** 总耗时毫秒 */
  durationMs: number
  percent: number
  /** 本卡「循环制造」开关（2026-09-10 卡片级：同卡各线读到的是**同一个**开关，不是逐线状态） */
  loopOn: boolean
  /** 本卡循环目标批数（全卡合计口径；0/缺省 = 直到材料不足） */
  loopGoal: number
  /** 本卡本轮合计产出**批数**（开关打开期间累加；与同卡其它线共享；一件的产出见 `outputUnits`） */
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

/** 全部制造线视图（v21 多工位：工业页卡片逐线 / 活动栏逐条） */
export function manufacturingRunViews(state: GameState, ctx: SimContext): ManufacturingView[] {
  return state.manufacturingRuns.map((r) => viewOf(state, ctx, r))
}
