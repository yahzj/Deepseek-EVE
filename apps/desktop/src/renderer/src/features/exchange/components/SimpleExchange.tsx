import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Locked } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import type { GameEngine } from '../../../game/engine'
import { amount, pct, price } from '../format'
import { T, stockName } from '../texts'
import { SimpleStockList } from './SimpleStockList'
import { BondCard } from './BondCard'
import { FundCard } from './FundCard'
import { SimpleChart } from './SimpleChart'
import { EXCHANGE_PREF_EVENT, EXCH_PREF, readExchangeChoice, writeExchangePref } from '../viewPrefs'
import { SimpleTrade } from './SimpleTrade'
import { CompanyPanel } from './CompanyPanel'
import { SimplePosition } from './SimplePosition'
import { SimpleTutorial } from './SimpleTutorial'
import { MyOrders } from './MyOrders'

type SimpleSideTab = 'bets' | 'orders' | 'finance' | 'companies'

const COMPANIES_TAB_ENABLED = true
const SIMPLE_SIDE_TABS_ALL = ['bets', 'orders', 'finance', 'companies'] as const
const SIMPLE_SIDE_TABS_BASE = ['bets', 'orders', 'finance'] as const
const SIMPLE_SIDE_TABS = COMPANIES_TAB_ENABLED ? SIMPLE_SIDE_TABS_ALL : SIMPLE_SIDE_TABS_BASE

interface SimpleExchangeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onSelectCode: (code: string) => void
  onToast: ToastFn
  engine: GameEngine
  isServer?: boolean
  guest?: boolean
  onRequireLogin?: () => void
  onRefresh: () => void
}

function GuestLock({
  locked,
  label,
  onUnlock,
  children,
}: {
  locked: boolean
  label: string
  onUnlock?: () => void
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (locked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [locked])
  if (!locked) return <>{children}</>
  return (
    <div className="ex-guest-lock">
      <div className="ex-guest-lock-body" ref={bodyRef} aria-hidden="true">{children}</div>
      <button type="button" className="ex-guest-lock-veil" onClick={onUnlock}>
        <Locked size={13} /> {label}
      </button>
    </div>
  )
}

export function SimpleExchange({
  client,
  snap,
  code,
  onSelectCode,
  onToast,
  engine,
  guest = false,
  onRequireLogin,
  onRefresh,
}: SimpleExchangeProps) {
  const quote = snap.stocks.find((s) => s.code === code) ?? snap.quote
  const isUp = quote.changePct >= 0
  const [sideTab, setSideTab] = useState<SimpleSideTab>(() =>
    readExchangeChoice(EXCH_PREF.simpleSide, SIMPLE_SIDE_TABS, 'finance'),
  )
  const [allInFx, setAllInFx] = useState(false)
  const betCount = snap.account.holdings.length + snap.account.positions.length
  const usedOrders = Math.max(0, Math.round(snap.round?.usedOrders ?? 0))
  const maxOrders = Math.max(1, Math.round(snap.round?.maxOrders ?? 10))

  useEffect(() => {
    writeExchangePref(EXCH_PREF.simpleSide, sideTab)
  }, [sideTab])

  useEffect(() => {
    client.refreshCharts?.()
  }, [client])

  useEffect(() => {
    const onPref = (): void => {
      setSideTab(readExchangeChoice(EXCH_PREF.simpleSide, SIMPLE_SIDE_TABS, 'finance'))
    }
    window.addEventListener(EXCHANGE_PREF_EVENT, onPref)
    return () => window.removeEventListener(EXCHANGE_PREF_EVENT, onPref)
  }, [])

  return (
    <div className="ex-grid ex-simple-grid">
      {/* 左栏：星际企业榜 */}
      <aside className="ex-col ex-col-left ex-simple-col-left" aria-label="行情列表">
        <SimpleStockList client={client} snap={snap} selected={code} onSelect={onSelectCode} />
      </aside>

      {/* 中栏：行情主视区 + 现货/融券买卖舱 */}
      <main className="ex-col ex-col-mid ex-simple-col-mid" aria-label={`${stockName(quote.code, quote.nameKey)} 交易主视区`}>
        {/* 标的抬头横幅 */}
        <header className="ex-simple-header">
          <div className="ex-simple-head-identity">
            <div className="ex-simple-stock-title">
              <span className="ex-simple-stock-name" title={T.tipDayLimit}>{stockName(quote.code, quote.nameKey)}</span>
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
          <SimpleChart client={client} code={code} quote={quote} tick={snap.tick} allInFx={allInFx} />
        </section>

        {/* 傻瓜买卖舱（游客：保留面板但禁用，点击提示登录） */}
        <section className="ex-simple-trade-section">
          <GuestLock locked={guest} label={T.guestLockLabel} onUnlock={onRequireLogin}>
            <SimpleTrade client={client} snap={snap} code={code} onToast={onToast} onAllInFx={setAllInFx} />
          </GuestLock>
        </section>
      </main>

      {/* 右栏：「我的下注与委托 / 理财与基金」二级切换 */}
      <aside className="ex-col ex-col-right ex-simple-col-right" aria-label="下注、委托与理财">
        <div className="ex-simple-side-switch" role="tablist" aria-label={T.myOrdersTitle}>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'bets'}
            className={`ex-simple-side-tab${sideTab === 'bets' ? ' is-on' : ''}`}
            onClick={() => setSideTab('bets')}
          >
            {T.simpleBookTitle}
            {betCount > 0 ? ` (${betCount})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'orders'}
            title={T.tipOrderQuota}
            className={`ex-simple-side-tab${sideTab === 'orders' ? ' is-on' : ''}`}
            onClick={() => setSideTab('orders')}
          >
            {T.myOrdersTitle} {usedOrders}/{maxOrders}
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
          {/* 企业：公司账本周报（公开数据，游客也能看）；数据管道未就绪前按船长令隐藏 */}
          {COMPANIES_TAB_ENABLED ? (
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'companies'}
              className={`ex-simple-side-tab${sideTab === 'companies' ? ' is-on' : ''}`}
              onClick={() => setSideTab('companies')}
            >
              {T.companyTab}
            </button>
          ) : null}
        </div>

        <div className="ex-simple-side-body">
          {COMPANIES_TAB_ENABLED && sideTab === 'companies' ? (
            <div className="ex-simple-companies">
              <CompanyPanel client={client} />
            </div>
          ) : (
            <GuestLock locked={guest} label={T.guestLockLabel} onUnlock={onRequireLogin}>
              {sideTab === 'bets' ? (
                /* 我的下注：全部持仓，不随选中标的切换 */
                <div className="ex-simple-book">
                  <SimplePosition client={client} snap={snap} onToast={onToast} />
                </div>
              ) : sideTab === 'orders' ? (
                /* 我的委托：全部委托，不随选中标的切换 */
                <div className="ex-simple-book-orders">
                  <MyOrders client={client} onToast={onToast} variant="compact" />
                </div>
              ) : (
                <div className="ex-simple-finance">
                  <BondCard client={client} snap={snap} onToast={onToast} onRefresh={onRefresh} />
                  <FundCard client={client} snap={snap} onToast={onToast} onRefresh={onRefresh} />
                </div>
              )}
            </GuestLock>
          )}
        </div>
      </aside>

      <SimpleTutorial />
    </div>
  )
}


