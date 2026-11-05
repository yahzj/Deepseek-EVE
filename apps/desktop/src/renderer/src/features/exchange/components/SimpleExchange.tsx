/**
 * 极简模式 · 投资大厅主视图（SimpleExchange）。
 *
 * 布局：
 * - 左栏（240px）：星际企业榜单（SimpleStockList，4 位代码，持仓角标）；
 * - 中栏（自适应）：
 *   1. 标的概览横幅（紧凑 header：大字现价、今日涨跌、24h 高低与成交）；
 *   2. 平滑流光渐变走势图（SimpleChart，分时/日走势/周线，呼吸微光，辅助刻度线）；
 *   3. 傻瓜多空买卖舱（SimpleTrade，买多/卖空快捷筹码输入与市价执行）；
 * - 右栏（340px）：
 *   1. 一级切换：我的委托 / 理财与基金；
 *   2. 「我的委托」是一整块：我的下注（全部持仓，单行紧凑，可逐笔结算/一键全平）
 *      + 委托列表（全部股票，回合排队 / 已成交 / 未成交 / 已撤，可逐笔与批量撤单）；
 *   3. 「理财与基金」内放 BondCard + FundCard。
 * - 紧凑高度，三栏一屏尽览，杜绝页面滚动。
 */
import { useState } from 'react'
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
import { MyOrders } from './MyOrders'

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
  // 默认理财与基金；对手盘公开动态统一由快讯第二行显示。
  const [sideTab, setSideTab] = useState<'orders' | 'finance'>('finance')

  return (
    <div className="ex-grid ex-simple-grid">
      {/* 左栏：星际企业榜 */}
      <aside className="ex-col ex-col-left ex-simple-col-left" aria-label="行情列表">
        <SimpleStockList client={client} snap={snap} selected={code} onSelect={onSelectCode} />
      </aside>

      {/* 中栏：行情主视区 + 现货/融券买卖舱 */}
      <main className="ex-col ex-col-mid ex-simple-col-mid" aria-label={`${quote.nameKey} 交易主视区`}>
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

        {/* 傻瓜买卖舱 */}
        <section className="ex-simple-trade-section">
          <SimpleTrade client={client} snap={snap} code={code} onToast={onToast} />
        </section>
      </main>

      {/* 右栏：「我的下注与委托 / 理财与基金」二级切换 */}
      <aside className="ex-col ex-col-right ex-simple-col-right" aria-label="下注、委托与理财">
        <div className="ex-simple-side-switch" role="tablist" aria-label={T.myOrdersTitle}>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'orders'}
            className={`ex-simple-side-tab${sideTab === 'orders' ? ' is-on' : ''}`}
            onClick={() => setSideTab('orders')}
          >
            {T.myOrdersTitle}
            {snap.orders.length > 0 ? ` (${snap.orders.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'finance'}
            className={`ex-simple-side-tab${sideTab === 'finance' ? ' is-on' : ''}`}
            onClick={() => setSideTab('finance')}
          >
            {T.myOrdersFinance}
          </button>
        </div>

        <div className="ex-simple-side-body">
          {sideTab === 'orders' ? (
            /* 持仓与委托合成一块：列表都覆盖全部股票，不随选中标的切换 */
            <div className="ex-simple-book">
              <SimplePosition client={client} snap={snap} onToast={onToast} />
              <div className="ex-simple-book-orders">
                <MyOrders client={client} onToast={onToast} variant="compact" />
              </div>
            </div>
          ) : (
            <div className="ex-simple-finance">
              <BondCard client={client} snap={snap} onToast={onToast} onRefresh={onRefresh} />
              <FundCard client={client} snap={snap} onToast={onToast} onRefresh={onRefresh} />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}


