/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf, FOE_MOUNT_IDS } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'
import { FOE_DRONE_H_HEAVY } from '../../foe-drones'

/**
 * H 族 · T3「**墨潮干扰舰**」（船长 2026-09-24：「**墨潮快艇改为墨潮干扰舰，档位改为T3巡洋舰，
 * 拥有和我方电子舰同款降低敌人射程的效果，降低效果为降低50%射程，可以和我方电子舰的效果相互抵消**」）。
 *
 * - **档位 T3 巡洋舰**（原快艇是 T1）⇒ 血/单发按 T3 档基线 900 / 124 × 角色 1.00 / 0.85 = **900 / 105**
 *   （角色 = "支援/干扰舰"：单发略让位给特性，与电子舰同语言）；
 * - **射程压制 50%**（**2026-09-26 起写在挂载件「墨潮干扰阵列」上** `foe-mount-ink-range-debuff`；
 *   迁移前是舰级字段 `foeRangeDebuffPct`，数值一字不变）：**多艘乘法合成**（2 艘 = 75%）·
 *   与我方电子舰的 15% **做加法抵消**（船长例：我方 1 艘电子舰 + 敌方 1 艘干扰舰 ⇒ 我方射程 **×0.65 = -35%**）；
 * - 速度 258 × **1.45** = **374 m/s**（对基准船 165.2 的 ≈1.43×，落 H 族族格带 1.0~1.6）；射程带 **1 ~ 4,275**（与突击舰同口径 · 中距）。
 */
export const FOE_H_INK_JAMMER: FoeShipDef = {
  id: 'foe-h-ink-jammer',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "gunCount"),
  name: '墨潮干扰舰',
  family: 'H',
  evasion: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰（船长 2026-09-24：「档位改为T3巡洋舰」）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "speedRatio"), // 258 × 1.3 = 335 m/s（船长 2026-09-24：「其他敌方舰船按照1.3」；1.14× 在族格带内）
  hp: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "hp"), // T3 档基线 900 × 角色 1.00
  split: { s: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "split_h") }, // 护盾 0.5（船长 2026-09-24）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "shotDmg"), // T3 档基线 124 × 角色 0.85（"干扰舰"把单发让给特性）
  // 命中 1.1（**船长 2026-09-25 Excel 微调 · 命中方面**）：>1 = 贴脸时按 `hitMax` 封顶必中，
  // 只有目标闪避与距离衰减能把它压回来（有效命中 = clamp(0, 1, (命中 + 命中加成 − 目标闪避) × 衰减)）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-h-ink-jammer", "dmgMix_explosive") }, // 船长 2026-09-24：突击舰与干扰舰改「6 动能 : 4 爆炸」
  tactic: 'orbit',
  /**
   * **劫掠捕获网**（**船长 2026-09-25 令**：「**给墨潮干扰舰添加一个网子**」）——
   * 与 A 族洞内「劫掠电子舰」、H 族「墨潮突击舰」同款那件（减速 90% / 关推进器 / 闪避归零 / 射程 −500m；
   * **首次开火钉住一个没被钉住的目标**；**击沉发动者、或交战距离超过 4500 米**
   * （船长 2026-09-26「这个断开对敌我都有效」）才解除，见 `combat.fireFoeCaptureWeb` / `expireFoeWebs`）。
   * ⚠ 写在**舰级**上（与突击舰同一条写法）：H 族只在这四张入侵卡里出场，不存在"外借到洞外"的问题；
   * `content:check` 的捕获网归属白名单同步放行本舰级。
   *
   * ⚠ **射程压制 50% 已迁成同表第二件**（**船长 2026-09-26**：「**敌人的射程压制挂载件好像也还没有命名？**」
   * ⇒ 选甲：原舰级字段 `foeRangeDebuffPct: 0.5` 迁到具名挂载件「**墨潮干扰阵列**」
   * `foe-mount-ink-range-debuff`，数值一字不变）⇒ 本舰现在挂**两件**：网 ＋ 干扰阵列。
   */
  mounts: [FOE_MOUNT_IDS.captureWeb, FOE_MOUNT_IDS.inkRangeDebuff],
}

/**
 * H 族 · T1「**墨潮突击舰**」（船长 2026-09-24：「**墨潮突击舰添加A族洞内电子舰同款网子和冲锋**」）。
 *
 * - **挂载件**：`chargePirate`（劫掠冲锋推进器 ×1.6 / 冷却 30 秒）＋ `captureWeb`（劫掠捕获网）
 *   —— 与 A 族洞内「劫掠电子舰」那一条**逐件同款**（船长原话「同款网子和冲锋」）；
 * - 数值与 H 族原突击舰一字不变（T1 · 364 / 51 · 速度 ×1.05 · 射程 1~4,275）。
 */
export const FOE_H_INK_CORVETTE: FoeShipDef = {
  id: 'foe-h-ink-corvette',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "gunCount"),
  name: '墨潮突击舰',
  family: 'H',
  /**
   * **闪避 0.22 → 0.47**（2026-09-25 船长令：「**墨潮突击舰闪避率+0.25**」）——
   * 它是全族跑得最快的一档（544 m/s）＋带冲锋与捕获网，闪避抬上去才配得上"贴脸突击"的角色。
   * ⚠ 破既有闪避带的话在 `content:check` 的族格白名单里按同款口径记一笔（见 `INK_SPEED_EXEMPT_SHIP_IDS` 那一族的写法）。
   * **→ 0.59**（**同日 Excel 微调批**：与本文件的命中一起调，见下）。
   */
  evasion: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 护卫舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "speedRatio"), // 340 × 1.6 = 544 m/s（船长 2026-09-24：「突击舰速度过慢，按照1.6修正」；1.86× 破族格带 ⇒ INK_SPEED_EXEMPT_SHIP_IDS）
  hp: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "hp"),
  split: { s: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "split_h") }, // 护盾 0.5（船长 2026-09-24：「除了旗舰外所有敌舰护盾血量占0.5」）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "shotDmg"),
  // 命中 1.25（**船长 2026-09-25 Excel 微调**）：>1 时按 `hitMax` 封顶 ⇒ 贴脸必中，靠闪避/衰减压制
  hitRate: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "blindDmgMul"),
  dmgMix: { kinetic: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "dmgMix_kinetic"), explosive: enemyParameterOf(foeShipsParameters, "foe-h-ink-corvette", "dmgMix_explosive") }, // 船长 2026-09-24：突击舰与干扰舰改「6 动能 : 4 爆炸」
  tactic: 'orbit',
  // **网子 + 冲锋**（船长 2026-09-24「A族洞内电子舰同款」）：两件都写在舰级上 ⇒ 引用它的卡都带
  mounts: [FOE_MOUNT_IDS.chargePirate, FOE_MOUNT_IDS.captureWeb],
}

/**
 * H 族 · **T2「墨潮鱼雷舰」**（船长 2026-09-24：「**墨潮狙击舰改为墨潮鱼雷舰，使用远程导弹攻击**」）。
 *
 * ⚠ **档位 = T2 驱逐舰**（= 原「墨潮狙击舰」的档位；船长 2026-09-24 追问「**墨潮鱼雷舰原先不是T2吗？
 * 怎么升到T3了**」）。本舰在「逐条细化」那一版被连带抬成 T3（900 / 124 / 374）——那是**二号多改的**：
 * 船长令里只有「墨潮**快艇**改为 T3 巡洋舰」（已由干扰舰兑现），鱼雷舰只要求"改用远程导弹"。
 * 2026-09-24 按船长质疑**回调 T2**，再按同日第二轮令改**高攻低血**：
 * 「**鱼雷舰设定为攻击更高，但是血量偏低**」＋ 裁决「T2 躯：血 360 / 单发 90」。
 *
 * - **远程导弹口径**（与 E 族「导弹残段」同一套字段表达：`falloff: 1` + `blindDmgMul: 0.3`
 *   ⇒ 命中不随距离衰减、近盲带 ×0.3）；
 * - 数值：血 **360**（T2 档基线 480 × 0.75）· 单发 **90**（T2 档基线 68 × 角色 1.32）——"狙一发就走"；
 * - 射程 **1,000 ~ 12,000m**（远程压制）；速度 295 × **1.3** = **384 m/s**（1.31×，H 族带内）；`kite` 拉距打。
 */
export const FOE_H_INK_TORPEDO: FoeShipDef = {
  id: 'foe-h-ink-torpedo',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "gunCount"),
  name: '墨潮鱼雷舰',
  family: 'H',
  evasion: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 驱逐舰（原「墨潮狙击舰」的档位；船长 2026-09-24 追问后回调）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "speedRatio"), // 295 × 1.3 = 384 m/s（船长第二轮令「其他敌方舰船按照1.3」；1.31× 在族格带内）
  hp: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "hp"), // 高攻低血（船长 2026-09-24）：T2 档基线 480 × 0.75
  split: { s: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "split_h") }, // 护盾 0.5（船长 2026-09-24）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "shotDmg"), // 高攻（船长 2026-09-24）：T2 档基线 68 × 角色 1.32
  // 命中 1（**船长 2026-09-25 Excel 微调**）：导弹线 `falloff: 1`（命中不随距离衰减）⇒ 1 即"必中"
  hitRate: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "hitRate"),
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "reloadMs"), // 导弹节奏（远而慢）
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "falloff"), // 导弹口径：命中不随距离衰减
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "blindDmgMul"), // 近盲带 ×0.3（船长 2026-09-24 选「与 E 族口径统一」；E 族 2026-09-19「四条统一近盲 0.3」）
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-h-ink-torpedo", "dmgMix_kinetic") }, // 鱼雷 = 爆炸系（与 H 族导弹线同源；船长第二轮只改突击舰与干扰舰）
  tactic: 'kite',
}

/**
 * H 族 · T4「**墨潮战列巡洋舰**」（船长 2026-09-24：「**墨潮重炮舰改为墨潮战列巡洋舰，同样使用导弹远程攻击，
 * 还拥有1架攻坚无人机，该船的特点是虽然只有一个无人机，但是无人机属性极高**」）。
 *
 * - **导弹远程**（同鱼雷舰口径：`falloff: 1` + `blindDmgMul: 0.3`）；
 * - 数值 = T4 档基线 2,800 / 420 × 角色 1.00 / 0.95 = **2,800 / 399**；
 *   射程 **1,000 ~ 11,000m**；速度 205 × **1.3** = **266 m/s**（0.91× 低于族格带下限 ⇒ `INK_SPEED_EXEMPT_SHIP_IDS`）；`kite`；
 * - **1 架 `墨潮重袭机`**（`FOE_DRONE_H_HEAVY`：三层血 180 · 单发 60 · 射程 7,000 · 命中 0.85）——
 *   "只有一个，但属性极高"的落点（详见机型表头注）。
 */
export const FOE_H_INK_BATTLECRUISER: FoeShipDef = {
  id: 'foe-h-ink-battlecruiser',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "gunCount"),
  name: '墨潮战列巡洋舰',
  family: 'H',
  evasion: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 战列巡洋舰（战列档）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "speedRatio"), // 205 × 1.3 = 266 m/s（船长第二轮令「其他敌方舰船按照1.3」；0.91× 低于族格带下限 ⇒ 白名单破例）
  hp: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "hp"), // T4 档基线 2,800 × 角色 1.00
  split: { s: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "split_h") }, // 护盾 0.5（船长 2026-09-24）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "shotDmg"), // T4 档基线 420 × 角色 0.95（单发让一点给机群）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "hitRate"), // 命中 0.85 → **0.9**（船长 2026-09-25 Excel 微调）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "blindDmgMul"), // 船长 2026-09-24：与 E 族口径统一（原先沿用 E 族旧口径的"无视近盲 1"）
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "dmgMix_kinetic") }, // 导弹线 = 爆炸系
  tactic: 'kite',
  drones: [{ drone: FOE_DRONE_H_HEAVY, count: enemyParameterOf(foeShipsParameters, "foe-h-ink-battlecruiser", "drones_0_count") }], // 一架，属性极高（船长 2026-09-24）
}

/**
 * H 族 · **T5「墨潮入侵母舰」**——周末入侵的族旗舰（船长 2026-09-24：「**墨潮旗舰改为墨潮入侵母舰。
 * 拥有2架坚无人机，和墨潮战列巡洋舰一样，无人机属性极高。使用导弹攻击。**」）。
 *
 * - 数值沿用 T5 档基线 2,800 / 420 × 旗舰角色 1.40 / 1.30 = **3,920 / 546**，
 *   但**单发让给机群**（线列 3 舰 + 2 架重袭机）⇒ 取 **0.90** = **491**；射程 **1,000 ~ 12,000m**（导弹）；
 * - 速度 155 × **2.0** = **310 m/s**（对基准船比率 ≈1.06×，H 族族格带内；旗舰带头压上来打）；
 * - **2 架 `墨潮重袭机`**（同战列巡洋舰的机型：单架三层血 180 / 单发 60 / 射程 7,000）。
 */
export const FOE_H_INK_FLAGSHIP: FoeShipDef = {
  id: 'foe-h-ink-flagship',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "gunCount"),
  name: '墨潮入侵母舰',
  family: 'H',
  evasion: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "evasion"),
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 旗舰（本族唯一 T5，须登记在 H 族旗舰白名单）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "speedRatio"), // 155 × 2.0 = 310 m/s
  /**
   * **3,920 → 39,200（×10 · 船长 2026-09-25 指定）**：原值 = T5 档基线 2,800 × 角色 1.40
   * ⇒ 现值**脱离档基线 10×**（没有硬契约拦，按船长指定落，注明于此）。
   * 为什么这么厚：它是**周末入侵的 BOSS 本体**——战斗中的血条由**池子剩余**接管
   * （`weekendLaunch` 传 `FoeOverride.bossHp`：满血 = 池子剩余，池子 = 固定 150,000 起算）；
   * 这里的 39,200 是**卡面基准**（池子立起前的读数，以及"母舰占全卡血量多少"的口径）。
   */
  hp: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "hp"),
  split: { s: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "shotDmg"), // T5 档基线 420 × 角色 1.30 × 0.90（机群让位）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "hitRate"), // 命中 0.85 → **1**（船长 2026-09-25 Excel 微调）：母舰导弹线 `falloff: 1` ⇒ 1 即"必中"
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "rangeMinM"),
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "rangeMaxM"),
  falloff: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "falloff"),
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "blindDmgMul"), // 船长 2026-09-24：与 E 族口径统一（原先沿用 E 族旧口径的"无视近盲 1"）
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "dmgMix_kinetic") },
  tactic: 'kite',
  drones: [{ drone: FOE_DRONE_H_HEAVY, count: enemyParameterOf(foeShipsParameters, "foe-h-ink-flagship", "drones_0_count") }], // 两架，属性极高（船长 2026-09-24）
  elite: true, // 显示名挂「精锐」前缀
}
