import type { PlayerStationBill } from './types'

export interface StationManufacturingRecipe {
  cycleMs: number
  input: Record<string, number>
  output: Record<string, number>
}
export interface StationManufacturingRun extends StationManufacturingRecipe {
  cellIndex: number
  personIndex?: number
  blueprintId: string
  batches: number
  batchesDone: number
  progressMs: number
  paused: boolean
}
export interface StationManufacturing { version: 1; runs: StationManufacturingRun[] }
export interface StationManufacturingHost {
  residents(): readonly number[]
  personAvailable(index: number): boolean
  facilityAvailable(cellIndex: number): boolean
  powered(cellIndex: number): boolean
  /** 宿主复用既有主控制造参数；派工后锁定整份单批配方。 */
  recipe(blueprintId: string): StationManufacturingRecipe | undefined
  available(itemId: string): number
  /** 整批扣料与产物入库必须一起成功，失败不得改变库存，不得重入模块。 */
  settle(input: PlayerStationBill, output: PlayerStationBill): boolean
}
export type StationManufacturingAction = { kind: 'assign'; cellIndex: number; personIndex: number; blueprintId: string; batches: number }
  | { kind: 'stop' | 'pause' | 'resume'; cellIndex: number }
export type StationManufacturingReason = 'person' | 'facility' | 'recipe' | 'batches' | 'busy' | 'no-run'
  | 'materials' | 'power' | 'paused' | 'completed' | 'invalid-action'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function bill(value: unknown): value is Record<string, number> {
  return record(value) && Object.keys(value).length > 0 && Object.entries(value).every(([id, n]) =>
    id.trim().length > 0 && typeof n === 'number' && Number.isSafeInteger(n) && n > 0)
}
function hasMaterials(run: StationManufacturingRun, host: StationManufacturingHost): boolean {
  return Object.entries(run.input).every(([id, n]) => host.available(id) >= n)
}

export function createStationManufacturing(): StationManufacturing { return { version: 1, runs: [] } }
export function stationManufacturingBlock(run: StationManufacturingRun, host: StationManufacturingHost): StationManufacturingReason | undefined {
  if (run.batchesDone === run.batches) return 'completed'
  if (run.personIndex === undefined) return 'no-run'
  if (run.paused) return 'paused'
  if (!host.residents().includes(run.personIndex) || !host.personAvailable(run.personIndex)) return 'person'
  if (!host.facilityAvailable(run.cellIndex)) return 'facility'
  if (!hasMaterials(run, host)) return 'materials'
  if (!host.powered(run.cellIndex)) return 'power'
  return undefined
}
export function stationManufacturingCommand(state: StationManufacturing, host: StationManufacturingHost, action: StationManufacturingAction): { ok: true } | { ok: false; reason: StationManufacturingReason } {
  if (!action || typeof action !== 'object' || !['assign', 'stop', 'pause', 'resume'].includes(action.kind)) return { ok: false, reason: 'invalid-action' }
  if (!Number.isInteger(action.cellIndex) || action.cellIndex < 0 || action.cellIndex > 15) return { ok: false, reason: 'facility' }
  const previous = state.runs.find(run => run.cellIndex === action.cellIndex)
  if (action.kind !== 'assign') {
    if (!previous || previous.personIndex === undefined) return { ok: false, reason: 'no-run' }
    if (action.kind === 'stop') { delete previous.personIndex; previous.progressMs = 0; previous.paused = false }
    else previous.paused = action.kind === 'pause'
    return { ok: true }
  }
  if (!host.facilityAvailable(action.cellIndex)) return { ok: false, reason: 'facility' }
  if (previous?.personIndex !== undefined || state.runs.some(run => run.personIndex === action.personIndex)) return { ok: false, reason: 'busy' }
  if (!Number.isInteger(action.personIndex) || action.personIndex < 0 || action.personIndex > 5
    || !host.residents().includes(action.personIndex) || !host.personAvailable(action.personIndex)) return { ok: false, reason: 'person' }
  if (!Number.isInteger(action.batches) || action.batches < 1 || action.batches > 1000) return { ok: false, reason: 'batches' }
  if (typeof action.blueprintId !== 'string' || !action.blueprintId.trim()) return { ok: false, reason: 'recipe' }
  const recipe = host.recipe(action.blueprintId)
  if (!recipe || !Number.isSafeInteger(recipe.cycleMs) || recipe.cycleMs < 1 || !bill(recipe.input) || !bill(recipe.output)) return { ok: false, reason: 'recipe' }
  const run: StationManufacturingRun = { cellIndex: action.cellIndex, personIndex: action.personIndex,
    blueprintId: action.blueprintId, batches: action.batches, cycleMs: recipe.cycleMs,
    input: { ...recipe.input }, output: { ...recipe.output }, progressMs: 0, batchesDone: 0, paused: false }
  if (previous) state.runs[state.runs.indexOf(previous)] = run
  else state.runs.push(run)
  return { ok: true }
}
export function stationManufacturingNextEventMs(state: StationManufacturing, host: StationManufacturingHost): number {
  return Math.min(Infinity, ...state.runs.filter(run => !stationManufacturingBlock(run, host)).map(run => run.cycleMs - run.progressMs))
}
export function advanceStationManufacturing(state: StationManufacturing, host: StationManufacturingHost, deltaMs: number): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid manufacturing elapsed time')
  let left = deltaMs
  while (left > 0 || state.runs.some(run => run.progressMs === run.cycleMs && !stationManufacturingBlock(run, host))) {
    const running = state.runs.filter(run => !stationManufacturingBlock(run, host))
    if (running.length === 0) break
    const step = Math.min(left, ...running.map(run => run.cycleMs - run.progressMs))
    for (const run of running) run.progressMs += step
    left -= step
    for (const run of running) if (run.progressMs === run.cycleMs) {
      // 玩家站按本批授权到点交接，不预扣料；同刻争料失败者保留到点工时。
      if (host.settle({ ...run.input }, { ...run.output })) {
        run.progressMs = 0
        run.batchesDone++
        if (run.batchesDone === run.batches) { delete run.personIndex; run.paused = false }
      } else if (hasMaterials(run, host)) throw new Error('Manufacturing settlement rejected without material shortage')
    }
  }
}
export function stationManufacturingView(state: StationManufacturing, host: StationManufacturingHost) {
  return { runs: state.runs.map(run => ({ ...run, input: { ...run.input }, output: { ...run.output },
    blocked: stationManufacturingBlock(run, host), available: Object.fromEntries(Object.keys(run.input).map(id => [id, host.available(id)])),
    remainingMs: run.batchesDone === run.batches ? 0 : run.cycleMs - run.progressMs,
    remainingBatches: run.batches - run.batchesDone, completed: run.batchesDone === run.batches })) }
}
export function cleanStationManufacturing(value: unknown): StationManufacturing {
  const invalid = (): never => { throw new Error('Invalid station manufacturing snapshot') }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.runs) || value.runs.length > 16) return invalid()
  const runs = Array.from(value.runs, entry => {
    if (!record(entry)) return invalid()
    const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
      const n = entry[key]
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) return invalid()
      return n
    }
    const cellIndex = integer('cellIndex', 0, 15), cycleMs = integer('cycleMs', 1), batches = integer('batches', 1, 1000)
    const progressMs = integer('progressMs', 0, cycleMs), batchesDone = integer('batchesDone', 0, batches)
    if (typeof entry.blueprintId !== 'string' || !entry.blueprintId.trim() || typeof entry.paused !== 'boolean'
      || !bill(entry.input) || !bill(entry.output)) return invalid()
    const personIndex = entry.personIndex === undefined ? undefined : integer('personIndex', 0, 5)
    if (personIndex === undefined && (progressMs !== 0 || entry.paused)) return invalid()
    if (batchesDone === batches && (personIndex !== undefined || progressMs !== 0 || entry.paused)) return invalid()
    return { cellIndex, cycleMs, batches, progressMs, batchesDone, blueprintId: entry.blueprintId, paused: entry.paused,
      input: { ...entry.input }, output: { ...entry.output }, ...(personIndex !== undefined ? { personIndex } : {}) }
  })
  const people = runs.flatMap(run => run.personIndex === undefined ? [] : [run.personIndex])
  if (new Set(runs.map(run => run.cellIndex)).size !== runs.length || new Set(people).size !== people.length) return invalid()
  return { version: 1, runs }
}
