/**
 * 装备表（V17.1 + V17.2 + V18 + V18.1：72 件）。
 *
 * 设计（中文说明）：
 * - 工业槽（miner/cargo）：保留加成系数形态（bonus：产量/容量百分比）——生产参数简单直接；
 * - 战斗家族 V17.1 起按"参数进公式"分族（全部经用户审核定稿）：
 *   · 抗性件 = 纯抗性：护盾增强器（护盾槽）与装甲镀层（装甲槽），动能/高爆/能量三系 ×
 *     MK1/2/3；值 = "缺口削减"（实际抗性 = 1 − (1−船体基础) × (1−值)，上限 90%）——
 *     EVE 式乘入：船体基础越高同系收益越低，无基础船面板 = 该值；
 *   · 容量件 = 纯容量：护盾扩展器（护盾槽）与装甲增厚板（装甲槽），MK1/2/3——
 *     与抗性件同槽二选一（本槽只能装一件），无分系；
 *   · 矢量推进器 = 加力推进（战斗速度加成，常驻）＋代价：开火命中 ×(1−hitPenalty)
 *     （MK1 +15%/×0.95、MK2 +30%/×0.88、MK3 +50%/×0.80——低档轻微、高档重）；
 *   · 炮台（V17.2 炮族制；V18 口径取消） = 档位 × 固定弹种：轻型（MK1 速射近程）、
 *     重型（MK2 慢射远程）、攻坚（MK3 超远程重装填）、异星原型；同 MK 三弹种款
 *     性能一致只换伤害类型（动能打盾 ×1.5 / 高爆打甲 ×1.5 / 能量打盾 ×1.25 且单发基数最高）；
 *     蓝图 = 动能款（协会制式）；口径限制已取消——任意船可装任意炮，装配唯一约束 = CPU；
 *   · V18B-1/2 武器形态分家（船长 2026-09-04："按伤害类型设计武器，不应只是换描述"）：
 *     爆炸系已从临时"高爆炮"迁移为导弹架（mod-missile-1/2/3，见下方导弹架段）——
 *     追踪命中不随距离衰减的远程爆破，带近盲安全射距（太近会炸到自己）；
 *     V18B-2：能量系从临时"能量炮/异星原型"迁移为激光炮（mod-laser-1/2/3/proto）——
 *     必中（不掷命中）+ 距离衰减作用于威力（幅度 = 命中衰减的 50%）+ 消耗能量弹药；
 *     动能炮仍为临时填充数据，V18B-3 将改造为质量炮形态（届时再做迁移与改名确认）；
 *   · 弹药：动能弹药（质量炮）、爆破弹药（导弹架专用，爆炸键）、能量弹药（激光炮专用，
 *     原名"等离子弹"，id 不变）——每型单档通用弹（-l），武器按自身固定弹种消耗；
 *     ⚠ 2026-09-16 船长定名批：动能弹 / 爆破导弹 两名统一到《系+弹药》（id 一律不变）；
 *     ⚠ 2026-09-17 船长定批（带括号文案逐类审核 · 第一批裁决）：说明里**不再写槽位标签**——
 *       「（低槽）」「（中槽）」「（高槽）」「（高槽，无伤害）」6 类 29 段一律去掉；槽位由富卡
 *       「槽位 / 类型」行与仓库/装配/市场/手册各处 chip 承担。**「（不可制造）」按约定 §十三 保留**
 *       （"能不能造"是有用信息，中性句写法）；「（上限 90%）」与谜质储存器的尾注经复核**保留**。
 * - CPU 装配资源（V17.1 用户定稿：成倍档位拉开船级差距）：
 *   民用 3（炮台 6）/ MK1 5（炮台 10）/ MK2 15（炮台 28）/ MK3 40（炮台 52）/
 *   异星原型 60（炮台 70）——战斗件与工业件同档；低级船（沙猫 60 CPU）只带得动
 *   低级全套，MK3 顶配套件需要 220+ CPU 的顶级船，无人机放飞余量同池竞争；
 * - 渠道与既有规则一致：MK1 平价 / MK2・MK3 稀有（MK3 无蓝图市场专供）/
 *   proto 奇货（声望 10、无蓝图）；护盾/装甲/推进无蓝图（市场供应为主）；
 * - 存档迁移：mod-shield-1/2/3、mod-armor-1/2/3（通用全系）与 mod-turret-1/2/3
 *   （V17 前混型炮）已下架，载入存档自动按动能款迁移（core/equipment 迁移表）；
 * - V18（C3）槽位制 + V18.1（2026-09-04 船长拍板）支援件与收敛：
 *   · 槽位制：fitted 位数组 + rack 归属（高 = 炮台/采集器/打捞器/无人机装置；中 = 盾系/推进；
 *     低 = 甲系/货舱）；V18.1 支援件再挂 中/低（伤害+射速 = 低；命中+闪避 = 中）；
 *   · V18.1 取消"同类唯一"：全部件可复数安装，防超模靠收敛（core/equipment
 *     stackingOf）：抗性/闪避缺口复合、命中/速度 EVE 曲线、伤害/射速/容量加算；
 *     本表支援件数值（+6/10/15% 等）为暂定初值，进 C4 校准轮复核；
 *   · support 家族效果字段判别：damageTypeBonusPct = 稳定器、reloadCutPct = 射速
 *     计算机、hitBonusPct = 索敌阵列、evasionGapPct = 姿态陀螺。
 */

import type { ModuleDef } from '@whale/core'

export const MODULES: readonly ModuleDef[] = [
  // ══════════ 采集器（miner：工业槽，产量加成） ══════════
  {
    id: 'mod-miner-civ',
    name: '民用采集器',
    slot: 'miner',
    workEfficiency: 0, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    bonus: 0.1,
    description: '产量 +10%。空间站平价货，新手第一件看得起的强化。',
    cpuUse: 3,
  },
  {
    id: 'mod-miner-1',
    name: '强化采集器 MK1',
    slot: 'miner',
    workEfficiency: 0.2, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    bonus: 0.2,
    description: '提升 20% 循环产量。工业入门的第一件自制装备。',
    cpuUse: 5,
  },
  {
    id: 'mod-miner-2',
    name: '强化采集器 MK2',
    slot: 'miner',
    workEfficiency: 0.4, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    bonus: 0.5,
    description: '提升 50% 循环产量。双管谐振钻头，深空工业的标杆装备。',
    cpuUse: 15,
  },
  {
    id: 'mod-miner-3',
    name: '精密采集器 MK3',
    slot: 'miner',
    workEfficiency: 0.6, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    bonus: 0.8,
    description: '产量 +80%。协会精密工业的结晶（蓝图可造，见组装机）；40 CPU 已接近小型船满载。',
    cpuUse: 40,
  },
  {
    id: 'mod-miner-proto',
    name: '异星原型采集器',
    slot: 'miner',
    workEfficiency: 0.8, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    bonus: 1.1,
    description: '产量 +110%。来源不明的异星技术，无法复制——不可制造。',
    cpuUse: 60,
  },

  // ══════════ 货舱（cargo：工业槽，容量加成） ══════════
  {
    id: 'mod-cargo-civ',
    name: '民用货舱扩展',
    slot: 'cargo',
    rack: 'low',
    bonus: 0.15,
    description: '货舱容量 +15%。廉价的续航改装。',
    cpuUse: 3,
  },
  {
    id: 'mod-cargo-1',
    name: '货舱扩展 MK1',
    slot: 'cargo',
    rack: 'low',
    bonus: 0.3,
    description: '货舱容量 +30%，减少返港卸货次数。',
    cpuUse: 5,
  },
  {
    id: 'mod-cargo-2',
    name: '货舱扩展 MK2',
    slot: 'cargo',
    rack: 'low',
    bonus: 0.8,
    description: '货舱容量 +80%。离线长时间作业的必备扩展。',
    cpuUse: 15,
  },
  {
    id: 'mod-cargo-3',
    name: '折叠货舱扩展 MK3',
    slot: 'cargo',
    rack: 'low',
    bonus: 1.4,
    description: '货舱容量 +140%。空间折叠衬层，协会制式蓝图可造（组装机）。',
    cpuUse: 40,
  },
  {
    id: 'mod-cargo-proto',
    name: '异星原型货舱',
    slot: 'cargo',
    rack: 'low',
    bonus: 1.8,
    description: '货舱容量 +180%。异星空间技术，无法复制——不可制造。',
    cpuUse: 60,
  },

  // ══════════ 炮台（turret：V17.2 炮族制——固定弹种 × 档位；11 件；V18 口径取消） ══════════
  // 轻型（MK1）速射近程；重型（MK2）慢射远程；攻坚（MK3）超远程；同 MK 各弹种款
  // 性能一致、只换伤害类型（克制：动能打盾×1.5/高爆打甲×1.5/能量打盾×1.25 通用）。
  // 蓝图 = 动能款（协会制式）；高爆/能量款市场专供；弹药每型单档（-l），全炮台通用。
  {
    id: 'mod-turret-civ',
    name: '民用舰炮',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 24,
    description: '协会自警队制式轻型动能炮：吃动能弹药，4.2 km 有效射程。入门即动能——默认悬赏都能打。',
    cpuUse: 6,
    maxRangeM: 4200,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.5, // 2026-09-11 船长定（自 main 同步）：我方动能炮台远端命中衰减统一 0.5（民用 0.3 → 0.5）
    reloadMs: 2400,
    dmgMult: 1.0,
  },
  {
    id: 'mod-turret-kin-1',
    name: '轻型炮台 MK1·动能型',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 24,
    description: '轻型动能速射炮：对护盾 ×1.5、对装甲 ×0.75。',
    cpuUse: 10,
    maxRangeM: 3220, // 2026-09-08 船长定：动能炮射程 −30%（4600→3220），装填等价缩短（2200→1540）
    // 2026-09-17 船长：「将动能炮MK1~MK3的最小射程修改为500/600/700」⇒ 本件 250 → **500**
    minRangeM: 500,
    hitRate: 0.8,
    falloff: 0.5, // 2026-09-11 船长定（自 main 同步）：动能炮台远端命中 0.3 → 0.5
    reloadMs: 1540,
    dmgMult: 1.25,
  },
  {
    id: 'mod-turret-kin-2',
    name: '重型炮台 MK2·动能型',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 12,
    description: '重型动能炮：5.7 km 中远程。协会重型制式（蓝图可造）——中程压制的正解。',
    cpuUse: 28,
    maxRangeM: 5740, // 2026-09-08 船长定：动能炮射程 −30%（8200→5740），装填等价缩短（3400→2380）
    // 2026-09-17 船长：「将动能炮MK1~MK3的最小射程修改为500/600/700」⇒ 本件 700 → **600**
    minRangeM: 600,
    hitRate: 0.78,
    falloff: 0.5, // 2026-09-11 船长定（自 main 同步）：动能炮台远端命中 0.28 → 0.5
    reloadMs: 2380,
    dmgMult: 3.73,
  },
  {
    id: 'mod-turret-kin-3',
    name: '攻坚炮台 MK3·动能型',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 12,
    description: '攻城级动能巨炮：7.4 km，攻坚炮里的协会制式（蓝图可造，52 CPU 顶级重炮）。',
    cpuUse: 52,
    maxRangeM: 7350, // 2026-09-08 船长定：动能炮射程 −30%（10500→7350），装填等价缩短（4200→2940）
    // 2026-09-17 船长：「将动能炮MK1~MK3的最小射程修改为500/600/700」⇒ 本件 1200 → **700**（攻坚炮近盲带大幅收窄）
    minRangeM: 700,
    hitRate: 0.78,
    falloff: 0.5, // 2026-09-11 船长定（自 main 同步）：动能炮台远端命中 0.28 → 0.5
    reloadMs: 2940,
    dmgMult: 5.13,
  },
  /* ══════════ 防空武器（2026-09-11 机群批 S4 · 船长「需要带有防空属性的武器（**为近防炮做铺垫**）」+
     「**近防炮分族**」+「**做 E 族**，其他种族需要时候再做」） ══════════
   * **玩法口径**：玩家武器**默认打不到敌方无人机**；只有带**防空属性**（`canHitDrones`）的武器能打
   * ⇒ **带机群的仗，答案是近防炮**。
   * **定位 = 点防**：射程极短（1.4 km）、射速极快（1.5 秒一轮）、**对舰也打得动但 dps 远低于同档主炮**
   * ——它占一个**高槽**，代价就是少一门主炮；不是主炮替代品。
   * **族别（船长「分族」）**：本批只出 **E 族（泰坦巨构）**一件，其余族按需再补。 */
  {
    id: 'mod-pd-e',
    name: '近防炮 MK1',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 40,
    description: '动能点防炮：射程短、射速快。贴到近处威力很足，对舰不吃亏；带防空属性的武器才筛得到敌方机群。',
    cpuUse: 12,
    maxRangeM: 2500, // 2026-09-11 船长裁定「**近防炮射程按照 2500m 算**」（原 1400）；打机群**不看两舰间距**（甲案）
    minRangeM: 1, // 无近盲带：贴到脸上也开火
    hitRate: 0.9, // 点防本职：高命中
    falloff: 0.5,
    reloadMs: 1500, // 快射速是它的性格
    // **2026-09-12 船长裁定「丙」**：「**提高近防炮伤害，且因为其射程更短，威力应该提高**」⇒
    // 单发 3 → **10**（dmgMult 0.5 → 1.65）、名义 DPS 2.00 → **6.67**（= 轻型炮台 MK1 的 1.28 倍——
    // 射程只有 2,500m 对 3,220m，近身威力补回来）。**作废**旧口径「单发 = 同档主炮的 ~40% ⇒ 对舰明显偏弱」。
    dmgMult: 1.65,
    // **防空（属性）**（船长 2026-09-12：「**给近防炮系列添加一个属性"防空"，将近防炮的对无人机伤害 ×2
    // 写到防空属性里**」）：一条属性 = ①**能筛到敌方机群**（原 `canHitDrones` 已并入本字段）
    // ②**对无人机伤害 ×2**（原 `antiDroneDmgMul` 已并入本字段，2026-09-12「那伤害倍率按2倍算」）。
    // 三档同值（档位差仍由单发/射速承担）；界面在模块信息里渲染成一行「防空」。
    antiDrone: 2, // 防空（属性）：能打敌机群 + 对无人机伤害 ×2（船长 2026-09-12「按2倍算」）
  },
  // 2026-09-11 补档（防空行实测口径：**射程不拉长**——1.4 km 已在"贴近"打法里够用，
  // "想打机群就得走进警戒幕"这条张力应当保留；MK2/MK3 只提单发与射速）
  {
    id: 'mod-pd-e-2',
    name: '近防炮 MK2',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 48,
    description: '动能点防炮的强化型：射速更快、单发更重，射程依旧偏短——近身对舰与打机群都更利落。',
    cpuUse: 26,
    maxRangeM: 2500, // 三档同射程（船长「按照 2500m 算」）——MK2/MK3 的差异只在单发与射速
    minRangeM: 1,
    hitRate: 0.9,
    falloff: 0.5,
    reloadMs: 1400,
    dmgMult: 2.65, // 2026-09-12 裁定「丙」：单发 5 → **16**、名义 DPS **11.43**（= 重型炮台 MK2 的 1.24 倍）
    antiDrone: 2, // 防空（属性）：能打敌机群 + 对无人机伤害 ×2（船长 2026-09-12「按2倍算」）
  },
  {
    id: 'mod-pd-e-3',
    name: '近防炮 MK3',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 56,
    description: '动能点防炮的顶档：射速与单发都拉到极限，射程仍是贴身的那一小段——贴上去打，它是全场最凶的一门。',
    cpuUse: 44,
    maxRangeM: 2500,
    minRangeM: 1,
    hitRate: 0.92,
    falloff: 0.5,
    reloadMs: 1300,
    dmgMult: 2.85, // 2026-09-12 裁定「丙」：单发 6 → **17**、名义 DPS **13.08**（= 攻坚炮台 MK3 的 1.24 倍）
    antiDrone: 2, // 防空（属性）：能打敌机群 + 对无人机伤害 ×2（船长 2026-09-12「按2倍算」）
  },
  // ══════════ 激光炮（V18B-2 能量系武器形态：消耗能量弹药，必中光束） ══════════
  // 与原能量炮/异星原型（已退役迁移）同伤害系（plasma）/同消耗键，但性格独立：
  // - 必中：射程带内不掷命中（无视距离衰减与回避，锁定即命中）；
  // - 距离衰减作用在**威力**而非命中——**2026-09-11 船长定（自 main 同步）：合并旧修正、不再与命中衰减挂钩**，
  //   统一为"近端 ×1 → 最远端 ×该武器 falloff"，激光件一律 **falloff 0.1（最远端威力 ×0.10）**；
  //   （旧口径 = 命中衰减 ×0.8：falloff 0.30/0.35 → 远端 ×0.44/×0.48，现已作废）
  //   威系数 = 1 − 进度×(1−falloff)，保底 0）；
  // - minRange 0（光束无弹道近盲）；逐发消耗能量弹药（ammo-plasma-l = 能量弹药）；
  // - 数值初值对照原能量炮 dmgMult 下调（必中优势），进 C4 校准轮复核；
  // - 市场专供（无蓝图；沿用原能量炮渠道与价位）。异星原型 → 原型激光（奇货）。
  {
    id: 'mod-laser-1',
    name: '轻型激光炮 MK1',
    slot: 'laser',
    rack: 'high',

    damageType: 'plasma',
    ammoPerEngagement: 24,
    description: '轻型激光炮：光束必中、无视近盲，威力随距离衰减，吃能量弹药。',
    cpuUse: 10,
    maxRangeM: 4600,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.1, // 2026-09-11 船长定（自 main 同步）：能量武器远端统一「最远端威力 ×0.1」（旧 0.3 的 ×0.8 修正已合并作废）
    reloadMs: 2000,
    dmgMult: 1.1,
  },
  {
    id: 'mod-laser-2',
    name: '重型激光炮 MK2',
    slot: 'laser',
    rack: 'high',

    damageType: 'plasma',
    ammoPerEngagement: 12,
    description: '重型激光炮：8.2 km 远程光束，必中但威力随距离明显衰减——中程稳定输出的正解。',
    cpuUse: 28,
    maxRangeM: 8200,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.1, // 2026-09-11 船长定（自 main 同步）：远端统一「最远端威力 ×0.1」（旧 0.35 ×0.8 = ×0.48 作废）
    reloadMs: 3200,
    dmgMult: 3,
  },
  {
    id: 'mod-laser-3',
    name: '攻坚激光炮 MK3',
    slot: 'laser',
    rack: 'high',

    damageType: 'plasma',
    ammoPerEngagement: 12,
    description: '攻城级激光炮：10.5 km 光束炮塔——编队攻坚的稳定火力。',
    cpuUse: 52,
    maxRangeM: 10500,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.1, // 2026-09-11 船长定（自 main 同步）：远端统一「最远端威力 ×0.1」
    reloadMs: 4000,
    dmgMult: 4.2,
  },
  {
    id: 'mod-laser-proto',
    name: '异星原型激光炮',
    slot: 'laser',
    rack: 'high',

    damageType: 'plasma',
    ammoPerEngagement: 12,
    description: '无法逆向工程的异星能量武器：13 km 光束——不可制造。',
    cpuUse: 70,
    maxRangeM: 13000,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.1, // 2026-09-11 船长定（自 main 同步）：远端统一「最远端威力 ×0.1」
    reloadMs: 4600,
    dmgMult: 5.1,
  },

  // ══════════ 导弹架（V18B-1 爆炸系武器形态：爆破弹药弹头，逐发消耗） ══════════
  // 与原高爆炮（已退役迁移）同伤害系/同消耗键，但性格独立：
  // - 近盲安全射距（minRange 500/900/1400：太近发射会炸到自己）；命中不随距离衰减（falloff 1 = 追踪制）；
  // - 射程比同档动能炮更远、装填更慢、命中更高（追踪）——"远程爆破轰炸"定位；
  // - 数值初值 = 原高爆炮 dmgMult 继承 + 节奏重排，进 C4 校准轮复核；
  // - 市场专供（无蓝图；沿用原高爆炮渠道与价位）。
  {
    id: 'mod-missile-1',
    name: '轻型导弹架 MK1',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 24,
    description: '轻型导弹巢：发射爆破弹药（对装甲 ×1.5、对护盾 ×0.75）；近盲 500 m。',
    cpuUse: 10,
    maxRangeM: 7440, // 2026-09-08 船长定：导弹射程/装填/伤害倍率同步 +20%（6200/2600/1.25 → 7440/3120/1.5）
    minRangeM: 500,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 3432, // 2026-09-15 船长「**提高所有导弹发射器10%的周期**」：3120 → **3432**（周期 +10%，其余字段一字未动）
    dmgMult: 1.5,
  },
  {
    id: 'mod-missile-2',
    name: '重型导弹架 MK2',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '重型导弹巢：11.8 km 远程爆破轰炸——装甲舰编队的噩梦。',
    cpuUse: 28,
    maxRangeM: 11760, // 2026-09-08 船长定：导弹射程/装填/伤害倍率同步 +20%（9800/4000/3.66 → 11760/4800/4.39）
    minRangeM: 900,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 5280, // 2026-09-15 船长「**提高所有导弹发射器10%的周期**」：4800 → **5280**（周期 +10%，其余字段一字未动）
    dmgMult: 4.39,
  },
  {
    id: 'mod-missile-3',
    name: '巡航导弹架 MK3',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '巡航导弹巢：14.9 km 远程毁灭——大编队交火前先发制人的火力。',
    cpuUse: 52,
    maxRangeM: 14880, // 2026-09-08 船长定：导弹射程/装填/伤害倍率同步 +20%（12400/5000/5.03 → 14880/6000/6.04）
    minRangeM: 1400,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 6600, // 2026-09-15 船长「**提高所有导弹发射器10%的周期**」：6000 → **6600**（周期 +10%，其余字段一字未动）
    dmgMult: 6.04,
  },

  // ══════════ 无人机装置（V18 高槽装置位：远行星号式；与炮/矿共位竞争） ══════════
  // 无人机甲板扩展 = +droneBayM3（携带/放飞上限；线性可叠件）；战术导控阵列 =
  // 放飞无人机单发伤害加成（求和乘入；线性可叠件）。两者均为市场专供（无蓝图）。
  {
    id: 'mod-drone-rack-1',
    name: '无人机甲板扩展 MK1',
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 15,
    cpuUse: 5,
    description: '外挂无人机甲板：无人机舱 +15 m³（可多带 3 架侦察机 / 1 架战斗机）。无人机流的起点。',
  },
  {
    id: 'mod-drone-rack-2',
    name: '无人机甲板扩展 MK2',
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 35,
    cpuUse: 15,
    description: '外挂无人机甲板：无人机舱 +35 m³。中型无人机编队的扩容方案。',
  },
  {
    id: 'mod-drone-rack-3',
    name: '无人机甲板扩展 MK3',
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 70,
    cpuUse: 40,
    description: '整队级外挂甲板：无人机舱 +70 m³。',
  },
  {
    id: 'mod-drone-tac-1',
    name: '战术导控阵列 MK1',
    slot: 'drone-tac',
    rack: 'high',
    droneDmgBonus: 0.12,
    cpuUse: 8,
    description: '放飞无人机单发伤害 +12%。无人机流派的火力核心。',
  },
  {
    id: 'mod-drone-tac-2',
    name: '战术导控阵列 MK2',
    slot: 'drone-tac',
    rack: 'high',
    droneDmgBonus: 0.25,
    cpuUse: 20,
    description: '放飞无人机单发伤害 +25%。电子战终端加持下的无人机更致命。',
  },
  {
    id: 'mod-drone-tac-3',
    name: '战术导控阵列 MK3',
    slot: 'drone-tac',
    rack: 'high',
    droneDmgBonus: 0.4,
    cpuUse: 45,
    description: '放飞无人机单发伤害 +40%。无人机甲板舰的指挥核心。',
  },

  // ══════════ 无人机中继天线（2026-09-10 船长拍板：高槽装置——延长无人机作战半径；百分比
  //  **按折权加算**乘入机型基础射程（2026-09-14 船长「对无人机的射程插件添加叠加惩罚」⇒ 第 2 件起按 87% / 57% / 28% / 11% 折权后**相加**，不再全额线性叠加）； 市场现货 + 蓝图双渠道，MK3 学习声望 4） ══════════
  {
    id: 'mod-drone-relay-1',
    name: '无人机中继天线 MK1',
    slot: 'drone-relay',
    rack: 'high',
    droneRangeBonusPct: 0.2,
    cpuUse: 6,
    description: '制导中继天线：放飞无人机射程 +20%。给近战机群补一点交战距离。',
  },
  {
    id: 'mod-drone-relay-2',
    name: '无人机中继天线 MK2',
    slot: 'drone-relay',
    rack: 'high',
    droneRangeBonusPct: 0.45,
    cpuUse: 16,
    description: '制导中继天线：放飞无人机射程 +45%。中远程无人机的扩容方案。',
  },
  {
    id: 'mod-drone-relay-3',
    name: '无人机中继天线 MK3',
    slot: 'drone-relay',
    rack: 'high',
    droneRangeBonusPct: 0.8,
    cpuUse: 46, // 2026-09-10 船长：MK3 CPU 38 → 46（顶配装置高占用）
    description: '制导中继天线：放飞无人机射程 +80%。哨戒无人机可深入激光炮带。',
  },

  // ══════════ 护盾增强器（shield 抗性件：纯抗性，分系缺口乘入） ══════════
  {
    id: 'mod-shield-kin-1',
    name: '护盾增强器 MK1·动能型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.2 },
    cpuUse: 5,
    description: '动能抗 +20%（上限 90%）。动能是协会武装最常用弹种——默认悬赏都吃这口。',
  },
  {
    id: 'mod-shield-exp-1',
    name: '护盾增强器 MK1·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.2 },
    cpuUse: 5,
    description: '高爆抗 +20%（上限 90%）。克制爆破弹与鱼雷型敌人。',
  },
  {
    id: 'mod-shield-pla-1',
    name: '护盾增强器 MK1·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.2 },
    cpuUse: 5,
    description: '能量抗 +20%（上限 90%）。对能量武器的调谐方案。',
  },
  {
    id: 'mod-shield-kin-2',
    name: '护盾增强器 MK2·动能型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.35 },
    cpuUse: 15,
    description: '动能抗 +35%（上限 90%）。带弹道预测算法的第二代调谐器。',
  },
  {
    id: 'mod-shield-exp-2',
    name: '护盾增强器 MK2·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.35 },
    cpuUse: 15,
    description: '高爆抗 +35%（上限 90%）。专为爆破弹道优化的护盾频段。',
  },
  {
    id: 'mod-shield-pla-2',
    name: '护盾增强器 MK2·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.35 },
    cpuUse: 15,
    description: '能量抗 +35%（上限 90%）。高频能量护盾的稳定方案。',
  },
  {
    id: 'mod-shield-kin-3',
    name: '护盾增强器 MK3·动能型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.5 },
    cpuUse: 40,
    description: '动能抗 +50%（上限 90%）。旗舰级弹道拦截阵列。',
  },
  {
    id: 'mod-shield-exp-3',
    name: '护盾增强器 MK3·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.5 },
    cpuUse: 40,
    description: '高爆抗 +50%（上限 90%）。可以正面接下爆破弹雨的强化护盾。',
  },
  {
    id: 'mod-shield-pla-3',
    name: '护盾增强器 MK3·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.5 },
    cpuUse: 40,
    description: '能量抗 +50%（上限 90%）。能量武器时代的盾构解。',
  },

  // ══════════ 护盾扩展器（shield 容量件：纯容量，与抗性件同槽二选一） ══════════
  {
    id: 'mod-shield-ext-1',
    name: '护盾扩展器 MK1',
    slot: 'shield',
    rack: 'mid',
    shieldHpBonus: 0.15,
    cpuUse: 5,
    description: '护盾容量 +15%。只堆盾量、不选抗性系时的朴素方案。',
  },
  {
    id: 'mod-shield-ext-2',
    name: '护盾扩展器 MK2',
    slot: 'shield',
    rack: 'mid',
    shieldHpBonus: 0.35,
    cpuUse: 15,
    description: '护盾容量 +35%。扩容器阵列，吃下更多爆发伤害。',
  },
  {
    id: 'mod-shield-ext-3',
    name: '护盾扩展器 MK3',
    slot: 'shield',
    rack: 'mid',
    shieldHpBonus: 0.6,
    cpuUse: 40,
    description: '护盾容量 +60%。全站功率输送的巨型护盾发生器。',
  },

  /* ══════════ 护盾充能装置（2026-09-14 船长：「护盾充能装置，和船体修理装置类似。
     每 30 秒恢复自身护盾最大值一定比例的护盾量。CPU消耗较多」）
     —— 中槽 · 护盾系；**破盾后唯一能把盾点起来的件**（被动回充按当前盾比例 ⇒ 盾归零 = 回充 0）；
        每 30 秒一跳、每跳按**满盾**的一个比例恢复（12 / 20 / 32%）；CPU 比同槽件贵一档。 ══════════ */
  {
    id: 'mod-shieldchg-1',
    name: '护盾充能装置 MK1',
    slot: 'shield',
    rack: 'mid',
    shieldPulsePct: 0.24,
    cpuUse: 25,
    description:
      '每 30 秒脉冲充能，恢复护盾上限的 24%。',
  },
  {
    id: 'mod-shieldchg-2',
    name: '护盾充能装置 MK2',
    slot: 'shield',
    rack: 'mid',
    shieldPulsePct: 0.4,
    cpuUse: 45,
    description:
      '每 30 秒脉冲充能，恢复护盾上限的 40%。',
  },
  {
    id: 'mod-shieldchg-3',
    name: '护盾充能装置 MK3',
    slot: 'shield',
    rack: 'mid',
    shieldPulsePct: 0.64,
    cpuUse: 70,
    description:
      '每 30 秒脉冲充能，恢复护盾上限的 64%。',
  },

  // ══════════ 装甲镀层（armor 抗性件：纯抗性，分系缺口乘入）
  // 2026-09-10 船长定：装甲容量与抗性相关装备 CPU **统一下调 20%**（四舍五入到整数） ══════════
  {
    id: 'mod-armor-kin-1',
    name: '装甲镀层 MK1·动能型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.25 },
    cpuUse: 4,
    description: '动能抗 +25%（上限 90%）。动能弹药的克制镀层。',
  },
  {
    id: 'mod-armor-exp-1',
    name: '装甲镀层 MK1·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.25 },
    cpuUse: 4,
    description: '高爆抗 +25%（上限 90%）。高爆对装甲 ×1.5——这是第一道防线。',
  },
  {
    id: 'mod-armor-pla-1',
    name: '装甲镀层 MK1·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.25 },
    cpuUse: 4,
    description: '能量抗 +25%（上限 90%）。隔热镀层方案。',
  },
  {
    id: 'mod-armor-kin-2',
    name: '装甲镀层 MK2·动能型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.4 },
    cpuUse: 12,
    description: '动能抗 +40%（上限 90%）。复合夹层结构，动能弹药的噩梦。',
  },
  {
    id: 'mod-armor-exp-2',
    name: '装甲镀层 MK2·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.4 },
    cpuUse: 12,
    description: '高爆抗 +40%（上限 90%）。爆震格栅装甲，重炮手眼中最硬的骨头。',
  },
  {
    id: 'mod-armor-pla-2',
    name: '装甲镀层 MK2·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.4 },
    cpuUse: 12,
    description: '能量抗 +40%（上限 90%）。陶瓷隔热层叠技术。',
  },
  {
    id: 'mod-armor-kin-3',
    name: '装甲镀层 MK3·动能型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.55 },
    cpuUse: 32,
    description: '动能抗 +55%（上限 90%）。要塞级复合装甲。',
  },
  {
    id: 'mod-armor-exp-3',
    name: '装甲镀层 MK3·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.55 },
    cpuUse: 32,
    description: '高爆抗 +55%（上限 90%）。顶住高爆齐射的移动堡垒。',
  },
  {
    id: 'mod-armor-pla-3',
    name: '装甲镀层 MK3·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.55 },
    cpuUse: 32,
    description: '能量抗 +55%（上限 90%）。能硬抗能量炮的烧蚀装甲。',
  },

  // ══════════ 装甲增厚板（armor 容量件：纯容量，与抗性件同槽二选一） ══════════
  {
    id: 'mod-armor-plate-1',
    name: '装甲增厚板 MK1',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.2,
    cpuUse: 4,
    description: '装甲容量 +20%。经典堆甲方案，只加厚度、不挑弹种。',
  },
  {
    id: 'mod-armor-plate-2',
    name: '装甲增厚板 MK2',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.45,
    cpuUse: 12,
    description: '装甲容量 +45%。加厚夹层，装甲舰的中坚配置。',
  },
  {
    id: 'mod-armor-plate-3',
    name: '装甲增厚板 MK3',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.8,
    cpuUse: 32,
    description: '装甲容量 +80%。全站重工浇铸的复合装甲层。',
  },

  // ══════════ 矢量推进器（propulsion：**周期点火式**加力 + 点火期命中代价） ══════════
  // 2026-09-10 船长定：推进器不再常驻提速——改为**点火 60 秒 / 冷却 60 秒**（开场即点火）；
  // 幅度**沿用原档 30/60/100%**（船长同日回收了先提的 40/80/130%）；冷却期内不提供任何速度加成，
  // 点火代价（开火命中）也只在点火期生效。战斗界面底部「装填冷却」行同步显示冷却倒计时。
  {
    id: 'mod-prop-1',
    name: '矢量推进器 MK1',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.3,
    hitPenalty: 0.05,
    cpuUse: 5,
    description: '加力推进：点火期间战斗速度 +30%，持续 60 秒后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.95。逼近/脱离更快，输出略失稳。',
  },
  {
    id: 'mod-prop-2',
    name: '矢量推进器 MK2',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.6,
    hitPenalty: 0.12,
    cpuUse: 15,
    description: '加力推进：点火期间战斗速度 +60%，持续 60 秒后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.88。高机动舰标配，风筝战术的引擎。',
  },
  {
    id: 'mod-prop-3',
    name: '矢量推进器 MK3',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 1,
    hitPenalty: 0.2,
    cpuUse: 40,
    description: '加力推进：点火期间战斗速度 +100%，持续 60 秒后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.80。短距冲刺压燃引擎——快，但不稳。',
  },

  // ══════════ 微型跃迁引擎（propulsion：**短爆发**加力——点火 10 秒 / 冷却 60 秒） ══════════
  // 2026-09-14 船长定：「添加新装备，中槽，**微型跃迁引擎**：提供远超推进器的加速度，但是只持续 10 秒，
  // 冷却依旧 60 秒。」数值（船长给定，三档）：MK1 +80%（命中×0.80）· MK2 +150%（×0.75）· MK3 +250%（×0.60）。
  // 与三档矢量推进器**同槽族**（`slot: 'propulsion'` · 中槽），但**自带周期**——`thrusterBoostMs` /
  // `thrusterCooldownMs` 覆盖全局的 60/60 ⇒ 装了它的船自己按 10/70 走（引擎**逐单位**判定，
  // 见 core `combat.thrusterPhase` / `unitThrusterCycle`）。
  // ⚠ 占空比只有 10/70 ≈ 14%（矢量是 60/120 = 50%）⇒ **峰值高、均速低**：抢位/脱离/开场压制的爆发件，
  // 长期风筝仍归矢量推进器。
  {
    id: 'mod-mwd-1',
    name: '微型跃迁引擎 MK1',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.8,
    hitPenalty: 0.2,
    thrusterBoostMs: 10_000,
    thrusterCooldownMs: 60_000,
    cpuUse: 10,
    description: '短爆发跃迁推进：点火期间战斗速度 +80%，只持续 10 秒，随后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.80。十秒的位移够抢一个阵位——但别指望它一直快。',
  },
  {
    id: 'mod-mwd-2',
    name: '微型跃迁引擎 MK2',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 1.5,
    hitPenalty: 0.25,
    thrusterBoostMs: 10_000,
    thrusterCooldownMs: 60_000,
    cpuUse: 25,
    description: '短爆发跃迁推进：点火期间战斗速度 +150%，只持续 10 秒，随后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.75。十秒内把自己甩到对方够不着的地方，剩下的时间靠船体扛。',
  },
  {
    id: 'mod-mwd-3',
    name: '微型跃迁引擎 MK3',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 2.5,
    hitPenalty: 0.4,
    thrusterBoostMs: 10_000,
    thrusterCooldownMs: 60_000,
    cpuUse: 50,
    description: '短爆发跃迁推进：点火期间战斗速度 +250%，只持续 10 秒，随后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.60——这是全场最暴烈的十秒，也是最打不准的十秒。',
  },

  // ══════════ V18.1 支援件（support：低槽 = 伤害稳定器/射速计算机/**跃迁计算机**；中槽 = 索敌阵列/姿态陀螺） ══════════
  // 收敛标签：伤害/射速 = 可多装·全额叠加（加算）；命中 = 多装递减（EVE 曲线）；闪避 = 多装递减（缺口复合）；
  // 跃迁（2026-09-14 新增）= 多装递减（EVE 曲线）。
  // 数值 = 暂定初值（MK1/MK2/MK3：+6/10/15% 等；CPU 5/15/40），进 C4 校准轮复核。
  {
    id: 'mod-stab-kin-1',
    name: '动能稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.06 },
    cpuUse: 5,
    description: '动能武器支援：动能系武器单发伤害 +6%。',
  },
  {
    id: 'mod-stab-kin-2',
    name: '动能稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.1 },
    cpuUse: 15,
    description: '动能武器支援：动能系武器单发伤害 +10%。',
  },
  {
    id: 'mod-stab-kin-3',
    name: '动能稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.15 },
    cpuUse: 40,
    description: '动能武器支援：动能系武器单发伤害 +15%。',
  },
  {
    id: 'mod-stab-exp-1',
    name: '高爆稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.06 },
    cpuUse: 5,
    description: '高爆武器支援：高爆系武器单发伤害 +6%。',
  },
  {
    id: 'mod-stab-exp-2',
    name: '高爆稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.1 },
    cpuUse: 15,
    description: '高爆武器支援：高爆系武器单发伤害 +10%。',
  },
  {
    id: 'mod-stab-exp-3',
    name: '高爆稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.15 },
    cpuUse: 40,
    description: '高爆武器支援：高爆系武器单发伤害 +15%。',
  },
  {
    id: 'mod-stab-pla-1',
    name: '等离子稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.06 },
    cpuUse: 5,
    description: '等离子武器支援：能量系武器单发伤害 +6%。',
  },
  {
    id: 'mod-stab-pla-2',
    name: '等离子稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.1 },
    cpuUse: 15,
    description: '等离子武器支援：能量系武器单发伤害 +10%。',
  },
  {
    id: 'mod-stab-pla-3',
    name: '等离子稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.15 },
    cpuUse: 40,
    description: '等离子武器支援：能量系武器单发伤害 +15%。',
  },
  {
    id: 'mod-rof-1',
    name: '射速计算机 MK1',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.05,
    cpuUse: 5,
    description: '炮台射速支援：装填间隔 −5%。',
  },
  {
    id: 'mod-rof-2',
    name: '射速计算机 MK2',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.08,
    cpuUse: 15,
    description: '炮台射速支援：装填间隔 −8%。',
  },
  {
    id: 'mod-rof-3',
    name: '射速计算机 MK3',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.12,
    cpuUse: 40,
    description: '炮台射速支援：装填间隔 −12%。',
  },
  /* ══════════ 跃迁计算机（2026-09-14 船长：「添加低槽装备…效果是提高玩家舰船的跃迁速度，
   * 分别提高20%和35%，多件叠加惩罚。基础价格可以按照同级装备价格的四倍，有蓝图。」
   * → 定名「跃迁计算机」；只有 MK2/MK3 两档）══════════
   * 效果面 = **星系际航行耗时**（`travel.warpSpeedAus` 唯一入口：采矿往返/悬赏·远征/长途运输/
   * 扫描返航/快递/AI 副船，逐船生效）；**不碰战斗机动**（那是矢量推进器与推进器周期的地盘）。
   * 多件走 EVE 曲线（多装递减）；价 = 低槽支援件同档（48.1 万 / 236 万）×4。 */
  {
    id: 'mod-warpcomp-2',
    name: '跃迁计算机 MK2',
    slot: 'support',
    rack: 'low',
    warpSpeedBonusPct: 0.2,
    cpuUse: 15,
    description: '航行支援：跃迁速度 +20%——只缩短星系际航行时间，不改变战斗机动。多装递减。',
  },
  {
    id: 'mod-warpcomp-3',
    name: '跃迁计算机 MK3',
    slot: 'support',
    rack: 'low',
    warpSpeedBonusPct: 0.35,
    cpuUse: 40,
    description: '航行支援：跃迁速度 +35%——只缩短星系际航行时间，不改变战斗机动。多装递减。',
  },
  {
    id: 'mod-track-1',
    name: '索敌阵列 MK1',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.08,
    cpuUse: 5,
    description: '索敌支援：炮台命中整体提升 8%。',
  },
  {
    id: 'mod-track-2',
    name: '索敌阵列 MK2',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.12,
    cpuUse: 15,
    description: '索敌支援：炮台命中整体提升 12%。',
  },
  {
    id: 'mod-track-3',
    name: '索敌阵列 MK3',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.16,
    cpuUse: 40,
    description: '索敌支援：炮台命中整体提升 16%。',
  },
  {
    id: 'mod-gyro-1',
    name: '姿态陀螺 MK1',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.1,
    cpuUse: 5,
    description: '机动支援：被命中缺口削减 10%。',
  },
  {
    id: 'mod-gyro-2',
    name: '姿态陀螺 MK2',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.15,
    cpuUse: 15,
    description: '机动支援：被命中缺口削减 15%。',
  },
  {
    id: 'mod-gyro-3',
    name: '姿态陀螺 MK3',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.2,
    cpuUse: 40,
    description: '机动支援：被命中缺口削减 20%。',
  },

  // ══════════ 协处理器（cpu：低槽，**装配 CPU 预算扩容**） ══════════
  // 2026-09-11 船长定（原话）：「新增低槽配件，效果是增加舰船CPU」＋四条细裁：
  //   ① **自身不占用**（`cpuUse: 0`）——只加预算，`cpuBonus` = **+25 / +35 / +45（三档）**；
  //      （船长同日追加：「之前的CPU装备，增加的CPU数值上调至25/35/45」——原定 +10/+15/+20 上调，价与稀有度未动）
  //   ② 新开一族「协处理器」（低槽，与装甲/货舱/支援件抢同一槽位）；
  //   ③ 渠道：MK1 稀有度 2、MK2 稀有度 3（稀有订单层）、**MK3 稀有度 4 走奇货、无蓝图**；
  //   ④ 防套利 = **双向校验**（预算随件走，卸下时必须预演最终状态，超载拒绝卸下，见 equipment.cpuOverloadText）。
  // 叠加：多件全额叠加（与容量类同口径），天然上限 = 该船低槽位数（1~3）。
  // ⚠ 契约配套：`content-check` 的「装备 cpuUse ≥ 1」放宽为「≥ 0，且只有带 cpuBonus 的件可为 0」。
  {
    id: 'mod-cpu-1',
    name: '协处理器 MK1',
    slot: 'cpu',
    rack: 'low',
    cpuUse: 0, // 船长定：自身不占用（零占用只允许"加预算"件，见 content-check 契约）
    cpuBonus: 25,
    description: '算力扩展卡：装配 CPU 上限 +25。本件自身不占 CPU。',
  },
  {
    id: 'mod-cpu-2',
    name: '协处理器 MK2',
    slot: 'cpu',
    rack: 'low',
    cpuUse: 0,
    cpuBonus: 35,
    description: '双路算力扩展卡：装配 CPU 上限 +35。本件自身不占 CPU，中后期的通用解锁件。',
  },
  {
    id: 'mod-cpu-3',
    name: '协处理器 MK3',
    slot: 'cpu',
    rack: 'low',
    cpuUse: 0,
    cpuBonus: 45,
    description: '军用算力堆叠模块：装配 CPU 上限 +45（不可制造）。本件自身不占 CPU。',
  },

  // ══════════ B3 打捞器（salvager：**高槽**无伤害件 —— 2026-09-05 定稿高槽、2026-09-13 一度改判低槽、**2026-09-14 船长「改回高槽」**） ══════════
  // 每轮每台捞 1 具残骸；升级只缩短周期不增产（10s/8s/6s）；多台叠加；CPU 2/6/15（压缩表）。
  // 周期字段 salvageCycleMs 供打捞作业引擎消费；产出/密度关系见 salvage.ts 与 docs/design/b3-salvage.md。
  {
    id: 'mod-salvager-1',
    name: '打捞器 MK1',
    slot: 'salvager',
    workEfficiency: 0.2, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    cpuUse: 2,
    salvageCycleMs: 10_000,
    description: '残骸打捞：每 10 秒捞取 1 具残骸；密度越高捞到的残骸越肥。',
  },
  {
    id: 'mod-salvager-2',
    name: '打捞器 MK2',
    slot: 'salvager',
    workEfficiency: 0.4, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    cpuUse: 6,
    salvageCycleMs: 8_000,
    description: '残骸打捞：周期缩短至 8 秒/轮。',
  },
  {
    id: 'mod-salvager-3',
    name: '打捞器 MK3',
    slot: 'salvager',
    workEfficiency: 0.6, // 虫洞内打捞/采集效率（2026-09-19 谜质科技树批；见 ModuleDef.workEfficiency）
    rack: 'high',
    cpuUse: 15,
    salvageCycleMs: 6_000,
    description: '残骸打捞：周期缩短至 6 秒/轮。',
  },
  /* ═══ 2026-09-09 船体维修装置（船长定：中槽；战斗中每 5 秒自动修复装甲+结构，
      每脉冲消耗 1 枚修理组件（民用级吃民用组件 / MK1·MK2 吃军用组件）；组件耗尽自动停机；
      三档：民用级 / MK1 / MK2）
      2026-09-10 船长定：船体维修装置 CPU **统一上调 20%**（四舍五入到整数：6→7 / 14→17 / 26→31） ═══ */
  {
    id: 'mod-hullrep-civ',
    name: '民用船体维修装置',
    slot: 'support',
    rack: 'mid',
    cpuUse: 7,
    repairArmorHp: 5,
    repairHullHp: 5,
    repairKit: 'repairkit-civ',
    description: '中槽维修装置：战斗中每 5 秒修复装甲与结构各 5 点，每跳消耗 1 枚民用修理组件——保命件，修不过敌方火力。每跳修复量随装甲/结构容量加成与舰体快修学放大。',
  },
  {
    id: 'mod-hullrep-1',
    name: '船体维修装置 MK1',
    slot: 'support',
    rack: 'mid',
    cpuUse: 17,
    repairArmorHp: 10,
    repairHullHp: 10,
    repairKit: 'repairkit-mil',
    description: '中槽维修装置：战斗中每 5 秒修复装甲与结构各 10 点，每跳消耗 1 枚军用修理组件——显著延寿，修不过敌方火力。每跳修复量随装甲/结构容量加成与舰体快修学放大。',
  },
  {
    id: 'mod-hullrep-2',
    name: '船体维修装置 MK2',
    slot: 'support',
    rack: 'mid',
    cpuUse: 31,
    repairArmorHp: 18,
    repairHullHp: 18,
    repairKit: 'repairkit-mil',
    description: '中槽维修装置：战斗中每 5 秒修复装甲与结构各 18 点，每跳消耗 1 枚军用修理组件——高配巡洋/战列舰的持久战底牌。每跳修复量随装甲/结构容量加成与舰体快修学放大。',
  },

  /* ═══ 2026-09-09 目标锁定阵列（target-lock 家族·高槽；船长拍板：集火 + 被锁目标受击加深；
     装上任意一件即触发集火模式——**全队**全部武器不再随机分散，改打存活编队首位（主舰优先、
     击毁自动接力）；加深按档位 8/12/20%，多件 EVE 曲线收敛（见 equipment.stackingOf）；
     ⚠ **2026-09-17 船长：「增伤改为全队生效。」＋「集火也是全队生效」** ⇒ 编队取最高一份、
     增伤与集火都作用于全队（落点 `combat.applyFleetLockAura`，每拍重建处施加）） ═══ */
  {
    id: 'mod-lock-1',
    name: '目标锁定阵列 MK1',
    slot: 'target-lock',
    rack: 'high',
    cpuUse: 6,
    lockDmgBonus: 0.08,
    description: '全队集火编队首位，全队伤害 +8%',
  },
  {
    id: 'mod-lock-2',
    name: '目标锁定阵列 MK2',
    slot: 'target-lock',
    rack: 'high',
    cpuUse: 14,
    lockDmgBonus: 0.12,
    description: '全队集火编队首位，全队伤害 +12%',
  },
  {
    id: 'mod-lock-3',
    name: '目标锁定阵列 MK3',
    slot: 'target-lock',
    rack: 'high',
    cpuUse: 26,
    lockDmgBonus: 0.2,
    description: '全队集火编队首位，全队伤害 +20%',
  },

  /* ═══ 2026-09-15 隐秘行动装置（船长原话：「添加隐秘行动装置，高槽，效果是自身武器开火前，
      隐身30秒（不被锁定，不被攻击）」；六问六答：两档 MK2/MK3 = **20 / 30 秒**、**极度吃 CPU**、
      **带推进器则直接解除隐身**）——家族 = 支援件（rack 显式高槽，与锁定阵列同槽竞争）。
      引擎口径见 core/types.ts 的 `ModuleDef.stealthMs` 与 combat 的 `isMyUnitTargetable`。 ═══ */
  {
    id: 'mod-stealth-2',
    name: '隐秘行动装置 MK2',
    slot: 'support',
    rack: 'high',
    cpuUse: 55,
    stealthMs: 20_000,
    description:
      '开火前隐身 20 秒；与任何类型推进器一起使用时失效。',  },
  {
    id: 'mod-stealth-3',
    name: '隐秘行动装置 MK3',
    slot: 'support',
    rack: 'high',
    cpuUse: 80,
    stealthMs: 30_000,
    description:
      '开火前隐身 30 秒；与任何类型推进器一起使用时失效。',  },

  /* ═══ 2026-09-10 赏金任务·窝点专属装备（船长认可草案；**数值为占位初值，等船长定数后改这里**） ═══
     获取渠道：只在精炼炉「残骸回收」开**稀有残骸（高级箱）**时掉落——打赢赏金任务的敌人窝点、
     把该星系留下的稀有残骸捞回站内开箱，才可能拿到对应敌族的专属件。**无蓝图、不上市场**，
     也不进任何常规掉落池；按敌族取池（见 core/lairs.ts 的 FOE_LAIR_GEAR）。
     留空的两族：**B 族（武装拾荒者）**——2026-09-10 船长定取消 B 族窝点/赏金任务，原
     「拾荒者拆解臂」一并撤下；**F 族（制式巡逻）【已废弃·留档：2026-09-11 船长「废弃F族，将F族
     融合进A族」】**——该族从未有窝点成员（只有四张隐藏遭遇模板，且已显式登记 A 族），
     专属件池**恒为空**、`'F'` 字母位保留为空位。 */
  {
    id: 'mod-lair-turret-a',
    name: '劫掠者转管炮',
    slot: 'turret',
    rack: 'high',
    damageType: 'kinetic',
    ammoPerEngagement: 48,
    maxRangeM: 3600,
    minRangeM: 180,
    hitRate: 0.84,
    falloff: 0.35, // 2026-09-11 船长定：本件**保持 0.35**（只把 D 族守墓者长炮单独上调到 0.6；普通 MK3 为 0.5）
    reloadMs: 1200,
    dmgMult: 1.8,
    cpuUse: 34,
    description:
      '海盗窝点专属：缴获改装的多管动能炮——转管泼弹、射速极快，火力密度接近重型炮台，但射程只有攻坚炮台的一半、耗弹量是它的数倍；贴身缠斗最凶。',
  },
  {
    id: 'mod-lair-missile-a',
    name: '掠袭导弹巢',
    slot: 'missile',
    rack: 'high',
    damageType: 'explosive',
    ammoPerEngagement: 36,
    maxRangeM: 4500,
    minRangeM: 200,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 2420, // 2026-09-15 船长「**提高所有导弹发射器10%的周期**」：2200 → **2420**（周期 +10%，其余字段一字未动）
    dmgMult: 2.6,
    cpuUse: 36,
    description:
      '海盗窝点专属：掠袭艇拆下来的近程导弹巢——贴到脸上齐射爆破弹，追踪命中不随距离衰减、近盲安全射距仅 200 m；射程短到只能近身用，靠的是"贴上去就有量"。',
  },
  {
    id: 'mod-lair-cargo-a',
    name: '赃物强化舱',
    slot: 'cargo',
    rack: 'low',
    bonus: 1,
    armorHpBonus: 0.15,
    cpuUse: 36,
    description:
      '海盗窝点专属：缴获改装的分隔舱——货舱容量 +100%，并在舱壁内侧加挂捕获来的装甲板（装甲容量 +15%）。搬赃与跑商特化，战斗收益有限。',
  },
  {
    id: 'mod-lair-armor-c',
    name: '生体甲壳板',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.1, explosive: 0.1, plasma: 0.1 },
    repairArmorHp: 6,
    repairIntervalMs: 5000,
    repairFree: true,
    // 2026-09-17 船长：「**生体甲壳板的维修量，我希望不吃装甲容量的加成**」
    // ⇒ 本件与「生体损管腔」是同一条例外的两件（2026-09-16「维修量统一吃层容量加成」的单件例外，
    //   当日船长追加「损管腔也一同修改」）——两件都是**无消耗自愈**；耗组件装置照旧吃加成。
    //   ⚠ 说明文案归三号那批（同一件·在途），本行只动字段。
    repairIgnoresCapacityAmp: true,
    cpuUse: 30,
    description:
      '装甲层三系减伤各 +10%；交火中每 5 秒自修 6 点装甲（不吃组件）。',
  },
  {
    id: 'mod-lair-dc-c',
    name: '生体损管腔',
    slot: 'support',
    rack: 'mid',
    hullResistAdd: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 },
    repairHullHp: 4,
    repairIntervalMs: 5000,
    repairFree: true,
    // 2026-09-17 船长：「**损管腔也一同修改**」⇒ 与生体甲壳板同口径：无消耗自愈不吃（结构）容量加成。
    repairIgnoresCapacityAmp: true,
    cpuUse: 34,
    // 2026-09-17 船长：「**并修正损管腔文案**」＋同日立的文案规矩（括号只许放规格 · 不写原因解释；
    // ⚠ 其中的「≤30 字」一项已于 2026-09-18 由船长废止并清档）
    // ⇒ 去掉「修复量随结构容量加成放大」（该机制已作废）与风味句；**句式对齐三号重写后的生体甲壳板**
    //   （「装甲层三系减伤各 +10%；交火中每 5 秒自修 6 点装甲（不吃组件）。」，同样不带"窝点专属"前缀）
    // 括号里只放规格。
    description: '结构层三系减伤各 +25%；交火中每 5 秒自修 4 点结构（不吃组件）。',
  },
  {
    id: 'mod-lair-laser-c',
    name: '酸液喷吐器',
    slot: 'laser',
    rack: 'high',
    damageType: 'plasma',
    ammoPerEngagement: 24,
    maxRangeM: 2800,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.35,
    reloadMs: 3800,
    dmgMult: 4.4,
    cpuUse: 34,
    description:
      '异形生物窝点专属：腺体加压的酸液喷吐——光束级必中、无近盲；走"以射速换单发"的路子：装填偏慢，每一发都重。射程只有 2.8 km，必须贴上去喷。',
  },
  {
    id: 'mod-lair-shield-d',
    name: '陵墓护盾阵列',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.3, explosive: 0.3, plasma: 0.3 },
    cpuUse: 42,
    description:
      '三系减伤各 +30%；不用猜对手弹种。',
  },
  {
    id: 'mod-lair-turret-d',
    name: '守墓者长炮',
    slot: 'turret',
    rack: 'high',
    damageType: 'kinetic',
    ammoPerEngagement: 12,
    maxRangeM: 12000,
    minRangeM: 1300,
    hitRate: 1,
    falloff: 0.6, // 2026-09-11 船长定（自 main 同步 · 回调批 11e52e2）：守墓者长炮单件上调 0.45 → 0.6（射程尽头仍有六成命中，比 MK3 的 0.5 更准）
    reloadMs: 7350,
    dmgMult: 10.35,
    cpuUse: 62,
    description:
      '命中 100%、12 km 超远程（射程尽头六成）；射速极慢、单发极重。',
  },
  {
    id: 'mod-lair-armor-d',
    name: '陵寝装甲层',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 1.1,
    speedPenaltyPct: 0.25,
    cpuUse: 42,
    description:
      '守墓古舰窝点专属：陵寝级复合重甲——装甲容量 +110%，代价是战斗机动速度 −25%（多件不叠加）与 42 点 CPU：装它等于少一门重炮、也跑不快。守墓者从来不需要追人。',
  },
  {
    id: 'mod-lair-turret-e',
    name: '巨构残骸炮',
    slot: 'turret',
    rack: 'high',
    damageType: 'explosive',
    ammoPerEngagement: 12,
    maxRangeM: 9600,
    minRangeM: 900,
    hitRate: 0.7,
    falloff: 0.1,
    reloadMs: 10_000,
    dmgMult: 19.1,
    cpuUse: 22,
    description:
      '泰坦巨构窝点专属：拆自巨构核心舱段的主炮——十秒一发的重锤，单发威力极重，代价是弹道笨重、越远越打不中（射程带尽头几近失的），基础命中也只有七成。爆炸弹头破甲极强、拆盾乏力，是"贴到中距离换血"的巨构思路；结构简单得出奇，CPU 占用只有 22。',
  },
  {
    id: 'mod-lair-hangar-e',
    name: '深层机库',
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 95,
    cpuUse: 50,
    description:
      '泰坦巨构窝点专属：巨构舰体深处的整层机库——无人机舱 +95 m³（可多带 19 架侦察机 / 9 架战斗机 / 4 架攻坚机）。囤得起、放得出，代价是 50 点 CPU；真正卡放飞数量的仍是 CPU 带宽，机库只保证你带得够多。',
  },
  {
    id: 'mod-lair-frame-e',
    name: '巨构骨架',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.3,
    hullHpBonus: 0.6,
    cpuUse: 50,
    description:
      '泰坦巨构窝点专属：整段拆下的巨构龙骨——结构层容量 +60% ＋ 装甲容量 +30%——护盾与装甲被打穿之后，最后那段血就靠它。巨构造物不讲机动，只讲撑到最后。',
  },
  {
    id: 'mod-lair-drone-tac-g',
    name: '鱿蜂群导控',
    slot: 'drone-tac',
    rack: 'high',
    droneDmgBonus: 0.45,
    cpuUse: 32,
    description:
      '鱿烬亡军窝点专属：从残舰上拆回来的蜂群控制台——放飞无人机单发伤害 +45%，CPU 只吃 32：流亡者没有新零件，只有好手艺）。',
  },
  {
    id: 'mod-lair-drone-relay-g',
    name: '流亡中继桅',
    slot: 'drone-relay',
    rack: 'high',
    droneRangeBonusPct: 0.65,
    cpuUse: 34,
    description:
      '鱿烬亡军窝点专属：用废桅杆拼起来的中继阵——放飞无人机射程 +65%（蜂鸟 6600 m / 赤鸢 7425 m / 猎鹰 8250 m / 雷鸥 10725 m）。CPU 只吃 34——省下的算力留给别处。',
  },

  /* ══════════════ 虫洞专属装备（2026-09-13 船长「开工，装备就全部做进来」；设计稿 `docs/design/wormhole-exclusive-20260913.md`）
   * 五族各 6 件，**同族以内与本族的"残骸族专属"（`FOE_LAIR_GEAR`）不重复定位**（逐件核过：本套用的
   * 字段，族专属一件都没用过）。强度档 ≈ **MK3 同字段件的 2 倍量级**（与窝点专属同档、走另一维度），
   * 每件都带一个明确代价（高 CPU，或失步 / 近盲 / 偏低的命中 / 只对单弹种有效）。
   *
   * ⚠ **施工期闸门**：全部标 `unreleased: true`（手册装备图鉴遍历 MODULES 全目录），上线时删字段；
   *   `content:check` 的「虫洞不可见闸门」按 `mod-wh-` 前缀逐条钉住。
   * ⚠ 这 30 件**无市场卡**（买不到也卖不掉），来源 = 洞内掉落 + 各自的**一次性图纸**（`singleUse`）。 */
  /* ── A 族（海盗 · 掠夺：大货舱 / 快 / 中近程）──
   * 窝点套已占：转管炮（动能近程）・导弹巢（爆破中程）・赃物强化舱（货舱+甲容量） */
  {
    // 2026-09-13 船长审核改：原「裂罅熔流炮」（激光·等离子·11.5 km）⇒ **爆炸武器·破片炮**
    id: 'mod-wh-a-frag',
    name: '掠袭破片炮',
    slot: 'turret', // 爆炸系武器形态 = 炮台（激光槽契约要求等离子 ⇒ 随弹种改槽）
    rack: 'high',
    damageType: 'explosive',
    ammoPerEngagement: 20,
    maxRangeM: 7_300, // 船长审核：11.5 km → 7.3 km
    minRangeM: 0,
    hitRate: 0.8, // 船长审核：1 → 0.8
    falloff: 0.5,
    reloadMs: 5_600,
    dmgMult: 7.04, // 船长审核：8.8 ×0.8（伤害降低 20%）
    cpuUse: 37, // 船长 2026-09-13：48 → 37（再降 11 点）
    secondaryDamagePct: 0.5, // 船长：附加伤害段 = 主段实收 ×50%，固定动能（与所耗爆炸弹无关）
    secondaryDamageType: 'kinetic',
    // ⚠ **待落**：船长要求「攻击额外造成 50% 的动能伤害」——引擎当前**一件武器只有一个弹种**
    //   （`ModuleDef.damageType` 单值），需新增字段（建议 `secondaryDamagePct` + 副弹种）与战斗侧
    //   第二段伤害，见设计稿 §3.6「待落机制」。
        description:
      '会自己炸开的破片弹：7.3 km 内撒出一片高爆碎片，单发威力极重；碎片不看装甲缝隙——额外造成 50% 的动能伤害（与所耗的爆破弹药无关）。代价：命中只有 0.8，装填 5.6 秒。',
  },
  {
    id: 'mod-wh-a-hangar',
    name: '掠袭机库', // 船长审核改：赃物机库 → 掠袭机库
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 30, // 船长审核：85 → 30
    droneCycleCutPct: 0.08, // 船长：无人机攻击间隔 −8%（澄清 = **出击周期**）
    cpuUse: 25, // 船长审核：46 → 25
    // ⚠ **待落**：船长要求「无人机攻击间隔减少 8%」——无人机当前没有"攻击间隔"可加的模块字段
    //   （只有 bay/dmg/range 三件），需新增字段（建议 `droneIntervalCutPct`）+ 战斗侧接入，见设计稿 §3.6。
        description:
      '把抢来的货舱隔板焊成的机库夹层：无人机舱 +30 m³，且放飞无人机的出击周期 −8%。装得下又放得快，代价只有 25 点 CPU。',
  },
  {
    id: 'mod-wh-a-prop',
    name: '掠袭加力器',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 1.2, // 矢量推进器 MK3 = +100%
    hitPenalty: 0.35, // 船长审核：0.05 → 0.35（开火命中 ×0.65）
    cpuUse: 18, // 船长审核：38 → 18
    description:
      '过载到发红的推进段：战斗机动 +120%，CPU 只吃 18。代价是开火失稳到极点——命中 ×0.65。抢完就跑才是它的正经用法。',
  },
  {
    id: 'mod-wh-a-coat',
    name: '掠袭折射涂层', // 船长审核改：赃物折射涂层 → 掠袭折射涂层
    slot: 'armor', // 船长审核：改**低槽装甲**
    rack: 'low',
    evasionGapPct: 0.28, // 姿态陀螺 MK3 = 0.2（跨族，已登记）
    allResistPenaltyPct: 0.15, // 船长：负面 = **全抗性 −15**（盾/甲/结构三层各减 15 个百分点）
    cpuUse: 34,
        description:
      '一层会骗测距的涂层：被命中缺口再削 28%，代价是全抗性 −15——盾、甲、结构三层一起变脆。保命也保货，但别指望它扛。',
  },
  {
    id: 'mod-wh-a-scan',
    name: '赃物扫描阵',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.24, // 索敌阵列 MK3 = 0.16（本件船长只要求加射程惩罚，未改命中）
    rangeCutPct: 0.15, // 船长：负面 = 武器射程 −15%
    cpuUse: 36,
        description:
      '拼装起来的火控阵列：炮台命中整体 ×1.24，代价是武器射程 −15%——看得更准，但得让对方更靠近。',
  },
  {
    id: 'mod-wh-a-shield',
    name: '掠袭者护盾笼', // 船长审核改：掠夺者护盾笼 → 掠袭者护盾笼
    slot: 'shield',
    rack: 'mid',
    shieldHpBonus: 0.8, // 船长审核：0.9 → 0.8
    rangeCutPct: 0.25, // 船长：负面 = 武器射程 −25%
    cpuUse: 46,
    // ⚠ **待落**：船长要求「射程削减 25%」——引擎当前没有"武器射程百分比"模块字段，
    //   需新增（建议 `rangeCutPct`，多件取最重一件）+ 战斗侧接入，见设计稿 §3.6。
        description:
      '把三块抢来的护盾发生器串成一个笼：护盾容量 +80%。代价是武器射程 −25%：护盾笼挤占了炮座的位置。',
  },
  {
    id: 'mod-wh-c-laser',
    name: '生体棱镜束',
    slot: 'laser',
    rack: 'high',
    damageType: 'plasma', // ⚠ 审核修正：C 族卡池 = 等离子 8 / 爆破 2（无动能）⇒ 原"动能穿刺炮"越出本族弹型，改为等离子
    ammoPerEngagement: 22,
    maxRangeM: 8_600, // 与本族窝点件（酸液喷吐器 2.8 km 近程必中）拉开射程带：近战贴脸是它的，这件管拉开之后
    minRangeM: 0, // 激光家族口径：光束无近盲
    hitRate: 1,
    falloff: 0.1, // 激光件统一口径：最远端威力 ×0.10
    reloadMs: 5_600, // 代价：装填比激光炮 MK3 慢四成
    dmgMult: 7.6, // 单发 ≈ 激光炮 MK3（4.2）的 1.8 倍
    cpuUse: 60,
    description:
      '生体棱镜阵列射出的酸蚀光束：8.6 km 必中、单发很重，射程在族内够长——贴脸的活交给同族酸液喷吐器，这件管的是"它想拉开距离"的时候。代价是装填 5.6 秒。',
  },
  /* ── C 族（异形 · 生体：结构/装甲高、护盾薄、近程高伤）──
   * 窝点套已占：生体甲壳板（甲自修）・生体损管腔（结构抗+结构自修）・酸液喷吐器（近程必中） */
  {
    id: 'mod-wh-c-prism',
    name: '甲壳棱镜层',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.3, explosive: 0.3, plasma: 0.3 }, // 三系均衡（与 D 族盾抗同档，但走装甲层）
    cpuUse: 46,
    description:
      '三系装甲抗性各削三成缺口。',
  },
  {
    id: 'mod-wh-c-pulse',
    name: '生体脉搏加速器',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.06, // 船长审核：0.18 → 0.06（射速计算机 MK3 = 0.12）
    speedBonusPct: 0.1, // 船长：舰船速度 +10%（跨族：支援槽携速度，已登记）
    cpuUse: 42, // 船长审核：32 → 42（CPU +10）
        description:
      '以生体脉搏驱动装填链：炮台装填间隔 ÷1.06，并让舰船速度 +10%。占用 42 点 CPU——打得快，也跑得快。',
  },
  {
    id: 'mod-wh-c-missile',
    name: '孢子导弹巢',
    slot: 'missile',
    rack: 'high',
    damageType: 'explosive',
    ammoPerEngagement: 30,
    maxRangeM: 13_500,
    minRangeM: 400,
    hitRate: 0.6, // 船长 2026-09-13：0.5 → 0.6
    // 2026-09-13 船长：「对所有敌方同时攻击」——**本轮已落码**（引擎 allFoes + 演出逐目标弹道）
    hitsAllFoes: true,
    falloff: 1, // 导弹家族口径：追踪命中，命中不随距离衰减
    reloadMs: 8360, // 2026-09-15 船长「**提高所有导弹发射器10%的周期**」：7600 → **8360**（周期 +10%，其余字段一字未动）
    dmgMult: 9.68, // 船长审核：12.1 ×0.8（降低 20%）；≈ 导弹架 MK3 的 1.6 倍
    cpuUse: 58,
    description:
      '会自己散开的孢子囊：13.5 km 爆破覆盖、单发极重，一次罩住全部敌舰（逐舰各结算一次）。散布较大（命中 0.6）、装填 7.6 秒——它负责把整片战场铺满。',
  },
  {
    id: 'mod-wh-c-frame',
    name: '几丁质骨架层',
    slot: 'armor',
    rack: 'low',
    hullHpBonus: 0.75, // 巨构骨架 = 0.6
    speedBonusPct: 0.05, // 船长：移除甲容量，改为**舰船速度 +5%**
    cpuUse: 46,
        description:
      '把整副骨架换成几丁质复合层：结构层容量 +75%，并让舰船速度 +5%——壳更厚，却更轻。护盾与装甲被打穿之后，最后那段血就靠它。',
  },
  /* ── D 族（守墓 · 重装：三系抗 / 必中远程 / 最慢）──
   * 窝点套已占：陵墓护盾阵列（三系盾抗）・守墓者长炮（动能必中 12 km）・陵寝装甲层（甲容量） */
  {
    id: 'mod-wh-d-turret',
    name: '陵卫连装炮',
    slot: 'turret',
    rack: 'high',
    damageType: 'kinetic', // ⚠ 审核修正：D 族卡池 = 等离子 8 / 动能 2（**无爆破**）⇒ 原"陵寝齐射巢（导弹＝爆破）"越出本族弹型，改为动能
    ammoPerEngagement: 40,
    maxRangeM: 5_400, // 与本族窝点件（守墓者长炮 12 km 必中慢炮）拉开射程带与节奏：一门点名、一门清近
    minRangeM: 300,
    hitRate: 0.86,
    falloff: 0.4,
    reloadMs: 2_800, // 船长审核：1_600 → 2_800
    dmgMult: 9.2, // 船长审核：4.6 → 9.2（单发翻倍）
    ammoPerShot: 2, // 船长：每次攻击消耗 2 发弹药
    cpuUse: 46,
        description:
      '陵卫的连装炮：5.4 km 内 2.8 秒一轮，一轮打出两发、单发极重。长炮点名硬目标，它负责把贴上来的一群清掉。',
  },
  {
    id: 'mod-wh-d-shield',
    name: '陵墓护盾芯',
    slot: 'shield',
    rack: 'mid',
    shieldHpBonus: 0.9, // 护盾扩展器 MK3 = 0.6
    cpuUse: 52,
    description:
      '从陵墓阵列里取出的核心：护盾容量 +90%。与本族那套"三系抗性的盾"互补——一个管厚度，一个管硬度。',
  },
  {
    id: 'mod-wh-d-lock',
    name: '守墓者丧钟',
    slot: 'target-lock',
    rack: 'high',
    lockDmgBonus: 0.3, // 目标锁定阵列 MK3 = 0.2
    cpuUse: 40,
    description: '全队集火编队首位，全队伤害 +30%',
  },
  {
    id: 'mod-wh-d-laser',
    name: '陵寝棱镜炮',
    slot: 'laser',
    rack: 'high',
    damageType: 'plasma',
    ammoPerEngagement: 18,
    maxRangeM: 12_500,
    minRangeM: 0, // 激光家族口径：光束无近盲
    hitRate: 1,
    falloff: 0.1, // 激光件统一口径
    reloadMs: 6_800, // 代价：本套最慢
    dmgMult: 9.4,
    cpuUse: 68,
    description:
      '把陵墓顶端的棱镜拆下来当炮管：12.5 km 必中光束、单发极重。装填 6.8 秒——瞄准的时间，就是它全部的代价。',
  },
  {
    id: 'mod-wh-d-loader',
    name: '守墓者速装填机',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.18, // 射速计算机 MK3 = 0.12
    cpuUse: 54, // 船长审核：34 → 54（CPU +20）
    description:
      '一套不知疲倦的机械装填臂：炮台装填间隔 ÷1.18。必中长炮唯一的短板就是慢，它专补这一处。',
  },
  {
    id: 'mod-wh-d-steady',
    name: '陵墓弹道铭文',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.18, plasma: 0.18 }, // 船长审核：22% → 18%，并追加能量（等离子）18%
    cpuUse: 30,
    description:
      '刻在炮闩上的铭文：动能与能量武器单发各 +18%。守墓者的炮不是动能就是能量，它两系都认。',
  },
  /* ── E 族（巨构 · 平台：机库 / CPU）──
   * 窝点套已占：巨构残骸炮（爆破重锤）・深层机库（机库容量）・巨构骨架（甲+结构容量） */
  {
    id: 'mod-wh-e-dc',
    name: '巨构损管阵列',
    slot: 'armor',
    rack: 'low',
    hullResistAdd: { kinetic: 0.3, explosive: 0.3 }, // 船长：改结构类——**结构对动能与爆炸抗性 +30%**（去掉等离子）
    hullHpBonus: 0.35, // 船长：结构值 +35%
    cpuUse: 38, // 船长：CPU −10（48 → 38）
        description:
      '巨构造物的自带损管网：结构对动能与爆炸的抗性各 +30%、结构值 +35%，占用只有 38 点 CPU。巨构本来是挨打不还手的料，这一层让它挨得住第二轮。',
  },
  {
    id: 'mod-wh-e-tac',
    name: '巨构导控塔',
    slot: 'drone-tac',
    rack: 'high',
    droneDmgBonus: 0.5, // 鱿蜂群导控 = 0.45
    droneHullHpBonusPct: 0.8, // 2026-09-13 船长：「提高无人机 80% 的结构」
    cpuUse: 44,
    description:
      '塔状的机群指挥中枢：放飞无人机单发 +50%。机库族缺的从来不是数量，是让它们打得疼。',
  },
  {
    id: 'mod-wh-e-cpu',
    name: '巨构协处理器',
    slot: 'cpu',
    rack: 'low',
    cpuBonus: 90, // 协处理器 MK3 = +45
    reloadPenaltyPct: 0.12, // 船长：负面 = 装填 +12%
    cpuUse: 0, // 协处理器口径：自身不占 CPU
        description:
      '巨构造物的并行计算核心：装配 CPU 上限 +90，自身不占 CPU，代价是全舰装填 +12%——算力是借来的，得用射速还。',
  },
  {
    id: 'mod-wh-e-pd',
    name: '巨构近防阵列',
    slot: 'turret',
    rack: 'high',
    damageType: 'kinetic',
    ammoPerEngagement: 64,
    maxRangeM: 2_500, // 防空口径（船长 2026-09-11「近防炮射程按 2500m 算」）：防空是贴身护卫，不得超过
    minRangeM: 1,
    hitRate: 0.92,
    falloff: 0.5,
    reloadMs: 1_200,
    dmgMult: 3.7, // 单发 ≈ 近防炮 MK3（2.85）的 1.3 倍
    antiDrone: 2, // 防空值 = 2（船长 2026-09-12「那伤害倍率按 2 倍算」——全游统一，专属件也不破例）
    cpuUse: 56,
    description:
      '一整套阵列化点防：射程 2.5 km，贴到近处靠射速压制——防空属性 ×2，单发也重。',
  },
  {
    id: 'mod-wh-e-shield',
    name: '巨构护盾矩阵',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.32, plasma: 0.32 }, // 船长：动能与能量抗性 +32%（去掉高爆）
    shieldHpBonus: 0.42, // 船长：护盾上限 +42%
    cpuUse: 70, // 船长：CPU +20（50 → 70）
        description:
      '矩阵式护盾发生层：动能与能量护盾抗性各 +32%，同时把护盾上限抬高 42%。占用 70 点 CPU——巨构族的第一块盾。',
  },
  /* ── G 族（亡军 · 幽灵：低信号 / 快 / 远锁定 / 无人机）──
   * 窝点套已占：鱿蜂无人机（专属无人机）・鱿蜂群导控（无人机伤害）・流亡中继桅（无人机射程） */
  {
    id: 'mod-wh-g-hangar',
    name: '亡军蜂巢坞',
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 110, // 深层机库 = +95
    cpuUse: 54,
    description:
      '由废弃蜂巢改成的机坞：无人机舱 +110 m³。亡军给了无人机伤害与射程，唯独没给"装得下"——这就是那一块。',
  },
  {
    id: 'mod-wh-g-fcs',
    name: '亡军火控', // 船长审核改：亡军火控残响 → 亡军火控
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.12, // 船长审核：0.24 → 0.12
    damageBonusPct: 0.06, // 船长：伤害 +6%（通用单发加成，只进炮台/光束）
    cpuUse: 36,
        description:
      '从沉船里捡回的火控残骸，还在按老参数工作：炮台命中整体 ×1.12，并让全部武器单发 +6%。它记得上一任主人的射击习惯。',
  },
  {
    id: 'mod-wh-g-ballistic',
    name: '幽灵弹道校正器',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.22 }, // 动能稳定器 MK3 = 0.15
    rangeTypeBonusPct: { kinetic: 0.22 }, // 船长：动能武器射程 +22%
    cpuUse: 60, // 船长审核：30 → 60（CPU +30）
        description:
      '一把没有主人的弹道仪：动能武器单发 +22%，并把动能武器的射程拉长 22%。占用 60 点 CPU——亡军的炮都是捡来的动能炮，校正器也只好认这一系。',
  },
  {
    id: 'mod-wh-g-hull',
    name: '鱿蜂结构层', // 2026-09-13 船长：改名（G 族已更名「鱿烬亡军」；**id 不动**）
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.18, // 结构抗性件带一点甲容量（装甲槽契约要求有甲族字段）
    hullResistAdd: { kinetic: 0.28, explosive: 0.28, plasma: 0.28 },
    droneHullHpBonusPct: 0.8, // 2026-09-13 船长：「提高无人机 80% 的结构」
    cpuUse: 44,
    description:
      '一层用同族残骸回炉重铸的结构层：三系结构抗性各削二成八缺口、装甲容量 +18%，并让本舰机群的结构层 +80%——亡军没有完整的船，只有拆下来的骨，捡来的无人机也一样。',
  },
  {
    id: 'mod-wh-g-turret',
    name: '亡军残炮',
    slot: 'turret',
    rack: 'high',
    damageType: 'explosive',
    ammoPerEngagement: 36,
    maxRangeM: 8_600,
    minRangeM: 700,
    hitRate: 0.75, // 代价：命中偏低（拼装货）
    falloff: 0.4,
    reloadMs: 4_600,
    dmgMult: 11.5, // 单发 ≈ 攻坚炮台 MK3（5.13）的 2.2 倍
    cpuUse: 54,
    description:
      '把三门废炮的部件拼成一门：单发是攻坚炮台 MK3 的两倍多，命中只有 0.75——它经手过太多任主人，膛线早就花了。',
  },
  {
    id: 'mod-wh-g-prop',
    name: '幽灵推进器',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.85, // 船长审核：+115% → +85%
    cpuUse: 36,
    description:
      '没有排气痕迹的推进段：战斗机动 +85%，且不拖累命中。幽灵的走法是悄无声息地靠近。',
  },
]

/** 构建"装备 id → 定义"目录 */
export function buildModuleCatalog(): ReadonlyMap<string, ModuleDef> {
  return new Map(MODULES.map((m) => [m.id, m]))
}
