/**
 * 证券交易所 · 一级页（**F0 可点击原型**）。
 *
 * 结构：固定头（快讯走马灯 + 账户/指数条）+ 三栏主区 + 底部二级窗口内滚。
 * 「一级页不滚」：页面根吃满高度，滚动只发生在左右两栏与底部流水窗口里。
 *
 * 数据流：Mock 引擎每秒 tick 一次 → 本页 `useReducer` 强制重渲染 → 从
 * `client.getSnapshot(code)` 取整页同步快照；页面**不持有行情状态**，避免两套状态漂移。
 * 定时器与事件订阅全部在同一个 `useEffect` 里清理，离开页面即停（硬约束）。
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { PageProps } from '../../pages/common'
import type { MarginCallPayload } from './client'
import { createExchangeClient } from './client'
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

export function ExchangePage({ onToast }: PageProps) {
  // 客户端只创建一次；页面卸载即 stop（见下面的清理）
  const client = useMemo(() => createExchangeClient(), [])
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const [code, setCode] = useState(DEFAULT_CODE)
  const [pickedPrice, setPickedPrice] = useState<{ value: number; seq: number } | null>(null)

  // App 每渲染一次都会重建 onToast；放进 effect 依赖会把 1 秒定时器反复重启 ⇒ 用 ref 取最新
  const toastRef = useRef(onToast)
  toastRef.current = onToast

  useEffect(() => {
    client.start()
    const stopTick = client.onTick(bump)
    const stopMargin = client.on('margin_call', (payload) => {
      const call = payload as MarginCallPayload
      const side = call.side === 'long' ? T.posSideLong : T.posSideShort
      toastRef.current(TF.marginCalled(call.code, side, amount(call.qty)), true)
    })
    return () => {
      stopTick()
      stopMargin()
      client.stop()
    }
  }, [client, bump])

  const snap = useMemo(() => client.getSnapshot(code), [client, code, tick])

  const marginUsed = snap.account.positions.reduce((sum, p) => sum + p.margin, 0)
  const marginRatio = marginUsed > 0 ? pctAbs(snap.account.marginRatio * 100) : '—'
  const bondTotal = snap.bonds.principal + snap.bonds.accrued
  const up = snap.index.changePct >= 0

  const pickPrice = (value: number): void => {
    setPickedPrice((prev) => ({ value, seq: (prev?.seq ?? 0) + 1 }))
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
      </header>

      <div className="ex-grid">
        <aside className="ex-col ex-col-left">
          <StockList snap={snap} selected={code} onSelect={setCode} />
          <BondCard client={client} snap={snap} onToast={onToast} />
        </aside>

        <section className="ex-col ex-col-mid">
          <Chart quote={snap.quote} klines={snap.klines} />
          <div className="ex-mid-bottom">
            <OrderBook book={snap.book} onPickPrice={pickPrice} />
            <TradeTape trades={snap.trades} />
          </div>
        </section>

        <aside className="ex-col ex-col-right">
          <TradePanel client={client} snap={snap} code={code} pickedPrice={pickedPrice} onToast={onToast} />
          <Positions client={client} snap={snap} code={code} onSelect={setCode} onToast={onToast} />
          <AutoTrade client={client} snap={snap} code={code} onToast={onToast} />
        </aside>
      </div>

      <Records snap={snap} />
    </div>
  )
}
