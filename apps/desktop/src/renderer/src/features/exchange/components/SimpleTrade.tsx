/**
 * 极简模式 · 现货傻瓜式买卖舱（SimpleTrade）。
 *
 * 核心设计：
 * - 纯现货市价即时成交（IOC），永不爆仓零门槛；
 * - 25% / 50% / 75% / 全仓 快捷筹码；
 * - 实时换算预计股数 / 变现金额，明示 0.1% 手续费；
 * - 深度贴合深空科幻 HUD 视觉，类名严格与 exchange.css 对齐。
 */
import { useRef, useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, price } from '../format'
import { T, TF } from '../texts'

interface SimpleTradeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onToast: ToastFn
}

export function SimpleTrade({ client, snap, code, onToast }: SimpleTradeProps) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy')
  const [buyAmount, setBuyAmount] = useState<string>('')
  const [sellQty, setSellQty] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const orderSeq = useRef(0)

  const quote = snap.stocks.find((s) => s.code === code)
  const currentPrice = quote?.price ?? 1
  const cash = snap.account.cash

  // 当前股票的现货持仓
  const holding = snap.account.holdings.find((h) => h.code === code)
  const heldQty = holding?.availableQty ?? holding?.qty ?? 0

  // 买入换算：输入金额 → 股数
  const inputAmountNum = Number(buyAmount) || 0
  const feeRate = 0.001 // 0.1% 手续费
  const effectiveCash = inputAmountNum / (1 + feeRate)
  const estBuyQty = currentPrice > 0 ? Math.floor(effectiveCash / currentPrice) : 0
  const estBuyFee = effectiveCash * feeRate

  // 卖出换算：输入股数 → 变现金额
  const inputSellQtyNum = Math.min(heldQty, Math.max(0, Math.floor(Number(sellQty) || 0)))
  const rawProceeds = inputSellQtyNum * currentPrice
  const estSellFee = rawProceeds * feeRate
  const estNetProceeds = rawProceeds - estSellFee

  const quickBuyRatio = (ratio: number) => {
    const val = Math.floor(cash * ratio)
    setBuyAmount(val > 0 ? String(val) : '')
  }

  const quickSellRatio = (ratio: number) => {
    const val = Math.floor(heldQty * ratio)
    setSellQty(val > 0 ? String(val) : '')
  }

  const handleBuy = async () => {
    if (busy) return
    if (estBuyQty <= 0) {
      onToast('请输入有效的买入金额', true)
      return
    }
    if (inputAmountNum > cash) {
      onToast(T.toastNoCash, true)
      return
    }

    setBusy(true)
    orderSeq.current += 1
    try {
      const order = await client.placeOrder({
        clientOrderId: `simple-buy-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'buy',
        type: 'market',
        tif: 'IOC',
        qty: estBuyQty,
        leverage: 1,
      })
      onToast(TF.simpleOrderDone(code, '买入', amount(order.filledQty ?? estBuyQty)))
      setBuyAmount('')
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  const handleSell = async () => {
    if (busy) return
    if (inputSellQtyNum <= 0) {
      onToast('请输入有效的卖出数量', true)
      return
    }
    if (inputSellQtyNum > heldQty) {
      onToast(T.toastNoHolding, true)
      return
    }

    setBusy(true)
    orderSeq.current += 1
    try {
      const order = await client.placeOrder({
        clientOrderId: `simple-sell-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'sell',
        type: 'market',
        tif: 'IOC',
        qty: inputSellQtyNum,
        leverage: 1,
      })
      onToast(TF.simpleOrderDone(code, '卖出', amount(order.filledQty ?? inputSellQtyNum)))
      setSellQty('')
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ex-simple-trade-card">
      {/* 顶部 Tab 切换 */}
      <div className="ex-simple-trade-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'buy'}
          className={`ex-simple-trade-tab is-buy${tab === 'buy' ? ' is-on is-active' : ''}`}
          onClick={() => setTab('buy')}
        >
          {T.simpleTradeBuy}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sell'}
          className={`ex-simple-trade-tab is-sell${tab === 'sell' ? ' is-on is-active' : ''}`}
          onClick={() => setTab('sell')}
        >
          {T.simpleTradeSell} {heldQty > 0 ? `(${amount(heldQty)})` : ''}
        </button>
      </div>

      <div className="ex-simple-trade-body">
        {tab === 'buy' ? (
          <div className="ex-simple-trade-form">
            <div className="ex-simple-trade-info-row">
              <span className="ex-dim">可用: <b className="ex-num">{money(cash)}</b></span>
              <span className="ex-dim">市价: <b className="ex-num">{price(currentPrice)}</b></span>
            </div>

            <div className="ex-simple-input-group">
              <div className="ex-simple-input-wrap">
                <input
                  id="ex-simple-buy-amount"
                  className="ex-simple-input ex-num"
                  type="number"
                  min="0"
                  placeholder="输入买入金额"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                />
                <span className="ex-simple-input-unit">ISK</span>
              </div>
            </div>

            {/* 快捷筹码 */}
            <div className="ex-simple-chips">
              <button type="button" className="ex-simple-chip-btn" onClick={() => quickBuyRatio(0.25)}>{T.quickBuy25}</button>
              <button type="button" className="ex-simple-chip-btn" onClick={() => quickBuyRatio(0.5)}>{T.quickBuy50}</button>
              <button type="button" className="ex-simple-chip-btn" onClick={() => quickBuyRatio(0.75)}>{T.quickBuy75}</button>
              <button type="button" className="ex-simple-chip-btn is-max" onClick={() => quickBuyRatio(1.0)}>{T.quickBuyAll}</button>
            </div>

            {/* 预估换算 */}
            <div className="ex-simple-trade-preview">
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.estSharesLabel}</span>
                <b className="ex-num ex-highlight-green">{amount(estBuyQty)} 股</b>
              </div>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.estFeeLabel} (0.1%)</span>
                <span className="ex-num">{money(estBuyFee)}</span>
              </div>
            </div>

            <button
              type="button"
              className="ex-simple-big-action-btn is-buy"
              disabled={busy || estBuyQty <= 0 || inputAmountNum > cash}
              onClick={handleBuy}
            >
              {busy ? '下单中…' : `${T.simpleBuyAction} · ${code}`}
            </button>
          </div>
        ) : (
          <div className="ex-simple-trade-form">
            <div className="ex-simple-trade-info-row">
              <span className="ex-dim">可卖: <b className="ex-num">{amount(heldQty)} 股</b></span>
              <span className="ex-dim">市值: <b className="ex-num">{money(heldQty * currentPrice)}</b></span>
            </div>

            <div className="ex-simple-input-group">
              <div className="ex-simple-input-wrap">
                <input
                  id="ex-simple-sell-qty"
                  className="ex-simple-input ex-num"
                  type="number"
                  min="0"
                  max={heldQty}
                  placeholder={`可卖 ${heldQty} 股`}
                  value={sellQty}
                  onChange={(e) => setSellQty(e.target.value)}
                />
                <span className="ex-simple-input-unit">股</span>
              </div>
            </div>

            {/* 快捷减仓 */}
            <div className="ex-simple-chips">
              <button type="button" className="ex-simple-chip-btn" onClick={() => quickSellRatio(0.25)}>{T.quickSell25}</button>
              <button type="button" className="ex-simple-chip-btn" onClick={() => quickSellRatio(0.5)}>{T.quickSellHalf}</button>
              <button type="button" className="ex-simple-chip-btn" onClick={() => quickSellRatio(0.75)}>{T.quickSell75}</button>
              <button type="button" className="ex-simple-chip-btn is-max" onClick={() => quickSellRatio(1.0)}>{T.quickSellAll}</button>
            </div>

            {/* 预估变现 */}
            <div className="ex-simple-trade-preview">
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.estProceedsLabel}</span>
                <b className="ex-num ex-highlight-green">{money(estNetProceeds)}</b>
              </div>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.estFeeLabel} (0.1%)</span>
                <span className="ex-num">{money(estSellFee)}</span>
              </div>
            </div>

            <button
              type="button"
              className="ex-simple-big-action-btn is-sell"
              disabled={busy || inputSellQtyNum <= 0 || inputSellQtyNum > heldQty}
              onClick={handleSell}
            >
              {busy ? '变现中…' : `${T.simpleSellAction} · ${code}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
