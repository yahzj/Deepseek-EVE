import { type ReactNode } from 'react'
import { tr } from '../../i18n/locale'
import type { ShareSeg } from './hudTypes'

/**
 * **精炼产出构成环（SVG 多段环）**——**2026-09-30 船长令**：「给圆环添加动画，按照当前所有精炼炉产出
 * 各个资源的占比，将其分配到圆环上并染色，玩家鼠标移动上去时，显示该资源产量」。
 *
 * 为什么改成 SVG（三件事一起解决，且回到合规线）：
 * 1. 原先那个环是 **CSS `conic-gradient` 画的图形**，而船长 2026-09-10 定过「**形状只允许用 SVG 画**，
 *    CSS 只能做背景氛围」⇒ 多段染色＋分段悬停＋过渡这三件都更该走 SVG；
 * 2. **分段悬停**：每段一条 `<circle>`，自己的 `data-tip`（SVG 悬停按全仓规矩只走 `data-tip`）；
 * 3. **动画**：动的是 `stroke-dasharray/dashoffset`（不触发布局的描边属性），并在 `prefers-reduced-motion`
 *    与「关特效」下退化为瞬时。
 *
 * 技能 chart 域「Part-to-Whole」的三条硬口径都在这里落地：**≤5 类**（多出的并进「其他」）·
 * **最大段从 12 点方向起**（分段已按产值降序 + `rotate(-90)`）· **不能只靠颜色**（环旁有同名同值的
 * 构成表，且 svg 带 `aria-label` 逐段念出占比）。
 */
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
