/**
 * 行情图：SVG 手绘 K 线 / 分时，两种视图共用同一批分钟线。
 *
 * 为什么不用 canvas：原型只有 60 根柱子，SVG 够快，还能被样式与主题变量直接染色；
 * 也不用现成图表库——仓库目前没有图表依赖，为一页原型引库不划算。
 */
import { useState } from 'react'
import type { Kline, StockQuote } from '../client'
import { amount, pct, price } from '../format'
import { T } from '../texts'

type ChartMode = 'candle' | 'line'

const W = 660
const H = 240
const PAD_L = 10
const PAD_R = 10
const PAD_T = 12
const PAD_B = 20

export function Chart({ quote, klines }: { quote: StockQuote; klines: Kline[] }) {
  const [mode, setMode] = useState<ChartMode>('candle')
  const bars = klines.slice(-60)
  if (bars.length < 2) {
    return (
      <section className="ex-panel ex-chart">
        <header className="ex-panel-head">
          <h3 className="ex-panel-title">{T.chartTitle}</h3>
        </header>
        <div className="ex-empty">{T.chartNoData}</div>
      </section>
    )
  }
  const hi = bars.reduce((m, b) => Math.max(m, b.h), bars[0]!.h)
  const lo = bars.reduce((m, b) => Math.min(m, b.l), bars[0]!.l)
  const span = Math.max(1e-6, hi - lo)
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const yOf = (p: number): number => PAD_T + (1 - (p - lo) / span) * innerH
  const slot = innerW / bars.length
  const xOf = (i: number): number => PAD_L + slot * (i + 0.5)
  const bodyW = Math.max(1.2, slot * 0.56)

  const closeLine = bars.map((b, i) => `${xOf(i).toFixed(1)},${yOf(b.c).toFixed(1)}`).join(' ')
  const maPoints = bars
    .map((_, i) => {
      if (i < 4) return null
      const seg = bars.slice(i - 4, i + 1)
      const ma = seg.reduce((s, b) => s + b.c, 0) / seg.length
      return `${xOf(i).toFixed(1)},${yOf(ma).toFixed(1)}`
    })
    .filter((p): p is string => p !== null)
    .join(' ')
  const up = quote.changePct >= 0
  const last = bars[bars.length - 1]!

  return (
    <section className="ex-panel ex-chart">
      <header className="ex-panel-head">
        <div className="ex-chart-title">
          <h3 className="ex-panel-title">
            {quote.code} <span className="ex-dim">{quote.nameKey}</span>
          </h3>
          <span className={`ex-chart-price ${up ? 'is-up' : 'is-down'}`}>{price(quote.price)}</span>
          <span className={`ex-chart-change ${up ? 'is-up' : 'is-down'}`}>{pct(quote.changePct)}</span>
        </div>
        <div className="ex-seg" role="tablist" aria-label={T.chartTitle}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'candle'}
            className={`ex-seg-btn${mode === 'candle' ? ' is-on' : ''}`}
            onClick={() => setMode('candle')}
          >
            {T.chartCandle}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'line'}
            className={`ex-seg-btn${mode === 'line' ? ' is-on' : ''}`}
            onClick={() => setMode('line')}
          >
            {T.chartLine}
          </button>
        </div>
      </header>
      <div className="ex-chart-meta">
        <span>{T.chartOpen} <b>{price(quote.open)}</b></span>
        <span>{T.chartHigh} <b>{price(hi)}</b></span>
        <span>{T.chartLow} <b>{price(lo)}</b></span>
        <span>{T.chartVolume} <b>{amount(quote.volume24h)}</b></span>
        <span className="ex-chart-close">{T.colPrice} <b>{price(last.c)}</b></span>
      </div>
      <div className="ex-chart-wrap">
        <svg
          className="ex-chart-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${quote.code} ${T.chartCandle}`}
        >
          {/* 三段横向参考线（不做价格刻度，避免非等比缩放把文字拉变形） */}
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={PAD_T + innerH * r}
              y2={PAD_T + innerH * r}
              className="ex-chart-grid"
            />
          ))}
          {mode === 'candle'
            ? bars.map((b, i) => {
                const rise = b.c >= b.o
                const top = yOf(Math.max(b.o, b.c))
                const bottom = yOf(Math.min(b.o, b.c))
                const x = xOf(i)
                return (
                  <g key={b.t} className={rise ? 'is-up' : 'is-down'}>
                    <line x1={x} x2={x} y1={yOf(b.h)} y2={yOf(b.l)} className="ex-candle-wick" />
                    <rect
                      x={x - bodyW / 2}
                      y={top}
                      width={bodyW}
                      height={Math.max(1, bottom - top)}
                      className="ex-candle-body"
                    />
                  </g>
                )
              })
            : (
              <>
                <polygon
                  points={`${PAD_L},${H - PAD_B} ${closeLine} ${W - PAD_R},${H - PAD_B}`}
                  className={`ex-line-area ${up ? 'is-up' : 'is-down'}`}
                />
                <polyline points={closeLine} className={`ex-line ${up ? 'is-up' : 'is-down'}`} />
              </>
            )}
          {mode === 'candle' && maPoints ? <polyline points={maPoints} className="ex-ma5" /> : null}
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yOf(quote.price)}
            y2={yOf(quote.price)}
            className="ex-chart-last"
          />
        </svg>
        <span className="ex-chart-hi">{price(hi)}</span>
        <span className="ex-chart-lo">{price(lo)}</span>
        <span className="ex-chart-axis">{bars.length} 分钟</span>
      </div>
    </section>
  )
}
