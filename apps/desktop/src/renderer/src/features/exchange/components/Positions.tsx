import { isEn } from '../../../i18n/locale'
/**
 * 右栏下半：持仓 / 委托 Tabs。
 *
 * 优化排版：
 * - 彻底摒弃单行死板 48px 列宽与横向挤压，采用卡片式两行自适应排版；
 * - 首行：标的代码 + 系统预置徽标 + 方向杠杆 + 今日振幅，右侧为浮盈浮亏与一键平仓；
 * - 次行：数量、开仓均价、保证金占用、强平价，以及醒目人话强平缓冲提示；
 * - 保证在任何宽度与高度下零截断、零列错位。
 */
import { useRef, useState } from 'react'
import { Close, TrashCan } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeOrder, ExchangeSnapshot, OrderSource } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, pct, pctAbs, pnlMoney, price, shortTime } from '../format'
import { T, TF } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'

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
  const [busyTarget, setBusyTarget] = useState<string | null>(null)
  const actionProgress = useActionProgress(client)
  const busyRef = useRef(false)
  const runAction = async (target: string, action: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusyTarget(target)
    actionProgress.start()
    try {
      await action()
      await actionProgress.finish()
    } catch (err) {
      await actionProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      busyRef.current = false
      setBusyTarget(null)
    }
  }
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
    void runAction(`spot-${target}`, () => client
      .placeOrder({ clientOrderId: nextId(), code: target, side: 'sell', type: 'market', tif: 'IOC', qty, leverage: 1 })
      .then((o) => onToast(`${TF.positionClosed(o.code, amount(o.filledQty ?? qty))}`))
    )
  }
  const closeLeverage = (target: string, side: 'long' | 'short'): void => {
    void runAction(`${side}-${target}`, () => client
      .closePosition(target, side)
      .then(() => onToast(TF.positionClosedAll(target)))
    )
  }
  const cancelOrder = (id: string): void => {
    void runAction(id, () => client
      .cancelOrder(id)
      .then(() => onToast(T.toastOrderCancelled))
    )
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

        {/* 现货持仓列表 */}
        {tab === 'positions' && holdings.length > 0 ? (
          <div className="ex-pos-card-list">
            {holdings.map((h) => {
              const q = snap.stocks.find((s) => s.code === h.code)
              const mark = q?.price ?? 0
              const pnl = (mark - h.avgCost) * h.qty
              const prev = (q?.prevClose ?? mark) || 1
              const amp = q ? ((q.high - q.low) / prev) * 100 : 0
              const volTier = amp >= 6 ? T.posVolHigh : amp >= 3 ? T.posVolMid : T.posVolLow
              const pnlPct = h.avgCost > 0 ? ((mark - h.avgCost) / h.avgCost) * 100 : 0

              return (
                <div className={`ex-pos-card-item${code === h.code ? ' is-sel' : ''}`} key={`spot-${h.code}`}>
                  <div className="ex-pos-head-row">
                    <div className="ex-pos-head-left">
                      <button type="button" className="ex-pos-code" onClick={() => onSelect(h.code)} title={h.code}>
                        {h.code}
                      </button>
                      <span className="ex-preset-tag" title={T.systemPresetTip}>
                        {T.systemPresetTag}
                      </span>
                      <span className="ex-badge">{T.posSideSpot}</span>
                      <span className="ex-pos-vol-tag" title={isEn() ? `Daily amplitude ${amp.toFixed(1)}%` : `今日振幅 ${amp.toFixed(1)}%`}>
                        {volTier} {amp.toFixed(1)}%
                      </span>
                    </div>

                    <div className="ex-pos-head-right">
                      <div className="ex-pos-pnl">
                        <b className={`ex-num ${pnl >= 0 ? 'is-up' : 'is-down'}`}>{pnlMoney(pnl)}</b>
                        <span className={`ex-num ${pnl >= 0 ? 'is-up' : 'is-down'}`}>{pct(pnlPct)}</span>
                      </div>
                      <button
                        type="button"
                        className="ex-mini-btn is-close ex-btn-progress"
                        disabled={busyTarget !== null}
                        style={busyTarget === `spot-${h.code}` ? progressStyle(actionProgress) : undefined}
                        title={`${T.posSell} ${h.code}`}
                        aria-label={`${T.posSell} ${h.code}`}
                        onClick={() => sellSpot(h.code, h.availableQty ?? h.qty)}
                      >
                        <Close size={12} /> {T.posSell}
                        {busyTarget === `spot-${h.code}` ? ` ${actionProgress.pct}%` : ''}
                      </button>
                    </div>
                  </div>

                  <div className="ex-pos-detail-row">
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posQty}</span>
                      <b className="ex-num">{amount(h.qty)}</b>
                    </div>
                    {(h.availableQty ?? h.qty) < h.qty ? (
                      <div className="ex-pos-detail-item">
                        <span className="ex-dim">{isEn() ? 'Avail' : '可卖'}</span>
                        <b className="ex-num">{amount(h.availableQty ?? 0)}</b>
                      </div>
                    ) : null}
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posEntry}</span>
                      <b className="ex-num">{price(h.avgCost)}</b>
                    </div>
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posMark}</span>
                      <b className="ex-num">{price(mark)}</b>
                    </div>
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.positionMarkVal}</span>
                      <b className="ex-num">{money(h.qty * mark)}</b>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* 逐仓杠杆持仓列表 */}
        {tab === 'positions' && positions.length > 0 ? (
          <div className="ex-pos-card-list">
            {positions.map((p) => {
              const distance = p.liquidationDistancePct ?? 100
              const danger = distance < DANGER_DISTANCE_PCT
              const critical = distance < 5
              const up = p.unrealizedPnl >= 0
              const q = snap.stocks.find((s) => s.code === p.code)
              const prev = (q?.prevClose ?? q?.price) || 1
              const amp = q ? ((q.high - q.low) / prev) * 100 : 0
              const volTier = amp >= 6 ? T.posVolHigh : amp >= 3 ? T.posVolMid : T.posVolLow

              const humanLiq = critical
                ? TF.posLiqDangerHint(pctAbs(distance), p.side === 'long')
                : danger
                  ? TF.posLiqWarnHint(pctAbs(distance), p.side === 'long')
                  : TF.posLiqSafeHint(pctAbs(distance))

              return (
                <div
                  className={`ex-pos-card-item${danger ? ' is-danger' : ''}${code === p.code ? ' is-sel' : ''}`}
                  key={p.id}
                >
                  <div className="ex-pos-head-row">
                    <div className="ex-pos-head-left">
                      <button type="button" className="ex-pos-code" onClick={() => onSelect(p.code)} title={p.code}>
                        {p.code}
                      </button>
                      <span className="ex-preset-tag" title={T.systemPresetTip}>
                        {T.systemPresetTag}
                      </span>
                      <span className={`ex-badge ${p.side === 'long' ? 'is-long' : 'is-short'}`}>
                        {p.side === 'long' ? T.posSideLong : T.posSideShort} · {p.leverage}x
                      </span>
                      <span className="ex-pos-vol-tag" title={isEn() ? `Daily amplitude ${amp.toFixed(1)}%` : `今日振幅 ${amp.toFixed(1)}%`}>
                        {volTier} {amp.toFixed(1)}%
                      </span>
                    </div>

                    <div className="ex-pos-head-right">
                      <div className="ex-pos-pnl">
                        <b className={`ex-num ${up ? 'is-up' : 'is-down'}`}>{pnlMoney(p.unrealizedPnl)}</b>
                        <span className={`ex-num ${up ? 'is-up' : 'is-down'}`}>
                          {pct((p.unrealizedPnl / Math.max(1, p.margin)) * 100)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="ex-mini-btn is-close ex-btn-progress"
                        disabled={busyTarget !== null}
                        style={busyTarget === `${p.side}-${p.code}` ? progressStyle(actionProgress) : undefined}
                        title={`${T.posClose} ${p.code} ${p.side}`}
                        aria-label={`${T.posClose} ${p.code} ${p.side}`}
                        onClick={() => closeLeverage(p.code, p.side)}
                      >
                        <Close size={12} /> {T.posClose}
                        {busyTarget === `${p.side}-${p.code}` ? ` ${actionProgress.pct}%` : ''}
                      </button>
                    </div>
                  </div>

                  <div className="ex-pos-detail-row">
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posQty}</span>
                      <b className="ex-num">{amount(p.qty)}</b>
                    </div>
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posEntry}</span>
                      <b className="ex-num">{price(p.avgEntry)}</b>
                    </div>
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posMargin}</span>
                      <b className="ex-num">{money(p.margin)}</b>
                    </div>
                    <div className="ex-pos-detail-item">
                      <span className="ex-dim">{T.posLiq}</span>
                      <b className={`ex-num ${danger ? 'is-danger' : ''}`}>{price(p.liquidationPrice)}</b>
                    </div>
                    <div className="ex-pos-detail-item ex-pos-human-item">
                      <span className={`ex-pos-human-liq ${danger ? 'is-danger' : 'is-safe'}`} title={humanLiq}>
                        {humanLiq}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* 委托单列表 */}
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
                <button
                  type="button"
                  className="ex-mini-btn is-cancel"
                  title={`${T.orderCancel} ${o.code}`}
                  aria-label={`${T.orderCancel} ${o.code}`}
                  onClick={() => cancelOrder(o.id)}
                >
                  <TrashCan size={12} /> {T.orderCancel}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
