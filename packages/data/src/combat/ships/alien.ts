/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf, FOE_MOUNT_IDS } from '@whale/core'
import { L10N } from '../../l10n/table'
import foeShipsParameters from '../../static/foeShips.json'
import { C_FAMILY_RESISTS } from './constants'
import { FOE_DRONE_C_JAWCLAW, FOE_DRONE_C_SPORE } from '../../foe-drones'

export const FOE_ALIEN_ACID_BURSTER: FoeShipDef = {
  id: 'foe-alien-acid-burster', name: L10N['ship.alien.001']!.zh, family: 'C',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-acid-burster', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "hullClassTier") as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "speedRatio_input0") / enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "speedRatio_input1"), hp: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "hp"), split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "split_h") },
  ...C_FAMILY_RESISTS, shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "shotDmg"), gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "gunCount"), hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "hitRate"), reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "rangeMinM"), rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "rangeMaxM"), falloff: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "falloff"), dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "dmgMix_kinetic") }, tactic: 'brawl',
  acidBurst: { attackRangeM: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "acidBurst_attackRangeM"), deathRangeM: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "acidBurst_deathRangeM"), corrosionPct: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "acidBurst_corrosionPct"), damage: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "acidBurst_damage"), hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-acid-burster", "acidBurst_hitRate") }, mounts: [FOE_MOUNT_IDS.acidCharge, FOE_MOUNT_IDS.acidShield],
}

export const FOE_ALIEN_BROOD_WORKER: FoeShipDef = {
  id: 'foe-alien-brood-worker', name: L10N['ship.alien.002']!.zh, family: 'C',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-brood-worker', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "hullClassTier") as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "speedRatio_input0") / enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "speedRatio_input1"), hp: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "hp"), split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "split_h") },
  ...C_FAMILY_RESISTS, shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "shotDmg"), gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "gunCount"), hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "hitRate"), reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "rangeMinM"), rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "rangeMaxM"), falloff: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "falloff"), blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "dmgMix_explosive") }, energyForm: 'spit', tactic: 'brawl', repairPct: enemyParameterOf(foeShipsParameters, "foe-alien-brood-worker", "repairPct"),
  mounts: [FOE_MOUNT_IDS.chargeSwarmT3],
}

export const FOE_ALIEN_HIVEBACK: FoeShipDef = {
  id: 'foe-alien-hiveback', name: L10N['ship.alien.003']!.zh, family: 'C',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-hiveback', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "hullClassTier") as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "speedRatio_input0") / enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "speedRatio_input1"), hp: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "hp"), split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "split_h") },
  ...C_FAMILY_RESISTS, shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "shotDmg"), gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "gunCount"), hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "hitRate"), reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "rangeMinM"), rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "rangeMaxM"), falloff: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "falloff"), blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "dmgMix_explosive") }, energyForm: 'spit', tactic: 'brawl',
  drones: [{ drone: FOE_DRONE_C_JAWCLAW, count: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "drones_0_count") }], droneFireShare: enemyParameterOf(foeShipsParameters, "foe-alien-hiveback", "droneFireShare"),
  mounts: [FOE_MOUNT_IDS.hivebackCharge, FOE_MOUNT_IDS.broodControl, FOE_MOUNT_IDS.hivebackHatchery],
}

export const FOE_ALIEN_BROODMOTHER: FoeShipDef = {
  id: 'foe-alien-broodmother', name: L10N['ship.alien.004']!.zh, family: 'C',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-broodmother', 'evasion'),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "hullClassTier") as 1 | 2 | 3 | 4 | 5), speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "speedRatio_input0") / enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "speedRatio_input1"), hp: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "hp"), split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "split_h") },
  ...C_FAMILY_RESISTS, shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "shotDmg"), gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "gunCount"), hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "hitRate"), reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "rangeMinM"), rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "rangeMaxM"), falloff: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "falloff"), blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "dmgMix_explosive") }, energyForm: 'spit', tactic: 'brawl',
  drones: [{ drone: FOE_DRONE_C_JAWCLAW, count: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "drones_0_count") }], droneFireShare: enemyParameterOf(foeShipsParameters, "foe-alien-broodmother", "droneFireShare"),
  mounts: [FOE_MOUNT_IDS.broodmotherCharge, FOE_MOUNT_IDS.broodControl, FOE_MOUNT_IDS.broodmotherHatchery],
}

/** C 族 · 一档「畸变幼虫」——裂谷畸变体的**幼体**，brawl 贴脸撕咬（服务：裂谷畸变体猎杀令 58、
 * 噬口猎杀令 80）。舰种档由 T3 巡洋**下落为 T1 护卫舰**（船长族级结构修正：C 族只留
 * 「护卫舰级 2 种（星髓幼虫 / 畸变幼虫）+ 驱逐级 1 种（星髓成虫）+ T4 巨兽」）。
 *
 * **按档重排（甲案）**：T1 档基线 260 / 39.5 × 角色 **1.00 / 1.10**（标准近战虫）= **260 / 43**。
 * 速度 = 1 护卫舰基准 340 × **`1.6`** = **544**（船长 2026-09-11「**两种幼虫提速倍率 1.6**」；
 * 远高于 A 族同档最高 391，兑现「C 族速度比 A 海盗还快」）。
 * 其余字段 = 迁移前的现状建档值：命中 0.95 · 射程带 **1~2552** · 远端衰减 0.5 · 近盲 0.3 · 装填 4000ms ·
 * 血型均衡（= 裂谷卡 `defProfile balanced`）；主系**等离子** 8:2（C 族酸液签名）。
 * 形态 = `'spit'`（**能量掷命中**）。**逐卡目标值由卡的 `hpMul`/`dmgMul` 反算**（舰级值只是档案锚）。
 * **冲锋**（2026-09-14 船长：「给小虫子添加冲锋，倍率为 1.5」）：`foeCanCharge` + `foeChargeMul: 1.5`。
 * ⚠ **这条不是洞内的那条**（船长 2026-09-16 戊案「现状即设计，不改」）：544 m/s 的幼虫原本是洞内
 * C 族三卡的主力，"洞内被贴上拉不开距离"的历史读数出自那一版；**「C 族三卡改编成」之后幼虫已从
 * 洞内三卡退场**（改由星髓成虫 398 / 孢群异虫 400 / 噬口巨兽 297 出场，仍留悬赏线）。
 * 机制层面的来龙去脉见 `combat.updateFoeCharge` 的 2026-09-16 注记。
 * 倍率 = **1.5**（本舰 T1 ⇒ 按档阶梯 `ALIEN_CHARGE_MUL_BY_TIER`；2026-09-16 全族按档口径，值不变）。 */
export const FOE_ALIEN_RIFT: FoeShipDef = {
  id: 'foe-alien-rift-larva',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-rift-larva', 'evasion'),
  gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "gunCount"),
  name: '畸变幼虫',
  family: 'C',
  ...C_FAMILY_RESISTS, // C 族族抗性：三层各 25% 爆炸抗（船长 2026-09-15，见常量注释）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰（**由 T3 巡洋下落一档**）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "speedRatio"), // = 544 / 340（船长「两种幼虫提速倍率 1.6」）
  hp: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "hp"), // 按档重排：T1 档基线 260 × 角色 1.00（标准近战虫）= **260**
  split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "split_h") }, // 均衡型（= 裂谷卡 defProfile balanced）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "shotDmg"), // T1 档基线 39.5 × 角色 1.10 = 43.45 → **43**
  hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "rangeMaxM"), // 缺省 = 裂谷卡的带；噬口卡的条目覆写为 1~2713
  //   ⚠ 沿革：2026-09-14 曾「全族 +1000 射程」（→ 3552），同日**船长又令回滚**（「可以回滚C族敌人射程增加的修改」）
  //   ⇒ 回到本值；卡的条目覆写与 `desireRangeM` 钉子一并撤回
  falloff: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-rift-larva", "dmgMix_explosive") }, // 主系**等离子**（C 族酸液签名）
  energyForm: 'spit', // 能量·掷命中（裁定⑤）
  tactic: 'brawl',
  // **冲锋**（2026-09-14 船长：「给小虫子添加冲锋，倍率为 1.5」）：小虫也吃冲锋，倍率 1.5
  // （巨兽 3）——解除 = **自身炮台命中我方**（或压到期望交距），随后冷却 10 秒；逐单位独立。
    // **冲锋挂载件**（2026-09-16 船长：「能否将冲锋设置成类似舰船装备的挂载物？」）——按档倍率 1.5 / 冷却 10 秒
    mounts: [FOE_MOUNT_IDS.chargeSwarmT1],
}

/** C 族 · 一档「星髓幼虫」——星髓虫群的**幼体**、厚甲筑巢（服务：深渊之门卫队 45、星髓虫群 72）。
 * 舰种档由 T3 巡洋**下落为 T1 护卫舰**（船长族级结构修正）。
 *
 * **按档重排（甲案）**：T1 档基线 260 / 39.5 × 角色 **0.80 / 0.80**（群袭脆虫：靠数量不靠单体）= **208 / 32**。
 * 速度 = 1 护卫舰基准 340 × **`1.6`** = **544**（船长「两种幼虫提速倍率 1.6」）。
 * 其余字段 = 迁移前的现状建档值：**命中 0.95**（C 族**不保留光束必中**：能量武器正常掷命中，
 * 命中随距离衰减 + 吃守方回避——这是星髓那张卡唯一的难度改动）· 射程带 **1~2655** ·
 * 远端衰减 0.5 · 近盲 0.3 · 装填 4000ms · 血型**装甲**（= 星髓卡 `defProfile armor`）；
 * 主系**等离子** 8:2。形态 = `'spit'`（**能量掷命中**）。
 * ⚠ 深渊之门卫队卡的条目覆写：血型**护盾**（卡面 shield）· 命中 **0.90** · **纯等离子** · 射程 1~2600。
 * **冲锋**（2026-09-14 船长：「给小虫子添加冲锋，倍率为 1.5」）：`foeCanCharge` + `foeChargeMul: 1.5`。
 * 倍率 = **1.5**（本舰 T1 ⇒ 按档阶梯 `ALIEN_CHARGE_MUL_BY_TIER`；2026-09-16 全族按档口径，值不变）。 */
export const FOE_ALIEN_STARCORE: FoeShipDef = {
  id: 'foe-alien-starcore-larva',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-starcore-larva', 'evasion'),
  gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "gunCount"),
  name: '星髓幼虫',
  family: 'C',
  ...C_FAMILY_RESISTS, // C 族族抗性：三层各 25% 爆炸抗（船长 2026-09-15，见常量注释）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰（**由 T3 巡洋下落一档**）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "speedRatio"), // = 544 / 340（船长「两种幼虫提速倍率 1.6」）
  hp: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "hp"), // 按档重排：T1 档基线 260 × 角色 0.80（群袭脆虫）= **208**
  split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "split_h") }, // 装甲型（= 星髓卡 defProfile armor；深渊之门卡条目覆写为护盾）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "shotDmg"), // T1 档基线 39.5 × 角色 0.80 = 31.6 → **32**
  hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "hitRate"), // 掷命中（C 族不保留光束必中）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "rangeMaxM"), // 缺省 = 星髓卡的带；深渊之门卡条目覆写为 1~2600
  //   ⚠ 沿革：2026-09-14 曾「全族 +1000」（→ 3655），同日**船长又令回滚** ⇒ 回到本值
  falloff: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-larva", "dmgMix_explosive") }, // 等离子主
  energyForm: 'spit',
  tactic: 'brawl',
  // **冲锋**（2026-09-14 船长：「给小虫子添加冲锋，倍率为 1.5」）：星髓幼虫同样吃冲锋、倍率 1.5
    mounts: [FOE_MOUNT_IDS.chargeSwarmT1],
}

/**
 * C 族 · 四档「噬口巨兽」——**T4 战列舰档的'生物巨兽'**，也是**全族唯一的稀有头目**
 * （服务：噬口猎杀令 80 的第 3 波 ×1）。
 *
 * **稀有头目**（船长 2026-09-11）：「**只有噬口有头目出现**」「在设定上，**出现稀少**，和海盗头目
 * 那种到处都是的不一样，**因此也更加强大**」「**首领血量占比提高到 80%**」——
 * 「稀少」由**全族只此一条舰级 + 只此一张卡的一个单位**表达（`elite: true` → 显示名「精锐噬口巨兽」），
 * 「更强大」由**卡上 80% 血量 + 80% 火力**表达（数值见 `anomalies.ts` 的噬口卡）。
 *
 * **按档重排（甲案）**：T4 档基线 1600 / 240 × 角色 **1.00 / 1.00**（稀有巨兽）= **1600 / 240**
 * （原 922 / 167 是卡锚；现由卡的 `hpMul`/`dmgMul` 反算回目标值）。
 * 速度 = **4 战列舰基准 205 × `297/205` = 297**（船长 2026-09-11 先「巨兽提速降为 1.35」（= 277），
 * 看过实测后「**将首领速度单独上调 20 点**」⇒ **297**；仍是族内唯一破例的慢档），
 * 并**给巨兽开启之前做过的冲锋能力**补偿其慢——`foeCanCharge: true`（**2026-09-14 船长定倍率 3**：
 * 「将大虫子的冲锋倍率改为 3」；解除 = **自身炮台命中我方** 或 压到期望交距，随后冷却 10 秒；逐单位独立），
 * 见 `combat.updateFoeCharge` 与 `docs/design/foe-faction-c-alien-20260911.md` §十）。
 * 射程带 **1~2,713**（船长 2026-09-11 当日先令「**巨兽射程增加**」到 4,000，看过实测后**随即「回收射程加成」**
 * ⇒ **回到原值 2,713**，与全族同档一致、**不再覆盖标准站位 3,220 m**）。⚠ **期望交距与开战距离都不动**：
 * 那两个量由「波 0 编制的首个单位」即**畸变幼虫**的带（1~2,713）锚定（小虫排在末波之前），
 * 故「全队想站的位置仍是 **543 m**」（见设计稿 §十 三）。
 * 其余字段 = 迁移前的现状建档值：命中 0.95 · 远端衰减 0.5 · 近盲 0.3 · 装填 4000ms ·
 * 血型均衡（噬口卡 `defProfile` 未写 = 缺省）；主系**等离子** 8:2。形态 = `'spit'`。 */
export const FOE_ALIEN_MAW: FoeShipDef = {
  id: 'foe-alien-maw',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-maw', 'evasion'),
  gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "gunCount"),
  name: '噬口巨兽',
  family: 'C',
  ...C_FAMILY_RESISTS, // C 族族抗性：三层各 25% 爆炸抗（船长 2026-09-15，见常量注释）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-maw", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 战列舰（**巨兽档**：须登记在 ALIEN_BEAST_SHIP_IDS，契约守卫）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "speedRatio_input0") / enemyParameterOf(foeShipsParameters, "foe-alien-maw", "speedRatio_input1"), // = **297**（船长 2026-09-11「将首领速度**单独上调 20 点**」：277 → 297；T4 仍是族内唯一破例的慢档）
  hp: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "hp"), // 按档重排：T4 档基线 1600 × 角色 1.00（稀有巨兽）= **1600**
  split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "split_h") }, // 均衡型（卡面未写 defProfile = 缺省）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "shotDmg"), // T4 档基线 240 × 角色 1.00 = **240**
  hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "rangeMaxM"), // 沿革：曾令「巨兽射程增加」（4000）→ 实测后**「回收射程加成」**回 2713（不再覆盖标准站位 3,220m）
  //   → 2026-09-14 曾「全族 +1000」（3713）→ **同日船长又令回滚**（「可以回滚C族敌人射程增加的修改」）⇒ 回到本值
  falloff: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-maw", "dmgMix_explosive") },
  energyForm: 'spit',
  tactic: 'brawl',
  elite: true, // 全族唯一的稀有头目（显示名「精锐噬口巨兽」）
  // 倍率 = **3**（本舰 T4 ⇒ 按档阶梯 `ALIEN_CHARGE_MUL_BY_TIER`；2026-09-16 船长
  // 「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」后**维持 3**，与 2026-09-14 裁定逐字一致）
    mounts: [FOE_MOUNT_IDS.chargeSwarmT4],
}

/**
 * C 族 · 二档「星髓成虫」——星髓虫群的**成体**、虫群的中坚（服务：星髓虫群 72 的**末波** ×3）。
 *
 * 船长族级结构修正：「**驱逐级一种，星髓成虫**」+「**星髓成虫给第三张卡最后一波，血量占比要调整**」
 * ⇒ 本条舰级**只服务星髓虫群那一张卡**的最后一波（前两波是星髓幼虫），
 * 血占比由卡的 `hpMul` 表达（幼虫:成虫 = **1:3**，即两条舰级的档基线比 208:624，
 * 于是全卡共用**同一个血量倍率** `1530 ÷ (7×208 + 3×624)`）。
 *
 * **按档重排（甲案）**：T2 档基线 480 / 68 × 角色 **1.30 / 0.82**（中坚成虫）= **624 / 56**。
 * 速度 = 2 驱逐舰基准 295 × **`1.35`** = **398**（高于 A 族同档最高 325）。
 * 其余字段 = 迁移前的现状建档值：命中 0.95 · 射程带 **1~2655** · 远端衰减 0.5 · 近盲 0.3 · 装填 4000ms ·
 * 血型**装甲**（= 星髓卡 `defProfile armor`）；主系**等离子** 8:2。形态 = `'spit'`。
 * **冲锋**（2026-09-14 船长：「给小虫子添加冲锋，倍率为 1.5」）：`foeCanCharge` + `foeChargeMul: 1.5`。 */
export const FOE_ALIEN_STARCORE_ADULT: FoeShipDef = {
  id: 'foe-alien-starcore-adult',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-starcore-adult', 'evasion'),
  gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "gunCount"),
  name: '星髓成虫',
  family: 'C',
  ...C_FAMILY_RESISTS, // C 族族抗性：三层各 25% 爆炸抗（船长 2026-09-15，见常量注释）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰（C 族唯一的驱逐档）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "speedRatio"), // = 398 / 295（船长「提速倍率 1.35」；高于 A 族同档 325）
  hp: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "hp"), // 按档重排：T2 档基线 480 × 角色 1.30（中坚成虫）= **624**
  split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "split_h") }, // 装甲型（= 星髓卡 defProfile armor）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "shotDmg"), // T2 档基线 68 × 角色 0.82 = 55.76 → **56**
  hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "rangeMaxM"),
  //   ⚠ 沿革：2026-09-14 曾「全族 +1000」（→ 3655），同日**船长又令回滚** ⇒ 回到本值
  falloff: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-starcore-adult", "dmgMix_explosive") },
  energyForm: 'spit',
  tactic: 'brawl',
  // **冲锋**（2026-09-14 船长：「给小虫子添加冲锋，倍率为 1.5」）：星髓成虫同样吃冲锋；
  // 倍率 **1.5 → 2**（2026-09-16 船长「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」⇒
  // 按档阶梯 `ALIEN_CHARGE_MUL_BY_TIER`：本舰 T2 ⇒ **2**）
    mounts: [FOE_MOUNT_IDS.chargeSwarmT2],
}

/** C 族 · 三档「**孢群异虫**」——**无人机舰**（2026-09-15 船长：「**C组添加一艘巡洋舰，为无人机舰，
 *  释放蜂群机。炮台同样是近战。**」；同日补：「**孢群机主要是装甲和结构，攻坚机模板，射程6000，
 *  需要专门的无人机SVG(属于虫族)**」）。
 *
 * | 项 | 值 | 口径 |
 * |---|---|---|
 * | 舰种档 | **T3 巡洋舰** | C 族允许 1~4 档 |
 * | 血 / 单发 | **1,125 / 87** | T3 档基线 900 / 124 × 角色 **1.25 / 0.70**（母舰偏厚；炮台让位给机群） |
 * | 速度 | **300 m/s**（`speedRatio 300/258 ≈ 1.16`） | 船长 2026-09-16「**孢群异虫速度削减到300**」⇒ **C 族唯一"允许慢"例外**（`ALIEN_SLOW_SHIP_IDS`）：无人机母舰不追人，火力由机群投送 |
 * | 血型 | 均衡 0.34/0.33/0.33 | C 族生物软体（畸变幼虫 / 噬口巨兽同款） |
 * | 武器 | 等离子 8 : 爆炸 2 · **近战** 1~2,700m · `brawl` | 船长「**炮台同样是近战**」＋ C 族族规（贴脸 brawl） |
 * | 形态 | `energyForm: 'spit'`（能量·**掷命中**） | C 族四档全部掷命中（不保留光束必中） |
 * | 机群 | **孢群机 ×3**（无后备） | 船长「释放蜂群机」；**不写 `droneReserve`** ⇒ 无后备（虫海靠数量不靠补位） |
 * | 火力占比 | `droneFireShare 0.6` | A5 守恒：**机群拿 60%、炮台只剩 40%** ⇒ 显式表达"母舰让位、机群为主" |
 * | 冲锋 | **×2.5**（T3 档） | 船长 2026-09-16「C族全部添加冲锋，按级别 1.5/2/2.5/3/4」⇒ 此前**唯一不具冲锋资格**的 C 族舰级补上 |
 *
 * ⚠ **不是"多一条 C 族卡"那么简单**：它是 C 族**唯一带机群**的舰级，也是洞内 C 族深层卡的主体。 */
export const FOE_ALIEN_SPORE_HIVE: FoeShipDef = {
  id: 'foe-alien-spore-hive',
  evasion: enemyParameterOf(foeShipsParameters, 'foe-alien-spore-hive', 'evasion'),
  gunCount: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "gunCount"),
  name: '孢群异虫',
  family: 'C',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "speedRatio_input0") / enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "speedRatio_input1"), // = **300 m/s**（船长 2026-09-16「孢群异虫速度削减到300」；改前 1.55 = 400）
  //   ⚠ **C 族唯一的"允许慢"例外**（登记在 `ALIEN_SLOW_SHIP_IDS`）：族格口径要求"同档实速高于 A 族
  //   最快（海盗头目舰 374）"，本舰按船长裁定不适用——理由见该白名单的注释（无人机母舰不追人）。
  hp: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "hp"), // T3 档基线 900 × 角色 1.25
  split: { s: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "split_h") }, // 均衡型
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "shotDmg"), // T3 档基线 124 × 角色 0.70（近战副炮，主力在机群）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "rangeMaxM"), // C 族贴脸口径（畸变幼虫 2552 / 星髓系 2655）
  falloff: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "blindDmgMul"),
  dmgMix: { plasma: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "dmgMix_plasma"), explosive: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "dmgMix_explosive") }, // C 族签名（酸液 / 孢子）
  tactic: 'brawl', // 船长「炮台同样是近战」
  energyForm: 'spit', // C 族四档一律"能量·掷命中"
  ...C_FAMILY_RESISTS, // C 族族抗性：三层各 25% 爆炸抗（船长 2026-09-15；本舰 2026-09-15 批 2 加入 ⇒ 同族同口径）
  // **释放孢群机**（3 架、无后备）；`droneFireShare` = 机群占总火力 60%（A5 守恒，见舰级注释）
  drones: [{ drone: FOE_DRONE_C_SPORE, count: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "drones_0_count") }],
  droneFireShare: enemyParameterOf(foeShipsParameters, "foe-alien-spore-hive", "droneFireShare"),
  // **冲锋**（船长 2026-09-16：「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」）：
  // 本舰 T3 ⇒ 按档阶梯 `ALIEN_CHARGE_MUL_BY_TIER` 取 **2.5**（此前是族内唯一**不**具冲锋资格的舰级）。
  // ⚠ 它的 400 m/s 是全族最快（`speedRatio 1.55`）⇒ 冲锋期 **1,000 m/s**，是洞内"想拉开距离"最硬的一堵墙。
    mounts: [FOE_MOUNT_IDS.chargeSwarmT3],
}
