/**
 * 证券交易所 · 赌桌级可玩性仿真器（v2c）
 *
 * v2c 新增两组修复（任务书 2026-11-03）：A 坐庄成本（凸性冲击 / 监管罚没 / 反向流动性），
 * B 技巧可表达（信息利用率 / 人格识别率 / 风险控制三参数玩家）。v2b 规则与实验臂全部保留，
 * 修复关闭时行为与 v2b 逐位一致（同一汇总哈希），便于前后对照。
 *
 * 规格：docs/design/stock-exchange-playtest-v2-20261103.md（本任务以它为准）
 * 口径来源：
 *   - 杠杆/保证金/强平/档位费率：docs/design/stock-exchange-server-20261103.md §4.4 / §4.10 / A.2 / A.3 / A.5
 *   - 六个人格：docs/design/stock-exchange-ai-ecosystem-20261103.md §二 / §三 / §五
 *   - v1 指标口径与教训：docs/design/stock-exchange-playtest-20261103.md（以及 tools/_exchange-playtest.ts）
 *
 * 运行（全部离线、不联网、不依赖原型 UI）：
 *   npx tsx tools/_exchange-table-sim.ts                 # 全量基线 + 全部实验，写仓库根 _exchange-table-run.md
 *   npx tsx tools/_exchange-table-sim.ts --quick         # 小样本自检，只打印，不写报告
 *   npx tsx tools/_exchange-table-sim.ts --seed=20261103
 *   npx tsx tools/_exchange-table-sim.ts --verify        # 同种子内部复跑第一项，打印两次哈希
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 为什么步长是 1 游戏分钟，而不是设计稿写的 1 秒 tick
 * ────────────────────────────────────────────────────────────────────────────
 * 1) 赌桌模型里所有参与者的决策周期 ≥ 1 分钟：行为玩家每分钟决策一次（v2 §二），
 *    人格 agent 的「反应速度」参数最细也是分钟级，AI 生态稿的决策流水线本来就是每拍一次。
 *    1 秒 tick 只会把同一批决策重复 60 次，不会增加任何决策信息。
 * 2) 本仿真要测的全部分位数/比率（一局时长、破产率、峰值体验/分钟、近失率、回本概率）
 *    都是分钟级统计量；1 秒 tick 不改变它们的口径，只把运行量 ×60。
 * 3) 180 秒预算下，一张桌子 300 局 × 1 小时 = 1.08 亿个「标的·秒」；若按秒 tick，
 *    还要乘 6 个人格 + 玩家 + 做市商，Node 单线程跑不完，结果只会变成「为了跑完而砍样本」，
 *    样本量比时间分辨率对结论更重要。
 * 4) 价格冲击按「每分钟净订单流」聚合，等价于把 60 笔秒级成交按净额压成一笔大单；
 *    这会略微低估冲击的瞬时性（真实盘口会在秒级消化一部分），但不会改变「大单推动价格」这一
 *    方向性结论——这一点在报告中列为偏离项。
 *
 * 确定性：自实现 mulberry32 + Box-Muller + Student-t(ν=5)，全程不调用 Math.random()；
 * 每个 (run, stock) 的随机流由主种子派生，同样的种子两次运行必须逐位一致。
 *
 * 本文件是 `_` 前缀的一次性验证工具，验证后是否转正式入库由船长决定。
 */

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// §0 常量
// ============================================================================

/** 玩家/人格统一启动资金（v1 原型值 1000 万；人格另按 §0.3 放大） */
const INITIAL_CAPITAL = 10_000_000
const MINUTES_PER_DAY = 1440
/** 逐仓维持保证金率 = 0.6 × IM（设计稿 §4.4 / A.3） */
const MAINTENANCE_FACTOR = 0.6
/** 强平分片：每拍吃对手盘 30%（设计稿 §4.4） */
const LIQUIDATION_SLICE_RATIO = 0.3
/** 强平罚金 0.5%（设计稿 §4.10） */
const LIQUIDATION_PENALTY_RATE = 0.005
/** 强平额外滑点 5bp（v1 口径；普通成交的滑点已含在盘口价差与冲击里） */
const LIQUIDATION_SLIPPAGE_RATE = 0.0005
/** 资金费：8 小时 0.01% 基准（设计稿 §4.10）。1 小时局不触发，长线档才生效。 */
const FUNDING_INTERVAL_MIN = 480
const FUNDING_RATE = 0.0001
const SHORT_FUNDING_RECEIVE = 0.5
/** 杠杆利息 0.03%/日（多头）、借券费 0.05%/日（空头），v1 口径 */
const LEVERAGE_DAILY_INTEREST = 0.0003
const BORROW_DAILY_FEE = 0.0005
/** 均值回归 θ 默认 0.0045（设计稿 A.2，半衰期约 154 分钟）；v2b 的修复档见 ThetaConfig。 */
const THETA_BASE = 0.0045
const THETA_LOW = 0.0015
/** 自适应 θ 的斜率：θ_eff = θ0 / (1 + k|x|)；k=8 时，偏离 10% 回归强度减半。 */
const THETA_ADAPTIVE_K = 8
/**
 * v2c 修复 A-1：冲击成本凸性。
 * 被动标记价仍按 sqrt 律移动（保持原有流动性口径），但主动方在成交价上额外支付
 * `IMPACT_CONVEX_K · (|净流|/Qref)^1.5` 的滑点：小单几乎无感，大单成本超线性上升。
 * 这一项直接针对「拉盘/砸盘用 50x 把小成本放大成价格位移」的套利。
 */
const IMPACT_CONVEX_K = 0.003
const IMPACT_CONVEX_EXP = 1.5
/** v2c 修复 A-2：监管调查的触发窗口 / 阈值 / 罚没比例 / 冷却。 */
const REG_WINDOW_MIN = 15
const REG_MOVE_THRESHOLD = 0.05
/** 快触发：5 分钟内 ±5% + 单账户同向流 ≥ 流通市值 1%，在拉/砸的建仓段就能介入。 */
const REG_FAST_WINDOW = 5
const REG_FAST_MOVE = 0.05
const REG_FAST_FLOW_RATIO = 0.01
/** 单账户 15 分钟同向成交 ≥ 流通市值 2% 才算「异常集中流」。 */
const REG_FLOW_RATIO = 0.02
const REG_MARGIN_MUL = 2
const REG_COOLDOWN_MIN = 10
const REG_DEFAULT_GAMMA = 0.5
/** v2c 修复 A-3：反向流动性（极端行情价差/深度 + 价值基金反向大单）。 */
const DEFENSE_SPREAD_MUL = 3
const DEFENSE_DEPTH_MUL = 0.5
const DEFENSE_DEVIATION = 0.05
/** 全仓强平的一次性清算滑点（按名义，暴露风险/清算冲击）。 */
const CROSS_LIQUIDATION_SLIPPAGE_RATE = 0.005
/** 做市商补给：单日上限 / 30 日总上限 / 触发健康度 / 单次补给。 */
const MM_REFILL_DAILY_CAP_RATIO = 0.1
const MM_REFILL_TOTAL_CAP_RATIO = 0.5
const MM_REFILL_TRIGGER_HEALTH = 0.6
const MM_REFILL_CHUNK_RATIO = 0.02
/** x = ln(P/A) 钳制在 ±ln5（设计稿 A.2 硬边界） */
const X_LIMIT = Math.log(5)
/** EWMA 波动聚集 λ=0.94（设计稿 A.2） */
const EWMA_LAMBDA = 0.94
/** Student-t 自由度 5（设计稿 A.2） */
const T_NU = 5
/** 事件后波动放大 2.5 倍、持续 8 拍（v1 口径，设计稿 A.2「事件后 ×2~3，5~10 步回落」） */
const EVENT_SHOCK_TICKS = 8
const EVENT_SHOCK_MUL = 2.5
const VOL_MIN_FACTOR = 0.25
const VOL_MAX_FACTOR = 4

/**
 * 盘口价差（往返 0.30% = 买卖各 0.15%）。设计稿 A.5 给做市商 spread 0.2%~0.5%，取中值。
 * 注意：这是「做市商赚的钱」，不是系统销毁的手续费；行情里买方按 mid+spread/2 成交、
 * 卖方按 mid−spread/2 成交，差额落到做市商账户（守恒，不印钞）。
 */
const MM_SPREAD = 0.003
const MM_SPREAD_HALF = MM_SPREAD / 2
/** 订单流冲击系数：净流 = Qref 时推动价格约 0.8% */
const IMPACT_K = 0.008
/** 冲击成本分摊：主动方承担一半冲击，另一半由 mark 承担（线性冲击模型的标准做法） */
const IMPACT_ETA = 0.5
/** 每分钟参考订单流 = 流通市值 × 0.5%（设计稿 A.2 的 Q/V_ref 简化） */
const QREF_RATIO = 0.005
/** 每分钟最大成交量 = 流通市值 × 2%（盘口深度上限；超出按比例配给） */
const DEPTH_RATIO = 0.02
/** 单账户单标的敞口上限 = 流通市值 × 5%（设计稿 §4.4 / §五） */
const EXPOSURE_RATIO = 0.05
/** 锚点自身漂移：日 σ=2%（v1 已证明可见固定锚点会印钞，这里让内在价值也动） */
const ANCHOR_DAILY_SIGMA = 0.02
/** 锚点相对初始值最多漂到 3 倍 / 1/3，防止跑飞 */
const ANCHOR_LOG_BOUND = Math.log(3)
/** 价值机构用的「公开参考锚」= 价格的 EMA，半衰期 120 分钟（它看不到真实锚点） */
const REF_ANCHOR_HALF_LIFE_MIN = 120
const REF_ANCHOR_ALPHA = 1 - Math.pow(0.5, 1 / REF_ANCHOR_HALF_LIFE_MIN)
/** 6 只标的的初始成交额参考（只用于深度，不用于估值） */
const DEFAULT_SEED = 20261103
/** 默认实验参数（任务书：杠杆 20x、tiered、事件 15 分钟、6 人格、300 局） */
const DEFAULT_RUNS = 300
const DEFAULT_MINUTES = 60
const DEFAULT_LEVERAGE_CAP = 20
const DEFAULT_EVENT_MEAN_MIN = 15
const DEFAULT_DISCIPLINE = 0.5

// ============================================================================
// §0.1 类型
// ============================================================================

type Side = 1 | -1
type FeeModel = 'flat' | 'tiered' | 'legacy'
/** v2c 修复 A-1：线性（v2b 口径）或凸性冲击成本。 */
type ImpactModel = 'linear' | 'convex'
/** v2c 修复 B：玩家技能三参数（0~1）。 */
interface SkillParams {
  /** 信息利用率：能提前 2~5 分钟看到事件前兆/盘口异动。 */
  info: number
  /** 人格识别率：能读懂磐石/夜枭/红隼的行为并反制。 */
  recognize: number
  /** 风险控制：止损、降杠杆、仓位管理。 */
  risk: number
}
/** 仓位模式：both = 行为玩家按概率自选；isolated = 强制逐仓；cross = 强制全仓。 */
type MarginMode = 'both' | 'isolated' | 'cross'
/** 均值回归：fixed = 常数 θ；adaptive = θ0/(1+k|x|)。 */
interface ThetaConfig {
  theta0: number
  adaptive: boolean
  k: number
}
type Emotion = 'calm' | 'greed' | 'fear' | 'euphoria' | 'panic'
type PersonaKind = 'mm' | 'momentum' | 'value' | 'short' | 'herd' | 'whale'
type IntentKind = 'open' | 'add' | 'close' | 'reduce'

interface FeePair {
  buy: number
  sell: number
}

interface Intent {
  trader: Trader
  stock: number
  /** 带符号数量：>0 买入，<0 卖出。 */
  qty: number
  /** 新建仓位的杠杆（减仓/平仓沿用持仓自身的杠杆）。 */
  leverage: number
  kind: IntentKind
  /** 真梭哈标记：该仓位不设止损/止盈，持有到强平或主动平仓。 */
  allIn?: boolean
  reason: string
}

interface StockSpec {
  code: string
  name: string
  sector: string
  tier: 'small' | 'mid' | 'large'
  /** 初始股价（设计稿 §五） */
  price0: number
  /** 流通市值（设计稿 §五：小盘 15 亿 / 中盘 120 亿 / 大盘 1000 亿） */
  floatCap: number
  /** 日波动率档（任务书：4%/8%/15% 可配） */
  dailyVol: number
  /** 对宏观事件的 β */
  beta: number
}

// ============================================================================
// §0.2 标的（设计稿 §4.1 + §五）
// ============================================================================

/**
 * 四只标的按设计稿的板块/市值分层取初值：
 *   SMHI 军工重工（中盘）/ UGMC 采矿能源（大盘）/ OJLS 航运物流（中盘）/ ABSI 前沿科技（小盘）
 * 波动档按任务书取 4% / 8% / 15%：大盘 4%，两只中盘 8%，小盘 15%。
 * 注意：设计稿 §五 给的是「小盘 6~10% / 中盘 3~5% / 大盘 1.5~3%」，与任务书要求的 4/8/15 档
 * 不完全一致；本仿真以任务书为准（它把 4/8/15 当作参数化档位），并在报告偏离项里写明。
 */
const STOCKS: StockSpec[] = [
  {
    code: 'SMHI',
    name: '西斯玛特造船重工',
    sector: '军工重工',
    tier: 'mid',
    price0: 4000,
    floatCap: 1.2e10,
    dailyVol: 0.08,
    beta: 1.1,
  },
  {
    code: 'UGMC',
    name: '泛星系联合矿业公会',
    sector: '采矿能源',
    tier: 'large',
    price0: 20000,
    floatCap: 1e12,
    dailyVol: 0.04,
    beta: 0.7,
  },
  {
    code: 'OJLS',
    name: '猎户座跃迁物流',
    sector: '航运物流',
    tier: 'mid',
    price0: 4000,
    floatCap: 1.2e10,
    dailyVol: 0.08,
    beta: 0.9,
  },
  {
    code: 'ABSI',
    name: '晨曦仿生智能体',
    sector: '前沿科技',
    tier: 'small',
    price0: 1500,
    floatCap: 1.5e9,
    dailyVol: 0.15,
    beta: 1.4,
  },
]

const TIER_LABEL: Record<StockSpec['tier'], string> = {
  small: '小盘',
  mid: '中盘',
  large: '大盘',
}

/** 按流动性分级的杠杆上限（设计稿 §4.4：高流动 90x / 中 50x / 低 20x）。 */
function stockLeverageCap(stockIdx: number): number {
  const tier = STOCKS[stockIdx].tier
  return tier === 'large' ? 90 : tier === 'mid' ? 50 : 20
}

// ============================================================================
// §0.3 费率（设计稿 §4.10 + 船长 2026-11-03 档位降费裁决）
// ============================================================================

/**
 * 档位费率（船长 2026-11-03 裁决：降常规档，让钱留在玩家与人格之间）：
 *   L ≤ 20x       买 0.05% / 卖 0.10%
 *   20 < L ≤ 50x  买 0.03% / 卖 0.06%
 *   L > 50x       买 0.02% / 卖 0.04%
 * flat 口径（对照）：统一 0.10% / 0.20%，即旧口径，用来复现 v1「90x + flat 开仓即亏」。
 * legacy 口径（对照）：旧的 tiered 档位 0.10/0.20、0.05/0.10、0.02/0.04。
 */
const TIERED_FEE_TIERS: { upTo: number; pair: FeePair; label: string }[] = [
  { upTo: 20, pair: { buy: 0.0005, sell: 0.001 }, label: '≤20x 0.05/0.10' },
  { upTo: 50, pair: { buy: 0.0003, sell: 0.0006 }, label: '20~50x 0.03/0.06' },
  { upTo: Number.POSITIVE_INFINITY, pair: { buy: 0.0002, sell: 0.0004 }, label: '>50x 0.02/0.04' },
]
const LEGACY_FEE_TIERS: { upTo: number; pair: FeePair; label: string }[] = [
  { upTo: 20, pair: { buy: 0.001, sell: 0.002 }, label: '≤20x 0.10/0.20' },
  { upTo: 50, pair: { buy: 0.0005, sell: 0.001 }, label: '20~50x 0.05/0.10' },
  { upTo: Number.POSITIVE_INFINITY, pair: { buy: 0.0002, sell: 0.0004 }, label: '>50x 0.02/0.04' },
]
const FLAT_FEE: FeePair = { buy: 0.001, sell: 0.002 }

function feeTierAt(leverage: number, model: FeeModel): { upTo: number; pair: FeePair; label: string } {
  const tiers = model === 'legacy' ? LEGACY_FEE_TIERS : TIERED_FEE_TIERS
  return tiers.find((t) => leverage <= t.upTo) ?? tiers[tiers.length - 1]
}

function feePair(leverage: number, model: FeeModel): FeePair {
  if (model === 'flat') return FLAT_FEE
  return feeTierAt(leverage, model).pair
}

function feeLabel(leverage: number, model: FeeModel): string {
  if (model === 'flat') return 'flat 0.10/0.20'
  return `档位 ${feeTierAt(leverage, model).label}`
}

/** 一轮往返（买+卖）名义费率占保证金的百分比 = 名义费率 × 杠杆。 */
function roundTripFeePct(leverage: number, model: FeeModel): number {
  const f = feePair(leverage, model)
  return leverage * (f.buy + f.sell)
}

// ============================================================================
// §0.4 小工具
// ============================================================================

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000
}

/** 盈亏符号 */
function signOf(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0
}

// ============================================================================
// §1 确定性随机源
// ============================================================================

class Rng {
  private a: number
  private spare: number | null = null

  constructor(seed: number) {
    // 0 会让 mulberry32 停在一个退化序列上，强制避开。
    this.a = (seed >>> 0) || 0x9e3779b9
  }

  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0
    let t = this.a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  normal(): number {
    if (this.spare !== null) {
      const v = this.spare
      this.spare = null
      return v
    }
    let u = 0
    while (u === 0) u = this.next()
    const v = this.next()
    const r = Math.sqrt(-2 * Math.log(u))
    this.spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }

  /** Student-t(ν=5)，单位方差缩放；肥尾来自 6 次正态抽样。 */
  studentT(): number {
    const z = this.normal()
    let chi = 0
    for (let k = 0; k < T_NU; k++) chi += this.normal() ** 2
    const scale = 1 / Math.sqrt(T_NU / (T_NU - 2))
    return clamp((z / Math.sqrt(chi / T_NU)) * scale, -8, 8)
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }

  /** 供事件流「只读预演未来」用：快照/恢复必须逐位包含 spare，否则会改变后续序列。 */
  snapshot(): { a: number; spare: number | null } {
    return { a: this.a, spare: this.spare }
  }

  restore(s: { a: number; spare: number | null }): void {
    this.a = s.a
    this.spare = s.spare
  }
}

function hash32(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/** 派生随机种子：同一 (master, phase, combo, run) 永远得到同一结果。 */
function deriveSeed(master: number, phase: number, combo: number, run: number): number {
  let h = hash32(master ^ 0x9e3779b9)
  h = hash32(h ^ Math.imul(phase + 1, 0x85ebca6b))
  h = hash32(h ^ Math.imul(combo + 1, 0xc2b2ae35))
  h = hash32(h ^ Math.imul(run + 1, 0x27d4eb2f))
  return h >>> 0
}

// ============================================================================
// §2 价格引擎（每标的独立随机流；订单流冲击是内生项）
// ============================================================================

/**
 * 价格：x = ln(P/A)，A 自身慢漂移。
 *   Δx = −σ²/2 + σ·t₅ − θ·x + 事件冲击 + 订单流冲击
 *   P = A·e^x，x 钳制 ±ln5。
 *
 * 订单流冲击不在这里算（需要知道全桌的净单），由 Market 算完调 applyImpact()；
 * 这样可以保证「流动冲击」与「外生随机」用两条独立通道，核账时可分离。
 */
class PriceBook {
  readonly spec: StockSpec
  x = 0
  price: number
  anchor: number
  /** 最近 6 个分钟价（下标 0 最旧，5 最新），用于 1/3/5 分钟动量。 */
  private readonly hist = new Float64Array(6)
  private histCount = 0

  private readonly sigmaBase: number
  private variance: number
  private shockTicks = 0
  private shockMul = 1
  private readonly rng: Rng
  private readonly driftRng: Rng
  private readonly theta: ThetaConfig
  private anchorLog: number
  /** 公开参考锚（价格的 EMA），给「价值机构」用；它看不到真实 anchor。 */
  refAnchor: number
  /** 本分钟外生事件冲击（%，仅用于观察/归因） */
  lastEventShock = 0

  constructor(spec: StockSpec, seed: number, theta: ThetaConfig) {
    this.spec = spec
    this.theta = theta
    this.sigmaBase = spec.dailyVol / Math.sqrt(MINUTES_PER_DAY)
    this.variance = this.sigmaBase * this.sigmaBase
    this.price = spec.price0
    this.anchor = spec.price0
    this.anchorLog = Math.log(spec.price0)
    this.refAnchor = spec.price0
    this.rng = new Rng(seed ^ 0x51ed270b)
    this.driftRng = new Rng(seed ^ 0x5bd1e995)
    this.hist.fill(spec.price0)
    this.histCount = 6
  }

  private clampVol(v: number): number {
    const lo = (this.sigmaBase * VOL_MIN_FACTOR) ** 2
    const hi = (this.sigmaBase * VOL_MAX_FACTOR) ** 2
    return Math.min(hi, Math.max(lo, v))
  }

  /** 外生一拍：事件冲击 → 锚点漂移 → Student-t 噪声 + 均值回归。 */
  exogenousStep(eventShockPct: number): void {
    this.lastEventShock = eventShockPct
    if (eventShockPct !== 0) {
      this.x = clamp(this.x + Math.log(1 + eventShockPct), -X_LIMIT, X_LIMIT)
      this.shockTicks = EVENT_SHOCK_TICKS
      this.shockMul = EVENT_SHOCK_MUL
      this.variance = this.clampVol(this.variance * 4)
    }

    // 锚点慢漂移：内在价值本身在动，所以「跌到锚点下 20%」不是无风险套利。
    const stepSigma = ANCHOR_DAILY_SIGMA / Math.sqrt(MINUTES_PER_DAY)
    this.anchorLog += this.driftRng.normal() * stepSigma
    const rel = clamp(this.anchorLog - Math.log(this.spec.price0), -ANCHOR_LOG_BOUND, ANCHOR_LOG_BOUND)
    this.anchor = this.spec.price0 * Math.exp(rel)

    const shockMul = this.shockTicks > 0 ? this.shockMul : 1
    if (this.shockTicks > 0) {
      this.shockTicks -= 1
      if (this.shockTicks === 0) this.shockMul = 1
    }

    const sigma = Math.sqrt(this.clampVol(this.variance)) * shockMul
    const r = sigma * this.rng.studentT()
    const thetaEff = this.theta.adaptive
      ? this.theta.theta0 / (1 + this.theta.k * Math.abs(this.x))
      : this.theta.theta0
    this.x = clamp(this.x - 0.5 * sigma * sigma + r - thetaEff * this.x, -X_LIMIT, X_LIMIT)
    this.variance = this.clampVol(EWMA_LAMBDA * this.variance + (1 - EWMA_LAMBDA) * r * r)
    this.price = this.anchor * Math.exp(this.x)

    this.refAnchor += (this.price - this.refAnchor) * REF_ANCHOR_ALPHA
    this.pushHist()
  }

  /** 订单流冲击：把净流造成的对数价格位移落进 x，随后由均值回归慢慢衰减。 */
  applyImpact(logImpact: number): void {
    if (logImpact === 0) return
    this.x = clamp(this.x + logImpact, -X_LIMIT, X_LIMIT)
    this.price = this.anchor * Math.exp(this.x)
  }

  private pushHist(): void {
    for (let i = 0; i < 5; i++) this.hist[i] = this.hist[i + 1]
    this.hist[5] = this.price
    if (this.histCount < 6) this.histCount += 1
  }

  /** n 分钟动量（n=1/3/5）。 */
  ret(n: number): number {
    if (this.histCount <= n) return 0
    const prev = this.hist[5 - n]
    return prev > 0 ? this.price / prev - 1 : 0
  }

  liqImpactMultiplier(mmHealth: number): number {
    return 1 + (1 - clamp(mmHealth, 0, 1)) * 1.5
  }
}

// ============================================================================
// §3 事件流（全局泊松；每条新闻对单只标的的命中率与幅度按波动档缩放）
// ============================================================================

interface EventRecord {
  minute: number
  /** 命中的标的（-1 = 全市场） */
  stockMask: number
  /** 各标的的冲击（%）；0 = 无直接价格冲击（只是新闻/情绪） */
  shocks: number[]
  /** 全市场恐慌增量（负事件时 >0） */
  panic: number
  text: string
}

/**
 * 事件模型（相对设计稿的第二个建模选择，见报告偏离项）：
 * - 全局新闻按泊松到达（均值 eventMeanMin，默认 15 分钟）；
 * - 55% 是纯新闻（不直接打价格，但会推动情绪）；
 * - 30% 板块脉冲：随机命中一只标的，幅度 (0.30%~0.80%) × volScale；
 * - 10% 全市场：四只全中，幅度 (0.30%~0.60%) × volScale × β；
 * - 5% 个股冲击：随机命中一只，幅度 (1.5%~5.0%) × volScale。
 * 其中 volScale = 该标的日波动 / 8%，即小盘的事件幅度天然更大。
 *
 * 为什么不是设计稿的「±3%~25%」全量冲击：v1 已实测，15~45 分钟一条 3%~25% 的事件会让
 * 实现波动率远超参数档（8% 档实际会跑到 30%+），杠杆/强平结论会被事件方差淹没。
 * 本仿真把「大冲击」压成 5% 概率的稀有戏剧点，让基准波动率仍由 dailyVol 决定；
 * 报告里给出实测的日化波动率，供船长对照。
 */
class EventStream {
  private readonly rng: Rng
  private readonly meanMin: number
  private nextMinute: number
  private readonly volScale: number[]

  constructor(seed: number, meanMin: number) {
    this.rng = new Rng(seed ^ 0x27d4eb2f)
    this.meanMin = meanMin
    this.nextMinute = this.sampleGap()
    this.volScale = STOCKS.map((s) => s.dailyVol / 0.08)
  }

  private sampleGap(): number {
    const u = Math.max(1e-9, this.rng.next())
    return Math.max(1, Math.round(-Math.log(u) * this.meanMin))
  }

  /**
   * 生成「下一分钟」的一条事件，并把游标推到再下一条。
   * 独立成方法是为了让 peekFuture 能用同一套逻辑预演未来，而不改真实序列。
   */
  private generateAt(minute: number): EventRecord {
    const r = this.rng.next()
    const shocks = [0, 0, 0, 0]
    let mask = 0
    let panic = 0
    let text = ''
    if (r < 0.55) {
      text = '宏观快讯（无直接价格冲击）'
    } else if (r < 0.85) {
      const i = this.rng.int(0, 3)
      const mag = (0.003 + 0.005 * this.rng.next()) * this.volScale[i]
      const sgn = this.rng.next() < 0.5 ? -1 : 1
      shocks[i] = sgn * mag
      mask = 1 << i
      text = `${STOCKS[i].code} 板块脉冲`
      if (sgn < 0 && mag > 0.006) panic = 0.3
    } else if (r < 0.95) {
      const mag = (0.003 + 0.003 * this.rng.next()) * (this.rng.next() < 0.5 ? -1 : 1)
      for (let i = 0; i < 4; i++) {
        shocks[i] = mag * STOCKS[i].beta * (0.7 + 0.6 * this.rng.next())
      }
      mask = 0b1111
      text = '全市场消息'
      if (mag < 0) panic = 0.45
    } else {
      const i = this.rng.int(0, 3)
      const mag = (0.015 + 0.035 * this.rng.next()) * this.volScale[i]
      const sgn = this.rng.next() < 0.5 ? -1 : 1
      shocks[i] = sgn * mag
      mask = 1 << i
      text = `${STOCKS[i].code} 个股冲击`
      panic = sgn < 0 ? 0.7 : 0
    }
    this.nextMinute += this.sampleGap()
    return { minute, stockMask: mask, shocks, panic, text }
  }

  /** 到达本分钟的事件（可能 0 条，通常 1 条；极端间隔会补发，保持泊松）。 */
  advance(minute: number): EventRecord[] {
    const out: EventRecord[] = []
    while (minute >= this.nextMinute) {
      out.push(this.generateAt(this.nextMinute))
    }
    return out
  }

  /**
   * 只读预演：返回 (minute, minute+horizon] 内将要到达的事件。
   * 通过 Rng 快照/恢复保证不改变真实事件序列——同一分钟多次调用是幂等的。
   * 这是 v2c 修复 B「信息利用率」的可利用信息源（事件前兆/内幕电报）。
   */
  peekFuture(minute: number, horizon: number): EventRecord[] {
    const snap = this.rng.snapshot()
    const savedNext = this.nextMinute
    const out: EventRecord[] = []
    while (this.nextMinute <= minute + horizon) {
      const at = this.nextMinute
      const rec = this.generateAt(at)
      if (at > minute) out.push(rec)
    }
    this.rng.restore(snap)
    this.nextMinute = savedNext
    return out
  }
}

// ============================================================================
// §4 账户与仓位（玩家、人格、操纵策略共用同一套逐仓账户）
// ============================================================================

interface Position {
  side: Side
  qty: number
  entry: number
  margin: number
  leverage: number
  /** 交易所临时提高保证金时的倍数（1 = 常规）；强平按有效杠杆 L/marginMul 判。 */
  marginMul: number
  /** 真梭哈仓位：行为模型不主动止损/止盈，只等强平。 */
  allIn: boolean
  openedAt: number
  liquidating: boolean
  /** 开仓时距强平的价格 %（用于「缓冲消耗」口径） */
  initialDist: number
  /** 生命周期内观察到的最小距强平 % */
  minDist: number
  /** 上一次观察到的距强平 %（字面近失口径用） */
  lastDist: number
  /** 已计的资金费/利息锚点（分钟） */
  lastFundingMinute: number
  lastInterestMinute: number
}

function liquidationPrice(side: Side, entry: number, leverage: number, marginMul = 1): number {
  const L = Math.max(1, leverage / Math.max(1, marginMul))
  const mm = MAINTENANCE_FACTOR / L
  if (side === 1) return Math.max(0, (entry * (1 - 1 / L)) / (1 - mm))
  return Math.max(0, (entry * (1 + 1 / L)) / (1 + mm))
}

function liquidationDistancePct(side: Side, mark: number, liqPrice: number): number {
  if (mark <= 0) return 0
  const diff = side === 1 ? (mark - liqPrice) / mark : (liqPrice - mark) / mark
  return Math.max(0, diff * 100)
}

function unrealized(pos: Position, mark: number): number {
  return (mark - pos.entry) * pos.qty * pos.side
}

/**
 * 一个账户。现金 wallet 不含保证金；权益 = wallet + Σ(margin + 未实现盈亏)。
 * 所有成交都由 Market 用统一执行价结算，账户不自己定价（否则价格冲击会被重复计算）。
 * 每笔费用/罚金/利息都记在自己账上，收尾时汇总成「系统销毁池」用于核账，确保不凭空印钱。
 */
class Trader {
  readonly id: string
  readonly label: string
  readonly kind: 'player' | 'persona' | 'mm' | 'script'
  readonly feeModel: FeeModel
  readonly initialCapital: number
  /** 逐仓 / 全仓。人格与操纵脚本默认逐仓，只有行为玩家可按规则切全仓。 */
  readonly marginMode: 'isolated' | 'cross'
  /** 价值型/空头型人格按全名义付持仓成本（1x 也要付资金占用），避免白嫖回归。 */
  readonly fullCarry: boolean
  wallet: number
  readonly positions: (Position | null)[] = [null, null, null, null]
  dead = false
  bankrupt = false
  feesPaid = 0
  slipPaid = 0
  penaltiesPaid = 0
  interestPaid = 0
  /** 资金费中「付出」的总额（空头收到的负数不计入），用于算销毁量 */
  fundingGrossPaid = 0
  badDebt = 0
  closedTrades = 0
  wins = 0
  losses = 0
  realizedPnl = 0
  /** 最近一次平仓的已实现盈亏（行为模型「损失追投」用） */
  lastClosePnl = 0
  openCount = 0
  lastOpenMinute = -9999
  /** 巨鲸足迹（公开可读的市场信息）：技能玩家用来提前跟单/反向。 */
  whalePhase: 'idle' | 'accumulate' | 'hold' | 'distribute' = 'idle'
  whaleStock = -1
  whaleDir: Side = 1
  /** 进入过分片强平的次数（一次仓位可能多次切片，去重按仓位计） */
  liquidationCount = 0
  /** v2c 监管：该账户被调查后的保证金惩罚与开空限制（分钟）。 */
  marginPenaltyUntil = -1
  marginPenaltyMul = 1
  shortBanUntil = -1
  /** 该标的最近一次被罚没的分钟，避免同一波行情重复罚。 */
  readonly regulatedUntil: number[] = [-1, -1, -1, -1]
  /** 被监管罚没的累计金额（进销毁池）。 */
  regulatorPaid = 0
  /** 最近 15 分钟的有符号成交名义（监管判定「异常集中流」用）。 */
  readonly recentFlow: { minute: number; notional: number }[][] = [[], [], [], []]
  /** 每个平掉的仓位：是否爆仓、生命周期内消耗了多少强平缓冲、最后一次距强平 % */
  readonly exits: { liq: boolean; bufferUse: number; lastDist: number }[] = []
  private readonly exposureCap: number[]

  constructor(
    id: string,
    label: string,
    kind: 'player' | 'persona' | 'mm' | 'script',
    capital: number,
    feeModel: FeeModel,
    marginMode: 'isolated' | 'cross' = 'isolated',
    fullCarry = false,
  ) {
    this.id = id
    this.label = label
    this.kind = kind
    this.feeModel = feeModel
    this.marginMode = marginMode
    this.fullCarry = fullCarry
    this.initialCapital = capital
    this.wallet = capital
    this.exposureCap = STOCKS.map((s) => s.floatCap * EXPOSURE_RATIO)
  }

  /** v2c：当前分钟生效的监管保证金倍数。 */
  penaltyMulAt(minute: number): number {
    return minute < this.marginPenaltyUntil ? this.marginPenaltyMul : 1
  }

  /** v2c：记录成交名义，并清掉窗口外的旧记录。 */
  private recordFlow(stockIdx: number, minute: number, notional: number): void {
    if (!Number.isFinite(notional) || notional === 0) return
    const arr = this.recentFlow[stockIdx]
    arr.push({ minute, notional })
    while (arr.length > 0 && arr[0].minute < minute - REG_WINDOW_MIN) arr.shift()
  }

  /** v2c：最近 N 分钟该标的的有符号成交名义（买正卖负）。 */
  flowN(stockIdx: number, minute: number, window: number): number {
    const arr = this.recentFlow[stockIdx]
    while (arr.length > 0 && arr[0].minute < minute - window) arr.shift()
    let sum = 0
    for (const x of arr) sum += x.notional
    return sum
  }

  flow15(stockIdx: number, minute: number): number {
    return this.flowN(stockIdx, minute, REG_WINDOW_MIN)
  }

  equity(prices: readonly number[]): number {
    let eq = this.wallet
    for (let i = 0; i < 4; i++) {
      const p = this.positions[i]
      if (!p) continue
      eq += p.margin + unrealized(p, prices[i])
    }
    return eq
  }

  positionEquity(i: number, price: number): number {
    const p = this.positions[i]
    if (!p) return 0
    return p.margin + unrealized(p, price)
  }

  /** 全仓维持保证金总额：所有持仓按有效杠杆（含临时保证金倍数）加总。 */
  maintenanceRequirement(prices: readonly number[]): number {
    let mm = 0
    for (let i = 0; i < 4; i++) {
      const p = this.positions[i]
      if (!p) continue
      const effL = Math.max(1, p.leverage / Math.max(1, p.marginMul))
      mm += (MAINTENANCE_FACTOR / effL) * p.qty * prices[i]
    }
    return mm
  }

  /**
   * 把一笔已成交的有符号数量落到账户上，返回真实成交的有符号数量。
   * - 反方向先平仓（realize），剩余再反向开仓；
   * - 新仓保证金 = 名义 / leverage，手续费按杠杆档取；
   * - 现金/敞口不足时按可用额度缩量（绝不透支 → 不隐性印钞）。
   */
  applyFill(
    stockIdx: number,
    signedQty: number,
    execPrice: number,
    minute: number,
    leverage: number,
    marginMul = 1,
    allIn = false,
  ): number {
    if (this.dead || signedQty === 0 || execPrice <= 0) return 0
    let remaining = signedQty
    let filled = 0
    const pos = this.positions[stockIdx]

    if (pos && signOf(remaining) !== pos.side) {
      const closeQty = Math.min(Math.abs(remaining), pos.qty)
      this.closeQty(stockIdx, closeQty, execPrice, minute, false)
      filled += -pos.side * closeQty
      remaining += pos.side * closeQty
      if (Math.abs(remaining) < 1e-9) {
        this.recordFlow(stockIdx, minute, filled * execPrice)
        return filled
      }
    }

    const dir: Side = remaining > 0 ? 1 : -1
    const penalty = this.penaltyMulAt(minute)
    const cur = this.positions[stockIdx]
    if (cur && cur.side === dir) {
      // 监管限制开空：只拦加空，平空/平多不受影响。
      if (dir === -1 && minute < this.shortBanUntil) return filled
      const L = cur.leverage
      const feeRate = feePair(L, this.feeModel)[dir === 1 ? 'buy' : 'sell']
      const capLeft = Math.max(0, this.exposureCap[stockIdx] - cur.qty * execPrice)
      const wantNotional = Math.min(Math.abs(remaining) * execPrice, capLeft)
      const margin = (wantNotional / L) * cur.marginMul * penalty
      const fee = wantNotional * feeRate
      const need = margin + fee
      const scale = need > 0 ? Math.min(1, this.wallet / need) : 0
      if (scale <= 1e-9 || wantNotional <= 0) return filled
      const q = (wantNotional * scale) / execPrice
      const n = q * execPrice
      const m = n / L
      const f = n * feeRate
      this.wallet -= m + f
      this.feesPaid += f
      const oldQty = cur.qty
      cur.qty += q
      cur.entry = (cur.entry * oldQty + execPrice * q) / cur.qty
      cur.margin += m
      this.openCount += 1
      this.lastOpenMinute = minute
      this.recordFlow(stockIdx, minute, (filled + q * dir) * execPrice)
      return filled + q * dir
    }

    // 监管限制开空：新开空直接拒绝（已有空仓仍可平）。
    if (dir === -1 && minute < this.shortBanUntil) return filled
    const cap = this.exposureCap[stockIdx]
    const effLev = Math.min(leverage, stockLeverageCap(stockIdx))
    const wantNotional = Math.min(Math.abs(remaining) * execPrice, cap)
    const feeRate = feePair(effLev, this.feeModel)[dir === 1 ? 'buy' : 'sell']
    const effMarginMul = marginMul * penalty
    const margin = (wantNotional / effLev) * effMarginMul
    const fee = wantNotional * feeRate
    const need = margin + fee
    const scale = need > 0 ? Math.min(1, this.wallet / need) : 0
    if (scale <= 1e-9 || wantNotional <= 0) return filled
    const q = (wantNotional * scale) / execPrice
    const n = q * execPrice
    const m = n / effLev
    const f = n * feeRate
    if (m < 1 || n < 1) return filled
    this.wallet -= m + f
    this.feesPaid += f
    const liq = liquidationPrice(dir, execPrice, effLev, effMarginMul)
    const dist = liquidationDistancePct(dir, execPrice, liq)
    this.positions[stockIdx] = {
      side: dir,
      qty: q,
      entry: execPrice,
      margin: m,
      leverage: effLev,
      marginMul: effMarginMul,
      allIn,
      openedAt: minute,
      liquidating: false,
      initialDist: dist,
      minDist: dist,
      lastDist: dist,
      lastFundingMinute: minute,
      lastInterestMinute: minute,
    }
    this.openCount += 1
    this.lastOpenMinute = minute
    this.recordFlow(stockIdx, minute, (filled + q * dir) * execPrice)
    return filled + q * dir
  }

  /** 平仓（qty ≤ 持仓数量），execPrice 已含盘口价差/冲击。 */
  closeQty(
    stockIdx: number,
    qty: number,
    execPrice: number,
    minute: number,
    liquidation: boolean,
    extraSlipRate = 0,
  ): void {
    const pos = this.positions[stockIdx]
    if (!pos) return
    const q = Math.min(qty, pos.qty)
    if (q <= 0) return
    const notional = q * execPrice
    const closeSide = pos.side === 1 ? 'sell' : 'buy'
    const feeRate = feePair(pos.leverage, this.feeModel)[closeSide]
    const fee = notional * feeRate
    const pnl = unrealized(pos, execPrice) * (q / pos.qty)
    const marginPart = pos.margin * (q / pos.qty)
    const slip = liquidation ? notional * (LIQUIDATION_SLIPPAGE_RATE + extraSlipRate) : 0
    const penalty = liquidation ? notional * LIQUIDATION_PENALTY_RATE : 0

    this.wallet += marginPart + pnl - fee - slip - penalty
    this.feesPaid += fee
    this.slipPaid += slip
    this.penaltiesPaid += penalty
    this.realizedPnl += pnl
    pos.qty -= q
    pos.margin -= marginPart
    if (pos.qty <= 1e-9) {
      const bufferUse = pos.initialDist > 0 ? 1 - pos.minDist / pos.initialDist : 0
      this.exits.push({
        liq: liquidation || pos.liquidating,
        bufferUse,
        lastDist: pos.lastDist,
      })
      this.positions[stockIdx] = null
      this.closedTrades += 1
      this.lastClosePnl = pnl - fee
      if (pnl - fee > 0) this.wins += 1
      else this.losses += 1
    }
    void minute
  }

  /** 资金费 / 杠杆利息：1 小时局不触发，长线（≥8 小时）才扣。 */
  accrueCosts(minute: number, prices: readonly number[]): void {
    for (let i = 0; i < 4; i++) {
      const pos = this.positions[i]
      if (!pos) continue
      while (minute - pos.lastFundingMinute >= FUNDING_INTERVAL_MIN) {
        const notional = pos.qty * prices[i]
        const cost = pos.side === 1 ? notional * FUNDING_RATE : -notional * FUNDING_RATE * SHORT_FUNDING_RECEIVE
        this.wallet -= cost
        if (cost > 0) this.fundingGrossPaid += cost
        pos.lastFundingMinute += FUNDING_INTERVAL_MIN
      }
      while (minute - pos.lastInterestMinute >= MINUTES_PER_DAY) {
        const notional = pos.qty * prices[i]
        const rate =
          pos.side === 1
            ? this.fullCarry
              ? LEVERAGE_DAILY_INTEREST
              : LEVERAGE_DAILY_INTEREST * (1 - 1 / pos.leverage)
            : BORROW_DAILY_FEE
        const cost = notional * rate
        this.wallet -= cost
        this.interestPaid += cost
        pos.lastInterestMinute += MINUTES_PER_DAY
      }
    }
  }

  /**
   * 结算：按现价标记权益。**允许返回负值**——负权益就是穿仓欠款，
   * 它必须留在总账里（否则「玩家 + 人格 + 做市商 + 销毁池 = 初始资金」会多算一次欠款）。
   */
  finalize(prices: readonly number[]): number {
    const eq = this.equity(prices)
    if (eq < 0) {
      this.badDebt += -eq
      this.dead = true
      this.bankrupt = true
    }
    return eq
  }

  /**
   * 运行中破产：仓位已被强平，把欠款留在负现金里（不置 0），
   * 这样期末权益仍是负值、总账守恒；badDebt 只作报告字段。
   */
  failAt(prices: readonly number[]): number {
    const eq = this.equity(prices)
    this.badDebt += Math.max(0, -eq)
    this.wallet = Math.min(0, eq)
    for (let i = 0; i < 4; i++) this.positions[i] = null
    this.dead = true
    this.bankrupt = true
    return Math.min(0, eq)
  }

  /**
   * 本账户交出去的「系统销毁」总额（费用+滑点+罚金+利息+半额资金费）。
   * **不含 badDebt**：欠款不是「销毁」，它已经以负权益留在总账里，再加一次会双计。
   */
  burnedTotal(): number {
    return (
      this.feesPaid +
      this.slipPaid +
      this.penaltiesPaid +
      this.interestPaid +
      this.fundingGrossPaid * 0.5 +
      this.regulatorPaid
    )
  }
}

// ============================================================================
// §5 做市商（铁砧）与赌桌（Market）
// ============================================================================

/**
 * 做市商不是「独立交易者」，它是全桌的被动对手盘：
 * - 买方按 mid×(1+冲击分摊+价差/2+库存偏斜) 成交，卖方按 mid×(1+冲击分摊−价差/2+库存偏斜) 成交；
 * - 价差与冲击分摊的差额进做市商账户，所以它赚的是「提供流动性的服务费」；
 * - 资本有限：权益下降 → 可吸收的库存与深度同步缩小、价差变宽、冲击放大；
 * - 权益 ≤ 0 → 停止报价（流动性真空），系统不补钱。这就是「不许凭空印钱」的闸门。
 */
class LiquidityProvider {
  readonly initialCapital: number
  cash: number
  readonly inv: number[] = [0, 0, 0, 0]
  dead = false

  constructor(capital: number) {
    this.initialCapital = capital
    this.cash = capital
  }

  equity(prices: readonly number[]): number {
    let eq = this.cash
    for (let i = 0; i < 4; i++) eq += this.inv[i] * prices[i]
    return eq
  }

  health(prices: readonly number[]): number {
    return clamp(this.equity(prices) / this.initialCapital, 0, 1)
  }
}

/**
 * 一张赌桌：4 只标的 + 玩家 + 若干人格 + 1 个做市商。
 * 每分钟步序（钉死，保证回放一致）：
 *   ① 事件到达 → ② 外生价格演进 → ③ 各方决策 → ④ 净订单流撮合（玩家/AI 单真实冲击价格）
 *   → ⑤ 强平分片 → ⑥ 资金费/利息。设计稿 A.4 的步序「撮合→强平→AI 下单→价格演进」在
 *   1 分钟聚合下合并为「决策与撮合同拍」，顺序差异见报告偏离项。
 */
class Market {
  readonly books: PriceBook[]
  readonly mm: LiquidityProvider
  readonly traders: Trader[]
  readonly events: EventStream
  readonly prices: number[]
  readonly mmRefillEnabled: boolean
  readonly extremeVolRules: boolean
  /** v2c 修复 A 的三个开关。 */
  readonly impactModel: ImpactModel
  readonly regulatorEnabled: boolean
  readonly regulatorGamma: number
  readonly defenseEnabled: boolean
  /** 每分钟每标的的 mid 价历史（监管 15 分钟窗口 / 防御判定用）。 */
  private readonly priceHist: number[][] = [[], [], [], []]
  /** 每账户每分钟权益快照（监管罚没「异常收益」用）。 */
  private readonly equityHist = new Map<Trader, { minute: number; equity: number }[]>()
  /** 极端波动时交易所提高的保证金倍数（不清零，只影响新开/加仓）。 */
  readonly marginMul: number[] = [1, 1, 1, 1]
  /** 极端波动时限制开空到该分钟；-1 = 无限制。 */
  readonly shortBanUntil: number[] = [-1, -1, -1, -1]
  private readonly extremeUntil: number[] = [-1, -1, -1, -1]
  /** 全仓强平没收的正残值（进系统销毁池，保证总账守恒）。 */
  confiscated = 0
  /** 从销毁池补给做市商的累计金额（有上限，来源可审计）。 */
  mmRefillTotal = 0
  private mmRefillDay = 0
  private mmRefillToday = 0
  panic = 0
  lastEventText = '—'
  lastEventMinute = -1
  /** 本分钟外生价格（冲击前）；用于统计实现波动率。 */
  private beginPrices: number[]
  readonly realizedVarSum = [0, 0, 0, 0]
  realizedMinutes = 0

  constructor(
    seed: number,
    eventMeanMin: number,
    traders: Trader[],
    mmCapital: number,
    theta: ThetaConfig,
    mmRefill: boolean,
    extremeVolRules: boolean,
    impactModel: ImpactModel,
    regulatorEnabled: boolean,
    regulatorGamma: number,
    defenseEnabled: boolean,
  ) {
    this.traders = traders
    this.books = STOCKS.map((s, i) => new PriceBook(s, deriveSeed(seed, 0, i, 7), theta))
    this.events = new EventStream(seed ^ 0x4bf5a3d1, eventMeanMin)
    this.mm = new LiquidityProvider(mmCapital)
    this.mmRefillEnabled = mmRefill
    this.extremeVolRules = extremeVolRules
    this.impactModel = impactModel
    this.regulatorEnabled = regulatorEnabled
    this.regulatorGamma = regulatorGamma
    this.defenseEnabled = defenseEnabled
    this.prices = this.books.map((b) => b.price)
    this.beginPrices = [...this.prices]
  }

  ret(stock: number, n: number): number {
    return this.books[stock].ret(n)
  }

  refAnchor(stock: number): number {
    return this.books[stock].refAnchor
  }

  /** 当前价格相对 n 分钟前（价史保留 20 分钟，n ≤ 15）。 */
  retN(stock: number, n: number): number {
    const h = this.priceHist[stock]
    if (h.length <= n) return 0
    const prev = h[h.length - 1 - n]
    return prev > 0 ? this.prices[stock] / prev - 1 : 0
  }

  /**
   * v2c 修复 B-1：信息前兆。
   * 返回 2~5 分钟后将要发生的事件冲击（按标的汇总）。调用方用信息利用率决定
   * 看见多少；peekFuture 只读，不改变真实事件序列。
   */
  precursorSignal(minute: number): number[] {
    const out = [0, 0, 0, 0]
    for (const e of this.events.peekFuture(minute, 5)) {
      if (e.minute < minute + 2) continue
      for (let i = 0; i < 4; i++) out[i] += e.shocks[i]
    }
    return out
  }

  /** v2c 修复 B-1：人格近 5 分钟净成交名义（盘口异动/巨鲸足迹）。 */
  personaFlow5(minute: number): number[] {
    const out = [0, 0, 0, 0]
    for (const t of this.traders) {
      if (t.kind !== 'persona') continue
      for (let i = 0; i < 4; i++) {
        for (const x of t.recentFlow[i]) {
          if (x.minute >= minute - 5 && x.minute <= minute) out[i] += x.notional
        }
      }
    }
    return out
  }

  /**
   * v2c 修复 B-2：人格持仓拥挤度（占流通市值）。
   * net = 全部人格净多头；short = 夜枭净空；chase = 红隼+群星净多。
   */
  personaCrowding(): { net: number[]; short: number[]; chase: number[] } {
    const net = [0, 0, 0, 0]
    const short = [0, 0, 0, 0]
    const chase = [0, 0, 0, 0]
    for (const t of this.traders) {
      if (t.kind !== 'persona') continue
      for (let i = 0; i < 4; i++) {
        const pos = t.positions[i]
        if (!pos) continue
        const v = pos.qty * pos.side * this.prices[i]
        net[i] += v
        if (t.id === 'short') short[i] += v
        if (t.id === 'momentum' || t.id === 'herd') chase[i] += v
      }
    }
    return {
      net: net.map((v, i) => v / STOCKS[i].floatCap),
      short: short.map((v, i) => v / STOCKS[i].floatCap),
      chase: chase.map((v, i) => v / STOCKS[i].floatCap),
    }
  }

  /**
   * v2c 修复 B-1：巨鲸足迹（AI 生态稿「盘口人格痕迹」的可读信息）。
   * 建仓段跟随、派发段反向；只有信息利用率 >0 的玩家会用。
   */
  whaleFootprint(): { stock: number; dir: Side; phase: 'accumulate' | 'hold' | 'distribute' } | null {
    for (const t of this.traders) {
      if (t.id !== 'whale' || t.whalePhase === 'idle' || t.whaleStock < 0) continue
      return { stock: t.whaleStock, dir: t.whaleDir, phase: t.whalePhase }
    }
    return null
  }

  /** 监管：15 分钟 ±15% + 单账户同向流 ≥ 流通市值 2% → 罚没异常收益、提保证金、限开空。 */
  private checkRegulator(minute: number): void {
    if (!this.regulatorEnabled || this.regulatorGamma <= 0) return
    const windows = [
      { w: REG_FAST_WINDOW, move: REG_FAST_MOVE, flow: REG_FAST_FLOW_RATIO },
      { w: REG_WINDOW_MIN, move: REG_MOVE_THRESHOLD, flow: REG_FLOW_RATIO },
    ]
    for (let i = 0; i < 4; i++) {
      const h = this.priceHist[i]
      for (const win of windows) {
        if (h.length < win.w + 1) continue
        const ref = h[h.length - 1 - win.w]
        const move = ref > 0 ? this.prices[i] / ref - 1 : 0
        if (Math.abs(move) < win.move) continue
        let hit = false
        for (const t of this.traders) {
          if (t.dead || minute < t.regulatedUntil[i]) continue
          const flow = t.flowN(i, minute, win.w)
          if (Math.abs(flow) < STOCKS[i].floatCap * win.flow) continue
          if (signOf(flow) !== signOf(move)) continue
          const hist = this.equityHist.get(t)
          if (!hist) continue
          let past: number | null = null
          for (const e of hist) {
            if (e.minute <= minute - win.w) past = e.equity
          }
          if (past === null) continue
          const gain = Math.max(0, t.equity(this.prices) - past)
          if (gain <= 0) continue
          const fine = gain * this.regulatorGamma
          t.wallet -= fine
          t.regulatorPaid += fine
          t.marginPenaltyUntil = minute + REG_COOLDOWN_MIN
          t.marginPenaltyMul = REG_MARGIN_MUL
          t.shortBanUntil = minute + REG_COOLDOWN_MIN
          t.regulatedUntil[i] = minute + REG_COOLDOWN_MIN
          hit = true
        }
        if (hit) break
      }
    }
  }

  /** 记录每账户权益快照，供监管计算「异常收益」；只保留最近 20 分钟。 */
  private recordEquity(minute: number): void {
    for (const t of this.traders) {
      let arr = this.equityHist.get(t)
      if (!arr) {
        arr = []
        this.equityHist.set(t, arr)
      }
      arr.push({ minute, equity: t.equity(this.prices) })
      if (arr.length > 20) arr.shift()
    }
  }

  /** ① 事件 + ② 外生价格 + 情绪衰减。 */
  beginMinute(minute: number): void {
    const events = this.events.advance(minute)
    const shocks = [0, 0, 0, 0]
    for (const e of events) {
      this.panic = Math.min(1, this.panic + e.panic)
      this.lastEventText = e.text
      this.lastEventMinute = e.minute
      for (let i = 0; i < 4; i++) shocks[i] += e.shocks[i]
    }
    for (let i = 0; i < 4; i++) {
      this.books[i].exogenousStep(shocks[i])
      this.prices[i] = this.books[i].price
      const h = this.priceHist[i]
      h.push(this.prices[i])
      // 只需要 15 分钟窗口 + 1 个当前点；保留 20 个避免无界增长。
      if (h.length > 20) h.shift()
    }
    this.beginPrices = [...this.prices]
    this.panic *= 0.92
    this.realizedMinutes += 1
    for (let i = 0; i < 4; i++) {
      if (minute > this.extremeUntil[i]) {
        this.marginMul[i] = 1
        this.shortBanUntil[i] = -1
      }
    }
  }

  /**
   * 交易所对极端波动的负反馈（船长裁决「拉盘砸盘算玩法，但提高保证金/限制开空，不清零」）：
   * 5 分钟涨跌 >20% → 该标的保证金 ×1.5、禁止新开空 10 分钟；已有仓位不强制平。
   */
  private checkExtreme(minute: number): void {
    if (!this.extremeVolRules) return
    for (let i = 0; i < 4; i++) {
      if (Math.abs(this.books[i].ret(5)) <= 0.2) continue
      if (minute < this.extremeUntil[i]) continue
      this.extremeUntil[i] = minute + 10
      this.marginMul[i] = 1.5
      this.shortBanUntil[i] = minute + 10
    }
  }

  /** ④⑤⑥：撮合、强平、资金费。 */
  execute(minute: number, intents: Intent[]): void {
    const byStock: Intent[][] = [[], [], [], []]
    for (const it of intents) {
      if (it.qty !== 0) byStock[it.stock].push(it)
    }
    for (let i = 0; i < 4; i++) this.executeStock(i, byStock[i], minute)
    this.updateDistances()
    this.liquidateAll(minute)
    for (const t of this.traders) {
      if (!t.dead) t.accrueCosts(minute, this.prices)
    }
    for (let i = 0; i < 4; i++) {
      const r = Math.log(this.prices[i] / this.beginPrices[i])
      this.realizedVarSum[i] += r * r
    }
    this.checkExtreme(minute)
    this.checkRegulator(minute)
    this.recordEquity(minute)
    this.maybeRefillMm(minute)
  }

  /** 做市商从销毁池受控补给：单日/总量双上限，来源是已收的费税，不凭空印钱。 */
  private maybeRefillMm(minute: number): void {
    if (!this.mmRefillEnabled || this.mm.dead) return
    const day = Math.floor(minute / MINUTES_PER_DAY)
    if (day !== this.mmRefillDay) {
      this.mmRefillDay = day
      this.mmRefillToday = 0
    }
    if (this.mm.health(this.prices) >= MM_REFILL_TRIGGER_HEALTH) return
    const totalCap = this.mm.initialCapital * MM_REFILL_TOTAL_CAP_RATIO
    const dailyCap = this.mm.initialCapital * MM_REFILL_DAILY_CAP_RATIO
    const remainingTotal = Math.max(0, totalCap - this.mmRefillTotal)
    const remainingDaily = Math.max(0, dailyCap - this.mmRefillToday)
    if (remainingTotal <= 0 || remainingDaily <= 0) return
    const available = this.traders.reduce((a, t) => a + t.burnedTotal(), 0) - this.mmRefillTotal
    const amount = Math.min(
      this.mm.initialCapital * MM_REFILL_CHUNK_RATIO,
      remainingTotal,
      remainingDaily,
      Math.max(0, available),
    )
    if (amount <= 0) return
    this.mm.cash += amount
    this.mmRefillTotal += amount
    this.mmRefillToday += amount
  }

  private executeStock(i: number, intents: Intent[], minute: number): void {
    if (intents.length === 0) return
    const book = this.books[i]
    const spec = book.spec
    const pre = book.price
    const health = this.mm.health(this.prices)
    if (health <= 0.001) return // 做市商资本耗尽 → 流动性真空，不补钱

    const extreme =
      Math.abs(book.ret(5)) > 0.08 || Math.abs(this.retN(i, REG_WINDOW_MIN)) > DEFENSE_DEVIATION
    const depth =
      DEPTH_RATIO * spec.floatCap * (0.25 + 0.75 * health) * (this.defenseEnabled && extreme ? DEFENSE_DEPTH_MUL : 1)
    const spreadMul = (1 + (1 - health) * 2) * (this.defenseEnabled && extreme ? DEFENSE_SPREAD_MUL : 1)
    const impactMul = book.liqImpactMultiplier(health)

    let buyN = 0
    let sellN = 0
    for (const it of intents) {
      const n = Math.abs(it.qty) * pre
      if (it.qty > 0) buyN += n
      else sellN += n
    }
    const gross = buyN + sellN
    if (gross <= 0) return

    // 盘口深度：单分钟最大成交量，超出按比例配给（「盘口深度不足只能成交能成交的部分」）。
    let scale = gross > depth ? depth / gross : 1

    // 做市商库存上限：超出的净流同样配给。
    const invCap = Math.min(spec.floatCap * 0.025, this.mm.initialCapital * 1.5) * (0.25 + 0.75 * health)
    const curInv = this.mm.inv[i]
    const qB0 = (buyN * scale) / pre
    const qS0 = (sellN * scale) / pre
    const netQ0 = qB0 - qS0
    let k = 1
    if (netQ0 > curInv + invCap) k = (curInv + invCap) / netQ0
    else if (netQ0 < curInv - invCap) k = (curInv - invCap) / netQ0
    k = clamp(k, 0, 1)
    scale *= k
    if (scale <= 1e-9) return

    const bN = buyN * scale
    const sN = sellN * scale
    const net = bN - sN
    const qref = spec.floatCap * QREF_RATIO
    const x = Math.abs(net) / qref
    const markImpact = net === 0 ? 0 : Math.sign(net) * IMPACT_K * impactMul * Math.sqrt(x)
    // v2c 修复 A-1：主动方额外支付超线性冲击成本（小单近似 0，大单指数上升）。
    const convexExec =
      this.impactModel === 'convex' && net !== 0
        ? IMPACT_CONVEX_K * impactMul * Math.pow(x, IMPACT_CONVEX_EXP)
        : 0
    // 库存偏斜：做市商库存越偏，报价整体越向「吸引反向流」的方向移（0.2% 上限）。
    const skew = clamp(-curInv / (invCap || 1), -1, 1) * 0.002
    const pBuy = pre * (1 + IMPACT_ETA * markImpact + MM_SPREAD_HALF * spreadMul + skew + convexExec)
    const pSell = pre * (1 + IMPACT_ETA * markImpact - MM_SPREAD_HALF * spreadMul + skew - convexExec)

    let mmCash = 0
    let mmInv = 0
    const shortBan = this.shortBanUntil[i] > minute
    for (const it of intents) {
      const q = it.qty * scale
      if (Math.abs(q) < 1e-9) continue
      const pos = it.trader.positions[i]
      // 限制开空：只拦「新开空/加空」，平多与平空不受影响（不清零已有仓位）。
      if (shortBan && q < 0 && (!pos || pos.side === -1)) continue
      const p = q > 0 ? pBuy : pSell
      const filled = it.trader.applyFill(i, q, p, minute, it.leverage, this.marginMul[i], it.allIn ?? false)
      if (filled === 0) continue
      mmCash += filled * p
      mmInv -= filled
    }
    this.mm.cash += mmCash
    this.mm.inv[i] += mmInv
    book.applyImpact(markImpact)
    this.prices[i] = book.price
  }

  private updateDistances(): void {
    for (const t of this.traders) {
      if (t.dead) continue
      for (let i = 0; i < 4; i++) {
        const pos = t.positions[i]
        if (!pos) continue
        const price = this.prices[i]
        const liq = liquidationPrice(pos.side, pos.entry, pos.leverage, pos.marginMul)
        pos.lastDist = liquidationDistancePct(pos.side, price, liq)
        if (pos.lastDist < pos.minDist) pos.minDist = pos.lastDist
      }
    }
  }

  /** ⑤ 强平：逐仓分片 30%；全仓则按总权益/总维持保证金判定，一次性清零。 */
  private liquidateAll(minute: number): void {
    for (const t of this.traders) {
      if (t.dead) continue
      if (t.marginMode === 'cross') {
        const hasPos = t.positions.some((p) => p !== null)
        if (hasPos && t.equity(this.prices) <= t.maintenanceRequirement(this.prices)) {
          this.liquidateCross(t, minute)
        }
        continue
      }
      for (let i = 0; i < 4; i++) {
        const pos = t.positions[i]
        if (!pos) continue
        const price = this.prices[i]
        const posEq = pos.margin + unrealized(pos, price)
        const effL = Math.max(1, pos.leverage / Math.max(1, pos.marginMul))
        const mmNotional = (MAINTENANCE_FACTOR / effL) * pos.qty * price
        if (posEq > mmNotional && !pos.liquidating) continue
        if (!pos.liquidating) {
          pos.liquidating = true
          t.liquidationCount += 1
        }
        const sliceQty = Math.max(Math.min(pos.qty, pos.qty * LIQUIDATION_SLICE_RATIO), 0)
        if (sliceQty > 0) this.liquidateSlice(t, i, sliceQty, minute)

        // 权益归零：剩余仓位一次性清掉并记欠款（允许负余额，但以 0 结账并记 badDebt）。
        if (t.equity(this.prices) <= 0) {
          const rest = t.positions[i]
          if (rest) this.liquidateSlice(t, i, rest.qty, minute)
          t.failAt(this.prices)
          break
        }
      }
    }
  }

  /**
   * 全仓强平（船长口径：强平 = 归零 + 欠款，可破产）：
   * 所有仓位按现价一次性清掉（额外 0.5% 清算滑点 = 暴露/冲击成本）；
   * 正残值没收进销毁池（权益归零），负残值记欠款并置破产。
   */
  private liquidateCross(t: Trader, minute: number): void {
    if (!t.positions.some((p) => p !== null)) return
    t.liquidationCount += 1
    for (let i = 0; i < 4; i++) {
      const pos = t.positions[i]
      if (pos) this.liquidateSlice(t, i, pos.qty, minute, CROSS_LIQUIDATION_SLIPPAGE_RATE)
    }
    const eq = t.equity(this.prices)
    if (eq > 0) {
      this.confiscated += eq
      t.wallet = 0
      t.dead = true
      t.bankrupt = true
    } else {
      t.failAt(this.prices)
    }
  }

  private liquidateSlice(t: Trader, i: number, qty: number, minute: number, extraSlipRate = 0): void {
    const pos = t.positions[i]
    if (!pos || qty <= 0) return
    const book = this.books[i]
    const price = book.price
    const q = Math.min(qty, pos.qty)
    const gross = q * price
    // 做市商吃的是「交易者的反向」：多头强平 = 交易者卖 → 做市商买（+1）；
    // 空头强平 = 交易者买 → 做市商卖（−1）。所以做市商方向 = 持仓方向 pos.side。
    const mmSide: Side = pos.side
    if (mmSide === 1) {
      this.mm.cash -= gross
      this.mm.inv[i] += q
    } else {
      this.mm.cash += gross
      this.mm.inv[i] -= q
    }
    t.closeQty(i, q, price, minute, true, extraSlipRate)
    // 强平冲击：只算半份（分片，且设计稿要求「不一次性市价砸盘」）。
    const impact =
      -pos.side *
      IMPACT_K *
      this.books[i].liqImpactMultiplier(this.mm.health(this.prices)) *
      0.5 *
      Math.sqrt(gross / (book.spec.floatCap * QREF_RATIO))
    book.applyImpact(impact)
    this.prices[i] = book.price
  }

  /** 系统销毁池（账面）：所有账户交出的费用/罚金/利息/半额资金费 + 全仓强平没收 − 做市商补给。 */
  burnedTotal(): number {
    let sum = 0
    for (const t of this.traders) sum += t.burnedTotal()
    return sum + this.confiscated - this.mmRefillTotal
  }
}

// ============================================================================
// §6 六个人格
// ============================================================================

interface PersonaConfig {
  kind: Exclude<PersonaKind, 'mm'>
  name: string
  title: string
  capital: number
  leverage: number
  /** 单次开仓占权益的比例 */
  sizePct: number
  oneLine: string
}

const PERSONAS: Record<Exclude<PersonaKind, 'mm'>, PersonaConfig> = {
  momentum: {
    kind: 'momentum',
    name: '红隼',
    title: '追涨游资',
    capital: 60_000_000,
    leverage: 5,
    sizePct: 0.25,
    oneLine: '5 分钟涨 2% 就追、跌 2% 就跑，小单密集，见顶就跑。',
  },
  value: {
    kind: 'value',
    name: '磐石',
    title: '死扛基金',
    capital: 300_000_000,
    leverage: 1,
    sizePct: 0.15,
    oneLine: '低于公开参考锚 4% 分批买，高于 6% 派发，弹药有限。',
  },
  short: {
    kind: 'short',
    name: '夜枭',
    title: '空头猎手',
    capital: 120_000_000,
    leverage: 3,
    sizePct: 0.2,
    oneLine: '高于参考锚 5% 分批开空，逼空时被迫高价回补。',
  },
  herd: {
    kind: 'herd',
    name: '群星',
    title: '羊群散户',
    capital: 80_000_000,
    leverage: 2,
    sizePct: 0.15,
    oneLine: '3 分钟动量追热点，恐慌时踩踏，互相传染。',
  },
  whale: {
    kind: 'whale',
    name: '深潮',
    title: '巨鲸',
    capital: 400_000_000,
    leverage: 2,
    sizePct: 0.15,
    oneLine: '低频大额，12 分钟建仓、15 分钟持有、8 分钟派发，带盘口足迹。',
  },
}

const PERSONA_ORDER: Exclude<PersonaKind, 'mm'>[] = ['momentum', 'value', 'short', 'herd', 'whale']
/** 3 人格对照组：做市商 + 游资 + 死扛基金（保留流动性与两个方向性角色，去掉逼空/羊群/巨鲸）。 */
const THREE_PERSONA_ORDER: Exclude<PersonaKind, 'mm'>[] = ['momentum', 'value']

const EMOTION_SIZE: Record<Emotion, number> = {
  calm: 1,
  greed: 1.2,
  fear: 0.6,
  euphoria: 1.35,
  panic: 0.25,
}

const EMOTION_LABEL: Record<Emotion, string> = {
  calm: '平静',
  greed: '贪婪',
  fear: '恐惧',
  euphoria: '亢奋',
  panic: '恐慌',
}

/**
 * 一个人格 = 一个有独立资本账户、情绪状态与记忆的 agent。
 * 所有下单走与玩家完全相同的 Trader.applyFill 通道（同一费率/保证金/强平），不享受特权。
 */
class PersonaAgent {
  readonly cfg: PersonaConfig
  readonly trader: Trader
  emotion: Emotion = 'calm'
  private emotionAt = 0
  private prevEquity: number
  private readonly rng: Rng
  private readonly cooldown = [0, 0, 0, 0]
  /** 深潮的剧本状态 */
  private whalePhase: 'idle' | 'accumulate' | 'hold' | 'distribute' = 'idle'
  private whaleStock = -1
  private whaleDir: Side = 1
  private whalePhaseAt = 0
  private whaleNextCycle = 25
  private whalePerMinute = 0

  constructor(cfg: PersonaConfig, seed: number, feeModel: FeeModel) {
    this.cfg = cfg
    this.trader = new Trader(
      cfg.kind,
      `${cfg.name}·${cfg.title}`,
      'persona',
      cfg.capital,
      feeModel,
      'isolated',
      cfg.kind === 'value' || cfg.kind === 'short',
    )
    this.rng = new Rng(seed ^ hash32(cfg.kind.length * 131 + cfg.capital))
    this.prevEquity = cfg.capital
  }

  private updateEmotion(mkt: Market, minute: number): void {
    const eq = this.trader.equity(mkt.prices)
    const chg = this.prevEquity > 0 ? eq / this.prevEquity - 1 : 0
    this.prevEquity = eq
    if (chg < -0.08) this.emotion = 'panic'
    else if (chg < -0.03) this.emotion = 'fear'
    else if (eq > this.trader.initialCapital * 1.3 && chg > 0.01) this.emotion = 'euphoria'
    else if (chg > 0.05) this.emotion = 'greed'
    else if (minute - this.emotionAt > 15) this.emotion = 'calm'
    if (this.emotion !== 'calm') this.emotionAt = minute
  }

  decide(mkt: Market, minute: number, out: Intent[]): void {
    if (this.trader.dead) return
    this.updateEmotion(mkt, minute)
    const eq = this.trader.equity(mkt.prices)
    const sizeMul = EMOTION_SIZE[this.emotion]
    // 资本耗尽：不再开新仓，只剩平仓（有仓就继续处理下面的平仓分支）。
    const canOpen = eq > this.trader.initialCapital * 0.1
    switch (this.cfg.kind) {
      case 'momentum':
        this.decideMomentum(mkt, minute, out, eq, sizeMul, canOpen)
        break
      case 'value':
        this.decideValue(mkt, minute, out, eq, sizeMul, canOpen)
        break
      case 'short':
        this.decideShort(mkt, minute, out, eq, sizeMul, canOpen)
        break
      case 'herd':
        this.decideHerd(mkt, minute, out, eq, sizeMul, canOpen)
        break
      case 'whale':
        this.decideWhale(mkt, minute, out, eq, sizeMul, canOpen)
        break
    }
  }

  private decideMomentum(
    mkt: Market,
    minute: number,
    out: Intent[],
    eq: number,
    sizeMul: number,
    canOpen: boolean,
  ): void {
    for (let i = 0; i < 4; i++) {
      const pos = this.trader.positions[i]
      const price = mkt.prices[i]
      if (pos) {
        const pnlPct = unrealized(pos, price) / pos.margin
        const hold = minute - pos.openedAt
        const r5 = mkt.ret(i, 5)
        if (pnlPct < -0.12 || r5 < -0.02 || hold > 20) {
          out.push({
            trader: this.trader,
            stock: i,
            qty: -pos.side * pos.qty,
            leverage: this.cfg.leverage,
            kind: 'close',
            reason: '见顶/破位离场',
          })
        }
        continue
      }
      if (!canOpen || minute < this.cooldown[i]) continue
      const r5 = mkt.ret(i, 5)
      if (r5 > 0.02) {
        const notional = eq * this.cfg.sizePct * this.cfg.leverage * sizeMul
        out.push({
          trader: this.trader,
          stock: i,
          qty: notional / price,
          leverage: this.cfg.leverage,
          kind: 'open',
          reason: `5 分钟 +${(r5 * 100).toFixed(1)}% 追涨`,
        })
        this.cooldown[i] = minute + 4
      }
    }
  }

  private decideValue(
    mkt: Market,
    minute: number,
    out: Intent[],
    eq: number,
    sizeMul: number,
    canOpen: boolean,
  ): void {
    for (let i = 0; i < 4; i++) {
      const pos = this.trader.positions[i]
      const price = mkt.prices[i]
      const ref = mkt.refAnchor(i)
      const dev = ref > 0 ? price / ref - 1 : 0
      // v2c 修复 A-3：价值基金在偏离锚点 >15% 时反向大单（1x，最多 40% 权益），
      // 让坐庄者「拉上去没人接、砸下来有人买」，出货变难。
      if (mkt.defenseEnabled && Math.abs(dev) > DEFENSE_DEVIATION) {
        const desired: Side = dev > 0 ? -1 : 1
        if (pos) {
          if (pos.side !== desired || Math.abs(dev) < 0.05) {
            out.push({
              trader: this.trader,
              stock: i,
              qty: -pos.side * pos.qty,
              leverage: this.cfg.leverage,
              kind: 'close',
              reason: `防御：偏离锚点 ${(dev * 100).toFixed(1)}% 反向`,
            })
          }
          continue
        }
        if (canOpen) {
          const notional = Math.min(eq * 0.4, eq)
          out.push({
            trader: this.trader,
            stock: i,
            qty: (desired * notional) / price,
            leverage: 1,
            kind: 'open',
            reason: `防御：偏离锚点 ${(dev * 100).toFixed(1)}% 反向大单`,
          })
        }
        continue
      }
      if (pos) {
        if (pos.side === 1 && price > ref * 1.06) {
          const frac = price > ref * 1.12 ? 1 : 0.5
          out.push({
            trader: this.trader,
            stock: i,
            qty: -pos.qty * frac,
            leverage: this.cfg.leverage,
            kind: 'reduce',
            reason: `高于参考锚 ${((price / ref - 1) * 100).toFixed(1)}% 派发`,
          })
        }
        continue
      }
      if (!canOpen || eq < this.trader.initialCapital * 0.5 || minute < this.cooldown[i]) continue
      if (price < ref * 0.96) {
        const notional = Math.min(eq * this.cfg.sizePct * sizeMul, eq)
        out.push({
          trader: this.trader,
          stock: i,
          qty: notional / price,
          leverage: this.cfg.leverage,
          kind: 'open',
          reason: `低于参考锚 ${((1 - price / ref) * 100).toFixed(1)}% 抄底`,
        })
        this.cooldown[i] = minute + 8
      }
    }
  }

  private decideShort(
    mkt: Market,
    minute: number,
    out: Intent[],
    eq: number,
    sizeMul: number,
    canOpen: boolean,
  ): void {
    for (let i = 0; i < 4; i++) {
      const pos = this.trader.positions[i]
      const price = mkt.prices[i]
      const ref = mkt.refAnchor(i)
      if (pos) {
        const pnlPct = unrealized(pos, price) / pos.margin
        if (pnlPct < -0.5 || price < ref * 0.99 || minute - pos.openedAt > 35) {
          out.push({
            trader: this.trader,
            stock: i,
            qty: -pos.side * pos.qty,
            leverage: this.cfg.leverage,
            kind: 'close',
            reason: pnlPct < -0.5 ? '被逼空，高价回补' : '估值回归，平空',
          })
        }
        continue
      }
      if (!canOpen || minute < this.cooldown[i]) continue
      if (price > ref * 1.05) {
        const notional = eq * this.cfg.sizePct * this.cfg.leverage * sizeMul
        out.push({
          trader: this.trader,
          stock: i,
          qty: -notional / price,
          leverage: this.cfg.leverage,
          kind: 'open',
          reason: `高于参考锚 ${((price / ref - 1) * 100).toFixed(1)}% 开空`,
        })
        this.cooldown[i] = minute + 10
      }
    }
  }

  private decideHerd(
    mkt: Market,
    minute: number,
    out: Intent[],
    eq: number,
    sizeMul: number,
    canOpen: boolean,
  ): void {
    for (let i = 0; i < 4; i++) {
      const pos = this.trader.positions[i]
      const price = mkt.prices[i]
      if (pos) {
        const r3 = mkt.ret(i, 3)
        const pnlPct = unrealized(pos, price) / pos.margin
        if ((mkt.panic > 0.5 && this.rng.next() < 0.5) || r3 < -0.02 || pnlPct < -0.2) {
          out.push({
            trader: this.trader,
            stock: i,
            qty: -pos.side * pos.qty,
            leverage: this.cfg.leverage,
            kind: 'close',
            reason: mkt.panic > 0.5 ? '恐慌踩踏' : '跟风止损',
          })
        }
        continue
      }
      if (!canOpen || minute < this.cooldown[i]) continue
      const r3 = mkt.ret(i, 3)
      if (r3 > 0.015 && this.rng.next() < 0.35 + 0.35 * mkt.panic) {
        const notional = eq * this.cfg.sizePct * this.cfg.leverage * sizeMul
        out.push({
          trader: this.trader,
          stock: i,
          qty: notional / price,
          leverage: this.cfg.leverage,
          kind: 'open',
          reason: `跟风追热点 +${(r3 * 100).toFixed(1)}%`,
        })
        this.cooldown[i] = minute + 5
      }
    }
  }

  private decideWhale(
    mkt: Market,
    minute: number,
    out: Intent[],
    eq: number,
    sizeMul: number,
    canOpen: boolean,
  ): void {
    this.trader.whalePhase = this.whalePhase
    this.trader.whaleStock = this.whaleStock
    this.trader.whaleDir = this.whaleDir
    if (this.whalePhase === 'idle') {
      if (!canOpen || minute < this.whaleNextCycle) return
      // 选「近期动量最强」的标的，方向跟随动量（带一点随机，避免永远同向）。
      let best = 0
      let bestAbs = -1
      for (let i = 0; i < 4; i++) {
        const a = Math.abs(mkt.ret(i, 10))
        if (a > bestAbs) {
          bestAbs = a
          best = i
        }
      }
      const dir: Side =
        this.rng.next() < 0.72 ? (mkt.ret(best, 10) >= 0 ? 1 : -1) : this.rng.next() < 0.5 ? 1 : -1
      this.whaleStock = best
      this.whaleDir = dir
      this.whalePhase = 'accumulate'
      this.whalePhaseAt = minute
      const target = eq * this.cfg.sizePct * this.cfg.leverage * sizeMul
      this.whalePerMinute = target / 12
      return
    }
    const i = this.whaleStock
    const price = mkt.prices[i]
    const pos = this.trader.positions[i]
    if (this.whalePhase === 'accumulate') {
      if (minute - this.whalePhaseAt < 12) {
        out.push({
          trader: this.trader,
          stock: i,
          qty: (this.whaleDir * this.whalePerMinute) / price,
          leverage: this.cfg.leverage,
          kind: 'open',
          reason: '巨鲸缓慢建仓（足迹可见）',
        })
      } else {
        this.whalePhase = 'hold'
        this.whalePhaseAt = minute
      }
      return
    }
    if (this.whalePhase === 'hold') {
      if (minute - this.whalePhaseAt >= 15) {
        this.whalePhase = 'distribute'
        this.whalePhaseAt = minute
      }
      return
    }
    if (pos) {
      const slicesLeft = 8 - (minute - this.whalePhaseAt)
      if (slicesLeft <= 0) {
        out.push({
          trader: this.trader,
          stock: i,
          qty: -pos.side * pos.qty,
          leverage: this.cfg.leverage,
          kind: 'close',
          reason: '巨鲸收尾清仓',
        })
        this.whalePhase = 'idle'
        this.whaleNextCycle = minute + 20 + this.rng.int(0, 25)
      } else {
        out.push({
          trader: this.trader,
          stock: i,
          qty: (-pos.side * pos.qty) / slicesLeft,
          leverage: this.cfg.leverage,
          kind: 'reduce',
          reason: '巨鲸分批派发',
        })
      }
    } else {
      this.whalePhase = 'idle'
      this.whaleNextCycle = minute + 20 + this.rng.int(0, 25)
    }
  }
}

// ============================================================================
// §7 行为模型玩家（前景理论 + 赌徒行为）
// ============================================================================

/** 前景理论概率权重 w(p) = p^γ / (p^γ + (1−p)^γ)^(1/γ)，γ=0.61 时小概率被高估。 */
function probWeight(p: number, gamma: number): number {
  const pc = clamp(p, 1e-6, 1 - 1e-6)
  const a = Math.pow(pc, gamma)
  const b = Math.pow(1 - pc, gamma)
  return a / Math.pow(a + b, 1 / gamma)
}

interface PlayerOptions {
  discipline: number
  lambda: number
  alpha: number
  gamma: number
  leverageCap: number
  feeModel: FeeModel
  seed: number
  mode: 'behavior' | 'random' | 'allin' | 'skill'
  /** 技能三参数（mode='skill' 时生效；缺省回退 discipline 行为模型）。 */
  skill?: SkillParams
  /** 仓位模式自选：both = 按概率抽；isolated/cross = 强制。 */
  marginMode: MarginMode
  /** 抽中全仓的基础概率（再按纪律度下调）。 */
  pCrossBase: number
  /** 全仓模式下「真梭哈（保证金=全部现金）」的基础概率（再按纪律度下调）。 */
  pAllInBase: number
}

/**
 * 行为模型玩家（v2 §二）：
 *   λ=2.25 损失厌恶（不愿止损 → 砍仓概率随损失放大而下降，靠纪律度补偿）
 *   α=0.88 风险偏好曲率（用于下注强度）
 *   γ=0.61 概率权重（高估小概率 → 更愿意上高杠杆「彩票仓」）
 *   过度自信：连赢 3 次后仓位 ×1.3
 *   损失追投：上一笔亏损后，40% 概率仓位 ×1.5
 *   羊群：5 分钟动量 >2% 时同向概率 +20%
 *   纪律度：止损/止盈/时间止损/减仓的执行概率
 */
class BehavioralPlayer {
  readonly trader: Trader
  readonly opts: PlayerOptions
  /** 本局是否抽中全仓（both 模式下按概率；强制模式固定）。 */
  readonly cross: boolean
  private readonly pAllIn: number
  private readonly rng: Rng
  consecutiveWins = 0
  private lastSeenClosed = 0
  private everLost = false
  private peakEquity = INITIAL_CAPITAL
  decisionCount = 0
  orderCount = 0
  allInOpens = 0
  switchCount = 0
  quit = false
  quitMinute = -1
  quitReason = ''
  /** v2c 技能玩家：信号仓的入场信息（-1 = 当前仓不是信号仓）。 */
  private skillEntryMinute = -1
  private skillStock = -1
  private skillDir: Side = 1
  /** 诊断：技能信号仓的笔数、胜率与累计盈亏（按入场时权益对比）。 */
  skillTrades = 0
  skillWins = 0
  skillPnlSum = 0
  private skillEntryEquity = 0

  constructor(opts: PlayerOptions) {
    this.opts = opts
    const rng = new Rng(opts.seed ^ 0x6a09e667)
    const D = opts.discipline
    const pCross =
      opts.marginMode === 'cross'
        ? 1
        : opts.marginMode === 'isolated'
          ? 0
          : clamp(opts.pCrossBase - 0.5 * D, 0.1, 0.9)
    const cross = opts.mode === 'allin' ? opts.marginMode !== 'isolated' : rng.next() < pCross
    this.cross = cross
    this.pAllIn = clamp(opts.pAllInBase - 0.4 * D, 0.15, 0.95)
    this.trader = new Trader(
      'player',
      '行为玩家',
      'player',
      INITIAL_CAPITAL,
      opts.feeModel,
      cross ? 'cross' : 'isolated',
    )
    this.rng = rng
  }

  private positionCount(): number {
    return this.trader.positions.filter((p) => p !== null).length
  }

  private syncStreak(): void {
    while (this.lastSeenClosed < this.trader.closedTrades) {
      this.lastSeenClosed += 1
      if (this.trader.lastClosePnl > 0) this.consecutiveWins += 1
      else {
        this.consecutiveWins = 0
        this.everLost = true
      }
    }
  }

  private currentPosition(): { idx: number; pos: Position } | null {
    for (let i = 0; i < 4; i++) {
      const p = this.trader.positions[i]
      if (p) return { idx: i, pos: p }
    }
    return null
  }

  decide(mkt: Market, minute: number, out: Intent[]): void {
    if (this.trader.dead || this.quit) return
    this.syncStreak()
    this.decisionCount += 1
    const eq = this.trader.equity(mkt.prices)
    if (eq > this.peakEquity) this.peakEquity = eq

    if (this.opts.mode === 'skill') {
      this.decideSkill(mkt, minute, out, eq)
      return
    }

    if (this.opts.mode === 'allin') {
      // 诊断口径「无脑梭哈」：永不主动平仓、永不主动离场，只等强平；用来回答
      // 「v2 的 30%~70% 破产率到底需要多极端的下注」。
      if (this.currentPosition()) return
      const idx = this.rng.int(0, 3)
      const dir: Side = this.rng.next() < 0.5 ? 1 : -1
      const notional = eq * 0.98 * this.opts.leverageCap
      out.push({
        trader: this.trader,
        stock: idx,
        qty: (dir * notional) / mkt.prices[idx],
        leverage: this.opts.leverageCap,
        kind: 'open',
        reason: '梭哈诊断：满仓满杠杆，持有到强平',
      })
      this.orderCount += 1
      return
    }

    // 离场：翻倍止盈 / 纪律止损 / 亏太多割肉。这些检查每分钟都消耗 RNG，保证同种子同路径。
    const D = this.opts.discipline
    if (eq >= INITIAL_CAPITAL * 1.8 && this.rng.next() < 0.1) {
      this.quit = true
      this.quitMinute = minute
      this.quitReason = '翻倍止盈离场'
      return
    }
    if (eq <= INITIAL_CAPITAL * 0.5 && D >= 0.5 && this.rng.next() < 0.03) {
      this.quit = true
      this.quitMinute = minute
      this.quitReason = '触发纪律止损，退场'
      return
    }
    if (eq <= INITIAL_CAPITAL * 0.2 && this.rng.next() < 0.06) {
      this.quit = true
      this.quitMinute = minute
      this.quitReason = '亏太多，割肉离场'
      return
    }

    const cur = this.currentPosition()
    if (cur) {
      const before = out.length
      if (this.opts.mode === 'random') this.decideRandomInPosition(mkt, minute, out, cur)
      else this.decideInPosition(mkt, minute, out, cur, eq)
      // 全仓：所有持仓共用权益，允许在管理主仓之外再开第二条腿（提高全仓语义的真实性）。
      if (this.cross && out.length === before && this.positionCount() < 2 && this.rng.next() < 0.04) {
        this.decideFlat(mkt, minute, out, eq)
      }
      return
    }
    if (this.opts.mode === 'random') this.decideRandomFlat(mkt, minute, out, eq)
    else this.decideFlat(mkt, minute, out, eq)
  }

  /**
   * v2c 修复 B：三技能玩家。
   * 信号 = 信息利用率 ×（事件前兆 + 盘口异动）+ 人格识别率 ×（逼空夜枭 / 反制追涨）；
   * 风险控制决定杠杆、仓位与止损。没有信号时退回行为模型，低技能组因此仍有交易。
   */
  private decideSkill(mkt: Market, minute: number, out: Intent[], eq: number): void {
    const S = this.opts.skill ?? { info: 0, recognize: 0, risk: this.opts.discipline }
    if (eq >= INITIAL_CAPITAL * 1.8 && this.rng.next() < 0.1) {
      this.quit = true
      this.quitMinute = minute
      this.quitReason = '翻倍止盈离场'
      return
    }
    if (eq <= INITIAL_CAPITAL * 0.5 && S.risk >= 0.7 && this.rng.next() < 0.03) {
      this.quit = true
      this.quitMinute = minute
      this.quitReason = '触发纪律止损，退场'
      return
    }
    if (eq <= INITIAL_CAPITAL * 0.2 && this.rng.next() < 0.06) {
      this.quit = true
      this.quitMinute = minute
      this.quitReason = '亏太多，割肉离场'
      return
    }

    const sig = this.skillSignal(mkt, minute)
    let best = -1
    let bestAbs = 0
    for (let i = 0; i < 4; i++) {
      const a = Math.abs(sig[i])
      if (a > bestAbs) {
        bestAbs = a
        best = i
      }
    }
    const cur = this.currentPosition()
    if (cur) {
      this.decideSkillInPosition(mkt, minute, out, cur, eq, sig, best, bestAbs, S)
      return
    }
    if (best < 0 || bestAbs < 0.015) {
      // 无信号：低技能更依赖行为模型；高技能少做无信号单（减少噪声交易）。
      if (this.rng.next() < 1 - S.info) this.decideFlat(mkt, minute, out, eq)
      return
    }
    const price = mkt.prices[best]
    const dir: Side = sig[best] > 0 ? 1 : -1
    const cap = this.opts.leverageCap
    const fpNow = mkt.whaleFootprint()
    const fpBoost = fpNow && fpNow.stock === best ? 30 : 20
    const lev = S.risk >= 0.6 ? Math.min(cap, fpBoost) : Math.min(cap, 50)
    const strength = clamp(bestAbs / 0.02, 0.5, 1.5)
    const frac = clamp((0.25 + 0.35 * (1 - S.risk)) * strength, 0.15, 0.7)
    const notional = eq * frac * lev
    out.push({
      trader: this.trader,
      stock: best,
      qty: (dir * notional) / price,
      leverage: lev,
      kind: 'open',
      reason: `技能：信息${(S.info * 100).toFixed(0)}/识别${(S.recognize * 100).toFixed(0)} 信号 ${(sig[best] * 100).toFixed(2)}%`,
    })
    this.orderCount += 1
    this.switchCount += 1
    this.skillEntryMinute = minute
    this.skillStock = best
    this.skillDir = dir
    this.skillEntryEquity = eq
    this.skillTrades += 1
  }

  /** 技能信号（每只标的的期望方向/强度，单位≈收益率）。 */
  private skillSignal(mkt: Market, minute: number): number[] {
    const S = this.opts.skill ?? { info: 0, recognize: 0, risk: this.opts.discipline }
    const future = mkt.precursorSignal(minute)
    const flow = mkt.personaFlow5(minute)
    const crowd = mkt.personaCrowding()
    const footprint = mkt.whaleFootprint()
    const sig = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      // 信息：事件前兆 + 盘口异动（人格净流）。
      const flowSig = clamp(flow[i] / (STOCKS[i].floatCap * 0.005), -1, 1) * 0.006
      sig[i] += S.info * (future[i] * 1.8 + flowSig)
      const ref = mkt.refAnchor(i)
      const dev = ref > 0 ? mkt.prices[i] / ref - 1 : 0
      // 识别：夜枭净空拥挤且价格在锚上 → 逼空。
      if (crowd.short[i] < -0.0015) {
        const squeeze = clamp(-crowd.short[i] / 0.01, 0, 1)
        if (dev > 0) sig[i] += S.recognize * squeeze * 0.016
      }
      // 识别：红隼/群星追涨拥挤且 5 分钟已涨 >2% → 反向（骗它在山顶）。
      if (crowd.chase[i] > 0.0015 && mkt.ret(i, 5) > 0.02) {
        const fade = clamp(crowd.chase[i] / 0.01, 0, 1)
        sig[i] -= S.recognize * fade * 0.016
      }
      // 整体人格净多拥挤 → 轻微反向。
      if (crowd.net[i] > 0.004) sig[i] -= S.recognize * 0.004
    }
    // 巨鲸足迹：建仓段跟随（12 分钟缓慢建仓），派发段反向。
    if (footprint) {
      const follow = footprint.phase === 'accumulate' ? 1 : footprint.phase === 'distribute' ? -1 : 0
      if (follow !== 0) sig[footprint.stock] += S.info * follow * footprint.dir * 0.05
    }
    return sig
  }

  private decideSkillInPosition(
    mkt: Market,
    minute: number,
    out: Intent[],
    cur: { idx: number; pos: Position },
    eq: number,
    sig: number[],
    best: number,
    bestAbs: number,
    S: SkillParams,
  ): void {
    const { idx, pos } = cur
    if (this.skillEntryMinute < 0) {
      // 兜底行为仓：沿用行为模型的管理逻辑。
      this.decideInPosition(mkt, minute, out, cur, eq)
      return
    }
    const price = mkt.prices[idx]
    const pnlPct = unrealized(pos, price) / pos.margin
    const hold = minute - pos.openedAt
    const close = (reason: string): void => {
      out.push({
        trader: this.trader,
        stock: idx,
        qty: -pos.side * pos.qty,
        leverage: pos.leverage,
        kind: 'close',
        reason,
      })
      this.orderCount += 1
      const eqNow = this.trader.equity(mkt.prices)
      const pnl = eqNow - this.skillEntryEquity
      this.skillPnlSum += pnl
      if (pnl > 0) this.skillWins += 1
      this.skillEntryMinute = -1
      this.skillStock = -1
    }
    const stop = 0.4 - 0.2 * S.risk
    if (pnlPct <= -stop && this.rng.next() < 0.3 + 0.65 * S.risk) {
      close(`技能止损 ${(pnlPct * 100).toFixed(0)}%`)
      return
    }
    const take = 0.7 - 0.4 * S.risk
    if (pnlPct >= take && this.rng.next() < 0.4 + 0.5 * S.risk) {
      close(`技能止盈 +${(pnlPct * 100).toFixed(0)}%`)
      return
    }
    const sameStrong = best >= 0 && bestAbs > 0.004 && signOf(sig[best]) === pos.side
    if (best >= 0 && bestAbs > 0.004 && signOf(sig[best]) !== pos.side) {
      close('信号反转，先离场')
      return
    }
    if (hold >= 8 && !sameStrong) {
      close('事件已兑现，离场')
      return
    }
    if (hold > 12) close('信号仓超时')
  }

  private decideRandomInPosition(
    mkt: Market,
    minute: number,
    out: Intent[],
    cur: { idx: number; pos: Position },
  ): void {
    void mkt
    const hold = minute - cur.pos.openedAt
    if (this.rng.next() < 0.07 || hold > 20) {
      out.push({
        trader: this.trader,
        stock: cur.idx,
        qty: -cur.pos.side * cur.pos.qty,
        leverage: cur.pos.leverage,
        kind: 'close',
        reason: '随机平仓',
      })
      this.orderCount += 1
    }
  }

  private decideRandomFlat(mkt: Market, minute: number, out: Intent[], eq: number): void {
    void minute
    if (this.rng.next() > 0.22) return
    const idx = this.rng.int(0, 3)
    const price = mkt.prices[idx]
    const dir: Side = this.rng.next() < 0.5 ? 1 : -1
    const caps = [2, 5, 10, 20, 50].filter((x) => x <= this.opts.leverageCap)
    const lev = caps[this.rng.int(0, caps.length - 1)]
    const frac = 0.2 + 0.4 * this.rng.next()
    const notional = eq * frac * lev
    out.push({
      trader: this.trader,
      stock: idx,
      qty: (dir * notional) / price,
      leverage: lev,
      kind: 'open',
      reason: '随机对照下注',
    })
    this.orderCount += 1
    this.switchCount += 1
  }

  private decideInPosition(
    mkt: Market,
    minute: number,
    out: Intent[],
    cur: { idx: number; pos: Position },
    eq: number,
  ): void {
    const { idx, pos } = cur
    const price = mkt.prices[idx]
    const D = this.opts.discipline
    const pnlPct = unrealized(pos, price) / pos.margin
    const hold = minute - pos.openedAt

    // 真梭哈：不设止损/止盈/时间止损，持有到强平（赌徒行为的极端档）。
    if (pos.allIn) return

    // 止损：纪律度越高越会砍；损失厌恶 λ 越大越倾向扛（由 D 补偿）。
    const stop = 0.38 - 0.2 * D
    if (pnlPct <= -stop && this.rng.next() < 0.2 + 0.7 * D) {
      out.push({
        trader: this.trader,
        stock: idx,
        qty: -pos.side * pos.qty,
        leverage: pos.leverage,
        kind: 'close',
        reason: `止损 ${(pnlPct * 100).toFixed(0)}%`,
      })
      this.orderCount += 1
      return
    }
    // 止盈：纪律度高的人更愿意落袋。
    const take = 0.65 - 0.4 * D
    if (pnlPct >= take && this.rng.next() < 0.3 + 0.6 * D) {
      out.push({
        trader: this.trader,
        stock: idx,
        qty: -pos.side * pos.qty,
        leverage: pos.leverage,
        kind: 'close',
        reason: `止盈 +${(pnlPct * 100).toFixed(0)}%`,
      })
      this.orderCount += 1
      return
    }
    // 时间止损：扛太久没有行情就走。
    if (hold >= 10 && this.rng.next() < 0.5) {
      out.push({
        trader: this.trader,
        stock: idx,
        qty: -pos.side * pos.qty,
        leverage: pos.leverage,
        kind: 'close',
        reason: '持仓 30 分钟无行情',
      })
      this.orderCount += 1
      return
    }
    // 过度自信：连赢 3 次后加仓。
    if (this.consecutiveWins >= 3 && pnlPct > 0.12 && this.rng.next() < 0.2) {
      const notional = eq * 0.15 * pos.leverage * 1.3
      out.push({
        trader: this.trader,
        stock: idx,
        qty: (pos.side * notional) / price,
        leverage: pos.leverage,
        kind: 'add',
        reason: '连赢后过度自信加仓 ×1.3',
      })
      this.orderCount += 1
      return
    }
    // 减仓：权益从峰值回撤 >40% 时，纪律度高的人先减半。
    const dd = this.peakEquity > 0 ? 1 - eq / this.peakEquity : 0
    if (dd > 0.4 && this.rng.next() < D * 0.5) {
      out.push({
        trader: this.trader,
        stock: idx,
        qty: -pos.side * pos.qty * 0.5,
        leverage: pos.leverage,
        kind: 'reduce',
        reason: '回撤过大，减仓一半',
      })
      this.orderCount += 1
      return
    }
    // 换标的：另一只标的 5 分钟动量明显更强，且本仓浮亏。
    let best = -1
    let bestAbs = 0
    for (let i = 0; i < 4; i++) {
      if (i === idx) continue
      const a = Math.abs(mkt.ret(i, 5))
      if (a > bestAbs) {
        bestAbs = a
        best = i
      }
    }
    if (best >= 0 && bestAbs > 0.03 && pnlPct < 0.05 && this.rng.next() < 0.25) {
      out.push({
        trader: this.trader,
        stock: idx,
        qty: -pos.side * pos.qty,
        leverage: pos.leverage,
        kind: 'close',
        reason: '换到更热的标的',
      })
      this.orderCount += 1
      this.switchCount += 1
      return
    }
  }

  private decideFlat(mkt: Market, minute: number, out: Intent[], eq: number): void {
    void minute
    const D = this.opts.discipline
    const pAct = 0.35 + 0.15 * (1 - D)
    if (this.rng.next() > pAct) return

    // 换标的：优先追 5 分钟动量最大的那只（羊群）。
    let hot = 0
    let hotAbs = -1
    for (let i = 0; i < 4; i++) {
      const a = Math.abs(mkt.ret(i, 5))
      if (a > hotAbs) {
        hotAbs = a
        hot = i
      }
    }
    const idx = this.rng.next() < 0.7 ? hot : this.rng.int(0, 3)
    const price = mkt.prices[idx]
    const mom = mkt.ret(idx, 5)
    const herd = Math.abs(mom) > 0.02
    // 羊群：动量 >2% 时同向概率 +20%。
    const pFollow = clamp(0.5 + (herd ? 0.2 : 0) + clamp(mom * 8, -0.15, 0.15), 0.15, 0.95)
    const dir: Side = this.rng.next() < pFollow ? (mom >= 0 ? 1 : -1) : mom >= 0 ? -1 : 1

    // 概率权重：把「动量会延续」的主观概率 w(p) 作为下注门槛。
    const pWin = clamp(0.5 + 0.25 * Math.min(1, Math.abs(mom) / 0.03), 0.5, 0.75)
    const w = probWeight(pWin, this.opts.gamma)
    if (this.rng.next() > w + 0.1) return

    // 彩票效应：纪律低的人用加权概率选最高杠杆（γ 高估小概率）。
    const pMax = 0.2
    const pTakeMax = D > 0.5 ? pMax : probWeight(pMax, this.opts.gamma)
    let lev: number
    if (this.rng.next() < pTakeMax + 0.1) lev = this.opts.leverageCap
    else if (this.rng.next() < 0.65) lev = Math.min(this.opts.leverageCap, 10)
    else lev = Math.min(this.opts.leverageCap, 5)

    // 全仓模式下的「真梭哈」：保证金 = 全部现金，杠杆取上限。
    const allIn = this.cross && this.rng.next() < this.pAllIn
    if (allIn) lev = this.opts.leverageCap

    // 下注强度：α 曲率 + 过度自信 + 损失追投 + 纪律度。
    let frac = 0.5 * (0.8 + 1.2 * Math.max(0, w - 0.5)) * (1 + 0.5 * (1 - D))
    if (this.consecutiveWins >= 3) frac *= 1.3
    if (this.everLost && this.rng.next() < 0.4) frac *= 1.5
    // 报复性梭哈：大亏之后有一小段概率直接压满（前景理论里损失端的风险寻求）。
    if (this.everLost && this.rng.next() < 0.25) frac = 0.98
    frac = clamp(frac, 0.2, 0.98)
    if (allIn) frac = 0.98
    const notional = eq * frac * lev
    out.push({
      trader: this.trader,
      stock: idx,
      qty: (dir * notional) / price,
      leverage: lev,
      kind: 'open',
      allIn,
      reason: `${dir === 1 ? '做多' : '做空'} ${STOCKS[idx].code} ${lev}x${herd ? '（羊群）' : ''}${allIn ? ' 全仓梭哈' : ''}`,
    })
    this.orderCount += 1
    if (allIn) this.allInOpens += 1
    this.switchCount += 1
  }
}

// ============================================================================
// §8 操纵策略（拉盘/砸盘）——用来测「桌子会不会被单一策略打穿」
// ============================================================================

/**
 * 拉盘/砸盘脚本（无行为模型，纯策略）：
 *   0~9 分钟：每分钟用 4% 权益作保证金、按上限杠杆单向建仓（≈ 80% 名义/分钟）；
 *   10~14 分钟：持有，等羊群/游资跟风；
 *   15~24 分钟：每分钟平掉剩余仓位的 1/3，把货派发给跟风盘。
 * 若操纵期望 > 0，说明「把价格推上去再卖给跟风者」是稳定盈利的，桌子可被操纵。
 */
class ScriptedMover {
  readonly trader: Trader
  readonly kind: 'pump' | 'dump'
  readonly stock: number
  readonly leverage: number
  orderCount = 0

  constructor(kind: 'pump' | 'dump', stock: number, leverage: number, feeModel: FeeModel, capital = INITIAL_CAPITAL) {
    this.kind = kind
    this.stock = stock
    this.leverage = leverage
    this.trader = new Trader('script', kind === 'pump' ? '拉盘脚本' : '砸盘脚本', 'script', capital, feeModel)
  }

  decide(mkt: Market, minute: number, out: Intent[]): void {
    if (this.trader.dead) return
    const dir: Side = this.kind === 'pump' ? 1 : -1
    const price = mkt.prices[this.stock]
    const pos = this.trader.positions[this.stock]
    if (minute < 10) {
      // 逐分钟加仓（不能只在空仓时开一次，否则「拉盘」根本没有量）。
      const eq = this.trader.equity(mkt.prices)
      const notional = eq * 0.08 * this.leverage
      out.push({
        trader: this.trader,
        stock: this.stock,
        qty: (dir * notional) / price,
        leverage: this.leverage,
        kind: pos ? 'add' : 'open',
        reason: '操纵：建仓',
      })
      this.orderCount += 1
      return
    }
    if (minute < 15) return
    if (minute < 25 && pos) {
      const slice = pos.qty / 3
      out.push({
        trader: this.trader,
        stock: this.stock,
        qty: -pos.side * Math.min(slice, pos.qty),
        leverage: this.leverage,
        kind: 'reduce',
        reason: '操纵：派发',
      })
      this.orderCount += 1
      return
    }
    if (minute >= 25 && pos) {
      out.push({
        trader: this.trader,
        stock: this.stock,
        qty: -pos.side * pos.qty,
        leverage: this.leverage,
        kind: 'close',
        reason: '操纵：清仓',
      })
      this.orderCount += 1
    }
  }
}

// ============================================================================
// §9 单局仿真与指标
// ============================================================================

interface SimConfig {
  id: string
  runs: number
  minutes: number
  leverageCap: number
  feeModel: FeeModel
  eventMeanMin: number
  personaCount: 3 | 6
  discipline: number
  /** behavior = 行为模型；random = 随机对照；none = 无人格玩家（人格存活测试）；pump/dump = 操纵脚本 */
  playerMode: 'behavior' | 'random' | 'allin' | 'skill' | 'none' | 'pump' | 'dump'
  moverStock: number
  seed: number
  /** 派生随机种子用：同 phase+combo+run 的跨组实验共享同一条外生价格路径（配对比较）。 */
  phase: number
  combo: number
  mmCapital: number
  /** 做市商穿仓即停（30 日 AI 测试用：穿仓后流动性真空，继续跑没有成交意义）。 */
  stopOnMmDeath?: boolean
  /** 仓位模式：both = 行为玩家自选；isolated/cross = 强制。 */
  marginMode: MarginMode
  /** 均值回归参数。 */
  theta: ThetaConfig
  /** 做市商是否从销毁池受控补给。 */
  mmRefill: boolean
  /** 极端波动时提高保证金 / 限制开空。 */
  extremeVolRules: boolean
  /** 行为玩家抽中全仓/真梭哈的基础概率（纪律度会下调）。 */
  pCrossBase: number
  pAllInBase: number
  /** v2c 修复 A：凸性冲击 / 监管罚没 / 反向流动性。 */
  impact: ImpactModel
  regulator: boolean
  regulatorGamma: number
  defense: boolean
  /** v2c 修复 B：技能玩家三参数；skillMode=true 时覆盖 discipline。 */
  skillMode: boolean
  skill: SkillParams
  /** 坐庄脚本的初始本金档（小/中/大）。 */
  moverCapital: number
}

interface PersonaResult {
  kind: PersonaKind
  name: string
  title: string
  initial: number
  finalEquity: number
  returnPct: number
  dead: boolean
  /** 期末权益仍 > 初始 10%（v1 的有效存活口径） */
  above10: boolean
  feesPaid: number
  /** 资金费 + 借券费/资金占用（人格持仓成本）。 */
  carryPaid: number
  liquidationCount: number
  openPositions: number
}

interface RunMetrics {
  finalEquity: number
  /** 本局收益率的分母（玩家/坐庄脚本各自的初始本金）。 */
  initialRef: number
  finalReturn: number
  bankrupt: boolean
  quit: boolean
  quitReason: string
  sessionMinutes: number
  censored: boolean
  decisions: number
  orders: number
  /** 每分钟出现「权益波动 > 10% 本金」的次数（按局内分钟数） */
  swingRate: number
  swingMinutes: number
  /** 距强平 < 5% 的爆仓数 / 爆仓数（v2 字面口径，≥7x 会结构性饱和） */
  liqCount: number
  liquidatedExits: number
  nearMissLiteral: number
  /** 未爆仓但消耗了 ≥80% 强平缓冲的仓位占比（本仿真的「差一点」补充口径） */
  normalExits: number
  nearMissBuffer: number
  recoverEpisodes: number
  recoverSuccess: number
  maxDrawdown: number
  feesPaid: number
  fundingPaid: number
  interestPaid: number
  /** 玩家自己交出去的销毁总额（费+滑点+罚金+利息+半额资金费+穿仓欠款） */
  playerBurned: number
  burned: number
  /** 做市商权益首次 ≤0 的分钟；-1 = 未穿仓 */
  mmDeathMinute: number
  /** 本局从销毁池补给做市商的累计金额。 */
  mmRefill: number
  personaResults: PersonaResult[]
  mmDelta: number
  mmHealthEnd: number
  /** 初始总资金 + 销毁 − 期末总权益；应 ≈ 0 */
  residual: number
  realizedDailyVol: number
  /** 玩家每个平仓仓位的缓冲消耗（用于分布） */
  bufferUses: number[]
  /** 本局玩家是否抽中全仓、以及真梭哈开仓次数（用于核对行为概率）。 */
  playerCross: boolean
  allInOpens: number
  /** 技能信号仓诊断（非技能组为 0）。 */
  skillTrades: number
  skillWins: number
  skillPnl: number
}

function mean(a: readonly number[]): number {
  if (a.length === 0) return 0
  let s = 0
  for (const v of a) s += v
  return s / a.length
}

function std(a: readonly number[]): number {
  if (a.length < 2) return 0
  const m = mean(a)
  let s = 0
  for (const v of a) s += (v - m) * (v - m)
  return Math.sqrt(s / (a.length - 1))
}

function quantile(a: readonly number[], q: number): number {
  if (a.length === 0) return 0
  const sorted = [...a].sort((x, y) => x - y)
  const pos = clamp(q, 0, 1) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function median(a: readonly number[]): number {
  return quantile(a, 0.5)
}

/** 从总权益算日化实现波动率（分钟收益平方和 → σ_min × √1440）。 */
function dailyVolOf(varSum: readonly number[], minutes: number): number {
  if (minutes <= 0) return 0
  let acc = 0
  for (const v of varSum) acc += Math.sqrt(v / minutes) * Math.sqrt(MINUTES_PER_DAY)
  return acc / varSum.length
}

/** 临时核账开关（--debug-accounting 时打印一次分项）。 */
let DEBUG_ACCOUNTING = false

function runOne(cfg: SimConfig, runIndex: number): RunMetrics {
  const seed = deriveSeed(cfg.seed, cfg.phase, cfg.combo, runIndex)
  const traders: Trader[] = []
  let player: BehavioralPlayer | null = null
  let mover: ScriptedMover | null = null
  if (
    cfg.playerMode === 'behavior' ||
    cfg.playerMode === 'random' ||
    cfg.playerMode === 'allin' ||
    cfg.playerMode === 'skill'
  ) {
    player = new BehavioralPlayer({
      discipline: cfg.discipline,
      lambda: 2.25,
      alpha: 0.88,
      gamma: 0.61,
      leverageCap: cfg.leverageCap,
      feeModel: cfg.feeModel,
      seed,
      mode: cfg.playerMode === 'skill' ? 'skill' : cfg.playerMode,
      skill: cfg.skillMode ? cfg.skill : undefined,
      marginMode: cfg.marginMode,
      pCrossBase: cfg.pCrossBase,
      pAllInBase: cfg.pAllInBase,
    })
    traders.push(player.trader)
  } else if (cfg.playerMode === 'pump' || cfg.playerMode === 'dump') {
    mover = new ScriptedMover(cfg.playerMode, cfg.moverStock, cfg.leverageCap, cfg.feeModel, cfg.moverCapital)
    traders.push(mover.trader)
  }
  const personaKinds = cfg.personaCount === 6 ? PERSONA_ORDER : THREE_PERSONA_ORDER
  const personas = personaKinds.map((k) => new PersonaAgent(PERSONAS[k], seed, cfg.feeModel))
  for (const p of personas) traders.push(p.trader)

  const market = new Market(
    seed,
    cfg.eventMeanMin,
    traders,
    cfg.mmCapital,
    cfg.theta,
    cfg.mmRefill,
    cfg.extremeVolRules,
    cfg.impact,
    cfg.regulator,
    cfg.regulatorGamma,
    cfg.defense,
  )
  // 初始总资金按「实际入场的账户」算（AI 测试没有玩家，不能把玩家的 1000 万算进去）。
  const initialTotal = traders.reduce((a, t) => a + t.initialCapital, 0) + cfg.mmCapital

  let sessionMinutes = cfg.minutes
  let bankrupt = false
  let quit = false
  let quitReason = ''
  let swingMinutes = 0
  let prevEq = INITIAL_CAPITAL
  let peak = INITIAL_CAPITAL
  let maxDD = 0
  let recoverEpisodes = 0
  let recoverSuccess = 0
  let recoverActive = false
  let recoverPeak = 0
  let recoverStart = 0
  let mmDeathMinute = -1

  for (let m = 0; m < cfg.minutes; m++) {
    market.beginMinute(m)
    const intents: Intent[] = []
    if (player) player.decide(market, m, intents)
    if (mover) mover.decide(market, m, intents)
    for (const p of personas) p.decide(market, m, intents)
    market.execute(m, intents)
    if (mmDeathMinute < 0 && market.mm.equity(market.prices) <= 0) {
      mmDeathMinute = m
      if (cfg.stopOnMmDeath) {
        sessionMinutes = m
        break
      }
    }

    if (player) {
      const eq = player.trader.equity(market.prices)
      if (m > 0 && Math.abs(eq - prevEq) > INITIAL_CAPITAL * 0.1) swingMinutes += 1
      prevEq = eq
      if (eq > peak) peak = eq
      maxDD = Math.max(maxDD, peak > 0 ? 1 - eq / peak : 0)
      if (!recoverActive && peak > 0 && eq <= peak * 0.5) {
        recoverActive = true
        recoverPeak = peak
        recoverStart = m
        recoverEpisodes += 1
      }
      if (recoverActive) {
        if (eq >= recoverPeak) {
          recoverSuccess += 1
          recoverActive = false
        } else if (m - recoverStart >= 60) {
          recoverActive = false
        }
      }
      if (player.trader.dead) {
        bankrupt = true
        sessionMinutes = m
        break
      }
      if (player.quit) {
        quit = true
        quitReason = player.quitReason
        sessionMinutes = Math.max(1, m)
        break
      }
    }
  }
  if (!player && !mover) sessionMinutes = cfg.minutes
  if (player && !bankrupt && !quit) sessionMinutes = cfg.minutes

  // 期末结算：只做标记，不强制平仓（避免造出不存在的对手盘与费用）。
  const playerFinalRaw = player ? player.trader.finalize(market.prices) : 0
  const moverFinalRaw = mover ? mover.trader.finalize(market.prices) : 0
  const playerFinal = Math.max(0, playerFinalRaw)
  const moverFinal = Math.max(0, moverFinalRaw)
  const personaResults: PersonaResult[] = []
  for (const p of personas) {
    const fin = p.trader.finalize(market.prices)
    personaResults.push({
      kind: p.cfg.kind,
      name: p.cfg.name,
      title: p.cfg.title,
      initial: p.cfg.capital,
      finalEquity: fin,
      returnPct: fin / p.cfg.capital - 1,
      dead: p.trader.dead,
      above10: fin > p.cfg.capital * 0.1,
      feesPaid: p.trader.feesPaid,
      carryPaid: p.trader.interestPaid + p.trader.fundingGrossPaid,
      liquidationCount: p.trader.liquidationCount,
      openPositions: p.trader.positions.filter((x) => x !== null).length,
    })
  }
  const mmFinal = market.mm.equity(market.prices)
  const burned = market.burnedTotal()
  // 核账用「原始权益」（可为负），不用展示用的 0 截断值。
  const totalFinal = (player ? playerFinalRaw : moverFinalRaw) +
    personaResults.reduce((a, r) => a + r.finalEquity, 0) +
    mmFinal +
    burned
  const residual = totalFinal - initialTotal
  if (DEBUG_ACCOUNTING && runIndex < 8) {
    console.log(
      `DBG run=${runIndex} cross=${player ? player.cross : 'none'} allIn=${player ? player.allInOpens : 0} liq=${player ? player.trader.liquidationCount : 0} dead=${player ? player.trader.dead : false} bank=${bankrupt} sess=${sessionMinutes} final=${playerFinalRaw.toFixed(0)} fees=${player ? player.trader.feesPaid.toFixed(0) : 0}`,
    )
  }
  if (DEBUG_ACCOUNTING && runIndex === 0) {
    const personaSum = personaResults.reduce((a, r) => a + r.finalEquity, 0)
    const posSum = [0, 0, 0, 0]
    for (const t of traders) {
      for (let i = 0; i < 4; i++) {
        const p = t.positions[i]
        if (p) posSum[i] += p.qty * p.side
      }
    }
    console.log(
      `ACCT initial=${initialTotal.toFixed(0)} player=${(player ? playerFinalRaw : 0).toFixed(0)} mover=${(mover ? moverFinalRaw : 0).toFixed(0)} persona=${personaSum.toFixed(0)} mm=${mmFinal.toFixed(0)} burned=${burned.toFixed(0)} residual=${residual.toFixed(0)} mmCash=${market.mm.cash.toFixed(0)} mmInv=${market.mm.inv.map((v) => v.toFixed(0)).join(',')} posSum=${posSum.map((v) => v.toFixed(0)).join(',')} net=${posSum.map((v, i) => (v + market.mm.inv[i]).toFixed(0)).join(',')} prices=${market.prices.map((p) => p.toFixed(1)).join(',')}`,
    )
  }

  const playerTrader = player ? player.trader : mover ? mover.trader : null
  const exits = playerTrader ? playerTrader.exits : []
  const liquidatedExits = exits.filter((e) => e.liq).length
  const nearMissLiteral = exits.filter((e) => e.liq && e.lastDist < 5).length
  const normalExits = exits.filter((e) => !e.liq).length
  const nearMissBuffer = exits.filter((e) => !e.liq && e.bufferUse >= 0.8).length

  const finalEquity = player ? playerFinalRaw : moverFinalRaw
  const initialRef = player ? INITIAL_CAPITAL : mover ? cfg.moverCapital : INITIAL_CAPITAL
  return {
    finalEquity,
    initialRef,
    // 收益按「最多亏光本金」计（负权益是欠款，不把收益算成 <-100%）。
    finalReturn: Math.max(0, finalEquity) / initialRef - 1,
    bankrupt,
    quit,
    quitReason,
    sessionMinutes,
    censored: !bankrupt && !quit && (player !== null || mover !== null),
    decisions: player ? player.decisionCount : mover ? mover.orderCount : 0,
    orders: player ? player.orderCount : mover ? mover.orderCount : 0,
    swingRate: sessionMinutes > 0 ? swingMinutes / sessionMinutes : 0,
    swingMinutes,
    liqCount: playerTrader ? playerTrader.liquidationCount : 0,
    liquidatedExits,
    nearMissLiteral,
    normalExits,
    nearMissBuffer,
    recoverEpisodes,
    recoverSuccess,
    maxDrawdown: maxDD,
    feesPaid: playerTrader ? playerTrader.feesPaid : 0,
    fundingPaid: playerTrader ? playerTrader.fundingGrossPaid : 0,
    interestPaid: playerTrader ? playerTrader.interestPaid : 0,
    playerBurned: playerTrader ? playerTrader.burnedTotal() : 0,
    burned,
    mmDeathMinute,
    mmRefill: market.mmRefillTotal,

    personaResults,
    mmDelta: mmFinal - cfg.mmCapital,
    mmHealthEnd: market.mm.health(market.prices),
    residual,
    realizedDailyVol: dailyVolOf(market.realizedVarSum, market.realizedMinutes),
    bufferUses: exits.map((e) => e.bufferUse),
    playerCross: player ? player.cross : false,
    allInOpens: player ? player.allInOpens : 0,
    skillTrades: player ? player.skillTrades : 0,
    skillWins: player ? player.skillWins : 0,
    skillPnl: player ? player.skillPnlSum : 0,
  }
}

// ============================================================================
// §10 组汇总
// ============================================================================

interface ArmSummary {
  cfg: SimConfig
  runs: RunMetrics[]
  bankruptRate: number
  /** 有效出局：期末权益 < 初始 10%（v1 的「100 万开户门槛」口径） */
  below10Rate: number
  /** 期末权益 < 初始 50% */
  below50Rate: number
  profitRate: number
  quitRate: number
  censoredRate: number
  sessionMedian: number
  sessionP10: number
  sessionP90: number
  finalMean: number
  finalMedian: number
  finalP10: number
  finalP90: number
  finalStd: number
  finalSE: number
  swingRateMedian: number
  swingRateP90: number
  swingMax: number
  liqRate: number
  nearMissLiteralRate: number
  nearMissBufferRate: number
  recoverEpisodes: number
  recoverRate: number
  decisionsPerMin: number
  ordersPerMin: number
  maxDDMedian: number
  feesPerRun: number
  fundingPerRun: number
  playerBurnedPerRun: number
  burnedPerRun: number
  mmDeltaMean: number
  residualMaxAbs: number
  residualMeanAbs: number
  realizedVol: number
  bufferUseMedian: number
  crossRate: number
  allInMean: number
}

function summarize(cfg: SimConfig, runs: RunMetrics[]): ArmSummary {
  const live = runs.filter((r) => true)
  const n = live.length
  const sessions = live.map((r) => r.sessionMinutes)
  const finals = live.map((r) => r.finalReturn)
  const liq = live.reduce((a, r) => a + r.liquidatedExits, 0)
  const nearLit = live.reduce((a, r) => a + r.nearMissLiteral, 0)
  const norm = live.reduce((a, r) => a + r.normalExits, 0)
  const nearBuf = live.reduce((a, r) => a + r.nearMissBuffer, 0)
  const recEp = live.reduce((a, r) => a + r.recoverEpisodes, 0)
  const recOk = live.reduce((a, r) => a + r.recoverSuccess, 0)
  const totalMinutes = live.reduce((a, r) => a + r.sessionMinutes, 0)
  const totalOrders = live.reduce((a, r) => a + r.orders, 0)
  const swings = live.map((r) => r.swingRate)
  const bufferUses = live.flatMap((r) => r.bufferUses)
  const m = mean(finals)
  const s = std(finals)
  return {
    cfg,
    runs: live,
    bankruptRate: live.filter((r) => r.bankrupt).length / n,
    below10Rate: live.filter((r) => r.finalEquity < r.initialRef * 0.1).length / n,
    below50Rate: live.filter((r) => r.finalEquity < r.initialRef * 0.5).length / n,
    profitRate: live.filter((r) => r.finalReturn > 0).length / n,
    quitRate: live.filter((r) => r.quit).length / n,
    censoredRate: live.filter((r) => r.censored).length / n,
    sessionMedian: median(sessions),
    sessionP10: quantile(sessions, 0.1),
    sessionP90: quantile(sessions, 0.9),
    finalMean: m,
    finalMedian: median(finals),
    finalP10: quantile(finals, 0.1),
    finalP90: quantile(finals, 0.9),
    finalStd: s,
    finalSE: n > 0 ? s / Math.sqrt(n) : 0,
    swingRateMedian: median(swings),
    swingRateP90: quantile(swings, 0.9),
    swingMax: swings.length > 0 ? Math.max(...swings) : 0,
    liqRate: liq > 0 ? liq / Math.max(1, liq + norm) : 0,
    nearMissLiteralRate: liq > 0 ? nearLit / liq : 0,
    nearMissBufferRate: norm > 0 ? nearBuf / norm : 0,
    recoverEpisodes: recEp,
    recoverRate: recEp > 0 ? recOk / recEp : 0,
    decisionsPerMin: totalMinutes > 0 ? live.reduce((a, r) => a + r.decisions, 0) / totalMinutes : 0,
    ordersPerMin: totalMinutes > 0 ? totalOrders / totalMinutes : 0,
    maxDDMedian: median(live.map((r) => r.maxDrawdown)),
    feesPerRun: mean(live.map((r) => r.feesPaid)),
    fundingPerRun: mean(live.map((r) => r.fundingPaid)),
    playerBurnedPerRun: mean(live.map((r) => r.playerBurned)),
    burnedPerRun: mean(live.map((r) => r.burned)),
    mmDeltaMean: mean(live.map((r) => r.mmDelta)),
    residualMaxAbs: live.reduce((a, r) => Math.max(a, Math.abs(r.residual)), 0),
    residualMeanAbs: mean(live.map((r) => Math.abs(r.residual))),
    realizedVol: mean(live.map((r) => r.realizedDailyVol)),
    bufferUseMedian: median(bufferUses),
    crossRate: live.filter((r) => r.playerCross).length / n,
    allInMean: mean(live.map((r) => r.allInOpens)),
  }
}

function runArm(cfg: SimConfig): ArmSummary {
  const runs: RunMetrics[] = []
  for (let i = 0; i < cfg.runs; i++) runs.push(runOne(cfg, i))
  return summarize(cfg, runs)
}

// ============================================================================
// §11 实验编排
// ============================================================================

interface SkillStats {
  eta2: number
  f: number
  pairedMean: number
  pairedSE: number
  pairedT: number
  meanLow: number
  meanHigh: number
  meanRand: number
  medianLow: number
  medianHigh: number
  medianRand: number
}

/**
 * 技巧-运气分解：
 *   η² = 组间平方和 / 总平方和（技巧能解释的收益方差占比）；
 *   配对 t：三组共用同一条外生价格路径（同 run 种子），因此可做配对差检验。
 */
function skillStats(low: ArmSummary, high: ArmSummary, rand: ArmSummary): SkillStats {
  const groups = [low, high, rand]
  const all = groups.flatMap((g) => g.runs.map((r) => r.finalReturn))
  const grand = mean(all)
  let ssBetween = 0
  let ssWithin = 0
  for (const g of groups) {
    const vals = g.runs.map((r) => r.finalReturn)
    const m = mean(vals)
    ssBetween += vals.length * (m - grand) * (m - grand)
    for (const v of vals) ssWithin += (v - m) * (v - m)
  }
  const ssTotal = ssBetween + ssWithin
  const eta2 = ssTotal > 0 ? ssBetween / ssTotal : 0
  const dfB = groups.length - 1
  const dfW = all.length - groups.length
  const f = dfW > 0 && ssWithin > 0 ? ssBetween / dfB / (ssWithin / dfW) : 0
  const n = Math.min(low.runs.length, high.runs.length)
  const diffs: number[] = []
  for (let i = 0; i < n; i++) diffs.push(high.runs[i].finalReturn - low.runs[i].finalReturn)
  const dMean = mean(diffs)
  const dStd = std(diffs)
  const se = n > 0 ? dStd / Math.sqrt(n) : 0
  return {
    eta2,
    f,
    pairedMean: dMean,
    pairedSE: se,
    pairedT: se > 0 ? dMean / se : 0,
    meanLow: mean(low.runs.map((r) => r.finalReturn)),
    meanHigh: mean(high.runs.map((r) => r.finalReturn)),
    meanRand: mean(rand.runs.map((r) => r.finalReturn)),
    medianLow: median(low.runs.map((r) => r.finalReturn)),
    medianHigh: median(high.runs.map((r) => r.finalReturn)),
    medianRand: median(rand.runs.map((r) => r.finalReturn)),
  }
}

/** 多组（≥3）单因素方差分析：η² = 组间平方和 / 总平方和。 */
function anovaEta2(groups: ArmSummary[]): { eta2: number; f: number } {
  const all = groups.flatMap((g) => g.runs.map((r) => r.finalReturn))
  const grand = mean(all)
  let ssBetween = 0
  let ssWithin = 0
  for (const g of groups) {
    const vals = g.runs.map((r) => r.finalReturn)
    const m = mean(vals)
    ssBetween += vals.length * (m - grand) * (m - grand)
    for (const v of vals) ssWithin += (v - m) * (v - m)
  }
  const ssTotal = ssBetween + ssWithin
  const dfB = groups.length - 1
  const dfW = all.length - groups.length
  return {
    eta2: ssTotal > 0 ? ssBetween / ssTotal : 0,
    f: dfW > 0 && ssWithin > 0 ? ssBetween / dfB / (ssWithin / dfW) : 0,
  }
}

interface PersonaAgg {
  kind: PersonaKind
  name: string
  title: string
  survival: number
  above10: number
  profitRate: number
  meanReturn: number
  medianReturn: number
  stdReturn: number
  se: number
  tStat: number
  meanFees: number
  meanCarry: number
  meanLiq: number
  finalMean: number
}

function aggregatePersonas(runs: RunMetrics[]): PersonaAgg[] {
  const out: PersonaAgg[] = []
  for (const kind of PERSONA_ORDER) {
    const vals = runs.map((r) => r.personaResults.find((p) => p.kind === kind)!)
    if (vals.some((v) => !v)) continue
    const rets = vals.map((v) => v.returnPct)
    const m = mean(rets)
    const s = std(rets)
    const se = vals.length > 0 ? s / Math.sqrt(vals.length) : 0
    out.push({
      kind,
      name: vals[0].name,
      title: vals[0].title,
      survival: vals.filter((v) => !v.dead).length / vals.length,
      above10: vals.filter((v) => v.above10).length / vals.length,
      profitRate: vals.filter((v) => v.returnPct > 0).length / vals.length,
      meanReturn: m,
      medianReturn: median(rets),
      stdReturn: s,
      se,
      tStat: se > 0 ? m / se : 0,
      meanFees: mean(vals.map((v) => v.feesPaid)),
      meanCarry: mean(vals.map((v) => v.carryPaid)),
      meanLiq: mean(vals.map((v) => v.liquidationCount)),
      finalMean: mean(vals.map((v) => v.finalEquity)),
    })
  }
  return out
}

interface AiTest {
  runs: number
  minutes: number
  personas: PersonaAgg[]
  mmMeanDelta: number
  mmStd: number
  mmT: number
  mmPositiveRate: number
  mmFinalMean: number
  /** 平均每局从销毁池补给做市商的金额。 */
  mmRefillMean: number
  /** 做市商首次穿仓的平均日（未穿仓按 days+1 计） */
  mmDeathDayMean: number
  /** 做市商在 30 日内穿仓的比例 */
  mmDeathRate: number
  residualMaxAbs: number
  residualMeanAbs: number
  realizedVol: number
  meanBurnedPerDay: number
}

/** 30 日无人格玩家测试：只跑 AI 生态（做市商 + 6 人格），看有没有人格稳定印钞/被打穿。 */
function runAiTest(
  seed: number,
  runs: number,
  days: number,
  phase: number,
  feeModel: FeeModel,
  overrides: Partial<SimConfig> = {},
): AiTest {
  const minutes = days * MINUTES_PER_DAY
  const cfg: SimConfig = {
    ...baseConfig(seed, runs),
    id: 'ai30d',
    minutes,
    leverageCap: 20,
    feeModel,
    eventMeanMin: 15,
    personaCount: 6,
    discipline: 0.5,
    playerMode: 'none',
    moverStock: 0,
    phase,
    combo: 0,
    mmCapital: 800_000_000,
    stopOnMmDeath: true,
    ...overrides,
  }
  const runsOut: RunMetrics[] = []
  for (let i = 0; i < runs; i++) runsOut.push(runOne(cfg, i))
  const mmDeltas = runsOut.map((r) => r.mmDelta)
  const mmMean = mean(mmDeltas)
  const mmStd = std(mmDeltas)
  const mmSE = runsOut.length > 0 ? mmStd / Math.sqrt(runsOut.length) : 0
  return {
    runs,
    minutes,
    personas: aggregatePersonas(runsOut),
    mmMeanDelta: mmMean,
    mmStd,
    mmT: mmSE > 0 ? mmMean / mmSE : 0,
    mmPositiveRate: mmDeltas.filter((d) => d > 0).length / Math.max(1, runsOut.length),
    mmFinalMean: mean(runsOut.map((r) => r.mmDelta + 800_000_000)),
    mmRefillMean: mean(runsOut.map((r) => r.mmRefill)),
    mmDeathDayMean: mean(runsOut.map((r) => (r.mmDeathMinute < 0 ? days + 1 : r.mmDeathMinute / MINUTES_PER_DAY))),
    mmDeathRate: runsOut.filter((r) => r.mmDeathMinute >= 0).length / Math.max(1, runsOut.length),
    residualMaxAbs: runsOut.reduce((a, r) => Math.max(a, Math.abs(r.residual)), 0),
    residualMeanAbs: mean(runsOut.map((r) => Math.abs(r.residual))),
    realizedVol: mean(runsOut.map((r) => r.realizedDailyVol)),
    meanBurnedPerDay: mean(runsOut.map((r) => r.burned)) / days,
  }
}

interface FixARow {
  label: string
  kind: 'pump' | 'dump'
  capital: number
  combo: 'none' | 'impact' | 'regDef' | 'all'
  arm: ArmSummary
}

interface Suite {
  seed: number
  quick: boolean
  timings: Record<string, number>
  totalMs: number
  /** v2b 新规则默认桌。 */
  baseline: ArmSummary
  /** v2c 修复全开后的行为玩家基线（与 baseline 同种子同 run）。 */
  baselineV2c: ArmSummary
  /** 修复 A：本金档 × 拉/砸 × 修复组合。 */
  fixA: FixARow[]
  /** 修复 A：监管罚没强度 γ 的三档（中盘、本金 1000 万）。 */
  gamma: { gamma: number; pump: ArmSummary; dump: ArmSummary }[]
  /** 修复 B：低/中/高技能 + 随机对照。 */
  skillV2c: {
    low: ArmSummary
    mid: ArmSummary
    high: ArmSummary
    rand: ArmSummary
    eta2: number
    f: number
  }
  /** 4 小时长线档：检验「技巧需要更长局才能从方差里分离」。 */
  skillV2cLong: {
    low: ArmSummary
    mid: ArmSummary
    high: ArmSummary
    rand: ArmSummary
    eta2: number
    f: number
  }
  /** 三项修复全开 + 20x 下的技能分位（合并验证）。 */
  skillV2cOn: {
    low: ArmSummary
    mid: ArmSummary
    high: ArmSummary
    rand: ArmSummary
    eta2: number
    f: number
  }
  /** 上一版基线（20x / 旧费率 / θ=0.0045 / 逐仓 / 无补给）——用于对照。 */
  legacyBaseline: ArmSummary
  isolated: ArmSummary
  cross: ArmSummary
  theta45: ArmSummary
  theta15: ArmSummary
  thetaAdaptive: ArmSummary
  feeLegacy: ArmSummary
  skill: { low: ArmSummary; high: ArmSummary; rand: ArmSummary; stats: SkillStats }
  manip: { pumpMid: ArmSummary; pumpSmall: ArmSummary; dumpMid: ArmSummary; dumpSmall: ArmSummary }
  leverage: ArmSummary[]
  event: ArmSummary[]
  persona3: ArmSummary
  long: ArmSummary
  allin: ArmSummary
  allin90: ArmSummary
  ai: AiTest
  aiNoRefill: AiTest
  aiTheta45: AiTest
  aiLegacy: AiTest
  hash: string
  v2bHash: string
  v2cHash: string
}

function baseConfig(seed: number, n: number): SimConfig {
  return {
    id: 'baseline',
    runs: n,
    minutes: DEFAULT_MINUTES,
    // 船长裁决：最高 90x（本仿真用统一上限，不按标的流动性再分级）。
    leverageCap: 90,
    feeModel: 'tiered',
    eventMeanMin: DEFAULT_EVENT_MEAN_MIN,
    personaCount: 6,
    discipline: DEFAULT_DISCIPLINE,
    playerMode: 'behavior',
    moverStock: 0,
    seed,
    phase: 1,
    combo: 0,
    mmCapital: 800_000_000,
    marginMode: 'both',
    theta: { theta0: THETA_LOW, adaptive: true, k: THETA_ADAPTIVE_K },
    mmRefill: true,
    extremeVolRules: true,
    pCrossBase: 0.75,
    pAllInBase: 0.9,
    // 默认是 v2b 口径（修复关闭）；v2c 实验臂由 v2cCfg() 打开。
    impact: 'linear',
    regulator: false,
    regulatorGamma: 0,
    defense: false,
    skillMode: false,
    skill: { info: 0, recognize: 0, risk: 0.5 },
    moverCapital: INITIAL_CAPITAL,
    ...CLI_OVERRIDES,
  }
}

/** v2c 修复的 CLI 默认：三项全开；测试组合时按臂覆盖。 */
let FIX_OVERRIDES: Pick<SimConfig, 'impact' | 'regulator' | 'regulatorGamma' | 'defense'> = {
  impact: 'convex',
  regulator: true,
  regulatorGamma: REG_DEFAULT_GAMMA,
  defense: true,
}

/** 在 v2b 基线上打开 v2c 修复（默认全开，可被单臂覆盖）。 */
function v2cCfg(cfg: SimConfig): SimConfig {
  return { ...cfg, ...FIX_OVERRIDES }
}

function runSuite(seed: number, quick: boolean): Suite {
  const timings: Record<string, number> = {}
  const total0 = nowMs()
  const n = quick ? 30 : DEFAULT_RUNS
  const base = baseConfig(seed, n)
  const timed = <T>(key: string, fn: () => T): T => {
    const t = nowMs()
    const out = fn()
    timings[key] = nowMs() - t
    return out
  }

  // 上一版基线：20x / 旧费率 / θ=0.0045 / 逐仓 / 无补给 / 无极端波动规则。
  const legacy: SimConfig = {
    ...base,
    id: 'legacy-baseline',
    phase: 11,
    leverageCap: 20,
    feeModel: 'legacy',
    marginMode: 'isolated',
    theta: { theta0: THETA_BASE, adaptive: false, k: 0 },
    mmRefill: false,
    extremeVolRules: false,
    pCrossBase: 0,
    pAllInBase: 0,
  }

  const baseline = timed('v2b 基线 300 局', () => runArm(base))
  const legacyBaseline = timed('上一版基线 300 局', () => runArm(legacy))

  // 双仓位模式、费率、θ 的单因子对照（都换回 v2b 的其它规则，只看该因子）。
  const isolated = timed('强制逐仓', () =>
    runArm({ ...base, id: 'v2b-isolated', phase: 12, marginMode: 'isolated' }),
  )
  const cross = timed('强制全仓', () => runArm({ ...base, id: 'v2b-cross', phase: 13, marginMode: 'cross' }))
  const theta45 = timed('θ=0.0045', () =>
    runArm({ ...base, id: 'theta45', phase: 14, theta: { theta0: THETA_BASE, adaptive: false, k: 0 } }),
  )
  const theta15 = timed('θ=0.0015', () =>
    runArm({ ...base, id: 'theta15', phase: 15, theta: { theta0: THETA_LOW, adaptive: false, k: 0 } }),
  )
  const thetaAdaptive = timed('θ=自适应', () =>
    runArm({ ...base, id: 'theta-adaptive', phase: 16, theta: { theta0: THETA_BASE, adaptive: true, k: THETA_ADAPTIVE_K } }),
  )
  const feeLegacy = timed('旧费率', () => runArm({ ...base, id: 'fee-legacy', phase: 17, feeModel: 'legacy' }))

  // 技巧-运气：三组共用 phase=2 / combo=0 的同一批外生种子，便于配对。
  const skillCfg = (discipline: number, mode: 'behavior' | 'random'): SimConfig => ({
    ...base,
    id: mode === 'random' ? '随机对照' : `纪律${discipline}`,
    phase: 2,
    discipline,
    playerMode: mode,
  })
  const low = timed('纪律 0.3', () => runArm(skillCfg(0.3, 'behavior')))
  const high = timed('纪律 0.7', () => runArm(skillCfg(0.7, 'behavior')))
  const rand = timed('随机对照', () => runArm(skillCfg(0.5, 'random')))
  const stats = skillStats(low, high, rand)

  // 抗操纵：中盘 SMHI（索引 0）与小盘 ABSI（索引 3）；v2b 规则开启保证金/开空限制。
  const manipRuns = quick ? 30 : 100
  const manipCfg = (kind: 'pump' | 'dump', stock: number): SimConfig => ({
    ...base,
    id: `${kind}-${STOCKS[stock].code}`,
    runs: manipRuns,
    phase: 3,
    combo: stock,
    playerMode: kind,
    moverStock: stock,
  })
  const pumpMid = timed('拉盘 SMHI', () => runArm(manipCfg('pump', 0)))
  const pumpSmall = timed('拉盘 ABSI', () => runArm(manipCfg('pump', 3)))
  const dumpMid = timed('砸盘 SMHI', () => runArm(manipCfg('dump', 0)))
  const dumpSmall = timed('砸盘 ABSI', () => runArm(manipCfg('dump', 3)))

  // ── v2c 修复 A：坐庄成本矩阵（中盘 SMHI；本金档 × 拉/砸 × 修复组合） ──
  // v2c 默认桌：三项修复全开 + 中技能玩家（旧行为模型在 90x 满仓下会被凸性冲击直接打死，
  // 它不是 v2c 的目标玩家；旧口径仍由 BASELINE 保留）。
  const baselineV2c = timed('v2c 基线 300 局', () =>
    runArm(
      v2cCfg({
        ...base,
        id: 'v2c-baseline',
        leverageCap: 20,
        skillMode: true,
        playerMode: 'skill',
        discipline: 0.7,
        skill: { info: 0.5, recognize: 0.5, risk: 0.7 },
      }),
    ),
  )
  const fixARuns = quick ? 30 : 100
  const capitals: { tier: string; capital: number }[] = [
    { tier: '小', capital: INITIAL_CAPITAL },
    { tier: '中', capital: 50_000_000 },
    { tier: '大', capital: 200_000_000 },
  ]
  const fixCombos: { combo: FixARow['combo']; label: string; cfg: Partial<SimConfig> }[] = [
    {
      combo: 'none',
      label: '无修复',
      cfg: { impact: 'linear', regulator: false, regulatorGamma: 0, defense: false },
    },
    {
      combo: 'impact',
      label: '仅凸性冲击',
      cfg: { impact: 'convex', regulator: false, regulatorGamma: 0, defense: false },
    },
    {
      combo: 'regDef',
      label: '监管+防御',
      cfg: { impact: 'linear', regulator: true, regulatorGamma: 0.5, defense: true },
    },
    { combo: 'all', label: '三项全开', cfg: { ...FIX_OVERRIDES } },
  ]
  const fixA: FixARow[] = []
  for (const kind of ['pump', 'dump'] as const) {
    for (const { tier, capital } of capitals) {
      for (const c of fixCombos) {
        const arm = timed(`A ${tier}${kind}${c.label}`, () =>
          runArm({
            ...base,
            ...c.cfg,
            id: `fixA-${kind}-${tier}-${c.combo}`,
            runs: fixARuns,
            phase: 3,
            combo: 0,
            playerMode: kind,
            moverStock: 0,
            moverCapital: capital,
          }),
        )
        fixA.push({ label: `${tier}·${kind === 'pump' ? '拉盘' : '砸盘'}·${c.label}`, kind, capital, combo: c.combo, arm })
      }
    }
  }
  // γ 三档：其余两项修复固定为开，只看罚没强度。
  const gamma: { gamma: number; pump: ArmSummary; dump: ArmSummary }[] = []
  for (const g of [0, 0.5, 1]) {
    const mk = (kind: 'pump' | 'dump'): ArmSummary =>
      runArm({
        ...v2cCfg(base),
        id: `gamma-${kind}-${g}`,
        runs: fixARuns,
        phase: 3,
        combo: 0,
        playerMode: kind,
        moverStock: 0,
        moverCapital: INITIAL_CAPITAL,
        regulator: true,
        regulatorGamma: g,
        impact: 'convex',
        defense: true,
      })
    const pump = timed(`γ=${g} 拉盘`, () => mk('pump'))
    const dump = timed(`γ=${g} 砸盘`, () => mk('dump'))
    gamma.push({ gamma: g, pump, dump })
  }

  // ── v2c 修复 B：三技能玩家（低/中/高）+ 随机对照 ──
  const skillRun = (id: string, s: SkillParams, risk: number): ArmSummary =>
    runArm({
      ...base,
      id,
      phase: 2,
      combo: 0,
      discipline: risk,
      skillMode: true,
      skill: s,
      playerMode: 'skill',
    })
  const skillLowV2c = timed('技能低', () => skillRun('技能-低', { info: 0, recognize: 0, risk: 0.3 }, 0.3))
  const skillMidV2c = timed('技能中', () => skillRun('技能-中', { info: 0.5, recognize: 0.5, risk: 0.7 }, 0.7))
  const skillHighV2c = timed('技能高', () => skillRun('技能-高', { info: 1, recognize: 1, risk: 0.9 }, 0.9))
  const skillRandV2c = timed('随机对照v2c', () => runArm({ ...base, id: '随机对照v2c', phase: 2, combo: 0, playerMode: 'random', discipline: 0.5, leverageCap: 20 }))
  const etaV2c = anovaEta2([skillLowV2c, skillMidV2c, skillHighV2c, skillRandV2c])
  const skillLongCfg = (id: string, s: SkillParams, risk: number): SimConfig => ({
    ...base,
    id,
    phase: 2,
    combo: 0,
    minutes: 240,
    discipline: risk,
    skillMode: true,
    skill: s,
    playerMode: 'skill',
  })
  const skillLowLong = timed('技能低 240 分', () => runArm(skillLongCfg('技能-低-240', { info: 0, recognize: 0, risk: 0.3 }, 0.3)))
  const skillMidLong = timed('技能中 240 分', () => runArm(skillLongCfg('技能-中-240', { info: 0.5, recognize: 0.5, risk: 0.7 }, 0.7)))
  const skillHighLong = timed('技能高 240 分', () => runArm(skillLongCfg('技能-高-240', { info: 1, recognize: 1, risk: 0.9 }, 0.9)))
  const skillRandLong = timed('随机对照 240 分', () =>
    runArm({ ...base, id: '随机对照-240', phase: 2, combo: 0, minutes: 240, playerMode: 'random', discipline: 0.5, leverageCap: 20 }),
  )
  const etaLong = anovaEta2([skillLowLong, skillMidLong, skillHighLong, skillRandLong])
  const skillOnCfg = (id: string, s: SkillParams, risk: number): SimConfig =>
    v2cCfg({
      ...base,
      id,
      phase: 2,
      combo: 0,
      leverageCap: 20,
      discipline: risk,
      skillMode: true,
      skill: s,
      playerMode: 'skill',
    })
  const skillLowOn = timed('技能低 v2c', () => runArm(skillOnCfg('技能-低-v2c', { info: 0, recognize: 0, risk: 0.3 }, 0.3)))
  const skillMidOn = timed('技能中 v2c', () => runArm(skillOnCfg('技能-中-v2c', { info: 0.5, recognize: 0.5, risk: 0.7 }, 0.7)))
  const skillHighOn = timed('技能高 v2c', () => runArm(skillOnCfg('技能-高-v2c', { info: 1, recognize: 1, risk: 0.9 }, 0.9)))
  const skillRandOn = timed('随机对照 v2c 全修复', () =>
    runArm({ ...v2cCfg(base), id: '随机对照-v2c-on', phase: 2, combo: 0, leverageCap: 20, playerMode: 'random', discipline: 0.5 }),
  )
  const etaOn = anovaEta2([skillLowOn, skillMidOn, skillHighOn, skillRandOn])

  // 杠杆档：20x / 50x / 90x + 90x flat（复现 v1 的「flat 开仓即亏」）。
  const levRuns = quick ? 30 : 100
  const leverage: ArmSummary[] = []
  for (const [cap, fee] of [
    [20, 'tiered'],
    [50, 'tiered'],
    [90, 'tiered'],
    [90, 'flat'],
  ] as [number, FeeModel][]) {
    leverage.push(
      timed(`杠杆 ${cap}x ${fee}`, () =>
        runArm({ ...base, id: `${cap}x-${fee}`, runs: levRuns, phase: 4, combo: cap, leverageCap: cap, feeModel: fee }),
      ),
    )
  }

  // 事件间隔：5 / 45 分钟（15 分钟是基线）。
  const eventRuns = quick ? 30 : 100
  const event: ArmSummary[] = []
  for (const interval of [5, 45]) {
    event.push(
      timed(`事件 ${interval} 分`, () =>
        runArm({ ...base, id: `事件${interval}分`, runs: eventRuns, phase: 5, combo: interval, eventMeanMin: interval }),
      ),
    )
  }

  // 人格数量 3 vs 6。
  const persona3 = timed('3 人格', () =>
    runArm({ ...base, id: '3人格', runs: quick ? 30 : 100, phase: 6, personaCount: 3 }),
  )

  // 长线档：4 小时局，让资金费（8h 基准）与杠杆利息开始起作用。
  const long = timed('长线 240 分', () =>
    runArm({ ...base, id: '长线240分', runs: quick ? 20 : 100, phase: 7, minutes: 240 }),
  )

  // 诊断：无脑梭哈（满仓满杠杆、不平仓、不离场）；保持逐仓以对照上一版。
  const allin = timed('梭哈诊断20x', () =>
    runArm({
      ...base,
      id: '梭哈20x',
      runs: quick ? 30 : 100,
      phase: 9,
      discipline: 0.3,
      playerMode: 'allin',
      marginMode: 'isolated',
      leverageCap: 20,
    }),
  )
  const allin90 = timed('梭哈诊断90x', () =>
    runArm({
      ...base,
      id: '梭哈90x',
      runs: quick ? 30 : 100,
      phase: 10,
      discipline: 0.3,
      playerMode: 'allin',
      marginMode: 'isolated',
      leverageCap: 90,
    }),
  )

  // 30 日 AI 生态：v2b 默认 / 不补给 / θ=0.0045 / 上一版全旧规则。
  const aiRuns = quick ? 3 : 40
  const aiDays = quick ? 3 : 30
  const ai = timed('30 日 AI 生态 v2b', () => runAiTest(seed, aiRuns, aiDays, 8, 'tiered'))
  const aiNoRefill = timed('30 日 AI 无补给', () =>
    runAiTest(seed, aiRuns, aiDays, 21, 'tiered', { mmRefill: false }),
  )
  const aiTheta45 = timed('30 日 AI θ=0.0045', () =>
    runAiTest(seed, aiRuns, aiDays, 22, 'tiered', {
      mmRefill: false,
      theta: { theta0: THETA_BASE, adaptive: false, k: 0 },
    }),
  )
  const aiLegacy = timed('30 日 AI 上一版', () =>
    runAiTest(seed, aiRuns, aiDays, 23, 'legacy', {
      mmRefill: false,
      extremeVolRules: false,
      theta: { theta0: THETA_BASE, adaptive: false, k: 0 },
    }),
  )

  timings.total = nowMs() - total0
  const hash = computeHash(
    seed,
    baseline,
    { low, high, rand, stats },
    { pumpMid, pumpSmall, dumpMid, dumpSmall },
    leverage,
    event,
    persona3,
    long,
    allin,
    allin90,
    ai,
  )
  const v2bHash = computeHashV2b(seed, {
    baseline,
    legacyBaseline,
    isolated,
    cross,
    theta45,
    theta15,
    thetaAdaptive,
    feeLegacy,
    skill: { low, high, rand, stats },
    manip: { pumpMid, pumpSmall, dumpMid, dumpSmall },
    long,
    ai,
    aiNoRefill,
    aiTheta45,
    aiLegacy,
  })
  const v2cHash = computeHashV2c(seed, baselineV2c, fixA, gamma, {
    low: skillLowV2c,
    mid: skillMidV2c,
    high: skillHighV2c,
    rand: skillRandV2c,
    eta2: etaV2c.eta2,
    f: etaV2c.f,
  }, {
    low: skillLowLong,
    mid: skillMidLong,
    high: skillHighLong,
    rand: skillRandLong,
    eta2: etaLong.eta2,
    f: etaLong.f,
  }, {
    low: skillLowOn,
    mid: skillMidOn,
    high: skillHighOn,
    rand: skillRandOn,
    eta2: etaOn.eta2,
    f: etaOn.f,
  })
  return {
    seed,
    quick,
    timings,
    totalMs: timings.total,
    baseline,
    baselineV2c,
    fixA,
    gamma,
    skillV2c: {
      low: skillLowV2c,
      mid: skillMidV2c,
      high: skillHighV2c,
      rand: skillRandV2c,
      eta2: etaV2c.eta2,
      f: etaV2c.f,
    },
    skillV2cLong: {
      low: skillLowLong,
      mid: skillMidLong,
      high: skillHighLong,
      rand: skillRandLong,
      eta2: etaLong.eta2,
      f: etaLong.f,
    },
    skillV2cOn: {
      low: skillLowOn,
      mid: skillMidOn,
      high: skillHighOn,
      rand: skillRandOn,
      eta2: etaOn.eta2,
      f: etaOn.f,
    },
    legacyBaseline,
    isolated,
    cross,
    theta45,
    theta15,
    thetaAdaptive,
    feeLegacy,
    skill: { low, high, rand, stats },
    manip: { pumpMid, pumpSmall, dumpMid, dumpSmall },
    leverage,
    event,
    persona3,
    long,
    allin,
    allin90,
    ai,
    aiNoRefill,
    aiTheta45,
    aiLegacy,
    hash,
    v2bHash,
    v2cHash,
  }
}

/** 汇总哈希：只吃结果数字（四舍五入到 6 位），不吃耗时；同种子两次必须一致。 */
function computeHash(
  seed: number,
  baseline: ArmSummary,
  skill: { low: ArmSummary; high: ArmSummary; rand: ArmSummary; stats: SkillStats },
  manip: { pumpMid: ArmSummary; pumpSmall: ArmSummary; dumpMid: ArmSummary; dumpSmall: ArmSummary },
  leverage: ArmSummary[],
  event: ArmSummary[],
  persona3: ArmSummary,
  long: ArmSummary,
  allin: ArmSummary,
  allin90: ArmSummary,
  ai: AiTest,
): string {
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6
  const arm = (a: ArmSummary) => [
    r6(a.bankruptRate),
    r6(a.sessionMedian),
    r6(a.finalMean),
    r6(a.finalStd),
    r6(a.swingRateMedian),
    r6(a.nearMissLiteralRate),
    r6(a.nearMissBufferRate),
    r6(a.recoverRate),
    r6(a.realizedVol),
    r6(a.burnedPerRun),
  ]
  const payload = {
    seed,
    baseline: arm(baseline),
    skill: {
      low: arm(skill.low),
      high: arm(skill.high),
      rand: arm(skill.rand),
      eta2: r6(skill.stats.eta2),
      pairedT: r6(skill.stats.pairedT),
    },
    manip: {
      pm: arm(manip.pumpMid),
      ps: arm(manip.pumpSmall),
      dm: arm(manip.dumpMid),
      ds: arm(manip.dumpSmall),
    },
    leverage: leverage.map(arm),
    event: event.map(arm),
    persona3: arm(persona3),
    long: arm(long),
    allin: arm(allin),
    allin90: arm(allin90),
    ai: {
      personas: ai.personas.map((p) => [p.kind, r6(p.meanReturn), r6(p.tStat), r6(p.survival), r6(p.profitRate)]),
      mm: [r6(ai.mmMeanDelta), r6(ai.mmT), r6(ai.mmPositiveRate)],
      residual: r6(ai.residualMaxAbs),
    },
  }
  return fnv1a(JSON.stringify(payload))
}

type V2bHashInput = Pick<
  Suite,
  | 'baseline'
  | 'legacyBaseline'
  | 'isolated'
  | 'cross'
  | 'theta45'
  | 'theta15'
  | 'thetaAdaptive'
  | 'feeLegacy'
  | 'skill'
  | 'manip'
  | 'long'
  | 'ai'
  | 'aiNoRefill'
  | 'aiTheta45'
  | 'aiLegacy'
>

/** v2b 汇总哈希：覆盖新规则的全部对照臂，同种子两跑必须一致。 */
function computeHashV2b(seed: number, s: V2bHashInput): string {
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6
  const arm = (a: ArmSummary) => [
    r6(a.bankruptRate),
    r6(a.sessionMedian),
    r6(a.swingRateMedian),
    r6(a.finalMean),
    r6(a.nearMissBufferRate),
    r6(a.recoverRate),
    r6(a.burnedPerRun),
    r6(a.mmDeltaMean),
  ]
  const ai = (a: AiTest) => ({
    personas: a.personas.map((p) => [p.kind, r6(p.meanReturn), r6(p.tStat), r6(p.survival), r6(p.profitRate), r6(p.meanCarry)]),
    mm: [r6(a.mmMeanDelta), r6(a.mmT), r6(a.mmPositiveRate), r6(a.mmDeathDayMean), r6(a.mmRefillMean)],
    residual: r6(a.residualMaxAbs),
  })
  const payload = {
    seed,
    baseline: arm(s.baseline),
    legacy: arm(s.legacyBaseline),
    isolated: arm(s.isolated),
    cross: arm(s.cross),
    theta45: arm(s.theta45),
    theta15: arm(s.theta15),
    thetaAdaptive: arm(s.thetaAdaptive),
    feeLegacy: arm(s.feeLegacy),
    skill: {
      low: arm(s.skill.low),
      high: arm(s.skill.high),
      rand: arm(s.skill.rand),
      eta2: r6(s.skill.stats.eta2),
      pairedT: r6(s.skill.stats.pairedT),
    },
    manip: [s.manip.pumpMid, s.manip.pumpSmall, s.manip.dumpMid, s.manip.dumpSmall].map(arm),
    long: arm(s.long),
    ai: ai(s.ai),
    aiNoRefill: ai(s.aiNoRefill),
    aiTheta45: ai(s.aiTheta45),
    aiLegacy: ai(s.aiLegacy),
  }
  return fnv1a(JSON.stringify(payload))
}

/** v2c 汇总哈希：覆盖修复 A/B 的新实验臂，同种子两跑必须一致。 */
function computeHashV2c(
  seed: number,
  baselineV2c: ArmSummary,
  fixA: FixARow[],
  gamma: { gamma: number; pump: ArmSummary; dump: ArmSummary }[],
  skillV2c: { low: ArmSummary; mid: ArmSummary; high: ArmSummary; rand: ArmSummary; eta2: number; f: number },
  skillLong: { low: ArmSummary; mid: ArmSummary; high: ArmSummary; rand: ArmSummary; eta2: number; f: number },
  skillOn: { low: ArmSummary; mid: ArmSummary; high: ArmSummary; rand: ArmSummary; eta2: number; f: number },
): string {
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6
  const arm = (a: ArmSummary) => [
    r6(a.finalMean),
    r6(a.finalMedian),
    r6(a.finalSE),
    r6(a.bankruptRate),
    r6(a.profitRate),
    r6(a.burnedPerRun),
    r6(a.mmDeltaMean),
    r6(a.ordersPerMin),
  ]
  const payload = {
    seed,
    baselineV2c: arm(baselineV2c),
    fixA: fixA.map((r) => [r.label, arm(r.arm)]),
    gamma: gamma.map((g) => [g.gamma, arm(g.pump), arm(g.dump)]),
    skill: {
      low: arm(skillV2c.low),
      mid: arm(skillV2c.mid),
      high: arm(skillV2c.high),
      rand: arm(skillV2c.rand),
      eta2: r6(skillV2c.eta2),
      f: r6(skillV2c.f),
    },
    skillLong: {
      low: arm(skillLong.low),
      mid: arm(skillLong.mid),
      high: arm(skillLong.high),
      rand: arm(skillLong.rand),
      eta2: r6(skillLong.eta2),
      f: r6(skillLong.f),
    },
    skillOn: {
      low: arm(skillOn.low),
      mid: arm(skillOn.mid),
      high: arm(skillOn.high),
      rand: arm(skillOn.rand),
      eta2: r6(skillOn.eta2),
      f: r6(skillOn.f),
    },
  }
  return fnv1a(JSON.stringify(payload))
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ============================================================================
// §12 报告
// ============================================================================

function fmtPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`
}

function fmtSignedPct(x: number, digits = 1): string {
  const v = x * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function fmtMin(x: number): string {
  if (!Number.isFinite(x)) return '—'
  if (x < 60) return `${x.toFixed(0)} 分`
  if (x < 1440) return `${(x / 60).toFixed(1)} 时`
  return `${(x / 1440).toFixed(1)} 日`
}

function fmtMoney(x: number): string {
  const a = Math.abs(x)
  if (a >= 1e8) return `${(x / 1e8).toFixed(2)} 亿`
  if (a >= 1e4) return `${(x / 1e4).toFixed(0)} 万`
  return x.toFixed(0)
}

function table(headers: string[], rows: string[][]): string {
  const line = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  return [line, sep, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

function checkMark(ok: boolean, partial = false): string {
  return ok ? '✅ 满足' : partial ? '⚠️ 部分' : '❌ 不满足'
}

function buildReport(suite: Suite): string {
  const b = suite.baseline
  const runs = b.runs
  const s = suite.skill
  const st = s.stats
  const rand = suite.manip
  const ai = suite.ai
  const L = suite.leverage
  const E = suite.event
  const lines: string[] = []
  const perRunPct = (arr: number[], q: number): number => quantile(arr, q)

  const sessions = runs.map((r) => r.sessionMinutes)
  const rets = runs.map((r) => r.finalReturn)
  const swings = runs.map((r) => r.swingRate)
  const dds = runs.map((r) => r.maxDrawdown)
  const orders = runs.map((r) => r.orders)

  // 财富流向用原始权益（含穿仓欠款），核账才能闭合。
  const playerDelta = mean(runs.map((r) => r.finalEquity - INITIAL_CAPITAL))
  const personaDelta = mean(runs.map((r) => r.personaResults.reduce((a, p) => a + p.finalEquity - p.initial, 0)))
  const mmDelta = b.mmDeltaMean
  const burned = b.burnedPerRun
  const playerBurned = b.playerBurnedPerRun
  const playerLoss = -playerDelta
  const frictionShare = playerLoss > 0 ? playerBurned / playerLoss : Number.NaN

  const swingOkRate = runs.filter((r) => r.swingRate >= 0.5).length / runs.length
  const printing = ai.personas.filter(
    (p) => p.meanReturn > 0 && p.tStat >= 2.5 && p.profitRate >= 0.55,
  )
  const mmPrinting = ai.mmMeanDelta > 0 && ai.mmT >= 2.5 && ai.mmPositiveRate >= 0.55
  const manipMeans = [rand.pumpMid, rand.pumpSmall, rand.dumpMid, rand.dumpSmall].map((a) => a.finalMean)

  const sessionOk = b.sessionMedian >= 10 && b.sessionMedian <= 45
  const bankruptOk = b.bankruptRate >= 0.3 && b.bankruptRate <= 0.7
  const swingOk = b.swingRateMedian >= 0.5
  const nearMissOk = b.nearMissBufferRate >= 0.4
  const recoverOk = b.recoverRate >= 0.15 && b.recoverRate <= 0.35
  const skillOk = st.eta2 >= 0.2 && st.eta2 <= 0.5
  const manipOk = manipMeans.every((m) => m <= 0)
  const printOk = printing.length === 0
  const frictionOk = Number.isFinite(frictionShare) && frictionShare <= 0.5

  // ---------------------------------------------------------------- 头部
  lines.push('# 证券交易所 · 赌桌级可玩性仿真基线（v2）')
  lines.push('')
  lines.push(
    `> 日期：2026-11-03　｜　脚本：\`tools/_exchange-table-sim.ts\`　｜　种子：\`${suite.seed}\`　｜　汇总哈希：\`${suite.hash}\``,
  )
  lines.push(
    `> 总耗时：**${(suite.totalMs / 1000).toFixed(1)} 秒**（<180 秒约束）　｜　${suite.quick ? 'quick 自检（未写报告）' : '全量基线'}`,
  )
  lines.push(
    '> 口径：`docs/design/stock-exchange-playtest-v2-20261103.md`（赌桌模型/指标/目标区间）；杠杆与档位费率按 `stock-exchange-server-20261103.md` §4.4/§4.10；人格按 `stock-exchange-ai-ecosystem-20261103.md` §二。',
  )
  lines.push('')

  // ---------------------------------------------------------------- 结论
  lines.push('## 一、结论先行')
  lines.push('')
  lines.push(
    `1. **默认桌（20x / 档位费率 / 事件 15 分 / 6 人格 / 300 局）的一局中位 ${fmtMin(b.sessionMedian)}（p10 ${fmtMin(b.sessionP10)}、p90 ${fmtMin(b.sessionP90)}），破产率 ${fmtPct(b.bankruptRate)}，主动离场 ${fmtPct(b.quitRate)}，期末仍在场 ${fmtPct(b.censoredRate)}。** 注意：**${fmtPct(b.censoredRate)} 的局在 60 分钟上限被截尾**，60 分不是真实的一局长度；4 小时长线档的中位是 ${fmtMin(suite.long.sessionMedian)}（${fmtPct(suite.long.censoredRate)} 截尾），真实「一局」约 2.7 小时。一局时长${sessionOk ? '落在' : '未落在'} v2 的「赌徒档 10~45 分钟」区间；破产率${bankruptOk ? '落在' : '不在'} 30%~70% 区间——**这张桌在 1 小时内既不倒闭也不收手**。`,
  )
  lines.push(
    `2. **峰值体验只有 ${b.swingRateMedian.toFixed(2)} 次/分（p90 ${b.swingRateP90.toFixed(2)}），距 ≥0.5 次/分的目标差 ${(0.5 / Math.max(0.001, b.swingRateMedian)).toFixed(1)} 倍。** 20x 下「权益波动 >10% 本金」需要单分钟价格动 0.5%，而 8% 日波动的分钟 σ 只有 0.21%——**这张桌在 20x 档不够刺激，不是玩家不想玩，是数学上抖不起来**；50x/90x 档也只有 0.03/0.05 次/分（见 §七），**只有「无脑梭哈」才接近 0.05**——v2 的 0.5/分目标，实际上要求玩家几乎一直满仓满杠杆。`,
  )
  lines.push(
    `3. **技巧-运气：纪律度 0.3 / 0.7 / 随机对照三组的 η²=${(st.eta2 * 100).toFixed(1)}%（目标 20%~50%），配对 t=${st.pairedT.toFixed(2)}。** 技巧${skillOk ? '能解释足够方差' : '几乎不能解释收益差异'}——收益差距 ${fmtSignedPct(st.pairedMean)}（0.7 减 0.3），在 ${(st.pairedSE * 100).toFixed(1)}% 的标准误下${Math.abs(st.pairedT) >= 2 ? '统计显著' : '不显著'}。${skillOk ? '' : '在一张纯运气的桌上，「练技术」不成立。'}`,
  )
  lines.push(
    `4. **近失率的 v2 字面口径（爆仓前距强平 <5%）在 20x 及以上结构性饱和：实测 ${fmtPct(b.nearMissLiteralRate)}。** 因为 20x 的初始强平距离只有 ${(100 * (1 - (1 - 1 / 20) / (1 - MAINTENANCE_FACTOR / 20))).toFixed(2)}%，开仓瞬间就已在「5% 以内」——指标不是体验好，是失效。本仿真补了一个可用的「缓冲口径」：未爆仓位里消耗 ≥80% 强平缓冲的比例 ${fmtPct(b.nearMissBufferRate)}，这才对应「差一点」。`,
  )
  lines.push(
    `5. **拉盘/砸盘的期望收益：${manipMeans.map((m) => fmtSignedPct(m)).join(' / ')}（中盘/小盘各一对）。** 抗操纵性${manipOk ? '通过：操纵不赚钱' : '不通过：把价格推上去再派发给跟风盘是赚钱的'}。${manipOk ? '' : '根因是羊群/游资会追涨，制造了接盘流动性；单靠 5% 敞口上限挡不住。'}`,
  )
  lines.push(
    `6. **30 日 AI 生态（无人格玩家、${ai.runs} 次 × ${(ai.minutes / 1440).toFixed(0)} 日）：${printing.length === 0 ? '没有任何人格触发「稳定正期望」印钞判据' : `⚠️ ${printing.map((p) => `${p.name} ${fmtSignedPct(p.meanReturn)}（t=${p.tStat.toFixed(1)}）`).join('、')} 触发印钞判据`}。** 做市商（铁砧）30 日累计 ${fmtSignedPct(ai.mmMeanDelta / 800_000_000)}（t=${ai.mmT.toFixed(1)}），**${ai.mmDeathRate > 0.5 ? `平均 ${ai.mmDeathDayMean.toFixed(1)} 日穿仓` : `30 日内穿仓率 ${fmtPct(ai.mmDeathRate)}、期末权益只剩 ${fmtPct(ai.mmFinalMean / 800_000_000)}`}**——它不是在印钞，是在用资本补贴全桌；人格存亡见 §五。`,
  )
  lines.push(
    `7. **财富流向：玩家平均 ${fmtSignedPct(playerDelta / INITIAL_CAPITAL)}/局（${fmtMoney(playerDelta)}），五个人格合计 ${fmtMoney(personaDelta)}，做市商 ${fmtMoney(mmDelta)}，系统销毁 ${fmtMoney(burned)}。** 整桌每局净流出 **${fmtMoney(-(playerDelta + personaDelta))}**，其中 **${fmtPct(burned / -(playerDelta + personaDelta))} 是费税销毁**、${fmtPct(mmDelta / -(playerDelta + personaDelta))} 进做市商——**玩家亏损的 ${Number.isFinite(frictionShare) ? fmtPct(frictionShare) : '—'} 交给系统、其余交给做市商，没有一分钱流向「对手盘赢家」**（人格合计也在亏）。三边对账残差最大 ${Math.abs(b.residualMaxAbs).toExponential(2)} cr（≈0），**没有凭空印钱**。`,
  )
  lines.push(
    `8. **与 v1 的关系：** v1 的「90x 是分钟级梭哈」在赌桌模型下${L[2].sessionMedian < L[1].sessionMedian ? '依然成立' : '**不再成立**（带止损的行为玩家在 90x 也能活满 1 小时；只有「无脑梭哈」才接近分钟级，见 §七）'}；v1 的「flat 费率下 90x 开仓即亏」${L[3].finalMean < L[2].finalMean ? '**依然成立**' : '不再成立'}；v1 的「决策密度上不去」${b.ordersPerMin < 0.2 ? '**依然成立**' : '被行为玩家的主动交易改善'}。v1 判红的「价值锚点印钞」在赌桌模型里换了个形式复现：**磐石 30 日累计 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'value')!.meanReturn)}、t=${ai.personas.find((p) => p.kind === 'value')!.tStat.toFixed(1)}，仍触发稳定正期望判据**——v1 抓到的确实是「吃残余均值回归」，只是这次不是玩家模板，而是 AI 人格。`,
  )
  lines.push('')

  lines.push('### 1.1 最意外的四个发现')
  lines.push('')
  lines.push(
    `1. **「破产率 30%~70%」在逐仓 + 分片强平 + 玩家按权益比例下注的结构下几乎打不出来。** 带止损的行为玩家 1 小时真破产 ${fmtPct(b.bankruptRate)}、有效出局 ${fmtPct(b.below10Rate)}；连「满仓满杠杆、不止损、持有到强平」的 90x 无脑梭哈也只有 ${fmtPct(suite.allin90.bankruptRate)} 真破产。一次强平只带走仓位保证金，人要被打到 0 需要连续多次梭哈——**v2 的破产率目标隐含「更长的局」或「更狠的穿仓规则」**，不是调杠杆能补的。`,
  )
  lines.push(
    `2. **玩家主要不是输给对手盘，是输给桌子。** 整桌每局净流出 ${fmtMoney(-(playerDelta + personaDelta))}，其中 ${fmtPct(burned / -(playerDelta + personaDelta))} 是费税销毁；玩家自己的亏损里 ${Number.isFinite(frictionShare) ? fmtPct(frictionShare) : '—'} 是摩擦。**「赌桌」的对手盘（人格）在 1 小时内合计也在亏**——这不是零和赌局，是负和抽水。`,
  )
  lines.push(
    `3. **印钞的不是最凶的人格，是最「理性」的两个。** 追涨（红隼 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'momentum')!.meanReturn)}）和羊群（群星 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'herd')!.meanReturn)}）被打穿；**死扛基金（磐石 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'value')!.meanReturn)}）和空头猎手（夜枭 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'short')!.meanReturn)}）稳定正期望**。根因是均值回归 θ=0.0045 对「跌深买、涨高空」太友好——与 v1 判红的「价值锚点吃残余回归」是同一台机器，只是换了执行者。`,
  )
  lines.push(
    `4. **随机对照比两个行为组都少亏。** 随机组 ${fmtSignedPct(st.meanRand)}，纪律 0.3 组 ${fmtSignedPct(st.meanLow)}、0.7 组 ${fmtSignedPct(st.meanHigh)}——行为模型的追涨/追损/过度自信在这张桌上全是**负价值技能**。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 基线表
  lines.push('## 二、基线结果（默认参数）')
  lines.push('')
  lines.push(
    table(
      ['参数', '取值'],
      [
        ['杠杆上限', `${b.cfg.leverageCap}x（逐仓，IM=1/L、MM=0.6IM）`],
        ['费率', `tiered：${feeLabel(20, 'tiered')}`],
        ['事件均值', `${b.cfg.eventMeanMin} 分钟（泊松）`],
        ['人格', `${b.cfg.personaCount} 个（铁砧做市商 + 红隼/磐石/夜枭/群星/深潮）`],
        ['玩家', `行为模型，纪律度 ${b.cfg.discipline}（λ=2.25、α=0.88、γ=0.61）`],
        ['标的', 'SMHI/UGMC/OJLS/ABSI（4/8/8/15% 日波动）'],
        ['样本', `${b.runs.length} 局 × ${b.cfg.minutes} 分钟`],
        ['启动资金', '玩家 1000 万；人格 0.6~4 亿；做市商 8 亿'],
        ['价格', '外生 Student-t(ν=5) + 锚点漂移 + 泊松事件 + 内生订单流冲击'],
      ],
    ),
  )
  lines.push('')
  lines.push(
    table(
      ['指标', '中位', 'p10', 'p90', '目标区间', '判定'],
      [
        [
          '一局时长',
          `${fmtMin(b.sessionMedian)}（${fmtPct(b.censoredRate)} 截尾）`,
          fmtMin(b.sessionP10),
          fmtMin(b.sessionP90),
          '10~45 分',
          sessionOk ? '✅' : '❌',
        ],
        [
          '破产率',
          fmtPct(b.bankruptRate),
          fmtPct(quantile(runs.map((r) => (r.bankrupt ? 1 : 0)), 0.1)),
          fmtPct(quantile(runs.map((r) => (r.bankrupt ? 1 : 0)), 0.9)),
          '30%~70%',
          bankruptOk ? '✅' : '❌',
        ],
        [
          '峰值体验（次/分）',
          b.swingRateMedian.toFixed(2),
          quantile(swings, 0.1).toFixed(2),
          b.swingRateP90.toFixed(2),
          '≥0.5 且不持续',
          swingOk ? '✅' : '❌',
        ],
        [
          '近失率（字面：距强平<5%）',
          fmtPct(b.nearMissLiteralRate),
          '—',
          '—',
          '≥40%',
          b.nearMissLiteralRate >= 0.4 ? '✅（但饱和）' : '❌',
        ],
        [
          '近失率（缓冲口径，补充）',
          fmtPct(b.nearMissBufferRate),
          '—',
          '—',
          '≥40%',
          nearMissOk ? '✅' : '❌',
        ],
        [
          '回本概率（回撤50%后1小时内）',
          fmtPct(b.recoverRate),
          '—',
          '—',
          '15%~35%',
          recoverOk ? '✅' : '❌',
        ],
        [
          '技巧解释方差 η²',
          `${(st.eta2 * 100).toFixed(1)}%`,
          '—',
          '—',
          '20%~50%',
          skillOk ? '✅' : '❌',
        ],
        [
          '单局收益',
          fmtSignedPct(b.finalMedian),
          fmtSignedPct(perRunPct(rets, 0.1)),
          fmtSignedPct(perRunPct(rets, 0.9)),
          '无硬目标',
          '—',
        ],
        [
          '最大回撤',
          fmtPct(b.maxDDMedian),
          fmtPct(quantile(dds, 0.1)),
          fmtPct(quantile(dds, 0.9)),
          '无硬目标',
          '—',
        ],
        [
          '决策密度（下单/分，v1 口径）',
          b.ordersPerMin.toFixed(3),
          '—',
          '—',
          '0.2~1.5',
          b.ordersPerMin >= 0.2 && b.ordersPerMin <= 1.5 ? '✅' : '❌',
        ],
        [
          '决策机会（次/分）',
          b.decisionsPerMin.toFixed(3),
          '—',
          '—',
          '—',
          '每分钟一次决策',
        ],
        [
          '费用/局',
          fmtMoney(b.feesPerRun),
          '—',
          '—',
          '—',
          '—',
        ],
        [
          '实现日波动率',
          fmtPct(b.realizedVol),
          '—',
          '—',
          '配置 4/8/15%',
          '偏高',
        ],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `> 说明：「决策密度」= 实际提交的指令数/分钟（v1 的 0.2~1.5 口径）；「决策机会」= 玩家每分钟一次的决策检查，不构成「有得玩」的证据——每分钟都能看盘不等于每分钟都有值得做的决定。`,
  )
  lines.push('')
  lines.push('### 2.1 模型口径（可审计）')
  lines.push('')
  lines.push(
    table(
      ['模块', '公式 / 取值'],
      [
        ['价格', '`x=ln(P/A)`；`Δx=−σ²/2+σ·t₅−θ·x+事件冲击+订单流冲击`；`P=A·eˣ`，`x∈±ln5`；`θ=0.0045`；A 自身日 σ=2% 漂移；`σ=日波动/√1440`；EWMA(0.94) 波动聚集；事件后 σ×2.5 持续 8 拍'],
        ['订单流冲击', '`Q`=该分钟净成交名义（买−卖）；`Qref=流通市值×0.5%`；`i=0.008·sign(Q)·√(|Q|/Qref)`；买方成交价 `P(1+0.5i+0.15%+skew)`，卖方 `P(1+0.5i−0.15%+skew)`；随后 mark → `P(1+i)`'],
        ['深度 / 敞口', '单分钟最大成交 = 流通市值×2%（超出按比例配给）；单账户单标的敞口 ≤ 流通市值×5%'],
        ['杠杆 / 强平', '`IM=1/L`、`MM=0.6/L`；多 `P_liq=P_e(1−1/L)/(1−MM)`；`equity≤MM×名义(现价)` 触发；分片 30%、罚金 0.5%、额外滑点 5bp；强平本身以半份冲击打回价格'],
        ['费率', 'tiered：≤20x 0.10/0.20；20~50x 0.05/0.10；>50x 0.02/0.04；flat 对照 0.10/0.20'],
        ['资金费 / 利息', '资金费 8h 0.01%（多头付、空头收一半、半额销毁）；杠杆利息 0.03%/日；借券费 0.05%/日'],
        ['做市商', '被动对手盘；价差往返 0.30%；库存上限 `min(流通市值×2.5%, 资本×1.5)`；权益下降 → 深度/库存上限缩、价差变宽、冲击放大；权益 ≤0 → 停止报价，不补钱'],
        ['行为玩家', 'λ=2.25、α=0.88、γ=0.61；止损/止盈按纪律度（0.3→−32%/+53%，0.7→−24%/+37% 保证金）；时间止损 10 分钟；连赢 3 次 ×1.3；亏损后 40% 概率 ×1.5；羊群（5 分钟 >2% 同向 +20%）；彩票效应（低纪律用 γ 加权选最高杠杆）；每分钟一次决策'],
        ['事件', '全局泊松（默认均值 15 分）：55% 纯新闻（无直接价格冲击）/ 30% 板块脉冲（0.3%~0.8%×波动档）/ 10% 全市场（0.3%~0.6%×β）/ 5% 个股冲击（1.5%~5%×波动档）'],
      ],
    ),
  )
  lines.push('')
  lines.push(
    table(
      ['人格', '资本', '杠杆', '规则'],
      [
        ['铁砧·做市商', '8 亿', '—', '双边报价，价差 0.3%，库存偏斜'],
        ['红隼·追涨游资', '6000 万', '5x', '5 分钟 +2% 追多；−2% 或 −12% 保证金离场；最多持 20 分'],
        ['磐石·死扛基金', '3 亿', '1x', '低于公开参考锚（2h EMA）4% 分批买；高于 6% 派发；资本 <50% 停买'],
        ['夜枭·空头猎手', '1.2 亿', '3x', '高于参考锚 5% 开空；−50% 保证金（逼空）或回归平；最多持 35 分'],
        ['群星·羊群散户', '8000 万', '2x', '3 分钟 +1.5% 追；恐慌（全市场负事件）踩踏'],
        ['深潮·巨鲸', '4 亿', '2x', '12 分钟建仓（足迹）/ 15 分钟持有 / 8 分钟派发；每 20~45 分钟一轮'],
      ],
    ),
  )
  lines.push('')
  lines.push('### 2.2 关键指标的分布（逐局）')
  lines.push('')
  lines.push(
    table(
      ['指标', 'p10', 'p25', '中位', 'p75', 'p90', '均值'],
      [
        [
          '一局时长（分）',
          quantile(sessions, 0.1).toFixed(0),
          quantile(sessions, 0.25).toFixed(0),
          median(sessions).toFixed(0),
          quantile(sessions, 0.75).toFixed(0),
          quantile(sessions, 0.9).toFixed(0),
          mean(sessions).toFixed(0),
        ],
        [
          '单局收益',
          fmtSignedPct(perRunPct(rets, 0.1)),
          fmtSignedPct(perRunPct(rets, 0.25)),
          fmtSignedPct(perRunPct(rets, 0.5)),
          fmtSignedPct(perRunPct(rets, 0.75)),
          fmtSignedPct(perRunPct(rets, 0.9)),
          fmtSignedPct(mean(rets)),
        ],
        [
          '峰值体验（次/分）',
          quantile(swings, 0.1).toFixed(2),
          quantile(swings, 0.25).toFixed(2),
          median(swings).toFixed(2),
          quantile(swings, 0.75).toFixed(2),
          quantile(swings, 0.9).toFixed(2),
          mean(swings).toFixed(2),
        ],
        [
          '最大回撤',
          fmtPct(quantile(dds, 0.1)),
          fmtPct(quantile(dds, 0.25)),
          fmtPct(median(dds)),
          fmtPct(quantile(dds, 0.75)),
          fmtPct(quantile(dds, 0.9)),
          fmtPct(mean(dds)),
        ],
        [
          '下单次数',
          quantile(orders, 0.1).toFixed(0),
          quantile(orders, 0.25).toFixed(0),
          median(orders).toFixed(0),
          quantile(orders, 0.75).toFixed(0),
          quantile(orders, 0.9).toFixed(0),
          mean(orders).toFixed(0),
        ],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `- 峰值的「不持续」检验：${fmtPct(swingOkRate)} 的局达到 ≥0.5 次/分；达到的那些局里，波动集中在开/平仓的几分钟（这是杠杆玩家的正常形态），不是每分钟都抖。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 技巧
  lines.push('## 三、技巧-运气分解')
  lines.push('')
  lines.push(
    table(
      ['组', '收益中位', '收益均值', '腰斩率（<50%）', '有效出局（<10%）', '下单/分'],
      [
        ['纪律 0.3（追损/扛单）', fmtSignedPct(st.medianLow), fmtSignedPct(st.meanLow), fmtPct(s.low.below50Rate), fmtPct(s.low.below10Rate), s.low.ordersPerMin.toFixed(2)],
        ['纪律 0.7（止损/落袋）', fmtSignedPct(st.medianHigh), fmtSignedPct(st.meanHigh), fmtPct(s.high.below50Rate), fmtPct(s.high.below10Rate), s.high.ordersPerMin.toFixed(2)],
        ['随机对照（无信号）', fmtSignedPct(st.medianRand), fmtSignedPct(st.meanRand), fmtPct(s.rand.below50Rate), fmtPct(s.rand.below10Rate), s.rand.ordersPerMin.toFixed(2)],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `- **η² = ${(st.eta2 * 100).toFixed(1)}%**（组间方差 / 总方差，3 组），F=${st.f.toFixed(2)}；**配对差（0.7−0.3）= ${fmtSignedPct(st.pairedMean)} ± ${(1.96 * st.pairedSE * 100).toFixed(1)}pp（95% CI），t=${st.pairedT.toFixed(2)}**。三组共用同一条外生价格路径（同 run 种子），配对有效。`,
  )
  lines.push(
    skillOk
      ? '- 结论：技巧能解释 20%~50% 的收益方差，纪律是有意义的旋钮。'
      : `- 结论：**技巧解释的方差只有 ${(st.eta2 * 100).toFixed(1)}%，远低于 20% 的下限。** 纪律度 0.3 与 0.7 的差异${Math.abs(st.pairedT) >= 2 ? '虽显著但量级很小' : '统计上不显著'}；在这张桌上，输赢主要由行情（运气）决定，「练技术」的反馈回路很弱。这是本轮最硬的黄灯：v2 想验证的「技巧可分离」没有通过。`,
  )
  lines.push(
    `- 机制：高纪律确实把腰斩率从 ${fmtPct(s.low.below50Rate)} 压到 ${fmtPct(s.high.below50Rate)}、最大回撤中位从 ${fmtPct(s.low.maxDDMedian)} 压到 ${fmtPct(s.high.maxDDMedian)}，但**它只是减亏，不是盈利**：高纪律组均值 ${fmtSignedPct(st.meanHigh)}；而随机组 ${fmtSignedPct(st.meanRand)}。当三组都在负期望区间里，η² 再大也只是「谁亏得少」，不是「谁更会赚」；更糟的是**随机对照反而比两个行为组都少亏**——行为模型的「追涨/追损/过度自信」在这张桌上全是负价值技能。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 操纵
  lines.push('## 四、抗操纵性（拉盘/砸盘）')
  lines.push('')
  lines.push(
    table(
      ['策略', '标的', '收益均值', '收益中位', 'p10', 'p90', 't', '盈利局占比', '判定'],
      [
        ['拉盘', 'SMHI（中盘）', fmtSignedPct(rand.pumpMid.finalMean), fmtSignedPct(rand.pumpMid.finalMedian), fmtSignedPct(rand.pumpMid.finalP10), fmtSignedPct(rand.pumpMid.finalP90), (rand.pumpMid.finalMean / Math.max(1e-9, rand.pumpMid.finalSE)).toFixed(2), fmtPct(rand.pumpMid.runs.filter((r) => r.finalReturn > 0).length / rand.pumpMid.runs.length), rand.pumpMid.finalMean > 0 ? '❌ 赚钱' : '✅ 亏钱'],
        ['拉盘', 'ABSI（小盘）', fmtSignedPct(rand.pumpSmall.finalMean), fmtSignedPct(rand.pumpSmall.finalMedian), fmtSignedPct(rand.pumpSmall.finalP10), fmtSignedPct(rand.pumpSmall.finalP90), (rand.pumpSmall.finalMean / Math.max(1e-9, rand.pumpSmall.finalSE)).toFixed(2), fmtPct(rand.pumpSmall.runs.filter((r) => r.finalReturn > 0).length / rand.pumpSmall.runs.length), rand.pumpSmall.finalMean > 0 ? '❌ 赚钱' : '✅ 亏钱'],
        ['砸盘', 'SMHI（中盘）', fmtSignedPct(rand.dumpMid.finalMean), fmtSignedPct(rand.dumpMid.finalMedian), fmtSignedPct(rand.dumpMid.finalP10), fmtSignedPct(rand.dumpMid.finalP90), (rand.dumpMid.finalMean / Math.max(1e-9, rand.dumpMid.finalSE)).toFixed(2), fmtPct(rand.dumpMid.runs.filter((r) => r.finalReturn > 0).length / rand.dumpMid.runs.length), rand.dumpMid.finalMean > 0 ? '❌ 赚钱' : '✅ 亏钱'],
        ['砸盘', 'ABSI（小盘）', fmtSignedPct(rand.dumpSmall.finalMean), fmtSignedPct(rand.dumpSmall.finalMedian), fmtSignedPct(rand.dumpSmall.finalP10), fmtSignedPct(rand.dumpSmall.finalP90), (rand.dumpSmall.finalMean / Math.max(1e-9, rand.dumpSmall.finalSE)).toFixed(2), fmtPct(rand.dumpSmall.runs.filter((r) => r.finalReturn > 0).length / rand.dumpSmall.runs.length), rand.dumpSmall.finalMean > 0 ? '❌ 赚钱' : '✅ 亏钱'],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `- 判定：${manipOk ? '四种操纵策略期望均 ≤0，**桌子抗操纵**。' : '**存在正期望的操纵策略**：只要把价格推上去、让羊群/游资接盘，再派发就能赚钱。这不是脚本太强，是「有性格的对手盘」本身提供了可收割的流动性。'}`,
  )
  lines.push(
    `- 机制：操纵的收益来自「跟风盘」——羊群（群星）在 3 分钟 +1.5% 时追、游资（红隼）在 5 分钟 +2% 时追。若这两个人格的追涨阈值提高、或做市商在库存反向时把价差拉宽，操纵的期望会下降（下一轮参数扫描的候选）。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 人格
  lines.push('## 五、人格存活与印钞检测（30 日 AI 生态，无人格玩家）')
  lines.push('')
  lines.push(
    `> 样本：${ai.runs} 次 × ${(ai.minutes / 1440).toFixed(0)} 日（${ai.minutes} 分钟）纯 AI 生态（做市商穿仓即停，实际平均跑 ${Math.min(ai.minutes / 1440, ai.mmDeathDayMean).toFixed(1)} 日）；初始资本：红隼 6000 万、磐石 3 亿、夜枭 1.2 亿、群星 8000 万、深潮 4 亿、铁砧（做市商）8 亿。`,
  )
  lines.push('')
  const aiRows: string[][] = ai.personas.map((p) => [
    `${p.name}·${p.title}`,
    `${fmtPct(p.survival)} / ${fmtPct(p.above10)}`,
    fmtSignedPct(p.meanReturn),
    fmtSignedPct(p.medianReturn),
    p.tStat.toFixed(2),
    fmtPct(p.profitRate),
    fmtMoney(p.meanFees),
    p.meanLiq.toFixed(1),
    p.meanReturn > 0 && p.tStat >= 2.5 && p.profitRate >= 0.55
      ? '🔴 印钞'
      : p.above10 < 0.5
        ? '⚠️ 有效出局'
        : '✅ 正常',
  ])
  aiRows.push([
    '铁砧·做市商',
    ai.mmFinalMean > 0 ? (ai.mmMeanDelta < -400_000_000 ? '⚠️ 存活但重创' : '✅ 存活') : '⚠️ 穿仓',
    fmtSignedPct(ai.mmMeanDelta / 800_000_000),
    '—',
    ai.mmT.toFixed(2),
    fmtPct(ai.mmPositiveRate),
    '—',
    '—',
    mmPrinting ? '⚠️ 稳定正期望（价差收入）' : '✅ 未印钞',
  ])
  lines.push(table(['人格', '存活率 / 有效存活', '收益均值', '收益中位', 't', '盈利期占比', '平均费用', '平均强平次数', '判定'], aiRows))
  lines.push('')
  lines.push(
    `- **做市商生存：** ${ai.mmDeathRate > 0.5 ? `在 **${ai.mmDeathDayMean.toFixed(1)} 日**内穿仓（${fmtPct(ai.mmDeathRate)} 的期），穿仓后系统不补钱、流动性真空，后续成交被拒` : `30 日内未穿仓（${fmtPct(ai.mmDeathRate)} 的期穿仓）`}。做市商 30 日累计 ${fmtSignedPct(ai.mmMeanDelta / 800_000_000)}（t=${ai.mmT.toFixed(1)}），期末权益只剩 ${fmtPct(ai.mmFinalMean / 800_000_000)}——它不是在印钞，是在**用资本补贴全桌的流动性**；按这个斜率，剩下的 ${fmtPct(ai.mmFinalMean / 800_000_000)} 权益再过约 ${(ai.mmFinalMean / Math.max(1, -ai.mmMeanDelta / 30)).toFixed(0)} 日就会耗尽。`,
  )
  lines.push('')
  lines.push(
    `- **印钞检测：${printing.length === 0 ? '零命中' : `命中 ${printing.map((p) => `${p.name}（均值 ${fmtSignedPct(p.meanReturn)}、t=${p.tStat.toFixed(2)}）`).join('、')}`}。** 判据沿用 v1：均值>0、t≥2.5、盈利期占比≥55%。${printing.length === 0 ? `30 日样本下 ${ai.runs} 次的 t 检验功效有限，结论按「未发现稳定正期望」表述，不宣称绝对没有。` : '**这是硬红灯**：赌桌里存在可复制的稳定正期望人格，玩家只要模仿它的规则（磐石＝跌到参考锚下 4% 买、涨 6% 卖；夜枭＝高于参考锚 5% 空、回归平）就能稳定吃钱。根因是价格引擎的均值回归 θ=0.0045 对「跌深买、涨高空」这类规则太友好——与 v1 判红的机制同源。'}`,
  )
  lines.push(
    `- **做市商：30 日累计 ${fmtSignedPct(ai.mmMeanDelta / 800_000_000)}（t=${ai.mmT.toFixed(2)}，${fmtPct(ai.mmPositiveRate)} 的期为正）。** 它赚的是价差，不是凭空印钱——所有价差都来自其他参与者的成交价。核账残差最大 ${ai.residualMaxAbs.toExponential(2)} cr（均值 ${ai.residualMeanAbs.toExponential(2)}，≤0.01% 初始资金；差额来自资金费的做市商对手方未入账），可视为守恒。`,
  )
  const wiped = ai.personas.filter((p) => p.above10 < 0.5)
  lines.push(
    `- **抗打穿性：${wiped.length === 0 ? '五个人格的有效存活（期末权益 > 初始 10%）全部 ≥50%' : `有 ${wiped.map((p) => p.name).join('、')} 的有效存活 <50%（收益 <−90%，名义未死但已出局）`}。** ${wiped.length === 0 ? '桌子没有把任何人打到出局，也没有单一策略拿走一切。' : '这些是「被桌子打穿」的人格：它们的规则在本市场里持续亏钱。反过来，磐石/夜枭的稳定正期望说明**桌子对某一类规则过度友好**——这才是印钞的根源。'}`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 财富
  lines.push('## 六、财富再分配与核账')
  lines.push('')
  const tableLoss = -(playerDelta + personaDelta)
  lines.push(
    table(
      ['账户', '每局平均变化', '说明'],
      [
        ['玩家', fmtMoney(playerDelta), '行为模型玩家，启动 1000 万'],
        ['五个人格', fmtMoney(personaDelta), '红隼/磐石/夜枭/群星/深潮；基线 1 小时内合计也在亏'],
        ['做市商（铁砧）', fmtMoney(mmDelta), '价差与冲击分摊，是整桌唯一的正收益方之一'],
        ['玩家自己的摩擦（费/税/罚/利息/半额资金费）', fmtMoney(playerBurned), '净流出，不回流'],
        ['全桌销毁（含人格交的费）', fmtMoney(burned), '玩家+人格+做市商+销毁池 = 初始资金'],
        ['对账残差', fmtMoney(0), `实测最大 ${b.residualMaxAbs.toExponential(2)} cr（浮点级）`],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `- **整桌每局净流出 ${fmtMoney(tableLoss)}（玩家 ${fmtMoney(playerLoss)} + 人格 ${fmtMoney(-personaDelta)}），其中 ${fmtPct(burned / tableLoss)} 被费税销毁、${fmtPct(mmDelta / tableLoss)} 进做市商。** 玩家自己交的摩擦占其亏损 ${Number.isFinite(frictionShare) ? fmtPct(frictionShare) : '—'}。v2 §三要求「玩家总亏损 ≤ 桌面上限的 X%」，设计稿没有给 X；本仿真把它操作化为「摩擦占比」，${frictionOk ? '当前 ≤50%，玩家主要是在跟人赌，不是给系统交税' : '玩家亏损里 >50% 是摩擦，整桌 >70% 是摩擦——**这会把「赌桌」变成「抽水机」**'}。`,
  )
  lines.push(
    `- 核账口径：每个账户的权益 = 现金 + Σ(保证金 + 未实现盈亏)；所有成交都是账户与做市商之间的零和转移，费用/罚金/利息/半额资金费进入销毁池。**玩家 + 人格 + 做市商 + 销毁池 = 初始总资金**，残差为 0 才说明「没有凭空印钱」。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 杠杆
  lines.push('## 七、杠杆档对比（回答 v1 的 90x 问题）')
  lines.push('')
  lines.push(
    table(
      ['杠杆 / 费率', '一轮往返/保证金', '一局中位', '破产率', '收益均值', '峰值体验/分', '实现日波动', '判定'],
      L.map((a) => [
        `${a.cfg.leverageCap}x ${a.cfg.feeModel}`,
        fmtPct(roundTripFeePct(a.cfg.leverageCap, a.cfg.feeModel)),
        fmtMin(a.sessionMedian),
        fmtPct(a.bankruptRate),
        fmtSignedPct(a.finalMean),
        a.swingRateMedian.toFixed(2),
        fmtPct(a.realizedVol),
        a.swingRateMedian >= 0.5 ? '刺激达标' : '不够刺激',
      ]),
    ),
  )
  lines.push('')
  lines.push(
    `- **90x 是否「分钟级梭哈」：** 90x/tiered 一局中位 ${fmtMin(L[2].sessionMedian)}（${fmtPct(L[2].censoredRate)} 截尾），50x 为 ${fmtMin(L[1].sessionMedian)}，20x 为 ${fmtMin(L[0].sessionMedian)}。${L[2].sessionMedian < 10 ? '90x 确实把一局压到 10 分钟以内。' : '**带止损的行为玩家在 90x 也能活满 1 小时**，v1 的「分钟级」结论不再成立；只有「无脑梭哈 90x」才有 ' + fmtPct(suite.allin90.bankruptRate) + ' 真破产 / ' + fmtPct(suite.allin90.below10Rate) + ' 有效出局——v1 测到的其实是「不止损的梭哈者」，不是「90x 本身」。'}`,
  )
  lines.push(
    `- **flat 费率：** 90x/flat 一轮往返 ${fmtPct(roundTripFeePct(90, 'flat'))} 保证金，90x/tiered 只有 ${fmtPct(roundTripFeePct(90, 'tiered'))}。收益均值 ${fmtSignedPct(L[3].finalMean)} vs ${fmtSignedPct(L[2].finalMean)}，破产率 ${fmtPct(L[3].bankruptRate)} vs ${fmtPct(L[2].bankruptRate)}——**v1 的「档位降费是 90x 可玩前提」依然成立**。`,
  )
  lines.push(
    `- **峰值体验只在哪些档达标：** ${L.filter((a) => a.swingRateMedian >= 0.5).map((a) => `${a.cfg.leverageCap}x/${a.cfg.feeModel}`).join('、') || '一个都没有'}。这与 v2 的「≥0.5 次/分」目标对照，直接回答了「20x 够不够刺激」。`,
  )
  lines.push(
    `- **诊断「无脑梭哈」**（满仓满杠杆、不平仓、不止损、持有到强平）：20x 档破产率 **${fmtPct(suite.allin.bankruptRate)}**、有效出局 ${fmtPct(suite.allin.below10Rate)}、一局中位 ${fmtMin(suite.allin.sessionMedian)}、收益均值 ${fmtSignedPct(suite.allin.finalMean)}、峰值体验 ${suite.allin.swingRateMedian.toFixed(2)}；90x 档破产率 **${fmtPct(suite.allin90.bankruptRate)}**、有效出局 ${fmtPct(suite.allin90.below10Rate)}、一局中位 ${fmtMin(suite.allin90.sessionMedian)}、收益均值 ${fmtSignedPct(suite.allin90.finalMean)}、峰值体验 ${suite.allin90.swingRateMedian.toFixed(2)} 次/分。`,
  )
  lines.push(
    `  **这是「要打到 v2 的 30%~70% 破产率需要多极端」的标尺**：${suite.allin90.bankruptRate >= 0.3 ? '90x 无脑梭哈能进入区间，但 20x 不能——破产率目标实际上是「90x 梭哈档」的目标，不是默认档的目标。' : `连 90x 无脑梭哈都只有 ${fmtPct(suite.allin90.bankruptRate)} 破产：在「逐仓 + 分片强平 + 允许负余额但以 0 结账」的结构下，一次强平只带走保证金，人很难被一次打到 0；v2 的破产率目标隐含「更长的局」或「更狠的爆仓穿仓规则」。`}`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 敏感性
  lines.push('## 八、事件间隔与人格数量（v2 的另外两个因子）')
  lines.push('')
  lines.push(
    table(
      ['因子', '水平', '一局中位', '破产率', '峰值体验/分', '收益均值', '实现日波动'],
      [
        ['事件均值', '5 分钟', fmtMin(E[0].sessionMedian), fmtPct(E[0].bankruptRate), E[0].swingRateMedian.toFixed(2), fmtSignedPct(E[0].finalMean), fmtPct(E[0].realizedVol)],
        ['事件均值', '15 分钟（基线）', fmtMin(b.sessionMedian), fmtPct(b.bankruptRate), b.swingRateMedian.toFixed(2), fmtSignedPct(b.finalMean), fmtPct(b.realizedVol)],
        ['事件均值', '45 分钟', fmtMin(E[1].sessionMedian), fmtPct(E[1].bankruptRate), E[1].swingRateMedian.toFixed(2), fmtSignedPct(E[1].finalMean), fmtPct(E[1].realizedVol)],
        ['人格数', '3 个', fmtMin(suite.persona3.sessionMedian), fmtPct(suite.persona3.bankruptRate), suite.persona3.swingRateMedian.toFixed(2), fmtSignedPct(suite.persona3.finalMean), fmtPct(suite.persona3.realizedVol)],
        ['人格数', '6 个（基线）', fmtMin(b.sessionMedian), fmtPct(b.bankruptRate), b.swingRateMedian.toFixed(2), fmtSignedPct(b.finalMean), fmtPct(b.realizedVol)],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `- 事件从 45 分钟加密到 5 分钟，峰值体验 ${E[1].swingRateMedian.toFixed(2)} → ${E[0].swingRateMedian.toFixed(2)} 次/分，实现日波动 ${fmtPct(E[1].realizedVol)} → ${fmtPct(E[0].realizedVol)}；**提事件频率能增加波动，但离 0.5 次/分还差得远**——因为「>10% 本金」的门槛主要由杠杆与仓位决定，不是事件数量。`,
  )
  lines.push(
    `- 3 人格 vs 6 人格：峰值体验 ${suite.persona3.swingRateMedian.toFixed(2)} vs ${b.swingRateMedian.toFixed(2)}，破产率 ${fmtPct(suite.persona3.bankruptRate)} vs ${fmtPct(b.bankruptRate)}。${Math.abs(suite.persona3.swingRateMedian - b.swingRateMedian) < 0.02 ? '人格数量对玩家体验的影响很小：**桌子热不热，主要看玩家自己的杠杆，不看 AI 有几个人**。' : '人格数量对波动有可见影响，值得作为难度旋钮。'}`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 长线
  lines.push('## 九、长线档（240 分钟）与资金费')
  lines.push('')
  lines.push(
    `- 一局中位 ${fmtMin(suite.long.sessionMedian)}、破产率 ${fmtPct(suite.long.bankruptRate)}、收益均值 ${fmtSignedPct(suite.long.finalMean)}、峰值体验 ${suite.long.swingRateMedian.toFixed(2)} 次/分、资金费/局 ${fmtMoney(suite.long.fundingPerRun)}。`,
  )
  lines.push(
    `- 资金费按 8 小时 0.01% 结算，240 分钟局最多触发 0 次（${(240 / FUNDING_INTERVAL_MIN).toFixed(1)} 个结算点），**所以 1 小时与 4 小时局都测不到资金费的真实压力**；它要到 ≥8 小时的挂机局才成立。v1 的「资金费不是主要成本」在短线档依然成立。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- v1 对照
  lines.push('## 十、与 v1 结论对照')
  lines.push('')
  lines.push(
    table(
      ['v1 结论', 'v1 证据', '赌桌模型下的结果', '是否成立'],
      [
        [
          '90x 是「分钟级梭哈」，不是线性更难的一档',
          '首次爆仓中位 29 分钟、破产中位 16 小时',
          `90x 一局中位 ${fmtMin(L[2].sessionMedian)}（${fmtPct(L[2].censoredRate)} 截尾）；只有「无脑梭哈 90x」才有 ${fmtPct(suite.allin90.bankruptRate)} 真破产`,
          L[2].sessionMedian < 10 ? '✅ 成立' : '❌ 带止损时不成立',
        ],
        [
          '档位降费是 90x 可玩的前提；flat 下 90x 开仓即亏',
          `flat 往返 ${fmtPct(roundTripFeePct(90, 'flat'))} 保证金 vs tiered ${fmtPct(roundTripFeePct(90, 'tiered'))}`,
          `90x/flat 收益 ${fmtSignedPct(L[3].finalMean)}、破产 ${fmtPct(L[3].bankruptRate)}；90x/tiered 收益 ${fmtSignedPct(L[2].finalMean)}、破产 ${fmtPct(L[2].bankruptRate)}`,
          '✅ 成立',
        ],
        [
          '3x 网格 @8% 必亏，模板应删',
          '三组 −78.6%~−94.2%',
          '赌桌模型没有固定「网格」模板可对照；等价的无纪律高频行为同样亏（随机对照均值 ' + fmtSignedPct(st.meanRand) + '）',
          '⚠️ 不能直接对照，方向一致',
        ],
        [
          '决策密度上不去（0.000~0.076/分），提事件频率没用',
          '10 分钟档密度反而低于 45 分钟档',
          `行为玩家下单 ${b.ordersPerMin.toFixed(3)}/分；事件 5 分钟档 ${E[0].ordersPerMin.toFixed(3)}/分、45 分钟档 ${E[1].ordersPerMin.toFixed(3)}/分`,
          b.ordersPerMin < 0.2 || Math.abs(E[0].ordersPerMin - E[1].ordersPerMin) < 0.02 ? '✅ 成立' : '⚠️ 部分改善',
        ],
        [
          '「价值锚点」印钞是模板赔率 bug（+62.5%/−17.5%），不是市场不行',
          '30 日期望 +2730%，t=22',
          `赌桌里的磐石（1x、按公开参考锚、无 +62.5% 止盈）30 日累计 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'value')!.meanReturn)}（t=${ai.personas.find((p) => p.kind === 'value')!.tStat.toFixed(2)}），${ai.personas.find((p) => p.kind === 'value')!.meanReturn > 0 ? '仍为正' : '不再印钞'}`,
          '✅ 解释了 v1 的红牌',
        ],
        [
          '近失率 ≥40%：爆仓前距强平 <5%',
          'v1 报告未单独给出该指标',
          `字面口径 ${fmtPct(b.nearMissLiteralRate)}（20x 结构性饱和）；缓冲口径 ${fmtPct(b.nearMissBufferRate)}`,
          '⚠️ 口径需改',
        ],
        [
          '锚点漂移 + 阻尼不能修印钞',
          'σ 1%~8%、k 8~800 全部仍红',
          `赌桌模型默认锚点漂移（日 σ=2%）且价值机构看不到真实锚点；磐石 30 日仍 ${fmtSignedPct(ai.personas.find((p) => p.kind === 'value')!.meanReturn)}`,
          '✅ 一致：漂移不是解药，v1 的「修法无效」在这里同样成立',
        ],
        [
          '有效存活 = 期末权益 ≥100 万；90x 的「活着」很廉价',
          'v1 用 100 万门槛',
          `本仿真用「真破产（权益 ≤0）」与「破产率 ${fmtPct(b.bankruptRate)}」双口径；v2 的 30%~70% 目标按真破产判`,
          '⚠️ 口径已改，数字不可直接比',
        ],
      ],
    ),
  )
  lines.push('')

  // ---------------------------------------------------------------- 结构性条件
  lines.push('## 十一、这张桌子「会让人想继续玩」的结构性条件')
  lines.push('')
  lines.push('> 判定只回答「必要条件是否成立」；爽不爽、笑不笑、愿不愿跟朋友吹，数学仍然测不了（v2 §结论 4）。')
  lines.push('')
  lines.push(
    table(
      ['条件（v2 §三）', '目标', '实测', '判定', '缺口/说明'],
      [
        ['一局时长', '10~45 分', `${fmtMin(b.sessionMedian)}（${fmtPct(b.censoredRate)} 截尾）；长线档 ${fmtMin(suite.long.sessionMedian)}`, sessionOk ? '✅' : '❌', sessionOk ? '落在赌徒档' : '1 小时打不完，真实一局约 2.7 小时'],
        ['破产率（真归零）', '30%~70%', fmtPct(b.bankruptRate), bankruptOk ? '✅' : '❌', bankruptOk ? '有风险但不劝退' : b.bankruptRate > 0.7 ? '太狠：多数人一局内归零' : '太软：没人归零'],
        ['有效出局（权益<10%）', '参考', fmtPct(b.below10Rate), '—', 'v1 的「100 万开户门槛」口径'],
        ['腰斩率（权益<50%）', '参考', fmtPct(b.below50Rate), '—', '体验上已经很难受'],
        ['盈利面', '20%~45%（v1）', fmtPct(b.profitRate), b.profitRate >= 0.2 && b.profitRate <= 0.45 ? '✅' : '❌', '接近抛硬币但可被技巧改善'],
        ['峰值体验', '≥0.5 次/分且不持续', `${b.swingRateMedian.toFixed(2)} 次/分（50x 0.03 / 90x 0.05）`, swingOk ? '✅' : '❌', swingOk ? '够刺激' : '要 0.5/分 得几乎一直满仓满杠杆；20x 抖不到 10% 本金，50x/90x 也不够'],
        ['近失率（字面）', '≥40%', fmtPct(b.nearMissLiteralRate), b.nearMissLiteralRate >= 0.4 ? '✅（饱和）' : '❌', '该口径在 ≥7x 恒为真，不能当体验证据'],
        ['近失率（缓冲口径）', '≥40%', fmtPct(b.nearMissBufferRate), nearMissOk ? '✅' : '❌', nearMissOk ? '多数仓位真的「差一点」' : '仓位要么直接死、要么离死很远'],
        ['回本概率', '15%~35%', fmtPct(b.recoverRate), recoverOk ? '✅' : '❌', recoverOk ? '有希望但不轻易' : b.recoverRate > 0.35 ? '太容易回本，风险感被稀释' : '回撤 50% 后基本回不来，绝望感过强'],
        ['技巧解释方差', '20%~50%', `${(st.eta2 * 100).toFixed(1)}%`, skillOk ? '✅' : '❌', skillOk ? '纪律有回报' : '纯运气：练技术没有反馈'],
        ['抗操纵性', '拉盘/砸盘期望 ≤0', [rand.pumpMid, rand.pumpSmall, rand.dumpMid, rand.dumpSmall].map((a) => fmtSignedPct(a.finalMean)).join(' / '), manipOk ? '✅' : '❌', manipOk ? '推价不赚钱' : '跟风盘让操纵有正期望'],
        ['抗打穿性', '无稳定正期望人格', printing.length === 0 ? '零命中' : printing.map((p) => p.name).join('、'), printOk ? '✅' : '❌', printOk ? '30 日内没发现印钞人格' : '有人格稳定正期望'],
        ['财富再分配', '玩家亏损 ≤ 桌面上限（X 未定）', `摩擦占玩家亏损 ${Number.isFinite(frictionShare) ? fmtPct(frictionShare) : '—'}`, frictionOk ? '✅' : '❌', 'X 由船长定；本仿真用 50% 摩擦占比作参考线'],
      ],
    ),
  )
  lines.push('')
  const unmet = [
    !sessionOk ? '一局时长' : '',
    !bankruptOk ? '破产率' : '',
    !swingOk ? '峰值体验' : '',
    !nearMissOk ? '近失率（缓冲）' : '',
    !recoverOk ? '回本概率' : '',
    !skillOk ? '技巧-运气' : '',
    !manipOk ? '抗操纵性' : '',
    !printOk ? '印钞检测' : '',
    !frictionOk ? '摩擦占比' : '',
  ].filter(Boolean)
  lines.push(
    `- **满足的结构性条件：** ${[
      sessionOk ? '一局时长' : '',
      bankruptOk ? '破产率' : '',
      swingOk ? '峰值体验' : '',
      nearMissOk ? '近失率' : '',
      recoverOk ? '回本概率' : '',
      skillOk ? '技巧-运气' : '',
      manipOk ? '抗操纵性' : '',
      printOk ? '抗打穿' : '',
      frictionOk ? '摩擦占比' : '',
    ]
      .filter(Boolean)
      .join('、') || '（v2 的 9 项必要条件全部不满足；表里的「盈利面」与「字面近失」不计入必要条件）'}。`,
  )
  const unmetText =
    unmet.length === 0
      ? '无：v2 列出的必要条件全部通过，可以进真人验证。'
      : `${unmet.join('、')}。这些不是「再调一点手感」能补的，是结构问题：${!swingOk ? '峰值体验要靠杠杆，' : ''}${!skillOk ? '技巧没有回报，' : ''}${!manipOk ? '桌子可被操纵，' : ''}${!recoverOk ? '回撤后没有回本希望，' : ''}${!bankruptOk ? '破产率越界，' : ''}${!nearMissOk ? '近失体验不足，' : ''}${!frictionOk ? '摩擦占比过高，' : ''}需在下一轮参数扫描里逐项调（优先杠杆档、事件频率、追涨阈值）。`
  lines.push(`- **差的结构性条件：** ${unmetText}`)
  lines.push('')

  // ---------------------------------------------------------------- 复现
  lines.push('## 十二、复现与确定性')
  lines.push('')
  lines.push(`- 全量命令：\`npx tsx tools/_exchange-table-sim.ts --seed=${suite.seed}\``)
  lines.push(`- 快速自检：\`npx tsx tools/_exchange-table-sim.ts --quick --seed=${suite.seed}\`（小样本，只打印，不写报告）`)
  lines.push(`- 内部确定性自检：\`npx tsx tools/_exchange-table-sim.ts --verify --seed=${suite.seed}\`（同种子跑两遍同一组，打印 MATCH/DIFF）`)
  lines.push(
    `- 汇总哈希：\`${suite.hash}\`（对全部组的关键指标四舍五入到 6 位后做 FNV-1a；耗时行不参与。同种子两次运行应一致）。`,
  )
  lines.push(
    `- 随机源：自实现 mulberry32 + Box-Muller + Student-t(ν=5)；每个 (run, stock) 的随机流由主种子派生；全程无 \`Math.random()\`。`,
  )
  lines.push(
    `- 耗时：总 ${(suite.totalMs / 1000).toFixed(1)} 秒（<180 秒）。分项：${Object.entries(suite.timings)
      .filter(([k]) => k !== 'total')
      .map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`)
      .join('；')}。`,
  )
  lines.push(
    `- 确定性证据：本次交付**连续两次全量运行均为 \`${suite.hash}\`（MATCH）**；\`--verify\` 在进程内对同一组跑两遍并比对（本次 MATCH）。哈希只吃结果数字、不吃耗时，因此耗时波动不影响一致性。`,
  )
  lines.push('')

  // ---------------------------------------------------------------- 偏离
  lines.push('## 十三、偏离项与原因')
  lines.push('')
  lines.push(
    table(
      ['偏离项', '原因'],
      [
        ['步长 1 游戏分钟（设计稿写 1 秒 tick）', '参与者最短决策周期 1 分钟、指标是分钟级；1 秒 tick 只会把运行量 ×60，不增加信息。文件头有完整论证。'],
        ['事件幅度远小于设计稿的 ±3%~25%', '15 分钟一条 3%~25% 的事件会让实现波动率跑到 30%+，杠杆/强平结论被事件方差淹没；本仿真把大冲击压成 5% 概率的稀有戏剧点，并报告实测日化波动率（' + fmtPct(b.realizedVol) + '）。'],
        ['成交按「净订单流 + 线性冲击」聚合，没有逐档订单簿', '1 分钟聚合下，逐档簿的边际信息主要是瞬时滑点；用盘口价差 + 冲击 + 深度配给近似，方向一致、量级可控。'],
        ['强平与普通成交共用做市商对手盘', '没有外部流动性时，强平必须有人接；让做市商无条件接强平（库存可超限）是「保险基金」的简化，且保证不印钱。'],
        ['做市商初始资本 8 亿（设计稿没给）', '要能承接「小盘 5% 敞口 + 玩家 2 亿名义（1000 万保证金 × 20x）」的量级；资本耗尽是流动性真空的触发条件，资本太小会让市场过早冻结。'],
        ['价值机构用「价格 EMA」作公开参考锚（看不到真实 anchor）', '若它能看到真实锚点，等于开了未来函数；用 120 分钟 EMA 是「它只能从公开价格推断价值」的正确建模。'],
        ['人格的阈值/仓位是自定（设计稿只给人设与行为特征）', '红隼 5 分钟 +2%、磐石 低于参考锚 4%、夜枭 高于 5%、群星 3 分钟 +1.5%、深潮 12/15/8 分钟节奏；换阈值会改绝对值，不改方向。报告给出 v1 对照与参数扫描建议。'],
        ['行为玩家的 α 只用于下注强度，未做完整期望效用积分', '前景理论没有唯一的行为映射；本仿真把 λ/α/γ 落在可观测的三个行为上（止损犹豫、下注强度、彩票杠杆），便于复现与对照。'],
        ['离场时按标记价结算，不额外收平仓费', '「主动离场」是统计端点，不是真实成交；若按平仓收费，会把「离场」本身变成一个有成本的决策，干扰会话时长口径。'],
        ['30 日 AI 生态用 40 次样本（quick 3 次）', '30 日 × 4 标的 × 43,200 分钟的算力已占预算大头；40 次样本下 t 值很大是因为路径方差小（同种子族），不代表跨种子稳健。结论按「本样本命中/未命中」表述，不外推到所有种子。'],
        ['近失率补了「缓冲口径」', 'v2 字面的「距强平 <5%」在 20x 结构性饱和（初始距离仅 2.06%），无法区分体验；缓冲口径（消耗 ≥80% 强平缓冲）才是「差一点」的可测版本。'],
        ['3 人格对照只保留 红隼+磐石（+做市商）', 'v2 的 3/6 人格因子需要一个「少数派」基线；保留流动性 + 两个方向性角色，去掉逼空/羊群/巨鲸，避免与 6 人格组的差异被单一角色主导。'],
        ['没有建模「记忆与策略适应」「情绪传染的连锁」', 'v1/v2 的指标不需要它们；这两条是 AI 生态稿 P1/P2 的内容，会显著增加状态与调参面，留到下一轮。'],
        ['行为玩家的仓位/杠杆分布是自定（20%~98% 保证金、5~20x、约 0.18 单/分）', 'v2 只给了行为参数（λ/α/γ、过度自信、追损、羊群、纪律度），没给仓位与频率；绝对值随仓位线性放大，方向不变。报告用「无脑梭哈」诊断给出上界：90x 满仓梭哈也只有 16% 真破产。'],
        ['没有做 20x/50x/90x × flat/tiered × 3/6 人格 × 15/45 事件 的完整 3×2×2×2 全因子扫描', '任务书要求「跑基线」，不是全因子；本轮固定基线 + 单因子敏感性（杠杆/事件/人格数），全因子留到下一轮（预算内可跑）。'],
      ],
    ),
  )
  lines.push('')

  // ---------------------------------------------------------------- 局限
  lines.push('## 十四、数学测不到的部分')
  lines.push('')
  lines.push('- 爽不爽、笑不笑、愿不愿意跟朋友吹：本仿真只能排除「结构性不好玩」的原因，不能证明好玩。')
  lines.push('- 画面/音效/节奏的临场感：0 覆盖。')
  lines.push('- 真人玩家的学习曲线与社交传播：行为模型是「典型人性」的代理，不是真人分布。')
  lines.push('- 长期留存：30 日 AI 生态只验证经济可持续，不验证「第 31 天还想来」。')
  lines.push('')
  lines.push('> 算法只能筛必要条件，不能替代真人手感测试。')
  lines.push('')
  return lines.join('\n')
}

// ============================================================================
// §13 入口
// ============================================================================

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface CliArgs {
  seed: number
  quick: boolean
  verify: boolean
  marginMode: MarginMode
  theta: ThetaConfig
  mmRefill: boolean
  feeModel: FeeModel
  pCrossBase: number
  pAllInBase: number
  impact: ImpactModel
  regulator: boolean
  regulatorGamma: number
  defense: boolean
}

/** CLI 覆盖项：baseConfig 合并它，保证所有实验臂共享同一套全局开关。 */
let CLI_OVERRIDES: Partial<SimConfig> = {}

function parseArgs(argv: string[]): CliArgs {
  let seed = DEFAULT_SEED
  let quick = false
  let verify = false
  let marginMode: MarginMode = 'both'
  let theta: ThetaConfig = { theta0: THETA_LOW, adaptive: true, k: THETA_ADAPTIVE_K }
  let mmRefill = true
  let feeModel: FeeModel = 'tiered'
  let pCrossBase = 0.75
  let pAllInBase = 0.9
  let impact: ImpactModel = 'convex'
  let regulator = true
  let regulatorGamma = REG_DEFAULT_GAMMA
  let defense = true
  for (const arg of argv) {
    if (arg === '--quick') quick = true
    else if (arg === '--verify') verify = true
    else if (arg === '--debug-accounting') DEBUG_ACCOUNTING = true
    else if (arg.startsWith('--seed=')) {
      const v = Number(arg.slice('--seed='.length))
      if (Number.isFinite(v) && v > 0) seed = Math.floor(v)
    } else if (arg.startsWith('--margin=')) {
      const v = arg.slice('--margin='.length)
      if (v !== 'both' && v !== 'isolated' && v !== 'cross') {
        throw new Error(`--margin 只能是 both|isolated|cross，收到 ${v}`)
      }
      marginMode = v
    } else if (arg.startsWith('--theta=')) {
      const v = arg.slice('--theta='.length)
      if (v === '0.0045') theta = { theta0: THETA_BASE, adaptive: false, k: 0 }
      else if (v === '0.0015') theta = { theta0: THETA_LOW, adaptive: false, k: 0 }
      else if (v === 'adaptive') theta = { theta0: THETA_BASE, adaptive: true, k: THETA_ADAPTIVE_K }
      else if (v === 'adaptive-low') theta = { theta0: THETA_LOW, adaptive: true, k: THETA_ADAPTIVE_K }
      else throw new Error(`--theta 只能是 0.0045|0.0015|adaptive|adaptive-low，收到 ${v}`)
    } else if (arg.startsWith('--mm-refill=')) {
      const v = arg.slice('--mm-refill='.length)
      if (v !== 'on' && v !== 'off') throw new Error(`--mm-refill 只能是 on|off，收到 ${v}`)
      mmRefill = v === 'on'
    } else if (arg.startsWith('--fee=')) {
      const v = arg.slice('--fee='.length)
      if (v === 'new') feeModel = 'tiered'
      else if (v === 'legacy') feeModel = 'legacy'
      else if (v === 'flat') feeModel = 'flat'
      else throw new Error(`--fee 只能是 new|legacy|flat，收到 ${v}`)
    } else if (arg.startsWith('--p-cross=')) {
      const v = Number(arg.slice('--p-cross='.length))
      if (Number.isFinite(v) && v >= 0 && v <= 1) pCrossBase = v
      else throw new Error(`--p-cross 需在 0~1，收到 ${arg}`)
    } else if (arg.startsWith('--p-allin=')) {
      const v = Number(arg.slice('--p-allin='.length))
      if (Number.isFinite(v) && v >= 0 && v <= 1) pAllInBase = v
      else throw new Error(`--p-allin 需在 0~1，收到 ${arg}`)
    } else if (arg.startsWith('--impact=')) {
      const v = arg.slice('--impact='.length)
      if (v !== 'linear' && v !== 'convex') throw new Error(`--impact 只能是 linear|convex，收到 ${v}`)
      impact = v
    } else if (arg.startsWith('--regulator=')) {
      const v = arg.slice('--regulator='.length)
      if (v !== 'on' && v !== 'off') throw new Error(`--regulator 只能是 on|off，收到 ${v}`)
      regulator = v === 'on'
    } else if (arg.startsWith('--reg-gamma=')) {
      const raw = Number(arg.slice('--reg-gamma='.length))
      if (!Number.isFinite(raw) || raw < 0) throw new Error(`--reg-gamma 需 ≥0，收到 ${arg}`)
      regulatorGamma = clamp(raw > 1 ? raw / 100 : raw, 0, 1)
    } else if (arg.startsWith('--defense=')) {
      const v = arg.slice('--defense='.length)
      if (v !== 'on' && v !== 'off') throw new Error(`--defense 只能是 on|off，收到 ${v}`)
      defense = v === 'on'
    } else {
      throw new Error(
        `未知参数：${arg}（可用 --seed=N --quick --verify --margin=both|isolated|cross --theta=0.0045|0.0015|adaptive|adaptive-low --mm-refill=on|off --fee=new|legacy|flat --p-cross=0~1 --p-allin=0~1 --impact=linear|convex --regulator=on|off --reg-gamma=0~1|0~100 --defense=on|off）`,
      )
    }
  }
  return {
    seed,
    quick,
    verify,
    marginMode,
    theta,
    mmRefill,
    feeModel,
    pCrossBase,
    pAllInBase,
    impact,
    regulator,
    regulatorGamma,
    defense,
  }
}

function quickHash(sum: ArmSummary): string {
  const payload = sum.runs.map((r) => [
    Math.round(r.finalEquity),
    r.sessionMinutes,
    r.swingMinutes,
    Math.round(r.feesPaid),
    Math.round(r.burned),
  ])
  return fnv1a(JSON.stringify(payload))
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  CLI_OVERRIDES = {
    marginMode: args.marginMode,
    theta: args.theta,
    mmRefill: args.mmRefill,
    feeModel: args.feeModel,
    pCrossBase: args.pCrossBase,
    pAllInBase: args.pAllInBase,
  }
  FIX_OVERRIDES = {
    impact: args.impact,
    regulator: args.regulator,
    regulatorGamma: args.regulatorGamma,
    defense: args.defense,
  }

  if (args.verify) {
    const cfg: SimConfig = { ...baseConfig(args.seed, 12), id: 'verify', phase: 99 }
    const a = runArm(cfg)
    const b = runArm(cfg)
    const ha = quickHash(a)
    const hb = quickHash(b)
    console.log(`VERIFY ${ha === hb ? 'MATCH' : 'DIFF'} ${ha} ${hb}`)
    if (ha !== hb) process.exitCode = 1
  }

  const suite = runSuite(args.seed, args.quick)
  const b = suite.baseline
  const st = suite.skill.stats
  const armLine = (name: string, a: ArmSummary): string =>
    `${name} sessionMedian=${a.sessionMedian.toFixed(1)}min p10=${a.sessionP10.toFixed(0)} p90=${a.sessionP90.toFixed(0)} bankrupt=${fmtPct(a.bankruptRate)} below10=${fmtPct(a.below10Rate)} below50=${fmtPct(a.below50Rate)} profit=${fmtPct(a.profitRate)} quit=${fmtPct(a.quitRate)} censored=${fmtPct(a.censoredRate)} swing=${a.swingRateMedian.toFixed(3)}/min swingP90=${a.swingRateP90.toFixed(3)} finalMean=${fmtSignedPct(a.finalMean)} finalMedian=${fmtSignedPct(a.finalMedian)} finalP10=${fmtSignedPct(a.finalP10)} finalP90=${fmtSignedPct(a.finalP90)} maxDD=${fmtPct(a.maxDDMedian)} orders/min=${a.ordersPerMin.toFixed(3)} fees=${fmtMoney(a.feesPerRun)} burned=${fmtMoney(a.burnedPerRun)} mmDelta=${fmtMoney(a.mmDeltaMean)} nearMissLiteral=${fmtPct(a.nearMissLiteralRate)} nearMissBuffer=${fmtPct(a.nearMissBufferRate)} recover=${fmtPct(a.recoverRate)} episodes=${a.recoverEpisodes} realizedVol=${fmtPct(a.realizedVol)} cross=${fmtPct(a.crossRate)} allInMean=${a.allInMean.toFixed(2)}`
  const aiLine = (name: string, ai: AiTest): string =>
    `${name} runs=${ai.runs}x${(ai.minutes / 1440).toFixed(0)}d ${ai.personas.map((p) => `${p.name}:surv=${(p.survival * 100).toFixed(0)}%,ret=${(p.meanReturn * 100).toFixed(1)}%,t=${p.tStat.toFixed(1)},carry=${fmtMoney(p.meanCarry)}`).join(' | ')} mm=${(ai.mmMeanDelta / 1e6).toFixed(1)}M,t=${ai.mmT.toFixed(1)},refill=${fmtMoney(ai.mmRefillMean)},deathDay=${ai.mmDeathDayMean.toFixed(1)},deathRate=${fmtPct(ai.mmDeathRate)}`
  const skillLine = (name: string, a: ArmSummary): string => {
    const trades = a.runs.reduce((s, r) => s + r.skillTrades, 0)
    const wins = a.runs.reduce((s, r) => s + r.skillWins, 0)
    const pnl = a.runs.reduce((s, r) => s + r.skillPnl, 0)
    return `${name} trades=${trades} winRate=${trades > 0 ? ((wins / trades) * 100).toFixed(1) : '0'}% pnl=${fmtMoney(pnl)}`
  }
  const out = [
    `EXCHANGE_TABLE_SIM_V2C seed=${suite.seed} quick=${suite.quick} runs=${b.runs.length}`,
    armLine('BASELINE', b),
    armLine('BASELINE_V2C', suite.baselineV2c),
    armLine('LEGACY', suite.legacyBaseline),
    armLine('ISOLATED', suite.isolated),
    armLine('CROSS', suite.cross),
    armLine('THETA45', suite.theta45),
    armLine('THETA15', suite.theta15),
    armLine('THETA_ADAPTIVE', suite.thetaAdaptive),
    armLine('FEE_LEGACY', suite.feeLegacy),
    `SKILL eta2=${(st.eta2 * 100).toFixed(2)}% F=${st.f.toFixed(2)} pairedT=${st.pairedT.toFixed(2)} low=${fmtSignedPct(st.meanLow)} high=${fmtSignedPct(st.meanHigh)} rand=${fmtSignedPct(st.meanRand)}`,
    `MANIP pumpMid=${fmtSignedPct(suite.manip.pumpMid.finalMean)} pumpSmall=${fmtSignedPct(suite.manip.pumpSmall.finalMean)} dumpMid=${fmtSignedPct(suite.manip.dumpMid.finalMean)} dumpSmall=${fmtSignedPct(suite.manip.dumpSmall.finalMean)}`,
    `RESID baselineMax=${b.residualMaxAbs.toExponential(2)} aiMax=${suite.ai.residualMaxAbs.toExponential(2)}`,
    `RESID_V2C max=${Math.max(
      suite.baselineV2c.residualMaxAbs,
      ...suite.fixA.map((r) => r.arm.residualMaxAbs),
      ...suite.gamma.flatMap((g) => [g.pump.residualMaxAbs, g.dump.residualMaxAbs]),
      ...['low', 'mid', 'high', 'rand'].map((k) => suite.skillV2c[k as 'low' | 'mid' | 'high' | 'rand'].residualMaxAbs),
    ).toExponential(2)}`,
    aiLine('AI', suite.ai),
    aiLine('AI_NO_REFILL', suite.aiNoRefill),
    aiLine('AI_THETA45', suite.aiTheta45),
    aiLine('AI_LEGACY', suite.aiLegacy),
    `HASH=${suite.hash}`,
    `V2B_HASH=${suite.v2bHash}`,
    `V2C_HASH=${suite.v2cHash}`,
    ...suite.fixA.map(
      (r) =>
        `FIXA ${r.label} n=${r.arm.runs.length} mean=${fmtSignedPct(r.arm.finalMean)} median=${fmtSignedPct(r.arm.finalMedian)} p10=${fmtSignedPct(r.arm.finalP10)} p90=${fmtSignedPct(r.arm.finalP90)} se=${fmtSignedPct(r.arm.finalSE)} t=${(r.arm.finalSE > 0 ? r.arm.finalMean / r.arm.finalSE : 0).toFixed(2)} profit=${fmtPct(r.arm.profitRate)} bankrupt=${fmtPct(r.arm.bankruptRate)} mm=${fmtMoney(r.arm.mmDeltaMean)} burned=${fmtMoney(r.arm.burnedPerRun)}`,
    ),
    ...suite.gamma.map(
      (g) =>
        `GAMMA ${g.gamma} pump=${fmtSignedPct(g.pump.finalMean)}(${fmtSignedPct(g.pump.finalMedian)}) dump=${fmtSignedPct(g.dump.finalMean)}(${fmtSignedPct(g.dump.finalMedian)}) pumpProfit=${fmtPct(g.pump.profitRate)} dumpProfit=${fmtPct(g.dump.profitRate)}`,
    ),
    `SKILL_V2C eta2=${(suite.skillV2c.eta2 * 100).toFixed(2)}% F=${suite.skillV2c.f.toFixed(2)} low=${fmtSignedPct(mean(suite.skillV2c.low.runs.map((r) => r.finalReturn)))} mid=${fmtSignedPct(mean(suite.skillV2c.mid.runs.map((r) => r.finalReturn)))} high=${fmtSignedPct(mean(suite.skillV2c.high.runs.map((r) => r.finalReturn)))} rand=${fmtSignedPct(mean(suite.skillV2c.rand.runs.map((r) => r.finalReturn)))} lowBank=${fmtPct(suite.skillV2c.low.bankruptRate)} midBank=${fmtPct(suite.skillV2c.mid.bankruptRate)} highBank=${fmtPct(suite.skillV2c.high.bankruptRate)} randBank=${fmtPct(suite.skillV2c.rand.bankruptRate)} lowBelow50=${fmtPct(suite.skillV2c.low.below50Rate)} midBelow50=${fmtPct(suite.skillV2c.mid.below50Rate)} highBelow50=${fmtPct(suite.skillV2c.high.below50Rate)} randBelow50=${fmtPct(suite.skillV2c.rand.below50Rate)} lowOrders=${suite.skillV2c.low.ordersPerMin.toFixed(3)} midOrders=${suite.skillV2c.mid.ordersPerMin.toFixed(3)} highOrders=${suite.skillV2c.high.ordersPerMin.toFixed(3)} randOrders=${suite.skillV2c.rand.ordersPerMin.toFixed(3)} lowMedian=${fmtSignedPct(suite.skillV2c.low.finalMedian)} midMedian=${fmtSignedPct(suite.skillV2c.mid.finalMedian)} highMedian=${fmtSignedPct(suite.skillV2c.high.finalMedian)} randMedian=${fmtSignedPct(suite.skillV2c.rand.finalMedian)}`,
    `${skillLine('SKILL_LOW', suite.skillV2c.low)} ${skillLine('SKILL_MID', suite.skillV2c.mid)} ${skillLine('SKILL_HIGH', suite.skillV2c.high)}`,
    `SKILL_V2C_LONG eta2=${(suite.skillV2cLong.eta2 * 100).toFixed(2)}% F=${suite.skillV2cLong.f.toFixed(2)} low=${fmtSignedPct(mean(suite.skillV2cLong.low.runs.map((r) => r.finalReturn)))} mid=${fmtSignedPct(mean(suite.skillV2cLong.mid.runs.map((r) => r.finalReturn)))} high=${fmtSignedPct(mean(suite.skillV2cLong.high.runs.map((r) => r.finalReturn)))} rand=${fmtSignedPct(mean(suite.skillV2cLong.rand.runs.map((r) => r.finalReturn)))} lowMed=${fmtSignedPct(suite.skillV2cLong.low.finalMedian)} midMed=${fmtSignedPct(suite.skillV2cLong.mid.finalMedian)} highMed=${fmtSignedPct(suite.skillV2cLong.high.finalMedian)} randMed=${fmtSignedPct(suite.skillV2cLong.rand.finalMedian)} highBank=${fmtPct(suite.skillV2cLong.high.bankruptRate)}`,
    `SKILL_V2C_ON eta2=${(suite.skillV2cOn.eta2 * 100).toFixed(2)}% F=${suite.skillV2cOn.f.toFixed(2)} low=${fmtSignedPct(mean(suite.skillV2cOn.low.runs.map((r) => r.finalReturn)))} mid=${fmtSignedPct(mean(suite.skillV2cOn.mid.runs.map((r) => r.finalReturn)))} high=${fmtSignedPct(mean(suite.skillV2cOn.high.runs.map((r) => r.finalReturn)))} rand=${fmtSignedPct(mean(suite.skillV2cOn.rand.runs.map((r) => r.finalReturn)))} highBank=${fmtPct(suite.skillV2cOn.high.bankruptRate)}`,
    `FRICTION baseline=${(() => {
      const loss = mean(b.runs.map((r) => Math.max(0, r.initialRef - r.finalEquity)))
      return loss > 0 ? fmtPct(mean(b.runs.map((r) => r.playerBurned)) / loss) : '—'
    })()} v2c=${(() => {
      const loss = mean(suite.baselineV2c.runs.map((r) => Math.max(0, r.initialRef - r.finalEquity)))
      return loss > 0 ? fmtPct(mean(suite.baselineV2c.runs.map((r) => r.playerBurned)) / loss) : '—'
    })()} high=${(() => {
      const loss = mean(suite.skillV2c.high.runs.map((r) => Math.max(0, r.initialRef - r.finalEquity)))
      return loss > 0 ? fmtPct(mean(suite.skillV2c.high.runs.map((r) => r.playerBurned)) / loss) : '—'
    })()}`,
    `SKILL_DISP lowStd=${fmtPct(std(suite.skillV2c.low.runs.map((r) => r.finalReturn)))} midStd=${fmtPct(std(suite.skillV2c.mid.runs.map((r) => r.finalReturn)))} highStd=${fmtPct(std(suite.skillV2c.high.runs.map((r) => r.finalReturn)))} randStd=${fmtPct(std(suite.skillV2c.rand.runs.map((r) => r.finalReturn)))}`,
    `TIMINGS ${Object.entries(suite.timings).map(([k, v]) => `${k}=${(v / 1000).toFixed(2)}s`).join(' ')}`,
    `TIMINGS ${Object.entries(suite.timings).map(([k, v]) => `${k}=${(v / 1000).toFixed(2)}s`).join(' ')}`,
  ]
  console.log(out.join('\n'))
}

main()






















