import type { GameState } from '../state'
import type { SimContext } from '../types'
import { ensureMarket } from './initialize'

/** 簿面报价：收购价 = npcBuy 最高价；供应价 = npcSell 最低价 */
export function marketQuote(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
): { buy?: number; sell?: number; buyDepth: number; sellDepth: number; buyQty: number; sellQty: number } {
  ensureMarket(state, ctx)
  const buyOrders = state.market.npcBuy[goodKey] ?? []
  const sellOrders = state.market.npcSell[goodKey] ?? []
  let bestBuy: number | undefined
  let buyQty = 0
  for (const o of buyOrders) {
    buyQty += o.qty
    if (bestBuy === undefined || o.price > bestBuy) bestBuy = o.price
  }
  let bestSell: number | undefined
  let sellQty = 0
  for (const o of sellOrders) {
    sellQty += o.qty
    if (bestSell === undefined || o.price < bestSell) bestSell = o.price
  }
  return { buy: bestBuy, sell: bestSell, buyDepth: buyOrders.length, sellDepth: sellOrders.length, buyQty, sellQty }
}

/** 价格小史（**每 30 分钟一点，上限 48 点 ≈ 24 小时**；2026-09-08 船长：保留窗 24 → 48，趋势展示用） */
export function marketHistory(state: GameState, goodKey: string): readonly number[] {
  return state.market.priceHistory[goodKey] ?? []
}

/**
 * 价格趋势：1 涨 / -1 跌 / 0 平（2026-09-08 船长：保留点加倍后仍锚定「**最近 24 点**」对比）。
 * ⚠ 采样点 = 30 分钟 ⇒ 这里的"24 点"= **最近 12 小时**（2026-09-16 改采样节奏后同步写清）。
 */
export function marketTrend(state: GameState, goodKey: string): number {
  const hist = state.market.priceHistory[goodKey]
  if (!hist || hist.length < 4) return 0
  const base = hist.length > 24 ? hist[hist.length - 24]! : hist[0]!
  const last = hist[hist.length - 1]!
  if (last > base * 1.01) return 1
  if (last < base * 0.99) return -1
  return 0
}
