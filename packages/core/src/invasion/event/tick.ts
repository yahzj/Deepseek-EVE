import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import type { WeekendTickResult } from './model'
import { ensureWeekendEvent, weekendClaimOctopus, endWeekendEvent } from './lifecycle'
import { weekendFlagshipView, weekendIsBossFamily, weekendOctopusTick } from './boss'
import { weekendDebugOn, weekendT0Of } from './time'
import { WEEKEND_WINDOW_MS, WEEKEND_WINDOW_END_HOLD_MS, weekendOccupiedIds, WEEKEND_OCTOPUS_HOLD_MS, WEEKEND_BOSS_TICK_MAX_MS } from './constants'
import { weekendEncounterChanceAt } from './progress'

export function weekendTick(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
  lastSeenWallMs: number,
  flagshipBattleActive = false,
): WeekendTickResult {
  const started = flagshipBattleActive ? false : ensureWeekendEvent(state, ctx, nowWallMs)
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) {
    return { started, flagshipShown: false, flagshipAnchored: false, ended: false, encounterRolls: [] }
  }

  const view = weekendFlagshipView(state, ev, nowWallMs, lastSeenWallMs)
  let flagshipAnchored = false
  if (view.shown && ev.flagshipAtWallMs === undefined && view.down === undefined) {
    ev.flagshipAtWallMs = view.atWallMs ?? nowWallMs
    flagshipAnchored = true
  }

  let ended = false
  let flagshipDown: WeekendTickResult['flagshipDown']
  if (!flagshipBattleActive && view.down === 'octopus' && weekendClaimOctopus(state, ev, nowWallMs)) {
    flagshipDown = 'octopus'
    ended = true
  }

  if (!ended && !weekendDebugOn(state)) {
    const summoned = ev.beaconLit === true
    const due = summoned
      ? nowWallMs >= ev.startedAtWallMs + WEEKEND_WINDOW_MS
      : weekendT0Of(nowWallMs) > ev.startedAtWallMs
    if (due) {
      if (flagshipBattleActive) {
        ev.windowEndHoldUntilWallMs = nowWallMs + WEEKEND_WINDOW_END_HOLD_MS
      } else if (nowWallMs >= (ev.windowEndHoldUntilWallMs ?? 0)) {
        endWeekendEvent(state, nowWallMs)
        ended = true
      }
    }
  }

  const encounterRolls = weekendOccupiedIds(ev)
    .map((id) => ({ galaxyId: id, chance: weekendEncounterChanceAt(state, ev, id, nowWallMs) }))
    .filter((x) => x.chance > 0)

  return { started, flagshipShown: view.shown, flagshipAnchored, ...(flagshipDown !== undefined ? { flagshipDown } : {}), ended, encounterRolls }
}

export function weekendTickBoss(
  state: GameState,
  nowWallMs: number | undefined,
  inBattle: boolean,
  flagshipBattleActive = false,
): { down?: 'octopus' } {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return {}
  if (!weekendIsBossFamily(ev)) return {}
  if (ev.flagshipDown !== undefined) return {}
  if (nowWallMs === undefined || !Number.isFinite(nowWallMs)) return {}
  const last = ev.bossTickWallMs
  const gap = Math.max(0, nowWallMs - (last ?? nowWallMs))
  ev.bossTickWallMs = nowWallMs
  if (flagshipBattleActive) ev.octopusHoldUntilWallMs = nowWallMs + WEEKEND_OCTOPUS_HOLD_MS
  if (last === undefined) return {}
  const dt = Math.min(gap, WEEKEND_BOSS_TICK_MAX_MS)
  if (ev.flagshipHpMax === undefined) return {}
  if (inBattle || nowWallMs < (ev.octopusHoldUntilWallMs ?? 0)) return {}
  if (weekendOctopusTick(state, ev, dt, inBattle)) {
    return weekendClaimOctopus(state, ev, nowWallMs) ? { down: 'octopus' } : {}
  }
  return {}
}
