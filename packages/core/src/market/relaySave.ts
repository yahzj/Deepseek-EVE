import type { MarketRelayRequest, MarketRelayState, MarketRelayOffer } from './relayTypes'
import {
  RELAY_MAX_FILLS, RELAY_MAX_ORDERS, RELAY_MAX_QUOTES, RELAY_MAX_RECEIPTS, RELAY_MAX_ACKS,
  relayCount, relayString,
} from './relayTypes'

type Raw = Record<string, unknown>
const raw = (v: unknown): Raw => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Raw : {}
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined => relayCount(v) && v <= max ? v : undefined
const text = (v: unknown): string | undefined => relayString(v) ? v : undefined
const side = (v: unknown): v is 'buy' | 'sell' => v === 'buy' || v === 'sell'

function cleanRequest(v: unknown): MarketRelayRequest | undefined {
  const r = raw(v)
  if (r.protocolVersion !== 1 || !text(r.requestId) || !text(r.scope) || !text(r.saveId) || count(r.snapshotSeq) === undefined || r.snapshotSeq === 0 || r.snapshotComplete !== true || !Array.isArray(r.orders) || r.orders.length > RELAY_MAX_ORDERS || !Array.isArray(r.fills) || r.fills.length > RELAY_MAX_FILLS || !Array.isArray(r.settlementAcks) || r.settlementAcks.length > RELAY_MAX_ACKS) return undefined
  const orders: MarketRelayRequest['orders'] = []
  for (const value of r.orders) {
    const o = raw(value)
    const price = count(o.price), originalQty = count(o.originalQty), qty = count(o.qty), localFilled = count(o.localFilled), filled = count(o.filled), remoteApplied = count(o.remoteApplied)
    if (!text(o.orderId) || !text(o.goodKey) || !side(o.side) || !price || !originalQty || !qty || localFilled === undefined || filled === undefined || remoteApplied === undefined || qty + filled !== originalQty || localFilled + remoteApplied !== filled || !Number.isSafeInteger(price * originalQty)) return undefined
    orders.push({ orderId: o.orderId as string, goodKey: o.goodKey as string, side: o.side, price, originalQty, qty, localFilled, filled, remoteApplied })
  }
  const fills: MarketRelayRequest['fills'] = []
  for (const value of r.fills) {
    const f = raw(value), qty = count(f.qty)
    if (!text(f.fillId) || !text(f.quoteId) || !qty || qty <= 0) return undefined
    fills.push({ fillId: f.fillId as string, quoteId: f.quoteId as string, qty })
  }
  const settlementAcks = r.settlementAcks.filter((id): id is string => !!text(id))
  if (settlementAcks.length !== r.settlementAcks.length) return undefined
  return { protocolVersion: 1, requestId: r.requestId as string, scope: r.scope as string, saveId: r.saveId as string, snapshotSeq: r.snapshotSeq as number, snapshotComplete: true, orders, fills, settlementAcks }
}

function cleanOffer(v: unknown): MarketRelayOffer & { expiresAtGameMs: number; remaining: number } | undefined {
  const o = raw(v), price = count(o.price), qty = count(o.qty), expiresAt = count(o.expiresAt), expiresAtGameMs = count(o.expiresAtGameMs), remaining = count(o.remaining)
  if (!text(o.quoteId) || !text(o.goodKey) || !side(o.side) || !price || !qty || expiresAt === undefined || expiresAtGameMs === undefined || remaining === undefined || remaining > qty || !Number.isSafeInteger(price * qty)) return undefined
  return { quoteId: o.quoteId as string, goodKey: o.goodKey as string, side: o.side, price, qty, expiresAt, expiresAtGameMs, remaining }
}

export function cleanMarketRelayState(v: unknown, gameMs: number, wallMs: number): MarketRelayState | undefined {
  const r = raw(v)
  if (!text(r.scope) || !text(r.saveId)) return undefined
  const fills = Array.isArray(r.fills) ? r.fills.slice(-RELAY_MAX_FILLS).flatMap(value => {
    const f = raw(value), qty = count(f.qty)
    const fillId = text(f.fillId), quoteId = text(f.quoteId)
    return fillId && quoteId && qty !== undefined && qty > 0 ? [{ fillId, quoteId, qty }] : []
  }) : []
  const pending = cleanRequest(r.pending)
  const offers = Array.isArray(r.quotes) ? r.quotes.slice(-RELAY_MAX_QUOTES).flatMap(value => {
    const q = cleanOffer(value)
    if (!q) return []
    const leftMs = Math.max(0, Math.min(300_000, q.expiresAt - wallMs))
    return [{ ...q, expiresAtGameMs: gameMs + leftMs }]
  }) : []
  const receiptIds = Array.isArray(r.receipts) ? r.receipts.slice(-RELAY_MAX_RECEIPTS).filter((id): id is string => !!text(id)) : []
  const settlementAcks = Array.isArray(r.settlementAcks) ? r.settlementAcks.slice(-RELAY_MAX_ACKS).filter((id): id is string => !!text(id)) : []
  const quoteHistory = Array.isArray(r.quoteHistory) ? r.quoteHistory.slice(-4096).filter((id): id is string => !!text(id)) : []
  return {
    scope: r.scope as string,
    saveId: r.saveId as string,
    fillSeq: count(r.fillSeq) ?? 0,
    requestSeq: count(r.requestSeq) ?? 0,
    fills,
    settlementAcks: [...new Set(settlementAcks)],
    ...(pending ? { pending } : {}),
    receipts: [...new Set(receiptIds)].slice(-RELAY_MAX_RECEIPTS),
    quoteHistory: [...new Set(quoteHistory)].slice(-4096),
    quotes: offers,
  }
}
