/**
 * 科幻线性图标集（图鉴/界面通用）。
 *
 * 设计（中文说明）：
 * - 全部图标同一语言：24×24 viewBox、1.7px 描边、几何构成（圆环徽/方框徽/盾徽/菱形徽），
 *   统一 stroke 质感 = "整体统一、接近科幻风格"；
 * - 颜色不在图标内写死：stroke 用 currentColor，调用方用 tone（色相变量）上色；
 * - 形状按内容体系分族：物品=圆环徽、装备=方框徽、舰船角色=大形徽、蓝图=图纸矩形、
 *   技能=圆徽；每种形状内部用不同几何区分分类。
 */
import type { ReactNode } from 'react'

/** glyph 名 → 矢量内容（以 <g> 为单位，使用 currentColor 描边） */
const SHAPES: Record<string, ReactNode> = {
  /* ── 物品（圆环徽：外环 + 内部几何） ── */
  ore: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l4.4 5.4-4.4 5.4-4.4-5.4z" />
      <path d="M12 9l2.2 3-2.2 3-2.2-3z" />
    </g>
  ),
  mineral: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.4" y="7.4" width="9.2" height="9.2" rx="1.3" />
      <path d="M12 7.4v9.2" />
    </g>
  ),
  gas: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="7" cy="9.6" r="1.8" />
      <circle cx="11.8" cy="15.4" r="2.3" />
      <circle cx="16.6" cy="8.8" r="1.5" />
    </g>
  ),
  ice: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.8l4.6 2.6v5.2L12 17.2l-4.6-2.6V9.4z" />
      <path d="M12 11.2v1.6M10.6 12h2.8" />
    </g>
  ),
  ammo: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.2l5.7 8.3H6.3z" />
    </g>
  ),
  drone: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.9l3.1 3.1-3.1 3.1-3.1-3.1z" />
      <path d="M6 6l2.6 2.6M18 6l-2.6 2.6M6 18l2.6-2.6M18 18l-2.6-2.6" />
    </g>
  ),
  /* ── 装备（方框徽：外框 + 内部机件） ── */
  miner: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.2l3.8 3.8-3.8 3.8-3.8-3.8z" />
      <path d="M12 10.4v3.2" />
    </g>
  ),
  cargo: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M7.8 11.2h8.4M7.8 14.4h8.4" />
    </g>
  ),
  turret: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 7.6v2.3M12 14.1v2.3M7.6 12h2.3M14.1 12h2.3" />
    </g>
  ),
  shield: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.9c1.5 1 2.7 1.4 3.5 1.5v2.8c0 2.4-1.5 3.8-3.5 4.5-2-.7-3.5-2.1-3.5-4.5v-2.8c.8-.1 2-.5 3.5-1.5z" />
    </g>
  ),
  armor: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M8.2 9.6h7.6M8.8 12.3h6.4M8.2 15h7.6" />
    </g>
  ),
  propulsion: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.6c1.7 2 2.7 3.4 2.7 5a2.7 2.7 0 1 1-5.4 0c0-1.6 1-3 2.7-5z" />
      <path d="M12 7.4V8.5" />
    </g>
  ),
  /* ── 舰船角色（大形徽：双层几何轮廓） ── */
  industrial: (
    <g>
      <path d="M12 3.4l9.2 8.6-9.2 8.6-9.2-8.6z" />
      <path d="M12 7.6l5.2 4.4-5.2 4.4-5.2-4.4z" />
    </g>
  ),
  armed: (
    <g>
      <path d="M12 2.9c2.6 1.8 4.9 2.4 6.4 2.6v6.1c0 4.7-3 7.7-6.4 9.1-3.4-1.4-6.4-4.4-6.4-9.1V5.5c1.5-.2 3.8-.8 6.4-2.6z" />
      <circle cx="12" cy="12.2" r="2" />
      <path d="M12 8.4v1.8M12 14.2v1.8M7.4 12.2h1.8M14.8 12.2h1.8" />
    </g>
  ),
  armored: (
    <g>
      <path d="M12 3.8l7 4v8.4l-7 4-7-4V7.8z" />
      <path d="M12 7.2l4.4 2.6v5.2L12 17.6l-4.4-2.6V9.8z" />
    </g>
  ),
  hauler: (
    <g>
      <rect x="3.6" y="7.2" width="16.8" height="9.6" rx="1.8" />
      <path d="M7.4 12h9.2M13.6 9.4l2.6 2.6-2.6 2.6" />
    </g>
  ),
  /* ── 蓝图（图纸矩形） ── */
  blueprint: (
    <g>
      <rect x="6.2" y="3.8" width="11.6" height="16.4" rx="1.5" />
      <path d="M6.2 8.6h11.6M9.6 11.8h4.8M9.6 14.6h3" />
    </g>
  ),
  /* ── 技能组（圆徽） ── */
  'group-舰船': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.4 16.6L16.6 7.4M11.6 7.4h5v5" />
    </g>
  ),
  'group-工业': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4l4 2.3v4.6L12 16.6l-4-2.3V9.7z" />
      <circle cx="12" cy="12" r="1.4" />
    </g>
  ),
  'group-战斗': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </g>
  ),
  'group-工程': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="8.4" y="8.4" width="7.2" height="7.2" rx="1.2" />
      <circle cx="12" cy="12" r="1.2" />
    </g>
  ),
  'group-贸易': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l3.4 3.4-3.4 3.4-3.4-3.4zM12 13.6l3.4 3.4-3.4 3.4-3.4-3.4z" />
    </g>
  ),
  fallback: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="2.4" />
    </g>
  ),
}

/** 调色板：分类色调（科幻 UI 亮色系） */
export const TONES: Record<string, string> = {
  ore: '#5ee6c8',
  mineral: '#6cb6ff',
  gas: '#c792ea',
  ice: '#9ce6f5',
  ammo: '#ff8373',
  drone: '#ffc46b',
  miner: '#5ee6c8',
  cargo: '#ffd166',
  turret: '#ff8373',
  shield: '#6cb6ff',
  armor: '#cdd6e0',
  propulsion: '#ffb454',
  industrial: '#5ee6c8',
  armed: '#ff8373',
  armored: '#cdd6e0',
  hauler: '#ffd166',
  blueprint: '#d4a0ff',
  'group-舰船': '#6cb6ff',
  'group-工业': '#5ee6c8',
  'group-战斗': '#ff8373',
  'group-工程': '#ffd166',
  'group-贸易': '#ffb454',
}

/** 取色调（带兜底） */
export function toneOf(key: string | undefined): string {
  return (key && TONES[key]) || '#8aa0b8'
}

/** 渲染一个科幻线性图标 */
export function Glyph({
  name,
  size = 26,
  color,
  className,
}: {
  name: string
  size?: number
  color?: string
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name] ?? SHAPES.fallback}
    </svg>
  )
}
