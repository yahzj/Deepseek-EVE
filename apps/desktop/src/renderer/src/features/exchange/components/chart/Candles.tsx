/**
 * 主图：蜡烛（M1/H1/D1/D7/D30）或分时折线，叠加 MA5 / MA20 与分时均价线。
 *
 * 纯展示组件：坐标映射由 `Chart.tsx` 统一算好传进来，主图与副图共享同一条时间轴。
 */
import type { Kline } from '../../client'
import type { ChartPeriod } from '../../client'

export interface CandleGeometry {
  /** 绘图区左边界（px） */
  left: number
  /** 绘图区右边界（px，右侧留给价格刻度） */
  right: number
  /** 主图顶/底（px） */
  top: number
  bottom: number
  /** 柱宽（px） */
  bodyW: number
  /** 第 i 根的中心 x */
  xOf: (i: number) => number
  /** 价格 → y */
  yOf: (p: number) => number
}

/** 折线点串；null 表示指标还没算出来，断线不硬连 */
function pointsOf(
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

export function Candles({
  bars,
  period,
  geo,
  ma5,
  ma20,
  showMa5,
  showMa20,
  avg,
}: {
  bars: readonly Kline[]
  period: ChartPeriod
  geo: CandleGeometry
  ma5: ReadonlyArray<number | null>
  ma20: ReadonlyArray<number | null>
  showMa5: boolean
  showMa20: boolean
  /** 分时均价线（非分时为 null） */
  avg: ReadonlyArray<number> | null
}) {
  const line = period === 'intraday'
  const linePoints = bars
    .map((b, i) => `${geo.xOf(i).toFixed(1)},${geo.yOf(b.c).toFixed(1)}`)
    .join(' ')
  const up = bars.length > 0 && bars[bars.length - 1]!.c >= bars[0]!.o
  return (
    <g>
      {line ? (
        <>
          <polygon
            points={`${geo.left},${geo.bottom} ${linePoints} ${geo.right},${geo.bottom}`}
            className={`ex-line-area ${up ? 'is-up' : 'is-down'}`}
          />
          <polyline points={linePoints} className={`ex-line ${up ? 'is-up' : 'is-down'}`} />
          {avg ? <polyline points={pointsOf(avg, geo.xOf, geo.yOf)} className="ex-avg" /> : null}
        </>
      ) : (
        bars.map((b, i) => {
          const rise = b.c >= b.o
          const top = geo.yOf(Math.max(b.o, b.c))
          const bottom = geo.yOf(Math.min(b.o, b.c))
          const x = geo.xOf(i)
          return (
            <g key={`${b.t}-${i}`} className={rise ? 'is-up' : 'is-down'}>
              <line x1={x} x2={x} y1={geo.yOf(b.h)} y2={geo.yOf(b.l)} className="ex-candle-wick" />
              <rect
                x={x - geo.bodyW / 2}
                y={top}
                width={geo.bodyW}
                height={Math.max(1, bottom - top)}
                className="ex-candle-body"
              />
            </g>
          )
        })
      )}
      {showMa5 && ma5.some((v) => v !== null) ? (
        <polyline points={pointsOf(ma5, geo.xOf, geo.yOf)} className="ex-ma5" />
      ) : null}
      {showMa20 && ma20.some((v) => v !== null) ? (
        <polyline points={pointsOf(ma20, geo.xOf, geo.yOf)} className="ex-ma20" />
      ) : null}
    </g>
  )
}
