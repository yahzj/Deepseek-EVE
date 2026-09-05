/**
 * 把 data 包全部内容组装成引擎需要的运行上下文（SimContext）。
 * 桌面层只在启动时构建一次。
 */

import {
  DEFAULT_BALANCE,
  FRAGMENT_RECIPES,
  fragmentItemDefOf,
  fragmentItemIdOf,
  wreckItemDefOf,
  wreckItemIdOf,
} from '@whale/core'
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
  const galaxies = buildGalaxyCatalog()
  const anomalies = buildAnomalyCatalog()
  const items = new Map(buildItemCatalog())
  // B3：按敌群自动补残骸物品（打捞回收原料；基础体积默认随威胁派生，可覆盖）
  for (const a of anomalies.values()) {
    const id = wreckItemIdOf(a.id)
    if (items.has(id)) continue
    items.set(id, wreckItemDefOf(a.id, a.name, a.threat))
  }
  const modules = buildModuleCatalog()
  // B3：碎片物品按"有逆向配方的装备"生成
  for (const moduleId of Object.keys(FRAGMENT_RECIPES)) {
    const mod = modules.get(moduleId)
    if (!mod) continue
    const id = fragmentItemIdOf(moduleId)
    if (!items.has(id)) items.set(id, fragmentItemDefOf(moduleId, mod.name))
  }
  return {
    skills: buildSkillCatalog(),
    ships: buildShipCatalog(),
    belts: buildBeltCatalog(),
    items,
    modules,
    blueprints: buildBlueprintCatalog(),
    shipBlueprints: buildShipBlueprintCatalog(),
    galaxies,
    galaxyEdges: GALAXY_EDGES,
    anomalies,
    travelEvents: buildTravelEvents(),
    stations: buildStationCatalog(),
    marketGoods: buildMarketGoodsCatalog(),
    balance: DEFAULT_BALANCE,
  }
}
