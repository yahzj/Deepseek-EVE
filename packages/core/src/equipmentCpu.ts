import type { GameState } from './state'
import type { FittedModules, ModuleDef, SimContext } from './types'
import { allFittedModules } from './fitted'
import { fleetDefOf } from './instances'
import { ceilFinalQuantity } from './quantity'
import { plugEffectPartsOf } from './plugEffects'

export function effectiveCpu(state: GameState, ctx: SimContext, def: { cpu?: number } | undefined): number {
  const bal = ctx.balance.battle
  const lv = Math.min(5, state.skills.trained[bal.cpuSkillId] ?? 0)
  return ceilFinalQuantity((def?.cpu ?? 0) * (1 + bal.cpuPerLevel * lv))
}

export function cpuUseOf(def: ModuleDef, ship?: { stealthCpuMul?: number }): number {
  const raw = def.cpuUse ?? 0
  const mul = ship?.stealthCpuMul
  return def.stealthMs !== undefined && mul !== undefined && mul !== 1 ? Math.ceil(raw * mul) : raw
}

export function fittedCpuUsed(fitted: FittedModules, ctx: SimContext, ship?: { stealthCpuMul?: number }): number {
  return allFittedModules(fitted, ctx).reduce((n, def) => n + cpuUseOf(def, ship), 0)
}

export function droneCpuUsed(load: Record<string, number> | undefined, ctx: SimContext): number {
  return Object.entries(load ?? {}).reduce((n, [id, count]) => {
    const def = ctx.items.get(id)
    return n + (def?.kind === 'drone' && count > 0 ? (def.cpuUse ?? 0) * count : 0)
  }, 0)
}

/** 安装候选与实际装配共用预算，不反向依赖插件安装模块。 */
export function cpuBudgetOf(state: GameState, ctx: SimContext, shipId: string,
  fittedOverride?: FittedModules | null, plugIds = state.fleet[shipId]?.plugs ?? []): number {
  const fitted = fittedOverride === undefined ? state.fleet[shipId]?.fitted : fittedOverride
  let budget = effectiveCpu(state, ctx, fleetDefOf(state, ctx, shipId))
  for (const m of fitted ? allFittedModules(fitted, ctx) : []) budget += m.cpuBonus ?? 0
  for (const { effective: p } of plugEffectPartsOf(plugIds, ctx)) {
    budget += (p.cpuBonus ?? 0) - (p.cpuPenalty ?? 0)
  }
  return Math.max(0, budget)
}
