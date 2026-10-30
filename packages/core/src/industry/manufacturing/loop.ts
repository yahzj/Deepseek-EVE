import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'

/**
 * 玩家指令：开/关这张生产卡的「循环制造」（2026-09-10 船长定：开关与目标批数挂在卡片上，
 * 作用于**该卡全部制造线**——含主控亲自那条；打开后新开的线自动继承；目标批数 = 全卡合计）。
 * - 从「关」到「开」= 开一批新循环：本轮合计 `produced` 与停因 `stopWhy` 一起清零；
 *   开关本来就开着时只更新目标批数（**不动**已累计的合计，避免改数字把进度重置）；
 * - 关闭 = 该卡在跑的线完成当前件后停（不写停因，属玩家主动收手）；
 * - 卡片无需正在生产：先开开关、后开线同样生效（预制循环）。
 */
export function setManufacturingLoop(
  state: GameState,
  blueprintId: string,
  on: boolean,
  goal?: number | null,
): CommandResult {
  if (typeof blueprintId !== 'string' || blueprintId.length === 0) {
    return { ok: false, error: '没有找到这张生产卡（蓝图记录缺失）。', errorId: 'core.manufacturing.007' }
  }
  const g = Number.isFinite(goal) ? Math.floor(goal ?? 0) : 0
  const prev = state.manufacturingLoops[blueprintId]
  if (on) {
    const already = prev?.on === true
    state.manufacturingLoops[blueprintId] = {
      on: true,
      goal: g > 0 ? g : undefined,
      produced: already ? (prev?.produced ?? 0) : 0,
      stopWhy: already ? prev?.stopWhy : undefined,
    }
  } else {
    state.manufacturingLoops[blueprintId] = {
      on: false,
      goal: g > 0 ? g : prev?.goal && prev.goal > 0 ? prev.goal : undefined,
      produced: prev?.produced ?? 0,
      stopWhy: undefined,
    }
  }
  return { ok: true }
}

/** 卡片级循环配置的只读视图（界面显示用；缺省 = 未开启过 → 不循环、无目标、合计 0） */
export interface ManufacturingLoopView {
  /** 开关是否打开 */
  on: boolean
  /** 目标批数（0 = 不限，直到材料不足；见头注"单位口径"） */
  goal: number
  /** 本轮全卡合计产出件数 */
  produced: number
  /** 上一次自动停线原因（空 = 无） */
  stopWhy: string
}

/** 取某张生产卡的循环配置视图（界面/文案统一走这里，不要各自读 state） */
export function manufacturingLoopOf(state: GameState, blueprintId: string | null): ManufacturingLoopView {
  const l = blueprintId ? state.manufacturingLoops[blueprintId] : undefined
  return {
    on: l?.on === true,
    goal: l?.goal && l.goal > 0 ? l.goal : 0,
    produced: l?.produced ?? 0,
    stopWhy: l?.stopWhy ?? '',
  }
}

/** 内部：取卡片循环配置（可写引用；无线/无配置返回 undefined） */
export function loopRefOf(state: GameState, blueprintId: string | null): GameState['manufacturingLoops'][string] | undefined {
  return blueprintId ? state.manufacturingLoops[blueprintId] : undefined
}
