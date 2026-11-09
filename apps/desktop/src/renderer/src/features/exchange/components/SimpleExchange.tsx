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

/** 简单界面右栏一级切换：我的下注 / 我的委托 / 理财与基金（2026-11-06 船长令拆开） */
type SimpleSideTab = 'bets' | 'orders' | 'finance' | 'companies'

interface SimpleExchangeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onSelectCode: (code: string) => void
  onToast: ToastFn
  /** 游戏引擎：联机模式下债券走本地存档 ISK + 本地计息 */
  engine: GameEngine
  /** 已废弃：2026-11-05 移除模拟盘后不再区分数据源，仅为 tools 夹具保留 */
  isServer?: boolean
  /** 游客态：交易与持仓/理财面板保留但禁用，点击提示登录（船长 2026-11-05） */
  guest?: boolean
  /** 游客点了被禁用的面板：提示登录并打开设置「账户」页 */
  onRequireLogin?: () => void
  /** 刷新页面快照（基金结算后） */
  onRefresh: () => void
}

/**
 * 游客禁用层：面板原样留在下面（变灰、不吃指针事件），整块可点，点了就提示登录。
 * 键盘可达性靠 `inert`：React 18 的类型里没有这个属性，所以由 ref 直接落到 DOM 上。
 */
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
  // `inert` 浏览器早就支持，但 React 18 的类型里没有这个属性 ⇒ 用 ref 直接落属性：
  // 否则遮罩只挡鼠标，键盘 Tab 仍能钻进被禁用的表单里。
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
  // 默认理财与基金；对手盘公开动态统一由快讯第二行显示。
  // 2026-11-06 船长令：我的下注与我的委托拆成两个 tab，不再堆在同一块里。
  const [sideTab, setSideTab] = useState<SimpleSideTab>(() =>
    readExchangeChoice(EXCH_PREF.simpleSide, ['bets', 'orders', 'finance', 'companies'] as const, 'finance'),
  )
  const [allInFx, setAllInFx] = useState(false)
  const betCount = snap.account.holdings.length + snap.account.positions.length
  const usedOrders = Math.max(0, Math.round(snap.round?.usedOrders ?? 0))
  const maxOrders = Math.max(1, Math.round(snap.round?.maxOrders ?? 10))

  useEffect(() => {
    writeExchangePref(EXCH_PREF.simpleSide, sideTab)
  }, [sideTab])

  // 重新上线或从别的页面切回：强制把大图与左栏小图的分时线换成最新切片。
  useEffect(() => {
    client.refreshCharts?.()
  }, [client])

  // 外部入口（活动栏「债券/基金」）要求直达理财页时，已挂载的页面跟着切
  useEffect(() => {
    const onPref = (): void => {
      setSideTab(readExchangeChoice(EXCH_PREF.simpleSide, ['bets', 'orders', 'finance', 'companies'] as const, 'finance'))
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
          {/* 企业：公司账本周报（公开数据，游客也能看） */}
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'companies'}
            className={`ex-simple-side-tab${sideTab === 'companies' ? ' is-on' : ''}`}
            onClick={() => setSideTab('companies')}
          >
            {T.companyTab}
          </button>
        </div>

        <div className="ex-simple-side-body">
          {sideTab === 'companies' ? (
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


