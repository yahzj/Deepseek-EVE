import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { firstStatOf } from '../src/firstTasks'
import { fleetRepairPlan, repairCostIsk, repairFleet } from '../src/shipyard'
import { makeTestCtx } from './helpers'

const ctx = makeTestCtx()

function damagedFleet() {
  const state = createInitialState({ nowWallMs: 0, seed: 41 })
  const secondId = addShipToFleet(state, 'sandcat2')
  state.fleet.sandcat!.durability = 0.6
  state.fleet.sandcat!.armorPct = 0.7
  state.fleet[secondId]!.durability = 0.8
  state.fleet[secondId]!.armorPct = 0.5
  state.wallet.isk = 1_000_000
  return { state, secondId }
}

describe('我的舰队全部维修 core 命令', () => {
  it('合计每艘费用、修满所有可修舰船并统计健康舰船', () => {
    const { state, secondId } = damagedFleet()
    state.fleet['sh-falconet']!.durability = 1
    state.fleet['sh-falconet']!.armorPct = 1
    const firstCost = repairCostIsk(state, 'sandcat', ctx)
    const secondCost = repairCostIsk(state, secondId, ctx)
    const plan = fleetRepairPlan(state, ctx)

    expect(plan).toEqual({
      repairableShipIds: ['sandcat', secondId],
      totalCost: firstCost + secondCost,
      fullCount: 1,
      blockedCount: 0,
    })
    const beforeWallet = state.wallet.isk
    expect(repairFleet(state, ctx)).toEqual({
      ok: true,
      repairedCount: 2,
      totalCost: firstCost + secondCost,
      fullCount: 1,
      blockedCount: 0,
    })
    expect(state.wallet.isk).toBe(beforeWallet - firstCost - secondCost)
    for (const shipId of ['sandcat', secondId]) {
      expect(state.fleet[shipId]).toMatchObject({ durability: 1, armorPct: 1 })
    }
    expect(firstStatOf(state, 'repairs')).toBe(2)
    expect(state.logs.filter(log => log.textId === 'core.shipyard.025')).toHaveLength(2)
    expect(state.logs.filter(log => log.textId === 'core.shipyard.025').map(log => log.textParams?.p1)).toEqual([
      '船sandcat', '船sandcat2',
    ])
  })

  it('按 repair 阻塞规则统计忙碌舰船且不纳入维修', () => {
    const { state, secondId } = damagedFleet()
    state.aiAssignments[secondId] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining' },
    } as never
    state.aiAssignments['sh-falconet'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining' },
    } as never

    expect(fleetRepairPlan(state, ctx)).toMatchObject({
      repairableShipIds: ['sandcat'],
      fullCount: 0,
      blockedCount: 2,
    })
    expect(repairFleet(state, ctx)).toMatchObject({
      ok: true,
      repairedCount: 1,
      fullCount: 0,
      blockedCount: 2,
    })
    expect(state.fleet.sandcat).toMatchObject({ durability: 1, armorPct: 1 })
    expect(state.fleet[secondId]).toMatchObject({ durability: 0.8, armorPct: 0.5 })
    expect(state.fleet['sh-falconet']).toMatchObject({ durability: 1, armorPct: 1 })
  })

  it('合计费用不足时整队状态不变', () => {
    const { state } = damagedFleet()
    const totalCost = fleetRepairPlan(state, ctx).totalCost
    state.wallet.isk = totalCost - 1
    const before = structuredClone(state)

    expect(repairFleet(state, ctx)).toMatchObject({ ok: false, errorId: 'core.shipyard.045' })
    expect(state).toEqual(before)
  })

  it('全员健康或无人可修时失败且不改动状态', () => {
    const healthy = createInitialState({ nowWallMs: 0, seed: 42 })
    const healthyBefore = structuredClone(healthy)
    expect(fleetRepairPlan(healthy, ctx)).toEqual({
      repairableShipIds: [], totalCost: 0, fullCount: 2, blockedCount: 0,
    })
    expect(repairFleet(healthy, ctx).ok).toBe(false)
    expect(healthy).toEqual(healthyBefore)

    const blocked = createInitialState({ nowWallMs: 0, seed: 43 })
    blocked.fleet.sandcat!.durability = 0.5
    blocked.aiAssignments.sandcat = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining' },
    } as never
    const blockedBefore = structuredClone(blocked)
    expect(fleetRepairPlan(blocked, ctx)).toEqual({
      repairableShipIds: [], totalCost: 0, fullCount: 1, blockedCount: 1,
    })
    expect(repairFleet(blocked, ctx).ok).toBe(false)
    expect(blocked).toEqual(blockedBefore)
  })
})
