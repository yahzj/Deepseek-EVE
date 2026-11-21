export const STATION_FIRST_RESEARCH = Object.freeze({ id: 'station-expansion-1', durationMs: 60 * 60_000 } as const)
/** 六项基础科研互不设前置，也不向宿主收取材料。 */
export const STATION_RESEARCH_CATALOG = Object.freeze([
  STATION_FIRST_RESEARCH,
  Object.freeze({ id: 'station-power-2', durationMs: 120 * 60_000 } as const),
  Object.freeze({ id: 'station-life-2', durationMs: 120 * 60_000 } as const),
  Object.freeze({ id: 'station-manufacturing', durationMs: 90 * 60_000 } as const),
  Object.freeze({ id: 'station-training', durationMs: 90 * 60_000 } as const),
  Object.freeze({ id: 'station-warning', durationMs: 60 * 60_000 } as const),
] as const)
export type StationResearchProjectId = typeof STATION_RESEARCH_CATALOG[number]['id']
export interface StationResearchProgress { progressMs: number; completed: boolean }

export interface StationResearch extends StationResearchProgress {
  version: 2
  projectId: StationResearchProjectId
  /** 仅保存非当前项目；未开始的项目无需记录。 */
  archives: Partial<Record<StationResearchProjectId, StationResearchProgress>>
  queue: StationResearchProjectId[]
  assignment?: { cellIndex: number; personIndex: number; paused: boolean }
}
export interface StationResearchHost {
  /** 已接收且取得基础研究资格的身份，不复制人口或资格账。 */
  researchers(): readonly number[]
  personAvailable(index: number): boolean
  facilityAvailable(cellIndex: number): boolean
  /** 宿主统一检查生活保障、中心与研究室作业供电。 */
  powered(cellIndex: number): boolean
}
export type StationResearchAction = { kind: 'assign'; cellIndex: number; personIndex: number; projectId?: string }
  | { kind: 'enqueue'; projectId: string }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; fromIndex: number; toIndex: number }
  | { kind: 'pause' | 'resume' | 'release' }
export type StationResearchReason = 'person' | 'facility' | 'power' | 'paused' | 'unassigned' | 'completed' | 'busy'
  | 'invalid-action' | 'project' | 'queued' | 'invalid-index'

export function createStationResearch(): StationResearch {
  return { version: 2, projectId: STATION_FIRST_RESEARCH.id, progressMs: 0, completed: false, archives: {}, queue: [] }
}
function researchProject(id: unknown) {
  return STATION_RESEARCH_CATALOG.find(project => project.id === id)
}
function researchProgress(state: StationResearch, id: StationResearchProjectId): StationResearchProgress {
  return id === state.projectId ? state : state.archives[id] ?? { progressMs: 0, completed: false }
}
export function researchCompleted(state: StationResearch, id: string): boolean {
  const project = researchProject(id)
  return !!project && researchProgress(state, project.id).completed
}
function selectResearch(state: StationResearch, id: StationResearchProjectId): void {
  if (id === state.projectId) return
  const progress = researchProgress(state, id)
  state.archives[state.projectId] = { progressMs: state.progressMs, completed: state.completed }
  delete state.archives[id]
  state.projectId = id
  state.progressMs = progress.progressMs
  state.completed = progress.completed
}
function nextResearch(state: StationResearch): void {
  const next = state.queue.shift()
  if (next) selectResearch(state, next)
  else delete state.assignment
}
function validQueueIndex(index: number, queue: readonly string[]): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < queue.length
}
export function stationResearchBlock(state: StationResearch, host: StationResearchHost): StationResearchReason | undefined {
  if (state.completed) return 'completed'
  const assignment = state.assignment
  if (!assignment) return 'unassigned'
  if (assignment.paused) return 'paused'
  if (!host.researchers().includes(assignment.personIndex) || !host.personAvailable(assignment.personIndex)) return 'person'
  if (!host.facilityAvailable(assignment.cellIndex)) return 'facility'
  if (!host.powered(assignment.cellIndex)) return 'power'
  return undefined
}
export function stationResearchCommand(state: StationResearch, host: StationResearchHost, action: StationResearchAction): { ok: true } | { ok: false; reason: StationResearchReason } {
  if (action.kind === 'assign') {
    const project = researchProject(action.projectId === undefined ? state.projectId : action.projectId)
    if (!project) return { ok: false, reason: 'project' }
    if (researchCompleted(state, project.id)) return { ok: false, reason: 'completed' }
    if (state.assignment) return { ok: false, reason: 'busy' }
    if (!Number.isInteger(action.cellIndex) || action.cellIndex < 0 || action.cellIndex > 15 || !host.facilityAvailable(action.cellIndex)) return { ok: false, reason: 'facility' }
    if (!Number.isInteger(action.personIndex) || action.personIndex < 0 || action.personIndex > 5
      || !host.researchers().includes(action.personIndex) || !host.personAvailable(action.personIndex)) return { ok: false, reason: 'person' }
    selectResearch(state, project.id)
    state.queue = state.queue.filter(id => id !== project.id)
    state.assignment = { cellIndex: action.cellIndex, personIndex: action.personIndex, paused: false }
  } else if (action.kind === 'enqueue') {
    const project = researchProject(action.projectId)
    if (!project) return { ok: false, reason: 'project' }
    if (researchCompleted(state, project.id)) return { ok: false, reason: 'completed' }
    if (project.id === state.projectId) return { ok: false, reason: 'busy' }
    if (state.queue.includes(project.id)) return { ok: false, reason: 'queued' }
    state.queue.push(project.id)
    if (state.completed) nextResearch(state)
  } else if (action.kind === 'remove') {
    if (!validQueueIndex(action.index, state.queue)) return { ok: false, reason: 'invalid-index' }
    state.queue.splice(action.index, 1)
  } else if (action.kind === 'move') {
    if (!validQueueIndex(action.fromIndex, state.queue) || !validQueueIndex(action.toIndex, state.queue)) return { ok: false, reason: 'invalid-index' }
    const [projectId] = state.queue.splice(action.fromIndex, 1)
    state.queue.splice(action.toIndex, 0, projectId)
  } else {
    if (action.kind !== 'pause' && action.kind !== 'resume' && action.kind !== 'release') return { ok: false, reason: 'invalid-action' }
    if (!state.assignment) return { ok: false, reason: 'unassigned' }
    if (action.kind === 'release') delete state.assignment
    else state.assignment.paused = action.kind === 'pause'
  }
  return { ok: true }
}
export function stationResearchNextEventMs(state: StationResearch, host: StationResearchHost): number {
  return stationResearchBlock(state, host) ? Infinity : researchProject(state.projectId)!.durationMs - state.progressMs
}
/** 与宿主的 deferBoundary 调用兼容；无论选项如何，每次最多结算一个项目，续项只吃下一时间段。 */
export function advanceStationResearch(state: StationResearch, host: StationResearchHost, deltaMs: number, _deferBoundary = false): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid research elapsed time')
  if (stationResearchBlock(state, host)) return
  const durationMs = researchProject(state.projectId)!.durationMs
  state.progressMs += Math.min(deltaMs, durationMs - state.progressMs)
  if (state.progressMs === durationMs) {
    state.completed = true
    nextResearch(state)
  }
}
export function stationResearchView(state: StationResearch, host: StationResearchHost) {
  const durationMs = researchProject(state.projectId)!.durationMs
  return { projectId: state.projectId, progressMs: state.progressMs, completed: state.completed,
    assignment: state.assignment ? { ...state.assignment } : undefined,
    durationMs, remainingMs: durationMs - state.progressMs, blocked: stationResearchBlock(state, host),
    catalog: STATION_RESEARCH_CATALOG.map(project => {
      const progress = researchProgress(state, project.id)
      return { ...project, progressMs: progress.progressMs, completed: progress.completed }
    }), queue: [...state.queue] }
}
export function cleanStationResearch(value: unknown): StationResearch {
  const invalid = (): never => { throw new Error('Invalid station research snapshot') }
  const record = (entry: unknown): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
    && (Object.getPrototypeOf(entry) === Object.prototype || Object.getPrototypeOf(entry) === null)
  const cleanProgress = (entry: unknown, durationMs: number): StationResearchProgress => {
    if (!record(entry) || typeof entry.completed !== 'boolean'
      || typeof entry.progressMs !== 'number' || !Number.isSafeInteger(entry.progressMs) || entry.progressMs < 0 || entry.progressMs > durationMs
      || entry.completed !== (entry.progressMs === durationMs)) return invalid()
    return { progressMs: entry.progressMs, completed: entry.completed }
  }
  if (!record(value)) return invalid()
  const raw = value, project = researchProject(raw.projectId)
  if (!project || (raw.version !== 1 && raw.version !== 2)) return invalid()
  if (raw.version === 1 && (project.id !== STATION_FIRST_RESEARCH.id || raw.archives !== undefined || raw.queue !== undefined)) return invalid()
  const state: StationResearch = { version: 2, projectId: project.id, ...cleanProgress(raw, project.durationMs), archives: {}, queue: [] }
  if (raw.version === 2) {
    if (!record(raw.archives) || !Array.isArray(raw.queue) || raw.queue.length >= STATION_RESEARCH_CATALOG.length) return invalid()
    for (const [id, progress] of Object.entries(raw.archives)) {
      const archivedProject = researchProject(id)
      if (!archivedProject || id === state.projectId) return invalid()
      state.archives[archivedProject.id] = cleanProgress(progress, archivedProject.durationMs)
    }
    for (const id of raw.queue) {
      const queuedProject = researchProject(id)
      if (!queuedProject || id === state.projectId || state.queue.includes(queuedProject.id) || researchCompleted(state, queuedProject.id)) return invalid()
      state.queue.push(queuedProject.id)
    }
    if (state.completed && state.queue.length > 0) return invalid()
  }
  if (raw.assignment !== undefined) {
    if (state.completed || !record(raw.assignment)) return invalid()
    const assignment = raw.assignment
    if (typeof assignment.cellIndex !== 'number' || !Number.isInteger(assignment.cellIndex) || assignment.cellIndex < 0 || assignment.cellIndex > 15
      || typeof assignment.personIndex !== 'number' || !Number.isInteger(assignment.personIndex) || assignment.personIndex < 0 || assignment.personIndex > 5
      || typeof assignment.paused !== 'boolean') return invalid()
    state.assignment = { cellIndex: assignment.cellIndex, personIndex: assignment.personIndex, paused: assignment.paused }
  }
  return state
}
