import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, isSiteBuilt } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  billDeliveredOf, billNeedOf, billRemainingOf, deliverStationResources,
  stationBillView, tierFulfilled, tierRemaining,
} from '../src/station'
import { advanceTransit, cancelSiteDeliverTrip, startSiteDeliverTrip } from '../src/location'
import type { StationSiteDef } from '../src/types'
import { makeTestCtx } from './helpers'

function creditWorld(value = 21) {
  const site: StationSiteDef = {
    id: 'site-credit', name: '抵扣测试站', galaxyId: 'galaxy-far', standingReq: 0,
    tiers: [
      {
        name: '奠基', bill: [{ itemId: 'frame', count: 10 }, { itemId: 'plate', count: 10 }],
        legacyDeliveredCredit: { previousUnitValues: { old: value }, currentUnitValues: { frame: 10, plate: 15 } },
      },
      { name: '建成', bill: [{ itemId: 'frame', count: 2 }] },
    ], introDialogueId: null, doneDialogueId: null, description: '抵扣测试站',
  }
  const ctx = makeTestCtx({ stations: [site], quietEvents: true })
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  state.onboarding.step = 99
  state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
  state.debugQuick = true
  state.stationSites[site.id] = { stage: 0, delivered: { old: 1 } }
  return { state, ctx, site }
}

describe('2026-10-18副站材料价值与结构', () => {
  const ctx = buildSimContext()
  for (const [id, stageValues] of [
    ['site-redring', [2_000_000, 2_800_000, 3_200_000]],
    ['site-cinder', [10_000_000, 14_000_000, 16_000_000]],
  ] as const) {
    it(`${id}分档、80%零件及满级减料正确`, () => {
      const site = ctx.stations.get(id)!
      const state = createInitialState({ nowWallMs: 0, seed: 1 })
      let parts = 0
      const values = site.tiers.map(tier => tier.bill.reduce((sum, row) => {
        const item = ctx.items.get(row.itemId)!
        expect(item.kind === 'part' || row.itemId === 'min-tritanium').toBe(true)
        const value = row.count * (item.baseSellPriceIsk ?? 0)
        if (item.kind === 'part') {
          parts += value
          expect(row.count % 10).toBe(0)
          expect([...ctx.blueprints.values()].find(bp => bp.itemId === item.id)?.learnless).toBe(true)
        }
        return sum + value
      }, 0))
      expect(values).toEqual(stageValues)
      const total = values.reduce((a, b) => a + b, 0)
      expect(parts).toBe(total * 0.8)
      state.skills.trained['station-engineering'] = 5
      const discounted = site.tiers.reduce((sum, tier, index) => sum + tier.bill.reduce((v, row) =>
        v + billNeedOf(state, site, index, row.itemId) * (ctx.items.get(row.itemId)?.baseSellPriceIsk ?? 0), 0), 0)
      expect(discounted).toBe(total * 0.6)
      expect(site.tiers[id === 'site-redring' ? 1 : 0]!.bill.some(row => row.itemId === 'min-tritanium')).toBe(true)
    })
  }
  it('合计精确符合已确认的全站数量', () => {
    const red = ctx.stations.get('site-redring')!
    const totals: Record<string, number> = {}
    for (const tier of red.tiers) for (const row of tier.bill) totals[row.itemId] = (totals[row.itemId] ?? 0) + row.count
    expect(totals).toEqual({
      'min-tritanium': 200_000, 'part-frame': 12_000, 'part-armor-plate': 7_440,
      'part-cable': 6_000, 'part-circuit': 6_000, 'part-coolant': 6_000,
      'part-gyro': 1_000, 'part-lens': 1_000,
    })
    const cinder: Record<string, number> = {}
    for (const tier of ctx.stations.get('site-cinder')!.tiers) for (const row of tier.bill) cinder[row.itemId] = (cinder[row.itemId] ?? 0) + row.count
    expect(cinder).toEqual(Object.fromEntries(Object.entries(totals).map(([id, count]) => [id, count * 5])))
    expect(ctx.stations.size).toBe(2)
  })
})

describe('旧已交材料的本档需求抵扣', () => {
  it('已交旧料按原价抵扣，并将不足一件零头向玩家取整', () => {
    const { state, ctx, site } = creditWorld()
    const before = structuredClone(state)
    expect(billNeedOf(state, site, 0, 'frame')).toBe(7)
    expect(billNeedOf(state, site, 0, 'plate')).toBe(10)
    expect(stationBillView(state, ctx, site).map(r => r.remaining)).toEqual([7, 10])
    expect(tierRemaining(state, site)).toBe(17)
    expect(billNeedOf(state, site, 0, 'old')).toBe(0)
    expect(state).toEqual(before)
  })
  it('同名已交照实保留，抵扣分配到尚未交齐的项，不重复占额', () => {
    const { state, ctx, site } = creditWorld()
    state.stationSites[site.id]!.delivered.frame = 9
    expect(billNeedOf(state, site, 0, 'frame')).toBe(9)
    expect(billNeedOf(state, site, 0, 'plate')).toBe(9)
    expect(billDeliveredOf(state.stationSites[site.id]!, site, 0, 'frame')).toBe(9)
    state.awayGalaxy = 'galaxy-far'
    state.warehouse.items.plate = 100
    expect(deliverStationResources(state, ctx, site.id, 'plate', 100).ok).toBe(true)
    expect(state.warehouse.items.plate).toBe(91)
    expect(state.stationSites[site.id]).toEqual({ stage: 1, delivered: {} })
    expect(billNeedOf(state, site, 1, 'frame')).toBe(2)
  })
  it('减料先作用于新需求，旧实交货值不再减一次', () => {
    const { state, site } = creditWorld()
    state.skills.trained['station-engineering'] = 5
    expect(billNeedOf(state, site, 0, 'frame')).toBe(3)
    expect(billNeedOf(state, site, 0, 'plate')).toBe(6)
    expect(billRemainingOf(state, site, 0, 'frame')).toBe(3)
  })
  it('重载往返幂等，不写新随档字段，不将抵扣再发到钱包或仓库', () => {
    const { state, ctx, site } = creditWorld()
    const one = loadSaveFile(serializeSaveFile(state, 0)).state
    const two = loadSaveFile(serializeSaveFile(one, 0)).state
    expect(two.stationSites).toEqual(state.stationSites)
    expect(stationBillView(two, ctx, site)).toEqual(stationBillView(state, ctx, site))
    expect(two.wallet).toEqual(state.wallet)
    expect(two.warehouse).toEqual(state.warehouse)
  })
  it('未交旧矿物和未知材料不被抵扣，也不再接受新缴旧料', () => {
    const { state, ctx, site } = creditWorld()
    state.stationSites[site.id]!.delivered = { unknown: 1_000_000 }
    state.warehouse.items.old = 10
    state.awayGalaxy = 'galaxy-far'
    expect(billNeedOf(state, site, 0, 'frame')).toBe(10)
    expect(deliverStationResources(state, ctx, site.id, 'old', 10).ok).toBe(false)
    expect(state.warehouse.items.old).toBe(10)
  })
  it.each([NaN, Infinity, -1, 0, 1.5])('异常已交数量%j不制造抵扣', count => {
    const { state, site } = creditWorld()
    state.stationSites[site.id]!.delivered.old = count
    expect(billNeedOf(state, site, 0, 'frame')).toBe(10)
  })
  it('不改变已完成档、已建成站或未来档的需求', () => {
    const { state, site } = creditWorld(1_000)
    state.stationSites[site.id]!.stage = 1
    expect(billNeedOf(state, site, 0, 'frame')).toBe(10)
    expect(billNeedOf(state, site, 1, 'frame')).toBe(2)
    expect(state.stationSites[site.id]!.stage).toBe(1)
    state.stationSites[site.id]!.stage = 2
    expect(isSiteBuilt(state, site)).toBe(true)
    expect(tierRemaining(state, site)).toBe(0)
  })
  it('同名材料不同时抵扣金额和数量，累计已有物品覆盖后再抵扣', () => {
    const { state, site } = creditWorld()
    site.tiers[0]!.legacyDeliveredCredit!.previousUnitValues = { old: 21, frame: 10 }
    state.stationSites[site.id]!.delivered.frame = 2
    expect(billNeedOf(state, site, 0, 'frame')).toBe(7)
    expect(billRemainingOf(state, site, 0, 'frame')).toBe(5)
    expect(billNeedOf(state, site, 0, 'plate')).toBe(10)
  })
  it('抵扣足够时本档已满但不将旧料价值跨档使用', () => {
    const { state, site } = creditWorld(250)
    expect(tierFulfilled(state, site)).toBe(true)
    expect(tierRemaining(state, site)).toBe(0)
    expect(billNeedOf(state, site, 1, 'frame')).toBe(2)
  })
  it.each([
    ['frame', 'plate'], ['plate', 'frame'],
  ] as const)('分次先交%s再交%s，全部已交价值不重复抵扣', (first, second) => {
    const { state, ctx, site } = creditWorld()
    site.tiers = [site.tiers[0]!]
    state.awayGalaxy = 'galaxy-far'
    state.warehouse.items = { frame: 100, plate: 100 }
    for (const id of [first, second]) {
      while (!isSiteBuilt(state, site) && billRemainingOf(state, site, 0, id) > 0) {
        expect(deliverStationResources(state, ctx, site.id, id, 1).ok).toBe(true)
      }
    }
    expect(isSiteBuilt(state, site)).toBe(true)
    const paid = (100 - (state.warehouse.items.frame ?? 0)) * 10
      + (100 - (state.warehouse.items.plate ?? 0)) * 15
    expect(paid).toBe(220)
    expect(state.stationSites[site.id]!.delivered).toEqual({})
  })
  it.each([
    ['site-redring', 0, { 'min-pyerite': 1_500, 'min-mexallon': 442, 'part-frame': 8 }],
    ['site-redring', 1, { 'min-tritanium': 5_000, 'min-nocxium': 710, 'part-frame': 180 }],
    ['site-redring', 2, { 'min-isotope': 1_200, 'min-starcore': 510, 'part-frame': 490 }],
    ['site-cinder', 0, { 'min-tritanium': 1_750, 'min-pyerite': 1_000, 'part-frame': 400 }],
    ['site-cinder', 1, { 'min-nocxium': 1_550, 'min-mexallon': 2_000, 'min-isotope': 1_000, 'part-frame': 900 }],
    ['site-cinder', 2, { 'min-starcore': 2_000, 'min-darkiron': 1_797, 'part-frame': 1_092 }],
  ] as const)('%s档%d全部旧实交货值仍获保留', (id, stage, delivered) => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const site = ctx.stations.get(id)!
    state.stationSites[id] = { stage, delivered: { ...delivered } }
    const originalValue = Object.entries(delivered).reduce((sum, [itemId, n]) => sum + n * (ctx.items.get(itemId)?.baseSellPriceIsk ?? 0), 0)
    const payable = site.tiers[stage]!.bill.reduce((sum, row) => sum + billRemainingOf(state, site, stage, row.itemId) * (ctx.items.get(row.itemId)?.baseSellPriceIsk ?? 0), 0)
    const total = site.tiers[stage]!.bill.reduce((sum, row) => sum + row.count * (ctx.items.get(row.itemId)?.baseSellPriceIsk ?? 0), 0)
    expect(total - payable).toBeGreaterThanOrEqual(originalValue)
    expect(total - payable - originalValue).toBeLessThan(251)
    expect(state.stationSites[id]!.stage).toBe(stage)
  })
})

describe('抵扣后的实际交付与旧在途货物', () => {
  it.each([
    ['site-redring', 0], ['site-redring', 5],
    ['site-cinder', 0], ['site-cinder', 5],
  ] as const)('%s工程学%d：小货舱完整多趟运输能建成，后档材料不挤占本档', (id, level) => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.onboarding.step = 99
    state.debugQuick = true
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.skills.trained['station-engineering'] = level
    const ship = ctx.ships.get(state.fleet[state.shipId]!.defId!)!
    const smallCtx = { ...ctx, ships: new Map(ctx.ships) }
    smallCtx.ships.set(ship.id, { ...ship, cargoM3: 100 })
    const site = ctx.stations.get(id)!
    state.warehouse.items = {}
    for (const [index, tier] of site.tiers.entries()) for (const row of tier.bill) {
      state.warehouse.items[row.itemId] = (state.warehouse.items[row.itemId] ?? 0)
        + billNeedOf(state, site, index, row.itemId)
    }
    expect(startSiteDeliverTrip(state, smallCtx, id).ok).toBe(true)
    let arrivals = 0
    while (state.transit.active && arrivals++ < 700) {
      state.gameMs = state.transit.finishAtGameMs
      advanceTransit(state, smallCtx)
    }
    expect(isSiteBuilt(state, site), `运输抵达${arrivals}次后仍未建成`).toBe(true)
    expect(state.transit.active).toBe(false)
    expect(state.dockedSite).toBe(id)
    expect(state.fleet[state.shipId]!.cargo).toEqual({})
    expect(Object.values(state.warehouse.items).reduce((sum, n) => sum + n, 0)).toBe(0)
  })
  it('装船只装当前实际缺口和后续档，不多扣已抵扣物资', () => {
    const { state, ctx, site } = creditWorld()
    state.warehouse.items = { frame: 100, plate: 100 }
    expect(startSiteDeliverTrip(state, ctx, site.id).ok).toBe(true)
    expect(state.transit.delivery!.loaded).toEqual({ frame: 9, plate: 10 })
    expect(state.warehouse.items).toEqual({ frame: 91, plate: 90 })
    state.gameMs = state.transit.finishAtGameMs
    advanceTransit(state, ctx)
    expect(isSiteBuilt(state, site)).toBe(true)
    expect(state.dockedSite).toBe(site.id)
    expect(state.warehouse.items).toEqual({ frame: 91, plate: 90 })
  })
  it('仓库仅有本档已抵扣收齐、后档仍需要的物资时拒发，失败不改状态', () => {
    const { state, ctx, site } = creditWorld()
    state.stationSites[site.id]!.delivered.frame = 9
    state.warehouse.items = { frame: 100 }
    const before = structuredClone(state)
    expect(startSiteDeliverTrip(state, ctx, site.id).ok).toBe(false)
    expect(state).toEqual(before)
  })
  it('改价前已在途旧矿物不被消耗或变成抵扣，到港原物卸回', () => {
    const { state, ctx, site } = creditWorld()
    state.stationSites[site.id]!.delivered = {}
    state.fleet[state.shipId]!.cargo = { old: 12 }
    state.transit = { active: true, fromGalaxy: 'galaxy-hub', toGalaxy: 'galaxy-far', finishAtGameMs: 1000, legMs: 1000,
      delivery: { siteId: site.id, phase: 'to-site', loaded: { old: 12 } } }
    state.awayGalaxy = 'galaxy-hub'
    state.gameMs = 1000
    advanceTransit(state, ctx)
    expect(state.fleet[state.shipId]!.cargo.old).toBe(12)
    expect(state.stationSites[site.id]).toEqual({ stage: 0, delivered: {} })
    state.gameMs = state.transit.finishAtGameMs
    advanceTransit(state, ctx)
    expect(state.warehouse.items.old).toBe(12)
    expect(state.fleet[state.shipId]!.cargo.old).toBeUndefined()
    expect(state.transit.active).toBe(false)
  })
  it('旧在途混装只交新表可收材料，取消仍原物退回', () => {
    const { state, ctx, site } = creditWorld()
    state.fleet[state.shipId]!.cargo = { old: 12, frame: 2 }
    state.transit = { active: true, fromGalaxy: 'galaxy-hub', toGalaxy: 'galaxy-far', finishAtGameMs: 1000, legMs: 1000,
      delivery: { siteId: site.id, phase: 'to-site', loaded: { old: 12, frame: 2 } } }
    state.awayGalaxy = 'galaxy-hub'
    state.gameMs = 1000
    advanceTransit(state, ctx)
    expect(state.stationSites[site.id]!.delivered.frame).toBe(2)
    expect(state.stationSites[site.id]!.delivered.old).toBe(1)
    expect(cancelSiteDeliverTrip(state, ctx).ok).toBe(true)
    expect(state.warehouse.items.old).toBe(12)
    expect(state.warehouse.items.frame ?? 0).toBe(0)
  })
  it('新版料单与旧实交账实际往返，不把不再收取的旧材料重新装船', () => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.onboarding.step = 99
    state.debugQuick = true
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.stationSites['site-redring'] = {
      stage: 0, delivered: { 'min-pyerite': 1_500, 'min-mexallon': 442, 'part-frame': 8 },
    }
    state.warehouse.items = { 'min-pyerite': 1_000, 'min-mexallon': 500, 'part-frame': 20_000 }
    const site = ctx.stations.get('site-redring')!
    const expected = billRemainingOf(state, site, 0, 'part-frame')
    const cap = ctx.ships.get(state.fleet[state.shipId]!.defId!)!
    const bigCtx = { ...ctx, ships: new Map(ctx.ships) }
    bigCtx.ships.set(cap.id, { ...cap, cargoM3: 10_000 })
    expect(startSiteDeliverTrip(state, bigCtx, site.id).ok).toBe(true)
    expect(state.transit.delivery!.loaded).toEqual({ 'part-frame': expected })
    expect(state.warehouse.items['min-pyerite']).toBe(1_000)
    expect(state.warehouse.items['min-mexallon']).toBe(500)
    expect(state.warehouse.items['part-frame']).toBe(20_000 - expected)
    state.gameMs = state.transit.finishAtGameMs
    advanceTransit(state, bigCtx)
    expect(state.stationSites[site.id]!.delivered['part-frame']).toBe(7_814)
    expect(state.stationSites[site.id]!.delivered['min-pyerite']).toBe(1_500)
    expect(state.fleet[state.shipId]!.cargo['part-frame'] ?? 0).toBe(0)
    expect(state.stationSites[site.id]!.stage).toBe(0)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(stationBillView(loaded, bigCtx, site)).toEqual(stationBillView(state, bigCtx, site))
    expect(cancelSiteDeliverTrip(loaded, bigCtx).ok).toBe(true)
    expect(loaded.warehouse.items['part-frame']).toBe(20_000 - (7_814 - 8))
  })
})
