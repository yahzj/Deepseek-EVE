/**
 * 左侧导航「出港」上方的驾驶舰船状态窗（2026-09-10 船长定）：
 * - 只展示当前驾驶舰船的独立矢量形（与战斗画面同款 25 舰资产），内部无任何文字；
 * - 根据驾驶船当前活动给"些许表现不同"（纯 CSS 轻动画，不碰引擎）：
 *     is-combat 交火中(震动 + 危险红光) / is-travel 航行中(摇摆 + 尾焰) /
 *     is-work   作业中(浮动 + 尾焰)     / is-field  野外驻留(静态冷光) /
 *     is-docked 停靠空间站(呼吸微光, 尾焰熄)
 */
import { fleetDefOf } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from './ShipSprite'

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

  return (
    <div className={`app-shipwin is-${cls}`} aria-hidden="true">
      <ShipSprite shipId={def.id} role={def.role} size={146} engine={engineOn} />
    </div>
  )
}
