import type { SkillDef } from '@whale/core'

export const ENGINEERING_SKILLS: readonly SkillDef[] = [

  // ───────── 工程 ─────────
  {
    id: 'hull-salvage-engineering',
    name: '舰体打捞工程学',
    group: '工程',
    rank: 4,
    branch: 'b-ship-recovery',
    description: '玩家舰船残骸的整船回收率每级提高 ⟦5⟧ 个百分点，与高级舰体打捞工程学加算。',
  },
  {
    id: 'advanced-hull-salvage-engineering',
    name: '高级舰体打捞工程学',
    group: '工程',
    rank: 5,
    branch: 'b-ship-recovery',
    prereq: ['hull-salvage-engineering'],
    description: '玩家舰船残骸的整船回收率每级再提高 ⟦4⟧ 个百分点，与舰体打捞工程学加算。',
  },
  {
    id: 'wreck-equipment-preservation',
    name: '装备保全工程学',
    group: '工程',
    rank: 5,
    branch: 'b-ship-recovery',
    prereq: ['hull-salvage-engineering'],
    description: '成功回收玩家舰船时，普通装备的保全率每级提高 ⟦4⟧ 个百分点，基础 ⟦80%⟧，满级 ⟦100%⟧；无人机不受影响。',
  },
  // 说明：护盾操作学 / 能量管理学 / 船体加固理论原为战斗线预留条目（曾由 HIDDEN_SKILL_IDS 隐藏），
  // 批次三起已全部开放并入战斗数值；批次五追加护盾调谐学 / 装甲调谐学（减伤缺口收窄）。
  {
    id: 'shield-operation',
    name: '护盾操作学',
    group: '工程',
    rank: 1,
    branch: 'b-protect',
    description: '护盾系统维护与回充规划：护盾容量每级 +⟦4%⟧（满级 +⟦20%⟧；与护盾扩展器件乘算）。',
  },
  {
    id: 'shield-tuning',
    name: '护盾调谐学',
    group: '工程',
    rank: 2,
    branch: 'b-protect',
    description: '护盾谐振调谐：全系抗性每级 +⟦2%⟧（上限 ⟦90%⟧；与护盾增强器同类叠加，多来源收益递减）。',
  },
  {
    id: 'energy-management',
    name: '能量管理学',
    group: '工程',
    rank: 2,
    branch: 'b-protect',
    description: '舰船能源供能调谐：激光炮单发威力每级 +⟦3%⟧（满级 +⟦15%⟧；与激光炮学乘算叠加）。',
  },
  {
    id: 'hull-upgrades',
    name: '船体加固理论',
    group: '工程',
    rank: 3,
    branch: 'b-protect',
    description: '船体结构强化工程：装甲与结构容量每级 +⟦4%⟧（满级 +⟦20%⟧；与装甲增厚板乘算）。容量变厚的同时，修理组件与船体维修装置的修复量按同一比例提高。',
  },
  {
    id: 'armor-tuning',
    name: '装甲调谐学',
    group: '工程',
    rank: 3,
    branch: 'b-protect',
    prereq: ['shield-tuning'],
    description: '装甲板晶格微调：全系抗性每级 +⟦2%⟧（上限 ⟦90%⟧；与装甲镀层同类叠加，多来源收益递减）。',
  },
  {
    id: 'repair-engineering',
    name: '维修工程学',
    group: '工程',
    rank: 3,
    branch: 'b-repair',
    prereq: ['hull-quick-repair'],
    description: '舰船维修工艺：停站维修费每级降低 ⟦10%⟧（与空间站维修协议乘算叠加）；并让修理组件恢复量每级 +⟦5%⟧（与舰体快修学同效果、按级相加；船体维修装置每跳同样计入）。',
  },
  {
    id: 'hull-quick-repair',
    name: '舰体快修学',
    group: '工程',
    rank: 2,
    branch: 'b-repair',
    description: '应急修补手法：使用修理组件时的恢复量每级 +⟦5%⟧（满级 +⟦25%⟧）——船体维修装置战斗中每跳同样计入。',
  },
  {
    id: 'station-protocol',
    // 2026-09-22 船长（Excel 工作台回稿）：「空间站协议学」⇒ **空间站维修协议**，且 **rank 1 → 4**；
    //   rank 一动，它与「维修工程学」（rank 3）的上下级方向就反了 ⇒ 前置改为挂在维修工程学之下
    //   （两者仍是同一乘区：停站维修费，双方说明里互相点名 ⇒ 符合船长「同类效果做上下级」的口径）
    name: '空间站维修协议',
    group: '工程',
    rank: 4,
    branch: 'b-repair',
    prereq: ['repair-engineering'],
    description: '空间站服务谈判：停站维修费每级降低 ⟦5%⟧（与维修工程学乘算叠加）。',
  },
  {
    id: 'ai-expert',
    name: 'AI 核心操作学', // 2026-09-08 船长定：原名"人工智能专家"（rank4）；降为 rank2 入门 + 更名，与 rank5「AI 核心调度学」成阶梯
    group: '工程',
    rank: 2,
    branch: 'b-ai',
    description: 'AI 核心的接入与指挥框架：每级 +⟦1⟧ 枚可同时启用的 AI 核心上限（AI 副船任务与站内精炼炉/回收炉/制造线共用该上限）。',
  },
  {
    id: 'ai-core-dispatch',
    name: 'AI 核心调度学',
    group: '工程',
    rank: 5,
    branch: 'b-ai',
    prereq: ['ai-expert'],
    description: '多核心的负载调度与协同优化：AI 核心驱动的全部作业（AI 副船任务与站内精炼炉/回收炉/制造线）效率每级 +⟦2 个百分点⟧（在核心档位之上累加，如基础核心 40% → 满级 ⟦50%⟧）。',
  },
  {
    id: 'accelerated-learning',
    name: '高效学习法',
    group: '工程',
    rank: 4,
    branch: 'b-learn',
    description: '神经回路训练法：所有技能的训练时长每级 −⟦4%⟧（满级 −⟦20%⟧）。',
  },
  {
    id: 'ship-systems-engineering',
    name: '舰船系统工程',
    group: '工程',
    rank: 2,
    branch: 'b-shipfit',
    description: '舰船电力与环路布局优化：船体 CPU 每级 +⟦5%⟧（满级 +⟦25%⟧；只提高装配与无人机放飞的总预算，不改单件装备的 CPU 占用）。',
  },
  {
    id: 'unattended-dispatch',
    name: '无人值守调度学',
    group: '工程',
    rank: 4,
    branch: 'b-ai',
    prereq: ['offline-ops'],
    // 2026-09-20 船长定：「新增离线作业管理学的上位技能：效果为离线结算时长每级 +40%.技能rank4」
    // 与「离线作业管理学」并存叠加（加算）：双满级 = 8h × (1+1.0+2.0) = 32 小时。
    description: '无人值守的作业统筹：离线结算时长每级 +⟦40%⟧（基础 8 小时，满级 24 小时；与「离线作业管理学」叠加计算）。',
  },
]
