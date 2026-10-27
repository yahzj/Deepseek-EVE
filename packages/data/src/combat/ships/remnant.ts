/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'
import { FOE_DRONE_G_BEE_KIN, FOE_DRONE_G_BEE_PLA, FOE_DRONE_G_BEE_EXP } from '../../foe-drones'

/** G 族 · 一档「围攻残兵舰」——orbit 环绕（层次词「外围围攻军」；数量型小艇）。 */
export const FOE_G_SWARM_SKIFF: FoeShipDef = {
  id: 'foe-g-swarm-skiff',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "gunCount"),
  name: '围攻残兵舰',
  family: 'G',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "speedRatio"), // 船长定值（全族一致）= 357 / 340
  hp: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "hp"), // 按档重排：T1 档基线 260 × 角色 0.60（数量型小艇）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "split_h") }, // 均衡型（= 迁移前实建比例）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "shotDmg"), // T1 档基线 39.5 × 角色 0.71 = 28.05 → 28
  hitRate: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "rangeMinM"), // = 烬火围攻战迁移前射程带（守恒）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "falloff"), // 守恒（迁移前实建 0.5）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-g-swarm-skiff", "dmgMix_explosive") },
  tactic: 'orbit',
}

/** G 族 · 二档「残响残舰」——orbit 环绕（层次词「残响残舰」）。 */
export const FOE_G_ECHO_REMNANT: FoeShipDef = {
  id: 'foe-g-echo-remnant',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "gunCount"),
  name: '残响残舰',
  family: 'G',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "speedRatio"), // = 310 / 295
  hp: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "hp"), // T2 档基线 480 × 角色 0.90（中坚残舰）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "shotDmg"), // T2 档基线 68 × 角色 0.70 = 47.6 → 48
  hitRate: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "rangeMinM"), // = 回音残舰迁移前射程带（守恒）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-g-echo-remnant", "dmgMix_explosive") },
  tactic: 'orbit',
}

/** G 族 · 三档「天底封锁舰」——orbit 环绕（层次词「最后据点」）；**族内唯一挂蜂群机的舰级**。 */
export const FOE_G_NADIR_LOCK: FoeShipDef = {
  id: 'foe-g-nadir-lock',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "gunCount"),
  name: '天底封锁舰',
  family: 'G',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "speedRatio"), // = 271 / 258
  hp: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "hp"), // T3 档基线 900 × 角色 1.20（据点主力）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "shotDmg"), // T3 档基线 124 × 角色 0.85 = 105.4 → 105
  hitRate: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "hitRate"), // 低安命中 +0.1（= 迁移前本卡实建命中，守恒）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "rangeMinM"), // = 天底静区封锁迁移前射程带（守恒）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "dmgMix_explosive") },
  tactic: 'orbit',
  // **蜂群机 2 架**（船长「挂在巡洋舰上。2 架。无后备」）——**P-20a 收口（2026-09-12 船长选「丙」：换系）**：
  // 两个机位 = **动能 + 等离子**（等离子机型 `foe-drone-g-bee-pla` 由"已备未挂"转为**实挂**，
  // 并由体检「机群与防空契约」硬守卫钉住——防日后又被换回去）；
  // **爆炸系改由母舰炮台承担**（本卡 `dmgMix { kinetic 8, explosive 2 }` 未动 ⇒ 卡整体三系齐备）；
  // 爆炸机型 `-exp` 转为已备未挂（体检汇总行列出）。
  drones: [
    { drone: FOE_DRONE_G_BEE_KIN, count: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "drones_0_count") },
    { drone: FOE_DRONE_G_BEE_PLA, count: enemyParameterOf(foeShipsParameters, "foe-g-nadir-lock", "drones_1_count") },
  ],
  // ⚠ **不写 `droneReserve`** ⇒ 无后备机库（船长「无后备」）。
}

/** G 族 · 四档「亡军战列舰」——**已启用**（2026-09-15 船长：「**G族添加战列舰动能伤害为主。**」＋
 *  「**G族战列可以添加机群。**」→（问"挂几架"）「**挂**」）。
 *
 * **沿革**：2026-09-12 船长「**G组分5档。从护卫舰到战列舰。战列舰暂时空置。战列舰先建壳体。**」
 * ⇒ 当时只登记壳体、无卡引用；**2026-09-15 由本批启用**（洞内 G 族深层卡「残军战列线」的主体）。
 *
 * **数值一字未动**（壳体当初就是按档基线 × 角色 + 全族 1.05 速 + orbit 定好的）：
 * T4 1,600 × 1.10 = **1,760** 血 / 240 × 0.90 = **216** 单发 / 实速 **215** / 射程 600~7,200 /
 * `dmgMix { kinetic: 8, explosive: 2 }`（= 船长要的"**动能伤害为主**"，本就如此）。
 *
 * **新增：蜂群机 ×3、无后备**（船长「挂」）——三系齐备（**动能 + 等离子 + 爆炸**）：
 * ① 与「天底封锁舰」的 2 架口径同源（都无后备）；② **P-20a 的"等离子系必须在场"**仍然满足；
 * ③ 顺带**消掉体检长期那条「已备未挂机型：蜂群机（`foe-drone-g-bee-exp`）」警告**
 * （三种机型终于全有挂载点——G 族"三系无人机"的族格由本条兑现）。 */
export const FOE_G_EXILE_BATTLESHIP: FoeShipDef = {
  id: 'foe-g-exile-battleship',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "gunCount"),
  name: '亡军战列舰',
  family: 'G',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 战列舰（2026-09-15 起**已启用**，不再是空置壳体）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "speedRatio"), // = 215 / 205
  hp: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "hp"), // T4 档基线 1,600 × 角色 1.10
  split: { s: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "shotDmg"), // T4 档基线 240 × 角色 0.90
  hitRate: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "dmgMix_explosive") }, // 船长「动能伤害为主」——与壳体原值一致，未动
  tactic: 'orbit',
  // **蜂群机 ×3（三系齐备、无后备）**：船长 2026-09-15「挂」
  drones: [
    { drone: FOE_DRONE_G_BEE_KIN, count: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "drones_0_count") },
    { drone: FOE_DRONE_G_BEE_PLA, count: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "drones_1_count") }, // P-20a：G 族挂机群必须含等离子系
    { drone: FOE_DRONE_G_BEE_EXP, count: enemyParameterOf(foeShipsParameters, "foe-g-exile-battleship", "drones_2_count") }, // 原"已备未挂"⇒ 本批挂上，体检警告随之消失
  ],
}

/**
 * **G 族 · T3「残军补给舰」——敌方后勤舰**（船长 2026-09-16：「**敌人后勤舰则是将 50% 的自身DPS转换为修理值**」
 * ＋「**敌方后勤舰新增一艘舰船**」＋「**T3巡洋**」＋「**先不进卡**」）。
 *
 * **备用壳体（先把舰建出来，暂不进任何卡）**——照 2026-09-12「亡军战列舰先建壳体、后启用」的先例：
 * 上场时只需把它写进某张 G 族卡的 `ships`（编成改动须过船长），机制与用例**本批已全部就位**。
 *
 * 数值（全程按族内既有算法，便于复核）：
 * - 档位 **T3 巡洋**（与我方「亡军后勤舰」镜像；也接替族内 T3 的"据点主力"位）；
 * - 血 **1080** = T3 档基线 900 × 角色 **1.20**（支援型必须在场活下来，与天底封锁舰同厚）；
 * - 单发 **62** = T3 档基线 124 × 角色 **0.50**（**火力让位给修理**）；
 * - 命中 **0.85**（后勤不靠命中；族内 T3 的 0.95 是那张低安卡的迁移守恒值）、装填 4000ms、射程带 **502~6604**；
 * - 速度 = 族定值 `speedRatio 1.05` ⇒ 实速 **271**（T3 基准 258）；战术 orbit；
 * - 主系 **动能 8 : 高爆 2**（G 族族格「动能伤害为主」）；
 * - **`repairPct: 0.5`** ⇒ 名义 DPS = 62 × 1000 ÷ 4000 = **15.5/s** ⇒ **修理 7.75 HP/s = 38.75 / 跳（5 秒）**，
 *   开火实收 ×0.5；修理目标**永不含任何后勤舰（含自己）**（船长 2026-09-16 补充裁定）。
 * - ⚠ **不挂机群**（后勤舰不带机群；`FOE_DRONES` 的"已备未挂"计数不受影响）。
 */
export const FOE_G_REMNANT_TENDER: FoeShipDef = {
  id: 'foe-g-remnant-tender',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "gunCount"),
  name: '残军补给舰',
  family: 'G',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰（船长 2026-09-16：「T3巡洋」）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "speedRatio"), // G 族族定值（实速 = 258 × 1.05 = 271）
  hp: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "hp"), // T3 档基线 900 × 角色 1.20（支援型要活下来）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "shotDmg"), // T3 档基线 124 × 角色 0.50（火力让位给修理）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "hitRate"), // 后勤不靠命中（族内 T3 的 0.95 属那张卡的迁移守恒值）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "rangeMinM"), // 与同族同档（天底封锁舰）同带
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "dmgMix_explosive") }, // 族格：G 族动能伤害为主
  tactic: 'orbit',
  // **敌方后勤舰**：50% 名义 DPS 转修理（见字段注释与 `types.ts` 的 `FoeShipDef.repairPct`）
  repairPct: enemyParameterOf(foeShipsParameters, "foe-g-remnant-tender", "repairPct"),
}

/** A 族 · **新舰「劫掠电子舰」**（船长 2026-09-16：「新增A族敌人劫掠电子舰…护卫舰档位，**闪避提高，血量降低**」）
 * —— 电子战支援：**血低（档基线 260 × 0.70 = 182）· 闪避高（0.30，族内其余舰级统一 0.12）· 火力弱（39.5 × 0.76 = 30）**，
 * 靠两件挂载件吃饭：**劫掠冲锋推进器**（×1.6 / 30 秒）＋**劫掠捕获网**（首次开火即钉住目标）。
 * 速度 = 1 护卫舰基准 340 × `1.10` = **374** m/s（仍满足 A 族「每档高于本档基准」）；
 * 射程带沿用劫掠护卫舰的口径（**上限** ±15% = 4275；**近界 = 船长 2026-09-20 特批 1**）；
 * 战术 `orbit`（中距环绕支援）。
 * ⚠ **舰级不带任何挂载件**（2026-09-19 船长：「**海盗电子舰的冲锋也移除，只在洞内单独挂载**」）——
 * 两件一律写在「海盗战团」的**条目**上，与 A 族另三条舰级同口径；本舰不外借（只服务深层战团）。
 * ⚠ 有效挂载是 `条目 ?? 舰级`（**替换**不是叠加）⇒ 条目必须**两件都写**，只写一件会顶掉另一件。 */
export const FOE_SHIP_PIRATE_RAIDER: FoeShipDef = {
  id: 'foe-pirate-raider',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "gunCount"),
  name: '劫掠电子舰',
  family: 'A',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "speedRatio"), // = 374 / 340
  hp: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "hp"), // 档基线 260 × 角色 0.70 = 182（船长「血量降低」⇒ 低于标准护卫 364、略高于数量型小艇 156）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "shotDmg"), // 档基线 39.5 × 角色 0.76 = 30.02 → **30**（支援型，火力不是它的活）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "rangeMinM"), // 船长 2026-09-20「除劫掠狙击舰外，A 族最小射程改为 1」（原沿用护卫舰的 −15% 值 326）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "dmgMix_explosive") },
  tactic: 'orbit',
  evasion: enemyParameterOf(foeShipsParameters, "foe-pirate-raider", "evasion"), // **闪避提高**（舰级覆写；族内其余舰级缺省 0.12）
  // 挂载件（冲锋 + 捕获网）**一律写在深层「海盗战团」的条目上**——见上方注释与船长的 2026-09-19 裁定
}
