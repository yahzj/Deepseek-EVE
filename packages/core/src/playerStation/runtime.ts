import type { PlayerFacilityKind, PlayerStationAction, PlayerStationBill, PlayerStationHost,
  PlayerStationProject, PlayerStationReason, PlayerStationResult, PlayerStationState } from './types'
import { PLAYER_FACILITIES, PLAYER_STATION_BODY_BILL, PLAYER_STATION_BODY_MS } from './rules'

const failure = (reason: PlayerStationReason): PlayerStationResult => ({ ok: false, reason })
const isFacility = (kind: string): kind is PlayerFacilityKind => Object.hasOwn(PLAYER_FACILITIES, kind)
function add(target: Record<string, number>, id: string, count: number): void {
  if (count <= 0) return
  const total = (Object.hasOwn(target, id) ? target[id] : 0) + count
  if (!Number.isSafeInteger(total)) throw new Error('Invalid station material total')
  Object.defineProperty(target, id, { value: total, enumerable: true, configurable: true, writable: true })
}

export function createPlayerStation(): PlayerStationState {
  return { runtimeVersion: 3, clockMs: 0, built: false, bodyApproved: false, bodyPaused: false,
    bodyMaterials: {}, recoveryMaterials: {}, cells: [], projects: [] }
}

export function playerStationBill(host: PlayerStationHost, base: PlayerStationBill = PLAYER_STATION_BODY_BILL): Record<string, number> {
  const level = host.engineeringLevel()
  if (!Number.isInteger(level) || level < 0 || level > 5) throw new Error('Invalid station engineering level')
  // 整数百分数避免边界取整被浮点误差放大一件。
  return Object.fromEntries(Object.entries(base).map(([id, n]) => [id, Math.max(1, Math.ceil(n * (100 - 8 * level) / 100))]))
}

function operationalPower(state: PlayerStationState, host?: PlayerStationHost) {
  const supply = state.cells.filter(c => c.enabled && c.kind === 'power' && !host?.facilityState?.(c.cellIndex).damaged)
    .reduce((sum, cell) => sum + (host?.facilityState?.(cell.cellIndex).level === 2 ? 36 : PLAYER_FACILITIES.power.capacity), 0)
  let demand = 0, left = supply, populationCapacity = 0, serviceOnline = false
  // 生命维持优先，其次服务中心；工程只使用剩余电力。
  const onlineCells = new Set<number>()
  for (const kind of ['life-support', 'service', 'refinery', 'research', 'manufacturing', 'training', 'warning'] as const) for (const cell of state.cells) {
    if (!cell.enabled || cell.kind !== kind || host?.facilityState?.(cell.cellIndex).damaged) continue
    const def = PLAYER_FACILITIES[kind]
    const upgraded = kind === 'life-support' && host?.facilityState?.(cell.cellIndex).level === 2
    const load = upgraded ? 8 : host?.workingCells?.().includes(cell.cellIndex) ? def.workPower ?? def.power : def.power
    demand += load
    if (left >= load) {
      left -= load
      onlineCells.add(cell.cellIndex)
      if (kind === 'life-support') populationCapacity += upgraded ? 10 : def.capacity
      if (kind === 'service') serviceOnline = true
    }
  }
  return { supply, demand, populationCapacity, serviceOnline, onlineCells, remaining: Math.max(0, supply - demand) }
}

function engineers(host?: PlayerStationHost) {
  return [...new Set(host?.engineers?.() ?? [])].filter(index => Number.isInteger(index) && index >= 0 && index < 6).sort((a, b) => a - b)
}
function freeEngineer(state: PlayerStationState, host: PlayerStationHost) {
  return engineers(host).find(index => !state.projects.some(project => project.engineerIndex === index))
}
function workerReady(project: PlayerStationProject, host?: PlayerStationHost) {
  return project.kind === 'body' || !PLAYER_FACILITIES[project.kind].engineers
    || project.engineerIndex !== undefined && engineers(host).includes(project.engineerIndex)
}

function allocation(state: PlayerStationState, projects = state.projects, host?: PlayerStationHost) {
  const power = operationalPower(state, host)
  const external = host?.externalConstructionPower?.() ?? 0
  let remaining = Math.max(0, power.remaining - external), constructionDemand = external, constructionRequested = external
  const powered = new Set<PlayerStationProject>()
  for (const project of projects) {
    if (project.paused) continue
    if (!workerReady(project, host) || project.engineerIndex !== undefined && power.populationCapacity === 0) continue
    if (project.startup) { powered.add(project); continue }
    constructionRequested += 4
    if (remaining < 4) continue
    remaining -= 4
    constructionDemand += 4
    powered.add(project)
  }
  return { powered, supply: power.supply, runningDemand: power.demand, populationCapacity: power.populationCapacity,
    constructionDemand, constructionRequested, demand: power.demand + constructionDemand }
}

function facilityProject(state: PlayerStationState, host: PlayerStationHost, kind: PlayerFacilityKind, cellIndex: number): PlayerStationProject {
  const startup = kind === 'power' && !state.cells.some(c => c.kind === 'power')
    && !state.projects.some(p => p.kind === 'power')
  return { kind, cellIndex, durationMs: PLAYER_FACILITIES[kind].durationMs, progressMs: 0,
    spent: playerStationBill(host, PLAYER_FACILITIES[kind].bill), paused: false, ...(startup ? { startup: true as const } : {}) }
}

export function reconcilePlayerStation(state: PlayerStationState, host: PlayerStationHost): void {
  if (!state.bodyApproved || state.bodyPaused || state.project || state.built) return
  const bill = playerStationBill(host)
  if (Object.entries(bill).some(([id, n]) => (state.bodyMaterials[id] ?? 0) < n)) return
  for (const [id, n] of Object.entries(bill)) {
    state.bodyMaterials[id] -= n
    if (state.bodyMaterials[id] === 0) delete state.bodyMaterials[id]
  }
  state.project = { kind: 'body', progressMs: 0, durationMs: PLAYER_STATION_BODY_MS, spent: bill, paused: false }
}

/** 宿主扣离货舱后交接；拒收部分仍归原货舱，本函数不重复向共仓退款。 */
export function receivePlayerStationMaterials(state: PlayerStationState, host: PlayerStationHost, materials: PlayerStationBill) {
  const accepted: Record<string, number> = {}, rejected: Record<string, number> = {}
  if (Object.values(materials).some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('Invalid delivered material quantity')
  reconcilePlayerStation(state, host)
  const bill = playerStationBill(host)
  for (const [id, n] of Object.entries(materials)) {
    const need = !state.built && state.bodyApproved && state.project?.kind !== 'body'
      ? Math.max(0, (Object.hasOwn(bill, id) ? bill[id] : 0) - (Object.hasOwn(state.bodyMaterials, id) ? state.bodyMaterials[id] : 0)) : 0
    const take = Math.min(n, need)
    add(state.bodyMaterials, id, take)
    add(accepted, id, take)
    add(rejected, id, n - take)
  }
  reconcilePlayerStation(state, host)
  return { accepted, rejected }
}

/** 只交接实际回收运力可装载的部分，不直接写回宿主共仓。 */
export function takePlayerStationRecovery(state: PlayerStationState, limits: PlayerStationBill): Record<string, number> {
  if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid recovery quantity')
  const taken: Record<string, number> = {}
  for (const [id, limit] of Object.entries(limits)) {
    const count = Math.min(limit, Object.hasOwn(state.recoveryMaterials, id) ? state.recoveryMaterials[id] : 0)
    if (count <= 0) continue
    taken[id] = count
    state.recoveryMaterials[id] -= count
    if (state.recoveryMaterials[id] === 0) delete state.recoveryMaterials[id]
  }
  return taken
}

export function advancePlayerStation(state: PlayerStationState, host: PlayerStationHost, deltaMs: number): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0 || !Number.isSafeInteger(state.clockMs + deltaMs)) throw new Error('Invalid elapsed station time')
  reconcilePlayerStation(state, host)
  state.clockMs += deltaMs
  const body = state.project
  if (body && !body.paused) {
    body.progressMs = Math.min(body.durationMs, body.progressMs + deltaMs)
    if (body.progressMs >= body.durationMs) {
      state.built = true
      state.bodyApproved = false
      const surplus = { ...state.bodyMaterials }
      state.bodyMaterials = {}
      delete state.project
      if (Object.keys(surplus).length > 0) host.give(surplus)
    }
    return
  }
  // 在每项完工边界重新分电，避免大步推进漏算释放负荷或提前借用新电源。
  let left = deltaMs
  while (left > 0) {
    const { powered } = allocation(state, state.projects, host)
    if (powered.size === 0) break
    const step = Math.min(left, ...[...powered].map(p => p.durationMs - p.progressMs))
    for (const p of powered) p.progressMs += step
    const done = state.projects.filter(p => p.progressMs >= p.durationMs)
    for (const p of done) state.cells.push({ kind: p.kind as PlayerFacilityKind, cellIndex: p.cellIndex!, enabled: true })
    state.projects = state.projects.filter(p => !done.includes(p))
    left -= step
  }
}

export function playerStationNextEventMs(state: PlayerStationState, host?: PlayerStationHost): number {
  if (state.project && !state.project.paused) return state.project.durationMs - state.project.progressMs
  return Math.min(Infinity, ...[...allocation(state, state.projects, host).powered].map(project => project.durationMs - project.progressMs))
}

export function playerStationCommand(state: PlayerStationState, host: PlayerStationHost, action: PlayerStationAction): PlayerStationResult {
  if (state.runtimeVersion !== 3) return failure('invalid-state')
  if (action.kind === 'approve') {
    if (state.built || state.project || state.bodyApproved) return failure('busy')
    state.bodyApproved = true
    state.bodyPaused = false
    reconcilePlayerStation(state, host)
    return { ok: true }
  }
  if (action.kind === 'pause' || action.kind === 'resume') {
    if (!state.built && action.cellIndex !== undefined) return failure('no-project')
    const project = state.built ? state.projects.find(p => p.cellIndex === action.cellIndex) : state.project
    if (project) project.paused = action.kind === 'pause'
    else if (!state.built && action.cellIndex === undefined && state.bodyApproved) state.bodyPaused = action.kind === 'pause'
    else return failure('no-project')
    reconcilePlayerStation(state, host)
    return { ok: true }
  }
  if (action.kind === 'cancel') {
    if (!state.built && action.cellIndex !== undefined) return failure('no-project')
    const project = state.built ? state.projects.find(p => p.cellIndex === action.cellIndex) : state.project
    if (!project && (state.built || action.cellIndex !== undefined || !state.bodyApproved)) return failure('no-project')
    const refund: Record<string, number> = {}
    if (project) for (const [id, n] of Object.entries(project.spent)) {
      // 原投入乘整数剩余工时，确保取消不会因技能或浮点误差改变物资账。
      const remaining = BigInt(project.durationMs - project.progressMs)
      add(refund, id, Number(BigInt(n) * remaining / BigInt(project.durationMs)))
    }
    if (!state.built) {
      for (const [id, n] of Object.entries(state.bodyMaterials)) add(state.recoveryMaterials, id, n)
      for (const [id, n] of Object.entries(refund)) add(state.recoveryMaterials, id, n)
      state.bodyMaterials = {}
    }
    if (state.built) state.projects = state.projects.filter(p => p !== project)
    else {
      delete state.project
      state.bodyApproved = false
      state.bodyPaused = false
    }
    if (state.built && Object.keys(refund).length > 0) host.give(refund)
    return { ok: true }
  }
  if (!state.built) return failure('body-required')
  if (action.kind === 'toggle') {
    const cell = state.cells.find(c => c.cellIndex === action.cellIndex)
    if (!cell) return failure('invalid-cell')
    cell.enabled = !cell.enabled
    return { ok: true }
  }
  if (action.kind !== 'build' || !isFacility(action.facility)) return failure('invalid-action')
  if (host.unlocked && !host.unlocked(action.facility)) return failure('research')
  if (!Number.isInteger(action.cellIndex) || action.cellIndex < 0 || action.cellIndex >= (host.cellCount?.() ?? 9)
    || state.cells.some(c => c.cellIndex === action.cellIndex) || state.projects.some(p => p.cellIndex === action.cellIndex)) return failure('invalid-cell')
  const project = facilityProject(state, host, action.facility, action.cellIndex)
  if (PLAYER_FACILITIES[action.facility].engineers) {
    const engineerIndex = freeEngineer(state, host)
    if (engineerIndex === undefined || operationalPower(state, host).populationCapacity === 0) return failure('engineer')
    project.engineerIndex = engineerIndex
  }
  if (!allocation(state, [...state.projects, project], host).powered.has(project)) return failure('power')
  if (!host.take(project.spent)) return failure('materials')
  state.projects.push(project)
  return { ok: true }
}

export function playerStationView(state: PlayerStationState, host: PlayerStationHost) {
  const project = state.project
  const bill = project?.kind === 'body' ? project.spent : playerStationBill(host)
  const { powered, ...power } = allocation(state, state.projects, host)
  const cellCount = host.cellCount?.() ?? 9
  return { visible: true, built: state.built, bodyApproved: state.bodyApproved, cellCount,
    receptionReady: state.built && operationalPower(state, host).serviceOnline && power.populationCapacity > 0,
    bodyPaused: state.bodyPaused, project: project ? { ...project, spent: { ...project.spent } } : undefined,
    cells: state.cells.map(cell => ({ ...cell, level: host.facilityState?.(cell.cellIndex).level ?? 1, damaged: host.facilityState?.(cell.cellIndex).damaged ?? false,
      operational: cell.kind === 'power' ? cell.enabled && !host.facilityState?.(cell.cellIndex).damaged : operationalPower(state, host).onlineCells.has(cell.cellIndex),
      working: !!host?.workingCells?.().includes(cell.cellIndex) })), power,
    projects: state.projects.map(p => ({ ...p, spent: { ...p.spent }, blocked: !p.paused && !powered.has(p),
      blockedReason: !p.paused && (!workerReady(p, host) || p.engineerIndex !== undefined && power.populationCapacity === 0) ? 'engineer' : !p.paused && !powered.has(p) ? 'power' : undefined })),
    facilityOptions: Object.fromEntries(Object.entries(PLAYER_FACILITIES).map(([kind, def]) => {
      const p = facilityProject(state, host, kind as PlayerFacilityKind, -1)
      const engineerIndex = freeEngineer(state, host)
      const needsEngineer = !!def.engineers
      if (needsEngineer && engineerIndex !== undefined) p.engineerIndex = engineerIndex
      const hasEngineer = !needsEngineer || engineerIndex !== undefined && power.populationCapacity > 0
      const hasPower = allocation(state, [...state.projects, p], host).powered.has(p)
      const remainingPower = Math.max(0, power.supply - power.runningDemand - power.constructionDemand)
      const materials = Object.entries(p.spent).every(([id, n]) => host.available(id) >= n)
      const unlocked = host.unlocked?.(kind as PlayerFacilityKind) ?? true
      return [kind, { nameId: def.nameId, descriptionId: def.descriptionId, durationMs: def.durationMs,
        constructionPower: p.startup ? 0 : 4, powerShortfall: p.startup ? 0 : Math.max(0, 4 - remainingPower),
        runPower: def.power, workPower: def.workPower ?? def.power, capacity: def.capacity, engineers: def.engineers ?? 0,
        availableEngineers: engineers(host).filter(index => !state.projects.some(project => project.engineerIndex === index)).length,
        canBuild: state.built && unlocked && hasEngineer && hasPower && materials,
        reason: !state.built ? 'body-required' : !unlocked ? 'research' : !hasEngineer ? 'engineer' : !hasPower ? 'power' : !materials ? 'materials' : undefined }]
    })) as Record<PlayerFacilityKind, { nameId: string; descriptionId: string; durationMs: number; constructionPower: number; powerShortfall: number;
      runPower: number; workPower: number; capacity: number; engineers: number; availableEngineers: number; canBuild: boolean; reason?: string }>,
    bill: Object.entries(bill).map(([itemId, need]) => ({ itemId, itemName: host.itemName(itemId), need,
      delivered: project?.kind === 'body' || state.built ? need : state.bodyMaterials[itemId] ?? 0,
      remaining: state.built || project?.kind === 'body' ? 0 : Math.max(0, need - (state.bodyMaterials[itemId] ?? 0)) })),
    recoveryMaterials: { ...state.recoveryMaterials },
    facilityBills: Object.fromEntries(Object.entries(PLAYER_FACILITIES).map(([kind, def]) => [kind,
      Object.entries(playerStationBill(host, def.bill)).map(([itemId, need]) => ({ itemId, itemName: host.itemName(itemId),
        need, available: host.available(itemId) }))])) as Record<PlayerFacilityKind, { itemId: string; itemName: string; need: number; available: number }[]>,
  }
}
