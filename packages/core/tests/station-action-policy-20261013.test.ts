import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { shipActuallyDocked, shipOperationBlockReason } from '../src/shipActionPolicy'
import { stationActivityStartBlockReason, isAtHomeLike, startSiteDeliverTrip } from '../src/location'
import { industryAvailable, redeemFragments, fragmentRedeemRowsOf, startRefineRun, advanceRefining, sellCargoItem, sellCargoItemQty } from '../src/industry'
import { loadWarehouseToCargoFit, unloadCargoToWarehouse, unloadShipCargo } from '../src/inventory'
import { fitModule, unfitAt, adjustDroneLoad } from '../src/equipment'
import { installPlug } from '../src/plugs'
import { applyFitPreset, unfitAllModules, clearDroneLoad } from '../src/fitPresets'
import { repairShip, changeShipBlockReason, changeShip } from '../src/shipyard'
import { wormholeAutoMainHandover } from '../src/wormholeAuto'
import { ensureBlackMarket, blackMarketBuy } from '../src/blackMarket'
import { buyShip } from '../src/industry'
import { FRAGMENT_RECIPES, fragmentItemIdOf } from '../src/salvage'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
function world() {
  const state = createInitialState({ nowWallMs: 1791864000000, seed: 17 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  state.wallet.isk = 1e12
  state.standingsEarned = { dsi: 100 }
  state.standings.dsi = 100
  return { state, uid }
}
const modes = ['mining', 'salvaging', 'hauling', 'courier', 'expedition', 'transit', 'standby', 'return', 'encounter', 'auto', 'planet'] as const
function occupy(state: GameState, uid: string, mode: typeof modes[number]) {
  if (['mining', 'salvaging', 'hauling', 'expedition', 'transit', 'standby'].includes(mode)) {
    (state[mode as 'mining' | 'salvaging' | 'hauling' | 'expedition' | 'transit' | 'standby']).active = true
    if (mode === 'mining') state.mining.beltId = [...ctx.belts.keys()][0]!
  } else if (mode === 'courier') state.sideTasks.deliver = { taskId: 1 } as never
  else if (mode === 'return') state.shipReturns[uid] = { beltId: null, legMs: 10000, phaseAccMs: 0 }
  else if (mode === 'encounter') Object.assign(state.encounter, { active: true, shipId: uid })
  else if (mode === 'auto') state.wormholeAuto = [{ shipIds: [uid] } as never]
  else if (mode === 'planet') state.planetary = { planets: {}, deliveries: [{ shipUid: uid } as never] }
}

describe('目标舰真实状态与实体命令', () => {
  it('母港、副站和野外分别判定；闲置副船不跟随主控位置', () => {
    const { state, uid } = world()
    const other = addShipToFleet(state, 'sh-mako')
    expect(shipActuallyDocked(state, ctx, uid)).toBe(true)
    const site = [...ctx.stations.values()][0]!
    state.dockedSite = site.id
    state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    expect(shipActuallyDocked(state, ctx, uid)).toBe(true)
    state.stationSites[site.id]!.stage = 0
    expect(shipActuallyDocked(state, ctx, uid)).toBe(false)
    expect(shipActuallyDocked(state, ctx, other)).toBe(true)
    state.dockedSite = null; state.awayGalaxy = 'galaxy-redring'
    expect(shipOperationBlockReason(state, ctx, uid, 'cargo')).not.toBeNull()
    expect(shipOperationBlockReason(state, ctx, uid, 'configure')).toBeNull()
    expect(shipOperationBlockReason(state, ctx, other, 'repair')).toBeNull()
  })
  it.each(modes)('%s不因旧位置字段空值被当作停靠，手动命令失败状态不变', mode => {
    const { state, uid } = world()
    state.warehouse.items['ammo-kinetic-l'] = 100
    state.fleet[uid]!.cargo = { 'ammo-kinetic-l': 20 }
    state.fleet[uid]!.durability = .5
    state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
    state.moduleBay['mod-laser-3'] = 2
    state.moduleBay['plug-shield-plate'] = 1
    occupy(state, uid, mode)
    expect(shipActuallyDocked(state, ctx, uid)).toBe(false)
    const before = structuredClone(state)
    expect(loadWarehouseToCargoFit(state, 'ammo-kinetic-l', ctx)).toBe(0)
    expect(unloadCargoToWarehouse(state, ctx, 'ammo-kinetic-l')).toBe(0)
    expect(unloadCargoToWarehouse(state, ctx)).toBe(0)
    expect(unloadShipCargo(state, ctx, uid)).toBe(0)
    expect(sellCargoItem(state, 'ammo-kinetic-l', ctx).ok).toBe(false)
    expect(sellCargoItemQty(state, 'ammo-kinetic-l', 1, ctx).ok).toBe(false)
    expect(repairShip(state, uid, ctx).ok).toBe(false)
    expect(fitModule(state, 'mod-laser-3', ctx).ok).toBe(false)
    expect(unfitAt(state, 'high', 0, uid, ctx)).toBe(false)
    expect(unfitAllModules(state, ctx, uid).ok).toBe(false)
    expect(adjustDroneLoad(state, ctx, 'drone-scout', -1, uid).ok).toBe(false)
    expect(clearDroneLoad(state, ctx, uid)).toBe(0)
    expect(installPlug(state, ctx, 'plug-shield-plate', uid).ok).toBe(false)
    expect(applyFitPreset(state, ctx, uid, 0).ok).toBe(false)
    expect(state).toEqual(before)
  })
  it('主控野外不限制空闲副船维修与配置，忙碌副船才被阻止', () => {
    const { state } = world()
    state.awayGalaxy = 'galaxy-redring'
    const other = addShipToFleet(state, 'sh-mako')
    state.fleet[other]!.durability = .5
    state.fleet[other]!.cargo = { 'ammo-kinetic-l': 20 }
    expect(unloadShipCargo(state, ctx, other)).toBe(20)
    state.moduleBay['mod-turret-kin-1'] = 1
    expect(repairShip(state, other, ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-turret-kin-1', ctx, { shipId: other }).ok).toBe(true)
    state.aiAssignments[other] = { task: { kind: 'mining' } } as never
    expect(shipOperationBlockReason(state, ctx, other, 'cargo')).not.toBeNull()
  })
  it('站内手动生产不虚构出勤，但禁止改装该主控舰', () => {
    const { state, uid } = world()
    state.refineRuns = [{ active: true, worker: 'pilot' } as never]
    expect(shipActuallyDocked(state, ctx, uid)).toBe(true)
    expect(shipOperationBlockReason(state, ctx, uid, 'cargo')).toBeNull()
    expect(shipOperationBlockReason(state, ctx, uid, 'configure')).not.toBeNull()
  })
  it('入侵编队僚舰不能被主控以外的操作入口改装', () => {
    const { state, uid } = world()
    const other = addShipToFleet(state, 'sh-mako')
    Object.assign(state.encounter, { active: true, shipId: uid, battle: { myFleet: [{ shipId: uid }, { shipId: other }] } })
    expect(shipActuallyDocked(state, ctx, other)).toBe(false)
    expect(shipOperationBlockReason(state, ctx, other, 'configure')).not.toBeNull()
  })
  it.each(['field', 'construction', 'battle'] as const)('%s中换驾驶预检与命令一致，拒绝不改变状态', mode => {
    const { state, uid } = world()
    const other = addShipToFleet(state, 'sh-mako')
    if (mode === 'field') state.awayGalaxy = 'galaxy-redring'
    if (mode === 'construction') state.dockedSite = [...ctx.stations.keys()][0]!
    if (mode === 'battle') Object.assign(state.encounter, { active: true, shipId: other, battle: { myFleet: [{ shipId: other }] } })
    const before = structuredClone(state)
    const block = changeShipBlockReason(state, other, ctx)
    expect(block).not.toBeNull()
    expect(changeShip(state, other, ctx)).toEqual({ ok: false, ...block })
    expect(state).toEqual(before)
    expect(wormholeAutoMainHandover(state, ctx, [uid]).reason).toBeTruthy()
    expect(state).toEqual(before)
  })
  it('运输切换失败不停止运输，合法换船才执行即时返港', () => {
    const { state, uid } = world()
    const other = addShipToFleet(state, 'sh-mako')
    state.hauling.active = true; state.awayGalaxy = 'galaxy-redring'
    state.shipReturns[other] = { beltId: null, legMs: 10000, phaseAccMs: 0 }
    const before = structuredClone(state)
    expect(changeShip(state, other, ctx).ok).toBe(false)
    expect(state).toEqual(before)
    delete state.shipReturns[other]
    expect(changeShipBlockReason(state, other, ctx)).toBeNull()
    expect(changeShip(state, other, ctx).ok).toBe(true)
    expect(state.shipId).toBe(other)
    expect(state.hauling.active).toBe(false)
    expect(shipActuallyDocked(state, ctx)).toBe(true)
    expect(state.shipReturns[uid]).toBeUndefined()
  })
  it('换驾驶保留采矿旧船真实返航与目标AI召回例外', () => {
    const { state, uid } = world()
    const other = addShipToFleet(state, 'sh-mako')
    occupy(state, uid, 'mining')
    state.mining.phase = 'mining'
    state.fleet[uid]!.cargo = { 'ammo-kinetic-l': 20 }
    state.aiAssignments[other] = { coreType: 'basic', task: { kind: 'standby', galaxyId: 'galaxy-redring', phase: 'standby' } } as never
    expect(changeShipBlockReason(state, other, ctx)).toBeNull()
    expect(changeShip(state, other, ctx).ok).toBe(true)
    expect(state.shipId).toBe(other)
    expect(state.shipReturns[uid]?.legMs).toBeGreaterThan(0)
    expect(state.fleet[uid]!.cargo['ammo-kinetic-l']).toBe(20)
    expect(state.aiAssignments[other]).toBeUndefined()
    expect(shipActuallyDocked(state, ctx)).toBe(true)
  })
  it('主控野外维修拒因显示舰名而非实例编号', () => {
    const { state, uid } = world()
    state.fleet[uid]!.customName = '维修测试船'
    state.awayGalaxy = 'galaxy-redring'
    expect(shipOperationBlockReason(state, ctx, uid, 'repair')?.errorParams?.p1).toBe('维修测试船')
  })
  it('AI副船正在交火时不能通过换驾驶召回，失败保留战斗与核心账', () => {
    const { state } = world()
    const other = addShipToFleet(state, 'sh-mako')
    state.aiAssignments[other] = { coreType: 'basic', task: { kind: 'expedition', phase: 'battle', battle: {} } } as never
    const before = structuredClone(state)
    expect(changeShipBlockReason(state, other, ctx)).not.toBeNull()
    expect(changeShip(state, other, ctx).ok).toBe(false)
    expect(state).toEqual(before)
  })
  it.each(['courier', 'planet', 'auto', 'encounter', 'transit'] as const)('%s空位置字段不能绕过换驾驶，拒绝不取消原活动', mode => {
    const { state, uid } = world()
    const other = addShipToFleet(state, 'sh-mako')
    occupy(state, uid, mode)
    const before = structuredClone(state)
    const block = changeShipBlockReason(state, other, ctx)
    expect(block).not.toBeNull()
    expect(changeShip(state, other, ctx)).toEqual({ ok: false, ...block })
    expect(state).toEqual(before)
  })
})

describe('远程管理只使用合法库存', () => {
  it('购船只入机库，主控空闲也不自动登舰', () => {
    const { state, uid } = world()
    expect(buyShip(state, 'sh-mako', ctx).ok).toBe(true)
    expect(state.shipId).toBe(uid)
  })
  it.each(modes)('%s中黑市不取消活动，研究不动船上碎片', mode => {
    const { state, uid } = world()
    occupy(state, uid, mode)
    const [moduleId, recipe] = Object.entries(FRAGMENT_RECIPES)[0]!
    const frag = fragmentItemIdOf(moduleId)
    state.fleet[uid]!.cargo = { [frag]: recipe.need }
    expect(fragmentRedeemRowsOf(state, ctx).find(row => row.moduleId === moduleId)!.have).toBe(0)
    const beforeCargo = { ...state.fleet[uid]!.cargo }
    expect(redeemFragments(state, ctx, moduleId).ok).toBe(false)
    state.warehouse.items[frag] = recipe.need
    expect(redeemFragments(state, ctx, moduleId).ok).toBe(true)
    expect(state.fleet[uid]!.cargo).toEqual(beforeCargo)
    const now = 1791864000000
    ensureBlackMarket(state, ctx, now)
    const before = structuredClone(state)
    const offer = state.blackMarket!.offers[0]!
    expect(blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket!.dayWallMs, offer.price, now).ok).toBe(true)
    for (const key of ['mining', 'salvaging', 'hauling', 'sideTasks', 'expedition', 'transit', 'standby', 'wormholeAuto', 'planetary'] as const) expect(state[key]).toEqual(before[key])
    expect(state.fleet[uid]!.cargo).toEqual(beforeCargo)
    expect(state.shipId).toBe(uid)
  })
  it('AI精炼只扣仓库，不拿正在采矿船上的物资', () => {
    const { state, uid } = world()
    const ore = [...ctx.items.values()].find(item => item.refine?.length && item.kind === 'ore')!
    state.skills.trained['ai-expert'] = 5
    state.aiCores.basic = 2
    state.mining.active = true
    state.fleet[uid]!.cargo = { [ore.id]: 100 }
    state.warehouse.items[ore.id] = 100
    expect(industryAvailable(state, ctx, ore.id)).toBe(100)
    expect(startRefineRun(state, ore.id, 'basic', ctx).ok).toBe(true)
    state.gameMs = state.refineRuns[0]!.finishAtGameMs
    advanceRefining(state, ctx)
    expect(state.fleet[uid]!.cargo[ore.id]).toBe(100)
    expect(state.warehouse.items[ore.id] ?? 0).toBeLessThan(100)
  })
  it('采矿切站内活动可安排，但预检不取消作业或伪造实际停靠', () => {
    const { state } = world()
    state.mining.active = true; state.mining.beltId = [...ctx.belts.keys()][0]!
    const before = structuredClone(state)
    expect(stationActivityStartBlockReason(state, ctx, 'refine')).toBeNull()
    expect(state).toEqual(before)
    expect(isAtHomeLike(state, ctx)).toBe(false)
  })
  it('原料不足一批不取消已有实验室手动作业', () => {
    const { state } = world()
    const ore = [...ctx.items.values()].find(item => item.refine?.length && item.kind === 'ore')!
    state.warehouse.items[ore.id] = 1
    state.labRuns = [{ active: true, worker: 'pilot' } as never]
    const before = structuredClone(state)
    expect(startRefineRun(state, ore.id, 'pilot', ctx).ok).toBe(false)
    expect(state).toEqual(before)
  })
  it('运输切手动炉按投影库存校验，但确认前不扣货也不取消运输', () => {
    const { state, uid } = world()
    const ore = [...ctx.items.values()].find(item => item.refine?.length && item.kind === 'ore')!
    state.fleet[uid]!.cargo = { [ore.id]: 100 }
    state.hauling.active = true; state.awayGalaxy = 'galaxy-redring'
    const before = structuredClone(state)
    expect(industryAvailable(state, ctx, ore.id)).toBe(0)
    expect(stationActivityStartBlockReason(state, ctx, 'refine')).toBeNull()
    expect(startRefineRun(state, ore.id, 'pilot', ctx).errorId).toBe('core.activityGate.002')
    expect(state).toEqual(before)
    expect(state.fleet[uid]!.cargo[ore.id]).toBe(100)
  })
  it('交付目标未探索不取消手动实验室、不创建建站进度账', () => {
    const { state } = world()
    const site = [...ctx.stations.values()][0]!
    delete state.stationSites[site.id]
    for (const material of site.tiers[0]!.bill) state.warehouse.items[material.itemId] = material.count
    state.exploredGalaxies = state.exploredGalaxies.filter(id => id !== site.galaxyId)
    state.labRuns = [{ active: true, worker: 'pilot' } as never]
    const before = structuredClone(state)
    expect(startSiteDeliverTrip(state, ctx, site.id).ok).toBe(false)
    expect(state).toEqual(before)
  })
})
