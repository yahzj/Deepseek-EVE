import type { GameState } from '../../state'
import type { SimContext, FittedModules, RackSlot, ModuleDef } from '../../types'
import * as cpu from '../../equipmentCpu'
import type { CoreBlockReason } from '../../engine'
import { rackBays, rackOf } from '../../labels'

export function effectiveCpu(state: GameState, ctx: SimContext, def: { cpu?: number } | undefined): number {
  return cpu.effectiveCpu(state, ctx, def)
}

export function cpuBudgetOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  fittedOverride?: FittedModules | null,
): number {
  return cpu.cpuBudgetOf(state, ctx, shipId, fittedOverride)
}

export function cpuOverloadText(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  plan?: { remove?: { rack: RackSlot; index: number }; addModuleId?: string },
): CoreBlockReason | null {
  const fleet = state.fleet[shipId]
  const shipDef = ctx.ships.get(fleet?.defId ?? shipId)
  if (!fleet || !shipDef || (shipDef.cpu ?? 0) <= 0) return null
  const after: FittedModules = {
    high: [...fleet.fitted.high],
    mid: [...fleet.fitted.mid],
    low: [...fleet.fitted.low],
  }
  const add = plan?.addModuleId !== undefined ? ctx.modules.get(plan.addModuleId) : undefined
  if (plan?.remove) {
    const bays = rackBays(after, plan.remove.rack)
    if (plan.remove.index < 0 || plan.remove.index >= bays.length) return null
    bays[plan.remove.index] = null
  }
  if (plan?.addModuleId !== undefined) {
    if (!add) return null
    const rack = rackOf(add)
    const bays = rackBays(after, rack)
    const free = bays.findIndex((x) => x === null)
    if (free < 0) return null
    bays[free] = add.id
  }
  const budget = cpuBudgetOf(state, ctx, shipId, after)
  const used = fittedCpuUsed(after, ctx, shipDef) + droneCpuUsed(fleet.droneLoad, ctx)
  if (used > budget) {
    return {
      error: `CPU 超载：合计需 ${used}，预算 ${budget}（协处理器只扩容、卸下即收回——先卸下其它装备或无人机）。`,
      errorId: 'core.equipment.032',
      errorParams: { p1: used, p2: budget },
    }
  }
  return null
}

export function cpuUseOf(def: ModuleDef, ship?: { stealthCpuMul?: number }): number {
  return cpu.cpuUseOf(def, ship)
}

export function fittedCpuUsed(
  fitted: FittedModules,
  ctx: SimContext,
  ship?: { stealthCpuMul?: number },
): number {
  return cpu.fittedCpuUsed(fitted, ctx, ship)
}

export function droneCpuUsed(droneLoad: Record<string, number> | undefined, ctx: SimContext): number {
  return cpu.droneCpuUsed(droneLoad, ctx)
}
