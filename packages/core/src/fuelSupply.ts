import type { GameState } from './state'
import type { LabRecipeDef, SimContext } from './types'
import { JUMP_FUEL_ITEM_ID, jumpFuelCapOf, jumpFuelHeadroomOf, jumpFuelWareOf } from './jumpFuel'
import { labOutputCapped, labOutputPerHourOf, labRecipeUnlocked, labUnlocked } from './lab'

export type JumpFuelFlowStatus = 'locked' | 'full' | 'flowing' | 'idle'

export interface JumpFuelSupply {
  ware: number
  cap: number
  headroom: number
  perHour: number
  status: JumpFuelFlowStatus
}

export function jumpFuelRecipeOf(ctx: SimContext): LabRecipeDef | undefined {
  return jumpFuelRecipesOf(ctx)[0]
}

export function jumpFuelRecipesOf(ctx: SimContext): LabRecipeDef[] {
  const out: LabRecipeDef[] = []
  for (const r of ctx.labRecipes.values()) if (r.outputItemId === JUMP_FUEL_ITEM_ID) out.push(r)
  return out
}

export function jumpFuelSupplyOf(state: GameState, ctx: SimContext): JumpFuelSupply {
  const ware = jumpFuelWareOf(state)
  const cap = jumpFuelCapOf(state)
  const recipes = jumpFuelRecipesOf(ctx)
  const unlocked = labUnlocked(state, ctx)
  let perHour = 0
  for (const r of recipes) perHour += labOutputPerHourOf(state, ctx, r.id)
  const full = unlocked && recipes.some((r) => labRecipeUnlocked(state, ctx, r) && labOutputCapped(state, r, ctx))
  const anyUnlocked = recipes.some((r) => labRecipeUnlocked(state, ctx, r))
  const status: JumpFuelFlowStatus = !unlocked || (recipes.length > 0 && !anyUnlocked) ? 'locked' : full ? 'full' : perHour > 0 ? 'flowing' : 'idle'
  return { ware, cap, headroom: jumpFuelHeadroomOf(state), perHour, status }
}
