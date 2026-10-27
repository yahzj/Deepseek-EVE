/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_SHIP_PIRATE_SKIFF, FOE_SHIP_PIRATE_CORVETTE, FOE_SHIP_PIRATE_SNIPER, FOE_SHIP_PIRATE_WARLORD } from '../../foe-ships'

export const ANOMALY_ENTRY_25: AnomalyDef =

  /* ═══ B1 低安遭遇战模板（hidden：不进悬赏目录；threat 档位供遭遇强度就近匹配） ═══ */
  {
    id: 'enc-pirate-1',
    foeFamily: 'A', // 敌族（2026-09-11 船长「废弃F族，将F族融合进A族」：本卡由"未登族 → 兜底 F 形"改为**显式登记 A 族**；签名表本就是 A 口径）
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-1", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-1", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '流窜海盗快艇',
    galaxyId: 'galaxy-hub',
    threat: enemyParameterOf(bountiesParameters, "enc-pirate-1", "threat"),
    // ═══ 2026-09-12 迁入舰级路径（船长「**隐藏模板迁**」）═══
    // 迁移守恒（逐项对照迁移前实建值）：总血 **12** · 炮台单发 **23** · 射程带 **350~4,600** ·
    // 实速 **281**（`speedMul` 反算）· 命中 0.85。舰级 = **海盗快艇（T1）**（原为"未录族 → 兜底 F 形"）。
    // 覆写理由：① 该舰级本体是 **brawl ＋ 爆炸 8:2**，本卡是 **orbit ＋ 动能 8:2** ⇒ 逐条目覆写；
    // ② 射程/速度覆写纯粹是"旧档兜底卡不许漂移"的守恒手段，不是新设计。
    // 旧字段撤下（原值留档）：`foeSpeedMps: 281`。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        hpMul: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_hpMul_input0") / FOE_SHIP_PIRATE_SKIFF.hp, // = 12 / 156
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_dmgMul_input0") / FOE_SHIP_PIRATE_SKIFF.shotDmg, // = 23 / 28（N = 1 ⇒ 补偿 = 1）
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_split_h") }, // 三层比例随卡走（迁移前 = 均衡，守恒）
        tactic: 'orbit',
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_dmgMix_explosive") },
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_hitRate"), // 迁移前缺省命中，守恒
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_falloff"), // 迁移前 `foeFalloff` 缺省 0.5（舰级本体 0.3）⇒ 逐条目覆写，守恒
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_rangeMinM"), // ⚠ 2026-09-20 船长「A 族（除狙击舰）最小射程改为 1」⇒ 本卡近界不再守恒（原 350）；上限仍守恒 4600
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-1", "ships_0_speedMul_input2")), // 舰级 T1 实速 391 ⇒ 覆写回 281
      },
    ],
    standingReq: enemyParameterOf(bountiesParameters, "enc-pirate-1", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "enc-pirate-1", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "enc-pirate-1", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "enc-pirate-1", "combatSeconds"),
    tactic: 'orbit',
    hidden: true,
    description: '低安遭遇模板：小股流窜海盗（隐藏，不出现在悬赏目录）。',
  }

export const ANOMALY_ENTRY_26: AnomalyDef =
  {
    id: 'enc-pirate-2',
    foeFamily: 'A', // 敌族（2026-09-11 船长「废弃F族，将F族融合进A族」：显式登记 A 族）
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-2", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-2", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '伏击劫掠队',
    galaxyId: 'galaxy-hub',
    threat: enemyParameterOf(bountiesParameters, "enc-pirate-2", "threat"),
    // ═══ 2026-09-12 迁入舰级路径（船长「隐藏模板迁」）═══
    // 守恒：总血 **100**（主 62.5 ＋ 僚 37.5）· 炮台单发 **51**（32 ＋ 19）· 射程带 **383~5,029** ·
    // 实速 **291**（`speedMul` 反算）· 命中 0.85。舰级 = **劫掠护卫舰（T1）**——本体即 orbit ＋ 动能 8:2
    // ⇒ 只需位移覆写（射程/速度）。N = 2 ⇒ 多舰补偿 `2N/(N+1)` = **4/3**（分母写 4/3）。
    // 旧字段撤下（原值留档）：`foeSpeedMps: 291` · `escorts: 1`（僚机由下方第二条目表达）。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_CORVETTE,
        hpMul: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_hpMul_input0") / FOE_SHIP_PIRATE_CORVETTE.hp, // = 62.5 / 364（主）
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_CORVETTE.shotDmg * (enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_dmgMul_input1") / enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_dmgMul_input2"))), // = 32
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_split_h") }, // 迁移前均衡（舰级本体同值 ⇒ 显式写出以防漂移）
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_hitRate"),
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_falloff"), // 迁移前缺省 0.5（舰级本体 0.3）⇒ 覆写守恒
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_rangeMinM"), // ⚠ 2026-09-20 船长「A 族（除狙击舰）最小射程改为 1」⇒ 近界不再守恒（原 383）；上限仍守恒 5029
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_0_speedMul_input2")), // 舰级 T1 实速 374 ⇒ 覆写回 291
      },
      {
        ship: FOE_SHIP_PIRATE_CORVETTE, // 僚位 ×1
        hpMul: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_hpMul_input0") / FOE_SHIP_PIRATE_CORVETTE.hp, // = 37.5 / 364
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_CORVETTE.shotDmg * (enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_dmgMul_input1") / enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_dmgMul_input2"))), // = 19
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_split_h") },
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_hitRate"),
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_falloff"),
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_rangeMinM"), // 同上（近界 383 → 1）
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-2", "ships_1_speedMul_input2")),
      },
    ],
    standingReq: enemyParameterOf(bountiesParameters, "enc-pirate-2", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "enc-pirate-2", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "enc-pirate-2", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "enc-pirate-2", "combatSeconds"),
    tactic: 'orbit',
    // 原 `escorts: 1`（旧路径僚机数）已由上方 `ships` 编成表达——**舰级路径不读该字段**。
    hidden: true,
    description: '低安遭遇模板：中等伏击队（隐藏）。',
  }

export const ANOMALY_ENTRY_27: AnomalyDef =
  {
    id: 'enc-pirate-3',
    foeFamily: 'A', // 敌族（2026-09-11 船长「废弃F族，将F族融合进A族」：显式登记 A 族）
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-3", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-3", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '狂徒巡逻编队',
    galaxyId: 'galaxy-hub',
    threat: enemyParameterOf(bountiesParameters, "enc-pirate-3", "threat"),
    // ═══ 2026-09-12 迁入舰级路径（船长「隐藏模板迁」）═══
    // 守恒：总血 **222**（主 5/11 ＋ 僚 3/11 ×2）· 炮台单发 **92**（42 ＋ 25×2）· 射程带 **1~2,420** ·
    // 实速 **394**（`speedMul` 反算）· 命中 0.85。舰级 = **劫掠狙击舰（T2）**——本体是 kite ＋ 爆炸 8:2
    // ⇒ 逐条目覆写回本卡的 **brawl ＋ 动能 8:2**，再叠加位移覆写。N = 3 ⇒ 补偿 **1.5**。
    // 旧字段撤下（原值留档）：`foeSpeedMps: 394` · `escorts: 2`（僚机由第二条目 ×2 表达）。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        hpMul: (enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_hpMul_input1")) / enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_hpMul_input2") / FOE_SHIP_PIRATE_SNIPER.hp, // 主：总血 222 的 5/11 = 100.909…
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_SNIPER.shotDmg * enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_dmgMul_input1")), // = 42
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_split_h") }, // 迁移前均衡（舰级本体是护盾型）⇒ 覆写守恒
        tactic: 'brawl',
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_dmgMix_explosive") },
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_hitRate"),
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_falloff"), // 迁移前缺省 0.5（舰级本体 0.3）⇒ 覆写守恒
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_0_speedMul_input2")), // 舰级 T2 实速 324.5 ⇒ 覆写回 394
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER, // 僚位 ×2
        count: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_hpMul_input1")) / enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_hpMul_input2") / FOE_SHIP_PIRATE_SNIPER.hp, // 僚：总血 222 的 3/11 = 60.545…（每艘）
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_SNIPER.shotDmg * enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_dmgMul_input1")), // = 每艘 25 ⇒ 两艘 50
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_split_h") },
        tactic: 'brawl',
        dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_dmgMix_explosive") },
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_hitRate"),
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_falloff"),
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-3", "ships_1_speedMul_input2")),
      },
    ],
    standingReq: enemyParameterOf(bountiesParameters, "enc-pirate-3", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "enc-pirate-3", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "enc-pirate-3", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "enc-pirate-3", "combatSeconds"),
    tactic: 'brawl',
    // 原 `escorts: 2`（旧路径僚机数）已由上方 `ships` 编成表达——**舰级路径不读该字段**。
    hidden: true,
    description: '低安遭遇模板：重装狂徒编队（隐藏）。',
  }

export const ANOMALY_ENTRY_28: AnomalyDef =
  {
    id: 'enc-pirate-4',
    foeFamily: 'A', // 敌族（2026-09-11 船长「废弃F族，将F族融合进A族」：显式登记 A 族）
    dmgMix: { kinetic: enemyParameterOf(bountiesParameters, "enc-pirate-4", "dmgMix_kinetic"), explosive: enemyParameterOf(bountiesParameters, "enc-pirate-4", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '深空屠夫舰队',
    galaxyId: 'galaxy-hub',
    threat: enemyParameterOf(bountiesParameters, "enc-pirate-4", "threat"),
    // ═══ 2026-09-12 迁入舰级路径（船长「隐藏模板迁」）═══
    // 守恒：总血 **695**（主 5/11 ＋ 僚 3/11 ×2）· 炮台单发 **164**（74 ＋ 45×2）· 射程带 **1~2,640** ·
    // 实速 **418**（`speedMul` 反算）· 命中 0.85。舰级 = **海盗头目舰（T3）**——本体即 brawl ＋ 动能 8:2
    // ⇒ 只需位移覆写。N = 3 ⇒ 补偿 **1.5**。
    // 旧字段撤下（原值留档）：`foeSpeedMps: 418` · `escorts: 2`（僚机由第二条目 ×2 表达）。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_hpMul_input0") * enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_hpMul_input1")) / enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_hpMul_input2") / FOE_SHIP_PIRATE_WARLORD.hp, // 主：总血 695 的 5/11 = 315.909…
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_dmgMul_input0") / (FOE_SHIP_PIRATE_WARLORD.shotDmg * enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_dmgMul_input1")), // = 74
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_split_h") }, // 迁移前均衡（舰级本体是装甲型）⇒ 覆写守恒
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_hitRate"), // 迁移前缺省 0.85（舰级本体 0.9）⇒ 覆写守恒
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_falloff"), // 迁移前缺省 0.5（舰级本体 0.3）⇒ 覆写守恒
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_0_speedMul_input2")), // 舰级 T3 实速 374.1 ⇒ 覆写回 418
      },
      {
        ship: FOE_SHIP_PIRATE_WARLORD, // 僚位 ×2
        count: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_hpMul_input0") * enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_hpMul_input1")) / enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_hpMul_input2") / FOE_SHIP_PIRATE_WARLORD.hp, // 僚：总血 695 的 3/11 = 189.545…（每艘）
        dmgMul: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_dmgMul_input0") / (FOE_SHIP_PIRATE_WARLORD.shotDmg * enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_dmgMul_input1")), // = 每艘 45 ⇒ 两艘 90
        split: { s: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_split_s"), a: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_split_a"), h: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_split_h") },
        hitRate: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_hitRate"),
        falloff: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_falloff"),
        rangeMinM: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_rangeMinM"),
        rangeMaxM: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_rangeMaxM"),
        speedMul: enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_speedMul_input0") / (enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_speedMul_input1") * enemyParameterOf(bountiesParameters, "enc-pirate-4", "ships_1_speedMul_input2")),
      },
    ],
    standingReq: enemyParameterOf(bountiesParameters, "enc-pirate-4", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "enc-pirate-4", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "enc-pirate-4", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "enc-pirate-4", "combatSeconds"),
    tactic: 'brawl',
    // 原 `escorts: 2`（旧路径僚机数）已由上方 `ships` 编成表达——**舰级路径不读该字段**。
    hidden: true,
    description: '低安遭遇模板：高危屠夫舰队（隐藏）。',
  }
