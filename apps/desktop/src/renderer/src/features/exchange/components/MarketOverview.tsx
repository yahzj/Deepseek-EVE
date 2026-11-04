/**
 * 市场战况仪表（MarketOverview）。
 *
 * 填充左下角视觉空洞，增强深空证券交易所的专业战况感：
 * - 星深综合指数（SEC Composite）：点位、涨跌幅、最高/最低；
 * - 多空涨跌家数比仪表盘：红绿双色多空横槽，清晰洞察全市场涨跌结构；
 * - 全市场成交量统计与在交易标的总数。
 */
import type { ExchangeSnapshot } from '../client'
import { amount, pct, turnover } from '../format'

export function MarketOverview({ snap }: { snap: ExchangeSnapshot }) {
  const stocks = snap.stocks
  const upCount = stocks.filter((s) => s.changePct > 0).length
  const downCount = stocks.filter((s) => s.changePct < 0).length
  const flatCount = stocks.filter((s) => s.changePct === 0).length
  const totalStocks = stocks.length
  const upRatio = totalStocks > 0 ? (upCount / totalStocks) * 100 : 50
  const flatRatio = totalStocks > 0 ? (flatCount / totalStocks) * 100 : 0
  const downRatio = totalStocks > 0 ? (downCount / totalStocks) * 100 : 50

  const totalTurnover = stocks.reduce((sum, s) => sum + s.volume24h * s.price, 0)
  const totalVolume = stocks.reduce((sum, s) => sum + s.volume24h, 0)

  const indexVal = snap.index.value
  const indexPct = snap.index.changePct
  const indexBase = indexPct !== -100 ? indexVal / (1 + indexPct / 100) : indexVal
  const indexChangeVal = indexVal - indexBase
  const indexUp = indexPct >= 0
  const sentiment = upCount > downCount ? '多头占优' : downCount > upCount ? '空头占优' : '多空平衡'

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
            <span className="ex-market-index-val ex-num">{indexVal.toFixed(1)}</span>
          </div>
          <div className="ex-market-index-sub">
            <div className={`ex-market-index-pill ex-num ${indexUp ? 'is-up' : 'is-down'}`}>
              <span className="ex-market-index-chg-val">
                {indexChangeVal >= 0 ? '+' : ''}{indexChangeVal.toFixed(1)}
              </span>
              <span className="ex-market-index-chg-pct">
                ({pct(indexPct)})
              </span>
            </div>
          </div>
        </div>

        {/* 高低范围微标注 */}
        <div className="ex-market-range-row ex-dim">
          <span>高 {snap.index.high.toFixed(1)}</span>
          <span>低 {snap.index.low.toFixed(1)}</span>
        </div>

        {/* 多空情绪双色槽 */}
        <div className="ex-market-ratio-box">
          <div className="ex-market-ratio-header">
            <span className="ex-dim">多空情绪</span>
            <span className={`ex-market-sentiment-tag ${upCount > downCount ? 'is-up' : downCount > upCount ? 'is-down' : 'is-flat'}`}>
              {sentiment}
            </span>
          </div>
          <div className="ex-market-ratio-labels">
            <span className="ex-ratio-label is-up">涨 {upCount} ({Math.round(upRatio)}%)</span>
            {flatCount > 0 ? <span className="ex-ratio-label ex-dim">平 {flatCount}</span> : null}
            <span className="ex-ratio-label is-down">跌 {downCount} ({Math.round(downRatio)}%)</span>
          </div>
          <div
            className="ex-market-ratio-track"
            title={`上涨 ${upCount} 家 (${Math.round(upRatio)}%) / 平盘 ${flatCount} 家 / 下跌 ${downCount} 家 (${Math.round(downRatio)}%)`}
          >
            <div className="ex-market-ratio-fill is-up" style={{ width: `${upRatio}%` }} />
            {flatRatio > 0 ? <div className="ex-market-ratio-fill is-flat" style={{ width: `${flatRatio}%` }} /> : null}
            <div className="ex-market-ratio-fill is-down" style={{ width: `${downRatio}%` }} />
          </div>
        </div>

        {/* 全市场成交统计 */}
        <div className="ex-market-stats-group">
          <div className="ex-market-stats-row">
            <span className="ex-dim">全市场成交额</span>
            <span className="ex-num ex-market-stat-num is-highlight">{turnover(totalTurnover)}</span>
          </div>
          <div className="ex-market-stats-row">
            <span className="ex-dim">全市场成交量</span>
            <span className="ex-num ex-market-stat-num">{amount(totalVolume)} 股</span>
          </div>
        </div>
      </div>
    </section>
  )
}
