import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_G_SWARM_SKIFF, FOE_G_ECHO_REMNANT, FOE_G_NADIR_LOCK } from '../../foe-ships'

export const ANOMALY_ENTRY_13: AnomalyDef =

  {
    id: 'ano-cinder-siege',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "dmgMix_explosive") },
    foeFamily: 'G',
    lairCore: '烬火围攻军',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "lairLevel"),
    name: '烬火围攻战',
    ships: [
      {
        ship: FOE_G_SWARM_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_hpMul_input1") * FOE_G_SWARM_SKIFF.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_dmgMul_input0") / (FOE_G_SWARM_SKIFF.shotDmg * (enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_dmgMul_input1") / enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_dmgMul_input2"))),
      },
    ],
    galaxyId: 'galaxy-cinder',
    wreckTier: 'dire',
    threat: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "threatJudged"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "wreckThreat"),
    tactic: 'orbit',
    standingReq: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "combatSeconds"),
    description: '烬火星区的防线战事常年不断，协会长期悬赏民间火力增援——击退一次围攻编队，结算一次赏金。',
  }

export const ANOMALY_ENTRY_14: AnomalyDef =
  {
    id: 'ano-echo-haunt',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "dmgMix_explosive") },
    foeFamily: 'G',
    lairCore: '回音残舰',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "lairLevel"),
    name: '回音残舰',
    ships: [
      {
        ship: FOE_G_ECHO_REMNANT,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_hpMul_input2") * FOE_G_ECHO_REMNANT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_dmgMul_input0") / (FOE_G_ECHO_REMNANT.shotDmg * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_dmgMul_input1")),
      },
      {
        ship: FOE_G_SWARM_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_hpMul_input2") * FOE_G_SWARM_SKIFF.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_dmgMul_input0") / (FOE_G_SWARM_SKIFF.shotDmg * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_dmgMul_input1")),
        rangeMinM: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_rangeMaxM"),
      },
    ],
    galaxyId: 'galaxy-echo',
    wreckTier: 'dire',
    threat: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "wreckThreat"),
    tactic: 'orbit',
    standingReq: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "combatSeconds"),
    description: '回音荒区的残舰群会不断“复活”，协会认为是残余自动化程序作祟。长期清剿令按次结算。',
  }

export const ANOMALY_ENTRY_15: AnomalyDef =
  {
    id: 'ano-nadir-static',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-nadir-static", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-nadir-static", "dmgMix_explosive") },
    foeFamily: 'G',
    lairCore: '天底封锁军',
    lairLevel: enemyParameterOf(bountiesParameters, "ano-nadir-static", "lairLevel"),
    name: '天底静区封锁',
    ships: [
      {
        ship: FOE_G_NADIR_LOCK,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_hpMul_input2") * FOE_G_NADIR_LOCK.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_dmgMul_input1"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_droneFireShare"),
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_firepowerAnchor"),
      },
      {
        ship: FOE_G_ECHO_REMNANT,
        count: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hpMul_input2") * FOE_G_ECHO_REMNANT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_dmgMul_input0") / (FOE_G_ECHO_REMNANT.shotDmg * enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_dmgMul_input1")),
        hitRate: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hitRate"),
        rangeMinM: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_rangeMaxM"),
      },
    ],
    galaxyId: 'galaxy-nadir',
    wreckTier: 'dire',
    threat: enemyParameterOf(bountiesParameters, "ano-nadir-static", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-nadir-static", "wreckThreat"),
    tactic: 'orbit',
    standingReq: enemyParameterOf(bountiesParameters, "ano-nadir-static", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-nadir-static", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-nadir-static", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-nadir-static", "combatSeconds"),
    description: '天底是条死胡同，也是鱿鱼亡军最后的据点。协会长年封锁此区，悬赏每一次突破防线的清剿。',
  }
