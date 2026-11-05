import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { PLAYER_ONLY_GOODS } from '../../data/src/market/playerGoods'
import { SHIP_PLUGS, isFactionPlugId } from '../../data/src/plugs'
import { encryptedBlueprintGroups } from '../src/encryptedContainer'
import { createInitialState } from '../src/state'
import { ensureMarket, advanceMarket, marketTradingGoods, listSellHolding, cancelOrder, placeBuyOrder, buyAtMarket,
  naturalHoldings, prepareMarketRelayRequest, applyMarketRelayResponse, loadSaveFile, serializeSaveFile } from '../src/index'
import { depositGood } from '../src/market/stock'
import { MARKET_RELAY_POLICY } from '../src/market/relayTypes'
import type { MarketRelayOffer } from '../src/market/relayTypes'
import { handMarketKeyOf } from '../../../apps/desktop/src/renderer/src/ui/marketJump'

const ctx = buildSimContext()
const scope = 'exclusive-market-scope'
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 20261105 })
  state.wallet.isk = 100_000_000
  ensureMarket(state, ctx)
  return state
}

describe('独占产物仅开放玩家交易', () => {
  it('22件插件、20张势力图纸和5种加密柜有唯一可见目录，采用有效参考基价', () => {
    expect(PLAYER_ONLY_GOODS).toHaveLength(47)
    expect(PLAYER_ONLY_GOODS.filter(good => good.kind === 'module')).toHaveLength(22)
    expect(PLAYER_ONLY_GOODS.filter(good => good.kind === 'blueprint')).toHaveLength(20)
    expect(PLAYER_ONLY_GOODS.filter(good => good.kind === 'item')).toHaveLength(5)
    for (const good of PLAYER_ONLY_GOODS) {
      expect(marketTradingGoods(ctx).filter(row => row.key === good.key)).toEqual([ctx.marketGoods.get(good.key)])
      expect(Number.isSafeInteger(good.basePrice) && good.basePrice > 0).toBe(true)
      expect(ctx.marketGoods.get(good.key)).toMatchObject({ basePrice: good.basePrice, playerBuyable: false, playerSellable: false, blackMarketBuyable: false })
      expect(handMarketKeyOf(ctx, good.kind === 'module' ? 'modules' : good.kind === 'item' ? 'items' : 'blueprints', good.refId)).toBe(good.key)
    }
  })

  it('所有插件成品按原始配方材料价值十倍、势力插件两种图纸均为一亿', () => {
    for (const mod of SHIP_PLUGS) {
      const bp = ctx.blueprints.get(`bp-${mod.id}`)!
      const materialValue = bp.materials.reduce((sum, mat) => sum + mat.count * ctx.items.get(mat.itemId)!.baseSellPriceIsk, 0)
      expect(materialValue).toBe(11_174_500)
      expect(ctx.marketGoods.get(mod.id)?.basePrice).toBe(materialValue * 10)
      if (isFactionPlugId(mod.id)) for (const id of [bp.id, `bp-once-${mod.id}`]) {
        expect(ctx.blueprints.get(id)?.priceIsk).toBe(100_000_000)
        expect(ctx.marketGoods.get(id)?.basePrice).toBe(100_000_000)
      }
    }
  })

  it.each([
    ['A', 21_164_234], ['C', 21_095_687], ['D', 21_959_260], ['E', 21_386_820], ['G', 21_415_210],
  ] as const)('%s柜按类别等权、平均两张的整柜期望乘30%%，最终才向上取整', (family, price) => {
    const groups = encryptedBlueprintGroups(ctx, family)!
    const sums = groups.map(group => group.reduce((sum, id) => sum + (ctx.blueprints.get(id) ?? ctx.shipBlueprints.get(id))!.priceIsk, 0))
    // 三类成员数均整除6：用整数分数独立核算，避免测试复制浮点实现。
    const weightedSixths = sums.reduce((sum, value, index) => sum + value * (6 / groups[index]!.length), 0)
    expect(Math.ceil(weightedSixths / 30)).toBe(price)
    expect(ctx.marketGoods.get(`box-encrypted-${family.toLowerCase()}`)?.basePrice).toBe(price)
  })

  it.each(SHIP_PLUGS.filter(mod => !isFactionPlugId(mod.id)))('$id非势力蓝图退出市场，保留配方并幂等退回旧挂单托管', mod => {
    const key = `bp-${mod.id}`
    const state = world()
    expect(ctx.blueprints.has(key)).toBe(true)
    expect(ctx.marketGoods.has(key)).toBe(false)
    expect(handMarketKeyOf(ctx, 'blueprints', key)).toBeNull()
    state.blueprintStock[key] = 3
    const before = state.wallet.isk
    state.orders.push({ id: 9001, good: key, side: 'sell', price: 2_000_000, qty: 2, filled: 1, placedAtGameMs: 0 },
      { id: 9002, good: key, side: 'buy', price: 1_000_000, qty: 2, filled: 0, escrowIsk: 2_000_000, placedAtGameMs: 0 })
    state.escrowItems[key] = 2
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    ensureMarket(restored, ctx)
    ensureMarket(restored, ctx)
    expect(restored.orders).toEqual([])
    expect(restored.blueprintStock[key]).toBe(5)
    expect(restored.escrowItems[key]).toBe(0)
    expect(restored.wallet.isk).toBe(before + 2_000_000)
    expect(listSellHolding(restored, ctx, key, 1_000_000, 1).ok).toBe(false)
    expect(placeBuyOrder(restored, ctx, key, 1_000_000, 1)).toBeNull()
    expect(prepareMarketRelayRequest(restored, ctx, scope, { saveId: 'save', requestId: 'removed', orderId: () => 'owner' })!.orders).toEqual([])
  })

  it('无NPC货源的参考价格不改变原有市场随机序列', () => {
    const keys = new Set(PLAYER_ONLY_GOODS.map(good => good.key))
    const reduced = { ...ctx, marketGoods: new Map([...ctx.marketGoods].filter(([key]) => !keys.has(key))) }
    const current = createInitialState({ nowWallMs: 0, seed: 51 })
    const baseline = structuredClone(current)
    ensureMarket(current, ctx)
    ensureMarket(baseline, reduced)
    current.gameMs = baseline.gameMs = 3_600_000
    advanceMarket(current, 3_600_000, ctx)
    advanceMarket(baseline, 3_600_000, reduced)
    expect(current.rng).toEqual(baseline.rng)
    for (const key of reduced.marketGoods.keys()) {
      expect(current.market.npcBuy[key]).toEqual(baseline.market.npcBuy[key])
      expect(current.market.npcSell[key]).toEqual(baseline.market.npcSell[key])
    }
  })

  it.each(PLAYER_ONLY_GOODS)('$key真实托管、保存与撤单回到正确库存，买单预扣可退回', good => {
    let state = world()
    depositGood(state, ctx, good.key, 2)
    const sell = listSellHolding(state, ctx, good.key, 2_000_000, 2)
    expect(sell).toMatchObject({ ok: true, filled: 0, resting: 2 })
    expect(naturalHoldings(state, good)).toBe(0)
    expect(state.escrowItems[good.key]).toBe(2)
    state = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(state.orders.find(order => order.id === sell.orderId)).toMatchObject({ good: good.key, qty: 2, price: 2_000_000 })
    expect(state.escrowItems[good.key]).toBe(2)
    expect(cancelOrder(state, ctx, sell.orderId!)).toBe(true)
    expect(naturalHoldings(state, good)).toBe(2)
    const before = state.wallet.isk
    const buy = placeBuyOrder(state, ctx, good.key, 1_000_000, 2)!
    expect(buy.qty).toBe(2)
    expect(state.wallet.isk).toBe(before - 2_000_000)
    expect(cancelOrder(state, ctx, buy.id)).toBe(true)
    expect(state.wallet.isk).toBe(before)
  })

  it('NPC开盘和一整天刷新都不供应或收购这些商品', () => {
    const state = world()
    state.gameMs = 86_400_000
    advanceMarket(state, 86_400_000, ctx)
    for (const good of PLAYER_ONLY_GOODS) {
      expect(state.market.npcBuy[good.key]).toEqual([])
      expect(state.market.npcSell[good.key]).toEqual([])
      expect(state.market.priceHistory[good.key]).toEqual([])
      expect(buyAtMarket(state, ctx, good.key, 1).bought).toBe(0)
    }
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    ensureMarket(restored, ctx)
    for (const good of PLAYER_ONLY_GOODS) expect(restored.market.priceHistory[good.key]).toEqual([])
  })

  it.each(['plug-pirate-damage-management', 'bp-plug-pirate-damage-management', 'bp-once-plug-pirate-raider', 'box-encrypted-a'])('%s转发卖单真实成交、正确入库且不把外来单再上传', key => {
    const state = world()
    const pending = prepareMarketRelayRequest(state, ctx, scope, { saveId: 'save', requestId: 'request', orderId: () => 'owner' })!
    const offer: MarketRelayOffer = { quoteId: 'quote', goodKey: key, side: 'sell', price: 5_000_000, qty: 2, expiresAt: 300_000 }
    expect(applyMarketRelayResponse(state, ctx, scope, pending.requestId, {
      protocolVersion: 1, requestId: pending.requestId, serverTime: 0, policy: MARKET_RELAY_POLICY,
      offers: [offer], settlements: [], acknowledgedFillIds: [], acknowledgedSettlementIds: [],
    })).toBe(true)
    const before = state.wallet.isk
    expect(buyAtMarket(state, ctx, key, 1)).toMatchObject({ bought: 1, total: 5_000_000 })
    expect(state.wallet.isk).toBe(before - 5_000_000)
    expect(naturalHoldings(state, ctx.marketGoods.get(key)!)).toBe(1)
    const next = prepareMarketRelayRequest(state, ctx, scope, { saveId: 'save', requestId: 'next', orderId: () => 'owner' })!
    expect(next.orders).toEqual([])
    expect(next.fills).toMatchObject([{ quoteId: 'quote', qty: 1 }])
  })

  it('拒绝非有限价格、超安全整数总额和超参考价上限的卖单，失败不扣资产', () => {
    const key = 'box-encrypted-a'
    const state = world()
    depositGood(state, ctx, key, 2)
    for (const price of [NaN, Infinity, -1, 0, Number.MAX_SAFE_INTEGER]) {
      const before = structuredClone(state)
      expect(listSellHolding(state, ctx, key, price, 2).ok).toBe(false)
      expect(placeBuyOrder(state, ctx, key, price, 2)).toBeNull()
      expect(state).toEqual(before)
    }
    expect(listSellHolding(state, ctx, key, ctx.marketGoods.get(key)!.basePrice * ctx.balance.market.maxPriceRatio + 1, 1).ok).toBe(false)
  })
})
