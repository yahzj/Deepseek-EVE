/**
 * 技能表（EVE 风格示例内容）。
 *
 * 游戏规则（中文说明）：
 * - rank 是"难度系数"：rank=1 的单级时长 = 基础 60 秒 × 2^(等级-1)；
 *   rank 越大整条线练得越慢，对应"越核心的专业技能越难练"的 EVE 手感；
 * - description 写该技能实际生效的位置（部分系统后开者保留"以后生效"字样）；
 * - 航行加速技能族（V12.1）：导航学 / 跃迁引擎操控 / 加速控制理论——效果趋同统一，
 *   每级各缩短星图航行时间 4%，多技能乘算叠加（见 core balance.travel 与 travel.ts）；
 * - T2 文案标记：description 里的"实际效果数值段"用 ⟦…⟧ 括起（如 ⟦4%⟧、⟦1 艘⟧），
 *   界面渲染为高亮/换色并自动去掉符号；同一句可有多段（会计学/贸易谈判学）。
 *   无数字效果的技能不必加标记；
 * - 加新技能 = 在此表加一行，引擎零改动（数据驱动）。
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
    description: '所有舰船驾驶的基础。以后决定你能开什么船、船的属性加成。',
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
    description: '以后生效：解锁采矿护卫舰（专用矿船），提高单船采矿效率。',
  },

  // ───────── 工业 ─────────
  {
    id: 'mining',
    name: '采矿技术',
    group: '工业',
    rank: 2,
    description: '以后生效：提升矿石产量，是采矿玩法的核心技能。',
  },
  {
    id: 'refining',
    name: '精炼学',
    group: '工业',
    rank: 1,
    description: '以后生效：提高矿石精炼收率，减少损耗。',
  },
  {
    id: 'reprocessing',
    name: '高级回收处理',
    group: '工业',
    rank: 2,
    description: '以后生效：进一步提高精炼收率，能处理更多种类的矿石。',
  },
  {
    id: 'industry',
    name: '工业理论',
    group: '工业',
    rank: 3,
    description: '以后生效：缩短蓝图制造时间，制造业的核心技能。',
  },

  // ───────── 战斗 ─────────
  {
    id: 'gunnery',
    name: '炮术学',
    group: '战斗',
    rank: 1,
    description: '以后生效：提高舰炮伤害，战斗玩法的入门技能。',
  },

  // ───────── 工程 ─────────
  {
    id: 'shield-operation',
    name: '护盾操作学',
    group: '工程',
    rank: 1,
    description: '以后生效：提升护盾容量与恢复，让船更抗打。',
  },
  {
    id: 'energy-management',
    name: '能量管理学',
    group: '工程',
    rank: 2,
    description: '以后生效：提升电容总量，支撑更强的武器与设备。',
  },
  {
    id: 'hull-upgrades',
    name: '船体加固理论',
    group: '工程',
    rank: 3,
    description: '以后生效：提升船体结构值与装甲抗性。',
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
]

/** 技能组清单（按此顺序分组展示） */
export const SKILL_GROUPS: readonly string[] = ['舰船', '工业', '战斗', '工程', '贸易']

/** 把技能表建成引擎用的"按 id 快速查找"目录 */
export function buildSkillCatalog(): ReadonlyMap<string, SkillDef> {
  return new Map(SKILLS.map((s) => [s.id, s]))
}
