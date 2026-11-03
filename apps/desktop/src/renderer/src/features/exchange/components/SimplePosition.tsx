/**
 * 极简模式 · 当前标的持仓战报（SimplePosition）。
 *
 * 紧凑清晰展现持仓股数、持仓成本、现股市值与浮动盈亏，
 * 提供【一键全部平仓变现】大按钮。
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
        <div className="ex-simple-pos-empty-inner">

          <div className="ex-simple-pos-empty-title">暂未持有 {code} 股份</div>
          <span className="ex-dim">可在左侧买卖舱输入金额，一键市价买入建仓</span>
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
          title="以市价卖出当前标的所有现货与平掉杠杆仓位"
        >
          {busy ? '清仓中…' : <><Close size={13} /> {T.closeAllPositions}</>}
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
          <b className={`ex-num ex-simple-pos-pnl-val ${isUp ? 'is-up' : 'is-down'}`}>
            {isUp ? '+' : ''}{money(spotPnl)} ({pct(spotPnlPct)})
          </b>
        </div>
      </div>

      {posList.length > 0 ? (
        <div className="ex-simple-pos-warn-line">
          <span className="ex-dim">
            提示：检测到 {posList.length} 笔杠杆仓位，可在顶栏切至「专业终端」管理。
          </span>
        </div>
      ) : null}
    </div>
  )
}
