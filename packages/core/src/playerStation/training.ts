export type StationQualification = 'engineer' | 'researcher'
export const STATION_COURSE_MS = 30 * 60_000
const PEOPLE = 6
const isCourse = (value: unknown): value is StationQualification => value === 'engineer' || value === 'researcher'

export interface StationTraining {
  version: 1
  /** 与来源人口身份下标对应，仅保存资格，不复制居民数量。 */
  qualifications: (StationQualification | null)[]
  queue: StationQualification[]
  active?: { personIndex: number; course: StationQualification; progressMs: number; paused: boolean }
}
export interface StationTrainingHost {
  residents(): readonly number[]
  /** 实际岗位互斥由宿主提供；不能从工作或其他课程中强抽人口。 */
  available(personIndex: number): boolean
  ready(): boolean
}
export type StationTrainingAction = { kind: 'enqueue'; course: StationQualification }
  | { kind: 'remove'; index: number } | { kind: 'pause' | 'resume' }
export type StationTrainingReason = 'invalid-action' | 'queue-full' | 'no-course' | 'invalid-index'

export function createStationTraining(): StationTraining {
  return { version: 1, qualifications: Array.from({ length: PEOPLE }, () => null), queue: [] }
}

function candidates(state: StationTraining, host: StationTrainingHost) {
  return [...host.residents()].filter(index => Number.isInteger(index) && index >= 0 && index < PEOPLE
    && state.qualifications[index] === null && state.active?.personIndex !== index && host.available(index)).sort((a, b) => a - b)
}
function canAdvance(state: StationTraining, host: StationTrainingHost) {
  const active = state.active
  return !!active && !active.paused && host.ready() && host.residents().includes(active.personIndex) && host.available(active.personIndex)
}

export function reconcileStationTraining(state: StationTraining, host: StationTrainingHost): void {
  if (state.active || state.queue.length === 0 || !host.ready()) return
  const personIndex = candidates(state, host)[0]
  if (personIndex === undefined) return
  state.active = { personIndex, course: state.queue.shift()!, progressMs: 0, paused: false }
}

export function stationTrainingNextEventMs(state: StationTraining, host: StationTrainingHost): number {
  return canAdvance(state, host) ? STATION_COURSE_MS - state.active!.progressMs : Infinity
}

export function advanceStationTraining(state: StationTraining, host: StationTrainingHost, deltaMs: number, deferBoundary = false): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid training elapsed time')
  reconcileStationTraining(state, host)
  let left = deltaMs
  while (left > 0 && canAdvance(state, host)) {
    const active = state.active!
    const step = Math.min(left, STATION_COURSE_MS - active.progressMs)
    active.progressMs += step
    left -= step
    if (active.progressMs < STATION_COURSE_MS) break
    state.qualifications[active.personIndex] = active.course
    delete state.active
    if (left > 0 || !deferBoundary) reconcileStationTraining(state, host)
  }
}

export function stationTrainingCommand(state: StationTraining, host: StationTrainingHost, action: StationTrainingAction): { ok: true } | { ok: false; reason: StationTrainingReason } {
  if (action.kind === 'enqueue') {
    if (!isCourse(action.course)) return { ok: false, reason: 'invalid-action' }
    if (state.qualifications.filter(Boolean).length + state.queue.length + (state.active ? 1 : 0) >= PEOPLE) return { ok: false, reason: 'queue-full' }
    state.queue.push(action.course)
  } else if (action.kind === 'remove') {
    if (!Number.isSafeInteger(action.index) || action.index < 0 || action.index >= state.queue.length) return { ok: false, reason: 'invalid-index' }
    state.queue.splice(action.index, 1)
  } else if (action.kind === 'pause' || action.kind === 'resume') {
    if (!state.active) return { ok: false, reason: 'no-course' }
    state.active.paused = action.kind === 'pause'
  } else return { ok: false, reason: 'invalid-action' }
  reconcileStationTraining(state, host)
  return { ok: true }
}

export function stationTrainingView(state: StationTraining, host: StationTrainingHost) {
  const active = state.active
  const residents = host.residents()
  const blocked = active && !active.paused ? !host.ready() ? 'facilities'
    : !residents.includes(active.personIndex) || !host.available(active.personIndex) ? 'person' : undefined : undefined
  return { durationMs: STATION_COURSE_MS, seatCount: 1, seatUsed: active ? 1 : 0, residents: residents.length,
    engineers: residents.filter(index => state.qualifications[index] === 'engineer').length,
    researchers: residents.filter(index => state.qualifications[index] === 'researcher').length,
    ordinary: residents.filter(index => state.qualifications[index] === null && active?.personIndex !== index && host.available(index)).length,
    canEnqueue: state.qualifications.filter(Boolean).length + state.queue.length + (active ? 1 : 0) < PEOPLE,
    active: active ? { ...active, blocked, remainingMs: STATION_COURSE_MS - active.progressMs } : undefined,
    queue: [...state.queue], qualifications: [...state.qualifications],
    wait: !active && state.queue.length > 0 ? !host.ready() ? 'facilities' : candidates(state, host).length === 0 ? 'person' : undefined : undefined }
}

/** 课程快照必须与人口身份成对验证，拒绝给未接收人口发资格或重复占席。 */
export function cleanStationTraining(value: unknown, residents: readonly number[]): StationTraining {
  const invalid = (): never => { throw new Error('Invalid station training snapshot') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || !Array.isArray(raw.qualifications) || raw.qualifications.length !== PEOPLE
    || !Array.isArray(raw.queue) || raw.queue.length > PEOPLE || !raw.queue.every(isCourse)) return invalid()
  const qualifications = raw.qualifications.map((entry, index) => {
    if (entry !== null && (!isCourse(entry) || !residents.includes(index))) return invalid()
    return entry as StationQualification | null
  })
  const state: StationTraining = { version: 1, qualifications, queue: [...raw.queue] }
  if (raw.active !== undefined) {
    if (!raw.active || typeof raw.active !== 'object' || Array.isArray(raw.active)) return invalid()
    const active = raw.active as Record<string, unknown>
    if (typeof active.personIndex !== 'number' || !Number.isInteger(active.personIndex) || active.personIndex < 0 || active.personIndex >= PEOPLE
      || !residents.includes(active.personIndex) || qualifications[active.personIndex] !== null || !isCourse(active.course)
      || typeof active.progressMs !== 'number' || !Number.isSafeInteger(active.progressMs) || active.progressMs < 0 || active.progressMs >= STATION_COURSE_MS
      || typeof active.paused !== 'boolean') return invalid()
    state.active = { personIndex: active.personIndex, course: active.course, progressMs: active.progressMs, paused: active.paused }
  }
  if (qualifications.filter(Boolean).length + state.queue.length + (state.active ? 1 : 0) > PEOPLE) return invalid()
  return state
}
