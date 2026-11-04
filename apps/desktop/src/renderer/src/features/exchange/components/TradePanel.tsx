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
import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Checkmark, CheckmarkFilled, Locked, Portfolio, SendAlt, WarningAlt } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot, PlaceOrderRequest, Side } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, pctAbs, price as fmtPrice } from '../format'
import { T, TF } from '../texts'

type Mode = 'spot' | 'long' | 'short'
type OrderKind = 'limit' | 'market'

const LEVERAGES = [2, 5, 10, 20, 50] as const
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
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  pickedPrice: { value: number; seq: number } | null
  onToast: ToastFn
}) {
  const quote = snap.quote
  const [mode, setMode] = useState<Mode>('spot')
  const [kind, setKind] = useState<OrderKind>('limit')
  const [priceText, setPriceText] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [leverage, setLeverage] = useState<number>(5)
  const [priceTouched, setPriceTouched] = useState(false)
  const [qtyTouched, setQtyTouched] = useState(false)
  const [protection, setProtection] = useState(false)
  const [stopText, setStopText] = useState('')
  const [takeProfitText, setTakeProfitText] = useState('')
  const [confirm, setConfirm] = useState<PlaceOrderRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const orderSeq = useRef(0)

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
  }, [code, mode])

  // 换标的必须清空价格/数量：上一只票的价格留给新票会被「偏离现价 20%」拦下，像 bug
  useEffect(() => {
    setPriceText('')
    setQtyText('')
    setPriceTouched(false)
    setQtyTouched(false)
    setStopText('')
    setTakeProfitText('')
  }, [code])

  const lev = mode === 'spot' ? 1 : leverage
  const side: Side = mode === 'short' ? 'sell' : 'buy'
  const priceNum = Number(priceText)
  const qtyNum = Math.round(Number(qtyText))
  const previewReq: PlaceOrderRequest = {
    clientOrderId: 'preview',
    code,
    side,
    type: kind,
    tif: kind === 'market' ? 'IOC' : 'GTC',
    ...(kind === 'limit' && priceText.trim() !== '' && Number.isFinite(priceNum) ? { price: priceNum } : {}),
    qty: Number.isFinite(qtyNum) ? qtyNum : 0,
    leverage: lev,
  }
  const preview = client.previewOrder(previewReq)
  const refPrice = kind === 'limit' && Number.isFinite(priceNum) && priceNum > 0 ? priceNum : quote.price

  const priceError =
    kind !== 'limit'
      ? null
      : priceText.trim() === '' || !Number.isFinite(priceNum) || priceNum <= 0
        ? T.toastInvalidPrice
        : !quote.price || quote.price <= 0 ? null : Math.abs(priceNum / quote.price - 1) > 0.2
          ? T.toastInvalidPrice
          : null
  const qtyError =
    qtyText.trim() === ''
      ? T.emptyQtyHint
      : !Number.isFinite(Number(qtyText)) || !Number.isInteger(Number(qtyText)) || qtyNum <= 0
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
    const cap = Math.max(0, Math.floor(preview.maxQty * ratio))
    setQtyText(cap > 0 ? String(cap) : '')
    setQtyTouched(true)
  }

  const submit = (req: PlaceOrderRequest): void => {
    setBusy(true)
    void (async () => {
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
        onToast(`${T.toastOrderPlaced}：${order.code} ${order.side === 'buy' ? T.buy : T.sell} ${amount(shownQty)} 股`)
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err), true)
      } finally {
        setBusy(false)
      }
    })()
  }

  const primaryAction = (): void => {
    if (busy) return
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
      clientOrderId: `ui-${code}-${Date.now()}-${orderSeq.current}`,
    }
    if (lev >= 10) {
      setConfirm(req)
      return
    }
    submit(req)
  }

  const liqDistance = preview.liquidationDistancePct
  const liqDanger = liqDistance !== null && liqDistance < DANGER_DISTANCE_PCT

  const activeFormError = (priceTouched && priceError) || (qtyTouched && qtyError) || preview.blockReason || protectionError || null
  const isReadyToSubmit = !priceError && !qtyError && !preview.blockReason && !protectionError && !busy

  return (
    <section className="ex-panel ex-trade" aria-label={T.orderTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.orderTitle}</h3>
        <span className="ex-dim">{code}</span>
      </header>
      <div className="ex-trade-body">
        {/* 交易模式三段切换 */}
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
                onClick={() => setMode(m)}
              >
                <span className="ex-trade-mode-btn-content">
                  <Icon size={13} />
                  <span>{modeLabel(m)}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className={`ex-mode-hint is-${mode}`}>{modeHint(mode)}</p>

        {/* 订单类型切换 */}
        <div className="ex-seg ex-seg-wide ex-trade-kind-seg" role="tablist" aria-label={T.orderTypeLimit}>
          {(['limit', 'market'] as const).map((k) => (
            <button
              type="button"
              key={k}
              role="tab"
              aria-selected={kind === k}
              className={`ex-seg-btn${kind === k ? ' is-on' : ''}`}
              onClick={() => setKind(k)}
            >
              {k === 'limit' ? T.orderTypeLimit : T.orderTypeMarket}
            </button>
          ))}
        </div>

        {/* 单列垂直：价格 */}
        <div className={`ex-field${priceError && priceTouched ? ' is-bad' : ''}`}>
          <div className="ex-field-header">
            <label className="ex-label" htmlFor="ex-price-input">
              {T.fieldPrice}
            </label>
            {kind === 'market' ? (
              <span className="ex-field-tag is-market">
                <Locked size={11} /> {T.marketPriceLocked}
              </span>
            ) : null}
          </div>
          <div className="ex-input-row">
            <input
              id="ex-price-input"
              className={`ex-input ex-num${kind === 'market' ? ' is-market-locked' : ''}`}
              inputMode="decimal"
              value={kind === 'market' ? '' : priceText}
              placeholder={kind === 'market' ? T.marketPriceNote : fmtPrice(quote.price)}
              disabled={kind === 'market'}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={() => setPriceTouched(true)}
            />
            {kind === 'market' ? (
              <button
                type="button"
                className="ex-mini-btn is-market-switch"
                title={T.useBookPrice}
                onClick={() => {
                  setPriceText(quote.price.toFixed(2))
                  setKind('limit')
                  setPriceTouched(false)
                }}
              >
                {T.useBookPrice}
              </button>
            ) : (
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

        {/* 数量与快捷比例选择（25%、50%、75%、MAX） */}
        <div className={`ex-field${qtyError && qtyTouched ? ' is-bad' : ''}`}>
          <div className="ex-field-header">
            <label className="ex-label" htmlFor="ex-qty-input">
              {T.fieldQty}
            </label>
            <span className="ex-max-hint">{TF.maxQty(amount(preview.maxQty))}</span>
          </div>
          <div className="ex-input-row">
            <input
              id="ex-qty-input"
              className="ex-input ex-num"
              inputMode="numeric"
              value={qtyText}
              placeholder="0"
              onChange={(e) => setQtyText(e.target.value)}
              onBlur={() => setQtyTouched(true)}
            />
          </div>
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
          {qtyError && qtyTouched ? <div className="ex-field-error">{qtyError}</div> : null}
        </div>

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
            <div className="ex-lev-capsules" role="group" aria-labelledby="ex-lev-label">
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
                    title={allowed ? TF.leverageLabel(String(l)) : `${T.leverageUnavailable}（最高 ${quote.maxLeverage}x）`}
                    onClick={() => {
                      if (!allowed) {
                        onToast(`${T.leverageUnavailable}：${code} 最高 ${quote.maxLeverage}x`, true)
                        return
                      }
                      setLeverage(l)
                    }}
                  >
                    <span className="ex-lev-pill-val">{l}x</span>
                    {l >= 10 ? <span className="ex-lev-pill-dot" title="高杠杆二次确认" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

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
          <div className="ex-preview-row">
            <span>{T.previewSlippage}</span>
            <span className="ex-num">{kind === 'limit' ? T.slippageLimitZero : `~0.05% (${money(preview.notional * 0.0005)})`}</span>
          </div>
          <div className="ex-preview-row">
            <span>{T.previewDailyCost}</span>
            <span className="ex-num">{mode === 'spot' ? T.dailyCostFree : `${money(preview.notional * 0.0003)} / 日`}</span>
          </div>
          {mode !== 'spot' && preview.liquidationPrice !== null && liqDistance !== null ? (
            <div className={`ex-liq-block${liqDanger ? ' is-danger' : ''}`}>
              <div className="ex-preview-row">
                <span className="ex-liq-label">
                  {liqDanger ? <WarningAlt size={12} className="ex-liq-warn-icon" /> : null}
                  {T.previewLiqPrice}
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
          <div className="ex-preview-row ex-preview-dim">
            <span>{side === 'sell' ? T.previewProceeds : T.previewCost}</span>
            <b className="ex-num">{money(Math.abs(preview.settleAmount))}</b>
          </div>
        </div>

        {/* 保护单（仅杠杆）：成交后在同一链路挂条件单 */}
        {mode !== 'spot' ? (
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

        {/* 确认下单大按钮 */}
        <button
          type="button"
          className={`ex-primary is-${mode}${!isReadyToSubmit ? ' is-blocked' : ''}`}
          aria-disabled={!isReadyToSubmit}
          title={activeFormError || undefined}
          onClick={primaryAction}
        >
          <SendAlt size={16} /> {busy ? T.submitting : `${T.submit} · ${modeLabel(mode)}`}
        </button>
      </div>

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
              <b className="ex-num">{money(preview.margin)}</b>
              <span>{T.previewLiqPrice}</span>
              <b className="ex-num is-danger">
                {preview.liquidationPrice !== null ? fmtPrice(preview.liquidationPrice) : '—'}
              </b>
              <span>{T.previewLiqDistance}</span>
              <b className="ex-num">
                {preview.liquidationDistancePct !== null ? pctAbs(preview.liquidationDistancePct) : '—'}
              </b>
              <span>{T.previewMaxLoss}</span>
              <b className="ex-num is-danger">{money(preview.margin)}</b>
            </div>
            <div className="ex-modal-actions">
              <button type="button" className="ex-mini-btn" onClick={() => setConfirm(null)}>
                {T.confirmCancel}
              </button>
              <button
                type="button"
                className="ex-primary ex-primary-small"
                onClick={() => {
                  const req = confirm
                  setConfirm(null)
                  submit(req)
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
