/**
 * 极简模式 · 双向多空看涨看跌交易舱（SimpleTrade）。
 *
 * 核心设计：
 * - 全面支持【看涨 · 买多】与【看跌 · 卖空】双向交易；
 * - 两个 Tab 均以【投入资金 ISK】为输入口径，支持 25% / 50% / 75% / 全仓 快捷筹码；
 * - 做空按 2x 杠杆融券市价即时开空，无需持有现货，零门槛借券卖出；
 * - 实时换算预计股数 / 占用保证金 / 手续费，提示价格上涨增值或下跌赚差价；
 * - 纯市价即时成交（IOC），深度贴合深空科幻 HUD 视觉。
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
  const [tab, setTab] = useState<'buy' | 'short'>('buy')
  const [cashAmount, setCashAmount] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const orderSeq = useRef(0)

  const quote = snap.stocks.find((s) => s.code === code)
  const currentPrice = quote?.price ?? 1
  const cash = snap.account.cash

  const inputCashNum = Number(cashAmount) || 0
  const feeRate = snap.feeRate ?? 0.001 // 手续费率 (默认 0.1%)
  const effectiveCash = inputCashNum > 0 ? inputCashNum / (1 + feeRate) : 0

  // 买多换算：现货 1x
  const estBuyQty = currentPrice > 0 ? Math.floor(effectiveCash / currentPrice) : 0
  const estBuyFee = effectiveCash * feeRate

  // 卖空换算：融券 2x 杠杆
  const estShortQty = currentPrice > 0 ? Math.floor((effectiveCash * 2) / currentPrice) : 0
  const estShortMargin = (estShortQty * currentPrice) / 2
  const estShortFee = (estShortQty * currentPrice) * feeRate

  const quickCashRatio = (ratio: number) => {
    const val = Math.floor(cash * ratio)
    setCashAmount(val > 0 ? String(val) : '')
  }

  const handleBuy = async () => {
    if (busy) return
    if (estBuyQty <= 0) {
      onToast('请输入有效的投入金额', true)
      return
    }
    if (inputCashNum > cash) {
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
      onToast(TF.simpleOrderDone(code, '买多', amount(order.filledQty ?? estBuyQty)))
      setCashAmount('')
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  const handleShort = async () => {
    if (busy) return
    if (estShortQty <= 0) {
      onToast('请输入有效的投入金额', true)
      return
    }
    if (inputCashNum > cash) {
      onToast(T.toastNoCash, true)
      return
    }

    setBusy(true)
    orderSeq.current += 1
    try {
      const order = await client.placeOrder({
        clientOrderId: `simple-short-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'sell',
        type: 'market',
        tif: 'IOC',
        qty: estShortQty,
        leverage: 2,
      })
      onToast(TF.simpleOrderDone(code, '卖空', amount(order.filledQty ?? estShortQty)))
      setCashAmount('')
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
          aria-selected={tab === 'short'}
          className={`ex-simple-trade-tab is-short${tab === 'short' ? ' is-on is-active' : ''}`}
          onClick={() => setTab('short')}
        >
          {T.simpleTradeShort}
        </button>
      </div>

      <div className="ex-simple-trade-body">
        <div className="ex-simple-trade-form">
          <div className="ex-simple-trade-info-row">
            <span className="ex-dim">可用: <b className="ex-num">{money(cash)}</b></span>
            <span className="ex-dim">市价: <b className="ex-num">{price(currentPrice)}</b></span>
          </div>

          <div className="ex-simple-input-group">
            <div className="ex-simple-input-wrap">
              <input
                id="ex-simple-cash-amount"
                className="ex-simple-input ex-num"
                type="number"
                min="0"
                placeholder={tab === 'buy' ? '输入买多金额' : '输入卖空保证金'}
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
              <span className="ex-simple-input-unit">ISK</span>
            </div>
          </div>

          {/* 快捷筹码 */}
          <div className="ex-simple-chips">
            <button type="button" className="ex-simple-chip-btn" onClick={() => quickCashRatio(0.25)}>{T.quickBuy25}</button>
            <button type="button" className="ex-simple-chip-btn" onClick={() => quickCashRatio(0.5)}>{T.quickBuy50}</button>
            <button type="button" className="ex-simple-chip-btn" onClick={() => quickCashRatio(0.75)}>{T.quickBuy75}</button>
            <button type="button" className="ex-simple-chip-btn is-max" onClick={() => quickCashRatio(1.0)}>{T.quickBuyAll}</button>
          </div>

          {/* 交易模式特征说明 */}
          <div className={`ex-simple-trade-hint ${tab === 'buy' ? 'is-buy' : 'is-short'}`}>
            {tab === 'buy' ? T.simpleBuyHint : T.simpleShortHint}
          </div>

          {/* 预估换算 */}
          {tab === 'buy' ? (
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
          ) : (
            <div className="ex-simple-trade-preview">
              <div className="ex-simple-preview-row">
                <span className="ex-dim">预计做空 (2x)</span>
                <b className="ex-num ex-highlight-red">{amount(estShortQty)} 股</b>
              </div>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.simpleEstMargin}</span>
                <span className="ex-num">{money(estShortMargin)}</span>
              </div>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.estFeeLabel} (0.1%)</span>
                <span className="ex-num">{money(estShortFee)}</span>
              </div>
            </div>
          )}

          {tab === 'buy' ? (
            <button
              type="button"
              className="ex-simple-big-action-btn is-buy"
              disabled={busy || estBuyQty <= 0 || inputCashNum > cash}
              onClick={handleBuy}
            >
              {busy ? '买多下单中…' : `${T.simpleBuyAction} · ${code}`}
            </button>
          ) : (
            <button
              type="button"
              className="ex-simple-big-action-btn is-short"
              disabled={busy || estShortQty <= 0 || inputCashNum > cash}
              onClick={handleShort}
            >
              {busy ? '卖空开仓中…' : `${T.simpleShortAction} · ${code}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
