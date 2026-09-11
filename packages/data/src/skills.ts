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
    rank: 2,
    description: '更快的航线规划与亚光速机动。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'warp-drive-operation',
    name: '跃迁引擎操控',
    group: '舰船',
    rank: 4,
    description: '跃迁引擎的调校与维护。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'acceleration-control',
    name: '加速控制理论',
    group: '舰船',
    rank: 3,
    description: '跃迁起止阶段的加速与减速控制。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'mining-frigate',
    name: '采矿护卫舰操作',
    group: '舰船',
    rank: 2,
    description: '专用矿船的驾驶与自动化开采调校：每级缩短采集循环时间 ⟦3%⟧。',
  },
  {
    id: 'industrial-ops',
    name: '采矿舰操作', // 2026-09-09 船长定：与 UI 徽标「采矿」一致（原"工业舰操作"）；id 不变
    group: '舰船',
    rank: 3,
    description: '采矿舰族专精驾驶：驾驶采矿舰族舰船时采集产量每级 +⟦4%⟧。',
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
  {
    id: 'vector-maneuvering',
    name: '矢量机动操作',
    group: '舰船',
    rank: 2,
    description: '矢量喷口操控：战斗机动速度每级 +⟦5%⟧（满级 +⟦25%⟧；与推进器点火加成乘算，星图航行加速不受影响）。',
  },
  {
    id: 'evasion-maneuvering',
    name: '规避机动学',
    group: '舰船',
    rank: 2,
    description: '规避机动训练：舰船被敌方命中的概率每级降低 ⟦5%⟧（满级约降至无技能时的 75%；与姿态陀螺的回避加成相互乘算）。',
  },
  {
    id: 'targeting-integration',
    name: '索敌统合',
    group: '舰船',
    rank: 2,
    description: '火控统合训练：舰船命中加成每级 +⟦5%⟧（满级 +⟦25%⟧；作用于打敌命中加成，与武器级「火控阵列学」独立）。',
  },

  // ───────── 工业 ─────────
  {
    id: 'mining',
    name: '采矿技术',
    group: '工业',
    rank: 3,
    description: '矿藏采集的核心技术：矿石、气体与冰矿的采集循环产量每级 +⟦6%⟧（与星质地质学、深空采集学乘算叠加）。',
  },
  {
    id: 'deep-space-harvesting',
    name: '深空采集学',
    group: '工业',
    rank: 4,
    description: '稀有资源采集：气体与冰矿的采集循环产量每级 +⟦5%⟧（普通矿石不受影响）。',
  },
  {
    id: 'refining',
    name: '精炼学',
    group: '工业',
    rank: 3,
    // 2026-09-08 工业工位收益体检再定：基础 100%→120%（无技能净率 ≈+20%）；技能加成下调约 20%：8%→6%
    description: '精炼炉产出倍率：每级提高 ⟦6%⟧（基础 ⟦120%⟧，无技能时炼矿净收益约两成；与高级回收处理双修满级合计 ⟦165%⟧）。',
  },
  {
    id: 'reprocessing',
    name: '高级回收处理',
    group: '工业',
    rank: 4,
    // 2026-09-08：4%→3%
    description: '进一步提高精炼产出倍率：每级 +⟦3%⟧（与精炼学双修满级合计 ⟦165%⟧）。',
  },
  {
    id: 'industry',
    name: '工业理论',
    group: '工业',
    rank: 4,
    // 2026-09-08 技能加成下调约 20%：−5% → −4%
    description: '制造业核心理论：每级缩短蓝图制造时间 ⟦4%⟧（与批量生产学乘算叠加）。',
  },
  {
    id: 'materials',
    name: '材料学',
    group: '工业',
    rank: 4,
    // 2026-09-08 技能加成下调约 20%：−2% → −1.5%
    description: '制造工艺精进：每级减少蓝图制造的材料消耗 ⟦1.5%⟧（满级 −⟦7.5%⟧；与组件标准化乘算叠加）。',
  },
  {
    id: 'industrial-automation',
    name: '产线节拍学', // 2026-09-08 船长定：原名"工业自动化"让位给新的工业 AI 工位扩容技能，本技能按真实效果改名
    group: '工业',
    rank: 3,
    description: '产线节拍优化：精炼炉与组装机的作业周期每级缩短 ⟦5%⟧（满级 −⟦25%⟧；手动与 AI 核心驱动同享，与炉心熔炼学/批量生产学乘算叠加）。',
  },
  {
    // 2026-09-11 船长定：rank3 下级技能（工业自动化的基础课程）——满级 +5 站内工位
    id: 'industrial-ai-cap-basic',
    name: '工业自动化基础',
    group: '工业',
    rank: 3,
    description: '自动化产线入门（工业自动化的基础课程）：AI 核心驱动的站内精炼炉/回收炉/制造线，在 AI 核心共用上限之外每级 +⟦1⟧ 枚工业专用工位（满级 +⟦5⟧；仅对站内产业生效，不增加 AI 副船任务上限；与「工业自动化」叠加）。',
  },
  {
    id: 'industrial-ai-cap',
    name: '工业自动化', // 2026-09-08 船长定：新 rank4——为站内产业扩容 AI 工位（每级 +2，仅产业生效）
    group: '工业',
    rank: 4,
    description: '自动化产线扩容：AI 核心驱动的站内精炼炉/回收炉/制造线，在 AI 核心共用上限之外每级 +⟦2⟧ 枚工业专用工位（满级 +⟦10⟧；仅对站内产业生效，不增加 AI 副船任务上限；每个工位仍占用一枚实体 AI 核心）。',
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
    description: '脉矿判定与富集带追踪：采掘时发现富矿脉的机会每级 ×⟦1.2⟧（基础每分钟 ⟦3%⟧；发现后连续 2 个循环产量 ×⟦3⟧）。',
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
    rank: 2,
    // 2026-09-08 技能加成下调约 20%：−4% → −3%
    description: '多工位装配线排程：蓝图制造时间每级再 −⟦3%⟧（与工业理论乘算叠加）。',
  },
  {
    id: 'component-standardization',
    name: '组件标准化',
    group: '工业',
    rank: 2,
    // 2026-09-08 技能加成下调约 20%：−1% → −0.8%
    description: '通用组件规格化：蓝图制造材料消耗每级再 −⟦0.8%⟧（与材料学乘算叠加）。',
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
    description: '无人值守作业调度：离线结算时长每级 +⟦20%⟧（基础 8 小时，满级 16 小时）。',
  },
  {
    id: 'station-engineering',
    name: '建筑工程学',
    group: '工业',
    rank: 3,
    description: '副空间站工程标准：建站所需建材每级 −⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'salvage-recycling',
    name: '残骸回收学',
    group: '工业',
    rank: 3,
    description: '残骸回收（精炼炉拆解残骸）的批周期优化：批周期每级 −⟦4%⟧（手动与 AI 核心驱动同享）。',
  },
  {
    id: 'salvage-rigging',
    name: '打捞装置整备学',
    group: '工业',
    rank: 3,
    description: '打捞器的维护与调校：打捞器单轮周期每级缩短 ⟦3%⟧（主控与 AI 同享）。',
  },
  {
    id: 'wreck-assaying',
    name: '残骸富集识别学',
    group: '工业',
    rank: 3,
    description: '残骸价值判定：打捞中发现「完好舰体」的机会每级 ×⟦1.2⟧——完好舰体不再折算体积，而是当场缴获一件该编队回收池的完整装备（低安空域有机会缴获更高档成装）。',
  },
  {
    id: 'salvage-refining',
    name: '残骸提纯学',
    group: '工业',
    rank: 2,
    description: '回收提纯工艺：残骸回收的保底矿物产出每级 +⟦8%⟧（满级共 +40%）。',
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
    rank: 3,
    description: '火控解算优化：炮台/导弹架的命中率每级 +⟦3%⟧（相对乘算；激光必中不受影响）。',
  },
  {
    id: 'reload-drills',
    name: '武器装填技术',
    group: '战斗',
    rank: 4,
    description: '装填班组训练：炮台/导弹架/激光炮的装填时间每级 −⟦4%⟧。',
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
    description: '弹仓整理与备弹规划：出发预载弹药量每级 +⟦8%⟧（满级 +⟦40%⟧）。',
  },
  {
    id: 'drone-servicing',
    name: '无人机整备学',
    group: '战斗',
    rank: 3,
    description: '甲板整备与再出击优化：无人机的装填时间每级 −⟦4%⟧（武器装填技术只作用于炮台/导弹架/激光炮，两者独立乘算）。',
  },
  /* ───────── 无人机线扩展（2026-09-10 船长拍板：配合"近防炮可 100% 损坏机群 + 战后回收"） ─────────
   * 五条新技能覆盖"打得更痛 / 更耐打（两档）/ 更难被点中 / 战后捡得回来"；数值接线在 core/combat.ts */
  {
    id: 'drone-strike',
    name: '无人机打击学',
    group: '战斗',
    rank: 4,
    description: '机群战术打击课程：无人机单发伤害每级再 +⟦4%⟧（与无人机作战学、战术导控装置乘算叠加）。',
  },
  {
    id: 'drone-durability',
    name: '无人机耐久学',
    group: '战斗',
    rank: 2,
    description: '机体加固与冗余线路（基础档）：无人机三层血量（护盾 / 装甲 / 结构）每级 +⟦4%⟧（满级 +⟦20%⟧，直接放大全血条）。',
  },
  {
    id: 'drone-reinforce',
    name: '无人机强化学',
    group: '战斗',
    rank: 4,
    description: '高强度机体与冗余结构（进阶档）：无人机三层血量每级再 +⟦6%⟧（满级再 +⟦30%⟧，与耐久学乘算叠加）。',
  },
  {
    id: 'drone-recovery',
    name: '无人机回收学',
    group: '战斗',
    rank: 3,
    description: '残骸打捞与机体翻修：战斗结束后损坏无人机的回收比例每级 +⟦6%⟧（基础 ⟦20%⟧ → 满级 ⟦50%⟧；回收的机体回舱继续服役）。',
  },
  {
    id: 'drone-evasion',
    name: '无人机规避学',
    group: '战斗',
    rank: 4,
    description: '机群规避机动训练：无人机闪避每级 +⟦2%⟧（满级 +⟦10%⟧，相对乘算、闪避上限 ⟦90%⟧；对近防炮尤其有效）。',
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
    description: '护盾谐振调谐：全系抗性每级 +⟦2%⟧（乘入制，上限 ⟦90%⟧；与护盾增强器同类叠加，多来源收益递减）。',
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
    rank: 3,
    description: '装甲板晶格微调：全系抗性每级 +⟦2%⟧（乘入制，上限 ⟦90%⟧；与装甲镀层同类叠加，多来源收益递减）。',
  },
  {
    id: 'repair-engineering',
    name: '维修工程学',
    group: '工程',
    rank: 2,
    description: '舰船维修工艺：停站维修费每级降低 ⟦10%⟧（与空间站协议学乘算叠加；修理组件不受影响）。',
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
    rank: 1,
    description: '空间站服务谈判：停站维修费每级降低 ⟦5%⟧（与维修工程学乘算叠加）。',
  },
  {
    id: 'ai-expert',
    name: 'AI 核心操作学', // 2026-09-08 船长定：原名"人工智能专家"（rank4）；降为 rank2 入门 + 更名，与 rank5「AI 核心调度学」成阶梯
    group: '工程',
    rank: 2,
    description: 'AI 核心的接入与指挥框架：每级 +⟦1⟧ 枚可同时启用的 AI 核心上限（AI 副船任务与站内精炼炉/回收炉/制造线共用该上限）。',
  },
  {
    id: 'ai-core-dispatch',
    name: 'AI 核心调度学',
    group: '工程',
    rank: 5,
    description: '多核心的负载调度与协同优化：AI 核心驱动的全部作业（AI 副船任务与站内精炼炉/回收炉/制造线）效率每级 +⟦2 个百分点⟧（在核心档位之上累加，如基础核心 40% → 满级 ⟦50%⟧）。',
  },
  {
    id: 'accelerated-learning',
    name: '高效学习法',
    group: '工程',
    rank: 4,
    description: '神经回路训练法：所有技能的训练时长每级 −⟦4%⟧（满级 −⟦20%⟧）。',
  },
  {
    id: 'ship-systems-engineering',
    name: '舰船系统工程',
    group: '工程',
    rank: 2,
    description: '舰船电力与环路布局优化：船体 CPU 每级 +⟦5%⟧（满级 +⟦25%⟧；只提高装配与无人机放飞的总预算，不改单件装备的 CPU 占用）。',
  },

  // ───────── 贸易（V9+：市场税率减免） ─────────
  {
    id: 'accounting',
    name: '会计学',
    group: '贸易',
    rank: 3,
    description: '贸易税减免：卖出成交的贸易税每级降低 ⟦8%⟧（与贸易谈判学乘算叠加）。',
  },
  {
    id: 'trade-negotiation',
    name: '贸易谈判学',
    group: '贸易',
    rank: 4,
    description: '协会渠道谈判：贸易税每级再降低 ⟦8%⟧（与会计学乘算叠加）。',
  },
  {
    id: 'bounty-hunting',
    name: '赏金猎手学',
    group: '贸易',
    rank: 4,
    description: '赏金评估与协会渠道：完成悬赏的奖金每级 +⟦8%⟧（满级 +⟦40%⟧，在随机浮动之上乘算）。',
  },
  {
    id: 'marketing',
    name: '营销学',
    group: '贸易',
    rank: 4,
    description: '货物包装与渠道推销：市场卖出结算价每级 +⟦1.2%⟧（满级 +⟦6%⟧，与协会声望加成乘算）。',
  },
  {
    id: 'source-sweeping',
    name: '现货抢购学',
    group: '贸易',
    rank: 4,
    description: '供应链情报网络：市场稀有/限定订单的刷新频率每级 ×⟦1.1⟧（满级约 ×⟦1.5⟧）。',
  },
  {
    id: 'secondhand-market',
    name: '二手市场学',
    group: '贸易',
    rank: 2,
    description: '旧货市场渠道：市场稀有商品的供给单价格每级 −⟦2%⟧（满级 −⟦10%⟧）。',
  },
  {
    id: 'galactic-happenings',
    name: '星际奇遇学',
    group: '贸易',
    rank: 3,
    description: '奇闻轶事的嗅觉：在线随机事件的来访间隔每级 −⟦8%⟧（满级间隔约为原来的六成）；出击出发时遭遇随机事件的机会每级 ×⟦1.15⟧。',
  },
  {
    id: 'event-dividend',
    name: '事件分红学',
    group: '贸易',
    rank: 2,
    description: '把每一次巧合都变成收入：随机事件的现金奖励每级 +⟦15%⟧（事件赏钱本身不多，纯属娱乐向的小彩头，不必指望发家）。',
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
    description: '航线标定与跳跃窗优化：就地扫描窗口每级缩短 ⟦6%⟧（满级 −⟦30%⟧；与信号分析学、信号过滤学乘算叠加）。',
  },
  {
    id: 'signal-filtering',
    name: '信号过滤学',
    group: '探索',
    rank: 3,
    description: '干扰抑制与信号提纯：就地扫描窗口每级再缩短 ⟦6%⟧（与信号分析学乘算叠加）。',
  },
  {
    id: 'salvage-diving',
    name: '漂流物打捞学',
    group: '探索',
    rank: 3,
    description: '残骸打捞与战利品收集：远征缴获的物资数量与残骸打捞量每级 +⟦12%⟧（主控与 AI 同享）。',
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
    rank: 2,
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
    rank: 1,
    description: '舱位规划与收纳：全舰队货仓容量每级再 +⟦3%⟧（与深空物流学乘算叠加）。',
  },
]

/** 技能组清单（按此顺序分组展示） */
export const SKILL_GROUPS: readonly string[] = ['舰船', '工业', '战斗', '工程', '贸易', '探索', '物流']

/** 把技能表建成引擎用的"按 id 快速查找"目录 */
export function buildSkillCatalog(): ReadonlyMap<string, SkillDef> {
  return new Map(SKILLS.map((s) => [s.id, s]))
}
