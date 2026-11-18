import type { GameState } from '../state'
import type { SimContext } from '../types'
import { ensureMarket } from './initialize'

let readEnsured: { state: GameState; ctx: SimContext } | null = null

function ensureMarketForRead(state: GameState, ctx: SimContext): void {
  if (readEnsured?.state === state && readEnsured.ctx === ctx) return
  ensureMarket(state, ctx)
  readEnsured = { state, ctx }
  queueMicrotask(() => {
    if (readEnsured?.state === state && readEnsured.ctx === ctx) readEnsured = null
  })
}

export function marketQuote(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
): { buy?: number; sell?: number; buyDepth: number; sellDepth: number; buyQty: number; sellQty: number } {
  ensureMarketForRead(state, ctx)
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

export function marketHistory(state: GameState, goodKey: string): readonly number[] {
  return state.market.priceHistory[goodKey] ?? []
}

export function marketTrend(state: GameState, goodKey: string): number {
  const hist = state.market.priceHistory[goodKey]
  if (!hist || hist.length < 4) return 0
  const base = hist.length > 24 ? hist[hist.length - 24]! : hist[0]!
  const last = hist[hist.length - 1]!
  if (last > base * 1.01) return 1
  if (last < base * 0.99) return -1
  return 0
}
