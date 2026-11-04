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
    /** 当前 qty + 累计 filled；是该 owner 原单的数量预算。 */
    originalQty: number
    qty: number
    /** 本地已成交量；filled - remoteApplied。 */
    localFilled: number
    filled: number
    remoteApplied: number
  }>
  fills: Array<{ fillId: string; quoteId: string; qty: number }>
  /** 本地已持久化应用的 settlement；服务端收到后才可结束重放。 */
  settlementAcks: string[]
}

export interface MarketRelayResponse {
  protocolVersion: 1
  requestId: string
  serverTime: number
  policy: MarketRelayPolicy
  offers: MarketRelayOffer[]
  settlements: MarketRelaySettlement[]
  /** 服务端确认已收到的 settlementAcks；客户端据此删除本地确认待办。 */
  acknowledgedSettlementIds: string[]
  /** 只有明确确认的 fill 才能从本地未上报队列删除。 */
  acknowledgedFillIds: string[]
}

export interface MarketRelayState {
  scope: string
  saveId: string
  fillSeq: number
  requestSeq: number
  fills: MarketRelayRequest['fills']
  /** 成交回执已先本地应用并持久化，随后等待发给服务端确认。 */
  settlementAcks: string[]
  pending?: MarketRelayRequest
  receipts: string[]
  quoteHistory: string[]
  /** 报价耗尽后仍留墓碑，直到原报价过期，防刷新把已成交量补回来。 */
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

/** Core protocol v1: all fields are immutable for the lifetime of a pending request. */
export interface MarketRelayIdentity {
  /** Normalized server origin + authenticated player id. */
  scope: string
  /** Stable per-save identity, bound to the first accepted scope. */
  saveId: string
}

export interface MarketRelayRequestIds {
  requestId: string
  orderId: () => string
}
