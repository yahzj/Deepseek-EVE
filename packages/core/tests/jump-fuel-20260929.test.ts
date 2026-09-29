/**
 * **跃迁燃料链**（**2026-09-29 船长令**）用例：气/冰重配比总价值不变 · 燃料按"原返航秒"扣料与 ×10 ·
 * 实验室 BOM 投料与料尽自停 · 首座空间站解锁门槛。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, LAB_RECIPES, ITEMS } from '@whale/data'
import { createInitialState, advanceGame } from '../src/index'
import { beginJumpFuelLeg, jumpFuelLegMsOf, jumpFuelStockOf, JUMP_FUEL_ITEM_ID, JUMP_FUEL_SPEED_MUL } from '../src/jumpFuel'
import { advanceLab, labAffordableBatches, labUnlocked, startLabRun } from '../src/lab'
import { addWare } from '../src/inventory'

const ctx = buildSimContext()
const recipe = LAB_RECIPES[0]!

/** 气/冰重配比：改后总价值与"改前口径"（= 直接卖价 ×1.67）同档（±1%） */
describe('跃迁燃料链 · 重配比', () => {
  it('每种气/冰的精炼总价值 ≈ 直接卖价 ×1.67（±1%）', () => {
    const gases = ITEMS.filter((d) => d.kind === 'gas' || d.kind === 'ice')
    expect(gases.length, '4 气 + 3 冰').toBe(7)
    for (const def of gases) {
      let v = 0
      for (const r of def.refine ?? []) v += r.perOre * (ctx.items.get(r.mineralId)?.baseSellPriceIsk ?? 0)
      const want = def.baseSellPriceIsk * 1.67
      expect(Math.abs(v - want) / want, `${def.name} 精炼总价值`).toBeLessThan(0.01)
    }
  })

  it('新三件套都有市场行（可买卖）且价格与物品一致', () => {
    for (const id of ['min-jumplasma', 'min-cryoslurry', 'min-curvature', JUMP_FUEL_ITEM_ID]) {
      const def = ctx.items.get(id)!
      const good = [...ctx.marketGoods.values()].find((g) => g.refId === id)
      expect(good, `${id} 有市场行`).toBeDefined()
      expect(good!.basePrice, `${id} 行价 = 物品卖价`).toBe(def.baseSellPriceIsk)
    }
  })
})

describe('跃迁燃料 · 消耗与倍率', () => {
  /** 造一个"已解锁"的档：给一座站点的档位全部交满（用 `stationSites` 直接写满，避开交付流程） */
  const unlockedState = (): ReturnType<typeof createInitialState> => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    for (const site of ctx.stations.values()) s.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    return s
  }

  it('门槛：空间站未建成 ⇒ 未解锁、起线被拒', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    expect(labUnlocked(s, ctx)).toBe(false)
    const r = startLabRun(s, ctx, recipe.id, 'pilot')
    expect(r.ok).toBe(false)
    expect(labUnlocked(unlockedState(), ctx), '首座建成 ⇒ 解锁').toBe(true)
  })

  it('按原返航秒扣 1 单位/秒，返航时长 ÷10；燃料不足 ⇒ 不加速也不扣', () => {
    const s = unlockedState()
    s.jumpFuel = { mine: true }
    expect(beginJumpFuelLeg(s, 'mine', 60_000), '没料 ⇒ 不加速').toBe(1)
    addWare(s, JUMP_FUEL_ITEM_ID, 119)
    expect(beginJumpFuelLeg(s, 'mine', 120_000), '119 < 120 秒 ⇒ 仍不加速').toBe(1)
    expect(jumpFuelStockOf(s), '不扣料').toBe(119)
    addWare(s, JUMP_FUEL_ITEM_ID, 1)
    expect(beginJumpFuelLeg(s, 'mine', 120_000), '够 ⇒ ×10').toBe(JUMP_FUEL_SPEED_MUL)
    expect(jumpFuelStockOf(s), '扣 120 单位（= 原返航秒数）').toBe(0)
    expect(jumpFuelLegMsOf(120_000, JUMP_FUEL_SPEED_MUL), '时长 ÷10').toBe(12_000)
    /** 开关没开的活动不吃料 */
    addWare(s, JUMP_FUEL_ITEM_ID, 500)
    expect(beginJumpFuelLeg(s, 'salvage', 120_000), '打捞没开 ⇒ 1').toBe(1)
    expect(jumpFuelStockOf(s), '没扣').toBe(500)
  })

  it('算例：20 分钟原返航 ⇒ 扣 1,200 单位、实飞 2 分钟', () => {
    const s = unlockedState()
    s.jumpFuel = { expedition: true }
    addWare(s, JUMP_FUEL_ITEM_ID, 1_200)
    expect(beginJumpFuelLeg(s, 'expedition', 20 * 60_000)).toBe(JUMP_FUEL_SPEED_MUL)
    expect(jumpFuelStockOf(s)).toBe(0)
    expect(jumpFuelLegMsOf(20 * 60_000, JUMP_FUEL_SPEED_MUL)).toBe(2 * 60_000)
  })
})

describe('实验室 · BOM 投料与自停', () => {
  const readyState = (): ReturnType<typeof createInitialState> => {
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    for (const site of ctx.stations.values()) s.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    s.debugQuick = false
    for (const m of recipe.materials) addWare(s, m.itemId, m.units * 2)
    return s
  }

  it('够两批 ⇒ 每批扣齐 BOM、产出 600 单位燃料；料尽自停', () => {
    const s = readyState()
    expect(labAffordableBatches(s, recipe), '够 2 批').toBe(2)
    const r = startLabRun(s, ctx, recipe.id, 'pilot')
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.labRuns?.length).toBe(1)
    const before = jumpFuelStockOf(s)
    advanceGame(s, recipe.cycleMs + 1, ctx)
    expect(jumpFuelStockOf(s) - before, '第一批 600 单位入仓库').toBe(recipe.outputUnits)
    expect(labAffordableBatches(s, recipe), '只剩一批的料').toBe(1)
    advanceGame(s, recipe.cycleMs + 1, ctx)
    expect(jumpFuelStockOf(s) - before, '两批共 1,200 单位').toBe(recipe.outputUnits * 2)
    /** 第三批无料 ⇒ 自停并摘线 */
    advanceGame(s, recipe.cycleMs + 1, ctx)
    expect(s.labRuns?.length ?? 0, '料尽自停（线被摘掉）').toBe(0)
  })

  it('材料不足一批 ⇒ 起线被拒', () => {
    const s = readyState()
    /** 直接把主料压到"差 1 单位不够一批"（`addWare` 负数会被钳，不适用） */
    s.warehouse.items[recipe.materials[0]!.itemId] = recipe.materials[0]!.units - 1
    expect(labAffordableBatches(s, recipe), '差 1 单位 ⇒ 0 批').toBe(0)
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok).toBe(false)
  })
})
