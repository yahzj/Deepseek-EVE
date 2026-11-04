/**
 * 极简迷你走势折线（Sparkline）。
 *
 * 用于左栏企业卡片，提取近期分时价格走势，以 SVG 微光折线呈现。
 */
import { useMemo } from 'react'
import type { ExchangeClient } from '../client'

interface SparklineProps {
  client: ExchangeClient
  code: string
  isUp: boolean
  width?: number
  height?: number
}

export function Sparkline({ client, code, isUp, width = 76, height = 24 }: SparklineProps) {
  const points = useMemo(() => {
    try {
      const series = client.getChartSeries(code, 'intraday')
      if (!series || series.length === 0) return []
      // 取最近 24 根采样点
      const sample = series.slice(-24)
      return sample.map((k) => k.c)
    } catch {
      return []
    }
  }, [client, code])

  if (points.length < 2) {
    return <div className="ex-sparkline-empty" style={{ width, height }} />
  }

  const min = Math.min(...points)
  const max = Math.max(...points)
  const isFlat = max === min
  const span = isFlat ? 1 : max - min

  const paddingY = 2
  const usableH = height - paddingY * 2
  const stepX = width / (points.length - 1)

  const coords = points.map((val, i) => {
    const x = i * stepX
    const y = isFlat ? height / 2 : height - paddingY - ((val - min) / span) * usableH
    return [x, y] as [number, number]
  })

  // 构造光滑或紧凑折线
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
