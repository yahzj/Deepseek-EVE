/**
 * 底部二级窗口：当前委托 / 历史成交 / 分红流水（固定高、内部滚动）。
 *
 * 一级页不滚红线：这一块是页面里唯一"整页常驻的第二窗口"，用固定高度 + 内部滚动，
 * 加载更多由滚动完成，不做分页（原型数据量 < 200 条）。
 */
import { useState } from 'react'
import type { ExchangeOrder, ExchangeSnapshot, OrderSource, TradeSource } from '../client'
import { amount, clock, money, price, shortTime } from '../format'
import { T } from '../texts'

type Tab = 'orders' | 'trades' | 'dividends'

function sourceLabel(source: TradeSource | OrderSource | undefined): string {
  if (source === 'strategy') return T.orderSourceStrategy
  if (source === 'conditional') return T.orderSourceConditional
  if (source === 'liquidation') return T.orderSourceLiquidation
  if (source === 'mm') return T.orderSourceMm
  return T.orderSourceManual
}

function statusLabel(order: ExchangeOrder): string {
  if (order.status === 'filled') return T.orderStatusFilled
  if (order.status === 'partial') return T.orderStatusPartial
  if (order.status === 'cancelled') return T.orderStatusCancelled
  if (order.status === 'rejected') return T.orderStatusRejected
  if (order.status === 'trigger_pending') return T.orderStatusTriggerPending
  return T.orderStatusOpen
}

function typeLabel(order: ExchangeOrder): string {
  if (order.type === 'stop') return T.orderTypeStop
  if (order.type === 'take_profit') return T.orderTypeTakeProfit
  if (order.type === 'market') return T.orderTypeMarket
  return T.orderTypeLimit
}

export function Records({ snap }: { snap: ExchangeSnapshot }) {
  const [tab, setTab] = useState<Tab>('orders')
  const orders = snap.orders
  const trades = snap.myTrades
  const dividends = snap.dividends
  return (
    <section className="ex-records" aria-label={T.recordsTitle}>
      <div className="ex-records-head">
        <div className="ex-tabs" role="tablist">
          {([
            ['orders', T.recordsOrders],
            ['trades', T.recordsTrades],
            ['dividends', T.recordsDividends],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`ex-tab${tab === key ? ' is-on' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ex-dim">{T.recordsTitle}</span>
      </div>
      <div className="ex-records-body">
        {tab === 'orders' ? (
          orders.length === 0 ? (
            <div className="ex-empty">{T.recordsEmptyOrders}</div>
          ) : (
            <>
              <div className="ex-records-row is-head">
                <span>{T.recordsTime}</span>
                <span>{T.recordsCode}</span>
                <span>{T.recordsSide}</span>
                <span>{T.recordsType}</span>
                <span>{T.recordsPrice}</span>
                <span>{T.recordsQty}</span>
                <span>{T.recordsFilled}</span>
                <span>{T.recordsStatus}</span>
                <span>{T.recordsSource}</span>
              </div>
              {orders.map((o) => (
                <div className="ex-records-row" key={o.id}>
                  <span className="ex-dim">{shortTime(o.createdAt)}</span>
                  <span>{o.code}</span>
                  <span className={o.side === 'buy' ? 'is-up' : 'is-down'}>{o.side === 'buy' ? T.buy : T.sell}</span>
                  <span>{typeLabel(o)}</span>
                  <span className="ex-num">{o.price !== null ? price(o.price) : T.orderTypeMarket}</span>
                  <span className="ex-num">{amount(o.qty)}</span>
                  <span className="ex-num">{amount(o.filledQty ?? 0)}</span>
                  <span>{statusLabel(o)}</span>
                  <span className="ex-badge">{sourceLabel(o.source)}</span>
                </div>
              ))}
            </>
          )
        ) : null}
        {tab === 'trades' ? (
          trades.length === 0 ? (
            <div className="ex-empty">{T.recordsEmptyTrades}</div>
          ) : (
            <>
              <div className="ex-records-row is-head">
                <span>{T.recordsTime}</span>
                <span>{T.recordsCode}</span>
                <span>{T.recordsSide}</span>
                <span>{T.recordsPrice}</span>
                <span>{T.recordsQty}</span>
                <span>{T.recordsAmount}</span>
                <span>{T.recordsSource}</span>
              </div>
              {trades.map((t) => (
                <div className="ex-records-row" key={t.id}>
                  <span className="ex-dim">{clock(t.ts)}</span>
                  <span>{t.code}</span>
                  <span className={t.side === 'buy' ? 'is-up' : 'is-down'}>{t.side === 'buy' ? T.buy : T.sell}</span>
                  <span className="ex-num">{price(t.price)}</span>
                  <span className="ex-num">{amount(t.qty)}</span>
                  <span className="ex-num">{money(t.price * t.qty)}</span>
                  <span className="ex-badge">{sourceLabel(t.source)}</span>
                </div>
              ))}
            </>
          )
        ) : null}
        {tab === 'dividends' ? (
          dividends.length === 0 ? (
            <div className="ex-empty">{T.recordsEmptyDividends}</div>
          ) : (
            <>
              <div className="ex-records-row is-wide is-head">
                <span>{T.recordsTime}</span>
                <span>{T.recordsCode}</span>
                <span>{T.recordsAmount}</span>
              </div>
              {dividends.map((d) => (
                <div className="ex-records-row is-wide" key={d.id}>
                  <span className="ex-dim">{shortTime(d.ts)}</span>
                  <span>{d.code}</span>
                  <span className="ex-num is-up">+{money(d.amount)}</span>
                </div>
              ))}
            </>
          )
        ) : null}
      </div>
    </section>
  )
}
