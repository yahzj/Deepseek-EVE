
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
  enemyFormationCard,
  rangeEwFlagshipCard,
  ENEMY_FORMATION_PLANS,
} from '@whale/core'
import type { SimContext } from '@whale/core'
import { buildSkillCatalog } from './skills/catalog'
import { buildItemCatalog } from './items'
import { buildBeltCatalog } from './belts'
import { buildShipCatalog } from './ships'
import { buildModuleCatalog } from './modules'
import { buildBlueprintCatalog } from './blueprints'
import { buildShipBlueprintCatalog } from './shipBlueprints'
import { buildGalaxyCatalog } from './universe'
import { buildAnomalyCatalog } from './anomalies'
import { buildTravelEvents } from './travelEvents'
import { buildMarketGoodsCatalog } from './market/catalog'
import { buildStationCatalog } from './stations'
import { buildLabRecipeCatalog } from './labRecipes'
import { buildMatterTechCatalog } from './matterTech'
import { ACHIEVEMENTS } from './achievements/catalog'
import { buildCommsCatalog } from './messages'
import { buildCommsFactionCatalog } from './commsFactions'
import { buildDialogueCatalog } from './dialogues'
import { GALAXY_EDGES } from './universe'
import { EN_FRAGMENT, localizeCtx, type Locale } from './l10n'
import { FOE_SHIPS } from './foe-ships'
import { buildPlanetCatalog } from './planets'

export function buildSimContext(locale: Locale = 'zh'): SimContext {
  const galaxies = buildGalaxyCatalog()
  const anomalies = buildAnomalyCatalog()
  const items = new Map(buildItemCatalog())
  for (const g of WRECK_GROUPS) {
    const id = wreckItemIdOf(g.key)
    if (!items.has(id)) items.set(id, wreckItemDefOf(g))
    const rareId = rareWreckItemIdOf(g.key)
    if (!items.has(rareId)) items.set(rareId, rareWreckItemDefOf(g))
  }
  const modules = buildModuleCatalog()
  const base = localizeCtx(
    {
      planetary: buildPlanetCatalog(),
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
      foeShips: new Map(FOE_SHIPS.map(ship => [ship.id, ship])),
      travelEvents: buildTravelEvents(),
      stations: buildStationCatalog(),
      labRecipes: buildLabRecipeCatalog(),
      marketGoods: buildMarketGoodsCatalog(),
      commsMessages: buildCommsCatalog(),
      commsFactions: buildCommsFactionCatalog(),
      dialogues: buildDialogueCatalog(),
      matterTech: buildMatterTechCatalog(),
      achievements: ACHIEVEMENTS,
      balance: DEFAULT_BALANCE,
    },
    locale,
  )
  const formationAnomalies = new Map(base.anomalies)
  for (const [id, card] of base.anomalies) {
    if (!id.startsWith('wh-')) formationAnomalies.set(id, rangeEwFlagshipCard(enemyFormationCard(card, base.balance.battle, ENEMY_FORMATION_PLANS[id] ?? {}, base.foeShips), base.balance.battle))
  }
  const itemsFinal = new Map(base.items)
  let addedFragment = false
  for (const moduleId of Object.keys(FRAGMENT_RECIPES)) {
    const mod = base.modules.get(moduleId)
    if (!mod) continue
    const id = fragmentItemIdOf(moduleId)
    if (itemsFinal.has(id)) continue
    itemsFinal.set(id, fragmentItemDefOf(moduleId, mod.name, locale === 'en' ? EN_FRAGMENT : undefined))
    addedFragment = true
  }
  return { ...base, anomalies: formationAnomalies, ...(addedFragment ? { items: itemsFinal } : {}) }
}

