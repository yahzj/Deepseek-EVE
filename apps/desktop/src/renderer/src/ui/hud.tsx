/**
 * **HUD 通用小件**（**2026-09-30 船长令**：「和之前技能树一样，先复制现有工业页面…」＋
 * 「**现在文字太多了，适量的图标也不能拉下**」）。
 *
 * 两个件是"少字多图标"的最小公共语汇，工业 HUD 页与舰船页跃迁燃料页共用（避免两处各写一份）：
 * - `IconBtn`：**图标按钮** —— 图标 ＋（可选）2~4 字；语义说明一律走 `title`（全仓 `ui/Tooltip.tsx` 接管）；
 * - `Readout`：**图标读数** —— 图标 ＋ 数字；单位/口径走 `title`。
 *
 * 样式全部挂在 `.hud` 命名空间（`ui/layout-css/_hud-industry.css`）⇒ 不影响任何既有页面。
 */
import type { ReactNode } from 'react'
import { Glyph } from './Glyphs'

export function IconBtn({
  glyph,
  label,
  title,
  primary,
  disabled,
  onClick,
}: {
  glyph: string
  label?: string
  title: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      className={`hud-btn${primary ? ' is-primary' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Glyph name={glyph} size={14} color="currentColor" />
      {label !== undefined ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
    </button>
  )
}

export function Readout({ glyph, value, title }: { glyph: string; value: ReactNode; title: string }): ReactNode {
  return (
    <span className="hud-row" style={{ gap: 6 }} title={title}>
      <Glyph name={glyph} size={13} color="currentColor" />
      <b>{value}</b>
    </span>
  )
}
