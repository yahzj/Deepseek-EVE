import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExchangeClient, ExchangeOrder, OrderSource, RoundInfo } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, periodIndex, price, shortTime } from '../format'
import { T, TF } from '../texts'
import { tr } from '../../../i18n/locale'

type Filter = 'pending' | 'done' | 'all'
type Variant = 'table' | 'compact'

interface MyOrdersProps {
  client: ExchangeClient
  onToast: ToastFn
  variant: Variant
}

const PENDING_STATUSES: ReadonlySet<ExchangeOrder['status']> = new Set<ExchangeOrder['status']>([
  'queued',
  'open',
  'partial',
  'trigger_pending',
])

const REFRESH_MS = 10_000
const ROUND_POLL_MS = 5_000
const CONFIRM_MS = 3_000

function statusLabel(order: ExchangeOrder): string {
  switch (order.status) {
    case 'queued':
      return T.orderStatusQueued
    case 'filled':
      return T.orderStatusFilled
    case 'partial':
      return T.orderStatusPartial
    case 'cancelled':
      return T.orderStatusCancelled
    case 'rejected':
      return T.orderStatusRejected
    case 'trigger_pending':
      return T.orderStatusTriggerPending
    case 'expired':
      return T.orderStatusExpired
    default:
      return T.orderStatusOpen
  }
}

function typeLabel(order: ExchangeOrder): string {
  if (order.type === 'stop') return T.orderTypeStop
  if (order.type === 'take_profit') return T.orderTypeTakeProfit
  if (order.type === 'market') return T.orderTypeMarket
  return T.orderTypeLimit
}

function sourceLabel(source: OrderSource | undefined): string {
  if (source === 'strategy') return T.orderSourceStrategy
  if (source === 'conditional') return T.orderSourceConditional
  if (source === 'liquidation') return T.orderSourceLiquidation
  return T.orderSourceManual
}

function sideLabel(order: ExchangeOrder): string {
  if (order.short) return T.orderSideShort
  return order.side === 'buy' ? T.buy : T.sell
}

function sideTone(order: ExchangeOrder): 'buy' | 'sell' | 'short' {
  if (order.short) return 'short'
  return order.side === 'buy' ? 'buy' : 'sell'
}

export function MyOrders({ client, onToast, variant }: MyOrdersProps) {
  const [orders, setOrders] = useState<ExchangeOrder[]>([])
  const [filter, setFilter] = useState<Filter>(variant === 'compact' ? 'pending' : 'all')
  const [loading, setLoading] = useState(true)
  const [locked, setLocked] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  const aliveRef = useRef(true)
  const confirmTimer = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await client.getOrders()
      if (!aliveRef.current) return
      setOrders([...list].sort((a, b) => b.createdAt - a.createdAt))
    } catch {
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, REFRESH_MS)
    return () => {
      aliveRef.current = false
      window.clearInterval(timer)
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current)
    }
  }, [refresh])

  useEffect(() => {
    let timer: number | null = null
    const unsub = client.onTick(() => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void refresh()
      }, 100)
    })
    return () => {
      unsub()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [client, refresh])

  useEffect(() => {
    const getRound = client.getRound
    if (typeof getRound !== 'function') return
    let alive = true
    let offset: number | null = null
    const poll = (): void => {
      getRound
        .call(client)
        .then((info: RoundInfo) => {
          if (!alive) return
          if (offset === null) offset = info.serverTime - Date.now()
          const remaining = info.nextRoundAt - (Date.now() + offset)
          setLocked(info.locked || remaining <= info.lockSec * 1_000)
        })
        .catch(() => {
        })
    }
    poll()
    const timer = window.setInterval(poll, ROUND_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [client])

  const cancelOne = async (order: ExchangeOrder): Promise<void> => {
    if (busyId !== null || bulkBusy) return
    setBusyId(order.id)
    try {
      await client.cancelOrder(order.id)
      onToast(TF.myOrdersCancelled(1))
      await refresh()
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      if (aliveRef.current) setBusyId(null)
    }
  }

  const queuedOrders = orders.filter((order) => order.status === 'queued')
  const cancellable = locked ? [] : queuedOrders

  const handleCancelAll = (): void => {
    if (bulkBusy || cancellable.length === 0) return
    if (!confirmingBulk) {
      setConfirmingBulk(true)
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmingBulk(false), CONFIRM_MS)
      return
    }
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current)
      confirmTimer.current = null
    }
    setConfirmingBulk(false)
    void (async () => {
      setBulkBusy(true)
      let done = 0
      let failed = 0
      for (const order of cancellable) {
        try {
          await client.cancelOrder(order.id)
          done += 1
        } catch {
          failed += 1
        }
      }
      await refresh()
      if (!aliveRef.current) return
      setBulkBusy(false)
      if (failed === 0) onToast(TF.myOrdersCancelled(done))
      else if (done === 0) onToast(TF.myOrdersCancelFailed(failed), true)
      else onToast(`${TF.myOrdersCancelled(done)} · ${TF.myOrdersCancelFailed(failed)}`, true)
    })()
  }

  const visible = orders.filter((order) => {
    if (filter === 'all') return true
    const pending = PENDING_STATUSES.has(order.status)
    return filter === 'pending' ? pending : !pending
  })

  const filters: ReadonlyArray<[Filter, string]> = [
    ['pending', variant === 'compact' ? tr('ui.exchange.028') : T.myOrdersFilterPending],
    ['done', T.myOrdersFilterDone],
    ['all', T.myOrdersFilterAll],
  ]

  return (
    <div className={`ex-myorders is-${variant}`}>
      <div className="ex-myorders-head">
        <div className="ex-myorders-filters" role="tablist" aria-label={T.myOrdersTitle}>
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`ex-myorders-filter${filter === key ? ' is-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {queuedOrders.length > 0 ? (
          <button
            type="button"
            className={`ex-myorders-bulk${confirmingBulk ? ' is-confirm' : ''}`}
            disabled={bulkBusy || locked}
            onClick={handleCancelAll}
            title={locked ? T.myOrdersLocked : T.myOrdersCancelAll}
          >
            {bulkBusy
              ? T.myOrdersCancelling
              : confirmingBulk
                ? T.myOrdersConfirmCancelAll
                : `${T.myOrdersCancelAll} (${queuedOrders.length})`}
          </button>
        ) : null}
      </div>

      <div className="ex-myorders-body">
        {loading && orders.length === 0 ? (
          <div className="ex-empty">{T.chartNoData}</div>
        ) : visible.length === 0 ? (
          <div className="ex-empty">{T.myOrdersEmpty}</div>
        ) : variant === 'table' ? (
          <>
            <div className="ex-myorders-row is-head">
              <span>{T.recordsRound}</span>
              <span>{T.recordsTime}</span>
              <span>{T.recordsCode}</span>
              <span>{T.recordsSide}</span>
              <span>{T.recordsType}</span>
              <span>{T.recordsPrice}</span>
              <span>{T.recordsQty}</span>
              <span>{T.recordsFilled}</span>
              <span>{T.recordsStatus}</span>
              <span>{T.recordsSource}</span>
              <span />
            </div>
            {visible.map((order) => {
              const filled = order.filledQty ?? (order.status === 'filled' ? order.qty : 0)
              const isQueued = order.status === 'queued'
              const canCancel = isQueued && !locked
              return (
                <div className={`ex-myorders-row is-${order.status}`} key={order.id}>
                  <span className="ex-dim">
                    {order.roundNo ? TF.myOrdersRound(periodIndex(order.roundNo)) : '—'}
                  </span>
                  <span className="ex-dim">{shortTime(order.createdAt)}</span>
                  <span>{order.code}</span>
                  <span className={`is-${sideTone(order)}`}>{sideLabel(order)}</span>
                  <span>{typeLabel(order)}</span>
                  <span className="ex-num">
                    {order.price !== null ? price(order.price) : T.orderTypeMarket}
                  </span>
                  <span className="ex-num">{amount(order.qty)}</span>
                  <span className="ex-num">{amount(filled)}</span>
                  <span className={`ex-myorders-status is-${order.status}`}>{statusLabel(order)}</span>
                  <span className="ex-badge">{sourceLabel(order.source)}</span>
                  <span>
                    {isQueued ? (
                      <button
                        type="button"
                        className="ex-myorders-cancel"
                        disabled={!canCancel || busyId === order.id || bulkBusy}
                        title={!canCancel ? T.myOrdersLocked : T.myOrdersCancel}
                        onClick={() => void cancelOne(order)}
                      >
                        {busyId === order.id ? T.myOrdersCancelling : T.myOrdersCancel}
                      </button>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </>
        ) : (
          visible.map((order) => {
            const isQueued = order.status === 'queued'
            const canCancel = isQueued && !locked
            // 窄列必须同时给出「成交 / 委托」两个数：只显示下单量会让玩家把委托量当成成交量。
            const filled = order.filledQty ?? (order.status === 'filled' ? order.qty : 0)
            return (
              <div className={`ex-myorders-card is-${order.status}`} key={order.id}>
                <div className="ex-myorders-card-top">
                  <span className={`ex-myorders-side is-${sideTone(order)}`}>{sideLabel(order)}</span>
                  <b className="ex-myorders-code">{order.code}</b>
                  <span
                    className="ex-num"
                    title={`${T.recordsFilled} ${amount(filled)} / ${T.recordsQty} ${amount(order.qty)}`}
                  >
                    {amount(filled)}/{amount(order.qty)} {T.sharesSuffix}
                  </span>
                  <span className="ex-num ex-dim">
                    {order.price !== null ? price(order.price) : T.orderTypeMarket}
                  </span>
                  <span className={`ex-myorders-status is-${order.status}`}>
                    {statusLabel(order)}
                  </span>
                </div>
                <div className="ex-myorders-card-bottom">
                  <span className="ex-dim">
                    {order.roundNo ? `${TF.myOrdersRound(periodIndex(order.roundNo))} · ` : ''}
                    {shortTime(order.createdAt)}
                    {order.status === 'queued' ? ` · ${T.myOrdersQueued}` : ''}
                  </span>
                  {isQueued ? (
                    <button
                      type="button"
                      className="ex-myorders-cancel"
                      disabled={!canCancel || busyId === order.id || bulkBusy}
                      title={!canCancel ? T.myOrdersLocked : T.myOrdersCancel}
                      onClick={() => void cancelOne(order)}
                    >
                      {busyId === order.id ? T.myOrdersCancelling : T.myOrdersCancel}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
