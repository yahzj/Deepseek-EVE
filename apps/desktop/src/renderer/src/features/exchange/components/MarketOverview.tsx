import { T } from '../texts'
import { tr } from '../../../i18n/locale'
import { isEn } from '../../../i18n/locale'
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
  const upRatio = totalStocks > 0 ? (upCount / totalStocks) * 100 : 0
  const flatRatio = totalStocks > 0 ? (flatCount / totalStocks) * 100 : 0
  const downRatio = totalStocks > 0 ? (downCount / totalStocks) * 100 : 0

  const totalTurnover = stocks.reduce((sum, s) => sum + s.volume24h * s.price, 0)
  const totalVolume = stocks.reduce((sum, s) => sum + s.volume24h, 0)

  const indexVal = snap.index.value
  const indexPct = snap.index.changePct
  const indexBase = indexPct !== -100 ? indexVal / (1 + indexPct / 100) : indexVal
  const indexChangeVal = indexVal - indexBase
  const indexUp = indexPct >= 0

  return (
    <section className="ex-panel ex-market-overview" aria-label={T.marketBattleTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.marketBattleTitle}</h3>
        <span className="ex-dim">{T.marketBroad}</span>
      </header>
      <div className="ex-market-overview-body">
        {/* 指数行 */}
        <div className="ex-market-index-row">
          <div className="ex-market-index-main">
            <span className="ex-market-index-name">{T.indexShortName}</span>
            <span className="ex-market-index-val ex-num">{Math.round(indexVal).toLocaleString('zh-CN')}</span>
          </div>
          <div className="ex-market-index-sub">
            <div className={`ex-market-index-pill ex-num ${indexUp ? 'is-up' : 'is-down'}`}>
              <span className="ex-market-index-chg-val">
                {indexChangeVal >= 0 ? '+' : ''}{Math.round(indexChangeVal).toLocaleString('zh-CN')}
              </span>
              <span className="ex-market-index-chg-pct">
                ({pct(indexPct)})
              </span>
            </div>
          </div>
        </div>

        {/* 高低范围微标注 */}
        <div className="ex-market-range-row ex-dim">
          <span>{T.highShort} {Math.round(snap.index.high).toLocaleString('zh-CN')}</span>
          <span>{T.lowShort} {Math.round(snap.index.low).toLocaleString('zh-CN')}</span>
        </div>

        {/* 多空情绪双色槽 */}
        <div className="ex-market-ratio-box">
          <div className="ex-market-ratio-header">
            <span className="ex-dim">{T.sentimentTitle}</span>
          </div>
          <div className="ex-market-ratio-labels">
            <span className="ex-ratio-label is-up">{T.countUp} {upCount} ({Math.round(upRatio)}%)</span>
            {flatCount > 0 ? <span className="ex-ratio-label ex-dim">{T.countFlat} {flatCount}</span> : null}
            <span className="ex-ratio-label is-down">{T.countDown} {downCount} ({Math.round(downRatio)}%)</span>
          </div>
          <div
            className="ex-market-ratio-track"
            title={isEn() ? `Up: ${upCount} (${Math.round(upRatio)}%) / Flat: ${flatCount} / Down: ${downCount} (${Math.round(downRatio)}%)` : `上涨 ${upCount} 家 (${Math.round(upRatio)}%) / 平盘 ${flatCount} 家 / 下跌 ${downCount} 家 (${Math.round(downRatio)}%)`}
          >
            <div className="ex-market-ratio-fill is-up" style={{ width: `${upRatio}%` }} />
            {flatRatio > 0 ? <div className="ex-market-ratio-fill is-flat" style={{ width: `${flatRatio}%` }} /> : null}
            <div className="ex-market-ratio-fill is-down" style={{ width: `${downRatio}%` }} />
          </div>
        </div>

        {/* 全市场成交统计 */}
        <div className="ex-market-stats-group">
          <div className="ex-market-stats-row">
            <span className="ex-dim">{tr('ui.exchange.003')}</span>
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
