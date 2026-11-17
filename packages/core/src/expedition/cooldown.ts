import type { GameState } from '../state'
import type { SimContext } from '../types'
import { fleetDefOf } from '../instances'

export const BOUNTY_COOLDOWN_BASE_MS = 10_000

export const BOUNTY_COOLDOWN_REF_RES = 500

export function bountyCooldownMsFor(state: GameState, ctx: SimContext): number {
  const res = fleetDefOf(state, ctx, state.shipId)?.scanResMm ?? BOUNTY_COOLDOWN_REF_RES
  const factor = Math.pow(BOUNTY_COOLDOWN_REF_RES / Math.max(1, res), 0.5)
  return Math.max(1000, Math.round(BOUNTY_COOLDOWN_BASE_MS * factor))
}

export function setBountyCooldown(state: GameState, ctx: SimContext, anomalyId: string): void {
  state.bountyCooldowns[anomalyId] = state.gameMs + bountyCooldownMsFor(state, ctx)
}

export function bountyCooldownRemainingMs(state: GameState, anomalyId: string): number {
  const until = state.bountyCooldowns[anomalyId]
  if (typeof until !== 'number' || !Number.isFinite(until)) return 0
  const remain = until - state.gameMs
  if (remain <= 0) {
    delete state.bountyCooldowns[anomalyId]
    return 0
  }
  return remain
}
