import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import { FOE_SCAV_SKIFF } from '../../foe-ships'
import bountiesParameters from '../../static/bounties.json'

export const ANOMALY_ENTRY_2: AnomalyDef =
  {
    id: 'ano-training',
    foeFamily: 'B',
    name: '演习场驱逐令',
    ships: [{ ship: FOE_SCAV_SKIFF, hpMul: enemyParameterOf(bountiesParameters, "ano-training", "ships_0_hpMul_input0") / enemyParameterOf(bountiesParameters, "ano-training", "ships_0_hpMul_input1"), dmgMul: enemyParameterOf(bountiesParameters, "ano-training", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-training", "ships_0_dmgMul_input1") }],
    galaxyId: 'galaxy-hub',
    threat: enemyParameterOf(bountiesParameters, "ano-training", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-training", "wreckThreat"),
    tactic: 'orbit',
    defProfile: 'balanced',
    standingReq: enemyParameterOf(bountiesParameters, "ano-training", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-training", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-training", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-training", "combatSeconds"),
    description: '深空工业协会的例行清场令：拾荒船常年在演习场边缘翻捡演习残骸，协会按次悬赏驱逐。悬赏常设、可反复接取——新手的第一张长期单。',
  }
