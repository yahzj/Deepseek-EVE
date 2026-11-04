/**
 * 五档盘口 + 逐笔成交。
 *
 * 优化（对齐玩家吐槽 3）：
 * - 增加买卖量不平衡条（Depth Imbalance Bar）：实时汇总买卖五档总量，
 *   展示多空买卖压力差比例条与状态标签（多头占优 / 空头占优 / 多空均势），盘口买卖力量一目了然；
 * - 盘口档位可点击直接把价格填入下单面板。
 */
import type { BookLevel, OrderBookSnapshot, TradeRecord } from '../client'
import { amount, clock, price } from '../format'
import { T } from '../texts'

const DEPTH = 5

function padLevels(levels: BookLevel[]): Array<BookLevel | null> {
  const out: Array<BookLevel | null> = levels.slice(0, DEPTH)
  while (out.length < DEPTH) out.push(null)
  return out
}

export function OrderBook({
  book,
  onPickPrice,
}: {
  book: OrderBookSnapshot
  onPickPrice: (price: number) => void
}) {
  const asks = padLevels(book.asks)
  const bids = padLevels(book.bids)
  const maxQty = Math.max(1, ...[...asks, ...bids].map((l) => l?.qty ?? 0))
  const spread =
    book.asks[0] !== undefined && book.bids[0] !== undefined
      ? book.asks[0].price - book.bids[0].price
      : null

  // 计算买卖总量与深度不平衡比例
  const sumAsks = book.asks.reduce((s, l) => s + l.qty, 0)
  const sumBids = book.bids.reduce((s, l) => s + l.qty, 0)
  const totalDepth = sumAsks + sumBids
  const bidRatio = totalDepth > 0 ? (sumBids / totalDepth) * 100 : 50
  const askRatio = 100 - bidRatio

  const diff = bidRatio - askRatio
  const imbalanceLabel =
    diff > 10 ? T.imbalanceBuyAdv : diff < -10 ? T.imbalanceSellAdv : T.imbalanceBalanced

  return (
    <section className="ex-panel ex-book" aria-label={T.bookTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.bookTitle}</h3>
        <span className="ex-dim">{T.bookClickHint}</span>
      </header>

      {/* 买卖量不平衡条（深度差力量条） */}
      <div className="ex-imbalance-wrap" title={`${T.bookImbalance}：买方 ${sumBids} 股 / 卖方 ${sumAsks} 股`}>
        <div className="ex-imbalance-head">
          <span className="ex-imbalance-side is-bid">{bidRatio.toFixed(1)}%</span>
          <span className="ex-imbalance-tag">{imbalanceLabel}</span>
          <span className="ex-imbalance-side is-ask">{askRatio.toFixed(1)}%</span>
        </div>
        <div className="ex-imbalance-bar">
          <div className="ex-imbalance-fill is-bid" style={{ width: `${bidRatio}%` }} />
          <div className="ex-imbalance-fill is-ask" style={{ width: `${askRatio}%` }} />
        </div>
      </div>

      <div className="ex-book-legend">
        <span>{T.bookPrice}</span>
        <span>{T.bookQty}</span>
      </div>

      <div className="ex-book-side is-ask">
        {[...asks].reverse().map((level, idx) => {
          const pos = asks.length - idx
          if (!level) {
            return (
              <div className="ex-book-row is-empty" key={`ask-empty-${pos}`}>
                <span className="ex-book-lv">{T.bookAsk}{pos}</span>
                <span className="ex-num">—</span>
                <span className="ex-num">—</span>
              </div>
            )
          }
          return (
            <button
              type="button"
              className="ex-book-row"
              key={`ask-${level.price}`}
              onClick={() => onPickPrice(level.price)}
              title={`${T.bookAsk}${pos} ${price(level.price)} × ${amount(level.qty)}`}
            >
              <span className="ex-book-lv">{T.bookAsk}{pos}</span>
              <span className="ex-num is-down">{price(level.price)}</span>
              <span className="ex-num">{amount(level.qty)}</span>
              <i className="ex-book-bar is-ask" style={{ width: `${(level.qty / maxQty) * 100}%` }} />
            </button>
          )
        })}
      </div>

      <div className="ex-book-spread">
        <span>{T.bookPrice}</span>
        <b>{spread !== null ? price(spread) : '—'}</b>
      </div>

      <div className="ex-book-side is-bid">
        {bids.map((level, idx) => {
          const pos = idx + 1
          if (!level) {
            return (
              <div className="ex-book-row is-empty" key={`bid-empty-${pos}`}>
                <span className="ex-book-lv">{T.bookBid}{pos}</span>
                <span className="ex-num">—</span>
                <span className="ex-num">—</span>
              </div>
            )
          }
          return (
            <button
              type="button"
              className="ex-book-row"
              key={`bid-${level.price}`}
              onClick={() => onPickPrice(level.price)}
              title={`${T.bookBid}${pos} ${price(level.price)} × ${amount(level.qty)}`}
            >
              <span className="ex-book-lv">{T.bookBid}{pos}</span>
              <span className="ex-num is-up">{price(level.price)}</span>
              <span className="ex-num">{amount(level.qty)}</span>
              <i className="ex-book-bar is-bid" style={{ width: `${(level.qty / maxQty) * 100}%` }} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** 逐笔成交：只显示最近 14 笔，方向色块区分主动买/卖 */
export function TradeTape({ trades }: { trades: TradeRecord[] }) {
  return (
    <section className="ex-panel ex-tape" aria-label={T.tradesTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.tradesTitle}</h3>
      </header>
      <div className="ex-tape-head">
        <span>{T.recordsTime}</span>
        <span>{T.tradesPrice}</span>
        <span>{T.tradesQty}</span>
        <span>{T.tradesSide}</span>
      </div>
      <div className="ex-tape-rows">
        {trades.length === 0 ? <div className="ex-empty">{T.chartNoData}</div> : null}
        {trades.slice(0, 14).map((t) => (
          <div className="ex-tape-row" key={t.id}>
            <span className="ex-dim">{clock(t.ts)}</span>
            <span className={`ex-num ${t.side === 'buy' ? 'is-up' : 'is-down'}`}>{price(t.price)}</span>
            <span className="ex-num">{amount(t.qty)}</span>
            <span className={`ex-tape-side ${t.side === 'buy' ? 'is-up' : 'is-down'}`}>
              {t.side === 'buy' ? T.buy : T.sell}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
