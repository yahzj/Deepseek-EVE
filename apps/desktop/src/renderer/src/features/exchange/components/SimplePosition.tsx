/**
 * 极简模式 · 当前标的持仓看板（SimplePosition）。
 *
 * 紧贴买卖舱下方，直观展示当前股票的持仓数量、持仓成本与浮动盈亏，
 * 并提供【一键全部平仓变现】大按钮，让玩家对赚赔一目了然、落袋为安零门槛。
 */
import { useRef, useState } from 'react'
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

  // 当前股票的现货持仓
  const holding = snap.account.holdings.find((h) => h.code === code)
  const heldQty = holding?.availableQty ?? holding?.qty ?? 0
  const avgCost = holding?.avgCost ?? 0

  // 杠杆持仓（若此前在专业模式开过多空）
  const posList = snap.account.positions.filter((p) => p.code === code)

  const hasAnyPosition = heldQty > 0 || posList.length > 0

  if (!hasAnyPosition) {
    return (
      <div className="ex-simple-pos-card is-empty">
        <div className="ex-simple-pos-empty-text">
          <span className="ex-dim">当前未持有 <b>{code}</b> 的任何股份，可在上方买入建仓</span>
        </div>
      </div>
    )
  }

  // 现货盈亏
  const spotVal = heldQty * curPrice
  const spotCost = heldQty * avgCost
  const spotPnl = spotVal - spotCost
  const spotPnlPct = spotCost > 0 ? (spotPnl / spotCost) * 100 : 0
  const isUp = spotPnl >= 0

  // 一键全部平仓清仓
  const handleCloseAll = async () => {
    if (busy) return
    setBusy(true)
    orderSeq.current += 1
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
        await client.closePosition(p.code, p.side)
      }
      onToast(TF.closeAllDone(code, amount(heldQty)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`ex-simple-pos-card${isUp ? ' is-profit' : ' is-loss'}`}>
      <div className="ex-simple-pos-head">
        <h4 className="ex-simple-pos-title">我的【{code}】持仓战报</h4>
        <button
          type="button"
          className="ex-simple-close-btn"
          disabled={busy}
          onClick={handleCloseAll}
        >
          {busy ? '清仓中…' : T.closeAllPositions}
        </button>
      </div>

      <div className="ex-simple-pos-grid">
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
          <b className={`ex-num ${isUp ? 'is-up' : 'is-down'}`}>
            {isUp ? '+' : ''}{money(spotPnl)} ({pct(spotPnlPct)})
          </b>
        </div>
      </div>

      {posList.length > 0 ? (
        <div className="ex-simple-pos-warn-line">
          <span className="ex-dim">提示：本标的尚存 {posList.length} 笔高阶杠杆持仓，可在右上角切至「专业终端」管理强平线与止盈止损。</span>
        </div>
      ) : null}
    </div>
  )
}

