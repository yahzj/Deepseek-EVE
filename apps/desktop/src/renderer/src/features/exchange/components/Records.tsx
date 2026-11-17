import { useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot, OrderSource, TradeSource } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, clock, money, price, shortTime } from '../format'
import { T } from '../texts'
import { MyOrders } from './MyOrders'

type Tab = 'orders' | 'trades' | 'dividends'

function sourceLabel(source: TradeSource | OrderSource | undefined): string {
  if (source === 'strategy') return T.orderSourceStrategy
  if (source === 'conditional') return T.orderSourceConditional
  if (source === 'liquidation') return T.orderSourceLiquidation
  if (source === 'mm') return T.orderSourceMm
  return T.orderSourceManual
}

interface RecordsProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  onToast: ToastFn
}

export function Records({ client, snap, onToast }: RecordsProps) {
  const [tab, setTab] = useState<Tab>('orders')
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
          <MyOrders client={client} onToast={onToast} variant="table" />
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
