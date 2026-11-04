/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import { FOE_SCAV_SKIFF } from '../../foe-ships'
import bountiesParameters from '../../static/bounties.json'

export const ANOMALY_ENTRY_2: AnomalyDef =
  {
    id: 'ano-training',
    // 2026-09-11 族系单一真相源（船长定案）：本卡原先**美术侧登记为 B、数据侧 `foeFamily` 为空**
    // （`shipArt.tsx` 的硬编码 `FOE_FAMILY` 与数据字段各写各的）——现按数据侧补齐为 B，
    // 并删掉美术侧那张硬编码表，敌族一律由 `AnomalyDef.foeFamily` 推导（口径统一）。
    foeFamily: 'B',
    name: '演习场驱逐令',
    // B 族落码批（2026-09-11 船长七裁决）：迁入**舰级路径**（拾荒武装艇 ×1）。
    // 原 `foeHpOverride 22` / `foeSpeedMps 322` 退场——数值由舰级（`foe-scav-skiff`，基准即本卡现状值）供给，
    // **除速度外逐字不变**：血 22 / 单发 14（纯动能）/ 命中 0.85 / 射程 1~2200 / 衰减 0.3 / 近盲 0.3。
    // 速度：旧绝对 322 → **306**（舰级 `speedRatio 0.90`，船长「速度偏慢」——**有意改慢**）。
    // ⚠ 舰级按档重排（2026-09-11 甲案）后，舰级值是**档基线**（拾荒武装艇 = T1 156/28），
    // 卡片自己的目标值由倍率表达 ⇒ 本卡仍是 **血 22 / 单发 14**（船长「新手过渡族」的小艇）。
    ships: [{ ship: FOE_SCAV_SKIFF, hpMul: enemyParameterOf(bountiesParameters, "ano-training", "ships_0_hpMul_input0") / enemyParameterOf(bountiesParameters, "ano-training", "ships_0_hpMul_input1"), dmgMul: enemyParameterOf(bountiesParameters, "ano-training", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-training", "ships_0_dmgMul_input1") }],
    galaxyId: 'galaxy-hub',
    threat: enemyParameterOf(bountiesParameters, "ano-training", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-training", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 船长：B 族战术统一 orbit（原 brawl）
    defProfile: 'balanced',
    standingReq: enemyParameterOf(bountiesParameters, "ano-training", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-training", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-training", "rewardIsk"), // 本地悬赏（2026-09-08 船长定）：胜利返港固定 2 分钟（120s）后，奖励按新港每分钟费率对齐：3,600÷(交火2min+返港2min)=900 信用点/min ≈ 新港 6,400÷7min≈914（取整百略留教学利差）；防零航程白刷（旧 1,000@0返航=30k/h 压到教学水平的口径随返航段同步退出）
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-training", "combatSeconds"),
    description: '深空工业协会的例行清场令：拾荒船常年在演习场边缘翻捡演习残骸，协会按次悬赏驱逐。悬赏常设、可反复接取——新手的第一张长期单。',
  }
