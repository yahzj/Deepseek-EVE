import type { GameState, WorkReturnProgress } from './state'
import type { SimContext } from './types'
import { cargoUsedM3Of, cargoCapacityM3Of } from './inventory'
import { fleetDefOf } from './instances'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from './jumpFuel'

export function cargoHoldRatio(state: GameState, ctx: SimContext, shipId: string): number {
  const used = Math.max(0, cargoUsedM3Of(state, ctx, shipId))
  const def = fleetDefOf(state, ctx, shipId)
  const base = def?.cargoM3 && def.cargoM3 > 0 ? def.cargoM3 : cargoCapacityM3Of(state, ctx, shipId)
  if (!base || base <= 0) return 1
  return Math.min(1, Math.max(0, used / base))
}

export function scaledReturnMs(fullMs: number, state: GameState, ctx: SimContext, shipId: string, fuelMul = 1): number {
  const base = Math.max(1, Math.round(fullMs * cargoHoldRatio(state, ctx, shipId)))
  return jumpFuelLegMsOf(base, fuelMul)
}

export function workReturnLeg(state: GameState, activity: 'mine' | 'salvage', baseMs: number, progress: WorkReturnProgress): {
  legMs: number; phaseAccMs: number
} {
  const returning = progress.phase === 'returning'
  const fuelMul = returning ? progress.fuelMul ?? 1 : beginJumpFuelLeg(state, activity, baseMs)
  const legMs = jumpFuelLegMsOf(baseMs, fuelMul)
  const elapsed = returning ? progress.phaseAccMs
    : progress.phase === 'outbound' ? Math.round(progress.phaseAccMs * 2 / fuelMul) : 0
  return { legMs, phaseAccMs: Math.min(legMs, Math.max(0, elapsed)) }
}
