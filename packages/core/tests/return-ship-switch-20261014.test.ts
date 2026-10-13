import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { changeShip, changeShipBlockReason, repairShip } from '../src/shipyard'
import { shipActuallyDocked, shipOperationBlockReason } from '../src/shipActionPolicy'
import { advanceGame } from '../src/engine'
import { advanceShipReturns, startMining, stopMining, retireMiningShip } from '../src/mining'
import { startSalvageOp, stopSalvageOp, retireSalvageShip } from '../src/salvaging'
import { startRefineRun } from '../src/industry'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { pendingStationActivityView } from '../src/stationActivityPending'
import { makeTestCtx, moduleDef, ship } from './helpers'

const ctx = makeTestCtx({ quietEvents: true,
  ships: [ship('sandcat', { cargo: 800, warpSpeedAus: 2 }), ship('switch-fast', { cargo: 2000, warpSpeedAus: 8 })],
  modules: [moduleDef('switch-salvager', 'salvager', 0, { salvageCycleMs: 1000 })],
})

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 1014 })
  state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
  const oldShip = state.shipId
  const nextShip = addShipToFleet(state, 'switch-fast')
  state.fleet[oldShip]!.cargo = { 'ore-b': 20 }
  state.fleet[oldShip]!.durability = .8
  state.fleet[oldShip]!.armorPct = .7
  state.fleet[nextShip]!.cargo = { 'min-a': 3 }
  state.warehouse.items['ore-a'] = 100
  return { state, oldShip, nextShip }
}

const reasons = [undefined, 'miningStop', 'salvageStop', 'expedition', 'salvage'] as const

describe('当前驾驶船独立返航可换其他船', () => {
  it.each(reasons)('%s返航交接不重置进度或提前卸货，返航只限制旧船实体操作', reason => {
    for (const awayGalaxy of [null, 'galaxy-far']) {
      const { state, oldShip, nextShip } = world()
      state.awayGalaxy = awayGalaxy
      state.dockedSite = awayGalaxy ? 'old-construction' : null
      state.shipReturns[oldShip] = { beltId: null, legMs: 10000, phaseAccMs: 2000, ...(reason ? { reason } : {}) }
      const before = structuredClone(state)
      expect(changeShipBlockReason(state, nextShip, ctx)).toBeNull()
      expect(state).toEqual(before)
      expect(shipActuallyDocked(state, ctx, oldShip)).toBe(false)
      for (const operation of ['cargo', 'repair', 'configure'] as const) expect(shipOperationBlockReason(state, ctx, oldShip, operation)).not.toBeNull()
      expect(repairShip(state, oldShip, ctx).ok).toBe(false)
      expect(state).toEqual(before)
      expect(changeShip(state, nextShip, ctx).ok).toBe(true)
      expect(state.shipId).toBe(nextShip)
      expect(shipActuallyDocked(state, ctx, nextShip)).toBe(true)
      expect(state.awayGalaxy).toBeNull()
      expect(state.dockedSite).toBeNull()
      expect(state.shipReturns).toEqual(before.shipReturns)
      expect(state.fleet).toEqual(before.fleet)
      expect(state.warehouse).toEqual(before.warehouse)
      expect(changeShip(state, oldShip, ctx).ok).toBe(false)
      advanceShipReturns(state, 7999, ctx)
      expect(state.shipReturns[oldShip]!.phaseAccMs).toBe(9999)
      expect(state.fleet[oldShip]!.cargo).toEqual({ 'ore-b': 20 })
      advanceShipReturns(state, 1, ctx)
      expect(state.shipReturns[oldShip]).toBeUndefined()
      expect(state.fleet[oldShip]!.cargo).toEqual({})
      expect(state.warehouse.items['ore-b']).toBe((before.warehouse.items['ore-b'] ?? 0) + 20)
      expect(state.fleet[nextShip]).toEqual(before.fleet[nextShip])
      expect(state.shipId).toBe(nextShip)
      const inventory = structuredClone(state.warehouse)
      advanceShipReturns(state, 10000, ctx)
      expect(state.warehouse).toEqual(inventory)
      expect(changeShipBlockReason(state, oldShip, ctx)).toBeNull()
    }
  })

  it.each(['mining', 'salvaging'] as const)('%s手动停止后可换船，旧返航两次保存重载保持且在线继续到港', mode => {
    const w = world()
    if (mode === 'mining') {
      expect(startMining(w.state, 'belt-a', ctx).ok).toBe(true)
      expect(stopMining(w.state, ctx)).toBe(true)
    } else {
      w.state.fleet[w.oldShip]!.fitted.high = ['switch-salvager']
      expect(startSalvageOp(w.state, 'galaxy-hub', ctx).ok).toBe(true)
      expect(stopSalvageOp(w.state, ctx)).toBe(true)
    }
    expect(w.state.shipReturns[w.oldShip]).toBeDefined()
    const before = structuredClone(w.state.shipReturns[w.oldShip]!)
    const state = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(changeShip(state, w.nextShip, ctx).ok).toBe(true)
    expect(state.shipReturns[w.oldShip]).toEqual(before)
    const reloaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(reloaded.shipId).toBe(w.nextShip)
    expect(reloaded.shipReturns[w.oldShip]).toEqual(before)
    advanceGame(reloaded, before.legMs - before.phaseAccMs - 1, ctx, { offline: true })
    expect(reloaded.fleet[w.oldShip]!.cargo).toEqual({ 'ore-b': 20 })
    expect(reloaded.shipReturns[w.oldShip]).toBeDefined()
    advanceGame(reloaded, 1, ctx, { offline: true })
    expect(reloaded.shipReturns[w.oldShip]).toBeUndefined()
    expect(reloaded.shipReturns[w.nextShip]).toBeUndefined()
    expect(reloaded.fleet[w.oldShip]!.cargo).toEqual({})
    expect(reloaded.fleet[w.nextShip]!.cargo).toEqual({ 'min-a': 3 })
    expect(reloaded.shipId).toBe(w.nextShip)
  })
})

describe('站内待办返航的换驾驶交接', () => {
  it.each(['mining', 'salvaging'] as const)('%s切站内活动后首拍前换船，在旧舰兑现真实返航，取消待办但不取消返航', mode => {
    const { state, oldShip, nextShip } = world()
    if (mode === 'mining') expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    else {
      state.fleet[oldShip]!.fitted.high = ['switch-salvager']
      expect(startSalvageOp(state, 'galaxy-hub', ctx).ok).toBe(true)
    }
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx)).toMatchObject({ ok: true, queued: true })
    expect(state.pendingActivityReturn?.kind).toBe(mode)
    const control = structuredClone(state)
    const pending = control.pendingActivityReturn!
    if (pending.kind === 'mining') retireMiningShip(control, ctx, { beltId: pending.id, preserveExisting: true })
    else retireSalvageShip(control, ctx, { galaxyId: pending.id, preserveExisting: true })
    const correctReturn = structuredClone(control.shipReturns[oldShip]!)
    const fleetBefore = structuredClone(state.fleet)
    const warehouseBefore = structuredClone(state.warehouse)
    const snapshot = structuredClone(state)
    expect(changeShipBlockReason(state, nextShip, ctx)).toBeNull()
    expect(state).toEqual(snapshot)
    expect(changeShip(state, nextShip, ctx).ok).toBe(true)
    expect(state.pendingStationActivity).toBeUndefined()
    expect(state.pendingActivityReturn).toBeNull()
    expect(state.haltedBySwitch).toBeNull()
    expect(pendingStationActivityView(state, ctx)).toBeNull()
    expect(state.shipReturns[oldShip]).toEqual(correctReturn)
    expect(state.shipReturns[nextShip]).toBeUndefined()
    expect(state.fleet).toEqual(fleetBefore)
    expect(state.warehouse).toEqual(warehouseBefore)
    advanceGame(state, 1, ctx)
    expect(state.shipReturns[nextShip]).toBeUndefined()
    expect(state.refineRuns).toHaveLength(0)
    expect(state.fleet[nextShip]).toEqual(fleetBefore[nextShip])
    expect(state.logs.filter(log => log.textId === (mode === 'mining' ? 'core.mining.042' : 'core.salvaging.029'))
      .some(log => log.text.includes(ctx.ships.get('sandcat')!.name))).toBe(true)
    const returned = loadSaveFile(serializeSaveFile(state, 0)).state
    const remaining = returned.shipReturns[oldShip]!.legMs - returned.shipReturns[oldShip]!.phaseAccMs
    advanceGame(returned, remaining, ctx, { offline: true })
    expect(returned.shipReturns[oldShip]).toBeUndefined()
    expect(returned.fleet[oldShip]!.cargo).toEqual({})
    expect(returned.fleet[nextShip]).toEqual(fleetBefore[nextShip])
    expect(returned.refineRuns).toHaveLength(0)
  })

  it('已走返航相位的待办切船不变更腿长，旧船到港不再自动开炉', () => {
    const { state, oldShip, nextShip } = world()
    state.awayGalaxy = 'galaxy-far'
    state.shipReturns[oldShip] = { beltId: null, legMs: 10000, phaseAccMs: 2000, reason: 'salvageStop' }
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx)).toMatchObject({ ok: true, queued: true })
    const before = structuredClone(state)
    expect(changeShip(state, nextShip, ctx).ok).toBe(true)
    expect(state.shipReturns).toEqual(before.shipReturns)
    expect(state.pendingStationActivity).toBeUndefined()
    advanceGame(state, 8000, ctx, { offline: true })
    expect(state.refineRuns).toHaveLength(0)
    expect(state.shipReturns[oldShip]).toBeUndefined()
    expect(state.warehouse.items['ore-a']).toBe(before.warehouse.items['ore-a'])
    expect(state.fleet[nextShip]).toEqual(before.fleet[nextShip])
  })

  it.each(['mining', 'salvaging'] as const)('%s排队后未走首拍即读档换船，新船可采矿且旧船返航不会误卸新货', mode => {
    const w = world()
    if (mode === 'mining') expect(startMining(w.state, 'belt-a', ctx).ok).toBe(true)
    else {
      w.state.fleet[w.oldShip]!.fitted.high = ['switch-salvager']
      expect(startSalvageOp(w.state, 'galaxy-hub', ctx).ok).toBe(true)
    }
    expect(startRefineRun(w.state, 'ore-a', 'pilot', ctx)).toMatchObject({ ok: true, queued: true })
    const state = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(state.pendingActivityReturn?.kind).toBe(mode)
    expect(changeShip(state, w.nextShip, ctx).ok).toBe(true)
    const oldReturn = structuredClone(state.shipReturns[w.oldShip]!)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.shipReturns[w.oldShip]).toEqual(oldReturn)
    expect(state.shipReturns[w.nextShip]).toBeUndefined()
    advanceGame(state, 1, ctx)
    expect(state.shipReturns[w.nextShip]).toBeUndefined()
    expect(state.fleet[w.nextShip]!.cargo).toEqual({ 'min-a': 3 })
    expect(state.refineRuns).toHaveLength(0)
  })

  it.each(['mining', 'salvaging'] as const)('%s首拍前切换到不可接管舰，待办和待建返航标记都不变', mode => {
    const { state, oldShip, nextShip } = world()
    if (mode === 'mining') expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    else {
      state.fleet[oldShip]!.fitted.high = ['switch-salvager']
      expect(startSalvageOp(state, 'galaxy-hub', ctx).ok).toBe(true)
    }
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx)).toMatchObject({ ok: true, queued: true })
    state.shipReturns[nextShip] = { beltId: null, legMs: 8000, phaseAccMs: 1000 }
    const before = structuredClone(state)
    expect(changeShip(state, nextShip, ctx).ok).toBe(false)
    expect(state).toEqual(before)
    expect(state.pendingActivityReturn?.kind).toBe(mode)
  })

  it.each(['returning', 'exploring', 'combat', 'missing'] as const)('目标%s时拒绝不取消待办或改变原航程和货物', kind => {
    const { state, oldShip, nextShip } = world()
    state.shipReturns[oldShip] = { beltId: null, legMs: 10000, phaseAccMs: 2000, reason: 'miningStop' }
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx)).toMatchObject({ ok: true, queued: true })
    if (kind === 'returning') state.shipReturns[nextShip] = { beltId: null, legMs: 8000, phaseAccMs: 1000 }
    if (kind === 'exploring') state.wormholeAuto = [{ shipIds: [nextShip] } as never]
    if (kind === 'combat') state.aiAssignments[nextShip] = { coreType: 'basic', task: { kind: 'expedition', phase: 'battle', battle: {} } } as never
    if (kind === 'missing') delete state.fleet[nextShip]
    const before = structuredClone(state)
    const blocked = changeShipBlockReason(state, nextShip, ctx)
    expect(blocked).not.toBeNull()
    expect(changeShip(state, nextShip, ctx)).toEqual({ ok: false, ...blocked })
    expect(state).toEqual(before)
  })
})

describe('独立返航放行不解除其他活动锁定', () => {
  it.each(['courier', 'transit', 'delivery', 'combat', 'auto', 'planet'] as const)('%s与旧返航并存时仍拒绝换船，整份状态不变', kind => {
    const { state, oldShip, nextShip } = world()
    state.shipReturns[oldShip] = { beltId: null, legMs: 10000, phaseAccMs: 2000, reason: 'miningStop' }
    if (kind === 'courier') state.sideTasks.deliver = { taskId: 1 } as never
    if (kind === 'transit') state.transit.active = true
    if (kind === 'delivery') Object.assign(state.transit, { active: true, delivery: { siteId: 'test-site' } })
    if (kind === 'combat') Object.assign(state.encounter, { active: true, shipId: oldShip, battle: {} })
    if (kind === 'auto') state.wormholeAuto = [{ shipIds: [oldShip] } as never]
    if (kind === 'planet') state.planetary = { planets: {}, deliveries: [{ shipUid: oldShip } as never] }
    const before = structuredClone(state)
    expect(changeShipBlockReason(state, nextShip, ctx)).not.toBeNull()
    expect(changeShip(state, nextShip, ctx).ok).toBe(false)
    expect(state).toEqual(before)
  })
})
