import { ceilFinalQuantity } from '../../quantity'
import { refundOneTimeBookOf } from '../../state'
import type { GameState } from '../../state'
import type { BlueprintDef, ShipBlueprintDef, SimContext } from '../../types'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeManufacturingUnlocked } from '../../probeManufacturing'

export interface BuildSpec {
  materials: BlueprintDef['materials']
  buildSeconds: number
  buildCostIsk: number
  partTier?: 'basic' | 'advanced'
  learnless?: boolean
}

export function findBuildable(
  ctx: SimContext,
  blueprintId: string,
): { kind: 'module' | 'ship' | 'item'; spec: BuildSpec; moduleId?: string; shipId?: string; itemId?: string; outputUnits?: number } | null {
  const bp = ctx.blueprints.get(blueprintId)
  if (bp) {
    if (bp.itemId !== undefined) {
      return { kind: 'item', spec: bp, itemId: bp.itemId, outputUnits: ceilFinalQuantity(bp.outputUnits ?? 1) }
    }
    return { kind: 'module', spec: bp, moduleId: bp.moduleId }
  }
  const shipBp = ctx.shipBlueprints.get(blueprintId)
  if (shipBp) {
    return { kind: 'ship', spec: shipBp, shipId: shipBp.shipId }
  }
  return null
}

export interface RecipeCapability {
  kind: 'ok' | 'learned' | 'need-book' | 'exhausted' | 'no-book'
  consumeBook: boolean
}

export function oneTimeBookInUse(state: GameState, blueprintId: string): boolean {
  return state.manufacturingRuns.some((r) => r.active && r.blueprintId === blueprintId)
}

export function recipeCapability(state: GameState, blueprintId: string, singleUse: boolean): RecipeCapability {
  if (!singleUse) return { kind: 'ok', consumeBook: false }
  if (state.learnedRecipes.includes(blueprintId)) return { kind: 'learned', consumeBook: false }
  const stock = state.blueprintStock[blueprintId] ?? 0
  if (stock > 0) return { kind: 'ok', consumeBook: true }
  if ((state.spentOneTimeRecipes ?? []).includes(blueprintId)) return { kind: 'exhausted', consumeBook: false }
  return { kind: 'no-book', consumeBook: false }
}

export function ownsBlueprint(state: GameState, blueprintId: string): boolean {
  return state.learnedRecipes.includes(blueprintId)
}

export function blueprintDefOf(
  ctx: SimContext,
  blueprintId: string,
): BlueprintDef | ShipBlueprintDef | undefined {
  return ctx.blueprints.get(blueprintId) ?? ctx.shipBlueprints.get(blueprintId)
}

const productIndexCache = new WeakMap<SimContext, ReadonlyMap<string, BlueprintDef>>()

export function blueprintProducingItem(ctx: SimContext, itemId: string): BlueprintDef | null {
  let index = productIndexCache.get(ctx)
  if (index === undefined) {
    const map = new Map<string, BlueprintDef>()
    for (const bp of ctx.blueprints.values()) {
      if (bp.itemId !== undefined && bp.itemId.length > 0 && !map.has(bp.itemId)) map.set(bp.itemId, bp)
    }
    index = map
    productIndexCache.set(ctx, index)
  }
  return index.get(itemId) ?? null
}

export function isSingleUseBlueprint(ctx: SimContext, blueprintId: string): boolean {
  return blueprintDefOf(ctx, blueprintId)?.singleUse === true
}

export function canStartBlueprint(state: GameState, ctx: SimContext, blueprintId: string): boolean {
  if (blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID && !probeManufacturingUnlocked(state)) return false
  if (ownsBlueprint(state, blueprintId)) return true
  if (ctx.blueprints.get(blueprintId)?.learnless === true) return true
  if (!isSingleUseBlueprint(ctx, blueprintId)) return false
  return recipeCapability(state, blueprintId, true).kind === 'ok'
}

export function spendOneTimeBook(state: GameState, blueprintId: string): boolean {
  const c = state.blueprintStock[blueprintId] ?? 0
  if (c <= 0) return false
  if (c - 1 <= 0) delete state.blueprintStock[blueprintId]
  else state.blueprintStock[blueprintId] = c - 1
  const spent = (state.spentOneTimeRecipes ??= [])
  if (!spent.includes(blueprintId)) spent.push(blueprintId)
  return true
}

export function refundOneTimeBook(state: GameState, blueprintId: string): boolean {
  return refundOneTimeBookOf(state, blueprintId)
}

export function blueprintName(ctx: SimContext, blueprintId: string): string {
  return ctx.blueprints.get(blueprintId)?.name ?? ctx.shipBlueprints.get(blueprintId)?.name ?? blueprintId
}

export function productNameOf(ctx: SimContext, b: NonNullable<ReturnType<typeof findBuildable>>, fallback: string): string {
  if (b.kind === 'item') return ctx.items.get(b.itemId ?? '')?.name ?? fallback
  if (b.kind === 'module') return ctx.modules.get(b.moduleId ?? '')?.name ?? fallback
  return ctx.ships.get(b.shipId ?? '')?.name ?? fallback
}
