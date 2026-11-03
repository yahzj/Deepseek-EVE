/**
 * 市场战况仪表（MarketOverview）。
 *
 * 填充左下角视觉空洞，增强深空证券交易所的专业战况感：
 * - 星深综合指数（SEC Composite）：点位、涨跌幅、最高/最低；
 * - 多空涨跌家数比仪表盘：红绿双色多空横槽，清晰洞察全市场涨跌结构；
 * - 全市场成交量统计与在交易标的总数。
 */
import type { ExchangeSnapshot } from '../client'
import { amount, pct } from '../format'

export function MarketOverview({ snap }: { snap: ExchangeSnapshot }) {
  const stocks = snap.stocks
  const upCount = stocks.filter((s) => s.changePct > 0).length
  const downCount = stocks.filter((s) => s.changePct < 0).length
  const flatCount = stocks.filter((s) => s.changePct === 0).length
  const totalStocks = stocks.length
  const upRatio = totalStocks > 0 ? (upCount / totalStocks) * 100 : 50
  const downRatio = totalStocks > 0 ? (downCount / totalStocks) * 100 : 50

  const totalVolume = stocks.reduce((sum, s) => sum + s.volume24h, 0)
  const indexUp = snap.index.changePct >= 0

  return (
    <section className="ex-panel ex-market-overview" aria-label="全市场战况大盘">
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">市场战况</h3>
        <span className="ex-dim">星深大盘</span>
      </header>
      <div className="ex-market-overview-body">
        {/* 指数行 */}
        <div className="ex-market-index-row">
          <div className="ex-market-index-main">
            <span className="ex-market-index-name">星深综指</span>
            <span className="ex-market-index-val ex-num">{snap.index.value.toFixed(1)}</span>
          </div>
          <div className="ex-market-index-sub">
            <span className={`ex-market-index-pill ex-num ${indexUp ? 'is-up' : 'is-down'}`}>
              {pct(snap.index.changePct)}
            </span>
          </div>
        </div>

        {/* 高低范围微标注 */}
        <div className="ex-market-range-row ex-dim">
          <span>高 {snap.index.high.toFixed(1)}</span>
          <span>低 {snap.index.low.toFixed(1)}</span>
        </div>

        {/* 涨跌家数比 */}
        <div className="ex-market-ratio-box">
          <div className="ex-market-ratio-labels">
            <span className="ex-ratio-label is-up">涨 {upCount}</span>
            <span className="ex-ratio-label ex-dim">平 {flatCount}</span>
            <span className="ex-ratio-label is-down">跌 {downCount}</span>
          </div>
          <div className="ex-market-ratio-track" title={`涨 ${upCount} / 平 ${flatCount} / 跌 ${downCount}`}>
            <div className="ex-market-ratio-fill is-up" style={{ width: `${upRatio}%` }} />
            <div className="ex-market-ratio-fill is-down" style={{ width: `${downRatio}%` }} />
          </div>
        </div>

        {/* 24h 成交统计 */}
        <div className="ex-market-stats-row">
          <span className="ex-dim">全市场成交量</span>
          <span className="ex-num ex-market-vol-num">{amount(totalVolume)} 股</span>
        </div>
      </div>
    </section>
  )
}
