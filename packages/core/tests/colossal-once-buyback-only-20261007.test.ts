import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { buyAtMarket, ensureMarket, marketQuote, marketSellHolding, slowSupplyDraw } from '../src/market'
import { blackMarketBuy, blackMarketCandidateGoods } from '../src/blackMarket'
import { wormholeDilutionPoolOf } from '../src/wormholeSalvage'
import { DSI_FACTION_ID } from '../src/standing'

const ctx = buildSimContext()
const id = 'sbp-once-colossal'

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  state.wallet.isk = 1_000_000_000_000
  state.standings[DSI_FACTION_ID] = 100
  state.standingsEarned = { [DSI_FACTION_ID]: 100 }
  ensureMarket(state, ctx)
  return state
}

describe('皇带鱼一次性蓝图只收不卖', () => {
  it('市场供应关闭，定义、制造资格、掉落和出售通道保留', () => {
    const good = ctx.marketGoods.get(id)!
    expect(good.playerBuyable).toBe(false)
    expect(good.playerSellable).not.toBe(false)
    expect(ctx.shipBlueprints.get(id)?.singleUse).toBe(true)
    expect(ctx.shipBlueprints.get(id)?.shipId).toBe('sh-colossal')
    expect(wormholeDilutionPoolOf(ctx, 5)).toContain(id)
    expect(ctx.marketGoods.get('sbp-colossal')?.playerBuyable).not.toBe(false)
    const state = world()
    expect(buyAtMarket(state, ctx, id, 1).blocked).toBe('not-buyable')
    for (let i = 0; i < 100; i++) slowSupplyDraw(state, ctx, i * 600_000)
    expect(state.market.npcSell[id]).toEqual([])
  })

  it('旧档供应即撤下，收购簿、库存及玩家挂单不改，能实际售出', () => {
    const state = world()
    state.blueprintStock[id] = 2
    const buy = [{ price: 320_000_000, qty: 1, expiresAtGameMs: 1_000_000 }]
    state.market.npcBuy[id] = buy
    state.market.npcSell[id] = [{ price: 340_000_000, qty: 1, expiresAtGameMs: 1_000_000 }]
    const beforeOrders = structuredClone(state.orders)
    const quote = marketQuote(state, ctx, id)
    expect(quote.sellQty).toBe(0)
    expect(quote.sell).toBeUndefined()
    expect(state.market.npcBuy[id]).toEqual(buy)
    expect(state.blueprintStock[id]).toBe(2)
    expect(state.orders).toEqual(beforeOrders)
    const beforeWallet = state.wallet.isk
    expect(marketSellHolding(state, ctx, id, 1).sold).toBe(1)
    expect(state.blueprintStock[id]).toBe(1)
    expect(state.wallet.isk).toBeGreaterThan(beforeWallet)
  })

  it('黑市不再抽取，旧报价也拒购，不扣钱包或给图纸', () => {
    const state = world()
    const day = new Date(2026, 9, 7).getTime()
    const price = 320_000_000 * 30
    expect(blackMarketCandidateGoods(ctx).some(g => g.key === id)).toBe(false)
    state.blackMarket = { dayWallMs: day, offers: [{ goodKey: id, basePrice: 320_000_000, multiplier: 30, price, sold: false }] }
    const before = structuredClone(state)
    expect(blackMarketBuy(state, ctx, id, day, price, day + 1000).ok).toBe(false)
    expect(state).toEqual(before)
  })
})
