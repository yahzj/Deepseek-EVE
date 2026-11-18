import type { BookLevel, OrderBookSnapshot, OrderSource, Side, TradeRecord, TradeSource } from '../client'
import type { Rng } from './priceEngine'

export type BookOwner = 'player' | 'strategy' | 'mm'

export interface BookOrder {
  id: string
  side: Side
  priceCents: number
  qty: number
  seq: number
  owner: BookOwner
}

export interface BookFill {
  price: number
  qty: number
  takerSide: Side
  takerId: string
  makerId: string
  makerOwner: BookOwner
}

const toCents = (p: number): number => Math.round(p * 100)
const fromCents = (c: number): number => c / 100
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export class OrderBook {
  readonly code: string
  private bids = new Map<number, BookOrder[]>()
  private asks = new Map<number, BookOrder[]>()
  private seq = 0
  private tradeSeq = 0
  private tradeLog: TradeRecord[] = []
  private mmInventory = 0
  private playerFillQuota?: (price: number, requestedQty: number) => number

  setPlayerFillQuota(consume: (price: number, requestedQty: number) => number): void {
    this.playerFillQuota = consume
  }

  constructor(code: string) {
    this.code = code
  }

  get inventory(): number {
    return this.mmInventory
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.code}-${this.seq}`
  }

  private bestPriceCents(book: Map<number, BookOrder[]>, side: Side): number | null {
    let best: number | null = null
    for (const key of book.keys()) {
      if (best === null) best = key
      else best = side === 'buy' ? Math.max(best, key) : Math.min(best, key)
    }
    return best
  }

  private pushTrade(priceCents: number, qty: number, takerSide: Side, source: TradeSource, ts: number): void {
    this.tradeSeq += 1
    this.tradeLog.push({
      id: `${this.code}-T${this.tradeSeq}`,
      ts,
      code: this.code,
      price: fromCents(priceCents),
      qty,
      side: takerSide,
      source,
    })
    if (this.tradeLog.length > 100) this.tradeLog.splice(0, this.tradeLog.length - 100)
  }

  private insertResting(order: BookOrder): void {
    const book = order.side === 'buy' ? this.bids : this.asks
    const queue = book.get(order.priceCents)
    if (queue) queue.push(order)
    else book.set(order.priceCents, [order])
  }

  private consume(order: BookOrder, limitCents: number | null, source: TradeSource, ts: number): BookFill[] {
    const fills: BookFill[] = []
    const opp = order.side === 'buy' ? this.asks : this.bids
    while (order.qty > 0) {
      const best = this.bestPriceCents(opp, order.side === 'buy' ? 'sell' : 'buy')
      if (best === null) break
      const crosses = limitCents === null || (order.side === 'buy' ? best <= limitCents : best >= limitCents)
      if (!crosses) break
      const queue = opp.get(best)
      if (!queue || queue.length === 0) {
        opp.delete(best)
        continue
      }
      while (order.qty > 0 && queue.length > 0) {
        const maker = queue[0]!
        let qty = Math.min(order.qty, maker.qty)
        if (maker.owner !== 'mm' || order.owner !== 'mm') {
          qty = this.playerFillQuota?.(fromCents(maker.priceCents), qty) ?? qty
          if (qty <= 0) return fills
        }
        order.qty -= qty
        maker.qty -= qty
        if (maker.owner === 'mm') this.mmInventory += order.side === 'buy' ? -qty : qty
        fills.push({
          price: fromCents(maker.priceCents),
          qty,
          takerSide: order.side,
          takerId: order.id,
          makerId: maker.id,
          makerOwner: maker.owner,
        })
        this.pushTrade(maker.priceCents, qty, order.side, source, ts)
        if (maker.qty <= 0) queue.shift()
      }
      if (queue.length === 0) opp.delete(best)
    }
    return fills
  }

  submit(
    side: Side,
    qty: number,
    limitPrice: number | null,
    owner: 'player' | 'strategy',
    source: OrderSource,
    ts: number,
    allowRest: boolean,
  ): { order: BookOrder; fills: BookFill[] } {
    const market = limitPrice === null
    const priceCents = market ? (side === 'buy' ? Number.MAX_SAFE_INTEGER : 0) : toCents(limitPrice)
    const order: BookOrder = {
      id: this.nextId(owner === 'strategy' ? 'ST' : 'PX'),
      side,
      priceCents,
      qty,
      seq: this.seq,
      owner,
    }
    const fills = this.consume(order, market ? null : priceCents, source, ts)
    if (order.qty > 0 && allowRest && !market) this.insertResting(order)
    return { order, fills }
  }

  refreshQuotes(
    midPrice: number,
    spreadBps: number,
    levelQty: number,
    rng: Rng,
    ts: number,
  ): BookFill[] {
    this.removeMakerQuotes()
    const midCents = Math.max(1, toCents(midPrice))
    const halfSpread = Math.max(1, Math.round((midCents * spreadBps) / 20000))
    const step = Math.max(1, Math.round(midCents * 0.0008))
    const cap = Math.max(1, levelQty * 5 * 4)
    const invRatio = clamp(this.mmInventory / cap, -1, 1)
    const shift = Math.round(-invRatio * halfSpread * 2)
    const fills: BookFill[] = []
    for (let i = 0; i < 5; i++) {
      const sizeFactor = 1 - i * 0.12
      const jitter = 0.85 + rng.next() * 0.3
      const qty = Math.max(1, Math.round(levelQty * sizeFactor * jitter))
      const bidCents = midCents - halfSpread - i * step + shift
      const askCents = midCents + halfSpread + i * step + shift
      if (invRatio < 0.9) fills.push(...this.makeQuote('buy', bidCents, qty, ts))
      if (invRatio > -0.9) fills.push(...this.makeQuote('sell', askCents, qty, ts))
    }
    return fills
  }

  private makeQuote(side: Side, priceCents: number, qty: number, ts: number): BookFill[] {
    const fills: BookFill[] = []
    const order: BookOrder = {
      id: this.nextId('MM'),
      side,
      priceCents,
      qty,
      seq: this.seq,
      owner: 'mm',
    }
    const opp = side === 'buy' ? this.asks : this.bids
    let quotaBlocked = false
    while (order.qty > 0) {
      const best = this.bestPriceCents(opp, side === 'buy' ? 'sell' : 'buy')
      if (best === null) break
      const crosses = side === 'buy' ? best <= priceCents : best >= priceCents
      if (!crosses) break
      const queue = opp.get(best)
      if (!queue || queue.length === 0) {
        opp.delete(best)
        continue
      }
      while (order.qty > 0 && queue.length > 0) {
        const maker = queue[0]!
        let fillQty = Math.min(order.qty, maker.qty)
        if (maker.owner !== 'mm') {
          fillQty = this.playerFillQuota?.(fromCents(maker.priceCents), fillQty) ?? fillQty
          if (fillQty <= 0) {
            quotaBlocked = true
            break
          }
        }
        order.qty -= fillQty
        maker.qty -= fillQty
        this.mmInventory += side === 'buy' ? fillQty : -fillQty
        fills.push({
          price: fromCents(maker.priceCents),
          qty: fillQty,
          takerSide: side,
          takerId: order.id,
          makerId: maker.id,
          makerOwner: maker.owner,
        })
        this.pushTrade(maker.priceCents, fillQty, side, 'mm', ts)
        if (maker.qty <= 0) queue.shift()
      }
      if (quotaBlocked) break
      if (queue.length === 0) opp.delete(best)
    }
    if (order.qty > 0 && !quotaBlocked) this.insertResting(order)
    return fills
  }

  private removeMakerQuotes(): void {
    for (const [price, queue] of this.bids) {
      const keep = queue.filter((o) => o.owner !== 'mm')
      if (keep.length === 0) this.bids.delete(price)
      else this.bids.set(price, keep)
    }
    for (const [price, queue] of this.asks) {
      const keep = queue.filter((o) => o.owner !== 'mm')
      if (keep.length === 0) this.asks.delete(price)
      else this.asks.set(price, keep)
    }
  }

  restoreResting(side: Side, price: number, qty: number, owner: 'player' | 'strategy'): BookOrder {
    const order: BookOrder = {
      id: this.nextId(owner === 'strategy' ? 'ST' : 'PX'),
      side,
      priceCents: Math.max(1, toCents(price)),
      qty,
      seq: this.seq,
      owner,
    }
    this.insertResting(order)
    return order
  }

  cancel(orderId: string): BookOrder | null {
    for (const book of [this.bids, this.asks]) {
      for (const [price, queue] of book) {
        const idx = queue.findIndex((o) => o.id === orderId)
        if (idx < 0) continue
        const [removed] = queue.splice(idx, 1)
        if (queue.length === 0) book.delete(price)
        return removed ?? null
      }
    }
    return null
  }

  restingQty(orderId: string): number {
    for (const book of [this.bids, this.asks]) {
      for (const queue of book.values()) {
        const found = queue.find((o) => o.id === orderId)
        if (found) return found.qty
      }
    }
    return 0
  }

  private levels(book: Map<number, BookOrder[]>, side: Side, depth: number): BookLevel[] {
    const keys = [...book.keys()].filter((k) => (book.get(k)?.length ?? 0) > 0)
    keys.sort((a, b) => (side === 'buy' ? b - a : a - b))
    return keys.slice(0, depth).map((k) => ({
      price: fromCents(k),
      qty: (book.get(k) ?? []).reduce((s, o) => s + o.qty, 0),
    }))
  }

  snapshot(ts: number, depth = 5): OrderBookSnapshot {
    return {
      code: this.code,
      bids: this.levels(this.bids, 'buy', depth),
      asks: this.levels(this.asks, 'sell', depth),
      ts,
    }
  }

  trades(limit = 30): TradeRecord[] {
    return this.tradeLog.slice(-limit).reverse()
  }
}
