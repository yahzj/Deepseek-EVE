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
    description: '产量 +80%。协会精密工业的结晶（蓝图可造，见制造台）；40 CPU 已接近小型船满载。',
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
    description: '货舱容量 +140%。空间折叠衬层，协会制式蓝图可造（制造台）。',
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
    falloff: 0.3,
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
    maxRangeM: 4600,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2200,
    dmgMult: 1.25,
  },
  {
    id: 'mod-turret-kin-2',
    name: '重型炮台 MK2·动能型',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 12,
    description: '重型动能炮：8.2 km 远程。协会重型制式（蓝图可造）——远程压制的正解。',
    cpuUse: 28,
    maxRangeM: 8200,
    minRangeM: 700,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 3400,
    dmgMult: 3.73,
  },
  {
    id: 'mod-turret-kin-3',
    name: '攻坚炮台 MK3·动能型',
    slot: 'turret',
    rack: 'high',

    damageType: 'kinetic',
    ammoPerEngagement: 12,
    description: '攻城级动能巨炮：10.5 km，攻坚炮里的协会制式（蓝图可造，52 CPU 顶级重炮）。',
    cpuUse: 52,
    maxRangeM: 10500,
    minRangeM: 1200,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 4200,
    dmgMult: 5.13,
  },
  // ══════════ 激光炮（V18B-2 能量系武器形态：消耗能量弹药，必中光束） ══════════
  // 与原能量炮/异星原型（已退役迁移）同伤害系（plasma）/同消耗键，但性格独立：
  // - 必中：射程带内不掷命中（无视距离衰减与回避，锁定即命中）；
  // - 距离衰减作用在威力而非命中，且幅度只有命中衰减的一半（威系数 = 1 − 进度×(1−falloff)×50%）；
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
    description: '轻型激光炮：能量光束必中（锁定即命中）、无视近盲；距离只轻微削减威力。消耗能量弹药（市场专供）。',
    cpuUse: 10,
    maxRangeM: 4600,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.3,
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
    description: '重型激光炮：8.2 km 远程光束，必中且只受轻微威力衰减——远程稳定输出的正解（市场专供，无蓝图）。',
    cpuUse: 28,
    maxRangeM: 8200,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.35,
    reloadMs: 3200,
    dmgMult: 2.7,
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
    falloff: 0.35,
    reloadMs: 4000,
    dmgMult: 3.8,
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
    falloff: 0.3,
    reloadMs: 4600,
    dmgMult: 4.7,
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
    maxRangeM: 6200,
    minRangeM: 500,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 2600,
    dmgMult: 1.25,
  },
  {
    id: 'mod-missile-2',
    name: '重型导弹架 MK2',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '重型导弹巢：9.8 km 远程爆破轰炸——装甲舰编队的噩梦（市场专供，无蓝图）。',
    cpuUse: 28,
    maxRangeM: 9800,
    minRangeM: 900,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 4000,
    dmgMult: 3.66,
  },
  {
    id: 'mod-missile-3',
    name: '巡航导弹架 MK3',
    slot: 'missile',
    rack: 'high',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '巡航导弹巢：12.4 km 远程毁灭——大编队交火前先发制人的火力（市场稀有现货，无蓝图）。',
    cpuUse: 52,
    maxRangeM: 12400,
    minRangeM: 1400,
    hitRate: 0.92,
    falloff: 1,
    reloadMs: 5000,
    dmgMult: 5.03,
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
    description: '外挂无人机甲板：无人机舱 +15 m³（约多带 2-5 架中型/数架轻型）。无人机流的起点。',
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
    description: '放飞无人机单发伤害 +12%（乘入无人机自身基数）。无人机流派的火力核心。',
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

  // ══════════ 护盾增强器（shield 抗性件：纯抗性，分系缺口乘入） ══════════
  {
    id: 'mod-shield-kin-1',
    name: '护盾增强器 MK1·动能型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.2 },
    cpuUse: 5,
    description: '动能抗 +20%（乘入制：0 基础船面板 +20%，25% 基础船 → 40%，上限 90%）。动能是协会武装最常用弹种——默认悬赏都吃这口。',
  },
  {
    id: 'mod-shield-exp-1',
    name: '护盾增强器 MK1·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.2 },
    cpuUse: 5,
    description: '高爆抗 +20%（乘入制，上限 90%）。克制爆破弹与鱼雷型敌人。',
  },
  {
    id: 'mod-shield-pla-1',
    name: '护盾增强器 MK1·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.2 },
    cpuUse: 5,
    description: '能量抗 +20%（乘入制，上限 90%）。对能量武器的调谐方案。',
  },
  {
    id: 'mod-shield-kin-2',
    name: '护盾增强器 MK2·动能型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.35 },
    cpuUse: 15,
    description: '动能抗 +35%（乘入制：0 基础船 +35%，25% 基础船 → 51%，上限 90%）。带弹道预测算法的第二代调谐器。',
  },
  {
    id: 'mod-shield-exp-2',
    name: '护盾增强器 MK2·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.35 },
    cpuUse: 15,
    description: '高爆抗 +35%（乘入制，上限 90%）。专为爆破弹道优化的护盾频段。',
  },
  {
    id: 'mod-shield-pla-2',
    name: '护盾增强器 MK2·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.35 },
    cpuUse: 15,
    description: '能量抗 +35%（乘入制，上限 90%）。高频能量护盾的稳定方案。',
  },
  {
    id: 'mod-shield-kin-3',
    name: '护盾增强器 MK3·动能型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { kinetic: 0.5 },
    cpuUse: 40,
    description: '动能抗 +50%（乘入制：0 基础船 +50%，25% 基础船 → 63%，上限 90%）。旗舰级弹道拦截阵列（市场稀有）。',
  },
  {
    id: 'mod-shield-exp-3',
    name: '护盾增强器 MK3·高爆型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { explosive: 0.5 },
    cpuUse: 40,
    description: '高爆抗 +50%（乘入制，上限 90%）。可以正面接下爆破弹雨的强化护盾（市场稀有）。',
  },
  {
    id: 'mod-shield-pla-3',
    name: '护盾增强器 MK3·能量型',
    slot: 'shield',
    rack: 'mid',
    shieldResistAdd: { plasma: 0.5 },
    cpuUse: 40,
    description: '能量抗 +50%（乘入制，上限 90%）。能量武器时代的盾构解（市场稀有）。',
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

  // ══════════ 装甲镀层（armor 抗性件：纯抗性，分系缺口乘入） ══════════
  {
    id: 'mod-armor-kin-1',
    name: '装甲镀层 MK1·动能型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.25 },
    cpuUse: 5,
    description: '动能抗 +25%（乘入制：0 基础船 +25%，25% 基础船 → 44%，上限 90%）。动能破甲弹的克制镀层。',
  },
  {
    id: 'mod-armor-exp-1',
    name: '装甲镀层 MK1·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.25 },
    cpuUse: 5,
    description: '高爆抗 +25%（乘入制，上限 90%）。高爆对装甲是双倍伤害——这是第一道防线。',
  },
  {
    id: 'mod-armor-pla-1',
    name: '装甲镀层 MK1·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.25 },
    cpuUse: 5,
    description: '能量抗 +25%（乘入制，上限 90%）。隔热镀层方案。',
  },
  {
    id: 'mod-armor-kin-2',
    name: '装甲镀层 MK2·动能型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.4 },
    cpuUse: 15,
    description: '动能抗 +40%（乘入制：0 基础船 +40%，25% 基础船 → 55%，上限 90%）。复合夹层结构，动能弹的噩梦。',
  },
  {
    id: 'mod-armor-exp-2',
    name: '装甲镀层 MK2·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.4 },
    cpuUse: 15,
    description: '高爆抗 +40%（乘入制，上限 90%）。爆震格栅装甲，重炮手眼中最硬的骨头。',
  },
  {
    id: 'mod-armor-pla-2',
    name: '装甲镀层 MK2·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.4 },
    cpuUse: 15,
    description: '能量抗 +40%（乘入制，上限 90%）。陶瓷隔热层叠技术。',
  },
  {
    id: 'mod-armor-kin-3',
    name: '装甲镀层 MK3·动能型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { kinetic: 0.55 },
    cpuUse: 40,
    description: '动能抗 +55%（乘入制：0 基础船 +55%，25% 基础船 → 66%，上限 90%）。要塞级复合装甲（市场稀有）。',
  },
  {
    id: 'mod-armor-exp-3',
    name: '装甲镀层 MK3·高爆型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { explosive: 0.55 },
    cpuUse: 40,
    description: '高爆抗 +55%（乘入制，上限 90%）。顶住高爆齐射的移动堡垒（市场稀有）。',
  },
  {
    id: 'mod-armor-pla-3',
    name: '装甲镀层 MK3·能量型',
    slot: 'armor',
    rack: 'low',
    armorResistAdd: { plasma: 0.55 },
    cpuUse: 40,
    description: '能量抗 +55%（乘入制，上限 90%）。能硬抗能量炮的烧蚀装甲（市场稀有）。',
  },

  // ══════════ 装甲增厚板（armor 容量件：纯容量，与抗性件同槽二选一） ══════════
  {
    id: 'mod-armor-plate-1',
    name: '装甲增厚板 MK1',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.2,
    cpuUse: 5,
    description: '装甲容量 +20%。经典堆甲方案，只加厚度、不挑弹种。',
  },
  {
    id: 'mod-armor-plate-2',
    name: '装甲增厚板 MK2',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.45,
    cpuUse: 15,
    description: '装甲容量 +45%。加厚夹层，装甲舰的中坚配置。',
  },
  {
    id: 'mod-armor-plate-3',
    name: '装甲增厚板 MK3',
    slot: 'armor',
    rack: 'low',
    armorHpBonus: 0.8,
    cpuUse: 40,
    description: '装甲容量 +80%。全站重工浇铸的复合装甲层（市场稀有）。',
  },

  // ══════════ 矢量推进器（propulsion：加力推进 + 常驻命中代价） ══════════
  {
    id: 'mod-prop-1',
    name: '矢量推进器 MK1',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.15,
    hitPenalty: 0.05,
    cpuUse: 5,
    description: '加力推进：战斗速度 +15%，代价 = 开火命中 ×0.95（常驻）。逼近/脱离更快，输出略失稳。',
  },
  {
    id: 'mod-prop-2',
    name: '矢量推进器 MK2',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.3,
    hitPenalty: 0.12,
    cpuUse: 15,
    description: '加力推进：战斗速度 +30%，代价 = 开火命中 ×0.88（常驻）。高机动舰标配，风筝战术的引擎。',
  },
  {
    id: 'mod-prop-3',
    name: '矢量推进器 MK3',
    slot: 'propulsion',
    rack: 'mid',
    speedBonusPct: 0.5,
    hitPenalty: 0.2,
    cpuUse: 40,
    description: '加力推进：战斗速度 +50%，代价 = 开火命中 ×0.80（常驻）。短距冲刺压燃引擎——快，但不稳（市场稀有）。',
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
    description: '动能武器支援（低槽）：动能炮台单发伤害 +6%。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-stab-kin-2',
    name: '动能稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.1 },
    cpuUse: 15,
    description: '动能武器支援（低槽）：动能炮台单发伤害 +10%。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-stab-kin-3',
    name: '动能稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { kinetic: 0.15 },
    cpuUse: 40,
    description: '动能武器支援（低槽）：动能炮台单发伤害 +15%。同类可多装、效果全额叠加（市场稀有）。',
  },
  {
    id: 'mod-stab-exp-1',
    name: '高爆稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.06 },
    cpuUse: 5,
    description: '高爆武器支援（低槽）：爆炸系武器（导弹架）单发伤害 +6%。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-stab-exp-2',
    name: '高爆稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.1 },
    cpuUse: 15,
    description: '高爆武器支援（低槽）：爆炸系武器（导弹架）单发伤害 +10%。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-stab-exp-3',
    name: '高爆稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { explosive: 0.15 },
    cpuUse: 40,
    description: '高爆武器支援（低槽）：爆炸系武器（导弹架）单发伤害 +15%。同类可多装、效果全额叠加（市场稀有）。',
  },
  {
    id: 'mod-stab-pla-1',
    name: '等离子稳定器 MK1',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.06 },
    cpuUse: 5,
    description: '等离子武器支援（低槽）：能量系武器（激光炮）单发伤害 +6%。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-stab-pla-2',
    name: '等离子稳定器 MK2',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.1 },
    cpuUse: 15,
    description: '等离子武器支援（低槽）：能量系武器（激光炮）单发伤害 +10%。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-stab-pla-3',
    name: '等离子稳定器 MK3',
    slot: 'support',
    rack: 'low',
    damageTypeBonusPct: { plasma: 0.15 },
    cpuUse: 40,
    description: '等离子武器支援（低槽）：能量系武器（激光炮）单发伤害 +15%。同类可多装、效果全额叠加（市场稀有）。',
  },
  {
    id: 'mod-rof-1',
    name: '射速计算机 MK1',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.05,
    cpuUse: 5,
    description: '炮台射速支援（低槽）：装填间隔 −5%（约合射速 +5%）。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-rof-2',
    name: '射速计算机 MK2',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.08,
    cpuUse: 15,
    description: '炮台射速支援（低槽）：装填间隔 −8%（约合射速 +9%）。同类可多装、效果全额叠加。',
  },
  {
    id: 'mod-rof-3',
    name: '射速计算机 MK3',
    slot: 'support',
    rack: 'low',
    reloadCutPct: 0.12,
    cpuUse: 40,
    description: '炮台射速支援（低槽）：装填间隔 −12%（约合射速 +14%）。同类可多装、效果全额叠加（市场稀有）。',
  },
  {
    id: 'mod-track-1',
    name: '索敌阵列 MK1',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.08,
    cpuUse: 5,
    description: '索敌支援（中槽）：炮台命中整体提升 8%。同类多装收益递减。',
  },
  {
    id: 'mod-track-2',
    name: '索敌阵列 MK2',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.12,
    cpuUse: 15,
    description: '索敌支援（中槽）：炮台命中整体提升 12%。同类多装收益递减。',
  },
  {
    id: 'mod-track-3',
    name: '索敌阵列 MK3',
    slot: 'support',
    rack: 'mid',
    hitBonusPct: 0.16,
    cpuUse: 40,
    description: '索敌支援（中槽）：炮台命中整体提升 16%。同类多装收益递减（市场稀有）。',
  },
  {
    id: 'mod-gyro-1',
    name: '姿态陀螺 MK1',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.1,
    cpuUse: 5,
    description: '机动支援（中槽）：被命中缺口削减 10%（敌命中 60% → 54%）。同类多装收益递减。',
  },
  {
    id: 'mod-gyro-2',
    name: '姿态陀螺 MK2',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.15,
    cpuUse: 15,
    description: '机动支援（中槽）：被命中缺口削减 15%（敌命中 60% → 51%）。同类多装收益递减。',
  },
  {
    id: 'mod-gyro-3',
    name: '姿态陀螺 MK3',
    slot: 'support',
    rack: 'mid',
    evasionGapPct: 0.2,
    cpuUse: 40,
    description: '机动支援（中槽）：被命中缺口削减 20%（敌命中 60% → 48%）。同类多装收益递减（市场稀有）。',
  },
]

/** 构建"装备 id → 定义"目录 */
export function buildModuleCatalog(): ReadonlyMap<string, ModuleDef> {
  return new Map(MODULES.map((m) => [m.id, m]))
}
