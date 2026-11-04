/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf, FOE_MOUNT_IDS } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'
import { L10N } from '../../l10n/table'

/** D 族 · 一档「幽灵舰」——外围巡哨的残影（服务：幽灵舰信号 46）。
 * **按档重排**：T2 档基线 480 / 68 × 角色 0.90 / 0.70 = **432 / 48**（档案锚，逐卡由倍率反算）。
 * 速度 = 2 驱逐舰基准 295 × **`1.10`** = **325**（船长定；外围哨戒是全族唯一还要机动的档）。
 * 射程带 562~7,000 = **中程**（船长「幽灵舰为中程」；原 1,752~13,432 是旧 kite 口径，随战法收窄）。
 * 形态 = **`beam` 光束必中**（「靠必中与射程立身」；本族**保留必中**，不走 C 族那套掷命中）。 */
export const FOE_D_GHOST: FoeShipDef = {
  id: 'foe-d-ghost',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "gunCount"),
  name: '幽灵舰',
  family: 'D',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-d-ghost", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰（船长「1 驱逐 2 巡洋」里的那个"1"）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "speedRatio"), // = 325 / 295（船长「幽灵舰提速到 110%」）
  hp: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "hp"), // T2 档基线 480 × 角色 0.90（巡哨残影）= 432
  split: { s: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "split_h") }, // 护盾型（= 幽灵舰信号卡面 defProfile）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "shotDmg"), // T2 档基线 68 × 角色 0.70 = 47.6 → 48
  hitRate: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "rangeMinM"), // 族统一下限（避免"贴脸安全区"——见设计稿 §二 口径 4）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "rangeMaxM"),
  // **2026-09-19 船长「将D族单独调整，远端改为 0.2」**：D 族四条舰级 0.5 → 0.2（全族一齐改，卡面自动跟随）
  falloff: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-d-ghost", "dmgMix_kinetic") }, // 主系**等离子（能量）**：设定「以能量武器为主」
  energyForm: 'beam',
  tactic: 'orbit', // 中程（船长定）
}

/** D 族 · 二档「守墓长舰」——陵区守卫主力（服务：坟场守墓者 88、虚海守望者 88 两处陵区）。
 * **按档重排**：T3 档基线 900 / 124 × 角色 1.20 / 0.85 = **1,080 / 105**。
 * 速度 = 3 巡洋舰基准 258 × **`0.90`** = **232**（船长 2026-09-11：先「按正常算」= 258，
 * 后「**将守墓长舰速度下调至 0.9 倍率**」⇒ 258 × 0.9 = 232.2 → **232**）。
 * 射程带 **562~7,391**（**沿用现状上限，零变化**）。
 * 血型默认**装甲型**（= 坟场守墓者卡面）；虚海守望者卡的条目覆写为**均衡**（其卡面本是均衡）。 */
export const FOE_D_LONGSHIP: FoeShipDef = {
  id: 'foe-d-longship',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-d-longship", "gunCount"),
  name: '守墓长舰',
  family: 'D',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-d-longship", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-d-longship", "speedRatio"), // = **232** / 258（船长 2026-09-11「将守墓长舰速度下调至 **0.9** 倍率」；原 1.00 = 258）
  hp: enemyParameterOf(foeShipsParameters, "foe-d-longship", "hp"), // T3 档基线 900 × 角色 1.20（陵区守卫主力）= 1080
  split: { s: enemyParameterOf(foeShipsParameters, "foe-d-longship", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-d-longship", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-d-longship", "split_h") }, // 装甲型（= 坟场守墓者卡面；虚海卡条目覆写为均衡）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-d-longship", "shotDmg"), // T3 档基线 124 × 角色 0.85 = 105.4 → 105
  hitRate: enemyParameterOf(foeShipsParameters, "foe-d-longship", "hitRate"), // 光束必中
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-d-longship", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-d-longship", "rangeMinM"), // 船长 2026-09-11「守墓长舰的最短射程 +500」（562 → **1,062**）：古舰不贴脸
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-d-longship", "rangeMaxM"), // 沿用现状上限（零变化）
  falloff: enemyParameterOf(foeShipsParameters, "foe-d-longship", "falloff"), // 2026-09-19 船长：D 族远端统一 0.2（原 0.5）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-d-longship", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-d-longship", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-d-longship", "dmgMix_kinetic") },
  energyForm: 'beam',
  tactic: 'orbit', // 中程（沿用现状）
}

/** D 族 · 二档「静滞卫舰」——**静滞陵寝的守誓者**，全族最慢也最重（服务：穹顶守卫 96）。
 * **按档重排**：T3 档基线 900 / 124 × 角色 1.30 / 1.00 = **1,170 / 124**（血/单发都是族内最高）。
 * 速度 = 3 巡洋舰基准 258 × **`0.50`** = **129**（船长「静滞卫舰速度只有正常的 50%」）——
 * 全族最慢：**'守墓者从来不需要追人'**，它只从 12 km 外一直点名。
 * 射程带 562~**12,000** = **远程档全族最长**（船长「静滞卫舰改为远程」；守墓者长炮的招牌射程）。
 * ⚠ 下限仍取 562（**不抬**）：族规「不许 brawl」约束的是'它不主动贴上来'，
 * 不是'你贴上来它不打你'——「越界即清除」在射程上就该是'任何距离都打得到'。 */
export const FOE_D_STASIS: FoeShipDef = {
  id: 'foe-d-stasis',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "gunCount"),
  name: '静滞卫舰',
  family: 'D',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-d-stasis", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "speedRatio"), // = 129 / 258（船长「静滞卫舰速度只有正常的 50%」）
  hp: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "hp"), // T3 档基线 900 × 角色 1.30（静滞陵寝的守誓者）= 1170
  split: { s: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "split_h") }, // 均衡型（= 穹顶守卫卡面）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "shotDmg"), // T3 档基线 124 × 角色 1.00 = 124
  hitRate: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "hitRate"), // 光束必中
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "reloadMs"), // 船长 2026-09-11「静滞卫舰的攻击间隔**延长 10%**」：4000 → **4400ms**（单发 190 不变 ⇒ 实收 dps −9.1%）
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "rangeMinM"), // 船长 2026-09-11「穹顶守卫最短射程 +1,500」（562 → **2,062**）：族内**最不贴脸**的一档
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "rangeMaxM"), // 远程档最长（守墓者长炮）
  // **受击增程（炮台）**（2026-09-12 船长：「给 D 族静滞卫舰加入类似 E 族挨打加炮台射程的效果，
  // 不过仅影响所有静滞卫舰。挨打后射程增加 50%」）：挨打一次 ⇒ 本场所有静滞卫舰最远射程 ×1.5
  // ⇒ **12,000 → 18,000m**（近界 2,062 不动）。⚠ 与 E 族的机群增程是**两套独立机制**：
  // 那条是"整支敌队的机群 ×4"，本条**只作用于静滞卫舰自己**（同场的守墓长舰不受影响）。
  // 衰减口径（船长选乙）：原射程内读数一字不变，12 km 以外按同斜率继续衰减（18 km 处 ≈ ×0.20）。
    mounts: [FOE_MOUNT_IDS.gunRangeX15], // 炮台受击增程（2026-09-16 迁成挂载件：×1.5）
  falloff: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "falloff"), // 2026-09-19 船长：D 族远端统一 0.2（原 0.5）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-d-stasis", "dmgMix_kinetic") },
  energyForm: 'beam',
  tactic: 'kite', // 远程（船长定）
}

/** D 族 · 四档「**守墓王座舰**」——陵寝最深处的主力（2026-09-15 船长：「**D族添加一艘战列舰。
 *  用的是50%动能+50%能量的混合炮台。**」→ 逐条问答后改判「**按乙调整为 6:4**」⇒ **等离子 6 : 动能 4**；
 *  同日另一处纠正：「**D组不应该是以护盾为主吗**」⇒ 血型 = **护盾型**）。
 *
 * | 项 | 值 | 口径 |
 * |---|---|---|
 * | 舰种档 | **T4 战列舰** | D 族新增第 4 档（旧口径「1 驱逐 2 巡洋，**更高级的船还没出**」由本批兑现） |
 * | 血 / 单发 | **1,840 / 252** | T4 档基线 1,600 / 240 × 角色 **1.15 / 1.05**（族内最厚） |
 * | 速度 | **123 m/s**（`speedRatio 0.60`） | 族格「越往里越慢」的**新终点**（仍慢于静滞卫舰 129）；⚠ **不能取 0.40**——那会算出 82 m/s、比率 0.28，**掉出 D 族速带 0.40~1.15**（体检会红） |
 * | 血型 | **护盾型 0.5/0.25/0.25** | 船长 2026-09-15 纠正（与幽灵舰同款"陵墓护盾"语言） |
 * | 武器 | **等离子 6 : 动能 4** · `beam` **必中** · 命中 1 | 主系仍是等离子 ⇒ **保留 D 族"必中"**（不像平手口径会落到动能、变成掷命中实弹） |
 * | 射程 · 战术 | **1,400~9,600m** · `orbit` | 族规全远程（brawl 已退役）；比守墓长舰（1,062~7,391）更远、比静滞卫舰（2,062~12,000）近 |
 * | 机群 | 无 | D 族从不带机群 |
 *
 * ⚠ **混伤口径的一处新形态**：主系等离子 6 : 副系动能 4 ⇒ 通用混伤契约（"卡须主 8 : 副 2"）对它不适用
 * ⇒ 已按船长「**撞到的契约开白名单**」登记在 `FOE_SHIP_MIX_AUTHORITY_IDS`（**舰级口径优先**：
 * 卡面构成按"与主体一致"校验，不再套 8:2）。
 * ⚠ **不写 `gunRangeMulOnHit`**：炮台受击增程在体检里**只允许静滞卫舰**（船长 2026-09-12 指名）。
 * ⚠ **舰级挂「支援呼叫装置」**（船长 2026-09-19：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己
 * 最远射程之外时，增援2艘静滞卫舰。**」＋「因为延迟到场，所以需要一定补偿。**卡计算的实际威胁要*1.1**」）
 * ——本舰**只服务**洞内深层卡「陵墓王庭」，故挂舰级与挂条目等价（不外借 ⇒ 洞外零影响）；
 * 两支到场单位写在**那张卡的条目**上（`enterAt` ＋ `enterBranch`）。 */
export const FOE_D_THRONE: FoeShipDef = {
  id: 'foe-d-throne',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-d-throne", "gunCount"),
  name: '守墓王座舰',
  family: 'D',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-d-throne", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 战列舰（D 族新档）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-d-throne", "speedRatio"), // = 123 / 205（族格"越往里越慢"的新终点）
  hp: enemyParameterOf(foeShipsParameters, "foe-d-throne", "hp"), // T4 档基线 1,600 × 角色 1.15
  split: { s: enemyParameterOf(foeShipsParameters, "foe-d-throne", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-d-throne", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-d-throne", "split_h") }, // **护盾型**（船长「D组不应该是以护盾为主吗」）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-d-throne", "shotDmg"), // T4 档基线 240 × 角色 1.05
  hitRate: enemyParameterOf(foeShipsParameters, "foe-d-throne", "hitRate"), // 光束必中（舰级路径下不消费本字段，写 1 表意）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-d-throne", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-d-throne", "rangeMinM"), // 古舰不贴脸（逐档抬升 562 / 1062 / 1400 / 2062）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-d-throne", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-d-throne", "falloff"), // 2026-09-19 船长：D 族远端统一 0.2（原 0.5）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-d-throne", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-d-throne", "dmgMix_plasma"), kinetic: enemyParameterOf(foeShipsParameters, "foe-d-throne", "dmgMix_kinetic") }, // 船长「50%动能+50%能量的混合炮台」→ 改判「按乙调整为 6:4」
  energyForm: 'beam', // 主系仍是等离子 ⇒ 保留必中（D 族族格）
  tactic: 'orbit',
  // 支援呼叫装置（2026-09-19 船长）：开战 20 秒后按距离呼叫一支支援军（幽灵舰 / 静滞卫舰，见卡面条目）
  mounts: [FOE_MOUNT_IDS.supportCall],
}

export const FOE_D_INVASION_CRUISER: FoeShipDef = {
  id: 'foe-d-invasion-cruiser', name: L10N['ship.gravekeeper.001']!.zh, family: 'D',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'hullClassTier') as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'speedRatio'),
  hp: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'hp'),
  split: { s: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'split_s'), a: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'split_a'), h: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'split_h') },
  shotDmg: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'shotDmg'), gunCount: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'gunCount'),
  hitRate: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'hitRate'), reloadMs: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'reloadMs'),
  rangeMinM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'rangeMinM'), rangeMaxM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'rangeMaxM'),
  falloff: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'falloff'), blindDmgMul: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'blindDmgMul'),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'dmgMix_plasma'), kinetic: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-cruiser', 'dmgMix_kinetic') }, energyForm: 'beam', tactic: 'orbit',
  mounts: [FOE_MOUNT_IDS.dRebirthProtocol],
}

export const FOE_D_INVASION_BASTION: FoeShipDef = {
  id: 'foe-d-invasion-bastion', name: L10N['ship.gravekeeper.002']!.zh, family: 'D',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'hullClassTier') as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'speedRatio'),
  hp: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'hp'),
  split: { s: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'split_s'), a: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'split_a'), h: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'split_h') },
  shotDmg: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'shotDmg'), gunCount: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'gunCount'),
  hitRate: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'hitRate'), reloadMs: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'reloadMs'),
  rangeMinM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'rangeMinM'), rangeMaxM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'rangeMaxM'),
  falloff: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'falloff'), blindDmgMul: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'blindDmgMul'),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'dmgMix_plasma'), kinetic: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-bastion', 'dmgMix_kinetic') }, energyForm: 'beam', tactic: 'orbit',
  mounts: [FOE_MOUNT_IDS.dMausoleumArmor, FOE_MOUNT_IDS.dRangeDebuff],
}

export const FOE_D_INVASION_OATHKEEPER: FoeShipDef = {
  id: 'foe-d-invasion-oathkeeper', name: L10N['ship.gravekeeper.003']!.zh, family: 'D',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'hullClassTier') as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'speedRatio'),
  hp: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'hp'),
  split: { s: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'split_s'), a: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'split_a'), h: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'split_h') },
  shotDmg: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'shotDmg'), gunCount: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'gunCount'),
  hitRate: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'hitRate'), reloadMs: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'reloadMs'),
  rangeMinM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'rangeMinM'), rangeMaxM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'rangeMaxM'),
  falloff: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'falloff'), blindDmgMul: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'blindDmgMul'),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'dmgMix_plasma'), kinetic: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-oathkeeper', 'dmgMix_kinetic') }, energyForm: 'beam', tactic: 'kite',
  mounts: [FOE_MOUNT_IDS.dMausoleumArmor, FOE_MOUNT_IDS.dRebirthProtocol],
}

export const FOE_D_INVASION_ETERNAL_TOMB: FoeShipDef = {
  id: 'foe-d-invasion-eternal-tomb', name: L10N['ship.gravekeeper.004']!.zh, family: 'D',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'hullClassTier') as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'speedRatio'),
  // 船长2026-10-16改判：基础厚血参照既有入侵旗舰，共享池仍最后绝对覆写。
  hp: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'hp'),
  split: { s: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'split_s'), a: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'split_a'), h: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'split_h') },
  shotDmg: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'shotDmg'), gunCount: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'gunCount'),
  hitRate: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'hitRate'), reloadMs: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'reloadMs'),
  rangeMinM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'rangeMinM'), rangeMaxM: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'rangeMaxM'),
  falloff: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'falloff'), blindDmgMul: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'blindDmgMul'),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'dmgMix_plasma'), kinetic: enemyParameterOf(foeShipsParameters, 'foe-d-invasion-eternal-tomb', 'dmgMix_kinetic') }, energyForm: 'beam', tactic: 'orbit',
  mounts: [FOE_MOUNT_IDS.dCoatingArmor, FOE_MOUNT_IDS.dShieldCapacitor, FOE_MOUNT_IDS.dReconstruction],
}
