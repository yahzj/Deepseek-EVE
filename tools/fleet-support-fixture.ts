/** 编队支援合成夹具，不读取个人存档。 */
import assert from 'node:assert/strict'
import { repairDroneFixture } from './make-repair-drone-save'
import { fitModule, unfitAt, cpuOverloadText } from '../packages/core/src/equipment'
import { createPlayerSpec } from '../packages/core/src/combat/player/create'

export function fleetSupportFixture() {
  const built = repairDroneFixture()
  const { state, ctx, logi, roster } = built
  for (const index of [0, 1]) assert(unfitAt(state, 'high', index, logi, ctx))
  for (const [index, id] of ['mod-shieldfield-2', 'mod-lock-3'].entries()) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 10
    const result = fitModule(state, id, ctx, { shipId: logi, rack: 'high', index })
    assert(result.ok, `${id}:${result.error}`)
  }
  for (const id of ['mod-shieldfield-2', 'mod-shieldfield-3', 'mod-lock-1', 'mod-lock-2', 'mod-lock-3', 'mod-wh-d-lock']) state.moduleBay[id] = 10
  for (const id of roster) assert.equal(cpuOverloadText(state, ctx, id), null)
  assert.equal(createPlayerSpec(state, ctx, logi)!.lockTargetChance, .8)
  return built
}
