import { useLayoutEffect, useRef, useState } from 'react'
import { PRICE_SAMPLE_MS } from '@whale/core'
import { isk } from '../../pages/common'
import { tr } from '../../i18n/locale'


const MIN_POINT_SPACING_PX = 12

function sampleAgoLabel(fullLen: number, absIdx: number): string {
  const mins = ((fullLen - 1 - absIdx) * PRICE_SAMPLE_MS) / 60_000
  if (mins <= 0) return tr("ui.MarketPage.036")
  if (mins < 60) return tr("ui.MarketPage.144", { mins: mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? tr("ui.MarketPage.145", { h: h }) : tr("ui.MarketPage.146", { h: h, m: m })
}

export function PriceChart({ hist }: { hist: readonly number[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [wrapW, setWrapW] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const fullLen = hist.length
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWrapW(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  if (fullLen < 2) {
    return (
      <div className="app-mkt-chart-empty">
        <span className="app-dim">{tr("ui.MarketPage.037")}</span>
      </div>
    )
  }
  const tooNarrow = wrapW !== null && wrapW < fullLen * MIN_POINT_SPACING_PX
  const slice = tooNarrow ? hist.slice(-24) : hist
  const offset = tooNarrow ? fullLen - 24 : 0
  const w = 560
  const h = 120
  const pad = 6
  const dataMn = Math.min(...slice)
  const dataMx = Math.max(...slice)
  const dataRange = Math.max(1, dataMx - dataMn)
  const margin = dataRange * 0.15
  const axisMin = Math.floor(dataMn - margin)
  const axisMax = Math.ceil(dataMx + margin)
  const axisSpan = Math.max(1, axisMax - axisMin)
  const mapY = (v: number) => h - pad - ((v - axisMin) / axisSpan) * (h - pad * 2)
  const xAt = (i: number) => (i / (slice.length - 1)) * (w - pad * 2) + pad
  const pts = slice.map((v, i) => `${xAt(i).toFixed(1)},${mapY(v).toFixed(1)}`).join(' ')
  return (
    <div className="app-mkt-chart-wrap" ref={wrapRef}>
        <svg
          className="app-mkt-chart"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={tr('ui.MarketPage.172')}
          onMouseLeave={() => setHover(null)}
        >
          <polyline points={pts} fill="none" stroke="rgb(var(--wui-gold))" strokeWidth="2" opacity="0.9" />
          {slice.map((v, i) => {
            const x = xAt(i)
            const y = mapY(v)
            const isLast = offset + i === fullLen - 1
            const isHover = hover === i
            return (
              <g key={offset + i}>
                {!isLast && !isHover ? <circle cx={x} cy={y} r={1.6} fill="rgba(255,224,138,0.55)" /> : null}
                {isLast ? <circle cx={x} cy={y} r={3.5} style={{ fill: 'rgb(var(--wui-flag))' }} /> : null}
                {isHover ? <circle cx={x} cy={y} r={4.5} fill="none" style={{ stroke: 'rgb(var(--wui-flag))' }} strokeWidth={1.2} /> : null}
                <circle cx={x} cy={y} r={7} fill="transparent" style={{ cursor: 'crosshair' }} onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        </svg>
        {/* 高低价标注用 HTML 覆盖层（非 SVG 文本），避免 preserveAspectRatio=none 拉伸字形 */}
        <span className="app-mkt-chart-hi">{tr("ui.MarketPage.038")} {isk(dataMx)}</span>
        <span className="app-mkt-chart-lo">{tr("ui.MarketPage.039")} {isk(dataMn)}</span>
        {hover !== null && hover < slice.length ? (
          <div
            className={`app-mkt-chart-tip${mapY(slice[hover]!) < 40 ? ' is-below' : ''}`}
            style={{
              left: `${(xAt(hover) / w) * 100}%`,
              // 浮标挂在 .app-mkt-chart-wrap 上 ⇒ 百分比要按 **viewBox 高度**折算（图会被 CSS 拉伸到 wrap 的实测高度，
              // 折线图高度现在跟面板走、wrap 不再是固定 130px；此前写死的 /130 也一直让浮标偏高约 8%）
              top: `${(mapY(slice[hover]!) / h) * 100}%`,
            }}
          >
            ≈{isk(slice[hover]!)} {tr("ui.MarketPage.040")} {sampleAgoLabel(fullLen, offset + hover)}
          </div>
        ) : null}
    </div>
  )
}
