import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { weekendDebugOn, weekendT0Of, weekendWindowOpen } from './time'
import { WEEKEND_DEBUG_AUTO_START_ENABLED, WEEKEND_FIRST_T0_WALL_MS, WEEKEND_WINDOW_MS, WEEKEND_DEBUG_ONLY, WEEKEND_DEBUG_RESTART_MS } from './constants'
import { weekendInvasionAllowedFor, weekendRollOccupation, weekendPeriodSealedByKill } from './occupation'
import { weekendLockedFamilyOf, weekendFamilyForWindow } from './family'
import type { WeekendEventState } from './model'
import { weekendCoreProgressAt } from './progress'

export function ensureWeekendEvent(state: GameState, ctx: SimContext, nowWallMs: number): boolean {
  if (weekendDebugOn(state) && !WEEKEND_DEBUG_AUTO_START_ENABLED) return false
  const ev = state.weekendEvent
  const firstT0 = WEEKEND_FIRST_T0_WALL_MS
  if (
    firstT0 !== null &&
    nowWallMs >= firstT0 - 2 * 3_600_000 &&
    nowWallMs < firstT0 + WEEKEND_WINDOW_MS
  ) {
    if (nowWallMs < firstT0 && !weekendDebugOn(state)) return false
    if (nowWallMs >= firstT0 && (ev === undefined || ev.startedAtWallMs < firstT0) && weekendInvasionAllowedFor(state)) {
      const seq = (ev?.seq ?? 0) + 1
      const rolled = weekendRollOccupation(state, ctx, seq)
      if (rolled) {
        state.weekendEvent = { seq, startedAtWallMs: firstT0, ...rolled, contributed: {} }
        return true
      }
    }
  }
  if (WEEKEND_DEBUG_ONLY && !weekendDebugOn(state)) return false
  if (weekendDebugOn(state)) {
    if (
      ev !== undefined &&
      ev.endedAtWallMs === undefined &&
      weekendLockedFamilyOf(state) !== null &&
      ev.family !== weekendLockedFamilyOf(state)
    ) {
      ev.family = weekendLockedFamilyOf(state)!
    }
    if (ev && ev.endedAtWallMs === undefined) return false
    if (ev && nowWallMs - ev.endedAtWallMs! < WEEKEND_DEBUG_RESTART_MS) return false
    const seq = (ev?.seq ?? 0) + 1
    const rolled = weekendRollOccupation(state, ctx, seq)
    if (!rolled) return false
    state.weekendEvent = { seq, startedAtWallMs: nowWallMs, ...rolled, contributed: {} }
    return true
  }
  const t0 = weekendT0Of(nowWallMs)
  if (!weekendWindowOpen(nowWallMs, t0)) return false
  if (!weekendInvasionAllowedFor(state)) return false
  if (ev && ev.endedAtWallMs === undefined) return false
  if (weekendPeriodSealedByKill(state, t0)) return false
  const seq = (ev?.seq ?? 0) + 1
  const rolled = weekendRollOccupation(state, ctx, seq, weekendFamilyForWindow(t0))
  if (!rolled) return false
  state.weekendEvent = { seq, startedAtWallMs: t0, ...rolled, contributed: {} }
  return true
}

export function endWeekendEvent(state: GameState, nowWallMs: number): WeekendEventState | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return ev
  ev.endedAtWallMs = nowWallMs
  return ev
}

export function weekendNoteFlagshipKilled(state: GameState, nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  if (weekendCoreProgressAt(state, ev, nowWallMs) < 1) return false
  ev.flagshipDown = 'player'
  endWeekendEvent(state, nowWallMs)
  return true
}

export function weekendClaimOctopus(state: GameState, ev: WeekendEventState, nowWallMs: number): boolean {
  if (ev.flagshipDown !== undefined || ev.endedAtWallMs !== undefined) return false
  ev.flagshipDown = 'octopus'
  endWeekendEvent(state, nowWallMs)
  return true
}
