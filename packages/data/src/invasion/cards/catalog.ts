/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, type AnomalyDef, type FoeShipSlot, enemyParameterOf } from '@whale/core'
import { FOE_ALIEN_BROODMOTHER, FOE_ALIEN_HIVEBACK, FOE_ALIEN_ACID_BURSTER, FOE_ALIEN_STARCORE_ADULT, FOE_ALIEN_SPORE_HIVE, FOE_ALIEN_BROOD_WORKER, FOE_ALIEN_MAW } from '../../foe-ships'
import invasionFleetsParameters from '../../static/invasionFleets.json'
import { L10N } from '../../l10n/table'
import { WEEKEND_INK_HARASS_CARD, WEEKEND_INK_RAID_CARD, WEEKEND_INK_MAIN_CARD, WEEKEND_INK_FLAGSHIP_CARD } from './ink'
import { WEEKEND_CORONA_DRIFT_CARD, WEEKEND_CORONA_SPLIT_CARD, WEEKEND_CORONA_CONVERGE_CARD, WEEKEND_CORONA_NEXUS_CARD } from './corona'
import { WEEKEND_GRAVEKEEPER_DRIFT_CARD, WEEKEND_GRAVEKEEPER_LINE_CARD, WEEKEND_GRAVEKEEPER_MAIN_CARD, WEEKEND_GRAVEKEEPER_FLAGSHIP_CARD } from './gravekeeper'

/** 周末入侵·独立卡清单（`data/context.ts` 把它们并进 `ANOMALIES_FLAVORED` ⇒ 引擎 `ctx.anomalies` 能取到） */
export function alienInvasionCard(id: string, nameId: string, scale: number, wreckThreat: number, waves: readonly (readonly [FoeShipDef, number][])[]): AnomalyDef {
  const count = waves.reduce((n, wave) => n + wave.reduce((m, [, size]) => m + size, 0), 0)
  const comp = 2 * count / (count + 1)
  const ships: FoeShipSlot[] = waves.flatMap((wave, index) => wave.map(([ship, size]) => ({
    ship, count: size, wave: index, hpMul: ship === FOE_ALIEN_BROODMOTHER ? enemyParameterOf(invasionFleetsParameters, "alien-common", "motherHpMul") : scale,
    dmgMul: scale / comp,
    ...(ship === FOE_ALIEN_HIVEBACK ? { firepowerAnchor: Math.round(enemyParameterOf(invasionFleetsParameters, "alien-common", "hivebackFirepowerAnchor") * scale * size) } : {}),
    ...(ship === FOE_ALIEN_BROODMOTHER ? { firepowerAnchor: Math.round(enemyParameterOf(invasionFleetsParameters, "alien-common", "motherFirepowerAnchor") * scale * size) } : {}),
  })))
  return {
    id, name: L10N[nameId]!.zh, description: L10N['ano.alien.005']!.zh,
    galaxyId: 'galaxy-hub', foeFamily: 'C', region: 'inv', wreckTier: 'dire', wreckThreat,
    threat: ({ 'alien-vanguard': enemyParameterOf(invasionFleetsParameters, "alien-vanguard", "threat"), 'alien-escort': enemyParameterOf(invasionFleetsParameters, "alien-escort", "threat"), 'alien-main': enemyParameterOf(invasionFleetsParameters, "alien-main", "threat"), 'alien-broodmother': enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "threat") } as Record<string, number>)[id]!, threatJudged: wreckThreat,
    ...(id === 'alien-main' ? { rareWreckDrop: 1 } : {}), foeTargeting: 'smallest', foeTargetingChance: enemyParameterOf(invasionFleetsParameters, "alien-common", "foeTargetingChance"),
    dmgMix: { plasma: enemyParameterOf(invasionFleetsParameters, "alien-common", "dmgMix_plasma"), explosive: enemyParameterOf(invasionFleetsParameters, "alien-common", "dmgMix_explosive") }, ships,
    waves: waves.map(wave => ({ units: wave.reduce((n, [, size]) => n + size, 0), hpShare: 1 / waves.length })),
    standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: enemyParameterOf(invasionFleetsParameters, "alien-common", "combatSeconds"), hidden: true,
  }
}

export const WEEKEND_ALIEN_CARDS: readonly AnomalyDef[] = [
  alienInvasionCard('alien-vanguard', 'ano.alien.001', enemyParameterOf(invasionFleetsParameters, "alien-vanguard", "scale"), enemyParameterOf(invasionFleetsParameters, "alien-vanguard", "wreckThreat"), [
    [[FOE_ALIEN_ACID_BURSTER, enemyParameterOf(invasionFleetsParameters, "alien-vanguard", "ships_0_count")]],
    [[FOE_ALIEN_STARCORE_ADULT, enemyParameterOf(invasionFleetsParameters, "alien-vanguard", "ships_1_count")]],
  ]),
  alienInvasionCard('alien-escort', 'ano.alien.002', enemyParameterOf(invasionFleetsParameters, "alien-escort", "scale"), enemyParameterOf(invasionFleetsParameters, "alien-escort", "wreckThreat"), [
    [[FOE_ALIEN_ACID_BURSTER, enemyParameterOf(invasionFleetsParameters, "alien-escort", "ships_0_count")]],
    [[FOE_ALIEN_SPORE_HIVE, enemyParameterOf(invasionFleetsParameters, "alien-escort", "ships_1_count")], [FOE_ALIEN_BROOD_WORKER, enemyParameterOf(invasionFleetsParameters, "alien-escort", "ships_2_count")]],
  ]),
  alienInvasionCard('alien-main', 'ano.alien.003', enemyParameterOf(invasionFleetsParameters, "alien-main", "scale"), enemyParameterOf(invasionFleetsParameters, "alien-main", "wreckThreat"), [
    [[FOE_ALIEN_ACID_BURSTER, enemyParameterOf(invasionFleetsParameters, "alien-main", "ships_0_count")]],
    [[FOE_ALIEN_HIVEBACK, enemyParameterOf(invasionFleetsParameters, "alien-main", "ships_1_count")], [FOE_ALIEN_SPORE_HIVE, enemyParameterOf(invasionFleetsParameters, "alien-main", "ships_2_count")], [FOE_ALIEN_BROOD_WORKER, enemyParameterOf(invasionFleetsParameters, "alien-main", "ships_3_count")]],
  ]),
  alienInvasionCard('alien-broodmother', 'ano.alien.004', enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "scale"), enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "wreckThreat"), [
    [[FOE_ALIEN_ACID_BURSTER, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_0_count")]],
    [[FOE_ALIEN_MAW, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_1_count")], [FOE_ALIEN_STARCORE_ADULT, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_2_count")]],
    [[FOE_ALIEN_HIVEBACK, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_3_count")], [FOE_ALIEN_BROOD_WORKER, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_4_count")]],
    [[FOE_ALIEN_BROODMOTHER, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_5_count")], [FOE_ALIEN_HIVEBACK, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_6_count")], [FOE_ALIEN_BROOD_WORKER, enemyParameterOf(invasionFleetsParameters, "alien-broodmother", "ships_7_count")]],
  ]),
]

export const WEEKEND_FOE_CARDS: readonly AnomalyDef[] = [
  ...WEEKEND_ALIEN_CARDS,
  WEEKEND_INK_HARASS_CARD,
  WEEKEND_INK_RAID_CARD,
  WEEKEND_INK_MAIN_CARD,
  WEEKEND_INK_FLAGSHIP_CARD,
  WEEKEND_CORONA_DRIFT_CARD,
  WEEKEND_CORONA_SPLIT_CARD,
  WEEKEND_CORONA_CONVERGE_CARD,
  WEEKEND_CORONA_NEXUS_CARD,
  WEEKEND_GRAVEKEEPER_DRIFT_CARD,
  WEEKEND_GRAVEKEEPER_LINE_CARD,
  WEEKEND_GRAVEKEEPER_MAIN_CARD,
  WEEKEND_GRAVEKEEPER_FLAGSHIP_CARD,
]
