import { isEn, tr } from '../../../i18n/locale'
/**
 * 统一下单面板（现货 / 杠杆多 / 杠杆空 共用一套控件）。
 *
 * 逐条对齐 `docs/design/stock-exchange-server-20261103.md` 6.2「下单表单防错规格」：
 * - **单列垂直**，标签在控件上方（不用占位符冒充标签）；
 * - 保证金 / 名义 / 手续费 / 强平价 / 距强平**随输入实时重算**（走 `client.previewOrder`，不自己抄公式）；
 * - **失焦即校验**，错误写在字段下方；主按钮**永不置灰**，点击后显式说明不可下单原因；
 * - 强平价旁写人话「跌到 X 会强平，距现价 Y%」；
 * - ≥10x 二次确认，确认框里再显示一次强平价与最大亏损。
 */
import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownRight, ArrowUpRight, Checkmark, CheckmarkFilled, Portfolio, SendAlt, WarningAlt } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot, PlaceOrderRequest, Side, OrderPreview } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, pctAbs, price as fmtPrice } from '../format'
import { T, TF } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'
import { OrderCtaSlotContext } from '../orderCta'

type Mode = 'spot' | 'long' | 'short'
type OrderKind = 'limit' | 'market'

// 1x 即原「现货」：全额保证金、不放大（2026-11-06 船长令：现货并入杠杆，省一段高度）
const LEVERAGES = [1, 2, 5, 10, 20, 50, 90] as const
/** 距强平低于这个百分比就转警示色（设计稿 6.1） */
const DANGER_DISTANCE_PCT = 15

function modeLabel(mode: Mode): string {
  return mode === 'spot' ? T.modeSpot : mode === 'long' ? T.modeLong : T.modeShort
}

function modeHint(mode: Mode): string {
  return mode === 'spot' ? T.orderModeHintSpot : mode === 'long' ? T.orderModeHintLong : T.orderModeHintShort
}

export function TradePanel({
  client,
  snap,
  code,
  pickedPrice,
  onToast,
  fixedMode,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  pickedPrice: { value: number; seq: number } | null
  onToast: ToastFn
  /** 由外层 Tab 固定方向时，不再渲染方向切换段（2026-11-06 船长令） */
  fixedMode?: 'long' | 'short'
}) {
  const quote = snap.quote
  const [innerMode, setInnerMode] = useState<Mode>('spot')
  const mode: Mode = fixedMode ?? innerMode
  const [kind, setKind] = useState<OrderKind>('market')
  const [priceText, setPriceText] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [investmentText, setInvestmentText] = useState('')
  const [serverPreview, setServerPreview] = useState<{ key: string; value: OrderPreview } | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [leverage, setLeverage] = useState<number>(5)
  const [priceTouched, setPriceTouched] = useState(false)
  const [qtyTouched, setQtyTouched] = useState(false)
  const [protection, setProtection] = useState(false)
  const [stopText, setStopText] = useState('')
  const [takeProfitText, setTakeProfitText] = useState('')
  const [confirm, setConfirm] = useState<PlaceOrderRequest | null>(null)
  const [confirmPreview, setConfirmPreview] = useState<OrderPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const orderSeq = useRef(0)
  const submitProgress = useActionProgress(client)

  // 点盘口档位 → 填入价格（seq 保证连点同一档也能再次生效）
  useEffect(() => {
    if (!pickedPrice) return
    setPriceText(pickedPrice.value.toFixed(2))
    setKind('limit')
    setPriceTouched(false)
  }, [pickedPrice])

  // 切换标的/模式时清掉上一次的二次确认，避免"确认框还停在上一只票"
  useEffect(() => {
    setConfirm(null)
  }, [code, mode, leverage, kind, qtyText, investmentText, priceText])

  // 换标的必须清空价格/数量：上一只票的价格留给新票会被「偏离现价 20%」拦下，像 bug
  useEffect(() => {
    setPriceText('')
    setQtyText('')
    setInvestmentText('')
    setPriceTouched(false)
    setQtyTouched(false)
    setStopText('')
    setTakeProfitText('')
  }, [code])

  const lev = mode === 'spot' ? 1 : leverage
  const side: Side = mode === 'short' ? 'sell' : 'buy'
  // 市价单按对手盘成交：买吃卖一、卖砸买一，没有档位时退回现价
  const bookPrice =
    side === 'buy' ? (snap.book.asks[0]?.price ?? quote.price) : (snap.book.bids[0]?.price ?? quote.price)
  const priceNum = Number(priceText)
  const refPrice = kind === 'limit' && Number.isFinite(priceNum) && priceNum > 0 ? priceNum : quote.price
  const investment = Number(investmentText)
  const feeRate = lev > 1 ? (lev <= 20 ? (mode === 'short' ? 0.001 : 0.0005) : lev <= 50 ? (mode === 'short' ? 0.0006 : 0.0003) : (mode === 'short' ? 0.0004 : 0.0002)) : (snap.feeRate ?? 0)
  const qtyNum = mode === 'spot' ? Number(qtyText) : (refPrice > 0 ? Math.floor(investment / (refPrice / lev + refPrice * feeRate)) : 0)
  const previewReq: PlaceOrderRequest = {
    clientOrderId: 'preview',
    code,
    side,
    type: kind,
    tif: kind === 'market' ? 'IOC' : 'GTC',
    ...(kind === 'limit' && priceText.trim() !== '' && Number.isFinite(priceNum) ? { price: priceNum } : {}),
    qty: Number.isFinite(qtyNum) ? Math.min(1_000_000, Math.max(0, qtyNum)) : 0,
    leverage: lev,
    // 做空模式必须显式带 short：服务端把「side=sell + 杠杆」默认当平多。
    ...(mode === 'short' ? { short: true } : {}),
  }
  const previewQuery = { ...previewReq, ...(mode !== 'spot' ? { investment: Number.isInteger(investment) && investment > 0 ? investment : 1 } : {}) }
  const previewKey = JSON.stringify(previewQuery)
  const preview = serverPreview?.key === previewKey ? serverPreview.value : client.previewOrder(previewReq)
  const effectiveQty = mode === 'spot' ? qtyNum : (preview.qty ?? qtyNum)
  const previewPending = Boolean(client.fetchOrderPreview && serverPreview?.key !== previewKey)
  useEffect(() => {
    if (!client.fetchOrderPreview) return
    let alive = true
    setPreviewFailed(false)
    const timer = window.setTimeout(() => {
      void client.fetchOrderPreview!(previewQuery).then((value) => { if (alive) setServerPreview({ key: previewKey, value }) }).catch(() => { if (alive) setPreviewFailed(true) })
    }, 200)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [client, previewKey, snap.tick])

  const priceError =
    kind !== 'limit'
      ? null
      : priceText.trim() === '' || !Number.isFinite(priceNum) || priceNum <= 0
        ? T.toastInvalidPrice
        : !quote.price || quote.price <= 0 ? null : Math.abs(priceNum / quote.price - 1) > 0.2
          ? T.toastInvalidPrice
          : null
  const qtyError =
    (mode === 'spot' ? qtyText : investmentText).trim() === ''
      ? T.emptyQtyHint
      : !Number.isFinite(qtyNum) || effectiveQty <= 0 || (mode === 'spot' && !Number.isInteger(qtyNum)) || (mode !== 'spot' && (!Number.isInteger(investment) || investment <= 0 || investment > snap.account.cash))
        ? T.toastInvalidQty
        : null

  const protectionError = ((): string | null => {
    if (!protection || mode === 'spot') return null
    const stop = Number(stopText)
    const tp = Number(takeProfitText)
    const stopGiven = stopText.trim() !== ''
    const tpGiven = takeProfitText.trim() !== ''
    if (!stopGiven && !tpGiven) return null
    if (stopGiven && (!Number.isFinite(stop) || stop <= 0)) return T.toastProtectionInvalid
    if (tpGiven && (!Number.isFinite(tp) || tp <= 0)) return T.toastProtectionInvalid
    if (mode === 'long') {
      if (stopGiven && stop >= quote.price) return T.toastProtectionInvalid
      if (tpGiven && tp <= quote.price) return T.toastProtectionInvalid
    } else {
      if (stopGiven && stop <= quote.price) return T.toastProtectionInvalid
      if (tpGiven && tp >= quote.price) return T.toastProtectionInvalid
    }
    return null
  })()

  const setQtyByRatio = (ratio: number): void => {
    if (mode !== 'spot') { setInvestmentText(String(Math.floor(snap.account.cash * ratio))); setQtyTouched(true); return }
    const cap = Math.max(0, Math.floor(preview.maxQty * ratio))
    setQtyText(cap > 0 ? String(cap) : '')
    setQtyTouched(true)
  }

  const submit = async (req: PlaceOrderRequest): Promise<void> => {
    setBusy(true)
    submitProgress.start()
    try {
        const order = await client.placeOrder(req)
        const filled = order.filledQty ?? 0
        // 回合制下开仓单提交时 status=queued、filledQty=0，回合末集合竞价才成交。
        // 保护单不能依赖「本次响应已有成交」，否则会静默不挂；未成交时必须明确提示玩家。
        const pendingFill = filled <= 0 || order.status === 'queued'
        if (protection && mode !== 'spot') {
          if (pendingFill) {
            onToast(T.protectionRoundPending, true)
          } else {
            const protSide: Side = mode === 'long' ? 'sell' : 'buy'
            const stop = Number(stopText)
            const tp = Number(takeProfitText)
            try {
              if (stopText.trim() !== '' && stop > 0) {
                await client.placeOrder({
                  clientOrderId: `${req.clientOrderId}-sl`,
                  code,
                  side: protSide,
                  type: 'stop',
                  tif: 'GTC',
                  qty: filled,
                  leverage: lev,
                  reduceOnly: true,
                  triggerPrice: stop,
                })
              }
              if (takeProfitText.trim() !== '' && tp > 0) {
                await client.placeOrder({
                  clientOrderId: `${req.clientOrderId}-tp`,
                  code,
                  side: protSide,
                  type: 'take_profit',
                  tif: 'GTC',
                  qty: filled,
                  leverage: lev,
                  reduceOnly: true,
                  triggerPrice: tp,
                })
              }
            } catch (err) {
              onToast(err instanceof Error ? err.message : String(err), true)
            }
          }
        }
        // 回合制委托提交后尚未成交：展示委托数量，避免「已提交 0 股」的误导。
        const shownQty = filled > 0 ? filled : order.qty
        await submitProgress.finish()
        onToast(`${T.toastOrderPlaced}: ${order.code} ${order.side === 'buy' ? T.buy : T.sell} ${amount(shownQty)} ${T.sharesSuffix}`)
      } catch (err) {
        await submitProgress.finish(false)
        onToast(err instanceof Error ? err.message : String(err), true)
      } finally {
        setBusy(false)
      }
  }

  const primaryAction = (): void => {
    if (busy) return
    if (previewPending || previewFailed) { onToast(tr(previewFailed ? 'ui.exchange.026' : 'ui.exchange.024'), true); return }
    setPriceTouched(true)
    setQtyTouched(true)
    if (priceError) {
      onToast(priceError, true)
      return
    }
    if (qtyError) {
      onToast(qtyError, true)
      return
    }
    if (preview.blockReason) {
      // 主按钮不置灰：把「为什么下不了」说清楚，避免灰按钮死胡同
      onToast(`${TF.unavailable(preview.blockReason)}`, true)
      return
    }
    if (protectionError) {
      onToast(protectionError, true)
      return
    }
    orderSeq.current += 1
    const req: PlaceOrderRequest = {
      ...previewReq,
      qty: effectiveQty,
      clientOrderId: `ui-${code}-${Date.now()}-${orderSeq.current}`,
    }
    if (lev >= 10) {
      setConfirm(req)
      setConfirmPreview(preview)
      return
    }
    void submit(req)
  }

  const confirmationPreview = confirmPreview ?? preview
  const liqDistance = preview.liquidationDistancePct
  const liqDanger = liqDistance !== null && liqDistance < DANGER_DISTANCE_PCT

  const activeFormError = (priceTouched && priceError) || (qtyTouched && qtyError) || (previewFailed ? tr('ui.exchange.024') : null) || preview.blockReason || protectionError || null
  const isReadyToSubmit = !priceError && !qtyError && !preview.blockReason && !protectionError && !busy && !previewPending && !previewFailed

  const ctaTarget = useContext(OrderCtaSlotContext)

  const submitButton = (
    <button
      type="button"
      className={`ex-primary ex-trade-submit is-${mode}${!isReadyToSubmit ? ' is-blocked' : ''} ex-btn-progress`}
      data-sfx={side === 'sell' ? 'exchange-sell' : 'exchange-buy'}
      aria-disabled={!isReadyToSubmit}
      disabled={busy}
      title={activeFormError || undefined}
      style={progressStyle(submitProgress)}
      onClick={primaryAction}
    >
      <SendAlt size={16} /> {busy ? T.submitting : `${T.submit} · ${modeLabel(mode)}`}
      {submitProgress.active ? ` ${submitProgress.pct}%` : ''}
    </button>
  )

  return (
    <section className="ex-panel ex-trade" aria-label={T.orderTitle}>
      {fixedMode === undefined ? (
        <header className="ex-panel-head">
          <h3 className="ex-panel-title">{T.orderTitle}</h3>
          <span className="ex-dim">{code}</span>
        </header>
      ) : null}
      <div className="ex-trade-body">
        {/* 交易模式三段切换（外层固定方向时不渲染） */}
        {fixedMode === undefined ? (
        <div className="ex-seg ex-seg-wide ex-trade-mode-seg" role="tablist" aria-label={T.orderTitle}>
          {(['spot', 'long', 'short'] as const).map((m) => {
            const Icon = m === 'spot' ? Portfolio : m === 'long' ? ArrowUpRight : ArrowDownRight
            return (
              <button
                type="button"
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={`ex-seg-btn is-${m}${mode === m ? ' is-on' : ''}`}
                onClick={() => setInnerMode(m)}
              >
                <span className="ex-trade-mode-btn-content">
                  <Icon size={13} />
                  <span>{modeLabel(m)}</span>
                </span>
              </button>
            )
          })}
        </div>
        ) : null}
        {fixedMode === undefined ? (
          <p className={`ex-mode-hint is-${mode}`}>{modeHint(mode)}</p>
        ) : null}

        {/* 杠杆倍数选择器（数值胶囊） */}
        {mode !== 'spot' ? (
          <div className="ex-field ex-field-leverage">
            <div className="ex-field-header">
              <span className="ex-label" id="ex-lev-label">
                {T.fieldLeverage}
              </span>
              <span className="ex-lev-cur-badge">
                {leverage}x{leverage >= 10 ? ' · ' + TF.leverageRequireConfirm(`${leverage}x`) : ''}
              </span>
            </div>
            <div className="ex-lev-capsules" role="group" aria-label={T.fieldLeverage}>
              {LEVERAGES.map((l) => {
                const allowed = l <= quote.maxLeverage
                const isSelected = leverage === l
                return (
                  <button
                    type="button"
                    key={l}
                    aria-pressed={isSelected}
                    aria-disabled={!allowed}
                    className={`ex-lev-pill is-${mode}${isSelected ? ' is-on' : ''}${allowed ? '' : ' is-off'}`}
                    title={allowed ? TF.leverageLabel(String(l)) : (isEn() ? `${T.leverageUnavailable} (Max ${quote.maxLeverage}x)` : `${T.leverageUnavailable}（最高 ${quote.maxLeverage}x）`)}
                    onClick={() => {
                      if (!allowed) {
                        onToast(isEn() ? `${T.leverageUnavailable}: ${code} Max ${quote.maxLeverage}x` : `${T.leverageUnavailable}：${code} 最高 ${quote.maxLeverage}x`, true)
                        return
                      }
                      setLeverage(l)
                    }}
                  >
                    <span className="ex-lev-pill-val">{l}x</span>
                    {l >= 10 ? <span className="ex-lev-pill-dot" title={T.confirmTitle} /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 数量与快捷比例选择（25%、50%、75%、MAX） */}
        <div className={`ex-field ex-field-qty${qtyError && qtyTouched ? ' is-bad' : ''}`}>
          <div className="ex-field-header">
            <label className="ex-label" htmlFor="ex-qty-input">
              {mode === 'spot' ? T.fieldQty : tr('ui.exchange.022')}
            </label>
            <span className="ex-max-hint">
              {TF.maxQty(amount(preview.maxQty))}
              {mode !== 'spot'
                ? ` · ${tr('ui.exchange.023')} ${amount(Number.isFinite(effectiveQty) ? effectiveQty : 0)} ${T.sharesSuffix}`
                : ''}
            </span>
          </div>
          <div className="ex-input-row">
            <input
              id="ex-qty-input"
              className="ex-input ex-num"
              inputMode="numeric"
              value={mode === 'spot' ? qtyText : investmentText}
              placeholder="0"
              onChange={(e) => mode === 'spot' ? setQtyText(e.target.value) : setInvestmentText(e.target.value)}
              onBlur={() => setQtyTouched(true)}
            />
            <div className="ex-quick-row">
            {([0.25, 0.5, 0.75, 1] as const).map((ratio) => {
              const cap = Math.max(0, Math.floor(preview.maxQty * ratio))
              const isSelected = qtyNum > 0 && qtyNum === cap
              const label =
                ratio === 0.25
                  ? T.quickQty25
                  : ratio === 0.5
                    ? T.quickQty50
                    : ratio === 0.75
                      ? T.quickQty75
                      : T.quickQtyMax
              return (
                <button
                  type="button"
                  key={ratio}
                  className={`ex-mini-btn ex-quick-btn${ratio === 1 ? ' is-accent' : ''}${isSelected ? ' is-active' : ''}`}
                  onClick={() => setQtyByRatio(ratio)}
                  title={TF.maxQty(amount(preview.maxQty))}
                >
                  {label}
                </button>
              )
            })}
            </div>
          </div>
          {qtyError && qtyTouched ? <div className="ex-field-error">{qtyError}</div> : null}
        </div>

        {/* 单列垂直：价格 */}
        <div className={`ex-field ex-field-price${priceError && priceTouched ? ' is-bad' : ''}`}>
          <div className="ex-field-header">
            <label className="ex-label" htmlFor="ex-price-input">
              {T.fieldPrice}
            </label>
            <div className="ex-kind-seg" role="tablist" aria-label={T.orderTypeLimit}>
              {(['limit', 'market'] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  role="tab"
                  aria-selected={kind === k}
                  className={`ex-kind-btn${kind === k ? ' is-on' : ''}`}
                  onClick={() => setKind(k)}
                >
                  {k === 'limit' ? T.orderTypeLimit : T.orderTypeMarket}
                </button>
              ))}
            </div>
          </div>
          <div className="ex-input-row">
            <input
              id="ex-price-input"
              className={`ex-input ex-num${kind === 'market' ? ' is-market-locked' : ''}`}
              inputMode="decimal"
              value={kind === 'market' ? fmtPrice(bookPrice) : priceText}
              placeholder={fmtPrice(bookPrice)}
              readOnly={kind === 'market'}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={() => setPriceTouched(true)}
            />
            {kind === 'market' ? null : (
              <button
                type="button"
                className="ex-mini-btn is-accent"
                title={T.useBookPrice}
                aria-label={T.useBookPrice}
                onClick={() => {
                  setPriceText(quote.price.toFixed(2))
                  setKind('limit')
                  setPriceTouched(false)
                }}
              >
                {T.useBookPrice}
              </button>
            )}
          </div>
          {priceError && priceTouched ? <div className="ex-field-error">{priceError}</div> : null}
        </div>

        {/* 前馈读数：财务与风险预估明细 */}
        <div className="ex-preview" aria-live="polite">
          <div className="ex-preview-row">
            <span>{mode === 'spot' ? T.previewAmount : T.previewMargin}</span>
            <b className="ex-num">{money(mode === 'spot' ? preview.notional : preview.margin)}</b>
          </div>
          {mode !== 'spot' ? (
            <div className="ex-preview-row">
              <span>{T.previewNotional}</span>
              <b className="ex-num">{money(preview.notional)}</b>
            </div>
          ) : null}
          <div className="ex-preview-row">
            <span>{T.previewFee}</span>
            <b className="ex-num">{money(preview.fee)}</b>
          </div>
          <div className="ex-preview-row ex-preview-dim">
            <span>{side === 'sell' && mode === 'spot' ? T.previewProceeds : T.previewCost}</span>
            <b className="ex-num">{money(Math.abs(preview.settleAmount))}</b>
          </div>
          {mode !== 'spot' && preview.liquidationPrice !== null && liqDistance !== null ? (
            <div className={`ex-liq-block${liqDanger ? ' is-danger' : ''}`}>
              <div className="ex-preview-row">
                <span className="ex-liq-label">
                  {liqDanger ? <WarningAlt size={12} className="ex-liq-warn-icon" /> : null}
                  {tr('ui.exchange.027')}
                </span>
                <b className="ex-num">{fmtPrice(preview.liquidationPrice)}</b>
              </div>
              <div className="ex-preview-row">
                <span>{T.previewLiqDistance}</span>
                <b className="ex-num">{pctAbs(liqDistance)}</b>
              </div>
              <p className={`ex-liq-sentence${liqDanger ? ' is-danger' : ''}`}>
                {mode === 'long'
                  ? TF.liqLong(fmtPrice(preview.liquidationPrice), pctAbs(liqDistance))
                  : TF.liqShort(fmtPrice(preview.liquidationPrice), pctAbs(liqDistance))}
              </p>
            </div>
          ) : null}
        </div>

        {/* 保护单（仅杠杆）：成交后在同一链路挂条件单 */}
        {mode !== 'spot' && !client.fetchOrderPreview ? (
          <div className="ex-protect">
            <label className="ex-check">
              <input type="checkbox" checked={protection} onChange={(e) => setProtection(e.target.checked)} />
              <span>{T.protectionEnable}</span>
            </label>
            {protection ? (
              <>
                <div className="ex-field">
                  <label className="ex-label" htmlFor="ex-stop-input">
                    {T.protectionStop}
                  </label>
                  <input
                    id="ex-stop-input"
                    className="ex-input ex-num"
                    inputMode="decimal"
                    value={stopText}
                    onChange={(e) => setStopText(e.target.value)}
                    placeholder={fmtPrice(mode === 'long' ? quote.price * 0.97 : quote.price * 1.03)}
                  />
                </div>
                <div className="ex-field">
                  <label className="ex-label" htmlFor="ex-tp-input">
                    {T.protectionTakeProfit}
                  </label>
                  <input
                    id="ex-tp-input"
                    className="ex-input ex-num"
                    inputMode="decimal"
                    value={takeProfitText}
                    onChange={(e) => setTakeProfitText(e.target.value)}
                    placeholder={fmtPrice(mode === 'long' ? quote.price * 1.05 : quote.price * 0.95)}
                  />
                </div>
                {protectionError ? <div className="ex-field-error">{protectionError}</div> : null}
              </>
            ) : (
              <span className="ex-dim">{T.protectionSpotNote}</span>
            )}
          </div>
        ) : null}

        {/* 防呆校验状态栏 */}
        <div className={`ex-submit-guard-bar${isReadyToSubmit ? ' is-ready' : activeFormError ? ' is-blocked' : ''}`}>
          {isReadyToSubmit ? (
            <span className="ex-guard-text">
              <CheckmarkFilled size={12} /> {T.orderValidationPassed}
            </span>
          ) : activeFormError ? (
            <span className="ex-guard-text">
              <WarningAlt size={12} /> {activeFormError}
            </span>
          ) : (
            <span className="ex-guard-text ex-dim">{TF.maxQty(amount(preview.maxQty))}</span>
          )}
        </div>

      </div>

      {/* 确认下单大按钮：有插槽时挂到右栏面板右下角（2026-11-06 船长令），否则留在原位 */}
      {ctaTarget
        ? createPortal(submitButton, ctaTarget)
        : <div className="ex-trade-footer">{submitButton}</div>}

      {confirm !== null ? (
        <div className="ex-modal-mask" role="dialog" aria-modal="true" aria-label={T.confirmTitle}>
          <div className="ex-modal">
            <h4 className="ex-modal-title">{T.confirmTitle}</h4>
            <p className="ex-modal-text">{T.confirmText}</p>
            <div className="ex-modal-grid">
              <span>{T.fieldPrice}</span>
              <b className="ex-num">{confirm.type === 'market' ? T.orderTypeMarket : fmtPrice(confirm.price ?? 0)}</b>
              <span>{T.fieldQty}</span>
              <b className="ex-num">{amount(confirm.qty)}</b>
              <span>{T.fieldLeverage}</span>
              <b className="ex-num">{confirm.leverage ?? 1}x</b>
              <span>{T.previewMargin}</span>
              <b className="ex-num">{money(confirmationPreview.margin)}</b>
              <span>{T.previewLiqPrice}</span>
              <b className="ex-num is-danger">
                {confirmationPreview.liquidationPrice !== null ? fmtPrice(confirmationPreview.liquidationPrice) : '—'}
              </b>
              <span>{T.previewLiqDistance}</span>
              <b className="ex-num">
                {confirmationPreview.liquidationDistancePct !== null ? pctAbs(confirmationPreview.liquidationDistancePct) : '—'}
              </b>
              <span>{T.previewMaxLoss}</span>
              <b className="ex-num is-danger">{money(confirmationPreview.margin)}</b>
            </div>
            <div className="ex-modal-actions">
              <button type="button" className="ex-mini-btn" onClick={() => setConfirm(null)}>
                {T.confirmCancel}
              </button>
              <button
                type="button"
                className="ex-primary ex-primary-small ex-btn-progress"
                data-sfx={confirm.side === 'sell' ? 'exchange-sell' : 'exchange-buy'}
                style={progressStyle(submitProgress)}
                onClick={() => {
                  if (previewPending || previewFailed || preview.blockReason || confirm.qty !== effectiveQty) { setConfirm(null); onToast(tr('ui.exchange.024'), true); return }
                  const req = confirm
                  setConfirm(null)
                  void submit(req)
                }}
              >
                <Checkmark size={14} /> {T.confirmOk}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* 供屏幕阅读器：当前参考价（隐藏，避免重复读数） */}
      <span className="ex-sr-only">{fmtPrice(refPrice)}</span>
    </section>
  )
}
