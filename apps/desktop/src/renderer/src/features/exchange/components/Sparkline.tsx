/**
 * 极简迷你走势折线（Sparkline）。
 *
 * 用于左栏企业卡片：与中栏大图（SimpleChart）同窗口（最近约 20 分钟）、
 * 同一套自适应纵轴比例，按卡片尺寸缩小的分时走势。
 */
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
  // 直接读缓存：父组件每次行情 tick 都会重渲染，这里不能再 useMemo 锁死
  // （否则第一次拿到空数组后永远不重算，小曲线就「消失」了——2026-11-04 船长反馈）。
  let points: number[] = []
  try {
    const series = client.getChartSeries(code, 'intraday')
    if (series && series.length > 0) {
      // 与中栏大图（SimpleChart）共用同一显示窗口：最近 INTRADAY_VIEW_POINTS 个 10 秒点 ≈ 20 分钟
      points = series.slice(-INTRADAY_VIEW_POINTS).map((k) => k.c)
    }
  } catch {
    points = []
  }

  // 优雅降级：分时尚未累积足够高频点时，回退 m1 覆盖相同的约 20 分钟（6 个 10 秒点 = 1 分钟），
  // 保障专业/极简终端均秒级出图。
  if (points.length < 2) {
    try {
      const m1Series = client.getChartSeries(code, 'm1')
      if (m1Series && m1Series.length > 0) {
        points = m1Series.slice(-Math.ceil(INTRADAY_VIEW_POINTS / 6)).map((k) => k.c)
      }
    } catch {
      // ignore
    }
  }

  if (points.length < 2) {
    return <div className="ex-sparkline-empty" style={{ width, height }} />
  }

  const rawHi = Math.max(...points)
  const rawLo = Math.min(...points)
  const mid = (rawHi + rawLo) / 2
  // 与大图（SimpleChart）完全同一套自适应比例：平盘至少 1.5% 视窗 + 上下各 12% 呼吸区，
  // 保证同一时刻小图与大图形状一致，只是画布按卡片尺寸缩小。
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

  // 构造与大图同样形状的折线
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
