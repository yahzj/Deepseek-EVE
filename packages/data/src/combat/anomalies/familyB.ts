/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import { FOE_SCAV_ARMED, FOE_SCAV_SKIFF } from '../../foe-ships'
import bountiesParameters from '../../static/bounties.json'

export const ANOMALY_ENTRY_4: AnomalyDef =
  {
    id: 'ano-abandoned-platform',
    foeFamily: 'B', // 敌族（与美术层 FOE_ART 族字母同源）
    // ⚠ **`lairCore` 已退役（2026-09-11 船长裁决「B 族没有窝点、排除出赏金范围」）**：
    // 本卡曾带 `lairCore: '占港拾荒团'`，按"方案 2"删除字段（数据层干净）——
    // **旧档兼容去向 = `RETIRED_LAIR_CARD_IDS` 白名单**（`docs/design/foe-faction-b-scavenger-20260911.md` §六；
    // 让旧档里已获得的 `wreck-rare-ano-abandoned-platform` 仍能被识别与开箱）。**不是漏标，勿加回来**（契约会拦）。
    name: '占港武装通缉',
    // B 族落码批（2026-09-11 船长七裁决）：迁入**舰级路径**（拾荒火力舰 ×1）——舰级基准即本卡现状值，
    // 故血 292 / 单发 58 / 射程 366~4815 / 构成 8:2 / 血型均衡**逐字不变**，无需任何倍率。
    // 速度：旧绝对 286 → **271**（舰级 `speedRatio 0.92`，船长「速度偏慢」——**有意改慢**）。
    // ⚠ **乱射（命中 0.55）不动**，但它是**单卡特征**（不是族级签名），故写在**本卡条目**上、不写进舰级。
    // ⚠ 舰级按档重排（2026-09-11 甲案）后，舰级值是**档基线**（拾荒火力舰 = T2 480/65）
    // ⇒ 本卡目标值由倍率表达：血 **292**、单发 **58**（逐字守恒）。
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
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 船长：B 族战术统一 orbit（本卡原即 orbit）
    defProfile: 'balanced',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-abandoned-platform", "combatSeconds"),
    description: '长期通缉：武装拾荒者盘踞废弃采掘平台多年，协会悬赏清除其火力点。',
  }

export const ANOMALY_ENTRY_19: AnomalyDef =
  // ══════════ V16.1 内容补充：为空缺星系添加的长期悬赏 ══════════
  {
    id: 'ano-harbor-escort',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'B', // 敌族（与美术层 FOE_ART 族字母同源）
    // ⚠ **`lairCore` 已退役（2026-09-11 船长裁决「B 族没有窝点、排除出赏金范围」）**：
    // 本卡曾带 `lairCore: '新港拾荒团'`，按"方案 2"删除字段（数据层干净）——
    // **旧档兼容去向 = `RETIRED_LAIR_CARD_IDS` 白名单**（`docs/design/foe-faction-b-scavenger-20260911.md` §六；
    // 让旧档里已获得的 `wreck-rare-ano-harbor-escort` 仍能被识别与开箱）。**不是漏标，勿加回来**（契约会拦）。
    name: '新港商路护航令',
    // B 族落码批（2026-09-11 船长七裁决）：迁入**舰级路径**（拾荒武装艇 ×1）。
    // 基准卡 = 演习场驱逐令（T15），本卡按**精确倍率**复现原建档值：血 75（75/22）、单发 23（23/14）、
    // 射程 1~2200 与舰级相同（无需覆写）；卡面**装甲型**、构成 **8:2** 均与舰级基准不同 → 条目上覆写。
    // 速度：旧绝对 337 → **306**（同舰级 0.90；船长「速度偏慢」——**有意改慢**，本卡不再比教学卡更快）。
    ships: [
      {
        ship: FOE_SCAV_SKIFF,
        hpMul: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_hpMul_input0") / enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_hpMul_input1"), // 目标血 75（舰级按档重排后：拾荒武装艇 T1 档基线 156）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMul_input1"), // 目标单发 23（kinetic 18 + explosive 5）
        split: foeLayerSplit('armor'), // 卡面装甲型（舰级基准是均衡型）
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "ships_0_dmgMix_explosive") }, // 本卡 8:2（舰级基准是纯动能）
      },
    ],
    galaxyId: 'galaxy-harbor',
    threat: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 船长：B 族战术统一 orbit（原 brawl）
    defProfile: 'armor',
    standingReq: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "rewardIsk"), // 2026-09-06 船长复核：8,000→6,400（−20%，新手区第二张单收益收口）
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-harbor-escort", "combatSeconds"),
    description: '新港走廊的商路劫案从未断过。协会长期悬赏护航协防：击退小型劫掠艇按次结算——新手练兵的第一张常驻单。',
  }
