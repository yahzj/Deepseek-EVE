import type { MarketRelayRequest, MarketRelayResponse } from '@whale/core'

export const MARKET_RELAY_MAX_BYTES = 512 * 1024

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 512
const count = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min
const side = (v: unknown): boolean => v === 'buy' || v === 'sell'
const priceQty = (price: unknown, qty: unknown): boolean => count(price, 1) && count(qty, 1) && Number.isSafeInteger(price * qty)
const unique = (rows: Record<string, unknown>[], key: string): boolean => new Set(rows.map(row => row[key])).size === rows.length
const uniqueValues = (values: unknown[]): boolean => new Set(values).size === values.length

export function marketRelayRequestShape(value: unknown): value is MarketRelayRequest {
  if (!record(value) || value.protocolVersion !== 1 || !id(value.requestId) || !id(value.scope) || !id(value.saveId)
    || !count(value.snapshotSeq, 1) || value.snapshotComplete !== true
    || !Array.isArray(value.orders) || value.orders.length > 128
    || !Array.isArray(value.fills) || value.fills.length > 256
    || !Array.isArray(value.settlementAcks) || value.settlementAcks.length > 128
    || !value.settlementAcks.every(id) || new Set(value.settlementAcks).size !== value.settlementAcks.length) return false
  if (!value.orders.every((order: unknown) => record(order) && id(order.orderId) && id(order.goodKey)
    && side(order.side) && priceQty(order.price, order.qty) && count(order.originalQty, 1)
    && count(order.localFilled) && count(order.filled) && count(order.remoteApplied))
    || !value.fills.every((fill: unknown) => record(fill) && id(fill.fillId) && id(fill.quoteId) && count(fill.qty, 1))) return false
  return unique(value.orders, 'orderId') && unique(value.fills, 'fillId')
}

export function marketRelayResponseShape(value: unknown, request: MarketRelayRequest): value is MarketRelayResponse {
  if (!record(value) || value.protocolVersion !== 1 || !id(value.requestId) || value.requestId !== request.requestId
    || !count(value.serverTime) || !record(value.policy)) return false
  const policy = value.policy
  if (policy.version !== 1 || policy.scarceMultiplier !== 5 || policy.sampleRatio !== 0.1
    || policy.maxOffers !== 10 || policy.maxPriceRatio !== 1000 || policy.offerTtlMs !== 300000
    || !Array.isArray(value.offers) || value.offers.length > 10
    || !Array.isArray(value.settlements) || value.settlements.length > 128) return false
  if (!value.offers.every((offer: unknown) => record(offer) && id(offer.quoteId) && id(offer.goodKey)
    && side(offer.side) && priceQty(offer.price, offer.qty) && count(offer.expiresAt))
    || !value.settlements.every((settlement: unknown) => record(settlement) && id(settlement.settlementId)
      && id(settlement.orderId) && id(settlement.goodKey) && side(settlement.side) && priceQty(settlement.price, settlement.qty))) return false
  if (!unique(value.offers, 'quoteId') || !unique(value.settlements, 'settlementId')
    || !Array.isArray(value.acknowledgedSettlementIds) || !Array.isArray(value.acknowledgedFillIds)) return false
  const settlementAcks = new Set(request.settlementAcks)
  const fillIds = new Set(request.fills.map(fill => fill.fillId))
  return value.acknowledgedSettlementIds.every(id) && uniqueValues(value.acknowledgedSettlementIds)
    && value.acknowledgedSettlementIds.every((ack: unknown) => settlementAcks.has(ack as string))
    && value.acknowledgedFillIds.every(id) && uniqueValues(value.acknowledgedFillIds)
    && value.acknowledgedFillIds.every((ack: unknown) => fillIds.has(ack as string))
}

export function marketRelayJsonWithinLimit(value: unknown): boolean {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' && new TextEncoder().encode(text).byteLength <= MARKET_RELAY_MAX_BYTES
  } catch {
    return false
  }
}
