import type { ReactNode } from 'react'

function wavePath(width: number, height: number, amplitude: number, periods: number): string {
  const seg = width / periods
  const mid = 0
  let d = `M0 ${mid}`
  for (let i = 0; i < periods; i++) {
    const x0 = i * seg
    d += ` Q${x0 + seg / 4} ${mid - amplitude} ${x0 + seg / 2} ${mid}`
    d += ` Q${x0 + (seg * 3) / 4} ${mid + amplitude} ${x0 + seg} ${mid}`
  }
  d += ` V${height + amplitude * 2} H0 Z`
  return d
}

export interface FuelTankProps {
  units: number
  capacity: number
  height?: number
  width?: number
  tickUnits?: number
  label: string
}

export function FuelTank({ units, capacity, height = 148, width, tickUnits, label }: FuelTankProps): ReactNode {
  const H = Math.max(80, Math.round(height))
  const W = Math.max(28, Math.round(width ?? H * 0.46))
  const padX = 7
  const padTop = 16
  const padBottom = 10
  const innerW = W - padX * 2
  const innerH = H - padTop - padBottom
  const ratio = capacity > 0 ? Math.max(0, Math.min(1, units / capacity)) : 0
  const filled = ratio > 0
  const surfaceY = innerH * (1 - ratio)
  const amp = ratio === 1 ? 0 : 2.8
  const WAVE_PERIODS = 6
  const waveW = (innerW / 2) * WAVE_PERIODS
  const waveH = innerH - surfaceY + amp * 3
  const d = wavePath(waveW, waveH, amp, WAVE_PERIODS)
  const tickY = tickUnits !== undefined && capacity > 0 ? innerH * (1 - Math.min(1, tickUnits / capacity)) : undefined
  const uid = `ft${W}x${H}${Math.round(capacity)}`.replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg
      className={`hud-tank${filled ? ' is-filled' : ''}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ ['--tank-shift' as string]: `-${innerW}px` }}
      role="img"
      aria-label={label}
    >
      <defs>
        {/* 玻璃：斜向高光（SVG 渐变 —— 不用 CSS 拼形状） */}
        <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--wui-text-hi))" stopOpacity="0.16" />
          <stop offset="38%" stopColor="rgb(var(--wui-text-hi))" stopOpacity="0.04" />
          <stop offset="100%" stopColor="rgb(var(--wui-text-hi))" stopOpacity="0.10" />
        </linearGradient>
        {/* 液体：上浅下深（有厚度感） */}
        <linearGradient id={`${uid}-fuel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--wui-accent))" stopOpacity="0.92" />
          <stop offset="100%" stopColor="rgb(var(--wui-accent-deep))" stopOpacity="0.96" />
        </linearGradient>
        {/* 内腔：液体的裁剪区（罐内圆角矩形） */}
        <clipPath id={`${uid}-clip`}>
          <rect x={padX} y={padTop} width={innerW} height={innerH} rx="5" />
        </clipPath>
      </defs>

      {/* 罐体：空段底（轨道） */}
      <rect
        x={padX}
        y={padTop}
        width={innerW}
        height={innerH}
        rx="5"
        fill="rgb(var(--wui-bg-track))"
      />

      {/* 液体（被内腔裁剪）：两层错速波 ＋ 主体 */}
      <g clipPath={`url(#${uid}-clip)`}>
        {filled ? <g transform={`translate(0 ${padTop + surfaceY})`}>
          <g className="wave-b">
            <path d={d} fill="rgb(var(--wui-accent))" opacity="0.30" />
          </g>
          <g className="wave-a">
            <path d={d} fill={`url(#${uid}-fuel)`} />
          </g>
        </g> : null}
        {/* 液下微光（呼吸；空罐不亮） */}
        {filled ? (
          <ellipse
            className="glow"
            cx={W / 2}
            cy={padTop + innerH - 6}
            rx={innerW * 0.42}
            ry="6"
            fill="rgb(var(--wui-accent))"
            opacity="0.35"
          />
        ) : null}
      </g>

      {/* 玻璃外壳：描边 ＋ 高光 ＋ 颈口 ＋ 液面参考刻度 */}
      <rect
        x={padX}
        y={padTop}
        width={innerW}
        height={innerH}
        rx="5"
        fill={`url(#${uid}-glass)`}
        stroke="rgb(var(--wui-border-bright))"
        strokeWidth="1.2"
      />
      {/* 玻璃反光条（细线稿语言，不用 CSS 造形） */}
      <path
        d={`M${padX + 3.2} ${padTop + 6} V${padTop + innerH - 6}`}
        stroke="rgb(var(--wui-text-hi))"
        strokeOpacity="0.20"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* 颈口（罐盖） */}
      <path
        d={`M${W / 2 - 6.5} ${padTop} v-4.4 a1.6 1.6 0 0 1 1.6 -1.6 h9.8 a1.6 1.6 0 0 1 1.6 1.6 V${padTop}`}
        fill="none"
        stroke="rgb(var(--wui-border-bright))"
        strokeWidth="1.2"
      />
      {/* 刻度：四等分短发丝线 */}
      {[0.25, 0.5, 0.75].map((t) => (
        <path
          key={t}
          d={`M${padX + innerW - 5} ${padTop + innerH * t} h-4`}
          stroke="rgb(var(--wui-text-dim))"
          strokeOpacity="0.55"
          strokeWidth="1"
        />
      ))}
      {/* 「一趟长途」长刻度（有值时画；给玩家一个"够不够飞一趟"的参照） */}
      {tickY !== undefined ? (
        <path
          d={`M${padX} ${padTop + tickY} h${innerW}`}
          stroke="rgb(var(--wui-text-hi))"
          strokeOpacity="0.34"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ) : null}
    </svg>
  )
}
