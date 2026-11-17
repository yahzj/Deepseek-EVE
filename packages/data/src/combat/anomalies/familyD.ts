import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_D_LONGSHIP, FOE_D_GHOST, FOE_D_STASIS } from '../../foe-ships'
import { COMP_MUL } from './constants'

export const ANOMALY_ENTRY_6: AnomalyDef =
  {
    id: 'ano-gravekeeper',
    foeFamily: 'D',
    lairCore: '坟场守墓者',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "lairLevel"),
    name: '坟场守墓者',
    ships: [
      {
        ship: FOE_D_LONGSHIP,
        count: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_hpMul_input0") / FOE_D_LONGSHIP.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_dmgMul_input0") / (FOE_D_LONGSHIP.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_dmgMul_input1"))),
      },
    ],
    waves: [{ units: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "waves_0_hpShare") }],
    galaxyId: 'galaxy-grave',
    threat: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'armor',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "dmgMix_kinetic") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "combatSeconds"),
    description: '暗星坟场的守墓舰队从不轮换，协会对它的通缉令也从未撤销：击退一次，结算一次。',
  }

export const ANOMALY_ENTRY_7: AnomalyDef =
  {
    id: 'ano-ghost-signal',
    foeFamily: 'D',
    lairCore: '幽灵舰',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "lairLevel"),
    name: '幽灵舰信号',
    ships: [
      {
        ship: FOE_D_GHOST,
        hpMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_0_hpMul_input0") / FOE_D_GHOST.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_0_dmgMul_input0") / (FOE_D_GHOST.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_0_dmgMul_input1"))),
      },
      {
        ship: FOE_D_GHOST,
        hpMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_1_hpMul_input0") / FOE_D_GHOST.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_1_dmgMul_input0") / (FOE_D_GHOST.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_1_dmgMul_input1"))),
      },
    ],
    galaxyId: 'galaxy-redring',
    threat: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'shield',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "dmgMix_kinetic") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "combatSeconds"),
    description: '一桩悬了许久的疑案：幽灵舰定期在红环深处现身又消失。协会对每一次成功接触都发放调查赏金——它到底是什么，至今没人说清。',
  }

export const ANOMALY_ENTRY_17: AnomalyDef =
  {
    id: 'ano-vault-sentinel',
    foeFamily: 'D',
    lairCore: '穹顶守卫',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "lairLevel"),
    name: '穹顶守卫',
    ships: [
      {
        ship: FOE_D_STASIS,
        count: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_hpMul_input0") / FOE_D_STASIS.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_dmgMul_input0") / (FOE_D_STASIS.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_dmgMul_input1"))),
      },
      {
        ship: FOE_D_LONGSHIP,
        count: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_hpMul_input0") * (enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_hpMul_input1") / FOE_D_STASIS.hp)) / FOE_D_LONGSHIP.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_dmgMul_input0") / (FOE_D_LONGSHIP.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_dmgMul_input1"))),
        split: foeLayerSplit('balanced'),
        tactic: 'kite',
      },
    ],
    waves: [{ units: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "waves_0_hpShare") }],
    galaxyId: 'galaxy-vault',
    threat: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "wreckThreat"),
    tactic: 'kite',
    defProfile: 'balanced',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "dmgMix_kinetic") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "combatSeconds"),
    description: '穹顶墓园的守墓舰队是现存最古老的武装力量，协会将其列为全星域最高悬赏——无人知晓它们为何仍在巡弋。',
  }

export const ANOMALY_ENTRY_18: AnomalyDef =
  {
    id: 'ano-voidedge-warden',
    ships: [
      {
        ship: FOE_D_LONGSHIP,
        count: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_hpMul_input0") / FOE_D_LONGSHIP.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_dmgMul_input0") / (FOE_D_LONGSHIP.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_dmgMul_input1"))),
        split: foeLayerSplit('balanced'),
      },
    ],
    waves: [{ units: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "waves_0_hpShare") }],
    foeFamily: 'D',
    lairCore: '虚海守望者',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "lairLevel"),
    name: '虚海守望者',
    galaxyId: 'galaxy-voidedge',
    threat: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'balanced',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "dmgMix_kinetic") },
    standingReq: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "combatSeconds"),
    description: '虚海边缘的守望者只对强敌回应。协会常年保留这份最高级通缉，等待能活着带回战报的人。',
  }
