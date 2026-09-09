/**
 * 货仓通用化（2026-09-09 船长口径 A：仓库可携带物都可装船，消费链路不变）：
 * - 物品全放开（矿物等小体积物品装船；引擎无 kind 门槛，按各自 unitM3 占舱）；
 * - 模块（装备）装船 = 携带：从 moduleBay 扣取、占位体积 1 m³/件（MODULE_CARGO_UNIT_M3）；
 * - 卸货分流：模块回 moduleBay（装备库）、其余回 warehouse.items（物品仓库）；
 * - 货仓体积计算：模块按占位 1 m³/件计入（cargoUsedM3Of）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import {
  MODULE_CARGO_UNIT_M3,
  addWare,
  cargoOfShip,
  cargoUsedM3Of,
  countWare,
  isModuleCargoId,
  loadWarehouseToCargoFit,
  unloadCargoOfShipToWarehouse,
  unloadCargoToWarehouse,
} from '../src/inventory'
import { makeTestCtx } from './helpers'

function world() {
  const ctx = makeTestCtx({})
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  return { state, ctx }
}

describe('货仓通用化（口径 A：可携带物都可装船）', () => {
  it('模块 id 前缀判定：mod-* 进装备库、其余进物品仓库', () => {
    expect(isModuleCargoId('mod-a')).toBe(true)
    expect(isModuleCargoId('mod-turret-kin-3')).toBe(true)
    expect(isModuleCargoId('min-a')).toBe(false)
    expect(isModuleCargoId('ore-a')).toBe(false)
  })

  it('矿物（小体积物品）可装船：按 unitM3 占舱、仓库扣减', () => {
    const { state, ctx } = world()
    addWare(state, 'min-a', 100)
    const loaded = loadWarehouseToCargoFit(state, 'min-a', ctx)
    expect(loaded).toBe(100) // 舱容足够（默认 800 m³，矿物 0.01 m³/单位）
    expect(countWare(state, 'min-a')).toBe(0)
    expect(cargoOfShip(state, state.shipId)['min-a']).toBe(100)
    expect(cargoUsedM3Of(state, ctx, state.shipId)).toBeCloseTo(1, 6) // 100 × 0.01
  })

  it('模块装船受舱容限制：从装备库扣取、放不下按剩余空间截断', () => {
    const { state, ctx } = world()
    state.moduleBay['mod-a'] = 120
    const loaded = loadWarehouseToCargoFit(state, 'mod-a', ctx)
    expect(loaded).toBeGreaterThan(0)
    expect(MODULE_CARGO_UNIT_M3).toBe(1)
    expect(state.moduleBay['mod-a'] ?? 0).toBe(120 - loaded)
    expect(cargoOfShip(state, state.shipId)['mod-a'] ?? 0).toBe(loaded)
    // 占位体积与剩余空间一致：remaining = 舱容 − loaded×1 ≥ 0
    expect(cargoUsedM3Of(state, ctx, state.shipId)).toBe(loaded)
  })

  it('卸货分流：模块回装备库、物品回物品仓库；指定船同款', () => {
    const { state, ctx } = world()
    addWare(state, 'min-a', 60) // 物品：60 × 0.01 = 0.6 m³
    state.moduleBay['mod-b'] = 4 // 模块：4 m³
    expect(loadWarehouseToCargoFit(state, 'min-a', ctx)).toBe(60)
    expect(loadWarehouseToCargoFit(state, 'mod-b', ctx)).toBe(4)
    expect(cargoUsedM3Of(state, ctx, state.shipId)).toBeCloseTo(4.6, 6)

    // 单条卸货：先卸物品 → 回 warehouse.items
    expect(unloadCargoToWarehouse(state, 'min-a')).toBe(60)
    expect(countWare(state, 'min-a')).toBe(60)
    expect(state.moduleBay['mod-b']).toBeUndefined() // 未动
    // 单条卸货：模块 → 回 moduleBay
    expect(unloadCargoToWarehouse(state, 'mod-b')).toBe(4)
    expect(state.moduleBay['mod-b']).toBe(4)
    expect(Object.keys(cargoOfShip(state, state.shipId))).toHaveLength(0)

    // 整仓卸货（含模块）：分流回两个库
    addWare(state, 'ore-a', 10)
    state.moduleBay['mod-a'] = 2
    expect(loadWarehouseToCargoFit(state, 'ore-a', ctx)).toBe(10)
    expect(loadWarehouseToCargoFit(state, 'mod-a', ctx)).toBe(2)
    expect(unloadCargoToWarehouse(state)).toBe(12)
    expect(countWare(state, 'ore-a')).toBe(10)
    expect(state.moduleBay['mod-a']).toBe(2)
  })

  it('指定船整仓卸货（善后路径）同样分流', () => {
    const { state, ctx } = world()
    state.moduleBay['mod-a'] = 3
    expect(loadWarehouseToCargoFit(state, 'mod-a', ctx)).toBe(3)
    expect(unloadCargoOfShipToWarehouse(state, state.shipId)).toBe(3)
    expect(state.moduleBay['mod-a']).toBe(3)
    expect(cargoOfShip(state, state.shipId)['mod-a']).toBeUndefined()
  })
})
