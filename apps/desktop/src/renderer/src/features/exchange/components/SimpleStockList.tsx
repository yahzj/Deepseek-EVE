/**
 * 极简模式 · 左栏星际企业榜（约 250px）。
 *
 * 紧凑卡片式展示 4 位代码股票（SMHI、UGMC、OJLS、ABSI）：
 * - 4 位代码 + 公司名 + 现价大字 + 今日涨跌 + 名字右侧 Sparkline 小走势（2026-11-04 船长：必须保留）；
 * - 若持有该公司股票，卡片右上角显示精致角标「持仓 X 股」。
 */
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import { amount, pct, price } from '../format'
import { T } from '../texts'
import { Sparkline } from './Sparkline'

interface SimpleStockListProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  selected: string
  onSelect: (code: string) => void
}

export function SimpleStockList({ client, snap, selected, onSelect }: SimpleStockListProps) {
  // 统计每只股票的持仓明细（现货、做多杠杆、做空杠杆）
  const holdMap = new Map<string, { spotQty: number; longQty: number; shortQty: number }>()
  for (const h of snap.account.holdings) {
    const cur = holdMap.get(h.code) ?? { spotQty: 0, longQty: 0, shortQty: 0 }
    cur.spotQty += h.qty
    holdMap.set(h.code, cur)
  }
  for (const p of snap.account.positions) {
    const cur = holdMap.get(p.code) ?? { spotQty: 0, longQty: 0, shortQty: 0 }
    if (p.side === 'long') cur.longQty += p.qty
    else if (p.side === 'short') cur.shortQty += p.qty
    holdMap.set(p.code, cur)
  }

  return (
    <section className="ex-simple-sidebar" aria-label={T.stockListTitle}>
      <div className="ex-simple-side-head">
        <h3 className="ex-simple-side-title">星际企业榜</h3>
        <span className="ex-dim">4 核心股票</span>
      </div>

      <div className="ex-simple-card-list" role="list">
        {snap.stocks.map((q) => {
          const isSel = selected === q.code
          const hold = holdMap.get(q.code) ?? { spotQty: 0, longQty: 0, shortQty: 0 }
          const up = q.changePct >= 0
          const hasHolding = hold.spotQty > 0 || hold.longQty > 0 || hold.shortQty > 0

          return (
            <div
              key={q.code}
              role="button"
              tabIndex={0}
              className={`ex-simple-stock-card${isSel ? ' is-sel' : ''}`}
              onClick={() => onSelect(q.code)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(q.code)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  const idx = snap.stocks.findIndex((s) => s.code === q.code)
                  if (idx >= 0 && idx < snap.stocks.length - 1) {
                    onSelect(snap.stocks[idx + 1].code)
                  }
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  const idx = snap.stocks.findIndex((s) => s.code === q.code)
                  if (idx > 0) {
                    onSelect(snap.stocks[idx - 1].code)
                  }
                }
              }}
              aria-pressed={isSel}
              aria-label={`${q.code} ${q.nameKey} 现价 ${price(q.price)} 涨跌 ${pct(q.changePct)}`}
            >
              {/* 持仓角标群 */}
              {hasHolding ? (
                <div className="ex-simple-holding-badges">
                  {hold.longQty > 0 ? (
                    <span className="ex-simple-holding-badge is-long" title={`做多持仓 ${amount(hold.longQty)} 股`}>
                      多 {amount(hold.longQty)}
                    </span>
                  ) : null}
                  {hold.shortQty > 0 ? (
                    <span className="ex-simple-holding-badge is-short" title={`做空持仓 ${amount(hold.shortQty)} 股`}>
                      空 {amount(hold.shortQty)}
                    </span>
                  ) : null}
                  {hold.spotQty > 0 ? (
                    <span className="ex-simple-holding-badge is-spot" title={`现货持仓 ${amount(hold.spotQty)} 股`}>
                      持 {amount(hold.spotQty)}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* 卡片头部：代码 + 名称 + 板块 */}
              <div className="ex-simple-card-top">
                <span className="ex-simple-card-code">{q.code}</span>
                <span className="ex-simple-card-name" title={q.nameKey}>{q.nameKey}</span>
                <span className="ex-simple-card-sector">{q.sector}</span>
              </div>

              {/* 卡片中间与右侧：现价、涨跌幅、Sparkline */}
              <div className="ex-simple-card-main">
                <div className="ex-simple-card-price-col">
                  <div className="ex-simple-card-price ex-num">{price(q.price)}</div>
                  <div className={`ex-simple-card-change ex-num ${up ? 'is-up' : 'is-down'}`}>
                    {pct(q.changePct)}
                  </div>
                </div>

                <div className="ex-simple-card-spark">
                  <Sparkline client={client} code={q.code} isUp={up} width={72} height={24} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
