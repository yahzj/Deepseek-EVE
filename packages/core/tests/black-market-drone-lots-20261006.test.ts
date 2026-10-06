import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState, type BlackMarketOffer } from '../src/state'
import { blackMarketBuy, blackMarketCandidateGoods, blackMarketDayStart, blackMarketNextRefresh, ensureBlackMarket, normalizeBlackMarket, blackMarketOfferQuantity, blackMarketLotQuantity } from '../src/blackMarket'
import { naturalHoldings } from '../src/market'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const base = buildSimContext()
const now = new Date(2026, 9, 6, 12).getTime()
const DRONES = ['drone-exile-bee', 'drone-wh-c-heavy', 'drone-wh-e-sentry', 'drone-ink-heavy']
function world(id = DRONES[0]!) {
  const good = base.marketGoods.get(id)!
  const ctx = { ...base, marketGoods: new Map([[id, good]]) }
  const state = createInitialState({ nowWallMs: now, seed: 42 })
  state.standingsEarned = { dsi: 100 }
  state.wallet.isk = 1e14
  expect(ensureBlackMarket(state, ctx, now)).toBe(true)
  return { state, ctx, good, offer: state.blackMarket!.offers[0]! }
}

describe('黑市无人机组货', () => {
  it.each(DRONES)('%s新上架50架、组总价按单架倍率计算；一次交付/扣款/售罄', id => {
    const { state, ctx, good, offer } = world(id)
    expect(offer).toMatchObject({ quantity: 50, basePrice: good.basePrice, sold: false })
    expect(offer.multiplier).toBeGreaterThanOrEqual(30)
    expect(offer.multiplier).toBeLessThanOrEqual(100)
    expect(offer.price).toBe(good.basePrice * offer.multiplier * 50)
    const owned = naturalHoldings(state, good), money = state.wallet.isk, market = structuredClone(state.market), rng = { ...state.rng }
    expect(blackMarketBuy(state, ctx, id, state.blackMarket!.dayWallMs, offer.price, now).ok).toBe(true)
    expect(naturalHoldings(state, good)).toBe(owned + 50)
    expect(state.wallet.isk).toBe(money - offer.price)
    expect(offer.sold).toBe(true)
    expect(state.market).toEqual(market)
    expect(state.rng).toEqual(rng)
    const log = state.logs[state.logs.length - 1]!
    expect(log.textId).toBe('core.blackMarket.008')
    expect(log.textParams!.p3).toBe(50)
    expect(log.text).toContain('×50')
    expect(blackMarketBuy(state, ctx, id, state.blackMarket!.dayWallMs, offer.price, now).errorId).toBe('core.blackMarket.003')
    expect(naturalHoldings(state, good)).toBe(owned + 50)
    expect(state.wallet.isk).toBe(money - offer.price)
  })
  it.each(['bp-lair-g-drone', 'mod-lair-drone-tac-g', 'blackbox-h', 'core-alpha', 'sh-wh-a-cruiser'])('%s仍一件，名字含无人机不视为成品组货', id => {
    const { state, ctx, good, offer } = world(id)
    expect(offer.quantity ?? 1).toBe(1)
    expect(offer.price).toBe(good.basePrice * offer.multiplier)
    const quantity = () => good.kind === 'ship' ? Object.values(state.fleet).filter(s => s.defId === good.refId).length : naturalHoldings(state, good)
    const before = quantity()
    expect(blackMarketBuy(state, ctx, id, state.blackMarket!.dayWallMs, offer.price, now).ok).toBe(true)
    expect(quantity()).toBe(before + 1)
  })
  it('旧当天单架保原价/数量，售罄不恢复；次日刷新才生成50架', () => {
    const { state, ctx, good } = world()
    const old = { goodKey: good.key, basePrice: good.basePrice, multiplier: 30, price: good.basePrice * 30, sold: false }
    state.blackMarket!.offers = [old]
    const before = structuredClone(state.blackMarket)
    const loaded = loadSaveFile(serializeSaveFile(state, now)).state
    expect(loaded.blackMarket).toEqual(before)
    expect(ensureBlackMarket(loaded, ctx, now + 1000)).toBe(false)
    expect(blackMarketBuy(loaded, ctx, good.key, loaded.blackMarket!.dayWallMs, old.price, now).ok).toBe(true)
    expect(naturalHoldings(loaded, good)).toBe(1)
    const sold = loadSaveFile(serializeSaveFile(loaded, now)).state
    expect(ensureBlackMarket(sold, ctx, now)).toBe(false)
    expect(sold.blackMarket!.offers[0]!.sold).toBe(true)
    const wallet = sold.wallet.isk, quantity = naturalHoldings(sold, good)
    const next = blackMarketNextRefresh(sold)
    expect(ensureBlackMarket(sold, ctx, next)).toBe(true)
    expect(sold.blackMarket!.offers[0]).toMatchObject({ quantity: 50, sold: false })
    expect(sold.blackMarket!.offers[0]!.price).toBe(good.basePrice * sold.blackMarket!.offers[0]!.multiplier * 50)
    expect(sold.wallet.isk).toBe(wallet)
    expect(naturalHoldings(sold, good)).toBe(quantity)
  })
  it('组数量/总价/售罄往返不丢失，改目录基价不重报当天价格', () => {
    const { state, ctx, good } = world()
    const before = structuredClone(state.blackMarket)
    const loaded = loadSaveFile(serializeSaveFile(state, now)).state
    expect(loaded.blackMarket).toEqual(before)
    const edited = { ...ctx, marketGoods: new Map([[good.key, { ...good, basePrice: good.basePrice * 2 }]]) }
    expect(ensureBlackMarket(loaded, edited, now)).toBe(false)
    const offer = loaded.blackMarket!.offers[0]!
    expect(blackMarketBuy(loaded, edited, good.key, loaded.blackMarket!.dayWallMs, offer.price, now).ok).toBe(true)
    expect(naturalHoldings(loaded, good)).toBe(50)
    expect(loadSaveFile(serializeSaveFile(loaded, now)).state.blackMarket!.offers[0]).toEqual({ ...offer, sold: true })
  })
  it.each([0, -1, 2, 49, 51, 1.5, NaN, Infinity, '50', null])('无效数量%s丢条但不重抽、不恢复库存', quantity => {
    const { state, ctx, offer } = world()
    const raw = { dayWallMs: state.blackMarket!.dayWallMs, offers: [{ ...offer, quantity }] }
    const clean = normalizeBlackMarket(raw)!
    expect(clean.offers).toEqual([])
    state.blackMarket = clean
    expect(ensureBlackMarket(state, ctx, now)).toBe(false)
    expect(state.blackMarket.offers).toEqual([])
  })
  it('损坏总价/危险整数拒绝，非无人机商品不能通过数量50批量复制', () => {
    const { state, ctx, offer } = world('blackbox-h')
    const forged = { ...offer, quantity: 50, price: offer.price * 50 } as BlackMarketOffer
    state.blackMarket!.offers = [forged]
    const before = JSON.stringify(state)
    expect(blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket!.dayWallMs, forged.price, now).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    expect(normalizeBlackMarket({ dayWallMs: blackMarketDayStart(now), offers: [{ ...forged, price: 1 }] })!.offers).toEqual([])
    const overflow = world()
    const huge = { ...overflow.good, basePrice: Math.floor(Number.MAX_SAFE_INTEGER / 100) }
    expect(blackMarketCandidateGoods({ ...overflow.ctx, marketGoods: new Map([[huge.key, huge]]) })).toEqual([])
  })
  it.each(['money', 'location', 'sold', 'quote', 'day'])('%s失败不扣款或交付半组', reason => {
    const { state, ctx, offer, good } = world()
    if (reason === 'money') state.wallet.isk = offer.price - 1
    if (reason === 'location') state.awayGalaxy = 'galaxy-redring'
    if (reason === 'sold') offer.sold = true
    const before = JSON.stringify(state)
    expect(blackMarketBuy(state, ctx, good.key, state.blackMarket!.dayWallMs + (reason === 'day' ? 1 : 0), offer.price + (reason === 'quote' ? 1 : 0), now).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
  })
  it('组数生成不增加随机抽签；中英新文案齐备，不改历史单架日志', () => {
    const a = world(), b = world()
    expect(a.state.blackMarket).toEqual(b.state.blackMarket)
    for (const id of ['ui.blackMarket.025', 'ui.blackMarket.026', 'core.blackMarket.008']) {
      expect(L10N[id]!.zh).toBeTruthy()
      expect(L10N[id]!.en).toBeTruthy()
    }
    expect(L10N['core.blackMarket.007']!.zh).toContain('×1')
  })
  it('旧确认数量不能购买已变化的报价数量；显式单件兼容且坏值不降级', () => {
    const { state, ctx, offer } = world()
    const before = JSON.stringify(state)
    expect(blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket!.dayWallMs, offer.price, now, 1).errorId).toBe('core.blackMarket.002')
    expect(JSON.stringify(state)).toBe(before)
    expect(blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket!.dayWallMs, offer.price, now, 50).ok).toBe(true)
    expect(blackMarketOfferQuantity({ quantity: 1 })).toBe(1)
    expect(blackMarketOfferQuantity({})).toBe(1)
    expect(blackMarketOfferQuantity({ quantity: -1 })).toBe(0)
  })
  it('所有候选成品组数只取物品kind，普通市场定义与无关货号不改', () => {
    expect(blackMarketCandidateGoods(base).filter(g => blackMarketLotQuantity(base, g) === 50).map(g => g.key).sort()).toEqual([...DRONES].sort())
    for (const id of ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry']) {
      const good = base.marketGoods.get(id)!
      expect(good.playerBuyable).not.toBe(false)
      expect(good.basePrice).toBe(base.items.get(id)!.baseSellPriceIsk)
    }
  })
})
