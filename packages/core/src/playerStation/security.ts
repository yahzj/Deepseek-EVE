export const STATION_SECURITY_TRAVEL_MS = 5 * 60_000
export const STATION_SECURITY_JOB_MS = 30 * 60_000
export const STATION_SECURITY_RAID_MS = 6 * 60 * 60_000
export const STATION_SECURITY_REPORT_LIMIT = 100
/** nameId 复用既有异常卡身份，由宿主从本地化异常表取名。 */
export const STATION_SECURITY_SOURCES = Object.freeze([
  Object.freeze({ id: 'ano-harbor-escort', nameId: 'ano-harbor-escort' }),
  Object.freeze({ id: 'ano-pirate-post', nameId: 'ano-pirate-post' }),
  Object.freeze({ id: 'ano-abandoned-platform', nameId: 'ano-abandoned-platform' }),
] as const)
export const STATION_SECURITY_ESCORT_BILL = Object.freeze({ 'repairkit-civ': 4, 'ammo-kinetic-l': 60 })
export const STATION_SECURITY_ESCORT_REWARD = Object.freeze({ 'part-circuit': 20 })
export type StationSecuritySourceId = typeof STATION_SECURITY_SOURCES[number]['id']
export type StationSecurityKind = 'patrol' | 'clear' | 'escort'
export interface StationSecurityResult {
  /** ammoUsed 是实际消耗材料账，可含原引擎维修组件；宿主只原子扣一次。 */
  outcome: 'victory' | 'defeat'; durationMs: number; ammoUsed?: Record<string, number>; reward: Record<string, number>
}
interface Deployment { teamIds: string[]; shipIds: string[]; paused: boolean }
export interface StationSecurityMission extends Deployment {
  id: number; sourceId?: StationSecuritySourceId; kind: StationSecurityKind
  phase: 'outbound' | 'operation' | 'returning'; progressMs: number; durationMs: number
  stopped: boolean; reason?: StationSecurityReason; result?: StationSecurityResult; completed: boolean
}
export interface StationSecurityReport {
  id: number; clockMs: number; kind: StationSecurityKind | 'raid' | 'harassment' | 'returned'
  missionId?: number; sourceId?: StationSecuritySourceId; teamIds: string[]
  outcome?: 'victory' | 'defeat'; durationMs: number; ammoUsed: Record<string, number>; reward: Record<string, number>
  /** 由宿主按报告 id 一次性发放；core 不写船员账。 */
  experience: number; materialRisk: boolean; reason?: StationSecurityReason
}
export interface StationSecurity {
  version: 1; clockMs: number; sequence: number
  sources: { id: StationSecuritySourceId; nameId: string; cleared: boolean; nextRaidMs: number; raids: number }[]
  guard?: Deployment
  mission?: StationSecurityMission
  raid?: { sourceId: StationSecuritySourceId; progressMs: number; result: StationSecurityResult }
  reports: StationSecurityReport[]
  /** 累计在外执行时间（毫秒），不读取财富或建筑等级。 */
  exposure: number
}
export interface StationSecurityHost {
  ready(): boolean
  warningOnline(): boolean
  team(id: string): { available: boolean; shipId: string } | undefined
  /** 原子核对人员、队伍及实际船实例的跨岗位互斥，成功后同时锁定。 */
  claimTeams(ids: readonly string[]): boolean
  releaseTeams(ids: readonly string[]): void
  available(itemId: string): number
  take(bill: Readonly<Record<string, number>>): boolean
  settle(result: { reward: Record<string, number> }): void
  /** 必须由宿主调用既有战斗引擎；本模块只推进结果的真实耗时。 */
  resolve(teamIds: readonly string[], sourceId: StationSecuritySourceId): StationSecurityResult
}
export type StationSecurityReason = 'invalid-action' | 'busy' | 'teams' | 'source' | 'cleared' | 'facilities'
  | 'supplies' | 'unassigned' | 'paused' | 'stopped' | 'defeat' | 'harassment'
export type StationSecurityAction = { kind: 'start'; teamIds: string[]; sourceId?: string; missionKind: StationSecurityKind }
  | { kind: 'guard'; teamIds: string[] } | { kind: 'stop' | 'unguard' }
  | { kind: 'pause' | 'resume'; target?: 'mission' | 'guard' }

const integer = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max
const identity = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9_.:#-]*$/.test(id)
const sourceId = (id: unknown): id is StationSecuritySourceId => STATION_SECURITY_SOURCES.some(source => source.id === id)
const missionKind = (kind: unknown): kind is StationSecurityKind => kind === 'patrol' || kind === 'clear' || kind === 'escort'
const reasons: readonly string[] = ['invalid-action', 'busy', 'teams', 'source', 'cleared', 'facilities', 'supplies', 'unassigned', 'paused', 'stopped', 'defeat', 'harassment']
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
function fields(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !keys.split(' ').includes(key))) throw new Error('Invalid station security snapshot')
}
function bill(value: unknown): Record<string, number> {
  if (!record(value) || Object.keys(value).length > 64) throw new Error('Invalid security bill')
  const copy: Record<string, number> = {}
  for (const [id, n] of Object.entries(value)) {
    if (!identity(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !integer(n, 1_000_000_000)) throw new Error('Invalid security bill')
    if (n > 0) copy[id] = n
  }
  return copy
}
function resultOf(value: unknown): StationSecurityResult {
  fields(value, 'outcome durationMs ammoUsed reward')
  if ((value.outcome !== 'victory' && value.outcome !== 'defeat') || !integer(value.durationMs, STATION_SECURITY_JOB_MS - 2 * STATION_SECURITY_TRAVEL_MS) || value.durationMs < 1) throw new Error('Invalid security battle result')
  return { outcome: value.outcome, durationMs: value.durationMs, ammoUsed: bill(value.ammoUsed ?? {}), reward: bill(value.reward) }
}
export function createStationSecurity(): StationSecurity {
  return { version: 1, clockMs: 0, sequence: 0, sources: STATION_SECURITY_SOURCES.map(source =>
    ({ ...source, cleared: false, nextRaidMs: STATION_SECURITY_RAID_MS, raids: 0 })), reports: [], exposure: 0 }
}
function report(state: StationSecurity, entry: Omit<StationSecurityReport, 'id' | 'clockMs'>): void {
  state.reports.push({ ...entry, id: ++state.sequence, clockMs: state.clockMs })
  if (state.reports.length > STATION_SECURITY_REPORT_LIMIT) state.reports.shift()
}
function deployment(state: StationSecurity, host: StationSecurityHost, ids: readonly string[]): Deployment | undefined {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || !ids.every(identity) || new Set(ids).size !== ids.length) return
  const occupied = [state.guard, state.mission].filter((entry): entry is Deployment => !!entry)
  const ships = ids.map(id => host.team(id))
  if (ships.some(entry => !entry?.available || !identity(entry.shipId))) return
  const shipIds = ships.map(entry => entry!.shipId)
  if (new Set(shipIds).size !== shipIds.length || occupied.some(entry => entry.teamIds.some(id => ids.includes(id)) || entry.shipIds.some(id => shipIds.includes(id)))) return
  return { teamIds: [...ids], shipIds, paused: false }
}
function matches(host: StationSecurityHost, entry: Deployment): boolean {
  return entry.teamIds.every((id, i) => host.team(id)?.shipId === entry.shipIds[i])
}
function returnHome(mission: StationSecurityMission, reason?: StationSecurityReason): void {
  if (mission.phase !== 'returning') {
    const travel = mission.phase === 'outbound' ? Math.max(1, mission.progressMs) : STATION_SECURITY_TRAVEL_MS
    mission.phase = 'returning'; mission.progressMs = 0; mission.durationMs = travel
    delete mission.result
  }
  mission.paused = false
  if (reason) { mission.stopped = true; mission.reason = reason }
}
export function stationSecurityCommand(state: StationSecurity, host: StationSecurityHost, action: StationSecurityAction): { ok: true } | { ok: false; reason: StationSecurityReason } {
  if (action.kind === 'start' || action.kind === 'guard') {
    if (action.kind === 'start' ? state.mission : state.guard) return { ok: false, reason: 'busy' }
    if (!host.ready()) return { ok: false, reason: 'facilities' }
    let selected: StationSecuritySourceId | undefined
    if (action.kind === 'start') {
      if (!missionKind(action.missionKind)) return { ok: false, reason: 'invalid-action' }
      selected = action.sourceId === undefined && action.missionKind === 'patrol' ? state.sources.find(source => !source.cleared)?.id
        : sourceId(action.sourceId) ? action.sourceId : undefined
      if (action.missionKind === 'escort' ? action.sourceId !== undefined : !selected) return { ok: false, reason: 'source' }
      if (selected && state.sources.find(source => source.id === selected)!.cleared) return { ok: false, reason: 'cleared' }
    }
    const assigned = deployment(state, host, action.teamIds)
    if (!assigned) return { ok: false, reason: 'teams' }
    const cost: Readonly<Record<string, number>> = action.kind === 'start' && action.missionKind === 'escort' ? STATION_SECURITY_ESCORT_BILL : {}
    if (Object.entries(cost).some(([id, n]) => !(host.available(id) >= n))) return { ok: false, reason: 'supplies' }
    if (!host.claimTeams(assigned.teamIds)) return { ok: false, reason: 'teams' }
    if (!host.take(cost)) { host.releaseTeams(assigned.teamIds); return { ok: false, reason: 'supplies' } }
    if (action.kind === 'guard') state.guard = assigned
    else state.mission = { ...assigned, id: ++state.sequence, kind: action.missionKind, ...(selected ? { sourceId: selected } : {}),
      phase: 'outbound', progressMs: 0, durationMs: STATION_SECURITY_TRAVEL_MS, stopped: false, completed: false }
  } else if (action.kind === 'stop') {
    if (!state.mission) return { ok: false, reason: 'unassigned' }
    const mission = state.mission
    if (mission.phase === 'operation') report(state, { kind: mission.kind, missionId: mission.id, teamIds: [...mission.teamIds],
      ...(mission.sourceId ? { sourceId: mission.sourceId } : {}), durationMs: mission.progressMs,
      ammoUsed: { ...mission.result?.ammoUsed }, reward: {}, experience: 0, materialRisk: false, reason: 'stopped' })
    returnHome(state.mission, 'stopped')
  } else if (action.kind === 'unguard') {
    if (!state.guard) return { ok: false, reason: 'unassigned' }
    if (state.raid) return { ok: false, reason: 'busy' }
    host.releaseTeams(state.guard.teamIds); delete state.guard
  } else if (action.kind === 'pause' || action.kind === 'resume') {
    if (action.target !== undefined && action.target !== 'guard' && action.target !== 'mission') return { ok: false, reason: 'invalid-action' }
    const entry = action.target === 'guard' ? state.guard : state.mission
    if (!entry) return { ok: false, reason: 'unassigned' }
    if (action.target === 'guard' ? !!state.raid : state.mission!.phase === 'returning') return { ok: false, reason: 'busy' }
    entry.paused = action.kind === 'pause'
    if (action.kind === 'resume' && action.target !== 'guard') delete state.mission!.reason
  } else return { ok: false, reason: 'invalid-action' }
  return { ok: true }
}
function harassment(state: StationSecurity, id: StationSecuritySourceId, reason: StationSecurityReason): void {
  if (state.mission && state.mission.phase !== 'returning') { state.mission.paused = true; state.mission.reason = 'harassment' }
  report(state, { kind: 'harassment', sourceId: id, teamIds: [], durationMs: 0, ammoUsed: {}, reward: {}, experience: 0, materialRisk: true, reason })
}
function missionRunning(state: StationSecurity, host: StationSecurityHost): boolean {
  return !!state.mission && (state.mission.phase === 'returning' || (!state.mission.paused && host.ready()))
}
export function stationSecurityNextEventMs(state: StationSecurity, host: StationSecurityHost): number {
  return Math.min(missionRunning(state, host) ? state.mission!.durationMs - state.mission!.progressMs : Infinity,
    state.raid ? state.raid.result.durationMs - state.raid.progressMs : Infinity,
    state.raid ? Infinity : Math.min(...state.sources.filter(source => !source.cleared).map(source => Math.max(0, source.nextRaidMs - state.clockMs))))
}
function missionBoundary(state: StationSecurity, host: StationSecurityHost): void {
  const mission = state.mission!
  if (mission.phase === 'returning') {
    report(state, { kind: 'returned', missionId: mission.id, teamIds: [...mission.teamIds], ...(mission.sourceId ? { sourceId: mission.sourceId } : {}),
      durationMs: mission.durationMs, ammoUsed: {}, reward: {}, experience: 0, materialRisk: false, ...(mission.reason ? { reason: mission.reason } : {}) })
    host.releaseTeams(mission.teamIds); delete state.mission
  } else if (mission.phase === 'outbound') {
    if (!matches(host, mission)) { returnHome(mission, 'teams'); return }
    if (mission.kind !== 'escort') {
      const result = resultOf(host.resolve([...mission.teamIds], mission.sourceId!))
      if (!host.take(result.ammoUsed!)) { returnHome(mission, 'supplies'); return }
      mission.result = result
    }
    mission.phase = 'operation'; mission.progressMs = 0
    mission.durationMs = mission.kind === 'clear' || mission.result?.outcome === 'defeat'
      ? mission.result!.durationMs : STATION_SECURITY_JOB_MS - 2 * STATION_SECURITY_TRAVEL_MS
  } else {
    const result = mission.result
    const victory = !result || result.outcome === 'victory'
    const reward = victory ? mission.kind === 'escort' ? { ...STATION_SECURITY_ESCORT_REWARD }
      : mission.kind === 'clear' ? { ...result!.reward } : { 'part-circuit': 4 } : {}
    host.settle({ reward: { ...reward } })
    if (mission.kind === 'clear' && victory) state.sources.find(source => source.id === mission.sourceId)!.cleared = true
    report(state, { kind: mission.kind, missionId: mission.id, teamIds: [...mission.teamIds], ...(mission.sourceId ? { sourceId: mission.sourceId } : {}),
      outcome: victory ? 'victory' : 'defeat', durationMs: mission.durationMs, ammoUsed: { ...result?.ammoUsed }, reward,
      experience: victory ? 20 : 5, materialRisk: false, ...(!victory ? { reason: 'defeat' as const } : {}) })
    mission.completed = true
    returnHome(mission, victory ? undefined : 'defeat')
  }
}
function raidBoundary(state: StationSecurity, host: StationSecurityHost): void {
  const raid = state.raid!, guard = state.guard!
  report(state, { kind: 'raid', sourceId: raid.sourceId, teamIds: [...guard.teamIds], outcome: raid.result.outcome,
    durationMs: raid.result.durationMs, ammoUsed: { ...raid.result.ammoUsed }, reward: {}, experience: raid.result.outcome === 'victory' ? 10 : 3, materialRisk: false })
  if (raid.result.outcome === 'defeat') { guard.paused = true; harassment(state, raid.sourceId, 'defeat') }
  delete state.raid
}
/** 同时刻先结任务，再结防守，最后处理来袭；大步和小步共用事件边界。 */
export function advanceStationSecurity(state: StationSecurity, host: StationSecurityHost, deltaMs: number): void {
  if (!integer(deltaMs) || !integer(state.clockMs + deltaMs + STATION_SECURITY_RAID_MS)) throw new Error('Invalid security elapsed time')
  const endMs = state.clockMs + deltaMs
  for (;;) {
    const remaining = stationSecurityNextEventMs(state, host)
    const step = Math.min(endMs - state.clockMs, remaining)
    if (missionRunning(state, host)) {
      state.mission!.progressMs += step
      state.exposure = Math.min(Number.MAX_SAFE_INTEGER, state.exposure + step)
    }
    if (state.raid) state.raid.progressMs += step
    state.clockMs += step
    if (missionRunning(state, host) && state.mission!.progressMs === state.mission!.durationMs) missionBoundary(state, host)
    if (state.raid && state.raid.progressMs === state.raid.result.durationMs) raidBoundary(state, host)
    for (const source of state.sources) {
      if (state.raid || source.cleared || source.nextRaidMs > state.clockMs) continue
      // 零暴露不制造袭扰；离线空档按已有计划跨过，不重新随机倒计时。
      source.nextRaidMs += (Math.floor((state.clockMs - source.nextRaidMs) / STATION_SECURITY_RAID_MS) + 1) * STATION_SECURITY_RAID_MS
      if (state.exposure === 0) continue
      source.raids++
      const guard = state.guard
      if (!guard || guard.paused || !host.ready() || !matches(host, guard)) { harassment(state, source.id, 'unassigned'); continue }
      const result = resultOf(host.resolve([...guard.teamIds], source.id))
      if (!host.take(result.ammoUsed!)) { guard.paused = true; harassment(state, source.id, 'supplies'); continue }
      state.raid = { sourceId: source.id, progressMs: 0, result }
    }
    if (state.clockMs === endMs && stationSecurityNextEventMs(state, host) > 0) break
  }
}
export function stationSecurityView(state: StationSecurity, host: StationSecurityHost) {
  return { ...structuredClone(state), sources: state.sources.map(source => ({ ...source,
    remainingMs: host.warningOnline() && !source.cleared ? Math.max(0, source.nextRaidMs - state.clockMs) : undefined })),
    blocked: state.mission && state.mission.phase !== 'returning' ? state.mission.paused ? 'paused' : !host.ready() ? 'facilities' : undefined : undefined,
    nextEventMs: stationSecurityNextEventMs(state, host) }
}

/** 只清洗本域；人员唯一性与其他岗位的船锁仍须宿主在整档装载事务中核对。 */
export function cleanStationSecurity(value: unknown, host?: Pick<StationSecurityHost, 'team'>): StationSecurity {
  const invalid = (): never => { throw new Error('Invalid station security snapshot') }
  fields(value, 'version clockMs sequence sources guard mission raid reports exposure')
  if (value.version !== 1 || !integer(value.clockMs, Number.MAX_SAFE_INTEGER - STATION_SECURITY_RAID_MS) || !integer(value.sequence)
    || !integer(value.exposure) || value.exposure > value.clockMs || !Array.isArray(value.sources) || value.sources.length !== 3
    || !Array.isArray(value.reports) || value.reports.length > STATION_SECURITY_REPORT_LIMIT) return invalid()
  const state = createStationSecurity()
  state.clockMs = value.clockMs; state.sequence = value.sequence; state.exposure = value.exposure
  state.sources = value.sources.map((raw, index) => {
    fields(raw, 'id nameId cleared nextRaidMs raids')
    const source = STATION_SECURITY_SOURCES[index]!
    if (raw.id !== source.id || raw.nameId !== source.nameId || typeof raw.cleared !== 'boolean' || !integer(raw.nextRaidMs)
      || raw.nextRaidMs < STATION_SECURITY_RAID_MS || raw.nextRaidMs % STATION_SECURITY_RAID_MS !== 0 || !integer(raw.raids)
      || raw.raids > Math.floor(state.clockMs / STATION_SECURITY_RAID_MS) || raw.nextRaidMs > state.clockMs + STATION_SECURITY_RAID_MS) return invalid()
    return { ...source, cleared: raw.cleared, nextRaidMs: raw.nextRaidMs, raids: raw.raids }
  })
  const teams = new Set<string>(), ships = new Set<string>()
  const cleanDeployment = (raw: Record<string, unknown>): Deployment => {
    if (!Array.isArray(raw.teamIds) || raw.teamIds.length < 1 || raw.teamIds.length > 4 || !Array.isArray(raw.shipIds)
      || raw.shipIds.length !== raw.teamIds.length || typeof raw.paused !== 'boolean') return invalid()
    for (let i = 0; i < raw.teamIds.length; i++) {
      const id = raw.teamIds[i], ship = raw.shipIds[i]
      if (!identity(id) || !identity(ship) || teams.has(id) || ships.has(ship) || (host && host.team(id)?.shipId !== ship)) return invalid()
      teams.add(id); ships.add(ship)
    }
    return { teamIds: [...raw.teamIds] as string[], shipIds: [...raw.shipIds] as string[], paused: raw.paused }
  }
  if (value.guard !== undefined) {
    fields(value.guard, 'teamIds shipIds paused'); state.guard = cleanDeployment(value.guard)
  }
  if (value.mission !== undefined) {
    const raw = value.mission
    fields(raw, 'teamIds shipIds paused id sourceId kind phase progressMs durationMs stopped reason result completed')
    if (!integer(raw.id, state.sequence) || raw.id < 1 || !missionKind(raw.kind) || !['outbound', 'operation', 'returning'].includes(String(raw.phase))
      || !integer(raw.durationMs, STATION_SECURITY_JOB_MS) || raw.durationMs < 1 || !integer(raw.progressMs, raw.durationMs - 1)
      || typeof raw.stopped !== 'boolean' || typeof raw.completed !== 'boolean' || (raw.reason !== undefined && !reasons.includes(String(raw.reason)))
      || (raw.kind === 'escort' ? raw.sourceId !== undefined : !sourceId(raw.sourceId))) return invalid()
    const phase = raw.phase as StationSecurityMission['phase']
    if ((raw.stopped || raw.completed) && phase !== 'returning') return invalid()
    if (phase === 'returning' && (raw.paused || raw.durationMs > STATION_SECURITY_TRAVEL_MS || raw.result !== undefined)) return invalid()
    if (phase === 'outbound' && (raw.durationMs !== STATION_SECURITY_TRAVEL_MS || raw.result !== undefined)) return invalid()
    const result = raw.result === undefined ? undefined : resultOf(raw.result)
    if (phase === 'operation' && (raw.kind === 'escort' ? !!result : !result)) return invalid()
    if (phase === 'operation' && raw.durationMs !== (raw.kind === 'clear' || result?.outcome === 'defeat'
      ? result!.durationMs : STATION_SECURITY_JOB_MS - 2 * STATION_SECURITY_TRAVEL_MS)) return invalid()
    if (raw.kind !== 'escort' && phase !== 'returning' && state.sources.find(source => source.id === raw.sourceId)!.cleared) return invalid()
    state.mission = { ...cleanDeployment(raw), id: raw.id, kind: raw.kind, phase, durationMs: raw.durationMs, progressMs: raw.progressMs,
      stopped: raw.stopped, completed: raw.completed, ...(sourceId(raw.sourceId) ? { sourceId: raw.sourceId } : {}),
      ...(raw.reason ? { reason: raw.reason as StationSecurityReason } : {}), ...(result ? { result } : {}) }
  }
  if (value.raid !== undefined) {
    const raw = value.raid
    fields(raw, 'sourceId progressMs result')
    const result = resultOf(raw.result)
    const source = state.sources.find(source => source.id === raw.sourceId)
    if (!state.guard || state.guard.paused || !sourceId(raw.sourceId) || !integer(raw.progressMs, result.durationMs - 1)
      || !source || source.raids < 1 || source.nextRaidMs <= state.clockMs) return invalid()
    state.raid = { sourceId: raw.sourceId, progressMs: raw.progressMs, result }
  }
  if (!state.raid && state.sources.some(source => !source.cleared && source.nextRaidMs <= state.clockMs)) return invalid()
  let previous = 0, previousClock = 0
  const clearedReports = new Set<string>()
  state.reports = value.reports.map(raw => {
    fields(raw, 'id clockMs kind missionId sourceId teamIds outcome durationMs ammoUsed reward experience materialRisk reason')
    if (!integer(raw.id, state.sequence) || raw.id <= previous || raw.id === state.mission?.id || !integer(raw.clockMs, state.clockMs) || raw.clockMs < previousClock
      || !['patrol', 'clear', 'escort', 'raid', 'harassment', 'returned'].includes(String(raw.kind)) || !Array.isArray(raw.teamIds)
      || raw.teamIds.length > 4 || !raw.teamIds.every(identity) || new Set(raw.teamIds).size !== raw.teamIds.length
      || (raw.sourceId !== undefined && !sourceId(raw.sourceId)) || (raw.missionId !== undefined && (!integer(raw.missionId, raw.id - 1) || raw.missionId < 1))
      || (raw.outcome !== undefined && raw.outcome !== 'victory' && raw.outcome !== 'defeat') || !integer(raw.durationMs, STATION_SECURITY_JOB_MS)
      || !integer(raw.experience, 20) || typeof raw.materialRisk !== 'boolean' || (raw.reason !== undefined && !reasons.includes(String(raw.reason)))) return invalid()
    const reward = bill(raw.reward), ammoUsed = bill(raw.ammoUsed)
    if (raw.kind === 'harassment') {
      if (!sourceId(raw.sourceId) || raw.teamIds.length !== 0 || raw.missionId !== undefined || raw.outcome !== undefined
        || raw.durationMs !== 0 || raw.experience !== 0 || !raw.materialRisk || Object.keys(reward).length || Object.keys(ammoUsed).length) return invalid()
    } else {
      if (raw.teamIds.length === 0 || raw.materialRisk) return invalid()
      if (raw.kind === 'raid') {
        if (!sourceId(raw.sourceId) || raw.missionId !== undefined || !raw.outcome || Object.keys(reward).length
          || raw.experience !== (raw.outcome === 'victory' ? 10 : 3)) return invalid()
      } else {
        if (raw.missionId === undefined || (raw.kind === 'escort' ? raw.sourceId !== undefined : raw.kind !== 'returned' && !sourceId(raw.sourceId))) return invalid()
        if (raw.kind === 'returned') {
          if (raw.outcome !== undefined || raw.experience !== 0 || Object.keys(reward).length || Object.keys(ammoUsed).length) return invalid()
        } else if (raw.reason === 'stopped') {
          if (raw.outcome !== undefined || raw.experience !== 0 || Object.keys(reward).length) return invalid()
        } else if (!raw.outcome || raw.experience !== (raw.outcome === 'victory' ? 20 : 5)
          || (raw.outcome === 'defeat' && Object.keys(reward).length)) return invalid()
      }
    }
    if (raw.kind === 'clear' && raw.outcome === 'victory') {
      if (clearedReports.has(String(raw.sourceId)) || !state.sources.find(source => source.id === raw.sourceId)!.cleared) return invalid()
      clearedReports.add(String(raw.sourceId))
    }
    previous = raw.id; previousClock = raw.clockMs
    return { id: raw.id, clockMs: raw.clockMs, kind: raw.kind as StationSecurityReport['kind'], teamIds: [...raw.teamIds], durationMs: raw.durationMs,
      ammoUsed, reward, experience: raw.experience, materialRisk: raw.materialRisk,
      ...(raw.sourceId ? { sourceId: raw.sourceId as StationSecuritySourceId } : {}), ...(raw.missionId ? { missionId: raw.missionId as number } : {}),
      ...(raw.outcome ? { outcome: raw.outcome as 'victory' | 'defeat' } : {}), ...(raw.reason ? { reason: raw.reason as StationSecurityReason } : {}) }
  })
  return state
}
