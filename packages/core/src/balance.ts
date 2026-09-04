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
    perM3Cost: 60, // 维修费 = 缺失耐久 × 货舱 m³ × 60 ISK
  },
  richVeinChance: 0.01, // 每循环 1% 富矿脉（该循环产量翻倍）
  travelEventChance: 0.3, // 远征出发 30% 概率遇到途中事件
  rewardJitter: 0.15, // 远征奖金浮动 ±15%
  // B1 低安遭遇（初稿数值：150s 窗口；sec=−1 → ≈6%；实测后回调）
  encounter: {
    highSecSafe: 0.5, // sec ≥ 0.5（高安）不掷
    windowMs: 150_000,
    chanceAtZero: 0.01, // sec=0 → 1%
    chancePerSec: 0.05, // sec 每降 1.0 → +5%（线性，到 −1 封顶约 6%）
    zoneCooldownMs: 300_000, // 事件后同星系 5 分钟不再判
    inviteWaitMs: 60_000, // 在线邀约 60 秒未响应 → 自动文字结算
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
    sigBaseM: 60, // 信号半径 60m 为基准：更小 → 回避修正上浮（难打中）
    sigMin: 0.4,
    sigMax: 1.4,
    scanBaseMm: 600, // 扫描分辨率 600mm 为基准：更大 → 命中加成发挥更足
    scanMin: 0.6,
    scanMax: 1.5,
    gunneryDmgPerLevel: 0.05, // 炮术学：每级 +5% 单发伤害
    minDistanceM: 200, // 距离下限（贴脸极限）
    // 开战距离 = 双方最远武器射程 +100m：开局几乎即时进入接战，缩短无谓等待
    openRangeFactor: 1.0,
    openRangePadM: 100,
    speedFactor: 0.6, // 战斗机动速度 = maxSpeed ×0.6 ×(1 ± agility 修正)
    agilitySpeedBonus: 0.15,
    foeHpPerThreat: 2.6, // 敌方总血量 ≈ threat ×2.6（初值，校准脚本核对）
    foeEscortThreatFrac: 0.5, // 僚机每架 = threat ×0.5
    foeDpsPerThreat: 1.1, // 敌方总火力 ≈ threat ×1.1
    foeHitRate: 0.55, // 敌方武器基础命中
    foeReloadMs: 4_000, // 敌方武器装填
    foeFalloff: 0.3, // 敌方命中衰减（maxRange 端点）
    foeSpeedBaseMps: 120, // 敌方速度基准（按体积修正）
    // 敌期望交战距离 = 自身武器带内站位系数（贴脸近端 / 环绕中段 / 风筝远端）——带内必能开火
    tacticDesireFactor: { brawl: 0.2, orbit: 0.55, kite: 0.85 },
    ammoTimeCapMs: 4 * 60_000, // 弹药预载：按 4 分钟最大交战时长估算
    ammoMargin: 1.5, // 预载余量 ×1.5
    maxBattleMs: 10 * 60_000, // 战斗硬上限：超时按剩余血量比判胜
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
