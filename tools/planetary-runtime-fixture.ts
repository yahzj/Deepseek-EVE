/** 完整星球验收夹具，纯合成，无个人档；保存结构v31，2026-10-07核对。 */
import { discoverPlanet, surveyPlanet, preparePlanetBase, startPlanetBuild, advancePlanetary, addShipToFleet } from '@whale/core'
import type { GameState } from '@whale/core'
import { buildPlanetCatalog, buildSimContext } from '@whale/data'

export function injectPlanetaryRuntimeTestState(state: GameState): string[] {
  const catalog = buildPlanetCatalog(), ctx = buildSimContext()
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.planetary = { planets: {}, runtimeVersion: 1 }
  for (const def of catalog.planets.values()) {
    discoverPlanet(state, catalog, def.id)
    surveyPlanet(state, catalog, def.id, 3)
    const p = state.planetary.planets[def.id]!
    preparePlanetBase(p, catalog)
    p.colony!.items['min-tritanium'] = 12000
    p.colony!.credits = 300000
    p.colony!.supplies = { medicine: 300, parts: 300, food: 300, water: 300, metal: 300, research: 100 }
    for (const id of ['power', 'base', 'cryo', 'housing', 'nutrition', 'water']) {
      const index = p.cells.findIndex(c => !c.obstacle && !c.building)
      const result = startPlanetBuild(p, catalog, index, id)
      if (!result.ok) throw new Error(`fixture-build:${id}:${result.reason}`)
    }
  }
  advancePlanetary(state, 30 * 60000, catalog)
  state.importantTasks['find-humans'] = { done: false }
  state.modeChosen = true
  state.wallet.isk = 1_000_000
  state.warehouse.items['min-tritanium'] = 20000
  state.warehouse.items['repairkit-civ'] = 1000
  state.warehouse.items['part-coolant'] = 1000
  addShipToFleet(state, 'sh-manatee')
  addShipToFleet(state, 'sh-manatee')
  return ['三颗星球完整生存设施和本地储备、零唤醒人口；等待实际调查发现人类。', '仓库建材与医疗、两艘运货舰；普通入口隐藏，需明确本机实验标记。']
}
