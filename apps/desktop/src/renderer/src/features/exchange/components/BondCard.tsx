/**
 * 低风险理财卡：一笔可买的「舰船债券」。
 *
 * 两种模式：
 * - 模拟盘：债券由 Mock 客户端本地维护（原有行为）；
 * - 联机模式（传 engine）：债券走**本地存档 ISK + 本地分钟计息**，不上服务器
 *   （船长 2026-11-04 定案：存档币本地为准、作弊不设防）。
 */
import { useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import type { GameEngine } from '../../../game/engine'
import { money, pctAbs } from '../format'
import { T } from '../texts'
import { LOCAL_BOND_MINUTE_RATE, buyLocalBond, localBondHolding, redeemLocalBond } from '../localProducts'

const LOCAL_PRODUCT = {
  id: 'WHALE-BOND-LOCAL',
  name: '舰船债券 · 稳健型',
  dailyRate: LOCAL_BOND_MINUTE_RATE,
  note: '本地计息：每 60 秒 0.03%',
}

export function BondCard({
  client,
  snap,
  onToast,
  engine,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  onToast: ToastFn
  /** 联机模式传引擎：债券改走本地存档 ISK + 本地计息 */
  engine?: GameEngine
}) {
  const [amountText, setAmountText] = useState('100000')
  const local = engine !== undefined
  const bond = local ? localBondHolding() : snap.bonds
  const product = local ? LOCAL_PRODUCT : snap.bondProduct
  const held = bond.principal + bond.accrued

  const buy = (): void => {
    try {
      const amount = Number(amountText)
      if (local) {
        buyLocalBond(engine, amount)
      } else {
        client.buyBond(amount)
      }
      onToast(`${T.toastBondBought} ${money(amount)} ISK`)
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
      const total = local ? redeemLocalBond(engine) : client.redeemBond()
      if (total > 0) onToast(`${T.toastBondRedeemed} ${money(total)} ISK`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    }
  }

  return (
    <section className="ex-panel ex-bond" aria-label={T.bondTitle}>
      <header className="ex-panel-head">
        <h3 className="ex-panel-title">{T.bondTitle}</h3>
        <span className="ex-dim">{local ? T.bondLocalNote : T.bondGameDay}</span>
      </header>
      <div className="ex-bond-body">
        <div className="ex-bond-name">
          <b>{product.name}</b>
          <span className="ex-bond-rate">
            {T.bondRateLabel} {pctAbs(product.dailyRate * 100)}
          </span>
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
        {local ? (
          <div className="ex-preview-row">
            <span>{T.cashierLocalWallet}</span>
            <b className="ex-num">{money(engine.state.wallet.isk)}</b>
          </div>
        ) : null}
        <div className="ex-field">
          <label className="ex-label" htmlFor="ex-bond-input">
            {T.bondBuy}
          </label>
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
