/**
 * 把 data 包全部内容组装成引擎需要的运行上下文（SimContext）。
 * 桌面层只在启动时构建一次。
 */

import { DEFAULT_BALANCE } from '@whale/core'
import type { SimContext } from '@whale/core'
import { buildSkillCatalog } from './skills'
import { buildItemCatalog } from './items'
import { buildBeltCatalog } from './belts'
import { buildShipCatalog } from './ships'
import { buildModuleCatalog } from './modules'
import { buildBlueprintCatalog } from './blueprints'
import { buildShipBlueprintCatalog } from './shipBlueprints'
import { buildGalaxyCatalog } from './universe'
import { buildAnomalyCatalog } from './anomalies'
import { buildTravelEvents } from './travelEvents'
import { buildMarketGoodsCatalog } from './marketCatalog'
import { buildStationCatalog } from './stations'
import { GALAXY_EDGES } from './universe'

export function buildSimContext(): SimContext {
  return {
    skills: buildSkillCatalog(),
    ships: buildShipCatalog(),
    belts: buildBeltCatalog(),
    items: buildItemCatalog(),
    modules: buildModuleCatalog(),
    blueprints: buildBlueprintCatalog(),
    shipBlueprints: buildShipBlueprintCatalog(),
    galaxies: buildGalaxyCatalog(),
    galaxyEdges: GALAXY_EDGES,
    anomalies: buildAnomalyCatalog(),
    travelEvents: buildTravelEvents(),
    stations: buildStationCatalog(),
    marketGoods: buildMarketGoodsCatalog(),
    balance: DEFAULT_BALANCE,
  }
}
