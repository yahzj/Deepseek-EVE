/**
 * 极简模式 · 行情图（SimpleChart）。
 *
 * 船长 2026-11-04 核心升级：
 * - 【分时】：10 秒时间轴走势线，按真实最新成交价每拍延伸（无成交即平线，不编造涨跌）；
 * - 【M1 / M5 / H1 / 日线 / 周线】：现代标准 K 线蜡烛图（红涨绿跌、实体影线、开高低收完整刻度）；
 * - 【上下轴自适应比例】：平盘基准 1.5% 视窗保护 + 上下各 12% 呼吸安全区，绝不撑满画布贴边。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartPeriod, ExchangeClient, StockQuote } from '../client'
import { INTRADAY_VIEW_POINTS } from '../chartPeriods'
import { pct, price } from '../format'
import { T } from '../texts'

interface SimpleChartProps {
  client: ExchangeClient
  code: string
  quote?: StockQuote
  tick: number
  /** 全仓下注反馈：卡片边缘黄色光效顺时针旋转 */
  allInFx?: boolean
}

type SimplePeriod = 'intraday' | 'h1'

/** 图表缩放偏好：切页面、重开客户端后仍记得上次停在分时还是小时 K。 */
const CHART_ZOOM_KEY = 'whale-idle:exch-chart-zoom-v1'

function readChartZoom(): { zoom: number; candleLimit: number } {
  if (typeof window === 'undefined') return { zoom: 0, candleLimit: 168 }
  try {
    const raw = window.localStorage.getItem(CHART_ZOOM_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { zoom?: unknown; candleLimit?: unknown }
      const zoom = parsed.zoom === 1 ? 1 : 0
      const candleLimit =
        typeof parsed.candleLimit === 'number'
          ? Math.max(24, Math.min(168, Math.round(parsed.candleLimit)))
          : 168
      return { zoom, candleLimit }
    }
  } catch {
    /* 缓存损坏按分时处理 */
  }
  return { zoom: 0, candleLimit: 168 }
}

export function SimpleChart({ client, code, quote, tick, allInFx = false }: SimpleChartProps) {
  const initialZoom = readChartZoom()
  const [zoom, setZoom] = useState(initialZoom.zoom)
  /** 小时 K 默认直接铺满 7 天（168 根），向上滚逐步放大到 24 根。 */
  const [candleLimit, setCandleLimit] = useState(initialZoom.candleLimit)
  const [pan, setPan] = useState(0)
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [zooming, setZooming] = useState(false)
  const [zoomDir, setZoomDir] = useState<'in' | 'out'>('in')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /** 滚轮累计增量：触控板的小 delta 先攒够再走一级，避免卡顿和一次跳多级。 */
  const wheelAccumRef = useRef(0)

  // 记住缩放级别：切到别的页面再回来、或重开客户端后恢复
  useEffect(() => {
    try {
      window.localStorage.setItem(CHART_ZOOM_KEY, JSON.stringify({ zoom, candleLimit }))
    } catch {
      /* ignore */
    }
  }, [zoom, candleLimit])

  const isCandle = zoom > 0
  const clientPeriod: ChartPeriod = isCandle ? 'h1' : 'intraday'
  const period: SimplePeriod = isCandle ? 'h1' : 'intraday'
  const barLimit = isCandle ? candleLimit : INTRADAY_VIEW_POINTS


  // 切到未缓存的周期时补拉（否则 H1/日线/周线永远空白、M5 预加载失败也不重试）
  useEffect(() => {
    client.ensureChartData?.(code, clientPeriod)
    // 分时图也需要 h1 全历史来确定上下界
    client.ensureChartData?.(code, 'h1')
  }, [client, code, clientPeriod])

  // 滚轮累计增量触发；监听只绑一次，避免缩放重渲染时反复解绑导致丢事件。
  const wheelStateRef = useRef({ isCandle, candleLimit })
  wheelStateRef.current = { isCandle, candleLimit }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      wheelAccumRef.current += e.deltaY
      if (Math.abs(wheelAccumRef.current) < 40) return
      const zoomIn = wheelAccumRef.current > 0
      wheelAccumRef.current = 0
      const { isCandle: candleNow, candleLimit: limitNow } = wheelStateRef.current
      if (!candleNow) {
        if (!zoomIn) return
        setZoomDir('in')
        setZooming(true)
        setPan(0)
        setCandleLimit(168)
        setZoom(1)
        window.setTimeout(() => setZooming(false), 900)
        return
      }
      if (zoomIn && limitNow < 168) {
        setCandleLimit(Math.min(168, limitNow + 48))
        setPan(0)
        return
      }
      if (!zoomIn) {
        // 默认 168 或已放大到 24：滚一格直接回分时；只有主动放大过才逐级。
        if (limitNow < 168 && limitNow > 24) {
          setCandleLimit(Math.max(24, limitNow - 48))
          setPan(0)
          return
        }
        setZoomDir('out')
        setZooming(true)
        setPan(0)
        // 先让蜡烛收拢回收盘价，再切回分时，避免瞬间消失。
        window.setTimeout(() => {
          setZoom(0)
          window.setTimeout(() => setZooming(false), 500)
        }, 260)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const series = useMemo(() => {
    try {
      return client.getChartSeries(code, clientPeriod) ?? []
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, code, clientPeriod, tick])

  /** 全历史最高/最低：分时和 K 线共用同一个上下界，按历史比例显示。 */
  const historyHiLo = useMemo(() => {
    try {
      const bars = client.getChartSeries(code, 'h1')
      if (!Array.isArray(bars) || bars.length === 0) return null
      let hi = -Infinity
      let lo = Infinity
      for (const bar of bars) {
        if (bar.h > hi) hi = bar.h
        if (bar.l > 0 && bar.l < lo) lo = bar.l
      }
      return hi > 0 && lo > 0 && hi >= lo ? { hi, lo } : null
    } catch {
      return null
    }
  }, [client, code, tick])

  // 拖动查看历史：pan = 从最新一根往前偏移的根数
  const visibleSeries = useMemo(() => {
    const end = Math.max(0, series.length - pan)
    const start = Math.max(0, end - barLimit)
    return series.slice(start, end)
  }, [series, pan, barLimit])

  // 空图时按时间推进进度（0→92%，加载完成即消失）：让玩家看到「行情初始化 42%」而不是干等；
  // 12 秒仍无数据就停表改「暂无行情」，不再空转定时器（子代理 review 2026-11-04 建议 6）。
  const ready = series.length >= 2
  const [loadPct, setLoadPct] = useState(0)
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (ready) {
      setLoadPct(100)
      setStalled(false)
      return
    }
    setLoadPct(4)
    setStalled(false)
    const timer = window.setInterval(() => {
      setLoadPct((p) => Math.min(92, p + Math.max(1, Math.round((92 - p) * 0.07))))
    }, 160)
    const guard = window.setTimeout(() => {
      window.clearInterval(timer)
      setStalled(true)
    }, 12_000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(guard)
    }
  }, [ready, code])

  // SVG 视口尺寸
  const width = 640
  const height = 150
  const padX = 14
  const padY = 14
  // 右侧留约 4 个背景网格，让最新数据不贴边
  const rightGap = 96
  const usableW = width - padX * 2 - rightGap
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
      const bars = visibleSeries.slice(-barLimit)
      if (bars.length === 0) {
        return { minP: 0, maxP: 0, coords: [], candleBars: [], points: [], pathLine: '', pathArea: '' }
      }

      const values = bars.map((b) => b.c)
      const rawHi = bars.reduce((m, b) => Math.max(m, b.h), bars[0]!.h)
      const rawLo = bars.reduce((m, b) => Math.min(m, b.l), bars[0]!.l)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
      const std = Math.sqrt(variance)
      const center = (rawHi + rawLo) / 2
      // 波动率自适应：至少覆盖 ±3σ，且不低于 0.3% 价格视窗，避免单根极值撑大或压扁
      const baseSpan = Math.max(rawHi - rawLo, std * 6, mean * 0.003, 1)
      const pad = baseSpan * 0.06
      const maxP = center + baseSpan / 2 + pad
      const minP = Math.max(0, center - baseSpan / 2 - pad)
      const span = Math.max(1e-4, maxP - minP)

      const yOf = (p: number) => padY + (1 - (p - minP) / span) * usableH
      const slot = usableW / bars.length
      const candleW = Math.max(2, Math.min(10, slot * 0.7))

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
          yC: yOf(b.c),
          formattedTime: formatPeriodTime(b.t, period),
        }
      })

      const coords = candleBars.map((c) => [c.cx, c.top] as [number, number])
      return { minP, maxP, coords, candleBars, points: [], pathLine: '', pathArea: '' }
    } else {
      // 分时折线模式（10 秒高频走势，取最近 INTRADAY_VIEW_POINTS 点 ≈ 20 分钟，与左栏小图同窗口）
      const sample = visibleSeries.slice(-barLimit)
      if (sample.length < 2) {
        return { minP: 0, maxP: 0, coords: [], candleBars: [], points: [], pathLine: '', pathArea: '' }
      }

      const points = sample.map((k) => ({
        t: k.t,
        p: k.c,
        formattedTime: formatPeriodTime(k.t, period),
      }))

      const values = points.map((p) => p.p)
      const rawHi = Math.max(...values)
      const rawLo = Math.min(...values)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
      const std = Math.sqrt(variance)
      const center = (rawHi + rawLo) / 2
      // 波动率自适应：至少覆盖 ±3σ，且不低于 0.3% 价格视窗
      const baseSpan = Math.max(rawHi - rawLo, std * 6, mean * 0.003, 1)
      const pad = baseSpan * 0.12
      const maxP = center + baseSpan / 2 + pad
      const minP = Math.max(0, center - baseSpan / 2 - pad)
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
  }, [visibleSeries, isCandle, barLimit, historyHiLo, usableW, usableH, padX, padY, height, period])

  const { minP, maxP, coords, candleBars, points, pathLine, pathArea } = chartData

  // 悬停数据提取
  const curPrice = quote?.price ?? (series[series.length - 1]?.c ?? 0)
  const isUp = (quote?.changePct ?? 0) >= 0
  const liveY = maxP > minP ? padY + (1 - (curPrice - minP) / (maxP - minP)) * usableH : height / 2

  // 盘口押注比例：买盘/卖盘挂单量占比
  const book = client.getSnapshot(code).book
  const bidVol = book.bids.reduce((sum, level) => sum + level.qty, 0)
  const askVol = book.asks.reduce((sum, level) => sum + level.qty, 0)
  const depthTotal = bidVol + askVol
  const bidPct = depthTotal > 0 ? Math.round((bidVol / depthTotal) * 100) : 50

  const activeCandle = isCandle && hoverIndex !== null && candleBars[hoverIndex] ? candleBars[hoverIndex] : null
  const activePoint = !isCandle && hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null

  const displayPrice = activeCandle ? activeCandle.bar.c : activePoint ? activePoint.p : curPrice
  const displayTime = activeCandle ? activeCandle.formattedTime : activePoint ? activePoint.formattedTime : '实时'

  const strokeColor = isUp ? 'rgb(var(--wui-tone-gain))' : 'rgb(var(--wui-tone-loss))'
  const gradId = `ex-simple-grad-${code}`

  return (
    <div className={`ex-simple-chart-card${allInFx ? ' is-allin' : ''}`}>
      {allInFx ? (
        <div className="ex-allin-glow" aria-hidden="true">
          <div className="ex-allin-glow-beam" />
        </div>
      ) : null}
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
          {historyHiLo ? (
            <span className="ex-simple-history-range ex-dim">
              {T.historyHigh} {price(historyHiLo.hi)} / {T.historyLow} {price(historyHiLo.lo)}
            </span>
          ) : null}
        </div>

        <div className="ex-simple-chart-side">
          <span className="ex-simple-depth is-bid">{T.buySide} {bidPct}%</span>
          <span className="ex-simple-depth is-ask">{T.sellSide} {100 - bidPct}%</span>
          <span className="ex-simple-chart-badge" title={zoom === 0 ? T.tipIntraday : T.tipZoom}>
            {zoom === 0 ? T.simpleIntradayTag : T.zoomDay}
          </span>
        </div>
      </div>

      <div
        ref={wrapRef}
        className={`ex-simple-svg-wrap${zooming ? ` is-zooming is-zoom-${zoomDir}` : ''}`}
        onPointerDown={(e) => {
          if (series.length <= barLimit) return
          e.preventDefault()
          dragRef.current = { startX: e.clientX, startPan: pan }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (dragRef.current === null) return
          const rect = e.currentTarget.getBoundingClientRect()
          if (rect.width <= 0) return
          const perBar = rect.width / Math.max(1, visibleSeries.length)
          const delta = Math.round((e.clientX - dragRef.current.startX) / perBar)
          const maxPan = Math.max(0, series.length - barLimit)
          setPan(Math.max(0, Math.min(maxPan, dragRef.current.startPan + delta)))
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          if (dragRef.current !== null || coords.length === 0) return
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
        {isCandle && minP > 0 ? (
          <div className="ex-simple-live-label" style={{ top: `${(liveY / height) * 100}%` }}>
            {price(curPrice)}
          </div>
        ) : null}
        {coords.length < 2 ? (
          <div className="ex-simple-chart-empty">
            {stalled ? (
              <>
                <span className="ex-dim">{T.dataEmptyHint}</span>
                <button
                  type="button"
                  className="app-btn is-small ex-simple-chart-retry"
                  onClick={() => { void client.ensureChartData?.(code, clientPeriod) }}
                >
                  {T.dataRetry}
                </button>
              </>
            ) : `${T.chartLoading} ${loadPct}%`}
          </div>
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
                  top: `${(coords[hoverIndex][1] / height) * 100}%`,
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
                x2={width - padX}
                y2={padY}
                stroke="rgb(var(--wui-border))"
                strokeWidth="0.8"
                strokeDasharray="4 4"
              />
              <line
                x1={padX}
                y1={height - padY}
                x2={width - padX}
                y2={height - padY}
                stroke="rgb(var(--wui-border))"
                strokeWidth="0.8"
                strokeDasharray="4 4"
              />

              {isCandle ? (
                /* K 线蜡烛图模式 */
                <g>
                <g className="ex-simple-candles">
                  {candleBars.map((c, i) => (
                    <g
                      key={`${c.bar.t}-${i}`}
                      className={`ex-simple-candle ${c.isUp ? 'is-up' : 'is-down'}${i === candleBars.length - 1 ? ' is-live' : ''}`}
                      style={{
                        animationDelay: `${i * 2}ms`,
                        transformBox: 'view-box',
                        transformOrigin: `${c.cx}px ${c.yC}px`,
                      }}
                    >
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
                <g className="ex-simple-live-line">
                  <line x1={padX} y1={liveY} x2={width - padX} y2={liveY} />
                </g>
                </g>
              ) : (
                /* 分时折线面积模式 */
                <>
                  <path d={pathArea} className="ex-simple-path-area" fill={`url(#${gradId})`} />
                  <path
                    d={pathLine}
                    className="ex-simple-path-line"
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

function formatPeriodTime(ts: number, period: ChartPeriod): string {
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
