import type { GameState } from './state'
import type { PlanetActionResult } from './planetTypes'
import { hashSeed, nextInt } from './rng'
import { generateStellarSystem, parseStellarSeed, stellarSystemId } from './stellarGeneration'
import type { StellarState } from './stellarTypes'

export const DEEP_SPACE_PROBE_ID = 'deep-space-probe'
export const STELLAR_SEARCH_SKILL = { basicId: 'deep-space-probing', advancedId: 'advanced-deep-space-probing',
  archiveId: 'stellar-archive', basicPerLevel: .06, advancedPerLevel: .04, archivePerLevel: 2 } as const
const level = (state: GameState, id: string): number => {
  const value = state.skills.trained[id] ?? 0
  return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.floor(value))) : 0
}
export function stellarSearchDuration(state: GameState): number {
  return state.debugQuick ? 1000 : Math.round(6 * 3600000 * (1 - STELLAR_SEARCH_SKILL.basicPerLevel * level(state, STELLAR_SEARCH_SKILL.basicId)
    - STELLAR_SEARCH_SKILL.advancedPerLevel * level(state, STELLAR_SEARCH_SKILL.advancedId)))
}
export function stellarCapacity(state: GameState): number { return 5 + STELLAR_SEARCH_SKILL.archivePerLevel * level(state, STELLAR_SEARCH_SKILL.archiveId) }
export function stellarSystemDeveloped(state: GameState, id: string): boolean {
  return state.planetary?.stellar?.systems[id]?.developed === true || Object.values(state.planetary?.planets ?? {}).some(p => p.systemId === id
    && p.cells.some(cell => cell.building?.id === 'base' && cell.building.status === 'ready'))
}
export function stellarCandidateCount(state: GameState): number {
  return Object.keys(state.planetary?.stellar?.systems ?? {}).filter(id => !stellarSystemDeveloped(state, id)).length
}
function ensure(state: GameState): StellarState {
  state.planetary ??= { planets: {}, runtimeVersion: 1 }
  return state.planetary.stellar ??= { systems: {}, searchSeq: 0, autoSearch: false }
}
export function beginStellarSearch(state: GameState, mode: 'random' | 'specified', input?: string): PlanetActionResult {
  if (state.planetary?.runtimeVersion !== 1) return { ok: false, reason: 'entry-blocked' }
  if (mode !== 'random' && mode !== 'specified') return { ok: false, reason: 'invalid-seed' }
  const specified = mode === 'specified' ? parseStellarSeed(input ?? '') : undefined
  if (mode === 'specified' && specified === undefined) return { ok: false, reason: 'invalid-seed' }
  const current = state.planetary.stellar
  if (specified !== undefined && current?.systems[stellarSystemId(specified)]) return { ok: true }
  if (current?.search) return { ok: false, reason: 'search-busy' }
  if (stellarCandidateCount(state) >= stellarCapacity(state)) return { ok: false, reason: 'capacity' }
  if ((state.warehouse.items[DEEP_SPACE_PROBE_ID] ?? 0) < 1) return { ok: false, reason: 'probe-stock' }
  const previousSeq = current?.searchSeq ?? 0
  if (!Number.isSafeInteger(previousSeq) || previousSeq < 0 || previousSeq >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'unsupported' }
  let seq = previousSeq + 1
  let seed = specified
  if (seed === undefined) {
    do {
      seed = nextInt({ seed: hashSeed(`stellar-search:${state.rng.seed}:${seq}`), count: 0 }, 0x100000000)
      if (current?.systems[stellarSystemId(seed)] && seq < Number.MAX_SAFE_INTEGER) seq++
      else break
    } while (seq - previousSeq < 10000)
    if (current?.systems[stellarSystemId(seed)]) return { ok: false, reason: 'capacity' }
  }
  const s = ensure(state)
  state.warehouse.items[DEEP_SPACE_PROBE_ID] -= 1
  s.searchSeq = seq
  s.search = { seq, mode, seed, durationMs: stellarSearchDuration(state), progressMs: 0, paused: false }
  delete s.stoppedReason
  return { ok: true }
}
export function pauseStellarSearch(state: GameState, paused: boolean): PlanetActionResult {
  const search = state.planetary?.stellar?.search
  if (!search) return { ok: false, reason: 'no-search' }
  search.paused = paused
  return { ok: true }
}
export function cancelStellarSearch(state: GameState): PlanetActionResult {
  const s = state.planetary?.stellar
  if (!s?.search) return { ok: false, reason: 'no-search' }
  delete s.search; s.autoSearch = false
  return { ok: true }
}
export function setStellarAutoSearch(state: GameState, on: boolean): PlanetActionResult {
  if (state.planetary?.runtimeVersion !== 1) return { ok: false, reason: 'entry-blocked' }
  ensure(state).autoSearch = on
  return { ok: true }
}
export function discardStellarSystem(state: GameState, id: string): PlanetActionResult {
  const s = state.planetary?.stellar
  if (!s?.systems[id]) return { ok: false, reason: 'unknown-system' }
  if (s.systems[id]!.generationVersion !== 1) return { ok: false, reason: 'unsupported' }
  if (stellarSystemDeveloped(state, id) || state.planetary?.humans?.sourcePlanetId.startsWith(`${id}-`)
    || Object.values(state.planetary?.planets ?? {}).some(p => p.systemId === id && p.colony
      && (p.colony.jobs.length > 0 || p.colony.credits > 0 || p.colony.awake + p.colony.sleeping > 0
        || Object.values(p.colony.items).some(n => n > 0) || Object.values(p.colony.supplies).some(n => (n ?? 0) > 0)))
    || state.planetary?.deliveries?.some(d => state.planetary?.planets[d.planetId]?.systemId === id)) return { ok: false, reason: 'protected' }
  delete s.systems[id]
  for (const [planetId, p] of Object.entries(state.planetary!.planets)) if (p.systemId === id) delete state.planetary!.planets[planetId]
  return { ok: true }
}
export function advanceStellarSearch(state: GameState, deltaMs: number): void {
  const s = state.planetary?.stellar
  if (!s?.search || s.search.paused || state.planetary?.runtimeVersion !== 1 || !Number.isFinite(deltaMs) || deltaMs <= 0) return
  let left = Math.floor(deltaMs)
  while (s.search && left > 0) {
    const search = s.search
    const step = Math.min(left, search.durationMs - search.progressMs)
    search.progressMs += step; left -= step
    if (search.progressMs < search.durationMs) return
    if (stellarCandidateCount(state) >= stellarCapacity(state)) { search.paused = true; s.stoppedReason = 'capacity'; return }
    const generated = generateStellarSystem(search.seed)
    if (!s.systems[generated.system.id]) {
      s.systems[generated.system.id] = generated.system
      for (const p of generated.planets) state.planetary!.planets[p.id] ??= p
    }
    const mode = search.mode
    delete s.search
    if (!s.autoSearch || mode !== 'random') return
    const next = beginStellarSearch(state, 'random')
    if (!next.ok) { s.stoppedReason = next.reason === 'capacity' ? 'capacity' : 'probe-stock'; return }
  }
}
