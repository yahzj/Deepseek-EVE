/**
 * 极简模式 · 左栏星际企业榜（约 300px）。
 *
 * 极简卡片式展示 4 位代码股票（SMHI、UGMC、OJLS、ABSI）：
 * - 4 位代码 + 公司名 + 现价大字 + 今日涨跌 + Sparkline 小走势；
 * - 若持有该公司股票，卡片右上角显示精致角标「持仓 X 股」；
 * - 极简模式下不显示债券理财卡（BondCard），保持专注纯粹。
 */
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import { amount, pct, price } from '../format'
import { T, TF } from '../texts'
import { Sparkline } from './Sparkline'

interface SimpleStockListProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  selected: string
  onSelect: (code: string) => void
}

export function SimpleStockList({ client, snap, selected, onSelect }: SimpleStockListProps) {
  // 统计每只股票的持仓数量（现货 + 杠杆仓总和）
  const held = new Map<string, number>()
  for (const h of snap.account.holdings) {
    held.set(h.code, (held.get(h.code) ?? 0) + h.qty)
  }
  for (const p of snap.account.positions) {
    held.set(p.code, (held.get(p.code) ?? 0) + p.qty)
  }

  return (
    <aside className="ex-simple-sidebar" aria-label={T.stockListTitle}>
      <div className="ex-simple-side-head">
        <h3 className="ex-simple-side-title">星际企业榜</h3>
        <span className="ex-dim">4 核心标的</span>
      </div>

      <div className="ex-simple-card-list" role="list">
        {snap.stocks.map((q) => {
          const isSel = selected === q.code
          const hold = held.get(q.code) ?? 0
          const up = q.changePct >= 0

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
                }
              }}
              aria-pressed={isSel}
            >
              {/* 持仓角标 */}
              {hold > 0 ? (
                <div className="ex-simple-holding-badge">
                  {TF.holdingsCountBadge(amount(hold))}
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
                  <Sparkline client={client} code={q.code} isUp={up} width={82} height={26} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
