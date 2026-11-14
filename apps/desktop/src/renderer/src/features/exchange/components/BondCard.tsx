/**
 * 低风险理财卡：交易所现金申购、固定单利、随时赎回。
 *
 * 2026-11-04 船长令：债券不再吃本地存档 ISK——和基金一样走交易所账户现金
 * （`GET /bond`、`POST /bond/open`、`POST /bond/redeem`），利息按真实分钟单利累积，
 * 顶栏的可用现金会同步扣减，玩家能直接看到钱去哪了。
 */
import { useEffect, useRef, useState } from 'react'
import type { BondPosition, ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { isEn } from '../../../i18n/locale'
import { money } from '../format'
import { T } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'

/** 高收益档本金上限（与服务端 `savingsPrincipalCap` 同口径）：1 亿以内是最高收益档，超出只有固定低息 */
const SAVINGS_SWEET_CAP = 100_000_000
/**
 * 「每日收益摸到上限」所需的本金（与服务端结算同口径）：
 * 赢的一天收益 = 12%×min(本金,1亿) + 1.2%×超出部分，正收益每天封顶 2 亿 ⇒
 * 本金到 1亿 + (2亿 − 1200万)/1.2% ≈ 157.7 亿时，赢的一天刚好赚满 2 亿；
 * 再多的本金当天不会多赚。「最优」按这个数字算，而不是按 1 亿。
 */
const BOND_DAILY_CAP = 200_000_000
const BOND_CAP_PRINCIPAL = Math.ceil(
  SAVINGS_SWEET_CAP + Math.max(0, (BOND_DAILY_CAP - SAVINGS_SWEET_CAP * 0.12) / 0.012),
)

export function BondCard({
  client,
  snap,
  onToast,
  onRefresh,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  onToast: ToastFn
  /** 申购/赎回后触发上游刷新（顶栏现金、侧栏持仓） */
  onRefresh?: () => void
}) {
  const [amountText, setAmountText] = useState('100000')
  /** 玩家手动改过输入框后不再自动填写「钱包最优金额」 */
  const amountDirtyRef = useRef(false)
  const [bond, setBond] = useState<BondPosition>(snap.bonds)
  const [tipOpen, setTipOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isAccruing, setIsAccruing] = useState(false)
  const nonceSeq = useRef(0)
  const buyProgress = useActionProgress(client)
  const redeemProgress = useActionProgress(client)

  const available = snap.account.cash
  // 收益跟行情一起刷新（10 秒一次，船长 2026-11-04 定），不做本地插值，避免与结算口径不一致。
  const accruedLive = bond.accrued
  const held = bond.principal + accruedLive

  // 快照更新（行情/账户轮询）时同步服务端持仓
  useEffect(() => {
    setBond(snap.bonds)
  }, [snap.bonds])

  // 金额默认值按「钱包最优」：投到每日收益摸到上限所需的本金为止，钱包不够就全投；玩家手动改过后不再覆盖
  useEffect(() => {
    if (amountDirtyRef.current) return
    const gap = BOND_CAP_PRINCIPAL - bond.principal
    if (available <= 0 || gap <= 0) return
    setAmountText(String(Math.floor(Math.min(available, gap))))
  }, [available, bond.principal])

  // 利息按分钟结算：行情轮询（10 秒）已带 loadBond，这里 30 秒兜底，防止上游轮询停摆。
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      void client
        .getBondPosition()
        .then((next) => {
          if (alive) setBond(next)
        })
        .catch(() => undefined)
    }
    const timer = window.setInterval(pull, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [client])

  // 利息跳动视觉平滑：已计利息增加时触发一次脉冲
  const prevAccruedRef = useRef(bond.accrued)
  useEffect(() => {
    if (bond.accrued > prevAccruedRef.current) {
      setIsAccruing(true)
      const timer = setTimeout(() => setIsAccruing(false), 900)
      prevAccruedRef.current = bond.accrued
      return () => clearTimeout(timer)
    }
    prevAccruedRef.current = bond.accrued
  }, [bond.accrued])

  const numericAmount = Math.floor(Number(amountText.replace(/,/g, '')))
  const isInvalid = !Number.isFinite(numericAmount) || numericAmount <= 0
  const isOverCash = !isInvalid && numericAmount > available
  const canBuy = !busy && !isInvalid && !isOverCash && available > 0
  const canRedeem = !busy && held > 0
  const tip = (
    <div className="ex-savings-tip">
      <div className="ex-savings-tip-row">
        <span className="ex-savings-tip-label">{T.savingsHighLabel}</span>
        <b className="ex-savings-tip-value">{T.bondTipHighValue}</b>
      </div>
      <div className="ex-savings-tip-row">
        <span className="ex-savings-tip-label">{T.savingsLowLabel}</span>
        <b className="ex-savings-tip-value">{T.bondTipLowValue}</b>
      </div>
      <div className="ex-savings-tip-row">
        <span className="ex-savings-tip-label">{T.savingsCapLabel}</span>
        <b className="ex-savings-tip-cap">{T.bondTipCapValue}</b>
      </div>
      <div className="ex-savings-tip-note">{T.savingsNote}</div>
    </div>
  )

  const handleBlur = (): void => {
    const raw = Number(amountText.replace(/,/g, ''))
    if (!Number.isFinite(raw) || raw <= 0) {
      setAmountText(available > 0 ? String(Math.min(100000, Math.floor(available))) : '100000')
      return
    }
    setAmountText(String(Math.floor(raw)))
  }

  const setRatio = (ratio: number): void => {
    if (available <= 0) return
    amountDirtyRef.current = true
    const target = Math.floor(available * ratio)
    setAmountText(String(Math.max(1, target)))
  }

  /** 「1 亿」：把本金补到 1 亿高收益档上限（钱包不够补满时不动作，由「最优」按钱包投） */
  const fillToSweetCap = (): void => {
    if (busy || available <= 0) return
    const gap = SAVINGS_SWEET_CAP - bond.principal
    if (gap <= 0 || available < gap) return
    amountDirtyRef.current = true
    setAmountText(String(gap))
  }

  /** 「最优」：按钱包与收益上限——投到「每日收益摸到上限」所需的本金为止，钱包不够就全投 */
  const fillOptimal = (): void => {
    if (busy || available <= 0) return
    const gap = BOND_CAP_PRINCIPAL - bond.principal
    if (gap <= 0) return
    amountDirtyRef.current = true
    setAmountText(String(Math.max(1, Math.min(available, gap))))
  }

  const buy = async (): Promise<void> => {
    if (!canBuy) {
      if (isOverCash) {
        onToast(T.bondNoCashTip, true)
      } else {
        onToast(T.cashierInvalidAmount, true)
      }
      return
    }
    nonceSeq.current += 1
    setBusy(true)
    buyProgress.start()
    try {
      const next = await client.openBond(numericAmount, `bond-open-${Date.now()}-${nonceSeq.current}`)
      await buyProgress.finish()
      setBond(next)
      onToast(`${T.toastBondBought} ${money(numericAmount)} ${T.creditUnit}`)
      onRefresh?.()
    } catch (err) {
      await buyProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  const redeem = async (): Promise<void> => {
    if (!canRedeem) {
      onToast(T.bondEmpty, true)
      return
    }
    nonceSeq.current += 1
    setBusy(true)
    redeemProgress.start()
    try {
      const next = await client.redeemBond(`bond-redeem-${Date.now()}-${nonceSeq.current}`)
      const total = Math.max(0, next.value)
      await redeemProgress.finish()
      setBond(next)
      if (total > 0) onToast(`${T.toastBondRedeemed} ${money(total)} ${T.creditUnit}`)
      onRefresh?.()
    } catch (err) {
      await redeemProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ex-panel ex-bond" aria-label={T.bondTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.bondTitle}</h3>
      </header>
      <div className="ex-bond-body">
        <div
          className="ex-bond-name"
          onMouseEnter={() => setTipOpen(true)}
          onMouseLeave={() => setTipOpen(false)}
        >
          <b className="ex-savings-anchor">
            {T.bondName}
            <span className="ex-help-mark">?</span>
          </b>
          {tipOpen ? (
            <div className="ex-savings-pop" role="tooltip">
              <span className="ex-savings-pop-line" />
              <div className="ex-savings-pop-body">{tip}</div>
            </div>
          ) : null}
        </div>

        {/* 债券资产概览：可用现金 → 本金 → 已计息（2026-11-06 船长令统一排序） */}
        <div className="ex-preview-row is-avail-row">
          <span>{T.strategyAvailCash}</span>
          <b className="ex-num">
            {money(available)} <span className="ex-unit">{T.creditUnit}</span>
          </b>
        </div>
        <div className="ex-preview-row">
          <span>{T.bondPrincipal}</span>
          <b className="ex-num">
            {money(bond.principal)} <span className="ex-unit">{T.creditUnit}</span>
          </b>
        </div>
        <div className="ex-preview-row is-bond-highlight">
          <span>{T.bondAccrued}</span>
          <b className={`ex-num ${bond.accrued > 0 ? 'is-up' : bond.accrued < 0 ? 'is-down' : ''} ex-bond-accrued ${isAccruing ? 'is-pulse' : ''}`}>
            {bond.accrued > 0 ? '+' : bond.accrued < 0 ? '−' : ''}{money(Math.abs(bond.accrued))} <span className="ex-unit">{T.creditUnit}</span>
          </b>
        </div>

        {/* 买入配置与快捷比例 */}
        <div className="ex-bond-field">
          <div className="ex-bond-field-head">
            <label className="ex-label" htmlFor="ex-bond-input">
              {T.bondBuy}
            </label>
            <div
              className="ex-bond-quick-ratios"
              role="group"
              aria-label={isEn() ? 'Quick buy ratios' : '快捷买入比例'}
            >
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title={isEn() ? 'Quick buy 25% cash' : '快捷买入 25% 可用资金'}
                aria-label={isEn() ? 'Quick buy 25% cash' : '快捷买入 25% 可用资金'}
                disabled={available <= 0}
                onClick={() => setRatio(0.25)}
              >
                {T.bondPct25}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title={isEn() ? 'Quick buy 50% cash' : '快捷买入 50% 可用资金'}
                aria-label={isEn() ? 'Quick buy 50% cash' : '快捷买入 50% 可用资金'}
                disabled={available <= 0}
                onClick={() => setRatio(0.5)}
              >
                {T.bondPct50}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn is-sweet"
                title={T.savingsFillCapTip}
                aria-label={T.savingsFillCapTip}
                disabled={busy || available <= 0 || bond.principal >= SAVINGS_SWEET_CAP || available < SAVINGS_SWEET_CAP - bond.principal}
                onClick={fillToSweetCap}
              >
                {T.savingsOneCap}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title={T.savingsOptimalTip}
                aria-label={T.savingsOptimalTip}
                disabled={busy || available <= 0 || bond.principal >= BOND_CAP_PRINCIPAL}
                onClick={fillOptimal}
              >
                {T.savingsOptimal}
              </button>
            </div>
          </div>
          <div className="ex-bond-input-box">
            <input
              id="ex-bond-input"
              className="ex-input ex-num"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                amountDirtyRef.current = true
                setAmountText(e.target.value)
              }}
              onBlur={handleBlur}
            />
            <span className="ex-input-unit">{T.creditUnit}</span>
          </div>
          {/* 防呆提示 */}
          {isOverCash ? (
            <div className="ex-bond-hint is-warn">{T.bondNoCashTip}</div>
          ) : isInvalid && amountText.trim() !== '' ? (
            <div className="ex-bond-hint is-warn">{T.bondAmountInvalid}</div>
          ) : null}
        </div>

        {/* 操作按钮组：优雅禁用态与防呆提示 */}
        <div className="ex-bond-actions">
          <button
            type="button"
            className="ex-mini-btn is-bond-buy ex-btn-progress"
            data-sfx="exchange-buy"
            disabled={!canBuy}
            style={progressStyle(buyProgress)}
            onClick={() => void buy()}
          >
            {T.bondBuyBtn}{buyProgress.active ? ` ${buyProgress.pct}%` : ''}
          </button>
          <button
            type="button"
            className="ex-mini-btn is-bond-redeem ex-btn-progress"
            data-sfx="exchange-sell"
            disabled={!canRedeem}
            title={!canRedeem ? T.bondHoldingEmptyTip : undefined}
            style={progressStyle(redeemProgress)}
            onClick={() => void redeem()}
          >
            {T.bondRedeemAll}{redeemProgress.active ? ` ${redeemProgress.pct}%` : ''}
          </button>
        </div>
      </div>
    </section>
  )
}
