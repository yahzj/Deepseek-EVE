import { isEn } from '../../../i18n/locale'
/**
 * 极简模式 · 我的持仓（SimplePosition）。
 *
 * 2026-11-04 船长令：右栏原来的「下注列表」只显示当前选中股票，和「我的委托」重复；
 * 两者整合成一块，并且必须显示所有买过的股票，不随选中标的切换。
 *
 * 核心设计：
 * - 全部持仓（现货多头 / 逐仓多头 / 逐仓空头）逐行汇总，不按 code 过滤；
 * - 每条持仓压成单行（类型徽标 · 代码 · 数量 · 成本 · 浮动盈亏 · 平仓），把高度留给列表本身；
 * - 强平风险不再铺开风险条，只在行尾用警示图标 + 悬停提示，避免窄列被撑高；
 * - 顶部只保留总浮动盈亏与【一键全平】（含 3 秒防误触倒计时）。
 */
import { useEffect, useRef, useState } from 'react'
import { Close, WarningAlt } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, pct, pnlMoney, price } from '../format'
import { T, TF } from '../texts'
import { progressStyle, useActionProgress } from '../useActionProgress'

interface SimplePositionProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  onToast: ToastFn
}

/** 距强平危险警戒阈值（百分比） */
const LIQ_DANGER_PCT = 15
const LIQ_CRITICAL_PCT = 5

/** 单行持仓视图模型：现货与逐仓仓位统一成同一种紧凑行 */
interface HoldingLine {
  key: string
  code: string
  tag: string
  tone: 'spot' | 'long' | 'short'
  qty: number
  avgPrice: number
  principal: number
  pnl: number
  liquidationPrice: number
  distance: number
}

export function SimplePosition({ client, snap, onToast }: SimplePositionProps) {
  // 当前正在平仓的目标：'all' | 行 key | null
  const [closingTarget, setClosingTarget] = useState<string | null>(null)
  const [confirmCloseAll, setConfirmCloseAll] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const countdownTimer = useRef<number | null>(null)
  const orderSeq = useRef(0)
  const closeProgress = useActionProgress(client)

  const priceOf = (code: string): number => snap.stocks.find((s) => s.code === code)?.price ?? 0

  const lines: HoldingLine[] = []
  for (const h of snap.account.holdings) {
    const qty = h.availableQty ?? h.qty
    if (qty <= 0) continue
    const curPrice = priceOf(h.code)
    const pnl = qty * (curPrice - h.avgCost)
    lines.push({
      key: `spot-${h.code}`,
      code: h.code,
      tag: T.simpleSpotHolding,
      tone: 'spot',
      qty,
      avgPrice: h.avgCost,
      principal: qty * h.avgCost,
      pnl,
      liquidationPrice: 0,
      distance: 100,
    })
  }
  for (const p of snap.account.positions) {
    const isShort = p.side === 'short'
    const rawDist =
      p.liquidationDistancePct ??
      (p.liquidationPrice > 0 && priceOf(p.code) > 0
        ? isShort
          ? ((p.liquidationPrice - priceOf(p.code)) / priceOf(p.code)) * 100
          : ((priceOf(p.code) - p.liquidationPrice) / priceOf(p.code)) * 100
        : 100)
    lines.push({
      key: p.id || `pos-${p.code}-${p.side}`,
      code: p.code,
      // 1x 与现货同口径，不再附加「· 1x」后缀；只有真实高杠杆才显示倍数，避免一长一短。
      tag: `${isShort ? T.simpleLeverageShort : T.simpleLeverageLong}${p.leverage > 1 ? ` · ${p.leverage}x` : ''}`,
      tone: isShort ? 'short' : 'long',
      qty: p.qty,
      avgPrice: p.avgEntry,
      principal: p.margin,
      pnl: p.unrealizedPnl,
      liquidationPrice: p.liquidationPrice,
      distance: Number.isFinite(rawDist) ? Math.max(0, rawDist) : 0,
    })
  }

  const totalPnl = lines.reduce((sum, line) => sum + line.pnl, 0)
  const totalCost = lines.reduce((sum, line) => sum + line.principal, 0)
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const isOverallProfit = totalPnl >= 0
  const isBusy = closingTarget !== null

  const cancelConfirm = (): void => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
    setConfirmCloseAll(false)
    setCountdown(3)
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && confirmCloseAll) cancelConfirm()
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }
  }, [confirmCloseAll])

  if (lines.length === 0) {
    return (
      <div className="ex-simple-pos-card is-empty">
        <div className="ex-simple-pos-empty-inner">
          <div className="ex-simple-pos-empty-title">{T.simpleBookEmptyTitle}</div>
          <span className="ex-dim">{T.simpleEmptyPosHint}</span>
          <button
            type="button"
            className="app-btn is-small ex-simple-pos-go-trade"
            onClick={() => document.getElementById('ex-simple-cash-amount')?.focus()}
          >
            {T.simpleGoTrade}
          </button>
        </div>
      </div>
    )
  }

  const closeSpot = async (code: string, qty: number): Promise<void> => {
    orderSeq.current += 1
    await client.placeOrder({
      clientOrderId: `simple-close-spot-${code}-${Date.now()}-${orderSeq.current}`,
      code,
      side: 'sell',
      type: 'market',
      tif: 'IOC',
      qty,
      leverage: 1,
      // 简单模式结算：按点击时的现价锁价，回合末由系统兜底保证成交。
      guaranteed: true,
      expectedPrice: priceOf(code),
    })
  }

  const handleCloseLine = async (line: HoldingLine): Promise<void> => {
    if (isBusy) return
    setClosingTarget(line.key)
    closeProgress.start()
    try {
      if (line.tone === 'spot') await closeSpot(line.code, line.qty)
      else await client.closePosition(line.code, line.tone, undefined, priceOf(line.code))
      await closeProgress.finish()
      onToast(TF.closePosDone(line.code, line.tag, amount(line.qty)))
    } catch (err) {
      await closeProgress.finish(false)
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setClosingTarget(null)
    }
  }

  const executeCloseAll = async (): Promise<void> => {
    setClosingTarget('all')
    closeProgress.start()
    let failed = 0
    let firstError = ''
    for (const line of lines) {
      try {
        if (line.tone === 'spot') await closeSpot(line.code, line.qty)
        else await client.closePosition(line.code, line.tone, undefined, priceOf(line.code))
      } catch (err) {
        failed += 1
        // 只报失败笔数会让玩家不知道卡在哪一条；带上首条服务端原因，便于自查。
        if (firstError === '') firstError = err instanceof Error ? err.message : String(err)
      }
    }
    await closeProgress.finish(failed === 0)
    setClosingTarget(null)
    if (failed === 0) onToast(TF.simpleBookCloseAllDone(lines.length))
    else if (firstError !== '') onToast(`${TF.simpleBookCloseAllFailed(failed)}：${firstError}`, true)
    else onToast(TF.simpleBookCloseAllFailed(failed), true)
  }

  const handleClickCloseAll = (): void => {
    if (isBusy) return
    if (!confirmCloseAll) {
      setConfirmCloseAll(true)
      setCountdown(3)
      if (countdownTimer.current) clearInterval(countdownTimer.current)
      countdownTimer.current = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            cancelConfirm()
            return 3
          }
          return prev - 1
        })
      }, 1000)
      return
    }
    cancelConfirm()
    void executeCloseAll()
  }

  return (
    <div className={`ex-simple-pos-card${isOverallProfit ? ' is-profit' : ' is-loss'}`}>
      <div className="ex-simple-pos-head">
        <div className="ex-simple-pos-head-info">
          <div className="ex-simple-pos-title-row">
            <h4 className="ex-simple-pos-title">{T.simpleBookTitle}</h4>
            <span className="ex-simple-pos-count">{lines.length}</span>
          </div>
          <span className={`ex-simple-pos-total-pnl ${isOverallProfit ? 'is-up' : 'is-down'}`}>
            {T.unrealizedPnl}: {pnlMoney(totalPnl)} ({pct(totalPnlPct)})
          </span>
        </div>

        <div className="ex-simple-pos-head-actions">
          {confirmCloseAll && (
            <button
              type="button"
              className="ex-simple-close-cancel-btn"
              onClick={cancelConfirm}
              title="取消全部结算"
              aria-label="取消全部结算"
            >
              取消
            </button>
          )}
          <button
            type="button"
            className={`ex-simple-close-all-btn ex-btn-progress${confirmCloseAll ? ' is-confirming' : ''}${closingTarget === 'all' ? ' is-busy' : ''}`}
            data-sfx="exchange-sell"
            style={closingTarget === 'all' ? progressStyle(closeProgress) : undefined}
            disabled={isBusy}
            onClick={handleClickCloseAll}
            title={confirmCloseAll ? T.confirmCloseAllTooltip : T.confirmCloseAllHelp}
          >
            {closingTarget === 'all' ? (
              <span className="ex-simple-pos-loading">{T.closing} {closeProgress.pct}%</span>
            ) : confirmCloseAll ? (
              <>
                <WarningAlt size={13} />
                <span>{T.confirmCloseAll} ({countdown}s)</span>
              </>
            ) : (
              <>
                <Close size={13} />
                <span>{T.closeAllPositions}</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="ex-simple-pos-list">
        {lines.map((line) => {
          const isCritical = line.liquidationPrice > 0 && line.distance < LIQ_CRITICAL_PCT
          const isDanger = line.liquidationPrice > 0 && line.distance < LIQ_DANGER_PCT
          const pnlPct = line.principal > 0 ? (line.pnl / line.principal) * 100 : 0
          const isPnlUp = line.pnl >= 0
          const isThisBusy = closingTarget === line.key
          return (
            <div
              className={`ex-simple-pos-line is-${line.tone}${isCritical ? ' is-liq-critical' : isDanger ? ' is-liq-danger' : ''}`}
              key={line.key}
              title={`${line.code} · ${line.tag} · ${T.simpleBetPrice} ${price(line.avgPrice)}`}
            >
              <span className={`ex-simple-pos-badge is-${line.tone}`}>{line.tag}</span>
              <b className="ex-simple-pos-code">{line.code}</b>
              <span className="ex-num ex-dim">{amount(line.qty)}</span>
              <span className={`ex-num ex-simple-pos-pnl-val ${isPnlUp ? 'is-up' : 'is-down'}`}>
                {pnlMoney(line.pnl)} ({pct(pnlPct)})
              </span>
              {line.liquidationPrice > 0 && (isCritical || isDanger) && (
                <WarningAlt
                  size={12}
                  className={isCritical ? 'ex-risk-icon-pulse is-critical' : 'is-danger'}
                  title={`${T.previewLiqPrice} ${price(line.liquidationPrice)} · ${T.previewLiqDistance} ${line.distance.toFixed(1)}%`}
                />
              )}
              <button
                type="button"
                className={`ex-simple-sub-close-btn is-close ex-btn-progress${isThisBusy ? ' is-busy' : ''}`}
                data-sfx="exchange-sell"
                style={isThisBusy ? progressStyle(closeProgress) : undefined}
                disabled={isBusy}
                onClick={() => void handleCloseLine(line)}
                title={isEn() ? `Market close ${line.code}` : `结算 ${line.code} 下注`}
              >
                {isThisBusy ? (
                  <span className="ex-simple-pos-loading">{T.closingPos} {closeProgress.pct}%</span>
                ) : (
                  <>
                    <Close size={12} /> {T.simpleClose}
                  </>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
