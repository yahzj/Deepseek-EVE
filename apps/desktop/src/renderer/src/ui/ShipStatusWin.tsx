/**
 * 左侧导航「出港」上方的驾驶舰船状态窗（2026-09-10 船长定，次日表现升级）：
 * - 只展示当前驾驶舰船的独立矢量形（与战斗画面同款 25 舰资产），内部无任何文字；
 * - 场景背景随状态变化（纯 CSS）：停靠 = 泊位暖光 / 采矿 = 矿带飘小行星 /
 *   打捞 = 残骸场飘碎片 / 扫描 = 深空信号点 / 航行 = 星流 / 驻留 = 冷星 / 交火 = 警报红光；
 * - 交火中：舰艏炮口位置开火闪光动画（两炮交替）；
 * - 切换驾驶时双图层交叉过渡（旧舰淡出左移 + 新舰滑入淡入），不瞬间替换；
 * - 过渡/背景/浮物均为轻量 CSS，不碰引擎。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { fleetDefOf } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from './ShipSprite'

const SWITCH_MS = 520 // 稍长于 CSS 过渡(450ms)，旧层完全结束后再卸载

type WinCls = 'combat' | 'travel' | 'work-mine' | 'work-salvage' | 'work-scan' | 'field' | 'docked'

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

  // 场景飘浮物：右入左出（每场景两个、错开相位；样式/形状见 styles .app-swin-drift.*）
  const driftEls: ReactNode[] = []
  if (cls === 'work-mine') {
    driftEls.push(
      <i key="m1" className="app-swin-drift is-rock" style={{ top: '7px', animationDelay: '0s', animationDuration: '3.4s' }} />,
      <i key="m2" className="app-swin-drift is-rock is-small" style={{ top: '30px', animationDelay: '1.6s', animationDuration: '4.2s' }} />,
    )
  } else if (cls === 'work-salvage') {
    driftEls.push(
      <i key="s1" className="app-swin-drift is-debris" style={{ top: '6px', animationDelay: '0.4s', animationDuration: '3s' }} />,
      <i key="s2" className="app-swin-drift is-debris is-small" style={{ top: '31px', animationDelay: '1.9s', animationDuration: '3.8s' }} />,
    )
  } else if (cls === 'work-scan') {
    driftEls.push(
      <i key="p1" className="app-swin-drift is-probe" style={{ top: '9px', animationDelay: '0s', animationDuration: '2.6s' }} />,
      <i key="p2" className="app-swin-drift is-probe is-small" style={{ top: '33px', animationDelay: '1.2s', animationDuration: '3.2s' }} />,
    )
  }

  return (
    <div className={`app-shipwin is-${cls}`} aria-hidden="true">
      <div className="app-shipwin-bg" />
      {driftEls}
      <div className="app-shipwin-stack">
        {leaving !== null ? (
          <div className="app-shipwin-layer is-leave">
            <ShipSprite shipId={leaving.id} role={leaving.role} size={112} engine={false} />
          </div>
        ) : null}
        <div className="app-shipwin-layer is-enter">
          <ShipSprite shipId={def.id} role={def.role} size={112} engine={engineOn} />
        </div>
        {cls === 'combat' ? (
          <>
            {/* 开火闪光：主炮口（舰艏右侧上）/ 副炮口（下），交替节奏 */}
            <i className="app-swin-muzzle" style={{ top: '20px', animationDelay: '0s' }} />
            <i className="app-swin-muzzle is-low" style={{ top: '29px', animationDelay: '0.55s' }} />
          </>
        ) : null}
      </div>
    </div>
  )
}
