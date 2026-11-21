import { allFittedIds } from './labels'
import type { FittedModules, ModuleDef, ModuleSlot, SimContext } from './types'
import type { GameState } from './state'
import { fleetDefOf } from './instances'
import { moduleAllowedOnShip } from './shipFitting'

export function allFittedModules(fitted: FittedModules, ctx: SimContext): ModuleDef[] {
  const out: ModuleDef[] = []
  for (const id of allFittedIds(fitted)) {
    const def = ctx.modules.get(id)
    if (def) out.push(def)
  }
  return out
}

export function familyModules(state: GameState, ctx: SimContext, shipId: string, family: ModuleSlot): ModuleDef[] {
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return []
  const ship = fleetDefOf(state, ctx, shipId)
  return allFittedModules(fitted, ctx).filter((d) => d.slot === family && moduleAllowedOnShip(ship, d))
}
