import type { PlayerStationBill } from './types'

export interface StationRefineryRun {
  cellIndex: number
  personIndex?: number
  itemId: string
  batchUnits: number
  cycleMs: number
  progressMs: number
  batchesDone: number
  paused: boolean
}
export interface StationRefining { version: 1; runs: StationRefineryRun[] }
export interface StationRefiningHost {
  residents(): readonly number[]
  personAvailable(index: number): boolean
  facilityAvailable(cellIndex: number): boolean
  powered(cellIndex: number): boolean
  /** 必须复用现有手动精炼参数与产出单点，不另造人类倍率。 */
  recipe(itemId: string): { batchUnits: number; cycleMs: number } | undefined
  output(itemId: string, batchUnits: number): Record<string, number>
  available(itemId: string): number
  /** 原子交接：整批扣料与产物入库一起成功；失败不改变任何库存。 */
  settle(input: PlayerStationBill, output: PlayerStationBill): boolean
}
export type StationRefiningAction = { kind: 'assign'; cellIndex: number; personIndex: number; itemId: string }
  | { kind: 'stop' | 'pause' | 'resume'; cellIndex: number }
export type StationRefiningReason = 'person' | 'facility' | 'recipe' | 'busy' | 'no-run' | 'materials' | 'power' | 'paused' | 'invalid-action'

export function createStationRefining(): StationRefining { return { version: 1, runs: [] } }
export function stationRefiningBlock(run: StationRefineryRun, host: StationRefiningHost): StationRefiningReason | undefined {
  if (run.personIndex === undefined) return 'no-run'
  if (run.paused) return 'paused'
  if (!host.residents().includes(run.personIndex) || !host.personAvailable(run.personIndex)) return 'person'
  if (!host.facilityAvailable(run.cellIndex)) return 'facility'
  if (host.available(run.itemId) < run.batchUnits) return 'materials'
  if (!host.powered(run.cellIndex)) return 'power'
  return undefined
}
export function stationRefiningCommand(state: StationRefining, host: StationRefiningHost, action: StationRefiningAction): { ok: true } | { ok: false; reason: StationRefiningReason } {
  const previous = state.runs.find(run => run.cellIndex === action.cellIndex)
  if (action.kind !== 'assign') {
    if (action.kind !== 'stop' && action.kind !== 'pause' && action.kind !== 'resume') return { ok: false, reason: 'invalid-action' }
    if (!previous || previous.personIndex === undefined) return { ok: false, reason: 'no-run' }
    if (action.kind === 'stop') { delete previous.personIndex; previous.progressMs = 0; previous.paused = false }
    else previous.paused = action.kind === 'pause'
    return { ok: true }
  }
  if (!Number.isInteger(action.cellIndex) || action.cellIndex < 0 || action.cellIndex >= 16 || !host.facilityAvailable(action.cellIndex)) return { ok: false, reason: 'facility' }
  if (previous?.personIndex !== undefined || state.runs.some(run => run.personIndex === action.personIndex)) return { ok: false, reason: 'busy' }
  if (!Number.isInteger(action.personIndex) || action.personIndex < 0 || action.personIndex >= 6
    || !host.residents().includes(action.personIndex) || !host.personAvailable(action.personIndex)) return { ok: false, reason: 'person' }
  const recipe = host.recipe(action.itemId)
  if (!recipe || !Number.isSafeInteger(recipe.batchUnits) || recipe.batchUnits < 1 || !Number.isSafeInteger(recipe.cycleMs) || recipe.cycleMs < 1) return { ok: false, reason: 'recipe' }
  const run: StationRefineryRun = { cellIndex: action.cellIndex, personIndex: action.personIndex, itemId: action.itemId,
    ...recipe, progressMs: 0, batchesDone: 0, paused: false }
  if (previous) state.runs[state.runs.indexOf(previous)] = run
  else state.runs.push(run)
  return { ok: true }
}
export function stationRefiningNextEventMs(state: StationRefining, host: StationRefiningHost): number {
  return Math.min(Infinity, ...state.runs.filter(run => !stationRefiningBlock(run, host)).map(run => run.cycleMs - run.progressMs))
}
export function advanceStationRefining(state: StationRefining, host: StationRefiningHost, deltaMs: number): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid refining elapsed time')
  let left = deltaMs
  while (left > 0 || state.runs.some(run => run.progressMs === run.cycleMs && !stationRefiningBlock(run, host))) {
    const running = state.runs.filter(run => !stationRefiningBlock(run, host))
    if (running.length === 0) break
    const step = Math.min(left, ...running.map(run => run.cycleMs - run.progressMs))
    for (const run of running) run.progressMs += step
    left -= step
    for (const run of running) if (run.progressMs === run.cycleMs) {
      const output = host.output(run.itemId, run.batchUnits)
      if (!Object.values(output).every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid refining output')
      if (!Number.isSafeInteger(run.batchesDone + 1)) throw new Error('Invalid refining batch count')
      if (host.settle({ [run.itemId]: run.batchUnits }, output)) { run.progressMs = 0; run.batchesDone++ }
      else if (host.available(run.itemId) >= run.batchUnits) throw new Error('Refining settlement rejected without material shortage')
      // 同刻多台争用公共库存，未取得整批者保留已完成的有效工时，补料后只结算一次。
    }
  }
}
export function stationRefiningView(state: StationRefining, host: StationRefiningHost) {
  return { runs: state.runs.map(run => ({ ...run, blocked: stationRefiningBlock(run, host),
    available: host.available(run.itemId), output: { ...host.output(run.itemId, run.batchUnits) }, remainingMs: run.cycleMs - run.progressMs })) }
}
export function cleanStationRefining(value: unknown): StationRefining {
  const invalid = (): never => { throw new Error('Invalid station refining snapshot') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || !Array.isArray(raw.runs) || raw.runs.length > 16) return invalid()
  const runs = raw.runs.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid()
    const run = entry as Record<string, unknown>
    const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
      const n = run[key]
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) return invalid()
      return n
    }
    const cellIndex = integer('cellIndex', 0, 15), batchUnits = integer('batchUnits', 1), cycleMs = integer('cycleMs', 1)
    const progressMs = integer('progressMs', 0, cycleMs), batchesDone = integer('batchesDone', 0)
    if (typeof run.itemId !== 'string' || !run.itemId || typeof run.paused !== 'boolean') return invalid()
    const personIndex = run.personIndex === undefined ? undefined : integer('personIndex', 0, 5)
    if (personIndex === undefined && (progressMs !== 0 || run.paused)) return invalid()
    return { cellIndex, batchUnits, cycleMs, progressMs, batchesDone, itemId: run.itemId, paused: run.paused,
      ...(personIndex !== undefined ? { personIndex } : {}) }
  })
  const people = runs.flatMap(run => run.personIndex === undefined ? [] : [run.personIndex])
  if (new Set(runs.map(run => run.cellIndex)).size !== runs.length || new Set(people).size !== people.length) return invalid()
  return { version: 1, runs }
}
