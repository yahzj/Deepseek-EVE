import type { WeekendEventState } from './model'
import { WEEKEND_STANDING_BEACON, WEEKEND_STANDING_MAX, clamp01, WEEKEND_PROGRESS_ISK_PER_PCT, weekendOccupiedIds, WEEKEND_CONTRIBUTION_BOSS_WEIGHT } from './constants'
import { ceilFinalQuantity } from '../../quantity'
import type { GameState } from '../../state'
import { weekendProgressAt } from './progress'
import { weekendFlagshipSharesOf } from './boss'


export function weekendLastHitByPlayer(ev: WeekendEventState | undefined): boolean {
  if (!ev) return false
  return ev.flagshipPlayerKill !== undefined || ev.flagshipDown === 'player'
}

export function weekendBlackBoxSettledOf(ev: WeekendEventState | undefined): boolean {
  return ev?.flagshipBlackBox === true
}

export function weekendStandingGainOf(ev: Pick<WeekendEventState, 'beaconLit'>, share: number): number {
  return ev.beaconLit === true ? WEEKEND_STANDING_BEACON : ceilFinalQuantity(share * WEEKEND_STANDING_MAX)
}

export function weekendNoteContribution(ev: WeekendEventState, galaxyId: string, gain: number): void {
  ev.contributed[galaxyId] = clamp01((ev.contributed[galaxyId] ?? 0) + gain)
}

export function weekendPlayerContribution(ev: WeekendEventState): number {
  return Object.values(ev.contributed).reduce((a, b) => a + b, 0)
}

export function weekendProgressIncomeIsk(ev: WeekendEventState): number {
  return ceilFinalQuantity(weekendPlayerContribution(ev) * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)
}

export function weekendContributionShareAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const ids = weekendOccupiedIds(ev)
  const npc = ids.reduce((sum, id) => {
    const p = weekendProgressAt(state, ev, id, nowWallMs)
    const put = ev.contributed[id] ?? 0
    return sum + Math.max(0, p - put)
  }, 0)
  const mine = weekendPlayerContribution(ev)
  const total = npc + mine
  const clear = total <= 0 ? 0 : clamp01(mine / total)
  const boss = weekendFlagshipSharesOf(ev).player
  return clamp01(WEEKEND_CONTRIBUTION_BOSS_WEIGHT * boss + (1 - WEEKEND_CONTRIBUTION_BOSS_WEIGHT) * clear)
}

export function weekendContributionTier(share: number): { tier: 'A' | 'B' | 'C' | 'D' | 'none'; wreck: number; isk: number } {
  if (share >= 0.8) return { tier: 'A', wreck: 12, isk: 8_000_000 }
  if (share >= 0.5) return { tier: 'B', wreck: 8, isk: 5_000_000 }
  if (share >= 0.2) return { tier: 'C', wreck: 4, isk: 2_000_000 }
  if (share > 0) return { tier: 'D', wreck: 1, isk: 0 }
  return { tier: 'none', wreck: 0, isk: 0 }
}
