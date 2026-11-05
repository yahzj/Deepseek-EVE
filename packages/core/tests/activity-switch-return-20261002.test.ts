/** 野外作业直接转场不虚构返港；最终停止仍须按真实航程返航卸货。 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining, stopMining, oneLegMs, oneOutboundLegMs } from '../src/mining'
import { startSalvageOp, stopSalvageOp, legMsFor, outboundLegMsFor } from '../src/salvaging'
import { countWare } from '../src/inventory'
import { shipDisplayName } from '../src/instances'
import { anomaly, belt, galaxy, makeTestCtx, moduleDef, ship } from './helpers'
import { finishDeparture } from './helpers/departure-ready'
import { scaledReturnMs } from '../src/trips'

function ctxOf() {
  return makeTestCtx({
    quietEvents: true,
    ships: [ship('sandcat', { cargo: 800 })],
    belts: [belt('belt-a', 'ore-a')],
    galaxies: [
      { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
      { ...galaxy('galaxy-scrap', '废场'), security: -0.6 },
    ],
    edges: [{ from: 'galaxy-hub', to: 'galaxy-scrap', travelMinutes: 2 }],
    anomalies: [anomaly('ano-far', 'galaxy-scrap', { threat: 40, tactic: 'brawl' })],
    modules: [moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 })],
  })
}

describe('野外采矿与打捞转场及最终返航', () => {
  it('打捞转开采不虚构返港，最终停止开采后残骸随返航卸货', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.debugQuick = true
    state.exploredGalaxies.push('galaxy-scrap')
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    state.galaxyWrecks['galaxy-scrap'] = { density: 30, rare: 0 }
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    advanceGame(state, 5_000, ctx)
    expect(state.fleet[state.shipId]!.cargo['wreck-ano-far'] ?? 0, '本趟应有收获').toBeGreaterThan(0)
    const cargo = structuredClone(state.fleet[state.shipId]!.cargo)
    const before = countWare(state, 'wreck-ano-far')
    /** 🔴 切活动：新开采指令会把打捞挤掉（`AUTO_HALT` 档） */
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.salvaging.active, '打捞应已被自动停掉').toBe(false)
    // 已确认的野外转场：只走星门，不让旧返航账本提前卸走新作业的货。
    expect(state.departure).toMatchObject({ undockMs: 0, gateMs: 7000, fromGalaxy: 'galaxy-scrap' })
    advanceGame(state, 1, ctx)
    expect(state.pendingActivityReturn).toBeNull()
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    expect(countWare(state, 'wreck-ano-far')).toBe(before)
    expect(state.logs.some(log => log.textId === 'core.activityGate.001')).toBe(true)
    finishDeparture(state, ctx)
    const returnMs = scaledReturnMs(oneLegMs(state, ctx, 'belt-a') + oneOutboundLegMs(state, ctx, 'belt-a'), state, ctx, state.shipId)
    expect(stopMining(state, ctx)).toBe(true)
    const shipName = shipDisplayName(state, ctx, state.shipId)
    const stopLog = state.logs.filter(log => log.textId === 'core.mining.042').at(-1)!
    expect(stopLog.text, '日志应用船名而不是内部 id').toContain(shipName)
    expect(stopLog.text, '日志应报真实到港秒数').toMatch(/约 \d+ 秒后到港/)
    expect(stopLog.text, '不该残留占位口径的措辞').not.toContain('引擎下一拍')
    expect(state.shipReturns[state.shipId]!.legMs).toBe(returnMs)
    const leg = state.shipReturns[state.shipId]!
    advanceGame(state, leg.legMs - leg.phaseAccMs - 1, ctx)
    expect(state.shipReturns[state.shipId]).toBeDefined()
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    expect(countWare(state, 'wreck-ano-far')).toBe(before)
    advanceGame(state, 1, ctx)
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(countWare(state, 'wreck-ano-far')).toBe(before + cargo['wreck-ano-far']!)
    expect(state.fleet[state.shipId]!.cargo['wreck-ano-far'] ?? 0, '船上应已清空').toBe(0)
  })

  it('开采转打捞不提前卸货，最终停止打捞后原矿随返航卸货', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.debugQuick = true
    state.exploredGalaxies.push('galaxy-scrap')
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    state.galaxyWrecks['galaxy-scrap'] = { density: 30, rare: 0 }
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    advanceGame(state, 60_000, ctx)
    expect(state.fleet[state.shipId]!.cargo['ore-a'] ?? 0, '本趟应有收获').toBeGreaterThan(0)
    const cargo = structuredClone(state.fleet[state.shipId]!.cargo)
    const before = countWare(state, 'ore-a')
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    expect(state.mining.active, '采矿应已被自动停掉').toBe(false)
    expect(state.departure).toMatchObject({ undockMs: 0, gateMs: 7000, fromGalaxy: 'galaxy-hub' })
    advanceGame(state, 1, ctx)
    expect(state.pendingActivityReturn).toBeNull()
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    expect(countWare(state, 'ore-a')).toBe(before)
    expect(state.logs.some(log => log.textId === 'core.activityGate.001')).toBe(true)
    finishDeparture(state, ctx)
    const returnMs = scaledReturnMs(legMsFor(state, ctx, 'galaxy-scrap') + outboundLegMsFor(state, ctx, 'galaxy-scrap'), state, ctx, state.shipId)
    expect(stopSalvageOp(state, ctx)).toBe(true)
    const mineLog = state.logs.filter(log => log.textId === 'core.salvaging.029').at(-1)!
    expect(mineLog.text, '日志应用船名而不是内部 id').toContain(shipDisplayName(state, ctx, state.shipId))
    expect(mineLog.text, '日志应报真实到港秒数').toMatch(/约 \d+ 秒后到港/)
    expect(state.shipReturns[state.shipId]!.legMs).toBe(returnMs)
    const leg = state.shipReturns[state.shipId]!
    advanceGame(state, leg.legMs - leg.phaseAccMs - 1, ctx)
    expect(state.shipReturns[state.shipId]).toBeDefined()
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    expect(countWare(state, 'ore-a')).toBe(before)
    advanceGame(state, 1, ctx)
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(state.fleet[state.shipId]!.cargo).toEqual({})
    expect(countWare(state, 'ore-a')).toBe(before + cargo['ore-a']!)
  })
})
