/**
 * 数值平衡默认值（唯一调参处）。
 * 说明：系数/概率集中在 balance.ts；"加成作用于哪个技能"通过技能 id 与数据表约定，
 * 若日后给技能改名，需同步 data 与这里。
 */
import type { BalanceConfig } from './types'

export const DEFAULT_BALANCE: BalanceConfig = {
  mining: {
    yieldSkillId: 'mining', // 采矿技术：每级 +6% 产量
    yieldPerLevel: 0.06,
    timeSkillId: 'mining-frigate', // 采矿护卫舰操作：每级 -3% 循环时间
    timePerLevel: 0.03,
    /** T4 显式行程基准（满载/返航单程的进出港基础）：本地矿带 120 秒；
     *  出航（空船）时跃迁×2 → 出航单程减半（60 秒）；远带单程 = 航程 + 120 秒 */
    localLegMs: 120 * 1000,
  },
  refining: {
    // 2026-09-08 船长再定（工业工位收益体检）：无技能净率抬到 ≈+20%（基础倍率 100% → 120%），
    // 技能本身每级加成在原值上下调约 20% → 精炼学 +6%、高级回收 +3%（就近取整），满级倍率 165%
    baseRate: 1.2,
    rateSkillId: 'refining', // 精炼学：产出倍率每级 +6%
    ratePerLevel: 0.06,
    secondRateSkillId: 'reprocessing', // 高级回收处理：产出倍率每级 +3%
    secondRatePerLevel: 0.03,
  },
  manufacturing: {
    timeSkillId: 'industry', // 工业理论：每级 -4% 制造时间（2026-09-08 技能加成下调约 20%，原 -5%）
    timePerLevel: 0.04,
  },
  combat: {
    basePower: 10, // 初始舰炮火力 10
    gunnerySkillId: 'gunnery', // 炮术学：每级 +2 火力
    powerPerLevel: 2,
    minWinChance: 0.05, // 胜率最低 5%（再低就别去送了）
    maxWinChance: 0.95,
    defeatCostRatio: 0.5, // 失利：维修费 = 期望奖励 × 50%
    durabilityLossMin: 0.15, // 每次失利扣耐久 15%~30%
    durabilityLossMax: 0.3,
    minAbandonChance: 0.03, // 弃船率下限 3%
    maxAbandonChance: 0.5, // 弃船率上限 50%
    agilityEscapeFactor: 0.4, // 动力减免：× (1 - 0.4×agility)
    durabilityFactor: 0.6, // 耐久惩罚：× (0.4 + 0.6×durability)
  },
  aiCore: {
    skillId: 'ai-expert', // 共用「AI 核心上限」技能：LvN = 可同时启用 N 枚 AI 核心（AI 副船任务与站内 AI 设施共用；后续上限技能在 ai.ts aiCoreCap 叠加）
    // 2026-09-08 船长定：工业专用扩容——industrySkillIds 内技能每级 +industrySlotsPerLevel 枚
    // 「工业专用 AI 工位」（只对站内精炼炉/回收炉/制造线生效，不增加 AI 副船任务上限；
    // 将来新增"工业 AI 专用扩容技能"只需往该表追加 id）
    industrySkillIds: ['industrial-ai-cap'],
    industrySlotsPerLevel: 2,
    dispatchSkillId: 'ai-core-dispatch', // AI 核心调度学（卷B3⑩，2026-09-08 船长定）：核心驱动作业效率累加区
    dispatchPerLevel: 0.02, // 每级 +2 个百分点（基础 40% → 满级 50%；伽马 60%/贝塔 70%/阿尔法 85%，封顶 100%）
    basicPriceIsk: 25_000, // 基础核心直购价
    efficiency: { basic: 0.4, gamma: 0.5, beta: 0.6, alpha: 0.75 },
    drops: [
      { minThreat: 24, rewards: [{ type: 'gamma', chance: 0.12 }] },
      { minThreat: 35, rewards: [{ type: 'gamma', chance: 0.18 }] },
      { minThreat: 45, rewards: [{ type: 'beta', chance: 0.1 }] },
      { minThreat: 60, rewards: [{ type: 'beta', chance: 0.15 }] },
      { minThreat: 90, rewards: [{ type: 'beta', chance: 0.15 }, { type: 'alpha', chance: 0.08 }] },
    ],
  },
  repair: {
    // P2 定稿（2026-09-05）：维修费 =（甲缺失+结构缺失 HP）× perHpCost × 科技档权重（L1×0.4…L4×1.4）
    perHpCost: 300,
  },
  // 富矿脉基础触发率 3%/分钟（卷B2⑥，2026-09-08 船长定稿：掷点按"循环占用分钟数"缩放；
  // 命中后连续 2 循环 ×3；0 = 禁用，测试用它关富矿保 rng 时序）
  richVeinChance: 0.03,
  // 完好舰体命中率 0.08%/打捞分钟（卷B3⑨，2026-09-08 船长定稿：命中 = 当场直发该敌群回收彩头；
  // 基础件均价 33.5k 锚下 ≈ 4×MK2 打捞器满级 1 次/80 分钟 ≈ +6~8k/h 惊喜线；0 = 禁用）
  intactHullRatePerMin: 0.0008,
  intactMk2Chance: 0.04, // 命中后的低安 MK2 层（sec<0；默认 MK2 池均价 ≈251k → 大奖层频率压低）
  travelEventChance: 0.3, // 远征出发 30% 概率遇到途中事件
  // 远征奖金浮动（2026-09-10 船长拍板**取消**：玩家反馈"卡片赏金与实际到账不一样"——
  // 现口径 = 卡片展示值即到账值；唯一随机性保留给"情报彩蛋" +10%，且该条会在日志里说明）
  rewardJitter: 0,
  // B1 低安遭遇（2026-09-04 定稿：占用随机事件时机——事件线到点判定；到达缓冲 5 分钟；
  // 到点遇袭率 sec=0 → 5%、sec=−1 → 20%；实测后回调）
  encounter: {
    highSecSafe: 0.5, // sec ≥ 0.5（高安）不掷
    zoneCooldownMs: 300_000, // 遭遇后同星系 5 分钟冷却（区域事件不叠加）
    inviteWaitMs: 60_000, // 在线邀约 60 秒未响应 → 自动文字结算
    entryBufferMs: 300_000, // 到达低安地点后 5 分钟缓冲：期间绝不遇袭
    ambushChanceAtZero: 0.05, // 事件到点遇袭率基线（sec = 0）
    ambushChancePerSec: 0.15, // sec 每降 1.0 → +15%（线性，封顶 ~27%）
    scanAmbushMul: 1.5, // 低安扫描中：遇袭概率 ×1.5（封顶 0.9；船长 2026-09-05 定，扫描即暴露、无入场缓冲）
    duraLossMin: 0.05,
    duraLossMax: 0.15, // 受损档：耐久 −5%~15%（底 clamp 5%）
    lootTakenMaxPct: 0.3, // 被抢：至多 30% 船上货
    iskTakenMaxPct: 0.05, // 无货被抢：至多 5% 钱包
    lootFracOfBounty: 0.5, // 2026-09-09 船长定：击退/胜利缴获 = 当地悬赏敌群赏金 ×50%（旧档兜底 = 威胁 ×1）
  },
  travel: {
    warpRefAus: 3.0, // 基准跃迁速度：沙猫级 3.5 → 航程 ×0.857（快 14%）；2.8 慢船 → ×1.07
    minFactor: 0.35, // 时间因子下限（再快也至少保留 35% 时间）
    skillIds: ['navigation', 'warp-drive-operation', 'acceleration-control'], // 航行加速技能族
    cutPerLevel: 0.04, // 每个技能每级 -4%（三技能满级乘算 → ×0.512）
  },
  market: {
    tickMs: 60_000, // 刷单/撮合窗口 60 秒
    orderLifeMs: { common: 20 * 60_000, rare: 9 * 60_000, exotic: 6 * 3_600_000 }, // rare 实发 ×RARE_LIFE_MUL=36 分钟；exotic 6h（2026-09-06 船长定）
    poolRegenHalfMs: 30 * 60_000, // 池回归半程 30 分钟
    commonFlowPerWindow: 1, // 常驻商品每窗口供需两侧各补 1 档（数量由目录流量定）
    rareWindowChance: 0.1, // 遗留字段（P2 配额制后 unused，保留兼容数据/档；见 types.ts 注）
    exoticWindowChance: 0.008, // 限定商品每抽取窗（10 分钟）0.8% 独立掷骰（约每件每 20.8h 一轮；2026-09-06 船长定窗口 10 分钟）
    rareTier3Weight: 0.25, // 数字稀有度 3 档刷新权重乘子（2 档 = 1；2026-09-09 初值，market-rarity-sim 校准中）
    blueprintWeight: 0.05, // 蓝图书权重乘子（2026-09-10 船长定：50% → 5%，稀有抽取 + 奇货掷骰两渠道都乘）
    blueprintLifeMs: 6 * 3_600_000, // 蓝图书稀有单寿命 6 小时（2026-09-10 船长定：权重降到 5% 后 36 分钟太短，玩家只会错过）
    shockTriggerRatio: 2, // 窗口净成交量 > 参考量 ×2 时触发冲击
    shockPerTrigger: 0.05, // 每次触发 +5% 方向偏移（无上限叠加，见"冲击动量"）
    shockDecayHalfMs: 6 * 60_000, // 冲击衰减半程 6 分钟
    noiseHalfLifeMs: 4 * 3_600_000, // 慢速噪声均值回归半程 4 小时（让常驻行情即使无人交易也温和起伏）
    noiseStep: 0.04, // 每窗口随机游走增量半幅（约 4%/分钟尺度，稳态 ±15% 左右；叠加冲击/压力后形成真实曲线）
    minPriceRatio: 0.2, // 价格输出下限（相对基准），防归零
    maxPriceRatio: 5, // 价格输出上限（相对基准），防溢出
    digestPerWindow: 0.15, // 内部消化队列每窗口消化 15%（冲突订单随时间推进消化）
    absorbPerPoint: 0.4, // 让利吸收：每折价 1 个百分点放大 +40%（折 5% → ×3、折 10% → ×5 封顶）
    absorbMaxMul: 5, // 让利吸收上限倍数（2026-09-08 船长定：最大约 5 倍常规窗吸收）
    builtSellMulPerSite: 1.5, // 建站收购网络扩容（2026-09-09 船长定：每建成副站 ×1.5，乘法叠加无封顶，仅单件商品卖出侧）
    referenceVolRatio: 1 / 120, // 参考成交量默认 = poolTarget × (1/120)
    salesTaxRate: 0.05, // 贸易税（销售税）5%：卖出成交按成交额征税（挂单/买入不收）
    taxSkillAId: 'accounting', // 会计学：每级 -8% 贸易税
    taxSkillBId: 'trade-negotiation', // 贸易谈判学：每级 -8% 贸易税
    taxCutPerLevel: 0.08, // 两技能各 5 级 → 合计减免 80%（税 5% → 1%）
    // 两侧抢单（2026-09-08 船长定：越线挂单每 60s 窗小概率成交——高挂/低挂 = 赌巡游，慢但可能）
    snatchSellChance: 0.3, // 卖出侧基础命中：压线 0% 溢价时 30%/窗（溢价 10% → ≈16%、+50% → ≈1.5%）
    snatchSellDecay: 6,
    snatchBuyChance: 0.2, // 买入侧基础命中：压线砍价 0% 时 20%/窗（砍 5% → ≈10%、砍 20% → ≈1.2%）
    snatchBuyDecay: 14,
  },
  battle: {
    hitMin: 0, // 命中率开放下限 0%：极端劣势可完全脱靶（不再保底 3%）
    hitMax: 1, // 命中率开放上限 100%：贴脸高加成场合可必中（不再封顶 97%）
    gunneryDmgPerLevel: 0.05, // 炮术学：每级 +5% 单发伤害
    minDistanceM: 200, // 距离下限（贴脸极限）
    // 开战距离 = 双方最远武器射程 + 缓冲；缓冲 = max(100m, 射程×10%)（船长 2026-09-05 拍板：
    // 旧固定 +100m 对远程武器太近——导弹 6200m 开场 100m 即接战，画面还没看清就先挨一轮；
    // 现按射程比例拉开，远程武器有可见的接敌接近窗口）
    openRangeFactor: 1.0,
    openRangePadM: 100,
    openRangePadShare: 0.1,
    // V18B 武器族专精技能（2026-09-05 一号按交接底稿接入）：+5%/级，与炮术学乘算（数值 C4 校准）
    familySkillIds: { turret: 'kinetic-gunnery', missile: 'missile-launching', laser: 'laser-cannon' },
    familySkillPerLevel: 0.05,
    // 舰船属性成长技能（2026-09-05 一号按盘点补；显著档 +5%/级，数值 C4 复核）
    cpuSkillId: 'ship-systems-engineering',
    cpuPerLevel: 0.05,
    speedSkillId: 'vector-maneuvering',
    speedPerLevel: 0.05,
    evasionSkillId: 'evasion-maneuvering',
    evasionPerLevel: 0.05,
    hitSkillId: 'targeting-integration',
    hitPerLevel: 0.05,
    speedFactor: 0.6, // 战斗机动速度 = maxSpeed ×0.6 ×(1 ± agility 修正)
    agilitySpeedBonus: 0.15,
    // C4 血量曲线（2026-09-05 船长拍板：战斗时长预期反推，k=1.6 幂型凸曲线，方案 A=无技能基线）：
    // 敌总血(T) = 参考段火力 × D(T)，D = 5 + 85×((T−6)/90)^1.6（T6→5s … T96→90s，纯对射口径）
    // 参考火力 = 无技能解析对射 DPS（动能制式：鲣鱼3高槽?1×MK1=2.1 待定——当前段表：
    //   ≤16 鲣鱼+1×MK1 2.1 / ≤40 虎鲨+2×MK2 9.7 / >40 鲸王+3×MK3 12.8；跑解析探针生成，船长可微调）
    foeHpCurveDMin: 5,
    foeHpCurveDSpan: 85,
    foeHpCurveExp: 1.6,
    foeHpCurveFloorThreat: 6,
    foeHpCurveSpanThreat: 90,
    foeRefFire: [
      { upToThreat: 16, dps: 2.1 },
      { upToThreat: 40, dps: 9.7 },
      { upToThreat: 9999, dps: 12.8 },
    ],
    foeDpsPerThreat: 0.8, // 敌方总火力 ≈ threat ×0.8（C4 前 1.1）
    foeHitRate: 0.85, // 敌方动能/爆炸武器基础命中（2026-09-08 船长定：普遍高命中；能量=光束必中不消费本值；逐卡 foeHitRate 可覆写做低命中特例）
    foeHitCompMul: 0.62, // 动能/爆炸等效补偿（方案 A 初值：按典型回避 0.22×中距衰减 0.7 折算回旧 0.55 模型，矩阵迭代校准）
    foeReloadMs: 4_000, // 敌方武器装填
    foeFalloff: 0.3, // 敌方命中衰减（maxRange 端点）
    // C4-#3 敌方"虚拟装配"（2026-09-05 船长拍板）：威胁越高全属性越高、侧重随战术风格。
    // 参考船速表 = 玩家船 maxSpeed 同池分段（threat ≤10 对应 T1 级、96+ 对应旗舰级）；
    // 敌速 = 参考段船速 × m_base(threat) × tactic 系数，m_base 0.80→0.95（threat 10→100）
    // ——无推进玩家多数持平/略快；brawl 再 ×1.28 贴脸（2026-09-05 船长确认：普通船不开
    // 加力甩不掉、贴脸怪须快速近身；1.12→1.28，命中失稳由玩家加力自行取舍）
    foeRefSpeedTable: [
      { upToThreat: 10, maxSpeedMps: 220 },
      { upToThreat: 34, maxSpeedMps: 250 },
      { upToThreat: 62, maxSpeedMps: 280 },
      { upToThreat: 88, maxSpeedMps: 300 },
      { upToThreat: 9999, maxSpeedMps: 320 },
    ],
    foeSpeedAtThreat10: 0.8,
    foeSpeedAtThreat100: 0.95,
    // 战术风格速度系数：brawl 贴脸再高（近身使命）；**kite ×0.72（2026-09-05 船长拍板：远程怪
    // 大降速与速度成长——慢速风筝怪可被玩家追上钻近盲，远程压制窗口受玩家速度制约）**
    foeSpeedTacticMul: { brawl: 1.28, orbit: 1.0, kite: 0.72 },
    foeSpeedCapMul: 1.2,
    // 射程成长侧重：近战几乎不变形（靠速度近身）、环绕居中、风筝多增；封顶 = 玩家天花板 13 km + 2 km
    foeRangeGrowMul: { brawl: 0.3, orbit: 0.7, kite: 1.15 },
    foeRangeCapM: 15_000,
    // 敌期望交战距离 = 自身武器带内站位系数（贴脸近端 / 环绕中段 / 风筝远端）——带内必能开火
    tacticDesireFactor: { brawl: 0.2, orbit: 0.55, kite: 0.85 },
    ammoTimeCapMs: 4 * 60_000, // 弹药预载：按 4 分钟最大交战时长估算
    ammoMargin: 1.5, // 预载余量 ×1.5
    maxBattleMs: 10 * 60_000, // 战斗硬上限：打满即判负（2026-09-10 船长定），结算按被迫撤退处理
    /* ═══ 推进器周期爆发（2026-09-10 船长定：持续 60 秒 / 冷却 60 秒 / 开场即启动）═══
     * 推进器不再常驻加成：爆发窗口内按模块档位给速度（模块 speedBonusPct 已改为 0.4/0.8/1.3），
     * 冷却窗口内**一点加成都没有**（回到基础战斗机动速度）。周期由**战斗时钟推导**（见 combat.thrusterPhase），
     * 故不需要任何存档字段、战中重载不丢。动机：原常驻加成让玩家全程快于近战敌 → 距离拔河停在
     * 玩家期望距离（主武器射程中点）而近战敌够不着（复核 §10）。 */
    thrusterBoostMs: 60_000, // 爆发窗口时长（开场 t=0 即进入爆发）
    thrusterCooldownMs: 60_000, // 冷却窗口时长
    /* ═══ 高威胁近战敌突进（2026-09-10 船长定：机动 ×2 / 进射程后维持 2 秒 / 冷却 20 秒）═══
     * 只给「威胁 ≥ 门槛 且 战术 = brawl」的敌卡——治"短射程敌够不着"，长射程敌不给（它们本就打得到）。
     * ⚠ **2026-09-10 船长：暂时先取消实装，仅实现功能** → `foeChargeEnabled` 默认 false，
     *   机制、状态机、参数与界面标记全部就位，但**任何战斗都不会触发**；要启用只改这一个开关。 */
    foeChargeEnabled: false, // 总开关（船长 2026-09-10：机制已实现，暂不实装）
    foeChargeMul: 2.0, // 突进期敌机动倍率（临时加速，仍走距离拔河公式）
    foeChargeMaxHoldMs: 2_000, // 进入自己武器射程后再维持这么久，随后突进结束
    foeChargeCooldownMs: 20_000, // 冷却：这么久内不能再次突进
    foeChargeThreatFloor: 60, // 威胁门槛（与 pdThreatFloor 同口径）
    // P0 承伤持久化：护盾战中被动回充（每秒回满盾的 2%；P2 随流派平衡再校准）
    shieldRegenPerSec: 0.02,
    waveReopenFrac: 0.5, // 多波次转场（2026-09-09 船长建议）：下一波把距离向开战距离回拉 50%（0=原地/1=回满，可随时调）
    // 多波次演出间隔（2026-09-09 船长反馈二轮）：波全灭后等上一波爆炸+残骸演出完整播完再刷下一波。
    // 口径 = 引擎清波刻 → 下一波入场：UI 残骸演出全长 ≈ 致死弹道(≤760ms) + 爆炸(1.7s) + 淡出(0.52s)
    // ≈ 3.0s，再加一拍的检测延迟 → 3300（0=立即；战斗时钟冻结不计入 maxBattleMs 超时）
    waveEnterGapMs: 3_300,
    winSpread: 1.6, // 预估胜率扩散（logit ×1.6）：0.8 → ~0.90 / 0.5 → 0.5 / 0.2 → ~0.10
    aiFavorStrength: 0.3, // AI 远征 favor：模型胜率 0.8 局 → AI 命中 ×1.18 / 敌命中 ×0.82（简单局近必胜）
    killcamMs: 1_500, // 击杀慢镜：胜负后延迟 1.5s 再结算（让最后一击动画+爆炸演出播完）
    // 带伤预警扣分（2026-09-08 船长定：展示胜率 = 原显示 − 预计装甲损耗×0.10 − 预计结构损耗×0.25；
    // 只改展示，实际结算与 AI/模拟预估不变）
    winPenaltyArmorPerFull: 0.1,
    winPenaltyHullPerFull: 0.25,
    /* ═══ 敌舰近防炮（2026-09-10 船长拍板「无人机可被击落」，永久损失制）═══
     * 每艘点防舰**独立**每 pdJudgementMs 判定一次：随机挑一架**正在攻击的放飞无人机**
     * （哨戒机不被打）→ 按 pdAcc 掷命中（守方 = 机型闪避）→ 命中按 pdDmg 走机型三层抗性；
     * 血量归零 = 该架本场击落并**永久损失**（战后从无人机舱清单扣除）。
     * 近防炮**不参与**敌舰对玩家的常规攻击（独立系统，只打无人机）；
     * **不看距离**——放飞出去就在其威胁之下（"毕竟你要飞过去"）。
     * **默认档（2026-09-10 船长：未特意说明的敌舰一律按此算）**
     * = 每 0.5 秒判定一次（pdJudgementMs 500）/ 命中 0.5 / 每发伤害 5；逐舰独立、多舰叠加。 */
    pdThreatFloor: 60, // 点防起始威胁：威胁 < 此值的敌舰不装近防炮
    pdJudgementMs: 500, // 判定周期：每艘点防舰每 0.5 秒判定一次伤害
    pdAcc: 0.5, // 判定命中率（直接减机型闪避；不叠敌方通用命中加成，突出"闪避"价值）
    pdDmg: 5, // 命中单发伤害（走该机型三层抗性）
    // 2026-09-10 船长：**取消单场击落上限**——战斗内可 100% 损坏机群；
    // 战后按回收率找回一部分（基础 20%，无人机回收学满级 50%，见 combat.droneRecoveryRate）
  },
  events: {
    enabled: true, // 随机事件总开关（测试可整体关闭）
    minGapMs: 10 * 60_000, // 事件最短间隔 10 分钟
    maxGapMs: 30 * 60_000, // 事件最长间隔 30 分钟（到点 100% 触发）
    gapPower: 2, // 间隔 = 10 + 20×u² 分钟：越短概率越低，越接近 30 分钟越可能到期
    miscWeight: 40, // 宇宙杂讯/奇遇
    voyageWeight: 35, // 航行叙事（舰桥日志/航道见闻）
    marketShockWeight: 15, // 市场行情突变动（冲击/池/大宗单）
    marketOrderWeight: 10, // 市场奇货（稀有品突现供应单 / 极高价收购单）
    exploreBoost: 1.0, // 扫描探索作业期间事件倒计时 ×2（V13：探索时段更"热闹"）
    exploreBonusPerGalaxy: 0.1, // 随机事件现金 · 每已探索星系 +10%（2026-09-10 船长）
    exploreBonusCap: 1, // 探索加成封顶：最多 ×2
  },
}
