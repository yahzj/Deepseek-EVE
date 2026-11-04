import { expect } from 'vitest'
import type { GameState } from '../../src/state'
import type { SimContext } from '../../src/types'
import { advanceGame } from '../../src/engine'

/** 非出发专项先真实走完等待，再验证原领域行为；不删状态或跳过引擎。 */
export function finishDeparture(state: GameState, ctx: SimContext): void {
  const leg = state.departure
  if (!leg) return
  advanceGame(state, Math.max(1, leg.undockMs + leg.gateMs - leg.progressMs), ctx)
  expect(state.departure, '出发等待应已完成').toBeUndefined()
}
