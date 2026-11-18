import { type ReactNode } from 'react'
import { tr } from '../../i18n/locale'
import type { ShareSeg } from './hudTypes'

export function RefineShareRing({ segments, total }: { segments: readonly ShareSeg[]; total: number }): ReactNode {
  const size = 132
  const stroke = 15
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg
      className="hud-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={tr('ui.hud.138', {
        p1: segments
          .map((s) => `${s.label} ${total > 0 ? Math.round((s.isk / total) * 100) : 0}%`)
          .join(tr('ui.MatterTechTab.017')),
      })}
    >
      <circle className="hud-ring-bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
      {segments.map((s, i) => {
        const frac = total > 0 ? s.isk / total : 0
        const len = Math.max(0, frac * c)
        const off = -acc * c
        acc += frac
        return (
          <circle
            key={s.key}
            className="hud-ring-seg"
            data-seg={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={`${len} ${Math.max(0, c - len)}`}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            data-tip={`${s.label} · ${s.detail}`}
          />
        )
      })}
      <text className="hud-ring-num" x={size / 2} y={size / 2 - 2} textAnchor="middle">
        {total > 0 ? `${Math.round(total / 1000).toLocaleString('zh-CN')}k` : '—'}
      </text>
      <text className="hud-ring-cap" x={size / 2} y={size / 2 + 14} textAnchor="middle">
        {tr('ui.hud.135')}
      </text>
    </svg>
  )
}
