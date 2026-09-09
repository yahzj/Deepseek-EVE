/**
 * 左侧导航「出港」上方的驾驶舰船状态窗（2026-09-10 船长定，次日表现升级）：
 * - 只展示当前驾驶舰船的独立矢量形（与战斗画面同款 25 舰资产），内部无任何文字；
 * - 场景背景随状态变化（氛围层 = CSS 渐变/光带；物件层 = SVG 线稿，与舰船图形同语言）：
 *   停靠 = 泊位暖光 / 采矿 = 矿带飘小行星 / 打捞 = 残骸场飘碎片 / 扫描 = 深空信号点 /
 *   航行 = 星光速度带 / 驻留 = 冷星 / 交火 = 警报红光 + 炮口开火闪光；
 * - 切换驾驶时双图层交叉过渡（旧舰淡出左移 + 新舰滑入淡入），不瞬间替换；
 * - 全部为轻量 CSS 动画（物件为 SVG 元素平移/旋转），不碰引擎。
 * 图形风格规则：新增视觉物件一律 SVG 线稿（细描边、同语言），禁止 CSS 拼形状——见
 * docs/development-conventions.md 第九章。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { fleetDefOf } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from './ShipSprite'

const SWITCH_MS = 520 // 稍长于 CSS 过渡(450ms)，旧层完全结束后再卸载

type WinCls = 'combat' | 'travel' | 'work-mine' | 'work-salvage' | 'work-scan' | 'field' | 'docked'

/** 小窗画布 = 卡片实际尺寸（viewBox 1:1 到 CSS 像素，物件动画按 px 平移） */
const FX_W = 148
const FX_H = 66

export function ShipStatusWin({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const def = fleetDefOf(state, engine.ctx, state.shipId)
  const b = state.expedition.battle

  let cls: WinCls = 'docked'
  let engineOn = false
  if (state.expedition.active && b) {
    cls = 'combat' // 实时交火
    engineOn = true
  } else if (state.hauling.active) {
    cls = 'travel' // 长途运输：逐段真实航程航行
    engineOn = true
  } else if (state.mining.active) {
    cls = state.mining.phase === 'returning' ? 'travel' : 'work-mine'
    engineOn = true
  } else if (state.salvaging.active) {
    cls = state.salvaging.phase === 'returning' ? 'travel' : 'work-salvage'
    engineOn = true
  } else if (state.scanning.active) {
    cls = state.scanning.returning ? 'travel' : 'work-scan'
    engineOn = true
  } else if (state.expedition.active) {
    cls = 'travel' // 远征返航中（去程已取消：即时开战）
    engineOn = true
  } else if (state.transit.active) {
    cls = 'travel' // 返航空间站 / 建站交付航线
    engineOn = true
  } else if (state.standby.active) {
    cls = 'field' // 掩护巡逻（含前往途中，统一驻留姿态）
  } else if (state.awayGalaxy !== null) {
    cls = 'field' // 野外停留
  }
  if (!def) return null

  // ── 切换驾驶的交叉过渡：记录上一艘，换船时把旧舰保留 ~0.5s 做淡出左移，新舰滑入淡入 ──
  const prevRef = useRef<{ id: string; role: ShipRole } | null>(null)
  const [leaving, setLeaving] = useState<{ id: string; role: ShipRole } | null>(null)
  useEffect(() => {
    if (!def) return
    const prev = prevRef.current
    prevRef.current = { id: def.id, role: def.role }
    if (prev !== null && prev.id !== def.id) {
      setLeaving(prev)
      const t = window.setTimeout(() => setLeaving(null), SWITCH_MS)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id])

  // ── 场景物件层（SVG 线稿，与舰船图形同语言；漂移动画 = g 元素 CSS translate） ──
  const fx: ReactNode[] = []
  if (cls === 'work-mine') {
    fx.push(
      <g key="m1" className="app-swin-drift is-rock" style={{ animationDelay: '0s', animationDuration: '3.4s' }}>
        <path d="M1 6 L5 1 L11 2 L13 7 L9 12 L2 10 Z" />
        <path d="M5 3 l4 1 M4 8 l3 -1 M9 9 l2 -1" strokeOpacity="0.45" />
      </g>,
      <g key="m2" className="app-swin-drift is-rock is-small" style={{ animationDelay: '1.6s', animationDuration: '4.4s' }}>
        <path d="M1 4 L6 1 L9 3 L8 6 L3 7 Z" />
      </g>,
    )
  } else if (cls === 'work-salvage') {
    fx.push(
      <g key="s1" className="app-swin-drift is-debris" style={{ animationDelay: '0.4s', animationDuration: '3s' }}>
        <path d="M1 4 L6 0 L11 2 L9 6 L3 7 Z" />
        <path d="M6 1 l1 3 M3 5 l3 0" strokeOpacity="0.45" />
      </g>,
      <g key="s2" className="app-swin-drift is-debris is-small" style={{ animationDelay: '1.9s', animationDuration: '4s' }}>
        <path d="M0 3 L5 1 L7 4 L4 6 Z" />
      </g>,
    )
  } else if (cls === 'work-scan') {
    fx.push(
      <g key="p1" className="app-swin-drift is-probe" style={{ animationDelay: '0s', animationDuration: '2.6s' }}>
        <circle cx="5" cy="5" r="3.2" />
        <circle cx="5" cy="5" r="1" fill="currentColor" stroke="none" />
      </g>,
      <g key="p2" className="app-swin-drift is-probe is-small" style={{ animationDelay: '1.2s', animationDuration: '3.4s' }}>
        <circle cx="4" cy="4" r="2.2" />
        <circle cx="4" cy="4" r="0.8" fill="currentColor" stroke="none" />
      </g>,
    )
  }
  if (cls === 'combat') {
    // 开火闪光：主/副炮口两处菱形火光（外圈柔光 + 内芯亮菱，交替相位）
    fx.push(
      <g key="f1" className="app-swin-muzzle" style={{ animationDelay: '0s' }}>
        <path d="M106 19.1 l8.2 5.2 -8.2 5.2 -8.2 -5.2 Z" fill="rgba(255,220,140,.25)" stroke="none" />
        <path d="M106 21.1 l5 3.2 -5 3.2 -5 -3.2 Z" fill="#ffe9a8" stroke="none" />
      </g>,
      <g key="f2" className="app-swin-muzzle is-low" style={{ animationDelay: '0.55s' }}>
        <path d="M105 27.5 l6.8 4.4 -6.8 4.4 -6.8 -4.4 Z" fill="rgba(255,214,130,.28)" stroke="none" />
        <path d="M105 29.7 l4.2 2.7 -4.2 2.7 -4.2 -2.7 Z" fill="#ffe0a0" stroke="none" />
      </g>,
    )
  }

  return (
    <div className={`app-shipwin is-${cls}`} aria-hidden="true">
      <div className="app-shipwin-bg" />
      <svg className="app-shipwin-fx" viewBox={`0 0 ${FX_W} ${FX_H}`} preserveAspectRatio="none">
        {fx}
      </svg>
      <div className="app-shipwin-stack">
        {leaving !== null ? (
          <div className="app-shipwin-layer is-leave">
            <ShipSprite shipId={leaving.id} role={leaving.role} size={112} engine={false} />
          </div>
        ) : null}
        <div className="app-shipwin-layer is-enter">
          <ShipSprite shipId={def.id} role={def.role} size={112} engine={engineOn} />
        </div>
      </div>
    </div>
  )
}
