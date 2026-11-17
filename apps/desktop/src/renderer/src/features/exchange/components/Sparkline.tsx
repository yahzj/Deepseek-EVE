import type { ExchangeClient } from '../client'
import { INTRADAY_VIEW_POINTS } from '../chartPeriods'

interface SparklineProps {
  client: ExchangeClient
  code: string
  isUp: boolean
  width?: number
  height?: number
}

export function Sparkline({ client, code, isUp, width = 76, height = 24 }: SparklineProps) {
  let points: number[] = []
  try {
    const series = client.getChartSeries(code, 'intraday')
    if (series && series.length > 0) {
      points = series.slice(-INTRADAY_VIEW_POINTS).map((k) => k.c)
    }
  } catch {
    points = []
  }

  if (points.length < 2) {
    try {
      const m1Series = client.getChartSeries(code, 'm1')
      if (m1Series && m1Series.length > 0) {
        points = m1Series.slice(-Math.ceil(INTRADAY_VIEW_POINTS / 6)).map((k) => k.c)
      }
    } catch {
    }
  }

  if (points.length < 2) {
    return <div className="ex-sparkline-empty" style={{ width, height }} />
  }

  const rawHi = Math.max(...points)
  const rawLo = Math.min(...points)
  const mid = (rawHi + rawLo) / 2
  const minSpan = Math.max(1, mid * 0.015)
  const effectiveSpan = Math.max(rawHi - rawLo, minSpan)
  const pad = effectiveSpan * 0.12
  const maxP = rawHi + pad
  const minP = Math.max(0, rawLo - pad)
  const span = Math.max(1e-4, maxP - minP)

  const paddingY = 2
  const usableH = height - paddingY * 2
  const stepX = width / (points.length - 1)
  const yOf = (val: number): number => paddingY + (1 - (val - minP) / span) * usableH

  const coords = points.map((val, i) => [i * stepX, yOf(val)] as [number, number])

  const linePath = coords.reduce((acc, [x, y], i) => `${acc} ${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`, '')
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`

  const strokeColor = isUp ? 'rgb(var(--wui-tone-gain))' : 'rgb(var(--wui-tone-loss))'
  const gradId = `ex-spark-grad-${code}`

  return (
    <svg
      className="ex-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
