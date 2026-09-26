/**
 * 货仓通用化（2026-09-09 船长口径 A：仓库可携带物都可装船，消费链路不变）：
 * - 物品全放开（矿物等小体积物品装船；引擎无 kind 门槛，按各自 unitM3 占舱）；
 * - 模块（装备）装船 = 携带：从 moduleBay 扣取、占位体积 1 m³/件（MODULE_CARGO_UNIT_M3）；
 * - 卸货分流：模块回 moduleBay（装备库）、其余回 warehouse.items（物品仓库）；
 * - 货仓体积计算：模块按占位 1 m³/件计入（cargoUsedM3Of）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import {
  MODULE_CARGO_UNIT_M3,
  addWare,
  cargoOfShip,
  cargoUsedM3Of,
  countWare,
  isModuleCargoId,
  loadWarehouseToCargoFit,
  repairMisplacedWarehouseModules,
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
  it('判定 = **查装备目录**（不再看 id 前缀）', () => {
    const ctx = buildSimContext()
    expect(isModuleCargoId(ctx, 'mod-turret-kin-3')).toBe(true)
    expect(isModuleCargoId(ctx, 'plug-shield-plate'), '插件也是装备').toBe(true)
    expect(isModuleCargoId(ctx, 'min-tritanium')).toBe(false)
    expect(isModuleCargoId(ctx, 'blackbox-h')).toBe(false)
    expect(isModuleCargoId(ctx, 'neither-mod-nor-item'), '目录里没有的一律当物品').toBe(false)
  })

  /**
   * **报障回归护栏**（**2026-09-26 玩家报障**：「**玩家将插件放到货仓再卸进仓库后插件不见了**」）：
   * 判据原先写的是 id 前缀 `mod-`，而舰船插件 id 是 `plug-*` ⇒ 装卸分流把它当物品扔进物品仓库
   * （物品页只列物品目录 ⇒ 谁都看不见）。本用例对**真目录**逐个过一遍：装备目录里每一件都必须判成模块，
   * 物品目录里每一件都必须判成物品 —— 这样"将来新增一个 id 空间的装备"当场就会红。
   */
  it('真目录全量对照：装备目录里每一件都算模块、物品目录里每一件都不算', () => {
    const ctx = buildSimContext()
    expect(ctx.modules.size).toBeGreaterThan(0)
    for (const id of ctx.modules.keys()) expect(isModuleCargoId(ctx, id), `装备 ${id} 应判成模块`).toBe(true)
    for (const id of ctx.items.keys()) expect(isModuleCargoId(ctx, id), `物品 ${id} 不该判成模块`).toBe(false)
    // 报障的那一族（舰船插件）单独点名，防将来目录改动把这条护栏变成空转
    expect(isModuleCargoId(ctx, 'plug-shield-plate'), '舰船插件（plug-*）必须判成模块').toBe(true)
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

  it('**报障回归**：舰船插件（`plug-*`）装船再卸货**回装备库**、且绝不落进物品仓库', () => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const PLUG = 'plug-shield-plate'
    state.moduleBay[PLUG] = 2
    expect(loadWarehouseToCargoFit(state, PLUG, ctx)).toBe(2)
    expect(cargoOfShip(state, state.shipId)[PLUG]).toBe(2)
    // 整仓卸货（报障走的就是这条）
    expect(unloadCargoToWarehouse(state, ctx)).toBe(2)
    expect(state.moduleBay[PLUG]).toBe(2)
    expect(state.warehouse.items[PLUG], '插件不该出现在物品仓库（那里没有入口 ⇒ 看着像丢了）').toBeUndefined()
    // 指定船那条路同样
    expect(loadWarehouseToCargoFit(state, PLUG, ctx)).toBe(2)
    expect(unloadCargoOfShipToWarehouse(state, ctx, state.shipId)).toBe(2)
    expect(state.moduleBay[PLUG]).toBe(2)
    expect(state.warehouse.items[PLUG]).toBeUndefined()
  })

  it('**存量修复**：已经误落进物品仓库的装备搬回装备库（物品一件不动）', () => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    // 复现报障后的存档状态：插件躺在物品仓库里
    state.warehouse.items['plug-shield-plate'] = 3
    state.warehouse.items['mod-turret-kin-3'] = 1
    state.warehouse.items['min-a'] = 5
    expect(repairMisplacedWarehouseModules(state, ctx)).toBe(4)
    expect(state.moduleBay['plug-shield-plate']).toBe(3)
    expect(state.moduleBay['mod-turret-kin-3']).toBe(1)
    expect(state.warehouse.items['plug-shield-plate']).toBeUndefined()
    expect(state.warehouse.items['mod-turret-kin-3']).toBeUndefined()
    expect(state.warehouse.items['min-a'], '物品照旧').toBe(5)
    // 幂等：再跑一次什么都不搬
    expect(repairMisplacedWarehouseModules(state, ctx)).toBe(0)
  })

  it('卸货分流：模块回装备库、物品回物品仓库；指定船同款', () => {
    const { state, ctx } = world()
    addWare(state, 'min-a', 60) // 物品：60 × 0.01 = 0.6 m³
    state.moduleBay['mod-b'] = 4 // 模块：4 m³
    expect(loadWarehouseToCargoFit(state, 'min-a', ctx)).toBe(60)
    expect(loadWarehouseToCargoFit(state, 'mod-b', ctx)).toBe(4)
    expect(cargoUsedM3Of(state, ctx, state.shipId)).toBeCloseTo(4.6, 6)

    // 单条卸货：先卸物品 → 回 warehouse.items
    expect(unloadCargoToWarehouse(state, ctx, 'min-a')).toBe(60)
    expect(countWare(state, 'min-a')).toBe(60)
    expect(state.moduleBay['mod-b']).toBeUndefined() // 未动
    // 单条卸货：模块 → 回 moduleBay
    expect(unloadCargoToWarehouse(state, ctx, 'mod-b')).toBe(4)
    expect(state.moduleBay['mod-b']).toBe(4)
    expect(Object.keys(cargoOfShip(state, state.shipId))).toHaveLength(0)

    // 整仓卸货（含模块）：分流回两个库
    addWare(state, 'ore-a', 10)
    state.moduleBay['mod-a'] = 2
    expect(loadWarehouseToCargoFit(state, 'ore-a', ctx)).toBe(10)
    expect(loadWarehouseToCargoFit(state, 'mod-a', ctx)).toBe(2)
    expect(unloadCargoToWarehouse(state, ctx)).toBe(12)
    expect(countWare(state, 'ore-a')).toBe(10)
    expect(state.moduleBay['mod-a']).toBe(2)
  })

  it('指定船整仓卸货（善后路径）同样分流', () => {
    const { state, ctx } = world()
    state.moduleBay['mod-a'] = 3
    expect(loadWarehouseToCargoFit(state, 'mod-a', ctx)).toBe(3)
    expect(unloadCargoOfShipToWarehouse(state, ctx, state.shipId)).toBe(3)
    expect(state.moduleBay['mod-a']).toBe(3)
    expect(cargoOfShip(state, state.shipId)['mod-a']).toBeUndefined()
  })
})
