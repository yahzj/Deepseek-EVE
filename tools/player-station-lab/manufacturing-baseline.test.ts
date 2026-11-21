import { describe, expect, it } from 'vitest'
import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { startManufacturing } from '../../packages/core/src/industry/manufacturing/start'
import { advanceManufacturing } from '../../packages/core/src/industry/manufacturing/advance'
import { advanceStationManufacturing, createStationManufacturing, stationManufacturingCommand } from '../../packages/core/src/playerStation/manufacturing'
import type { StationManufacturingHost } from '../../packages/core/src/playerStation/manufacturing'
import { MANUFACTURING_ITEM_IDS, MANUFACTURING_RECIPES, manufacturingBlueprintName, manufacturingItemName, manufacturingRecipe } from './manufacturing-baseline'

const context = buildSimContext()
describe('玩家站制造预览：真实主控基准适配', () => {
  it('只开放真实learnless基础零件，不将第8张learnless探测机误当零件', () => {
    expect(MANUFACTURING_RECIPES.map(row => row.blueprintId).sort()).toEqual([
      'bp-part-armor-plate', 'bp-part-cable', 'bp-part-circuit', 'bp-part-coolant', 'bp-part-frame', 'bp-part-gyro', 'bp-part-lens',
    ])
    const allowed = [...context.blueprints.values()].filter(bp => bp.learnless === true && bp.partTier === 'basic'
      && bp.itemId !== undefined && context.items.get(bp.itemId)?.kind === 'part')
    expect(MANUFACTURING_RECIPES.map(row => row.blueprintId)).toEqual(allowed.map(bp => bp.id))
    for (const row of MANUFACTURING_RECIPES) {
      const bp = context.blueprints.get(row.blueprintId)!
      expect(row.itemId).toBe(bp.itemId)
      expect(row.name).toBe(context.items.get(row.itemId)!.name)
      expect(manufacturingBlueprintName(row.blueprintId)).toBe(bp.name)
      expect(manufacturingItemName(row.itemId)).toBe(row.name)
    }
    expect(new Set(MANUFACTURING_ITEM_IDS).size).toBe(MANUFACTURING_ITEM_IDS.length)
    expect(MANUFACTURING_ITEM_IDS.every(id => context.items.has(id))).toBe(true)
  })
  it.each([0, 1, 2, 3, 4, 5])('统一技能等级%i：逐蓝图工期/实扣材料/产物与既有主控一致', level => {
    for (const row of MANUFACTURING_RECIPES) {
      const state = createInitialState({ nowWallMs: 0, seed: 1 }), bp = context.blueprints.get(row.blueprintId)!
      for (const skill of context.skills.values()) state.skills.trained[skill.id] = level
      for (const material of bp.materials) state.warehouse.items[material.itemId] = 1_000_000
      const initial = { ...state.warehouse.items }
      expect(startManufacturing(state, bp.id, 'pilot', context).ok).toBe(true)
      const run = state.manufacturingRuns.find(entry => entry.active)!
      expect(run.worker).toBe('pilot')
      const input = Object.fromEntries(Object.entries(initial).flatMap(([id, n]) =>
        n > (state.warehouse.items[id] ?? 0) ? [[id, n - (state.warehouse.items[id] ?? 0)]] : []))
      const before = { ...state.warehouse.items }
      state.gameMs = run.finishAtGameMs - 1
      advanceManufacturing(state, context)
      expect(state.warehouse.items).toEqual(before)
      state.gameMs++
      advanceManufacturing(state, context)
      expect(state.manufacturingRuns).toHaveLength(0)
      const output = Object.fromEntries(Object.entries(state.warehouse.items).flatMap(([id, n]) =>
        n > (before[id] ?? 0) ? [[id, n - (before[id] ?? 0)]] : []))
      const recipe = manufacturingRecipe(bp.id, level)!
      expect(recipe).toEqual({ cycleMs: run.durationMs, input, output })
      expect(Object.keys(recipe.output)).toEqual([row.itemId])
      expect(Object.keys(recipe.input).every(id => MANUFACTURING_ITEM_IDS.includes(id))).toBe(true)

      const station = createStationManufacturing(), inventory = { ...initial }
      const host: StationManufacturingHost = {
        residents: () => [0], personAvailable: () => true, facilityAvailable: index => index === 15, powered: () => true,
        recipe: id => manufacturingRecipe(id, level), available: id => inventory[id] ?? 0,
        settle: (cost, products) => {
          if (Object.entries(cost).some(([id, n]) => (inventory[id] ?? 0) < n)) return false
          for (const [id, n] of Object.entries(cost)) inventory[id] -= n
          for (const [id, n] of Object.entries(products)) inventory[id] = (inventory[id] ?? 0) + n
          return true
        },
      }
      expect(stationManufacturingCommand(station, host, { kind: 'assign', cellIndex: 15, personIndex: 0, blueprintId: bp.id, batches: 1 })).toEqual({ ok: true })
      expect(inventory).toEqual(initial)
      advanceStationManufacturing(station, host, run.durationMs)
      expect(inventory).toEqual(state.warehouse.items)
      expect(station.runs[0]).toMatchObject({ batchesDone: 1, progressMs: 0 })
      expect(station.runs[0].personIndex).toBeUndefined()
    }
  })
  it('未知/非基础/未发布蓝图不返回配方，使用原蓝图id而非物品id', () => {
    for (const bp of context.blueprints.values()) {
      if (!MANUFACTURING_RECIPES.some(row => row.blueprintId === bp.id)) expect(manufacturingRecipe(bp.id, 0)).toBeUndefined()
    }
    expect(manufacturingRecipe('bp-deep-space-probe', 0)).toBeUndefined()
    expect(manufacturingRecipe('part-frame', 0)).toBeUndefined()
    expect(manufacturingRecipe('unknown', 0)).toBeUndefined()
    expect(manufacturingItemName('unknown')).toBe('unknown')
    expect(manufacturingBlueprintName('unknown')).toBe('unknown')
  })
  it('默认等级0，缓存输入/输出均深拷贝，级别相互隔离', () => {
    const id = 'bp-part-frame', baseline = manufacturingRecipe(id, 0)!, copy = manufacturingRecipe(id)!
    expect(copy).toEqual(baseline)
    expect(copy).not.toBe(baseline)
    expect(copy.input).not.toBe(baseline.input)
    expect(copy.output).not.toBe(baseline.output)
    copy.cycleMs = 1; copy.input['min-tritanium'] = 999; copy.output['part-frame'] = 999
    expect(manufacturingRecipe(id, 0)).toEqual(baseline)
    const max = manufacturingRecipe(id, 5)!
    expect(max.cycleMs).toBeLessThan(baseline.cycleMs)
    expect(max.input['min-tritanium']).toBeLessThan(baseline.input['min-tritanium'])
    expect(max.output).toEqual(baseline.output)
    expect(manufacturingRecipe(id, 0)).toEqual(baseline)
  })
  it.each([-1, 6, 0.5, NaN, Infinity])('拒绝非法合成技能等级%s', level => {
    expect(() => manufacturingRecipe('bp-part-frame', level)).toThrow('Invalid manufacturing baseline level')
  })
})
