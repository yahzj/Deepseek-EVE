/** 功能域职责拆分，保持原计算与顺序。 */
import { type FoeShipDef, enemyParameterOf, FOE_MOUNT_IDS } from '@whale/core'
import foeShipsParameters from '../../static/foeShips.json'
import { FOE_DRONE_E_ALERT } from '../../foe-drones'

/** E 族 · 四档「**导弹残段**」——**长臂导弹平台**（2026-09-15 船长：「**E族添加巡洋级导弹残骸段，
 *  使用导弹。**」＋「**导弹残段射程提高到 1W5**」＋「**伤害为100%纯爆炸**」＋「**导弹沿用现在的风格**」）。
 *
 * **"导弹"在这个游戏里的机制含义** = 武器族别（炮台 / 导弹 / 激光）的那两条特性：
 * **无视近盲带**（近盲带内不打折）+ **命中不随距离衰减**。敌方没有"武器族别"字段，
 * 但这两条**用现有字段就能表达** ⇒ `blindDmgMul: 1` + `falloff: 1`（**零引擎改动**）。
 * 船长选了「沿用现在的风格」⇒ **不做专门的导弹弹道演出**（沿用爆炸系的点/线演出）。
 *
 * | 项 | 值 | 口径 |
 * |---|---|---|
 * | 舰种档 | **T3 巡洋舰** | E 族第二艘 T3（奥罗残骸段之外） |
 * | 血 / 单发 / 装填 | **990 / 161 / 5,000ms** | T3 档基线 900 / 124 × 角色 **1.10 / 1.30**；导弹"单发重、射速慢"（炮台 4,000ms） |
 * | 速度 | **0**（`speedRatio 0`） | 族格「巨构不讲机动」＝静物残骸 |
 * | 血型 | 装甲型 0.2/0.55/0.25 | E 族统一 |
 * | 射程 · 战术 | **3,000~15,000m** · `orbit` | 船长 2026-09-19「**射程下限改为 3000 米**（只给导弹残段）」⇒ 近界 100 → **3,000**；期望交距随之 8,295 → **9,600m**（= 3,000 + 0.55 × 12,000，船长选「顺其自然」） |
 * | 构成 | **纯爆炸**（`{ explosive: 10 }`） | 船长「伤害为100%纯爆炸」（2026-09-19 复核：「**导弹残段依旧是 100% 爆炸**」）；⇒ 已登记 `FOE_SHIP_MIX_AUTHORITY_IDS`（白名单） |
 * | 命中 | **0.85** | 制导修正（船长指定）；E 族内另有 0.65（老化失准）与 0.75（奥罗，2026-09-19 由 0.95 下调）⇒ 0.85 属族内既有区间 |
 * | 机群 | **无** | 与族内另三艘"机群型"分工：它是**炮台型**；也因此**不触发** E 族射程带契约（那条只约束带机群的舰级） |
 *
 * ⚠ **纯系卡的"收束旋钮"**：爆炸是掷命中形态（非等离子 ⇒ 不是光束）⇒ 唯一收束旋钮是 `hitRate 0.85 < 1`；
 * 体检的混伤契约白名单分支对此有断言（纯系卡必须掷命中 + 命中 < 1）。
 * ⚠ **2026-09-19 船长两条改判**：①「E 族四条统一近盲 0.3」⇒ `blindDmgMul` 1 → **0.3**（"导弹无视近盲"
 * 这条特性**作废**：贴进 3 km 内它的伤害只剩三成）；②「射程下限改为 3000 米（只给导弹残段）」。
 * `falloff: 1`（命中不随距离衰减）**保留不动**。 */
export const FOE_MISSILE_HULK: FoeShipDef = {
  id: 'foe-missile-hulk',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "gunCount"),
  name: '导弹残段',
  family: 'E',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "speedRatio"), // 族格：巨构不讲机动（静物残骸）
  hp: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "hp"), // T3 档基线 900 × 角色 1.10
  split: { s: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "split_h") }, // 装甲型（E 族统一）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "shotDmg"), // T3 档基线 124 × 角色 1.30（导弹齐射：单发重）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "hitRate"), // 制导修正（船长「④按0.85给」）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "reloadMs"), // 比炮台（4,000ms）慢：导弹"一发顶几发"
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "rangeMinM"), // 2026-09-19 船长「射程下限改为 3000 米」（只给导弹残段；原 100）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "rangeMaxM"), // 2026-09-19 船长「**将导弹残段的基础射程降低为 11000**」（原 15,000；导弹仍是最远射程的敌型之一）
  falloff: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "falloff"), // **导弹：命中不随距离衰减**（2026-09-19 保留不动）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "blindDmgMul"), // 2026-09-19 船长「E 族四条统一近盲 0.3」（原 1 = 导弹无视近盲，已作废）
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-missile-hulk", "dmgMix_explosive") }, // 船长「伤害为100%纯爆炸」（2026-09-19 复核：依旧是 100% 爆炸）
  tactic: 'orbit',
  /**
   * **受击增程挂载件**（船长 2026-09-19：「**并挂载类似静滞卫舰的挨打后对方在射程外就增加射程的挂载件**」）：
   * 挂的是 **E 族自己的那件**「**巨构齐射观瞄**」（`foe-mount-titan-range-x1-5`，`gunRangeOnHit ×1.5`）——
   * 船长同日澄清「**只是采用类似的效果的挂载件，并不是真的是静滞卫舰的挂载件（因此名字要不同）**」
   * ⇒ **不与 D 族共用**「守墓远距观瞄」，两件效果同档、id / 名 / 备注各自独立。
   *
   * 为什么要给它：导弹残段是 E 族里唯一的**远射平台**（11,000m），玩家在它射程外"站着点"就是它的天敌；
   * 挨打增程让它把射程反推回来（11,000 → 16,500m），与 D 族静滞卫舰同一套反制语言。
   */
  mounts: [FOE_MOUNT_IDS.gunRangeX15Titan],
}

/**
 * **混伤/构成口径由舰级说了算的舰级**（卡面构成按"**与主体一致**"校验，不套通用 8:2 / 族级 5:5）。
 *
 * 由来：船长点名要的口径**与既有混伤契约冲突**，他裁定「**撞到的契约开白名单**」：
 * - `foe-d-throne`（守墓王座舰）= **等离子 6 : 动能 4**（2026-09-15「50%动能+50%能量的混合炮台」→「按乙调整为 6:4」）；
 * - `foe-missile-hulk`（导弹残段）= **纯爆炸**（2026-09-15「伤害为100%纯爆炸」）；
 * - **E 族三条**（巨构残段 / 奥罗残骸段 / 核心舱段）= **爆炸 6 : 动能 4**（2026-09-19「所有E族的默认伤害比
 *   改为爆炸60%，动能40%」）——原 5:5 同样不落 8:2 契约，随本次一并登记。
 *
 * **登记纪律**：只登记"舰级自带口径"的舰级；**卡面必须与主体构成逐键一致**（体检另有一条通用断言
 * 「卡面 = 每条主体的有效构成」兜底）⇒ 白名单放行的只是"不必等于 8:2 / 5:5"，不是"可以随便写"。
 */
export const FOE_SHIP_MIX_AUTHORITY_IDS: readonly string[] = [
  'foe-d-throne', // 等离子 6 : 动能 4（船长 2026-09-15「按乙调整为 6:4」）
  'foe-d-invasion-cruiser',
  'foe-d-invasion-bastion',
  'foe-d-invasion-oathkeeper',
  'foe-d-invasion-eternal-tomb',
  'foe-missile-hulk', // 纯爆炸（船长 2026-09-15「伤害为100%纯爆炸」）
  // E 族三条：爆炸 6 : 动能 4（船长 2026-09-19「所有E族的默认伤害比改为爆炸60%，动能40%」）
  'foe-titan-hulk',
  'foe-auro-hulk',
  'foe-core-section',
  // H 族五条（2026-09-24 第二轮令：「**干扰舰和突击舰的伤害构成比例为6动能4爆炸**」）——
  // 族内出现 **6:4（突击舰 / 干扰舰）与 8:2（鱼雷舰 / 战巡 / 母舰）两种口径** ⇒ 通用"卡须主 8 : 副 2"
  // 对"全突击舰编成"的骚扰舰队不适用 ⇒ 按既有「撞到的契约开白名单」纪律整族登记。
  // ⚠ 卡面仍须与**每一条主体**的有效构成逐键一致（族内换构成时要在**条目**上写 `dmgMix` 覆写）。
  'foe-h-ink-corvette',
  'foe-h-ink-jammer',
  'foe-h-ink-torpedo',
  'foe-h-ink-battlecruiser',
  'foe-h-ink-flagship',
]

/** E 族 · 一档「巨构残段」——**泰坦级巨构**的残段（服务：泰坦残骸勘探 60；**全族第一条舰级**）。
 *
 * **按档重排**：T4 档基线 1,600 / 240 × 角色 1.00 / 0.95 = **1,600 / 228**。
 * 速度 = **`speedRatio 0`（实速 0）**——船长 2026-09-11 终裁「**族速度倍率设为 0**。依靠无人机攻击
 * 炮台范围外敌人」：巨构是**静物残骸**，不机动、不追人，火力由**警戒机群**投送（本批之前曾按族格速带
 * 取 0.95 = 195，**已作废**）。射程带 **1~2,567** 与命中 **0.65** **逐字沿用现状**——后者是族格
 * '**远古残骸老化自动炮台，单发重但失准**'的落点；血型装甲、构成 **爆炸 60% + 动能 40%**、
 * 战术 `orbit` ＋ `desireRangeM 513` 均为本批按族规落定（原'动能 8 : 等离子 2'与战术 `brawl`
 * 已随 E 族数据批 P-12 / P-13 对齐退出）。
 *
 * **机群**：`警戒机 ×2`（`foe-drones.ts`）——船长「**巨构需要制作敌方无人机系统**」的落点，
 * 也是据点词「**警戒机群**」承诺的第二套火力。 */
export const FOE_SHIP_TITAN_HULK: FoeShipDef = {
  id: 'foe-titan-hulk',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "gunCount"),
  name: '巨构残段',
  family: 'E',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 战列舰（"泰坦级巨构"的档位）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "speedRatio"), // **0**（船长 2026-09-11：「族速度倍率设为 0。**依靠无人机攻击炮台范围外敌人**」）——
  // 巨构是**静物残骸**：它不机动、不追人，只靠**警戒机群**打它炮台够不着的目标（"巨构不讲机动"的极致落点）
  hp: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "hp"), // T4 档基线 1600 × 角色 1.00
  split: { s: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "split_h") }, // 装甲型（= 泰坦残骸勘探卡面）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "shotDmg"), // T4 档基线 240 × 角色 0.95
  hitRate: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "hitRate"), // **老化自动炮台**（族格；沿用现状卡面值 ⇒ 实收不变）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "rangeMinM"), // **族级最低 100**（船长 2026-09-11：「E 族射程按照最低 100」；原 1）
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "rangeMaxM"), // **族级最高 8,500**（船长：最高按 7,000~10,000 设定；族内中档）
  falloff: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "falloff"), // 2026-09-12 船长「衰减降低为 0.3」（原 0.5；机群受击增程后的远距火力也一起吃这层收束）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "blindDmgMul"),
  // **爆炸 60% + 动能 40%**（船长 2026-09-19：「所有E族的默认伤害比改为爆炸60%，动能40%」；
  // 原 2026-09-11 的 50:50 作废 ⇒ 主系由动能变**爆炸**）
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "dmgMix_kinetic") },
  // **中距为主**（族规）——2026-09-11 射程既定 ⇒ **解除期望距离钉住**，交距回归 orbit 口径
  // （8,500 × 0.55 = **4,675m**；此前"射程未定"时曾用 `desireRangeM 513` 钉住旧值，已撤）
  tactic: 'orbit',
  drones: [{ drone: FOE_DRONE_E_ALERT, count: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "drones_0_count") }], // **常态出击 7 架**（船长 2026-09-12：按舰种档——
  // 巡洋 5 / **战列 7** / 旗舰 10）
    mounts: [FOE_MOUNT_IDS.droneRangeX4], // 机群受击增程（2026-09-16 迁成挂载件：×4）
  // **备用机库**（船长 2026-09-12：「损坏后补充敌机」+「**备用机库为出击数量的 100%**」）：+7 架备用
  // （总库存 14），战损后 **10s** 满血补位（母舰阵亡则整群停，含备用机）。
  // ⚠ **甲（单次出击上限 `droneLaunch`）本轮不采用** —— 机制已实现，**留作后续其他机制**（缺省不写）。
  droneReserve: { count: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "droneReserve_count"), respawnMs: enemyParameterOf(foeShipsParameters, "foe-titan-hulk", "droneReserve_respawnMs") },
}

/** E 族 · 二档「**奥罗残骸段**」——**被风暴反复激活的武装残骸**（服务：奥罗武装残骸群 62）。
 *
 * 船长 2026-09-11「该族建议符合设定」⇒ 按 E 族设定落：**奥罗＝地名**（奥罗荒环），不是型号名。
 * **按档重排**：T3 档基线 900 / 124 × 角色 1.10 / 1.00 = **990 / 124**。
 * 全族同口径：**速度倍率 0**（静物残骸）· 构成 **爆炸 60% + 动能 40%** · 战法 **orbit** 且
 * `desireRangeM` 钉住现状作战距离（射程未定）· 命中 **0.75**（船长 2026-09-19「奥罗残骸段的命中率
 * 降低为 0.75」；原 0.95 = 族内最准）· 带 100~7,000（沿用）。
 * **机群**：警戒机 ×2——与巨构残段同款'第二套火力'。 */
export const FOE_SHIP_AURO_HULK: FoeShipDef = {
  id: 'foe-auro-hulk',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "gunCount"),
  name: '奥罗残骸段',
  family: 'E',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // 巡洋舰
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "speedRatio"), // 全族 0（船长：族速度倍率设为 0）
  hp: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "hp"), // T3 档基线 900 × 角色 1.10
  split: { s: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "split_h") }, // 装甲型（= 奥罗武装残骸群卡面）
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "shotDmg"), // T3 档基线 124 × 角色 1.00
  hitRate: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "hitRate"), // 2026-09-19 船长「奥罗残骸段的命中率降低为 0.75」（原 0.95）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "rangeMinM"), // 族级最低 100
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "rangeMaxM"), // **族级最低档 7,000**（族内最"旧"的一截，射程也最短）
  falloff: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "falloff"), // 2026-09-12 船长「衰减降低为 0.3」（原 0.5）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "blindDmgMul"),
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "dmgMix_kinetic") }, // 爆炸 60% + 动能 40%（船长 2026-09-19 全族改判）
  tactic: 'orbit',
  // 交距 = 7,000 × 0.55 = **3,850m**（射程既定后解除钉住；旧钉值 516 已撤）
  drones: [{ drone: FOE_DRONE_E_ALERT, count: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "drones_0_count") }], // **常态出击 5 架**（船长：巡洋 **5** / 战列 7 / 旗舰 10）
    mounts: [FOE_MOUNT_IDS.droneRangeX4], // 机群受击增程（2026-09-16 迁成挂载件：×4）
  droneReserve: { count: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "droneReserve_count"), respawnMs: enemyParameterOf(foeShipsParameters, "foe-auro-hulk", "droneReserve_respawnMs") }, // 备用机库 = 出击数的 **100%**（+5，总 10），10s 满血补位
}

/** E 族 · 三档「**核心舱段**」——**一具接近完好的巨构**（族内最高级目标，船长裁定 8「核心舱段级代表位」）。
 *
 * **舰种档 = T5 旗舰**（2026-09-12 船长：「**核心舱段，调为旗舰级**」）——E 族唯一旗舰，也是目前
 * 敌舰里唯一 T5（原登记 T4 战列舰；「T4 上限、T5 不开」的旧口径随之作废）。
 * **按档重排（甲案）**：**T5 档基线 2,800 / 420 × 角色 1.40 / 1.30 = 3,920 / 546**（族内最厚最重）。
 * ⚠ 舰级基础值上调后由**卡侧 `hpMul`/`dmgMul` 反算吸收**（`ano-core-section` 实收仍为血 3,400／
 * 总单发 672）⇒ 「基础属性符合舰种定位」与「卡读数」同时成立。
 * 速度 = 5 旗舰基准 155 × `speedRatio 0` = **0**（静物残骸）。**远端衰减 0.3**（船长 2026-09-12
 * 「衰减降低为 0.3」；原 0.5 ⇒ 远端威力收得更紧）。其余同族口径：**爆炸 60% + 动能 40%**
 * （船长 2026-09-19 全族改判；原 50:50）· orbit · 装甲型 · 射程 100~10,000 · 警戒机 ×3 · 受击增程 ×4。
 * **`elite`**（显示名加「精锐」前缀）——「接近完好」＝族内唯一精锐档。 */
export const FOE_SHIP_CORE_SECTION: FoeShipDef = {
  id: 'foe-core-section',
  gunCount: enemyParameterOf(foeShipsParameters, "foe-core-section", "gunCount"),
  name: '核心舱段',
  family: 'E',
  hullClassTier: (enemyParameterOf(foeShipsParameters, "foe-core-section", "hullClassTier") as 1 | 2 | 3 | 4 | 5), // **旗舰**（船长 2026-09-12「调为旗舰级」）
  speedRatio: enemyParameterOf(foeShipsParameters, "foe-core-section", "speedRatio"),
  hp: enemyParameterOf(foeShipsParameters, "foe-core-section", "hp"), // 按档重排：T5 档基线 2,800 × 角色 1.40 = **3,920**（原 T4 口径 2,240）
  split: { s: enemyParameterOf(foeShipsParameters, "foe-core-section", "split_s"), a: enemyParameterOf(foeShipsParameters, "foe-core-section", "split_a"), h: enemyParameterOf(foeShipsParameters, "foe-core-section", "split_h") },
  shotDmg: enemyParameterOf(foeShipsParameters, "foe-core-section", "shotDmg"), // T5 档基线 420 × 角色 1.30 = **546**（原 T4 口径 312）
  hitRate: enemyParameterOf(foeShipsParameters, "foe-core-section", "hitRate"), // 老化自动炮台（族格，与巨构残段同口径）
  reloadMs: enemyParameterOf(foeShipsParameters, "foe-core-section", "reloadMs"),
  rangeMinM: enemyParameterOf(foeShipsParameters, "foe-core-section", "rangeMinM"), // 族级最低 100
  rangeMaxM: enemyParameterOf(foeShipsParameters, "foe-core-section", "rangeMaxM"), // **族级最高档 10,000**（"接近完好的巨构"＝族内最远的一门；与玩家侧 E 族专属件
  // 「巨构残骸炮 9,600m」同档 —— 主题自洽；代价：纯动能玩家（上限 7,350）须换激光/导弹/该专属件才能对射）
  falloff: enemyParameterOf(foeShipsParameters, "foe-core-section", "falloff"), // 2026-09-12 船长「衰减降低为 0.3」（原 0.5）
  blindDmgMul: enemyParameterOf(foeShipsParameters, "foe-core-section", "blindDmgMul"),
  dmgMix: { explosive: enemyParameterOf(foeShipsParameters, "foe-core-section", "dmgMix_explosive"), kinetic: enemyParameterOf(foeShipsParameters, "foe-core-section", "dmgMix_kinetic") }, // 爆炸 60% + 动能 40%（船长 2026-09-19 全族改判）
  tactic: 'orbit',
  // 交距 = 10,000 × 0.55 = **5,545m**（射程既定后解除钉住；旧钉值 513 已撤）
  elite: true, // 「精锐核心舱段」
  drones: [{ drone: FOE_DRONE_E_ALERT, count: enemyParameterOf(foeShipsParameters, "foe-core-section", "drones_0_count") }], // **常态出击 10 架**（船长：旗舰 **10**；族内最多）
    mounts: [FOE_MOUNT_IDS.droneRangeX4], // 机群受击增程（2026-09-16 迁成挂载件：×4）
  droneReserve: { count: enemyParameterOf(foeShipsParameters, "foe-core-section", "droneReserve_count"), respawnMs: enemyParameterOf(foeShipsParameters, "foe-core-section", "droneReserve_respawnMs") }, // 备用机库 = 出击数的 **100%**（+10，总 20），12s 满血补位
}
