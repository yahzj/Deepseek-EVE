import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { askLineOf, buyLineOf, ceilFinalQuantity, marketLockNote, marketHistory, marketQuote, marketTrend, naturalHoldings, shipStoredCount } from '@whale/core'
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

/**
 * 买卖盘显示档数：**上限 12**、下限 5。
 *
 * - **下限 5**（船长 2026-09-14：「窗口高度不足时可以隐藏部分订单，最少显示 5 个」）——不变。
 * - **上限 2026-09-22 由 8 放宽到 12**（船长：「既然我的订单已经移走了，那么关于买卖订单的最大显示数量
 *   是不是可以放宽？在保证不会过多的情况下？」）。依据是当天实测（`docs/design/archive/market-book-rows-20260922.md`）：
 *   ① 「我的挂单」搬走后右栏只剩详情卡 ⇒ 买卖盘可用高度大增：按本组件自己那套公式现算，
 *      窗口高 800/900/1080/1440 分别**放得下 16/22/33/55 档** ⇒ 原来的 8 档上限成了唯一瓶颈；
 *   ② 全部真实档位**最深 11 档**（两份后期档：买侧最大 11、卖侧最大 10，**没有任何商品超过 12 档**；
 *      466 个有簿面的商品里 230 个超过 8 档）⇒ **12 就是"全覆盖且不过多"的那个数**，
 *      再往上加也不会多显示一行（数据里没有那么多档）。
 * - 自适应机制（下面 `useLayoutEffect` 量可用高度反推行数）**一字未改**：窗口矮时照旧只渲染放得下的
 *   **整行**、绝不裁半行；档数超过上限时按价差取前 N 档。
 */
const BOOK_ROWS_MAX = 12

const BOOK_ROWS_MIN = 5

/** 市场详情卡：价格曲线 + 买卖盘深度 + 持有量 + 交易面板（买/卖 tab：市价或挂单） */
export function MarketDetail({ engine, onToast, good }: { engine: PageProps['engine']; onToast: PageProps['onToast']; good: MarketGoodDef }) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const hist = marketHistory(state, good.key)
  const trend = marketTrend(state, good.key)
  const holdings = good.kind === 'ship' ? shipStoredCount(state, good.refId) : naturalHoldings(state, good)
  /** 舰船的量词是「艘」（其余商品是「件」）；舰队同型艘数用于"可卖量从哪来"的提示 */
  const unit = good.kind === 'ship' ? tr("ui.MarketPage.116") : tr("ui.MarketPage.117")
  const shipInFleet = good.kind === 'ship' ? fleetCountOf(state, good.refId) : 0
  /** 声望门槛锁（按语言出；同文件上面对话框那处用的是同一个 `marketLockNote`） */
  const lockNote = marketLockNote(state, good)
  const lock = lockNote !== null ? tr(lockNote.textId, lockNote.params) : null
  /**
   * 买卖盘显示几档：**随这块自己的实测高度自适应**（船长 2026-09-14：「当窗口高度不足时，可以隐藏部分订单
   * （最少显示5个订单）」）。做法 = 让买卖盘那块可被压缩（`styles.css` 的 flex/ min-height 105px = 5 档下限），
   * 量它的实测高度反推行数 ⇒ **只渲染放得下的整行**（绝不裁半行）；紧到 5 档都放不下时由面板体出内滚。
   * 行高/标题高从 DOM 实测（拿不到就退回样式表里的标称值），避免两处硬编码漂移。
   */
  const [bookRows, setBookRows] = useState(BOOK_ROWS_MAX)
  const booksRef = useRef<HTMLDivElement | null>(null)
  // 按价格档聚合成交量（2026-09-05 船长：同价订单不应拆成多行——盘口按档合并），再取前 N 档（N 见 bookRows）
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

  // 打开详情时按初始页签预填一次默认价/数量（此后切换页签保留手填值，2026-09-08 船长定）
  useEffect(() => {
    setPrice(Math.max(1, quote.sell ?? askLineOf(state, engine.ctx, good.key)))
    setQty(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [good.key])
  /**
   * 买卖盘显示几档：**随面板可用高度自适应**（船长 2026-09-14：「当窗口高度不足时，可以隐藏部分订单
   * （最少显示5个订单）」）。做法 = 让买卖盘那块可被压缩（`styles.css`：flex + min-height 105px = 5 档下限），
   * 这里量「面板体还能给它多少」反推行数 ⇒ **只渲染放得下的整行**（绝不裁半行）；紧到 5 档都放不下时
   * 由面板体出内滚。可用高度 = 面板体内高 − 上下内边距 − 除买卖盘外各块 − 块间距，其中折线图**按它的
   * 下限（min-height 64px）计入**，差额补给买卖盘。
   * ⚠ 不能量买卖盘自己的高度反推（第一版正是如此）：它被压到 5 档后尺寸不再变化 ⇒ ResizeObserver
   * 不再触发 ⇒ 卡死在 5 档。改看**面板体**（尺寸由窗口/布局决定，是稳定触发源）。
   * ⚠ **2026-09-15 起**右栏分配改判（详情按内容高封顶、富余归「我的挂单」，见 `styles.css` 的
   * `market right column stretch` 段）：窗口够高时详情面板不再被拉长 ⇒ 面板体高度由内容决定，
   * 本函数量出来的档数会**逐步升到上限 8**（`fit(rows) ≥ rows+1` ⇒ 不会反向层层下探），
   * 窗口矮时详情被压、面板体高度由 flex 决定 ⇒ 与改判前一样稳定。
   */
  useLayoutEffect(() => {
    const el = booksRef.current
    if (!el) return
    const body = el.closest('.wui-panel-body') as HTMLElement | null
    const detail = el.parentElement as HTMLElement | null
    if (!body || !detail) return
    const measure = (): void => {
      const titleEl = el.querySelector('.app-mkt-book-title')
      const rowEl = el.querySelector('.app-mkt-depth')
      // ⚠ 实测值必须**夹到合理区间**：手机旋转模式（`is-mobile-rot`）下首次测量可能落在布局未定型的瞬间
      // ——实测到过「一行 166px」，写进 `min-height` 后把卡片顶出 ~780px 空白，且此后尺寸不再变、
      // ResizeObserver 也不再触发 ⇒ 永久卡死。行高/标题高的正常区间是 10~40px，越界就用标称值。
      const clampPx = (v: number, fallback: number): number => (v >= 10 && v <= 40 ? v : fallback)
      const titleH = clampPx(titleEl ? titleEl.getBoundingClientRect().height : 16.5, 16.5) + 3 // 标题行高 + 下边距 3px
      const rowH = clampPx(rowEl ? rowEl.getBoundingClientRect().height : 16.5, 16.5)
      // 5 档下限：**只在数据确实有 ≥5 档时**才把这块撑到 5 档高（数据本来不足 5 档就按内容高 ——
      // 否则白占近 20px，紧窗口里正好把面板顶出一条内滚，实测 15/123 就是这么来的）
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
      const avail = body.clientHeight - padY - others - gap * Math.max(0, count - 1) - 16 // 16px 余量：各块高度取整/小数累计的零头（余量给小了，残差会顶出一条 1~3px 的内滚）
      const fit = Math.floor((avail - titleH) / rowH)
      const next = Math.max(BOOK_ROWS_MIN, Math.min(BOOK_ROWS_MAX, fit))
      setBookRows((prev) => (prev === next ? prev : next)) // 值守卫：不触发多余重渲染
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(body)
    // 各兄弟块也看一眼：交易面板/提示行会随换页签、预填价、文案折行改高（只观察不改高度的话，
    // 行数会停在按旧高度算的值上，紧窗口里就可能多出一行的内滚）
    for (const child of Array.from(detail.children)) ro?.observe(child)
    window.addEventListener('resize', measure)
    // 兄弟块的最终高度可能在这一帧之后才定（例如下方「我的挂单」被对齐到整行后会改本面板的高度）
    // ⇒ 下一帧再量一次，避免按旧高度算出行数、把买卖盘裁掉半行
    const raf = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
    // 换商品 / 切买·卖页签都会改交易面板与提示行的高度 ⇒ 各重算一次
  }, [good.key, tab])
  function doBuy(): void {
    if (lock) {
      onToast(tr("ui.MarketPage.147", { lock: lock }), true)
      return
    }
    const n = Math.max(1, Math.floor(qty || 1))
    const r = engine.buyGoodAt(good.key, n)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.173'), true)
    else onToast(tr("ui.MarketPage.148", { name: name, p2: n.toLocaleString('zh-CN') }))
  }
  function doSell(q?: number): void {
    const n = Math.max(1, Math.min(holdings, Math.floor(q ?? (qty || 1))))
    if (n <= 0 || holdings <= 0) {
      onToast(good.kind === 'ship' ? tr("ui.MarketPage.041") : tr("ui.MarketPage.042"), true)
      return
    }
    const r = engine.sellHoldingAt(good.key, n)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.174'), true)
    else if (good.kind === 'ship') {
      // 舰船：即时成交的部分吃收购簿，其余**留簿挂着**（可撤销退回舰船仓库）——回执把两段都说清
      const filled = r.sold ?? 0
      const rest = r.remaining ?? 0
      onToast(
        rest > 0
          ? `已提交出售 ${name}×${n} 艘：即时成交 ${filled} 艘${filled > 0 ? tr("ui.MarketPage.149", { p1: isk(r.total ?? 0) }) : ''}，余 ${rest} 艘已留簿挂单（可随时撤销退回舰船仓库）。`
          : tr("ui.MarketPage.150", { name: name, filled: filled, p3: isk(r.total ?? 0) }),
      )
    } else onToast(tr("ui.MarketPage.151", { name: name, p2: n.toLocaleString('zh-CN') }))
  }
  /** 全部卖出：先预览（可成交件数/毛额/税/净到账）再弹确认——不直接执行（船长 2026-09-05） */
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
    const r = engine.sellHoldingAt(good.key, holdings)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.174'), true)
    else if (good.kind === 'ship') {
      const filled = r.sold ?? 0
      const rest = r.remaining ?? 0
      onToast(
        rest > 0
          ? `已提交出售 ${name}×${holdings} 艘：即时成交 ${filled} 艘${filled > 0 ? tr("ui.MarketPage.149", { p1: isk(r.total ?? 0) }) : ''}，余 ${rest} 艘已留簿挂单（可撤销退回舰船仓库）。`
          : tr("ui.MarketPage.152", { name: name, filled: filled, p3: isk(r.total ?? 0) }),
      )
    } else onToast(tr("ui.MarketPage.153", { name: name, p2: holdings.toLocaleString('zh-CN') }))
  }
  function doPlace(): void {
    const n = Math.max(1, Math.floor(qty || 1))
    const p = Math.max(1, ceilFinalQuantity(price || 1))
    if (tab === 'buy') {
      // 2026-09-08（船长反馈）：声望不足等门槛原因要明示，不再笼统报"价格或数量无效"。
      // 2026-09-11（预扣冻结）：余额不足同样明示（core 单点口径：挂 1 件需预扣多少、钱包多少）
      const gate = engine.buyOrderBlocked(good.key, p, n)
      if (gate) {
        onToast(tr("ui.MarketPage.154", { gate: cmdText(gate) }), true)
        return
      }
      const res = engine.placeBuyOrderAt(good.key, p, n)
      if (res === null) onToast(tr("ui.MarketPage.155"), true)
      else {
        // 2026-09-10：挂单瞬间会先与现有卖单簿面对冲成交 → 回执写明即时成交部分
        const exoNote =
          good.rarity === 'exotic' && p < askLineOf(state, engine.ctx, good.key)
            ? tr("ui.MarketPage.156", { p1: isk(askLineOf(state, engine.ctx, good.key)) })
            : ''
        // 2026-09-11：预扣口径写进回执（实际挂量可能因余额缩量；预扣撤单即退回）
        const shrinkNote = res.placed < n ? tr("ui.MarketPage.157", { p1: n.toLocaleString('zh-CN'), p2: res.placed.toLocaleString('zh-CN') }) : ''
        const escrowNote = res.escrow > 0 ? tr("ui.MarketPage.158", { p1: isk(res.escrow) }) : ''
        onToast(`${placeOrderToast('买' /* l10n-keep：side 是字面量联合 key */, name, res.placed, p, res.filled, res.resting)}${shrinkNote}${escrowNote}${exoNote}。`)
      }
    } else {
      const r = engine.placeSellOrderAt(good.key, p, n)
      if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.176'), true)
      else onToast(`${placeOrderToast('卖' /* l10n-keep：同上 */, name, n, p, r.filled ?? 0, r.resting ?? n, unit)}。`)
    }
  }
  /**
   * 点盘口行快速就位（2026-09-08 船长）：买盘（收你的货）行 → 切「卖出」并预填该档价格/数量，
   * 卖盘（卖给你的货）行 → 切「买入」并预填该档价格/数量——填好后可直接微调挂单或走市价按钮。
   */
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
