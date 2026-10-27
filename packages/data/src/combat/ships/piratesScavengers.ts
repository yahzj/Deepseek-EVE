/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'

/** A 族 · 一档「海盗快艇」——brawl 贴脸杂鱼。
 * 速度（2026-09-11 落地）= 1 护卫舰基准 340 × `1.15` = **391** m/s（高于本档基准 340，"快得起来才好突袭"）；
 * 射程 −15%：`1 ×0.85 → 1` / `2215 ×0.85 = 1882.75 → 1883`。 */
export const FOE_SHIP_PIRATE_SKIFF: FoeShipDef = {
  id: 'foe-pirate-skiff',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "gunCount"),
  name: '海盗快艇',
  family: 'A',
  evasion: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "evasion"), // 2026-09-24 船长令：A 族**除电子舰外** +10% 闪避（缺省 0.12 → 0.22）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "speedRatio"), // = 391 / 340
  hp: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "hp"), // 按档重排（甲案）：T1 档基线 260 × 角色 0.60（数量型小艇）= **156**；原 150（卡锚）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "shotDmg"), // T1 档基线 39.5 × 角色 0.71 = 28.05 → **28**（原 28）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "rangeMinM"), // 1 ×0.85 = 0.85 → 1（保留下限 1）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "rangeMaxM"), // 2026-09-11 船长定「**低威胁卡敌人射程延长到 2600**」（原 1883 = 2215 ×0.85 射程 −15% 值）
  falloff: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "blindDmgMul"),
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-pirate-skiff", "dmgMix_kinetic") },
  tactic: 'brawl',
}

/** A 族 · 二档「劫掠护卫舰」——orbit 环绕。
 * 速度 = 1 护卫舰基准 340 × `1.10` = **374** m/s（高于本档基准 340）；
 * 射程上限 −15%：`5029 ×0.85 = 4274.65 → 4275`；
 * **近界 = 船长 2026-09-20 特批 `1`**（原话「**将除劫掠狙击艇外的A族船，最小射程改为1.**」——
 * 全族贴脸，武器死区下沿取消；原按 −15% 推导为 `383 ×0.85 = 326`，该推导现在只对上限生效）。 */
export const FOE_SHIP_PIRATE_CORVETTE: FoeShipDef = {
  id: 'foe-pirate-corvette',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "gunCount"),
  name: '劫掠护卫舰',
  family: 'A',
  evasion: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "evasion"), // 2026-09-24 船长令：A 族**除电子舰外** +10% 闪避（缺省 0.12 → 0.22）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰（2026-09-11 追加裁决：本舰级**下落一档**到护卫舰，名与档一致）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "speedRatio"), // = 374 / 340
  hp: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "hp"), // 按档重排（甲案）：T1 260 × 角色 1.40（标准护卫）= **364**；原 365（卡锚）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "shotDmg"), // T1 39.5 × 角色 1.29 = 50.96 → **51**（原 51）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "rangeMinM"), // 船长 2026-09-20「除劫掠狙击舰外，A 族最小射程改为 1」（原 −15% 推导值 326）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "rangeMaxM"), // 5029 ×0.85 = 4274.65 → 4275
  falloff: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-pirate-corvette", "dmgMix_explosive") },
  tactic: 'orbit',
}

/** A 族 · 三档「劫掠狙击舰」——kite 拉距。
 * 速度 = 2 驱逐舰基准 295 × `1.10` = **325** m/s（高于本档基准 295——海盗"拉距也跑得快"）；
 * 射程 −15%：`1476 ×0.85 = 1254.6 → 1255` / `11316 ×0.85 = 9618.6 → 9619`。 */
export const FOE_SHIP_PIRATE_SNIPER: FoeShipDef = {
  id: 'foe-pirate-sniper',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "gunCount"),
  name: '劫掠狙击舰',
  family: 'A',
  evasion: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "evasion"), // 2026-09-24 船长令：A 族**除电子舰外** +10% 闪避（缺省 0.12 → 0.22）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰（2026-09-11 追加裁决：本舰级**下落一档**到驱逐舰）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "speedRatio"), // = 325 / 295
  hp: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "hp"), // 按档重排（甲案）：T2 档基线 480 × 角色 1.00（远程狙击）= **480**；原 268.75（卡锚）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "shotDmg"), // T2 68 × 角色 0.88（远射程换单发）= 59.84 → **60**；原 41
  hitRate: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "rangeMinM"), // 1476 ×0.85 = 1254.6 → 1255
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "rangeMaxM"), // 11316 ×0.85 = 9618.6 → 9619
  falloff: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "blindDmgMul"),
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-pirate-sniper", "dmgMix_kinetic") },
  tactic: 'kite',
}

/**
 * A 族 · 四档「海盗头目舰」——**头目档**（`elite: true` → 显示名挂「精锐」前缀）。
 * **2026-09-11 数值落地批启用**：六张 A 族卡统一编成「**头目 ×1 + 杂鱼 ×3**」，
 * 头目按卡位血占 **60%**、名义 DPS 占 **60%**（设定：**一个头目强大带一堆杂鱼**）。
 * 舰种档 = **3 巡洋舰**（2026-09-11 追加裁决「**只有头目是巡洋舰**」= 海盗舰队顶格）；
 * 速度 = 258 × `1.45` = **374** m/s（比杂鱼快，"头目跑得掉"）；射程 −15%：`1` / `2600 ×0.85 = 2210`。
 * ⚠ 头目血型恒为**装甲型**（0.2/0.55/0.25）：卡面 `defProfile` 讲的是**主体杂鱼**那一族的口径，
 * 头目这 60% 血量不随卡面血型走（`FoeShipSlot` 无 `split` 覆写位）——已在设计稿里记明。
 */
export const FOE_SHIP_PIRATE_WARLORD: FoeShipDef = {
  id: 'foe-pirate-warlord',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "gunCount"),
  name: '海盗头目舰',
  family: 'A',
  evasion: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "evasion"), // 2026-09-24 船长令：A 族**除电子舰外** +10% 闪避（缺省 0.12 → 0.22）
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰（海盗族顶格）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "speedRatio"), // = 374 / 258
  hp: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "hp"), // 按档重排（甲案）：T3 档基线 900 × 角色 1.00（精锐主力）= **900**；原 360（卡锚 ⇒ 与护卫舰同强）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "shotDmg"), // T3 124 × 角色 1.09 = 135.2 → **135**；原 56
  hitRate: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "rangeMinM"), // 1 ×0.85 → 1
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "rangeMaxM"), // 2600 ×0.85 = 2210
  falloff: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-pirate-warlord", "dmgMix_explosive") },
  tactic: 'brawl',
  elite: true,
}

/** B 族 · 一档「拾荒武装艇」——武装拾荒者的杂鱼小艇（新手过渡族的主力小艇）。
 * 基准 = **演习场驱逐令（T6，教学卡）**迁移前的现状建档值：血 22 / 单发 14（**纯动能**）/
 * 命中 0.85 / 射程带 1~2200 / 衰减 0.3 / 近盲 0.3 / 装填 4000 / 血型均衡（= 教学卡 `defProfile`）。
 * 速度 = 1 护卫舰基准 340 × **`0.80`** = **272**（船长「速度偏慢」→ 2026-09-11 裁决「B 族速落实 0.8」）。 */
export const FOE_SCAV_SKIFF: FoeShipDef = {
  id: 'foe-scav-skiff',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "gunCount"),
  name: '拾荒武装艇',
  family: 'B',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰（新手过渡族只用 1/2 两档）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "speedRatio"), // = 272 / 340（< 1 = 比本档基准慢；船长 2026-09-11「B 族速落实 0.8」）
  hp: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "hp"), // 按档重排（甲案）：T1 260 × 角色 0.60（数量型小艇）= **156**；原 22（卡锚，改由卡片倍率表达）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "split_h") }, // 均衡型（基准卡 = 教学卡）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "shotDmg"), // T1 39.5 × 角色 0.71 = 28.05 → **28**；原 14
  hitRate: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-scav-skiff", "dmgMix_kinetic") }, // **纯动能**（教学卡为纯系；新港护航卡在条目上覆写 8:2 混伤）
  tactic: 'orbit',
}

/** B 族 · 二档「拾荒火力舰」——把拆来的舰炮焊上拾荒船的重火力型。
 * 基准 = **占港武装通缉（T16）**迁移前的现状建档值：血 292 / 单发 58 / 命中 0.85（族缺省）
 * / 射程带 366~4815 / 衰减 0.3 / 近盲 0.3 / 装填 4000 / 血型均衡 / 构成动能 8:2。
 * 速度 = 2 驱逐舰基准 295 × **`0.80`** = **236**（船长「速度偏慢」→ 2026-09-11 裁决「B 族速落实 0.8」）。
 * ⚠ **乱射（命中 0.55）不写在这里**——那是占港那张卡的**单卡特征**，写在卡的条目 `hitRate` 上。 */
export const FOE_SCAV_ARMED: FoeShipDef = {
  id: 'foe-scav-armed',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "gunCount"),
  name: '拾荒火力舰',
  family: 'B',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-scav-armed", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰（B 族顶格）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "speedRatio"), // = 236 / 295（船长 2026-09-11「B 族速落实 0.8」）
  hp: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "hp"), // 按档重排（甲案）：T2 480 × 角色 1.00（中距火力舰）= **480**；原 292（卡锚，改由卡片倍率表达）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "split_h") }, // 均衡型（基准卡 = 占港卡）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "shotDmg"), // T2 68 × 角色 0.95 = 64.6 → **65**；原 58
  hitRate: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "hitRate"), // 族缺省；「乱射」是单卡特征（见上）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-scav-armed", "dmgMix_explosive") },
  tactic: 'orbit',
}
