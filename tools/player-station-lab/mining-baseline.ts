import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { advanceMining, getMiningParams, oneLegMs, oneOutboundLegMs } from '../../packages/core/src/mining'
import { cargoCapacityM3Of, cargoUsedM3Of } from '../../packages/core/src/inventory'
import { scaledReturnMs } from '../../packages/core/src/trips'
import { departureDurationMs } from '../../packages/core/src/departure'
import { effectiveCpu, fittedCpuUsed } from '../../packages/core/src/equipment'
import type { StationMiningRun } from '../../packages/core/src/playerStation/index'

const context = buildSimContext()
// 仅合成取数上下文登记已建玩家站，正式站点目录不变；C2先开放本站同星系采集点。
const site = { id: 'lab-player-home', galaxyId: 'galaxy-grave', name: '合成玩家站', standingReq: 0,
  tiers: [], introDialogueId: null, doneDialogueId: null, description: '' }
context.stations = new Map([...context.stations, [site.id, site]])
export const MINING_BELTS = [...context.belts.values()].filter(belt => belt.galaxyId === site.galaxyId && !belt.outputs?.length)
export const MINER_ID = 'lab-miner'
const profiles = new Map<number, ReturnType<typeof createInitialState>>()

function profile(level: number) {
  let state = profiles.get(level)
  if (!state) {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    for (const skill of context.skills.values()) state.skills.trained[skill.id] = level
    state.fleet[MINER_ID] = { ...structuredClone(state.fleet.sandcat), cargo: {}, fitted: { high: ['mod-miner-1', 'mod-miner-1'], mid: [], low: [] } }
    state.shipId = MINER_ID
    state.stationSites[site.id] = { stage: 0, delivered: {} }
    state.dockedSite = site.id
    const def = context.ships.get('sandcat')!
    if (fittedCpuUsed(state.fleet[MINER_ID].fitted, context, def) > effectiveCpu(state, context, def)) throw new Error('合成矿船CPU装配无效')
    profiles.set(level, state)
  }
  return state
}
function working(run: Readonly<StationMiningRun>, level: number) {
  const state = structuredClone(profile(level))
  state.fleet[MINER_ID].cargo = { ...run.cargo }
  state.rng = { ...run.rng }
  state.mining = { ...state.mining, active: true, beltId: run.beltId, phase: 'mining', cycleAccMs: 0,
    phaseAccMs: 0, autoCycle: true, stopAfterTrip: false, rvLeft: run.rvLeft, tripUnits: 0, originGalaxy: site.galaxyId }
  return state
}
export function miningParams(shipId: string, beltId: string, level: number) {
  if (shipId !== MINER_ID || !MINING_BELTS.some(belt => belt.id === beltId)) return undefined
  const state = profile(level), params = getMiningParams(state, context, { shipId: MINER_ID, beltId })
  if (!params) return undefined
  return { cycleMs: params.cycleMs, unitsPerCycle: params.unitsPerCycle, capacityM3: cargoCapacityM3Of(state, context, MINER_ID),
    departureMs: departureDurationMs(context, 'mining', site.galaxyId, params.belt.galaxyId ?? site.galaxyId).totalMs }
}
export function miningCycle(run: Readonly<StationMiningRun>, level: number) {
  const state = working(run, level), params = getMiningParams(state, context)!
  advanceMining(state, params.cycleMs, context)
  return { cargo: { ...state.fleet[MINER_ID].cargo }, rng: { ...state.rng }, rvLeft: state.mining.rvLeft ?? 0,
    returning: state.mining.phase === 'returning' }
}
export function miningReturnMs(run: Readonly<StationMiningRun>, level: number) {
  const state = working(run, level)
  return scaledReturnMs(oneLegMs(state, context, run.beltId, MINER_ID, site.galaxyId)
    + oneOutboundLegMs(state, context, run.beltId, MINER_ID, site.galaxyId), state, context, MINER_ID)
}
export function miningCargoValid(cargo: Readonly<Record<string, number>>) {
  return Object.entries(cargo).every(([id, n]) => context.items.has(id) && Number.isSafeInteger(n) && n > 0)
}
export function miningCargoM3(cargo: Readonly<Record<string, number>>, level: number) {
  const state = structuredClone(profile(level))
  state.fleet[MINER_ID].cargo = { ...cargo }
  return cargoUsedM3Of(state, context, MINER_ID)
}
