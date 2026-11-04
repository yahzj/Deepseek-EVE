import type { SkillDef } from '@whale/core'

export const SHIP_OPERATION_SKILLS: readonly SkillDef[] = [
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
    group: '矿业',
    rank: 2,
    branch: 'b-indship',
    description: '采集器的调校与作业流程入门：每级缩短采集循环时间 ⟦3%⟧。',
  },
  {
    id: 'industrial-ops',
    name: '采矿舰操作', // 2026-09-09 船长定：与 UI 徽标「采矿」一致（原"工业舰操作"）；id 不变
    group: '矿业',
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
    // ⟪文案调整 2026-09-24⟫ 原「采矿舰族专精驾驶：驾驶采矿舰族舰船时…」——"舰族"是开发口径（role 族），
    //   玩家侧「族」另指敌方势力 ⇒ 按界面既有类别名（角色标签 = 采矿）正字
    description: '采矿舰专精驾驶：驾驶采矿舰时采集产量每级 +⟦4%⟧。',
  },
  {
    id: 'armed-ops',
    name: '武装舰操作',
    group: '舰船',
    rank: 3,
    branch: 'b-warship',
    description: '武装舰专精驾驶：驾驶武装舰时所有武器（含基础舰炮）单发伤害每级 +⟦3%⟧（满级 +⟦15%⟧；与炮术学、武器类型加成乘算叠加）。',
  },
  {
    id: 'armored-ops',
    // 2026-09-16 船长：「将重装舰类的名称改为装甲舰」⇒ 展示名改「装甲舰操作」（id `armored-ops` 不变，存档零迁移）
    name: '装甲舰操作',
    group: '舰船',
    rank: 3,
    branch: 'b-warship',
    description: '装甲舰专精驾驶：驾驶装甲舰时装甲与结构容量每级 +⟦4%⟧（满级 +⟦20%⟧；与船体加固理论、装甲增厚板乘算叠加，护盾不受影响）。容量变厚的同时，修理组件与船体维修装置的修复量按同一比例提高。',
  },
  /**
   * **舰种操作四技能**（2026-09-22 船长令）：「添加战舰操作系T4技能，护卫舰操作…驱逐舰操作…」＋
   * 「添加战舰操作系T5技能，巡洋舰操作…战列操作…」。
   *
   * 判据 = **舰种**（`ShipDef.tier`：T1 护卫舰 / T2 驱逐舰 / T3 巡洋舰 / T4 战列舰，见 core `SHIP_SIZE_CLASS`），
   * 与既有的「武装舰操作 / 装甲舰操作」按**类别**判定**互不冲突、可叠加**（长尾鲨级 = 武装舰 且 T3 ⇒ 两条都吃）。
   * 前置 = 武装舰操作 ＋ 装甲舰操作（船长指定，两条都要 Lv1）。口径（船长同日逐条裁定）：
   * 闪避/命中加**百分点**；单发伤害与容量**相对乘算**；抗性只对**已有条目**相对乘算（上限 90%）。
   */
  {
    id: 'frigate-ops',
    name: '护卫舰操作',
    group: '舰船',
    rank: 4,
    branch: 'b-warship',
    prereq: ['armed-ops', 'armored-ops'],
    description: '护卫舰专精驾驶：驾驶护卫舰时闪避每级 +⟦2⟧ 个百分点（满级 +⟦10⟧ 个百分点；与规避机动学、姿态陀螺乘算叠加）。',
  },
  {
    id: 'destroyer-ops',
    name: '驱逐舰操作',
    group: '舰船',
    rank: 4,
    branch: 'b-warship',
    prereq: ['armed-ops', 'armored-ops'],
    description: '驱逐舰专精驾驶：驾驶驱逐舰时单发伤害每级 +⟦5%⟧（满级 +⟦25%⟧）、命中每级 +⟦2⟧ 个百分点（满级 +⟦10⟧ 个百分点；与炮术学、武器类型加成乘算叠加）。',
  },
  {
    id: 'cruiser-ops',
    name: '巡洋舰操作',
    group: '舰船',
    rank: 5,
    branch: 'b-warship',
    prereq: ['armed-ops', 'armored-ops'],
    description: '巡洋舰专精驾驶：驾驶巡洋舰时单发伤害每级 +⟦3%⟧（满级 +⟦15%⟧）、已有抗性每级再 +⟦2%⟧（满级 ×⟦1.1⟧，如 25%→27.5%；没有抗性的层不受影响，上限 90%）。',
  },
  {
    id: 'battleship-ops',
    name: '战列操作',
    group: '舰船',
    rank: 5,
    branch: 'b-warship',
    prereq: ['armed-ops', 'armored-ops'],
    description: '战列舰专精驾驶：驾驶战列舰时护盾、装甲与结构容量每级 +⟦3%⟧（满级 +⟦15%⟧）、已有抗性每级再 +⟦2%⟧（满级 ×⟦1.1⟧；没有抗性的层不受影响，上限 90%）。',
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
]
