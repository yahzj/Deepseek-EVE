/**
 * 保底基金（放置型）：本金锁定，按 UTC 自然日收益档计提，随时可赎回。
 *
 * 规则（船长 2026-11-04 定案：「起码 3 倍收益，但是有概率亏，随时可赎」）：
 * - 每日结算档：70% 概率 +0.03%、30% 概率 −0.05%；
 * - 亏损真实发生，不保本；赎回额 = 本金 + 累计收益（可为负）；
 * - 每日结果由服务端决定，前端只负责展示与触发，不参与计算。
 */
import { useEffect, useState } from 'react'
import { isEn } from '../../../i18n/locale'
import type { ExchangeClient, ExchangeSnapshot, FundPosition } from '../client'
import type { ToastFn } from '../../../pages/common'
import { money } from '../format'
import { T, TF } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'

/** 持仓刷新间隔：服务端惰性按分钟结算，跟行情一起 10 秒拉一次（船长 2026-11-04 定）。 */
const POSITION_REFRESH_MS = 10_000

export function FundCard({
  client,
  snap,
  onToast,
  onRefresh,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  onToast: ToastFn
  onRefresh: () => void
}) {
  const [position, setPosition] = useState<FundPosition | null>(null)
  const [amountText, setAmountText] = useState('100000')
  const [busy, setBusy] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const openProgress = useActionProgress(client)
  const redeemProgress = useActionProgress(client)

  const availableCash = snap.account.cash
  const principal = position?.principal ?? 0
  const hasPosition = principal > 0
  const accrued = position?.accrued ?? 0

  // 首屏拉一次持仓，之后每 10 秒刷新（与行情轮询同节奏，收益才会随分钟跳动）。
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      void client
        .getFundPosition()
        .then((next) => {
          if (alive) setPosition(next)
        })
        .catch(() => undefined)
    }
    pull()
    const timer = setInterval(pull, POSITION_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [client])

  const numericAmount = Math.floor(Number(amountText.replace(/,/g, '')))
  const isInvalid = !Number.isFinite(numericAmount) || numericAmount <= 0
  const isOverCash = !isInvalid && numericAmount > availableCash
  const canSubmit = !busy && !isInvalid && !isOverCash && availableCash > 0
  const tip = (
    <div className="ex-savings-tip">
      <div className="ex-savings-tip-row">
        <span className="ex-savings-tip-label">{T.savingsHighLabel}</span>
        <b className="ex-savings-tip-value">{T.fundTipHighValue}</b>
      </div>
      <div className="ex-savings-tip-row">
        <span className="ex-savings-tip-label">{T.savingsLowLabel}</span>
        <b className="ex-savings-tip-value">{T.fundTipLowValue}</b>
      </div>
      <div className="ex-savings-tip-row">
        <span className="ex-savings-tip-label">{T.savingsCapLabel}</span>
        <b className="ex-savings-tip-cap">{T.fundTipCapValue}</b>
      </div>
    </div>
  )

  const setRatio = (ratio: number): void => {
    if (availableCash <= 0 || busy) return
    const target = Math.floor(availableCash * ratio)
    setAmountText(String(Math.max(1, target)))
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      onToast(isOverCash ? T.fundNoCash : T.cashierInvalidAmount, true)
      return
    }
    setBusy(true)
    openProgress.start()
    const amount = numericAmount
    try {
      const next = await client.openFund(amount, crypto.randomUUID())
      await openProgress.finish()
      setPosition(next)
      setAmountText('')
      onToast(TF.fundOpened(money(amount)), false)
      onRefresh()
    } catch (err) {
      await openProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  const redeem = async (): Promise<void> => {
    if (busy || !hasPosition) return
    const payout = Math.max(0, principal + accrued)
    const lost = accrued < 0
    setBusy(true)
    redeemProgress.start()
    try {
      const next = await client.redeemFund(crypto.randomUUID())
      await redeemProgress.finish()
      setPosition(next)
      onToast(TF.fundRedeemed(money(payout)), lost)
      onRefresh()
    } catch (err) {
      await redeemProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ex-panel ex-bond ex-fund" aria-label={T.fundTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.fundTitle}</h3>
      </header>
      <div className="ex-bond-body">
        <div
          className="ex-bond-name"
          onMouseEnter={() => setTipOpen(true)}
          onMouseLeave={() => setTipOpen(false)}
        >
          <b className="ex-savings-anchor">
            {T.fundName}
            <span className="ex-help-mark">?</span>
          </b>
          {tipOpen ? (
            <div className="ex-savings-pop" role="tooltip">
              <span className="ex-savings-pop-line" />
              <div className="ex-savings-pop-body">{tip}</div>
            </div>
          ) : null}
        </div>

        {/* 账户可用资金：等宽排版 */}
        <div className="ex-preview-row is-avail-row">
          <span>{T.strategyAvailCash}</span>
          <b className="ex-num">
            {money(availableCash)} <span className="ex-unit">{T.creditUnit}</span>
          </b>
        </div>

        {/* 持仓区：本金 → 累计收益（2026-11-06 船长令：与债券同一排序，去掉无意义读数） */}
        <div className="ex-preview-row">
          <span>{T.fundPrincipal}</span>
          <b className="ex-num">
            {money(principal)} <span className="ex-unit">{T.creditUnit}</span>
          </b>
        </div>
        <div className={`ex-preview-row ${accrued > 0 ? 'is-bond-highlight' : ''}`}>
          <span>{T.fundAccrued}</span>
          <b
            className={`ex-num ${
              accrued > 0 ? 'is-up ex-fund-result-win' : accrued < 0 ? 'is-down ex-fund-result-lose' : ''
            }`}
          >
            {accrued > 0 ? '+' : accrued < 0 ? '−' : ''}
            {money(Math.abs(accrued))} <span className="ex-unit">{T.creditUnit}</span>
          </b>
        </div>

        {/* 申购 / 追加金额 */}
        <div className="ex-bond-field">
          <div className="ex-bond-field-head">
            <label className="ex-label" htmlFor="ex-fund-input">
              {T.fundAmount}
            </label>
            <div
              className="ex-bond-quick-ratios"
              role="group"
              aria-label={isEn() ? 'Quick invest ratios' : '快捷投入比例'}
            >
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title={isEn() ? 'Quick invest 25% cash' : '快捷投入 25% 可用资金'}
                aria-label={isEn() ? 'Quick invest 25% cash' : '快捷投入 25% 可用资金'}
                disabled={busy || availableCash <= 0}
                onClick={() => setRatio(0.25)}
              >
                {T.bondPct25}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title={isEn() ? 'Quick invest 50% cash' : '快捷投入 50% 可用资金'}
                aria-label={isEn() ? 'Quick invest 50% cash' : '快捷投入 50% 可用资金'}
                disabled={busy || availableCash <= 0}
                onClick={() => setRatio(0.5)}
              >
                {T.bondPct50}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title={isEn() ? 'Quick invest max cash' : '快捷投入全部可用资金'}
                aria-label={isEn() ? 'Quick invest max cash' : '快捷投入全部可用资金'}
                disabled={busy || availableCash <= 0}
                onClick={() => setRatio(1)}
              >
                {T.fundAllIn}
              </button>
            </div>
          </div>
          <div className="ex-bond-input-box">
            <input
              id="ex-fund-input"
              className="ex-input ex-num"
              inputMode="numeric"
              value={amountText}
              disabled={busy}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => {
                const raw = Number(amountText.replace(/,/g, ''))
                if (!Number.isFinite(raw) || raw <= 0) {
                  setAmountText(
                    availableCash > 0 ? String(Math.min(100000, Math.floor(availableCash))) : '100000',
                  )
                  return
                }
                setAmountText(String(Math.floor(raw)))
              }}
            />
            <span className="ex-input-unit">{T.creditUnit}</span>
          </div>
          {isOverCash ? (
            <div className="ex-bond-hint is-warn">{T.fundNoCash}</div>
          ) : isInvalid && amountText.trim() !== '' ? (
            <div className="ex-bond-hint is-warn">{T.bondAmountInvalid}</div>
          ) : null}
        </div>

        <div className="ex-bond-actions">
          <button
            type="button"
            className="ex-mini-btn is-bond-buy ex-btn-progress"
            data-sfx="exchange-buy"
            disabled={!canSubmit}
            style={progressStyle(openProgress)}
            onClick={() => void submit()}
          >
            {busy ? T.fundCalculating : hasPosition ? T.fundAddBtn : T.fundPlayBtn}
            {openProgress.active ? ` ${openProgress.pct}%` : ''}
          </button>
          <button
            type="button"
            className="ex-mini-btn ex-btn-progress"
            data-sfx="exchange-sell"
            disabled={busy || !hasPosition}
            style={progressStyle(redeemProgress)}
            onClick={() => void redeem()}
          >
            {T.fundRedeemBtn}
            {redeemProgress.active ? ` ${redeemProgress.pct}%` : ''}
          </button>
        </div>
      </div>
    </section>
  )
}
