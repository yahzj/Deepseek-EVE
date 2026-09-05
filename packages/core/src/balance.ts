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
    minTimeRatio: 0.6, // 循环时间最多缩短 40%
    /** T4 显式行程基准（满载/返航单程的进出港基础）：本地矿带 120 秒；
     *  出航（空船）时跃迁×2 → 出航单程减半（60 秒）；远带单程 = 航程 + 120 秒 */
    localLegMs: 120 * 1000,
  },
  refining: {
    baseRate: 0.5, // 基础收率 50%
    rateSkillId: 'refining', // 精炼学：每级 +8%
    ratePerLevel: 0.08,
    secondRateSkillId: 'reprocessing', // 高级回收处理：每级 +4%
    secondRatePerLevel: 0.04,
    maxRate: 0.95, // 上限 95%
  },
  manufacturing: {
    timeSkillId: 'industry', // 工业理论：每级 -5% 制造时间
    timePerLevel: 0.05,
    minTimeRatio: 0.4, // 制造时间最多缩短 60%
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
    skillId: 'ai-expert', // 人工智能专家：LvN = 可同时指挥 N 艘副船
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
  richVeinChance: 0.01, // 每循环 1% 富矿脉（该循环产量翻倍）
  travelEventChance: 0.3, // 远征出发 30% 概率遇到途中事件
  rewardJitter: 0.15, // 远征奖金浮动 ±15%
  // B1 低安遭遇（2026-09-04 定稿：占用随机事件时机——事件线到点判定；到达缓冲 5 分钟；
  // 到点遇袭率 sec=0 → 5%、sec=−1 → 20%；实测后回调）
  encounter: {
    highSecSafe: 0.5, // sec ≥ 0.5（高安）不掷
    zoneCooldownMs: 300_000, // 遭遇后同星系 5 分钟冷却（区域事件不叠加）
    inviteWaitMs: 60_000, // 在线邀约 60 秒未响应 → 自动文字结算
    entryBufferMs: 300_000, // 到达低安地点后 5 分钟缓冲：期间绝不遇袭
    ambushChanceAtZero: 0.05, // 事件到点遇袭率基线（sec = 0）
    ambushChancePerSec: 0.15, // sec 每降 1.0 → +15%（线性，封顶 ~27%）
    duraLossMin: 0.05,
    duraLossMax: 0.15, // 受损档：耐久 −5%~15%（底 clamp 5%）
    lootTakenMaxPct: 0.3, // 被抢：至多 30% 船上货
    iskTakenMaxPct: 0.05, // 无货被抢：至多 5% 钱包
    foePowerMin: 0.6,
    foePowerMax: 1.05, // 遭遇强度 ≈ 承担船火力 × 0.6~1.05
    lootIskMin: 0.2,
    lootIskMax: 0.6, // 击退缴获 = 威胁 × 20%~60%
  },
  travel: {
    warpRefAus: 3.0, // 基准跃迁速度：沙猫级 3.5 → 航程 ×0.857（快 14%）；2.8 慢船 → ×1.07
    minFactor: 0.35, // 时间因子下限（再快也至少保留 35% 时间）
    skillIds: ['navigation', 'warp-drive-operation', 'acceleration-control'], // 航行加速技能族
    cutPerLevel: 0.04, // 每个技能每级 -4%（三技能满级乘算 → ×0.512）
  },
  market: {
    tickMs: 60_000, // 刷单/撮合窗口 60 秒
    orderLifeMs: { common: 20 * 60_000, rare: 9 * 60_000, exotic: 4 * 60_000 },
    poolRegenHalfMs: 30 * 60_000, // 池回归半程 30 分钟
    commonFlowPerWindow: 1, // 常驻商品每窗口供需两侧各补 1 档（数量由目录流量定）
    rareWindowChance: 0.1, // 稀有商品每窗口 10% 概率刷出供应单
    exoticWindowChance: 0.008, // 限定商品每窗口 0.8% 概率刷出供应单（约 2 小时一件）
    shockTriggerRatio: 2, // 窗口净成交量 > 参考量 ×2 时触发冲击
    shockPerTrigger: 0.05, // 每次触发 +5% 方向偏移（无上限叠加，见"冲击动量"）
    shockDecayHalfMs: 6 * 60_000, // 冲击衰减半程 6 分钟
    noiseHalfLifeMs: 4 * 3_600_000, // 慢速噪声均值回归半程 4 小时（让常驻行情即使无人交易也温和起伏）
    noiseStep: 0.04, // 每窗口随机游走增量半幅（约 4%/分钟尺度，稳态 ±15% 左右；叠加冲击/压力后形成真实曲线）
    minPriceRatio: 0.2, // 价格输出下限（相对基准），防归零
    maxPriceRatio: 5, // 价格输出上限（相对基准），防溢出
    digestPerWindow: 0.15, // 内部消化队列每窗口消化 15%（冲突订单随时间推进消化）
    referenceVolRatio: 1 / 120, // 参考成交量默认 = poolTarget × (1/120)
    salesTaxRate: 0.05, // 贸易税（销售税）5%：卖出成交按成交额征税（挂单/买入不收）
    taxSkillAId: 'accounting', // 会计学：每级 -8% 贸易税
    taxSkillBId: 'trade-negotiation', // 贸易谈判学：每级 -8% 贸易税
    taxCutPerLevel: 0.08, // 两技能各 5 级 → 合计减免 80%（税 5% → 1%）
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
    // 参考火力 = 无技能解析对射 DPS（动能制式：隼枭3高槽?1×MK1=2.1 待定——当前段表：
    //   ≤16 隼枭+1×MK1 2.1 / ≤40 虎鲨+2×MK2 9.7 / >40 鲸王+3×MK3 12.8；跑解析探针生成，船长可微调）
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
    foeHitRate: 0.55, // 敌方武器基础命中
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
    maxBattleMs: 10 * 60_000, // 战斗硬上限：超时按剩余血量比判胜
    // P0 承伤持久化：护盾战中被动回充（每秒回满盾的 2%；P2 随流派平衡再校准）
    shieldRegenPerSec: 0.02,
    winSpread: 1.6, // 预估胜率扩散（logit ×1.6）：0.8 → ~0.90 / 0.5 → 0.5 / 0.2 → ~0.10
    aiFavorStrength: 0.3, // AI 远征 favor：模型胜率 0.8 局 → AI 命中 ×1.18 / 敌命中 ×0.82（简单局近必胜）
    killcamMs: 1_500, // 击杀慢镜：胜负后延迟 1.5s 再结算（让最后一击动画+爆炸演出播完）
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
    exploreBoost: 1.0, // 扫描探索期间事件倒计时 ×2（V13：探索时段更"热闹"）
  },
}
