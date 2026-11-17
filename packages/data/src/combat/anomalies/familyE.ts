import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_SHIP_TITAN_HULK, FOE_SHIP_AURO_HULK, FOE_SHIP_CORE_SECTION } from '../../foe-ships'

export const ANOMALY_ENTRY_9: AnomalyDef =
  {
    id: 'ano-titan-wreck',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "dmgMix_kinetic") },
    foeFamily: 'E',
    lairCore: '泰坦残骸',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "lairLevel"),
    name: '泰坦残骸勘探',
    ships: [
      {
        ship: FOE_SHIP_TITAN_HULK,
        count: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_hpMul_input0") / FOE_SHIP_TITAN_HULK.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_dmgMul"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_droneFireShare"),
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_firepowerAnchor"),
      },
    ],
    galaxyId: 'galaxy-auro',
    threat: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'armor',
    standingReq: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "combatSeconds"),
    description: '一具远古泰坦残骸静卧深渊航道，协会长期征集武装护航下的勘探与清剿——击退残骸守备，赏金照发。',
  }

export const ANOMALY_ENTRY_10: AnomalyDef =
  {
    id: 'ano-auro-raiders',
    foeFamily: 'E',
    lairCore: '奥罗武装残骸',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "lairLevel"),
    name: '奥罗武装残骸群',
    ships: [
      {
        ship: FOE_SHIP_AURO_HULK,
        count: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_hpMul_input0") * (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_hpMul_input1") / enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_hpMul_input2"))) / FOE_SHIP_AURO_HULK.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_dmgMul"),
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_firepowerAnchor"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_droneFireShare"),
      },
      {
        ship: FOE_SHIP_AURO_HULK,
        count: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_count"),
        escort: true,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_hpMul_input0") * (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_hpMul_input1") / enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_hpMul_input2"))) / FOE_SHIP_AURO_HULK.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_dmgMul"),
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_firepowerAnchor"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_droneFireShare"),
      },
    ],
    galaxyId: 'galaxy-auro',
    threat: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "threatJudged"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'armor',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "dmgMix_kinetic") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "combatSeconds"),
    description: '奥罗荒环的武装残骸会被风暴反复激活，协会的猎杀令因此常年有效：按次结算，可反复接取。',
  }

export const ANOMALY_ENTRY_11: AnomalyDef =
  {
    id: 'ano-core-section',
    foeFamily: 'E',
    lairCore: '巨构核心',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-core-section", "lairLevel"),
    name: '巨构核心勘探令',
    ships: [
      {
        ship: FOE_SHIP_CORE_SECTION,
        count: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_hpMul_input0") / FOE_SHIP_CORE_SECTION.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_dmgMul"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_droneFireShare"),
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_firepowerAnchor"),
      },
    ],
    galaxyId: 'galaxy-auro',
    threat: enemyParameterOf(bountiesParameters, "ano-core-section", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-core-section", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'armor',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-core-section", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-core-section", "dmgMix_kinetic") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-core-section", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-core-section", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-core-section", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-core-section", "combatSeconds"),
    description:
      '深渊航道最深处立着一具几乎完好的巨构——残存的自动程序仍在运转，警戒机群仍在巡逻。协会为能拆开它的人开出了长期悬赏。',
  }
