import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { askLineOf, buyLineOf, ceilFinalQuantity, marketLockNote, marketHistory, marketQuote, marketTrend, naturalHoldings, salesTaxRate, shipStoredCount } from '@whale/core'
import type { MarketGoodDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { marketGoodDisplayName as goodDisplayName } from '../../ui/marketGoodHover'
import type { PageProps } from '../../pages/common'
import { isk } from '../../pages/common'
import { fmtInt } from '../../i18n/fmt'
import { HintIcon } from '../../ui/Hint'
import { tr, cmdText } from '../../i18n/locale'
import { fleetCountOf, placeOrderToast, taxTipText } from './readouts'
import { PriceChart } from './PriceChart'
import { reportCompanyFlow } from '../exchange/companyReporter'

const BOOK_ROWS_MAX = 12

const BOOK_ROWS_MIN = 5

export function MarketDetail({ engine, onToast, good }: { engine: PageProps['engine']; onToast: PageProps['onToast']; good: MarketGoodDef }) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const hist = marketHistory(state, good.key)
  const trend = marketTrend(state, good.key)
  const holdings = good.kind === 'ship' ? shipStoredCount(state, good.refId) : naturalHoldings(state, good)
  const unit = good.kind === 'ship' ? tr("ui.MarketPage.116") : tr("ui.MarketPage.117")
  const shipInFleet = good.kind === 'ship' ? fleetCountOf(state, good.refId) : 0
  const lockNote = marketLockNote(state, good)
  const lock = lockNote !== null ? tr(lockNote.textId, lockNote.params) : null
  const [bookRows, setBookRows] = useState(BOOK_ROWS_MAX)
  const booksRef = useRef<HTMLDivElement | null>(null)
  const agg = (orders: Array<{ price: number; qty: number }>, desc: boolean): Array<{ price: number; qty: number }> => {
    const m = new Map<number, number>()
    for (const o of orders) m.set(o.price, (m.get(o.price) ?? 0) + o.qty)
    return [...m.entries()]
      .map(([price, qty]) => ({ price, qty }))
      .sort((a, b) => (desc ? b.price - a.price : a.price - b.price))
      .slice(0, bookRows)
  }
  const buyOrders = agg(state.market.npcBuy[good.key] ?? [], true)
  const sellOrders = agg(state.market.npcSell[good.key] ?? [], false)
  const maxOrderQty = Math.max(1, ...buyOrders.map((o) => o.qty), ...sellOrders.map((o) => o.qty))
  const sortedHist = hist.length ? [...hist].sort((a, b) => a - b) : []
  const median = sortedHist.length ? sortedHist[Math.floor(sortedHist.length / 2)]! : undefined
  const name = goodDisplayName(engine.ctx, good.key)
  const [tab, setTab] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState(1)
  const [confirmSell, setConfirmSell] = useState<{
    avail: number
    want: number
    fillable: number
    orders: number
    gross: number
    tax: number
    net: number
    leftover: number
  } | null>(null)

  useEffect(() => {
    setPrice(Math.max(1, quote.sell ?? askLineOf(state, engine.ctx, good.key)))
    setQty(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [good.key])
  useLayoutEffect(() => {
    const el = booksRef.current
    if (!el) return
    const body = el.closest('.wui-panel-body') as HTMLElement | null
    const detail = el.parentElement as HTMLElement | null
    if (!body || !detail) return
    const measure = (): void => {
      const titleEl = el.querySelector('.app-mkt-book-title')
      const rowEl = el.querySelector('.app-mkt-depth')
      const clampPx = (v: number, fallback: number): number => (v >= 10 && v <= 40 ? v : fallback)
      const titleH = clampPx(titleEl ? titleEl.getBoundingClientRect().height : 16.5, 16.5) + 3
      const rowH = clampPx(rowEl ? rowEl.getBoundingClientRect().height : 16.5, 16.5)
      const levels = (rows: Array<{ price: number }>): number => new Set(rows.map((o) => o.price)).size
      const maxLevels = Math.max(
        levels(state.market.npcBuy[good.key] ?? []),
        levels(state.market.npcSell[good.key] ?? []),
      )
      const floorRows = Math.max(1, Math.min(BOOK_ROWS_MIN, maxLevels))
      el.style.minHeight = `${Math.round(titleH + floorRows * rowH)}px`
      const charts = detail.querySelector('.app-mkt-chart-wrap, .app-mkt-chart-empty') as HTMLElement | null
      const chartFloor = charts ? parseFloat(getComputedStyle(charts).minHeight) || 64 : 64
      const chartNow = charts ? charts.getBoundingClientRect().height : 0
      const gap = parseFloat(getComputedStyle(detail).rowGap) || 12
      const csBody = getComputedStyle(body)
      const padY = (parseFloat(csBody.paddingTop) || 0) + (parseFloat(csBody.paddingBottom) || 0)
      let others = 0
      let count = 0
      for (const child of Array.from(detail.children)) {
        count++
        if (child === el) continue
        const h = child.getBoundingClientRect().height
        others += charts && child.contains(charts) ? h - chartNow + chartFloor : h
      }
      const avail = body.clientHeight - padY - others - gap * Math.max(0, count - 1) - 16
      const fit = Math.floor((avail - titleH) / rowH)
      const next = Math.max(BOOK_ROWS_MIN, Math.min(BOOK_ROWS_MAX, fit))
      setBookRows((prev) => (prev === next ? prev : next))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(body)
    for (const child of Array.from(detail.children)) ro?.observe(child)
    window.addEventListener('resize', measure)
    const raf = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [good.key, tab])
  function doBuy(): void {
    if (lock) {
      onToast(tr("ui.MarketPage.147", { lock: lock }), true)
      return
    }
    const n = Math.max(1, Math.floor(qty || 1))
    const iskBefore = engine.state.wallet.isk
    const r = engine.buyGoodAt(good.key, n)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.173'), true)
    else {
      reportCompanyFlow(good.key, 'buy', iskBefore - engine.state.wallet.isk)
      onToast(tr("ui.MarketPage.148", { name: name, p2: n.toLocaleString('zh-CN') }))
    }
  }
  function doSell(q?: number): void {
    const n = Math.max(1, Math.min(holdings, Math.floor(q ?? (qty || 1))))
    if (n <= 0 || holdings <= 0) {
      onToast(good.kind === 'ship' ? tr("ui.MarketPage.041") : tr("ui.MarketPage.042"), true)
      return
    }
    const iskBefore = engine.state.wallet.isk
    const r = engine.sellHoldingAt(good.key, n)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.174'), true)
    else {
      const net = engine.state.wallet.isk - iskBefore
      reportCompanyFlow(good.key, 'sell', net)
      reportMarketTax(engine, net)
      if (good.kind === 'ship') {
        const filled = r.sold ?? 0
        const rest = r.remaining ?? 0
        onToast(
          rest > 0
            ? `已提交出售 ${name}×${n} 艘：即时成交 ${filled} 艘${filled > 0 ? tr("ui.MarketPage.149", { p1: isk(r.total ?? 0) }) : ''}，余 ${rest} 艘已留簿挂单（可随时撤销退回舰船仓库）。`
            : tr("ui.MarketPage.150", { name: name, filled: filled, p3: isk(r.total ?? 0) }),
        )
      } else onToast(tr("ui.MarketPage.151", { name: name, p2: n.toLocaleString('zh-CN') }))
    }
  }
  function reportMarketTax(eng: PageProps['engine'], net: number): void {
    if (net <= 0) return
    const rate = salesTaxRate(eng.state, eng.ctx)
    if (!(rate > 0) || rate >= 1) return
    const tax = Math.round((net * rate) / (1 - rate))
    if (tax > 0) reportCompanyFlow('market-tax', 'buy', tax)
  }
  function askSellAll(): void {
    if (holdings <= 0) {
      onToast(good.kind === 'ship' ? tr("ui.MarketPage.041") : tr("ui.MarketPage.042"), true)
      return
    }
    const pv = engine.sellPreviewAt(good.key, holdings)
    if (!pv.ok) {
      onToast(pv.error ?? tr('ui.MarketPage.175'), true)
      return
    }
    setConfirmSell(pv)
  }
  function doSellAll(): void {
    setConfirmSell(null)
    const iskBefore = engine.state.wallet.isk
    const r = engine.sellHoldingAt(good.key, holdings)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.174'), true)
    else {
      const net = engine.state.wallet.isk - iskBefore
      reportCompanyFlow(good.key, 'sell', net)
      reportMarketTax(engine, net)
      if (good.kind === 'ship') {
        const filled = r.sold ?? 0
        const rest = r.remaining ?? 0
        onToast(
          rest > 0
            ? `已提交出售 ${name}×${holdings} 艘：即时成交 ${filled} 艘${filled > 0 ? tr("ui.MarketPage.149", { p1: isk(r.total ?? 0) }) : ''}，余 ${rest} 艘已留簿挂单（可撤销退回舰船仓库）。`
            : tr("ui.MarketPage.152", { name: name, filled: filled, p3: isk(r.total ?? 0) }),
        )
      } else onToast(tr("ui.MarketPage.153", { name: name, p2: holdings.toLocaleString('zh-CN') }))
    }
  }
  function doPlace(): void {
    const n = Math.max(1, Math.floor(qty || 1))
    const p = Math.max(1, ceilFinalQuantity(price || 1))
    if (tab === 'buy') {
      const gate = engine.buyOrderBlocked(good.key, p, n)
      if (gate) {
        onToast(tr("ui.MarketPage.154", { gate: cmdText(gate) }), true)
        return
      }
      const res = engine.placeBuyOrderAt(good.key, p, n)
      if (res === null) onToast(tr("ui.MarketPage.155"), true)
      else {
        const exoNote =
          good.rarity === 'exotic' && p < askLineOf(state, engine.ctx, good.key)
            ? tr("ui.MarketPage.156", { p1: isk(askLineOf(state, engine.ctx, good.key)) })
            : ''
        const shrinkNote = res.placed < n ? tr("ui.MarketPage.157", { p1: n.toLocaleString('zh-CN'), p2: res.placed.toLocaleString('zh-CN') }) : ''
        const escrowNote = res.escrow > 0 ? tr("ui.MarketPage.158", { p1: isk(res.escrow) }) : ''
        onToast(`${placeOrderToast('买', name, res.placed, p, res.filled, res.resting)}${shrinkNote}${escrowNote}${exoNote}。`)
      }
    } else {
      const r = engine.placeSellOrderAt(good.key, p, n)
      if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.176'), true)
      else onToast(`${placeOrderToast('卖', name, n, p, r.filled ?? 0, r.resting ?? n, unit)}。`)
    }
  }
  function fillFromBook(side: 'buy' | 'sell', rowPrice: number, rowQty: number): void {
    setTab(side)
    setPrice(rowPrice)
    setQty(Math.max(1, rowQty))
  }

  return (
    <>
    <Panel
      title={tr("ui.MarketPage.161", { name: name })}
      hint={<HintIcon tip={taxTipText(state, engine.ctx)} />}
      right={
        <span className="app-dim">
          {/* 2026-09-14：舰船的可卖量 = **舰船仓库**艘数（机库里的船不能直接卖）⇒ 舰船把两处读数分开写 */}
          {good.kind === 'ship'
            ? tr('ui.MarketPage.123', { a: fmtInt(holdings), b: fmtInt(shipInFleet) })
            : tr('ui.MarketPage.124', { n: fmtInt(holdings) })}{' '}
          {tr('ui.MarketPage.125', { v: median !== undefined ? isk(median) : '—' })}
          <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
            {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : tr("ui.MarketPage.118")}
          </span>
        </span>
      }
    >
      <div className="app-mkt-detail">
        <div className="app-mkt-detail-left">
          <PriceChart hist={hist} />
          <div className="app-mkt-detail-quotes">
            <div className="app-mkt-quote">
              {tr("ui.MarketPage.029")} <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            </div>
            <div className="app-mkt-quote">
              {tr("ui.MarketPage.030")} <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : tr("ui.MarketPage.032")}</b>
            </div>
            <div className="app-mkt-quote">
              {tr("ui.MarketPage.043")} {good.poolTarget && good.poolTarget > 0 ? Math.floor(state.market.pools[good.key]?.q ?? 0).toLocaleString('zh-CN') : '—'}
            </div>
          </div>
        </div>
        <div className="app-mkt-detail-books" ref={booksRef}>
          <div className="app-mkt-book">
            <div className="app-mkt-book-title">{tr("ui.MarketPage.044")}</div>
            {buyOrders.map((o, i) => (
              <div
                key={`b${i}`}
                className="app-mkt-depth is-click"
                title={`${tr("ui.MarketPage.045")} · ${isk(o.price)} × ${o.qty.toLocaleString('zh-CN')} = ${isk(o.price * o.qty)}`}
                onClick={() => fillFromBook('sell', o.price, o.qty)}
              >
                <span className="app-mkt-depth-price">{isk(o.price)}</span>
                <span className="app-mkt-depth-bar app-mkt-depth-buy">
                  <i style={{ width: `${Math.round((o.qty / maxOrderQty) * 100)}%` }} />
                </span>
                <span className="app-mkt-depth-qty">{o.qty.toLocaleString('zh-CN')}</span>
              </div>
            ))}
            {buyOrders.length === 0 ? <div className="app-dim app-sr-eta">{tr("ui.MarketPage.046")}</div> : null}
          </div>
          <div className="app-mkt-book">
            <div className="app-mkt-book-title">{tr("ui.MarketPage.047")}</div>
            {sellOrders.map((o, i) => (
              <div
                key={`s${i}`}
                className="app-mkt-depth is-click"
                title={`${tr("ui.MarketPage.048")} · ${isk(o.price)} × ${o.qty.toLocaleString('zh-CN')} = ${isk(o.price * o.qty)}`}
                onClick={() => fillFromBook('buy', o.price, o.qty)}
              >
                <span className="app-mkt-depth-price">{isk(o.price)}</span>
                <span className="app-mkt-depth-bar app-mkt-depth-sell">
                  <i style={{ width: `${Math.round((o.qty / maxOrderQty) * 100)}%` }} />
                </span>
                <span className="app-mkt-depth-qty">{o.qty.toLocaleString('zh-CN')}</span>
              </div>
            ))}
            {sellOrders.length === 0 ? (
              <div className="app-dim app-sr-eta">{tr("ui.MarketPage.049")}</div>
            ) : null}
          </div>
        </div>
        <div className="app-mkt-trade">
          {/* 交易面板（2026-09-09 船长布局：左列 = 买/卖切换 + 数量/单价输入；右侧按钮容器 =
              挂单/市价/(卖出侧)全部卖出 纵向整体，按钮等宽撑近容器宽） */}
          <div className="app-mkt-trade-body">
            <div className="app-mkt-trade-fields">
              <div className="app-mkt-trade-row">
                <div className="app-mkt-sides" role="tablist">
                  <button
                    role="tab"
                    aria-selected={tab === 'buy'}
                    className={`app-mkt-side is-buy${tab === 'buy' ? ' is-active' : ''}`}
                    onClick={() => setTab('buy')}
                  >
                    {tr("ui.MarketPage.052")}
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'sell'}
                    className={`app-mkt-side is-sell${tab === 'sell' ? ' is-active' : ''}`}
                    onClick={() => setTab('sell')}
                  >
                    {tr("ui.MarketPage.053")}
                  </button>
                </div>
              </div>
              <div className="app-mkt-trade-row">
                <span className="app-dim">{tr("ui.Expedition.003")}</span>
                <input className="app-input" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                {tab === 'sell' ? (
                  <button className="app-btn is-small" disabled={holdings <= 0} onClick={() => setQty(Math.max(1, holdings))} title={tr("ui.MarketPage.162", { holdings: holdings, unit: unit })}>
                    {tr("ui.IndustryPage.001")}
                  </button>
                ) : null}
              </div>
              <div className="app-mkt-trade-row">
                <span className="app-dim">{tr("ui.MarketPage.054")}</span>
                <input className="app-input" type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                <span className="app-dim">{tr("ui.FirstTasks.003")}</span>
              </div>
            </div>
            <div className="app-mkt-actions">
              <button className="app-btn is-small" onClick={doPlace}>
                {tab === 'buy' ? tr("ui.MarketPage.055") : tr("ui.MarketPage.056")}
              </button>
              {/* 市价买入（2026-09-11 船长实测反馈修复）：**没有可吃单 / 钱包连最低一张都不够时按钮禁用**，
                  并把原因写在 title 里——此前按钮一直可点，点下去只会报一句"供应簿只剩 0 件"（原因其实是钱不够/声望闸/无货） */}
              <button
                className="app-btn is-primary is-small"
                disabled={tab === 'buy' && (quote.sell === undefined || state.wallet.isk < quote.sell)}
                title={
                  tab !== 'buy'
                    ? undefined
                    : quote.sell === undefined
                      ? tr("ui.MarketPage.057")
                      : state.wallet.isk < quote.sell
                        ? tr("ui.MarketPage.163", { p1: isk(quote.sell), p2: isk(Math.floor(state.wallet.isk)) })
                        : undefined
                }
                onClick={tab === 'buy' ? doBuy : () => doSell()}
              >
                {tab === 'buy' ? tr("ui.MarketPage.058") : tr("ui.CargoPage.038")}
              </button>
              {tab === 'sell' ? (
                <button className="app-btn is-small is-sellall" disabled={holdings <= 0} onClick={askSellAll} title={tr("ui.MarketPage.059")}>
                  {tr("ui.MarketPage.060")}{holdings} {unit}）
                </button>
              ) : null}
            </div>
          </div>
          {/* 舰船专卖提示（2026-09-14 船长报障「市场依旧无法挂单或者直接出售舰船」）：
              可卖只有**舰船仓库**这一处来源，机库里的船要先入库——仓库空而机库有货时把这一步说明白 */}
          {good.kind === 'ship' ? (
            <div className={`app-dim app-sr-eta${holdings <= 0 && shipInFleet > 0 ? ' is-warn' : ''}`}>
              {holdings > 0
                ? tr("ui.MarketPage.164", { holdings: holdings })
                : shipInFleet > 0
                  ? tr("ui.MarketPage.165", { shipInFleet: shipInFleet })
                  : tr("ui.MarketPage.061")}
            </div>
          ) : null}
          {/* 价格指引（2026-09-08 船长定：不向玩家披露站内吸收/巡游通道——只保留普通撮合语义的指导文案） */}
          <div className="app-dim app-sr-eta">
            {(() => {
              const p = Math.max(1, ceilFinalQuantity(price || 1))
              if (tab === 'sell') {
                const bid = buyLineOf(state, engine.ctx, good.key)
                if (p > bid) {
                  return (
                    <>
                      {tr("ui.MarketPage.062")} {isk(bid)}{tr('ui.MarketPage.128')}
                    </>
                  )
                }
                if (p < bid) {
                  return (
                    <>
                      {tr("ui.MarketPage.063")} {isk(bid)}{tr('ui.MarketPage.129')}
                    </>
                  )
                }
                return <>{tr("ui.MarketPage.064")} {isk(bid)}{tr('ui.MarketPage.130')}</>
              }
              // 奇货专项提示（2026-09-08 船长定）：挂单价低于奇货参考价时提醒并给出合适价位
              //（口径保密：不披露 20L/巡游机制，只讲"稀见到货 + 参考价"）
              if (good.rarity === 'exotic') {
                const exoLine = askLineOf(state, engine.ctx, good.key)
                if (p >= exoLine) {
                  return (
                    <>
                      {tr("ui.MarketPage.065")} {isk(exoLine)} {tr("ui.MarketPage.066")}
                    </>
                  )
                }
                return (
                  <>
                    {tr("ui.MarketPage.067")} {isk(p)} {tr("ui.MarketPage.068")} {isk(exoLine)} {tr("ui.MarketPage.069")}{isk(exoLine)} {tr("ui.MarketPage.119")}
                  </>
                )
              }
              const ask = quote.sell ?? askLineOf(state, engine.ctx, good.key)
              if (p >= ask) return <>{tr("ui.MarketPage.070")} {isk(ask)}{tr('ui.MarketPage.131')}</>
              return (
                <>
                  {tr("ui.MarketPage.071")} {isk(ask)}{tr('ui.MarketPage.132')}
                </>
              )
            })()}
          </div>
        </div>
      </div>
    </Panel>
      {confirmSell ? (
        <div className="app-mkt-confirm-mask" onClick={() => setConfirmSell(null)}>
          <div className="app-mkt-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="app-mkt-confirm-title">{tr("ui.MarketPage.072")} {name}</div>
            <div className="app-mkt-confirm-row">
              <span>{tr("ui.MarketPage.073")}</span>
              <b>{confirmSell.want.toLocaleString('zh-CN')} {unit}{tr("ui.MarketPage.120")} {confirmSell.avail.toLocaleString('zh-CN')}）</b>
            </div>
            <div className="app-mkt-confirm-row">
              <span>{tr("ui.MarketPage.074")}</span>
              <b className={confirmSell.fillable > 0 ? 'app-trend-up' : ''}>
                {confirmSell.fillable.toLocaleString('zh-CN')} {unit} · {confirmSell.orders} {tr("ui.MarketPage.121")}
              </b>
            </div>
            {confirmSell.fillable > 0 ? (
              <>
                <div className="app-mkt-confirm-row">
                  <span>{tr("ui.MarketPage.075")}</span>
                  <b className="app-gold">{isk(confirmSell.gross)} {tr("ui.FirstTasks.003")}</b>
                </div>
                <div className="app-mkt-confirm-row">
                  <span>{tr("ui.MarketPage.076")}</span>
                  <b>−{isk(confirmSell.tax)} {tr("ui.FirstTasks.003")}</b>
                </div>
                <div className="app-mkt-confirm-row is-net">
                  <span>{tr("ui.MarketPage.077")}</span>
                  <b className="app-gold">{isk(confirmSell.net)} {tr("ui.FirstTasks.003")}</b>
                </div>
              </>
            ) : null}
            {confirmSell.leftover > 0 ? (
              <div className="app-mkt-confirm-note">
                {tr("ui.MarketPage.078")} {fmtInt(confirmSell.fillable)} {unit}{tr('ui.MarketPage.133', { n: `${fmtInt(confirmSell.leftover)} ${unit}` })}{tr("ui.MarketPage.079")}
                {good.kind === 'ship' ? tr("ui.MarketPage.080") : tr("ui.MarketPage.081")}
              </div>
            ) : null}
            {confirmSell.fillable <= 0 ? (
              <div className="app-mkt-confirm-note">
                {tr("ui.MarketPage.082")}
                {good.kind === 'ship' ? tr("ui.MarketPage.083") : tr("ui.MarketPage.084")}
              </div>
            ) : null}
            <div className="app-mkt-confirm-btns">
              <button className="app-btn is-small" onClick={() => setConfirmSell(null)}>
                {tr("ui.ActivityBar.004")}
              </button>
              <button className="app-btn is-small is-sellall" onClick={doSellAll}>
                {tr("ui.MarketPage.085")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
