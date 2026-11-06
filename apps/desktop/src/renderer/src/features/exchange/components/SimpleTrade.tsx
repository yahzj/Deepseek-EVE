import { isEn } from '../../../i18n/locale'
/**
 * 极简模式 · 双向多空看涨看跌交易舱（SimpleTrade）。
 *
 * 核心设计：
 * - 全面支持【看涨 · 买多】与【看跌 · 卖空】双向交易；
 * - 两个 Tab 均以【投入资金 ISK】为输入口径，支持 25% / 50% / 75% / 全仓 快捷筹码；
 * - 看跌按 1x 全额融券市价开空（投入多少占用多少，只收手续费），无需持有现货；
 * - 金额换算集中走 `estimateSimpleBet`：就地前馈股数 / 手续费 / 费后实际支出 / 提交后可用；
 * - 提交后进入本回合队列，回合末集合竞价统一成交（船长 2026-11-05 裁定）。
 *   `tif:'IOC'` 只是客户端兼容占位字段，不代表即时成交；服务端按
 *   `docs/design/stock-exchange-round-model-20261103.md:11,14,36` 统一回合末批量撮合。
 */
import { useRef, useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, estimateSimpleBet, money, price } from '../format'
import { T, TF } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'
import { notifyUiAction } from '../../../game/audio/uiFeedback'

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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const buyProgress = useActionProgress(client)
  const shortProgress = useActionProgress(client)

  const quote = snap.stocks.find((s) => s.code === code)
  const currentPrice = quote?.price ?? 1
  const cash = snap.account.cash
  const dailyTurnoverLeft = Math.max(0, snap.account.dailyTradeLimit - snap.account.dailyTradeUsed)

  const inputCashNum = Number(cashAmount) || 0
  const feeRate = snap.feeRate ?? 0
  const hasFee = feeRate > 0
  const tradeCapQty = currentPrice > 0 ? Math.floor(dailyTurnoverLeft / currentPrice) : 0
  const est = estimateSimpleBet(Math.min(inputCashNum, dailyTurnoverLeft * (1 + feeRate)), currentPrice, feeRate, cash)
  // 买多与看跌同为 1x 全额换算（看跌融券，投入多少占用多少）
  const estBuyQty = est.qty
  const estShortQty = est.qty

  // 步进微调资金基数（按 1 股换算所需资金，含手续费；两侧同为全额）
  const stepCash = Math.max(1, Math.ceil(currentPrice * (1 + feeRate)))

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

  /** 主按钮保持可点：校验不通过时把焦点带回输入框并就地说明原因，而不是让玩家面对灰按钮猜 */
  const showGuard = (): void => {
    if (disableReason === null) return
    inputRef.current?.focus()
    onToast(disableReason, true)
  }

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
    buyProgress.start()
    orderSeq.current += 1
    try {
      const order = await client.placeOrder({
        clientOrderId: `simple-buy-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'buy',
        type: 'market',
        tif: 'IOC',
        qty: Math.min(estBuyQty, tradeCapQty),
        leverage: 1,
      })
      // 成功回执才响下注音（2026-11-06 船长）：失败分支只走 toast → ui-error，绝不能叠一声动作音；
      // 放在进度满格动画之前，声音跟着回执走，不被动画挡住。
      notifyUiAction('exchange-bet')
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
    if (estShortQty <= 0) {
      onToast(T.enterAmountPrompt, true)
      return
    }
    if (inputCashNum > cash) {
      onToast(T.toastNoCash, true)
      return
    }

    setBusy(true)
    shortProgress.start()
    orderSeq.current += 1
    try {
      const order = await client.placeOrder({
        clientOrderId: `simple-short-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'sell',
        type: 'market',
        tif: 'IOC',
        qty: Math.min(estShortQty, tradeCapQty),
        // 1x 全额：投入多少占用多少，只收卖出档手续费，与看涨对称。
        leverage: 1,
        // 必须显式标记开空：服务端把「side=sell + 杠杆」默认当平多，缺这个字段会报
        // 「没有可平的杠杆多头持仓」。
        short: true,
      })
      // 与买多同口径：服务端确认才响，失败只留 ui-error。
      notifyUiAction('exchange-bet')
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
          <div className="ex-dim">{T.exchangeDailyLimit}: <span className="ex-num">{money(snap.account.dailyTradeUsed)} / {money(snap.account.dailyTradeLimit)}</span></div>

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
              <span className="ex-dim">{T.estFeeLabel} {hasFee ? `(${(feeRate * 100).toFixed(2)}%)` : `(${T.freeFee})`}</span>
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
            <span aria-hidden="true">{tab === 'buy' ? '▲' : '▼'}</span>{' '}
            {busy ? (tab === 'buy' ? T.submittingBuy : T.submittingShort) : (tab === 'buy' ? T.simpleBuyAction : T.simpleShortAction)}
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
