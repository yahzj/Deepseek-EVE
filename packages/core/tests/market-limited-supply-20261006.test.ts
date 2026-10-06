import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceMarket, buyAtMarket, ensureMarket, marketQuote, placeBuyOrder, sellAtMarket, cancelOrder } from '../src/market'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceLimitedSupply, hasLimitedSupply } from '../src/marketLimitedSupply'
import type { GameState, MarketPoolState } from '../src/state'

const KEY = 'min-voidcrystal'
const MINUTE = 60_000
function world(cap = 3000, every = 6 * MINUTE, units = 1) {
  const base = buildSimContext()
  const def = { ...base.marketGoods.get(KEY)!, limitedSupplyCap: cap, limitedSupplyEveryMs: every, limitedSupplyUnits: units }
  const ctx = { ...base, marketGoods: new Map([[KEY, def]]), balance: {
    ...base.balance, market: { ...base.balance.market, noiseStep: 0 },
  } }
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.wallet.isk = 1e12
  ensureMarket(state, ctx)
  return { state, ctx, def }
}
function stock(state: GameState) { return state.market.pools[KEY]!.limitedSupply! }
function quantity(state: GameState) { return (state.market.npcSell[KEY] ?? []).reduce((sum, order) => sum + order.qty, 0) }
function tick(w: ReturnType<typeof world>, ms: number) {
  w.state.gameMs += ms
  advanceMarket(w.state, ms, w.ctx)
}

describe('限额慢补货：存货/经济池分离与共用成交额度', () => {
  it('虚空晶正式配置、开盘三档合计3000而非每张3000，收购保持', () => {
    const real = buildSimContext().marketGoods.get(KEY)!
    expect([real.limitedSupplyCap, real.limitedSupplyEveryMs, real.limitedSupplyUnits]).toEqual([3000, 360000, 1])
    expect([real.poolTarget, real.supplyFlow, real.basePrice]).toEqual([48000, 13, 5400])
    const w = world()
    expect(quantity(w.state)).toBe(3000)
    expect(w.state.market.npcSell[KEY]!.map(o => o.qty)).toEqual([900, 1050, 1050])
    expect(w.state.market.npcBuy[KEY]!.reduce((n, o) => n + o.qty, 0)).toBe(29)
    expect(stock(w.state)).toEqual({ remaining: 3000, refillProgressMs: 0, lastRefillGameMs: 0 })
  })
  it('市价购买钱货守恒，买空后不能再次购买或重开市补满', () => {
    const w = world(), money = w.state.wallet.isk
    const result = buyAtMarket(w.state, w.ctx, KEY, 4000)
    expect(result.bought).toBe(3000)
    expect(result.remaining).toBe(1000)
    expect(w.state.wallet.isk).toBe(money - result.total)
    expect(w.state.warehouse.items[KEY]).toBe(3000)
    expect(stock(w.state).remaining).toBe(0)
    for (let i = 0; i < 5; i++) ensureMarket(w.state, w.ctx)
    expect(quantity(w.state)).toBe(0)
    expect(buyAtMarket(w.state, w.ctx, KEY, 1).blocked).toBe('no-stock')
  })
  it('5分钟不补，第6分钟补1枚，1小时10枚；订单寿命不额外刷货', () => {
    const w = world()
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    tick(w, 5 * MINUTE)
    expect(quantity(w.state)).toBe(0)
    tick(w, MINUTE)
    expect(quantity(w.state)).toBe(1)
    tick(w, 54 * MINUTE)
    expect(quantity(w.state)).toBe(10)
    expect(stock(w.state)).toMatchObject({ remaining: 10, refillProgressMs: 0 })
  })
  it('购买2000枚，一小时后1010枚；满额不积攒未来补货', () => {
    const w = world()
    tick(w, 24 * 60 * MINUTE)
    expect(quantity(w.state)).toBe(3000)
    buyAtMarket(w.state, w.ctx, KEY, 2000)
    tick(w, MINUTE)
    expect(stock(w.state).remaining).toBe(1000)
    tick(w, 59 * MINUTE)
    expect(quantity(w.state)).toBe(1010)
  })
  it('空额离线300小时补满，继续推进仍最多3000枚', () => {
    const w = world()
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    tick(w, 300 * 60 * MINUTE)
    expect(quantity(w.state)).toBe(3000)
    tick(w, 24 * 60 * MINUTE)
    expect(quantity(w.state)).toBe(3000)
  })
  it('剩余周期与零余额连续往返不丢，读档不重复发初始3000枚', () => {
    const w = world()
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    tick(w, 5 * MINUTE)
    for (let i = 0; i < 3; i++) {
      w.state = loadSaveFile(serializeSaveFile(w.state, 0)).state
      ensureMarket(w.state, w.ctx)
      expect(stock(w.state)).toMatchObject({ remaining: 0, refillProgressMs: 5 * MINUTE })
      expect(quantity(w.state)).toBe(0)
    }
    tick(w, MINUTE)
    expect(quantity(w.state)).toBe(1)
  })
  it('旧只收不卖档首次升级给3000枚，经济池不补满；后续读档不再赠送', () => {
    const w = world()
    const old = { ...w.def, playerBuyable: false, limitedSupplyCap: undefined, limitedSupplyEveryMs: undefined, limitedSupplyUnits: undefined }
    const legacy = createInitialState({ nowWallMs: 0, seed: 7 })
    ensureMarket(legacy, { ...w.ctx, marketGoods: new Map([[KEY, old]]) })
    legacy.market.pools[KEY]!.q = 123
    w.state = loadSaveFile(serializeSaveFile(legacy, 0)).state
    ensureMarket(w.state, w.ctx)
    expect(quantity(w.state)).toBe(3000)
    expect(w.state.market.pools[KEY]!.q).toBe(123)
    w.state.wallet.isk = 1e12
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    w.state = loadSaveFile(serializeSaveFile(w.state, 0)).state
    ensureMarket(w.state, w.ctx)
    expect(quantity(w.state)).toBe(0)
  })
  it('限价挂买单即时成交与市价共用3000；后续只成交每6分钟的1枚', () => {
    const w = world()
    const initial = w.state.wallet.isk
    const order = placeBuyOrder(w.state, w.ctx, KEY, 100000, 4000)!
    expect(order.filled).toBe(3000)
    expect(order.qty).toBe(1000)
    expect(buyAtMarket(w.state, w.ctx, KEY, 1).bought).toBe(0)
    tick(w, 60 * MINUTE)
    expect(order.filled).toBe(3010)
    expect(w.state.warehouse.items[KEY]).toBe(3010)
    expect(quantity(w.state)).toBe(0)
    const frozen = order.escrowIsk!
    const beforeCancel = w.state.wallet.isk
    expect(cancelOrder(w.state, w.ctx, order.id)).toBe(true)
    expect(w.state.wallet.isk).toBe(beforeCancel + frozen)
    expect(w.state.wallet.isk).toBeLessThan(initial)
  })
  it('拆成100笔限价单，持续抢单也只能获得3000+10枚/小时', () => {
    const w = world()
    for (let i = 0; i < 100; i++) placeBuyOrder(w.state, w.ctx, KEY, 100000, 100)
    expect(w.state.warehouse.items[KEY]).toBe(3000)
    tick(w, 60 * MINUTE)
    expect(w.state.warehouse.items[KEY]).toBe(3010)
    expect(quantity(w.state)).toBe(0)
  })
  it('强制巡游成功仍扣共享存货，不凭空供货或同时保留可售数量', () => {
    const w = world()
    w.ctx.balance.market.snatchBuyChance = 1
    w.ctx.balance.market.snatchBuyDecay = 0
    const order = placeBuyOrder(w.state, w.ctx, KEY, 1, 4000)!
    tick(w, MINUTE)
    expect(order.filled).toBe(1)
    expect(quantity(w.state)).toBe(2999)
    expect(stock(w.state).remaining).toBe(2999)
    stock(w.state).remaining = 0
    w.state.market.npcSell[KEY] = []
    tick(w, MINUTE)
    expect(order.filled).toBe(1)
  })
  it('经济池回归和玩家卖出不补额度，买空后仍可正常卖出', () => {
    const w = world()
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    const q = w.state.market.pools[KEY]!.q
    const sold = sellAtMarket(w.state, w.ctx, KEY, 10)
    expect(sold.sold).toBe(10)
    expect(stock(w.state).remaining).toBe(0)
    expect(w.state.market.pools[KEY]!.q).toBe(q + 10)
    tick(w, 30 * MINUTE)
    expect(stock(w.state).remaining).toBe(5)
  })
  it('铁人、抢购满技能及建站不改变限额和补货量', () => {
    const w = world()
    w.state.ironman = { on: true, seq: 1 }
    w.state.skills.trained['source-sweeping'] = 5
    for (const site of w.ctx.stations.values()) w.state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    tick(w, 60 * MINUTE)
    expect(quantity(w.state)).toBe(10)
  })
  it('配置可复用不同上限/周期/每次补量，无限额商品完全走旧供给', () => {
    const w = world(20, 2 * MINUTE, 3)
    buyAtMarket(w.state, w.ctx, KEY, 20)
    tick(w, 6 * MINUTE)
    expect(quantity(w.state)).toBe(9)
    const base = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = { ...base, marketGoods: new Map([['min-tritanium', base.marketGoods.get('min-tritanium')!]]) }
    ensureMarket(state, ctx)
    expect(state.market.pools['min-tritanium']!.limitedSupply).toBeUndefined()
    expect(marketQuote(state, ctx, 'min-tritanium').sellQty).toBe(Math.round(19890 * 0.8))
  })
  it('另一件无经济池的常驻商品只配置三项即可复用，单件补量不乘铁人倍率', () => {
    const w = world()
    const good = { ...w.def, key: 'drone-heavy', refId: 'drone-heavy', poolTarget: undefined,
      limitedSupplyCap: 7, limitedSupplyEveryMs: 3 * MINUTE, limitedSupplyUnits: 2 }
    const ctx = { ...w.ctx, marketGoods: new Map([[good.key, good]]) }
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.wallet.isk = 1e12
    ensureMarket(state, ctx)
    expect(marketQuote(state, ctx, good.key).sellQty).toBe(7)
    expect(buyAtMarket(state, ctx, good.key, 7).bought).toBe(7)
    state.gameMs += 3 * MINUTE
    advanceMarket(state, 3 * MINUTE, ctx)
    expect(marketQuote(state, ctx, good.key).sellQty).toBe(2)
  })
  it('在线逐窗和离线大推进一致，补货余量不因进出页面或换站变化', () => {
    const a = world(), b = world()
    buyAtMarket(a.state, a.ctx, KEY, 3000)
    buyAtMarket(b.state, b.ctx, KEY, 3000)
    for (let i = 0; i < 65; i++) {
      tick(a, MINUTE)
      a.state.dockedSite = i % 2 === 0 ? 'site-redring' : null
      ensureMarket(a.state, a.ctx)
    }
    tick(b, 65 * MINUTE)
    expect(a.state.market).toEqual(b.state.market)
    expect(stock(a.state)).toMatchObject({ remaining: 10, refillProgressMs: 5 * MINUTE })
  })
  it('钱包不足不扣出售额度，存档坏账保留为空而非反复获赠', () => {
    const w = world()
    w.state.wallet.isk = 0
    expect(buyAtMarket(w.state, w.ctx, KEY, 1).blocked).toBe('insufficient-isk')
    expect(stock(w.state).remaining).toBe(3000)
    const raw = JSON.parse(serializeSaveFile(w.state, 0))
    raw.state.market.pools[KEY].limitedSupply = { remaining: -1, refillProgressMs: 'broken' }
    w.state = loadSaveFile(JSON.stringify(raw)).state
    ensureMarket(w.state, w.ctx)
    expect(stock(w.state)).toMatchObject({ remaining: 0, refillProgressMs: 0 })
    expect(quantity(w.state)).toBe(0)
  })
  it('缺失/损坏供应簿只重铺余额；经济池耗尽也不能切到普通透支供货', () => {
    const w = world()
    buyAtMarket(w.state, w.ctx, KEY, 2500)
    w.state.market.pools[KEY]!.q = 0
    w.state.market.npcSell[KEY] = [{ price: 1, qty: 99999, expiresAtGameMs: 1e12 }]
    ensureMarket(w.state, w.ctx)
    expect(quantity(w.state)).toBe(500)
    expect(buyAtMarket(w.state, w.ctx, KEY, 1000).bought).toBe(500)
    tick(w, MINUTE)
    expect(quantity(w.state)).toBe(0)
  })
  it('满额清进度与整数周期小数结余守恒，非法配置不启用', () => {
    const w = world(20, 1000, 3)
    const pool: MarketPoolState = { q: 0, shock: 0, noise: 0, netVol: 0, lastHistoryGameMs: 0, limitedSupply: { remaining: 0, refillProgressMs: 0 } }
    advanceLimitedSupply(pool, w.def, 2500)
    expect(pool.limitedSupply).toMatchObject({ remaining: 6, refillProgressMs: 500 })
    advanceLimitedSupply(pool, w.def, 100000)
    expect(pool.limitedSupply).toMatchObject({ remaining: 20, refillProgressMs: 0 })
    expect(hasLimitedSupply({ ...w.def, rarity: 'rare' })).toBe(false)
    expect(hasLimitedSupply({ ...w.def, limitedSupplyEveryMs: 0 })).toBe(false)
  })
  it('分钟末首次买货不借用成交前时间，至少等满6分钟后才在窗口补货', () => {
    const w = world()
    w.state.gameMs = 59000
    buyAtMarket(w.state, w.ctx, KEY, 3000)
    tick(w, 301000)
    expect(quantity(w.state)).toBe(0)
    tick(w, MINUTE)
    expect(quantity(w.state)).toBe(1)
    expect(stock(w.state).refillProgressMs).toBe(1000)
  })
})
