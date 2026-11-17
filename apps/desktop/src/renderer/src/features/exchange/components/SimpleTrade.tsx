import { isEn } from '../../../i18n/locale'
import { useEffect, useRef, useState } from 'react'
import type { ExchangeClient, ExchangeOrder, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, estimateSimpleBet, money, price } from '../format'
import { T, TF } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'
import { notifyUiAction } from '../../../game/audio/uiFeedback'
import { playCue } from '../../../game/audio/player'

interface SimpleTradeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onToast: ToastFn
  onAllInFx?: (on: boolean) => void
}

export function SimpleTrade({ client, snap, code, onToast, onAllInFx }: SimpleTradeProps) {
  const [tab, setTab] = useState<'buy' | 'short'>('buy')
  const [cashAmount, setCashAmount] = useState<string>('')
  const [activeRatio, setActiveRatio] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const orderSeq = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const allInSeq = useRef(0)
  const allInTimer = useRef<number | null>(null)
  const buyProgress = useActionProgress(client)
  const shortProgress = useActionProgress(client)

  const quote = snap.stocks.find((s) => s.code === code)
  const currentPrice = quote?.price ?? 1
  const cash = snap.account.cash
  const dailyUsed =
    tab === 'buy'
      ? (snap.account.dailyBuyUsed ?? snap.account.dailyTradeUsed)
      : (snap.account.dailySellUsed ?? snap.account.dailyTradeUsed)
  const dailyTurnoverLeft = Math.max(0, snap.account.dailyTradeLimit - dailyUsed)
  const turnoverPct =
    snap.account.dailyTradeLimit > 0
      ? Math.max(0, Math.min(100, (dailyUsed / snap.account.dailyTradeLimit) * 100))
      : 0

  const inputCashNum = Number(cashAmount) || 0
  const feeRate = snap.feeRate ?? 0
  const hasFee = feeRate > 0
  const tradeCapQty = currentPrice > 0 ? Math.floor(dailyTurnoverLeft / currentPrice) : 0
  const maxQtyPerOrder = client.maxOrderQty ?? 10_000_000
  const est = estimateSimpleBet(Math.min(inputCashNum, dailyTurnoverLeft * (1 + feeRate)), currentPrice, feeRate, cash)
  const estBuyQty = Math.min(est.qty, maxQtyPerOrder)
  const estShortQty = Math.min(est.qty, maxQtyPerOrder)

  const stepCash = Math.max(1, Math.ceil(currentPrice * (1 + feeRate)))
  const pendingOrders = snap.orders.filter((order) => order.code === code)

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

  useEffect(
    () => () => {
      if (allInTimer.current !== null) window.clearTimeout(allInTimer.current)
    },
    [],
  )

  const triggerAllInFx = () => {
    allInSeq.current += 1
    const seq = allInSeq.current
    onAllInFx?.(true)
    const stop = (): void => {
      if (allInSeq.current === seq) onAllInFx?.(false)
    }
    const audio = playCue('exchange-allin')
    if (allInTimer.current !== null) window.clearTimeout(allInTimer.current)
    allInTimer.current = window.setTimeout(() => {
      if (audio !== null) {
        try {
          audio.pause()
          audio.dispatchEvent(new Event('ended'))
        } catch {
        }
      }
      stop()
    }, 1500)
  }

  const handleCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  let disableReason: string | null = null
  if (busy) {
    disableReason = tab === 'buy' ? T.submittingBuy : T.submittingShort
  } else if (cash <= 0) {
    disableReason = T.noAvailableCash
  } else if (!cashAmount || inputCashNum <= 0) {
    disableReason = T.enterAmountPrompt
  } else if (inputCashNum > cash) {
    disableReason = isEn() ? `Amount exceeds available cash (limit ${money(cash)})` : `投入金额超过可用资金（可用上限 ${money(cash)}）`
  } else if (tradeCapQty <= 0) {
    disableReason = T.exchangeDailyLimit
  } else if (tab === 'buy' && estBuyQty <= 0) {
    disableReason = isEn() ? `Amount insufficient to buy 1 share (mark ${price(currentPrice)})` : `金额不足以买入 1 股（现价 ${price(currentPrice)}）`
  } else if (tab === 'short' && quote !== undefined && !quote.shortable) {
    disableReason = T.noShort
  } else if (tab === 'short' && estShortQty <= 0) {
    disableReason = isEn() ? `Margin insufficient to short 1 share (mark ${price(currentPrice)})` : `保证金不足以做空 1 股（现价 ${price(currentPrice)}）`
  }
  const canSubmit = !busy && disableReason === null

  const showGuard = (): void => {
    if (disableReason === null) return
    inputRef.current?.focus()
    onToast(disableReason, true)
  }

  const handleBuy = async () => {
    if (busy) return
    const allIn = activeRatio === 1
    const latest = client.getSnapshot(code)
    const latestCash = latest.account.cash
    const latestPrice = latest.quote.price > 0 ? latest.quote.price : currentPrice
    const baseCash = Math.min(inputCashNum, latestCash)
    const latestEst = estimateSimpleBet(baseCash, latestPrice, feeRate, latestCash)
    let qty = Math.min(latestEst.qty, tradeCapQty, maxQtyPerOrder)
    if (qty <= 0) {
      onToast(allIn ? T.toastNoCash : T.enterAmountPrompt, true)
      return
    }

    setBusy(true)
    buyProgress.start()
    orderSeq.current += 1
    try {
      let order: ExchangeOrder | null = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          order = await client.placeOrder({
            clientOrderId: `simple-buy-${code}-${Date.now()}-${orderSeq.current}`,
            code,
            side: 'buy',
            type: 'market',
            tif: 'IOC',
            qty,
            leverage: 1,
            guaranteed: true,
            expectedPrice: latestPrice,
          })
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (attempt >= 2 || !msg.includes('余额不足')) throw err
          const match = msg.match(/需要冻结\s*(\d+)[，,]\s*现有\s*(\d+)/)
          const over = match ? Number(match[1]) - Number(match[2]) : 0
          qty -= Math.max(1, over > 0 ? Math.ceil(over / latestPrice) : Math.ceil(qty * 0.01))
          if (qty <= 0) throw err
        }
      }
      if (!order) throw new Error('order retry exhausted')
      if (allIn) triggerAllInFx()
      else notifyUiAction('exchange-bet')
      await buyProgress.finish()
      onToast(TF.simpleOrderDone(code, T.buy, amount(order.filledQty || order.qty)))
      setCashAmount('')
      setActiveRatio(null)
    } catch (err) {
      await buyProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  const handleShort = async () => {
    if (busy) return
    const allIn = activeRatio === 1
    const latest = client.getSnapshot(code)
    const latestCash = latest.account.cash
    const latestPrice = latest.quote.price > 0 ? latest.quote.price : currentPrice
    const baseCash = Math.min(inputCashNum, latestCash)
    const latestEst = estimateSimpleBet(baseCash, latestPrice, feeRate, latestCash)
    let qty = Math.min(latestEst.qty, tradeCapQty, maxQtyPerOrder)
    if (qty <= 0) {
      onToast(T.enterAmountPrompt, true)
      return
    }

    setBusy(true)
    shortProgress.start()
    orderSeq.current += 1
    try {
      let order: ExchangeOrder | null = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          order = await client.placeOrder({
            clientOrderId: `simple-short-${code}-${Date.now()}-${orderSeq.current}`,
            code,
            side: 'sell',
            type: 'market',
            tif: 'IOC',
            qty,
            leverage: 1,
            short: true,
            guaranteed: true,
            expectedPrice: latestPrice,
          })
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (attempt >= 2 || !msg.includes('余额不足')) throw err
          const match = msg.match(/需要冻结\s*(\d+)[，,]\s*现有\s*(\d+)/)
          const over = match ? Number(match[1]) - Number(match[2]) : 0
          qty -= Math.max(1, over > 0 ? Math.ceil(over / latestPrice) : Math.ceil(qty * 0.01))
          if (qty <= 0) throw err
        }
      }
      if (!order) throw new Error('order retry exhausted')
      if (allIn) triggerAllInFx()
      else notifyUiAction('exchange-bet')
      await shortProgress.finish()
      onToast(TF.simpleOrderDone(code, T.sell, amount(order.filledQty || order.qty)))
      setCashAmount('')
      setActiveRatio(null)
    } catch (err) {
      await shortProgress.finish(false)
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
      } else {
        showGuard()
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
            disabled={busy}
          className={`ex-simple-trade-tab is-buy${tab === 'buy' ? ' is-on is-active' : ''}`}
          onClick={() => {
            setTab('buy')
            if (activeRatio !== null) {
              const val = Math.floor(cash * activeRatio)
              setCashAmount(val > 0 ? String(val) : '')
            }
          }}
        >
          <span aria-hidden="true">▲</span> {T.simpleTradeBuy}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'short'}
            disabled={busy}
          className={`ex-simple-trade-tab is-short${tab === 'short' ? ' is-on is-active' : ''}`}
          onClick={() => {
            setTab('short')
            if (activeRatio !== null) {
              const val = Math.floor(cash * activeRatio)
              setCashAmount(val > 0 ? String(val) : '')
            }
          }}
        >
          <span aria-hidden="true">▼</span> {T.simpleTradeShort}
        </button>
      </div>

      <div className="ex-simple-trade-body">
        <div className="ex-simple-trade-form">
          <div className="ex-simple-trade-info-row">
            <span className="ex-dim">{T.availCashShort}: <b className="ex-num">{money(cash)}</b></span>
            <span className="ex-dim">{T.marketPriceShort}: <b className="ex-num">{price(currentPrice)}</b></span>
          </div>
          <div className="ex-turnover-meter">
            <div className="ex-turnover-meter-head">
              <span title={T.tipDailyTurnover}>{tab === 'buy' ? T.buyTurnoverQuota : T.sellTurnoverQuota}</span>
              <span className="ex-num">{money(dailyUsed)} / {money(snap.account.dailyTradeLimit)}</span>
            </div>
            <div className="ex-turnover-meter-track">
              <span className="ex-turnover-meter-fill" style={{ width: `${turnoverPct}%` }} />
            </div>
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
                ref={inputRef}
                id="ex-simple-cash-amount"
                className="ex-simple-input ex-num"
                type="text"
                inputMode="numeric"
                placeholder={tab === 'buy' ? T.inputBuyPlaceholder : T.inputShortPlaceholder}
                value={cashAmount}
                onChange={handleCashChange}
                onKeyDown={handleKeyDown}
                aria-label={tab === 'buy' ? T.inputAmountLabel : T.simpleEstMargin}
                aria-invalid={!canSubmit && cashAmount !== '' ? true : undefined}
                aria-describedby="ex-simple-guard-hint"
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

          {/* 金额前馈：股数 / 手续费 / 费后实际支出 / 提交后可用（含全仓费后取整差额） */}
          <div className="ex-simple-trade-preview">
            <div className="ex-simple-preview-row">
              <span className="ex-dim">{tab === 'buy' ? T.estSharesLabel : (isEn() ? 'Est. Fall' : '预计看跌')}</span>
              <b className={`ex-num ${tab === 'buy' ? 'ex-highlight-green' : 'ex-highlight-red'}`}>{amount(est.qty)} {T.sharesSuffix}</b>
            </div>
            <div className="ex-simple-preview-row">
              <span className="ex-dim" title={T.tipFee}>{T.estFeeLabel} {hasFee ? `(${(feeRate * 100).toFixed(2)}%)` : `(${T.freeFee})`}</span>
              <span className="ex-num">{money(est.fee)} {T.creditUnit}</span>
            </div>
            <div className="ex-simple-preview-row">
              <span className="ex-dim">{T.simpleActualCostLabel}</span>
              <span className="ex-num">{money(est.spend)} {T.creditUnit}</span>
            </div>
            <div className="ex-simple-preview-row">
              <span className="ex-dim">{T.simpleRemainCashLabel}</span>
              <span className="ex-num">{money(est.remainCash)} {T.creditUnit}</span>
            </div>
          </div>

          {/* 主按钮分向动宾：方向由文字与符号共同承载，不只靠色相 */}
          {/* 音效：data-sfx-on="success" = 点击这一拍不排队，成功回执后才由 handleBuy/handleShort 响 exchange-bet；
              被本地校验或服务端拒绝时只剩 ui-error，不会叠两声。 */}
          <button
            type="button"
            className={`ex-simple-big-action-btn ${tab === 'buy' ? 'is-buy' : 'is-short'} ex-btn-progress`}
            data-sfx="exchange-bet"
            data-sfx-on="success"
            aria-label={tab === 'buy' ? T.simpleBuyAction : T.simpleShortAction}
            aria-disabled={!canSubmit}
            style={progressStyle(tab === 'buy' ? buyProgress : shortProgress)}
            onClick={() => {
              if (busy) return
              if (!canSubmit) {
                showGuard()
                return
              }
              void (tab === 'buy' ? handleBuy() : handleShort())
            }}
            title={canSubmit ? `${tab === 'buy' ? T.simpleBuyAction : T.simpleShortAction}（${T.simplePendingNote}）(Enter)` : (disableReason ?? '')}
          >
            <span aria-hidden="true">{tab === 'buy' ? '↗' : '↘'}</span>{' '}
            {T.betAction}
            <span className="ex-hud-en" aria-hidden="true">// EXECUTE</span>
            {(tab === 'buy' ? buyProgress : shortProgress).active ? ` ${(tab === 'buy' ? buyProgress : shortProgress).pct}%` : ''}
          </button>

          {/* 防呆提示与就绪反馈 */}
          <div id="ex-simple-guard-hint" className={`ex-simple-trade-guard-hint ${canSubmit ? 'is-ready' : 'is-disabled'}`} role="status">
            <span className="ex-simple-guard-dot" />
            <span className="ex-simple-guard-text">
              {canSubmit ? T.orderReadyHint : disableReason}
            </span>
          </div>

          {/* 回合制待成交下注：明确「已提交、等回合末集合竞价」，并告知可撤销 */}
          {pendingOrders.length > 0 ? (
            <div className="ex-simple-trade-preview" role="status" aria-label={T.simplePendingTitle}>
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.simplePendingTitle}（{T.simplePendingNote}）</span>
                <b className="ex-num">{pendingOrders.length} {isEn() ? 'orders' : '笔'}</b>
              </div>
              {pendingOrders.slice(0, 3).map((order) => (
                <div className="ex-simple-preview-row" key={order.id}>
                  <span className="ex-dim">
                    {order.side === 'buy' ? '买' : '卖'} {order.code} ·{' '}
                    {order.type === 'market' ? '市价' : price(order.price ?? 0)}
                  </span>
                  <span className="ex-num">{amount(order.qty)} {T.sharesSuffix} · {T.simplePendingNote}</span>
                </div>
              ))}
              <div className="ex-simple-preview-row">
                <span className="ex-dim">{T.simpleUndoHint}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
