export interface MarketRelayPolicy {
  version: 1
  scarceMultiplier: number
  sampleRatio: number
  maxOffers: number
  maxPriceRatio: number
  offerTtlMs: number
}

export interface MarketRelayOffer {
  quoteId: string
  goodKey: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  expiresAt: number
}

export interface MarketRelaySettlement {
  settlementId: string
  orderId: string
  goodKey: string
  side: 'buy' | 'sell'
  qty: number
  price: number
}

export interface MarketRelayRequest {
  protocolVersion: 1
  requestId: string
  scope: string
  saveId: string
  snapshotSeq: number
  snapshotComplete: true
  orders: Array<{
    orderId: string
    goodKey: string
    side: 'buy' | 'sell'
    price: number
    originalQty: number
    qty: number
    localFilled: number
    filled: number
    remoteApplied: number
  }>
  fills: Array<{ fillId: string; quoteId: string; qty: number }>
  settlementAcks: string[]
}

export interface MarketRelayResponse {
  protocolVersion: 1
  requestId: string
  serverTime: number
  policy: MarketRelayPolicy
  offers: MarketRelayOffer[]
  settlements: MarketRelaySettlement[]
  acknowledgedSettlementIds: string[]
  acknowledgedFillIds: string[]
}

export interface MarketRelayState {
  scope: string
  saveId: string
  fillSeq: number
  requestSeq: number
  fills: MarketRelayRequest['fills']
  settlementAcks: string[]
  pending?: MarketRelayRequest
  receipts: string[]
  quoteHistory: string[]
  quotes: Array<MarketRelayOffer & { expiresAtGameMs: number; remaining: number }>
}

export const RELAY_MAX_ORDERS = 128
export const RELAY_MAX_FILLS = 256
export const RELAY_MAX_OFFERS = 10
export const RELAY_MAX_RECEIPTS = 4096
export const RELAY_MAX_ACKS = 128
export const RELAY_MAX_QUOTES = 256
export const MARKET_RELAY_POLICY: MarketRelayPolicy = {
  version: 1,
  scarceMultiplier: 5,
  sampleRatio: 0.1,
  maxOffers: RELAY_MAX_OFFERS,
  maxPriceRatio: 1000,
  offerTtlMs: 300_000,
}

export function relayString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 512
}

export function relayCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

export function relayPriceQty(price: unknown, qty: unknown): boolean {
  return relayCount(price) && price > 0 && relayCount(qty) && qty > 0 && Number.isSafeInteger(price * qty)
}

export interface MarketRelayIdentity {
  scope: string
  saveId: string
}

export interface MarketRelayRequestIds {
  requestId: string
  orderId: () => string
}
