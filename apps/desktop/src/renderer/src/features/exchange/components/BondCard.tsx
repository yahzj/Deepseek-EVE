/**
 * 低风险理财卡：一笔可买的「舰船债券」。
 *
 * 利率是**原型观感值**（日化 0.03%，游戏内 60 秒按 1 日计息），用于让船长在 10 分钟里
 * 看到「利息在涨」；不代表最终经济数值，转正时由服务端配置下发。
 */
import { useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { money, pctAbs } from '../format'
import { T } from '../texts'

export function BondCard({
  client,
  snap,
  onToast,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  onToast: ToastFn
}) {
  const [amountText, setAmountText] = useState('100000')
  const bond = snap.bonds
  const product = snap.bondProduct
  const held = bond.principal + bond.accrued

  const buy = (): void => {
    try {
      client.buyBond(Number(amountText))
      onToast(`${T.toastBondBought} ${money(Number(amountText))} ISK`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    }
  }
  const redeem = (): void => {
    if (held <= 0) {
      onToast(T.bondEmpty, true)
      return
    }
    try {
      const total = client.redeemBond()
      if (total > 0) onToast(`${T.toastBondRedeemed} ${money(total)} ISK`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    }
  }

  return (
    <section className="ex-panel ex-bond" aria-label={T.bondTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.bondTitle}</h3>
        <span className="ex-dim">{T.bondGameDay}</span>
      </header>
      <div className="ex-bond-body">
        <div className="ex-bond-name">
          <b>{product.name}</b>
          <span className="ex-bond-rate">{T.bondRateLabel} {pctAbs(product.dailyRate * 100)}</span>
        </div>
        <div className="ex-preview-row">
          <span>{T.bondPrincipal}</span>
          <b className="ex-num">{money(bond.principal)}</b>
        </div>
        <div className="ex-preview-row">
          <span>{T.bondAccrued}</span>
          <b className="ex-num is-up">+{money(bond.accrued)}</b>
        </div>
        <div className="ex-preview-row">
          <span>{T.bondValue}</span>
          <b className="ex-num">{money(held)}</b>
        </div>
        <div className="ex-field">
          <label className="ex-label" htmlFor="ex-bond-input">{T.bondBuy}</label>
          <input
            id="ex-bond-input"
            className="ex-input ex-num"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        <div className="ex-bond-actions">
          <button type="button" className="ex-mini-btn is-bond-buy" onClick={buy}>
            {T.bondBuyBtn}
          </button>
          <button type="button" className="ex-mini-btn is-bond-redeem" onClick={redeem}>
            {T.bondRedeem}
          </button>
        </div>
      </div>
    </section>
  )
}
