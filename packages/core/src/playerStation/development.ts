import type { PlayerFacilityKind, PlayerStationBill } from './types'

export type DevelopmentKind = 'expand' | 'power-upgrade' | 'life-upgrade' | 'repair'
export interface StationDevelopment {
  version: 1
  expanded: boolean
  levels: Record<string, 2>
  damaged: number[]
  projects: { kind: DevelopmentKind; cellIndex?: number; engineerIndices: number[]; durationMs: number; progressMs: number; paused: boolean; spent: Record<string, number> }[]
}
export interface StationDevelopmentHost {
  built(): boolean
  facility(index: number): PlayerFacilityKind | undefined
  engineers(): readonly number[]
  technology(id: string): boolean
  ready(): boolean
  availablePower(): number
  engineeringLevel(): number
  available(id: string): number
  take(bill: PlayerStationBill): boolean
  give(bill: PlayerStationBill): void
}
export type DevelopmentAction = { kind: 'expand' } | { kind: 'power-upgrade' | 'life-upgrade' | 'repair'; cellIndex: number }
  | { kind: 'pause' | 'resume' | 'cancel'; projectIndex: number }
export type DevelopmentReason = 'facility' | 'research' | 'engineer' | 'power' | 'materials' | 'busy' | 'invalid-action'

// 新数值由本批自主设计授权确定；使用既有零件，不增加研究币、施工手续费或维修电耗。
export const DEVELOPMENT_RULES = {
  expand: { durationMs: 240 * 60_000, engineers: 2, power: 6, technology: 'station-expansion-1',
    bill: { 'min-tritanium': 500_000, 'part-frame': 30_000, 'part-armor-plate': 20_000, 'part-cable': 15_000, 'part-circuit': 15_000, 'part-coolant': 15_000, 'part-gyro': 2_500, 'part-lens': 2_500 } },
  'power-upgrade': { durationMs: 60 * 60_000, engineers: 1, power: 4, technology: 'station-power-2',
    bill: { 'min-tritanium': 100_000, 'part-frame': 3_000, 'part-cable': 6_000, 'part-circuit': 3_000, 'part-coolant': 6_000 } },
  'life-upgrade': { durationMs: 90 * 60_000, engineers: 1, power: 4, technology: 'station-life-2',
    bill: { 'min-tritanium': 100_000, 'part-frame': 4_000, 'part-armor-plate': 4_000, 'part-cable': 2_000, 'part-circuit': 4_000, 'part-coolant': 6_000 } },
} as const
const REPAIR = {
  power: { durationMs: 15 * 60_000, bill: { 'part-cable': 400, 'part-circuit': 200, 'part-coolant': 400 } },
  'life-support': { durationMs: 20 * 60_000, bill: { 'part-armor-plate': 400, 'part-circuit': 400, 'part-coolant': 600 } },
  service: { durationMs: 10 * 60_000, bill: { 'part-circuit': 500, 'part-cable': 200, 'part-lens': 100 } },
} as const
export function createStationDevelopment(): StationDevelopment { return { version: 1, expanded: false, levels: {}, damaged: [], projects: [] } }
export function developmentSpec(kind: DevelopmentKind, cellIndex: number | undefined, host: StationDevelopmentHost) {
  if (kind !== 'repair') return DEVELOPMENT_RULES[kind]
  const facility = cellIndex === undefined ? undefined : host.facility(cellIndex)
  if (!facility || !Object.hasOwn(REPAIR, facility)) return undefined
  return { ...REPAIR[facility as keyof typeof REPAIR], engineers: 0, power: 0, technology: '' }
}
export function developmentBill(kind: DevelopmentKind, cellIndex: number | undefined, host: StationDevelopmentHost) {
  const spec = developmentSpec(kind, cellIndex, host)
  if (!spec) return undefined
  const level = host.engineeringLevel()
  if (!Number.isInteger(level) || level < 0 || level > 5) throw new Error('Invalid engineering level')
  return Object.fromEntries(Object.entries(spec.bill).map(([id, n]) => [id, Math.ceil(n * (kind === 'repair' ? 100 : 100 - 8 * level) / 100)]))
}
export function developmentPower(state: StationDevelopment, host: StationDevelopmentHost) {
  if (state.projects.length === 0) return { running: new Set<number>(), demand: 0 }
  const available = host.availablePower()
  let left = available
  const running = new Set<number>()
  state.projects.forEach((project, index) => {
    const spec = developmentSpec(project.kind, project.cellIndex, host)
    if (!spec || project.paused || project.kind !== 'repair' && (!host.ready() || project.engineerIndices.some(person => !host.engineers().includes(person)))) return
    if (left >= spec.power) { left -= spec.power; running.add(index) }
  })
  return { running, demand: available - left }
}
export function stationDevelopmentCommand(state: StationDevelopment, host: StationDevelopmentHost, action: DevelopmentAction): { ok: true } | { ok: false; reason: DevelopmentReason } {
  if (action.kind === 'pause' || action.kind === 'resume' || action.kind === 'cancel') {
    const project = state.projects[action.projectIndex]
    if (!Number.isInteger(action.projectIndex) || !project) return { ok: false, reason: 'invalid-action' }
    if (action.kind !== 'cancel') project.paused = action.kind === 'pause'
    else {
      const refund = Object.fromEntries(Object.entries(project.spent).map(([id, n]) => [id, Number(BigInt(n) * BigInt(project.durationMs - project.progressMs) / BigInt(project.durationMs))]))
      host.give(refund); state.projects.splice(action.projectIndex, 1)
    }
    return { ok: true }
  }
  if (!['expand', 'power-upgrade', 'life-upgrade', 'repair'].includes(action.kind)) return { ok: false, reason: 'invalid-action' }
  const kind = action.kind as DevelopmentKind, cellIndex = 'cellIndex' in action ? action.cellIndex : undefined
  const facility = cellIndex === undefined ? undefined : host.facility(cellIndex)
  if (!host.built() || kind === 'expand' && state.expanded || kind !== 'expand' && (!Number.isInteger(cellIndex) || !facility)
    || kind === 'power-upgrade' && facility !== 'power' || kind === 'life-upgrade' && facility !== 'life-support'
    || kind.endsWith('upgrade') && (state.levels[String(cellIndex)] === 2 || state.damaged.includes(cellIndex!))
    || kind === 'repair' && !state.damaged.includes(cellIndex!)) return { ok: false, reason: 'facility' }
  if (state.projects.some(project => kind === 'expand' ? project.kind === 'expand' : project.cellIndex === cellIndex)) return { ok: false, reason: 'busy' }
  const spec = developmentSpec(kind, cellIndex, host), spent = developmentBill(kind, cellIndex, host)
  if (!spec || !spent) return { ok: false, reason: 'facility' }
  if (spec.technology && !host.technology(spec.technology)) return { ok: false, reason: 'research' }
  const used = state.projects.flatMap(project => project.engineerIndices)
  const people = [...new Set(host.engineers())].filter(index => Number.isInteger(index) && index >= 0 && index < 6 && !used.includes(index)).slice(0, spec.engineers)
  if (people.length < spec.engineers || spec.engineers > 0 && !host.ready()) return { ok: false, reason: 'engineer' }
  const power = developmentPower(state, host)
  if (host.availablePower() - power.demand < spec.power) return { ok: false, reason: 'power' }
  if (!host.take(spent)) return { ok: false, reason: 'materials' }
  state.projects.push({ kind, ...(cellIndex === undefined ? {} : { cellIndex }), engineerIndices: people,
    durationMs: spec.durationMs, progressMs: 0, paused: false, spent })
  return { ok: true }
}
export function stationDevelopmentNextEventMs(state: StationDevelopment, host: StationDevelopmentHost) {
  return Math.min(Infinity, ...[...developmentPower(state, host).running].map(index => state.projects[index].durationMs - state.projects[index].progressMs))
}
export function advanceStationDevelopment(state: StationDevelopment, host: StationDevelopmentHost, deltaMs: number, running = developmentPower(state, host).running): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid development elapsed time')
  state.projects.forEach((project, index) => {
    if (running.has(index)) project.progressMs = Math.min(project.durationMs, project.progressMs + deltaMs)
    if (project.progressMs !== project.durationMs) return
    if (project.kind === 'expand') state.expanded = true
    else if (project.kind === 'repair') state.damaged = state.damaged.filter(index => index !== project.cellIndex)
    else state.levels[String(project.cellIndex)] = 2
  })
  state.projects = state.projects.filter(project => project.progressMs < project.durationMs)
}
export function cleanStationDevelopment(value: unknown, host: StationDevelopmentHost): StationDevelopment {
  const invalid = (): never => { throw new Error('Invalid station development snapshot') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const raw = value as StationDevelopment
  if (raw.version !== 1 || typeof raw.expanded !== 'boolean' || !raw.levels || typeof raw.levels !== 'object' || Array.isArray(raw.levels)
    || !Array.isArray(raw.damaged) || !Array.isArray(raw.projects) || raw.projects.length > 17) return invalid()
  const validCell = (index: number) => Number.isInteger(index) && index >= 0 && index < (raw.expanded ? 16 : 9) && !!host.facility(index)
  for (const [key, level] of Object.entries(raw.levels)) if (String(Number(key)) !== key || level !== 2 || !validCell(Number(key)) || !['power', 'life-support'].includes(host.facility(Number(key))!)) return invalid()
  if (new Set(raw.damaged).size !== raw.damaged.length || raw.damaged.some(index => !validCell(index) || !Object.hasOwn(REPAIR, host.facility(index)!))) return invalid()
  const state: StationDevelopment = { version: 1, expanded: raw.expanded, levels: { ...raw.levels }, damaged: [...raw.damaged], projects: [] }
  for (const project of raw.projects) {
    if (!project || !['expand', 'power-upgrade', 'life-upgrade', 'repair'].includes(project.kind)) return invalid()
    const spec = developmentSpec(project.kind, project.cellIndex, host)
    if (!spec || project.durationMs !== spec.durationMs || !Number.isSafeInteger(project.progressMs) || project.progressMs < 0 || project.progressMs >= project.durationMs
      || typeof project.paused !== 'boolean' || !Array.isArray(project.engineerIndices) || project.engineerIndices.length !== spec.engineers
      || project.engineerIndices.some(index => !Number.isInteger(index) || index < 0 || index >= 6 || !host.engineers().includes(index))
      || !project.spent || typeof project.spent !== 'object' || Array.isArray(project.spent)) return invalid()
    if (project.kind === 'expand' ? raw.expanded || project.cellIndex !== undefined : !validCell(project.cellIndex!)) return invalid()
    if (project.kind === 'power-upgrade' && host.facility(project.cellIndex!) !== 'power' || project.kind === 'life-upgrade' && host.facility(project.cellIndex!) !== 'life-support'
      || project.kind.endsWith('upgrade') && (state.levels[String(project.cellIndex)] || state.damaged.includes(project.cellIndex!))
      || project.kind === 'repair' && !state.damaged.includes(project.cellIndex!) || spec.technology && !host.technology(spec.technology)) return invalid()
    const matches = [0, 1, 2, 3, 4, 5].some(level => {
      const bill = developmentBill(project.kind, project.cellIndex, { ...host, engineeringLevel: () => level })!
      return Object.keys(bill).length === Object.keys(project.spent).length && Object.entries(bill).every(([id, n]) => project.spent[id] === n)
    })
    if (!matches || state.projects.some(entry => project.kind === 'expand' ? entry.kind === 'expand' : entry.cellIndex === project.cellIndex)) return invalid()
    state.projects.push({ kind: project.kind, cellIndex: project.cellIndex, engineerIndices: [...project.engineerIndices], durationMs: project.durationMs, progressMs: project.progressMs, paused: project.paused, spent: { ...project.spent } })
  }
  const engineers = state.projects.flatMap(project => project.engineerIndices)
  if (new Set(engineers).size !== engineers.length) return invalid()
  return state
}
