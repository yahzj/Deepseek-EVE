import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_ALIEN_STARCORE, FOE_ALIEN_STARCORE_ADULT, FOE_ALIEN_RIFT, FOE_ALIEN_MAW } from '../../foe-ships'
import { COMP_MUL, MAW_TOTAL_HP, MAW_MINION_SHARE, MAW_TOTAL_DMG, MAW_BOSS_SHARE } from './constants'

export const ANOMALY_ENTRY_8: AnomalyDef =
  {
    id: 'ano-abyss-guard',
    foeFamily: 'C',
    lairCore: '深渊潜伏群',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "lairLevel"),
    name: '深渊之门卫队',
    ships: [
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_hpMul_input1") * FOE_ALIEN_STARCORE.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_dmgMul_input1"))),
        split: foeLayerSplit('shield'),
        hitRate: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_hitRate"),
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_dmgMix_plasma") },
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_rangeMaxM"),
      },
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_hpMul_input1") * FOE_ALIEN_STARCORE.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_dmgMul_input1"))),
        split: foeLayerSplit('shield'),
        hitRate: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_hitRate"),
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_dmgMix_plasma") },
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_rangeMaxM"),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_1_hpShare") },
    ],
    galaxyId: 'galaxy-abyss',
    threat: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "threatJudged"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "wreckThreat"),
    tactic: 'brawl',
    defProfile: 'shield',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "dmgMix_plasma") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "combatSeconds"),
    description: '深渊之门常年有人值守，也常年需要民间火力分担防务。协会常驻悬赏：按次结算，声望仅首胜授予。',
  }

export const ANOMALY_ENTRY_12: AnomalyDef =
  {
    id: 'ano-starcore-boss',
    foeFamily: 'C',
    lairCore: '星髓虫群',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "lairLevel"),
    name: '星髓虫群',
    ships: [
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_wave"),
        hpMul:
          enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_hpMul_input1") * FOE_ALIEN_STARCORE.hp + enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_hpMul_input2") * FOE_ALIEN_STARCORE_ADULT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_dmgMul_input1"))),
      },
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_wave"),
        hpMul:
          enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_hpMul_input1") * FOE_ALIEN_STARCORE.hp + enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_hpMul_input2") * FOE_ALIEN_STARCORE_ADULT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_dmgMul_input1"))),
      },
      {
        ship: FOE_ALIEN_STARCORE_ADULT,
        count: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_wave"),
        hpMul:
          enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_hpMul_input1") * FOE_ALIEN_STARCORE.hp + enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_hpMul_input2") * FOE_ALIEN_STARCORE_ADULT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_dmgMul_input0") / (FOE_ALIEN_STARCORE_ADULT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_dmgMul_input1"))),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_1_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_2_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_2_hpShare") },
    ],
    galaxyId: 'galaxy-starcore',
    threat: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, 'ano-starcore-boss', 'threatJudged'),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "wreckThreat"),
    tactic: 'brawl',
    defProfile: 'armor',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "dmgMix_plasma"), explosive: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "dmgMix_explosive") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "combatSeconds"),
    description: '星髓迷宫深处有东西在筑巢。协会将它列入最高级长期悬赏：进去的人要自己数着命回来。',
  }

export const ANOMALY_ENTRY_16: AnomalyDef =
  {
    id: 'ano-maw-hunt',
    foeFamily: 'C',
    lairCore: '噬口猎食群',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "lairLevel"),
    name: '噬口猎杀令',
    ships: [
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_MINION_SHARE) / FOE_ALIEN_RIFT.hp,
        dmgMul:
          (MAW_TOTAL_DMG * MAW_MINION_SHARE) /
          (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_dmgMul_input0"))),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_rangeMaxM"),
      },
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_MINION_SHARE) / FOE_ALIEN_RIFT.hp,
        dmgMul:
          (MAW_TOTAL_DMG * MAW_MINION_SHARE) /
          (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_dmgMul_input0"))),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_rangeMaxM"),
      },
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_MINION_SHARE) / FOE_ALIEN_RIFT.hp,
        dmgMul:
          (MAW_TOTAL_DMG * MAW_MINION_SHARE) /
          (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_dmgMul_input0"))),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_rangeMaxM"),
      },
      {
        ship: FOE_ALIEN_MAW,
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_3_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_BOSS_SHARE) / FOE_ALIEN_MAW.hp,
        dmgMul:
          (MAW_TOTAL_DMG * MAW_BOSS_SHARE) /
          (FOE_ALIEN_MAW.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_3_dmgMul_input0"))),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_1_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_2_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_2_hpShare") },
    ],
    galaxyId: 'galaxy-maw',
    threat: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, 'ano-maw-hunt', 'threatJudged'),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "wreckThreat"),
    tactic: 'brawl',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "dmgMix_plasma"), explosive: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "dmgMix_explosive") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "combatSeconds"),
    description: '星噬之口吞噬过太多舰队。协会悬赏一切能削弱其守军的行动——常设令，可反复接取。',
  }

export const ANOMALY_ENTRY_24: AnomalyDef =
  {
    id: 'ano-chasm-aberrations',
    foeFamily: 'C',
    lairCore: '裂谷畸变群',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "lairLevel"),
    name: '裂谷畸变体猎杀令',
    ships: [
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_hpMul_input1") * FOE_ALIEN_RIFT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_dmgMul_input0") / (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_dmgMul_input1"))),
      },
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_hpMul_input1") * FOE_ALIEN_RIFT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_dmgMul_input0") / (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_dmgMul_input1"))),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_1_hpShare") },
    ],
    galaxyId: 'galaxy-chasm',
    threat: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "threatJudged"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "wreckThreat"),
    tactic: 'brawl',
    defProfile: 'balanced',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "dmgMix_plasma"), explosive: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "dmgMix_explosive") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "combatSeconds"),
    description: '裂谷深带的引力畸变催生出集群异形，威胁深层矿道。协会将其列为长期高危猎杀令。',
  }
