import type { GameState } from './state'
import type { SimContext } from './types'
import type { PlanetActionResult, PlanetCatalog } from './planetTypes'
import { planetRulesSupported } from './planetRules'
import { tickPlanetColony, allocatePlanetPower, PLANET_TICK_MS, planetColonyView } from './planetColony'
import { advancePlanetConstruction } from './planetConstruction'
import { advancePlanetDeliveries } from './planetLogistics'
import { advancePlanetEvents } from './planetProjects'
import { hashSeed } from './rng'

/** 实验规则只对显式启用的测试世界推进；旧原型档仍冻结。 */
export function advancePlanetary(state: GameState, deltaMs: number, catalog: PlanetCatalog, startGameMs = state.gameMs): void {
  if (state.planetary?.runtimeVersion !== 1 || !Number.isFinite(deltaMs) || deltaMs <= 0) return
  // 以整个系统一条余数对齐物流与工程节点，避免长步先到货后补算之前产出。
  const planets = Object.values(state.planetary.planets).filter(p => p.colony && planetRulesSupported(p, catalog))
  if (planets.length === 0) return
  state.planetary.tickRemainderMs ??= planets[0]!.colony!.tickRemainderMs
  let left = Math.floor(deltaMs)
  while (left > 0) {
    const step = Math.min(left, PLANET_TICK_MS - state.planetary.tickRemainderMs)
    state.planetary.tickRemainderMs += step
    for (const p of planets) p.colony!.tickRemainderMs = state.planetary.tickRemainderMs
    left -= step
    if (state.planetary.tickRemainderMs < PLANET_TICK_MS) continue
    state.planetary.tickRemainderMs = 0
    for (const p of planets) {
      p.colony!.tickRemainderMs = 0
      p.colony!.clockMs += PLANET_TICK_MS
      tickPlanetColony(p, catalog, PLANET_TICK_MS)
      advancePlanetConstruction(p, catalog, PLANET_TICK_MS)
      advancePlanetEvents(p, catalog, PLANET_TICK_MS)
    }
    advancePlanetDeliveries(state, PLANET_TICK_MS)
    reconcilePlanetHome(state, catalog, startGameMs + Math.floor(deltaMs) - left)
  }
}

export function discoverPlanetHumans(state: GameState, ctx: SimContext, catalog: PlanetCatalog, planetId: string): PlanetActionResult {
  const p = state.planetary?.planets[planetId]
  if (state.planetary?.runtimeVersion !== 1 || !p || p.survey !== 3 || !planetRulesSupported(p, catalog)) return { ok: false, reason: 'survey-required' }
  if (state.planetary.humans) return { ok: false, reason: 'already-discovered' }
  const candidates = [...catalog.planets.keys()].sort()
  const source = candidates[hashSeed(`human-source:${state.rng.seed}`) % candidates.length]
  if (p.id !== source && !p.traitIds.includes('underground-ruins') && !p.traitIds.includes('old-dome')) return { ok: false, reason: 'trait-required' }
  if (!state.importantTasks['find-humans'] || ![...ctx.galaxies.keys()].every(id => state.exploredGalaxies.includes(id))) return { ok: false, reason: 'not-ready' }
  state.planetary.humans = { discoveredAtGameMs: state.gameMs, sourcePlanetId: p.id, sleeping: 6 }
  state.importantTasks['find-humans'].done = true
  state.importantTasks['human-home'] ??= { done: false }
  state.commsInstance ??= {}
  state.commsInstance['msg-planet-humans'] = {
    id: 'msg-planet-humans', factionId: 'archive', deptId: 'dept-recall', kind: '剧情', atGameMs: state.gameMs,
    subject: '已发现人类休眠装置', subjectId: 'core.planet.001', paragraphs: ['冷冻休眠装置内仍有人类生命反应。需要为他们寻找适合居住和发展的星球。'], bodyIds: ['core.planet.002'],
  }
  state.commsDelivered ??= {}
  state.commsDelivered['msg-planet-humans'] = state.gameMs
  return { ok: true }
}

export function reconcilePlanetHome(state: GameState, catalog: PlanetCatalog, atGameMs = state.gameMs): void {
  if (state.planetary?.runtimeVersion !== 1 || !state.planetary.humans) return
  const task = state.importantTasks['human-home']
  if (!task || task.done) return
  for (const p of Object.values(state.planetary.planets)) {
    allocatePlanetPower(p, catalog)
    const view = planetColonyView(p, catalog)
    if (view.stage === 'home' && p.colony?.crisis === 'none'
      && (['food', 'water', 'medicine'] as const).every(r => (p.colony!.supplies[r] ?? 0)
        >= Math.max(0, (view.consumption[r] ?? 0) - (view.production[r] ?? 0)) * 24 + 4)) {
      task.done = true
      state.commsInstance ??= {}
      state.commsInstance['msg-planet-home'] = { id: 'msg-planet-home', factionId: 'archive', deptId: 'dept-recall', kind: '剧情', atGameMs,
        subject: '人类新家园', subjectId: 'core.planet.003', paragraphs: ['人类聚居地已具备住房、生命维持与生活储备，环境改造工程已完成。'], bodyIds: ['core.planet.004'] }
      state.commsDelivered ??= {}; state.commsDelivered['msg-planet-home'] = atGameMs
      return
    }
  }
}
