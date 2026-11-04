/**
 * 低风险理财卡：一笔可买的「舰船债券」。
 *
 * 两种模式：
 * - 模拟盘：债券由 Mock 客户端本地维护（原有行为）；
 * - 联机模式（传 engine）：债券走**本地存档 ISK + 本地分钟计息**，不上服务器
 *   （船长 2026-11-04 定案：存档币本地为准、作弊不设防）。
 */
import { useEffect, useRef, useState } from 'react'
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
  const [isAccruing, setIsAccruing] = useState(false)
  const local = engine !== undefined
  const bond = local ? localBondHolding() : snap.bonds
  const product = local ? LOCAL_PRODUCT : snap.bondProduct
  const held = bond.principal + bond.accrued
  const availableIsk = local ? (engine?.state.wallet.isk ?? 0) : snap.account.cash

  // 利息跳动视觉平滑：当已计利息增加时触发脉冲光晕，平滑淡出
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

  // 输入校验与防呆
  const numericAmount = Math.floor(Number(amountText.replace(/,/g, '')))
  const isInvalid = !Number.isFinite(numericAmount) || numericAmount <= 0
  const isOverCash = !isInvalid && numericAmount > availableIsk
  const canBuy = !isInvalid && !isOverCash && availableIsk > 0
  const canRedeem = held > 0

  const handleBlur = (): void => {
    const raw = Number(amountText.replace(/,/g, ''))
    if (!Number.isFinite(raw) || raw <= 0) {
      setAmountText(availableIsk > 0 ? String(Math.min(100000, Math.floor(availableIsk))) : '100000')
      return
    }
    setAmountText(String(Math.floor(raw)))
  }

  const setRatio = (ratio: number): void => {
    if (availableIsk <= 0) return
    const target = Math.floor(availableIsk * ratio)
    setAmountText(String(Math.max(1, target)))
  }

  const buy = (): void => {
    if (!canBuy) {
      if (isOverCash) {
        onToast(T.bondNoCashTip, true)
      } else {
        onToast(T.cashierInvalidAmount, true)
      }
      return
    }
    try {
      if (local) {
        buyLocalBond(engine, numericAmount)
      } else {
        client.buyBond(numericAmount)
      }
      onToast(`${T.toastBondBought} ${money(numericAmount)} 信用点`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    }
  }

  const redeem = (): void => {
    if (!canRedeem) {
      onToast(T.bondEmpty, true)
      return
    }
    try {
      const total = local ? redeemLocalBond(engine) : client.redeemBond()
      if (total > 0) onToast(`${T.toastBondRedeemed} ${money(total)} 信用点`)
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

        {/* 债券资产概览：等宽排版对齐 */}
        <div className="ex-preview-row">
          <span>{T.bondPrincipal}</span>
          <b className="ex-num">
            {money(bond.principal)} <span className="ex-unit">信用点</span>
          </b>
        </div>
        <div className="ex-preview-row is-bond-highlight">
          <span>{T.bondAccrued}</span>
          <b className={`ex-num is-up ex-bond-accrued ${isAccruing ? 'is-pulse' : ''}`}>
            +{money(bond.accrued)} <span className="ex-unit">信用点</span>
          </b>
        </div>
        <div className="ex-preview-row">
          <span>{T.bondValue}</span>
          <b className="ex-num">
            {money(held)} <span className="ex-unit">信用点</span>
          </b>
        </div>
        <div className="ex-preview-row">
          <span>{local ? T.cashierLocalWallet : T.strategyAvailCash}</span>
          <b className="ex-num">
            {money(availableIsk)} <span className="ex-unit">信用点</span>
          </b>
        </div>

        {/* 买入配置与快捷比例 */}
        <div className="ex-bond-field">
          <div className="ex-bond-field-head">
            <label className="ex-label" htmlFor="ex-bond-input">
              {T.bondBuy}
            </label>
            <div className="ex-bond-quick-ratios" role="group" aria-label="快捷买入比例">
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title="快捷买入 25% 可用资金"
                aria-label="快捷买入 25% 可用资金"
                disabled={availableIsk <= 0}
                onClick={() => setRatio(0.25)}
              >
                {T.bondPct25}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title="快捷买入 50% 可用资金"
                aria-label="快捷买入 50% 可用资金"
                disabled={availableIsk <= 0}
                onClick={() => setRatio(0.5)}
              >
                {T.bondPct50}
              </button>
              <button
                type="button"
                className="ex-bond-ratio-btn"
                title="快捷买入全部可用资金"
                aria-label="快捷买入全部可用资金"
                disabled={availableIsk <= 0}
                onClick={() => setRatio(1)}
              >
                {T.bondBuyMax}
              </button>
            </div>
          </div>
          <div className="ex-bond-input-box">
            <input
              id="ex-bond-input"
              className="ex-input ex-num"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={handleBlur}
            />
            <span className="ex-input-unit">信用点</span>
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
            className="ex-mini-btn is-bond-buy"
            disabled={!canBuy}
            onClick={buy}
          >
            {T.bondBuyBtn}
          </button>
          <button
            type="button"
            className="ex-mini-btn is-bond-redeem"
            disabled={!canRedeem}
            title={!canRedeem ? T.bondHoldingEmptyTip : undefined}
            onClick={redeem}
          >
            {T.bondRedeemAll}
          </button>
        </div>
      </div>
    </section>
  )
}
