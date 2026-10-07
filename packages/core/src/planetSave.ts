import type {
  PlanetColonyState, PlanetDelivery, PlanetEvent, PlanetGridCell, PlanetJob,
  PlanetLocalResource, PlanetObstacle, PlanetResource, PlanetaryState, PlanetState,
} from './planetTypes'
import { PLANET_RULES } from './planetRules'
import { cleanStellarState } from './stellarSave'

function record(raw: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null)
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) if (id(key)) result[key] = value
  }
  return result
}
function id(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(raw)
}
function strings(raw: unknown, limit = 24): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(id))].slice(0, limit) : []
}
const RESOURCES: readonly PlanetResource[] = ['metal', 'water', 'food', 'research', 'rare', 'energy']
const LOCAL_RESOURCES: readonly PlanetLocalResource[] = ['food', 'water', 'medicine', 'metal', 'parts', 'research', 'rare']
const OBSTACLES: readonly PlanetObstacle[] = ['rough', 'ice', 'corrosion', 'rubble']
const JOB_KINDS: readonly PlanetJob['kind'][] = ['build', 'clear', 'move', 'project']
const EVENT_KINDS: readonly PlanetEvent['kind'][] = ['equipment', 'weather', 'resources', 'health', 'ruins']
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000
// 版本 1 的时钟余数是固定 10 秒量子；累计时钟不受单次工期的七天上限限制。
const TICK_MS = 10_000

function finite(raw: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max
}
function integer(raw: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): raw is number {
  return finite(raw, min, max) && Number.isSafeInteger(raw)
}
function count(raw: unknown): number {
  return integer(raw) ? raw : 0
}
function items(raw: unknown, positive = false): Record<string, number> {
  return Object.fromEntries(Object.entries(record(raw)).filter(([, value]) => integer(value, positive ? 1 : 0))) as Record<string, number>
}
function checkRuntimeVersion(raw: unknown): void {
  // 不抹掉未知版本再让运行器按旧规则推进；由读档入口显式拒绝。
  if (raw !== undefined && raw !== 1) throw new Error('unsupported-planet-runtime-version')
}

function cleanPlanetJob(raw: unknown, cellCount: number): PlanetJob | undefined {
  const j = record(raw)
  if (!integer(j.seq, 1) || !JOB_KINDS.includes(j.kind as PlanetJob['kind'])
    || !finite(j.totalMs, Number.MIN_VALUE, MAX_DURATION_MS) || !finite(j.remainingMs, 0, j.totalMs)
    || !integer(j.spentCredits) || typeof j.paused !== 'boolean'
    || j.spentItems === null || typeof j.spentItems !== 'object' || Array.isArray(j.spentItems)) return undefined
  if (j.cellIndex !== undefined && !integer(j.cellIndex, 0, cellCount - 1)
    || j.targetIndex !== undefined && !integer(j.targetIndex, 0, cellCount - 1)
    || j.buildingId !== undefined && !id(j.buildingId)
    || j.projectId !== undefined && !id(j.projectId)) return undefined
  if (j.kind === 'project') {
    if (!id(j.projectId)) return undefined
  } else {
    if (!integer(j.cellIndex, 0, cellCount - 1)) return undefined
    if ((j.kind === 'build' || j.kind === 'move') && !id(j.buildingId)) return undefined
    if (j.kind === 'move' && (!integer(j.targetIndex, 0, cellCount - 1) || j.targetIndex === j.cellIndex)) return undefined
  }
  return {
    seq: j.seq, kind: j.kind as PlanetJob['kind'], remainingMs: j.remainingMs, totalMs: j.totalMs,
    spentItems: items(j.spentItems, true), spentCredits: j.spentCredits, paused: j.paused,
    ...(finite(j.spentResearch) ? { spentResearch: j.spentResearch } : {}),
    ...(j.cellIndex !== undefined ? { cellIndex: j.cellIndex as number } : {}),
    ...(j.targetIndex !== undefined ? { targetIndex: j.targetIndex as number } : {}),
    ...(j.buildingId !== undefined ? { buildingId: j.buildingId as string } : {}),
    ...(j.projectId !== undefined ? { projectId: j.projectId as string } : {}),
  }
}

function cleanPlanetEvent(raw: unknown, cellCount: number): PlanetEvent | undefined {
  const e = record(raw)
  if (!integer(e.seq, 1) || !EVENT_KINDS.includes(e.kind as PlanetEvent['kind']) || !finite(e.atMs)
    || e.cellIndex !== undefined && !integer(e.cellIndex, 0, cellCount - 1)) return undefined
  return { seq: e.seq, kind: e.kind as PlanetEvent['kind'], atMs: e.atMs,
    ...(e.cellIndex !== undefined ? { cellIndex: e.cellIndex as number } : {}) }
}

export function cleanPlanetColonyState(raw: unknown, cellCount = 36): PlanetColonyState | undefined {
  const c = record(raw)
  checkRuntimeVersion(c.runtimeVersion)
  if (c.runtimeVersion !== 1) return undefined
  const jobs: PlanetJob[] = []
  const seen = new Set<number>()
  let jobSeq = count(c.jobSeq)
  for (const value of Array.isArray(c.jobs) ? c.jobs : []) {
    const job = cleanPlanetJob(value, cellCount)
    if (!job || seen.has(job.seq)) continue
    seen.add(job.seq)
    jobs.push(job)
    jobSeq = Math.max(jobSeq, job.seq)
  }
  const event = cleanPlanetEvent(c.event, cellCount)
  const supplies: PlanetColonyState['supplies'] = {}
  const source = record(c.supplies)
  for (const key of LOCAL_RESOURCES) if (finite(source[key])) supplies[key] = source[key]
  return {
    runtimeVersion: 1, items: items(c.items), credits: count(c.credits), supplies,
    awake: count(c.awake), sleeping: count(c.sleeping), jobs,
    jobSeq,
    clockMs: finite(c.clockMs) ? c.clockMs : 0,
    tickRemainderMs: finite(c.tickRemainderMs) && c.tickRemainderMs < TICK_MS ? c.tickRemainderMs : 0,
    crisis: c.crisis === 'none' || c.crisis === 'sheltered' || c.crisis === 'rescue' ? c.crisis : 'rescue',
    ...(event ? { event } : {}),
    eventSeq: Math.max(count(c.eventSeq), event?.seq ?? 0),
    nextEventMs: finite(c.nextEventMs) ? c.nextEventMs : 0,
    eventRngCount: count(c.eventRngCount),
    ...(typeof c.pauseEvents === 'boolean' ? { pauseEvents: c.pauseEvents } : {}),
  }
}

function cleanPlanetDelivery(raw: unknown): PlanetDelivery | undefined {
  const d = record(raw)
  if (!integer(d.seq, 1) || !id(d.planetId) || !id(d.shipUid) || !integer(d.credits) || !integer(d.humans)
    || !finite(d.durationMs, Number.MIN_VALUE, MAX_DURATION_MS) || !finite(d.remainingMs, 0, d.durationMs)
    || d.items === null || typeof d.items !== 'object' || Array.isArray(d.items)) return undefined
  return { seq: d.seq, planetId: d.planetId, shipUid: d.shipUid, items: items(d.items, true),
    credits: d.credits, humans: d.humans, remainingMs: d.remainingMs, durationMs: d.durationMs }
}

export function cleanPlanetaryState(raw: unknown): PlanetaryState | undefined {
  const root = record(raw)
  checkRuntimeVersion(root.runtimeVersion)
  const stellar = cleanStellarState(root.stellar)
  const bodies = new Map((stellar ? Object.values(stellar.systems) : []).flatMap(system =>
    system.bodies.map(body => [body.planetId, { systemId: system.id, kind: body.kind }] as const)))
  const source = record(root.planets)
  const planets: Record<string, PlanetState> = {}
  let legacyCount = 0
  for (const [key, value] of Object.entries(source)) {
    const p = record(value)
    const body = p.systemId !== undefined ? bodies.get(key) : undefined
    // 旧记录仍只读取前六十四条；新星球必须属于已清洗的星系，不能靠伪造归属绕过上限。
    if (p.systemId === undefined) {
      if (++legacyCount > PLANET_RULES.maxPlanets) continue
    } else if (!id(p.systemId) || !body || body.systemId !== p.systemId) continue
    if (p.surfaceAllowed !== undefined && typeof p.surfaceAllowed !== 'boolean') continue
    if (!id(key) || p.id !== key || !id(p.galaxyId) || (p.size !== 4 && p.size !== 5 && p.size !== 6)) continue
    if (!Number.isSafeInteger(p.seed) || (p.seed as number) < 0 || (p.seed as number) > 0xffffffff) continue
    if (!Number.isSafeInteger(p.generationVersion) || (p.generationVersion as number) < 1) continue
    const traitIds = strings(p.traitIds)
    if (!traitIds.length || !id(p.hiddenTraitId) || !traitIds.includes(p.hiddenTraitId)) continue
    const cells: PlanetGridCell[] = []
    const rawCells = Array.isArray(p.cells) ? p.cells : []
    if (rawCells.length !== p.size ** 2) continue
    let invalid = false
    for (let index = 0; index < rawCells.length; index++) {
      const c = record(rawCells[index])
      // 不补空地或重生成，避免损坏地图被清洗成可免费建设的地图。
      if (c.index !== index || (c.obstacle !== undefined && !OBSTACLES.includes(c.obstacle as PlanetObstacle))) { invalid = true; break }
      const cell: PlanetGridCell = { index }
      if (c.obstacle !== undefined) cell.obstacle = c.obstacle as PlanetObstacle
      if (c.deposit !== undefined) {
        const d = record(c.deposit)
        if (!RESOURCES.includes(d.resource as PlanetResource) || !id(d.sourceTraitId) || !traitIds.includes(d.sourceTraitId)
          || typeof d.bonus !== 'number' || !Number.isFinite(d.bonus) || d.bonus < 0 || d.bonus > 1) { invalid = true; break }
        cell.deposit = { resource: d.resource as PlanetResource, sourceTraitId: d.sourceTraitId, bonus: d.bonus }
      }
      if (c.building !== undefined) {
        const b = record(c.building)
        if (!id(b.id) || (b.status !== 'construction' && b.status !== 'ready' && b.status !== 'stopped') || cell.obstacle) { invalid = true; break }
        cell.building = { id: b.id, status: b.status, powered: b.powered === true, staffed: b.staffed === true }
        if (b.condition !== undefined) cell.building.condition = finite(b.condition, 0, 1) ? b.condition : 0
        if (b.enabled !== undefined) cell.building.enabled = b.enabled === true
      }
      cells.push(cell)
    }
    if (invalid) continue
    const colony = cleanPlanetColonyState(p.colony, rawCells.length)
    // 坏殖民记录不能退成可重新初始化的空基地。
    if (p.colony !== undefined && !colony) continue
    planets[key] = {
      id: key, galaxyId: p.galaxyId, size: p.size, seed: p.seed as number,
      generationVersion: p.generationVersion as number, traitIds, hiddenTraitId: p.hiddenTraitId,
      survey: p.survey === 2 || p.survey === 3 ? p.survey : 1, cells,
      ...(p.systemId !== undefined ? { systemId: p.systemId as string } : {}),
      ...(body?.kind === 'gas' ? { surfaceAllowed: false }
        : typeof p.surfaceAllowed === 'boolean' ? { surfaceAllowed: p.surfaceAllowed } : {}),
      ...(colony ? { colony } : {}),
      ...(p.originalTraitIds !== undefined ? { originalTraitIds: strings(p.originalTraitIds) } : {}),
      ...(p.projectHistory !== undefined ? { projectHistory: strings(p.projectHistory, Number.MAX_SAFE_INTEGER) } : {}),
    }
  }
  const result: PlanetaryState = { planets, ...(stellar ? { stellar } : {}) }
  if (root.runtimeVersion === 1) result.runtimeVersion = 1
  if (finite(root.tickRemainderMs) && root.tickRemainderMs < TICK_MS) result.tickRemainderMs = root.tickRemainderMs
  const humans = record(root.humans)
  if (finite(humans.discoveredAtGameMs) && id(humans.sourcePlanetId) && integer(humans.sleeping)) {
    result.humans = { discoveredAtGameMs: humans.discoveredAtGameMs, sourcePlanetId: humans.sourcePlanetId, sleeping: humans.sleeping }
  }
  if (Array.isArray(root.deliveries)) {
    const deliveries: PlanetDelivery[] = []
    const seqs = new Set<number>(), ships = new Set<string>()
    for (const value of root.deliveries) {
      const delivery = cleanPlanetDelivery(value)
      if (!delivery || seqs.has(delivery.seq) || ships.has(delivery.shipUid)) continue
      seqs.add(delivery.seq); ships.add(delivery.shipUid)
      deliveries.push(delivery)
      if (deliveries.length === 64) break
    }
    result.deliveries = deliveries
  }
  return Object.keys(planets).length || result.stellar || result.runtimeVersion === 1 || result.humans || result.deliveries?.length ? result : undefined
}
