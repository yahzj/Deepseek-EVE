import type { PlanetActionResult, PlanetBill, PlanetCatalog, PlanetJob, PlanetState } from './planetTypes'
import { planetConstructionCheck, planetClearanceCheck } from './planetGrid'
import { planetEnvironmentOf, planetRulesSupported } from './planetRules'
import { allocatePlanetPower, createPlanetColony } from './planetColony'
import { planetProjectCheck, completePlanetProject } from './planetProjects'

export function planetBillOf(planet: PlanetState, catalog: PlanetCatalog, bill: PlanetBill): PlanetBill {
  const multiplier = planetEnvironmentOf(planet, catalog)?.constructionMul ?? Infinity
  return { items: Object.fromEntries(Object.entries(bill.items).map(([id, count]) => [id, Math.ceil(count * multiplier)])),
    credits: Math.ceil(bill.credits * multiplier), durationMs: bill.durationMs }
}
function enqueue(planet: PlanetState, bill: PlanetBill, job: Omit<PlanetJob, 'seq' | 'remainingMs' | 'totalMs' | 'spentItems' | 'spentCredits' | 'paused'>): PlanetActionResult {
  const c = planet.colony
  if (!c || c.jobs.length >= 12) return { ok: false, reason: 'queue-full' }
  if (!Number.isFinite(bill.credits) || c.credits < bill.credits || Object.entries(bill.items).some(([id, count]) => (c.items[id] ?? 0) < count)) return { ok: false, reason: 'materials' }
  for (const [id, count] of Object.entries(bill.items)) c.items[id] = (c.items[id] ?? 0) - count
  c.credits -= bill.credits
  c.jobs.push({ ...job, seq: ++c.jobSeq, remainingMs: bill.durationMs, totalMs: bill.durationMs,
    spentItems: { ...bill.items }, spentCredits: bill.credits, paused: false })
  return { ok: true }
}
function reserved(planet: PlanetState, index: number): boolean {
  return planet.colony?.jobs.some(j => j.cellIndex === index || j.targetIndex === index) ?? false
}
export function startPlanetBuild(planet: PlanetState, catalog: PlanetCatalog, index: number, buildingId: string): PlanetActionResult {
  const check = planetConstructionCheck(planet, index, buildingId, catalog)
  if (!check.ok) return check
  if (!planet.colony || reserved(planet, index)) return { ok: false, reason: 'not-ready' }
  const op = catalog.operations?.get(buildingId)
  if (!op) return { ok: false, reason: 'unsupported' }
  const result = enqueue(planet, planetBillOf(planet, catalog, op.bill), { kind: 'build', cellIndex: index, buildingId })
  if (result.ok) planet.cells[index]!.building = { id: buildingId, status: 'construction', powered: false, staffed: false, condition: 1, enabled: true }
  return result
}
export function preparePlanetBase(planet: PlanetState, catalog: PlanetCatalog): PlanetActionResult {
  if (!planetRulesSupported(planet, catalog) || planet.survey < 2) return { ok: false, reason: 'survey-required' }
  if (!planet.colony) planet.colony = createPlanetColony()
  return { ok: true }
}
export function startPlanetClear(planet: PlanetState, catalog: PlanetCatalog, index: number): PlanetActionResult {
  if (!planetClearanceCheck(planet, index, catalog).ok || reserved(planet, index)) return { ok: false, reason: 'not-ready' }
  return enqueue(planet, planetBillOf(planet, catalog, { items: { 'min-tritanium': 30 }, credits: 1000, durationMs: 120_000 }), { kind: 'clear', cellIndex: index })
}
export function startPlanetMove(planet: PlanetState, catalog: PlanetCatalog, index: number, targetIndex: number): PlanetActionResult {
  const b = planet.cells[index]?.building
  if (!Number.isSafeInteger(index) || !b || b.status !== 'ready' || reserved(planet, index) || reserved(planet, targetIndex)) return { ok: false, reason: 'not-ready' }
  const target = planetConstructionCheck({ ...planet, cells: planet.cells.map(c => c.index === index ? { ...c, building: undefined } : c) }, targetIndex, b.id, catalog)
  if (!target.ok) return target
  if (b.id === 'base' || b.id === 'cryo' || b.id === 'housing') return { ok: false, reason: 'protected' }
  const result = enqueue(planet, planetBillOf(planet, catalog, { items: { 'min-tritanium': 20 }, credits: 500, durationMs: 60_000 }), { kind: 'move', cellIndex: index, targetIndex, buildingId: b.id })
  if (result.ok) b.enabled = false
  return result
}
export function cancelPlanetJob(planet: PlanetState, seq: number): PlanetActionResult {
  const c = planet.colony, job = c?.jobs.find(j => j.seq === seq)
  if (!c || !job) return { ok: false, reason: 'not-ready' }
  const refund = Math.max(0, Math.min(1, job.remainingMs / job.totalMs))
  for (const [id, count] of Object.entries(job.spentItems)) c.items[id] = (c.items[id] ?? 0) + Math.floor(count * refund)
  c.credits += Math.floor(job.spentCredits * refund)
  if (job.spentResearch) c.supplies.research = (c.supplies.research ?? 0) + job.spentResearch * refund
  if (job.kind === 'build' && job.cellIndex !== undefined) delete planet.cells[job.cellIndex]?.building
  if (job.kind === 'move' && job.cellIndex !== undefined && planet.cells[job.cellIndex]?.building) planet.cells[job.cellIndex]!.building!.enabled = true
  c.jobs = c.jobs.filter(j => j.seq !== seq)
  return { ok: true }
}
export function pausePlanetJob(planet: PlanetState, seq: number, paused: boolean): PlanetActionResult {
  const job = planet.colony?.jobs.find(j => j.seq === seq)
  if (!job) return { ok: false, reason: 'not-ready' }
  job.paused = paused
  return { ok: true }
}
export function demolishPlanetBuilding(planet: PlanetState, catalog: PlanetCatalog, index: number): PlanetActionResult {
  const b = planet.cells[index]?.building
  if (!b || b.status !== 'ready' || reserved(planet, index)) return { ok: false, reason: 'not-ready' }
  if (['base', 'cryo', 'housing'].includes(b.id)) return { ok: false, reason: 'protected' }
  delete planet.cells[index]!.building
  allocatePlanetPower(planet, catalog)
  return { ok: true }
}
export function togglePlanetBuilding(planet: PlanetState, catalog: PlanetCatalog, index: number, enabled: boolean): PlanetActionResult {
  const b = planet.cells[index]?.building
  if (!b || b.status !== 'ready' || reserved(planet, index)) return { ok: false, reason: 'not-ready' }
  b.enabled = enabled
  allocatePlanetPower(planet, catalog)
  return { ok: true }
}
export function startPlanetProject(planet: PlanetState, catalog: PlanetCatalog, projectId: string): PlanetActionResult {
  const check = planetProjectCheck(planet, projectId, catalog)
  if (!check.ok) return check
  if (planet.colony!.jobs.some(j => j.projectId === projectId)) return { ok: false, reason: 'occupied' }
  const project = catalog.projects!.get(projectId)!
  const result = enqueue(planet, planetBillOf(planet, catalog, project.bill), { kind: 'project', projectId })
  if (result.ok) {
    planet.colony!.supplies.research = (planet.colony!.supplies.research ?? 0) - project.requiredResearch
    planet.colony!.jobs[planet.colony!.jobs.length - 1]!.spentResearch = project.requiredResearch
  }
  return result
}
export function advancePlanetConstruction(planet: PlanetState, catalog: PlanetCatalog, deltaMs: number): void {
  const c = planet.colony, job = c?.jobs[0]
  if (!c || !job || job.paused) return
  if (job.kind === 'project' && !planet.cells.some(cell => cell.building?.id === 'power' && cell.building.powered && cell.building.enabled !== false)) return
  job.remainingMs = Math.max(0, job.remainingMs - deltaMs)
  if (job.remainingMs > 0) return
  if (job.kind === 'build' && job.cellIndex !== undefined) {
    const b = planet.cells[job.cellIndex]?.building
    if (b && b.id === job.buildingId) b.status = 'ready'
  } else if (job.kind === 'clear' && job.cellIndex !== undefined) delete planet.cells[job.cellIndex]?.obstacle
  else if (job.kind === 'move' && job.cellIndex !== undefined && job.targetIndex !== undefined) {
    const b = planet.cells[job.cellIndex]?.building
    if (b && !planet.cells[job.targetIndex]?.building && !planet.cells[job.targetIndex]?.obstacle) {
      planet.cells[job.targetIndex]!.building = { ...b, enabled: true }
      delete planet.cells[job.cellIndex]!.building
    }
  } else if (job.kind === 'project' && job.projectId) {
    const result = completePlanetProject(planet, job.projectId, catalog)
    if (!result.ok) { job.paused = true; return }
  }
  c.jobs.shift()
  allocatePlanetPower(planet, catalog)
}
