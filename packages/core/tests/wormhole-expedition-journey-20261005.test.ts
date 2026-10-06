import { describe, expect, it } from 'vitest'
import { makeExpeditionFixture, expeditionContext as ctx } from '../../../tools/wormhole-expedition-fixture'
import { wormholeRunExpeditionPolicy, wormholeGuardRiskPreview } from '../src/wormholeExpeditionPolicy'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeLeave, wormholeResume } from '../src/wormhole'
import type { WormholeFamily } from '../src/state'
import { wormholeAutoStart, advanceWormholeAuto } from '../src/wormholeAuto'
import { wormholePreparationPlan } from '../src/wormholePreparation'

describe('新虫洞真实首层至第十层', () => {
  it('已知守卫预估只读且独立于真实随机序列，未知出口不泄露未来敌情', () => {
    const fixture = makeExpeditionFixture('A', 19, 'drones')
    const state = fixture.state, run = state.wormhole.run!
    expect(wormholeGuardRiskPreview(state, ctx).available).toBe(false)
    run.grid!.pos = { ...run.grid!.exit }; run.grid!.exitKnown = true
    const before = structuredClone(state)
    const preview = wormholeGuardRiskPreview(state, ctx)
    expect(preview).toMatchObject({ available: true, samples: 3, safe: true })
    expect(state).toEqual(before)
    expect(wormholeGuardRiskPreview(state, ctx)).toEqual(preview)
    run.pendingNodeBattle = true
    expect(wormholeGuardRiskPreview(state, ctx).available).toBe(false)
  })
  it.each(['A', 'C', 'D', 'E', 'G'] as WormholeFamily[])('%s族四鹦鹉螺合法配置、守卫逐层胜利、3/7/10暂停重载并带货撤离', family => {
    const fixture = makeExpeditionFixture(family, 19, 'drones')
    const storage = { ...fixture.state.warehouse.items }
    const checkpointDepths: number[] = []
    const result = wormholeRunExpeditionPolicy(fixture.state, ctx, { checkpoint(state) {
      checkpointDepths.push(state.wormhole.run!.depth)
      const book = structuredClone(state.wormhole.run!.supplies)
      wormholeLeave(state)
      const loaded = loadSaveFile(serializeSaveFile(loadSaveFile(serializeSaveFile(state, 0)).state, 0)).state
      expect(loaded.wormhole.run!.supplies).toEqual(book)
      expect(loaded.warehouse.items).toEqual(storage)
      expect(wormholeResume(loaded, ctx).ok).toBe(true)
      return loaded
    } })
    expect(result.failure).toBeUndefined()
    expect(result.reachedDepth).toBe(10)
    expect(result.guardClearedDepth).toBe(10)
    expect(result.extracted).toBe(true)
    expect(result.layers.filter(row => row.stage === 'guard-after').map(row => row.depth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(checkpointDepths).toEqual([3, 7, 10])
    expect(result.state.wormhole.run).toBeNull()
    expect(result.state.wormhole.lastSettle?.expeditionProgress?.guards).toBe(10)
    const saved = loadSaveFile(serializeSaveFile(result.state, 0)).state
    expect(saved.wormhole.lastSettle?.expeditionProgress).toEqual(result.state.wormhole.lastSettle?.expeditionProgress)
  })

  it('自动测试新模式用同一强配置可清十层，仅该队损益回写，不覆盖主控及同时在途活动', () => {
    const fixture = makeExpeditionFixture('D', 19, 'drones')
    const state = fixture.before
    state.skills.trained['ai-expert'] = 2
    const main = state.shipId
    // 主控不在队时不发生交接；同一合法装备清单作为出发快照。
    state.shipId = Object.keys(state.fleet).find(id => !fixture.fleet.includes(id))!
    const current = state.shipId
    const plan = wormholePreparationPlan(state, ctx, fixture.fleet, { targets: fixture.manifest, unload: [] })
    expect(wormholeAutoStart(state, ctx, 'journey', fixture.fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(true)
    state.warehouse.items['ore-olivine'] = 777
    const initialTask = structuredClone(state.mining)
    const clock = state.gameMs + 300_001
    state.gameMs = clock
    advanceWormholeAuto(state, ctx)
    expect(state.shipId).toBe(current)
    expect(state.mining).toEqual(initialTask)
    expect(state.gameMs).toBe(clock)
    expect(state.warehouse.items['ore-olivine']).toBe(777)
    expect(state.fleet[main]).toBeTruthy()
    expect(state.wormholeAuto).toEqual([])
    expect(state.wormholeAutoReports![0]!.depth).toBe(10)
    expect(state.wormholeAutoReports![0]!.simulationMs).toBeGreaterThan(0)
    expect(state.wormholeAutoReports![0]!.shipsLost).toEqual([])
  })
})
