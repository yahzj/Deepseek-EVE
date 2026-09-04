/**
 * V12 舰船剪影（战斗场景用）：按 role 生成线描舰形，带引擎尾焰脉冲。
 * 与 Glyph 同一语言（currentColor 描边、几何构成），可镜像翻转（敌我相向/转身）。
 * 翻转实现为"绕舰体中心 scaleX(-1)"：flip 切换时 CSS 过渡平滑转身（船头跟随运动方向）。
 */
import type { ShipRole } from '@whale/core'
import { SHIP_ROLE_LABELS } from '@whale/core'

/** role → 线描舰形路径（船头朝右，viewBox 0 0 140 64） */
function hullPath(role: ShipRole): string {
  switch (role) {
    case 'armed':
      // 尖翼突击舰
      return 'M14 36 L70 8 L88 16 L124 30 L70 32 L70 24 L52 34 L14 36 Z M70 24 L70 32 L70 32'
    case 'armored':
      // 厚壳重甲舰
      return 'M20 12 h86 a8 8 0 0 1 8 8 v24 a8 8 0 0 1 -8 8 h-86 a8 8 0 0 1 -8 -8 v-24 a8 8 0 0 1 8 -8 z M28 24 h64 M20 40 h84'
    case 'hauler':
      // 长体货舰
      return 'M8 22 h96 l14 6 v8 l-14 6 h-96 a6 6 0 0 1 -6 -6 v-8 a6 6 0 0 1 6 -6 z M20 28 h70 M20 36 h70'
    default:
      // industrial：方正作业船 + 顶部作业塔
      return 'M22 16 h78 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-78 a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6 z M28 26 h68 M28 34 h68 M44 8 h20 l4 8 h-28 z'
  }
}

/** 引擎尾焰（x 从 14 反向？放在舰尾；形状独立于舰形，船头朝右 => 尾焰在左） */
const EXHAUST = 'M10 24 L2 30 L10 36 L14 30 Z'

export function ShipSprite({
  role,
  name,
  flip = false,
  accent = '#8aa0b8',
  engine = true,
  size = 150,
}: {
  role: ShipRole
  name?: string
  /** 镜像（头朝左）；战斗画面按移动方向动态切换，CSS 过渡平滑转身 */
  flip?: boolean
  accent?: string
  engine?: boolean
  size?: number
}) {
  return (
    <div className="app-sprite" style={{ width: size, height: Math.round(size * 0.46) }}>
      <svg viewBox="0 0 140 64" width="100%" height="100%" fill="none" aria-hidden="true">
        <g
          style={{
            transform: `scale(${flip ? -1 : 1}, 1)`,
            transformOrigin: '70px 32px', // 绕舰体中心翻转（配合 transform-box: view-box）
            color: accent,
          }}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          {engine ? <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" /> : null}
          <path d={hullPath(role)} />
        </g>
      </svg>
      {name ? <div className="app-sprite-name">{name}</div> : null}
    </div>
  )
}

export function roleLabel(role: ShipRole): string {
  return SHIP_ROLE_LABELS[role] ?? role
}
