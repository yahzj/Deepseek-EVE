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
import { T } from '../texts'

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

  const play = (): void => {
    if (calc) return
    const amount = Math.floor(Number(amountText))
    if (!(amount > 0) || !Number.isSafeInteger(amount)) {
      onToast(T.cashierInvalidAmount, true)
      return
    }
    if (amount > snap.account.cash) {
      onToast(T.fundNoCash, true)
      return
    }
    setCalc(true)
    const nonce = crypto.randomUUID()
    void (async () => {
      try {
        // 动画与请求并行：至少展示 1.2 秒「计算中…」，避免结果一闪而过。
        const [result] = await Promise.all([client.playFund(amount, nonce), sleep(CALC_ANIM_MS)])
        setLast(result)
        onToast(
          result.win ? T.fundWin(money(result.profit)) : T.fundLose(money(-result.profit)),
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
        {last !== null ? (
          <>
            <div className="ex-preview-row">
              <span>{last.win ? T.fundResultWin : T.fundResultLose}</span>
              <b className={`ex-num ${last.win ? 'is-up' : 'is-down'}`}>
                {last.win ? '+' : '−'}
                {money(Math.abs(last.profit))}
              </b>
            </div>
            <div className="ex-preview-row">
              <span>结算依据</span>
              <span className="ex-dim">{last.evidence}</span>
            </div>
          </>
        ) : null}
        <div className="ex-field">
          <label className="ex-label" htmlFor="ex-fund-input">
            {T.fundAmount}
          </label>
          <input
            id="ex-fund-input"
            className="ex-input ex-num"
            inputMode="numeric"
            value={amountText}
            disabled={calc}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        <div className="ex-bond-actions">
          <button type="button" className="ex-mini-btn is-bond-buy" disabled={calc} onClick={play}>
            {calc ? T.fundCalculating : T.fundPlayBtn}
          </button>
        </div>
      </div>
    </section>
  )
}
