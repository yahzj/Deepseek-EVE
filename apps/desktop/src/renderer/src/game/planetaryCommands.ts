import {
  discoverPlanet, surveyPlanet, preparePlanetBase, startPlanetBuild, startPlanetClear, startPlanetMove,
  cancelPlanetJob, pausePlanetJob, demolishPlanetBuilding, togglePlanetBuilding, assignPlanetWorker,
  wakePlanetPopulation, sleepPlanetPopulation, startPlanetProject, resolvePlanetEvent, repairPlanetBuilding,
  discoverPlanetHumans, dispatchPlanetDelivery, convertPlanetSupplies, allocatePlanetPower,
  type GameState, type SimContext, type PlanetActionResult,
  beginStellarSearch, pauseStellarSearch, cancelStellarSearch, setStellarAutoSearch, discardStellarSystem,
  startManufacturing,
} from '@whale/core'
import { planetaryEnabled } from './debugFlag'

export function runPlanetaryCommand(state: GameState, ctx: SimContext, action: string, args: unknown[]): PlanetActionResult {
  if (!planetaryEnabled() || !ctx.planetary) return { ok: false, reason: 'entry-blocked' }
  const catalog = ctx.planetary
  if (state.planetary?.runtimeVersion !== undefined && state.planetary.runtimeVersion !== 1) return { ok: false, reason: 'unsupported' }
  if (!state.planetary && !['discover', 'search', 'searchAuto', 'manufactureProbe'].includes(action)) return { ok: false, reason: 'not-discovered' }
  const existed = !!state.planetary
  const startResult = (result: PlanetActionResult): PlanetActionResult => {
    if (!result.ok && !existed) delete state.planetary
    return result
  }
  if (!state.planetary) state.planetary = { planets: {}, runtimeVersion: 1 }
  state.planetary.runtimeVersion = 1
  if (action === 'search') return startResult(beginStellarSearch(state, args[0] as 'random' | 'specified', String(args[1] ?? '')))
  if (action === 'searchPause') return pauseStellarSearch(state, args[0] === true)
  if (action === 'searchCancel') return cancelStellarSearch(state)
  if (action === 'searchAuto') return setStellarAutoSearch(state, args[0] === true)
  if (action === 'discardSystem') return discardStellarSystem(state, String(args[0]))
  if (action === 'manufactureProbe') {
    const result = startManufacturing(state, 'bp-deep-space-probe', 'pilot', ctx)
    return startResult({ ok: result.ok, ...(result.ok ? {} : { reason: result.errorId === 'core.activityGate.002' ? 'ship-busy' : 'materials' }) })
  }
  const id = String(args[0] ?? '')
  if (action === 'discover') return startResult(discoverPlanet(state, catalog, id))
  const p = state.planetary.planets[id]
  if (!p) return { ok: false, reason: 'not-discovered' }
  if (p.systemId && state.planetary.stellar?.systems[p.systemId]?.generationVersion !== 1) return { ok: false, reason: 'unsupported' }
  if (action === 'survey') return surveyPlanet(state, catalog, id, Number(args[1]) as 1 | 2 | 3)
  const index = Number(args[1])
  let result: PlanetActionResult
  switch (action) {
    case 'prepare': result = preparePlanetBase(p, catalog); break
    case 'build':
      { const existed = !!p.colony
        if (!existed) { const prepared = preparePlanetBase(p, catalog); if (!prepared.ok) return prepared }
        result = startPlanetBuild(p, catalog, index, String(args[2]))
        if (!result.ok && !existed) delete p.colony
        break }
    case 'clear': result = startPlanetClear(p, catalog, index); break
    case 'move': result = startPlanetMove(p, catalog, index, Number(args[2])); break
    case 'cancel': result = cancelPlanetJob(p, index); break
    case 'pause': result = pausePlanetJob(p, index, args[2] === true); break
    case 'demolish': result = demolishPlanetBuilding(p, catalog, index); break
    case 'toggle': result = togglePlanetBuilding(p, catalog, index, args[2] === true); break
    case 'staff': result = assignPlanetWorker(p, catalog, index, args[2] === true); break
    case 'wake': result = wakePlanetPopulation(p, catalog, index); break
    case 'sleep': result = sleepPlanetPopulation(p, catalog, index); break
    case 'repair': result = repairPlanetBuilding(p, catalog, index); break
    case 'project': result = startPlanetProject(p, catalog, String(args[1])); break
    case 'event': result = resolvePlanetEvent(p, catalog, String(args[1]) as 'repair' | 'shelter' | 'investigate' | 'dismiss'); break
    case 'resumeEvents': if (p.colony) { p.colony.pauseEvents = false; result = { ok: true } } else result = { ok: false, reason: 'not-ready' }; break
    case 'discoverHumans': result = discoverPlanetHumans(state, ctx, catalog, id); break
    case 'delivery': result = dispatchPlanetDelivery(state, ctx, catalog, id, String(args[1]), args[2] as Record<string, number>, Number(args[3]), Number(args[4])); break
    case 'convert': result = convertPlanetSupplies(state, id, String(args[1]), Number(args[2])); break
    default: return { ok: false, reason: 'unsupported' }
  }
  if (result.ok) allocatePlanetPower(p, catalog)
  return result
}
