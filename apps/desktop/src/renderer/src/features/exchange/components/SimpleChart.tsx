/**
 * 极简模式 · 平滑流光渐变面积图（SimpleChart）。
 *
 * 专为放置游戏玩家打造：
 * - 【分时 (实时)】、【日走势 (24小时)】、【历史周线 (7天)】3 个通俗大按钮；
 * - 发光平滑渐变面积曲线，最高/最低参考刻度线；
 * - 鼠标划过实时呈现十字虚线与精确价格读数；
 * - 紧凑高度，保障交易舱与持仓一屏可见。
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

type SimplePeriod = 'm1' | 'm5' | 'h5' | 'd5' | 'd35'

const PERIOD_LABELS: Record<SimplePeriod, string> = {
  m1: 'M1',
  m5: 'M5',
  h5: 'H5',
  d5: 'D5',
  d35: 'D35',
}

const SIMPLE_PERIODS: SimplePeriod[] = ['m1', 'm5', 'h5', 'd5', 'd35']

export function SimpleChart({ client, code, quote, tick }: SimpleChartProps) {
  const [period, setPeriod] = useState<SimplePeriod>('m1')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // 周期即 client 周期（2026-11-04 船长：分时图改为 M1/M5/H5/D5/D35）
  const clientPeriod: ChartPeriod = period

  const series = useMemo(() => {
    try {
      return client.getChartSeries(code, clientPeriod) ?? []
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, code, clientPeriod, tick])

  // 提取价格序列
  const points = useMemo(() => {
    if (series.length === 0) return []
    const sample = series.slice(-60)
    return sample.map((k) => ({
      t: k.t,
      p: k.c,
      formattedTime: formatPeriodTime(k.t, period),
    }))
  }, [series, period])

  const curPrice = quote?.price ?? (points[points.length - 1]?.p ?? 0)
  const isUp = (quote?.changePct ?? 0) >= 0

  // 悬停态数据
  const activePoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null
  const displayPrice = activePoint ? activePoint.p : curPrice
  const displayTime = activePoint ? activePoint.formattedTime : '实时'

  // SVG 视口尺寸
  const width = 640
  const height = 150
  const padX = 14
  const padY = 14
  const usableW = width - padX * 2
  const usableH = height - padY * 2

  const { pathLine, pathArea, coords, minP, maxP } = useMemo(() => {
    if (points.length < 2) {
      return { pathLine: '', pathArea: '', coords: [], minP: 0, maxP: 0 }
    }
    const min = Math.min(...points.map((p) => p.p))
    const max = Math.max(...points.map((p) => p.p))
    const isFlat = max === min
    const span = isFlat ? 1 : max - min
    const stepX = usableW / (points.length - 1)

    const cs = points.map((pt, i) => {
      const x = padX + i * stepX
      const y = isFlat ? height / 2 : height - padY - ((pt.p - min) / span) * usableH
      return [x, y] as [number, number]
    })

    const line = cs.reduce((acc, [x, y], i) => `${acc} ${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`, '')
    const area = `${line} L ${(padX + usableW).toFixed(1)},${height} L ${padX.toFixed(1)},${height} Z`
    return { pathLine: line, pathArea: area, coords: cs, minP: min, maxP: max }
  }, [points, usableW, usableH, padX, padY, height])

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
          <span className="ex-simple-chart-time ex-dim">时间: {displayTime}</span>
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
          // 物理屏幕坐标转换为 SVG viewBox 视口坐标（消除屏幕宽度与 viewBox 尺寸差异导致的映射漂移）
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
        {points.length < 2 ? (
          <div className="ex-simple-chart-empty">{T.chartNoData}</div>
        ) : (
          <>
            {/* 顶底参考刻度（HTML 排版，不受 SVG preserveAspectRatio="none" 导致的字体横向形变影响） */}
            <div className="ex-simple-axis-badge is-max ex-num">{price(maxP)}</div>
            <div className="ex-simple-axis-badge is-min ex-num">{price(minP)}</div>

            {/* 悬停光标微型读数胶囊（就近显示，缩短视线跳跃） */}
            {hoverIndex !== null && coords[hoverIndex] && activePoint ? (
              <div
                className={`ex-simple-cursor-bubble ex-num${coords[hoverIndex][1] < 45 ? ' is-flip' : ''}`}
                style={{
                  left: `${(coords[hoverIndex][0] / width) * 100}%`,
                  top: `${coords[hoverIndex][1]}px`,
                }}
              >
                <span className="ex-bubble-price">{price(activePoint.p)}</span>
                <span className="ex-bubble-time">{activePoint.formattedTime}</span>
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

              {/* 背景发光渐变区域 */}
              <path d={pathArea} fill={`url(#${gradId})`} />

              {/* 主曲线 */}
              <path
                d={pathLine}
                fill="none"
                stroke={strokeColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

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
  if (period === 'm1' || period === 'm5') {
    return `${hh}:${mm}`
  }
  const mon = d.getMonth() + 1
  const day = d.getDate()
  if (period === 'h5') {
    return `${mon}/${day} ${hh}:00`
  }
  if (period === 'd5') {
    return `${mon}月${day}日`
  }
  return `${d.getFullYear()}/${mon}/${day}`
}
