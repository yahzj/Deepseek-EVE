/**
 * 副图一：成交量柱（与主图共享时间轴，按当根 K 线涨跌染色）。
 */
import type { Kline } from '../../client'

export function VolumePane({
  bars,
  left,
  right,
  top,
  bottom,
  bodyW,
  xOf,
}: {
  bars: readonly Kline[]
  left: number
  right: number
  top: number
  bottom: number
  bodyW: number
  xOf: (i: number) => number
}) {
  const maxV = bars.reduce((m, b) => Math.max(m, b.v), 1)
  const height = Math.max(1, bottom - top)
  return (
    <g>
      <line x1={left} x2={right} y1={top} y2={top} className="ex-pane-border" />
      <line x1={left} x2={right} y1={bottom} y2={bottom} className="ex-pane-baseline" />
      {bars.map((b, i) => {
        const h = Math.max(1, (b.v / maxV) * (height - 2))
        return (
          <rect
            key={`v-${b.t}-${i}`}
            x={xOf(i) - bodyW / 2}
            y={bottom - h}
            width={Math.max(1, bodyW)}
            height={h}
            className={`ex-vol-bar ${b.c >= b.o ? 'is-up' : 'is-down'}`}
          />
        )
      })}
      <text x={left + 4} y={top + 10} className="ex-pane-label">
        成交量
      </text>
    </g>
  )
}
