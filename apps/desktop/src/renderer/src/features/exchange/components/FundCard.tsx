/**
 * 保底基金（极简模式）：投入交易所现金，服务端用实盘数据结算。
 *
 * 规则（船长 2026-11-04 定案）：
 * - 50% 概率盈利：盈利 = 债券分钟利息 × 3；
 * - 50% 概率亏损：亏损 = 债券分钟利息 × 1（不亏本金）；
 * - 结算由服务端读取实盘数据 + nonce 决定，前端只展示「计算中…」动画与结果。
 */
import { useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot, FundPlayResult } from '../client'
import type { ToastFn } from '../../../pages/common'
import { money } from '../format'
import { T, TF } from '../texts'

const CALC_ANIM_MS = 1200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

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
  const [amountText, setAmountText] = useState('100000')
  const [calc, setCalc] = useState(false)
  const [last, setLast] = useState<FundPlayResult | null>(null)

  const availableCash = snap.account.cash
  const numericAmount = Math.floor(Number(amountText.replace(/,/g, '')))
  const isInvalid = !Number.isFinite(numericAmount) || numericAmount <= 0
  const isOverCash = !isInvalid && numericAmount > availableCash
  const canPlay = !calc && !isInvalid && !isOverCash && availableCash > 0

  const handleBlur = (): void => {
    const raw = Number(amountText.replace(/,/g, ''))
    if (!Number.isFinite(raw) || raw <= 0) {
      setAmountText(availableCash > 0 ? String(Math.min(100000, Math.floor(availableCash))) : '100000')
      return
    }
    setAmountText(String(Math.floor(raw)))
  }

  const setRatio = (ratio: number): void => {
    if (availableCash <= 0 || calc) return
    const target = Math.floor(availableCash * ratio)
    setAmountText(String(Math.max(1, target)))
  }

  const play = (): void => {
    if (!canPlay) {
      if (isOverCash) {
        onToast(T.fundNoCash, true)
      } else {
        onToast(T.cashierInvalidAmount, true)
      }
      return
    }
    setCalc(true)
    const nonce = crypto.randomUUID()
    void (async () => {
      try {
        // 动画与请求并行：至少展示 1.2 秒「计算中…」，避免结果一闪而过。
        const [result] = await Promise.all([client.playFund(numericAmount, nonce), sleep(CALC_ANIM_MS)])
        setLast(result)
        onToast(
          result.win ? TF.fundWin(money(result.profit)) : TF.fundLose(money(-result.profit)),
          !result.win,
        )
        onRefresh()
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err), true)
      } finally {
        setCalc(false)
      }
    })()
  }

  return (
    <section className="ex-panel ex-bond ex-fund" aria-label={T.fundTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.fundTitle}</h3>
        <span className="ex-dim">{T.fundRateHint}</span>
      </header>
      <div className="ex-bond-body">
        <div className="ex-bond-name">
          <b>{T.fundName}</b>
        </div>
        <p className="ex-modal-text">{T.fundDesc}</p>

        {/* 账户可用资金展示：等宽排版 */}
        <div className="ex-preview-row">
          <span>{T.strategyAvailCash}</span>
          <b className="ex-num">
            {money(availableCash)} <span className="ex-unit">ISK</span>
          </b>
        </div>

        {/* 上次结算结果：等宽排版与平滑收益高亮 */}
        {last !== null ? (
          <>
            <div className={`ex-preview-row ${last.win ? 'is-bond-highlight' : ''}`}>
              <span>{last.win ? T.fundResultWin : T.fundResultLose}</span>
              <b className={`ex-num ${last.win ? 'is-up ex-fund-result-win' : 'is-down ex-fund-result-lose'}`}>
                {last.win ? '+' : '−'}
                {money(Math.abs(last.profit))} <span className="ex-unit">ISK</span>
              </b>
            </div>
            <div className="ex-preview-row">
              <span>结算依据</span>
              <span className="ex-dim ex-num">{last.evidence}</span>
            </div>
          </>
        ) : null}

        {/* 投入金额配置与快捷比例 */}
        <div className="ex-bond-field">
          <div className="ex-bond-field-head">
            <label className="ex-label" htmlFor="ex-fund-input">
              {T.fundAmount}
            </label>
            <div className="ex-bond-quick-ratios">
              <button
                type="button"
                className="ex-bond-ratio-btn"
                disabled={calc || availableCash <= 0}
                onClick={() => setRatio(0.25)}
              >
                {T.bondPct25}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                disabled={calc || availableCash <= 0}
                onClick={() => setRatio(0.5)}
              >
                {T.bondPct50}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                disabled={calc || availableCash <= 0}
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
              disabled={calc}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={handleBlur}
            />
            <span className="ex-input-unit">ISK</span>
          </div>
          {/* 防呆提示 */}
          {isOverCash ? (
            <div className="ex-bond-hint is-warn">{T.fundNoCash}</div>
          ) : isInvalid && amountText.trim() !== '' ? (
            <div className="ex-bond-hint is-warn">{T.bondAmountInvalid}</div>
          ) : null}
        </div>

        {/* 优雅禁用态与操作按钮 */}
        <div className="ex-bond-actions">
          <button
            type="button"
            className="ex-mini-btn is-bond-buy"
            disabled={!canPlay}
            onClick={play}
          >
            {calc ? T.fundCalculating : T.fundPlayBtn}
          </button>
        </div>
      </div>
    </section>
  )
}
