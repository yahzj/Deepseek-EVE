import { ceilFinalQuantity } from './quantity'
import type { FleetShipState, GameState } from './state'
import { shipDamageEffects } from './shipDamage'
import type { ItemDef, SimContext } from './types'
import { fleetDefOf } from './instances'
import { shipLockedReason } from './state'
import { shipOperationBlockReason } from './shipActionPolicy'
import { deployedCombatEscorts } from './combat/command/locks'
import { familyModules } from './fitted'
import { plugEffectPartsOf } from './plugEffects'
import { isBlackboxItem, noteBlackboxObtained } from './blackbox'

export const MODULE_CARGO_UNIT_M3 = 1

export function isModuleCargoId(ctx: SimContext, id: string): boolean {
  return ctx.modules.has(id)
}


export function itemReleased(def: { unreleased?: boolean } | undefined | null): boolean {
  return !!def && def.unreleased !== true
}

export function visibleItemDefs(ctx: SimContext): ItemDef[] {
  const out: ItemDef[] = []
  for (const def of ctx.items.values()) if (itemReleased(def)) out.push(def)
  return out
}

export function cargoHoldForbidden(ctx: SimContext, itemId: string): boolean {
  return ctx.items.get(itemId)?.holdForbidden === true
}


export function currentShipState(state: GameState): FleetShipState | null {
  return state.fleet[state.shipId] ?? null
}


export function cargoOfShip(state: GameState, shipId: string): Record<string, number> {
  return state.fleet[shipId]?.cargo ?? {}
}

export function cargoItemsOf(state: GameState): Record<string, number> {
  return cargoOfShip(state, state.shipId)
}

export function countItem(state: GameState, itemId: string): number {
  return cargoItemsOf(state)[itemId] ?? 0
}

export function addItem(state: GameState, itemId: string, units: number, shipId = state.shipId): boolean {
  if (!Number.isFinite(units) || units <= 0) return false
  const cargo = state.fleet[shipId]?.cargo
  if (cargo === undefined || Object.isFrozen(cargo)) return addWare(state, itemId, units)
  cargo[itemId] = (cargo[itemId] ?? 0) + ceilFinalQuantity(units)
  if (isBlackboxItem(itemId)) noteBlackboxObtained(state)
  return true
}

export function removeItem(state: GameState, itemId: string, units: number): boolean {
  const cargo = cargoItemsOf(state)
  const need = ceilFinalQuantity(units)
  if (!Number.isFinite(need) || need <= 0) return false
  const current = cargo[itemId] ?? 0
  if (current < need) return false
  const rest = current - need
  if (rest === 0) delete cargo[itemId]
  else cargo[itemId] = rest
  return true
}


export function countWare(state: GameState, itemId: string): number {
  return state.warehouse.items[itemId] ?? 0
}

export function addWare(state: GameState, itemId: string, units: number): boolean {
  if (!Number.isFinite(units) || units <= 0) return false
  state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + ceilFinalQuantity(units)
  if (isBlackboxItem(itemId)) noteBlackboxObtained(state)
  return true
}

export function removeWare(state: GameState, itemId: string, units: number): boolean {
  const need = ceilFinalQuantity(units)
  if (!Number.isFinite(need) || need <= 0) return false
  const current = state.warehouse.items[itemId] ?? 0
  if (current < need) return false
  const rest = current - need
  if (rest === 0) delete state.warehouse.items[itemId]
  else state.warehouse.items[itemId] = rest
  return true
}


export function cargoUsedM3Of(state: GameState, ctx: SimContext, shipId: string): number {
  let used = 0
  for (const [itemId, units] of Object.entries(cargoOfShip(state, shipId))) {
    const def = ctx.items.get(itemId)
    if (def) used += units * cargoUnitM3(state, def)
    else if (ctx.modules.get(itemId)) used += units * MODULE_CARGO_UNIT_M3
  }
  return used
}

export function cargoUnitM3(state: GameState, item: import('./types').ItemDef | undefined): number {
  const raw = item?.unitM3 ?? 0
  if (raw <= 0) return raw
  if (item!.kind === 'ore' || item!.kind === 'gas' || item!.kind === 'ice') {
    const lv = Math.min(5, state.skills.trained['compression'] ?? 0)
    if (lv > 0) return raw * (1 - 0.06 * lv)
  }
  return raw
}

export function cargoCapacityM3Of(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = fleetDefOf(state, ctx, shipId)
  if (!ship) return 0
  const cargoDefs = familyModules(state, ctx, shipId, 'cargo')
  let bonus = 0
  for (const def of cargoDefs) bonus += def.bonus ?? 0
  let capMult = 1
  const logLv = Math.min(5, state.skills.trained['deep-space-logistics'] ?? 0)
  if (logLv > 0) capMult *= 1 + 0.04 * logLv
  const holdLv = Math.min(5, state.skills.trained['hold-management'] ?? 0)
  if (holdLv > 0) capMult *= 1 + 0.03 * holdLv
  if (ship.role === 'hauler') {
    const haulerLv = Math.min(5, state.skills.trained['hauler-ops'] ?? 0)
    if (haulerLv > 0) capMult *= 1 + 0.05 * haulerLv
  }
  const plugDefs = plugEffectPartsOf(state.fleet[shipId]?.plugs ?? [], ctx).map(part => part.effective)
  for (const p of plugDefs) {
    bonus += p.cargoCapacityBonusPct ?? 0
  }
  const damage = shipDamageEffects(state.fleet[shipId]?.damagePlugs, plugDefs.find(p => p.damageManagement)?.damageManagement)
  return ceilFinalQuantity(ship.cargoM3 * (1 + bonus) * capMult * damage.cargo)
}

export function cargoUsedM3(state: GameState, ctx: SimContext): number {
  return cargoUsedM3Of(state, ctx, state.shipId)
}

export function cargoCapacityM3(state: GameState, ctx: SimContext): number {
  return cargoCapacityM3Of(state, ctx, state.shipId)
}

export function freeCargoM3Of(state: GameState, ctx: SimContext, shipId: string): number {
  return Math.max(0, cargoCapacityM3Of(state, ctx, shipId) - cargoUsedM3Of(state, ctx, shipId))
}

export function freeCargoM3(state: GameState, ctx: SimContext): number {
  return freeCargoM3Of(state, ctx, state.shipId)
}


export function unloadCargoOfShipToWarehouse(state: GameState, ctx: SimContext, shipId: string): number {
  const lock = shipLockedReason(state, shipId, '从它货仓卸货')
  if (lock) return 0
  const cargo = cargoOfShip(state, shipId)
  let moved = 0
  for (const [id, units] of Object.entries(cargo)) {
    if (units === undefined || units <= 0) continue
    if (isModuleCargoId(ctx, id)) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + units
    else state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + units
    delete cargo[id]
    moved += units
  }
  return moved
}

export function unloadWorkFleetToWarehouse(state: GameState, ctx: SimContext, leader = state.shipId): number {
  const escort = state.combatEscort
  const ids = escort?.leaderShipId === leader ? deployedCombatEscorts(state) : []
  const arrived = ids.length ? { ...state, combatEscort: undefined } : state
  return [...new Set([leader, ...ids])].reduce((sum, id) => sum + unloadCargoOfShipToWarehouse(arrived, ctx, id), 0)
}

export function unloadCargoToWarehouse(state: GameState, ctx: SimContext, itemId?: string): number {
  return unloadShipCargo(state, ctx, state.shipId, itemId)
}

export function unloadShipCargo(state: GameState, ctx: SimContext, shipId: string, itemId?: string): number {
  if (shipOperationBlockReason(state, ctx, shipId, 'cargo')) return 0
  const cargo = cargoOfShip(state, shipId)
  const targetIds = itemId ? [itemId] : Object.keys(cargo)
  let moved = 0
  for (const id of targetIds) {
    const units = cargo[id]
    if (units === undefined || units <= 0) continue
    if (isModuleCargoId(ctx, id)) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + units
    else state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + units
    delete cargo[id]
    moved += units
  }
  return moved
}

export function repairMisplacedWarehouseModules(state: GameState, ctx: SimContext): number {
  let moved = 0
  for (const [id, units] of Object.entries(state.warehouse.items)) {
    if (units === undefined || units <= 0) continue
    if (!isModuleCargoId(ctx, id)) continue
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + units
    delete state.warehouse.items[id]
    moved += units
  }
  return moved
}

export function repairHoldForbiddenCargo(state: GameState, ctx: SimContext): number {
  let moved = 0
  for (const ship of Object.values(state.fleet)) {
    const cargo = ship?.cargo
    if (cargo === undefined || Object.isFrozen(cargo)) continue
    for (const [id, units] of Object.entries(cargo)) {
      if (units === undefined || units <= 0) continue
      if (!cargoHoldForbidden(ctx, id)) continue
      state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + units
      delete cargo[id]
      moved += units
    }
  }
  return moved
}

export function loadWarehouseToCargo(state: GameState, itemId: string, units: number, ctx: SimContext): number {
  if (shipOperationBlockReason(state, ctx, state.shipId, 'cargo')) return 0
  const lock = shipLockedReason(state, state.shipId, '往它货仓装货')
  if (lock) return 0
  const available = countWare(state, itemId)
  const amount = Math.min(available, Math.floor(units))
  if (amount <= 0) return 0
  if (removeWare(state, itemId, amount)) {
    addItem(state, itemId, amount)
    return amount
  }
  return 0
}

export function loadWarehouseToCargoFit(state: GameState, itemId: string, ctx: SimContext): number {
  if (shipOperationBlockReason(state, ctx, state.shipId, 'cargo')) return 0
  const lock = shipLockedReason(state, state.shipId, '往它货仓装货')
  if (lock) return 0
  if (cargoHoldForbidden(ctx, itemId)) return 0
  const def = ctx.items.get(itemId)
  const mod = def ? undefined : ctx.modules.get(itemId)
  if (!def && !mod) return 0
  const unit = def ? cargoUnitM3(state, def) : MODULE_CARGO_UNIT_M3
  if (unit <= 0) return 0
  const maxBySpace = Math.floor(freeCargoM3(state, ctx) / unit)
  const amount = Math.min(def ? countWare(state, itemId) : (state.moduleBay[itemId] ?? 0), maxBySpace)
  if (amount <= 0) return 0
  if (def) {
    if (!removeWare(state, itemId, amount)) return 0
  } else {
    const rest = (state.moduleBay[itemId] ?? 0) - amount
    if (rest <= 0) delete state.moduleBay[itemId]
    else state.moduleBay[itemId] = rest
  }
  addItem(state, itemId, amount)
  return amount
}

export function removeCargoOfShip(state: GameState, shipId: string, itemId: string, units: number): number {
  const cargo = cargoOfShip(state, shipId)
  if (!cargo || Object.isFrozen(cargo)) return 0
  const have = Math.floor(cargo[itemId] ?? 0)
  const take = Math.min(have, Math.max(0, Math.floor(units)))
  if (take <= 0) return 0
  const left = have - take
  if (left > 0) cargo[itemId] = left
  else delete cargo[itemId]
  return take
}
