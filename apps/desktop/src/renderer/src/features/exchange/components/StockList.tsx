/**
 * 左栏标的列表：双行高密度现代金融行情卡片（代码/名称/板块/现价/涨跌/持仓徽标）。
 *
 * 核心设计：
 * - 废除生硬挤压的 4 列 grid，改为左右两栏 flex 流式卡片；
 * - 左栏：代码（加粗金） + 板块微标签 + 持仓徽标 / 第二行公司全名（单行省略，绝不折行叠字）；
 * - 右栏：现价（加粗等宽） / 第二行涨跌幅微胶囊（涨多绿跌空红）；
 * - 鼠标悬停青蓝微光，选中态左侧高能光条。
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
  // 统计每个标的的持仓明细（现货、做多杠杆、做空杠杆）
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
    <section className="ex-panel ex-stock-list" aria-label={T.stockListTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.stockListTitle}</h3>
        <span className="ex-dim">{T.stockListHint}</span>
      </header>
      <div className="ex-stock-cards" role="list">
        {snap.stocks.map((q) => {
          const hold = holdMap.get(q.code) ?? { spotQty: 0, longQty: 0, shortQty: 0 }
          const up = q.changePct >= 0
          const isSel = selected === q.code
          return (
            <button
              type="button"
              key={q.code}
              role="listitem"
              className={`ex-stock-card${isSel ? ' is-sel' : ''}`}
              onClick={() => onSelect(q.code)}
              aria-pressed={isSel}
              title={`${q.nameKey} · ${q.sector}`}
            >
              {/* 左栏：代码 + 板块 + 持仓徽标 / 公司全称 */}
              <div className="ex-stock-card-left">
                <div className="ex-stock-card-row1">
                  <span className="ex-stock-code">{q.code}</span>
                  <span className="ex-stock-sector">{q.sector}</span>
                  {hold.longQty > 0 ? (
                    <span className="ex-stock-hold-badge is-long" title={`做多持仓 ${amount(hold.longQty)} 股`}>
                      多 {amount(hold.longQty)}
                    </span>
                  ) : null}
                  {hold.shortQty > 0 ? (
                    <span className="ex-stock-hold-badge is-short" title={`做空持仓 ${amount(hold.shortQty)} 股`}>
                      空 {amount(hold.shortQty)}
                    </span>
                  ) : null}
                  {hold.spotQty > 0 ? (
                    <span className="ex-stock-hold-badge is-spot" title={`现货持仓 ${amount(hold.spotQty)} 股`}>
                      持 {amount(hold.spotQty)}
                    </span>
                  ) : null}
                </div>
                <div className="ex-stock-card-row2">
                  <span className="ex-stock-fullname" title={q.nameKey}>
                    {q.nameKey}
                  </span>
                </div>
              </div>

              {/* 右栏：当前现价 / 涨跌幅微胶囊 */}
              <div className="ex-stock-card-right">
                <div className="ex-stock-price-val ex-num">{price(q.price)}</div>
                <div className="ex-stock-card-row2-right">
                  <span className={`ex-stock-pct-pill ex-num ${up ? 'is-up' : 'is-down'}`}>
                    {pct(q.changePct)}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
