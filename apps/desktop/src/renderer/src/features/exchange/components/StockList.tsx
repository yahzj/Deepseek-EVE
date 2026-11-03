/**
 * 左栏标的列表：代码 / 名称 / 板块 / 现价 / 涨跌 / 持仓。
 *
 * 为什么持仓角标放这里：船长要判断"长线持有 + 短线梭哈同屏"的手感，切标的时必须一眼看到
 * 自己在这只票上还有没有仓位，否则会反复点进点出。
 */
import type { ExchangeSnapshot } from '../client'
import { amount, pct, price } from '../format'
import { T } from '../texts'

export function StockList({
  snap,
  selected,
  onSelect,
}: {
  snap: ExchangeSnapshot
  selected: string
  onSelect: (code: string) => void
}) {
  const held = new Map<string, number>()
  for (const h of snap.account.holdings) held.set(h.code, (held.get(h.code) ?? 0) + h.qty)
  for (const p of snap.account.positions) held.set(p.code, (held.get(p.code) ?? 0) + p.qty)
  return (
    <section className="ex-panel ex-stock-list" aria-label={T.stockListTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.stockListTitle}</h3>
        <span className="ex-dim">{T.stockListHint}</span>
      </header>
      <div className="ex-stock-head" aria-hidden="true">
        <span>{T.colCode}</span>
        <span>{T.colPrice}</span>
        <span>{T.colChange}</span>
        <span>{T.colHolding}</span>
      </div>
      <div className="ex-stock-rows">
        {snap.stocks.map((q) => {
          const hold = held.get(q.code) ?? 0
          const up = q.changePct >= 0
          return (
            <button
              type="button"
              key={q.code}
              className={`ex-stock-row${selected === q.code ? ' is-sel' : ''}`}
              onClick={() => onSelect(q.code)}
              aria-pressed={selected === q.code}
              title={`${q.nameKey} · ${q.sector}`}
            >
              <span className="ex-stock-name">
                <b>{q.code}</b>
                <i>{q.nameKey}</i>
                <em>{q.sector}</em>
              </span>
              <span className="ex-num">{price(q.price)}</span>
              <span className={`ex-num ${up ? 'is-up' : 'is-down'}`}>{pct(q.changePct)}</span>
              <span className={`ex-num ex-stock-hold${hold > 0 ? ' is-held' : ''}`}>
                {hold > 0 ? amount(hold) : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
