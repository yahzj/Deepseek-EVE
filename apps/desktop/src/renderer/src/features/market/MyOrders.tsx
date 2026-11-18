import { useLayoutEffect, useRef } from 'react'
import { goodName } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { isk } from '../../pages/common'
import { tr } from '../../i18n/locale'


export function MyOrders({ engine, onToast, onJump }: PageProps & { onJump: (goodKey: string) => void }) {
  const state = engine.state
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const body = wrap?.closest('.wui-panel-body') as HTMLElement | null
    if (!wrap || !body) return
    const measure = (): void => {
      const ul = wrap.querySelector('.app-inv-list')
      const rows = ul ? Array.from(ul.querySelectorAll('.app-inv-row')) : []
      body.style.maxHeight = ''
      body.style.paddingBottom = ''
      const cs = getComputedStyle(body)
      const padT = parseFloat(cs.paddingTop) || 0
      const padB = parseFloat(cs.paddingBottom) || 0
      if (rows.length === 0) return
      const avail = body.clientHeight - padT - padB
      let acc = 0
      let total = 0
      for (const r of rows) {
        const h = r.getBoundingClientRect().height
        total += h
        if (acc + h <= avail) acc += h
      }
      if (total <= avail + 0.5) return
      if (acc <= 0) acc = rows[0]!.getBoundingClientRect().height
      body.style.paddingBottom = '0px'
      body.style.maxHeight = `${Math.round(acc)}px`
    }
    measure()
    const column = wrap.closest('.app-mkt-left')
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (column) ro?.observe(column)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [state.orders.length])
  if (state.orders.length === 0) {
    return (
      <div className="app-dim app-inv-empty" ref={wrapRef}>
        {tr("ui.MarketPage.086")}
      </div>
    )
  }
  return (
    <div ref={wrapRef}>
      <ul className="app-inv-list">
        {state.orders.map((order) => (
          <li key={order.id} className="app-inv-row">
            <div className="app-inv-main">
              <span className="app-inv-name">
                {order.side === 'sell' ? tr("ui.MarketPage.087") : tr("ui.MarketPage.088")}：{goodName(engine.ctx, order.good)}
              </span>
              <span className="app-inv-count">
                {order.side === 'sell' ? tr("ui.MarketPage.089") : tr("ui.MarketPage.090")} {order.price.toLocaleString('zh-CN')} {tr("ui.MarketPage.091")} {order.qty.toLocaleString('zh-CN')}
                {order.filled > 0 ? tr("ui.MarketPage.166", { p1: order.filled.toLocaleString('zh-CN') }) : ''}
                {/* 2026-09-11（船长裁决「甲」预扣冻结）：买单显示"已预扣多少"，让玩家看得见这笔钱在哪 */}
                {order.side === 'buy' && (order.escrowIsk ?? 0) > 0
                  ? tr("ui.MarketPage.167", { p1: (order.escrowIsk ?? 0).toLocaleString('zh-CN') })
                  : ''}
              </span>
            </div>
            <div className="app-inv-btns">
              <button
                className="app-btn is-small"
                onClick={() => onJump(order.good)}
                title={tr("ui.MarketPage.092")}
              >
                {tr("ui.MarketPage.093")}
              </button>
              <button
                className="app-btn is-small is-warn"
                onClick={() => {
                  // 先取预扣额（撤单会把订单上的 escrowIsk 清零）
                  const back = order.side === 'buy' ? (order.escrowIsk ?? 0) : 0
                  engine.cancelOrderAt(order.id)
                  onToast(
                    order.side === 'sell'
                      ? engine.ctx.marketGoods.get(order.good)?.kind === 'ship'
                        ? tr("ui.MarketPage.094")
                        : tr("ui.MarketPage.095")
                      : back > 0
                        ? tr("ui.MarketPage.168", { p1: isk(back) })
                        : tr("ui.MarketPage.096"),
                  )
                }}
              >
                {tr("ui.MarketPage.097")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
