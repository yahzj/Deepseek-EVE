import type { GameState, NpcMarketOrder } from '../state'
import { RELAY_MAX_FILLS } from './relayTypes'
import { relayScopeIsActive } from './relaySession'

/** 队列满时暂停消费外来报价，保留未上报成交，单机 NPC 路径照常。 */
export function relayTradable(state: GameState, order: NpcMarketOrder, atGameMs = state.gameMs): boolean {
  if (!order.relay) return order.qty > 0 && order.expiresAtGameMs > atGameMs
  const relay = state.market.relay
  if (!relay || !relayScopeIsActive(state, relay.scope)) return false
  const quote = relay.quotes.find(q => q.quoteId === order.relay!.quoteId)
  return !!relay && !!quote && quote.remaining > 0 && order.qty > 0 &&
    quote.expiresAtGameMs > atGameMs && order.expiresAtGameMs > atGameMs &&
    relay.fills.length < RELAY_MAX_FILLS && relay.fillSeq < Number.MAX_SAFE_INTEGER
}

export function relayAvailableQty(state: GameState, order: NpcMarketOrder, atGameMs = state.gameMs): number {
  if (!relayTradable(state, order, atGameMs)) return 0
  if (!order.relay) return order.qty
  return Math.min(order.qty, state.market.relay!.quotes.find(q => q.quoteId === order.relay!.quoteId)?.remaining ?? 0)
}

/** 仅真实成交点调用；过期、重铺与簿面清理不能生成报告。 */
export function recordRelayFill(state: GameState, order: NpcMarketOrder, qty: number): void {
  if (!order.relay || qty <= 0) return
  const relay = state.market.relay!
  const quote = relay.quotes.find(q => q.quoteId === order.relay!.quoteId)!
  qty = Math.min(Math.floor(qty), quote.remaining, order.qty)
  if (qty <= 0 || relay.fills.length >= RELAY_MAX_FILLS) return
  relay.fillSeq += 1
  relay.fills.push({ fillId: `${relay.saveId}:fill:${relay.fillSeq}`, quoteId: quote.quoteId, qty })
  quote.remaining = Math.max(0, quote.remaining - qty)
}

export function pruneRelayOffers(state: GameState, atGameMs = state.gameMs): void {
  const relay = state.market.relay
  if (!relay) return
  relay.quotes = relay.quotes.filter(q => q.expiresAtGameMs > atGameMs)
  const ids = new Set(relay.quotes.map(q => q.quoteId))
  for (const book of [state.market.npcBuy, state.market.npcSell]) {
    for (const [key, list] of Object.entries(book)) {
      book[key] = list.filter(o => !o.relay || (ids.has(o.relay.quoteId) && o.expiresAtGameMs > atGameMs && o.qty > 0))
    }
  }
}
