/**
 * 技能表（EVE 风格内容；2026-09-04 技能补全轮：全部"以后生效"按真实效果定稿）。
 *
 * 游戏规则（中文说明）：
 * - rank 是"难度系数"：rank=1 的单级时长 = 基础 60 秒 × 2^(等级-1)；
 *   rank 越大整条线练得越慢，对应"越核心的专业技能越难练"的 EVE 手感；
 * - description 写该技能实际生效的位置——**接线点分散在 core 各模块**（travel/mining/
 *   refining/manufacturing/industry/explore/inventory/market/combat/ai），加新技能需
 *   在对应模块补效果代码，改效果数值 = 同步 description 的 ⟦…⟧ 数值与 balance/模块常量；
 * - 航行加速技能族（V12.1 + 2026-09-04）：导航学 / 跃迁引擎操控 / 加速控制理论每级各
 *   −4%（乘算），舰船操控学全船基础再每级 −2%（见 core travel.ts）；
 * - T2 文案标记：description 里的"实际效果数值段"用 ⟦…⟧ 括起，界面高亮并自动去符号；
 *   同一句可有多段（会计学/贸易谈判学）。无数字效果的技能不必加标记。
 */

import type { SkillDef } from '@whale/core'

/** 全量技能表。顺序即界面展示顺序，新手向的放前面 */
export const SKILLS: readonly SkillDef[] = [
  // ───────── 舰船 ─────────
  {
    id: 'spaceship-command',
    name: '舰船操控学',
    group: '舰船',
    rank: 1,
    description: '所有舰船驾驶的基础操控训练。航行加速：每级再缩短星图航行时间 ⟦2%⟧（与导航三技能乘算叠加，全船通用）。',
  },
  {
    id: 'navigation',
    name: '导航学',
    group: '舰船',
    rank: 1,
    description: '更快的航线规划与亚光速机动。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'warp-drive-operation',
    name: '跃迁引擎操控',
    group: '舰船',
    rank: 2,
    description: '跃迁引擎的调校与维护。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'acceleration-control',
    name: '加速控制理论',
    group: '舰船',
    rank: 2,
    description: '跃迁起止阶段的加速与减速控制。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'mining-frigate',
    name: '采矿护卫舰操作',
    group: '舰船',
    rank: 2,
    description: '专用矿船的驾驶与自动化开采调校：每级缩短采集循环时间 ⟦3%⟧（最多缩短 ⟦40%⟧）。',
  },
  {
    id: 'deep-space-logistics',
    name: '深空物流学',
    group: '舰船',
    rank: 3,
    description: '深空物流与仓位规划：全舰队货仓容量每级 +⟦4%⟧（满级 +⟦20%⟧；与货舱扩展件加成乘算）。',
  },

  // ───────── 工业 ─────────
  {
    id: 'mining',
    name: '采矿技术',
    group: '工业',
    rank: 2,
    description: '矿石开采的核心技术：每级提高采集循环产量 ⟦6%⟧。',
  },
  {
    id: 'deep-space-harvesting',
    name: '深空采集学',
    group: '工业',
    rank: 2,
    description: '稀有资源采集：气体与冰矿的采集循环产量每级 +⟦5%⟧（普通矿石不受影响）。',
  },
  {
    id: 'refining',
    name: '精炼学',
    group: '工业',
    rank: 1,
    description: '精炼炉收率：每级提高 ⟦8%⟧（基础 50%；与高级回收处理合计上限 ⟦95%⟧）。',
  },
  {
    id: 'reprocessing',
    name: '高级回收处理',
    group: '工业',
    rank: 2,
    description: '进一步提高精炼收率：每级 +⟦4%⟧（与精炼学合计上限 ⟦95%⟧）。',
  },
  {
    id: 'industry',
    name: '工业理论',
    group: '工业',
    rank: 3,
    description: '制造业核心理论：每级缩短蓝图制造时间 ⟦5%⟧（最多缩短 ⟦60%⟧）。',
  },
  {
    id: 'materials',
    name: '材料学',
    group: '工业',
    rank: 3,
    description: '制造工艺精进：每级减少蓝图制造的材料消耗 ⟦2%⟧（满级 −⟦10%⟧；单种至少消耗 1 单位）。',
  },
  {
    id: 'industrial-automation',
    name: '工业自动化',
    group: '工业',
    rank: 3,
    description: 'AI 自动化作业：AI 核心驱动的精炼炉运转周期每级缩短 ⟦5%⟧（满级 −⟦25%⟧，至少保留 60%；手动运转不受影响）。',
  },
  {
    id: 'astro-geology',
    name: '星质地质学',
    group: '工业',
    rank: 2,
    description: '岩层构成的进阶研究：全矿采集产量每级再 +⟦4%⟧（与采矿技术乘算叠加）。',
  },
  {
    id: 'deep-hole-blasting',
    name: '深井爆破学',
    group: '工业',
    rank: 3,
    description: '浅层矿带的爆破开采优化：低品位矿石（富凡晶石/灼烧岩/希莫非特）产量每级 +⟦6%⟧。',
  },
  {
    id: 'rich-vein-prospecting',
    name: '富矿勘探学',
    group: '工业',
    rank: 2,
    description: '脉矿判定与富集带追踪：采掘时发现富矿脉（当次循环产量翻倍）的概率每级 ×⟦1.2⟧（基础 1%）。',
  },
  {
    id: 'core-smelting',
    name: '炉心熔炼学',
    group: '工业',
    rank: 2,
    description: '精炼炉温控与搅拌工艺：**主控手动**精炼单批周期每级缩短 ⟦4%⟧（AI 核心驱动不受此技能影响）。',
  },
  {
    id: 'furnace-expansion',
    name: '炉膛扩容学',
    group: '工业',
    rank: 2,
    description: '精炼炉膛容积改造：**主控手动**精炼的单批处理量每级 +⟦6%⟧（AI 核心驱动不受此技能影响）。',
  },
  {
    id: 'batch-production',
    name: '批量生产学',
    group: '工业',
    rank: 3,
    description: '多工位装配线排程：蓝图制造时间每级再 −⟦4%⟧（与工业理论乘算叠加）。',
  },
  {
    id: 'component-standardization',
    name: '组件标准化',
    group: '工业',
    rank: 3,
    description: '通用组件规格化：蓝图制造材料消耗每级再 −⟦1%⟧（与材料学乘算叠加）。',
  },
  {
    id: 'ai-servicing',
    name: '副船整备学',
    group: '工业',
    rank: 3,
    description: 'AI 副船的采集设备整备：副船采矿循环周期每级缩短 ⟦3%⟧（在 AI 核心效率之上乘算）。',
  },
  {
    id: 'offline-ops',
    name: '离线作业管理学',
    group: '工业',
    rank: 3,
    description: '无人值守作业调度：离线结算时长上限每级 +⟦8%⟧（基础 8 小时，满级约 11.2 小时）。',
  },

  // ───────── 战斗（数值由战斗线维护） ─────────
  {
    id: 'gunnery',
    name: '炮术学',
    group: '战斗',
    rank: 1,
    description: '舰炮战斗训练：每级提高实时战斗的单发伤害 ⟦5%⟧。',
  },

  // ───────── 工程 ─────────
  // 说明：护盾操作学 / 能量管理学 / 船体加固理论为战斗线预留条目——暂在界面隐藏、
  // 引擎禁训（HIDDEN_SKILL_IDS，见 core/engine.ts），战斗数值（二号）接入后开放。
  {
    id: 'shield-operation',
    name: '护盾操作学',
    group: '工程',
    rank: 1,
    description: '以后生效：提升护盾容量与恢复（战斗线预留，当前隐藏）。',
  },
  {
    id: 'energy-management',
    name: '能量管理学',
    group: '工程',
    rank: 2,
    description: '以后生效：提升电容总量，支撑更强的武器与设备（战斗线预留，当前隐藏）。',
  },
  {
    id: 'hull-upgrades',
    name: '船体加固理论',
    group: '工程',
    rank: 3,
    description: '以后生效：提升船体结构值与装甲抗性（战斗线预留，当前隐藏）。',
  },
  {
    id: 'repair-engineering',
    name: '维修工程学',
    group: '工程',
    rank: 2,
    description: '舰船维修工艺：停站维修费每级降低 ⟦10%⟧（满级 −⟦50%⟧，最低半价；修理组件不受影响）。',
  },
  {
    id: 'ai-expert',
    name: '人工智能专家',
    group: '工程',
    rank: 4,
    description: 'AI 指挥技能：每级可同时指挥 ⟦1 艘⟧ AI 副船（配合 AI 核心使用）。',
  },

  // ───────── 贸易（V9+：市场税率减免） ─────────
  {
    id: 'accounting',
    name: '会计学',
    group: '贸易',
    rank: 2,
    description: '贸易税减免：每级降低 ⟦8%⟧ 卖出成交的贸易税（与贸易谈判学合计最多减免 ⟦80%⟧）。',
  },
  {
    id: 'trade-negotiation',
    name: '贸易谈判学',
    group: '贸易',
    rank: 2,
    description: '协会渠道谈判：每级再降低 ⟦8%⟧ 贸易税——与会计学双修满级后贸易税仅剩 ⟦1%⟧（合计减免 ⟦80%⟧）。',
  },
  {
    id: 'bounty-hunting',
    name: '赏金猎手学',
    group: '贸易',
    rank: 2,
    description: '赏金评估与协会渠道：完成悬赏（含 AI 副船远征）的奖金每级 +⟦8%⟧（满级 +⟦40%⟧，在随机浮动之上乘算）。',
  },

  // ───────── 探索（2026-09-04 新组） ─────────
  {
    id: 'signal-analysis',
    name: '信号分析学',
    group: '探索',
    rank: 2,
    description: '未知信号解读与锁定：就地扫描窗口每级缩短 ⟦8%⟧（满级 −⟦40%⟧）。',
  },
]

/** 技能组清单（按此顺序分组展示） */
export const SKILL_GROUPS: readonly string[] = ['舰船', '工业', '战斗', '工程', '贸易', '探索']

/** 把技能表建成引擎用的"按 id 快速查找"目录 */
export function buildSkillCatalog(): ReadonlyMap<string, SkillDef> {
  return new Map(SKILLS.map((s) => [s.id, s]))
}
