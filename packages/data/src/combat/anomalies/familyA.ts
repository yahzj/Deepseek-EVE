/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_SHIP_PIRATE_SKIFF, FOE_SHIP_PIRATE_WARLORD, FOE_SHIP_PIRATE_SNIPER, FOE_SHIP_PIRATE_CORVETTE } from '../../foe-ships'
import { A_MULTI_SHIP_COMP, REDRING_RANGE_MUL, MIRAGE_RANGE_MUL } from './constants'

export const ANOMALY_ENTRY_3: AnomalyDef =
  {
    id: 'ano-pirate-post',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '边境海盗', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-pirate-post", "lairLevel"), // 窝点地图级别（1 = 只出外围档）：族内最弱的近处图，柯尔边境是高安、日板不派发（档位上限仅作档案）
    name: '边境海盗前哨',
    // ★ 2026-09-11 船长两条裁定后重编（「边境海盗前哨 T12 减少为 1+2」+「**设定无首领**」）：
    //   **无首领** ⇒ 全队同一舰级（海盗快艇，卡面装甲型 + 爆炸 8:2 与舰级本体一致，**无需任何覆写**）；
    //   **1+2 两波** = 第一波 1 艘、第二波 2 艘（`slot.wave` + `anomaly.waves` 驱动，后缀 `w1-`）。
    //   难度盘守恒：总血仍 **150**（3 艘 × 50）、总单发仍 **43**（首波 15 + 次波 14 ×2）。
    //   ⚠ 多舰补偿按本卡**单位总数 N=3** ⇒ `2N/(N+1)` = **1.5**（原 N=4 为 1.6），故倍率分母用 1.5。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_0_hpMul_input0") / FOE_SHIP_PIRATE_SKIFF.hp, // = 50/156（总血 150 的三分之一）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_SKIFF.shotDmg * enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_0_dmgMul_input1")), // = 首波单发 15
      },
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_1_hpMul_input0") / FOE_SHIP_PIRATE_SKIFF.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_SKIFF.shotDmg * enemyParameterOf(bountiesParameters, "ano-pirate-post", "ships_1_dmgMul_input1")), // = 次波单发 14（两艘合计 28）
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-pirate-post", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-pirate-post", "waves_0_hpShare_input0") / enemyParameterOf(bountiesParameters, "ano-pirate-post", "waves_0_hpShare_input1") },
      { units: enemyParameterOf(bountiesParameters, "ano-pirate-post", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-pirate-post", "waves_1_hpShare_input0") / enemyParameterOf(bountiesParameters, "ano-pirate-post", "waves_1_hpShare_input1") },
    ],
    galaxyId: 'galaxy-kor',
    threat: enemyParameterOf(bountiesParameters, "ano-pirate-post", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-pirate-post", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'brawl',
    defProfile: 'armor',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-pirate-post", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-pirate-post", "dmgMix_kinetic") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: enemyParameterOf(bountiesParameters, "ano-pirate-post", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-pirate-post", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-pirate-post", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-pirate-post", "combatSeconds"),
    description: '通缉册上的老面孔：柯尔边境的前哨海盗团长期袭扰新手商路。悬赏常设，击溃即结算，可反复接取。',
  }

export const ANOMALY_ENTRY_5: AnomalyDef =
  {
    id: 'ano-redring-raiders',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '赤潮劫掠团', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "lairLevel"), // 窝点地图级别（3 = 全档）：A 族次强（红环航道）
    name: '赤潮劫掠舰队',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠狙击舰 ×3**。
    // 头目舰缺省 brawl、本卡 kite → `tactic: 'kite'` 覆写；主系覆写为**能量**（缴获改装的能量炮）⇒
    //   头目与杂鱼都走**光束必中**（不消费命中补偿），故单发 = 火力 × 装填 4s。
    // 血：340 → 头目 204（204÷360）、每杂鱼 340×40%÷3 = 45.3333（45.3333÷268.75，Σ 精确 = 340）。
    // ⚠ **火力重锚（2026-09-11 船长裁决 = 方案 B + 纸面锚 ×1.2）**：本卡**不走威胁曲线**——原口径按
    //   `威胁 × 0.8 × 1.6 = 43.52` 重锚单发时，把本卡旧有的**逐卡伤害压制倍率（旧 `foeDmgMul` 0.27）**
    //   无声取消了，实际火力 7.25 → 43.25（×5.97），实测难度失控。
    //   **船长裁决：锚回"改造前的实际火力"**（**不恢复已退休的 `foeDmgMul`**，改用卡上 `dmgMul` 重锚）；
    //   纸面锚点由 ×1.6 下调为 **×1.2**（理由：难度守恒按「**实收**」判定——4 单位逐个被击毁 ⇒
    //   实收积分 ≈ 纸面 ×`(N+1)/(2N)` = ×0.625，而本卡改动前只有 2 单位（衰减 ×0.75），
    //   纸面 ×1.6 会实收成改动前的 ×1.33；要"实收 ≈ 改动前"须用纸面 ×`0.75/0.625` = **×1.2**）。
    //   → 目标实际火力 = 7.25 × 1.2 = **8.70**；重锚单发（光束，÷装填 4s、按 60%/40%÷3 分配后取整）：
    //   头目 0.6×8.70×4 = 20.88 → **21**、每杂鱼 (0.4/3)×8.70×4 = 4.64 → **5**；
    //   Σ = 36 → **纸面 9.00**（目标 8.70，取整 +3.4%）；实收 = 9.00 × 0.625 = **5.63** ≈ 改动前 7.25 的 ×0.78。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_0_hpMul_input1")) / enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_0_hpMul_input2") / FOE_SHIP_PIRATE_WARLORD.hp, // = 204/360
        dmgMul: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 21/(56×1.6)
        split: foeLayerSplit('shield'), // 血型随卡走（船长裁决①）：卡面护盾 → 头目也护盾
        // 射程多重方案（船长裁决③）：头目原 1~2210m 在本卡 3312m 交战距离下 0 次开火（探针实测）
        // ⇒ 同卡同带（与杂鱼同式的变体倍率推导，**不手抄数字**）
        rangeMinM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMinM * REDRING_RANGE_MUL),
        rangeMaxM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMaxM * REDRING_RANGE_MUL),
        tactic: 'kite',
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_0_dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_0_dmgMix_kinetic") },
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        count: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_hpMul_input1")) / enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_hpMul_input2") / FOE_SHIP_PIRATE_SNIPER.hp, // = 45.3333/268.75
        dmgMul: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_SNIPER.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 5/(41×1.6)
        speedMul: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_speedMul_input0") / enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_speedMul_input1"),
        rangeMul: REDRING_RANGE_MUL,
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "ships_1_dmgMix_kinetic") },
      },
    ],
    galaxyId: 'galaxy-redring',
    threat: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'kite',
    defProfile: 'shield',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "dmgMix_kinetic") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-redring-raiders", "combatSeconds"),
    description: '红环航道的老牌劫掠舰队，通缉令在协会悬赏板上挂了五年——击退其主力即可结算，可反复接取。',
  }

export const ANOMALY_ENTRY_20: AnomalyDef =
  {
    id: 'ano-shard-bandits',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '碎晶劫匪', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "lairLevel"), // 窝点地图级别（1 = 只出外围档）：A 族第二弱的近处图（碎晶带）
    name: '碎晶带劫匪通缉',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 海盗快艇 ×3**（本卡的快艇是"提速变体"，
    // 保留试点期的 `speedMul 377/351` 与 `rangeMul 2273/2215`：它们乘在新的 −15% 基准与 1.15 基准之上）。
    // ★ 2026-09-11 船长两条裁定后重编（「剩余 2 个卡位 2+2」+「**设定无首领**」）：
    //   **无首领** ⇒ 全队 = 海盗快艇 ×4（卡面动能 8:2 与舰级本体（爆炸 8:2）不同 ⇒ 条目按卡面覆写 `dmgMix`）；
    //   **2+2 两波** = 每波 2 艘（`slot.wave` + `anomaly.waves`）。
    //   难度盘守恒：总血仍 **285**（4 艘 × 71.25）、总单发仍 **72**（4 艘 × 18）；N=4 ⇒ 补偿仍 ×1.6。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_hpMul_input0") / FOE_SHIP_PIRATE_SKIFF.hp, // = 71.25/156
        dmgMul: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_SKIFF.shotDmg * A_MULTI_SHIP_COMP), // = 18/(28×1.6)
        speedMul: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_speedMul_input0") / enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_speedMul_input1"),
        // rangeMul 退役（2026-09-11 船长「低威胁卡敌人射程延长到 2600」）：统一走舰级带，
        // 不再用 2273/2215 的微调——两处 rangeMul 一并撤下，本卡快艇射程带 = 舰级 1~2600
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_0_dmgMix_explosive") },
      },
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        count: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_hpMul_input0") / FOE_SHIP_PIRATE_SKIFF.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_SKIFF.shotDmg * A_MULTI_SHIP_COMP),
        speedMul: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_speedMul_input0") / enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_speedMul_input1"),
        // rangeMul 退役（2026-09-11 船长「低威胁卡敌人射程延长到 2600」）：统一走舰级带，
        // 不再用 2273/2215 的微调——两处 rangeMul 一并撤下，本卡快艇射程带 = 舰级 1~2600
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "ships_1_dmgMix_explosive") },
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "waves_1_hpShare") },
    ],
    galaxyId: 'galaxy-shard',
    threat: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    tactic: 'brawl',
    defProfile: 'armor',
    standingReq: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-shard-bandits", "combatSeconds"),
    description: '碎晶带的晶尘里藏着一伙专劫曦棱晶货船的惯匪。通缉长期有效，可反复接取。',
  }

export const ANOMALY_ENTRY_21: AnomalyDef =
  {
    id: 'ano-lantern-saboteurs',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '信标猎手', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "lairLevel"), // 窝点地图级别（2 = 到核心档）：灯塔长廊
    name: '信标猎手悬赏',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠护卫舰 ×3**。
    // 头目舰缺省是 brawl 贴脸，本卡是 orbit 环绕 → 用条目 `tactic` **覆写**（船长「头目可配多战术」）。
    // 血：365 → 头目 219（219÷360）、每杂鱼 365×40%÷3 = 48.6667（48.6667÷365，Σ 精确 = 365）。
    // 火力：名义总 DPS = 22 × 0.8 × 1.6 = **28.16** → 头目 16.896 / 每杂鱼 3.7547；
    //   单发（动能主系）→ 头目 16.896×4×0.62/0.9 = 46.5579 → **47**，杂鱼 3.7547×4×0.62/0.85 = 10.9548 → **11**；
    //   Σ = 80，名义 Σ = 79.4222 → **取整偏差 +1**（余数 1 落在 3 艘杂鱼上无法整分，如实记偏差）。
    // ★ 2026-09-11 船长两条裁定后重编（「剩余 2 个卡位 2+2」+「**设定无首领**」）：
    //   **无首领** ⇒ 全队 = 劫掠护卫舰 ×4（舰级本体即**均衡型 + orbit + 射程 326~4275 + 动能 8:2**，
    //   与本卡卡面口径**逐项一致**）⇒ 原先头目那条「血型随卡走覆写」「头目射程多重方案覆写」**随之退役**；
    //   **2+2 两波** = 每波 2 艘（`slot.wave` + `anomaly.waves`）。
    //   难度盘守恒：总血仍 **365**（4 艘 × 91.25）、总单发仍 **80**（4 艘 × 20）；N=4 ⇒ 补偿仍 ×1.6。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_CORVETTE,
        count: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_0_hpMul_input0") / FOE_SHIP_PIRATE_CORVETTE.hp, // = 91.25/364
        dmgMul: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_CORVETTE.shotDmg * A_MULTI_SHIP_COMP), // = 20/(51×1.6)
      },
      {
        ship: FOE_SHIP_PIRATE_CORVETTE,
        count: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_1_hpMul_input0") / FOE_SHIP_PIRATE_CORVETTE.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_CORVETTE.shotDmg * A_MULTI_SHIP_COMP),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "waves_1_hpShare") },
    ],
    galaxyId: 'galaxy-lantern',
    threat: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    tactic: 'orbit',
    defProfile: 'balanced',
    standingReq: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-lantern-saboteurs", "combatSeconds"),
    description: '灯塔长廊的信标阵列屡遭破坏，修复费用高昂。协会悬赏猎杀破坏信标的惯犯——本单长期有效。',
  }

export const ANOMALY_ENTRY_22: AnomalyDef =
  {
    id: 'ano-haze-ambush',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '灰霾伏击团', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "lairLevel"), // 窝点地图级别（2 = 到核心档）：灰霾带
    name: '灰霾伏击团清剿令',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠狙击舰 ×3**。
    // 原 `escorts: 1` 的**僚机条目取消**（船长 ①：灰霾/蜃影的 escort 条目改为上述编成）——
    // 三艘狙击舰现在都是**主体**（tag `w0-foe-1..3`），不再挂「轻装」前缀。
    // 头目舰缺省 brawl、本卡 kite → 条目 `tactic: 'kite'` 覆写；头目构成覆写为爆炸 8:2（与卡面一致）。
    // 血：430 → 头目 258（258÷360）、每杂鱼 430×40%÷3 = 57.3333（57.3333÷268.75，Σ 精确 = 430）。
    // 火力：名义总 DPS = 28 × 0.8 × 1.6 = **35.84** → 头目 21.504 / 每杂鱼 4.7787；
    //   单发（爆炸主系）→ 头目 21.504×4×0.62/0.9 = 59.2555 → **59**，杂鱼 4.7787×4×0.62/0.85 = 13.9425 → **14**；
    //   Σ = 101，名义 Σ = 101.0829 → **取整偏差 0**。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_0_hpMul_input1")) / enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_0_hpMul_input2") / FOE_SHIP_PIRATE_WARLORD.hp, // = 258/360
        dmgMul: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // = 59/(56×1.6)
        split: foeLayerSplit('shield'), // 血型随卡走（船长裁决①）：卡面护盾 → 头目也护盾
        // 射程多重方案（船长裁决③）：头目原 1~2210m 在本卡 3238m 交战距离下 0 次开火（探针实测）
        // ⇒ 同卡同带：覆写为杂鱼（劫掠狙击舰）射程带
        rangeMinM: FOE_SHIP_PIRATE_SNIPER.rangeMinM,
        rangeMaxM: FOE_SHIP_PIRATE_SNIPER.rangeMaxM,
        tactic: 'kite',
        dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_0_dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_0_dmgMix_kinetic") },
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        count: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_1_hpMul_input1")) / enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_1_hpMul_input2") / FOE_SHIP_PIRATE_SNIPER.hp, // = 57.3333/268.75
        dmgMul: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_SNIPER.shotDmg * A_MULTI_SHIP_COMP), // = 14/(41×1.6)
      },
    ],
    galaxyId: 'galaxy-haze',
    threat: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'kite',
    defProfile: 'shield',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "dmgMix_kinetic") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-haze-ambush", "combatSeconds"),
    description: '灰霾带的电离云是天然的伏击场——一伙劫掠团常年盘踞环心航路。协会发布长期清剿令，按次结算。',
  }

export const ANOMALY_ENTRY_23: AnomalyDef =
  {
    id: 'ano-mirage-hijackers',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '蜃影劫持团', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "lairLevel"), // 窝点地图级别（3 = 全档）：A 族最强（蜃影星系，威胁 30、奖金 19 万）
    name: '蜃影导航劫持令',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠狙击舰 ×3**（本卡是三档的"最强变体"，
    // 保留 `speedMul 235/201` 与 `rangeMul 13667/11316`；原 `escorts: 1` 僚机条目**取消**）。
    // 头目缺省 brawl、本卡 kite → `tactic: 'kite'` 覆写；主系覆写为能量 ⇒ 光束必中（单发不除命中）。
    // 血：560 → 头目 336（336÷360）、每杂鱼 560×40%÷3 = 74.6667（74.6667÷268.75，Σ 精确 = 560）。
    // ⚠ **火力重锚（2026-09-11 船长裁决 = 方案 B + 纸面锚 ×1.2）**：本卡同样**不走威胁曲线**——原口径按
    //   `威胁 × 0.8 × 1.6 = 61.44` 重锚时，把旧有的**逐卡伤害压制倍率（旧 `foeDmgMul` 0.30）**无声取消，
    //   实际火力 11.50 → 61.50（×5.35），实测**从"可打"变成"打不过"**。
    //   **船长裁决：锚回"改造前的实际火力"**（**不恢复 `foeDmgMul`**，用卡上 `dmgMul` 重锚）；
    //   纸面锚点由 ×1.6 下调为 **×1.2**（**难度守恒按「实收」判定**：4 单位 ⇒ 实收 ≈ 纸面 ×0.625，
    //   而本卡改动前只有 2 单位（衰减 ×0.75），故"实收 ≈ 改动前"须纸面 ×`0.75/0.625` = ×1.2）。
    //   → 目标实际火力 = 11.50 × 1.2 = **13.80**；重锚单发（光束，÷4s、60%/40%÷3 后取整）：
    //   头目 0.6×13.80×4 = 33.12 → **33**、每杂鱼 (0.4/3)×13.80×4 = 7.36 → **7**；
    //   Σ = 54 → **纸面 13.50**（目标 13.80，取整 −2.2%）；实收 = 13.50 × 0.625 = **8.44** ≈ 改动前 11.50 的 ×0.73。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_0_hpMul_input1")) / enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_0_hpMul_input2") / FOE_SHIP_PIRATE_WARLORD.hp, // = 336/360
        dmgMul: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 33/(56×1.6)
        split: foeLayerSplit('shield'), // 血型随卡走（船长裁决①）：卡面护盾 → 头目也护盾
        // 射程多重方案（船长裁决③）：头目原 1~2210m 在本卡 3809m 交战距离下 0 次开火（探针实测）
        // ⇒ 同卡同带（与杂鱼同式的变体倍率推导，**不手抄数字**）
        rangeMinM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMinM * MIRAGE_RANGE_MUL),
        rangeMaxM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMaxM * MIRAGE_RANGE_MUL),
        tactic: 'kite',
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_0_dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_0_dmgMix_kinetic") },
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        count: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_hpMul_input1")) / enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_hpMul_input2") / FOE_SHIP_PIRATE_SNIPER.hp, // = 74.6667/268.75
        dmgMul: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_SNIPER.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 7/(41×1.6)
        speedMul: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_speedMul_input0") / enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_speedMul_input1"),
        rangeMul: MIRAGE_RANGE_MUL,
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "ships_1_dmgMix_kinetic") },
      },
    ],
    galaxyId: 'galaxy-mirage',
    threat: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "threat"),
    /* ⟪2026-10-02 判据回钉⟫（船长令「两个都同意」之乙）：09-25 重定标把标签 48 → 48 时翻了近防炮门槛 ⇒ PD/修理判据回钉到**重定标前**旧标签 */
    threatJudged: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "threatJudged"), // 判据威胁（PD 门槛 ≥60 / 敌修理 k 读它；见 AnomalyDef.threatJudged）
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'kite',
    defProfile: 'shield',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "dmgMix_kinetic") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-mirage-hijackers", "combatSeconds"),
    description: '蜃影的引力透镜是天然的埋伏场，海盗借此劫持迷航商船。协会长期悬赏清除这些导航劫持者。',
  }
