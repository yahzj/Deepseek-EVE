import { ceilFinalQuantity } from '../quantity'
import type { GameState, PlayerOrder } from '../state'
import type { MarketBalance, MarketGoodDef, SimContext } from '../types'
import { nextRandom } from '../rng'
import { settleSell, settleBuy, settleSnatchSell, settleSnatchBuy, settleStationTake } from './settlement'
import { buyPrice, priceLevel, sellPrice, builtSellBoost } from './pricing'
import { bmGateLocked, goodLockedReason, playerTradingGood } from './access'
import { relayTradable } from './relayLedger'

export function snatchSellFill(def: MarketGoodDef | undefined, r: number): number {
  const pool = !!def?.poolTarget && (def.poolTarget ?? 0) > 0
  if (!pool) {
    if (r <= 0.01) return 5
    if (r <= 0.03) return 3
    if (r <= 0.08) return 2
    return 1
  }
  const qtyBase = def?.supplyFlow && def.supplyFlow > 0 ? def.supplyFlow : Math.max(1, (def?.poolTarget ?? 0) / 120)
  if (r <= 0.01) return Math.max(1, ceilFinalQuantity(qtyBase * 0.5))
  if (r <= 0.03) return Math.max(1, ceilFinalQuantity(qtyBase * 0.25))
  if (r <= 0.08) return Math.max(1, ceilFinalQuantity(qtyBase * 0.1))
  return 1
}


function eatBook(state: GameState, ctx: SimContext, order: PlayerOrder, atGameMs = state.gameMs): void {
  if (order.qty <= 0) return
  const def = ctx.marketGoods.get(order.good)
  if (!def || !playerTradingGood(ctx, def)) return
  if (order.side === 'sell') {
    const buyList = state.market.npcBuy[order.good] ?? []
    const sorted = [...buyList].sort((a, b) => b.price - a.price)
    for (const npc of sorted) {
      if (order.qty <= 0) break
      if (!relayTradable(state, npc, atGameMs) || (!npc.relay && def.playerSellable === false)) continue
      if (npc.price < order.price) continue
      const idx = buyList.indexOf(npc)
      if (idx < 0) continue
      settleSell(state, ctx, order, npc, Math.min(order.qty, npc.qty), idx)
    }
  } else {
    const sellList = state.market.npcSell[order.good] ?? []
    const sorted = [...sellList].sort((a, b) => a.price - b.price)
    for (const npc of sorted) {
      if (order.qty <= 0) break
      if (!relayTradable(state, npc, atGameMs)) continue
      if (npc.price > order.price) continue
      const idx = sellList.indexOf(npc)
      if (idx < 0) continue
      settleBuy(state, ctx, order, npc, idx, atGameMs)
    }
  }
}

export function crossOnPlacement(state: GameState, ctx: SimContext, order: PlayerOrder): { filled: number; resting: number } {
  const before = order.qty
  eatBook(state, ctx, order)
  const filled = before - order.qty
  if (order.qty <= 0) state.orders = state.orders.filter((o) => o !== order)
  return { filled, resting: order.qty }
}

export function matchPlayerOrders(state: GameState, ctx: SimContext, atGameMs = state.gameMs): void {
  const bal = ctx.balance.market
  for (const o of state.orders) if (o.side === 'sell') o.windowFilled = 0
  for (const order of [...state.orders]) {
    if (order.qty <= 0) continue
    eatBook(state, ctx, order, atGameMs)
    if (order.side === 'sell') {
      if (order.qty > 0) {
        const sdef = ctx.marketGoods.get(order.good)
        if (sdef && sdef.playerSellable !== false) {
          const bid = ceilFinalQuantity(buyPrice(sdef, priceLevel(state, ctx, sdef, state.market.pools[order.good]?.q ?? 0)))
          if (order.price > bid) {
            const r = bid > 0 ? (order.price - bid) / bid : 1
            const pRoll = Math.min(1, bal.snatchSellChance * Math.exp(-bal.snatchSellDecay * r))
            if (nextRandom(state.rng) < pRoll) {
              settleSnatchSell(state, ctx, order, Math.min(order.qty, snatchSellFill(sdef, r)))
            }
          }
        }
      }
    } else {
      if (order.qty > 0) {
        const bdef = ctx.marketGoods.get(order.good)
        if (bdef && bdef.playerBuyable !== false && goodLockedReason(state, bdef) === null && !bmGateLocked(state, bdef)) {
          const Lp = priceLevel(state, ctx, bdef, state.market.pools[order.good]?.q ?? 0)
          const ask = ceilFinalQuantity(bdef.rarity === 'exotic' ? Lp * 20 : sellPrice(bdef, Lp))
          if (order.price < ask) {
            const s = ask > 0 ? (ask - order.price) / ask : 1
            const pRoll = Math.min(1, bal.snatchBuyChance * Math.exp(-bal.snatchBuyDecay * s))
            if (nextRandom(state.rng) < pRoll) settleSnatchBuy(state, ctx, order, atGameMs)
          }
        }
      }
    }
  }
  if (state.orders.some((o) => o.qty <= 0)) {
    state.orders = state.orders.filter((o) => o.qty > 0)
  }
}


function absorbBaseQtyOf(def: MarketGoodDef): number {
  if (def.absorbQtyPerWindow !== undefined) return def.absorbQtyPerWindow
  if (def.poolTarget && def.poolTarget > 0) return def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))
  if (def.rarity === 'rare') return 0.3
  if (def.rarity === 'exotic') return 0.1
  return 1
}

function absorbMulOf(bal: MarketBalance, price: number, buyBid: number): number {
  if (price >= buyBid) return 1
  const pct = ((buyBid - price) / buyBid) * 100
  return Math.min(bal.absorbMaxMul, 1 + bal.absorbPerPoint * pct)
}

export function absorbViaStation(state: GameState, ctx: SimContext): void {
  const bal = ctx.balance.market
  for (const order of state.orders) {
    if (order.side !== 'sell' || order.qty <= 0) continue
    const def = ctx.marketGoods.get(order.good)
    if (!def || !playerTradingGood(ctx, def)) continue
    const poolQ = state.market.pools[order.good]?.q ?? 0
    const L = priceLevel(state, ctx, def, poolQ)
    const buyBid = ceilFinalQuantity(buyPrice(def, L))
    if (order.price > buyBid) continue
    const F0 = absorbBaseQtyOf(def)
    const F = def.poolTarget && def.poolTarget > 0 ? F0 : F0 * builtSellBoost(state, ctx)
    const E = absorbMulOf(bal, order.price, buyBid)
    const bookFill = order.windowFilled ?? 0
    if (bookFill < F * E) {
      order.absorbCredit = (order.absorbCredit ?? 0) + (F * E - bookFill)
    }
    const take = Math.min(order.qty, Math.floor((order.absorbCredit ?? 0) + 1e-9))
    if (take <= 0) continue
    settleStationTake(state, ctx, order, take)
    order.absorbCredit = (order.absorbCredit ?? 0) - take
  }
  if (state.orders.some((o) => o.side === 'sell' && o.qty <= 0)) {
    state.orders = state.orders.filter((o) => o.qty > 0)
  }
}
