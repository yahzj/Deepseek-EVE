import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/fleetBook'
import { advanceMining, startMining, beltYieldRows, stopMining, getMiningParams } from '../src/mining'
import { advanceSalvageOp, startSalvageOp, salvageFleetCyclesOf, salvageReturnMs, legMsFor, outboundLegMsFor } from '../src/salvaging'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { cargoUsedM3Of } from '../src/inventory'
import { scaledReturnMs } from '../src/trips'
import { injectWeekendWreck, weekendWreckDensityOf } from '../src/salvage'
import { advanceGame } from '../src/engine'
import { simulateOffline } from '../src/simulation'
import { createCommandReadyState } from './helpers/command-ready'
import { finishDeparture } from './helpers/departure-ready'
import { anomaly, galaxy, makeTestCtx, moduleDef, ship } from './helpers'

function world() {
  const ctx = makeTestCtx({ quietEvents: true, marketGoods: [],
    ships: [ship('sandcat', { cargo: 800, cycle: 12, perCycle: 10 }), ship('fast', { cargo: 800, cycle: 6, perCycle: 7 })],
    galaxies: [galaxy('galaxy-scrap', '废场')],
    edges: [{ from: 'galaxy-hub', to: 'galaxy-scrap', travelMinutes: 2 }],
    anomalies: [anomaly('ano-scrap', 'galaxy-scrap', { threat: 40 })],
    modules: [moduleDef('salvage-fast', 'salvager', 0, { salvageCycleMs: 1000 }),
      moduleDef('salvage-slow', 'salvager', 0, { salvageCycleMs: 2500 })],
  })
  ctx.balance = { ...ctx.balance, richVeinChance: 0 }
  const state = createCommandReadyState({ nowWallMs: 0, seed: 42 })
  const leader = state.shipId
  const escort = addShipToFleet(state, 'fast')
  const idle = addShipToFleet(state, 'fast')
  state.preparationSquads = { combat: [leader, escort] }
  state.exploredGalaxies.push('galaxy-scrap')
  return { state, ctx, leader, escort, idle }
}

describe('实际出勤编队逐舰生产', () => {
  it('不同舰船按自己的循环、装配与货仓采集，未出勤舰无产出', () => {
    const { state, ctx, leader, escort, idle } = world()
    state.fleet[escort]!.fitted.high = ['mod-a']
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.preparationSquads = { combat: [leader, idle] }
    advanceMining(state, 12_000, ctx)
    expect(state.fleet[leader]!.cargo['ore-a']).toBe(10)
    expect(state.fleet[escort]!.cargo['ore-a']).toBe(22)
    expect(state.fleet[idle]!.cargo).toEqual({})
    expect(state.mining.tripUnits).toBe(32)
    expect(beltYieldRows(state, ctx, ctx.belts.get('belt-a')!)![0]!.perHour).toBe(9600)
  })

  it('采集分拍、大步与中途存读档结果相同，不丢随行舰半周期', () => {
    const { state, ctx, leader, escort } = world()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    const big = structuredClone(state)
    advanceMining(big, 25_000, ctx)
    advanceMining(state, 7_000, ctx)
    expect(state.mining.shipProgress?.[escort]?.cycleAccMs).toBe(1000)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    for (const ms of [1100, 3900, 7000, 6000]) advanceMining(loaded, ms, ctx)
    for (const id of [leader, escort]) expect(loaded.fleet[id]!.cargo).toEqual(big.fleet[id]!.cargo)
    expect(loaded.mining.shipProgress).toEqual(big.mining.shipProgress)
    expect(loaded.mining.cycleAccMs).toBe(big.mining.cycleAccMs)
    expect(loaded.rng).toEqual(big.rng)
    expect(stopMining(loaded, ctx)).toBe(true)
    expect(loaded.mining.shipProgress).toBeUndefined()
  })

  it('正式在线与离线入口多舰生产一致，汇总包含随行舰货仓', () => {
    const { state, ctx, leader, escort } = world()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    const offline = structuredClone(state)
    for (let i = 0; i < 24; i++) advanceGame(state, 1000, ctx)
    simulateOffline(offline, 0, 24_000, ctx)
    for (const id of [leader, escort]) expect(offline.fleet[id]!.cargo).toEqual(state.fleet[id]!.cargo)
    expect(offline.mining.shipProgress).toEqual(state.mining.shipProgress)
    expect([...offline.logs].reverse().find(row => row.textId === 'core.simulation.002')?.text).toContain('48')
  })

  it('随行舰自己的货仓不足时整队返航，不把矿转进主驾空仓', () => {
    const { state, ctx, leader, escort } = world()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.fleet[escort]!.cargo['ore-a'] = 799
    advanceMining(state, 6000, ctx)
    expect(state.mining.phase).toBe('returning')
    expect(state.fleet[leader]!.cargo).toEqual({})
    expect(state.fleet[escort]!.cargo['ore-a']).toBe(799)
    expect(cargoUsedM3Of(state, ctx, escort)).toBeLessThanOrEqual(800)
  })

  it('富矿窗口逐舰保存且额外产出不超本舰货仓', () => {
    const { state, ctx, leader, escort } = world()
    ctx.balance = { ...ctx.balance, richVeinChance: 100 }
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.fleet[escort]!.cargo['ore-a'] = 790
    advanceMining(state, 6000, ctx)
    expect(state.fleet[escort]!.cargo['ore-a']).toBe(800)
    expect(state.mining.shipProgress?.[escort]?.rvLeft).toBe(1)
    expect(state.mining.rvLeft).toBe(0)
    expect(state.fleet[leader]!.cargo).toEqual({})
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.mining.shipProgress?.[escort]?.rvLeft).toBe(1)
    advanceMining(loaded, 6000, ctx)
    expect(loaded.mining.phase).toBe('returning')
    expect(loaded.fleet[escort]!.cargo['ore-a']).toBe(800)
  })

  it('自动循环大步与逐秒推进跨多次全队卸货一致', () => {
    const { state, ctx, leader, escort } = world()
    state.debugQuick = true
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    const big = structuredClone(state)
    advanceMining(big, 180_000, ctx)
    for (let i = 0; i < 180; i++) advanceMining(state, 1000, ctx)
    expect(state.warehouse).toEqual(big.warehouse)
    expect(state.mining).toEqual(big.mining)
    expect(state.rng).toEqual(big.rng)
    for (const id of [leader, escort]) expect(state.fleet[id]!.cargo).toEqual(big.fleet[id]!.cargo)
    expect(state.warehouse.items['ore-a']).toBeGreaterThan(0)
  })

  it('无出勤快照旧采矿只计算主驾，不因准备名单补发僚舰产出', () => {
    const { state, ctx, leader, escort } = world()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    delete state.combatEscort
    advanceMining(state, 12_000, ctx)
    expect(state.fleet[leader]!.cargo['ore-a']).toBe(10)
    expect(state.fleet[escort]!.cargo).toEqual({})
  })

  it('打捞可由随行舰独立装配完成，按每台设备周期计次，不复制主驾设备', () => {
    const { state, ctx, leader, escort, idle } = world()
    state.fleet[leader]!.fitted.high = []
    state.fleet[escort]!.fitted.high = ['salvage-fast', 'salvage-slow']
    state.galaxyWrecks['galaxy-scrap'] = { density: 100, rare: 0 }
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    expect(salvageFleetCyclesOf(state, ctx)).toEqual([1000, 2500])
    advanceSalvageOp(state, 5000, ctx)
    expect(state.fleet[leader]!.cargo).toEqual({})
    expect(Object.values(state.fleet[escort]!.cargo).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    expect(state.fleet[idle]!.cargo).toEqual({})
    expect(state.firstStats?.salvageRuns).toBe(7)
  })

  it('相同周期的多台打捞器在各舰独立计时，不相互重复累积', () => {
    const { state, ctx, leader, escort } = world()
    state.fleet[leader]!.fitted.high = ['salvage-fast', 'salvage-fast']
    state.fleet[escort]!.fitted.high = ['salvage-fast']
    state.galaxyWrecks['galaxy-scrap'] = { density: 100, rare: 0 }
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    advanceSalvageOp(state, 999, ctx)
    expect(state.salvaging.tripM3).toBe(0)
    advanceSalvageOp(state, 1, ctx)
    expect(state.firstStats?.salvageRuns).toBe(3)
    expect(Object.keys(state.salvaging.deviceAccMs)).toHaveLength(3)
    expect(Object.values(state.salvaging.deviceAccMs)).toEqual([0, 0, 0])
  })

  it('打捞非整倍数周期分拍、大步与存读档结果相同', () => {
    const { state, ctx, leader, escort } = world()
    state.fleet[leader]!.fitted.high = ['salvage-fast']
    state.fleet[escort]!.fitted.high = ['salvage-slow']
    state.galaxyWrecks['galaxy-scrap'] = { density: 100, rare: 0 }
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    const big = structuredClone(state)
    advanceSalvageOp(big, 7200, ctx)
    advanceSalvageOp(state, 1700, ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.salvaging.deviceAccMs).toEqual(state.salvaging.deviceAccMs)
    for (const ms of [300, 500, 800, 1100, 2800]) advanceSalvageOp(loaded, ms, ctx)
    expect(loaded.salvaging.deviceAccMs).toEqual(big.salvaging.deviceAccMs)
    expect(loaded.salvaging.tripM3).toBe(big.salvaging.tripM3)
    expect(loaded.galaxyWrecks).toEqual(big.galaxyWrecks)
    expect(loaded.rng).toEqual(big.rng)
    for (const id of [leader, escort]) expect(loaded.fleet[id]!.cargo).toEqual(big.fleet[id]!.cargo)
  })

  it('旧打捞周期键与统一余量迁入一次，随行设备不补发过去产出', () => {
    const { state, ctx, leader, escort } = world()
    state.fleet[leader]!.fitted.high = ['salvage-slow']
    state.fleet[escort]!.fitted.high = ['salvage-fast']
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    delete state.salvaging.deviceClockVersion
    state.salvaging.deviceAccMs = { '2500': 1200 }
    state.salvaging.cycleAccMs = 800
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    advanceSalvageOp(loaded, 500, ctx)
    expect(loaded.firstStats?.salvageRuns).toBe(1)
    expect(loaded.salvaging.deviceClockVersion).toBe(2)
    expect(loaded.fleet[escort]!.cargo).toEqual({})
    expect(loaded.salvaging.deviceAccMs[JSON.stringify([escort, 0, 1000])]).toBe(500)
  })

  it('多舰共用有限入侵残骸池，取完不重复、满仓不扣库存', () => {
    const { state, ctx, leader, escort } = world()
    state.fleet[leader]!.fitted.high = ['salvage-fast']
    state.fleet[escort]!.fitted.high = ['salvage-fast']
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    injectWeekendWreck(state, 'galaxy-scrap', 5, 'R')
    advanceSalvageOp(state, 1000, ctx)
    const units = [leader, escort].reduce((sum, id) => sum + (state.fleet[id]!.cargo['wreck-r-inv'] ?? 0), 0)
    expect(units + weekendWreckDensityOf(state, 'galaxy-scrap')).toBe(5)
    state.fleet[leader]!.cargo = { 'ore-a': 800 }
    const before = structuredClone(state.weekendWrecks)
    advanceSalvageOp(state, 1000, ctx)
    expect(state.salvaging.phase).toBe('returning')
    expect(state.weekendWrecks).toEqual(before)
  })

  it('全队返航按最慢实际载货腿，不因主驾空仓瞬间到港', () => {
    const { state, ctx, leader, escort } = world()
    state.fleet[leader]!.fitted.high = ['salvage-fast']
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.fleet[escort]!.cargo = { 'ore-a': 800 }
    const expected = scaledReturnMs(legMsFor(state, ctx, 'galaxy-scrap', escort)
      + outboundLegMsFor(state, ctx, 'galaxy-scrap', escort), state, ctx, escort)
    expect(salvageReturnMs(state, ctx, 'galaxy-scrap')).toBe(expected)
  })

  it('非法进度不进入存档；过大设备积累最多兑现当前一轮，不补发海量产物', () => {
    const { state, ctx, leader, escort } = world()
    state.fleet[leader]!.fitted.high = ['salvage-fast']
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.mining.shipProgress = { [escort]: { cycleAccMs: -1, rvLeft: 1 }, ghost: { cycleAccMs: 100, rvLeft: 1 } }
    const key = JSON.stringify([leader, 0, 1000])
    state.salvaging.deviceAccMs = { [key]: Number.MAX_SAFE_INTEGER, bad: -1, overflow: 1e30 }
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.mining.shipProgress).toBeUndefined()
    expect(loaded.salvaging.deviceAccMs).toEqual({ [key]: Number.MAX_SAFE_INTEGER })
    advanceSalvageOp(loaded, 1, ctx)
    expect(loaded.firstStats?.salvageRuns).toBe(1)
    expect(loaded.salvaging.deviceAccMs[key]).toBe(1)
  })

  it('正式内容表单舰与三舰60秒读数逐舰匹配，不以舰数复制主驾产能', () => {
    const original = buildSimContext()
    const ctx = { ...original, balance: { ...original.balance, richVeinChance: 0 } }
    const readings = []
    for (const defs of [['sandcat'], ['sandcat', 'burrower', 'whale']]) {
      const state = createCommandReadyState({ nowWallMs: 0, seed: 71 })
      state.fleet = {}
      const ids = defs.map(id => addShipToFleet(state, id))
      state.shipId = ids[0]!
      state.preparationSquads = { combat: ids }
      const belt = [...ctx.belts.values()].find(row => !row.outputs?.length && (row.standingReq ?? 0) === 0)!
      state.exploredGalaxies = [...ctx.galaxies.keys()]
      expect(startMining(state, belt.id, ctx).ok).toBe(true)
      finishDeparture(state, ctx)
      const expected = ids.map(id => {
        const params = getMiningParams(state, ctx, { shipId: id })!
        return Math.floor(60_000 / params.cycleMs) * params.unitsPerCycle
      })
      advanceMining(state, 60_000, ctx)
      const actual = ids.map(id => state.fleet[id]!.cargo[belt.oreId] ?? 0)
      expect(actual).toEqual(expected)
      readings.push({ defs, itemId: belt.oreId, units: actual })
    }
    console.log('[编队60秒产出]', JSON.stringify(readings))
  })
})
