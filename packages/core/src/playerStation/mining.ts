import type { PlayerStationBill } from './types'

export interface StationMiningRun {
  shipId: string
  personIndex: number
  beltId: string
  phase: 'departure' | 'mining' | 'returning'
  progressMs: number
  durationMs: number
  stopping: boolean
  paused: boolean
  cargo: Record<string, number>
  cyclesDone: number
  tripsDone: number
  rvLeft: number
  rng: { seed: number; count: number }
}
export interface StationMining { version: 1; runs: StationMiningRun[]; sequence: number }
export interface StationMiningHost {
  residents(): readonly number[]
  personAvailable(index: number): boolean
  ready(): boolean
  ship(id: string): { available: boolean; auxiliary: boolean; home: boolean } | undefined
  params(shipId: string, beltId: string): { cycleMs: number; unitsPerCycle: number; capacityM3: number; departureMs: number } | undefined
  /** 原子占船并转交其全部原货物，失败不得改船或货物。 */
  claimShip(id: string): Record<string, number> | undefined
  releaseShip(id: string, cargo: PlayerStationBill): void
  /** 单循环与实际返航参数由既有采矿单点提供。 */
  cycle(run: Readonly<StationMiningRun>): { cargo: Record<string, number>; rvLeft: number; rng: { seed: number; count: number }; returning: boolean }
  returnMs(run: Readonly<StationMiningRun>): number
  /** 到港后一次性交接全部货物；失败须不入库。 */
  unload(cargo: PlayerStationBill): void
}
export type StationMiningAction = { kind: 'assign'; shipId: string; personIndex: number; beltId: string }
  | { kind: 'stop' | 'pause' | 'resume'; shipId: string }
export type StationMiningReason = 'person' | 'ship' | 'belt' | 'facilities' | 'busy' | 'no-run' | 'paused' | 'invalid-action'

export function createStationMining(): StationMining { return { version: 1, runs: [], sequence: 0 } }
function returnHome(run: StationMiningRun, host: StationMiningHost) {
  const duration = host.returnMs(run)
  if (!Number.isSafeInteger(duration) || duration < 1) throw new Error('Invalid mining return time')
  run.phase = 'returning'; run.progressMs = 0; run.durationMs = duration; run.paused = false
}
function release(state: StationMining, host: StationMiningHost, run: StationMiningRun) {
  host.releaseShip(run.shipId, run.cargo)
  state.runs = state.runs.filter(entry => entry !== run)
}
export function stationMiningBlock(run: StationMiningRun, host: StationMiningHost): StationMiningReason | undefined {
  // 停止后的安全返航不被暂停、站点停电或中心失能卡在野外。
  if (run.phase === 'returning') return undefined
  if (run.paused) return 'paused'
  if (!host.residents().includes(run.personIndex) || !host.personAvailable(run.personIndex)) return 'person'
  if (!host.ready()) return 'facilities'
  return undefined
}
export function stationMiningCommand(state: StationMining, host: StationMiningHost, action: StationMiningAction): { ok: true } | { ok: false; reason: StationMiningReason } {
  const run = state.runs.find(entry => entry.shipId === action.shipId)
  if (action.kind !== 'assign') {
    if (!['stop', 'pause', 'resume'].includes(action.kind)) return { ok: false, reason: 'invalid-action' }
    if (!run) return { ok: false, reason: 'no-run' }
    if (action.kind === 'stop') {
      run.stopping = true
      if (run.phase === 'departure') release(state, host, run)
      else if (run.phase !== 'returning') returnHome(run, host)
    } else if (run.phase !== 'returning') run.paused = action.kind === 'pause'
    return { ok: true }
  }
  if (run || state.runs.some(entry => entry.personIndex === action.personIndex)) return { ok: false, reason: 'busy' }
  if (!Number.isInteger(action.personIndex) || action.personIndex < 0 || action.personIndex >= 6
    || !host.residents().includes(action.personIndex) || !host.personAvailable(action.personIndex)) return { ok: false, reason: 'person' }
  if (!host.ready()) return { ok: false, reason: 'facilities' }
  const ship = host.ship(action.shipId)
  if (!ship?.available || !ship.auxiliary || !ship.home) return { ok: false, reason: 'ship' }
  const params = host.params(action.shipId, action.beltId)
  if (!params || !Number.isSafeInteger(params.cycleMs) || params.cycleMs < 1
    || !Number.isSafeInteger(params.departureMs) || params.departureMs < 0
    || !Number.isSafeInteger(params.unitsPerCycle) || params.unitsPerCycle < 1
    || !Number.isFinite(params.capacityM3) || params.capacityM3 <= 0) return { ok: false, reason: 'belt' }
  if (!Number.isSafeInteger(state.sequence + 1)) throw new Error('Invalid mining sequence')
  const cargo = host.claimShip(action.shipId)
  if (!cargo) return { ok: false, reason: 'ship' }
  state.sequence++
  state.runs.push({ shipId: action.shipId, personIndex: action.personIndex, beltId: action.beltId,
    phase: params.departureMs > 0 ? 'departure' : 'mining', progressMs: 0, durationMs: params.departureMs || params.cycleMs,
    stopping: false, paused: false, cargo, cyclesDone: 0, tripsDone: 0, rvLeft: 0, rng: { seed: state.sequence, count: 0 } })
  return { ok: true }
}
export function stationMiningNextEventMs(state: StationMining, host: StationMiningHost): number {
  return Math.min(Infinity, ...state.runs.filter(run => !stationMiningBlock(run, host)).map(run => run.durationMs - run.progressMs))
}
export function advanceStationMining(state: StationMining, host: StationMiningHost, deltaMs: number): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid mining elapsed time')
  let left = deltaMs
  while (left > 0) {
    const active = state.runs.filter(run => !stationMiningBlock(run, host))
    if (active.length === 0) break
    const step = Math.min(left, ...active.map(run => run.durationMs - run.progressMs))
    for (const run of active) run.progressMs += step
    left -= step
    for (const run of active) {
      if (run.progressMs < run.durationMs) continue
      if (run.phase === 'returning') {
        if (!Number.isSafeInteger(run.tripsDone + 1)) throw new Error('Invalid mining trip count')
        host.unload(run.cargo)
        run.cargo = {}; run.tripsDone++
        if (run.stopping) { release(state, host, run); continue }
        const params = host.params(run.shipId, run.beltId)
        if (!params) { release(state, host, run); continue }
        run.phase = params.departureMs > 0 ? 'departure' : 'mining'
        run.durationMs = params.departureMs || params.cycleMs; run.progressMs = 0
      } else if (run.phase === 'departure') {
        const params = host.params(run.shipId, run.beltId)
        if (!params) { run.stopping = true; returnHome(run, host); continue }
        run.phase = 'mining'; run.progressMs = 0; run.durationMs = params.cycleMs
      } else {
        const result = host.cycle(run)
        run.cargo = result.cargo; run.rvLeft = result.rvLeft; run.rng = result.rng
        run.progressMs = 0
        if (result.returning) returnHome(run, host)
        else {
          if (!Number.isSafeInteger(run.cyclesDone + 1)) throw new Error('Invalid mining cycle count')
          run.cyclesDone++
          const params = host.params(run.shipId, run.beltId)
          if (!params) { run.stopping = true; returnHome(run, host) }
          else run.durationMs = params.cycleMs
        }
      }
    }
  }
}
export function stationMiningView(state: StationMining, host: StationMiningHost) {
  return { runs: state.runs.map(run => ({ ...run, cargo: { ...run.cargo }, rng: { ...run.rng },
    blocked: stationMiningBlock(run, host), remainingMs: run.durationMs - run.progressMs, params: host.params(run.shipId, run.beltId) })) }
}
export function cleanStationMining(value: unknown): StationMining {
  const invalid = (): never => { throw new Error('Invalid station mining snapshot') }
  const record = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
  const integer = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max ? n : invalid()
  const raw = record(value)
  if (raw.version !== 1 || !Array.isArray(raw.runs) || raw.runs.length > 6) return invalid()
  const sequence = integer(raw.sequence)
  const runs = raw.runs.map(entry => {
    const v = record(entry), rng = record(v.rng)
    if (typeof v.shipId !== 'string' || !v.shipId || typeof v.beltId !== 'string' || !v.beltId
      || !['departure', 'mining', 'returning'].includes(String(v.phase)) || typeof v.stopping !== 'boolean' || typeof v.paused !== 'boolean') return invalid()
    const durationMs = integer(v.durationMs, 1), progressMs = integer(v.progressMs, 0, durationMs - 1)
    const phase = v.phase as StationMiningRun['phase']
    if (v.stopping && phase !== 'returning' || phase === 'returning' && v.paused) return invalid()
    const cargo: Record<string, number> = {}
    for (const [id, n] of Object.entries(record(v.cargo))) {
      if (id === '__proto__' || id === 'constructor' || id === 'prototype' || !id) return invalid()
      cargo[id] = integer(n, 1)
    }
    return { shipId: v.shipId, beltId: v.beltId, personIndex: integer(v.personIndex, 0, 5), phase, progressMs, durationMs,
      stopping: v.stopping, paused: v.paused, cargo, cyclesDone: integer(v.cyclesDone), tripsDone: integer(v.tripsDone), rvLeft: integer(v.rvLeft, 0, 1),
      rng: { seed: integer(rng.seed, 1, sequence), count: integer(rng.count) } }
  })
  if (new Set(runs.map(run => run.shipId)).size !== runs.length || new Set(runs.map(run => run.personIndex)).size !== runs.length
    || new Set(runs.map(run => run.rng.seed)).size !== runs.length) return invalid()
  return { version: 1, sequence, runs }
}
