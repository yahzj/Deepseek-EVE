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
 *     性能一致只换伤害类型（动能打盾 ×1.5 / 高爆打甲 ×1.5 / 能量打盾 ×0.75 且单发基数最高）；
 *     蓝图 = 动能款（协会制式）；口径限制已取消——任意船可装任意炮，装配唯一约束 = CPU；
 *   · V18B-1/2 武器形态分家（船长 2026-09-04："按伤害类型设计武器，不应只是换描述"）：
 *     爆炸系已从临时"高爆炮"迁移为导弹架（mod-missile-1/2/3，见下方导弹架段）——
 *     追踪命中不随距离衰减的远程爆破，带近盲安全射距（太近会炸到自己）；
 *     V18B-2：能量系从临时"能量炮/异星原型"迁移为激光炮（mod-laser-1/2/3/proto）——
 *     必中（不掷命中）+ 距离衰减作用于威力（幅度 = 命中衰减的 50%）+ 消耗能量弹药；
 *     动能炮仍为临时填充数据，V18B-3 将改造为质量炮形态（届时再做迁移与改名确认）；
 *   · 弹药：动能弹（质量炮）、爆破导弹（导弹架专用，爆炸键）、能量弹药（激光炮专用，
 *     原名"等离子弹"，id 不变）——每型单档通用弹（-l），武器按自身固定弹种消耗；
 * - CPU 装配资源（V17.1 用户定稿：成倍档位拉开船级差距）：
 *   民用 3（炮台 6）/ MK1 5（炮台 10）/ MK2 15（炮台 28）/ MK3 40（炮台 52）/
 *   异星原型 60（炮台 70）——战斗件与工业件同档；低级船（沙猫 60 CPU）只带得动
 *   低级全套，MK3 顶配套件需要 220+ CPU 的顶级船，无人机放飞余量同池竞争；
 * - 渠道与既有规则一致：MK1 平价 / MK2・MK3 稀有（MK3 无蓝图市场专供）/
 *   proto 奇货（声望 10、无蓝图）；护盾/装甲/推进无蓝图（市场供应为主）；
 * - 存档迁移：mod-shield-1/2/3、mod-armor-1/2/3（通用全系）与 mod-turret-1/2/3
 *   （V17 前混型炮）已下架，载入存档自动按动能款迁移（core/equipment 迁移表）；
 * - V18（C3）槽位制 + V18.1（2026-09-04 船长拍板）支援件与收敛：
 *   · 槽位制：fitted 位数组 + rack 归属（高 = 炮/矿/无人机装置；中 = 盾系/推进；
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
    rack: 'high',
    bonus: 0.1,
    description: '产量 +10%。空间站平价货，新手第一件看得起的强化。',
    cpuUse: 3,
  },
  {
    id: 'mod-miner-1',
    name: '强化采集器 MK1',
    slot: 'miner',
    rack: 'high',
    bonus: 0.2,
    description: '提升 20% 循环产量。工业入门的第一件自制装备。',
    cpuUse: 5,
  },
  {
    id: 'mod-miner-2',
    name: '强化采集器 MK2',
    slot: 'miner',
    rack: 'high',
    bonus: 0.5,
    description: '提升 50% 循环产量。双管谐振钻头，深空工业的标杆装备。',
    cpuUse: 15,
  },
  {
    id: 'mod-miner-3',
    name: '精密采集器 MK3',
    slot: 'miner',
    rack: 'high',
    bonus: 0.8,
    description: '产量 +80%。协会精密工业的结晶（蓝图可造，见组装机）；40 CPU 已接近小型船满载。',
    cpuUse: 40,
  },
  {
    id: 'mod-miner-proto',
    name: '异星原型采集器',
    slot: 'miner',
    rack: 'high',
    bonus: 1.1,
    description: '产量 +110%。来源不明的异星技术，仅限奇货市场（需高声望）。',
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
    description: '货舱容量 +180%。异星空间技术，仅限奇货市场（需高声望）。',
    cpuUse: 60,
  },

  // ══════════ 炮台（turret：V17.2 炮族制——固定弹种 × 档位；11 件；V18 口径取消） ══════════
  // 轻型（MK1）速射近程；重型（MK2）慢射远程；攻坚（MK3）超远程；同 MK 各弹种款
  // 性能一致、只换伤害类型（克制：动能打盾×1.5/高爆打甲×1.5/能量打盾×0.75 通用）。
  // 蓝图 = 动能款（协会制式）；高爆/能量款市场专供；弹药每型单档（-l），全炮台通用。
  {
    id: 'mod-turret-civ',
    name: '民用舰炮',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 24,
    description: '协会自警队制式轻型动能炮：吃动能弹，4.2 km 有效射程。入门即动能——默认悬赏都能打。',
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
    description: '轻型动能速射炮：打盾 1.5 倍伤害（打甲减半）。协会制式、蓝图可造，把矿船变成勉强能打的武装矿船。',
    cpuUse: 10,
    maxRangeM: 3220, // 2026-09-08 船长定：动能炮射程 −30%（4600→3220），装填等价缩短（2200→1540）
    minRangeM: 250,
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
    minRangeM: 700,
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
    minRangeM: 1200,
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
    name: '巨构近防炮 MK1',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 40,
    description: '巨构残骸上拆下来的点防炮：射程极短、射速极快，是唯一能打敌方机群的武器。对舰也能开火，威力却远不如主炮——占一个高槽，换的是带机群的仗里的答案。',
    cpuUse: 12,
    maxRangeM: 2500, // 2026-09-11 船长裁定「**近防炮射程按照 2500m 算**」（原 1400）；打机群**不看两舰间距**（甲案）
    minRangeM: 1, // 无近盲带：贴到脸上也开火
    hitRate: 0.9, // 点防本职：高命中
    falloff: 0.5,
    reloadMs: 1500, // 快射速是它的性格
    dmgMult: 0.5, // ≈ 同档主炮（轻型炮台 MK1 = 1.25）的 40% ⇒ 对舰明显偏弱
    canHitDrones: true, // **防空属性**：唯一能筛到敌方无人机的武器类型
  },
  // 2026-09-11 补档（防空行实测口径：**射程不拉长**——1.4 km 已在"贴近"打法里够用，
  // "想打机群就得走进警戒幕"这条张力应当保留；MK2/MK3 只提单发与射速）
  {
    id: 'mod-pd-e-2',
    name: '巨构近防炮 MK2',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 48,
    description: '巨构近防炮的强化型：射速更快、单发更重，射程依旧很短。带机群的仗里，它让机群更快掉下来。',
    cpuUse: 26,
    maxRangeM: 2500, // 三档同射程（船长「按照 2500m 算」）——MK2/MK3 的差异只在单发与射速
    minRangeM: 1,
    hitRate: 0.9,
    falloff: 0.5,
    reloadMs: 1400,
    dmgMult: 0.8,
    canHitDrones: true,
  },
  {
    id: 'mod-pd-e-3',
    name: '巨构近防炮 MK3',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 56,
    description: '巨构近防炮的顶档：射速与单发都拉到极限，射程仍是贴身的那一小段。对舰威力仍明显低于同档主炮。',
    cpuUse: 44,
    maxRangeM: 2500,
    minRangeM: 1,
    hitRate: 0.92,
    falloff: 0.5,
    reloadMs: 1300,
    dmgMult: 1.05,
    canHitDrones: true,
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
    description: '轻型激光炮：能量光束必中（锁定即命中）、无视近盲；距离越远威力削减越明显。消耗能量弹药（市场专供）。',
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
    description: '重型激光炮：8.2 km 远程光束，必中但威力随距离明显衰减——中程稳定输出的正解（市场专供，无蓝图）。',
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
    description: '攻城级激光炮：10.5 km 光束炮塔——编队攻坚的稳定火力（市场稀有现货，无蓝图）。',
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
    description: '无法逆向工程的异星能量武器：13 km 光束，仅限奇货市场（需高声望）。',
    cpuUse: 70,
    maxRangeM: 13000,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.1, // 2026-09-11 船长定（自 main 同步）：远端统一「最远端威力 ×0.1」
    reloadMs: 4600,
    dmgMult: 5.1,
  },

  // ══════════ 导弹架（V18B-1 爆炸系武器形态：爆破导弹弹头，逐发消耗） ══════════
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
    description: '轻型导弹巢：发射爆破导弹（打甲 1.5 倍、打盾减半）。命中不随距离衰减；注意 500 m 内近盲——贴太近发射会炸到自己（市场专供）。',
    cpuUse: 10,
    maxRangeM: 7440, // 2026-09-08 船长定：导弹射程/装填/伤害倍率同步 +20%（6200/2600/1.25 → 7440/3120/1.5）
    minRangeM: 500,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 3120,
    dmgMult: 1.5,
  },
  {
    id: 'mod-missile-2',
    name: '重型导弹架 MK2',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '重型导弹巢：11.8 km 远程爆破轰炸——装甲舰编队的噩梦（市场专供，无蓝图）。',
    cpuUse: 28,
    maxRangeM: 11760, // 2026-09-08 船长定：导弹射程/装填/伤害倍率同步 +20%（9800/4000/3.66 → 11760/4800/4.39）
    minRangeM: 900,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 4800,
    dmgMult: 4.39,
  },
  {
    id: 'mod-missile-3',
    name: '巡航导弹架 MK3',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '巡航导弹巢：14.9 km 远程毁灭——大编队交火前先发制人的火力（市场稀有现货，无蓝图）。',
    cpuUse: 52,
    maxRangeM: 14880, // 2026-09-08 船长定：导弹射程/装填/伤害倍率同步 +20%（12400/5000/5.03 → 14880/6000/6.04）
    minRangeM: 1400,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 6000,
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
    description: '整队级外挂甲板：无人机舱 +70 m³（市场稀有，无蓝图）。',
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
    description: '放飞无人机单发伤害 +40%（市场稀有，无蓝图）。无人机甲板舰的指挥核心。',
  },

  // ══════════ 无人机中继天线（2026-09-10 船长拍板：高槽装置——延长无人机作战半径；百分比
  //  求和乘入机型基础射程，多件线性可叠；市场现货 + 蓝图双渠道，MK3 学习声望 4） ══════════
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
    description: '制导中继天线：放飞无人机射程 +80%（市场稀有）。哨戒无人机可深入激光炮带。',
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
    description: '动能抗 +50%（上限 90%）。旗舰级弹道拦截阵列（市场稀有）。',
  },
  {
    id: 'mod-shield-exp-3',
    name: '护盾增强器 MK3·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.5 },
    cpuUse: 40,
    description: '高爆抗 +50%（上限 90%）。可以正面接下爆破弹雨的强化护盾（市场稀有）。',
  },
  {
    id: 'mod-shield-pla-3',
    name: '护盾增强器 MK3·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.5 },
    cpuUse: 40,
    description: '能量抗 +50%（上限 90%）。能量武器时代的盾构解（市场稀有）。',
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
    description: '护盾容量 +60%。全站功率输送的巨型护盾发生器（市场稀有）。',
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
    description: '动能抗 +25%（上限 90%）。动能破甲弹的克制镀层。',
  },
  {
    id: 'mod-armor-exp-1',
    name: '装甲镀层 MK1·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.25 },
    cpuUse: 4,
    description: '高爆抗 +25%（上限 90%）。高爆对装甲是双倍伤害——这是第一道防线。',
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
    description: '动能抗 +40%（上限 90%）。复合夹层结构，动能弹的噩梦。',
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
    description: '动能抗 +55%（上限 90%）。要塞级复合装甲（市场稀有）。',
  },
  {
    id: 'mod-armor-exp-3',
    name: '装甲镀层 MK3·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.55 },
    cpuUse: 32,
    description: '高爆抗 +55%（上限 90%）。顶住高爆齐射的移动堡垒（市场稀有）。',
  },
  {
    id: 'mod-armor-pla-3',
    name: '装甲镀层 MK3·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.55 },
    cpuUse: 32,
    description: '能量抗 +55%（上限 90%）。能硬抗能量炮的烧蚀装甲（市场稀有）。',
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
    description: '装甲容量 +80%。全站重工浇铸的复合装甲层（市场稀有）。',
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
    description: '加力推进：点火期间战斗速度 +100%，持续 60 秒后进入 60 秒冷却（开场即点火）。点火代价 = 开火命中 ×0.80。短距冲刺压燃引擎——快，但不稳（市场稀有）。',
  },

  // ══════════ V18.1 支援件（support：低槽 = 伤害稳定器/射速计算机；中槽 = 索敌阵列/姿态陀螺） ══════════
  // 收敛标签：伤害/射速 = 可多装·全额叠加（加算）；命中 = 多装递减（EVE 曲线）；闪避 = 多装递减（缺口复合）。
  // 数值 = 暂定初值（MK1/MK2/MK3：+6/10/15% 等；CPU 5/15/40），进 C4 校准轮复核。
  {
    id: 'mod-stab-kin-1',
    name: '动能稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.06 },
    cpuUse: 5,
    description: '动能武器支援（低槽）：动能炮台单发伤害 +6%。',
  },
  {
    id: 'mod-stab-kin-2',
    name: '动能稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.1 },
    cpuUse: 15,
    description: '动能武器支援（低槽）：动能炮台单发伤害 +10%。',
  },
  {
    id: 'mod-stab-kin-3',
    name: '动能稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.15 },
    cpuUse: 40,
    description: '动能武器支援（低槽）：动能炮台单发伤害 +15%（市场稀有）。',
  },
  {
    id: 'mod-stab-exp-1',
    name: '高爆稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.06 },
    cpuUse: 5,
    description: '高爆武器支援（低槽）：爆炸系武器（导弹架）单发伤害 +6%。',
  },
  {
    id: 'mod-stab-exp-2',
    name: '高爆稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.1 },
    cpuUse: 15,
    description: '高爆武器支援（低槽）：爆炸系武器（导弹架）单发伤害 +10%。',
  },
  {
    id: 'mod-stab-exp-3',
    name: '高爆稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.15 },
    cpuUse: 40,
    description: '高爆武器支援（低槽）：爆炸系武器（导弹架）单发伤害 +15%（市场稀有）。',
  },
  {
    id: 'mod-stab-pla-1',
    name: '等离子稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.06 },
    cpuUse: 5,
    description: '等离子武器支援（低槽）：能量系武器（激光炮）单发伤害 +6%。',
  },
  {
    id: 'mod-stab-pla-2',
    name: '等离子稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.1 },
    cpuUse: 15,
    description: '等离子武器支援（低槽）：能量系武器（激光炮）单发伤害 +10%。',
  },
  {
    id: 'mod-stab-pla-3',
    name: '等离子稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.15 },
    cpuUse: 40,
    description: '等离子武器支援（低槽）：能量系武器（激光炮）单发伤害 +15%（市场稀有）。',
  },
  {
    id: 'mod-rof-1',
    name: '射速计算机 MK1',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.05,
    cpuUse: 5,
    description: '炮台射速支援（低槽）：装填间隔 −5%。',
  },
  {
    id: 'mod-rof-2',
    name: '射速计算机 MK2',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.08,
    cpuUse: 15,
    description: '炮台射速支援（低槽）：装填间隔 −8%。',
  },
  {
    id: 'mod-rof-3',
    name: '射速计算机 MK3',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.12,
    cpuUse: 40,
    description: '炮台射速支援（低槽）：装填间隔 −12%（市场稀有）。',
  },
  {
    id: 'mod-track-1',
    name: '索敌阵列 MK1',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.08,
    cpuUse: 5,
    description: '索敌支援（中槽）：炮台命中整体提升 8%。',
  },
  {
    id: 'mod-track-2',
    name: '索敌阵列 MK2',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.12,
    cpuUse: 15,
    description: '索敌支援（中槽）：炮台命中整体提升 12%。',
  },
  {
    id: 'mod-track-3',
    name: '索敌阵列 MK3',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.16,
    cpuUse: 40,
    description: '索敌支援（中槽）：炮台命中整体提升 16%（市场稀有）。',
  },
  {
    id: 'mod-gyro-1',
    name: '姿态陀螺 MK1',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.1,
    cpuUse: 5,
    description: '机动支援（中槽）：被命中缺口削减 10%。',
  },
  {
    id: 'mod-gyro-2',
    name: '姿态陀螺 MK2',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.15,
    cpuUse: 15,
    description: '机动支援（中槽）：被命中缺口削减 15%。',
  },
  {
    id: 'mod-gyro-3',
    name: '姿态陀螺 MK3',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.2,
    cpuUse: 40,
    description: '机动支援（中槽）：被命中缺口削减 20%（市场稀有）。',
  },

  // ══════════ B3 打捞器（salvager：高槽无伤害件，2026-09-05 船长定稿） ══════════
  // 每轮每台捞 1 具残骸；升级只缩短周期不增产（10s/8s/6s）；多台叠加；CPU 2/6/15（压缩表）。
  // 周期字段 salvageCycleMs 供打捞作业引擎消费；产出/密度关系见 salvage.ts 与 docs/design/b3-salvage.md。
  {
    id: 'mod-salvager-1',
    name: '打捞器 MK1',
    slot: 'salvager',
    rack: 'high',
    cpuUse: 2,
    salvageCycleMs: 10_000,
    description: '残骸打捞（高槽，无伤害）：每 10 秒捞取 1 具残骸；密度越高捞到的残骸越肥。',
  },
  {
    id: 'mod-salvager-2',
    name: '打捞器 MK2',
    slot: 'salvager',
    rack: 'high',
    cpuUse: 6,
    salvageCycleMs: 8_000,
    description: '残骸打捞（高槽，无伤害）：周期缩短至 8 秒/轮（每轮仍 1 具）（市场稀有）。',
  },
  {
    id: 'mod-salvager-3',
    name: '打捞器 MK3',
    slot: 'salvager',
    rack: 'high',
    cpuUse: 15,
    salvageCycleMs: 6_000,
    description: '残骸打捞（高槽，无伤害）：周期缩短至 6 秒/轮（每轮仍 1 具）（市场稀有）。',
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
    description: '中槽维修装置：战斗中每 5 秒修复装甲与结构各 5 点，每跳消耗 1 枚民用修理组件——保命件，修不过敌方火力。',
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
    description: '中槽维修装置：战斗中每 5 秒修复装甲与结构各 10 点，每跳消耗 1 枚军用修理组件——显著延寿，修不过敌方火力。',
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
    description: '中槽维修装置：战斗中每 5 秒修复装甲与结构各 18 点，每跳消耗 1 枚军用修理组件——高配巡洋/主力舰的持久战底牌。',
  },

  /* ═══ 2026-09-09 目标锁定阵列（target-lock 家族·高槽；船长拍板：集火 + 被锁目标受击加深；
     装上任意一件即触发集火模式——本舰全部武器不再随机分散，改打存活编队首位（主舰优先、
     击毁自动接力）；加深按档位 8/12/20%，多件 EVE 曲线收敛（见 equipment.stackingOf）） ═══ */
  {
    id: 'mod-lock-1',
    name: '目标锁定阵列 MK1',
    slot: 'target-lock',
    rack: 'high',
    cpuUse: 6,
    lockDmgBonus: 0.08,
    description: '目标锁定支援（高槽）：开火锁定存活编队首位集火，被锁定目标受本舰伤害 +8%（本舰全部武器）。',
  },
  {
    id: 'mod-lock-2',
    name: '目标锁定阵列 MK2',
    slot: 'target-lock',
    rack: 'high',
    cpuUse: 14,
    lockDmgBonus: 0.12,
    description: '目标锁定支援（高槽）：开火锁定存活编队首位集火，被锁定目标受本舰伤害 +12%（本舰全部武器）。',
  },
  {
    id: 'mod-lock-3',
    name: '目标锁定阵列 MK3',
    slot: 'target-lock',
    rack: 'high',
    cpuUse: 26,
    lockDmgBonus: 0.2,
    description: '目标锁定支援（高槽）：开火锁定存活编队首位集火，被锁定目标受本舰伤害 +20%（本舰全部武器）。',
  },

  /* ═══ 2026-09-10 赏金任务·窝点专属装备（船长认可草案；**数值为占位初值，等船长定数后改这里**） ═══
     获取渠道：只在精炼炉「残骸回收」开**稀有残骸（高级箱）**时掉落——打赢赏金任务的敌人窝点、
     把该星系留下的稀有残骸捞回站内开箱，才可能拿到对应敌族的专属件。**无蓝图、不上市场**，
     也不进任何常规掉落池；按敌族取池（见 core/lairs.ts 的 FOE_LAIR_GEAR）。
     留空的两族：**B 族（武装拾荒者）**——2026-09-10 船长定取消 B 族窝点/赏金任务，原
     「拾荒者拆解臂」一并撤下；**F 族（制式巡逻）**——只有隐藏遭遇模板、没有窝点成员。 */
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
      '海盗（A 族）窝点专属：缴获改装的多管动能炮——转管泼弹、射速极快，火力密度接近重型炮台，但射程只有攻坚炮台的一半、耗弹量是它的数倍；贴身缠斗最凶。',
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
    reloadMs: 2200,
    dmgMult: 2.6,
    cpuUse: 36,
    description:
      '海盗（A 族）窝点专属：掠袭艇拆下来的近程导弹巢——贴到脸上齐射爆破弹，追踪命中不随距离衰减、近盲安全射距仅 200 m；射程只有巡航导弹架的三成，靠的是"贴上去就有量"。',
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
      '海盗（A 族）窝点专属：缴获改装的分隔舱——货舱容量 +100%，并在舱壁内侧加挂捕获来的装甲板（装甲容量 +15%）。搬赃与跑商特化，战斗收益有限。',
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
    cpuUse: 30,
    description:
      '异形生物（C 族）窝点专属：层叠生体甲壳——装甲层三系减伤各 +10%，并自带**无消耗自愈**：战斗中每 5 秒自动修复 6 点装甲（不吃组件）。单系抗性远不如专精镀层，胜在能自己长回来。',
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
    cpuUse: 34,
    description:
      '异形生物（C 族）窝点专属：生体组织长成的损管腔——**结构层三系减伤各 +25%**，并自带无消耗自愈：战斗中每 5 秒自动修复 4 点结构。生物不该有护盾，它靠的是"被打穿也能长回来"。',
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
      '异形生物（C 族）窝点专属：腺体加压的酸液喷吐——光束级必中、无近盲；相对原型走"射速更慢、单发更重"的路线（单发略高于攻坚激光炮、装填更短，总输出相当）。射程只有 2.8 km，必须贴上去喷。',
  },
  {
    id: 'mod-lair-shield-d',
    name: '陵墓护盾阵列',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.3, explosive: 0.3, plasma: 0.3 },
    cpuUse: 42,
    description:
      '守墓古舰（D 族）窝点专属：陵寝守备用的全能重盾——三系减伤各 +30%。单系不如专精增强器，胜在不用猜对手弹种；CPU 占用很重（42）。',
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
      '守墓古舰（D 族）窝点专属：陵寝守备炮——**基础命中 100%**（必中量级）、12 km 超远程点名，射速只有攻坚炮台的四成、单发威力是它的两倍（总输出 ≈ 攻坚炮台的八成）；远端命中衰减也更轻（射程尽头仍有六成命中）。装填极慢，打空一发就是七秒。',
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
      '守墓古舰（D 族）窝点专属：陵寝级复合重甲——装甲容量 **+110%**（比装甲增厚板 MK3 还厚四成），代价是**战斗机动速度 −25%**（多件不叠加）与 42 点 CPU：装它等于少一门重炮、也跑不快。守墓者从来不需要追人。',
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
      '泰坦巨构（E 族）窝点专属：拆自巨构核心舱段的主炮——**十秒一发的重锤**，单发威力是攻坚炮台的三倍多，代价是弹道笨重、**越远越打不中**（射程带尽头几近失的），基础命中也只有七成。爆炸弹头破甲极强、拆盾乏力，是"贴到中距离换血"的巨构思路；结构简单得出奇，CPU 占用只有 22。',
  },
  {
    id: 'mod-lair-hangar-e',
    name: '深层机库',
    slot: 'drone-rack',
    rack: 'high',
    droneBayBonusM3: 95,
    cpuUse: 50,
    description:
      '泰坦巨构（E 族）窝点专属：巨构舰体深处的整层机库——无人机舱 **+95 m³**（比无人机甲板扩展 MK3 还大三分之一：可多带 19 架侦察机 / 9 架战斗机 / 4 架攻坚机）。囤得起、放得出，代价是 50 点 CPU；真正卡放飞数量的仍是 CPU 带宽，机库只保证你带得够多。',
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
      '泰坦巨构（E 族）窝点专属：整段拆下的巨构龙骨——**结构层容量 +60%**（护盾与装甲都被打穿之后，最后那段血比别人厚出六成；这是全游戏唯一能加厚结构层的模块）＋ 装甲容量 +30%。巨构造物不讲机动，只讲撑到最后。',
  },
  {
    id: 'mod-lair-drone-tac-g',
    name: '流亡蜂群导控',
    slot: 'drone-tac',
    rack: 'high',
    droneDmgBonus: 0.45,
    cpuUse: 32,
    description:
      '烬火流亡（G 族）窝点专属：从残舰上拆回来的蜂群控制台——放飞无人机单发伤害 **+45%**（比战术导控阵列 MK3 还高五个点，CPU 却只吃 32：流亡者没有新零件，只有好手艺）。',
  },
  {
    id: 'mod-lair-drone-relay-g',
    name: '流亡中继桅',
    slot: 'drone-relay',
    rack: 'high',
    droneRangeBonusPct: 0.65,
    cpuUse: 34,
    description:
      '烬火流亡（G 族）窝点专属：用废桅杆拼起来的中继阵——放飞无人机射程 **+65%**（蜂鸟 4125 m / 赤鸢 4950 m / 猎鹰 5775 m / 雷鸥 8250 m）。比无人机中继天线 MK3 近一档，却省下 12 点 CPU。',
  },
]

/** 构建"装备 id → 定义"目录 */
export function buildModuleCatalog(): ReadonlyMap<string, ModuleDef> {
  return new Map(MODULES.map((m) => [m.id, m]))
}
