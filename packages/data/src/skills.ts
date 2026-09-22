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
 *
 * ---
 *
 * **2026-09-22 船长令（技能树批）**：
 * ① 「**将现有的技能再进行细分**」⇒ 每条技能新增 `branch`（**技能书**，见 `SKILL_BRANCHES`，
 *    23 本：7 大类之内再切细）；
 * ② 「**将同类效果的技能做成上下级关系**」＋「**有前置的技能效果是否相关？如果不相关最好单开一条线。**」
 *    ⇒ 新增 `prereq`（**真前置**，`enqueueSkill` 校验，全部达到 `PREREQ_MIN_LEVEL` = **Lv1** 才可入队）。
 *    **连线判据 = 效果同族**（二者的 description 里互相点名「与 X 乘算叠加 / 同效果 / 同享」＝同一乘区）；
 *    **效果不同轴的一律不填**（82 条里只有 27 条有前置、共 28 条边 ⇒ 其余 55 条都是根，树上就是并列的独立点）。
 * ③ 「**采矿属于工业舰，武装舰操作 · 装甲舰操作是战斗**」⇒ **采矿舰入门学 / 采矿舰操作 归「工业」**、
 *    **武装舰操作 / 装甲舰操作 归「战斗」**（`group` 字段随之调整；舰船大类只留通用操纵）。
 * ④ **同一批的第二轮回稿**（船长在坐标工作台 `skilltree-workbench.xlsx` 里直接改的）：
 *    - **改名**：`mining-frigate` 采集器入门学 → **采矿舰入门学** · `station-protocol` 空间站协议学 → **空间站维修协议**；
 *    - **rank 调整**：`kinetic-gunnery` 动能炮术 1 → **2** · `missile-launching` 导弹发射学 1 → **2** ·
 *      `station-protocol` 空间站维修协议 **1 → 4**；
 *    - ⚠ `station-protocol` 升到 rank 4 后比 `repair-engineering`（维修工程学，rank 3）更深 ⇒ 那一对
 *      **上下级方向随之翻转**（前置挂在维修工程学之下），否则违反「父 rank ≤ 子 rank」的树契约。
 */

import type { SkillDef } from '@whale/core'

/**
 * **技能书**（技能树页的分支，2026-09-22 船长令「将现有的技能再进行细分」）——
 * 顺序即树页「技能书」导航的显示顺序；名字走 l10n（`ui.labelsText.026~048`，中英齐），本表只登记 id 与所属大类。
 */
export const SKILL_BRANCHES: readonly { readonly id: string; readonly group: string }[] = [
  { id: 'b-fly', group: '舰船' },
  { id: 'b-mine', group: '工业' },
  { id: 'b-refine', group: '工业' },
  { id: 'b-craft', group: '工业' },
  { id: 'b-salvage', group: '工业' },
  { id: 'b-auto', group: '工业' },
  { id: 'b-build', group: '工业' },
  { id: 'b-indship', group: '工业' },
  { id: 'b-weapon', group: '战斗' },
  { id: 'b-aim', group: '战斗' },
  { id: 'b-ammo', group: '战斗' },
  { id: 'b-drone', group: '战斗' },
  { id: 'b-warship', group: '战斗' },
  { id: 'b-protect', group: '工程' },
  { id: 'b-repair', group: '工程' },
  { id: 'b-shipfit', group: '工程' },
  { id: 'b-ai', group: '工程' },
  { id: 'b-learn', group: '工程' },
  { id: 'b-scan', group: '探索' },
  { id: 'b-survive', group: '探索' },
  { id: 'b-market', group: '贸易' },
  { id: 'b-bounty', group: '贸易' },
  { id: 'b-logistics', group: '物流' },
]

/** 全量技能表。顺序即界面展示顺序，新手向的放前面 */
export const SKILLS: readonly SkillDef[] = [
  // ───────── 舰船 ─────────
  {
    id: 'spaceship-command',
    name: '舰船操控学',
    group: '舰船',
    rank: 1,
    branch: 'b-fly',
    description: '所有舰船驾驶的基础操控训练。航行加速：每级再缩短星图航行时间 ⟦2%⟧（与导航三技能乘算叠加，全船通用）。',
  },
  {
    id: 'navigation',
    name: '导航学',
    group: '舰船',
    rank: 2,
    branch: 'b-fly',
    prereq: ['spaceship-command'],
    description: '更快的航线规划与亚光速机动。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'warp-drive-operation',
    name: '跃迁引擎操控',
    group: '舰船',
    rank: 4,
    branch: 'b-fly',
    prereq: ['acceleration-control'],
    description: '跃迁引擎的调校与维护。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'acceleration-control',
    name: '加速控制理论',
    group: '舰船',
    rank: 3,
    branch: 'b-fly',
    prereq: ['navigation'],
    description: '跃迁起止阶段的加速与减速控制。航行加速：每级缩短星图航行时间 ⟦4%⟧（同类技能乘算叠加）。',
  },
  {
    id: 'mining-frigate', // id 保持不动（存档键 = skills.trained；改名零迁移）
    // 2026-09-16 船长：「采矿护卫舰操作改名为采集器入门学。」
    // 2026-09-22 船长（技能树批，Excel 工作台回稿）：「采集器入门学」⇒ **采矿舰入门学**
    name: '采矿舰入门学',
    group: '工业',
    rank: 2,
    branch: 'b-indship',
    description: '采集器的调校与作业流程入门：每级缩短采集循环时间 ⟦3%⟧。',
  },
  {
    id: 'industrial-ops',
    name: '采矿舰操作', // 2026-09-09 船长定：与 UI 徽标「采矿」一致（原"工业舰操作"）；id 不变
    group: '工业',
    rank: 3,
    branch: 'b-indship',
    /**
     * **前置 = 采矿舰入门学**（**2026-09-22 船长在坐标工作台 Excel 里改的**）：
     * 船长那句「不同类型的舰船不应该是上下级关系」指的是**不同族之间**（采矿舰 / 武装舰 / 装甲舰互不隶属），
     * 而**同一族内的"入门 → 操作"要有上下级** ⇒ 本条挂在「采矿舰入门学」之下（rank 2 ≤ 3，树契约合法）。
     * ⚠ 上一轮我漏采用了这一处（比对脚本只看了名称/rank/坐标四列）——现已补上，并新增
     * `npm run skilltree:diff` 逐列比对工具防再漏。
     */
    prereq: ['mining-frigate'],
    description: '采矿舰族专精驾驶：驾驶采矿舰族舰船时采集产量每级 +⟦4%⟧。',
  },
  {
    id: 'armed-ops',
    name: '武装舰操作',
    group: '战斗',
    rank: 3,
    branch: 'b-warship',
    description: '武装舰专精驾驶：驾驶武装舰时所有武器（含基础舰炮）单发伤害每级 +⟦3%⟧（满级 +⟦15%⟧；与炮术学、武器族专精乘算叠加）。',
  },
  {
    id: 'armored-ops',
    // 2026-09-16 船长：「将重装舰类的名称改为装甲舰」⇒ 展示名改「装甲舰操作」（id `armored-ops` 不变，存档零迁移）
    name: '装甲舰操作',
    group: '战斗',
    rank: 3,
    branch: 'b-warship',
    description: '装甲舰专精驾驶：驾驶装甲舰时装甲与结构容量每级 +⟦4%⟧（满级 +⟦20%⟧；与船体加固理论、装甲增厚板乘算叠加，护盾不受影响）。容量变厚的同时，修理组件与船体维修装置的修复量按同一比例提高。',
  },
  {
    id: 'vector-maneuvering',
    name: '矢量机动操作',
    group: '舰船',
    // 2026-09-16 船长：「矢量机动操作，规避机动学，索敌统合改为rank3」（三者原 r2 ⇒ 训练时长 ≈2.9h → ≈11.2h）
    rank: 3,
    branch: 'b-fly',
    description: '矢量喷口操控：战斗机动速度每级 +⟦5%⟧（满级 +⟦25%⟧；与推进器点火加成乘算，星图航行加速不受影响）。',
  },
  {
    id: 'evasion-maneuvering',
    name: '规避机动学',
    group: '舰船',
    rank: 3, // 同上（2026-09-16 船长：改 rank3）
    branch: 'b-fly',
    description: '规避机动训练：舰船被敌方命中的概率每级降低 ⟦5%⟧（满级约降至无技能时的 75%；与姿态陀螺的回避加成相互乘算）。',
  },
  {
    id: 'targeting-integration',
    name: '索敌统合',
    group: '舰船',
    /**
     * 2026-09-16 船长：「矢量机动操作，规避机动学，索敌统合改为rank3」⇒ r2 → **r3**。
     * ⚠ 这是**补完 2026-09-14 的那次改判**：当日船长把索敌统合也改成"炮台命中"口径后，
     * 它与「火控阵列学」已经**走同一通道、只靠 3% vs 2% 的每级值区分**，
     * 所以 2026-09-08「相似效果错开级别」给它俩分档（r3 / r2）的**理由当日即已作废**；
     * 本次两者同为 r3 = 按船长新裁定收口（见 docs/design/skill-rank-dispersion.md 表 1 该行）。
     */
    rank: 3,
    branch: 'b-fly',
    // 2026-09-14 船长改判（原话：「索敌统合也改为炮台命中，缩减为 2% 每级」）：原为"舰船命中加成每级 +5%"，
    // 现与「火控阵列学」同口径（乘在炮台/导弹架基础命中上、两者乘算叠加）。
    description: '炮台与导弹架的命中率每级 +⟦2%⟧（满级 +⟦10%⟧；相对乘算，与「火控阵列学」乘算叠加；激光必中不受影响）。',
  },

  // ───────── 工业 ─────────
  {
    id: 'mining',
    name: '采矿技术',
    group: '工业',
    rank: 3,
    branch: 'b-mine',
    prereq: ['astro-geology'],
    description: '矿藏采集的核心技术：原矿、气体与冰矿的采集循环产量每级 +⟦6%⟧（与星质地质学、深空采集学乘算叠加）。',
  },
  {
    id: 'deep-space-harvesting',
    name: '深空采集学',
    group: '工业',
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
    description: '产线节拍优化：精炼炉与组装机的作业周期每级缩短 ⟦5%⟧（满级 −⟦25%⟧；手动与 AI 核心驱动同享，与炉心熔炼学/批量生产学乘算叠加）。',
  },
  {
    // 2026-09-11 船长定：rank3 下级技能（工业自动化的基础课程）——满级 +5 站内工位
    id: 'industrial-ai-cap-basic',
    name: '工业自动化基础',
    group: '工业',
    rank: 3,
    branch: 'b-auto',
    description: '自动化产线入门（工业自动化的基础课程）：AI 核心驱动的站内精炼炉/回收炉/制造线，在 AI 核心共用上限之外每级 +⟦1⟧ 枚工业专用工位（满级 +⟦5⟧；仅对站内产业生效，不增加 AI 副船任务上限；与「工业自动化」叠加）。',
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
    id: 'astro-geology',
    name: '星质地质学',
    group: '工业',
    rank: 2,
    branch: 'b-mine',
    description: '岩层构成的进阶研究：全矿采集产量每级再 +⟦4%⟧（与采矿技术乘算叠加）。',
  },
  {
    id: 'deep-hole-blasting',
    name: '深井爆破学',
    group: '工业',
    rank: 3,
    branch: 'b-mine',
    prereq: ['mining'],
    description: '浅层矿带的爆破开采优化：低品位原矿（橄榄岩/辉长岩/赤环岩）产量每级 +⟦6%⟧。',
  },
  {
    id: 'rich-vein-prospecting',
    name: '富矿勘探学',
    group: '工业',
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
    description: '精炼炉温控与搅拌工艺：精炼炉单批周期每级缩短 ⟦4%⟧（手动与 AI 核心驱动同享）。',
  },
  {
    id: 'furnace-expansion',
    name: '炉膛扩容学',
    group: '工业',
    rank: 2,
    branch: 'b-refine',
    prereq: ['core-smelting'],
    description: '精炼炉膛容积改造：主控手动精炼的单批处理量每级 +⟦6%⟧（AI 核心驱动不受此技能影响）。',
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
    id: 'salvage-rigging',
    name: '打捞装置整备学',
    group: '工业',
    rank: 3,
    branch: 'b-salvage',
    description: '打捞器的维护与调校：打捞器单轮周期每级缩短 ⟦3%⟧（主控与 AI 同享）。',
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
    id: 'part-forming',
    name: '零件成型工艺学',
    group: '工业',
    rank: 3,
    branch: 'b-craft',
    // 2026-09-20 船长定：基础零件制造时间每级 −8%（满级 −40%）
    description: '基础零件（电路基板、装甲板、结构框架等）的成型排程：基础零件制造时间每级 −⟦8%⟧（满级 −⟦40%⟧）。',
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

  // ───────── 战斗（2026-09-05 武器族技能批次：三形态专精乘区，乘算于炮术学之上） ─────────
  {
    id: 'gunnery',
    name: '炮术学',
    group: '战斗',
    rank: 1,
    branch: 'b-weapon',
    description: '舰载武器基础训练：每级提高实时战斗的单发伤害 ⟦5%⟧（三形态武器与基础舰炮通用，与族专精技能乘算）。',
  },
  {
    id: 'kinetic-gunnery',
    name: '动能炮术',
    group: '战斗',
    rank: 2,
    branch: 'b-weapon',
    prereq: ['gunnery'],
    description: '动能武器（炮台）专精：单发伤害每级 +⟦5%⟧（与炮术学乘算叠加）。',
  },
  {
    id: 'missile-launching',
    name: '导弹发射学',
    group: '战斗',
    rank: 2,
    branch: 'b-weapon',
    prereq: ['gunnery'],
    description: '导弹架专精：爆破弹药单发伤害每级 +⟦5%⟧（与炮术学乘算叠加；追踪命中与近盲安全射距不受影响）。',
  },
  {
    id: 'laser-cannon',
    name: '激光炮学',
    group: '战斗',
    rank: 2,
    branch: 'b-weapon',
    prereq: ['gunnery'],
    description: '激光炮专精：能量光束单发伤害每级 +⟦5%⟧（与炮术学乘算叠加；必中特性不受影响）。',
  },
  {
    id: 'fire-control',
    name: '火控阵列学',
    group: '战斗',
    rank: 3,
    branch: 'b-aim',
    description: '火控解算优化：炮台/导弹架的命中率每级 +⟦3%⟧（相对乘算；激光必中不受影响）。',
  },
  {
    id: 'reload-drills',
    name: '武器装填技术',
    group: '战斗',
    rank: 4,
    branch: 'b-aim',
    description: '装填班组训练：炮台/导弹架/激光炮的装填时间每级 −⟦4%⟧。',
  },
  {
    id: 'drone-warfare',
    name: '无人机作战学',
    group: '战斗',
    rank: 1,
    branch: 'b-drone',
    description: '无人机作战协同：无人机单发伤害每级 +⟦5%⟧（与战术导控装置乘算；无人机不吃炮术与武器族技能）。',
  },
  {
    id: 'ammunition-condensing',
    name: '弹药集约学',
    group: '战斗',
    rank: 2,
    branch: 'b-ammo',
    description: '弹仓整理与备弹规划：出发预载弹药量每级 +⟦8%⟧（满级 +⟦40%⟧）。',
  },
  {
    id: 'drone-servicing',
    name: '无人机整备学',
    group: '战斗',
    rank: 3,
    branch: 'b-drone',
    description: '甲板整备与再出击优化：无人机的装填时间每级 −⟦4%⟧（武器装填技术只作用于炮台/导弹架/激光炮，两者独立乘算）。',
  },
  /* ───────── 无人机线扩展（2026-09-10 船长拍板：配合"近防炮可 100% 损坏机群 + 战后回收"） ─────────
   * 五条新技能覆盖"打得更痛 / 更耐打（两档）/ 更难被点中 / 战后捡得回来"；数值接线在 core/combat.ts */
  {
    id: 'drone-strike',
    name: '无人机打击学',
    group: '战斗',
    rank: 4,
    branch: 'b-drone',
    prereq: ['drone-warfare'],
    description: '机群战术打击课程：无人机单发伤害每级再 +⟦4%⟧（与无人机作战学、战术导控装置乘算叠加）。',
  },
  {
    id: 'drone-durability',
    name: '无人机耐久学',
    group: '战斗',
    rank: 2,
    branch: 'b-drone',
    description: '机体加固与冗余线路（基础档）：无人机三层血量（护盾 / 装甲 / 结构）每级 +⟦4%⟧（满级 +⟦20%⟧，直接放大全血条）。',
  },
  {
    id: 'drone-reinforce',
    name: '无人机强化学',
    group: '战斗',
    rank: 4,
    branch: 'b-drone',
    prereq: ['drone-durability'],
    description: '高强度机体与冗余结构（进阶档）：无人机三层血量每级再 +⟦6%⟧（满级再 +⟦30%⟧，与耐久学乘算叠加）。',
  },
  {
    id: 'drone-recovery',
    name: '无人机回收学',
    group: '战斗',
    rank: 3,
    branch: 'b-drone',
    description: '残骸打捞与机体翻修：战斗结束后损坏无人机的回收比例每级 +⟦6%⟧（基础 ⟦20%⟧ → 满级 ⟦50%⟧；回收的机体回舱继续服役）。',
  },
  {
    id: 'drone-evasion',
    name: '无人机规避学',
    group: '战斗',
    rank: 4,
    branch: 'b-drone',
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

  // ───────── 贸易（V9+：市场税率减免） ─────────
  {
    id: 'accounting',
    name: '会计学',
    group: '贸易',
    rank: 3,
    branch: 'b-market',
    description: '贸易税减免：卖出成交的贸易税每级降低 ⟦8%⟧（与贸易谈判学乘算叠加）。',
  },
  {
    id: 'trade-negotiation',
    name: '贸易谈判学',
    group: '贸易',
    rank: 4,
    branch: 'b-market',
    prereq: ['accounting'],
    description: '协会渠道谈判：贸易税每级再降低 ⟦8%⟧（与会计学乘算叠加）。',
  },
  {
    id: 'bounty-hunting',
    name: '赏金猎手学',
    group: '贸易',
    rank: 4,
    branch: 'b-bounty',
    description: '赏金评估与协会渠道：完成悬赏的奖金每级 +⟦8%⟧（满级 +⟦40%⟧，在随机浮动之上乘算）。',
  },
  {
    id: 'marketing',
    name: '营销学',
    group: '贸易',
    rank: 4,
    branch: 'b-market',
    description: '货物包装与渠道推销：市场卖出结算价每级 +⟦1.2%⟧（满级 +⟦6%⟧，与协会声望加成乘算）。',
  },
  {
    id: 'source-sweeping',
    name: '现货抢购学',
    group: '贸易',
    rank: 4,
    branch: 'b-market',
    description: '供应链情报网络：市场稀有/限定订单的刷新频率每级 ×⟦1.1⟧（满级约 ×⟦1.5⟧）。',
  },
  {
    id: 'secondhand-market',
    name: '二手市场学',
    group: '贸易',
    rank: 2,
    branch: 'b-market',
    description: '旧货市场渠道：市场稀有商品的供给单价格每级 −⟦2%⟧（满级 −⟦10%⟧）。',
  },

  // ───────── 探索（2026-09-04 新组） ─────────
  {
    id: 'signal-analysis',
    name: '信号分析学',
    group: '探索',
    rank: 3, // 2026-09-14 船长：扫描虫洞要 12 小时，故三项扫描技能的难度重排（分析 3 / 测绘 4 / 过滤 5）
    branch: 'b-scan',
    description: '未知信号解读与锁定：就地扫描与虫洞扫描的窗口每级缩短 ⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'cartography',
    name: '星图测绘学',
    group: '探索',
    rank: 4, // 2026-09-14 船长（同上）
    branch: 'b-scan',
    prereq: ['signal-analysis'],
    description: '航线标定与跳跃窗优化：就地扫描与虫洞扫描的窗口每级缩短 ⟦6%⟧（满级 −⟦30%⟧；与信号分析学、信号过滤学乘算叠加）。',
  },
  {
    id: 'signal-filtering',
    name: '信号过滤学',
    group: '探索',
    rank: 5, // 2026-09-14 船长（同上）
    branch: 'b-scan',
    prereq: ['cartography'],
    description: '干扰抑制与信号提纯：就地扫描与虫洞扫描的窗口每级再缩短 ⟦6%⟧（与信号分析学乘算叠加）。',
  },
  {
    // 2026-09-14 船长三条改判（同日追加）：①「星际奇遇学，对缩减虫洞的时间也有效」⇒ 虫洞扫描周期每级 −4%、
    // 满级 −20%（虫洞专属第四项，接线 = `core/wormholeScan.ts happeningsScanFactor`；星图扫描不吃这一项）
    // ②「并移动到探索内」（原属 **贸易** 组）③「rank提升到5」（难度 3→5，单级时长倍数 ×7.98、练满约 89.7 小时）
    // **2026-09-17 船长改判**：「将一些只有满级后才有效果的技能，拆分成每个等级效果」⇒ ① 这条 09-14 曾按
    // 「满级阶跃」落（Lv1~4 对虫洞零效果），本日改回**线性每级 −4%**（满级仍恰 −20%）——旧阶跃口径作废
    id: 'galactic-happenings',
    name: '星际奇遇学',
    group: '探索',
    rank: 5,
    branch: 'b-survive',
    description: '奇闻轶事的嗅觉：在线随机事件的来访间隔每级 −⟦8%⟧（满级间隔约为原来的六成）；出击出发时遭遇随机事件的机会每级 ×⟦1.15⟧；虫洞扫描窗口每级缩短 ⟦4%⟧（满级 −⟦20%⟧）。',
  },
  {
    // 2026-09-14 船长四条改判（同日追加）：①「事件分红学，改名事件玄学」②「Rank提高到5」
    // ③「效果添加：降低虫洞内出现空白地点的几率，满级为20%」（四问四答：**相对削减**、分红部分不动、
    //   移入**探索**组、不做特殊重分配）④落到「探索」组内（原属 **贸易** 组）。
    // ⚠ **id 保持 `event-dividend` 不改**：老档 `skills.trained` / 训练队列都按 id 记账，改 id 会丢等级。
    // 接线：分红 = `core/events.ts fireFlavor`（+15%/级，本批一字未动）；
    //       空地点 = `core/wormhole.ts blankShareFactorOf` → `wormholeGrid.ts wormholeEmptyShareFor(depth, 系数)`。
    id: 'event-dividend',
    name: '事件玄学',
    group: '探索',
    rank: 5,
    branch: 'b-survive',
    prereq: ['galactic-happenings'],
    description: '把每一次巧合都变成收入：随机事件的现金奖励每级 +⟦15%⟧；运气也延伸进虫洞——洞里出现空白地点的几率每级相对削减 ⟦4%⟧（满级 −⟦20%⟧）。',
  },
  {
    // 2026-09-14 船长：「添加 rank4 技能，星图记录学，满级允许玩家虫洞的保存上限+10。」
    // **2026-09-16 船长改判**：「星图记录学，效果错误，应该为每级+2，满级+10。」⇒ 由**阶跃**改为
    // **每级线性 +2**（Lv1 +2 … Lv5 +10，满级总量不变）；接线 = `core/wormholeScan.ts` 的
    // `wormholeStockMaxOf`（基础 5 处 ⇒ 上限 7/9/11/13/15）。
    id: 'chart-archive',
    name: '星图记录学',
    group: '探索',
    rank: 4,
    branch: 'b-scan',
    description: '深空航图与虫洞档案的整理学：星图上可留存的虫洞每级 +⟦2⟧ 处（满级 +⟦10⟧ 处，由 5 处提到 15 处）。',
  },
  {
    id: 'salvage-diving',
    name: '漂流物打捞学',
    group: '探索',
    rank: 3,
    branch: 'b-survive',
    description: '残骸打捞与战利品收集：远征缴获的物资数量与残骸打捞量每级 +⟦12%⟧（主控与 AI 同享）。',
  },
  {
    id: 'seizure-appraisal',
    name: '缴获评估学',
    group: '探索',
    rank: 2,
    branch: 'b-survive',
    description: '战利品估值与销赃渠道：低安遭遇击退/大捷的缴获信用点每级 +⟦10%⟧。',
  },
  {
    id: 'lowsec-survival',
    name: '低安生存学',
    group: '探索',
    rank: 3,
    branch: 'b-survive',
    description: '危险星域的保命之道：低安被抢的损失上限每级 −⟦12%⟧（满级 −⟦60%⟧，货与现金同享）。',
  },

  // ───────── 物流（2026-09-04 技能扩军新组；含从舰船组归并的运力技能） ─────────
  {
    id: 'deep-space-logistics',
    name: '深空物流学',
    group: '物流',
    rank: 3,
    branch: 'b-logistics',
    prereq: ['hold-management'],
    description: '深空物流与仓位规划：全舰队货仓容量每级 +⟦4%⟧（满级 +⟦20%⟧；与货舱扩展件/货舱管理学乘算）。',
  },
  {
    id: 'hauler-ops',
    name: '货舰操作',
    group: '物流',
    rank: 2,
    branch: 'b-logistics',
    description: '航运舰族专精驾驶：驾驶航运族舰船时货仓容量每级 +⟦5%⟧。',
  },
  {
    id: 'compression',
    name: '压缩技术',
    group: '物流',
    rank: 3,
    branch: 'b-logistics',
    description: '原材料压缩封装：原矿/气体/冰矿的货仓占用体积每级 −⟦6%⟧（满级 −⟦30%⟧）。',
  },
  {
    id: 'hold-management',
    name: '货舱管理学',
    group: '物流',
    rank: 1,
    branch: 'b-logistics',
    description: '舱位规划与收纳：全舰队货仓容量每级再 +⟦3%⟧（与深空物流学乘算叠加）。',
  },
]

/** 技能组清单（按此顺序分组展示） */
export const SKILL_GROUPS: readonly string[] = ['舰船', '工业', '战斗', '工程', '贸易', '探索', '物流']

/** 把技能表建成引擎用的"按 id 快速查找"目录 */
export function buildSkillCatalog(): ReadonlyMap<string, SkillDef> {
  return new Map(SKILLS.map((s) => [s.id, s]))
}
