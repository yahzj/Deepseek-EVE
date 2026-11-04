import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { ENCRYPTED_FAMILIES, encryptedBlueprintDraw, encryptedBlueprintGroups } from '../src/encryptedContainer'
import { wormholeUnboxRoll } from '../src/wormholeSalvage'
import { startUnboxRun } from '../src/industry/refining/unbox'
import { advanceRefining } from '../src/industry/refining/advance'
import { startManufacturing, advanceManufacturing, cancelManufacturing } from '../src/manufacturing'
import { learnBlueprint } from '../src/market'
import { marketTradingGoods } from '../src/market/access'
import { exchangePlugBlueprint, plugExchangeRowsOf } from '../src/plugs'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const added = {
  A: 'plug-pirate-damage-management', C: 'plug-alien-nanobiomass', D: 'plug-gravekeeper-charge',
  E: 'plug-titan-drone-command', G: 'plug-deadarmy-reinforced-hull',
} as const
const original = {
  A: 'plug-pirate-raider', C: 'plug-alien-shield-coating', D: 'plug-gravekeeper-capacitor',
  E: 'plug-titan-compression', G: 'plug-deadarmy-printing',
} as const

describe('新增阵营插件获取与一次性制造', () => {
  it.each(ENCRYPTED_FAMILIES)('%s箱保留三类等权、插件同族两件均分和每箱1至3抽', family => {
    const groups = encryptedBlueprintGroups(ctx, family)!
    expect(groups).not.toBeNull()
    expect(groups.map(group => group.length)).toEqual([2, family === 'C' || family === 'D' ? 2 : 1, 3])
    expect(groups[0]).toEqual([`bp-once-${original[family]}`, `bp-once-${added[family]}`])
    const counts = [0, 0, 0]
    const plugCounts = [0, 0]
    const sizes = new Set<number>()
    const rng = { seed: 20261104, count: 0 }
    let total = 0
    let repeated = false
    for (let i = 0; i < 6000; i++) {
      const draw = encryptedBlueprintDraw(ctx, family, rng)!
      sizes.add(draw.length)
      repeated ||= new Set(draw).size < draw.length
      for (const id of draw) {
        const group = groups.findIndex(ids => ids.includes(id))
        expect(group).toBeGreaterThanOrEqual(0)
        counts[group]!++
        total++
        if (group === 0) plugCounts[groups[0]!.indexOf(id)]!++
      }
    }
    expect([...sizes].sort()).toEqual([1, 2, 3])
    expect(repeated).toBe(true)
    for (const count of counts) expect(count / total).toBeGreaterThan(0.31)
    for (const count of counts) expect(count / total).toBeLessThan(0.36)
    for (const count of plugCounts) expect(count / counts[0]!).toBeGreaterThan(0.46)
    for (const count of plugCounts) expect(count / counts[0]!).toBeLessThan(0.54)
    for (const other of ENCRYPTED_FAMILIES.filter(id => id !== family)) {
      expect(groups.flat()).not.toContain(`bp-once-${added[other]}`)
    }
  })

  it.each(ENCRYPTED_FAMILIES)('%s箱实际拆解可获得新增图纸，读档不改变结果', family => {
    const box = `box-encrypted-${family.toLowerCase()}`
    const blueprintId = `bp-once-${added[family]}`
    const state = createInitialState({ nowWallMs: 0, seed: 20261104 })
    let draws = 0
    while (draws++ < 100) {
      const preview = structuredClone(state)
      const result = wormholeUnboxRoll(preview, ctx, box)!
      if ([result.itemId, ...(result.extra ?? []).map(row => row.itemId)].includes(blueprintId)) break
      state.rng.box = preview.rng.box
    }
    expect(draws).toBeLessThanOrEqual(100)
    state.warehouse.items[box] = 1
    expect(startUnboxRun(state, ctx, box, 'pilot').ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    for (const actual of [state, back]) {
      actual.gameMs = actual.refineRuns[0]!.finishAtGameMs
      advanceRefining(actual, ctx)
      expect(actual.blueprintStock[blueprintId]).toBeGreaterThanOrEqual(1)
      expect(actual.warehouse.items[box] ?? 0).toBe(0)
    }
    expect(back.blueprintStock).toEqual(state.blueprintStock)
    expect(back.rng).toEqual(state.rng)
  })

  it.each(ENCRYPTED_FAMILIES)('%s箱新增图纸缺失时保留箱和开箱计数', family => {
    const state = createInitialState({ nowWallMs: 0, seed: 20261104 })
    const box = `box-encrypted-${family.toLowerCase()}`
    state.warehouse.items[box] = 1
    const broken = { ...ctx, blueprints: new Map(ctx.blueprints) }
    broken.blueprints.delete(`bp-once-${added[family]}`)
    const before = structuredClone(state.rng)
    expect(encryptedBlueprintGroups(broken, family)).toBeNull()
    expect(startUnboxRun(state, broken, box, 'pilot').ok).toBe(false)
    expect(state.warehouse.items[box]).toBe(1)
    expect(state.rng).toEqual(before)
    expect(state.refineRuns).toHaveLength(0)
  })

  it.each(ENCRYPTED_FAMILIES)('%s插件沿旧料单与1小时工时，通用黑匣可顶料，取消退书且只造一次', family => {
    const moduleId = added[family]
    const blueprintId = `bp-once-${moduleId}`
    const bp = ctx.blueprints.get(blueprintId)!
    const source = ctx.blueprints.get(`bp-once-${original[family]}`)!
    expect(bp.singleUse).toBe(true)
    expect(bp.moduleId).toBe(moduleId)
    expect(bp.materials).toEqual(source.materials)
    expect(bp.buildSeconds).toBe(3600)
    const state = createInitialState({ nowWallMs: 0, seed: 20261104 })
    state.blueprintStock[blueprintId] = 1
    for (const material of bp.materials) {
      const itemId = material.itemId.startsWith('blackbox-') ? 'blackbox-universal' : material.itemId
      state.warehouse.items[itemId] = material.count * 2
    }
    const materials = structuredClone(state.warehouse.items)
    expect(learnBlueprint(state, ctx, blueprintId).ok).toBe(false)
    expect(startManufacturing(state, blueprintId, 'pilot', ctx).ok).toBe(true)
    expect(state.warehouse.items['blackbox-universal']).toBe(materials['blackbox-universal']! - 1)
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    expect(state.blueprintStock[blueprintId]).toBe(1)
    expect(state.warehouse.items).toEqual(materials)
    expect(startManufacturing(state, blueprintId, 'pilot', ctx).ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    back.gameMs = back.manufacturingRuns[0]!.finishAtGameMs
    advanceManufacturing(back, ctx)
    expect(back.moduleBay[moduleId]).toBe(1)
    expect(back.blueprintStock[blueprintId] ?? 0).toBe(0)
    expect(back.learnedRecipes).not.toContain(blueprintId)
    expect(startManufacturing(back, blueprintId, 'pilot', ctx).ok).toBe(false)
  })

  it.each(ENCRYPTED_FAMILIES)('%s插件不能声望兑换或从普通市场获取', family => {
    const moduleId = added[family]
    const state = createInitialState({ nowWallMs: 0, seed: 20261104 })
    state.standings.dsi = 1000
    expect(ctx.modules.get(moduleId)).toMatchObject({ plugNonStacking: true, blueprintExchangeDisabled: true })
    expect(plugExchangeRowsOf(state, ctx).some(row => row.moduleId === moduleId)).toBe(false)
    expect(exchangePlugBlueprint(state, ctx, moduleId).ok).toBe(false)
    expect(state.standings.dsi).toBe(1000)
    expect(state.learnedRecipes).not.toContain(`bp-${moduleId}`)
    const ids = [moduleId, `bp-${moduleId}`, `bp-once-${moduleId}`]
    expect(marketTradingGoods(ctx).filter(row => ids.includes(row.refId))).toEqual([])
  })
})
