/**
 * 存储层（v7）：当前驾驶船的"货仓"与全局"物品仓库"两个独立存储。
 *
 * 语义（中文说明）：
 * - 货仓（cargo）：属于当前驾驶的船；挖矿/战利品入货仓，占船容量，弃船即遗失；
 * - 物品仓库（warehouse）：属于飞行员/空间站，无限容量、永不遗失；
 *   精炼产物入仓库，制造材料从仓库扣除；
 * - 船在 data 缺失或弃船瞬间 fleet 条目会短暂为空：所有辅助函数都做容错（按空处理）。
 */
import type { FleetShipState, GameState } from './state'
import type { SimContext } from './types'
import { fleetDefOf } from './instances'

/* ───────── 基础访问（容错） ───────── */

/** 当前驾驶船的舰队条目（数据异常时返回 null，调用方按空处理） */
export function currentShipState(state: GameState): FleetShipState | null {
  return state.fleet[state.shipId] ?? null
}

/* ───────── 货仓（驾驶船 + T3 按船只读查询） ───────── */

/** 指定舰队船的货仓内容（驾驶船或副船皆可；船不存在/条目缺失按空处理） */
export function cargoOfShip(state: GameState, shipId: string): Record<string, number> {
  return state.fleet[shipId]?.cargo ?? {}
}

/** 当前驾驶船的货仓（写操作与旧有调用一律只走这里） */
export function cargoItemsOf(state: GameState): Record<string, number> {
  return cargoOfShip(state, state.shipId)
}

/** 查询当前船货仓某物品数量 */
export function countItem(state: GameState, itemId: string): number {
  return cargoItemsOf(state)[itemId] ?? 0
}

/** 当前船货仓入库 */
export function addItem(state: GameState, itemId: string, units: number): void {
  if (!Number.isFinite(units) || units <= 0) return
  const cargo = cargoItemsOf(state)
  if (Object.isFrozen(cargo)) return
  cargo[itemId] = (cargo[itemId] ?? 0) + Math.floor(units)
}

/** 当前船货仓出库；数量不足返回 false */
export function removeItem(state: GameState, itemId: string, units: number): boolean {
  const cargo = cargoItemsOf(state)
  const need = Math.floor(units)
  if (!Number.isFinite(need) || need <= 0) return false
  const current = cargo[itemId] ?? 0
  if (current < need) return false
  const rest = current - need
  if (rest === 0) delete cargo[itemId]
  else cargo[itemId] = rest
  return true
}

/* ───────── 物品仓库（全局） ───────── */

/** 仓库某物品数量 */
export function countWare(state: GameState, itemId: string): number {
  return state.warehouse.items[itemId] ?? 0
}

/** 仓库入库 */
export function addWare(state: GameState, itemId: string, units: number): void {
  if (!Number.isFinite(units) || units <= 0) return
  state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + Math.floor(units)
}

/** 仓库出库；数量不足返回 false */
export function removeWare(state: GameState, itemId: string, units: number): boolean {
  const need = Math.floor(units)
  if (!Number.isFinite(need) || need <= 0) return false
  const current = state.warehouse.items[itemId] ?? 0
  if (current < need) return false
  const rest = current - need
  if (rest === 0) delete state.warehouse.items[itemId]
  else state.warehouse.items[itemId] = rest
  return true
}

/* ───────── 货仓体积（可指定船，含该船货舱槽装备加成） ───────── */

/** 指定船货仓已占用体积（m³） */
export function cargoUsedM3Of(state: GameState, ctx: SimContext, shipId: string): number {
  let used = 0
  for (const [itemId, units] of Object.entries(cargoOfShip(state, shipId))) {
    const def = ctx.items.get(itemId)
    used += units * (def ? def.unitM3 : 0)
  }
  return used
}

/** 指定船货仓容量（m³，按该船自己的舰船定义 + 该船货舱槽装备加成） */
export function cargoCapacityM3Of(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = fleetDefOf(state, ctx, shipId)
  if (!ship) return 0
  const fitted = state.fleet[shipId]?.fitted
  const cargoDef = fitted?.cargo ? ctx.modules.get(fitted.cargo) : undefined
  const bonus = cargoDef && cargoDef.slot === 'cargo' ? cargoDef.bonus ?? 0 : 0
  return Math.round(ship.cargoM3 * (1 + bonus))
}

/** 当前驾驶船货仓已占用体积（m³） */
export function cargoUsedM3(state: GameState, ctx: SimContext): number {
  return cargoUsedM3Of(state, ctx, state.shipId)
}

/** 当前驾驶船货仓容量（m³，含货舱槽装备加成） */
export function cargoCapacityM3(state: GameState, ctx: SimContext): number {
  return cargoCapacityM3Of(state, ctx, state.shipId)
}

/** 当前船货仓剩余空间（m³），不小于 0 */
export function freeCargoM3(state: GameState, ctx: SimContext): number {
  return Math.max(0, cargoCapacityM3(state, ctx) - cargoUsedM3(state, ctx))
}

/* ───────── 跨仓搬运（装卸） ───────── */

/**
 * 指定船货仓 → 仓库（卸货）：返回搬入仓库的单位数。
 * （T4 换船善后：旧船自动返航到港后整仓卸入物品仓库；写操作只经它，防"换船洗仓"。）
 */
export function unloadCargoOfShipToWarehouse(state: GameState, shipId: string): number {
  const cargo = cargoOfShip(state, shipId)
  let moved = 0
  for (const [id, units] of Object.entries(cargo)) {
    if (units === undefined || units <= 0) continue
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + units
    delete cargo[id]
    moved += units
  }
  return moved
}

/** 货仓 → 仓库（卸货）：返回搬入仓库的单位数 */
export function unloadCargoToWarehouse(state: GameState, itemId?: string): number {
  const cargo = cargoItemsOf(state)
  const targetIds = itemId ? [itemId] : Object.keys(cargo)
  let moved = 0
  for (const id of targetIds) {
    const units = cargo[id]
    if (units === undefined || units <= 0) continue
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + units
    delete cargo[id]
    moved += units
  }
  return moved
}

/** 仓库 → 货仓（装船，可指定数量上限防超舱由调用方校验）；返回实际装船单位数 */
export function loadWarehouseToCargo(state: GameState, itemId: string, units: number): number {
  const available = countWare(state, itemId)
  const amount = Math.min(available, Math.floor(units))
  if (amount <= 0) return 0
  if (removeWare(state, itemId, amount)) {
    addItem(state, itemId, amount)
    return amount
  }
  return 0
}

/** 仓库 → 货仓（按当前船的剩余空间尽量装）；返回实际装船单位数 */
export function loadWarehouseToCargoFit(state: GameState, itemId: string, ctx: SimContext): number {
  const def = ctx.items.get(itemId)
  if (!def || def.unitM3 <= 0) return 0
  const maxBySpace = Math.floor(freeCargoM3(state, ctx) / def.unitM3)
  return loadWarehouseToCargo(state, itemId, maxBySpace)
}
