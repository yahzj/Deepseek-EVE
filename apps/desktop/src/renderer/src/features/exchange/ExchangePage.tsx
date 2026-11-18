import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Analytics, Portfolio } from '@carbon/icons-react'
import type { PageProps } from '../../pages/common'
import type { MarginCallPayload } from './client'
import type { ExchangeClientBundle, ExchangeSourceInfo } from './factory'
import { createExchangeClient } from './factory'
import { CLOUD_SESSION_CHANGE_EVENT } from '../cloud/preferences'
import { EXCH_PREF, EXCHANGE_PREF_EVENT } from './viewPrefs'
import { amount, money, pct, pctAbs } from './format'
import { T, TF } from './texts'
import { Cashier } from './components/Cashier'
import {
  getExchangeSelectedCode,
  setExchangeSelectedCode,
  subscribeExchangeSelectedCode,
} from './selectedCode'
import { NewsTicker } from './components/NewsTicker'
import { setCrtBusy } from '../../ui/crtEffect'
import { SimpleExchange } from './components/SimpleExchange'
import { ProExchange } from './components/ProExchange'
import { RoundBadge } from './components/RoundBadge'
import './exchange.css'

const VIEW_MODE_KEY = EXCH_PREF.viewMode

const PRO_MODE_ENABLED = import.meta.env.DEV

export function ExchangePage({ engine, onToast, onOpenSettings }: PageProps) {
  useEffect(() => {
    setCrtBusy('exchange', true)
    return () => setCrtBusy('exchange', false)
  }, [])
  const [authTick, bumpAuth] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const onChange = (): void => bumpAuth()
    window.addEventListener(CLOUD_SESSION_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CLOUD_SESSION_CHANGE_EVENT, onChange)
  }, [])
  const bundle = useMemo(() => createExchangeClient(), [authTick])
  if (bundle.error) return <ExchangeGuide bundle={bundle} />
  return (
    <ExchangeBody
      key={bundle.source.auth}
      bundle={bundle}
      engine={engine}
      onToast={onToast}
      onOpenSettings={onOpenSettings}
    />
  )
}

function SourceBadge({ source }: { source: ExchangeSourceInfo }) {
  const guest = source.auth === 'guest'
  return (
    <span
      className={`ex-source-badge${guest ? ' is-guest' : ' is-server'}`}
      title={`${T.sourceBadgeHint}：${source.serverUrl}`}
    >
      {guest ? T.sourceGuest : T.sourceAccount}
    </span>
  )
}

function ExchangeGuide({ bundle }: { bundle: ExchangeClientBundle }) {
  return (
    <div className="page-stack page-fill ex-page ex-guide-page">
      <header className="ex-topbar">
        <div className="ex-title">
          <h2 className="ex-title-text">{T.simpleTopTitle}</h2>
          
        </div>
        <div className="ex-top-actions">
          <SourceBadge source={bundle.source} />
        </div>
      </header>
      <section className="ex-panel ex-guide" aria-label={T.guideTitle}>
        <h3 className="ex-guide-title">{T.guideTitle}</h3>
        <p className="ex-guide-text">{bundle.error?.message}</p>
        <p className="ex-guide-hint">{T.guideHint}</p>
      </section>
    </div>
  )
}

function ExchangeBody({
  bundle,
  engine,
  onToast,
  onOpenSettings,
}: {
  bundle: ExchangeClientBundle
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  onOpenSettings?: PageProps['onOpenSettings']
}) {
  const client = bundle.client
  const guest = bundle.source.auth === 'guest'
  const requireLogin = (): void => {
    onToast(T.guestNeedLogin, true)
    onOpenSettings?.('account')
  }
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const [code, setCode] = useState(getExchangeSelectedCode)
  const codeRef = useRef(code)
  codeRef.current = code
  const [pickedPrice, setPickedPrice] = useState<{ value: number; seq: number } | null>(null)

  useEffect(() => {
    return subscribeExchangeSelectedCode((nextCode) => {
      setCode(nextCode)
      setPickedPrice(null)
    })
  }, [])
  const [cashier, setCashier] = useState<'deposit' | 'withdraw' | null>(null)

  const [viewMode, setViewMode] = useState<'simple' | 'pro'>(() => {
    if (!PRO_MODE_ENABLED) return 'simple'
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY)
      return saved === 'pro' ? 'pro' : 'simple'
    } catch {
      return 'simple'
    }
  })

  useEffect(() => {
    const onPref = (): void => {
      if (!PRO_MODE_ENABLED) {
        setViewMode('simple')
        return
      }
      try {
        const saved = localStorage.getItem(VIEW_MODE_KEY)
        setViewMode(saved === 'pro' ? 'pro' : 'simple')
      } catch {
      }
    }
    window.addEventListener(EXCHANGE_PREF_EVENT, onPref)
    return () => window.removeEventListener(EXCHANGE_PREF_EVENT, onPref)
  }, [])

  const switchViewMode = (mode: 'simple' | 'pro') => {
    if (mode === 'pro' && !PRO_MODE_ENABLED) return
    if (mode === 'pro' && guest) {
      requireLogin()
      return
    }
    if (viewMode === mode) return
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
    }
  }

  const shownMode: 'simple' | 'pro' = guest || !PRO_MODE_ENABLED ? 'simple' : viewMode
  const proLocked = guest || !PRO_MODE_ENABLED

  const toastRef = useRef(onToast)
  toastRef.current = onToast

  useEffect(() => {
    const stopTick = client.onTick(bump)
    const stopMargin = client.on('margin_call', (payload) => {
      const call = payload as MarginCallPayload
      const side = call.side === 'long' ? T.posSideLong : T.posSideShort
      toastRef.current(TF.marginCalled(call.code, side, amount(call.qty)), true)
    })
    const stopError = client.on('error', (payload) => {
      toastRef.current(TF.dataLoadFailed(payload instanceof Error ? payload.message : String(payload)), true)
      window.setTimeout(() => client.retryBootstrap?.(), 1200)
    })
    const watchdog = window.setInterval(() => {
      if (client.getSnapshot(codeRef.current).stocks.length === 0) client.retryBootstrap?.()
    }, 3000)
    const marketRefresh = window.setInterval(() => {
      void client.refreshMarketData?.(codeRef.current)
    }, 10_000)
    client.start()
    return () => {
      window.clearInterval(watchdog)
      window.clearInterval(marketRefresh)
      stopTick()
      stopMargin()
      stopError()
      client.stop()
    }
  }, [client])

  const snap = useMemo(() => client.getSnapshot(code), [client, code, tick])

  const [dataStale, setDataStale] = useState(false)
  useEffect(() => {
    if (snap.stocks.length > 0) {
      setDataStale(false)
      return
    }
    const timer = window.setTimeout(() => setDataStale(true), 4000)
    return () => window.clearTimeout(timer)
  }, [snap.stocks.length])

  useEffect(() => {
    if (snap.stocks.length === 0) return
    const hasChart = client.getChartSeries(code, 'm1').length > 0
    const hasBook = snap.book.bids.length + snap.book.asks.length > 0
    if (hasChart && hasBook) return
    client.ensureSymbolData?.(code)
  }, [client, code, tick, snap.book.bids.length, snap.book.asks.length])

  const marginUsed = snap.account.positions.reduce((sum, p) => sum + p.margin, 0)
  const marginRatio = marginUsed > 0 ? pctAbs(snap.account.marginRatio * 100) : '—'
  const bondTotal = snap.bonds.principal + snap.bonds.accrued
  const up = snap.index.changePct >= 0

  const totalUnrealizedPnl = useMemo(() => {
    let sum = 0
    for (const h of snap.account.holdings) {
      const q = snap.stocks.find((s) => s.code === h.code)
      if (q) sum += (q.price - h.avgCost) * h.qty
    }
    for (const p of snap.account.positions) {
      sum += p.unrealizedPnl
    }
    return sum
  }, [snap])

  const pnlUp = totalUnrealizedPnl >= 0

  const holdingsValue = useMemo(() => {
    let sum = 0
    for (const h of snap.account.holdings) {
      const q = snap.stocks.find((s) => s.code === h.code)
      if (q) sum += q.price * h.qty
    }
    return sum
  }, [snap])

  const selectCode = (next: string): void => {
    setExchangeSelectedCode(next)
    setCode(next)
    setPickedPrice(null)
  }

  const pickPrice = (value: number): void => {
    setPickedPrice((prev) => ({ value, seq: (prev?.seq ?? 0) + 1 }))
  }

  return (
    <div className={`page-stack page-fill ex-page ex-mode-${shownMode}`}>
      {/* 顶栏：三段式逻辑架构（左：品牌与模式；中：市场与回合状态；右：个人核心资产与出入金操作） */}
      <header className="ex-topbar">
        {/* 左区：品牌名称 + 核心双模式 Segmented Tabs */}
        <div className="ex-topbar-left">
          <div className="ex-title">
            <h2 className="ex-title-row">
              <span className="ex-title-prefix">{T.titlePrefix}</span>
              <span className="ex-title-suffix">{T.titleSuffix}</span>
            </h2>
            <div className="ex-title-sub-row">
              <SourceBadge source={bundle.source} />
            </div>
          </div>

          <div className="ex-mode-tabs" role="tablist" aria-label={T.viewModeSimple}>
            <button
              type="button"
              role="tab"
              aria-selected={shownMode === 'simple'}
              className={`ex-mode-tab ex-mode-tab-simple${shownMode === 'simple' ? ' is-active' : ''}`}
              onClick={() => switchViewMode('simple')}
            >
              <span className="ex-mode-tab-title"><Portfolio size={14} /> {T.viewModeSimple}</span>
              <span className="ex-mode-tab-sub">{T.modeSpotSub}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shownMode === 'pro'}
              aria-disabled={proLocked || undefined}
              disabled={!PRO_MODE_ENABLED || undefined}
              title={!PRO_MODE_ENABLED ? T.proModeLocked : guest ? T.guestProLocked : undefined}
              className={`ex-mode-tab ex-mode-tab-pro${shownMode === 'pro' ? ' is-active' : ''}${proLocked ? ' is-guest-locked' : ''}`}
              onClick={() => switchViewMode('pro')}
            >
              <span className="ex-mode-tab-title"><Analytics size={14} /> {T.viewModePro}</span>
              <span className="ex-mode-tab-sub">{T.modeProSub}</span>
            </button>
          </div>
        </div>

        {/* 中区：交易所运行状态（回合倒计时 + 本回合委托配额）及专业模式大盘指数 */}
        <div className="ex-topbar-status">
          <RoundBadge
            client={client}
            onNewRound={bump}
            onRefreshMarket={
              typeof client.refreshMarketData === 'function'
                ? () => { void client.refreshMarketData?.(codeRef.current) }
                : undefined
            }
          />
          {shownMode === 'pro' ? (
            <div className="ex-index" title={T.indexName}>
              <span className="ex-dim">{T.indexName}</span>
              <b className="ex-num">{Math.round(snap.index.value).toLocaleString('zh-CN')}</b>
              <span className={`ex-num ${up ? 'is-up' : 'is-down'}`}>{pct(snap.index.changePct)}</span>
            </div>
          ) : null}
        </div>

        {/* 右区：个人账户核心资产看板 + 出入金操作（两模式像素级绝对一致，零跳动） */}
        <div className="ex-topbar-right">
          <div className="ex-topbar-stats">
            <div className="ex-stat is-cash">
              <span className="ex-stat-tag">{T.availableCash}<small> // CASH</small></span>
              <b className="ex-num">{money(snap.account.cash)}</b>
            </div>
            <div className="ex-stat is-holdings">
              <span className="ex-stat-tag">{T.holdingsValue}<small> // HOLDINGS</small></span>
              <b className="ex-num">{money(holdingsValue)}</b>
            </div>
            <div className={`ex-stat is-pnl ${pnlUp ? 'is-up' : 'is-down'}`}>
              <span className="ex-stat-tag">{T.unrealizedPnl}<small> // PNL</small></span>
              <b className={`ex-num ${pnlUp ? 'is-up' : 'is-down'}`}>
                {pnlUp ? '+' : ''}{money(totalUnrealizedPnl)}
              </b>
            </div>
            {shownMode === 'simple' ? (
              <div className="ex-stat is-bond">
                <span className="ex-stat-tag">{T.bondValue}<small> // BOND</small></span>
                <b className="ex-num">{money(bondTotal)}</b>
              </div>
            ) : (
              <div className="ex-stat is-margin">
                <span className="ex-stat-tag">{T.marginRatio}<small> // MARGIN</small></span>
                <b className="ex-num">{marginRatio}</b>
              </div>
            )}
          </div>

          <div className="ex-topbar-actions">
            <button
              type="button"
              className={`ex-mini-btn is-deposit${guest ? ' is-guest-locked' : ''}`}
              data-sfx="exchange-withdraw"
              aria-disabled={guest || undefined}
              onClick={() => (guest ? requireLogin() : setCashier('deposit'))}
            >
              {T.deposit}
            </button>
            <button
              type="button"
              className={`ex-mini-btn is-withdraw${guest ? ' is-guest-locked' : ''}`}
              data-sfx="exchange-deposit"
              aria-disabled={guest || undefined}
              onClick={() => (guest ? requireLogin() : setCashier('withdraw'))}
            >
              {T.withdraw}
            </button>
          </div>
        </div>
      </header>

      {/* 游客横幅：行情照常看，交易/持仓/理财要登录（2026-11-05 船长令） */}
      {guest ? (
        <div className="ex-guest-banner" role="status">
          <span className="ex-guest-banner-text">{T.guestBanner}</span>
          <button type="button" className="ex-mini-btn is-accent" onClick={requireLogin}>
            {T.guestBannerAction}
          </button>
        </div>
      ) : null}

      {/* 财经快讯：紧随顶栏下方，第一行市场事件、第二行对手盘动作（2026-11-04 船长口径） */}
      <NewsTicker news={snap.news} agents={snap.agents} onSelectCode={selectCode} />

      {/* 行情空数据提示：4 秒仍无 stocks 时显示原因入口，避免只剩空面板 */}
      {dataStale ? (
        <div className="ex-guide" role="alert">
          <p className="ex-guide-text">{T.dataEmptyHint}</p>
          <button
            type="button"
            className="ex-mini-btn"
            onClick={() => {
              client.retryBootstrap?.()
              window.setTimeout(bump, 600)
            }}
          >
            {T.dataRetry}
          </button>
        </div>
      ) : null}

      {/* 主视图区：根据当前模式渲染（游客强制极简模式，见 shownMode） */}
      {shownMode === 'simple' ? (
        <SimpleExchange
          client={client}
          snap={snap}
          code={code}
          onSelectCode={selectCode}
          onToast={onToast}
          engine={engine}
          guest={guest}
          onRequireLogin={requireLogin}
          onRefresh={bump}
        />
      ) : (
        <ProExchange
          client={client}
          snap={snap}
          code={code}
          pickedPrice={pickedPrice}
          onSelectCode={selectCode}
          onPickPrice={pickPrice}
          onToast={onToast}
        />
      )}

      {/* 入金 / 出金弹窗：资金闸门，关闭后回到原模式 */}
      {cashier !== null ? (
        <Cashier
          mode={cashier}
          cash={snap.account.cash}
          client={client}
          localIsk={engine.state.wallet.isk}
          onLocalDelta={(delta) => engine.exchangeWalletDelta(delta)}
          onToast={onToast}
          onClose={() => setCashier(null)}
          onRefresh={bump}
        />
      ) : null}
    </div>
  )
}

