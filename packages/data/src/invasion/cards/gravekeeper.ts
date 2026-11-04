/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, type AnomalyDef, enemyParameterOf } from '@whale/core'
import invasionFleetsParameters from '../../static/invasionFleets.json'
import { L10N } from '../../l10n/table'
import { FOE_D_INVASION_CRUISER, FOE_D_LONGSHIP, FOE_D_INVASION_BASTION, FOE_D_STASIS, FOE_D_INVASION_OATHKEEPER, FOE_D_THRONE, FOE_D_INVASION_ETERNAL_TOMB } from '../../foe-ships'
import { WEEKEND_INK_HARASS_CARD, WEEKEND_INK_RAID_CARD, WEEKEND_INK_MAIN_CARD, WEEKEND_INK_FLAGSHIP_CARD } from './ink'
import { WEEKEND_CORONA_DRIFT_CARD, WEEKEND_CORONA_SPLIT_CARD, WEEKEND_CORONA_CONVERGE_CARD, WEEKEND_CORONA_NEXUS_CARD } from './corona'

/** D族编成沿用C族的建卡方式，数值仅从静态参数表读取。 */
export function gravekeeperInvasionCard(id: string, nameId: string, roster: readonly FoeShipDef[]): AnomalyDef {
  const read = (key: string) => enemyParameterOf(invasionFleetsParameters, id, key)
  const dmgMix = { plasma: read('dmgMix_plasma'), kinetic: read('dmgMix_kinetic') }
  const ships = roster.map((ship, i) => ({
    ship, count: read(`ships_${i}_count`), wave: read(`ships_${i}_wave`),
    speedMul: read(`ships_${i}_speedMul`), shieldResist: { kinetic: read(`ships_${i}_shieldResist_kinetic`) },
    hpMul: read(`ships_${i}_hpMul`), dmgMul: read(`ships_${i}_dmgMul`), dmgMix,
  }))
  const waveCount = 1 + Math.max(...ships.map(slot => slot.wave))
  return {
    id, foeFamily: 'D', name: L10N[nameId]!.zh, galaxyId: 'galaxy-hub', region: 'inv', wreckTier: 'dire',
    wreckThreat: read('wreckThreat'), threat: read('threat'), foeTargeting: 'random', dmgMix, ships,
    waves: Array.from({ length: waveCount }, (_, i) => ({ units: read(`waves_${i}_units`), hpShare: read(`waves_${i}_hpShare`) })),
    standingReq: read('standingReq'), standingGain: read('standingGain'), rewardIsk: read('rewardIsk'),
    loot: [], combatSeconds: read('combatSeconds'), hidden: true, description: L10N['ano.gravekeeper.005']!.zh,
  }
}

export const WEEKEND_GRAVEKEEPER_DRIFT_CARD = gravekeeperInvasionCard('gravekeeper-drift', 'ano.gravekeeper.001', [
  FOE_D_INVASION_CRUISER, FOE_D_LONGSHIP,
])

export const WEEKEND_GRAVEKEEPER_LINE_CARD = gravekeeperInvasionCard('gravekeeper-line', 'ano.gravekeeper.002', [
  FOE_D_INVASION_CRUISER, FOE_D_INVASION_BASTION, FOE_D_STASIS,
])

export const WEEKEND_GRAVEKEEPER_MAIN_CARD = gravekeeperInvasionCard('gravekeeper-main', 'ano.gravekeeper.003', [
  FOE_D_INVASION_BASTION, FOE_D_INVASION_CRUISER, FOE_D_LONGSHIP, FOE_D_INVASION_OATHKEEPER, FOE_D_STASIS,
])

export const WEEKEND_GRAVEKEEPER_FLAGSHIP_CARD = gravekeeperInvasionCard('gravekeeper-flagship', 'ano.gravekeeper.004', [
  FOE_D_INVASION_CRUISER, FOE_D_THRONE, FOE_D_STASIS, FOE_D_INVASION_OATHKEEPER,
  FOE_D_THRONE, FOE_D_INVASION_ETERNAL_TOMB, FOE_D_INVASION_OATHKEEPER, FOE_D_INVASION_BASTION,
])

/** 周末入侵·独立卡的 id（core 的 `weekendFoeCardOf` 按族路由到它们；**本表是唯一登记处**） */
export const WEEKEND_FOE_CARD_IDS = {
  C_vanguard: 'alien-vanguard', C_escort: 'alien-escort', C_main: 'alien-main', C_flagship: 'alien-broodmother', C_assault: 'alien-vanguard',
  /** H 族（墨潮帮）· 1 骚扰舰队（外围常驻） */
  H_harass: WEEKEND_INK_HARASS_CARD.id,
  /** H 族（墨潮帮）· 2 袭击舰队（2 波） */
  H_raid: WEEKEND_INK_RAID_CARD.id,
  /** H 族（墨潮帮）· 3 主力舰队（2 波） */
  H_main: WEEKEND_INK_MAIN_CARD.id,
  /** H 族（墨潮帮）· 4 旗舰部队（4 波 · 自带波表） */
  H_flagship: WEEKEND_INK_FLAGSHIP_CARD.id,
  /** 兼容旧引用：旗舰 = 旗舰部队 · 普通 = 骚扰舰队 */
  H_assault: WEEKEND_INK_HARASS_CARD.id,
  /** R 族（光环）· 1 游弋集群（外围常驻） */
  R_drift: WEEKEND_CORONA_DRIFT_CARD.id,
  /** R 族（光环）· 2 分光集群（2 波） */
  R_split: WEEKEND_CORONA_SPLIT_CARD.id,
  /** R 族（光环）· 3 汇聚集群（2 波） */
  R_converge: WEEKEND_CORONA_CONVERGE_CARD.id,
  /** R 族（光环）· 4 中枢卫队（4 波 · 自带波表） */
  R_nexus: WEEKEND_CORONA_NEXUS_CARD.id,
  /** 兼容旧引用：旗舰 = 中枢卫队 · 普通 = 游弋集群 */
  R_assault: WEEKEND_CORONA_DRIFT_CARD.id,
  D_drift: WEEKEND_GRAVEKEEPER_DRIFT_CARD.id,
  D_line: WEEKEND_GRAVEKEEPER_LINE_CARD.id,
  D_main: WEEKEND_GRAVEKEEPER_MAIN_CARD.id,
  D_flagship: WEEKEND_GRAVEKEEPER_FLAGSHIP_CARD.id,
  D_assault: WEEKEND_GRAVEKEEPER_DRIFT_CARD.id,
} as const
