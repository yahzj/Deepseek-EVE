/**
 * 左侧导航「出港」上方的驾驶舰船状态窗（2026-09-10 船长定）：
 * - 只展示当前驾驶舰船的独立矢量形（与战斗画面同款 25 舰资产），内部无任何文字；
 * - 根据驾驶船当前活动给"些许表现不同"（纯 CSS 轻动画，不碰引擎）：
 *     is-combat 交火中(震动 + 危险红光) / is-travel 航行中(摇摆 + 尾焰) /
 *     is-work   作业中(浮动 + 尾焰)     / is-field  野外驻留(静态冷光) /
 *     is-docked 停靠空间站(呼吸微光, 尾焰熄)
 * - 2026-09-10（船长反馈）：切换驾驶舰船时双图层交叉过渡（旧舰淡出左移 + 新舰滑入淡入，
 *   约 0.45s），不做瞬间替换；过渡只绑定 defId 变化，活动状态变化不触发切换层。
 */
import { useEffect, useRef, useState } from 'react'
import type { ShipRole } from '@whale/core'
import { fleetDefOf } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from './ShipSprite'

const SWITCH_MS = 520 // 稍长于 CSS 过渡(450ms)，旧层完全结束后再卸载

export function ShipStatusWin({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const def = fleetDefOf(state, engine.ctx, state.shipId)
  const b = state.expedition.battle

  let cls: 'combat' | 'travel' | 'work' | 'field' | 'docked' = 'docked'
  let engineOn = false
  if (state.expedition.active && b) {
    cls = 'combat' // 实时交火
    engineOn = true
  } else if (state.hauling.active) {
    cls = 'travel' // 长途运输：逐段真实航程航行
    engineOn = true
  } else if (state.mining.active) {
    cls = state.mining.phase === 'returning' ? 'travel' : 'work' // 返航 = 航行
    engineOn = true
  } else if (state.salvaging.active) {
    cls = state.salvaging.phase === 'returning' ? 'travel' : 'work'
    engineOn = true
  } else if (state.scanning.active) {
    cls = state.scanning.returning ? 'travel' : 'work'
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

  return (
    <div className={`app-shipwin is-${cls}`} aria-hidden="true">
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
