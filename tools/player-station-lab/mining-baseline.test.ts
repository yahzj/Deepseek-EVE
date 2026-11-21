import { describe, expect, it } from 'vitest'
import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { advanceMining, getMiningParams, miningStatus, oneLegMs, oneOutboundLegMs, startMining } from '../../packages/core/src/mining'
import { cargoCapacityM3Of } from '../../packages/core/src/inventory'
import { scaledReturnMs } from '../../packages/core/src/trips'
import { departureDurationMs } from '../../packages/core/src/departure'
import { MINER_ID, MINING_BELTS, miningCycle, miningParams, miningReturnMs } from './mining-baseline'
import { advanceStationMining, createStationMining, stationMiningCommand } from '../../packages/core/src/playerStation/index'
import type { StationMiningHost } from '../../packages/core/src/playerStation/index'
import type { StationMiningRun } from '../../packages/core/src/playerStation/index'

function baseline(level: number) {
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 1 })
  const site = { id: 'lab-player-home', galaxyId: 'galaxy-grave', name: '合成玩家站', standingReq: 0,
    tiers: [], introDialogueId: null, doneDialogueId: null, description: '' }
  ctx.stations = new Map([...ctx.stations, [site.id, site]])
  for (const skill of ctx.skills.values()) state.skills.trained[skill.id] = level
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100; state.standingsEarned = { ...state.standingsEarned, dsi: 100 }
  state.fleet[MINER_ID] = { ...structuredClone(state.fleet.sandcat), cargo: {}, fitted: { high: ['mod-miner-1', 'mod-miner-1'], mid: [], low: [] } }
  state.shipId = MINER_ID; state.stationSites[site.id] = { stage: 0, delivered: {} }; state.dockedSite = site.id
  return { state, ctx }
}

describe('玩家站采矿预览：真实主控循环/货仓/返航基准', () => {
  it.each([0, 1, 2, 3, 4, 5])('统一技能%i与真实采矿逐循环一致，含富矿/满舱/返航缩放', level => {
    expect(MINING_BELTS.length).toBeGreaterThan(0)
    for (const belt of MINING_BELTS) {
      const { state, ctx } = baseline(level)
      expect(startMining(state, belt.id, ctx).ok).toBe(true)
      const params = getMiningParams(state, ctx)!, expected = miningParams(MINER_ID, belt.id, level)!
      expect(expected).toEqual({ cycleMs: params.cycleMs, unitsPerCycle: params.unitsPerCycle,
        capacityM3: cargoCapacityM3Of(state, ctx, MINER_ID), departureMs: departureDurationMs(ctx, 'mining', 'galaxy-grave', belt.galaxyId!).totalMs })
      advanceMining(state, expected.departureMs, ctx)
      const run: StationMiningRun = { shipId: MINER_ID, personIndex: 0, beltId: belt.id, phase: 'mining', progressMs: 0,
        durationMs: params.cycleMs, stopping: false, paused: false, cargo: {}, cyclesDone: 0, tripsDone: 0, rvLeft: 0, rng: { seed: 1, count: 0 } }
      let returned = false
      for (let cycle = 0; cycle < 1000 && !returned; cycle++) {
        const result = miningCycle(run, level)
        advanceMining(state, params.cycleMs, ctx)
        expect(result.cargo).toEqual(state.fleet[MINER_ID].cargo)
        expect(result.rng).toEqual(state.rng)
        expect(result.rvLeft).toBe(state.mining.rvLeft ?? 0)
        expect(result.returning).toBe(state.mining.phase === 'returning')
        run.cargo = result.cargo; run.rng = result.rng; run.rvLeft = result.rvLeft; returned = result.returning
        const actualReturn = scaledReturnMs(oneLegMs(state, ctx, belt.id, MINER_ID, 'galaxy-grave')
          + oneOutboundLegMs(state, ctx, belt.id, MINER_ID, 'galaxy-grave'), state, ctx, MINER_ID)
        expect(miningReturnMs(run, level)).toBe(actualReturn)
      }
      expect(returned).toBe(true)
      expect(miningStatus(state, ctx).remainingMs).toBe(miningReturnMs(run, level))
    }
  })
  it('本站以外、未知采集点或非合成矿船不偷偷开放', () => {
    expect(miningParams('lab-shuttle', 'belt-gas-phosphor', 0)).toBeUndefined()
    expect(miningParams(MINER_ID, 'unknown', 0)).toBeUndefined()
    expect(miningParams(MINER_ID, 'belt-gas-aurora', 0)).toBeUndefined()
  })
  it('自动循环跨趟保留富矿窗口，仓库/船货/随机状态逐阶段对照真实采矿', () => {
    const level = 0, beltId = 'belt-gas-phosphor', { state: live, ctx } = baseline(level)
    const state = createStationMining(), warehouse: Record<string, number> = {}
    const host: StationMiningHost = {
      residents: () => [0], personAvailable: () => true, ready: () => true,
      ship: () => ({ available: true, auxiliary: true, home: true }),
      params: (id, belt) => miningParams(id, belt, level), claimShip: () => ({}), releaseShip: () => {},
      cycle: run => miningCycle(run, level), returnMs: run => miningReturnMs(run, level),
      unload: cargo => { for (const [id, n] of Object.entries(cargo)) warehouse[id] = (warehouse[id] ?? 0) + n },
    }
    stationMiningCommand(state, host, { kind: 'assign', shipId: MINER_ID, personIndex: 0, beltId })
    startMining(live, beltId, ctx)
    live.warehouse.items = {}
    // 从同一满舱且还剩一循环奖励的边界出发，确保覆盖奖励跨越卸货的情况。
    state.runs[0].phase = 'mining'; state.runs[0].durationMs = miningParams(MINER_ID, beltId, level)!.cycleMs
    state.runs[0].cargo = { 'gas-phosphor': 100 }; state.runs[0].rvLeft = 1
    delete live.departure
    live.fleet[MINER_ID].cargo = { 'gas-phosphor': 100 }; live.mining.rvLeft = 1
    for (let i = 0; i < 2000 && state.runs[0].tripsDone < 2; i++) {
      const run = state.runs[0], delta = run.durationMs - run.progressMs
      advanceStationMining(state, host, delta)
      advanceMining(live, delta, ctx)
      expect(state.runs[0].cargo).toEqual(live.fleet[MINER_ID].cargo)
      expect(warehouse).toEqual(live.warehouse.items)
      expect(state.runs[0].rvLeft).toBe(live.mining.rvLeft ?? 0)
      expect(state.runs[0].rng).toEqual(live.rng)
    }
    expect(state.runs[0].tripsDone).toBe(2)
  })
})
