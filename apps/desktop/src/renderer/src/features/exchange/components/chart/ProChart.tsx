import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dispose, init, type Chart as KChart, type KLineData, type PaneOptions, type Period } from 'klinecharts'
import type { ChartPeriod, ExchangeClient, Kline, StockQuote } from '../../client'
import { PRO_CHART_PERIODS, chartPeriodSpec } from '../../chartPeriods'
import { amount, price } from '../../format'
import { T } from '../../texts'
import { isEn } from '../../../../i18n/locale'
import { bollinger, rsi } from './indicators'
import { EXCH_PREF, readExchangeChoice, readExchangeToggles, writeExchangePref, writeExchangeToggles } from '../../viewPrefs'

let rememberedPeriod: ChartPeriod = readExchangeChoice(
  EXCH_PREF.chartPeriod,
  PRO_CHART_PERIODS.map((spec) => spec.id),
  'm5',
)
type ChartToggles = { boll: boolean; rsi: boolean; vol: boolean }
let rememberedToggles: ChartToggles = readExchangeToggles<ChartToggles>({
  boll: false,
  rsi: false,
  vol: true,
})

type ToggleKey = keyof typeof rememberedToggles

function themeColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw === '' ? fallback : `rgb(${raw})`
}

function paneList(chart: KChart): PaneOptions[] {
  const panes = chart.getPaneOptions()
  return Array.isArray(panes) ? panes : []
}

function toKPeriod(period: ChartPeriod): Period {
  switch (period) {
    case 'm1':
    case 'intraday':
      return { type: 'minute', span: 1 }
    case 'm5':
      return { type: 'minute', span: 5 }
    case 'h1':
      return { type: 'hour', span: 1 }
    case 'h5':
      return { type: 'hour', span: 5 }
    case 'd1':
      return { type: 'day', span: 1 }
    case 'd5':
      return { type: 'day', span: 5 }
    case 'd7':
      return { type: 'day', span: 7 }
    case 'd30':
      return { type: 'day', span: 30 }
    case 'd35':
      return { type: 'day', span: 35 }
    default:
      return { type: 'minute', span: 1 }
  }
}

const DEFAULT_VIEW_MS = 3 * 86_400_000
function defaultViewBars(period: ChartPeriod): number {
  return Math.max(2, Math.ceil(DEFAULT_VIEW_MS / chartPeriodSpec(period).bucketMs))
}

function defaultBarSpace(plotWidth: number, period: ChartPeriod, barCount: number): number {
  const want = Math.min(defaultViewBars(period), Math.max(2, barCount))
  const width = Math.max(240, plotWidth)
  return Math.min(12, Math.max(1, width / want))
}

function BarTooltip({
  bar,
  period,
  x,
  y,
  width,
  height,
}: {
  bar: KLineData
  period: ChartPeriod
  x: number
  y: number
  width: number
  height: number
}) {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = new Date(bar.timestamp)
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const intraday = period === 'm1' || period === 'm5' || period === 'h1' || period === 'h5' || period === 'intraday'

  const tipWidth = 150
  const tipHeight = 108
  const left = Math.max(4, Math.min(x + 16, Math.max(4, width - tipWidth - 4)))
  const top = Math.min(Math.max(4, y - tipHeight / 2), Math.max(4, height - tipHeight - 4))

  return (
    <div className="ex-kline-tip" style={{ left, top }} role="status">
      <div className="ex-kline-tip-time">
        {intraday ? `${day} ${clock}` : day}
      </div>
      <div className="ex-kline-tip-row">
        <span>{T.chartOpen}</span>
        <b>{price(bar.open)}</b>
      </div>
      <div className="ex-kline-tip-row">
        <span>{T.chartHigh}</span>
        <b>{price(bar.high)}</b>
      </div>
      <div className="ex-kline-tip-row">
        <span>{T.chartLow}</span>
        <b>{price(bar.low)}</b>
      </div>
      <div className="ex-kline-tip-row">
        <span>{T.chartClose}</span>
        <b>{price(bar.close)}</b>
      </div>
      <div className="ex-kline-tip-row">
        <span>{T.chartVolume}</span>
        <b>{bar.volume === undefined ? '—' : amount(bar.volume)}</b>
      </div>
    </div>
  )
}

function layoutPanes(chart: KChart, containerHeight: number): void {
  const panes = paneList(chart)
  const subs = panes.filter((p) => p.id.startsWith('indicator_pane_'))
  const sep = 6
  const subHeight = 38
  const reserve = subs.length * (subHeight + sep) + sep
  const candle = Math.max(120, Math.round(containerHeight - reserve))
  chart.setPaneOptions({ id: 'candle_pane', height: candle, minHeight: 120 })
  for (const pane of subs) chart.setPaneOptions({ id: pane.id, height: subHeight, minHeight: 30 })
}

function toKLineData(bars: Kline[]): KLineData[] {  return bars.map((bar) => ({
    timestamp: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }))
}

export function ProChart({
  client,
  code,
  quote,
  tick,
  initialPeriod,
}: {
  client: ExchangeClient
  code: string
  quote: StockQuote
  tick: number
  initialPeriod?: ChartPeriod
}) {
  const [period, setPeriod] = useState<ChartPeriod>(() => {
    const wanted = initialPeriod ?? rememberedPeriod
    return PRO_CHART_PERIODS.some((spec) => spec.id === wanted) ? wanted : 'm1'
  })
  const [toggles, setToggles] = useState(() => ({ ...rememberedToggles }))
  const [ready, setReady] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number; bar: KLineData } | null>(null)
  const barsRef = useRef<KLineData[]>([])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<KChart | null>(null)
  const indicatorIds = useRef<string[]>([])
  const consumedKeyRef = useRef('')
  const symbolKeyRef = useRef('')
  const barSinkRef = useRef<((bar: KLineData) => void) | null>(null)
  const queryRef = useRef({ client, code, period })
  queryRef.current = { client, code, period }

  useEffect(() => {
    const load = (): void => client.ensureChartData?.(code, period)
    load()
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [client, code, period])

  useLayoutEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const chart = init(el, { locale: isEn() ? 'en-US' : 'zh-CN' })
    if (chart === null) return
    const border = themeColor('--wui-border', 'rgb(45 60 79)')
    const dim = themeColor('--wui-text-dim', 'rgb(154 167 184)')
    const gain = themeColor('--wui-tone-gain', 'rgb(228 132 132)')
    const loss = themeColor('--wui-tone-loss', 'rgb(111 220 143)')
    const gold = themeColor('--wui-gold', 'rgb(232 180 90)')
    const cyan = themeColor('--wui-cyan', 'rgb(94 234 212)')
    const purple = themeColor('--wui-purple', 'rgb(192 132 252)')
    const deep = themeColor('--wui-bg-deep', 'rgb(8 11 16)')
    const panelBg = themeColor('--wui-bg-panel', 'rgb(24 34 50)')
    chart.setStyles({
      grid: {
        show: true,
        horizontal: { show: true, color: 'rgba(255, 255, 255, 0.04)', size: 1, style: 'dashed', dashedValue: [4, 4] },
        vertical: { show: true, color: 'rgba(255, 255, 255, 0.025)', size: 1, style: 'dashed', dashedValue: [4, 4] },
      },
      candle: {
        type: 'candle_up_stroke',
        bar: {
          upColor: gain,
          downColor: loss,
          noChangeColor: dim,
          upBorderColor: gain,
          downBorderColor: loss,
          noChangeBorderColor: dim,
          upWickColor: gain,
          downWickColor: loss,
          noChangeWickColor: dim,
        },
        priceMark: {
          show: true,
          high: {
            show: true,
            color: 'rgba(228, 132, 132, 0.75)',
            textOffset: 4,
            textSize: 10,
          },
          low: {
            show: true,
            color: 'rgba(111, 220, 143, 0.75)',
            textOffset: 4,
            textSize: 10,
          },
          last: {
            show: true,
            upColor: gain,
            downColor: loss,
            noChangeColor: dim,
            line: {
              show: true,
              style: 'dashed',
              dashedValue: [4, 3],
              size: 1,
              color: null,
            },
            text: {
              show: true,
              color: deep,
              size: 10,
              backgroundColor: null,
            },
          },
        },
        tooltip: { showRule: 'none' },
      },
      indicator: {
        tooltip: { showRule: 'none' },
        lastValueMark: { show: false },
        lines: [
          { style: 'solid', smooth: true, size: 1.2, color: gold },
          { style: 'solid', smooth: true, size: 1.2, color: cyan },
          { style: 'solid', smooth: true, size: 1.2, color: purple },
        ],
        bars: [
          {
            style: 'fill',
            borderSize: 1,
            borderStyle: 'solid',
            upColor: 'rgba(228, 132, 132, 0.45)',
            downColor: 'rgba(111, 220, 143, 0.75)',
            noChangeColor: 'rgba(154, 167, 184, 0.45)',
          },
        ],
      },
      xAxis: {
        show: true,
        size: 18,
        axisLine: { show: true, color: 'rgba(255, 255, 255, 0.08)', size: 1 },
        tickLine: { show: true, color: 'rgba(255, 255, 255, 0.08)', size: 1, length: 3 },
        tickText: { show: true, color: dim, size: 10 },
      },
      yAxis: {
        show: true,
        size: 'auto',
        axisLine: { show: true, color: 'rgba(255, 255, 255, 0.08)', size: 1 },
        tickLine: { show: true, color: 'rgba(255, 255, 255, 0.08)', size: 1, length: 3 },
        tickText: { show: true, color: dim, size: 10 },
      },
      separator: { size: 6, color: panelBg, fill: true, activeBackgroundColor: border },
      crosshair: {
        show: true,
        horizontal: {
          show: true,
          line: { show: true, color: 'rgba(232, 180, 90, 0.75)', size: 1, style: 'dashed', dashedValue: [3, 3] },
          text: { show: true, color: deep, size: 10, backgroundColor: gold, borderColor: gold },
        },
        vertical: {
          show: true,
          line: { show: true, color: 'rgba(232, 180, 90, 0.75)', size: 1, style: 'dashed', dashedValue: [3, 3] },
          text: { show: true, color: deep, size: 10, backgroundColor: gold, borderColor: gold },
        },
      },
    })

    chart.setDataLoader({
      getBars: ({ callback }) => {
        const { client: c, code: k, period: p } = queryRef.current
        const keep = Math.max(320, defaultViewBars(p))
        const data = toKLineData(c.getChartSeries(k, p)).slice(-keep)
        barsRef.current = data
        callback(data, { backward: false, forward: false })
      },
      subscribeBar: ({ callback }) => {
        barSinkRef.current = callback
      },
      unsubscribeBar: () => {
        barSinkRef.current = null
      },
    })

    chartRef.current = chart
    setReady((n) => n + 1)


    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      chart.resize()
      raf2 = requestAnimationFrame(() => chart.resize())
    })

    const measure = (): void => {
      chart.resize()
      layoutPanes(chart, el.clientHeight)
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2 !== 0) cancelAnimationFrame(raf2)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      indicatorIds.current = []
      barSinkRef.current = null
      chartRef.current = null
      dispose(el)
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null || ready === 0) return
    for (const id of indicatorIds.current) chart.removeIndicator({ id })
    indicatorIds.current = []
    const add = (value: string | { name: string; calcParams?: number[]; paneId?: string }, stack: boolean): void => {
      const before = new Set(paneList(chart).map((p) => p.id))
      const id = chart.createIndicator(value, stack)
      if (id === null) return
      indicatorIds.current.push(id)
      if (!stack) {
        const created = paneList(chart).find((p) => !before.has(p.id))
        if (created !== undefined) chart.setPaneOptions({ id: created.id, height: 44, minHeight: 32 })
      }
    }
    if (toggles.boll) add({ name: 'BOLL', calcParams: [20, 2], paneId: 'candle_pane' }, true)
    if (toggles.vol) add('VOL', false)
    if (toggles.rsi) add({ name: 'RSI', calcParams: [21] }, false)
    layoutPanes(chart, hostRef.current?.clientHeight ?? 0)
  }, [ready, toggles])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null || ready === 0) return
    const symbolKey = `${code}|${period}`
    if (symbolKeyRef.current !== symbolKey) {
      symbolKeyRef.current = symbolKey
      chart.setSymbol({ ticker: code })
      chart.setPeriod(toKPeriod(period))
      return
    }
    const bars = client.getChartSeries(code, period)
    const data = toKLineData(bars)
    if (data.length === 0) return
    const key = `${symbolKey}|${data.length}|${data[0]?.timestamp ?? 0}`
    if (key !== consumedKeyRef.current) {
      consumedKeyRef.current = key
      chart.resetData()
      chart.setBarSpace(defaultBarSpace(hostRef.current?.clientWidth ?? 628, period, data.length))
      chart.scrollToRealTime()
      return
    }
    const last = data[data.length - 1]
    if (last !== undefined) barSinkRef.current?.(last)
  }, [ready, client, code, period, tick, quote.price])

  const axisSpec = chartPeriodSpec(period)
  const bars = client.getChartSeries(code, period)
  const lastBar = bars.length > 0 ? bars[bars.length - 1]! : null
  const boll = useMemo(() => bollinger(bars, 20, 2), [bars])
  const rsiValues = useMemo(() => rsi(bars, 21), [bars])
  const lastBoll = boll.mid.length > 0
    ? { up: boll.up[boll.up.length - 1]!, mid: boll.mid[boll.mid.length - 1]!, dn: boll.dn[boll.dn.length - 1]! }
    : null
  const lastRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1]! : null

  const switchPeriod = (next: ChartPeriod): void => {
    rememberedPeriod = next
    writeExchangePref(EXCH_PREF.chartPeriod, next)
    consumedKeyRef.current = ''
    setPeriod(next)
  }

  const toggle = (key: ToggleKey): void => {
    setToggles((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      rememberedToggles = next
      writeExchangeToggles(next)
      return next
    })
  }

  return (
    <section className="ex-chart" aria-label={`${quote.code} ${axisSpec.label} ${T.chartTitle}`}>
      <header className="ex-chart-header">
        <div className="ex-chart-periods" role="group" aria-label={T.chartTitle}>
          {PRO_CHART_PERIODS.map((spec) => (
            <button
              type="button"
              key={spec.id}
              aria-pressed={spec.id === period}
              className={`ex-chart-period-btn${spec.id === period ? ' is-on' : ''}`}
              onClick={() => switchPeriod(spec.id)}
            >
              {spec.label}
            </button>
          ))}
        </div>
        <div className="ex-chart-toggles" role="group" aria-label={T.chartToggles}>
          {(
            [
              ['boll', T.chartBoll],
              ['vol', T.chartVolume],
              ['rsi', T.chartRsi],
            ] as Array<[ToggleKey, string]>
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={toggles[key]}
              className={`ex-chart-toggle-btn is-${key}${toggles[key] ? ' is-on' : ''}`}
              onClick={() => toggle(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {(() => {
        const displayBar = hover !== null ? {
          o: hover.bar.open,
          h: hover.bar.high,
          l: hover.bar.low,
          c: hover.bar.close,
          v: hover.bar.volume,
          t: hover.bar.timestamp,
        } : lastBar
        const change = displayBar ? displayBar.c - displayBar.o : 0
        const changePct = displayBar && displayBar.o > 0 ? (change / displayBar.o) * 100 : 0
        const isUp = change >= 0
        const pad = (n: number): string => String(n).padStart(2, '0')
        const hoverDate = hover ? new Date(hover.bar.timestamp) : null
        const hoverTimeStr = hoverDate ? `${pad(hoverDate.getHours())}:${pad(hoverDate.getMinutes())}` : ''

        return (
          <div className="ex-chart-meta" role="status" aria-live="polite">
            <span className="ex-chart-meta-item">
              <span className="ex-chart-meta-lbl">{T.chartOpen}</span>
              <b className="ex-num">{displayBar ? price(displayBar.o) : '—'}</b>
            </span>
            <span className="ex-chart-meta-item">
              <span className="ex-chart-meta-lbl">{T.chartHigh}</span>
              <b className="ex-num">{displayBar ? price(displayBar.h) : '—'}</b>
            </span>
            <span className="ex-chart-meta-item">
              <span className="ex-chart-meta-lbl">{T.chartLow}</span>
              <b className="ex-num">{displayBar ? price(displayBar.l) : '—'}</b>
            </span>
            <span className="ex-chart-meta-item is-highlight">
              <span className="ex-chart-meta-lbl">{T.colPrice}</span>
              <b className={`ex-num ${isUp ? 'is-up' : 'is-down'}`}>
                {displayBar ? price(displayBar.c) : '—'}
              </b>
              {displayBar ? (
                <span className={`ex-chart-meta-badge ${isUp ? 'is-up' : 'is-down'}`}>
                  {isUp ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              ) : null}
            </span>
            <span className="ex-chart-meta-item">
              <span className="ex-chart-meta-lbl">{T.chartVolume}</span>
              <b className="ex-num">{displayBar?.v !== undefined ? amount(displayBar.v) : '—'}</b>
            </span>
            {toggles.boll ? (
              <span className="ex-chart-meta-item is-boll">
                <span className="ex-chart-meta-lbl">{T.chartBoll}</span>
                <b className="ex-num">
                  {lastBoll === null || lastBoll.up === null || lastBoll.dn === null
                    ? '—'
                    : `${price(lastBoll.up)} / ${lastBoll.mid === null ? '—' : price(lastBoll.mid)} / ${price(lastBoll.dn)}`}
                </b>
              </span>
            ) : null}
            {toggles.rsi ? (
              <span className="ex-chart-meta-item is-rsi">
                <span className="ex-chart-meta-lbl">{T.chartRsi}</span>
                <b className="ex-num">{lastRsi === null ? '—' : lastRsi.toFixed(1)}</b>
              </span>
            ) : null}
            <span className="ex-chart-close">
              {hover ? `${hoverTimeStr} 准星读数` : `${T.chartTitle} · ${axisSpec.label}`}
            </span>
          </div>
        )
      })()}

      <div className="ex-chart-wrap">
        <div
          ref={hostRef}
          className="ex-kline-chart"
          role="img"
          aria-label={`${quote.code} ${axisSpec.label} ${T.chartTitle}`}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const x = Math.round(event.clientX - rect.left)
            const y = Math.round(event.clientY - rect.top)
            const chart = chartRef.current
            if (chart === null) return
            // 只用主图 pane 做换算；y 用 absolute 让它按容器坐标算（默认按 pane 坐标，
            // 传容器 y 会算出错误的 value）。蜡烛优先按 dataIndex 取，避免时间戳四舍五入时找不到。
            const point = chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane', absolute: true })
            const first = Array.isArray(point) ? point[0] : point
            const index = first?.dataIndex
            const list = barsRef.current
            const bar = index === undefined || index < 0 || index >= list.length ? undefined : list[index]
            setHover(bar === undefined ? null : { x, y, bar })
          }}
          onMouseLeave={() => setHover(null)}
        />
        {hover !== null ? (
          <BarTooltip
            bar={hover.bar}
            period={axisSpec.id}
            x={hover.x}
            y={hover.y}
            width={hostRef.current?.clientWidth ?? 0}
            height={hostRef.current?.clientHeight ?? 0}
          />
        ) : null}
        {bars.length < 2 ? <div className="ex-empty ex-kline-empty">{T.chartNoData}</div> : null}
      </div>
    </section>
  )
}
