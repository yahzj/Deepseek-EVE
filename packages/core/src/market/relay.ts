import type { GameState, NpcMarketOrder, PlayerOrder } from '../state'
import type { SimContext } from '../types'
import { settleBuy, settleSell } from './settlement'
import { playerTradingGood, goodLockedReason, bmGateLocked } from './access'
import { activateRelayScope } from './relaySession'
import { pruneRelayOffers } from './relayLedger'
import {
  MARKET_RELAY_POLICY, RELAY_MAX_ACKS, RELAY_MAX_FILLS, RELAY_MAX_OFFERS, RELAY_MAX_ORDERS, RELAY_MAX_QUOTES,
  RELAY_MAX_RECEIPTS, relayCount, relayPriceQty, relayString,
} from './relayTypes'
import { cleanMarketRelayState } from './relaySave'
import type { MarketRelayOffer, MarketRelayRequest, MarketRelayResponse, MarketRelaySettlement, MarketRelayState } from './relayTypes'

export type { MarketRelayOffer, MarketRelayPolicy, MarketRelayRequest, MarketRelayResponse, MarketRelaySettlement } from './relayTypes'

function relayState(state: GameState, scope: string, saveId: string): MarketRelayState {
  return state.market.relay ??= {
    scope, saveId, fillSeq: 0, requestSeq: 0, fills: [], settlementAcks: [], receipts: [], quoteHistory: [], quotes: [],
  }
}

function ownOrder(state: GameState, id: string): PlayerOrder | undefined {
  return state.orders.find(order => order.relayId === id)
}

export function marketRelayPendingRequest(state: GameState, scope: string): MarketRelayRequest | null {
  const relay = state.market.relay
  if (!relay) return null
  return relay.scope === scope && relay.pending ? relay.pending : null
}

export function prepareMarketRelayRequest(
  state: GameState,
  _ctx: SimContext,
  scope: string,
  ids: { saveId: string; requestId: string; orderId: () => string },
): MarketRelayRequest | null {
  if (!relayString(scope) || !relayString(ids.saveId) || !relayString(ids.requestId) || typeof ids.orderId !== 'function') return null
  const relay = relayState(state, scope, ids.saveId)
  if (relay.scope !== scope || relay.saveId !== ids.saveId) return null
  if (relay.pending) return relay.pending
  if (state.orders.length > RELAY_MAX_ORDERS || relay.fills.length > RELAY_MAX_FILLS || relay.settlementAcks.length > RELAY_MAX_ACKS) return null
  for (const order of state.orders) {
    if (!order.relayId) {
      const id = ids.orderId()
      if (!relayString(id) || state.orders.some(other => other !== order && other.relayId === id)) return null
      order.relayId = id
    }
  }
  const orders = state.orders.flatMap(order => {
    if (!relayString(order.relayId) || order.qty <= 0) return []
    return [{
      orderId: order.relayId,
      goodKey: order.good,
      side: order.side,
      price: Math.floor(order.price),
      originalQty: Math.floor(order.qty + order.filled),
      qty: Math.floor(order.qty),
      localFilled: Math.floor(order.filled - (order.remoteApplied ?? 0)),
      filled: Math.floor(order.filled),
      remoteApplied: Math.floor(order.remoteApplied ?? 0),
    }]
  })
  const request: MarketRelayRequest = {
    protocolVersion: 1,
    requestId: ids.requestId,
    scope,
    saveId: relay.saveId,
    snapshotSeq: relay.requestSeq + 1,
    snapshotComplete: true,
    orders,
    fills: relay.fills.map(fill => ({ ...fill })),
    settlementAcks: [...relay.settlementAcks],
  }
  if (request.snapshotSeq > Number.MAX_SAFE_INTEGER || JSON.stringify(request).length > 512 * 1024) return null
  for (const order of request.orders) Object.freeze(order)
  for (const fill of request.fills) Object.freeze(fill)
  Object.freeze(request.orders)
  Object.freeze(request.fills)
  Object.freeze(request.settlementAcks)
  Object.freeze(request)
  relay.requestSeq = request.snapshotSeq
  relay.pending = request
  activateRelayScope(state, scope)
  return request
}

function validPolicy(policy: MarketRelayResponse['policy']): boolean {
  return !!policy && policy.version === MARKET_RELAY_POLICY.version &&
    policy.scarceMultiplier === MARKET_RELAY_POLICY.scarceMultiplier &&
    policy.sampleRatio === MARKET_RELAY_POLICY.sampleRatio &&
    policy.maxOffers === MARKET_RELAY_POLICY.maxOffers &&
    policy.maxPriceRatio === MARKET_RELAY_POLICY.maxPriceRatio &&
    policy.offerTtlMs === MARKET_RELAY_POLICY.offerTtlMs
}

function responseBytes(value: unknown): number {
  const text = JSON.stringify(value)
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1 }
    else bytes += 3
  }
  return bytes
}

function applySettlement(
  state: GameState,
  ctx: SimContext,
  settlement: MarketRelaySettlement,
  snapshot: MarketRelayRequest['orders'][number],
  remainingSnapshotQty: number,
): number {
  const order = ownOrder(state, settlement.orderId)
  const good = ctx.marketGoods.get(settlement.goodKey)
  if (!order || !good || !playerTradingGood(ctx, good) || order.good !== settlement.goodKey || order.side !== settlement.side || order.price !== settlement.price) return 0
  const escrowQty = order.side === 'buy'
    ? Math.floor((order.escrowIsk ?? 0) / order.price)
    : good.kind === 'ship' ? (state.escrowShips[order.id] ? 1 : 0) : state.escrowItems[order.good] ?? 0
  const take = Math.min(settlement.qty, order.qty, remainingSnapshotQty, Math.max(0, snapshot.originalQty - order.filled), Math.max(0, escrowQty))
  if (take <= 0) return 0
  const filledBefore = order.filled
  if (order.side === 'sell') {
    const receipt: NpcMarketOrder = { price: settlement.price, qty: take, expiresAtGameMs: state.gameMs + 1 }
    settleSell(state, ctx, order, receipt, take, -1, true)
  } else {
    if (goodLockedReason(state, good) !== null || bmGateLocked(state, good)) return 0
    const receipt: NpcMarketOrder = { price: order.price, qty: take, expiresAtGameMs: state.gameMs + 1 }
    settleBuy(state, ctx, order, receipt, -1, state.gameMs, true)
  }
  const applied = order.filled - filledBefore
  order.remoteApplied = (order.remoteApplied ?? 0) + applied
  return applied
}

function validOffer(offer: MarketRelayOffer, ctx: SimContext): boolean {
  const def = ctx.marketGoods.get(offer.goodKey)
  return !!def && playerTradingGood(ctx, def) && relayString(offer.quoteId) && relayString(offer.goodKey) &&
    (offer.side === 'buy' || offer.side === 'sell') && relayPriceQty(offer.price, offer.qty) &&
    relayCount(offer.expiresAt) && (!def.basePrice || offer.price <= def.basePrice * MARKET_RELAY_POLICY.maxPriceRatio)
}

export function applyMarketRelayResponse(
  state: GameState,
  ctx: SimContext,
  scope: string,
  requestId: string,
  response: MarketRelayResponse,
): boolean {
  const relay = state.market.relay
  if (!relay) return false
  const pending = relay.pending
  if (relay.scope !== scope || !pending || pending.scope !== scope || pending.requestId !== requestId || response.requestId !== requestId ||
    response.protocolVersion !== 1 || !relayCount(response.serverTime) || !validPolicy(response.policy) ||
    !Array.isArray(response.offers) || response.offers.length > RELAY_MAX_OFFERS ||
    !Array.isArray(response.settlements) || response.settlements.length > 128 ||
    !Array.isArray(response.acknowledgedSettlementIds) || response.acknowledgedSettlementIds.length > RELAY_MAX_ACKS ||
    !Array.isArray(response.acknowledgedFillIds) || response.acknowledgedFillIds.length > RELAY_MAX_FILLS || responseBytes(response) > 512 * 1024) return false
  const snapshotOrders = new Map(pending.orders.map(order => [order.orderId, order]))
  const settleIds = new Set<string>()
  for (const s of response.settlements) {
    const snapshot = snapshotOrders.get(s.orderId)
    if (!relayString(s.settlementId) || !relayString(s.orderId) || !relayString(s.goodKey) || !relayPriceQty(s.price, s.qty) || settleIds.has(s.settlementId) || (s.side !== 'buy' && s.side !== 'sell')) return false
    if (snapshot && (snapshot.goodKey !== s.goodKey || snapshot.side !== s.side || snapshot.price !== s.price)) return false
    settleIds.add(s.settlementId)
  }
  const pendingAckIds = new Set(pending.settlementAcks)
  const pendingFillIds = new Set(pending.fills.map(fill => fill.fillId))
  const ackedSettlements = new Set<string>()
  const ackedFills = new Set<string>()
  if (response.acknowledgedSettlementIds.some(id => !relayString(id) || !pendingAckIds.has(id) || !ackedSettlements.add(id)) ||
    response.acknowledgedFillIds.some(id => !relayString(id) || !pendingFillIds.has(id) || !ackedFills.add(id))) return false
  const newSettlements = response.settlements.filter(item => !relay.receipts.includes(item.settlementId)).length
  const remainingAcks = relay.settlementAcks.length + newSettlements - response.acknowledgedSettlementIds.length
  const remainingReceipts = relay.receipts.length - response.acknowledgedSettlementIds.filter(id => relay.receipts.includes(id)).length + newSettlements
  if (remainingAcks > RELAY_MAX_ACKS || remainingReceipts > RELAY_MAX_RECEIPTS) return false
  const nowWall = state.wallMs ?? state.savedAtWallMs
  const expiryBase = Math.max(nowWall, response.serverTime)
  const quoteIds = new Set<string>()
  for (const offer of response.offers) {
    if (!validOffer(offer, ctx) || quoteIds.has(offer.quoteId) || offer.expiresAt > expiryBase + MARKET_RELAY_POLICY.offerTtlMs) return false
    quoteIds.add(offer.quoteId)
  }
  const safeOffers = response.offers.filter(offer => offer.expiresAt > expiryBase)
  activateRelayScope(state, scope)
  pruneRelayOffers(state)
  const remainingSnapshotQty = new Map(pending.orders.map(order => [order.orderId, order.qty]))
  for (const settlement of response.settlements) {
    if (relay.receipts.includes(settlement.settlementId)) continue
    const snapshot = snapshotOrders.get(settlement.orderId)
    if (snapshot) {
      const remaining = remainingSnapshotQty.get(settlement.orderId)!
      const applied = applySettlement(state, ctx, settlement, snapshot, remaining)
      remainingSnapshotQty.set(settlement.orderId, remaining - applied)
    }
    relay.receipts.push(settlement.settlementId)
    relay.settlementAcks.push(settlement.settlementId)
  }
  relay.settlementAcks = relay.settlementAcks.filter(id => !response.acknowledgedSettlementIds.includes(id))
  relay.receipts = relay.receipts.filter(id => !response.acknowledgedSettlementIds.includes(id))
  const doneFills = ackedFills
  relay.fills = relay.fills.filter(fill => !doneFills.has(fill.fillId))
  for (const offer of safeOffers) {
    const remainingMs = Math.min(MARKET_RELAY_POLICY.offerTtlMs, offer.expiresAt - expiryBase)
    const expiresAtGameMs = state.gameMs + remainingMs
    const existing = relay.quotes.find(q => q.quoteId === offer.quoteId)
    if (existing || relay.quoteHistory.includes(offer.quoteId)) continue
    if (relay.quotes.length >= RELAY_MAX_QUOTES) break
    const quote = { ...offer, expiresAtGameMs, remaining: offer.qty }
    relay.quotes.push(quote)
    relay.quoteHistory.push(offer.quoteId)
    if (relay.quoteHistory.length > 4096) relay.quoteHistory.splice(0, relay.quoteHistory.length - 4096)
    const order: NpcMarketOrder = {
      price: offer.price,
      qty: offer.qty,
      expiresAtGameMs,
      relay: { quoteId: offer.quoteId },
    }
    const book = offer.side === 'sell' ? state.market.npcSell : state.market.npcBuy
    const list = book[offer.goodKey] ??= []
    list.push(order)
  }
  state.orders = state.orders.filter(order => order.qty > 0)
  if (relay.quoteHistory.length > 0) {
    const activeIds = new Set(relay.quotes.map(q => q.quoteId))
    relay.quoteHistory = relay.quoteHistory.filter(id => activeIds.has(id) || !relay.receipts.includes(id))
  }
  relay.pending = undefined
  return true
}

export function cleanRelayMarketForSave(v: unknown, gameMs: number, wallMs: number): MarketRelayState | undefined {
  return cleanMarketRelayState(v, gameMs, wallMs)
}
