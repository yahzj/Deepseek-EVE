import { ceilFinalQuantity } from './quantity'
import type { GameState } from './state'

export const DSI_FACTION_ID = 'dsi'

export function standingOf(state: GameState, factionId: string): number {
  return state.standingsEarned?.[factionId] ?? state.standings[factionId] ?? 0
}

export function spendableStandingOf(state: GameState, factionId: string): number {
  return state.standings[factionId] ?? 0
}

export function noteStandingEarned(state: GameState, factionId: string, v: number): void {
  const add = Math.max(0, ceilFinalQuantity(v))
  state.standings[factionId] = Math.max(0, (state.standings[factionId] ?? 0) + add)
  state.standingsEarned = state.standingsEarned ?? {}
  state.standingsEarned[factionId] = Math.max(0, (state.standingsEarned[factionId] ?? 0) + add)
}

export function spendStanding(state: GameState, factionId: string, v: number): boolean {
  const need = Math.max(0, ceilFinalQuantity(v))
  const have = state.standings[factionId] ?? 0
  if (have < need) return false
  state.standings[factionId] = have - need
  return true
}
