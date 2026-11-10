import { isEn } from '../../../i18n/locale'
import { T } from '../texts'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { ChevronRight } from '@carbon/icons-react'
import { createExchangeClient } from '../factory'
import { CLOUD_SESSION_CHANGE_EVENT } from '../../cloud/preferences'
import { price, pct, amount } from '../format'
import { DEFAULT_EXCHANGE_CODE, setExchangeSelectedCode } from '../selectedCode'
import '../exchange.css'

interface SidebarExchangeCardProps {
  onGoPage?: (page: string, mapTab?: string, taskTab?: string) => void
}

/**
 * 活动栏左侧深空证券交易所快捷监控微卡片
 * - 高密度紧凑排版，彻底解决文字拥挤、折行叠字与被侧栏截断问题；
 * - 实时显示标的代码、当前价位、涨跌幅、持仓盈亏；
 * - 数值统一绑定等宽字体 var(--wui-mono)，盈亏统一规范色彩；
 * - 点击平滑跳转进入深空证券交易所页面，并高亮定位对应标的。
 */
export function SidebarExchangeCard({ onGoPage }: SidebarExchangeCardProps) {
  const [tick, bumpTick] = useState(0)
  // 2026-11-05 游客行情批：登录/退出后必须换客户端实例——游客连接是匿名的，
  // 不换就一直读不到自己的持仓（侧栏持仓永远显示 0）。
  const [authTick, bumpAuth] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const onChange = (): void => bumpAuth()
    window.addEventListener(CLOUD_SESSION_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CLOUD_SESSION_CHANGE_EVENT, onChange)
  }, [])
  const bundle = useMemo(() => createExchangeClient(), [authTick])

  // 卡片常驻活动栏：自己持有一份生命周期（客户端按引用计数），
  // 这样即使没开过交易所页签也能拿到行情与持仓；反之离开页签也不会把卡片的数据源一起断掉。
  // 轻量模式：只拉行情/账户/回合，不预载全套 K 线（那是开页签才需要的）。
  useEffect(() => {
    bundle.client.start(false)
    return () => bundle.client.stop()
  }, [bundle.client])

  useEffect(() => {
    const unsub = bundle.client.onTick(() => bumpTick((t) => t + 1))
    return unsub
  }, [bundle.client])

  const snap = useMemo(
    () => bundle.client.getSnapshot(DEFAULT_EXCHANGE_CODE),
    [bundle.client, tick],
  )

  const summary = useMemo(() => {
    const holdings = snap.account.holdings
    const positions = snap.account.positions
    let totalPnl = 0
    let totalCostOrMargin = 0
    const heldStockCodes: string[] = []
    let maxVal = -1
    let primary = DEFAULT_EXCHANGE_CODE

    for (const h of holdings) {
      if (h.qty > 0) {
        heldStockCodes.push(h.code)
        const q = snap.stocks.find((s) => s.code === h.code)
        const curPrice = q ? q.price : h.avgCost
        const pnl = (curPrice - h.avgCost) * h.qty
        const val = curPrice * h.qty
        totalPnl += pnl
        totalCostOrMargin += h.avgCost * h.qty
        if (val > maxVal) {
          maxVal = val
          primary = h.code
        }
      }
    }

    for (const p of positions) {
      heldStockCodes.push(p.code)
      totalPnl += p.unrealizedPnl
      totalCostOrMargin += p.margin
      if (p.margin > maxVal) {
        maxVal = p.margin
        primary = p.code
      }
    }

    const uniqueCodes = Array.from(new Set(heldStockCodes))
    const hasPositions = uniqueCodes.length > 0
    const pnlPct = totalCostOrMargin > 0 ? (totalPnl / totalCostOrMargin) * 100 : 0

    const activeCode = hasPositions ? primary : DEFAULT_EXCHANGE_CODE
    const activeQuote = snap.stocks.find((s) => s.code === activeCode) ?? snap.quote

    return {
      hasPositions,
      uniqueCodes,
      primaryCode: activeCode,
      activeQuote,
      totalPnl,
      pnlPct,
    }
  }, [snap])

  const handleClick = () => {
    setExchangeSelectedCode(summary.primaryCode)
    onGoPage?.('exchange')
  }

  const { hasPositions, primaryCode, activeQuote, totalPnl, pnlPct, uniqueCodes } = summary
  const quotePrice = activeQuote?.price ?? 0
  const quoteChgPct = activeQuote?.changePct ?? 0

  const tooltipTitle = isEn()
    ? (hasPositions
        ? `Holdings: ${uniqueCodes.join(', ')}\nTotal Unrealized PnL: ${totalPnl >= 0 ? '+' : ''}${amount(totalPnl)} Credits (${pct(pnlPct)})\nPrimary: ${primaryCode} (Price: ${price(quotePrice)} Credits, Chg: ${pct(quoteChgPct)})\nClick to open exchange`
        : `Deep Space Exchange live\nReference: ${primaryCode} (Price: ${price(quotePrice)} Credits, Chg: ${pct(quoteChgPct)})\nNo positions held, click to enter`)
    : (hasPositions
        ? `已持仓股票：${uniqueCodes.join('、')}\n当前总浮动盈亏：${totalPnl >= 0 ? '+' : ''}${amount(totalPnl)} 信用点 (${pct(pnlPct)})\n主力股票：${primaryCode}（现价 ${price(quotePrice)} 信用点，涨跌幅 ${pct(quoteChgPct)}）\n点击直达交易所并定位该股票`
        : `深空证券交易所实时监控中\n参考股票：${primaryCode}（现价 ${price(quotePrice)} 信用点，涨跌幅 ${pct(quoteChgPct)}）\n当前未建仓，点击直达交易大厅选股`)

  return (
    <button
      type="button"
      className={`app-activitybar-exch-card${
        hasPositions ? (totalPnl >= 0 ? ' is-profitable' : ' is-loss') : ''
      }`}
      onClick={handleClick}
      title={tooltipTitle}
    >
      {/* 顶部行情行：标的代码 + 现价 + 涨跌幅胶囊 */}
      <div className="exch-sb-row exch-sb-head-row">
        <div className="exch-sb-head-left">
          <span className="exch-sb-code">{primaryCode}</span>
          {uniqueCodes.length > 1 ? (
            <span className="exch-sb-badge" title={isEn() ? `Total ${uniqueCodes.length} stocks held` : `共持有 ${uniqueCodes.length} 只股票`}>
              +{uniqueCodes.length - 1}
            </span>
          ) : null}
        </div>
        <div className="exch-sb-head-right">
          <span className="exch-sb-price">{price(quotePrice)}</span>
          <span
            className={`exch-sb-chg ${
              quoteChgPct > 0 ? 'is-up' : quoteChgPct < 0 ? 'is-down' : 'is-zero'
            }`}
          >
            {pct(quoteChgPct)}
          </span>
        </div>
      </div>

      {/* 底部收益行：持仓盈亏数值与百分比 / 未持仓点击进入 */}
      {hasPositions ? (
        <div className="exch-sb-row exch-sb-pnl-row">
          <span className="exch-sb-pnl-label">{totalPnl >= 0 ? T.sidebarPnlFloatWin : T.sidebarPnlFloatLoss}</span>
          <div className="exch-sb-pnl-right">
            <span className={`exch-sb-pnl-val ${totalPnl >= 0 ? 'is-up' : 'is-down'}`}>
              {totalPnl >= 0 ? '+' : '-'}{amount(Math.abs(totalPnl))}
            </span>
            <span className={`exch-sb-pnl-pct ${pnlPct >= 0 ? 'is-up' : 'is-down'}`}>
              ({pct(pnlPct)})
            </span>
          </div>
        </div>
      ) : (
        <div className="exch-sb-row exch-sb-unheld-row">
          <span className="exch-sb-unheld-label">{T.sidebarUnheld}</span>
          <span className="exch-sb-unheld-action">
            <span>{T.sidebarSelectStock}</span>
            <ChevronRight size={11} />
          </span>
        </div>
      )}
    </button>
  )
}
