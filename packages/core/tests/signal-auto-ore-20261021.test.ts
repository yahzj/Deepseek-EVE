import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import * as grids from '../src/wormholeGrid'
import * as sim from '../src/wormholeAutoSim'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule } from '../src/equipment'
import { wormholeAutoStart, advanceWormholeAuto, wormholeAutoReportsOf, WORMHOLE_AUTO_DURATION_MS } from '../src/wormholeAuto'
import { wormholeStockPush } from '../src/wormholeScan'
import { wormholeMinersInFleet, wormholeSalvagersInFleet } from '../src/wormholeSalvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const makeGrid = grids.wormholeMakeGrid
afterEach(() => vi.restoreAllMocks())

function controlled(places: grids.WormholePlace[], options: Partial<Parameters<typeof sim.wormholeAutoDescend>[0]> = {}) {
  vi.spyOn(grids, 'wormholeMakeGrid').mockImplementation((...args) => {
    const grid = makeGrid(...args)
    for (const cell of grid.cells) cell.place = 'empty'
    const cells = grid.cells.filter(cell => !grids.isExitCell(grid, cell) && grids.hexDistance(grid.start, cell) > 0)
      .sort((a, b) => grids.hexDistance(grid.start, a) - grids.hexDistance(grid.start, b))
    places.forEach((place, index) => { cells[index]!.place = place })
    return grid
  })
  return sim.wormholeAutoDescend({ seed: 71, startDepth: 9, totalMass: 0, holdM3: 10000, oreUnitM3: ctx.items.get('ore-voidmother')!.unitM3, miners: 4, salvagers: 4,
    scanRadius: 100, power: { dps: 1, ehp: 1 }, guardPowerOf: () => ({ dps: 1e12, ehp: 1e12 }), tech: { wreck: 1, ore: 1 }, ...options })
}

describe('信号空间自动探索资源额度与真实设备', () => {
  it('墓场先回收超过25%后仍会采矿，有空舱不被旧软额度阻断', () => {
    const result = controlled(['graveyard', 'vein'], { startDepth: 1, holdM3: 3000 })
    expect(result.wreckM3).toBeGreaterThan(3000 * .25 * sim.WORMHOLE_AUTO_SIM_YIELD_MUL)
    expect(result.oreUnits).toBeGreaterThan(0)
    expect(result.oreUnits + result.wreckM3).toBeLessThanOrEqual(3000)
  })
  it.each([['vein', 0, 4], ['graveyard', 4, 0], ['ruins', 4, 0]] as const)('%s没有对应设备则不去作业', (place, miners, salvagers) => {
    const result = controlled([place], { miners, salvagers })
    expect(result.cellsExplored).toBe(0)
    expect(result.oreUnits).toBe(0)
    expect(result.wreckM3).toBe(0)
    expect(result.rareItems).toBe(0)
    expect(result.relicBoxes).toBe(0)
  })
  it('无采集器不会虚构母矿，但有打捞器仍能回收墓场', () => {
    const result = controlled(['vein', 'graveyard'], { miners: 0 })
    expect(result.oreUnits).toBe(0)
    expect(result.wreckM3).toBeGreaterThan(0)
  })
  it('无打捞器不会捞墓场或遗迹，但有采集器仍能采矿', () => {
    const result = controlled(['graveyard', 'vein', 'ruins'], { salvagers: 0 })
    expect(result.oreUnits).toBeGreaterThan(0)
    expect(result.wreckM3).toBe(0)
    expect(result.rareItems).toBe(0)
    expect(result.relicBoxes).toBe(0)
  })
  it('无作业设备的谜质拾取与战斗残骸沿原规则，不伪装为采集或打捞', () => {
    const result = controlled(['matter', 'ship'], { miners: 0, salvagers: 0, power: { dps: 1e9, ehp: 1e9 },
      guardPowerOf: () => ({ dps: 1, ehp: 1 }), holdM3: 2000 })
    expect(result.matterDevices).toBeGreaterThan(0)
    expect(result.fightsWon).toBeGreaterThan(0)
    expect(result.wreckM3).toBeGreaterThan(0)
    expect(result.oreUnits).toBe(0)
  })
  it.each(['vein', 'graveyard'] as const)('%s多台作业只减少所需回合，不凭空补齐末批资源', place => {
    const one = controlled([place], { miners: 1, salvagers: 1, holdM3: 1e9 })
    const many = controlled([place], { miners: 100, salvagers: 100, holdM3: 1e9 })
    expect(one.oreUnits).toBe(many.oreUnits)
    expect(one.wreckM3).toBe(many.wreckM3)
  })
  it('回合紧张时多台采集可完成更多堆，不越过撤离预留回合', () => {
    const places = Array<grids.WormholePlace>(5).fill('vein')
    const one = controlled(places, { miners: 1, totalMass: 1e9, holdM3: 1e9 })
    const many = controlled(places, { miners: 4, totalMass: 1e9, holdM3: 1e9 })
    expect(one.oreUnits).toBeGreaterThan(0)
    expect(many.oreUnits).toBeGreaterThan(one.oreUnits)
    expect(one.outOfTurns).toBe(true)
  })
  it('母矿使用传入的物品体积，不能再用固定半立方低估占用', () => {
    const result = controlled(['vein'], { holdM3: 100, oreUnitM3: 2 })
    expect(result.holdFull).toBe(true)
    expect(result.oreUnits).toBe(50 * sim.WORMHOLE_AUTO_SIM_YIELD_MUL)
  })
  it('没有可达矿脉或连移动作业的回合都不足时仍允许零矿', () => {
    expect(controlled(['graveyard']).oreUnits).toBe(0)
    vi.spyOn(grids, 'wormholeGridRadiusFor').mockReturnValue(10)
    const noTurns = controlled(['vein'], { scanRadius: 1, totalMass: 1e9 })
    expect(noTurns.outOfTurns).toBe(true)
    expect(noTurns.oreUnits).toBe(0)
  })
  it.each(['ship', 'vein', 'graveyard'] as const)('%s收益包含战斗掉落也不能超出真实剩余货舱', place => {
    const result = controlled([place], { holdM3: 10, power: { dps: 1e9, ehp: 1e9 }, guardPowerOf: () => ({ dps: 1, ehp: 1 }) })
    expect(result.holdFull).toBe(true)
    expect(result.oreUnits + result.wreckM3).toBeLessThanOrEqual(10)
  })
  it('有限回合首先访问遗迹与谜质，不因矿量修复而改为采矿优先', () => {
    const result = controlled(['vein', 'graveyard', 'matter', 'ruins'], { totalMass: 1e9, scanRadius: 100 })
    expect(result.matterDevices + result.relicBoxes + result.rareItems).toBeGreaterThan(0)
  })
})

function team() {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  state.skills.trained['ai-expert'] = 6
  for (const skill of ctx.skills.values()) state.skills.trained[skill.id] = 5
  state.research!.levels = Object.fromEntries([...ctx.matterTech!.values()].map(node => [node.id, node.maxLevel]))
  const fleet = Array.from({ length: 4 }, () => addShipToFleet(state, 'sh-nautilus'))
  for (const uid of fleet) for (const id of ['mod-laser-3', 'mod-miner-3', 'mod-salvager-3', ...Array<string>(4).fill('mod-cargo-3')]) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(fitModule(state, id, ctx, { shipId: uid }).ok).toBe(true)
  }
  const stock = wormholeStockPush(state, ctx)!
  stock.seed = 10
  stock.depth = 1
  stock.family = 'A'
  return { state, fleet, stock }
}

describe('真实派队取数与返航入库', () => {
  it('真实种子10不再被旧共享额度挡住采矿，正常完成并释放队伍', () => {
    const { state, fleet, stock } = team()
    expect(wormholeAutoStart(state, ctx, stock.id, fleet).ok).toBe(true)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS
    advanceWormholeAuto(state, ctx)
    const report = wormholeAutoReportsOf(state)[0]!
    const ore = report.gains.find(row => row.itemId === 'ore-voidmother')!.units
    expect(ore).toBeGreaterThan(0)
    expect(state.warehouse.items['ore-voidmother']).toBe(ore)
    expect(state.wormholeAuto).toHaveLength(0)
    expect(report.coresReleased).toBe(0)
    for (const uid of fleet) expect(state.fleet[uid]!.durability).toBeGreaterThanOrEqual(.1)
  })
  it('在途档重载和一次离线大推进的结算与在线分步一致，不重复发货', () => {
    const { state, fleet, stock } = team()
    expect(wormholeAutoStart(state, ctx, stock.id, fleet).ok).toBe(true)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    state.gameMs = WORMHOLE_AUTO_DURATION_MS - 1
    advanceWormholeAuto(state, ctx)
    expect(wormholeAutoReportsOf(state)).toHaveLength(0)
    state.gameMs += 1
    advanceWormholeAuto(state, ctx)
    loaded.gameMs = WORMHOLE_AUTO_DURATION_MS
    advanceWormholeAuto(loaded, ctx)
    expect(wormholeAutoReportsOf(loaded)[0]!.gains).toEqual(wormholeAutoReportsOf(state)[0]!.gains)
    expect(loaded.warehouse.items['ore-voidmother']).toBe(state.warehouse.items['ore-voidmother'])
    const ware = structuredClone(loaded.warehouse)
    advanceWormholeAuto(loaded, ctx)
    expect(loaded.warehouse).toEqual(ware)
    expect(wormholeAutoReportsOf(loaded)).toHaveLength(1)
  })
  it('统计单点识别独立设备分类，多台数量传入模拟器而非旧兜底1台', () => {
    const { state, fleet, stock } = team()
    const descend = vi.spyOn(sim, 'wormholeAutoDescend')
    expect(wormholeMinersInFleet(state, ctx, fleet)).toBe(4)
    expect(wormholeSalvagersInFleet(state, ctx, fleet)).toBe(4)
    expect(wormholeAutoStart(state, ctx, stock.id, fleet).ok).toBe(true)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS
    advanceWormholeAuto(state, ctx)
    expect(descend.mock.calls.at(-1)![0]).toMatchObject({ miners: 4, salvagers: 4 })
  })
  it('混合地点真实派队采到矿后报告、仓库与重载一致，不写参与舰货仓', () => {
    controlled(['graveyard', 'vein'], { startDepth: 1 })
    const { state, fleet, stock } = team()
    const before = state.warehouse.items['ore-voidmother'] ?? 0
    const cargo = fleet.map(uid => structuredClone(state.fleet[uid]!.cargo))
    expect(wormholeAutoStart(state, ctx, stock.id, fleet).ok).toBe(true)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS
    advanceWormholeAuto(state, ctx)
    const report = wormholeAutoReportsOf(state)[0]!
    const ore = report.gains.find(row => row.itemId === 'ore-voidmother')!.units
    expect(ore).toBeGreaterThan(0)
    expect(state.warehouse.items['ore-voidmother']).toBe(before + ore)
    expect(fleet.map(uid => state.fleet[uid]!.cargo)).toEqual(cargo)
    const reloaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(reloaded.warehouse.items['ore-voidmother']).toBe(before + ore)
    expect(wormholeAutoReportsOf(reloaded)[0]!.gains).toEqual(report.gains)
  })
  it('正式入口缺采集器时确实不会带矿，缺打捞器不生成地点打捞收益', () => {
    controlled(['graveyard', 'vein', 'ruins'], { startDepth: 1 })
    const { state, fleet, stock } = team()
    for (const uid of fleet) state.fleet[uid]!.fitted.high = ['mod-laser-3']
    const descend = vi.spyOn(sim, 'wormholeAutoDescend')
    expect(wormholeAutoStart(state, ctx, stock.id, fleet).ok).toBe(true)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS
    advanceWormholeAuto(state, ctx)
    expect(descend.mock.calls.at(-1)![0]).toMatchObject({ miners: 0, salvagers: 0 })
    const gains = wormholeAutoReportsOf(state)[0]!.gains
    expect(gains.some(row => row.itemId === 'ore-voidmother' || row.itemId.startsWith('wreck-') || row.itemId.startsWith('box-'))).toBe(false)
  })
})
