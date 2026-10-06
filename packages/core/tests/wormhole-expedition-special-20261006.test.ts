import { describe, expect, it } from 'vitest'
import { makeExpeditionFixture, expeditionContext as ctx } from '../../../tools/wormhole-expedition-fixture'
import { wormholeDescend, wormholeGridScan } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import { wormholeEventPreview, wormholeResolveEvent } from '../src/wormholeExpedition'
import { wormholeEncounterView } from '../src/wormholeExpeditionView'
import type { WormholeFamily } from '../src/state'
import { gridCellAt, type WormholeEventKey } from '../src/wormholeGrid'
import { wormholeRunExpeditionPolicy } from '../src/wormholeExpeditionPolicy'

describe('虫洞精英专项 · 真实逐拍，不用于整趟胜率矩阵', () => {
  it.each(['A', 'C', 'D', 'E', 'G'] as WormholeFamily[])('%s精英通过已揭露情报迎战，实际预算战斗与一次性奖励', family => {
    const fixture = makeExpeditionFixture(family, 19, 'mixed')
    // 单场边界夹具从3层开始，明确不算首层至十层验收。
    const state = fixture.state, run = state.wormhole.run!
    run.grid!.pos = run.grid!.exit; run.bossCleared = 1
    expect(wormholeDescend(state, 107).ok).toBe(true)
    run.grid!.pos = run.grid!.exit; run.bossCleared = 2
    expect(wormholeDescend(state, 211).ok).toBe(true)
    expect(wormholeGridScan(state).ok).toBe(true)
    const elite = run.grid!.cells.find(c => c.elite)!
    run.grid!.scanned.push(elite.key)
    expect(wormholeEncounterView(state, ctx, elite.key)?.mechanismId).toBeTruthy()
    expect(wormholeTravelTo(state, ctx, elite, { confirmUnknown: true, confirmIntercept: true, confirmLeaveCargo: true }).ok).toBe(true)
    for (let n = 0; n < 2 && state.wormhole.run?.battle; n++) {
      for (let t = 0; state.wormhole.run?.battle && t < 9000; t++) { state.gameMs += 100; advanceWormhole(state, ctx) }
      if (state.wormhole.run && state.wormhole.run.grid!.pos.q !== elite.q) wormholeTravelTo(state, ctx, elite, { confirmUnknown: true, confirmIntercept: true, confirmLeaveCargo: true })
    }
    const result = state.wormhole.run!
    expect(result).toBeTruthy()
    expect(result.battle).toBeFalsy()
    if (!state.wormhole.run!.grid!.cells.find(c => c.key === elite.key)!.combatCleared) {
      expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
      for (let t = 0; state.wormhole.run?.battle && t < 9000; t++) { state.gameMs += 100; advanceWormhole(state, ctx) }
    }
    expect(state.wormhole.run?.expeditionProgress?.elites).toBe(1)
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(false)
    expect(Object.values(state.wormhole.run?.groundCargo ?? {}).flatMap(b => b.placements).some(p => p.itemId.startsWith('box-bp-'))).toBe(true)
  })
})

describe('六事件专项选项', () => {
  it.each(['controller', 'relay', 'distress'] as const)('%s实际交战胜利后才结事件，不改胜负或清敌', key => {
    const fixture = makeExpeditionFixture('A', 19, 'drones'), state = fixture.state, run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = 'empty'; cell.eventKey = key; cell.event = { identity: 'ambush' }; run.pendingEvent = { key, cellKey: cell.key }
    expect(wormholeResolveEvent(state, ctx, key === 'distress' ? 'respond' : 'force').ok).toBe(true)
    expect(state.wormhole.run!.battle!.wormhole!.expeditionRole).toBe('event')
    expect(state.wormhole.run!.guardSupportDisabled).not.toBe(true)
    expect(state.wormhole.run!.expeditionProgress!.events).toBe(0)
    for (let t = 0; state.wormhole.run?.battle && t < 9000; t++) { state.gameMs += 100; advanceWormhole(state, ctx) }
    expect(state.wormhole.run!.battle).toBeFalsy()
    expect(state.wormhole.run!.expeditionProgress!.events).toBe(1)
    expect(gridCellAt(state.wormhole.run!.grid!, state.wormhole.run!.grid!.pos)!.event!.battle).toBe('won')
    expect(state.wormhole.run!.guardSupportDisabled).toBe(key === 'distress' ? undefined : true)
  })
  it.each(['maintenance', 'transport', 'controller', 'relay', 'storm', 'distress'] as WormholeEventKey[])('%s免费退出和合法选项无重复赠送', key => {
    const fixture = makeExpeditionFixture('A', 19, 'drones'), state = fixture.state, run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = 'empty'; cell.eventKey = key; cell.event = { identity: 'genuine', supply: { 'repairkit-mil': 20 }, containerId: 'box-valuables' }
    run.pendingEvent = { key, cellKey: cell.key }
    const before = structuredClone(run.supplies)
    expect(wormholeResolveEvent(state, ctx, key === 'distress' ? 'reject' : 'bypass').ok).toBe(true)
    expect(state.wormhole.run!.supplies).toEqual(before)
    const action = key === 'maintenance' ? 'search' : key === 'transport' ? 'container' : key === 'storm' ? 'wait' : key === 'distress' ? 'respond' : 'investigate'
    expect(wormholeEventPreview(state, ctx, action).ok).toBe(true)
    expect(wormholeResolveEvent(state, ctx, action).ok).toBe(true)
    expect(wormholeEventPreview(state, ctx, action).ok).toBe(false)
  })

  it('合法T4/T3混编质量不超上限，用真实策略可清十层守卫后撤离', () => {
    const fixture = makeExpeditionFixture('A', 19, 'heavy')
    expect(fixture.state.wormhole.run!.totalMass).toBeLessThanOrEqual(16_000)
    const report = wormholeRunExpeditionPolicy(fixture.state, ctx)
    expect(report.failure).toBeUndefined()
    expect(report.guardClearedDepth).toBe(10)
    expect(report.extracted).toBe(true)
  })
})
