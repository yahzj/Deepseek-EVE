import type { GameState, NpcMarketOrder } from '../state'
import type { MarketGoodDef, SimContext } from '../types'

export function bestBuy(list: NpcMarketOrder[]): number | undefined {
  let best: number | undefined
  for (const o of list) if (best === undefined || o.price > best) best = o.price
  return best
}

function bestSell(list: NpcMarketOrder[]): number | undefined {
  let best: number | undefined
  for (const o of list) if (best === undefined || o.price < best) best = o.price
  return best
}

export function referenceVol(def: MarketGoodDef, ratio: number): number {
  if (def.poolTarget && def.poolTarget > 0) {
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget * ratio))
    return Math.max(1, Math.round(flow / 2))
  }
  return 1
}

export function npcPushBuy(
  state: GameState,
  ctx: SimContext,
  def: MarketGoodDef,
  now: number,
  lifeMs: number,
  price: number,
  qty: number,
  bm = false,
): void {
  if (qty <= 0 || def.playerSellable === false) return
  const key = def.key
  const buyList = state.market.npcBuy[key]!
  const lowest = bestSell(state.market.npcSell[key]!.filter(o => !o.relay))
  if (lowest !== undefined && price > lowest) {
    digestAdd(state, ctx, key, qty, price, lowest)
    return
  }
  buyList.push({ price, qty, bm: bm || undefined, expiresAtGameMs: now + lifeMs })
  if (buyList.filter(o => !o.relay).length > 10) buyList.splice(buyList.findIndex(o => !o.relay), 1)
}

export function npcPushSell(
  state: GameState,
  ctx: SimContext,
  def: MarketGoodDef,
  poolQ: number,
  now: number,
  lifeMs: number,
  price: number,
  qty: number,
  bm = false,
): void {
  if (qty <= 0) return
  const key = def.key
  const pool = state.market.pools[key]!
  if (def.poolTarget && def.poolTarget > 0 && poolQ < def.poolTarget * 0.05 && pool.shock <= 0) return
  const sellList = state.market.npcSell[key]!
  const highest = bestBuy(state.market.npcBuy[key]!.filter(o => !o.relay))
  if (highest !== undefined && price < highest) {
    digestAdd(state, ctx, key, qty, highest, price)
    return
  }
  sellList.push({ price, qty, bm: bm || undefined, expiresAtGameMs: now + lifeMs })
  if (sellList.filter(o => !o.relay).length > 10) sellList.splice(sellList.findIndex(o => !o.relay), 1)
}

function digestAdd(state: GameState, ctx: SimContext, key: string, qty: number, hiPrice: number, loPrice: number): void {
  const dig = state.market.digest[key]!
  dig.qty += qty
  dig.price = Math.round((hiPrice + loPrice) / 2)
  dig.perWindow = Math.max(1, Math.ceil(dig.qty * ctx.balance.market.digestPerWindow))
}
