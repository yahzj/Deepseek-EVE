/**
 * 专业行情图（2026-11-05 船长令：接 klinecharts 替换自绘 SVG，不留旧图回退开关）。
 *
 * 为什么换库：自绘 SVG 缺缩放/拖拽之外的指标面板、精确刻度与十字光标联动，专业终端需要这些能力。
 * 换库后数据契约不变（仍从 `client.getChartSeries(code, period)` 取 `Kline[]`），
 * 主题色从 `--wui-*` 变量读，切主题不必改代码。
 *
 * 指标：MA5 / MA20 叠在主图，VOL / RSI(14) 各自副图；开关即重建指标，缩放平移由库接管。
 * 数据：klinecharts 10 用 DataLoader 取数——`getBars` 整批（进页/换标的/换周期），
 * `subscribeBar` 拿到回调后由 tick 推最新一根，避免整批替换打断用户的缩放与平移。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dispose, init, type Chart as KChart, type KLineData, type PaneOptions, type Period } from 'klinecharts'
import type { ChartPeriod, ExchangeClient, Kline, StockQuote } from '../../client'
import { PRO_CHART_PERIODS, chartPeriodSpec } from '../../chartPeriods'
import { amount, price } from '../../format'
import { T } from '../../texts'
import { isEn } from '../../../../i18n/locale'
import { bollinger, rsi } from './indicators'
import { EXCH_PREF, readExchangeChoice, readExchangeToggles, writeExchangePref, writeExchangeToggles } from '../../viewPrefs'

/** 切页返回后保持周期（与旧图相同的空间记忆） */
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

/** DOM 上的主题变量是「r g b」三元组，这里拼回 rgb()；变量缺失时用兜底色，避免主题未加载时白屏 */
function themeColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw === '' ? fallback : `rgb(${raw})`
}

/** getPaneOptions 无参时返回数组，单参时返回单个 pane；这里只取列表形态 */
function paneList(chart: KChart): PaneOptions[] {
  const panes = chart.getPaneOptions()
  return Array.isArray(panes) ? panes : []
}

/** 本仓周期 → klinecharts 周期；v10 不设周期与标的不触发 DataLoader */
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

/** 悬浮读数小卡：只讲当前这根蜡烛，图面不常驻文字 */
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
  const left = x + 16 + tipWidth > width ? Math.max(4, x - tipWidth - 16) : x + 16
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

/**
 * 空间分配：v10 的 pane 高度是「期望值」，总高不够时副图会被压到 0。
 * 这里按容器实际高度反算主图，副图固定窄条，保证蜡烛始终是画面主体。
 */
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
  /** 行情拍号：即使现价恰好没变，也要让图表重新取最新一根 */
  tick: number
  /** 可选：初始周期（验收/测试用；页面不传，走空间记忆） */
  initialPeriod?: ChartPeriod
}) {
  const [period, setPeriod] = useState<ChartPeriod>(() => {
    const wanted = initialPeriod ?? rememberedPeriod
    return PRO_CHART_PERIODS.some((spec) => spec.id === wanted) ? wanted : 'm1'
  })
  const [toggles, setToggles] = useState(() => ({ ...rememberedToggles }))
  const [ready, setReady] = useState(0)
  /** 自绘读数卡：库内 tooltip 已全关，只跟随鼠标显示当前这根蜡烛（船长 2026-11-06） */
  const [hover, setHover] = useState<{ x: number; y: number; bar: KLineData } | null>(null)
  /** getBars 交出去的那批数据，鼠标坐标换算成 timestamp 后要回来找这一根 */
  const barsRef = useRef<KLineData[]>([])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<KChart | null>(null)
  const indicatorIds = useRef<string[]>([])
  const consumedKeyRef = useRef('')
  /** 已告知库的标的+周期；变化时先 setSymbol/setPeriod，库才会重新走 DataLoader */
  const symbolKeyRef = useRef('')
  /** DataLoader 拿到的最新一根推送回调；tick 只推一根，不动整批视图 */
  const barSinkRef = useRef<((bar: KLineData) => void) | null>(null)
  /** DataLoader 的取数闭包必须读到当前标的/周期，不能闭包在 init 那一刻 */
  const queryRef = useRef({ client, code, period })
  queryRef.current = { client, code, period }

  // 数据抓取节拍：进页拉一次 + 每 10 秒补拉（与旧图一致，接口有缓存，重复调用不重发）
  useEffect(() => {
    const load = (): void => client.ensureChartData?.(code, period)
    load()
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [client, code, period])

  // 建图（只建一次；主题切换由 CSS 变量驱动，库内颜色在挂载时读取）
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
        // 极弱化辅助网格：降低对蜡烛与折线的视觉压迫，增加图面通透呼吸感
        horizontal: { show: true, color: 'rgba(255, 255, 255, 0.04)', size: 1, style: 'dashed', dashedValue: [4, 4] },
        vertical: { show: true, color: 'rgba(255, 255, 255, 0.025)', size: 1, style: 'dashed', dashedValue: [4, 4] },
      },
      candle: {
        // 遵循权威金融与大鲸鱼规范：阳线中空镂空、阴线饱满实心
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
          // 极值自动标线：微弱提示当前视口高低阻力支撑
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
        // 库内 tooltip 全关：读数由顶部自绘制 HUD 仪表条承担，鼠标滑动即时联动
        tooltip: { showRule: 'none' },
      },
      indicator: {
        tooltip: { showRule: 'none' },
        lastValueMark: { show: false },
        // 指标配色专属定制：BOLL 上轨金色 / 中轨冰青 / 下轨暖紫
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

    // klinecharts 10 的数据入口：整批取数与最新一根推送
    chart.setDataLoader({
      getBars: ({ callback }) => {
        const { client: c, code: k, period: p } = queryRef.current
        // 只交最近 320 根：全量（M1 有 2016 根）塞进 628px 会把蜡烛压成一条线
        const data = toKLineData(c.getChartSeries(k, p)).slice(-320)
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


    // 首次挂载时父级 flex 还没分到高度，init 会按 0 建画布；下一帧再量一次把主图撑开。
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

  // 指标开关：先清掉上一批自己建的指标，再按开关重建（本图不开放其它指标入口，不会误删用户自建指标）
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
      // 副图默认按 100px 分走高度、把主图挤到 0；新建的 pane 固定成窄条。
      // 注意 createIndicator 返回的是指标 id，不是 pane id，只能按前后差集找新 pane。
      if (!stack) {
        const created = paneList(chart).find((p) => !before.has(p.id))
        if (created !== undefined) chart.setPaneOptions({ id: created.id, height: 44, minHeight: 32 })
      }
    }
    // 布林带必须显式落回主图：v10 的 isStack 在空主图时会各建一个指标 pane
    if (toggles.boll) add({ name: 'BOLL', calcParams: [20, 2], paneId: 'candle_pane' }, true)
    if (toggles.vol) add('VOL', false)
    if (toggles.rsi) add({ name: 'RSI', calcParams: [21] }, false)
    layoutPanes(chart, hostRef.current?.clientHeight ?? 0)
  }, [ready, toggles])

  // 数据衔接：换标的/换周期时先告诉库看哪只标的、哪个周期（v10 不设就不拉数），
  // 之后再整批重置；同一标的下 tick 只推最新一根。
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
      // 默认把蜡烛压到 4px/根：628px 宽约看 150 根，比 fit 全量可读
      chart.setBarSpace(4)
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
            // 只用主图 pane 做换算：副图上的鼠标不弹蜡烛读数
            const point = chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane' })
            const stamp = (Array.isArray(point) ? point[0] : point)?.timestamp
            const bar = stamp === undefined ? undefined : barsRef.current.find((item) => item.timestamp === stamp)
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
