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
  /* V18B-1 导弹架（方框徽：导弹弹体斜置） */
  missile: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M15.6 8.4l-6.6 6.6M13.6 8.4h2v2M10.4 15.6h-2v-2" />
      <path d="M8.9 15.1L15.1 8.9" />
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
  /* V18 无人机装置（方框徽：停机甲板 / 导控阵列） */
  'drone-rack': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M9.3 9.8h1.6v1.6H9.3zM13.1 9.8h1.6v1.6h-1.6z" />
      <path d="M9 14.8h6" />
    </g>
  ),
  'drone-tac': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 9.4l2.6 2.6-2.6 2.6-2.6-2.6z" />
      <path d="M8 8l1.8 1.8M16 8l-1.8 1.8M8 16l1.8-1.8M16 16l-1.8-1.8" />
    </g>
  ),
  /* V18B-2 激光炮（方框徽：光束横贯） */
  laser: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M8.4 15.6L15.6 8.4M8.4 8.4l7.2 7.2" />
      <path d="M10.9 8.4h4.7v4.7" />
    </g>
  ),
  /* V18.1 支援件（方框徽：上升增益箭头） */
  support: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 15.2V9.4M9.8 11.4L12 9l2.2 2.4" />
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
  /* ── 界面导航/功能概念（2026-09-05 图标全 SVG 线性化：与物品/装备同语言） ── */
  /* 星图/出港（2026-09-05 船长：实心四角星——闪星） */
  'nav-map': (
    <g>
      <path fill="currentColor" stroke="none" d="M12 2L14.9 9.1L22 12L14.9 14.9L12 22L9.1 14.9L2 12L9.1 9.1Z" />
    </g>
  ),
  /* 舰船/舰队（2026-09-05 船长：帆船不像星舰，改火箭造型） */
  'nav-ship': (
    <g>
      <path d="M4.8 16.6c-1.4 1.24-1.9 4.6-1.9 4.6s3.4-.5 4.6-1.9c.65-.77.64-1.96-.08-2.74a2 2 0 0 0-2.62-.06z" />
      <path d="M12.5 14.5l-3-3a20.3 20.3 0 0 1 1.9-3.6A11.9 11.9 0 0 1 22 2c0 2.5-.7 6.9-5.5 10.1a20.6 20.6 0 0 1-4 1.9z" />
      <path d="M9.5 12H4.8s.5-2.8 1.8-3.7c1.5-1 4.6 0 4.6 0" />
      <path d="M12.5 15v4.6s2.8-.5 3.7-1.8c1-1.5 0-4.6 0-4.6" />
    </g>
  ),
  'nav-fit': (
    <g>
      <rect x="8.1" y="8.1" width="3.4" height="3.4" rx="0.8" />
      <rect x="12.5" y="8.1" width="3.4" height="3.4" rx="0.8" />
      <rect x="8.1" y="12.5" width="3.4" height="3.4" rx="0.8" />
      <rect x="12.5" y="12.5" width="3.4" height="3.4" rx="0.8" />
    </g>
  ),
  'nav-items': (
    <g>
      <rect x="5.4" y="6.8" width="13.2" height="10.4" rx="1.5" />
      <path d="M5.4 10.6h13.2" />
      <path d="M8 6.8V5h8v1.8" />
    </g>
  ),
  'nav-market': (
    <g>
      <path d="M6.4 9.2h8.4a2.8 2.8 0 0 1 2.8 2.8" />
      <path d="M15.2 6.4l2.4 2.4-2.4 2.4" />
      <path d="M17.6 14.8H9.2a2.8 2.8 0 0 1-2.8-2.8" />
      <path d="M8.8 17.6l-2.4-2.4 2.4-2.4" />
    </g>
  ),
  'nav-industry': (
    <g>
      <path d="M12 4.9l6.2 3.6v7L12 19.1l-6.2-3.6v-7z" />
      <circle cx="12" cy="12" r="2.4" />
    </g>
  ),
  'nav-skills': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6v8.8M7.6 12h8.8" />
    </g>
  ),
  /* 矿带开采/采矿（2026-09-05 船长：原工具形似扳手，改矿镐——竖柄+镐头双弯臂） */
  'nav-mine': (
    <g>
      <path d="M12 21V9.6" />
      <path d="M12 9.6C9.9 9.8 7.3 8.4 6.2 5.6" />
      <path d="M12 9.6c2.1.2 4.7-1.2 5.8-4" />
      <path d="M6.2 5.6l-.8-1.6M17.8 5.6l.8-1.6" />
    </g>
  ),
  'nav-bounty': (
    <g>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 3.2v4.4M12 16.4v4.4M3.2 12h4.4M16.4 12h4.4" />
    </g>
  ),
  'nav-salvage': (
    <g>
      <rect x="5.2" y="12.2" width="13.6" height="6.6" rx="1.4" />
      <path d="M12 4.2v7.4M8.9 7.9L12 4.8l3.1 3.1" />
    </g>
  ),
  'nav-task': (
    <g>
      <rect x="5.6" y="4.8" width="12.8" height="14.4" rx="1.8" />
      <path d="M8.6 9.4h6.8M8.6 12.6h6.8M8.6 15.8h4.2" />
    </g>
  ),
  'nav-ai': (
    <g>
      <rect x="6.9" y="9" width="10.2" height="9.2" rx="2.4" />
      <path d="M12 5.4v2.6" />
      <circle cx="12" cy="4.9" r="1.1" />
      <path d="M9.7 12.6h.9v.9h-.9zM13.4 12.6h.9v.9h-.9z" />
    </g>
  ),
  'nav-shop': (
    <g>
      <path d="M12 4.6l7.4 7.4L12 19.4 4.6 12z" />
      <path d="M12 9.4l2.6 2.6-2.6 2.6-2.6-2.6z" />
    </g>
  ),
  /* ── 界面操作概念（批2，2026-09-05：按钮/徽标字符图标 SVG 化） ── */
  'ico-home': (
    <g>
      <path d="M4 11l8-6.6L20 11" />
      <path d="M6.2 9.4V19h11.6V9.4" />
      <path d="M10.2 19v-4.4h3.6V19" />
    </g>
  ),
  'ico-lock': (
    <g>
      <rect x="6.6" y="10.6" width="10.8" height="8.2" rx="1.8" />
      <path d="M9.2 10.4V8.2a2.8 2.8 0 0 1 5.6 0v2.2" />
      <circle cx="12" cy="14.6" r="1.2" />
      <path d="M12 15.8v1.2" />
    </g>
  ),
  'ico-clock': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 2" />
    </g>
  ),
  'ico-loop': (
    <g>
      <path d="M19.4 10.2A7.6 7.6 0 1 0 19.6 14" />
      <path d="M19.4 6.4v3.8h-3.8" />
    </g>
  ),
  'ico-flag': (
    <g>
      <path d="M6.2 20.4V4.6" />
      <path d="M6.2 5.2c3.8-2 6.4.6 9.8-.9v7c-3.4 1.5-6-1.1-9.8.9z" />
    </g>
  ),
  'ico-scan': (
    <g>
      <circle cx="12" cy="12" r="5.6" />
      <path d="M12 12l4.2-4.2" />
      <path d="M9 3.4h6M3.4 9v6M15 20.6H9M20.6 15V9" />
    </g>
  ),
  'ico-swap': (
    <g>
      <path d="M8 6.6h8.4a3 3 0 0 1 0 6H11" />
      <path d="M14.8 4l2 2.6-2 2.4" />
      <path d="M16 17.4H7.6a3 3 0 0 1 0-6H13" />
      <path d="M9.2 20l-2-2.6 2-2.4" />
    </g>
  ),
  'ico-cross': (
    <g>
      <path d="M12 5.4v13.2M5.4 12h13.2" />
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
  missile: '#ff9a6b',
  laser: '#c792ea',
  shield: '#6cb6ff',
  armor: '#cdd6e0',
  propulsion: '#ffb454',
  'drone-rack': '#ffc46b',
  'drone-tac': '#ffb454',
  support: '#ff8ab5',
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

/** 导航/标签图标专属色调（2026-09-05 船长：每个图标各自纯色，未选中也着色；选中态由按钮高亮区分） */
export const NAV_TONES: Record<string, string> = {
  'nav-map': '#ffe08a',
  'nav-ship': '#6cb6ff',
  'nav-fit': '#7de3a8',
  'nav-items': '#ffd166',
  'nav-market': '#ffa45c',
  'nav-industry': '#42d9b0',
  'nav-skills': '#c792ea',
  'nav-mine': '#b5e35f',
  'nav-bounty': '#ff8373',
  'nav-salvage': '#6fe3f0',
  'nav-task': '#8fa9d8',
  'nav-ai': '#ff8ab5',
  'nav-shop': '#f7c35c',
}

/** 操作图标色调（与 NAV_TONES 同族语汇；默认跟随文本色） */
export const ICO_TONES: Record<string, string> = {
  'ico-home': '#ffd76a',
  'ico-lock': '#ff8373',
  'ico-clock': '#ffe08a',
  'ico-loop': '#6fe3f0',
  'ico-flag': '#ffca58',
  'ico-scan': '#b78bff',
  'ico-swap': '#7de3a8',
  'ico-cross': '#ff8373',
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
