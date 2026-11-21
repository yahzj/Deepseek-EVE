import { createInitialState, type GameState } from '../state'
import type { SimContext } from '../types'
import { startRefineRun } from '../industry/refining/start'
import { refineBatchOutputOf } from '../industry/refining/params'
import { startManufacturing } from '../industry/manufacturing/start'
import { findBuildable } from '../industry/manufacturing/blueprints'
import { advanceMining, getMiningParams, oneLegMs, oneOutboundLegMs } from '../mining'
import { cargoCapacityM3Of } from '../inventory'
import { scaledReturnMs } from '../trips'
import { departureDurationMs } from '../departure'
import { isMineableItem } from '../labels'
import type { StationManufacturingRecipe } from './manufacturing'
import type { StationMiningHost, StationMiningRun } from './mining'
import { PLAYER_STATION_GALAXY_ID } from './rules'

export const STATION_GAME_ORIGIN = PLAYER_STATION_GALAXY_ID
// 仅借空闲工作位调用既有开工入口；不复制或停掉玩家的主控活动。
let industryIdle: GameState | undefined
function getIdle(): GameState {
  return industryIdle ??= createInitialState({ nowWallMs: 0, seed: 1 })
}

function industryState(state: GameState): GameState {
  return { ...getIdle(), gameMs: state.gameMs, wallMs: state.wallMs, debugQuick: state.debugQuick,
    skills: state.skills, research: state.research, learnedRecipes: [...state.learnedRecipes],
    blueprintStock: { ...state.blueprintStock }, spentOneTimeRecipes: [...(state.spentOneTimeRecipes ?? [])],
    warehouse: { items: {} }, refineRuns: [], manufacturingRuns: [], logs: [] }
}

export function refiningRecipe(state: GameState, ctx: SimContext, itemId: string): { batchUnits: number; cycleMs: number } | undefined {
  if (!ctx.items.get(itemId)?.refine?.length) return undefined
  const sim = industryState(state)
  sim.warehouse.items[itemId] = Number.MAX_SAFE_INTEGER
  if (!startRefineRun(sim, itemId, 'pilot', ctx).ok) return undefined
  const run = sim.refineRuns[0]
  return run ? { batchUnits: run.batchUnits, cycleMs: run.cycleMs } : undefined
}

export function refiningOutput(state: GameState, ctx: SimContext, itemId: string, batchUnits: number): Record<string, number> {
  const def = ctx.items.get(itemId)
  if (!def || !Number.isSafeInteger(batchUnits) || batchUnits < 1) return {}
  const output: Record<string, number> = {}
  for (const row of refineBatchOutputOf(state, ctx, def, batchUnits)) output[row.mineralId] = (output[row.mineralId] ?? 0) + row.units
  return output
}

/** 首版仅开放正式表里无需学习的基础零件；不把其他已学蓝图偷偷加入目录。 */
export function manufacturingRecipe(state: GameState, ctx: SimContext, blueprintId: string): StationManufacturingRecipe | undefined {
  const bp = ctx.blueprints.get(blueprintId)
  if (!bp?.learnless || bp.partTier !== 'basic' || !bp.itemId || !ctx.items.has(bp.itemId)) return undefined
  const buildable = findBuildable(ctx, blueprintId)
  if (!buildable || buildable.kind !== 'item') return undefined
  const sim = industryState(state)
  sim.debugQuick = false
  for (const material of bp.materials) sim.warehouse.items[material.itemId] = Number.MAX_SAFE_INTEGER
  if (!startManufacturing(sim, blueprintId, 'pilot', ctx).ok) return undefined
  const run = sim.manufacturingRuns[0]
  if (!run) return undefined
  const input: Record<string, number> = {}
  for (const row of run.spentMaterials ?? []) input[row.itemId] = (input[row.itemId] ?? 0) + row.count
  return { cycleMs: run.durationMs, input, output: { [bp.itemId]: buildable.outputUnits! } }
}

export function miningParams(state: GameState, ctx: SimContext, shipId: string, beltId: string): ReturnType<StationMiningHost['params']> {
  const belt = ctx.belts.get(beltId)
  if (shipId === state.shipId || !state.fleet[shipId] || belt?.galaxyId !== STATION_GAME_ORIGIN
    || belt.outputs?.length || !isMineableItem(ctx.items.get(belt.oreId))) return undefined
  const params = getMiningParams(state, ctx, { shipId, beltId })
  if (!params) return undefined
  return { cycleMs: params.cycleMs, unitsPerCycle: params.unitsPerCycle,
    capacityM3: cargoCapacityM3Of(state, ctx, shipId),
    departureMs: departureDurationMs(ctx, 'mining', STATION_GAME_ORIGIN, belt.galaxyId).totalMs }
}

function miningState(state: GameState, run: Readonly<StationMiningRun>): GameState {
  const ship = state.fleet[run.shipId]
  if (!ship) throw new Error('Invalid station mining ship')
  return { ...state, shipId: run.shipId, fleet: { [run.shipId]: { ...ship, cargo: { ...run.cargo } } },
    mining: { active: true, beltId: run.beltId, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0,
      autoCycle: true, stopAfterTrip: false, rvLeft: run.rvLeft, tripUnits: 0, originGalaxy: STATION_GAME_ORIGIN },
    rng: { ...run.rng }, firstStats: { ...state.firstStats }, logs: [], departure: undefined,
    warehouse: { ...state.warehouse, items: {} }, jumpFuel: { ...state.jumpFuel, mine: false } }
}

export function miningCycle(state: GameState, ctx: SimContext, run: Readonly<StationMiningRun>): ReturnType<StationMiningHost['cycle']> {
  const params = miningParams(state, ctx, run.shipId, run.beltId)
  if (!params) throw new Error('Invalid station mining recipe')
  const sim = miningState(state, run)
  advanceMining(sim, params.cycleMs, ctx)
  return { cargo: { ...sim.fleet[run.shipId]!.cargo }, rng: { ...sim.rng }, rvLeft: sim.mining.rvLeft ?? 0,
    returning: sim.mining.phase === 'returning' }
}

/** 本岗位没有燃料扣款接口，返航只取真实装配/技能及当前载重，不启用主控燃料。 */
export function miningReturnMs(state: GameState, ctx: SimContext, run: Readonly<StationMiningRun>): number {
  const sim = miningState(state, run)
  return scaledReturnMs(oneLegMs(sim, ctx, run.beltId, run.shipId, STATION_GAME_ORIGIN)
    + oneOutboundLegMs(sim, ctx, run.beltId, run.shipId, STATION_GAME_ORIGIN), sim, ctx, run.shipId)
}
