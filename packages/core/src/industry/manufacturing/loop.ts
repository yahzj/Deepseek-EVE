import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'

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

export interface ManufacturingLoopView {
  on: boolean
  goal: number
  produced: number
  stopWhy: string
}

export function manufacturingLoopOf(state: GameState, blueprintId: string | null): ManufacturingLoopView {
  const l = blueprintId ? state.manufacturingLoops[blueprintId] : undefined
  return {
    on: l?.on === true,
    goal: l?.goal && l.goal > 0 ? l.goal : 0,
    produced: l?.produced ?? 0,
    stopWhy: l?.stopWhy ?? '',
  }
}

export function loopRefOf(state: GameState, blueprintId: string | null): GameState['manufacturingLoops'][string] | undefined {
  return blueprintId ? state.manufacturingLoops[blueprintId] : undefined
}
