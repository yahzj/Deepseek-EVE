import { strict as assert } from 'node:assert'
import type { GameState } from '../../src/state'
import type { SimContext } from '../../src/types'
import { setFleetRange } from '../../src/fleetRange'

/** 通过正式命令设置当前编队默认；真实入场负责补齐射程证据。 */
export function setFleetDistance(state: GameState, ctx: SimContext, desireM: number | null): void {
  assert.equal(setFleetRange(state, ctx, desireM).ok, true)
}
