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
    id: 'industrial-ops',
    name: '工业舰操作',
    group: '舰船',
    rank: 3,
    description: '工业舰族专精驾驶：驾驶工业族舰船时采集产量每级 +⟦4%⟧。',
  },
  {
    id: 'armed-ops',
    name: '武装舰操作',
    group: '舰船',
    rank: 3,
    description: '武装舰族专精驾驶：驾驶武装族舰船时所有武器（含基础舰炮）单发伤害每级 +⟦3%⟧（满级 +⟦15%⟧；与炮术学、武器族专精乘算叠加）。',
  },
  {
    id: 'armored-ops',
    name: '重装舰操作',
    group: '舰船',
    rank: 3,
    description: '重装舰族专精驾驶：驾驶重装族舰船时装甲与结构容量每级 +⟦4%⟧（满级 +⟦20%⟧；与船体加固理论、装甲增厚板乘算叠加，护盾不受影响）。',
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
  {
    id: 'station-engineering',
    name: '建筑工程学',
    group: '工业',
    rank: 3,
    description: '副空间站工程标准：向建站点交付物资的进度计数每级 +⟦8%⟧（等价减少所需物资，满级 −⟦40%⟧）。',
  },

  // ───────── 战斗（2026-09-05 武器族技能批次：三形态专精乘区，乘算于炮术学之上） ─────────
  {
    id: 'gunnery',
    name: '炮术学',
    group: '战斗',
    rank: 1,
    description: '舰载武器基础训练：每级提高实时战斗的单发伤害 ⟦5%⟧（三形态武器与基础舰炮通用，与族专精技能乘算）。',
  },
  {
    id: 'kinetic-gunnery',
    name: '动能炮术',
    group: '战斗',
    rank: 1,
    description: '动能武器（炮台）专精：单发伤害每级 +⟦5%⟧（与炮术学乘算叠加）。',
  },
  {
    id: 'missile-launching',
    name: '导弹发射学',
    group: '战斗',
    rank: 1,
    description: '导弹架专精：爆破导弹单发伤害每级 +⟦5%⟧（与炮术学乘算叠加；追踪命中与近盲安全射距不受影响）。',
  },
  {
    id: 'laser-cannon',
    name: '激光炮学',
    group: '战斗',
    rank: 2,
    description: '激光炮专精：能量光束单发伤害每级 +⟦5%⟧（与炮术学乘算叠加；必中特性不受影响）。',
  },
  {
    id: 'fire-control',
    name: '火控阵列学',
    group: '战斗',
    rank: 2,
    description: '火控解算优化：炮台/导弹架的命中率每级 +⟦3%⟧（相对乘算；激光必中不受影响）。',
  },
  {
    id: 'reload-drills',
    name: '武器装填技术',
    group: '战斗',
    rank: 2,
    description: '装填班组训练：炮台/导弹架/激光炮的装填时间每级 −⟦4%⟧（至少保留 ⟦60%⟧）。',
  },
  {
    id: 'drone-warfare',
    name: '无人机作战学',
    group: '战斗',
    rank: 1,
    description: '无人机作战协同：无人机单发伤害每级 +⟦5%⟧（与战术导控装置乘算；无人机不吃炮术与武器族技能）。',
  },
  {
    id: 'ammunition-condensing',
    name: '弹药集约学',
    group: '战斗',
    rank: 2,
    description: '弹仓整理与备弹规划：出发预载弹药量每级 +⟦8%⟧（满级 +⟦40%⟧；实际装载仍受携带库存上限约束）。',
  },
  {
    id: 'drone-servicing',
    name: '无人机整备学',
    group: '战斗',
    rank: 3,
    description: '甲板整备流程优化：无人机放飞占用的 CPU 每级 −⟦8%⟧（满级 −⟦40%⟧，至少保留 ⟦60%⟧；只放宽放飞成本，船 CPU 装配约束不变）。',
  },

  // ───────── 工程 ─────────
  // 说明：护盾操作学 / 能量管理学 / 船体加固理论原为战斗线预留条目（曾由 HIDDEN_SKILL_IDS 隐藏），
  // 批次三起已全部开放并入战斗数值；批次五追加护盾调谐学 / 装甲调谐学（减伤缺口收窄）。
  {
    id: 'shield-operation',
    name: '护盾操作学',
    group: '工程',
    rank: 1,
    description: '护盾系统维护与回充规划：护盾容量每级 +⟦4%⟧（满级 +⟦20%⟧；与护盾扩展器件乘算）。',
  },
  {
    id: 'shield-tuning',
    name: '护盾调谐学',
    group: '工程',
    rank: 2,
    description: '护盾谐振频率调谐：护盾减伤缺口（未减免部分）每级收窄 ⟦2%⟧（等效全系抗性约 +2 个百分点/级；合计仍封顶 ⟦90%⟧，与抗性改装件乘算叠加）。',
  },
  {
    id: 'energy-management',
    name: '能量管理学',
    group: '工程',
    rank: 2,
    description: '舰船能源供能调谐：激光炮单发威力每级 +⟦3%⟧（满级 +⟦15%⟧；与激光炮学乘算叠加）。',
  },
  {
    id: 'hull-upgrades',
    name: '船体加固理论',
    group: '工程',
    rank: 3,
    description: '船体结构强化工程：装甲与结构容量每级 +⟦4%⟧（满级 +⟦20%⟧；与装甲增厚板乘算）。',
  },
  {
    id: 'armor-tuning',
    name: '装甲调谐学',
    group: '工程',
    rank: 2,
    description: '装甲板晶格微调：装甲减伤缺口（未减免部分）每级收窄 ⟦2%⟧（等效全系抗性约 +2 个百分点/级；合计仍封顶 ⟦90%⟧，与抗性改装件乘算叠加）。',
  },
  {
    id: 'repair-engineering',
    name: '维修工程学',
    group: '工程',
    rank: 2,
    description: '舰船维修工艺：停站维修费每级降低 ⟦10%⟧（与空间站协议学乘算，合计最多 −⟦60%⟧；修理组件不受影响）。',
  },
  {
    id: 'hull-quick-repair',
    name: '舰体快修学',
    group: '工程',
    rank: 2,
    description: '应急修补手法：自动使用修理组件时的恢复量每级 +⟦10%⟧（满级 +⟦50%⟧）。',
  },
  {
    id: 'station-protocol',
    name: '空间站协议学',
    group: '工程',
    rank: 2,
    description: '空间站服务谈判：停站维修费每级再降低 ⟦5%⟧（与维修工程学乘算，合计最多 −⟦60%⟧）。',
  },
  {
    id: 'ai-expert',
    name: '人工智能专家',
    group: '工程',
    rank: 4,
    description: 'AI 指挥技能：每级可同时指挥 ⟦1 艘⟧ AI 副船（配合 AI 核心使用）。',
  },
  {
    id: 'accelerated-learning',
    name: '高效学习法',
    group: '工程',
    rank: 1,
    description: '神经回路训练法：所有技能的训练时长每级 −⟦4%⟧（满级 −⟦20%⟧，至少保留 60%）。',
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
  {
    id: 'marketing',
    name: '营销学',
    group: '贸易',
    rank: 2,
    description: '货物包装与渠道推销：市场卖出结算价每级 +⟦1.2%⟧（满级 +⟦6%⟧，与协会声望加成乘算）。',
  },
  {
    id: 'source-sweeping',
    name: '现货抢购学',
    group: '贸易',
    rank: 3,
    description: '供应链情报网络：市场稀有/限定订单的刷新频率每级 ×⟦1.25⟧（满级约 ×⟦4⟧）。',
  },
  {
    id: 'secondhand-market',
    name: '二手市场学',
    group: '贸易',
    rank: 2,
    description: '收藏品估值与人脉：出售蓝图书的回价每级 +⟦8%⟧（满级 +⟦40%⟧）。',
  },
  {
    id: 'galactic-happenings',
    name: '星际奇遇学',
    group: '贸易',
    rank: 3,
    description: '奇闻轶事的嗅觉：远征途中遭遇随机事件的概率每级 ×⟦1.15⟧（满级约 ×⟦2⟧）。',
  },
  {
    id: 'event-dividend',
    name: '事件分红学',
    group: '贸易',
    rank: 2,
    description: '把每一次巧合都变成收入：随机事件的现金奖励每级 +⟦15%⟧。',
  },

  // ───────── 探索（2026-09-04 新组） ─────────
  {
    id: 'signal-analysis',
    name: '信号分析学',
    group: '探索',
    rank: 2,
    description: '未知信号解读与锁定：就地扫描窗口每级缩短 ⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'cartography',
    name: '星图测绘学',
    group: '探索',
    rank: 2,
    description: '航线标定与跳跃窗优化：前往扫描点的航行耗时每级缩短 ⟦6%⟧。',
  },
  {
    id: 'signal-filtering',
    name: '信号过滤学',
    group: '探索',
    rank: 2,
    description: '干扰抑制与信号提纯：就地扫描窗口每级再缩短 ⟦6%⟧（与信号分析学乘算，总下限 40%）。',
  },
  {
    id: 'salvage-diving',
    name: '漂流物打捞学',
    group: '探索',
    rank: 3,
    description: '残骸打捞与战利品收集：远征缴获的物资数量每级 +⟦12%⟧（主控与 AI 同享）。',
  },
  {
    id: 'seizure-appraisal',
    name: '缴获评估学',
    group: '探索',
    rank: 2,
    description: '战利品估值与销赃渠道：低安遭遇击退/大捷的缴获 ISK 每级 +⟦10%⟧。',
  },
  {
    id: 'lowsec-survival',
    name: '低安生存学',
    group: '探索',
    rank: 3,
    description: '危险星域的保命之道：低安被抢的损失上限每级 −⟦12%⟧（满级 −⟦60%⟧，货与现金同享）。',
  },

  // ───────── 物流（2026-09-04 技能扩军新组；含从舰船组归并的运力技能） ─────────
  {
    id: 'deep-space-logistics',
    name: '深空物流学',
    group: '物流',
    rank: 3,
    description: '深空物流与仓位规划：全舰队货仓容量每级 +⟦4%⟧（满级 +⟦20%⟧；与货舱扩展件/货舱管理学乘算）。',
  },
  {
    id: 'hauler-ops',
    name: '货舰操作',
    group: '物流',
    rank: 3,
    description: '航运舰族专精驾驶：驾驶航运族舰船时货仓容量每级 +⟦5%⟧。',
  },
  {
    id: 'compression',
    name: '压缩技术',
    group: '物流',
    rank: 3,
    description: '矿物压缩封装（EVE 同款概念）：矿石/气体/冰矿的货仓占用体积每级 −⟦6%⟧（满级 −⟦30%⟧）。',
  },
  {
    id: 'hold-management',
    name: '货舱管理学',
    group: '物流',
    rank: 2,
    description: '舱位规划与收纳：全舰队货仓容量每级再 +⟦3%⟧（与深空物流学乘算叠加）。',
  },
]

/** 技能组清单（按此顺序分组展示） */
export const SKILL_GROUPS: readonly string[] = ['舰船', '工业', '战斗', '工程', '贸易', '探索', '物流']

/** 把技能表建成引擎用的"按 id 快速查找"目录 */
export function buildSkillCatalog(): ReadonlyMap<string, SkillDef> {
  return new Map(SKILLS.map((s) => [s.id, s]))
}
