import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholePreparationPlan } from '../src/wormholePreparation'
import { wormholeAutoStart, wormholeAutoStop, advanceWormholeAuto } from '../src/wormholeAuto'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { shipLockedReason } from '../src/state'

const ctx = buildSimContext()
function setup() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const fleet = [addShipToFleet(state, 'sh-thresher'), addShipToFleet(state, 'sh-thresher')]
  state.skills.trained['ai-expert'] = 2
  state.wormholeStock = [{ id: 'auto-expedition', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0 }]
  state.warehouse.items['repairkit-mil'] = 200
  const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { 'repairkit-mil': 100 }, unload: [] })
  return { state, fleet, plan }
}

describe('自动新模式 · 出发快照与旧模式隔离', () => {
  it('到点走真实有限供货战斗，无法通关也如实结算，不套旧无损保险', () => {
    const { state, fleet, plan } = setup()
    expect(wormholeAutoStart(state, ctx, 'auto-expedition', fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(true)
    const warehouse = { ...state.warehouse.items }
    state.gameMs += 300_001
    advanceWormholeAuto(state, ctx)
    expect(state.wormholeAuto).toEqual([])
    expect(state.wormholeAutoReports![0]!.expeditionRules).toBe(2)
    expect(state.wormholeAutoReports![0]!.simulationMs).toBeGreaterThan(0)
    expect(state.wormholeAutoReports![0]!.shipsLost?.length).toBeGreaterThan(0)
    expect(state.warehouse.items['repairkit-mil']).toBe(warehouse['repairkit-mil'])
    const before = structuredClone(state)
    advanceWormholeAuto(state, ctx)
    expect(state).toEqual(before)
  })
  it('原子扣携入物资、5分钟承载、锁船和冻结规则，途中母港库存变化不补快照', () => {
    const { state, fleet, plan } = setup()
    expect(wormholeAutoStart(state, ctx, 'auto-expedition', fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(true)
    const run = state.wormholeAuto![0]!
    expect(run.finishAtGameMs - run.startedAtGameMs).toBe(300_000)
    expect(run.expeditionRules).toBe(2)
    expect(state.wormhole.run).toBeNull()
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
    expect(shipLockedReason(state, fleet[0]!, '')).toBeTruthy()
    const snap = JSON.parse(run.expeditionSnapshot!)
    expect(snap.wormhole.run.supplies.items['repairkit-mil']).toBe(100)
    expect(snap.warehouse.items).toEqual({})
    state.warehouse.items['repairkit-mil'] = 5000
    expect(JSON.parse(run.expeditionSnapshot!).wormhole.run.supplies.items['repairkit-mil']).toBe(100)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const twice = loadSaveFile(serializeSaveFile(loaded, 0)).state
    expect(twice.wormholeAuto![0]!.expeditionRules).toBe(2)
    expect(JSON.parse(twice.wormholeAuto![0]!.expeditionSnapshot!).wormhole.run.supplies.items).toEqual(snap.wormhole.run.supplies.items)
  })

  it('取消新模式走真实撤离核对，物资只退一次，旧模式不创建补给快照', () => {
    const { state, fleet, plan } = setup()
    expect(wormholeAutoStart(state, ctx, 'auto-expedition', fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(true)
    const runId = state.wormholeAuto![0]!.id
    expect(wormholeAutoStop(state, runId, ctx).ok).toBe(true)
    expect(state.warehouse.items['repairkit-mil']).toBe(200)
    expect(state.wormholeAuto).toEqual([])
    expect(state.wormholeAutoReports![0]!.suppliesReturned).toEqual({ 'repairkit-mil': 100 })
    expect(wormholeAutoStop(state, runId, ctx).ok).toBe(false)
    expect(state.warehouse.items['repairkit-mil']).toBe(200)
    const old = setup()
    expect(wormholeAutoStart(old.state, ctx, 'auto-expedition', old.fleet).ok).toBe(true)
    expect(old.state.wormholeAuto![0]!.expeditionRules).toBeUndefined()
    expect(old.state.wormholeAuto![0]!.expeditionSnapshot).toBeUndefined()
    expect(old.state.warehouse.items['repairkit-mil']).toBe(200)
  })

  it('旧预览、风险未确认与缺料整体拒绝，不先消费通道或改主控', () => {
    const { state, fleet, plan } = setup()
    state.warehouse.items['repairkit-mil'] = 0
    const before = structuredClone(state)
    expect(wormholeAutoStart(state, ctx, 'auto-expedition', fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(false)
    expect(state).toEqual(before)
    expect(wormholeAutoStart(state, ctx, 'auto-expedition', fleet, { prepared: plan, confirmLossRisk: false as true }).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('未知版本和损坏快照读档后不会降为旧模式免费结算或召回', () => {
    const { state, fleet, plan } = setup()
    expect(wormholeAutoStart(state, ctx, 'auto-expedition', fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(true)
    state.wormholeAuto![0]!.expeditionRules = 99
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    loaded.gameMs += 300_001
    const before = structuredClone(loaded)
    advanceWormholeAuto(loaded, ctx)
    expect(wormholeAutoStop(loaded, loaded.wormholeAuto![0]!.id, ctx).ok).toBe(false)
    expect(loaded).toEqual(before)
  })
})
