/**
 * 极简模式 · 平滑流光渐变面积图（SimpleChart）。
 *
 * 专为放置游戏玩家打造：
 * - 隐藏繁杂的蜡烛线、影线与多指标，只提供【分时 (实时)】、【日走势 (24小时)】、【历史周线 (7天)】3 个通俗大按钮；
 * - 绘制发光平滑渐变面积曲线，随行情涨跌呈现青绿（涨）或朱红（跌）的呼吸微光；
 * - 鼠标/触摸移动时提供十字虚线与浮动价格读数，直观清爽。
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

type SimplePeriod = 'intraday' | 'd1' | 'd7'

const PERIOD_LABELS: Record<SimplePeriod, string> = {
  intraday: '分时',
  d1: '日走势',
  d7: '周线',
}

export function SimpleChart({ client, code, quote, tick }: SimpleChartProps) {
  const [period, setPeriod] = useState<SimplePeriod>('intraday')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // 映射周期参数至 client 接口
  const clientPeriod: ChartPeriod = period === 'intraday' ? 'intraday' : period === 'd1' ? 'd1' : 'd7'

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
    // 截取最多 60 个点保持线条平滑
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
  const height = 240
  const padX = 12
  const padY = 24
  const usableW = width - padX * 2
  const usableH = height - padY * 2

  const { pathLine, pathArea, coords } = useMemo(() => {
    if (points.length < 2) return { pathLine: '', pathArea: '', coords: [] }
    const minP = Math.min(...points.map((p) => p.p))
    const maxP = Math.max(...points.map((p) => p.p))
    const span = maxP - minP || 1
    const stepX = usableW / (points.length - 1)

    const cs = points.map((pt, i) => {
      const x = padX + i * stepX
      const y = height - padY - ((pt.p - minP) / span) * usableH
      return [x, y] as [number, number]
    })

    const line = cs.reduce((acc, [x, y], i) => `${acc} ${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`, '')
    const area = `${line} L ${padX + usableW},${height - 4} L ${padX},${height - 4} Z`
    return { pathLine: line, pathArea: area, coords: cs }
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

        <div className="ex-simple-periods" role="tablist">
          {(['intraday', 'd1', 'd7'] as SimplePeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`ex-simple-period-btn${period === p ? ' is-active' : ''}`}
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
          const relX = e.clientX - rect.left
          const ratio = Math.max(0, Math.min(1, (relX - padX) / usableW))
          const idx = Math.round(ratio * (coords.length - 1))
          setHoverIndex(idx)
        }}
      >
        {points.length < 2 ? (
          <div className="ex-simple-chart-empty">{T.chartNoData}</div>
        ) : (
          <svg className="ex-simple-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.32" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* 背景发光渐变区域 */}
            <path d={pathArea} fill={`url(#${gradId})`} />

            {/* 主曲线 */}
            <path
              d={pathLine}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.2"
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
        )}
      </div>
    </div>
  )
}

function formatPeriodTime(ts: number, period: SimplePeriod): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (period === 'intraday') {
    return `${hh}:${mm}`
  }
  const mon = d.getMonth() + 1
  const day = d.getDate()
  if (period === 'd1') {
    return `${mon}/${day} ${hh}:${mm}`
  }
  return `${mon}月${day}日`
}

