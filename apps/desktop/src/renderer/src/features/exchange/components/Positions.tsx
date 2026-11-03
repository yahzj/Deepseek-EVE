/**
 * 右栏下半：持仓 / 委托 Tabs。
 *
 * 优化（对齐玩家吐槽 2 & 5）：
 * - 持仓行补齐【波动率档】、【今日振幅】、【距强平百分比 + 人话提示（安全缓冲 / 高危警告）】；
 * - 场景/初始仓位标明「系统预置」及来源说明，消除决策依据模糊感；
 * - 行内平仓与卖出，现货与逐仓杠杆直观区分。
 */
import { useRef, useState } from 'react'
import type { ExchangeClient, ExchangeOrder, ExchangeSnapshot, OrderSource } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, pct, pctAbs, price, shortTime } from '../format'
import { T, TF } from '../texts'

type Tab = 'positions' | 'orders'

/** 距强平低于这个百分比：整行红描边并高危提示 */
const DANGER_DISTANCE_PCT = 15

function sourceLabel(source: OrderSource | undefined): string {
  if (source === 'strategy') return T.orderSourceStrategy
  if (source === 'conditional') return T.orderSourceConditional
  if (source === 'liquidation') return T.orderSourceLiquidation
  return T.orderSourceManual
}

function orderTypeLabel(order: ExchangeOrder): string {
  if (order.type === 'stop') return T.orderTypeStop
  if (order.type === 'take_profit') return T.orderTypeTakeProfit
  if (order.type === 'market') return T.orderTypeMarket
  return T.orderTypeLimit
}

function orderStatusLabel(order: ExchangeOrder): string {
  if (order.status === 'filled') return T.orderStatusFilled
  if (order.status === 'partial') return T.orderStatusPartial
  if (order.status === 'cancelled') return T.orderStatusCancelled
  if (order.status === 'rejected') return T.orderStatusRejected
  if (order.status === 'trigger_pending') return T.orderStatusTriggerPending
  return T.orderStatusOpen
}

export function Positions({
  client,
  snap,
  code,
  onSelect,
  onToast,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onSelect: (code: string) => void
  onToast: ToastFn
}) {
  const [tab, setTab] = useState<Tab>('positions')
  const seq = useRef(0)
  const nextId = (): string => {
    seq.current += 1
    return `pos-${Date.now()}-${seq.current}`
  }
  const holdings = snap.account.holdings
  const positions = snap.account.positions
  const orders = snap.orders
  const empty = tab === 'positions' ? holdings.length === 0 && positions.length === 0 : orders.length === 0

  const sellSpot = (target: string, qty: number): void => {
    if (qty <= 0) {
      onToast(T.toastNoHolding, true)
      return
    }
    void client
      .placeOrder({ clientOrderId: nextId(), code: target, side: 'sell', type: 'market', tif: 'IOC', qty, leverage: 1 })
      .then((o) => onToast(`${TF.positionClosed(o.code, amount(o.filledQty ?? qty))}`))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }
  const closeLeverage = (target: string, side: 'long' | 'short'): void => {
    void client
      .closePosition(target, side)
      .then(() => onToast(TF.positionClosedAll(target)))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }
  const cancelOrder = (id: string): void => {
    void client
      .cancelOrder(id)
      .then(() => onToast(T.toastOrderCancelled))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }

  return (
    <section className="ex-panel ex-positions" aria-label={T.tabsPosition}>
      <header className="ex-panel-head">
        <div className="ex-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'positions'}
            className={`ex-tab${tab === 'positions' ? ' is-on' : ''}`}
            onClick={() => setTab('positions')}
          >
            {T.tabsPosition}
            <em>{holdings.length + positions.length}</em>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'orders'}
            className={`ex-tab${tab === 'orders' ? ' is-on' : ''}`}
            onClick={() => setTab('orders')}
          >
            {T.tabsOrder}
            <em>{orders.length}</em>
          </button>
        </div>
        <span className="ex-dim">
          {T.marginRatio} {pctAbs(snap.account.marginRatio * 100)}
        </span>
      </header>
      <div className="ex-pos-body">
        {empty ? (
          <div className="ex-empty">{tab === 'positions' ? T.emptyPositions : T.emptyOrders}</div>
        ) : null}
        {tab === 'positions' && holdings.length > 0 ? (
          <div className="ex-pos-list">
            {holdings.map((h) => {
              const q = snap.stocks.find((s) => s.code === h.code)
              const mark = q?.price ?? 0
              const pnl = (mark - h.avgCost) * h.qty
              // 振幅与波动率
              const prev = (q?.prevClose ?? mark) || 1
              const amp = q ? ((q.high - q.low) / prev) * 100 : 0
              const volTier = amp >= 6 ? T.posVolHigh : amp >= 3 ? T.posVolMid : T.posVolLow

              return (
                <div className={`ex-pos-row${code === h.code ? ' is-sel' : ''}`} key={`spot-${h.code}`}>
                  <div className="ex-pos-id-col">
                    <button type="button" className="ex-pos-code" onClick={() => onSelect(h.code)} title={h.code}>
                      {h.code}
                    </button>
                    <span className="ex-preset-tag" title={T.systemPresetTip}>
                      {T.systemPresetTag}
                    </span>
                  </div>
                  <span className="ex-badge">{T.posSideSpot}</span>
                  <div className="ex-pos-main">
                    <span>
                      {T.posQty} <b className="ex-num">{amount(h.qty)}</b>
                    </span>
                    {(h.availableQty ?? h.qty) < h.qty ? (
                      <span className="ex-dim">{TF.availableQty(amount(h.availableQty ?? 0))}</span>
                    ) : null}
                    <span>
                      {T.posEntry} <b className="ex-num">{price(h.avgCost)}</b>
                    </span>
                    <span>
                      {T.posMark} <b className="ex-num">{price(mark)}</b>
                    </span>
                    <span className="ex-pos-vol-tag" title={`今日振幅 ${amp.toFixed(1)}%`}>
                      {volTier} {amp.toFixed(1)}%
                    </span>
                  </div>
                  <span className={`ex-num ${pnl >= 0 ? 'is-up' : 'is-down'}`}>{money(pnl)}</span>
                  <button type="button" className="ex-mini-btn" onClick={() => sellSpot(h.code, h.availableQty ?? h.qty)}>
                    {T.posSell}
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
        {tab === 'positions' && positions.length > 0 ? (
          <div className="ex-pos-list">
            {positions.map((p) => {
              const distance = p.liquidationDistancePct ?? 100
              const danger = distance < DANGER_DISTANCE_PCT
              const critical = distance < 5
              const up = p.unrealizedPnl >= 0
              const q = snap.stocks.find((s) => s.code === p.code)
              const prev = q?.prevClose ?? q?.price ?? 1
              const amp = q ? ((q.high - q.low) / prev) * 100 : 0
              const volTier = amp >= 6 ? T.posVolHigh : amp >= 3 ? T.posVolMid : T.posVolLow

              // 距强平人话提示
              const humanLiq = critical
                ? TF.posLiqDangerHint(pctAbs(distance), p.side === 'long')
                : danger
                  ? TF.posLiqWarnHint(pctAbs(distance), p.side === 'long')
                  : TF.posLiqSafeHint(pctAbs(distance))

              return (
                <div
                  className={`ex-pos-row${danger ? ' is-danger' : ''}${code === p.code ? ' is-sel' : ''}`}
                  key={p.id}
                >
                  <div className="ex-pos-id-col">
                    <button type="button" className="ex-pos-code" onClick={() => onSelect(p.code)} title={p.code}>
                      {p.code}
                    </button>
                    <span className="ex-preset-tag" title={T.systemPresetTip}>
                      {T.systemPresetTag}
                    </span>
                  </div>
                  <span className={`ex-badge ${p.side === 'long' ? 'is-long' : 'is-short'}`}>
                    {p.side === 'long' ? T.posSideLong : T.posSideShort} · {p.leverage}x
                  </span>
                  <div className="ex-pos-main">
                    <span>
                      {T.posQty} <b className="ex-num">{amount(p.qty)}</b>
                    </span>
                    <span>
                      {T.posEntry} <b className="ex-num">{price(p.avgEntry)}</b>
                    </span>
                    <span>
                      {T.posMargin} <b className="ex-num">{money(p.margin)}</b>
                    </span>
                    <span className={danger ? 'is-danger' : ''}>
                      {T.posLiq} <b className="ex-num">{price(p.liquidationPrice)}</b>
                    </span>
                    <span className={`ex-pos-human-liq ${danger ? 'is-danger' : 'is-safe'}`} title={humanLiq}>
                      {humanLiq}
                    </span>
                    <span className="ex-pos-vol-tag" title={`今日振幅 ${amp.toFixed(1)}%`}>
                      {volTier} {amp.toFixed(1)}%
                    </span>
                  </div>
                  <div className="ex-pos-pnl">
                    <span className={`ex-num ${up ? 'is-up' : 'is-down'}`}>{money(p.unrealizedPnl)}</span>
                    <span className={`ex-num ${up ? 'is-up' : 'is-down'}`}>
                      {pct((p.unrealizedPnl / Math.max(1, p.margin)) * 100)}
                    </span>
                  </div>
                  <button type="button" className="ex-mini-btn" onClick={() => closeLeverage(p.code, p.side)}>
                    {T.posClose}
                  </button>
                  {danger ? <span className="ex-pos-warn">{T.posWarning}</span> : null}
                </div>
              )
            })}
          </div>
        ) : null}
        {tab === 'orders' ? (
          <div className="ex-order-list">
            {orders.map((o) => (
              <div className="ex-order-row" key={o.id}>
                <button type="button" className="ex-pos-code" onClick={() => onSelect(o.code)}>
                  {o.code}
                </button>
                <span className={o.side === 'buy' ? 'is-up' : 'is-down'}>{o.side === 'buy' ? T.buy : T.sell}</span>
                <span className="ex-pos-main">
                  <span>{orderTypeLabel(o)}</span>
                  <span className="ex-num">{o.price !== null ? price(o.price) : T.orderTypeMarket}</span>
                  <span>
                    {T.posQty} <b className="ex-num">{amount(o.qty)}</b>
                  </span>
                  <span>{orderStatusLabel(o)}</span>
                  <span className="ex-dim">{shortTime(o.createdAt)}</span>
                </span>
                <span className="ex-badge">{sourceLabel(o.source)}</span>
                <button type="button" className="ex-mini-btn" onClick={() => cancelOrder(o.id)}>
                  {T.orderCancel}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
