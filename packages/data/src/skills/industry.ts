import type { SkillDef } from '@whale/core'

export const INDUSTRY_SKILLS: readonly SkillDef[] = [

  // ───────── 工业 ─────────
  {
    id: 'probe-assembly',
    name: '探测机装配工程学',
    group: '工业',
    rank: 3,
    branch: 'b-probe-assembly',
    description: '深空探测机材料需求每级降低 ⟦4%⟧；与材料学、组件标准化乘算叠加。',
  },
  {
    id: 'mining',
    name: '采矿技术',
    group: '矿业',
    rank: 3,
    branch: 'b-mine',
    prereq: ['astro-geology'],
    description: '矿藏采集的核心技术：原矿、气体与冰矿的采集循环产量每级 +⟦6%⟧（与星质地质学、深空采集学乘算叠加）。',
  },
  {
    id: 'deep-space-harvesting',
    name: '深空采集学',
    group: '矿业',
    rank: 4,
    branch: 'b-mine',
    prereq: ['mining'],
    description: '稀有资源采集：气体与冰矿的采集循环产量每级 +⟦5%⟧（普通原矿不受影响）。',
  },
  {
    id: 'refining',
    name: '精炼学',
    group: '工业',
    rank: 3,
    branch: 'b-refine',
    // 2026-09-08 工业工位收益体检再定：基础 100%→120%（无技能净率 ≈+20%）；技能加成下调约 20%：8%→6%
    description: '精炼炉产出倍率：每级提高 ⟦6%⟧（基础 ⟦120%⟧，无技能时炼矿净收益约两成；与高级回收处理双修满级合计 ⟦165%⟧）。',
  },
  {
    id: 'reprocessing',
    name: '高级回收处理',
    group: '工业',
    rank: 4,
    branch: 'b-refine',
    prereq: ['refining'],
    // 2026-09-08：4%→3%
    description: '进一步提高精炼产出倍率：每级 +⟦3%⟧（与精炼学双修满级合计 ⟦165%⟧）。',
  },
  {
    id: 'smelting-mastery',
    name: '熔炉精通学',
    group: '工业',
    rank: 5,
    branch: 'b-refine',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「reprocessing」的上位补充，门槛只要父技能 Lv1
    prereq: ['reprocessing'],
    description: '精炼炉产出倍率进一步提高：每级 +⟦1%⟧（满级再 +⟦5%⟧；与高级回收处理相加计入产出倍率）。',
  },
  {
    id: 'industry',
    name: '工业理论',
    group: '工业',
    rank: 4,
    branch: 'b-craft',
    prereq: ['batch-production'],
    // 2026-09-08 技能加成下调约 20%：−5% → −4%
    description: '制造业核心理论：每级缩短蓝图制造时间 ⟦4%⟧（与批量生产学乘算叠加）。',
  },
  {
    id: 'industry-integration',
    name: '流水线统合学',
    group: '工业',
    rank: 5,
    branch: 'b-craft',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「industry」的上位补充，门槛只要父技能 Lv1
    prereq: ['industry'],
    description: '多线装配统合排程：蓝图制造时间每级再 −⟦1.5%⟧（满级再 −⟦7.5%⟧；与工业理论乘算叠加）。',
  },
  {
    id: 'materials',
    name: '材料学',
    group: '工业',
    rank: 4,
    branch: 'b-craft',
    prereq: ['component-standardization'],
    // 2026-09-08 技能加成下调约 20%：−2% → −1.5%
    description: '制造工艺精进：每级减少蓝图制造的材料消耗 ⟦1.5%⟧（满级 −⟦7.5%⟧；与组件标准化乘算叠加）。',
  },
  {
    id: 'industrial-automation',
    name: '产线节拍学', // 2026-09-08 船长定：原名"工业自动化"让位给新的工业 AI 工位扩容技能，本技能按真实效果改名
    group: '工业',
    rank: 3,
    branch: 'b-auto',
    description: '产线节拍优化：精炼炉、组装机与实验室的作业周期每级缩短 ⟦5%⟧（满级 −⟦25%⟧；手动与 AI 核心驱动同享，与炉心熔炼学/批量生产学乘算叠加）。',
  },
  {
    // 2026-09-11 船长定：rank3 下级技能（工业自动化的基础课程）——满级 +5 站内工位
    id: 'industrial-ai-cap-basic',
    name: '工业自动化基础',
    group: '工业',
    rank: 3,
    branch: 'b-auto',
    // ⟪文案调整 2026-09-30⟫ 文案审核批 E11（船长批「按你推荐来」）：删掉非规格括号「（工业自动化的基础课程）」
    //   ——说明只写规格、括号只放规格；技能之间的上下级关系在技能树上一眼可见，不必写在说明里。
    description: '自动化产线入门：AI 核心驱动的站内精炼炉/回收炉/制造线，在 AI 核心共用上限之外每级 +⟦1⟧ 枚工业专用工位（满级 +⟦5⟧；仅对站内产业生效，不增加 AI 副船任务上限；与「工业自动化」叠加）。',
  },
  {
    id: 'industrial-ai-cap',
    name: '工业自动化', // 2026-09-08 船长定：新 rank4——为站内产业扩容 AI 工位（每级 +2，仅产业生效）
    group: '工业',
    rank: 4,
    branch: 'b-auto',
    prereq: ['industrial-ai-cap-basic'],
    description: '自动化产线扩容：AI 核心驱动的站内精炼炉/回收炉/制造线，在 AI 核心共用上限之外每级 +⟦2⟧ 枚工业专用工位（满级 +⟦10⟧；仅对站内产业生效，不增加 AI 副船任务上限；每个工位仍占用一枚实体 AI 核心）。',
  },
  {
    // 2026-09-29 船长令：新增 R5，工业自动化的后续——工业专用工位再 +2/级
    id: 'industrial-ai-cap-integration',
    name: '工业自动化统合',
    group: '工业',
    rank: 5,
    branch: 'b-auto',
    prereq: ['industrial-ai-cap'],
    description: '自动化产线统合：AI 核心驱动的站内精炼炉/回收炉/制造线，在 AI 核心共用上限之外每级再 +⟦2⟧ 枚工业专用工位（满级再 +⟦10⟧；仅对站内产业生效，不增加 AI 副船任务上限；每个工位仍占用一枚实体 AI 核心）。',
  },
  {
    id: 'astro-geology',
    name: '星质地质学',
    group: '矿业',
    rank: 2,
    branch: 'b-mine',
    description: '岩层构成的进阶研究：全矿采集产量每级再 +⟦4%⟧（与采矿技术乘算叠加）。',
  },
  {
    id: 'deep-hole-blasting',
    name: '深井爆破学',
    group: '矿业',
    rank: 3,
    branch: 'b-mine',
    prereq: ['mining'],
    description: '浅层矿带的爆破开采优化：低品位原矿（橄榄岩/辉长岩/赤环岩）产量每级 +⟦6%⟧。',
  },
  {
    id: 'rich-vein-prospecting',
    name: '富矿勘探学',
    group: '矿业',
    rank: 2,
    branch: 'b-mine',
    prereq: ['astro-geology'],
    description: '脉矿判定与富集带追踪：采掘时发现富矿脉的机会每级 ×⟦1.2⟧（基础每分钟 ⟦3%⟧；发现后连续 2 个循环产量 ×⟦3⟧）。',
  },
  {
    id: 'core-smelting',
    name: '炉心熔炼学',
    group: '工业',
    rank: 2,
    branch: 'b-refine',
    // 2026-09-29 船长令：「炉心熔炼学为什么还会有下限？移除」——引擎里那个 0.6 下限已删（乘算本身有界）
    description: '精炼炉温控与搅拌工艺：精炼炉单批周期每级缩短 ⟦4%⟧（手动与 AI 核心驱动同享）。',
  },
  {
    // 2026-09-29 船长令：新增 R3「−4%/级」，插在炉心熔炼学与炉温精调学之间
    id: 'furnace-pressure',
    name: '炉压调控学',
    group: '工业',
    rank: 3,
    branch: 'b-refine',
    prereq: ['core-smelting'],
    description: '精炼炉压力调控：精炼炉单批周期每级再缩短 ⟦4%⟧（满级再 −⟦20%⟧；手动与 AI 核心驱动同享，与炉心熔炼学、炉温精调学、产线节拍学乘算叠加）。',
  },
  {
    id: 'furnace-expansion',
    name: '炉膛扩容学',
    group: '工业',
    rank: 2,
    branch: 'b-refine',
    prereq: ['core-smelting'],
    description: '精炼炉膛容积改造：精炼单批处理量每级 +⟦6%⟧（手动与 AI 核心驱动同享）。',
  },
  {
    id: 'furnace-amplification',
    name: '炉膛倍增学',
    group: '工业',
    rank: 4,
    branch: 'b-refine',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「furnace-expansion」的上位补充，门槛只要父技能 Lv1
    // 2026-09-29 船长令：「炉膛倍增学效果上调到 4%/级」（原 2%/级）
    prereq: ['furnace-expansion'],
    description: '精炼炉膛容积进一步改造：精炼单批处理量每级再 +⟦4%⟧（满级再 +⟦20%⟧；与炉膛扩容学乘算叠加）。',
  },
  {
    // 2026-09-29 船长令：新增 R5，炉膛倍增学的后续——批容再 +2%/级
    id: 'furnace-reconfiguration',
    name: '炉膛重构学',
    group: '工业',
    rank: 5,
    branch: 'b-refine',
    prereq: ['furnace-amplification'],
    description: '精炼炉膛结构重构：精炼单批处理量每级再 +⟦2%⟧（满级再 +⟦10%⟧；与炉膛扩容学、炉膛倍增学乘算叠加）。',
  },
  {
    id: 'furnace-precision',
    name: '炉温精调学',
    group: '工业',
    rank: 4,
    branch: 'b-refine',
    // 2026-09-22 船长令（精炼系 T4）：「添加一个精炼系T4的精炼炉周期缩短技能，每级4%」——
    // 与炉心熔炼学同乘区（都是精炼炉周期），故挂它为前置。
    // ⚠ 2026-09-29 船长令：「炉温精调学效果下调到 −3%/级」（原 −4%/级）；
    //   同时把前置改挂**新插入的 R3「炉压调控学」**（船长要求它插在炉心熔炼学与炉温精调学之间）。
    prereq: ['furnace-pressure'],
    description: '炉温精调与热工控制：精炼炉单批周期每级再缩短 ⟦3%⟧（满级 −⟦15%⟧；手动与 AI 核心驱动同享，与炉心熔炼学、炉压调控学、产线节拍学乘算叠加）。',
  },
  {
    id: 'furnace-thermal-control',
    name: '恒温炉控学',
    group: '工业',
    rank: 5,
    branch: 'b-refine',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「furnace-precision」的上位补充，门槛只要父技能 Lv1
    prereq: ['furnace-precision'],
    description: '精炼炉恒温控制：精炼炉单批周期每级再缩短 ⟦1.5%⟧（满级再 −⟦7.5%⟧；与炉温精调学乘算叠加）。',
  },
  {
    id: 'batch-production',
    name: '批量生产学',
    group: '工业',
    rank: 2,
    branch: 'b-craft',
    // 2026-09-08 技能加成下调约 20%：−4% → −3%
    description: '多工位装配线排程：蓝图制造时间每级再 −⟦3%⟧（与工业理论乘算叠加）。',
  },
  {
    id: 'parts-line',
    name: '零件流水线',
    group: '工业',
    rank: 5,
    branch: 'b-craft',
    // 2026-09-22 船长令（制造系 T5）：「添加一个制造系T5技能，缩短所有零件生产周期每级4%」——
    // 与批量生产学同乘区（都是蓝图制造周期），故挂它为前置。
    prereq: ['batch-production'],
    description: '零件专线排程：零件类蓝图的生产周期每级再缩短 ⟦4%⟧（满级 −⟦20%⟧；与工业理论、批量生产学乘算叠加，其余蓝图不受影响）。',
  },
  {
    id: 'component-standardization',
    name: '组件标准化',
    group: '工业',
    rank: 2,
    branch: 'b-craft',
    // 2026-09-08 技能加成下调约 20%：−1% → −0.8%
    description: '通用组件规格化：蓝图制造材料消耗每级再 −⟦0.8%⟧（与材料学乘算叠加）。',
  },
  {
    id: 'ai-servicing',
    name: '副船整备学',
    group: '工业',
    rank: 3,
    branch: 'b-auto',
    description: 'AI 副船的采集设备整备：副船采矿循环周期每级缩短 ⟦3%⟧（在 AI 核心效率之上乘算）。',
  },
  {
    id: 'ai-servicing-integration',
    name: '副船统合整备学',
    group: '工业',
    rank: 4,
    branch: 'b-auto',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「ai-servicing」的上位补充，门槛只要父技能 Lv1
    prereq: ['ai-servicing'],
    description: 'AI 副船采集设备统合整备：副船采矿循环周期每级再缩短 ⟦1%⟧（满级再 −⟦5%⟧；与副船整备学乘算叠加）。',
  },
  {
    id: 'offline-ops',
    name: '离线作业管理学',
    group: '工程',
    rank: 3,
    branch: 'b-ai',
    description: '无人值守作业调度：离线结算时长每级 +⟦20%⟧（基础 8 小时，满级 16 小时）。',
  },
  {
    id: 'station-engineering',
    name: '建筑工程学',
    group: '工业',
    rank: 3,
    branch: 'b-build',
    description: '副空间站工程标准：建站所需建材每级 −⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'salvage-recycling',
    name: '残骸回收学',
    group: '工业',
    rank: 3,
    branch: 'b-salvage',
    description: '残骸回收（精炼炉拆解残骸）的批周期优化：批周期每级 −⟦4%⟧（手动与 AI 核心驱动同享）。',
  },
  {
    id: 'salvage-recycling-integration',
    name: '残骸流水线学',
    group: '工业',
    rank: 5,
    branch: 'b-salvage',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「salvage-recycling」的上位补充，门槛只要父技能 Lv1
    prereq: ['salvage-recycling'],
    description: '残骸回收线统合：回收批周期每级再 −⟦1.5%⟧（满级再 −⟦7.5%⟧；与残骸回收学乘算叠加）。',
  },
  {
    id: 'salvage-rigging',
    name: '打捞装置整备学',
    group: '工业',
    rank: 3,
    branch: 'b-salvage',
    description: '打捞器的维护与调校：打捞器单轮周期每级缩短 ⟦3%⟧（主控与 AI 同享）。',
  },
  {
    id: 'salvager-overclock',
    name: '打捞器超频学',
    group: '工业',
    rank: 4,
    branch: 'b-salvage',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「salvage-rigging」的上位补充，门槛只要父技能 Lv1
    prereq: ['salvage-rigging'],
    description: '打捞器超频运转：打捞器单轮周期每级再缩短 ⟦1%⟧（满级再 −⟦5%⟧；与打捞装置整备学乘算叠加）。',
  },
  {
    id: 'wreck-assaying',
    name: '残骸富集识别学',
    group: '工业',
    rank: 3,
    branch: 'b-salvage',
    description: '残骸价值判定：打捞中发现「完好舰体」的机会每级 ×⟦1.2⟧——完好舰体不再折算体积，而是当场缴获一件该编队回收池的完整装备（低安空域有机会缴获更高档成装）。',
  },
  {
    id: 'salvage-refining',
    name: '残骸提纯学',
    group: '工业',
    rank: 2,
    branch: 'b-salvage',
    description: '回收提纯工艺：残骸回收的保底原材料产出每级 +⟦8%⟧（满级共 +40%）。',
  },
  {
    id: 'wreck-refining',
    name: '残骸精炼学',
    group: '工业',
    rank: 4,
    branch: 'b-salvage',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「salvage-refining」的上位补充，门槛只要父技能 Lv1
    prereq: ['salvage-refining'],
    description: '残骸回收的再提纯：残骸回收保底原材料产出每级再 +⟦2.5%⟧（满级再 +⟦12.5%⟧；与残骸提纯学乘算叠加）。',
  },
  {
    id: 'part-forming',
    name: '零件成型工艺学',
    group: '工业',
    rank: 3,
    branch: 'b-craft',
    // 2026-09-20 船长定：基础零件制造时间每级 −8%（满级 −40%）
    description: '基础零件（电路基板、装甲板、结构框架等）的成型排程：基础零件制造时间每级 −⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'part-forming-integration',
    name: '零件成型统合学',
    group: '工业',
    rank: 4,
    branch: 'b-craft',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「part-forming」的上位补充，门槛只要父技能 Lv1
    prereq: ['part-forming'],
    description: '零件成型排程统合：基础零件制造时间每级再 −⟦2.5%⟧（满级再 −⟦12.5%⟧；与零件成型工艺学乘算叠加）。',
  },
  {
    id: 'precision-assembly',
    name: '精密装配学',
    group: '工业',
    rank: 4,
    branch: 'b-craft',
    prereq: ['part-forming'],
    // 2026-09-20 船长定：高级零件制造时间每级 −8%（满级 −40%）
    description: '高级零件（无人机神经原件、护盾发生装置等）的精密装配：高级零件制造时间每级 −⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'precision-assembly-integration',
    name: '精密装配统合学',
    group: '工业',
    rank: 5,
    branch: 'b-craft',
    // 2026-09-27 船长令（R4/R5 上位技能批）：父技能「precision-assembly」的上位补充，门槛只要父技能 Lv1
    prereq: ['precision-assembly'],
    description: '高级零件精密装配统合：高级零件制造时间每级再 −⟦2.5%⟧（满级再 −⟦12.5%⟧；与精密装配学乘算叠加）。',
  },

  /* ═══ 实验室（**2026-09-30 船长令**：燃料上限 / 节拍 / 收率四条；技能书 b-lab）═══
   * 船长原话：「打算添加2个增加燃料上限的技能，并添加1个燃料生产速度和1个燃料产量的技能」＋
   * 「名字有些过于相似了。参考EVE让不同技能直接名称差异更大一些」＋「速度和产量的技能放到RANK4」
   * ＋「燃料合成节拍学叫燃料了，自然只对燃料生效」。
   * 接线：上限 = `core/jumpFuel.ts` 的 `JUMP_FUEL_CAP_SKILLS`；节拍/收率 = `core/lab.ts` 的
   * `LAB_CYCLE_SKILLS` / `LAB_YIELD_SKILLS`（**声明式表**，加技能=表里加一行）。 */
  {
    id: 'fuel-tank-structure',
    name: '储罐结构学',
    group: '工业',
    rank: 2,
    branch: 'b-lab',
    description: '燃料储罐结构改造：燃料仓库上限每级 +⟦10%⟧（满级 +⟦50%⟧）。',
  },
  {
    id: 'orbital-fuel-depot',
    name: '轨道储备库学',
    group: '工业',
    rank: 4,
    branch: 'b-lab',
    prereq: ['fuel-tank-structure'],
    description: '轨道储备库扩建：燃料仓库上限每级再 +⟦10%⟧（满级再 +⟦50%⟧；与储罐结构学乘算叠加）。',
  },
  {
    id: 'fuel-catalytic-cracking',
    name: '催化裂解学',
    group: '工业',
    rank: 4,
    branch: 'b-lab',
    description: '催化裂解工艺：燃料合成周期每级缩短 ⟦4%⟧（满级 −⟦20%⟧；与产线节拍学乘算叠加，只对燃料配方生效）。',
  },
  {
    id: 'fuel-yield-engineering',
    name: '收率工艺学',
    group: '工业',
    rank: 4,
    branch: 'b-lab',
    description: '合成收率优化：燃料合成每批产出每级 +⟦6%⟧（满级 +⟦30%⟧；只对燃料配方生效）。',
  },
]
