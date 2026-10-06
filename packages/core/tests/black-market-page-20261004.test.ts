import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { BlackMarketState } from '../src/state'
import { blackMarketUnlocked, blackMarketCandidateGoods, ensureBlackMarket, blackMarketBuy, blackMarketNextRefresh, normalizeBlackMarket, blackMarketOfferQuantity } from '../src/blackMarket'
import { serializeSaveFile, loadSaveFile } from '../src/save'
import { buyAtMarket } from '../src/market'
import { naturalHoldings } from '../src/market'

const ctx = buildSimContext()
const now = new Date(2026, 9, 4, 12).getTime()
function world(earned = 100) {
  const state = createInitialState({ nowWallMs: now, seed: 42 })
  state.standingsEarned = { dsi: earned }
  state.standings.dsi = 0
  state.wallet.isk = 1e14
  ensureBlackMarket(state, ctx, now)
  return state
}

describe('独立黑市日板候选与报价', () => {
  it('所有候选数字R4/R5，已上线、已解析、基价有效；只收不卖必须明确白名单', () => {
    const goods = blackMarketCandidateGoods(ctx)
    expect(goods.length).toBeGreaterThan(9)
    for (const g of goods) {
      expect(g.rarityTier!).toBeGreaterThanOrEqual(4)
      expect(g.unreleased).not.toBe(true)
      expect(g.basePrice).toBeGreaterThan(0)
      if (g.playerBuyable === false) expect(g.blackMarketBuyable).toBe(true)
    }
    expect(goods.some((g) => g.refId === 'alpha')).toBe(true)
    expect(goods.some((g) => g.refId === 'mod-shieldfield-3')).toBe(true)
    const extra = { ...goods[0]!, key: 'forbidden', playerBuyable: false, blackMarketBuyable: false }
    expect(blackMarketCandidateGoods({ ...ctx, marketGoods: new Map([[extra.key, extra]]) })).toEqual([])
  })
  it('99未解锁，100且余额0解锁，9个不重复至少3个白名单货；价格30~100倍', () => {
    expect(world(99).blackMarket).toBeUndefined()
    const state = world()
    expect(blackMarketUnlocked(state)).toBe(true)
    const offers = state.blackMarket!.offers
    expect(offers).toHaveLength(9)
    expect(new Set(offers.map((o) => o.goodKey)).size).toBe(9)
    expect(offers.filter((o) => ctx.marketGoods.get(o.goodKey)!.playerBuyable === false).length).toBeGreaterThanOrEqual(3)
    for (const o of offers) {
      expect(o.multiplier).toBeGreaterThanOrEqual(30)
      expect(o.multiplier).toBeLessThanOrEqual(100)
      expect(o.price).toBe(o.basePrice * o.multiplier * blackMarketOfferQuantity(o))
      expect(o.sold).toBe(false)
    }
  })
  it('同日重复进入/读档不重抽不恢复库存；主rng不受日板影响', () => {
    const state = world(), rng = { ...state.rng }
    state.blackMarket!.offers[0]!.sold = true
    const before = structuredClone(state.blackMarket)
    expect(ensureBlackMarket(state, ctx, now + 60000)).toBe(false)
    const back = loadSaveFile(serializeSaveFile(state, now)).state
    expect(back.blackMarket).toEqual(before)
    ensureBlackMarket(back, ctx, now + 60000)
    expect(back.blackMarket).toEqual(before)
    expect(back.rng).toEqual(rng)
    const next = blackMarketNextRefresh(state)
    expect(ensureBlackMarket(state, ctx, next + 1)).toBe(true)
    expect(state.blackMarket!.offers.every((o) => !o.sold)).toBe(true)
    expect(state.rng).toEqual(rng)
    const nextBoard = structuredClone(state.blackMarket)
    expect(ensureBlackMarket(state, ctx, now)).toBe(false)
    expect(state.blackMarket).toEqual(nextBoard)
  })
  it('离线跨多日只生成当前货架，独立种子同档同日一致，候选不足不补重复', () => {
    const a = world(), b = world()
    expect(a.blackMarket).toEqual(b.blackMarket)
    const later = new Date(2026, 9, 10, 12).getTime()
    ensureBlackMarket(a, ctx, later)
    ensureBlackMarket(b, ctx, later)
    expect(a.blackMarket).toEqual(b.blackMarket)
    const only = blackMarketCandidateGoods(ctx)[0]!
    const sparse = world()
    delete sparse.blackMarket
    ensureBlackMarket(sparse, { ...ctx, marketGoods: new Map([[only.key, only]]) }, now)
    expect(sparse.blackMarket!.offers).toHaveLength(1)
  })
  it('保存日界回拨不重抽，下次边界按本地日历午夜计算', () => {
    const state = world()
    expect(new Date(blackMarketNextRefresh(state)).getHours()).toBe(0)
    const before = structuredClone(state.blackMarket)
    // 保存的日界大于当前本地日界时，只保留旧货架，不把时区/回拨当新一天。
    state.blackMarket!.dayWallMs += 3600000
    const moved = structuredClone(state.blackMarket)
    ensureBlackMarket(state, ctx, now)
    expect(state.blackMarket).toEqual(moved)
    expect(before!.offers).toEqual(moved!.offers)
  })
  it('不可解析墙钟不建立无效日板，数字稀有度边界拒绝R3', () => {
    const state = world()
    delete state.blackMarket
    for (const time of [NaN, Infinity, -1, 1e20]) expect(ensureBlackMarket(state, ctx, time)).toBe(false)
    expect(state.blackMarket).toBeUndefined()
    const good = blackMarketCandidateGoods(ctx)[0]!
    const rows = [3, 4, 5].map((rarityTier) => ({ ...good, key: `r${rarityTier}`, rarityTier: rarityTier as 3 | 4 | 5 }))
    expect(blackMarketCandidateGoods({ ...ctx, marketGoods: new Map(rows.map((g) => [g.key, g])) }).map((g) => g.key)).toEqual(['r4', 'r5'])
  })
})

describe('黑市购买守恒与渠道隔离', () => {
  it.each(['mining', 'salvaging', 'hauling', 'expedition', 'standby', 'transit'] as const)('%s旧位置字段仍为空时也不能在途购买', (activity) => {
    const state = world()
    state[activity].active = true
    const offer = state.blackMarket!.offers[0]!
    const before = JSON.stringify(state)
    expect(blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket!.dayWallMs, offer.price, now).errorId).toBe('core.blackMarket.005')
    expect(JSON.stringify(state)).toBe(before)
  })
  it('已建成副站能买，未建成工地不能买；后台AI不占购买地点', () => {
    const state = world(), site = [...ctx.stations.values()][0]!
    state.dockedSite = site.id
    state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    const offer = state.blackMarket!.offers[0]!
    expect(blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket!.dayWallMs, offer.price, now).ok).toBe(true)
    state.stationSites[site.id]!.stage = 0
    const next = state.blackMarket!.offers[1]!
    expect(blackMarketBuy(state, ctx, next.goodKey, state.blackMarket!.dayWallMs, next.price, now).errorId).toBe('core.blackMarket.005')
  })
  it.each(['item','module','blueprint','ship','aicore'] as const)('%s正确入账、扣全款、不入普通簿，重复买失败', (kind) => {
    const state = world()
    const good = blackMarketCandidateGoods(ctx).find((g) => g.kind === kind)!
    expect(good).toBeDefined()
    const price = good.basePrice * 50
    const day = state.blackMarket!.dayWallMs
    state.blackMarket!.offers = [{ goodKey: good.key, basePrice: good.basePrice, multiplier: 50, price, sold: false }]
    const quantity = () => kind === 'ship' ? Object.values(state.fleet).filter((s) => s.defId === good.refId).length : naturalHoldings(state, good)
    const before = quantity(), money = state.wallet.isk, market = JSON.stringify(state.market), rng = { ...state.rng }
    expect(blackMarketBuy(state, ctx, good.key, day, price, now).ok).toBe(true)
    expect(quantity()).toBe(before + 1)
    expect(state.wallet.isk).toBe(money - price)
    expect(state.blackMarket!.offers[0]!.sold).toBe(true)
    expect(state.rng).toEqual(rng)
    expect(JSON.stringify(state.market)).toBe(market)
    expect(blackMarketBuy(state, ctx, good.key, day, price, now).errorId).toBe('core.blackMarket.003')
    expect(state.wallet.isk).toBe(money - price)
    if (kind === 'blueprint') expect(state.learnedRecipes).not.toContain(good.refId)
    if (kind === 'aicore') expect(state.warehouse.items[good.refId]).toBeUndefined()
  })
  it('普通市场依旧拒绝白名单只收不卖货，黑市才可买', () => {
    const state = world()
    const good = blackMarketCandidateGoods(ctx).find((g) => g.playerBuyable === false)!
    expect(buyAtMarket(state, ctx, good.key, 1).blocked).toBe('not-buyable')
  })
  it.each(['money','location','lock','quote','invalid','sold'] as const)('%s失败不扣款或库存', (reason) => {
    const state = world()
    const offer = state.blackMarket!.offers[0]!
    const day = state.blackMarket!.dayWallMs
    if (reason === 'money') state.wallet.isk = 0
    if (reason === 'location') state.awayGalaxy = 'galaxy-redring'
    if (reason === 'lock') state.standingsEarned!.dsi = 99
    if (reason === 'invalid') offer.multiplier = 2
    if (reason === 'sold') offer.sold = true
    const before = JSON.stringify(state)
    const result = blackMarketBuy(state, ctx, offer.goodKey, day, reason === 'quote' ? offer.price + 1 : offer.price, now)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
  })
  it('旧日确认不能买到新架，跨界只更新日板，钱包库存不动', () => {
    const state = world(), old = { ...state.blackMarket!.offers[0]! }, day = state.blackMarket!.dayWallMs
    const wallet = state.wallet.isk, warehouse = JSON.stringify([state.warehouse, state.moduleBay, state.fleet, state.aiCores])
    expect(blackMarketBuy(state, ctx, old.goodKey, day, old.price, blackMarketNextRefresh(state) + 1).errorId).toBe('core.blackMarket.002')
    expect(state.wallet.isk).toBe(wallet)
    expect(JSON.stringify([state.warehouse, state.moduleBay, state.fleet, state.aiCores])).toBe(warehouse)
  })
})

describe('黑市随档白名单', () => {
  it('缺失不强写空字段，破损条目不重抽、严格校价、截断去重', () => {
    const fresh = createInitialState({ nowWallMs: now, seed: 7 })
    expect(loadSaveFile(serializeSaveFile(fresh, now)).state.blackMarket).toBeUndefined()
    const state = world(), board = state.blackMarket!
    const keys: Record<keyof BlackMarketState, true> = { dayWallMs: true, offers: true }
    expect(keys.offers).toBe(true)
    expect(normalizeBlackMarket({ ...board, offers: [...board.offers, ...board.offers] })!.offers).toHaveLength(9)
    expect(normalizeBlackMarket({ ...board, offers: [{ ...board.offers[0], price: 1 }] })!.offers).toEqual([])
    const bad = { ...board, offers: [] }
    state.blackMarket = bad
    expect(ensureBlackMarket(state, ctx, now)).toBe(false)
    expect(state.blackMarket!.offers).toEqual([])
    for (const day of [-1, NaN, Infinity, 1e20]) expect(normalizeBlackMarket({ ...board, dayWallMs: day })).toBeUndefined()
  })
})
