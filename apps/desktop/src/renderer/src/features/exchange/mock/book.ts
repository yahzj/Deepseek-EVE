/**
 * 内存订单簿（原型）——价格优先 / 时间优先 + 做市商五档报价 + 限价/市价撮合 + 逐笔成交。
 *
 * 规则照 `docs/design/stock-exchange-server-20261103.md` 附录 A.1：
 * - 价格用「分」的整数（`priceCents`）落簿，避免浮点比较抖动；
 * - 同价 FIFO 由自增 `seq` 决定（**禁止 Date.now 当时间优先级**，否则同毫秒订单顺序不稳）；
 * - 成交价恒取**挂单方（maker）价格**；市价单按对手盘逐档吃，吃完撤余量。
 *
 * 原型简化（真机由服务端撮合替掉）：
 * - 只有一个玩家，理论上可能与自己的挂单成交（自成交）；原型不做自成交约束。
 * - 做市商报价每拍整批撤掉重挂；玩家挂单留在簿上，靠"报价穿价"被动成交。
 * - 市价单只吃当前簿上的量（5 档做市商 + 玩家单），不无限印流动性。
 */
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
  /** 主动方方向（吃单） */
  takerSide: Side
  takerId: string
  /** 被动方订单 id：玩家挂单被吃时，客户端据此回写剩余量 */
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
  /** 做市商净库存（正 = 多头）；用于报价偏斜与库存上限 */
  private mmInventory = 0
  private playerFillQuota?: (price: number, requestedQty: number) => number

  setPlayerFillQuota(consume: (price: number, requestedQty: number) => number): void {
    this.playerFillQuota = consume
  }

  constructor(code: string) {
    this.code = code
  }

  /** 做市商当前净库存（股） */
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
    // 逐笔只留最近 100 条（页面只显示最近 20 条）
    if (this.tradeLog.length > 100) this.tradeLog.splice(0, this.tradeLog.length - 100)
  }

  private insertResting(order: BookOrder): void {
    const book = order.side === 'buy' ? this.bids : this.asks
    const queue = book.get(order.priceCents)
    if (queue) queue.push(order)
    else book.set(order.priceCents, [order])
  }

  /**
   * 吃对手盘。`limitCents === null` 表示市价（不限价）。
   * 返回吃单成交；`order.qty` 会被就地扣减为剩余量。
   */
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

  /**
   * 玩家/策略单入场。
   * - `allowRest`：限价单未成交部分是否留簿（市价一律 false，吃完撤余量）；
   * - `type` 只影响撤余量语义，撮合本身不看单型。
   */
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

  /**
   * 做市商重挂五档。为什么每拍整批重挂：原型没有撮合队列的持久状态机，
   * "撤旧挂新"等价于真实做市商跟着中间价移动报价，代码量与风险都最低。
   *
   * 库存偏斜（A-S 简化）：做市商净多 ⇒ 报价整体下移，鼓励别人买走它的库存；
   * 净空 ⇒ 整体上移。库存到上限就停挂会加重敞口的那一侧（否则永远轧不起来，也永远不爆仓）。
   */
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
      // 每档量加一点确定性抖动（用行情 RNG，保证同种子复现）
      const jitter = 0.85 + rng.next() * 0.3
      const qty = Math.max(1, Math.round(levelQty * sizeFactor * jitter))
      const bidCents = midCents - halfSpread - i * step + shift
      const askCents = midCents + halfSpread + i * step + shift
      // 库存到边就停挂"继续扩大敞口"的一侧
      if (invRatio < 0.9) fills.push(...this.makeQuote('buy', bidCents, qty, ts))
      if (invRatio > -0.9) fills.push(...this.makeQuote('sell', askCents, qty, ts))
    }
    return fills
  }

  /** 做市商单侧报价：先与簿上穿价的玩家挂单成交（玩家是 maker），余量再挂出 */
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

  /**
   * **从本地持久化恢复一条挂单**（刷新后用）：直接进簿、**不撮合**。
   * 为什么不能复用 `submit`：挂了一夜的限价单若按当前盘口重新撮合，会立刻成交并回写现金，
   * 与持久化前冻结的金额对不上；这里只重建队列，后续由 `syncRestingOrders` 按成交情况对账。
   */
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

  /** 撤单：只允许撤玩家/策略的挂单（做市商单由重挂流程整批清理） */
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

  /** 玩家挂单剩余量（客户端每拍同步用） */
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
