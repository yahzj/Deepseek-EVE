/**
 * 装备表（M2 + V10 + V10.5 + V10.5b）：24 件装备。
 *
 * 设计（中文说明）：
 * - 生效家族（miner 采集器 / cargo 货舱 / turret 炮台）：各 4 档——民用（新手平价）、
 *   MK1/MK2（历史档位）、MK3（攻坚级，无蓝图仅市场稀有），加成封顶不无限拉高曲线；
 * - 占位家族（shield 护盾 / armor 装甲 / propulsion 推进器）：V10 新槽位，可装配，
 *   V10.5 起数值契约就位（量%/抗性/机动），V10.5b 起抗性加成为"对三系伤害等量提升"；
 * - 炮台配弹（V10.5 契约）：民用/MK1 = 轻型炮台（吃轻弹，每远征耗弹 24），
 *   MK2 起 = 重型炮台（吃重弹，每远征耗弹 12）；
 * - cpuUse（V10.5b）：装配占用 CPU——与无人机放飞共用船体 CPU（带宽已并入），
 *   本轮仅展示与契约，引擎在战斗系统阶段校验；
 * - 原型机（proto）：市场 exotic 限定奇货、声望门槛解锁、无蓝图——超档收藏品；
 * - 每类只有一档生效于单槽：重复装同槽自动退回旧件（见 core/equipment）。
 */

import type { ModuleDef } from '@whale/core'

export const MODULES: readonly ModuleDef[] = [
  // ══════════ 采集器（miner：+循环产量） ══════════
  {
    id: 'mod-miner-civ',
    name: '民用采集器',
    slot: 'miner',
    bonus: 0.1,
    description: '产量 +10%。空间站平价货，新手第一件看得起的强化（V10 新增）。',
    cpuUse: 6,
  },
  {
    id: 'mod-miner-1',
    name: '强化采集器 MK1',
    slot: 'miner',
    bonus: 0.2,
    description: '提升 20% 循环产量。工业入门的第一件自制装备。',
    cpuUse: 8,
  },
  {
    id: 'mod-miner-2',
    name: '强化采集器 MK2',
    slot: 'miner',
    bonus: 0.5,
    description: '提升 50% 循环产量。双管谐振钻头，深空工业的标杆装备。',
    cpuUse: 14,
  },
  {
    id: 'mod-miner-3',
    name: '精密采集器 MK3',
    slot: 'miner',
    bonus: 0.8,
    description: '产量 +80%。协会精密工业的结晶，市场稀有现货（V10 新增，无蓝图）。',
    cpuUse: 24,
  },
  {
    id: 'mod-miner-proto',
    name: '异星原型采集器',
    slot: 'miner',
    bonus: 1.1,
    description: '产量 +110%。来源不明的异星技术，仅限奇货市场（V10，需高声望）。',
    cpuUse: 34,
  },

  // ══════════ 货舱（cargo：+货舱容量） ══════════
  {
    id: 'mod-cargo-civ',
    name: '民用货舱扩展',
    slot: 'cargo',
    bonus: 0.15,
    description: '货舱容量 +15%。廉价的续航改装（V10 新增）。',
    cpuUse: 5,
  },
  {
    id: 'mod-cargo-1',
    name: '货舱扩展 MK1',
    slot: 'cargo',
    bonus: 0.3,
    description: '货舱容量 +30%，减少返港卸货次数。',
    cpuUse: 7,
  },
  {
    id: 'mod-cargo-2',
    name: '货舱扩展 MK2',
    slot: 'cargo',
    bonus: 0.8,
    description: '货舱容量 +80%。离线长时间作业的必备扩展。',
    cpuUse: 12,
  },
  {
    id: 'mod-cargo-3',
    name: '折叠货舱扩展 MK3',
    slot: 'cargo',
    bonus: 1.4,
    description: '货舱容量 +140%。空间折叠衬层，市场稀有现货（V10 新增，无蓝图）。',
    cpuUse: 20,
  },
  {
    id: 'mod-cargo-proto',
    name: '异星原型货舱',
    slot: 'cargo',
    bonus: 1.8,
    description: '货舱容量 +180%。异星空间技术，仅限奇货市场（V10，需高声望）。',
    cpuUse: 28,
  },

  // ══════════ 炮台（turret：+火力；V10.5 契约：weaponSize/耗弹基数） ══════════
  {
    id: 'mod-turret-civ',
    name: '民用舰炮',
    slot: 'turret',
    bonus: 0.12,
    description: '火力 +12%。协会自警队的制式轻型舰炮，吃轻弹（战斗启用后每远征耗弹 24）。',
    weaponSize: 'light',
    ammoPerEngagement: 24,
    cpuUse: 10,
    maxRangeM: 4200,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2400,
    dmgMult: 1.0,
  },
  {
    id: 'mod-turret-1',
    name: '舰载轻型炮台 MK1',
    slot: 'turret',
    bonus: 0.25,
    description: '火力 +25%。把矿船变成勉强能打的武装矿船（轻型炮台，吃轻弹）。',
    weaponSize: 'light',
    ammoPerEngagement: 24,
    cpuUse: 14,
    maxRangeM: 4600,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2200,
    dmgMult: 1.25,
  },
  {
    id: 'mod-turret-2',
    name: '舰载重型炮台 MK2',
    slot: 'turret',
    bonus: 0.6,
    description: '火力 +60%。深空工业舰炮的巅峰（重型炮台，吃重弹，每远征耗弹 12）。',
    weaponSize: 'heavy',
    ammoPerEngagement: 12,
    cpuUse: 26,
    maxRangeM: 8200,
    minRangeM: 700,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 3400,
    dmgMult: 1.6,
  },
  {
    id: 'mod-turret-3',
    name: '舰载攻坚炮台 MK3',
    slot: 'turret',
    bonus: 1.0,
    description: '火力 +100%。攻城级重型舰炮（吃重弹），市场稀有现货（V10 新增，无蓝图）。',
    weaponSize: 'heavy',
    ammoPerEngagement: 12,
    cpuUse: 40,
    maxRangeM: 10500,
    minRangeM: 1200,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 4200,
    dmgMult: 2.2,
  },
  {
    id: 'mod-turret-proto',
    name: '异星原型炮台',
    slot: 'turret',
    bonus: 1.5,
    description: '火力 +150%。无法逆向工程的异星重型武器（吃重弹），仅限奇货市场（V10，需高声望）。',
    weaponSize: 'heavy',
    ammoPerEngagement: 12,
    cpuUse: 55,
    maxRangeM: 13000,
    minRangeM: 1600,
    hitRate: 0.78,
    falloff: 0.28,
    reloadMs: 4800,
    dmgMult: 2.8,
  },

  // ══════════ 护盾（shield；数值契约就位，抗性加成为三系等量） ══════════
  {
    id: 'mod-shield-1',
    name: '护盾增强器 MK1',
    slot: 'shield',
    bonus: 0.15,
    description: '（战斗启用）护盾容量 +15%、护盾抗性三系各 +4 个百分点。',
    shieldHpBonus: 0.15,
    shieldResistBonus: 0.04,
    cpuUse: 6,
  },
  {
    id: 'mod-shield-2',
    name: '护盾增强器 MK2',
    slot: 'shield',
    bonus: 0.35,
    description: '（战斗启用）护盾容量 +35%、护盾抗性三系各 +8 个百分点。',
    shieldHpBonus: 0.35,
    shieldResistBonus: 0.08,
    cpuUse: 10,
  },
  {
    id: 'mod-shield-3',
    name: '护盾增强器 MK3',
    slot: 'shield',
    bonus: 0.5,
    description: '（战斗启用）护盾容量 +60%、护盾抗性三系各 +12 个百分点。',
    shieldHpBonus: 0.6,
    shieldResistBonus: 0.12,
    cpuUse: 16,
  },

  // ══════════ 装甲（armor；数值契约就位，抗性加成为三系等量） ══════════
  {
    id: 'mod-armor-1',
    name: '装甲增厚板 MK1',
    slot: 'armor',
    bonus: 0.2,
    description: '（战斗启用）装甲容量 +20%、装甲抗性三系各 +6 个百分点。',
    armorHpBonus: 0.2,
    armorResistBonus: 0.06,
    cpuUse: 5,
  },
  {
    id: 'mod-armor-2',
    name: '装甲增厚板 MK2',
    slot: 'armor',
    bonus: 0.5,
    description: '（战斗启用）装甲容量 +45%、装甲抗性三系各 +10 个百分点。',
    armorHpBonus: 0.45,
    armorResistBonus: 0.1,
    cpuUse: 8,
  },
  {
    id: 'mod-armor-3',
    name: '装甲增厚板 MK3',
    slot: 'armor',
    bonus: 0.8,
    description: '（战斗启用）装甲容量 +80%、装甲抗性三系各 +15 个百分点。',
    armorHpBonus: 0.8,
    armorResistBonus: 0.15,
    cpuUse: 14,
  },

  // ══════════ 推进器（propulsion；数值契约就位） ══════════
  {
    id: 'mod-prop-1',
    name: '矢量推进器 MK1',
    slot: 'propulsion',
    bonus: 0.1,
    description: '（战斗启用）机动 +0.08（弃船逃生率随机动提升）。',
    agilityBonus: 0.08,
    cpuUse: 6,
  },
  {
    id: 'mod-prop-2',
    name: '矢量推进器 MK2',
    slot: 'propulsion',
    bonus: 0.25,
    description: '（战斗启用）机动 +0.15（弃船逃生率随机动提升）。',
    agilityBonus: 0.15,
    cpuUse: 10,
  },
  {
    id: 'mod-prop-3',
    name: '矢量推进器 MK3',
    slot: 'propulsion',
    bonus: 0.4,
    description: '（战斗启用）机动 +0.25（弃船逃生率随机动提升）。',
    agilityBonus: 0.25,
    cpuUse: 15,
  },
]

/** 构建"装备 id → 定义"目录 */
export function buildModuleCatalog(): ReadonlyMap<string, ModuleDef> {
  return new Map(MODULES.map((m) => [m.id, m]))
}
