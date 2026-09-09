/**
 * 左侧导航「出港」上方的驾驶舰船状态窗（2026-09-10 船长定，背景专项迭代）：
 * - 只展示当前驾驶舰船的独立矢量形（25 舰资产），内部无文字；
 * - 场景 = 活动推导（sceneOfShipwin 独立导出 = 扩展接口：后期战斗/采矿等其它环境要
 *   同步换背景时，消费同一场景类型即可，见 docs/design/shipwin-scenes-20260910.md）；
 * - 背景分层（全部 SVG 物件 + CSS 氛围，主题深蓝青系收敛，不与主题色差过大）：
 *   ① CSS 氛围层 .app-shipwin-bg（每场景独立底色/光带，换场景交叉淡入淡出过渡）；
 *   ② .app-shipwin-sky 内联 SVG（星星点阵 + 机库结构件 + 作业飘浮物，都在舰后 = 远景）；
 *   ③ 舰船双图层（切驾驶交叉过渡）；
 *   ④ 交火炮口火光层（SVG，舰前）；
 * - 星光带方向：玩家舰船头朝右、向右航行 → 背景星带向左流动（修正 2026-09-10）；
 * - 图形风格规则：视觉物件一律 SVG 线稿（conventions 第九章）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { fleetDefOf } from '@whale/core'
import type { GameState } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from './ShipSprite'

const SWITCH_MS = 520 // 稍长于 CSS 过渡(450ms)，旧层完全结束后再卸载
const BG_SWITCH_MS = 480 // 背景交叉淡入淡出时长余量

/** 场景枚举 = 状态窗扩展接口（2026-09-10：后续若战斗/采矿等其它环境要同步背景，
 *  在本类型加值 + sceneOfShipwin 推导 + 对应背景类与远景物件内容即可，不扩散到各处） */
export type ShipwinScene = 'combat' | 'travel' | 'work-mine' | 'work-salvage' | 'work-scan' | 'field' | 'docked'

/** 活动 → 场景（纯函数，独立导出：其它消费方（未来的环境背景）可复用同一推导） */
export function sceneOfShipwin(state: GameState): ShipwinScene {
  const b = state.expedition.battle
  if (state.expedition.active && b) return 'combat'
  if (state.hauling.active) return 'travel'
  if (state.mining.active) return state.mining.phase === 'returning' ? 'travel' : 'work-mine'
  if (state.salvaging.active) return state.salvaging.phase === 'returning' ? 'travel' : 'work-salvage'
  if (state.scanning.active) return state.scanning.returning ? 'travel' : 'work-scan'
  if (state.expedition.active) return 'travel'
  if (state.transit.active) return 'travel'
  if (state.standby.active) return 'field'
  if (state.awayGalaxy !== null) return 'field'
  return 'docked'
}

/** 小窗画布 = 卡片实际尺寸（viewBox 1:1 到 CSS 像素） */
const FX_W = 148
const FX_H = 66

/** 星星点阵（本地坐标 x,y,半径；太空场景按需取前 N 颗，docked 机库不显示） */
const STAR_BASE: Array<[number, number, number]> = [
  [12, 6, 0.7], [30, 3, 1.0], [52, 8, 0.6], [74, 4, 0.9], [96, 7, 0.6], [118, 3, 1.0], [138, 6, 0.7],
  [20, 15, 0.5], [46, 13, 0.7], [66, 16, 0.5], [90, 12, 0.7], [110, 15, 0.5], [130, 11, 0.6], [8, 20, 0.5],
]
const STAR_COUNT: Record<ShipwinScene, number> = {
  docked: 0, // 机库内无星空
  'work-mine': 6,
  'work-salvage': 6,
  'work-scan': 7,
  travel: 14,
  field: 5,
  combat: 4,
}

export function ShipStatusWin({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const def = fleetDefOf(state, engine.ctx, state.shipId)
  const cls = sceneOfShipwin(state)
  const engineOn = cls === 'combat' || cls === 'travel' || cls === 'work-mine' || cls === 'work-salvage' || cls === 'work-scan'
  if (!def) return null

  // ── 切换驾驶交叉过渡（旧舰淡出左移 / 新舰滑入淡入） ──
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

  // ── 场景背景切换过渡（旧背景保留 ~0.5s 淡出，新背景淡入） ──
  const prevSceneRef = useRef<ShipwinScene | null>(null)
  const [bgPrev, setBgPrev] = useState<ShipwinScene | null>(null)
  useEffect(() => {
    const prev = prevSceneRef.current
    prevSceneRef.current = cls
    if (prev !== null && prev !== cls) {
      setBgPrev(prev)
      const t = window.setTimeout(() => setBgPrev(null), BG_SWITCH_MS)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cls])

  // ── 星空 + 远景物件（舰后层；作业场景飘浮物也在这层） ──
  const starN = STAR_COUNT[cls]
  const sky: ReactNode[] = STAR_BASE.slice(0, starN).map(([x, y, r], i) => (
    <circle key={`st${i}`} className="app-swin-star" cx={x} cy={y} r={r} />
  ))
  if (cls === 'docked') {
    // 机库场景（SVG 线稿：顶棚/墙面/地板停靠格/引导灯，主题青系）
    sky.push(
      <g key="hangar" className="app-swin-hangar">
        <path d="M0 8 H148 M0 46 H148" />
        <path d="M10 8 v10 M138 8 v10" />
        <path d="M18 46 V62 M34 46 V62 M114 46 V62 M130 46 V62" />
        <path d="M44 8 h60" strokeOpacity=".6" />
        <path d="M52 52 h44" strokeOpacity=".5" />
        <circle cx="70" cy="52" r="4" fill="none" strokeOpacity=".55" />
        <path d="M96 20 l-18 -7 h-6 l-18 7" strokeOpacity=".5" />
        <path d="M96 20 v10 h-42 v-10" strokeOpacity=".5" />
      </g>,
      <circle key="gl1" className="app-swin-hangar-lamp" cx="42" cy="8" r="1.6" />,
      <circle key="gl2" className="app-swin-hangar-lamp" cx="106" cy="8" r="1.6" />,
    )
  }
  if (cls === 'work-mine') {
    sky.push(
      <g key="m1" className="app-swin-drift is-rock" style={{ animationDelay: '0s', animationDuration: '3.4s' }}>
        <path d="M1 6 L5 1 L11 2 L13 7 L9 12 L2 10 Z" />
        <path d="M5 3 l4 1 M4 8 l3 -1 M9 9 l2 -1" strokeOpacity="0.45" />
      </g>,
      <g key="m2" className="app-swin-drift is-rock is-small" style={{ animationDelay: '1.6s', animationDuration: '4.4s' }}>
        <path d="M1 4 L6 1 L9 3 L8 6 L3 7 Z" />
      </g>,
    )
  } else if (cls === 'work-salvage') {
    sky.push(
      <g key="s1" className="app-swin-drift is-debris" style={{ animationDelay: '0.4s', animationDuration: '3s' }}>
        <path d="M1 4 L6 0 L11 2 L9 6 L3 7 Z" />
        <path d="M6 1 l1 3 M3 5 l3 0" strokeOpacity="0.45" />
      </g>,
      <g key="s2" className="app-swin-drift is-debris is-small" style={{ animationDelay: '1.9s', animationDuration: '4s' }}>
        <path d="M0 3 L5 1 L7 4 L4 6 Z" />
      </g>,
    )
  } else if (cls === 'work-scan') {
    sky.push(
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

  return (
    <div className={`app-shipwin is-${cls}`} aria-hidden="true">
      {/* 背景氛围层（换场景交叉过渡） */}
      {bgPrev !== null ? <div className={`app-shipwin-bg is-prev bg-${bgPrev}`} /> : null}
      <div className={`app-shipwin-bg is-cur bg-${cls}`} />
      {/* 星空/机库/远景物件（舰后） */}
      <svg className="app-shipwin-sky" viewBox={`0 0 ${FX_W} ${FX_H}`} preserveAspectRatio="none">
        {sky}
      </svg>
      {/* 舰船双层 */}
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
      {/* 交火炮口火光（舰前） */}
      {cls === 'combat' ? (
        <svg className="app-shipwin-mz" viewBox={`0 0 ${FX_W} ${FX_H}`} preserveAspectRatio="none">
          <g className="app-swin-muzzle" style={{ animationDelay: '0s' }}>
            <path d="M106 19.1 l8.2 5.2 -8.2 5.2 -8.2 -5.2 Z" fill="rgba(255,220,140,.25)" stroke="none" />
            <path d="M106 21.1 l5 3.2 -5 3.2 -5 -3.2 Z" fill="#ffe9a8" stroke="none" />
          </g>
          <g className="app-swin-muzzle is-low" style={{ animationDelay: '0.55s' }}>
            <path d="M105 27.5 l6.8 4.4 -6.8 4.4 -6.8 -4.4 Z" fill="rgba(255,214,130,.28)" stroke="none" />
            <path d="M105 29.7 l4.2 2.7 -4.2 2.7 -4.2 -2.7 Z" fill="#ffe0a0" stroke="none" />
          </g>
        </svg>
      ) : null}
    </div>
  )
}
