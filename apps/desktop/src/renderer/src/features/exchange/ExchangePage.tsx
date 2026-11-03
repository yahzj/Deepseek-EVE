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
import { NewsTicker } from './components/NewsTicker'
import { SimpleExchange } from './components/SimpleExchange'
import { ProExchange } from './components/ProExchange'
import { RoundBadge } from './components/RoundBadge'
import './exchange.css'

const DEFAULT_CODE = 'SMHI'
const VIEW_MODE_KEY = 'whale-idle:exch-view-mode'

/** 切页返回后保持选中标的（Spatial Memory） */
let rememberedCode = DEFAULT_CODE

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
          <span className="ex-prototype">{T.prototypeBadge}</span>
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
  const [code, setCode] = useState(rememberedCode)
  const [pickedPrice, setPickedPrice] = useState<{ value: number; seq: number } | null>(null)
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
    client.start()
    return () => {
      stopTick()
      stopMargin()
      client.stop()
    }
  }, [client])

  const snap = useMemo(() => client.getSnapshot(code), [client, code, tick])

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

  const selectCode = (next: string): void => {
    rememberedCode = next
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
      {/* 财经快讯走马灯 */}
      <NewsTicker news={snap.news} />

      {/* 顶栏 */}
      <header className="ex-topbar">
        <div className="ex-title">
          <h2 className="ex-title-text">{T.simpleTopTitle}</h2>
          <span className="ex-prototype">{T.prototypeBadge}</span>
        </div>

        {/* 核心双模式 Segmented Tabs：醒目清晰，直观切换 */}
        <div className="ex-mode-tabs" role="tablist" aria-label="交易视图模式">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'simple'}
            className={`ex-mode-tab ex-mode-tab-simple${viewMode === 'simple' ? ' is-active' : ''}`}
            onClick={() => switchViewMode('simple')}
          >
            <span className="ex-mode-tab-title"><Portfolio size={14} /> {T.viewModeSimple}</span>
            <span className="ex-mode-tab-sub">现货 · 零爆仓</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'pro'}
            className={`ex-mode-tab ex-mode-tab-pro${viewMode === 'pro' ? ' is-active' : ''}`}
            onClick={() => switchViewMode('pro')}
          >
            <span className="ex-mode-tab-title"><Analytics size={14} /> {T.viewModePro}</span>
            <span className="ex-mode-tab-sub">杠杆 · 深度盘口</span>
          </button>
        </div>

        {/* 极简模式顶栏资产指标：总资产、可用现金、理财总值、浮动盈亏 */}
        {viewMode === 'simple' ? (
          <div className="ex-simple-top-stats">
            <div className="ex-stat ex-stat-big">
              <span className="ex-dim">{T.totalAssets}</span>
              <b className="ex-num ex-val-highlight">{money(snap.account.equity)}</b>
            </div>
            <div className="ex-stat">
              <span className="ex-dim">{T.availableCash}</span>
              <b className="ex-num">{money(snap.account.cash)}</b>
            </div>
            <div className="ex-stat">
              <span className="ex-dim">{T.bondValue}</span>
              <b className="ex-num">{money(bondTotal)}</b>
            </div>
            <div className="ex-stat">
              <span className="ex-dim">{T.unrealizedPnl}</span>
              <b className={`ex-num ${pnlUp ? 'is-up' : 'is-down'}`}>
                {pnlUp ? '+' : ''}{money(totalUnrealizedPnl)}
              </b>
            </div>
          </div>
        ) : (
          /* 专业模式顶栏指标：指数 + 6 项财务指标 */
          <>
            <div className="ex-index">
              <span className="ex-dim">{T.indexName}</span>
              <b className="ex-num">{snap.index.value.toFixed(2)}</b>
              <span className={`ex-num ${up ? 'is-up' : 'is-down'}`}>{pct(snap.index.changePct)}</span>
            </div>
            <div className="ex-stats">
              <div className="ex-stat">
                <span>{T.accountEquity}</span>
                <b className="ex-num">{money(snap.account.equity)}</b>
              </div>
              <div className="ex-stat">
                <span>{T.availableCash}</span>
                <b className="ex-num">{money(snap.account.cash)}</b>
              </div>
              <div className="ex-stat">
                <span>{T.frozen}</span>
                <b className="ex-num">{money(snap.account.frozen)}</b>
              </div>
              <div className="ex-stat">
                <span>{T.marginUsed}</span>
                <b className="ex-num">{money(marginUsed)}</b>
              </div>
              <div className="ex-stat">
                <span>{T.marginRatio}</span>
                <b className="ex-num">{marginRatio}</b>
              </div>
              <div className="ex-stat">
                <span>{T.bondValue}</span>
                <b className="ex-num">{money(bondTotal)}</b>
              </div>
            </div>
          </>
        )}

        {/* 顶栏右侧：入金 / 出金 + 数据源徽标 + 重置按钮 */}
        <div className="ex-top-actions">
          <button type="button" className="ex-mini-btn" onClick={() => setCashier('deposit')}>
            {T.deposit}
          </button>
          <button type="button" className="ex-mini-btn" onClick={() => setCashier('withdraw')}>
            {T.withdraw}
          </button>
          <SourceBadge source={bundle.source} />
          {/* 回合倒计时 + 本回合委托配额：回合一变触发 bump，重拉页面快照 */}
          <RoundBadge client={client} onNewRound={bump} />
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
      </header>

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
