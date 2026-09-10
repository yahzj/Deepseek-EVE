/**
 * 无人机机体与弹道形制资产（2026-09-10 船长批第一批：战斗动画差异化）。
 *
 * 口径（docs/design/drone-combat-animation-20260910.md，已确认）：
 * - 颜色按弹型（动能金/高爆橙/能量青）——机型只决定**弹点形制与密度**，不夺颜色语言；
 * - 蜂鸟/赤鸢/猎鹰 = 放飞-回巢（母舰**上侧**编队）；雷鸥哨戒 = **常驻伴飞（母舰下方）**，
 *   多架只显示 1 架；
 * - 每型显示上限 6 架，超出以 ×N 徽标表达；
 * - 视觉纪律：机体与弹点一律 SVG 线稿（禁 CSS 拼形状；动作走 CSS 动画 + 类切换）。
 */
import type { ReactNode } from 'react'

export interface DroneSlot {
  x: number
  y: number
}
export interface DroneModel {
  /** 机型短名（图例/徽标用中文优先） */
  name: string
  /** 机体描边色（弹点仍按弹型着色） */
  tint: string
  /** 常驻伴飞（哨戒型：不回收、多架只显示 1 架） */
  resident?: boolean
  /** 编队悬浮位（px，相对母舰锚点；放飞后就位、回巢前离位） */
  slots: DroneSlot[]
  /** 蜂群弹点形制：len = 弹点长度(px)、width = 粗细(px)、tail = 是否拖尾细线 */
  bolt: { len: number; width: number; tail: boolean }
  /** 机体形（本地 −12..12 × −7..7 画布，线稿；currentColor 描边） */
  art: ReactNode
}

/** 编队位（母舰上侧，按机型分三层避免叠在一起） */
const SLOTS_HIGH = (y: number): DroneSlot[] => [
  { x: -52, y },
  { x: -26, y: y - 7 },
  { x: 0, y: y - 3 },
  { x: 26, y: y - 8 },
  { x: 50, y: y - 1 },
  { x: 14, y: y - 15 },
]

export const DRONE_MODELS: Record<string, DroneModel> = {
  'drone-scout': {
    name: '蜂鸟',
    tint: '#9fe8ff',
    slots: SLOTS_HIGH(-26),
    bolt: { len: 7, width: 1.6, tail: false },
    art: (
      <g>
        <path d="M12 0 L-2 -3 L-9 -6 L-4 -2 L-11 0 L-4 2 L-9 6 L-2 3 Z" />
        <circle cx="2" cy="0" r="1.1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-assault': {
    name: '赤鸢',
    tint: '#ffb98a',
    slots: SLOTS_HIGH(-46),
    bolt: { len: 10, width: 2.2, tail: false },
    art: (
      <g>
        <path d="M11 0 L1 -2 L-2 -8 L-5 -2 L-11 0 L-5 2 L-2 8 L1 2 Z" />
        <path d="M-2 -2 h6" className="app-bts-drone-line" />
      </g>
    ),
  },
  'drone-heavy': {
    name: '猎鹰',
    tint: '#cdd6e0',
    slots: SLOTS_HIGH(-64),
    bolt: { len: 14, width: 3, tail: true },
    art: (
      <g>
        <path d="M11 1 H-3 L-8 5 H-12 L-7 1 V-1 L-12 -5 H-8 L-3 -1 H11 Z" />
        <path d="M-1 -3 v6" className="app-bts-drone-line" />
      </g>
    ),
  },
  'drone-sentry': {
    name: '雷鸥',
    tint: '#8fd7ef',
    resident: true,
    slots: [{ x: 6, y: 42 }],
    bolt: { len: 9, width: 1.8, tail: true },
    art: (
      <g>
        <circle cx="0" cy="0" r="4.4" />
        <path d="M4.4 0 H12" />
        <circle cx="0" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
}

/** 取机型（未收录返回 undefined → 表现层回退"普通弹道"口径） */
export function droneModelOf(artId: string | null | undefined): DroneModel | undefined {
  return artId ? DRONE_MODELS[artId] : undefined
}

/** 机型显示上限（超出以 ×N 徽标表达；2026-09-10 船长定 6 架） */
export const DRONE_SHOW_MAX = 6
/** 放飞后无开火的回巢阈值（ms；2026-09-10 船长定 1.2s） */
export const DRONE_BACK_MS = 1200
/** 回巢动画时长（ms；与 styles.css 的 keyframes 时长一致） */
export const DRONE_BACK_ANIM_MS = 420
