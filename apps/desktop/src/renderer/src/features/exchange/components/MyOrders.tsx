/**
 * 委托管理列表（MyOrders）· 回合制的「我的所有单」。
 *
 * 为什么单独成件：回合制下玩家的预操作（本回合排队等集合竞价）和已操作（成交 / 未成交 /
 * 撤单 / 被拒）必须在一个地方看全，否则只能靠记忆判断「这回合下过什么、还剩几单」。
 *
 * 两种布局共用一个组件：
 * - `table`：专业模式「成交与流水」的委托页签，网格列对齐；
 * - `compact`：极简模式右栏「我的委托」页签，窄列分两层，不硬挤表格。
 *
 * 数据来源：`client.getOrders()` 返回最近 200 笔（Go 端上限），不塞进快照，
 * 避免改变 `snap.orders` 只含活跃委托的既有语义。
 * 撤单契约：仅 `queued` 可撤，且只在回合开放期；锁定窗口按钮置灰，撤单不返还本回合配额。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExchangeClient, ExchangeOrder, OrderSource, RoundInfo } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, periodIndex, price, shortTime } from '../format'
import { T, TF } from '../texts'

type Filter = 'pending' | 'done' | 'all'
type Variant = 'table' | 'compact'

interface MyOrdersProps {
  client: ExchangeClient
  onToast: ToastFn
  variant: Variant
}

/** 待成交状态：`queued` 是回合制核心，其余为模拟盘旧状态与条件单 */
const PENDING_STATUSES: ReadonlySet<ExchangeOrder['status']> = new Set<ExchangeOrder['status']>([
  'queued',
  'open',
  'partial',
  'trigger_pending',
])

/** 列表刷新间隔：与行情 / 账户刷新同频，回合末广播后不落后太多 */
const REFRESH_MS = 10_000
/** 回合锁定检查间隔 */
const ROUND_POLL_MS = 5_000
/** 批量撤单二次确认的有效窗口 */
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

/** 方向：开空与卖出都是 side=sell，必须靠 short 标记区分 */
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
  // 默认看全部：回合制下「本回合排队的预操作」与「上几回合的操作结果」要看在同一张表里
  const [filter, setFilter] = useState<Filter>('all')
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
      // 网络抖动保留上一份读数：回合末不该把列表清空
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

  // 回合锁定窗口：撤单按钮置灰，避免玩家点了才吃到 409
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
          // `locked` 与服务端各自可能略有先后，用剩余时间再兜一次底
          const remaining = info.nextRoundAt - (Date.now() + offset)
          setLocked(info.locked || remaining <= info.lockSec * 1_000)
        })
        .catch(() => {
          // 轮询失败沿用上一状态，不打断列表使用
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

  /** 本回合可撤的单：只有 queued；锁定窗口中一笔都不能撤 */
  const cancellable = locked ? [] : orders.filter((order) => order.status === 'queued')

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
    ['pending', T.myOrdersFilterPending],
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
        {cancellable.length > 0 ? (
          <button
            type="button"
            className={`ex-myorders-bulk${confirmingBulk ? ' is-confirm' : ''}`}
            disabled={bulkBusy}
            onClick={handleCancelAll}
            title={locked ? T.myOrdersLocked : T.myOrdersCancelAll}
          >
            {bulkBusy
              ? T.myOrdersCancelling
              : confirmingBulk
                ? T.myOrdersConfirmCancelAll
                : `${T.myOrdersCancelAll} (${cancellable.length})`}
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
              const canCancel = order.status === 'queued' && !locked
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
                    {canCancel ? (
                      <button
                        type="button"
                        className="ex-myorders-cancel"
                        disabled={busyId === order.id || bulkBusy}
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
            const canCancel = order.status === 'queued' && !locked
            return (
              <div className={`ex-myorders-card is-${order.status}`} key={order.id}>
                <div className="ex-myorders-card-top">
                  <span className={`ex-myorders-side is-${sideTone(order)}`}>{sideLabel(order)}</span>
                  <b className="ex-myorders-code">{order.code}</b>
                  <span className="ex-num">
                    {amount(order.qty)} {T.sharesSuffix}
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
                  {canCancel ? (
                    <button
                      type="button"
                      className="ex-myorders-cancel"
                      disabled={busyId === order.id || bulkBusy}
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
