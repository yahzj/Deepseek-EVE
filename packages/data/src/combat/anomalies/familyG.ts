/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_G_SWARM_SKIFF, FOE_G_ECHO_REMNANT, FOE_G_NADIR_LOCK } from '../../foe-ships'

export const ANOMALY_ENTRY_13: AnomalyDef =

  // ── 星图拓展（V12 深空悬赏：20 星系网络的远端目标） ──
  {
    id: 'ano-cinder-siege',
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'G', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '烬火围攻军', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "lairLevel"), // 窝点地图级别（1 = 只出外围档）：G 族最弱（烬火星区，威胁 44、奖金 15 万）
    name: '烬火围攻战',
    // ═══ 2026-09-12 迁入**舰级路径**（船长「G 组分 5 档…」＋「**烬火围攻战按 2 护卫舰**」）═══
    // 旧路径三字段随迁移撤下（原值留档）：`foeHpOverride: 1585` · `foeHitRate: 0.85` · `foeSpeedMps: 307`。
    //   · 血 1,585 ⇒ 卡侧 `hpMul`（**总血逐字守恒**）；命中 0.85 ⇒ 舰级 `hitRate`（同值）；
    //   · 射程带 437~5,745 ⇒ 舰级带（**守恒**）；
    //   · 速度 ⇒ **族口径 `speedRatio 1.05`** ⇒ T1 340 × 1.05 = **357**（原 307，**有意差异**，船长裁定）。
    // 炮台总单发守恒 = **98**（迁移前实建值）：N = 2 ⇒ 多舰补偿 `2N/(N+1)` = **4/3** ⇒ 分母写 4/3；
    // 每艘 49 ⇒ 合计 98。
    ships: [
      {
        ship: FOE_G_SWARM_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_hpMul_input1") * FOE_G_SWARM_SKIFF.hp), // = 792.5 / 156 ⇒ 合计 1,585
        dmgMul: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_dmgMul_input0") / (FOE_G_SWARM_SKIFF.shotDmg * (enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_dmgMul_input1") / enemyParameterOf(bountiesParameters, "ano-cinder-siege", "ships_0_dmgMul_input2"))), // = 每艘 49 ⇒ 合计 98
      },
    ],
    galaxyId: 'galaxy-cinder',
    // 2026-09-26 船长令「将G族和H族残骸价格提高到和D族差不多的位置」⇒ 卡级回收档覆写**危档**
    // （单点 `salvage.wreckCardTierOf`）：本卡星系密度 403 会现算成常档 ⇒ G 低安组价上不去。
    wreckTier: 'dire',
    threat: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "threat"),
    /* ⟪2026-10-02 判据回钉⟫（船长令「两个都同意」之乙）：09-25 重定标把标签 42 → 42 时翻了近防炮门槛 ⇒ PD/修理判据回钉到**重定标前**旧标签 */
    threatJudged: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "threatJudged"), // 判据威胁（PD 门槛 ≥60 / 敌修理 k 读它；见 AnomalyDef.threatJudged）
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-cinder-siege", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 2026-09-11 显式化：原靠 `anomaly.tactic ?? 'orbit'` 缺省值生效——那是个静默陷阱（谁动默认值，这几张卡会集体静默变战术）
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
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'G', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '回音残舰', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "lairLevel"), // 窝点地图级别（2 = 到核心档）：回音荒区
    name: '回音残舰',
    // ═══ 2026-09-12 迁入舰级路径（船长「**残响残舰按 1 驱逐 2 护卫**」）═══
    // 旧路径两字段随迁移撤下（原值留档）：`foeHpOverride: 2035` · `foeSpeedMps: 316`（命中迁移前即缺省 0.85）。
    // 血量权重 = **档基线比**（T2 480 : T1 260 : T1 260）⇒ 976.8 / 529.1 / 529.1（合计 **2,035** 守恒）；
    // 炮台总单发守恒 = **121**（主 59 ＋ 僚 31×2）；N = 3 ⇒ 补偿 `2N/(N+1)` = **1.5**。
    // 速度：驱逐 295 × 1.05 = **310** / 护卫 340 × 1.05 = **357**（原 316，**有意差异**，船长裁定）。
    // 僚位（2 艘围攻残兵舰）射程带覆写为 464~6,103 = 本卡迁移前射程带（**守恒**；舰级本体带 437~5,745）。
    ships: [
      {
        ship: FOE_G_ECHO_REMNANT,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_hpMul_input2") * FOE_G_ECHO_REMNANT.hp), // = 976.8 / 432（T2 权重 480/1000）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_dmgMul_input0") / (FOE_G_ECHO_REMNANT.shotDmg * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_0_dmgMul_input1")), // = 主舰单发 59
      },
      {
        ship: FOE_G_SWARM_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_hpMul_input2") * FOE_G_SWARM_SKIFF.hp), // = 529.1 / 156（每艘；T1 权重 260/1000）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_dmgMul_input0") / (FOE_G_SWARM_SKIFF.shotDmg * enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_dmgMul_input1")), // = 每艘 31 ⇒ 两艘 62
        rangeMinM: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_rangeMinM"), // 僚位射程带覆写（守恒）
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "ships_1_rangeMaxM"),
      },
    ],
    galaxyId: 'galaxy-echo',
    wreckTier: 'dire', // 2026-09-26 船长令：G 族残骸价提到 D 族水平（卡级回收档覆写危档）
    threat: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-echo-haunt", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 2026-09-11 显式化（原靠缺省值生效）
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
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-nadir-static", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-nadir-static", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'G', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '天底封锁军', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-nadir-static", "lairLevel"), // 窝点地图级别（3 = 全档）：G 族最强（天底静区，威胁 55、奖金 35 万）
    name: '天底静区封锁',
    // ═══ 2026-09-12 迁入舰级路径（船长「**天底封锁舰按 1 巡洋 2 驱逐**」＋「**蜂群挂在巡洋舰上。2 架。无后备**」）═══
    // 旧路径三字段随迁移撤下（原值留档）：`foeHpOverride: 2040` · `foeHitRate: 0.95` · `foeSpeedMps: 327`。
    //   · 命中 0.95 迁移前**全卡一致** ⇒ 迁到舰级（天底封锁舰）＋ 僚位覆写（残响残舰 ×2），**守恒**；
    //   · 射程带 502~6,604 = 舰级带（守恒）；僚位覆写为该带（舰级本体带 464~6,103）。
    // 血量权重 = 档基线比（T3 900 : T2 480 : T2 480）⇒ 987.1 / 526.45 / 526.45（合计 **2,040** 守恒）；
    // 速度：巡洋 258 × 1.05 = **271** / 驱逐 295 × 1.05 = **310**（原 327，**有意差异**，船长裁定）。
    // **蜂群火力守恒拆分**（「架数变多、总火力不动」同口径）：本卡炮台总单发 **110** =
    //   巡洋条目 52 ＋ 两艘驱逐条目 29×2；巡洋条目再拆出机群 **24**（2 架各 12）⇒
    //   **本卡实收总单发仍是迁移前的 138**（炮 114 ＋ 机 24）。锚点写在**巡洋那一条目**上
    //   （`firepowerAnchor` / `droneFireShare` 是**条目级**字段，不是卡级）。
    //   两台僚位**不挂机群**（蜂群只在巡洋舰那条），故只有巡洋条目写占比/锚点。
    // ⚠ 占比 **0.30** = 船长 2026-09-12「**G族无人机仅占30%**」（原按我提议落 0.35 ⇒ 已按裁决下调）。
    ships: [
      {
        ship: FOE_G_NADIR_LOCK,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_hpMul_input2") * FOE_G_NADIR_LOCK.hp), // = 987.1 / 1080（T3 权重 900/1860）
        // 旧口径（**未写占比时**）本条目 = 炮 76 ＋ 机 4 = **80** ⇒ 锚点取 80 与之相等
        // （口径：占比只改"机群 / 炮台"的**构成**，**总量不动**）；写成 12/25 = 0.48 使
        // `round(105 × 0.48 × 1.5)` = 76、`2 × round(4 × 0.48)` = 2×2 = 4。
        dmgMul: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_dmgMul_input0") / enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_dmgMul_input1"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_droneFireShare"), // 机群拿 30%（船长「G族无人机仅占30%」）：`round(80 × 0.30)` = **24**（2 架各 12）
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_0_firepowerAnchor"), // 本**条目**实收总单发钉住 = 56（炮）＋ 24（机）
      },
      {
        ship: FOE_G_ECHO_REMNANT,
        count: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hpMul_input1")) / (enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hpMul_input2") * FOE_G_ECHO_REMNANT.hp), // = 526.45 / 432（每艘；T2 权重 480/1860）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_dmgMul_input0") / (FOE_G_ECHO_REMNANT.shotDmg * enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_dmgMul_input1")), // = 每艘 29 ⇒ 两艘 58
        hitRate: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_hitRate"), // 命中随卡走（迁移前全卡 0.95）
        rangeMinM: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-nadir-static", "ships_1_rangeMaxM"),
      },
    ],
    galaxyId: 'galaxy-nadir',
    wreckTier: 'dire', // 2026-09-26 船长令：G 族残骸价提到 D 族水平（卡级回收档覆写危档）
    threat: enemyParameterOf(bountiesParameters, "ano-nadir-static", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-nadir-static", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 2026-09-11 显式化（原靠缺省值生效）
    standingReq: enemyParameterOf(bountiesParameters, "ano-nadir-static", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-nadir-static", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-nadir-static", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-nadir-static", "combatSeconds"),
    description: '天底是条死胡同，也是鱿鱼亡军最后的据点。协会长年封锁此区，悬赏每一次突破防线的清剿。',
  }
