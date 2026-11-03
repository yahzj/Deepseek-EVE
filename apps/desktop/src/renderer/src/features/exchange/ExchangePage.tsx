/**
 * 证券交易所 · 一级页（**F0 可点击原型**）。
 *
 * 结构：固定头（数据源徽标 + 快讯走马灯 + 账户/指数条）+ 三栏主区 + 底部二级窗口内滚。
 * 「一级页不滚」：页面根吃满高度，滚动只发生在左右两栏与底部流水窗口里。
 *
 * 数据流：Mock 引擎每秒 tick 一次 → 本页 `useReducer` 强制重渲染 → 从
 * `client.getSnapshot(code)` 取整页同步快照；页面**不持有行情状态**，避免两套状态漂移。
 * 2026-11-03 挂机语义：页面挂载调 `client.start()` 补算离页时间，**卸载不停止行情引擎**
 * （引擎是模块单例，构造即启动；页面只退订自己的 tick/强平监听）。
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { PageProps } from '../../pages/common'
import type { MarginCallPayload } from './client'
import type { ExchangeClientBundle, ExchangeSourceInfo } from './factory'
import { createExchangeClient } from './factory'
import { amount, money, pct, pctAbs } from './format'
import { T, TF } from './texts'
import { NewsTicker } from './components/NewsTicker'
import { StockList } from './components/StockList'
import { Chart } from './components/Chart'
import { OrderBook, TradeTape } from './components/OrderBook'
import { TradePanel } from './components/TradePanel'
import { Positions } from './components/Positions'
import { AutoTrade } from './components/AutoTrade'
import { BondCard } from './components/BondCard'
import { Records } from './components/Records'
import './exchange.css'

const DEFAULT_CODE = 'SMHI'
/** 切页返回后保持选中标的（设计稿「Spatial Memory」；页面重挂载不丢） */
let rememberedCode = DEFAULT_CODE

export function ExchangePage({ onToast }: PageProps) {
  // 装配点只调 factory：按 localStorage 解析 Mock / HTTP；http 缺地址时 bundle.error 非空
  const bundle = useMemo(() => createExchangeClient(), [])
  if (bundle.error) return <ExchangeGuide bundle={bundle} />
  return <ExchangeBody bundle={bundle} onToast={onToast} />
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

/** HTTP 模式但没服务器/传输层：引导态（不静默回退到模拟盘） */
function ExchangeGuide({ bundle }: { bundle: ExchangeClientBundle }) {
  return (
    <div className="page-stack page-fill ex-page ex-guide-page">
      <header className="ex-topbar">
        <div className="ex-title">
          <h2 className="ex-title-text">{T.pageTitle}</h2>
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
  onToast,
}: {
  bundle: ExchangeClientBundle
  onToast: PageProps['onToast']
}) {
  const client = bundle.client
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const [code, setCode] = useState(rememberedCode)
  const [pickedPrice, setPickedPrice] = useState<{ value: number; seq: number } | null>(null)

  // App 每渲染一次都会重建 onToast；放进 effect 依赖会把 1 秒订阅反复重启 ⇒ 用 ref 取最新
  const toastRef = useRef(onToast)
  toastRef.current = onToast

  useEffect(() => {
    // 先订阅再 start：start() 会补算离页期间漏掉的拍并在结束时广播一次 tick，
    // 订阅晚于 start 时首屏可能停在补算前的旧快照上（最多滞后 1 秒）。
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
      // stop() 在 Mock 实现里只落盘、不停止引擎（页面只退订；行情继续走）
      client.stop()
    }
  }, [client])

  const snap = useMemo(() => client.getSnapshot(code), [client, code, tick])

  const marginUsed = snap.account.positions.reduce((sum, p) => sum + p.margin, 0)
  const marginRatio = marginUsed > 0 ? pctAbs(snap.account.marginRatio * 100) : '—'
  const bondTotal = snap.bonds.principal + snap.bonds.accrued
  const up = snap.index.changePct >= 0

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
    <div className="page-stack page-fill ex-page">
      <NewsTicker news={snap.news} />

      <header className="ex-topbar">
        <div className="ex-title">
          <h2 className="ex-title-text">{T.pageTitle}</h2>
          <span className="ex-prototype">{T.prototypeBadge}</span>
        </div>
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
        <div className="ex-top-actions">
          <SourceBadge source={bundle.source} />
          {bundle.source.mode === 'mock' ? (
            <button type="button" className="ex-mini-btn ex-reset-btn" title={T.resetMockHint} onClick={resetMock}>
              {T.resetMock}
            </button>
          ) : null}
        </div>
      </header>

      <div className="ex-grid">
        <aside className="ex-col ex-col-left">
          <StockList snap={snap} selected={code} onSelect={selectCode} />
          <BondCard client={client} snap={snap} onToast={onToast} />
        </aside>

        <section className="ex-col ex-col-mid">
          <Chart client={client} code={code} quote={snap.quote} tick={snap.tick} />
          <div className="ex-mid-bottom">
            <OrderBook book={snap.book} onPickPrice={pickPrice} />
            <TradeTape trades={snap.trades} />
          </div>
        </section>

        <aside className="ex-col ex-col-right">
          <TradePanel client={client} snap={snap} code={code} pickedPrice={pickedPrice} onToast={onToast} />
          <Positions client={client} snap={snap} code={code} onSelect={selectCode} onToast={onToast} />
          <AutoTrade client={client} snap={snap} code={code} onToast={onToast} />
        </aside>
      </div>

      <Records snap={snap} />
    </div>
  )
}
