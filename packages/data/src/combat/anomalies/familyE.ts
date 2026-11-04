/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_SHIP_TITAN_HULK, FOE_SHIP_AURO_HULK, FOE_SHIP_CORE_SECTION } from '../../foe-ships'

export const ANOMALY_ENTRY_9: AnomalyDef =
  {
    id: 'ano-titan-wreck',
    // **爆炸 60% + 动能 40%**（船长 2026-09-19「所有E族的默认伤害比改为爆炸60%，动能40%」；与舰级同值）
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "dmgMix_kinetic") },
    foeFamily: 'E', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '泰坦残骸', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "lairLevel"), // 窝点地图级别（3 = 全档）：船长 2026-09-10 定「E 族两张都设为 3」
    name: '泰坦残骸勘探',
    // **2026-09-11 机群批 S3**（船长「我记得巨构需要制作敌方无人机系统」⇒ 甲案）：
    // 本卡由**旧威胁推导路径**迁入**舰级路径**，并挂上「**警戒机群**」（＝据点词承诺的第二套火力）。
    // - **总血逐字守恒**：990.625 + 594.375 = **1,585**（＝原 `foeHpOverride` 逐字）
    // - **单发实收守恒**：母舰 96 + 58（原 114 + 69）＋ **机群**每舰 2 架 ×（8 + 5）
    //   ⇒ 单发合计 180（原 183，**−1.6%**）
    // - **旧路径的 `escorts 1`（僚机）由警戒机群承接**——'巨构自带机群＝第二套火力'落在这里
    // - ⚠ **速度 410 → 0**（船长 2026-09-11：「**族速度倍率设为 0**。依靠无人机攻击炮台范围外敌人」）：
    //   巨构是**静物残骸**，此前的 195（E 族族格速带 0.65~0.95）已作废；这是本段唯一的大幅难度改动
    // **2026-09-12 修订（船长三条裁定）**：①「**敌人数量缩减为 1**」⇒ 由「巨构残段 ×2」改为**单舰**，
    //   总血 **1,585 逐字守恒**（集中在唯一那具残骸上）；②「**三个悬赏整体火力上调 20%**」⇒ 总单发
    //   180 → **216**；③「衰减降低为 0.3」（落在舰级 `falloff` 上，见 `foe-ships.ts`）。
    // - **单舰后机群架数随舰级走**（`FoeShipSegment.drones` = 警戒机 ×2）⇒ **4 架 → 2 架**，每架单发
    //   由 34/33 提到 **65/65**（总机群火力仍守恒：130）；炮台 86（原 72）。
    // - 旧口径的"主体 + 僚机位"两条目合并为一条（tag 由 `foe-0` + `w0-foe-1` 变为只有 `foe-0`）。
    ships: [
      {
        ship: FOE_SHIP_TITAN_HULK,
        count: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_hpMul_input0") / FOE_SHIP_TITAN_HULK.hp, // = 1585/1600（原两条 990.625 + 594.375 合并）
        // 旧口径 T = round(228×0.779) + 2×round(25×0.779) = 178 + 38 = **216**（+20%）
        // ⇒ 按 0.6 拆成 炮台 86 / 机群 2 架 ×65
        dmgMul: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_dmgMul"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_droneFireShare"),
        // **总火力锚点 216**（船长 2026-09-12：「架数变多、**总火力不动**」）——常态出击数上到 7 架后，
        // 总量仍钉在 **216**（炮台 86 / 机群 7 架 ×19~18）；不写锚点的话架数会把总量推到 311。
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "ships_0_firepowerAnchor"),
      },
    ],
    // 2026-09-12 船长「**将所有巨构移动到奥罗荒环**」：E 族三卡**全部集中**到奥罗荒环
    //（原在深渊之门；深渊之门恢复为纯 C 族异形星系——其 lore「古老跃迁门…守卫森严」不涉巨构，故无需改文案）。
    // ⚠ 连带：同星系日板"取级别最高（并列取奖金最高）"⇒ 见卡表 §11.6 的派发口径备注。
    galaxyId: 'galaxy-auro',
    threat: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    // **族规「中距为主」（P-12 对齐）**——⚠ 作战距离**不变**：舰级上写了 `desireRangeM` 钉住现状值
    tactic: 'orbit',
    defProfile: 'armor',
    standingReq: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-titan-wreck", "combatSeconds"),
    description: '一具远古泰坦残骸静卧深渊航道，协会长期征集武装护航下的勘探与清剿——击退残骸守备，赏金照发。',
  }

export const ANOMALY_ENTRY_10: AnomalyDef =
  {
    id: 'ano-auro-raiders',
    foeFamily: 'E', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '奥罗武装残骸', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "lairLevel"), // 窝点地图级别（3 = 全档）：船长 2026-09-10 定「E 族两张都设为 3」
    name: '奥罗武装残骸群',
    // **2026-09-11 E 族收尾批**（船长：「**E 族单独调整，包括 E 族赏金任务的伤害比例**」+「其余没有异议」）：
    // 本卡由**旧威胁推导路径**迁入**舰级路径**（舰级 = 「奥罗残骸段」T3），与「泰坦残骸勘探」同款处理：
    // - **总血逐字守恒**：1,740（＝原 `foeHpOverride`）——旧路径份额 = 主体 5 : 僚机 3 : 3
    //   ⇒ 主体 1,740×5/11 = **790.909** + 僚机 1,740×3/11 = **474.545** ×2
    // - **单发守恒 + 机群让位**（船长裁定 A5：机群火力**计入卡的总火力**、吃同一条 `dmgMul`）：
    //   母舰 46 + 僚机 27×2 = 100 ／ **机群 3 舰 ×2 架**（单发 6·6·4·4·4·4）= 28 ⇒ **合计 128**
    //   （原 129，**−0.8%**）
    // - **速度 412 → 0**（船长：「族速度倍率设为 0。**依靠无人机攻击炮台范围外敌人**」）：
    //   武装残骸是**静物**，火力改由**警戒机群**投送（机型射程 4,500m，远出炮台带）
    // - **构成改爆炸 60% + 动能 40%**（E 族族格 —— 飞船侧与窝点派生侧同值；船长 2026-09-19
    //   「所有E族的默认伤害比改为爆炸60%，动能40%」，原 50:50 作废）
    // - **战术改 orbit**（族规）**但作战距离不变**：舰级上写了 `desireRangeM: 516` 钉住现状
    //   （1~2,581 × brawl 0.20 ≈ 516）
    // - 旧路径的 `escorts 2`（僚机 ×2）改为**显式编成条目**（`escort: true` ⇒ 显示名带「轻装」前缀）
    ships: [
      {
        ship: FOE_SHIP_AURO_HULK, // 主体：原「武装残骸」主体
        count: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_count"),
        hpMul: (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_hpMul_input0") * (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_hpMul_input1") / enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_hpMul_input2"))) / FOE_SHIP_AURO_HULK.hp, // = 790.909/990
        // **火力 +20%（2026-09-12 船长「三个悬赏整体火力上调 20%」）**：本条目旧口径 T = 72
        // ⇒ 按 0.5 拆成 炮台 36 / 机群 2 架 ×18（卡合计 128 → **154**）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_dmgMul"),
        // **总火力锚点 72**（架数 5 架后总量不动：炮台 36 / 机群 5 架 ×8~7）
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_firepowerAnchor"),
        // **机群 50%**（首版取值）：奥罗命中 0.95（老化比泰坦级轻）⇒ 炮台仍可用，故主体"机炮各半"；
        // 总单发守恒（比例只改构成）。
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_0_droneFireShare"),
      },
      {
        ship: FOE_SHIP_AURO_HULK, // 僚机位 ×2：原「轻装武装残骸」
        count: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_count"),
        escort: true,
        hpMul: (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_hpMul_input0") * (enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_hpMul_input1") / enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_hpMul_input2"))) / FOE_SHIP_AURO_HULK.hp, // = 474.545/990
        // 火力 +20%：本条目旧口径 T = 82（每单位 41）⇒ 按 0.7 拆成 炮台 12 / 机群 2 架 ×15·14
        dmgMul: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_dmgMul"),
        // **总火力锚点 82**（架数 5 架后总量不动：炮台 25 / 机群 10 架 ×6~5）
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_firepowerAnchor"),
        // **轻装机群 70%**（首版取值）：同一截残骸的**轻装规格**（血量只有主体的六成）⇒ 更"残"、
        // 炮更不可用 ⇒ 更依赖机群；同时演示**条目级旋钮**（同卡两条目可各写各的）。
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "ships_1_droneFireShare"),
      },
    ],
    galaxyId: 'galaxy-auro',
    threat: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "threat"),
    /* ⟪2026-10-02 判据回钉⟫（船长令「两个都同意」之乙）：09-25 重定标把标签 62 → 62 时翻了近防炮门槛 ⇒ PD/修理判据回钉到**重定标前**旧标签 */
    threatJudged: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "threatJudged"), // 判据威胁（PD 门槛 ≥60 / 敌修理 k 读它；见 AnomalyDef.threatJudged）
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    // **族规「中距为主」（P-12 对齐）**——⚠ 作战距离**不变**：舰级上写了 `desireRangeM` 钉住现状值
    tactic: 'orbit',
    defProfile: 'armor',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "dmgMix_kinetic") }, // **爆炸 60% + 动能 40%**（E 族族格；船长 2026-09-19 改判，原 50:50）
    standingReq: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-auro-raiders", "combatSeconds"),
    description: '奥罗荒环的武装残骸会被风暴反复激活，协会的猎杀令因此常年有效：按次结算，可反复接取。',
  }

export const ANOMALY_ENTRY_11: AnomalyDef =
  {
    id: 'ano-core-section',
    foeFamily: 'E', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '巨构核心', // 赏金任务·窝点名的核心词（⇒「巨构核心·外围/核心/深层」；避开据点档位词本身）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-core-section", "lairLevel"), // 窝点地图级别（3 = 全档）：**E 族代表位**（族内最高级目标）
    // ⚠ 2026-09-12 过档留档：本字段当天曾按船长「把核心卡降为 L1」改为 1，同日船长「好像是我理解错误了，
    //   先回档为 L3」**回档到 3**；"不顶掉同域另外两张"的目标改由**派发规则**解决（代表位改**随机抽取**，
    //   见 `core/sideTasks.ts`）。
    name: '巨构核心勘探令',
    // **E 族「核心舱段级」代表卡**（2026-09-11 船长：设定裁定 8「**立『核心舱段级』代表位**（一具接近
    // 完好的巨构为目标）」；2026-09-12 船长「**你先完成所有代表卡**」）——填上 E 段（80~96）的唯一空缺：
    // 全表 15 条舰级里**只有「核心舱段」没有任何卡引用**，本卡即它的代表卡。
    // - **单舰**：一具"接近完好"的巨构（不配僚机——体量感靠它自己）；
    // - **数值对齐 E 段**（实测参照：噬口猎杀令 80 = 血 2,766／单发 501／85 万；坟场守墓者 88 =
    //   血 3,960／单发 350／110 万）：本卡 **血 3,400／总单发 560／奖金 100 万**，落在两者之间；
    // - **机群占比 0.6**（与泰坦残骸勘探同口径首版值）：总单发 560 拆成 **炮台 224 + 机群 3 架 ×112**；
    // - **长战**（`combatSeconds: 150`）：族格"撑到最后"的极致落点。
    ships: [
      {
        ship: FOE_SHIP_CORE_SECTION, // 单舰：一具接近完好的巨构（**旗舰档**精锐位）
        count: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_hpMul_input0") / FOE_SHIP_CORE_SECTION.hp, // = 3400/3920（T5 舰级基线 3,920 ⇒ 卡面实收仍是 3,400）
        // **火力 +20%（2026-09-12 船长）**：旧口径 T = round(546×1.082) + 3×round(25×1.082) = 591 + 81
        // = **672**（原 560）⇒ 按 0.6 拆成 炮台 269 / 机群 3 架 ×135·134·134
        dmgMul: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_dmgMul"),
        droneFireShare: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_droneFireShare"),
        // **总火力锚点 672**（船长 2026-09-12「架数变多、总火力不动」）——常态出击数上到 10 架后，
        // 总量仍钉在 **672**（炮台 269 / 机群 10 架 ×41~40）；不写锚点的话架数会把总量推到 861。
        firepowerAnchor: enemyParameterOf(bountiesParameters, "ano-core-section", "ships_0_firepowerAnchor"),
      },
    ],
    galaxyId: 'galaxy-auro', // 奥罗荒环（2026-09-12 船长「将所有巨构移动到奥罗荒环」⇒ E 族三卡同域）
    threat: enemyParameterOf(bountiesParameters, "ano-core-section", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-core-section", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 族规「中距为主」（舰级已解除期望距离钉住 ⇒ 交距 = 带内插值 0.55 × 10,000 ≈ 5,545m）
    defProfile: 'armor',
    dmgMix: { explosive: enemyParameterOf(bountiesParameters, "ano-core-section", "dmgMix_explosive"), kinetic: enemyParameterOf(bountiesParameters, "ano-core-section", "dmgMix_kinetic") }, // 爆炸 60% + 动能 40%（E 族族格；船长 2026-09-19 改判）
    standingReq: enemyParameterOf(bountiesParameters, "ano-core-section", "standingReq"), // 与 噬口猎杀令（80）同档；低于 坟场守墓者 / 虚海守望者（88，12）
    standingGain: enemyParameterOf(bountiesParameters, "ano-core-section", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-core-section", "rewardIsk"), // 威胁 115 段：介于 噬口 850,000（87）与 坟场 1,100,000（87）之间
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-core-section", "combatSeconds"),
    description:
      '深渊航道最深处立着一具几乎完好的巨构——残存的自动程序仍在运转，警戒机群仍在巡逻。协会为能拆开它的人开出了长期悬赏。',
  }
