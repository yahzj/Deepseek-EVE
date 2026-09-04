/**
 * 装备表（V17.1 + V17.2：48 件）。
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
 *     蓝图 = 动能款（协会制式）；高爆/能量款市场专供；口径限制已取消——任意船可装
 *     任意炮，装配唯一约束 = CPU；弹药每型单档通用弹（-l），炮台按自身固定弹种消耗；
 * - CPU 装配资源（V17.1 用户定稿：成倍档位拉开船级差距）：
 *   民用 3（炮台 6）/ MK1 5（炮台 10）/ MK2 15（炮台 28）/ MK3 40（炮台 52）/
 *   异星原型 60（炮台 70）——战斗件与工业件同档；低级船（沙猫 60 CPU）只带得动
 *   低级全套，MK3 顶配套件需要 220+ CPU 的顶级船，无人机放飞余量同池竞争；
 * - 渠道与既有规则一致：MK1 平价 / MK2・MK3 稀有（MK3 无蓝图市场专供）/
 *   proto 奇货（声望 10、无蓝图）；护盾/装甲/推进无蓝图（市场供应为主）；
 * - 存档迁移：mod-shield-1/2/3、mod-armor-1/2/3（通用全系）与 mod-turret-1/2/3
 *   （V17 前混型炮）已下架，载入存档自动按动能款迁移（core/equipment 迁移表）；
 * - V18 立项（C3）：EVE 式高/中/低槽船体布局为独立里程碑，届时纯结构迁移
 *   （槽位制设计评审中，见 docs/roadmap.md）——炮尺寸三档制已随口径取消移除，与其无关。
 */

import type { ModuleDef } from '@whale/core'

export const MODULES: readonly ModuleDef[] = [
  // ══════════ 采集器（miner：工业槽，产量加成） ══════════
  {
    id: 'mod-miner-civ',
    name: '民用采集器',
    slot: 'miner',
    bonus: 0.1,
    description: '产量 +10%。空间站平价货，新手第一件看得起的强化。',
    cpuUse: 3,
  },
  {
    id: 'mod-miner-1',
    name: '强化采集器 MK1',
    slot: 'miner',
    bonus: 0.2,
    description: '提升 20% 循环产量。工业入门的第一件自制装备。',
    cpuUse: 5,
  },
  {
    id: 'mod-miner-2',
    name: '强化采集器 MK2',
    slot: 'miner',
    bonus: 0.5,
    description: '提升 50% 循环产量。双管谐振钻头，深空工业的标杆装备。',
    cpuUse: 15,
  },
  {
    id: 'mod-miner-3',
    name: '精密采集器 MK3',
    slot: 'miner',
    bonus: 0.8,
    description: '产量 +80%。协会精密工业的结晶（蓝图可造，见制造台）；40 CPU 已接近小型船满载。',
    cpuUse: 40,
  },
  {
    id: 'mod-miner-proto',
    name: '异星原型采集器',
    slot: 'miner',
    bonus: 1.1,
    description: '产量 +110%。来源不明的异星技术，仅限奇货市场（需高声望）。',
    cpuUse: 60,
  },

  // ══════════ 货舱（cargo：工业槽，容量加成） ══════════
  {
    id: 'mod-cargo-civ',
    name: '民用货舱扩展',
    slot: 'cargo',
    bonus: 0.15,
    description: '货舱容量 +15%。廉价的续航改装。',
    cpuUse: 3,
  },
  {
    id: 'mod-cargo-1',
    name: '货舱扩展 MK1',
    slot: 'cargo',
    bonus: 0.3,
    description: '货舱容量 +30%，减少返港卸货次数。',
    cpuUse: 5,
  },
  {
    id: 'mod-cargo-2',
    name: '货舱扩展 MK2',
    slot: 'cargo',
    bonus: 0.8,
    description: '货舱容量 +80%。离线长时间作业的必备扩展。',
    cpuUse: 15,
  },
  {
    id: 'mod-cargo-3',
    name: '折叠货舱扩展 MK3',
    slot: 'cargo',
    bonus: 1.4,
    description: '货舱容量 +140%。空间折叠衬层，协会制式蓝图可造（制造台）。',
    cpuUse: 40,
  },
  {
    id: 'mod-cargo-proto',
    name: '异星原型货舱',
    slot: 'cargo',
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
    id: 'mod-turret-exp-1',
    name: '轻型炮台 MK1·高爆型',
    slot: 'turret',

    damageType: 'explosive',
    ammoPerEngagement: 24,
    description: '轻型高爆炮：打甲 1.5 倍伤害（打盾减半）。装甲型敌人的克星（市场专供，无蓝图）。',
    cpuUse: 10,
    maxRangeM: 4600,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2200,
    dmgMult: 1.25,
  },
  {
    id: 'mod-turret-pla-1',
    name: '轻型炮台 MK1·能量型',
    slot: 'turret',

    damageType: 'plasma',
    ammoPerEngagement: 24,
    description: '轻型能量炮：对三层伤害均衡（打盾 0.75 倍），但能量弹单发基数最高——结构层决胜弹（市场专供）。',
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
    id: 'mod-turret-exp-2',
    name: '重型炮台 MK2·高爆型',
    slot: 'turret',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '重型高爆炮：远程破甲主力——装甲舰编队的噩梦（市场专供，无蓝图）。',
    cpuUse: 28,
    maxRangeM: 8200,
    minRangeM: 700,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 3400,
    dmgMult: 3.66,
  },
  {
    id: 'mod-turret-pla-2',
    name: '重型炮台 MK2·能量型',
    slot: 'turret',

    damageType: 'plasma',
    ammoPerEngagement: 12,
    description: '重型能量炮：远程均衡火力，能量弹单发基数最高（市场专供，无蓝图）。',
    cpuUse: 28,
    maxRangeM: 8200,
    minRangeM: 700,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 3400,
    dmgMult: 3.38,
  },
  {
    id: 'mod-turret-kin-3',
    name: '攻坚炮台 MK3·动能型',
    slot: 'turret',

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
  {
    id: 'mod-turret-exp-3',
    name: '攻坚炮台 MK3·高爆型',
    slot: 'turret',

    damageType: 'explosive',
    ammoPerEngagement: 12,
    description: '攻城级高爆巨炮：摧毁装甲工事的一击（市场稀有现货，无蓝图）。',
    cpuUse: 52,
    maxRangeM: 10500,
    minRangeM: 1200,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 4200,
    dmgMult: 5.03,
  },
  {
    id: 'mod-turret-pla-3',
    name: '攻坚炮台 MK3·能量型',
    slot: 'turret',

    damageType: 'plasma',
    ammoPerEngagement: 12,
    description: '攻城级能量巨炮：能量武器时代的攻城解（市场稀有现货，无蓝图）。',
    cpuUse: 52,
    maxRangeM: 10500,
    minRangeM: 1200,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 4200,
    dmgMult: 4.64,
  },
  {
    id: 'mod-turret-proto',
    name: '异星原型炮台',
    slot: 'turret',

    damageType: 'plasma',
    ammoPerEngagement: 12,
    description: '无法逆向工程的异星重型能量武器：13 km 射程，仅限奇货市场（需高声望）。',
    cpuUse: 70,
    maxRangeM: 13000,
    minRangeM: 1600,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 4800,
    dmgMult: 5.91,
  },

  // ══════════ 护盾增强器（shield 抗性件：纯抗性，分系缺口乘入） ══════════
  {
    id: 'mod-shield-kin-1',
    name: '护盾增强器 MK1·动能型',
    slot: 'shield',
    shieldResistAdd: { kinetic: 0.2 },
    cpuUse: 5,
    description: '动能抗 +20%（乘入制：0 基础船面板 +20%，25% 基础船 → 40%，上限 90%）。动能是协会武装最常用弹种——默认悬赏都吃这口。',
  },
  {
    id: 'mod-shield-exp-1',
    name: '护盾增强器 MK1·高爆型',
    slot: 'shield',
    shieldResistAdd: { explosive: 0.2 },
    cpuUse: 5,
    description: '高爆抗 +20%（乘入制，上限 90%）。克制爆破弹与鱼雷型敌人。',
  },
  {
    id: 'mod-shield-pla-1',
    name: '护盾增强器 MK1·能量型',
    slot: 'shield',
    shieldResistAdd: { plasma: 0.2 },
    cpuUse: 5,
    description: '能量抗 +20%（乘入制，上限 90%）。对能量武器的调谐方案。',
  },
  {
    id: 'mod-shield-kin-2',
    name: '护盾增强器 MK2·动能型',
    slot: 'shield',
    shieldResistAdd: { kinetic: 0.35 },
    cpuUse: 15,
    description: '动能抗 +35%（乘入制：0 基础船 +35%，25% 基础船 → 51%，上限 90%）。带弹道预测算法的第二代调谐器。',
  },
  {
    id: 'mod-shield-exp-2',
    name: '护盾增强器 MK2·高爆型',
    slot: 'shield',
    shieldResistAdd: { explosive: 0.35 },
    cpuUse: 15,
    description: '高爆抗 +35%（乘入制，上限 90%）。专为爆破弹道优化的护盾频段。',
  },
  {
    id: 'mod-shield-pla-2',
    name: '护盾增强器 MK2·能量型',
    slot: 'shield',
    shieldResistAdd: { plasma: 0.35 },
    cpuUse: 15,
    description: '能量抗 +35%（乘入制，上限 90%）。高频能量护盾的稳定方案。',
  },
  {
    id: 'mod-shield-kin-3',
    name: '护盾增强器 MK3·动能型',
    slot: 'shield',
    shieldResistAdd: { kinetic: 0.5 },
    cpuUse: 40,
    description: '动能抗 +50%（乘入制：0 基础船 +50%，25% 基础船 → 63%，上限 90%）。旗舰级弹道拦截阵列（市场稀有）。',
  },
  {
    id: 'mod-shield-exp-3',
    name: '护盾增强器 MK3·高爆型',
    slot: 'shield',
    shieldResistAdd: { explosive: 0.5 },
    cpuUse: 40,
    description: '高爆抗 +50%（乘入制，上限 90%）。可以正面接下爆破弹雨的强化护盾（市场稀有）。',
  },
  {
    id: 'mod-shield-pla-3',
    name: '护盾增强器 MK3·能量型',
    slot: 'shield',
    shieldResistAdd: { plasma: 0.5 },
    cpuUse: 40,
    description: '能量抗 +50%（乘入制，上限 90%）。能量武器时代的盾构解（市场稀有）。',
  },

  // ══════════ 护盾扩展器（shield 容量件：纯容量，与抗性件同槽二选一） ══════════
  {
    id: 'mod-shield-ext-1',
    name: '护盾扩展器 MK1',
    slot: 'shield',
    shieldHpBonus: 0.15,
    cpuUse: 5,
    description: '护盾容量 +15%。只堆盾量、不选抗性系时的朴素方案。',
  },
  {
    id: 'mod-shield-ext-2',
    name: '护盾扩展器 MK2',
    slot: 'shield',
    shieldHpBonus: 0.35,
    cpuUse: 15,
    description: '护盾容量 +35%。扩容器阵列，吃下更多爆发伤害。',
  },
  {
    id: 'mod-shield-ext-3',
    name: '护盾扩展器 MK3',
    slot: 'shield',
    shieldHpBonus: 0.6,
    cpuUse: 40,
    description: '护盾容量 +60%。全站功率输送的巨型护盾发生器（市场稀有）。',
  },

  // ══════════ 装甲镀层（armor 抗性件：纯抗性，分系缺口乘入） ══════════
  {
    id: 'mod-armor-kin-1',
    name: '装甲镀层 MK1·动能型',
    slot: 'armor',
    armorResistAdd: { kinetic: 0.25 },
    cpuUse: 5,
    description: '动能抗 +25%（乘入制：0 基础船 +25%，25% 基础船 → 44%，上限 90%）。动能破甲弹的克制镀层。',
  },
  {
    id: 'mod-armor-exp-1',
    name: '装甲镀层 MK1·高爆型',
    slot: 'armor',
    armorResistAdd: { explosive: 0.25 },
    cpuUse: 5,
    description: '高爆抗 +25%（乘入制，上限 90%）。高爆对装甲是双倍伤害——这是第一道防线。',
  },
  {
    id: 'mod-armor-pla-1',
    name: '装甲镀层 MK1·能量型',
    slot: 'armor',
    armorResistAdd: { plasma: 0.25 },
    cpuUse: 5,
    description: '能量抗 +25%（乘入制，上限 90%）。隔热镀层方案。',
  },
  {
    id: 'mod-armor-kin-2',
    name: '装甲镀层 MK2·动能型',
    slot: 'armor',
    armorResistAdd: { kinetic: 0.4 },
    cpuUse: 15,
    description: '动能抗 +40%（乘入制：0 基础船 +40%，25% 基础船 → 55%，上限 90%）。复合夹层结构，动能弹的噩梦。',
  },
  {
    id: 'mod-armor-exp-2',
    name: '装甲镀层 MK2·高爆型',
    slot: 'armor',
    armorResistAdd: { explosive: 0.4 },
    cpuUse: 15,
    description: '高爆抗 +40%（乘入制，上限 90%）。爆震格栅装甲，重炮手眼中最硬的骨头。',
  },
  {
    id: 'mod-armor-pla-2',
    name: '装甲镀层 MK2·能量型',
    slot: 'armor',
    armorResistAdd: { plasma: 0.4 },
    cpuUse: 15,
    description: '能量抗 +40%（乘入制，上限 90%）。陶瓷隔热层叠技术。',
  },
  {
    id: 'mod-armor-kin-3',
    name: '装甲镀层 MK3·动能型',
    slot: 'armor',
    armorResistAdd: { kinetic: 0.55 },
    cpuUse: 40,
    description: '动能抗 +55%（乘入制：0 基础船 +55%，25% 基础船 → 66%，上限 90%）。要塞级复合装甲（市场稀有）。',
  },
  {
    id: 'mod-armor-exp-3',
    name: '装甲镀层 MK3·高爆型',
    slot: 'armor',
    armorResistAdd: { explosive: 0.55 },
    cpuUse: 40,
    description: '高爆抗 +55%（乘入制，上限 90%）。顶住高爆齐射的移动堡垒（市场稀有）。',
  },
  {
    id: 'mod-armor-pla-3',
    name: '装甲镀层 MK3·能量型',
    slot: 'armor',
    armorResistAdd: { plasma: 0.55 },
    cpuUse: 40,
    description: '能量抗 +55%（乘入制，上限 90%）。能硬抗能量炮的烧蚀装甲（市场稀有）。',
  },

  // ══════════ 装甲增厚板（armor 容量件：纯容量，与抗性件同槽二选一） ══════════
  {
    id: 'mod-armor-plate-1',
    name: '装甲增厚板 MK1',
    slot: 'armor',
    armorHpBonus: 0.2,
    cpuUse: 5,
    description: '装甲容量 +20%。经典堆甲方案，只加厚度、不挑弹种。',
  },
  {
    id: 'mod-armor-plate-2',
    name: '装甲增厚板 MK2',
    slot: 'armor',
    armorHpBonus: 0.45,
    cpuUse: 15,
    description: '装甲容量 +45%。加厚夹层，装甲舰的中坚配置。',
  },
  {
    id: 'mod-armor-plate-3',
    name: '装甲增厚板 MK3',
    slot: 'armor',
    armorHpBonus: 0.8,
    cpuUse: 40,
    description: '装甲容量 +80%。全站重工浇铸的复合装甲层（市场稀有）。',
  },

  // ══════════ 矢量推进器（propulsion：加力推进 + 常驻命中代价） ══════════
  {
    id: 'mod-prop-1',
    name: '矢量推进器 MK1',
    slot: 'propulsion',
    speedBonusPct: 0.15,
    hitPenalty: 0.05,
    cpuUse: 5,
    description: '加力推进：战斗速度 +15%，代价 = 开火命中 ×0.95（常驻）。逼近/脱离更快，输出略失稳。',
  },
  {
    id: 'mod-prop-2',
    name: '矢量推进器 MK2',
    slot: 'propulsion',
    speedBonusPct: 0.3,
    hitPenalty: 0.12,
    cpuUse: 15,
    description: '加力推进：战斗速度 +30%，代价 = 开火命中 ×0.88（常驻）。高机动舰标配，风筝战术的引擎。',
  },
  {
    id: 'mod-prop-3',
    name: '矢量推进器 MK3',
    slot: 'propulsion',
    speedBonusPct: 0.5,
    hitPenalty: 0.2,
    cpuUse: 40,
    description: '加力推进：战斗速度 +50%，代价 = 开火命中 ×0.80（常驻）。短距冲刺压燃引擎——快，但不稳（市场稀有）。',
  },
]

/** 构建"装备 id → 定义"目录 */
export function buildModuleCatalog(): ReadonlyMap<string, ModuleDef> {
  return new Map(MODULES.map((m) => [m.id, m]))
}
