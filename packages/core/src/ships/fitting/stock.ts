import type { ModuleSlot, SimContext, FittedModules, RackSlot, ModuleDef } from '../../types'
import { slotLabel as labelOf, allFittedIds, rackBays } from '../../labels'
import type { GameState } from '../../state'
import { ceilFinalQuantity } from '../../quantity'
import { countWare, currentShipState } from '../../inventory'
import { allFittedModules } from '../../fitted'
import { fleetDefOf } from '../../instances'
import { shipSlotsWithPlugsOf } from '../../plugs'

export function slotLabel(slot: ModuleSlot): string {
  return labelOf(slot)
}

export function countModule(state: GameState, moduleId: string): number {
  return state.moduleBay[moduleId] ?? 0
}

export function ownedModuleCount(state: GameState, moduleId: string): number {
  let n = countModule(state, moduleId)
  for (const ship of Object.values(state.fleet)) {
    if (!ship?.fitted) continue
    for (const id of allFittedIds(ship.fitted)) if (id === moduleId) n += 1
  }
  return n
}

export function addModule(state: GameState, moduleId: string, count = 1): void {
  if (!Number.isFinite(count) || count <= 0) return
  state.moduleBay[moduleId] = countModule(state, moduleId) + ceilFinalQuantity(count)
}

export function ownedItemCount(state: GameState, itemId: string): number {
  let n = countWare(state, itemId)
  for (const ship of Object.values(state.fleet)) {
    n += ship?.droneLoad?.[itemId] ?? 0
  }
  return n
}

export function removeModule(state: GameState, moduleId: string, count = 1): boolean {
  count = ceilFinalQuantity(count)
  const current = countModule(state, moduleId)
  if (!Number.isFinite(count) || count <= 0 || current < count) return false
  const rest = current - count
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  return true
}

export const WEAPON_SLOTS: ReadonlySet<ModuleSlot> = new Set([
  'turret',
  'missile',
  'laser',
  'drone-rack',
  'drone-tac',
])

export function shipHasWeapon(state: GameState, ctx: SimContext, shipId: string): boolean {
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return false
  return allFittedModules(fitted, ctx).some((d) => WEAPON_SLOTS.has(d.slot))
}

export function fittedOf(state: GameState): GameState['fleet'][string]['fitted'] | null {
  return currentShipState(state)?.fitted ?? null
}

export function firstFreeBay(fitted: FittedModules, rack: RackSlot): number {
  return rackBays(fitted, rack).findIndex((id) => id === null)
}

export function ensureRackBays(fitted: FittedModules, rack: RackSlot, want: number): Array<string | null> {
  const bays = rackBays(fitted, rack)
  while (bays.length < want) bays.push(null)
  return bays
}

export function wantedBaysOf(state: GameState, ctx: SimContext, shipId: string, rack: RackSlot): number {
  if (!fleetDefOf(state, ctx, shipId)) return 0
  return shipSlotsWithPlugsOf(state, ctx, shipId)[rack]
}

export function uniqueConflictOf(
  fitted: FittedModules,
  ctx: SimContext,
  moduleId: string,
  ignore?: { rack: RackSlot; index: number },
): ModuleDef | undefined {
  if (ctx.modules.get(moduleId)?.unique !== true) return undefined
  for (const rack of ['high', 'mid', 'low'] as const) {
    const bays = rackBays(fitted, rack)
    for (let i = 0; i < bays.length; i += 1) {
      if (ignore && ignore.rack === rack && ignore.index === i) continue
      const id = bays[i]
      if (!id) continue
      const def = ctx.modules.get(id)
      if (def?.unique === true) return def
    }
  }
  return undefined
}
