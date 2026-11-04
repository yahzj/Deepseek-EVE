/** 2026-11-01现行承运：保留实体货、按实装结算、真实返航及旧在途兼容。 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startHauling as launchHauling, stopHauling, haulBaseReward, haulLegReward, haulEffectiveMinutes, haulingOccupiedM3, HAUL_RATE_PER_M3_MIN, HAUL_LEG_TIME_MUL, HAUL_TRIP_MUL_MIN, HAUL_TRIP_MUL_MAX } from '../src/hauling'
import { finishDeparture } from './helpers/departure-ready'
import { cargoCapacityM3Of } from '../src/inventory'
import { changeShip, addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { makeTestCtx } from './helpers'
import { haulFleetLoadOf } from '../src/hauling/load'
import type { StationSiteDef } from '../src/types'

function startHauling(...args: Parameters<typeof launchHauling>) {
  const result = launchHauling(...args)
  if (result.ok && !result.queued) finishDeparture(args[0], args[3])
  return result
}

const site: StationSiteDef = { id: 'site-test', name: '测试前哨站', galaxyId: 'galaxy-far', standingReq: 0,
  tiers: [{ name: '建成', bill: [], unlockDesc: '' }], introDialogueId: '', doneDialogueId: null, description: '' }

function world() {
  const ctx = makeTestCtx({ stations: [site], quietEvents: true })
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  state.stationSites[site.id] = { stage: 1, delivered: {} }
  state.debugQuick = true
  return { state, ctx }
}

describe('长途运输现行编队规则', () => {
  it('未建成、同点、野外与0/超额装载拒绝，失败无写入', () => {
    const { state, ctx } = world()
    state.stationSites[site.id]!.stage = 0
    expect(startHauling(state, null, site.id, ctx).ok).toBe(false)
    state.stationSites[site.id]!.stage = 1
    expect(startHauling(state, null, null, ctx).ok).toBe(false)
    state.awayGalaxy = 'galaxy-far'
    expect(startHauling(state, null, site.id, ctx).ok).toBe(false)
    state.awayGalaxy = null
    expect(startHauling(state, null, site.id, ctx, 0).ok).toBe(false)
    expect(startHauling(state, null, site.id, ctx, 1_000_000).ok).toBe(false)
    expect(state.hauling.active).toBe(false)
  })

  it('保留实体货与仓库，仅按指定体积占舱', () => {
    const { state, ctx } = world()
    state.fleet[state.shipId]!.cargo['ore-a'] = 50
    const warehouse = structuredClone(state.warehouse)
    expect(startHauling(state, null, site.id, ctx, 100).ok).toBe(true)
    expect(state.fleet[state.shipId]!.cargo['ore-a']).toBe(50)
    expect(state.warehouse).toEqual(warehouse)
    expect(haulingOccupiedM3(state, ctx)).toBe(100)
    expect(state.hauling.fleetLeg!.loadedByShip[0]!.loadedM3).toBe(100)
  })

  it('两向结算同价、下一趟重掷，仅按承运量计钱', () => {
    const { state, ctx } = world()
    expect(startHauling(state, null, site.id, ctx, 100).ok).toBe(true)
    const mul = state.hauling.tripMul
    const due = haulLegReward(ctx, 100, haulEffectiveMinutes(ctx, 'galaxy-hub', 'galaxy-far'), mul)
    const wallet = state.wallet.isk
    advanceGame(state, 1000, ctx)
    expect(state.wallet.isk - wallet).toBe(due)
    expect(state.hauling.toSiteId).toBeNull()
    expect(state.hauling.tripMul).toBe(mul)
    finishDeparture(state, ctx)
    advanceGame(state, 1000, ctx)
    expect(state.wallet.isk - wallet).toBe(due * 2)
    expect(state.hauling.tripLegsLeft).toBe(2)
    expect(state.hauling.tripMul).toBeGreaterThanOrEqual(HAUL_TRIP_MUL_MIN)
    expect(state.hauling.tripMul).toBeLessThanOrEqual(HAUL_TRIP_MUL_MAX)
    expect(state.logs.filter(row => row.textId === 'core.industrial.004')).toHaveLength(2)
  })

  it('费率和距离指数锚定不变', () => {
    const { state, ctx } = world()
    const cap = cargoCapacityM3Of(state, ctx, state.shipId)
    const distance = haulEffectiveMinutes(ctx, 'galaxy-hub', 'galaxy-far')
    const b = ctx.balance.haul
    expect(HAUL_LEG_TIME_MUL).toBe(15)
    expect(HAUL_RATE_PER_M3_MIN).toBe(0.6)
    expect(haulBaseReward(ctx, cap, distance)).toBe(Math.ceil(cap * 0.6 * b.anchorNominalMinutes * Math.pow(distance / b.anchorEffectiveMinutes, b.distExp)))
  })

  it('中断放弃报酬、真实折返且重复停止不重置进度', () => {
    const { state, ctx } = world()
    startHauling(state, null, site.id, ctx, 100)
    advanceGame(state, 500, ctx)
    const wallet = state.wallet.isk
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(true)
    expect(state.hauling.fleetLeg!.returning).toBe(true)
    expect(haulingOccupiedM3(state, ctx)).toBe(0)
    advanceGame(state, 250, ctx)
    stopHauling(state, ctx)
    expect(state.hauling.phaseAccMs).toBe(250)
    advanceGame(state, 250, ctx)
    expect(state.hauling.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    expect(state.wallet.isk).toBe(wallet)
  })

  it('到站停运计当前段，运输中换驾驶拒绝且不丢任务', () => {
    const { state, ctx } = world()
    startHauling(state, null, site.id, ctx, 100)
    const before = structuredClone(state.hauling)
    expect(changeShip(state, addShipToFleet(state, 'sandcat2'), ctx).ok).toBe(false)
    expect(state.hauling).toEqual(before)
    state.hauling.fleetLeg!.stopAtArrival = true
    const wallet = state.wallet.isk
    advanceGame(state, 1000, ctx)
    expect(state.hauling.active).toBe(false)
    expect(state.wallet.isk).toBeGreaterThan(wallet)
    expect(state.dockedSite).toBe(site.id)
  })

  it('目标货量只改变下一段，运力不足到站停运', () => {
    const { state, ctx } = world()
    startHauling(state, null, site.id, ctx, 100)
    state.hauling.fleetLeg!.targetM3 = 200
    expect(haulingOccupiedM3(state, ctx)).toBe(100)
    advanceGame(state, 1000, ctx)
    expect(haulingOccupiedM3(state, ctx)).toBe(200)
    state.hauling.fleetLeg!.targetM3 = 1_000_000
    finishDeparture(state, ctx)
    advanceGame(state, 1000, ctx)
    expect(state.hauling.active).toBe(false)
  })

  it('存读档保留逐船货量与航路且不会重复结算', () => {
    const { state, ctx } = world()
    startHauling(state, null, site.id, ctx, 123)
    advanceGame(state, 300, ctx)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    expect(loaded.hauling).toEqual(state.hauling)
    const wallet = loaded.wallet.isk
    const due = haulLegReward(ctx, 123, haulEffectiveMinutes(ctx, 'galaxy-hub', 'galaxy-far'), loaded.hauling.tripMul)
    advanceGame(loaded, 700, ctx)
    expect(loaded.wallet.isk - wallet).toBe(due)
    advanceGame(loaded, 1, ctx)
    expect(loaded.wallet.isk - wallet).toBe(due)
  })

  it('旧档无承运快照只按旧单船完成当前段后停运', () => {
    const { state, ctx } = world()
    startHauling(state, null, site.id, ctx)
    delete state.hauling.fleetLeg
    state.hauling.tripMul = 0
    state.hauling.tripLegsLeft = 0
    const wallet = state.wallet.isk
    const cap = cargoCapacityM3Of(state, ctx, state.shipId)
    advanceGame(state, 1000, ctx)
    expect(state.wallet.isk - wallet).toBe(haulLegReward(ctx, cap, haulEffectiveMinutes(ctx, 'galaxy-hub', 'galaxy-far'), HAUL_TRIP_MUL_MIN))
    expect(state.hauling.active).toBe(false)
  })

  it('全舰种容量汇总、实例去重和比例装载守恒', () => {
    const { state, ctx } = world()
    const other = addShipToFleet(state, 'sandcat2')
    const ids = [state.shipId, other, state.shipId]
    const load = haulFleetLoadOf(state, ctx, ids, 101)
    expect(load.byShip).toHaveLength(2)
    expect(load.loadedM3).toBe(101)
    expect(load.byShip.reduce((sum, row) => sum + row.loadedM3, 0)).toBe(101)
    expect(load.capacityM3).toBe(cargoCapacityM3Of(state, ctx, state.shipId) + cargoCapacityM3Of(state, ctx, other))
    expect(load.byShip.every(row => row.loadedM3 <= row.availableM3)).toBe(true)
  })

  it('小数剩余空间也可共同承运，逐舰不超仓且往返保真', () => {
    const { state, ctx } = world()
    const other = addShipToFleet(state, 'sandcat2')
    const ids = [state.shipId, other]
    for (const id of ids) state.fleet[id]!.cargo['min-a'] = (cargoCapacityM3Of(state, ctx, id) - 0.6) * 100
    const load = haulFleetLoadOf(state, ctx, ids, 1)
    expect(load.capacityM3).toBe(1)
    expect(load.byShip.reduce((sum, row) => sum + row.loadedM3, 0)).toBeCloseTo(1)
    expect(load.byShip.every(row => row.loadedM3 <= row.availableM3)).toBe(true)
  })

  it('损坏全队装载记录不能回退满仓计酬', () => {
    const { state, ctx } = world()
    startHauling(state, null, site.id, ctx, 100)
    const raw = JSON.parse(serializeSaveFile(state))
    raw.state.hauling.fleetLeg.loadedByShip[0].loadedM3 = 200
    expect(loadSaveFile(JSON.stringify(raw)).state.hauling.active).toBe(false)
  })
})
