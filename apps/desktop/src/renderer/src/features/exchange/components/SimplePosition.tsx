/**
 * 极简模式 · 当前标的持仓战报（SimplePosition）。
 *
 * 核心设计：
 * - 集中呈现当前标的的现货多头、逐仓多头与融券空头全部持仓；
 * - 各个持仓子项独立提供【单独平仓】操作（现货平多变现、空头平空结清、杠杆平多结清）；
 * - 顶部醒目配备【一键全部平仓】大按钮，一键市价结清变现所有仓位；
 * - 严谨计算单项浮盈率与标的总净收益，深空科技 HUD 风格。
 */
import { useRef, useState } from 'react'
import { Close } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, pct, price } from '../format'
import { T, TF } from '../texts'

interface SimplePositionProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onToast: ToastFn
}

export function SimplePosition({ client, snap, code, onToast }: SimplePositionProps) {
  const [busy, setBusy] = useState(false)
  const orderSeq = useRef(0)

  const quote = snap.stocks.find((s) => s.code === code)
  const curPrice = quote?.price ?? 0

  // 1. 现货多头
  const holding = snap.account.holdings.find((h) => h.code === code)
  const heldQty = holding?.availableQty ?? holding?.qty ?? 0
  const avgCost = holding?.avgCost ?? 0
  const spotVal = heldQty * curPrice
  const spotCost = heldQty * avgCost
  const spotPnl = spotVal - spotCost
  const spotPnlPct = spotCost > 0 ? (spotPnl / spotCost) * 100 : 0

  // 2. 逐仓杠杆（多头/空头）
  const posList = snap.account.positions.filter((p) => p.code === code)
  const hasAnyPosition = heldQty > 0 || posList.length > 0

  if (!hasAnyPosition) {
    return (
      <div className="ex-simple-pos-card is-empty">
        <div className="ex-simple-pos-empty-inner">
          <div className="ex-simple-pos-empty-title">暂未持有 {code} 仓位</div>
          <span className="ex-dim">{T.simpleEmptyPosHint}</span>
        </div>
      </div>
    )
  }

  // 整体战报盈亏汇总
  const totalPnl = (heldQty > 0 ? spotPnl : 0) + posList.reduce((sum, p) => sum + p.unrealizedPnl, 0)
  const totalCost = (heldQty > 0 ? spotCost : 0) + posList.reduce((sum, p) => sum + p.margin, 0)
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const isOverallProfit = totalPnl >= 0

  // 单独平仓：现货
  const handleCloseSpot = async () => {
    if (busy || heldQty <= 0) return
    setBusy(true)
    orderSeq.current += 1
    try {
      await client.placeOrder({
        clientOrderId: `simple-close-spot-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'sell',
        type: 'market',
        tif: 'IOC',
        qty: heldQty,
        leverage: 1,
      })
      onToast(TF.closeSpotDone(code, amount(heldQty)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  // 单独平仓：逐仓多/空
  const handleClosePos = async (pSide: 'long' | 'short', pQty: number) => {
    if (busy) return
    setBusy(true)
    try {
      await client.closePosition(code, pSide)
      onToast(TF.closePosDone(code, pSide === 'short' ? '融券空头' : '杠杆多头', amount(pQty)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  // 一键全部平仓变现
  const handleCloseAll = async () => {
    if (busy) return
    setBusy(true)
    orderSeq.current += 1
    let totalShares = heldQty
    try {
      if (heldQty > 0) {
        await client.placeOrder({
          clientOrderId: `simple-close-all-${code}-${Date.now()}-${orderSeq.current}`,
          code,
          side: 'sell',
          type: 'market',
          tif: 'IOC',
          qty: heldQty,
          leverage: 1,
        })
      }
      for (const p of posList) {
        totalShares += p.qty
        await client.closePosition(p.code, p.side)
      }
      onToast(TF.closeAllDone(code, amount(totalShares)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`ex-simple-pos-card${isOverallProfit ? ' is-profit' : ' is-loss'}`}>
      <div className="ex-simple-pos-head">
        <div className="ex-simple-pos-head-info">
          <h4 className="ex-simple-pos-title">我的【{code}】持仓战报</h4>
          <span className={`ex-simple-pos-total-pnl ${isOverallProfit ? 'is-up' : 'is-down'}`}>
            净浮盈: {isOverallProfit ? '+' : ''}{money(totalPnl)} ({pct(totalPnlPct)})
          </span>
        </div>
        <button
          type="button"
          className="ex-simple-close-all-btn"
          disabled={busy}
          onClick={handleCloseAll}
          title="以市价卖出该标的所有现货并结清所有杠杆仓位"
        >
          {busy ? '清仓中…' : <><Close size={13} /> {T.closeAllPositions}</>}
        </button>
      </div>

      <div className="ex-simple-pos-list">
        {/* 1. 现货多头行 */}
        {heldQty > 0 && (
          <div className="ex-simple-pos-row is-spot">
            <div className="ex-simple-pos-row-head">
              <div className="ex-simple-pos-badge is-spot">{T.simpleSpotHolding} (1x)</div>
              <button
                type="button"
                className="ex-simple-sub-close-btn is-close"
                disabled={busy}
                onClick={handleCloseSpot}
                title="单独市价全额卖出现货多头"
              >
                <Close size={12} /> {T.simpleCloseSpot}
              </button>
            </div>
            <div className="ex-simple-pos-row-grid">
              <div className="ex-simple-pos-item">
                <span className="ex-dim">{T.currentHolding}</span>
                <b className="ex-num">{amount(heldQty)} 股</b>
              </div>
              <div className="ex-simple-pos-item">
                <span className="ex-dim">{T.positionCost}</span>
                <b className="ex-num">{price(avgCost)}</b>
              </div>
              <div className="ex-simple-pos-item">
                <span className="ex-dim">{T.positionMarkVal}</span>
                <b className="ex-num">{money(spotVal)}</b>
              </div>
              <div className="ex-simple-pos-item is-pnl">
                <span className="ex-dim">{T.unrealizedPnl}</span>
                <b className={`ex-num ex-simple-pos-pnl-val ${spotPnl >= 0 ? 'is-up' : 'is-down'}`}>
                  {spotPnl >= 0 ? '+' : ''}{money(spotPnl)} ({pct(spotPnlPct)})
                </b>
              </div>
            </div>
          </div>
        )}

        {/* 2. 逐仓杠杆仓位行（多头 / 空头） */}
        {posList.map((p) => {
          const isShort = p.side === 'short'
          const pnlPct = p.margin > 0 ? (p.unrealizedPnl / p.margin) * 100 : 0
          const isPnlUp = p.unrealizedPnl >= 0
          return (
            <div key={p.id || `${p.code}-${p.side}`} className={`ex-simple-pos-row ${isShort ? 'is-short' : 'is-long'}`}>
              <div className="ex-simple-pos-row-head">
                <div className={`ex-simple-pos-badge ${isShort ? 'is-short' : 'is-long'}`}>
                  {isShort ? T.simpleLeverageShort : `${T.simpleLeverageLong} (${p.leverage}x)`}
                </div>
                <button
                  type="button"
                  className="ex-simple-sub-close-btn is-close"
                  disabled={busy}
                  onClick={() => handleClosePos(p.side, p.qty)}
                  title={isShort ? '单独市价全平空头仓位' : '单独市价全平多头仓位'}
                >
                  <Close size={12} /> {isShort ? T.simpleCloseShort : T.simpleCloseLong}
                </button>
              </div>
              <div className="ex-simple-pos-row-grid">
                <div className="ex-simple-pos-item">
                  <span className="ex-dim">{isShort ? '融券数量' : '杠杆数量'}</span>
                  <b className="ex-num">{amount(p.qty)} 股</b>
                </div>
                <div className="ex-simple-pos-item">
                  <span className="ex-dim">{isShort ? '开空均价' : '开多均价'}</span>
                  <b className="ex-num">{price(p.avgEntry)}</b>
                </div>
                <div className="ex-simple-pos-item">
                  <span className="ex-dim">{T.simpleEstMargin}</span>
                  <b className="ex-num">{money(p.margin)}</b>
                </div>
                <div className="ex-simple-pos-item is-pnl">
                  <span className="ex-dim">{T.unrealizedPnl}</span>
                  <b className={`ex-num ex-simple-pos-pnl-val ${isPnlUp ? 'is-up' : 'is-down'}`}>
                    {isPnlUp ? '+' : ''}{money(p.unrealizedPnl)} ({pct(pnlPct)})
                  </b>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
