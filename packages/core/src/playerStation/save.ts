import type { PlayerFacilityKind, PlayerStationProject, PlayerStationState } from './types'
import { PLAYER_FACILITIES, PLAYER_STATION_BODY_BILL, PLAYER_STATION_BODY_MS } from './rules'

const FORMAT = 'whale-player-station-lab'
const invalid = (): never => { throw new Error('Invalid player station snapshot') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid()
  return value
}
function bill(value: unknown, maxima = PLAYER_STATION_BODY_BILL, accumulated = false): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(record(value))) {
    if (!Object.hasOwn(maxima, id)) return invalid()
    const n = integer(v)
    if (!accumulated && n > maxima[id]) return invalid()
    if (n > 0) out[id] = n
  }
  return out
}

/** 独立模块快照：结构不完整直接拒绝，不能静默丢弃已投入材料。 */
export function cleanPlayerStation(value: unknown, cellCount: 9 | 16 = 9): PlayerStationState {
  const v = record(value)
  if (v.runtimeVersion !== 3 || !Array.isArray(v.cells) || v.cells.length > cellCount
    || !Array.isArray(v.projects) || v.projects.length > cellCount) return invalid()
  const built = boolean(v.built)
  const cells: PlayerStationState['cells'] = []
  for (const entry of v.cells) {
    const cell = record(entry)
    if (typeof cell.kind !== 'string' || !Object.hasOwn(PLAYER_FACILITIES, cell.kind)) return invalid()
    const cellIndex = integer(cell.cellIndex)
    if (cellIndex >= cellCount || cells.some(c => c.cellIndex === cellIndex)) return invalid()
    cells.push({ kind: cell.kind as PlayerFacilityKind, cellIndex, enabled: boolean(cell.enabled) })
  }
  function readProject(value: unknown): PlayerStationProject {
    const p = record(value)
    const kind = p.kind
    if (!(kind === 'body' || typeof kind === 'string' && Object.hasOwn(PLAYER_FACILITIES, kind))) return invalid()
    const expected = kind === 'body' ? PLAYER_STATION_BODY_MS : PLAYER_FACILITIES[kind as PlayerFacilityKind].durationMs
    const durationMs = integer(p.durationMs), progressMs = integer(p.progressMs)
    if (durationMs !== expected || progressMs >= durationMs) return invalid()
    const maxima = kind === 'body' ? PLAYER_STATION_BODY_BILL : PLAYER_FACILITIES[kind as PlayerFacilityKind].bill
    const spent = bill(p.spent, maxima)
    // 工程必须是一档真实技能产生的完整料单，不接受半单或超额退款账。
    const matches = Array.from({ length: 6 }, (_, level) => level).some(level =>
      Object.keys(spent).length === Object.keys(maxima).length && Object.entries(maxima).every(([id, n]) =>
        spent[id] === Math.max(1, Math.ceil(n * (100 - 8 * level) / 100))))
    if (!matches || (kind === 'body') === built) return invalid()
    const cellIndex = kind === 'body' ? undefined : integer(p.cellIndex)
    if (kind === 'body' && p.cellIndex !== undefined || cellIndex !== undefined && (cellIndex >= cellCount || cells.some(c => c.cellIndex === cellIndex))) return invalid()
    if (p.startup !== undefined && (p.startup !== true || kind !== 'power')) return invalid()
    const needsEngineer = kind !== 'body' && !!PLAYER_FACILITIES[kind as PlayerFacilityKind].engineers
    const engineerIndex = p.engineerIndex === undefined ? undefined : integer(p.engineerIndex)
    if (needsEngineer ? engineerIndex === undefined || engineerIndex >= 6 : engineerIndex !== undefined) return invalid()
    return { kind: kind as PlayerStationProject['kind'], ...(cellIndex !== undefined ? { cellIndex } : {}),
      durationMs, progressMs, spent, paused: boolean(p.paused), ...(p.startup === true ? { startup: true } : {}),
      ...(engineerIndex !== undefined ? { engineerIndex } : {}) }
  }
  const project = v.project !== undefined ? readProject(v.project) : undefined
  if (project && project.kind !== 'body') return invalid()
  const projects = v.projects.map(readProject)
  if (projects.some(p => p.kind === 'body') || new Set(projects.map(p => p.cellIndex)).size !== projects.length) return invalid()
  const assigned = projects.flatMap(p => p.engineerIndex === undefined ? [] : [p.engineerIndex])
  if (new Set(assigned).size !== assigned.length) return invalid()
  const powerProjects = projects.filter(p => p.kind === 'power')
  const startup = projects.filter(p => p.startup)
  if (startup.length > 1 || startup.length > 0 && (cells.some(c => c.kind === 'power') || powerProjects[0] !== startup[0])
    || !cells.some(c => c.kind === 'power') && powerProjects.length > 0 && !powerProjects[0].startup) return invalid()
  const bodyApproved = boolean(v.bodyApproved), bodyPaused = boolean(v.bodyPaused)
  const bodyMaterials = bill(v.bodyMaterials), recoveryMaterials = bill(v.recoveryMaterials, PLAYER_STATION_BODY_BILL, true)
  if (!built && (cells.length > 0 || projects.length > 0) || built && (bodyApproved || bodyPaused || Object.keys(bodyMaterials).length > 0)
    || bodyPaused && !bodyApproved || project?.kind === 'body' && !bodyApproved
    || !bodyApproved && Object.keys(bodyMaterials).length > 0) return invalid()
  return { runtimeVersion: 3, clockMs: integer(v.clockMs), built, bodyApproved, bodyPaused,
    bodyMaterials, recoveryMaterials, cells, projects, ...(project ? { project } : {}) }
}

export function serializePlayerStation(state: PlayerStationState, cellCount: 9 | 16 = 9): string {
  return JSON.stringify({ format: FORMAT, version: 3, state: cleanPlayerStation(state, cellCount) })
}

export function loadPlayerStation(text: string, cellCount: 9 | 16 = 9): PlayerStationState {
  const file = record(JSON.parse(text))
  if (file.format !== FORMAT || file.version !== 1 && file.version !== 2 && file.version !== 3) return invalid()
  if (file.version === 3) return cleanPlayerStation(file.state, cellCount)
  // 独立预览v1仅迁移单工程字段，保留物料/暂停/有效工时，不扩展正式游戏迁移。
  const old = record(file.state)
  const oldCells = Array.isArray(old.cells) ? old.cells : invalid()
  const legacyKind = (value: unknown) => {
    const entry = record(value)
    if (!['body', 'power', 'life-support', 'service'].includes(String(entry.kind)) || entry.engineerIndex !== undefined) return invalid()
  }
  oldCells.forEach(legacyKind)
  if (file.version === 2) {
    if (old.runtimeVersion !== 2 || !Array.isArray(old.projects)) return invalid()
    old.projects.forEach(legacyKind)
    if (old.project !== undefined) legacyKind(old.project)
    return cleanPlayerStation({ ...old, runtimeVersion: 3 })
  }
  if (old.runtimeVersion !== 1 || Object.hasOwn(old, 'projects')) return invalid()
  const oldProject = old.project !== undefined ? record(old.project) : undefined
  if (oldProject) legacyKind(oldProject)
  const facility = oldProject && oldProject.kind !== 'body'
  const cells = Array.isArray(old.cells) ? old.cells : invalid()
  const startup = facility && oldProject.kind === 'power' && !cells.some(c => record(c).kind === 'power')
  return cleanPlayerStation({ ...old, runtimeVersion: 3, project: facility ? undefined : oldProject,
    projects: facility ? [{ ...oldProject, ...(startup ? { startup: true } : {}) }] : [] })
}
