/**
 * 极简迷你走势折线（Sparkline）。
 *
 * 用于左栏企业卡片，提取近期分时价格走势，以 SVG 微光折线呈现。
 */
import type { ExchangeClient } from '../client'

interface SparklineProps {
  client: ExchangeClient
  code: string
  isUp: boolean
  width?: number
  height?: number
}

export function Sparkline({ client, code, isUp, width = 76, height = 24 }: SparklineProps) {
  // 直接读缓存：父组件每次行情 tick 都会重渲染，这里不能再 useMemo 锁死
  // （否则第一次拿到空数组后永远不重算，小曲线就「消失」了——2026-11-04 船长反馈）。
  let points: number[] = []
  try {
    const series = client.getChartSeries(code, 'intraday')
    if (series && series.length > 0) {
      // 取最近 24 根采样点
      points = series.slice(-24).map((k) => k.c)
    }
  } catch {
    points = []
  }

  // 优雅降级：若 intraday 尚未累积足够高频点，自动回退到 m1 周期切片，保障专业/极简终端均秒级出图
  if (points.length < 2) {
    try {
      const m1Series = client.getChartSeries(code, 'm1')
      if (m1Series && m1Series.length > 0) {
        points = m1Series.slice(-24).map((k) => k.c)
      }
    } catch {
      // ignore
    }
  }

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
