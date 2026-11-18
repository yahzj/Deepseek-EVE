import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { fleetDefOf, weekendFlagshipBattleActive } from '@whale/core'
import type { GameState } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from './ShipSprite'
import { mountsOf } from './shipMounts'
import { toneOf } from './Glyphs'
import { tr } from '../i18n/locale'

import { WORK_ACCENT as WORK_ACCENT_TABLE } from './tones'

export const WORK_ACCENT = WORK_ACCENT_TABLE as Partial<Record<ShipwinScene, string>>

const SWITCH_MS = 520
const BG_SWITCH_MS = 480

export type ShipwinScene =
  | 'combat'
  | 'travel'
  | 'work-mine'
  | 'work-salvage'
  | 'work-scan'
  | 'work-haul'
  | 'field'
  | 'docked'

export function sceneOfShipwin(state: GameState): ShipwinScene {
  const b = state.expedition.battle
  if (state.wormhole.run?.battle) return 'combat'
  if (weekendFlagshipBattleActive(state)) return 'combat'
  if (state.encounter.active && state.encounter.battle !== null && state.encounter.shipId === state.shipId) return 'combat'
  if (state.expedition.active && b) return 'combat'
  if (state.hauling.active) return 'work-haul'
  if (state.mining.active) return state.mining.phase === 'returning' ? 'travel' : 'work-mine'
  if (state.salvaging.active) return state.salvaging.phase === 'returning' ? 'travel' : 'work-salvage'
  if (state.wormholeScan?.active === true) return 'work-scan'
  if (state.expedition.active) return 'travel'
  if (state.transit.active) return 'travel'
  if (state.standby.active) return 'field'
  if (state.awayGalaxy !== null) return 'field'
  return 'docked'
}

const FX_W = 148
const FX_H = 66

const STAR_BASE: Array<[number, number, number]> = [
  [8, 14, 0.6], [24, 50, 0.7], [40, 6, 0.9], [56, 62, 0.5], [72, 36, 0.6],
  [88, 4, 0.8], [104, 54, 0.6], [122, 18, 0.9], [140, 60, 0.5], [12, 32, 0.7],
  [30, 8, 0.6], [46, 46, 0.9], [60, 16, 0.5], [78, 64, 0.6], [94, 40, 0.7],
  [110, 5, 0.5], [128, 56, 0.8], [144, 20, 0.6], [16, 62, 0.5], [34, 30, 0.6],
  [52, 10, 0.7], [68, 52, 0.5], [86, 60, 0.7], [100, 34, 0.5], [118, 7, 0.9],
  [134, 14, 0.5], [6, 58, 0.6], [50, 38, 0.8],
]
const STAR_COUNT: Record<ShipwinScene, number> = {
  docked: 0,
  'work-mine': 14,
  'work-salvage': 14,
  'work-scan': 16,
  'work-haul': 20,
  travel: 28,
  field: 9,
  combat: 8,
}

export function ShipStatusWin({
  engine,
  restore,
  onNavigateShip,
}: {
  engine: GameEngine
  restore?: { title: string; onRestore: () => void } | null
  onNavigateShip?: () => void
}) {
  const state = engine.state
  const def = fleetDefOf(state, engine.ctx, state.shipId)
  const cls = sceneOfShipwin(state)
  const engineOn = cls === 'combat' || cls === 'travel' || cls === 'work-mine' || cls === 'work-salvage' || cls === 'work-scan'
  if (!def) return null
  const accent = WORK_ACCENT[cls] ?? toneOf(def.role)

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

  const starN = STAR_COUNT[cls]
  const sky: ReactNode[] = STAR_BASE.slice(0, starN).map(([x, y, r], i) => (
    <circle key={`st${i}`} className="app-swin-star" cx={x} cy={y} r={r} />
  ))
  if (cls === 'docked') {
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
      <g key="mine-fx" className="app-swin-work is-mine">
        <path className="app-swin-wbeam" d="M104 33 H131" />
        <path className="app-swin-wrock" d="M131 27 l5 0 l3 5 l-3 5 l-5 0 l-3 -5 z" />
        <path className="app-swin-wrock" d="M134 30 l2 3 -2 3" strokeOpacity="0.45" />
        <rect className="app-swin-wchip" x="124" y="24" width="2.6" height="2.6" />
        <rect className="app-swin-wchip is-late" x="128" y="38" width="2.6" height="2.6" />
        <rect className="app-swin-wchip is-late2" x="119" y="40" width="2.6" height="2.6" />
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
      <g key="salvage-fx" className="app-swin-work is-salvage">
        <path className="app-swin-wcone" d="M104 33 L137 23 L137 43 Z" fill="currentColor" fillOpacity="0.1" />
        <path className="app-swin-wbeam" d="M104 33 H137" />
        <path className="app-swin-warc" d="M123 19 C126 14 130 11 136 9" />
        <path className="app-swin-wrock" d="M133 21 l7 3 l-5 4 z" />
        <path className="app-swin-wrock is-b" d="M138 37 l6 -2 l1 4 z" />
        <rect className="app-swin-wchip" x="126" y="28" width="2.6" height="2.6" />
        <rect className="app-swin-wchip is-late" x="130" y="35" width="2.6" height="2.6" />
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

  const handleClick = () => {
    if (restore) {
      restore.onRestore()
    } else if (onNavigateShip) {
      onNavigateShip()
    } else {
      window.dispatchEvent(new CustomEvent('whale-page-change', { detail: { page: 'ship' } }))
    }
  }
  const winTitle = restore?.title ?? tr('ui.App.002')

  return (
    <button
      type="button"
      className={`app-shipwin-wrap${restore ? ' is-restore' : ''}`}
      onClick={handleClick}
      title={winTitle}
      aria-label={winTitle}
    >
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
              <ShipSprite shipId={leaving.id} role={leaving.role} size={112} engine={false} accent={toneOf(leaving.role)} />
            </div>
          ) : null}
          <div className="app-shipwin-layer is-enter">
            <ShipSprite shipId={def.id} role={def.role} size={112} engine={engineOn} accent={accent} />
          </div>
          {/* 交火炮口火光（2026-09-10 船长批：按驾驶舰真实炮口挂载，与舰形同画布坐标系；
              无原生炮（货/矿舰等）回退舰艏前缘单点） */}
          {cls === 'combat' ? <MuzzleFlash defId={def.id} /> : null}
        </div>
      </div>
      {restore ? <span className="app-shipwin-badge">⤢</span> : null}
    </button>
  )
}

function MuzzleFlash({ defId }: { defId: string }) {
  const mounts = mountsOf(defId, undefined)
  const mz = mounts?.muzzles && mounts.muzzles.length > 0 ? mounts.muzzles : [{ x: 215, y: 55 }]
  return (
    <svg className="app-shipwin-mz" viewBox="0 0 240 110">
      {mz.map((p, i) => (
        <g
          key={i}
          className={`app-swin-muzzle${i % 2 === 1 ? ' is-low' : ''}`}
          style={{ animationDelay: `${(i % 2) * 0.55}s` }}
        >
          <path d={`M${p.x} ${p.y - 5.2} l8.2 5.2 -8.2 5.2 -8.2 -5.2 Z`} fill="rgba(255,220,140,.25)" stroke="none" />
          <path d={`M${p.x} ${p.y - 3.2} l5 3.2 -5 3.2 -5 -3.2 Z`} style={{ fill: 'rgb(var(--wui-flag))' }} stroke="none" />
        </g>
      ))}
    </svg>
  )
}
