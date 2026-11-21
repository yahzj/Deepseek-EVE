import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import { FOE_SCAV_ARMED, FOE_SCAV_SKIFF } from '../../foe-ships'
import bountiesParameters from '../../static/bounties.json'

export const ANOMALY_ENTRY_4: AnomalyDef =
  {
    id: 'ano-abandoned-platform',
    foeFamily: 'B',
    name: '占港武装通缉',
    ships: [
      {
        ship: FOE_SCAV_ARMED,
        hitRate: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "ships_0_hitRate"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "ships_0_hpMul_input0") / enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "ships_0_hpMul_input1"),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "ships_0_dmgMul_input1"),
      },
    ],
    galaxyId: 'galaxy-dust',
    threat: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'balanced',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "dmgMix_explosive") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "combatSeconds"),
    description: '长期通缉：武装拾荒者盘踞废弃采掘平台多年，协会悬赏清除其火力点。',
  }

export const ANOMALY_ENTRY_19: AnomalyDef =
  {
    id: 'ano-harbor-escort',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "dmgMix_explosive") },
    foeFamily: 'B',
    name: '新港商路护航令',
    ships: [
      {
        ship: FOE_SCAV_SKIFF,
        hpMul: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_hpMul_input0") / enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_hpMul_input1"),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMul_input1"),
        split: foeLayerSplit('armor'),
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMix_explosive") },
      },
    ],
    galaxyId: 'galaxy-harbor',
    threat: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'armor',
    standingReq: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "combatSeconds"),
    description: '新港走廊的商路劫案从未断过。协会长期悬赏护航协防：击退小型劫掠艇按次结算——新手练兵的第一张常驻单。',
  }
