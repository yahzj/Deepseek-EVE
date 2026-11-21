
import { addLog } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import { advanceGame } from './engine'
import { formatDurationMs } from './time'
import type { SettleStats } from './settleStats'
import { advanceAutoLoopBounty, advanceAutoLoopInvasion, autoLoopInvasionGalaxy } from './expedition'
import { ironmanOfflineCapBonusMs } from './ironman'
import type { UnboxResultRow } from './industry'
import type { StationAction } from './stationActivityPending'
import { offlineBoostRenewCount, setOfflineBoostTally } from './consumables'
import { beginOfflineCombatStats, newOfflineCombatStats } from './offlineCombatStats'
import { workFleetShipIds } from './workFleet'

export { formatDurationMs } from './time'

export const DEFAULT_OFFLINE_CAP_MS = 8 * 60 * 60 * 1000

export const OFFLINE_LOOP_CHUNK_MS = 30_000

export function offlineSplit(
  rawGapMs: number,
  capMs: number = DEFAULT_OFFLINE_CAP_MS,
): { deltaMs: number; overflowMs: number } {
  const raw = Math.max(0, Math.floor(rawGapMs))
  const cap = Math.max(0, Math.floor(capMs))
  return { deltaMs: Math.min(raw, cap), overflowMs: Math.max(0, raw - cap) }
}

export function offlineCapMsOf(state: GameState, baseMs: number = DEFAULT_OFFLINE_CAP_MS): number {
  const opsLv = Math.min(5, state.skills.trained['offline-ops'] ?? 0)
  const dispatchLv = Math.min(5, state.skills.trained['unattended-dispatch'] ?? 0)
  return Math.round((baseMs + ironmanOfflineCapBonusMs(state)) * (1 + 0.2 * opsLv + 0.4 * dispatchLv))
}

export function simulateOffline(
  state: GameState,
  lastSavedWallMs: number,
  nowWallMs: number,
  ctx: SimContext,
  capMs: number = DEFAULT_OFFLINE_CAP_MS,
  opts?: { freezeBattle?: boolean; stats?: SettleStats; onUnboxResult?: (result: UnboxResultRow) => void; onStationActivityStarted?: (action: StationAction) => void },
): void {
  const rawGap = nowWallMs - lastSavedWallMs
  if (rawGap <= 0) return
  const capEff = offlineCapMsOf(state, capMs)
  const { deltaMs, overflowMs } = offlineSplit(rawGap, capEff)
  if (deltaMs <= 0) return

  const beforeCounts = new Map<string, number>()
  const snapshot = (map: Record<string, number>): void => {
    for (const [id, units] of Object.entries(map)) {
      if (units > 0) beforeCounts.set(id, (beforeCounts.get(id) ?? 0) + units)
    }
  }
  const workShipIds = state.mining.active || state.salvaging.active ? workFleetShipIds(state) : [state.shipId]
  for (const id of workShipIds) snapshot(state.fleet[id]?.cargo ?? {})
  snapshot(state.warehouse.items)

  const before = state.logs.length
  addLog(
    state,
    'system',
    `离线归来：已离开 ${formatDurationMs(rawGap)}，开始结算……`,
    'core.simulation.001',
    { p1: formatDurationMs(rawGap) },
  )
  const advOpts = {
    freezeBattle: opts?.freezeBattle,
    settleStats: opts?.stats,
    onUnboxResult: opts?.onUnboxResult,
    onStationActivityStarted: opts?.onStationActivityStarted,
    nowWallMs: lastSavedWallMs + deltaMs,
    offline: true,
  }
  const driveLoop =
    !opts?.freezeBattle &&
    (state.autoLoopAnomalyId !== null || autoLoopInvasionGalaxy(state) !== null)
  let boostN = 0
  const combatStats = newOfflineCombatStats()
  if (opts?.stats) opts.stats.combat = combatStats
  const endCombatStats = beginOfflineCombatStats(state, combatStats)
  setOfflineBoostTally(true)
  try {
    if (driveLoop) {
      let remaining = deltaMs
      let guard = 0
      let wallMs = lastSavedWallMs
      while (remaining > 0) {
        if (++guard > 200_000) break
        const step = Math.min(remaining, OFFLINE_LOOP_CHUNK_MS)
        wallMs += step
        advanceGame(state, step, ctx, { ...advOpts, nowWallMs: wallMs })
        remaining -= step
        if (remaining > 0) {
          advanceAutoLoopBounty(state, ctx)
          advanceAutoLoopInvasion(state, ctx, wallMs)
        }
      }
    } else {
      advanceGame(state, deltaMs, ctx, advOpts)
    }
    boostN = offlineBoostRenewCount()
  } finally {
    endCombatStats()
    setOfflineBoostTally(false)
  }
  const eventCount = state.logs.length - before - 1

  const gained: string[] = []
  const after = new Map<string, number>()
  const snapshotAfter = (map: Record<string, number>): void => {
    for (const [id, units] of Object.entries(map)) {
      if (units > 0) after.set(id, (after.get(id) ?? 0) + units)
    }
  }
  for (const id of workShipIds) snapshotAfter(state.fleet[id]?.cargo ?? {})
  snapshotAfter(state.warehouse.items)
  for (const [id, unitsNow] of after) {
    const unitsBefore = beforeCounts.get(id) ?? 0
    if (unitsNow > unitsBefore) gained.push(`${ctx.items.get(id)?.name ?? id}×${unitsNow - unitsBefore}`)
  }
  const minedText = gained.length > 0 ? `；离线采集 ${gained.join('、')}` : ''
  const boostText = boostN > 0 ? `；自动续用突触加速剂 ×${boostN}` : ''
  const overflowTxt = formatDurationMs(overflowMs)
  const tail = overflowMs > 0 ? `；超出上限的 ${overflowTxt} 未结算` : ''
  addLog(
    state,
    'system',
    `离线结算完成：推进 ${formatDurationMs(deltaMs)}${tail}${boostText}${minedText}，期间发生 ${eventCount} 条事件。`,
    'core.simulation.002',
    {
      p1: formatDurationMs(deltaMs),
      p2: tail,
      p3: minedText,
      p4: eventCount,
      p5: boostText,
      ...(boostN > 0 ? { p5Id: 'core.simulation.003', p5p1: boostN } : {}),
      ...(overflowMs > 0 ? { p2Id: 'core.state.023', p2p1: overflowTxt } : {}),
    },
  )
}
