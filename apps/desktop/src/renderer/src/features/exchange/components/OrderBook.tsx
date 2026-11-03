/**
 * 五档盘口 + 逐笔成交。
 *
 * 盘口档位是可点击按钮：排面（把价格填进右侧下单面板）是设计稿 6.1 明确要求的快捷操作，
 * 做成整行按钮比在价格上挂小链接更符合"交易所"手感，也自带键盘可达性。
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
  return (
    <section className="ex-panel ex-book" aria-label={T.bookTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.bookTitle}</h3>
        <span className="ex-dim">{T.bookClickHint}</span>
      </header>
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

/** 逐笔成交：只显示最近 12 笔，方向色块区分主动买/卖 */
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
