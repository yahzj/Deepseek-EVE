/**
 * 十字光标（2026-11-03 船长规格）：
 * - 竖线贯穿主图/成交量/RSI（共享时间轴），横线标出该根收盘价；
 * - 悬停提示走现有 `ui/Tooltip` 单例（`showTip` / `moveTip` / `hideTip`），
 *   显示该根 `O/H/L/C/量/MA/RSI`，不另起一套浮层。
 */
import type { ReactNode } from 'react'
import type { ChartPeriod, Kline } from '../../client'
import { chartPeriodSpec } from '../../chartPeriods'
import { amount, pct, price } from '../../format'
import { T } from '../../texts'

export interface CrosshairPoint {
  index: number
  /** 该根中心 x（px） */
  x: number
  /** 该根收盘价 y（主图坐标系，px） */
  y: number
}

export interface CrosshairProps {
  point: CrosshairPoint
  active?: boolean
  top: number
  bottom: number
  left: number
  right: number
  axisY?: number
  timeText?: string
  priceText?: string
}

export function Crosshair({
  point,
  active = true,
  top,
  bottom,
  left,
  right,
  axisY,
  timeText,
  priceText,
}: CrosshairProps) {
  // X轴时间胶囊尺寸与内缩边界判断（杜绝裁切）
  const timeBadgeW = 56
  const timeBadgeH = 15
  const clampedX = Math.max(left + timeBadgeW / 2, Math.min(right - timeBadgeW / 2, point.x))
  const timeBadgeY = (axisY ?? bottom) - 1

  // Y轴价格胶囊尺寸与内缩边界判断（杜绝裁切）
  const priceBadgeW = 54
  const priceBadgeH = 15
  const clampedY = Math.max(top + priceBadgeH / 2, Math.min(bottom - priceBadgeH / 2, point.y))
  const priceBadgeX = right + 2

  return (
    <g className={`ex-crosshair${active ? ' is-active' : ''}`} aria-hidden="true">
      <line x1={point.x} x2={point.x} y1={top} y2={bottom} className="ex-crosshair-line" />
      <line x1={left} x2={right} y1={point.y} y2={point.y} className="ex-crosshair-line" />
      <circle cx={point.x} cy={point.y} r={3} className="ex-crosshair-dot" />

      {/* X轴底部时间胶囊 */}
      {timeText ? (
        <g className="ex-axis-pill ex-axis-pill-time">
          <rect
            x={clampedX - timeBadgeW / 2}
            y={timeBadgeY}
            width={timeBadgeW}
            height={timeBadgeH}
            rx={2}
            className="ex-axis-pill-bg"
          />
          <text
            x={clampedX}
            y={timeBadgeY + 11}
            textAnchor="middle"
            className="ex-axis-pill-text"
          >
            {timeText}
          </text>
        </g>
      ) : null}

      {/* Y轴右侧价格胶囊 */}
      {priceText ? (
        <g className="ex-axis-pill ex-axis-pill-price">
          <rect
            x={priceBadgeX}
            y={clampedY - priceBadgeH / 2}
            width={priceBadgeW}
            height={priceBadgeH}
            rx={2}
            className="ex-axis-pill-bg"
          />
          <text
            x={priceBadgeX + priceBadgeW / 2}
            y={clampedY + 4}
            textAnchor="middle"
            className="ex-axis-pill-text"
          >
            {priceText}
          </text>
        </g>
      ) : null}
    </g>
  )
}

/** 悬停提示内容（交给 `ui/Tooltip` 的富内容路径） */
export function crosshairTipContent({
  bars,
  point,
  period,
  ma5,
  ma20,
  rsiValue,
  avg,
}: {
  bars: readonly Kline[]
  point: CrosshairPoint
  period: ChartPeriod
  ma5: ReadonlyArray<number | null>
  ma20: ReadonlyArray<number | null>
  rsiValue: ReadonlyArray<number | null>
  avg: ReadonlyArray<number> | null
}): ReactNode {
  const b = bars[point.index]
  if (!b) return null
  const changePct = b.o > 0 ? ((b.c - b.o) / b.o) * 100 : 0
  const up = b.c >= b.o
  const ma5v = ma5[point.index]
  const ma20v = ma20[point.index]
  const rsiNow = rsiValue[point.index]
  const row = (label: string, value: ReactNode): ReactNode => (
    <>
      <span className="ex-tip-k">{label}</span>
      <span className="ex-tip-v">{value}</span>
    </>
  )
  return (
    <div className="ex-tip">
      <div className="ex-tip-head">
        {chartPeriodSpec(period).tipLabel(b.t)}
        <span className={up ? 'is-up' : 'is-down'}>{pct(changePct)}</span>
      </div>
      <div className="ex-tip-grid">
        {row(T.chartOpen, <b>{price(b.o)}</b>)}
        {row(T.chartHigh, <b>{price(b.h)}</b>)}
        {row(T.chartLow, <b>{price(b.l)}</b>)}
        {row(T.colPrice, <b className={up ? 'is-up' : 'is-down'}>{price(b.c)}</b>)}
        {row(T.chartVolume, <b>{amount(b.v)}</b>)}
        {avg ? row(T.chartAvg, <b>{price(avg[point.index] ?? b.c)}</b>) : null}
        {row(T.chartMa5, <b>{ma5v === null || ma5v === undefined ? '—' : price(ma5v)}</b>)}
        {row(T.chartMa20, <b>{ma20v === null || ma20v === undefined ? '—' : price(ma20v)}</b>)}
        {row(T.chartRsi, <b>{rsiNow === null || rsiNow === undefined ? '—' : rsiNow.toFixed(1)}</b>)}
      </div>
    </div>
  )
}
