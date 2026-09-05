/**
 * 市价买卖边界回归（2026-09-05 船长报告“市价快速买卖可超出订单限制”的排查结论固化）：
 * ① 买入超量：实买 ≤ 卖盘总量，其余原样退回（钱不多扣）；
 * ② 卖出超量：实卖 ≤ 自然持有量（含刚买入入仓部分），不吃穿簿的余量自动挂限价单；
 * ③ 收购簿为空卖出：不得吞货——退还全部锁定库存、不产生挂单、返回明确错误。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, ensureMarket, marketQuote, addWare, buyAtMarket, marketSellHolding, countWare } from '../src/index'

describe('市价买卖边界（2026-09-05）', () => {
  const ctx = buildSimContext()

  function pickGood(): string {
    const g = [...ctx.marketGoods.values()].find((d) => d.kind === 'item' && d.playerSellable !== false)
    if (!g) throw new Error('无 item 商品')
    return g.key
  }

  it('买入超量：实买 = 卖盘总量，剩余未成交不回吞资金', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    ensureMarket(state, ctx)
    const key = pickGood()
    const q0 = marketQuote(state, ctx, key)
    const want = 1_000_000
    state.wallet.isk = 1e12
    const r = buyAtMarket(state, ctx, key, want)
    expect(r.bought + r.remaining).toBe(want)
    expect(r.bought).toBe(Math.min(want, q0.sellQty ?? 0))
    const q1 = marketQuote(state, ctx, key)
    expect((q1.sellQty ?? 0) + r.bought).toBe(q0.sellQty ?? 0)
    expect(state.wallet.isk).toBe(1e12 - r.total)
  })

  it('卖出超量：实卖 = 持有量（簿充足时一次吃尽、不足自动挂限价余量）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    ensureMarket(state, ctx)
    const key = pickGood()
    addWare(state, key, 100)
    const r = marketSellHolding(state, ctx, key, 1_000_000)
    expect(r.ok).toBe(true)
    expect(r.sold).toBe(100) // 不超出持有
    expect(countWare(state, key)).toBe(0)
  })

  it('收购簿为空卖出：拒绝并退还全部货物（不吞货、不产生无主 escrow）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2 })
    ensureMarket(state, ctx)
    const key = pickGood()
    state.market.npcBuy[key] = [] // 清空收购簿
    addWare(state, key, 5)
    const r = marketSellHolding(state, ctx, key, 5)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('收购簿为空')
    expect(countWare(state, key)).toBe(5) // 货物退回
    expect(state.escrowItems[key] ?? 0).toBe(0) // 无残留锁定
  })
})
