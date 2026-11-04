/**
 * 极简模式 · 行情图（SimpleChart）。
 *
 * 船长 2026-11-04 核心升级：
 * - 【分时】：独立 10 秒高频流光平滑走势折线（与后端 10 秒微步游走实时对应）；
 * - 【M1 / M5 / H1 / 日线 / 周线】：现代标准 K 线蜡烛图（红涨绿跌、实体影线、开高低收完整刻度）；
 * - 【上下轴自适应比例】：平盘基准 1.5% 视窗保护 + 上下各 12% 呼吸安全区，绝不撑满画布贴边。
 */
import { useMemo, useState } from 'react'
import type { ChartPeriod, ExchangeClient, StockQuote } from '../client'
import { pct, price } from '../format'
import { T } from '../texts'

interface SimpleChartProps {
  client: ExchangeClient
  code: string
  quote?: StockQuote
  tick: number
}

type SimplePeriod = 'intraday' | 'm1' | 'm5' | 'h1' | 'd1' | 'd7'

const PERIOD_LABELS: Record<SimplePeriod, string> = {
  intraday: '分时',
  m1: 'M1',
  m5: 'M5',
  h1: 'H1',
  d1: '日线',
  d7: '周线',
}

const SIMPLE_PERIODS: SimplePeriod[] = ['intraday', 'm1', 'm5', 'h1', 'd1', 'd7']

export function SimpleChart({ client, code, quote, tick }: SimpleChartProps) {
  const [period, setPeriod] = useState<SimplePeriod>('intraday')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const isCandle = period !== 'intraday'
  const clientPeriod: ChartPeriod = period

  const series = useMemo(() => {
    try {
      return client.getChartSeries(code, clientPeriod) ?? []
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, code, clientPeriod, tick])

  // SVG 视口尺寸
  const width = 640
  const height = 150
  const padX = 14
  const padY = 14
  const usableW = width - padX * 2
  const usableH = height - padY * 2

  // 计算几何与坐标映射（包含平盘保护与 12% 呼吸区自动比例）
  const chartData = useMemo(() => {
    if (series.length === 0) {
      return {
        minP: 0,
        maxP: 0,
        coords: [],
        candleBars: [],
        points: [],
        pathLine: '',
        pathArea: '',
      }
    }

    if (isCandle) {
      // K 线蜡烛图模式（显示最近 40 根）
      const bars = series.slice(-40)
      if (bars.length === 0) {
        return { minP: 0, maxP: 0, coords: [], candleBars: [], points: [], pathLine: '', pathArea: '' }
      }

      const rawHi = bars.reduce((m, b) => Math.max(m, b.h), bars[0]!.h)
      const rawLo = bars.reduce((m, b) => Math.min(m, b.l), bars[0]!.l)
      const mid = (rawHi + rawLo) / 2
      // 船长自适应算法：平盘 1.5% 视窗保底，上下各 12% 呼吸区
      const minSpan = Math.max(1, mid * 0.015)
      const effectiveSpan = Math.max(rawHi - rawLo, minSpan)
      const pad = effectiveSpan * 0.12
      const maxP = rawHi + pad
      const minP = Math.max(0, rawLo - pad)
      const span = Math.max(1e-4, maxP - minP)

      const yOf = (p: number) => padY + (1 - (p - minP) / span) * usableH
      const slot = usableW / bars.length
      const candleW = Math.max(3, Math.min(10, slot * 0.65))

      const candleBars = bars.map((b, i) => {
        const cx = padX + slot * (i + 0.5)
        const yO = yOf(b.o)
        const yC = yOf(b.c)
        const yH = yOf(b.h)
        const yL = yOf(b.l)
        const top = Math.min(yO, yC)
        const bot = Math.max(yO, yC)
        const isUp = b.c >= b.o
        return {
          bar: b,
          cx,
          yH,
          yL,
          top,
          height: Math.max(1.5, bot - top),
          isUp,
          width: candleW,
          formattedTime: formatPeriodTime(b.t, period),
        }
      })

      const coords = candleBars.map((c) => [c.cx, c.top] as [number, number])
      return { minP, maxP, coords, candleBars, points: [], pathLine: '', pathArea: '' }
    } else {
      // 分时折线模式（10 秒高频走势，最多取最近 120 点）
      const sample = series.slice(-120)
      if (sample.length < 2) {
        return { minP: 0, maxP: 0, coords: [], candleBars: [], points: [], pathLine: '', pathArea: '' }
      }

      const points = sample.map((k) => ({
        t: k.t,
        p: k.c,
        formattedTime: formatPeriodTime(k.t, period),
      }))

      const rawHi = Math.max(...points.map((p) => p.p))
      const rawLo = Math.min(...points.map((p) => p.p))
      const mid = (rawHi + rawLo) / 2
      const minSpan = Math.max(1, mid * 0.015)
      const effectiveSpan = Math.max(rawHi - rawLo, minSpan)
      const pad = effectiveSpan * 0.12
      const maxP = rawHi + pad
      const minP = Math.max(0, rawLo - pad)
      const span = Math.max(1e-4, maxP - minP)

      const yOf = (p: number) => padY + (1 - (p - minP) / span) * usableH
      const stepX = usableW / (points.length - 1)
      const cs = points.map((pt, i) => {
        const x = padX + i * stepX
        const y = yOf(pt.p)
        return [x, y] as [number, number]
      })

      const line = cs.reduce((acc, [x, y], i) => `${acc} ${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`, '')
      const area = `${line} L ${(padX + usableW).toFixed(1)},${height} L ${padX.toFixed(1)},${height} Z`
      return { minP, maxP, coords: cs, candleBars: [], points, pathLine: line, pathArea: area }
    }
  }, [series, isCandle, usableW, usableH, padX, padY, height, period])

  const { minP, maxP, coords, candleBars, points, pathLine, pathArea } = chartData

  // 悬停数据提取
  const curPrice = quote?.price ?? (series[series.length - 1]?.c ?? 0)
  const isUp = (quote?.changePct ?? 0) >= 0

  const activeCandle = isCandle && hoverIndex !== null && candleBars[hoverIndex] ? candleBars[hoverIndex] : null
  const activePoint = !isCandle && hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null

  const displayPrice = activeCandle ? activeCandle.bar.c : activePoint ? activePoint.p : curPrice
  const displayTime = activeCandle ? activeCandle.formattedTime : activePoint ? activePoint.formattedTime : '实时'

  const strokeColor = isUp ? 'rgb(var(--wui-tone-gain))' : 'rgb(var(--wui-tone-loss))'
  const gradId = `ex-simple-grad-${code}`

  return (
    <div className="ex-simple-chart-card">
      <div className="ex-simple-chart-top">
        <div className="ex-simple-chart-hud">
          <div className="ex-simple-chart-price ex-num">
            {price(displayPrice)}
            <span className={`ex-simple-chart-tag ex-num ${isUp ? 'is-up' : 'is-down'}`}>
              {quote ? pct(quote.changePct) : '—'}
            </span>
          </div>
          {activeCandle ? (
            <span className="ex-simple-chart-ohlc ex-dim">
              开: {price(activeCandle.bar.o)} 高: {price(activeCandle.bar.h)} 低: {price(activeCandle.bar.l)} 收: {price(activeCandle.bar.c)}
            </span>
          ) : (
            <span className="ex-simple-chart-time ex-dim">时间: {displayTime}</span>
          )}
        </div>

        {/* 周期切换按钮组 */}
        <div className="ex-simple-chart-periods" role="tablist">
          {SIMPLE_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              className={`ex-simple-period-btn${period === p ? ' is-on' : ''}`}
              onClick={() => {
                setPeriod(p)
                setHoverIndex(null)
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div
        className="ex-simple-svg-wrap"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          if (coords.length === 0) return
          const rect = e.currentTarget.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          const svgX = ((e.clientX - rect.left) / rect.width) * width
          const ratio = Math.max(0, Math.min(1, (svgX - padX) / usableW))
          const idx = Math.round(ratio * (coords.length - 1))
          setHoverIndex(idx)
        }}
        onTouchMove={(e) => {
          if (coords.length === 0) return
          const touch = e.touches[0]
          if (!touch) return
          const rect = e.currentTarget.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          const svgX = ((touch.clientX - rect.left) / rect.width) * width
          const ratio = Math.max(0, Math.min(1, (svgX - padX) / usableW))
          const idx = Math.round(ratio * (coords.length - 1))
          setHoverIndex(idx)
        }}
        onTouchEnd={() => setHoverIndex(null)}
      >
        {coords.length < 2 ? (
          <div className="ex-simple-chart-empty">{T.chartNoData}</div>
        ) : (
          <>
            {/* 顶底参考刻度（平盘保护与 12% 呼吸区自动比例） */}
            <div className="ex-simple-axis-badge is-max ex-num">{price(maxP)}</div>
            <div className="ex-simple-axis-badge is-min ex-num">{price(minP)}</div>

            {/* 悬停光标微型读数胶囊 */}
            {hoverIndex !== null && coords[hoverIndex] ? (
              <div
                className={`ex-simple-cursor-bubble ex-num${coords[hoverIndex][1] < 45 ? ' is-flip' : ''}`}
                style={{
                  left: `${(coords[hoverIndex][0] / width) * 100}%`,
                  top: `${coords[hoverIndex][1]}px`,
                }}
              >
                <span className="ex-bubble-price">{price(displayPrice)}</span>
                <span className="ex-bubble-time">{displayTime}</span>
              </div>
            ) : null}

            <svg className="ex-simple-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* 上下界辅助网格线 */}
              <line
                x1={padX}
                y1={padY}
                x2={padX + usableW}
                y2={padY}
                stroke="rgb(var(--wui-border))"
                strokeWidth="0.8"
                strokeDasharray="4 4"
              />
              <line
                x1={padX}
                y1={height - padY}
                x2={padX + usableW}
                y2={height - padY}
                stroke="rgb(var(--wui-border))"
                strokeWidth="0.8"
                strokeDasharray="4 4"
              />

              {isCandle ? (
                /* K 线蜡烛图模式 */
                <g className="ex-simple-candles">
                  {candleBars.map((c, i) => (
                    <g key={`${c.bar.t}-${i}`} className={`ex-simple-candle ${c.isUp ? 'is-up' : 'is-down'}`}>
                      <line x1={c.cx} x2={c.cx} y1={c.yH} y2={c.yL} className="ex-simple-candle-wick" />
                      <rect
                        x={c.cx - c.width / 2}
                        y={c.top}
                        width={c.width}
                        height={c.height}
                        className="ex-simple-candle-body"
                      />
                    </g>
                  ))}
                </g>
              ) : (
                /* 分时折线面积模式 */
                <>
                  <path d={pathArea} fill={`url(#${gradId})`} />
                  <path
                    d={pathLine}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}

              {/* 悬停竖线与十字光标 */}
              {hoverIndex !== null && coords[hoverIndex] ? (
                <g className="ex-simple-cursor">
                  <line
                    x1={coords[hoverIndex][0]}
                    y1={padY}
                    x2={coords[hoverIndex][0]}
                    y2={height - padY}
                    stroke="rgb(var(--wui-text-dim))"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={coords[hoverIndex][0]}
                    cy={coords[hoverIndex][1]}
                    r="4"
                    fill="rgb(var(--wui-bg-deep))"
                    stroke={strokeColor}
                    strokeWidth="2"
                  />
                </g>
              ) : null}
            </svg>
          </>
        )}
      </div>
    </div>
  )
}

function formatPeriodTime(ts: number, period: SimplePeriod): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  if (period === 'intraday') {
    return `${hh}:${mm}:${ss}`
  }
  if (period === 'm1' || period === 'm5') {
    return `${hh}:${mm}`
  }
  const mon = d.getMonth() + 1
  const day = d.getDate()
  if (period === 'h1') {
    return `${mon}/${day} ${hh}:00`
  }
  if (period === 'd1' || period === 'd7') {
    return `${mon}月${day}日`
  }
  return `${d.getFullYear()}/${mon}/${day}`
}
