/**
 * 极简模式 · 当前标的持仓战报（SimplePosition）。
 *
 * 核心设计：
 * - 集中呈现当前标的的现货多头、逐仓多头与融券空头全部持仓；
 * - 现货 / 杠杆多头 / 融券空头三种类型持仓清晰区分（徽标胶囊、颜色条）；
 * - 数据展示：持仓量、成本均价、当前市价、浮动盈亏（金额+百分比），全部等宽字体排版杜绝数字跳动；
 * - 保证金与强平风险感知：展示杠杆/融券仓位强平价、距强平安全百分比及微型安全指示条；
 * - 各持仓子项独立提供【单独平仓】操作，具备 loading 状态防重；
 * - 顶部配备【一键全部平仓】高危动作防误触交互（首次点击进入确认倒计时态，二次点击执行平仓）；
 * - 严密遵守色彩语义与深空主题契约（无 Emoji，无裸色字面量）。
 */
import { useEffect, useRef, useState } from 'react'
import { Close, WarningAlt } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount, money, pct, pnlMoney, price } from '../format'
import { T, TF } from '../texts'

interface SimplePositionProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onToast: ToastFn
}

/** 距强平危险警戒阈值（百分比） */
const LIQ_DANGER_PCT = 15
const LIQ_CRITICAL_PCT = 5

export function SimplePosition({ client, snap, code, onToast }: SimplePositionProps) {
  // 当前正在平仓的目标：'spot' | 'all' | 逐仓仓位 id | null
  const [closingTarget, setClosingTarget] = useState<string | null>(null)
  // 一键全部平仓防误触状态与倒计时秒数
  const [confirmCloseAll, setConfirmCloseAll] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const countdownTimer = useRef<number | null>(null)
  const orderSeq = useRef(0)

  const quote = snap.stocks.find((s) => s.code === code)
  const curPrice = quote?.price ?? 0

  // 1. 现货多头
  const holding = snap.account.holdings.find((h) => h.code === code)
  const heldQty = holding?.availableQty ?? holding?.qty ?? 0
  const avgCost = holding?.avgCost ?? 0
  const spotVal = heldQty * curPrice
  const spotCost = heldQty * avgCost
  const spotPnl = spotVal - spotCost
  const spotPnlPct = spotCost > 0 ? (spotPnl / spotCost) * 100 : 0

  // 2. 逐仓杠杆（多头/空头）
  const posList = snap.account.positions.filter((p) => p.code === code)
  const hasAnyPosition = heldQty > 0 || posList.length > 0

  // 倒计时结束时自动重置防误触状态
  const cancelConfirm = () => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
    setConfirmCloseAll(false)
    setCountdown(3)
  }

  // 组件卸载时清理倒计时定时器
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && confirmCloseAll) {
        cancelConfirm()
      }
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

  if (!hasAnyPosition) {
    return (
      <div className="ex-simple-pos-card is-empty">
        <div className="ex-simple-pos-empty-inner">
          <div className="ex-simple-pos-empty-title">暂未持有 {code} 仓位</div>
          <span className="ex-dim">{T.simpleEmptyPosHint}</span>
        </div>
      </div>
    )
  }

  // 整体战报盈亏汇总
  const totalMargin = posList.reduce((sum, p) => sum + p.margin, 0)
  const totalPnl = (heldQty > 0 ? spotPnl : 0) + posList.reduce((sum, p) => sum + p.unrealizedPnl, 0)
  const totalCost = (heldQty > 0 ? spotCost : 0) + totalMargin
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const isOverallProfit = totalPnl >= 0
  const isBusy = closingTarget !== null

  // 单独平仓：现货
  const handleCloseSpot = async () => {
    if (isBusy || heldQty <= 0) return
    setClosingTarget('spot')
    orderSeq.current += 1
    try {
      await client.placeOrder({
        clientOrderId: `simple-close-spot-${code}-${Date.now()}-${orderSeq.current}`,
        code,
        side: 'sell',
        type: 'market',
        tif: 'IOC',
        qty: heldQty,
        leverage: 1,
      })
      onToast(TF.closeSpotDone(code, amount(heldQty)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setClosingTarget(null)
    }
  }

  // 单独平仓：逐仓多/空
  const handleClosePos = async (posKey: string, pSide: 'long' | 'short', pQty: number) => {
    if (isBusy) return
    setClosingTarget(posKey)
    try {
      await client.closePosition(code, pSide)
      onToast(TF.closePosDone(code, pSide === 'short' ? '融券空头' : '杠杆多头', amount(pQty)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setClosingTarget(null)
    }
  }

  // 执行全部平仓变现
  const executeCloseAll = async () => {
    setClosingTarget('all')
    orderSeq.current += 1
    let totalShares = heldQty
    try {
      if (heldQty > 0) {
        await client.placeOrder({
          clientOrderId: `simple-close-all-${code}-${Date.now()}-${orderSeq.current}`,
          code,
          side: 'sell',
          type: 'market',
          tif: 'IOC',
          qty: heldQty,
          leverage: 1,
        })
      }
      for (const p of posList) {
        totalShares += p.qty
        await client.closePosition(p.code, p.side)
      }
      onToast(TF.closeAllDone(code, amount(totalShares)))
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), true)
    } finally {
      setClosingTarget(null)
    }
  }

  // 一键全部平仓触发入口（含安全防误触流程）
  const handleClickCloseAll = () => {
    if (isBusy) return
    // 若尚未进入确认态，则开启确认倒计时
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

    // 处于确认态，第二次点击直接执行平仓
    cancelConfirm()
    executeCloseAll()
  }

  return (
    <div className={`ex-simple-pos-card${isOverallProfit ? ' is-profit' : ' is-loss'}`}>
      <div className="ex-simple-pos-head">
        <div className="ex-simple-pos-head-info">
          <div className="ex-simple-pos-title-row">
            <h4 className="ex-simple-pos-title">我的【{code}】持仓战报</h4>
            {totalMargin > 0 && (
              <span className="ex-simple-pos-margin-badge" title="当前股票逐仓杠杆占用总保证金">
                保证金: <b className="ex-num">{money(totalMargin)}</b>
              </span>
            )}
          </div>
          <span className={`ex-simple-pos-total-pnl ${isOverallProfit ? 'is-up' : 'is-down'}`}>
            净浮盈: {pnlMoney(totalPnl)} ({pct(totalPnlPct)})
          </span>
        </div>

        <div className="ex-simple-pos-head-actions">
          {confirmCloseAll && (
            <button
              type="button"
              className="ex-simple-close-cancel-btn"
              onClick={cancelConfirm}
              title="取消全部平仓"
              aria-label="取消全部平仓"
            >
              取消
            </button>
          )}
          <button
            type="button"
            className={`ex-simple-close-all-btn${confirmCloseAll ? ' is-confirming' : ''}${closingTarget === 'all' ? ' is-busy' : ''}`}
            disabled={isBusy}
            onClick={handleClickCloseAll}
            title={confirmCloseAll ? '高危操作：再次点击立即全部平仓！' : '以市价卖出该股票所有现货并结清所有杠杆仓位'}
          >
            {closingTarget === 'all' ? (
              <span className="ex-simple-pos-loading">清仓中…</span>
            ) : confirmCloseAll ? (
              <>
                <WarningAlt size={13} />
                <span>确定全平? ({countdown}s)</span>
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
        {/* 1. 现货多头行 */}
        {heldQty > 0 && (
          <div className="ex-simple-pos-row is-spot">
            <div className="ex-simple-pos-row-head">
              <div className="ex-simple-pos-badge is-spot">{T.simpleSpotHolding} · 1x</div>
              <button
                type="button"
                className={`ex-simple-sub-close-btn is-close${closingTarget === 'spot' ? ' is-busy' : ''}`}
                disabled={isBusy}
                onClick={handleCloseSpot}
                title="单独市价全额卖出现货多头"
              >
                {closingTarget === 'spot' ? (
                  <span className="ex-simple-pos-loading">变现中…</span>
                ) : (
                  <>
                    <Close size={12} /> {T.simpleCloseSpot}
                  </>
                )}
              </button>
            </div>
            <div className="ex-simple-pos-row-grid">
              <div className="ex-simple-pos-item">
                <span className="ex-dim">{T.currentHolding}</span>
                <b className="ex-num">{amount(heldQty)} 股</b>
              </div>
              <div className="ex-simple-pos-item">
                <span className="ex-dim">{T.positionCost}</span>
                <b className="ex-num">{price(avgCost)}</b>
              </div>
              <div className="ex-simple-pos-item">
                <span className="ex-dim">{T.positionMarkVal}</span>
                <b className="ex-num">{money(spotVal)}</b>
              </div>
              <div className="ex-simple-pos-item is-pnl">
                <span className="ex-dim">{T.unrealizedPnl}</span>
                <b className={`ex-num ex-simple-pos-pnl-val ${spotPnl >= 0 ? 'is-up' : 'is-down'}`}>
                  {pnlMoney(spotPnl)} ({pct(spotPnlPct)})
                </b>
              </div>
            </div>
          </div>
        )}

        {/* 2. 逐仓杠杆仓位行（多头 / 空头） */}
        {posList.map((p) => {
          const isShort = p.side === 'short'
          const pnlPct = p.margin > 0 ? (p.unrealizedPnl / p.margin) * 100 : 0
          const isPnlUp = p.unrealizedPnl >= 0
          const posKey = p.id || `${p.code}-${p.side}`
          const isThisBusy = closingTarget === posKey

          // 强平安全距离评估
          const rawDist = p.liquidationDistancePct ?? (
            p.liquidationPrice > 0 && curPrice > 0
              ? isShort
                ? Math.max(0, ((p.liquidationPrice - curPrice) / curPrice) * 100)
                : Math.max(0, ((curPrice - p.liquidationPrice) / curPrice) * 100)
              : 100
          )
          const distance = Number.isFinite(rawDist) ? Math.max(0, rawDist) : 0
          const isCritical = distance < LIQ_CRITICAL_PCT
          const isDanger = distance < LIQ_DANGER_PCT
          const riskLevelClass = isCritical ? 'is-critical' : isDanger ? 'is-danger' : 'is-safe'
          const healthBarWidth = Math.min(100, Math.max(4, distance))

          return (
            <div
              key={posKey}
              className={`ex-simple-pos-row ${isShort ? 'is-short' : 'is-long'}${isCritical ? ' is-liq-critical' : isDanger ? ' is-liq-danger' : ''}`}
            >
              <div className="ex-simple-pos-row-head">
                <div className={`ex-simple-pos-badge ${isShort ? 'is-short' : 'is-long'}`}>
                  {isShort ? `融券空头 · ${p.leverage}x` : `杠杆多头 · ${p.leverage}x`}
                </div>
                <button
                  type="button"
                  className={`ex-simple-sub-close-btn is-close${isThisBusy ? ' is-busy' : ''}`}
                  disabled={isBusy}
                  onClick={() => handleClosePos(posKey, p.side, p.qty)}
                  title={isShort ? '单独市价全平空头仓位' : '单独市价全平多头仓位'}
                >
                  {isThisBusy ? (
                    <span className="ex-simple-pos-loading">平仓中…</span>
                  ) : (
                    <>
                      <Close size={12} /> {isShort ? T.simpleCloseShort : T.simpleCloseLong}
                    </>
                  )}
                </button>
              </div>

              <div className="ex-simple-pos-row-grid">
                <div className="ex-simple-pos-item">
                  <span className="ex-dim">{isShort ? '融券数量' : '杠杆数量'}</span>
                  <b className="ex-num">{amount(p.qty)} 股</b>
                </div>
                <div className="ex-simple-pos-item">
                  <span className="ex-dim">{isShort ? '开空均价' : '开多均价'}</span>
                  <b className="ex-num">{price(p.avgEntry)}</b>
                </div>
                <div className="ex-simple-pos-item">
                  <span className="ex-dim">{T.simpleEstMargin}</span>
                  <b className="ex-num">{money(p.margin)}</b>
                </div>
                <div className="ex-simple-pos-item is-pnl">
                  <span className="ex-dim">{T.unrealizedPnl}</span>
                  <b className={`ex-num ex-simple-pos-pnl-val ${isPnlUp ? 'is-up' : 'is-down'}`}>
                    {pnlMoney(p.unrealizedPnl)} ({pct(pnlPct)})
                  </b>
                </div>
              </div>

              {/* 强平风险与健康度指示条 */}
              {p.liquidationPrice > 0 && (
                <div className={`ex-simple-pos-risk-bar ${riskLevelClass}`}>
                  <div className="ex-simple-pos-risk-info">
                    <span className="ex-simple-pos-risk-tag">
                      {isCritical && <WarningAlt size={12} className="ex-risk-icon-pulse" />}
                      {isCritical ? ' 强平极危' : isDanger ? '强平预警' : '仓位健康'}
                    </span>
                    <span className="ex-simple-pos-risk-desc">
                      强平价: <b className="ex-num">{price(p.liquidationPrice)}</b>
                      <span className="ex-simple-pos-risk-gap">
                        (距强平: <b className="ex-num">{distance.toFixed(1)}%</b>)
                      </span>
                    </span>
                  </div>
                  <div className="ex-simple-pos-meter-track" title={`距强平安全距离: ${distance.toFixed(1)}%`}>
                    <div
                      className={`ex-simple-pos-meter-fill ${riskLevelClass}`}
                      style={{ width: `${healthBarWidth}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

