import { type FoeShipDef, type AnomalyDef, enemyParameterOf } from '@whale/core'
import invasionFleetsParameters from '../../static/invasionFleets.json'
import { L10N } from '../../l10n/table'
import { FOE_D_INVASION_CRUISER, FOE_D_LONGSHIP, FOE_D_INVASION_BASTION, FOE_D_STASIS, FOE_D_INVASION_OATHKEEPER, FOE_D_THRONE, FOE_D_INVASION_ETERNAL_TOMB } from '../../foe-ships'
import { WEEKEND_INK_HARASS_CARD, WEEKEND_INK_RAID_CARD, WEEKEND_INK_MAIN_CARD, WEEKEND_INK_FLAGSHIP_CARD } from './ink'
import { WEEKEND_CORONA_DRIFT_CARD, WEEKEND_CORONA_SPLIT_CARD, WEEKEND_CORONA_CONVERGE_CARD, WEEKEND_CORONA_NEXUS_CARD } from './corona'

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

export const WEEKEND_FOE_CARD_IDS = {
  C_vanguard: 'alien-vanguard', C_escort: 'alien-escort', C_main: 'alien-main', C_flagship: 'alien-broodmother', C_assault: 'alien-vanguard',
  H_harass: WEEKEND_INK_HARASS_CARD.id,
  H_raid: WEEKEND_INK_RAID_CARD.id,
  H_main: WEEKEND_INK_MAIN_CARD.id,
  H_flagship: WEEKEND_INK_FLAGSHIP_CARD.id,
  H_assault: WEEKEND_INK_HARASS_CARD.id,
  R_drift: WEEKEND_CORONA_DRIFT_CARD.id,
  R_split: WEEKEND_CORONA_SPLIT_CARD.id,
  R_converge: WEEKEND_CORONA_CONVERGE_CARD.id,
  R_nexus: WEEKEND_CORONA_NEXUS_CARD.id,
  R_assault: WEEKEND_CORONA_DRIFT_CARD.id,
  D_drift: WEEKEND_GRAVEKEEPER_DRIFT_CARD.id,
  D_line: WEEKEND_GRAVEKEEPER_LINE_CARD.id,
  D_main: WEEKEND_GRAVEKEEPER_MAIN_CARD.id,
  D_flagship: WEEKEND_GRAVEKEEPER_FLAGSHIP_CARD.id,
  D_assault: WEEKEND_GRAVEKEEPER_DRIFT_CARD.id,
} as const
