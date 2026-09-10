/**
 * 舰船战斗图形（2026-09-09 三号重构，补上此前缺失的资产接线）：
 * 双层取形——
 * ① 传 shipId（玩家舰 defId）/ foeKey（敌族 A~G）且命中 SHIP_ART / FOE_ART 资产表 →
 *    240×110 独立矢量形（舰首朝右；无类元素 = 主轮廓继承 currentColor 2.2 描边；
 *    面板线/族件/发光件类规则见 styles.css .shipart-*）；
 * ② 未命中（异常旧档/未录形）→ 回退 V12 role 线描剪影（140×64 放大适配，观感同旧版）。
 * 翻转 = 绕舰体中心 scaleX(-1)（CSS 过渡平滑转身，船头跟随运动方向）。
 * 引擎尾焰 2026-09-10 船长批：数量/位置对齐各舰引擎喷口——按 shipMounts.engines 逐口
 * 挂载（同尺寸焰形；喷口点 = 口沿左缘中点，焰形右尖恰好抵口）；未收录挂点的形回退旧单焰；
 * 脉冲动画沿用 .app-sprite-exhaust（纯 opacity/scale 动画，逐口由 <g> 平移隔离，互不干扰）。
 */
import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { SHIP_ROLE_LABELS } from '@whale/core'
import { FOE_ART, SHIP_ART } from './shipArt'
import { mountsOf } from './shipMounts'

/** role → 线描舰形路径（回退形；船头朝右，viewBox 0 0 140 64） */
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

/** 引擎尾焰（旧 140×64 画布形；放在舰尾、船头朝右 => 尾焰在左） */
const EXHAUST_LEGACY = 'M10 24 L2 30 L10 36 L14 30 Z'

/** 引擎尾焰（新 240×110 画布形：菱形右尖在 (24,51.6) = 贴喷口口沿锚点；2026-09-10 起
 *  逐口挂载：<g translate(口沿x−24, 口沿y−51.6)> 使右尖恰好抵住每枚喷口，焰向左喷出） */
const EXHAUST = 'M17.1 41.3 L3.4 51.6 L17.1 61.9 L24 51.6 Z'

/**
 * 尾焰挂载（2026-09-10 船长批：数量/位置对齐引擎喷口）：
 * - 有挂点数据 → 按 engines 每口一枚（同尺寸）；engines 为空（有机体异形等）→ 不画；
 * - 无挂点数据（未转录的形）→ 回退旧单焰，观感不变。
 */
function Exhausts({ shipId, foeKey }: { shipId?: string; foeKey?: string }) {
  const mounts = mountsOf(shipId, foeKey)
  if (!mounts) {
    return <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" />
  }
  return (
    <>
      {mounts.engines.map((p, i) => (
        <g key={i} transform={`translate(${p.x - 24} ${p.y - 51.6})`}>
          <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" />
        </g>
      ))}
    </>
  )
}

/** 舰体本地画布（与 .app-sprite 容器同比例：0.458 ≈ 容器高宽比 0.46，meet 无信箱边） */
const VB = '0 0 240 110'
const FLIP_ORIGIN = '120px 55px'

export function ShipSprite({
  role,
  shipId,
  foeKey,
  name,
  flip = false,
  accent = '#8aa0b8',
  engine = true,
  size = 150,
}: {
  /** 回退剪影族别（资产表未命中时使用；敌舰按族取形时可不传） */
  role?: ShipRole
  /** 玩家舰 defId：命中 SHIP_ART 资产表走独立形（缺省回退 role 剪影） */
  shipId?: string
  /** 敌舰族群 A~G：命中 FOE_ART 资产表走族形 */
  foeKey?: string
  name?: string
  /** 镜像（头朝左）；战斗画面按移动方向动态切换，CSS 过渡平滑转身 */
  flip?: boolean
  accent?: string
  engine?: boolean
  size?: number
}) {
  const art: ReactNode | undefined = shipId ? SHIP_ART[shipId] : foeKey ? FOE_ART[foeKey] : undefined
  if (art) {
    return (
      <div className="app-sprite" style={{ width: size, height: Math.round(size * 0.46) }}>
        <svg viewBox={VB} width="100%" height="100%" fill="none" aria-hidden="true">
          <g
            style={{
              transform: `scale(${flip ? -1 : 1}, 1)`,
              transformOrigin: FLIP_ORIGIN, // 绕新画布中心翻转（配合 .app-sprite svg g 的 transform-box: view-box）
              color: accent,
            }}
            stroke="currentColor"
            strokeWidth="2.2" // 主轮廓线宽（无类元素；面板/族件等 CSS 类自带线宽覆盖此值）
            strokeLinejoin="round"
          >
            {engine ? <Exhausts shipId={shipId} foeKey={foeKey} /> : null}
            {art}
          </g>
        </svg>
        {name ? <div className="app-sprite-name">{name}</div> : null}
      </div>
    )
  }

  // ── 回退形：V12 role 剪影（与重构前渲染完全一致） ──
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
          {engine ? <path className="app-sprite-exhaust" d={EXHAUST_LEGACY} fill="currentColor" stroke="none" opacity="0.85" /> : null}
          <path d={hullPath(role ?? 'industrial')} />
        </g>
      </svg>
      {name ? <div className="app-sprite-name">{name}</div> : null}
    </div>
  )
}

export function roleLabel(role: ShipRole): string {
  return SHIP_ROLE_LABELS[role] ?? role
}
