import { describe, expect, it } from 'vitest'
import { buildSimContext, blueprintBookPriceOf } from '@whale/data'
import { createInitialState } from '../src/state'
import { startManufacturing, advanceManufacturing, cancelManufacturing } from '../src/manufacturing'
import { learnBlueprint } from '../src/market'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { rarityTierOf } from '../../data/src/rarityTier'
import { L10N, l10nEntryText } from '../../data/src/l10n/table'

const ctx = buildSimContext()
const once = 'bp-once-drone-repair-mil', permanent = 'bp-drone-repair-mil', product = 'drone-repair-mil'
function world(id: string) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const bp = ctx.blueprints.get(id)!
  state.blueprintStock[id] = 1
  for (const row of bp.materials) state.warehouse.items[row.itemId] = row.count * 3
  return { state, bp }
}

describe('军用修理无人机生产与市场', () => {
  it('成品R2/稀有，一次性R3/稀有，永久R4/奇货，三种商品都可买入', () => {
    for (const [id, tier, channel] of [[product, 2, 'rare'], [once, 3, 'rare'], [permanent, 4, 'exotic']] as const) {
      expect(rarityTierOf(id)).toBe(tier)
      expect(ctx.marketGoods.get(id)).toMatchObject({ refId: id, rarity: channel, rarityTier: tier })
      expect(ctx.marketGoods.get(id)!.playerBuyable).not.toBe(false)
      expect(ctx.marketGoods.get(id)!.unreleased).not.toBe(true)
    }
  })
  it('50架/6分钟和100架/12分钟共用单位料单，料价约50%，书价与目录一致', () => {
    const a = ctx.blueprints.get(once)!, b = ctx.blueprints.get(permanent)!
    expect(a).toMatchObject({ singleUse: true, outputUnits: 50, buildSeconds: 360, priceIsk: 840000, buildCostIsk: 0 })
    expect(b).toMatchObject({ outputUnits: 100, buildSeconds: 720, priceIsk: 16800000, buildCostIsk: 0 })
    expect(b.singleUse).not.toBe(true)
    expect(b.materials).toEqual(a.materials.map(row => ({ ...row, count: row.count * 2 })))
    for (const bp of [a, b]) {
      const materialValue = bp.materials.reduce((sum, row) => sum + row.count * ctx.items.get(row.itemId)!.baseSellPriceIsk, 0)
      expect(materialValue / (42000 * bp.outputUnits!)).toBeCloseTo(.5, 3)
      const good = ctx.marketGoods.get(bp.id)!
      expect(good.basePrice).toBe(bp.priceIsk)
      expect(blueprintBookPriceOf(bp.id, 42000 * bp.outputUnits!, good.rarity)).toBe(bp.priceIsk)
    }
  })
  it('一次性图纸不能永久学习，开工吃书，读档完工只交付50架一次', () => {
    const { state } = world(once)
    expect(learnBlueprint(state, ctx, once).ok).toBe(false)
    expect(startManufacturing(state, once, 'pilot', ctx).ok).toBe(true)
    expect(state.blueprintStock[once] ?? 0).toBe(0)
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    const run = restored.manufacturingRuns.find(row => row.active)!
    restored.gameMs = run.finishAtGameMs - 1
    advanceManufacturing(restored, ctx)
    expect(restored.warehouse.items[product] ?? 0).toBe(0)
    restored.gameMs++
    advanceManufacturing(restored, ctx)
    expect(restored.warehouse.items[product]).toBe(50)
    advanceManufacturing(restored, ctx)
    expect(restored.warehouse.items[product]).toBe(50)
    expect(startManufacturing(restored, once, 'pilot', ctx).ok).toBe(false)
  })
  it('取消一次性制造退回实扣材料与图纸，重新开工仍只交付一批', () => {
    const { state } = world(once)
    const before = structuredClone(state.warehouse.items)
    expect(startManufacturing(state, once, 'pilot', ctx).ok).toBe(true)
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(cancelManufacturing(restored, ctx, restored.manufacturingRuns[0]!.id).ok).toBe(true)
    expect(restored.warehouse.items).toEqual(before)
    expect(restored.blueprintStock[once]).toBe(1)
    expect(startManufacturing(restored, once, 'pilot', ctx).ok).toBe(true)
    restored.gameMs = restored.manufacturingRuns[0]!.finishAtGameMs
    advanceManufacturing(restored, ctx)
    expect(restored.warehouse.items[product]).toBe(50)
  })
  it('永久图纸学习后两次开工共交付200架，不重复耗书', () => {
    const { state } = world(permanent)
    expect(learnBlueprint(state, ctx, permanent).ok).toBe(true)
    for (let i = 0; i < 2; i++) {
      expect(startManufacturing(state, permanent, 'pilot', ctx).ok).toBe(true)
      state.gameMs = state.manufacturingRuns.find(row => row.active)!.finishAtGameMs
      advanceManufacturing(state, ctx)
    }
    expect(state.warehouse.items[product]).toBe(200)
    expect(state.blueprintStock[permanent] ?? 0).toBe(0)
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(restored.learnedRecipes).toContain(permanent)
    expect(restored.warehouse.items[product]).toBe(200)
  })
  it('新蓝图和新版插件说明英文未准备时回退中文，不使用旧机制说明', () => {
    const en = buildSimContext('en')
    for (const [id, nameId, descId] of [[once, 'bp.repairDrone.001', 'bp.repairDrone.003'], [permanent, 'bp.repairDrone.002', 'bp.repairDrone.004']]) {
      expect(en.blueprints.get(id!)!.name).toBe(l10nEntryText(L10N[nameId!]!, 'en'))
      expect(en.blueprints.get(id!)!.description).toBe(l10nEntryText(L10N[descId!]!, 'en'))
    }
    expect(en.modules.get('plug-alien-shield-coating')!.description).toBe(L10N['mod.factionPlug.008']!.zh)
    expect(en.modules.get('plug-titan-compression')!.description).toBe(L10N['mod.factionPlug.009']!.zh)
  })
})
