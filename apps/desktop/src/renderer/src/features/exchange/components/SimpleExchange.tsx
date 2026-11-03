/**
 * 极简模式 · 投资大厅主视图（SimpleExchange）。
 *
 * 布局：
 * - 左栏（250px）：星际企业榜单（SimpleStockList，4 位代码，Sparkline 走势，持仓角标）；
 * - 右栏（自适应）：
 *   1. 标的概览横幅（紧凑 header：大字现价、今日涨跌、24h 高低与成交）；
 *   2. 平滑流光渐变走势图（SimpleChart，分时/日走势/周线，呼吸微光，辅助刻度线）；
 *   3. 下方双栏（SimpleTrade 傻瓜现货买卖舱 + SimplePosition 当前持仓战报）。
 * - 紧凑高度，一屏尽览，杜绝页面滚动。
 */
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import type { GameEngine } from '../../../game/engine'
import { amount, pct, price } from '../format'
import { T } from '../texts'
import { SimpleStockList } from './SimpleStockList'
import { BondCard } from './BondCard'
import { FundCard } from './FundCard'
import { SimpleChart } from './SimpleChart'
import { SimpleTrade } from './SimpleTrade'
import { SimplePosition } from './SimplePosition'

interface SimpleExchangeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onSelectCode: (code: string) => void
  onToast: ToastFn
  /** 游戏引擎：联机模式下债券走本地存档 ISK + 本地计息 */
  engine: GameEngine
  /** 当前是否联机模式（模拟盘债券仍走 Mock 客户端） */
  isServer: boolean
  /** 刷新页面快照（基金结算后） */
  onRefresh: () => void
}

export function SimpleExchange({
  client,
  snap,
  code,
  onSelectCode,
  onToast,
  engine,
  isServer,
  onRefresh,
}: SimpleExchangeProps) {
  const quote = snap.stocks.find((s) => s.code === code) ?? snap.quote
  const isUp = quote.changePct >= 0

  return (
    <div className="ex-simple-layout">
      {/* 左栏：星际企业榜 + 低风险理财 + 保底基金 */}
      <aside className="ex-simple-col-left" aria-label="行情与理财">
        <SimpleStockList client={client} snap={snap} selected={code} onSelect={onSelectCode} />
        <BondCard
          client={client}
          snap={snap}
          onToast={onToast}
          engine={isServer ? engine : undefined}
        />
        <FundCard client={client} snap={snap} onToast={onToast} onRefresh={onRefresh} />
      </aside>

      {/* 右栏：行情主视区 + 现货买卖舱 + 持仓战报 */}
      <main className="ex-simple-main" aria-label={`${quote.nameKey} 交易大厅`}>
        {/* 标的抬头横幅 */}
        <header className="ex-simple-header">
          <div className="ex-simple-head-identity">
            <div className="ex-simple-stock-title">
              <span className="ex-simple-stock-name">{quote.nameKey}</span>
              <span className="ex-simple-stock-code">{quote.code}</span>
              <span className="ex-simple-stock-sector">{quote.sector}</span>
            </div>
            <div className="ex-simple-head-pricing">
              <span className="ex-simple-big-price ex-num">{price(quote.price)}</span>
              <span className={`ex-simple-big-change ex-num ${isUp ? 'is-up' : 'is-down'}`}>
                {pct(quote.changePct)}
              </span>
            </div>
          </div>

          <div className="ex-simple-head-stats">
            <div className="ex-simple-head-stat">
              <span className="ex-dim">{T.high24}</span>
              <b className="ex-num">{price(quote.high)}</b>
            </div>
            <div className="ex-simple-head-stat">
              <span className="ex-dim">{T.low24}</span>
              <b className="ex-num">{price(quote.low)}</b>
            </div>
            <div className="ex-simple-head-stat">
              <span className="ex-dim">{T.vol24}</span>
              <b className="ex-num">{amount(quote.volume24h)}</b>
            </div>
          </div>
        </header>

        {/* 走势图 */}
        <section className="ex-simple-chart-section">
          <SimpleChart client={client} code={code} quote={quote} tick={snap.tick} />
        </section>

        {/* 下方双栏：左边现货买卖舱，右边当前持仓战报 */}
        <div className="ex-simple-bottom-grid">
          <SimpleTrade client={client} snap={snap} code={code} onToast={onToast} />
          <SimplePosition client={client} snap={snap} code={code} onToast={onToast} />
        </div>
      </main>
    </div>
  )
}
