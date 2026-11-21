import { STATION_COURSE_MS } from './training'
import type { StationQualification } from './training'

export interface StationAcademy { version: 1; active?: { cellIndex: number; personIndex: number; course: StationQualification; progressMs: number; paused: boolean } }
export interface StationAcademyHost {
  candidate(personIndex: number): boolean
  facility(cellIndex: number): boolean
  powered(cellIndex: number): boolean
  qualify(personIndex: number, course: StationQualification): void
}
export type StationAcademyAction = { kind: 'assign'; cellIndex: number; personIndex: number; course: StationQualification } | { kind: 'pause' | 'resume' | 'release' }
export function createStationAcademy(): StationAcademy { return { version: 1 } }
export function stationAcademyBlock(state: StationAcademy, host: StationAcademyHost): string | undefined {
  const active = state.active
  return !active ? 'unassigned' : active.paused ? 'paused' : !host.candidate(active.personIndex) ? 'person'
    : !host.facility(active.cellIndex) ? 'facility' : !host.powered(active.cellIndex) ? 'power' : undefined
}
export function stationAcademyCommand(state: StationAcademy, host: StationAcademyHost, action: StationAcademyAction) {
  if (action.kind === 'assign') {
    if (state.active) return { ok: false, reason: 'busy' }
    if (!Number.isInteger(action.personIndex) || action.personIndex < 0 || action.personIndex >= 6 || !host.candidate(action.personIndex)) return { ok: false, reason: 'person' }
    if (!Number.isInteger(action.cellIndex) || action.cellIndex < 0 || action.cellIndex >= 16 || !host.facility(action.cellIndex)) return { ok: false, reason: 'facility' }
    if (action.course !== 'engineer' && action.course !== 'researcher') return { ok: false, reason: 'course' }
    state.active = { cellIndex: action.cellIndex, personIndex: action.personIndex, course: action.course, progressMs: 0, paused: false }
  } else {
    if (!['pause', 'resume', 'release'].includes(action.kind)) return { ok: false, reason: 'invalid-action' }
    if (!state.active) return { ok: false, reason: 'unassigned' }
    if (action.kind === 'release') delete state.active
    else state.active.paused = action.kind === 'pause'
  }
  return { ok: true }
}
export function stationAcademyNextEventMs(state: StationAcademy, host: StationAcademyHost) {
  return stationAcademyBlock(state, host) ? Infinity : STATION_COURSE_MS - state.active!.progressMs
}
export function advanceStationAcademy(state: StationAcademy, host: StationAcademyHost, deltaMs: number) {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid academy elapsed time')
  if (stationAcademyBlock(state, host)) return
  const active = state.active!
  active.progressMs += Math.min(deltaMs, STATION_COURSE_MS - active.progressMs)
  if (active.progressMs === STATION_COURSE_MS) { host.qualify(active.personIndex, active.course); delete state.active }
}
export function cleanStationAcademy(value: unknown): StationAcademy {
  const invalid = (): never => { throw new Error('Invalid academy snapshot') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const raw = value as StationAcademy
  if (raw.version !== 1) return invalid()
  if (raw.active === undefined) return { version: 1 }
  const active = raw.active
  if (!active || !Number.isInteger(active.cellIndex) || active.cellIndex < 0 || active.cellIndex >= 16
    || !Number.isInteger(active.personIndex) || active.personIndex < 0 || active.personIndex >= 6
    || !['engineer', 'researcher'].includes(active.course) || typeof active.paused !== 'boolean'
    || !Number.isSafeInteger(active.progressMs) || active.progressMs < 0 || active.progressMs >= STATION_COURSE_MS) return invalid()
  return { version: 1, active: { cellIndex: active.cellIndex, personIndex: active.personIndex, course: active.course, progressMs: active.progressMs, paused: active.paused } }
}
