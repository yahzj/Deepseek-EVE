/**
 * 行情图（2026-11-03 六周期批）——`分时 / M1 / H1 / D1 / D7 / D30` 共用一块画布。
 *
 * 结构：主图（蜡烛或分时线 + MA5/MA20/均价）+ 成交量副图 + RSI(14) 副图；三者共享时间轴。
 * 数据：每个 tick 从 `ExchangeClient.getChartSeries()` 同步取缓存；指标（MA/RSI/均价）全部
 * 在前端现算，不请求接口。切换周期/指标开关不重开页面、不丢当前标的与周期。
 *
 * 为什么不用图表库：仓库没有图表依赖；SVG 足够画 400 根柱，还能被主题变量直接染色。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Reset, ZoomIn, ZoomOut } from '@carbon/icons-react'
import type { ChartPeriod, ExchangeClient, StockQuote } from '../../client'
import { CHART_PERIODS, INTRADAY_MAX_POINTS, chartPeriodSpec, sampleSeries } from '../../chartPeriods'
import { amount, pct, price } from '../../format'
import { T } from '../../texts'
import { hideTip, moveTip, showTip } from '../../../../ui/Tooltip'
import { averageLine, lastDefined, movingAverage, rsi } from './indicators'
import { Candles } from './Candles'
import { VolumePane } from './VolumePane'
import { Crosshair, crosshairTipContent, type CrosshairPoint } from './Crosshair'

/** 切页返回后保持周期（设计稿「Spatial Memory」：选中标的与 K 线周期不因切页丢失） */
let rememberedPeriod: ChartPeriod = 'm1'
/** 指标开关同样跨页保持（默认全开） */
let rememberedToggles = { ma5: true, ma20: true, rsi: true, vol: true }

type ToggleKey = keyof typeof rememberedToggles

interface ChartSize {
  w: number
  h: number
}

/** 指标折线点串（null 表示指标未就绪；只跳过该点，不做虚假连线） */
function indicatorPoints(
  values: ReadonlyArray<number | null>,
  xOf: (i: number) => number,
  yOf: (p: number) => number,
): string {
  const pts: string[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) continue
    pts.push(`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
  }
  return pts.join(' ')
}

export function Chart({
  client,
  code,
  quote,
  tick,
}: {
  client: ExchangeClient
  code: string
  quote: StockQuote
  /** 行情拍号：即使现价恰好没变，也要让图表重新取最新一根 */
  tick: number
}) {
  const [period, setPeriod] = useState<ChartPeriod>(() => rememberedPeriod)
  const [toggles, setToggles] = useState(() => ({ ...rememberedToggles }))
  const [size, setSize] = useState<ChartSize>({ w: 660, h: 320 })
  const [point, setPoint] = useState<CrosshairPoint | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const tipShown = useRef(false)

  // 时间轴滚轮缩放与鼠标拖拽平移状态（船长 2026-11-03 交互升级）
  const [visibleCount, setVisibleCount] = useState<number>(60)
  const [panOffset, setPanOffset] = useState<number>(0)
  const dragStartRef = useRef<{ x: number; offset: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = (): void => {
      const w = Math.max(320, Math.round(el.clientWidth))
      const h = Math.max(220, Math.round(el.clientHeight))
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 卸载时收起自绘提示（切页/切标的不留残影）
  useEffect(() => () => hideTip(), [])

  const data = useMemo(() => {
    const raw = client.getChartSeries(code, period)
    const allBars = period === 'intraday' ? sampleSeries(raw, INTRADAY_MAX_POINTS) : raw
    const allMa5 = movingAverage(allBars, 5)
    const allMa20 = movingAverage(allBars, 20)
    const allRsi = rsi(allBars, 14)
    const allAvg = period === 'intraday' ? averageLine(allBars) : null

    // 基于 visibleCount 与 panOffset 截取可视窗口数据
    const totalBars = allBars.length
    const clampedCount = Math.max(15, Math.min(visibleCount, Math.max(15, totalBars)))
    const maxOffset = Math.max(0, totalBars - clampedCount)
    const clampedOffset = Math.max(0, Math.min(panOffset, maxOffset))

    const endIdx = totalBars - clampedOffset
    const startIdx = Math.max(0, endIdx - clampedCount)

    const bars = allBars.slice(startIdx, endIdx)
    const ma5 = allMa5.slice(startIdx, endIdx)
    const ma20 = allMa20.slice(startIdx, endIdx)
    const rsiValues = allRsi.slice(startIdx, endIdx)
    const avg = allAvg ? allAvg.slice(startIdx, endIdx) : null

    return { raw, bars, ma5, ma20, rsiValues, avg, totalBars, maxOffset, clampedOffset }
  }, [client, code, period, quote.price, tick, visibleCount, panOffset])

  const { raw, bars, ma5, ma20, rsiValues, avg, maxOffset, clampedOffset } = data
  const lastBar = bars.length > 0 ? bars[bars.length - 1]! : null
  const up = quote.changePct >= 0

  const { w, h } = size
  const axisH = 16
  const gap = 6
  const plotLeft = 8
  const plotRight = w - 58
  const bottomLimit = h - axisH
  const volH = toggles.vol ? Math.max(30, Math.round((bottomLimit - gap * 2) * 0.18)) : 0
  const rsiH = toggles.rsi ? Math.max(30, Math.round((bottomLimit - gap * 2) * 0.18)) : 0
  const mainBottom = Math.max(
    70,
    bottomLimit - volH - rsiH - (toggles.vol ? gap : 0) - (toggles.rsi ? gap : 0),
  )
  const volTop = mainBottom + gap
  const volBottom = volTop + volH
  const rsiTop = volTop + volH + (toggles.vol ? gap : 0)
  const rsiBottom = rsiTop + rsiH

  let hi = 1
  let lo = 0
  if (bars.length > 0) {
    hi = bars.reduce((m, b) => Math.max(m, b.h), bars[0]!.h)
    lo = bars.reduce((m, b) => Math.min(m, b.l), bars[0]!.l)
    const pad = Math.max((hi - lo) * 0.06, hi * 0.002)
    hi += pad
    lo = Math.max(0, lo - pad)
  }
  const span = Math.max(1e-6, hi - lo)
  const innerW = Math.max(1, plotRight - plotLeft)
  const slot = bars.length > 0 ? innerW / bars.length : innerW
  const bodyW = Math.max(1, Math.min(12, slot * 0.68))
  const xOf = (i: number): number => plotLeft + slot * (i + 0.5)
  const yOf = (p: number): number => 8 + (1 - (p - lo) / span) * (mainBottom - 8)

  // 极值标记计算：当前可见周期内最高价与最低价及其坐标索引
  const extremum = useMemo(() => {
    if (bars.length < 2) return null
    let maxIdx = 0
    let minIdx = 0
    for (let i = 1; i < bars.length; i++) {
      if (bars[i]!.h > bars[maxIdx]!.h) maxIdx = i
      if (bars[i]!.l < bars[minIdx]!.l) minIdx = i
    }
    return {
      maxIdx,
      minIdx,
      maxH: bars[maxIdx]!.h,
      minL: bars[minIdx]!.l,
    }
  }, [bars])

  // 记住最近一次的十字光标坐标，支持离开图表时平滑淡出过渡
  const lastPointRef = useRef<CrosshairPoint | null>(null)
  if (point) {
    lastPointRef.current = point
  }
  const activeCrosshair = point ?? lastPointRef.current

  const changePeriod = (next: ChartPeriod): void => {
    rememberedPeriod = next
    setPeriod(next)
    setPoint(null)
    setPanOffset(0) // 切换周期重置平移
    hideTip()
    tipShown.current = false
  }

  // 滚轮缩放时间轴
  const handleWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    const step = e.deltaY < 0 ? -6 : 6
    setVisibleCount((prev) => Math.max(15, Math.min(180, prev + step)))
  }

  // 拖拽平移时间轴
  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    dragStartRef.current = { x: e.clientX, offset: panOffset }
    setIsDragging(true)
  }

  const handleMouseUp = (): void => {
    dragStartRef.current = null
    setIsDragging(false)
  }

  const toggle = (key: ToggleKey): void => {
    setToggles((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      rememberedToggles = next
      return next
    })
  }

  const pointAt = (event: ReactMouseEvent<SVGRectElement>): CrosshairPoint | null => {
    if (bars.length === 0) return null
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const px = ((event.clientX - rect.left) / rect.width) * w
    const index = Math.max(0, Math.min(bars.length - 1, Math.floor((px - plotLeft) / slot)))
    return { index, x: xOf(index), y: yOf(bars[index]!.c) }
  }

  const onMove = (event: ReactMouseEvent<SVGRectElement>): void => {
    if (dragStartRef.current) {
      const dx = event.clientX - dragStartRef.current.x
      const barsMoved = Math.round(dx / Math.max(1, slot))
      setPanOffset(Math.max(0, Math.min(maxOffset, dragStartRef.current.offset + barsMoved)))
      hideTip()
      tipShown.current = false
      return
    }
    const next = pointAt(event)
    if (!next) return
    setPoint(next)
    const content = crosshairTipContent({
      bars,
      point: next,
      period,
      ma5,
      ma20,
      rsiValue: rsiValues,
      avg,
    })
    if (tipShown.current) moveTip(content, event.clientX, event.clientY)
    else {
      showTip(content, event.clientX, event.clientY)
      tipShown.current = true
    }
  }

  const onLeave = (): void => {
    dragStartRef.current = null
    setIsDragging(false)
    setPoint(null)
    hideTip()
    tipShown.current = false
  }

  // 时间轴刻度：最多 5 个（首/尾必留），避免 400 根时字挤在一起
  const tickIndexes =
    bars.length === 0
      ? []
      : [
          ...new Set([
            0,
            Math.round((bars.length - 1) * 0.25),
            Math.round((bars.length - 1) * 0.5),
            Math.round((bars.length - 1) * 0.75),
            bars.length - 1,
          ]),
        ]

  const lastMa5 = lastDefined(ma5)
  const lastMa20 = lastDefined(ma20)
  const lastRsi = lastDefined(rsiValues)
  const axisSpec = chartPeriodSpec(period)

  return (
    <section className="ex-panel ex-chart">
      <header className="ex-panel-head ex-chart-head">
        <div className="ex-chart-title">
          <h3 className="ex-panel-title">
            {quote.code} <span className="ex-dim">{quote.nameKey}</span>
          </h3>
          <span className={`ex-chart-price ${up ? 'is-up' : 'is-down'}`}>{price(quote.price)}</span>
          <span className={`ex-chart-change ${up ? 'is-up' : 'is-down'}`}>{pct(quote.changePct)}</span>
        </div>
        <div className="ex-chart-tools">
          <div className="ex-seg ex-chart-periods" role="tablist" aria-label={T.chartTitle}>
            {CHART_PERIODS.map((spec) => (
              <button
                type="button"
                key={spec.id}
                role="tab"
                aria-selected={period === spec.id}
                className={`ex-seg-btn${period === spec.id ? ' is-on' : ''}`}
                onClick={() => changePeriod(spec.id)}
              >
                {spec.label}
              </button>
            ))}
          </div>
          <div className="ex-chart-toggles" role="group" aria-label={T.chartToggles}>
            {(
              [
                ['ma5', T.chartMa5],
                ['ma20', T.chartMa20],
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
          <div className="ex-chart-zoom-group" role="group" aria-label="时间轴缩放">
            <button
              type="button"
              className="ex-mini-btn"
              title="放大时间轴（看清单根蜡烛细节，亦可滚轮向上）"
              onClick={() => setVisibleCount((v) => Math.max(15, v - 10))}
            >
              <ZoomIn size={14} /> 放大
            </button>
            <span className="ex-chart-zoom-text ex-dim">{bars.length} 根</span>
            <button
              type="button"
              className="ex-mini-btn"
              title="缩小时间轴（看宏观大趋势，亦可滚轮向下）"
              onClick={() => setVisibleCount((v) => Math.min(180, v + 10))}
            >
              <ZoomOut size={14} /> 缩小
            </button>
            {clampedOffset > 0 ? (
              <button
                type="button"
                className="ex-mini-btn is-on"
                title="已处于历史回溯态，点击快速回到最新行情"
                onClick={() => setPanOffset(0)}
              >
                <Reset size={14} /> 最新
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="ex-chart-meta">
        <span>
          {T.chartOpen} <b>{lastBar ? price(lastBar.o) : '—'}</b>
        </span>
        <span>
          {T.chartHigh} <b>{lastBar ? price(lastBar.h) : '—'}</b>
        </span>
        <span>
          {T.chartLow} <b>{lastBar ? price(lastBar.l) : '—'}</b>
        </span>
        <span>
          {T.colPrice}{' '}
          <b className={lastBar ? (lastBar.c >= lastBar.o ? 'is-up' : 'is-down') : ''}>
            {lastBar ? price(lastBar.c) : '—'}
          </b>
        </span>
        <span>
          {T.chartVolume} <b>{lastBar ? amount(lastBar.v) : '—'}</b>
        </span>
        {toggles.ma5 ? (
          <span>
            {T.chartMa5} <b>{lastMa5 === null ? '—' : price(lastMa5)}</b>
          </span>
        ) : null}
        {toggles.ma20 ? (
          <span>
            {T.chartMa20} <b>{lastMa20 === null ? '—' : price(lastMa20)}</b>
          </span>
        ) : null}
        {toggles.rsi ? (
          <span>
            {T.chartRsi} <b>{lastRsi === null ? '—' : lastRsi.toFixed(1)}</b>
          </span>
        ) : null}
        <span className="ex-chart-close">
          {T.chartTitle} · {axisSpec.label}
          {period === 'intraday' && raw.length > bars.length
            ? ` · ${T.chartSampled} ${bars.length}/${raw.length}`
            : ''}
        </span>
      </div>

      <div
        className={`ex-chart-wrap${isDragging ? ' is-dragging' : ''}`}
        ref={wrapRef}
        onWheel={handleWheel}
      >
        {bars.length < 2 ? (
          <div className="ex-empty">{T.chartNoData}</div>
        ) : (
          <svg
            ref={svgRef}
            className="ex-chart-svg"
            viewBox={`0 0 ${w} ${h}`}
            role="img"
            aria-label={`${quote.code} ${axisSpec.label} ${T.chartTitle}`}
          >
            {/* 主图价格网格 + 右侧刻度 */}
            {[0.2, 0.4, 0.6, 0.8].map((r) => {
              const y = 8 + r * (mainBottom - 8)
              const p = hi - span * r
              return (
                <g key={`grid-${r}`}>
                  <line x1={plotLeft} x2={plotRight} y1={y} y2={y} className="ex-chart-grid" />
                  <text x={plotRight + 4} y={y + 3} className="ex-axis-text">
                    {price(p)}
                  </text>
                </g>
              )
            })}

            <Candles
              bars={bars}
              period={period}
              geo={{ left: plotLeft, right: plotRight, top: 8, bottom: mainBottom, bodyW, xOf, yOf }}
              ma5={ma5}
              ma20={ma20}
              showMa5={toggles.ma5}
              showMa20={toggles.ma20}
              avg={avg}
            />

            {/* 极值标记（最高价 / 最低价）：权威折线标尺，带内缩边界防裁切判断 */}
            {extremum ? (
              <g className="ex-extremum-group" aria-hidden="true">
                {/* 最高价标注 */}
                {(() => {
                  const x = xOf(extremum.maxIdx)
                  const y = yOf(extremum.maxH)
                  const isLeft = x > (plotLeft + plotRight) / 2
                  const armLen = 14
                  const bendX = isLeft ? x - armLen : x + armLen
                  const tailX = isLeft ? bendX - 6 : bendX + 6
                  const textY = Math.max(14, Math.min(mainBottom - 10, y < 18 ? y + 10 : y - 2))
                  const textX = isLeft ? tailX - 4 : tailX + 4
                  const textAnchor = isLeft ? 'end' : 'start'
                  const label = `H ${price(extremum.maxH)}`
                  return (
                    <g key="hi">
                      <circle cx={x} cy={y} r={1.8} className="ex-extremum-dot" />
                      <polyline
                        points={`${x.toFixed(1)},${y.toFixed(1)} ${bendX.toFixed(1)},${textY.toFixed(1)} ${tailX.toFixed(1)},${textY.toFixed(1)}`}
                        className="ex-extremum-line"
                      />
                      <text
                        x={textX.toFixed(1)}
                        y={(textY + 3).toFixed(1)}
                        textAnchor={textAnchor}
                        className="ex-extremum-text"
                      >
                        {label}
                      </text>
                    </g>
                  )
                })()}

                {/* 最低价标注 */}
                {(() => {
                  const x = xOf(extremum.minIdx)
                  const y = yOf(extremum.minL)
                  const isLeft = x > (plotLeft + plotRight) / 2
                  const armLen = 14
                  const bendX = isLeft ? x - armLen : x + armLen
                  const tailX = isLeft ? bendX - 6 : bendX + 6
                  const textY = Math.max(16, Math.min(mainBottom - 6, y > mainBottom - 18 ? y - 10 : y + 4))
                  const textX = isLeft ? tailX - 4 : tailX + 4
                  const textAnchor = isLeft ? 'end' : 'start'
                  const label = `L ${price(extremum.minL)}`
                  return (
                    <g key="lo">
                      <circle cx={x} cy={y} r={1.8} className="ex-extremum-dot" />
                      <polyline
                        points={`${x.toFixed(1)},${y.toFixed(1)} ${bendX.toFixed(1)},${textY.toFixed(1)} ${tailX.toFixed(1)},${textY.toFixed(1)}`}
                        className="ex-extremum-line"
                      />
                      <text
                        x={textX.toFixed(1)}
                        y={(textY + 3).toFixed(1)}
                        textAnchor={textAnchor}
                        className="ex-extremum-text"
                      >
                        {label}
                      </text>
                    </g>
                  )
                })()}
              </g>
            ) : null}

            {/* 现价虚线 + 右轴读数 */}
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={yOf(quote.price)}
              y2={yOf(quote.price)}
              className="ex-chart-last"
            />
            <text x={plotRight + 4} y={yOf(quote.price) + 3} className="ex-axis-text ex-axis-last">
              {price(quote.price)}
            </text>

            {/* 时间轴刻度（首尾对齐边缘） */}
            {tickIndexes.map((i) => (
              <text
                key={`t-${bars[i]!.t}`}
                x={xOf(i)}
                y={h - 4}
                textAnchor={i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'}
                className="ex-axis-text"
              >
                {axisSpec.axisLabel(bars[i]!.t)}
              </text>
            ))}

            {toggles.vol ? (
              <VolumePane
                bars={bars}
                left={plotLeft}
                right={plotRight}
                top={volTop}
                bottom={volBottom}
                bodyW={bodyW}
                xOf={xOf}
              />
            ) : null}

            {toggles.rsi ? (
              <RsiPane
                values={rsiValues}
                left={plotLeft}
                right={plotRight}
                top={rsiTop}
                bottom={rsiBottom}
                xOf={xOf}
              />
            ) : null}

            {activeCrosshair && activeCrosshair.index < bars.length ? (
              <Crosshair
                point={activeCrosshair}
                active={Boolean(point)}
                top={8}
                bottom={toggles.rsi ? rsiBottom : toggles.vol ? volBottom : mainBottom}
                left={plotLeft}
                right={plotRight}
                axisY={h - axisH}
                timeText={axisSpec.axisLabel(bars[activeCrosshair.index]!.t)}
                priceText={price(bars[activeCrosshair.index]!.c)}
              />
            ) : null}

            {/* 透明覆盖层：承接十字光标与拖拽平移事件（放在最后，盖住所有可绘制元素） */}
            <rect
              x={0}
              y={0}
              width={w}
              height={h}
              fill="transparent"
              className={`ex-chart-hit${isDragging ? ' is-dragging' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseMove={onMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={onLeave}
            />
          </svg>
        )}
      </div>
    </section>
  )
}

/** RSI 副图：30/70 参考线 + RSI(14) 折线 */
function RsiPane({
  values,
  left,
  right,
  top,
  bottom,
  xOf,
}: {
  values: ReadonlyArray<number | null>
  left: number
  right: number
  top: number
  bottom: number
  xOf: (i: number) => number
}) {
  const height = Math.max(1, bottom - top)
  const yOf = (v: number): number => bottom - (Math.max(0, Math.min(100, v)) / 100) * height
  return (
    <g>
      <line x1={left} x2={right} y1={top} y2={top} className="ex-pane-border" />
      <line x1={left} x2={right} y1={bottom} y2={bottom} className="ex-pane-baseline" />
      {[30, 70].map((v) => (
        <g key={`rsi-${v}`}>
          <line x1={left} x2={right} y1={yOf(v)} y2={yOf(v)} className="ex-rsi-guide" />
          <text x={left + 4} y={yOf(v) - 2} className="ex-pane-dim">
            {v}
          </text>
          <text x={right + 4} y={yOf(v) + 3} className="ex-axis-text ex-pane-guide-text">
            {v}
          </text>
        </g>
      ))}
      <text x={left + 4} y={top + 10} className="ex-pane-label">
        RSI14
      </text>
      <polyline points={indicatorPoints(values, xOf, yOf)} className="ex-rsi" />
    </g>
  )
}
