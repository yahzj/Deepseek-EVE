import type { PlanetActionResult, PlanetCatalog, PlanetColonyState, PlanetEvent, PlanetProjectDef, PlanetState } from './planetTypes'
import { planetRulesSupported, planetTraitsCompatible } from './planetRules'
import { planetSurveyView } from './planetSurvey'
import { hashSeed, nextInt } from './rng'

const EVENT_MIN_MS = 4 * 60 * 60 * 1000
const EVENT_MAX_MS = 8 * 60 * 60 * 1000
const EVENT_KINDS: readonly PlanetEvent['kind'][] = ['equipment', 'weather', 'resources', 'health', 'ruins']
const EVENT_CHOICES: Record<PlanetEvent['kind'], readonly PlanetEventChoice[]> = {
  equipment: ['repair', 'shelter', 'dismiss'],
  weather: ['shelter', 'investigate', 'dismiss'],
  resources: ['investigate', 'dismiss'],
  health: ['shelter', 'investigate', 'dismiss'],
  ruins: ['investigate', 'dismiss'],
}
type PlanetEventChoice = 'repair' | 'shelter' | 'investigate' | 'dismiss'

function projectTraitIds(planet: PlanetState, project: PlanetProjectDef): string[] {
  const ids = planet.traitIds.filter(id => id !== project.removeTraitId)
  if (project.fromTraitId) ids[ids.indexOf(project.fromTraitId)] = project.toTraitId!
  else if (project.toTraitId) ids.push(project.toTraitId)
  return ids
}

function checkProject(planet: PlanetState, projectId: string, catalog: PlanetCatalog, checkResearch: boolean): PlanetActionResult {
  if (!planetRulesSupported(planet, catalog)) return { ok: false, reason: 'unsupported' }
  if (planet.survey < 2) return { ok: false, reason: 'survey-required' }
  if (!planet.colony || planet.colony.runtimeVersion !== 1) return { ok: false, reason: 'colony-required' }
  const project = catalog.projects?.get(projectId)
  if (!project) return { ok: false, reason: 'unknown-project' }
  if (planet.projectHistory?.includes(projectId)) return { ok: false, reason: 'already-completed' }
  if (project.id !== projectId || !Number.isFinite(project.requiredResearch) || project.requiredResearch < 0
    || (!project.toTraitId && !project.removeTraitId) || (project.fromTraitId && !project.toTraitId)
    || project.fromTraitId === project.toTraitId && project.fromTraitId !== undefined
    || project.fromTraitId === project.removeTraitId && project.fromTraitId !== undefined) return { ok: false, reason: 'invalid-project' }
  for (const id of [project.fromTraitId, project.toTraitId, project.removeTraitId]) {
    if (id !== undefined && !catalog.traits.has(id)) return { ok: false, reason: 'unknown-trait' }
  }
  const revealed = planetSurveyView(planet, catalog)!.traitIds
  if ([project.fromTraitId, project.removeTraitId].some(id => id !== undefined && !revealed.includes(id))) return { ok: false, reason: 'trait-required' }
  const research = planet.colony.supplies.research ?? 0
  if (checkResearch && (!Number.isFinite(research) || research < project.requiredResearch)) return { ok: false, reason: 'research-required' }
  const traitIds = projectTraitIds(planet, project)
  if (!traitIds.length) return { ok: false, reason: 'empty-traits' }
  const selected = traitIds.map(id => catalog.traits.get(id)!)
  if (selected.some((trait, index) => !planetTraitsCompatible(trait, selected.filter((_, i) => i !== index)))) return { ok: false, reason: 'trait-conflict' }
  if (planet.cells.some(cell => cell.deposit && !traitIds.includes(cell.deposit.sourceTraitId))) return { ok: false, reason: 'resource-preservation' }
  return { ok: true }
}

export function planetProjectCheck(planet: PlanetState, projectId: string, catalog: PlanetCatalog): PlanetActionResult {
  return checkProject(planet, projectId, catalog, true)
}

export function completePlanetProject(planet: PlanetState, projectId: string, catalog: PlanetCatalog): PlanetActionResult {
  // 施工在开工时扣取研究与材料；完成只复核仍有效的特性条件。
  const check = checkProject(planet, projectId, catalog, false)
  if (!check.ok) return check
  const project = catalog.projects!.get(projectId)!
  const traitIds = projectTraitIds(planet, project)
  planet.originalTraitIds ??= [...planet.traitIds]
  if (!traitIds.includes(planet.hiddenTraitId)) {
    planet.hiddenTraitId = project.fromTraitId === planet.hiddenTraitId && project.toTraitId && traitIds.includes(project.toTraitId)
      ? project.toTraitId : traitIds[0]!
  }
  planet.traitIds = traitIds
  planet.projectHistory ??= []
  planet.projectHistory.push(projectId)
  return { ok: true }
}

function eventClockSupported(planet: PlanetState, colony: PlanetColonyState): boolean {
  return colony.runtimeVersion === 1 && Number.isSafeInteger(planet.seed) && planet.seed >= 0 && planet.seed <= 0xffffffff
    && Number.isFinite(colony.clockMs) && colony.clockMs >= 0
    && Number.isFinite(colony.nextEventMs) && colony.nextEventMs >= 0
    && Number.isSafeInteger(colony.eventRngCount) && colony.eventRngCount >= 0 && colony.eventRngCount < Number.MAX_SAFE_INTEGER - 3
    && Number.isSafeInteger(colony.eventSeq) && colony.eventSeq >= 0 && colony.eventSeq < Number.MAX_SAFE_INTEGER
}

export function advancePlanetEvents(planet: PlanetState, catalog: PlanetCatalog, deltaMs: number): void {
  const colony = planet.colony
  if (!colony || !Number.isFinite(deltaMs) || deltaMs < 0 || planet.survey < 2
    || !planetRulesSupported(planet, catalog) || !eventClockSupported(planet, colony)
    || colony.pauseEvents || colony.event) return
  const rng = { seed: hashSeed(`planet-events:${planet.generationVersion}:${planet.seed}:${planet.id}`), count: colony.eventRngCount }
  const interval = (): number => EVENT_MIN_MS + nextInt(rng, EVENT_MAX_MS - EVENT_MIN_MS + 1)
  // clockMs 由主推进器更新；首次排期从本段起点算，不再累计一次 deltaMs。
  if (colony.nextEventMs === 0) colony.nextEventMs = Math.max(0, colony.clockMs - deltaMs) + interval()
  if (colony.clockMs >= colony.nextEventMs) {
    const atMs = colony.nextEventMs
    const kind = EVENT_KINDS[nextInt(rng, EVENT_KINDS.length)]!
    const candidates = planet.cells.filter(cell => kind === 'equipment'
      ? cell.building && cell.building.status !== 'construction'
      : kind === 'ruins' && cell.deposit?.resource === 'research')
    const cellIndex = candidates.length ? candidates[nextInt(rng, candidates.length)]!.index : undefined
    colony.event = { seq: ++colony.eventSeq, kind, atMs, ...(cellIndex !== undefined ? { cellIndex } : {}) }
    colony.nextEventMs = atMs + interval()
  }
  colony.eventRngCount = rng.count
}

export function resolvePlanetEvent(planet: PlanetState, catalog: PlanetCatalog, choice: PlanetEventChoice): PlanetActionResult {
  if (!planetRulesSupported(planet, catalog)) return { ok: false, reason: 'unsupported' }
  if (planet.survey < 2) return { ok: false, reason: 'survey-required' }
  const colony = planet.colony
  if (!colony || !eventClockSupported(planet, colony)) return { ok: false, reason: 'colony-required' }
  const event = colony.event
  if (!event) return { ok: false, reason: 'no-event' }
  if (!EVENT_KINDS.includes(event.kind) || !Number.isSafeInteger(event.seq) || event.seq < 1 || event.seq !== colony.eventSeq
    || !Number.isFinite(event.atMs) || event.atMs < 0 || event.atMs > colony.clockMs
    || (event.cellIndex !== undefined && (!Number.isSafeInteger(event.cellIndex) || !planet.cells[event.cellIndex]))) return { ok: false, reason: 'unsupported' }
  if (!EVENT_CHOICES[event.kind].includes(choice)) return { ok: false, reason: 'invalid-choice' }
  if (choice === 'repair') {
    const parts = colony.supplies.parts ?? 0
    if (!Number.isFinite(parts) || parts < 10) return { ok: false, reason: 'parts-required' }
    colony.supplies.parts = parts - 10
  } else if (choice === 'investigate') {
    const research = colony.supplies.research ?? 0
    const reward = event.kind === 'resources' || event.kind === 'ruins'
    if (!Number.isFinite(research) || research < 0 || !Number.isFinite(research + 5)
      || !reward && research < 5) return { ok: false, reason: 'research-required' }
    colony.supplies.research = research + (reward ? 5 : -5)
  } else if (choice === 'shelter') {
    colony.pauseEvents = true
  }
  // 待处理期间不积压连发事件，保留抽定间隔，从本次处理完成时重新计时。
  const interval = Math.max(EVENT_MIN_MS, Math.min(EVENT_MAX_MS, colony.nextEventMs - event.atMs))
  colony.nextEventMs = colony.clockMs + interval
  delete colony.event
  return { ok: true }
}
