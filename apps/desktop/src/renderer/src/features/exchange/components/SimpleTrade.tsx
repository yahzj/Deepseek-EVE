import { isEn } from '../../../i18n/locale'
/**
 * 极简模式 · 双向多空看涨看跌交易舱（SimpleTrade）。
 *
 * 核心设计：
 * - 全面支持【看涨 · 买多】与【看跌 · 卖空】双向交易；
 * - 两个 Tab 均以【投入资金 ISK】为输入口径，支持 25% / 50% / 75% / 全仓 快捷筹码；
 * - 做空按 2x 杠杆融券市价即时开空，无需持有现货，零门槛借券卖出；
 * - 实时换算预计股数 / 占用保证金 / 手续费，提示价格上涨增值或下跌赚差价；
 * - 纯市价委托提交后进入本回合队列，回合末集合竞价统一成交（不是即时 IOC）；
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
  const [activeRatio, setActiveRatio] = useState<number | null>(null)
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

  // 步进微调资金基数（按 1 股换算所需资金，含手续费与杠杆）
  const stepCash = tab === 'buy'
    ? Math.max(1, Math.ceil(currentPrice * (1 + feeRate)))
    : Math.max(1, Math.ceil((currentPrice / 2) * (1 + feeRate)))

  const isRatioActive = (r: number) => {
    if (activeRatio === r) return true
    const targetVal = Math.floor(cash * r)
    return targetVal > 0 && inputCashNum === targetVal
  }

  const quickCashRatio = (ratio: number) => {
    const val = Math.floor(cash * ratio)
    setCashAmount(val > 0 ? String(val) : '')
    setActiveRatio(ratio)
  }

  const handleCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 严格过滤非正整数字符，移除多余的前导 0
    const clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    setCashAmount(clean)
    setActiveRatio(null)
  }

  const handleStep = (direction: 1 | -1) => {
    const current = Number(cashAmount) || 0
    let next: number
    if (direction > 0) {
      next = Math.min(cash, current + stepCash)
    } else {
      next = Math.max(0, current - stepCash)
    }
    setCashAmount(next > 0 ? String(Math.floor(next)) : '')
    setActiveRatio(null)
  }

  const handleClear = () => {
    setCashAmount('')
    setActiveRatio(null)
  }

  // 防呆校验状态判断
  let disableReason: string | null = null
  if (busy) {
    disableReason = tab === 'buy' ? T.submittingBuy : T.submittingShort
  } else if (cash <= 0) {
    disableReason = T.noAvailableCash
  } else if (!cashAmount || inputCashNum <= 0) {
    disableReason = T.enterAmountPrompt
  } else if (inputCashNum > cash) {
    disableReason = isEn() ? `Amount exceeds available cash (limit ${money(cash)})` : `投入金额超过可用资金（可用上限 ${money(cash)}）`
  } else if (tab === 'buy' && estBuyQty <= 0) {
    disableReason = isEn() ? `Amount insufficient to buy 1 share (mark ${price(currentPrice)})` : `金额不足以买入 1 股（现价 ${price(currentPrice)}）`
  } else if (tab === 'short' && estShortQty <= 0) {
    disableReason = isEn() ? `Margin insufficient to short 1 share (mark ${price(currentPrice)})` : `保证金不足以做空 1 股（现价 ${price(currentPrice)}）`
  }
  const canSubmit = !busy && disableReason === null

  const handleBuy = async () => {
    if (busy) return
    if (estBuyQty <= 0) {
      onToast(T.toastBondInvalid, true)
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
      onToast(TF.simpleOrderDone(code, T.buy, amount(order.filledQty ?? estBuyQty)))
      setCashAmount('')
      setActiveRatio(null)
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
      onToast(TF.simpleOrderDone(code, T.sell, amount(order.filledQty ?? estShortQty)))
      setCashAmount('')
      setActiveRatio(null)
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (canSubmit) {
        if (tab === 'buy') {
          void handleBuy()
        } else {
          void handleShort()
        }
      } else if (disableReason) {
        onToast(disableReason, true)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      handleStep(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      handleStep(-1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClear()
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
          onClick={() => {
            setTab('buy')
            if (activeRatio !== null) {
              const val = Math.floor(cash * activeRatio)
              setCashAmount(val > 0 ? String(val) : '')
            }
          }}
        >
          {T.simpleTradeBuy}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'short'}
          className={`ex-simple-trade-tab is-short${tab === 'short' ? ' is-on is-active' : ''}`}
          onClick={() => {
            setTab('short')
            if (activeRatio !== null) {
              const val = Math.floor(cash * activeRatio)
              setCashAmount(val > 0 ? String(val) : '')
            }
          }}
        >
          {T.simpleTradeShort}
        </button>
      </div>

      <div className="ex-simple-trade-body">
        <div className="ex-simple-trade-form">
          <div className="ex-simple-trade-info-row">
            <span className="ex-dim">{T.availCashShort}: <b className="ex-num">{money(cash)}</b></span>
            <span className="ex-dim">{T.marketPriceShort}: <b className="ex-num">{price(currentPrice)}</b></span>
          </div>

          <div className="ex-simple-input-group">
            <div className="ex-simple-input-wrap">
              <button
                type="button"
                className="ex-simple-step-btn is-minus"
                onClick={() => handleStep(-1)}
                title="微调减少 1 股资金 (↓)"
                disabled={busy || inputCashNum <= 0}
                aria-label="减少 1 股对应资金"
              >
                -
              </button>
              <input
                id="ex-simple-cash-amount"
                className="ex-simple-input ex-num"
                type="text"
                inputMode="numeric"
                placeholder={tab === 'buy' ? T.inputBuyPlaceholder : T.inputShortPlaceholder}
                value={cashAmount}
                onChange={handleCashChange}
                onKeyDown={handleKeyDown}
                aria-label={tab === 'buy' ? T.inputAmountLabel : T.simpleEstMargin}
              />
              {cashAmount !== '' && (
                <button
                  type="button"
                  className="ex-simple-clear-btn"
                  onClick={handleClear}
                  title="清空输入 (Esc)"
                  aria-label="清空输入"
                >
                  ×
                </button>
              )}
              <span className="ex-simple-input-unit">{T.creditUnit}</span>
              <button
                type="button"
                className="ex-simple-step-btn is-plus"
                onClick={() => handleStep(1)}
                title="微调增加 1 股资金 (↑)"
                disabled={busy || inputCashNum >= cash}
                aria-label="增加 1 股对应资金"
              >
                +
              </button>
            </div>
          </div>

          {/* 快捷筹码 */}
          <div className="ex-simple-chips" role="group" aria-label="快捷比例筹码">
            <button
              type="button"
              className={`ex-simple-chip-btn${isRatioActive(0.25) ? ' is-active' : ''}`}
              title="快捷填入 25% 可用资金"
              aria-label="快捷填入 25% 可用资金"
              onClick={() => quickCashRatio(0.25)}
            >
              {T.quickBuy25}
            </button>
            <button
              type="button"
              className={`ex-simple-chip-btn${isRatioActive(0.5) ? ' is-active' : ''}`}
              title="快捷填入 50% 可用资金"
              aria-label="快捷填入 50% 可用资金"
              onClick={() => quickCashRatio(0.5)}
            >
              {T.quickBuy50}
            </button>
            <button
              type="button"
              className={`ex-simple-chip-btn${isRatioActive(0.75) ? ' is-active' : ''}`}
              title="快捷填入 75% 可用资金"
              aria-label="快捷填入 75% 可用资金"
              onClick={() => quickCashRatio(0.75)}
            >
              {T.quickBuy75}
            </button>
            <button
              type="button"
              className={`ex-simple-chip-btn is-max${isRatioActive(1.0) ? ' is-active' : ''}`}
              title="快捷填入全部可用资金"
              aria-label="快捷填入全部可用资金"
              onClick={() => quickCashRatio(1.0)}
            >
              {T.quickBuyAll}
            </button>
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
                <b className="ex-num ex-highlight-green">{amount(estBuyQty)} {T.sharesSuffix}</b>
              </div>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.estFeeLabel} (0.1%)</span>
                <span className="ex-num">{money(estBuyFee)}</span>
              </div>
            </div>
          ) : (
            <div className="ex-simple-trade-preview">
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{isEn() ? 'Est. Short (2x)' : '预计做空 (2x)'}</span>
                <b className="ex-num ex-highlight-red">{amount(estShortQty)} {T.sharesSuffix}</b>
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

          {/* 操作按钮 */}
          {tab === 'buy' ? (
            <button
              type="button"
              className="ex-simple-big-action-btn is-buy"
              disabled={!canSubmit}
              onClick={handleBuy}
              title={canSubmit ? '提交市价买多（回合末集合竞价成交）(Enter)' : (disableReason ?? '')}
            >
              {busy ? T.submittingBuy : `${T.simpleBuyAction} · ${code}`}
            </button>
          ) : (
            <button
              type="button"
              className="ex-simple-big-action-btn is-short"
              disabled={!canSubmit}
              onClick={handleShort}
              title={canSubmit ? '提交融券卖空（回合末集合竞价成交）(Enter)' : (disableReason ?? '')}
            >
              {busy ? T.submittingShort : `${T.simpleShortAction} · ${code}`}
            </button>
          )}

          {/* 防呆提示与就绪反馈 */}
          <div className={`ex-simple-trade-guard-hint ${canSubmit ? 'is-ready' : 'is-disabled'}`}>
            <span className="ex-simple-guard-dot" />
            <span className="ex-simple-guard-text">
              {canSubmit ? T.orderReadyHint : disableReason}
            </span>
          </div>

          {/* 回合制待成交委托：明确告诉玩家「已提交、等回合末成交」，不是没买到 */}
          {snap.orders.length > 0 ? (
            <div className="ex-simple-trade-preview" role="status" aria-label={T.simplePendingTitle}>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.simplePendingTitle}（{T.simplePendingNote}）</span>
                <b className="ex-num">{snap.orders.length} {isEn() ? 'orders' : '笔'}</b>
              </div>
              {snap.orders.slice(0, 3).map((order) => (
                <div className="ex-simple-preview-row" key={order.id}>
                  <span className="ex-dim">
                    {order.side === 'buy' ? '买' : '卖'} {order.code} ·{' '}
                    {order.type === 'market' ? '市价' : price(order.price ?? 0)}
                  </span>
                  <span className="ex-num">{amount(order.qty)} {T.sharesSuffix} · {isEn() ? 'Round-end settlement' : '待回合末成交'}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
