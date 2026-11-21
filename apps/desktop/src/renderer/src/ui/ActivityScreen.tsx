import { memo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { fleetDefOf, getMiningParams, matterTechScanCut, salvagerCyclesOf, wormholeScanWindowMs } from '@whale/core'
import type { GameState, ShipRole, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'
import { toneOf } from './Glyphs'
import { sceneOfShipwin, WORK_ACCENT } from './ShipStatusWin'
import type { ShipwinScene } from './ShipStatusWin'
import { ACTIVITY_SCENES, ACT_H, ACT_W } from './activityArt'
import type { ActSceneId } from './activityArt'
import { WinBox } from './WinBox'


export type ActivityKind = 'mine' | 'salvage' | 'haul' | 'scan'

const HOUR = 3_600_000

function activityOf(scene: ShipwinScene): ActivityKind | null {
  switch (scene) {
    case 'work-mine':
      return 'mine'
    case 'work-salvage':
      return 'salvage'
    case 'work-haul':
      return 'haul'
    case 'work-scan':
      return 'scan'
    default:
      return null
  }
}

export function activityKindOf(state: GameState): ActivityKind | null {
  return activityOf(sceneOfShipwin(state))
}


function sceneIdOf(kind: ActivityKind, state: GameState): ActSceneId {
  if (kind === 'haul') return (state.hauling.fleetLeg ? state.hauling.fleetLeg.positioning || state.hauling.fleetLeg.returning : state.hauling.tripLegsLeft <= 1) ? 'haul-pos' : 'haul'
  return kind
}

const SCENE_CLASS: Record<ActivityKind, ShipwinScene> = {
  mine: 'work-mine',
  salvage: 'work-salvage',
  haul: 'work-haul',
  scan: 'work-scan',
}

const BEAT_MIN_MS = 1_600
const BEAT_MAX_MS = 12_000

function beatStyle(cycleMs: number | null, progress: number | null): CSSProperties | undefined {
  if (cycleMs === null || progress === null || cycleMs <= 0) return undefined
  const cycle = Math.min(BEAT_MAX_MS, Math.max(BEAT_MIN_MS, cycleMs))
  return { '--act-cycle': `${Math.round(cycle)}ms`, '--act-delay': `-${Math.round(cycle * progress)}ms` } as CSSProperties
}

const ActArt = memo(function ActArt({
  sceneId,
  shipId,
  role,
  accent,
}: {
  sceneId: ActSceneId
  shipId?: string
  role?: ShipRole
  accent: string
}) {
  const Scene = ACTIVITY_SCENES[sceneId]
  return <Scene fx={{ shipId, role, accent, engine: true }} />
})


interface Readout {
  title: string
  lines: string[]
  progress: number | null
  progressLabel: string
  cycleMs: number | null
}

function readoutOf(kind: ActivityKind, state: GameState, ctx: SimContext): Readout {
  if (kind === 'mine') {
    const m = state.mining
    const p = getMiningParams(state, ctx)
    const belt = m.beltId !== null ? ctx.belts.get(m.beltId)?.name : undefined
    const cycle = p?.cycleMs ?? 0
    return {
      title: tr('ui.ActivityWin.001'),
      lines: [
        `${tr('ui.ActivityWin.010')}${belt ?? '—'}`,
        `${tr('ui.ActivityWin.011')}${m.tripUnits.toLocaleString('zh-CN')}`,
        `${tr('ui.ActivityWin.012')}${(p?.unitsPerCycle ?? 0).toLocaleString('zh-CN')}`,
      ],
      progress: cycle > 0 ? Math.min(1, m.cycleAccMs / cycle) : null,
      progressLabel: tr('ui.ActivityWin.020'),
      cycleMs: cycle > 0 ? cycle : null,
    }
  }
  if (kind === 'salvage') {
    const s = state.salvaging
    const cycles = salvagerCyclesOf(state, ctx, state.shipId)
    const stepMs = cycles.length > 0 ? Math.min(...cycles) : 0
    const working = s.phase === 'salvaging'
    return {
      title: tr('ui.ActivityWin.002'),
      lines: [
        `${tr('ui.ActivityWin.013')}${Math.round(s.tripM3).toLocaleString('zh-CN')} m³`,
        `${tr('ui.ActivityWin.018')}${cycles.length}`,
        `${tr('ui.ActivityWin.019')}${(stepMs / 1000).toFixed(1)} s`,
      ],
      progress: working && stepMs > 0 ? Math.min(1, s.cycleAccMs / stepMs) : null,
      progressLabel: tr('ui.ActivityWin.023'),
      cycleMs: working && stepMs > 0 ? stepMs : null,
    }
  }
  if (kind === 'haul') {
    const h = state.hauling
    const a = h.routeA === null ? tr('ui.ActivityWin.004') : (ctx.stations.get(h.routeA)?.name ?? h.routeA)
    const b = h.routeB === null ? tr('ui.ActivityWin.004') : (ctx.stations.get(h.routeB)?.name ?? h.routeB)
    const to = h.toSiteId === null ? tr('ui.ActivityWin.004') : (ctx.stations.get(h.toSiteId)?.name ?? h.toSiteId)
    const positioning = h.fleetLeg ? h.fleetLeg.positioning : h.tripLegsLeft <= 1
    const returning = h.fleetLeg?.returning === true
    return {
      title: tr(returning ? 'ui.industrial.007' : positioning ? 'ui.ActivityWin.030' : 'ui.ActivityWin.003'),
      lines: [
        `${tr('ui.ActivityWin.014')}${a} ⇄ ${b}`,
        `${tr('ui.ActivityWin.015')}${to}`,
        returning ? tr('ui.industrial.007') : positioning ? tr('ui.ActivityWin.031') : `${tr('ui.ActivityWin.016')}×${h.tripMul.toFixed(1)}`,
      ],
      progress: h.legMs > 0 ? Math.min(1, h.phaseAccMs / h.legMs) : null,
      progressLabel: tr('ui.ActivityWin.021'),
      cycleMs: h.legMs > 0 ? h.legMs : null,
    }
  }
  const sc = state.wormholeScan ?? { active: false, progressMs: 0 }
  const win = wormholeScanWindowMs(state, matterTechScanCut(state, ctx))
  const totalH = win / HOUR
  const doneH = sc.progressMs / HOUR
  const pct = win > 0 ? Math.min(100, Math.floor((sc.progressMs / win) * 100)) : 0
  return {
    title: tr('ui.ActivityWin.005'),
    lines: [
      `${tr('ui.ActivityWin.017')}${doneH.toFixed(1)} h / ${totalH.toFixed(1)} h（${pct}%）`,
      tr('ui.ActivityWin.024', { p1: win > 0 ? Math.max(0, (win - sc.progressMs) / HOUR).toFixed(1) : '—' }),
    ],
    progress: win > 0 ? Math.min(1, sc.progressMs / win) : null,
    progressLabel: tr('ui.ActivityWin.022'),
    cycleMs: win > 0 ? win : null,
  }
}


export function ActivityScreen({
  state,
  ctx,
  open,
  onMinimize,
}: {
  state: GameState
  ctx: SimContext
  open: boolean
  onMinimize: () => void
}): ReactNode {
  const kind = activityKindOf(state)
  if (kind === null) return null
  const r = readoutOf(kind, state, ctx)
  const def = fleetDefOf(state, ctx, state.shipId)
  const accent = WORK_ACCENT[SCENE_CLASS[kind]] ?? toneOf(def?.role)
  return (
    <WinBox
      variant="app-winbox is-activity"
      title={r.title}
      open={open}
      onMinimize={onMinimize}
      minimizeText={tr('ui.ActivityWin.006')}
      minimizeTitle={tr('ui.ActivityWin.032')}
    >
      <div className={`app-act-stage bg-${SCENE_CLASS[kind]}`} style={beatStyle(r.cycleMs, r.progress)}>
        <svg
          className="app-act-svg"
          viewBox={`0 0 ${ACT_W} ${ACT_H}`}
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <ActArt sceneId={sceneIdOf(kind, state)} shipId={def?.id} role={def?.role} accent={accent} />
        </svg>
      </div>
      <div className="app-act-dock">
        {r.lines.map((t, i) => (
          <span key={i} className="app-act-line">{t}</span>
        ))}
        {r.progress !== null ? (
          <span className="app-act-progress" title={r.progressLabel}>
            <i className="app-act-bar" style={{ width: `${Math.round(r.progress * 100)}%` }} />
            <b className="app-act-pct">{Math.round(r.progress * 100)}%</b>
          </span>
        ) : null}
      </div>
    </WinBox>
  )
}
