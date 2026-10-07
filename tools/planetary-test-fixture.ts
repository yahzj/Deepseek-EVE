/** 星球原型合成夹具：不读取个人档，不实际建设或扣材料。
 * 版本自检：游戏v0.1.0 · 存档结构v31 · 最后核对2026-10-07 · 最后跑过2026-10-07。
 */
import { discoverPlanet, surveyPlanet, planetSurveyView, planetEnvironmentOf, planetAdjacencyOf, planetConstructionCheck } from '@whale/core'
import type { GameState } from '@whale/core'
import { buildPlanetCatalog, PLANET_DEFS } from '@whale/data'

export function injectPlanetaryTestState(state: GameState): string[] {
  const catalog = buildPlanetCatalog()
  for (const [i, def] of PLANET_DEFS.entries()) {
    if (!state.exploredGalaxies.includes(def.galaxyId)) state.exploredGalaxies.push(def.galaxyId)
    const discovered = discoverPlanet(state, catalog, def.id)
    const surveyed = surveyPlanet(state, catalog, def.id, (i + 1) as 1 | 2 | 3)
    if (!discovered.ok || !surveyed.ok) throw new Error('星球合成夹具初始化失败')
  }
  const large = state.planetary!.planets[PLANET_DEFS[2]!.id]!
  const free = large.cells.filter(c => !c.obstacle)
  for (const [i, id] of ['base', 'water', 'farm'].entries()) {
    free[i]!.building = { id, status: 'ready', powered: i !== 1, staffed: i !== 2 }
  }
  return ['三颗原型：16格初探、25格详探、36格专项；大型星球含正常基地／断电水站／无人农业。', '只供核心规则和存档验证，没有玩家入口，不能在游戏内操作星球。']
}

export function planetaryFixtureReport(state: GameState): unknown[] {
  const catalog = buildPlanetCatalog()
  return Object.values(state.planetary?.planets ?? {}).map(planet => ({
    view: planetSurveyView(planet, catalog),
    environment: planetEnvironmentOf(planet, catalog),
    freeCells: planet.cells.filter(c => !c.obstacle && !c.building).length,
    construction: planet.cells.map(c => ({ index: c.index, check: planetConstructionCheck(planet, c.index, 'base', catalog) })),
    adjacency: planet.cells.filter(c => c.building).map(c => ({ index: c.index, ...planetAdjacencyOf(planet, c.index, catalog) })),
  }))
}
