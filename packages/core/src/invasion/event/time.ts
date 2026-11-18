import type { GameState } from '../../state'
import { WEEKEND_DEBUG_TIME_DIVISOR, WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS, WEEKEND_FLAGSHIP_DEADLINE_MS, WEEKEND_START_WEEKDAY, WEEKEND_START_HOUR, WEEKEND_WINDOW_MS } from './constants'

export function weekendDebugOn(state: Pick<GameState, 'debugQuick'>): boolean {
  return state.debugQuick === true
}

export function weekendClockOf(
  state: Pick<GameState, 'savedAtWallMs'>,
  realNowMs: number = Date.now(),
): number {
  const ledger = Number.isFinite(state.savedAtWallMs) ? state.savedAtWallMs : 0
  return Math.max(realNowMs, ledger > 0 ? ledger : 0)
}

export function weekendNpcTimelineMs(state: Pick<GameState, 'debugQuick'>, baseMs: number): number {
  return weekendDebugOn(state) ? Math.max(1, Math.round(baseMs / WEEKEND_DEBUG_TIME_DIVISOR)) : baseMs
}

export function weekendFlagshipWindowMs(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS : WEEKEND_FLAGSHIP_DEADLINE_MS
}

export function weekendT0Of(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  const day = d.getDay()
  let back = (day - WEEKEND_START_WEEKDAY + 7) % 7
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WEEKEND_START_HOUR, 0, 0, 0).getTime()
  if (back === 0 && nowWallMs < at) back = 7
  return at - back * 86_400_000
}

export function weekendWindowOpen(nowWallMs: number, t0: number): boolean {
  return nowWallMs >= t0 && nowWallMs < t0 + WEEKEND_WINDOW_MS
}

export function weekendWindowMsOf(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? Math.round(WEEKEND_WINDOW_MS / WEEKEND_DEBUG_TIME_DIVISOR) : WEEKEND_WINDOW_MS
}
