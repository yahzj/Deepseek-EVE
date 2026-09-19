/**
 * 把 data 包全部内容组装成引擎需要的运行上下文（SimContext）。
 * 桌面层只在启动时构建一次。
 */

import {
  DEFAULT_BALANCE,
  FRAGMENT_RECIPES,
  fragmentItemDefOf,
  fragmentItemIdOf,
  rareWreckItemDefOf,
  rareWreckItemIdOf,
  wreckItemDefOf,
  wreckItemIdOf,
  WRECK_GROUPS,
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
import { buildMatterTechCatalog } from './matterTech'
import { buildCommsCatalog } from './messages'
import { buildCommsFactionCatalog } from './commsFactions'
import { buildDialogueCatalog } from './dialogues'
import { GALAXY_EDGES } from './universe'

export function buildSimContext(): SimContext {
  const galaxies = buildGalaxyCatalog()
  const anomalies = buildAnomalyCatalog()
  const items = new Map(buildItemCatalog())
  /**
   * B3：残骸物品 = **按「来源种族 × 来源地区」的 13 组**注册（2026-09-19 船长定「合并」；见
   * `core/wreckGroups.ts` 与 `docs/design/wreck-groups-20260919.md`）——不再是"每卡一种"。
   *
   * - **普通残骸 13 种**（`wreck-a-hi` … `wreck-g-wh`）；
   * - **稀有残骸 13 种**（`wreck-rare-<组 key>`）：注册范围 = **全部 13 组**，理由与旧口径一致——
   *   ① 窝点战利品（`isLairCandidate`，B 族除外）+ ② 洞内墓场/遗迹打捞（`wh-*` 卡）；
   *   ③ **B 族（武装拾荒者）的 `b-hi` 只为旧档兼容保留登记**（它既无窝点、也不在洞里 ⇒ 不再新增产出，
   *      但老档里可能存着 B 族两卡的稀有残骸，迁移后落进 `wreck-rare-b-hi`，必须认得出）。
   *   ⚠ 旧的两个白名单（`RETIRED_LAIR_CARD_IDS` / `WORMHOLE_RARE_WRECK_CARD_IDS`）**已随本次合并退役**：
   *   它们的唯一职责是"给旧档里已获得的稀有残骸保住物品定义"，而迁移（v27→v28）已把旧 id 折进组 id，
   *   组注册对 13 组一视同仁 ⇒ 白名单没有存在意义了（卡表本身仍保留，只作内容记录）。
   */
  for (const g of WRECK_GROUPS) {
    const id = wreckItemIdOf(g.key)
    if (!items.has(id)) items.set(id, wreckItemDefOf(g))
    const rareId = rareWreckItemIdOf(g.key)
    if (!items.has(rareId)) items.set(rareId, rareWreckItemDefOf(g))
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
    commsMessages: buildCommsCatalog(),
    commsFactions: buildCommsFactionCatalog(),
    dialogues: buildDialogueCatalog(),
    matterTech: buildMatterTechCatalog(),
    balance: DEFAULT_BALANCE,
  }
}
