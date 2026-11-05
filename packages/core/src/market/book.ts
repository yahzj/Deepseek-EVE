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

/** 参考成交量（冲击归一）：池商品 = 稳态窗口流量的一半（持续按流量买卖不触发冲击，
 * 单窗口爆量（>流量）才触发）；单件 = 1（单件爆买立刻触发） */
export function referenceVol(def: MarketGoodDef, ratio: number): number {
  if (def.poolTarget && def.poolTarget > 0) {
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget * ratio))
    return Math.max(1, Math.round(flow / 2))
  }
  return 1
}

/** NPC 簿入单（共用）：收购单（玩家卖出对手盘）。撞价冲突 → 内部消化队列；簿上限 10 张 */
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
    digestAdd(state, ctx, key, qty, price, lowest) // 与簿上供应单冲突 → 内部消化
    return
  }
  buyList.push({ price, qty, bm: bm || undefined, expiresAtGameMs: now + lifeMs })
  if (buyList.filter(o => !o.relay).length > 10) buyList.splice(buyList.findIndex(o => !o.relay), 1)
}

/** NPC 簿入单（共用）：供应单（玩家买入对手盘）。池快干涸断供/撞价冲突；簿上限 10 张 */
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
  // 池商品：池快干涸时站里没货可卖（短缺断供；冲击可短期透支库存）
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

/** 冲突订单入内部消化队列（不瞬消：按 perWindow/窗口 随时间消化） */
function digestAdd(state: GameState, ctx: SimContext, key: string, qty: number, hiPrice: number, loPrice: number): void {
  const dig = state.market.digest[key]!
  dig.qty += qty
  dig.price = Math.round((hiPrice + loPrice) / 2)
  dig.perWindow = Math.max(1, Math.ceil(dig.qty * ctx.balance.market.digestPerWindow))
}
