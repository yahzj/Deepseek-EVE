/**
 * 证券交易所 · 一级页（**深空证券交易所 DSSE · 双模式**）。
 *
 * 核心升级：
 * - 极简 / 专业 双模式 Segmented Tabs 一览无遗，一键切换（持久化到 `localStorage['whale-idle:exch-view-mode']`）；
 * - 纯净硬核科幻 HUD 视觉，彻底去除 emoji；
 * - 极简模式：双栏清爽布局，4位代码股票，Sparkline，流光渐变面积图，傻瓜现货买卖舱，当前持仓战报，零门槛；
 * - 专业模式：三栏全功能 HUD PRO，逐仓杠杆，五档深度盘口（含买卖量不平衡条），量化网格与流水；
 * - 共享同一个 Client 单例与快照，切换模式零延迟、状态零丢失。
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Analytics, Portfolio, Reset } from '@carbon/icons-react'
import type { PageProps } from '../../pages/common'
import type { MarginCallPayload } from './client'
import type { ExchangeClientBundle, ExchangeSourceInfo } from './factory'
import { createExchangeClient } from './factory'
import { amount, money, pct, pctAbs } from './format'
import { T, TF } from './texts'
import { Cashier } from './components/Cashier'
import {
  getExchangeSelectedCode,
  setExchangeSelectedCode,
  subscribeExchangeSelectedCode,
} from './selectedCode'
import { NewsTicker } from './components/NewsTicker'
import { SimpleExchange } from './components/SimpleExchange'
import { ProExchange } from './components/ProExchange'
import { RoundBadge } from './components/RoundBadge'
import './exchange.css'

const VIEW_MODE_KEY = 'whale-idle:exch-view-mode'

export function ExchangePage({ engine, onToast }: PageProps) {
  const bundle = useMemo(() => createExchangeClient(), [])
  if (bundle.error) return <ExchangeGuide bundle={bundle} />
  return <ExchangeBody bundle={bundle} engine={engine} onToast={onToast} />
}

/** 数据源徽标（模拟盘 / 服务器） */
function SourceBadge({ source }: { source: ExchangeSourceInfo }) {
  const mock = source.mode === 'mock'
  return (
    <span
      className={`ex-source-badge${mock ? ' is-mock' : ' is-server'}`}
      title={source.serverUrl ? `${T.sourceBadgeHint}：${source.serverUrl}` : T.sourceBadgeHint}
    >
      {mock ? T.sourceMock : T.sourceServer}
    </span>
  )
}

/** HTTP 模式但没服务器/传输层：引导态 */
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
}: {
  bundle: ExchangeClientBundle
  engine: PageProps['engine']
  onToast: PageProps['onToast']
}) {
  const client = bundle.client
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const [code, setCode] = useState(getExchangeSelectedCode)
  const codeRef = useRef(code)
  codeRef.current = code
  const [pickedPrice, setPickedPrice] = useState<{ value: number; seq: number } | null>(null)

  // 响应外部（如活动栏快捷监控微卡片）的标的高亮切换
  useEffect(() => {
    return subscribeExchangeSelectedCode((nextCode) => {
      setCode(nextCode)
      setPickedPrice(null)
    })
  }, [])
  // 入金 / 出金弹窗：null = 关闭
  const [cashier, setCashier] = useState<'deposit' | 'withdraw' | null>(null)

  // 极简 / 专业 双模式状态（默认极简）
  const [viewMode, setViewMode] = useState<'simple' | 'pro'>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY)
      return saved === 'pro' ? 'pro' : 'simple'
    } catch {
      return 'simple'
    }
  })

  const switchViewMode = (mode: 'simple' | 'pro') => {
    if (viewMode === mode) return
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // ignore
    }
  }

  const toastRef = useRef(onToast)
  toastRef.current = onToast

  useEffect(() => {
    const stopTick = client.onTick(bump)
    const stopMargin = client.on('margin_call', (payload) => {
      const call = payload as MarginCallPayload
      const side = call.side === 'long' ? T.posSideLong : T.posSideShort
      toastRef.current(TF.marginCalled(call.code, side, amount(call.qty)), true)
    })
    // 数据链路错误可见化：bootstrap/WS 失败时明确弹提示，避免页面只剩「没数据」看不出原因。
    const stopError = client.on('error', (payload) => {
      toastRef.current(TF.dataLoadFailed(payload instanceof Error ? payload.message : String(payload)), true)
      window.setTimeout(() => client.retryBootstrap?.(), 1200)
    })
    // 行情看门狗：HMR 半更新/首拉失败时页面会停在空数据，自动重试而不是等玩家重启客户端。
    const watchdog = window.setInterval(() => {
      if (client.getSnapshot(codeRef.current).stocks.length === 0) client.retryBootstrap?.()
    }, 3000)
    // 行情 10 秒刷新一次（2026-11-04 船长：玩家要能看到 10 秒级数据变动）；回合仍 5 分钟、每回合 10 手。
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

  // 行情空数据兜底：首拉失败/HMR 半更新时 4 秒后显示提示与手动重试（看门狗同时自动重试）。
  const [dataStale, setDataStale] = useState(false)
  useEffect(() => {
    if (snap.stocks.length > 0) {
      setDataStale(false)
      return
    }
    const timer = window.setTimeout(() => setDataStale(true), 4000)
    return () => window.clearTimeout(timer)
  }, [snap.stocks.length])

  // 切换标的补拉图表/盘口：联机模式 bootstrap 只拉了首只标的，其余切过去会一直「行情初始化中…」。
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

  // 极简模式下计算总浮动盈亏（现货 + 杠杆仓总和）
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

  // 现货持仓市值：总资产已在游戏左上角显示，顶栏改为看「钱变成了多少股票」
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

  const resetMock = (): void => {
    try {
      client.resetAccount()
      onToast(T.resetMockDone)
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    }
  }

  return (
    <div className={`page-stack page-fill ex-page ex-mode-${viewMode}`}>
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
              aria-selected={viewMode === 'simple'}
              className={`ex-mode-tab ex-mode-tab-simple${viewMode === 'simple' ? ' is-active' : ''}`}
              onClick={() => switchViewMode('simple')}
            >
              <span className="ex-mode-tab-title"><Portfolio size={14} /> {T.viewModeSimple}</span>
              <span className="ex-mode-tab-sub">{T.modeSpotSub}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'pro'}
              className={`ex-mode-tab ex-mode-tab-pro${viewMode === 'pro' ? ' is-active' : ''}`}
              onClick={() => switchViewMode('pro')}
            >
              <span className="ex-mode-tab-title"><Analytics size={14} /> {T.viewModePro}</span>
              <span className="ex-mode-tab-sub">{T.modeProSub}</span>
            </button>
          </div>
        </div>

        {/* 中区：交易所运行状态（回合倒计时 + 本回合委托配额）及专业模式大盘指数 */}
        <div className="ex-topbar-status">
          <RoundBadge client={client} onNewRound={bump} />
          {viewMode === 'pro' ? (
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
            <div className="ex-stat">
              <span className="ex-dim">{T.availableCash}</span>
              <b className="ex-num">{money(snap.account.cash)}</b>
            </div>
            <div className="ex-stat">
              <span className="ex-dim">{T.holdingsValue}</span>
              <b className="ex-num">{money(holdingsValue)}</b>
            </div>
            <div className="ex-stat">
              <span className="ex-dim">{T.unrealizedPnl}</span>
              <b className={`ex-num ${pnlUp ? 'is-up' : 'is-down'}`}>
                {pnlUp ? '+' : ''}{money(totalUnrealizedPnl)}
              </b>
            </div>
            {viewMode === 'simple' ? (
              <div className="ex-stat">
                <span className="ex-dim">{T.bondValue}</span>
                <b className="ex-num">{money(bondTotal)}</b>
              </div>
            ) : (
              <div className="ex-stat">
                <span className="ex-dim">{T.marginRatio}</span>
                <b className="ex-num">{marginRatio}</b>
              </div>
            )}
          </div>

          <div className="ex-topbar-actions">
            <button type="button" className="ex-mini-btn is-deposit" onClick={() => setCashier('deposit')}>
              {T.deposit}
            </button>
            <button type="button" className="ex-mini-btn is-withdraw" onClick={() => setCashier('withdraw')}>
              {T.withdraw}
            </button>
            {bundle.source.mode === 'mock' ? (
              <button
                type="button"
                className="ex-mini-btn ex-reset-btn"
                title={T.resetMockHint}
                onClick={resetMock}
              >
                <Reset size={12} /> {T.resetMock}
              </button>
            ) : null}
          </div>
        </div>
      </header>

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

      {/* 主视图区：根据当前模式渲染 */}
      {viewMode === 'simple' ? (
        <SimpleExchange
          client={client}
          snap={snap}
          code={code}
          onSelectCode={selectCode}
          onToast={onToast}
          engine={engine}
          isServer={bundle.source.mode !== 'mock'}
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

