import { describe, expect, it } from 'vitest'
import { buildPlanetCatalog, buildSimContext } from '@whale/data'
import {
  createInitialState, discoverPlanet, surveyPlanet, preparePlanetBase, startPlanetBuild, startPlanetClear,
  cancelPlanetJob, pausePlanetJob, advancePlanetary, allocatePlanetPower, planetColonyView,
  wakePlanetPopulation, sleepPlanetPopulation, assignPlanetWorker, repairPlanetBuilding, togglePlanetBuilding,
  startPlanetProject, dispatchPlanetDelivery, convertPlanetSupplies, addShipToFleet, shipLockedReason,
  discoverPlanetHumans, reconcilePlanetHome, advanceGame,
} from '../src/index'
import { loadSaveFile, serializeSaveFile } from '../src/save'
const catalog = buildPlanetCatalog()
const ctx = buildSimContext()
function setup() {
  const state = createInitialState({ seed: 7, nowWallMs: 0 })
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.planetary = { planets: {}, runtimeVersion: 1 }
  discoverPlanet(state, catalog, 'planet-prototype-large')
  surveyPlanet(state, catalog, 'planet-prototype-large', 3)
  const p = state.planetary.planets['planet-prototype-large']!
  preparePlanetBase(p, catalog)
  p.colony!.items['min-tritanium'] = 10000
  p.colony!.credits = 100000
  p.colony!.supplies = { medicine: 100, parts: 100, food: 100, water: 100, metal: 100, research: 100 }
  return { state, p, c: p.colony! }
}
function install(p: ReturnType<typeof setup>['p'], id: string) {
  const cell = p.cells.find(c => !c.obstacle && !c.building)!
  expect(startPlanetBuild(p, catalog, cell.index, id).ok).toBe(true)
  return cell.index
}
function habitat() {
  const s = setup()
  const indices = ['base', 'power', 'cryo', 'water', 'nutrition', 'housing'].map(id => install(s.p, id))
  advancePlanetary(s.state, 30 * 60000, catalog)
  allocatePlanetPower(s.p, catalog)
  s.c.sleeping = 6
  return { ...s, indices }
}
describe('星球施工与本地材料', () => {
  it('整批扣本地材料与费用，仓库不动；失败不扣', () => {
    const { state, p, c } = setup()
    const before = structuredClone(state.warehouse)
    const items = c.items['min-tritanium']!
    install(p, 'base')
    expect(c.items['min-tritanium']).toBeLessThan(items)
    expect(state.warehouse).toEqual(before)
    c.credits = 0
    const empty = p.cells.find(c => !c.obstacle && !c.building)!
    const snap = structuredClone(c)
    expect(startPlanetBuild(p, catalog, empty.index, 'power').ok).toBe(false)
    expect(c).toEqual(snap)
  })
  it('未动工可退全额，部分工期只退未使用部分，不允许二次退', () => {
    const { state, p, c } = setup()
    const initial = c.items['min-tritanium']!
    install(p, 'base')
    const seq = c.jobs[0]!.seq
    expect(cancelPlanetJob(p, seq).ok).toBe(true)
    expect(c.items['min-tritanium']).toBe(initial)
    expect(cancelPlanetJob(p, seq).ok).toBe(false)
    install(p, 'power')
    advancePlanetary(state, 60000, catalog)
    expect(cancelPlanetJob(p, c.jobs[0]!.seq).ok).toBe(true)
    expect(c.items['min-tritanium']).toBeLessThan(initial)
  })
  it('障碍清除保资源，暂停续工不重扣', () => {
    const { state, p, c } = setup()
    const blocked = p.cells.find(c => c.obstacle)!
    const deposit = structuredClone(blocked.deposit)
    expect(startPlanetClear(p, catalog, blocked.index).ok).toBe(true)
    const paid = c.items['min-tritanium']
    pausePlanetJob(p, c.jobs[0]!.seq, true)
    advancePlanetary(state, 600000, catalog)
    expect(blocked.obstacle).toBeDefined()
    pausePlanetJob(p, c.jobs[0]!.seq, false)
    advancePlanetary(state, 120000, catalog)
    expect(blocked.obstacle).toBeUndefined()
    expect(blocked.deposit).toEqual(deposit)
    expect(c.items['min-tritanium']).toBe(paid)
  })
})
describe('生存、人口与维修', () => {
  it('无人基地先准备生存，唤醒不会超住房／库存，岗位不重复占用', () => {
    const s = habitat()
    expect(planetColonyView(s.p, catalog).ready).toBe(true)
    expect(wakePlanetPopulation(s.p, catalog, 5).ok).toBe(false)
    expect(wakePlanetPopulation(s.p, catalog, 1).ok).toBe(true)
    const a = install(s.p, 'farm'), b = install(s.p, 'research')
    advancePlanetary(s.state, 10 * 60000, catalog)
    expect(assignPlanetWorker(s.p, catalog, a, true).ok).toBe(true)
    expect(assignPlanetWorker(s.p, catalog, b, true).ok).toBe(false)
    expect(assignPlanetWorker(s.p, catalog, a, false).ok).toBe(true)
    expect(assignPlanetWorker(s.p, catalog, b, true).ok).toBe(true)
  })
  it('供电优先生存，高级产业不抢冷冻舱，缺电保护人口而不是杀死', () => {
    const s = habitat()
    wakePlanetPopulation(s.p, catalog, 1)
    const total = s.c.awake + s.c.sleeping
    togglePlanetBuilding(s.p, catalog, s.indices[1]!, false)
    advancePlanetary(s.state, 10000, catalog)
    expect(s.c.awake + s.c.sleeping).toBe(total)
    expect(s.c.crisis).toBe('rescue')
    togglePlanetBuilding(s.p, catalog, s.indices[1]!, true)
    expect(sleepPlanetPopulation(s.p, catalog, 1).ok).toBe(true)
    expect(s.c.awake).toBe(0)
  })
  it('机械运转磨损、手动维修扣零件，停机不消失', () => {
    const s = habitat()
    const power = s.p.cells[s.indices[1]!]!.building!
    advancePlanetary(s.state, 3600000, catalog)
    expect(power.condition).toBeLessThan(1)
    const parts = s.c.supplies.parts!
    expect(repairPlanetBuilding(s.p, catalog, s.indices[1]!).ok).toBe(true)
    expect(power.condition).toBe(1)
    expect(s.c.supplies.parts).toBeLessThan(parts)
    expect(repairPlanetBuilding(s.p, catalog, s.indices[1]!).ok).toBe(false)
  })
  it('小步、大步与中途存档相同，不额外补离线时间', () => {
    const { state } = habitat()
    const a = structuredClone(state), b = structuredClone(state)
    advancePlanetary(a, 3600500, catalog)
    for (let i = 0; i < 3600; i++) advancePlanetary(b, 1000, catalog)
    advancePlanetary(b, 500, catalog)
    expect(b.planetary).toEqual(a.planetary)
    const loaded = loadSaveFile(serializeSaveFile(b, 0)).state
    expect(loaded.planetary).toEqual(b.planetary)
    advancePlanetary(a, 12345, catalog); advancePlanetary(loaded, 12345, catalog)
    expect(loaded.planetary).toEqual(a.planetary)
  })
})
describe('物流与改造整链', () => {
  it('货船实际容量、锁定、到达才入库且只交付一次', () => {
    const { state, p, c } = setup()
    const uid = addShipToFleet(state, 'sh-manatee')
    state.warehouse.items['min-tritanium'] = 1000
    state.wallet.isk = 100000
    const initial = c.items['min-tritanium']!
    expect(dispatchPlanetDelivery(state, ctx, catalog, p.id, uid, { 'min-tritanium': 100 }, 1000, 0).ok).toBe(true)
    expect(c.items['min-tritanium']).toBe(initial)
    expect(shipLockedReason(state, uid)).not.toBeNull()
    expect(dispatchPlanetDelivery(state, ctx, catalog, p.id, uid, { 'min-tritanium': 100 }, 0, 0).ok).toBe(false)
    advancePlanetary(state, 3600000, catalog)
    expect(c.items['min-tritanium']).toBe(initial + 100)
    expect(shipLockedReason(state, uid)).toBeNull()
    advancePlanetary(state, 3600000, catalog)
    expect(c.items['min-tritanium']).toBe(initial + 100)
  })
  it('本地医疗兑换只能用已送达物品，未知物品拒绝', () => {
    const { state, p, c } = setup()
    state.warehouse.items['repairkit-civ'] = 100
    expect(convertPlanetSupplies(state, p.id, 'repairkit-civ', 1).ok).toBe(false)
    c.items['repairkit-civ'] = 10
    const medicine = c.supplies.medicine!
    expect(convertPlanetSupplies(state, p.id, 'repairkit-civ', 3).ok).toBe(true)
    expect(c.supplies.medicine).toBe(medicine + 3)
    expect(state.warehouse.items['repairkit-civ']).toBe(100)
  })
  it('改造施工完成才替换特性，原始记录／资源不变，重做拒绝', () => {
    const { state, p, c } = setup()
    p.traitIds = ['corrosive', 'metal-veins']; p.hiddenTraitId = 'corrosive'
    p.cells = p.cells.map(cell => ({ index: cell.index }))
    p.cells[0]!.building = { id: 'power', status: 'ready', powered: true, staffed: false, enabled: true, condition: 1 }
    const before = structuredClone(p.cells)
    expect(startPlanetProject(p, catalog, 'detox-corrosive').ok).toBe(true)
    expect(p.traitIds).toContain('corrosive')
    advancePlanetary(state, 3600000, catalog)
    expect(p.traitIds).toContain('controlled-corrosion')
    expect(p.originalTraitIds).toEqual(['corrosive', 'metal-veins'])
    expect(p.cells.map(c => c.deposit)).toEqual(before.map(c => c.deposit))
    expect(c.supplies.research).toBe(70)
    expect(startPlanetProject(p, catalog, 'detox-corrosive').ok).toBe(false)
  })
  it('未公开世界不会自动完成寻人，显式调查后只完成一次', () => {
    const { state, p } = setup()
    state.importantTasks['find-humans'] = { done: false }
    p.traitIds = ['old-dome']; p.hiddenTraitId = 'old-dome'; p.cells = p.cells.map(cell => ({ index: cell.index }))
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['find-humans']!.done).toBe(false)
    expect(discoverPlanetHumans(state, ctx, catalog, p.id).ok).toBe(true)
    expect(state.planetary!.humans!.sleeping).toBe(6)
    expect(state.importantTasks['find-humans']!.done).toBe(true)
    expect(discoverPlanetHumans(state, ctx, catalog, p.id).ok).toBe(false)
    reconcilePlanetHome(state, catalog)
    expect(state.importantTasks['human-home']!.done).toBe(false)
  })
})
