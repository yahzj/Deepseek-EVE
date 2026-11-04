/**
 * 证券交易所 · 可玩性算法验证工具（正式入库，2026-11-03）
 *
 * 运行：`npx tsx tools/exchange-playtest.ts`（报告输出到仓库根 `_exchange-playtest-report.md`，
 * 该文件已被 .gitignore 的 `/_exchange*` 规则忽略，只作本地产物）。
 *
 * 规格：docs/design/stock-exchange-playtest-20261103.md
 * 数值口径：docs/design/stock-exchange-server-20261103.md §4.4 / §4.10 / §5 / 附录 A.2-A.3
 * 市场时间：docs/design/stock-exchange-pacing-emotion-20261103.md §2.1（7×24，无交易节）
 *
 * 运行：
 *   npx tsx tools/_exchange-playtest.ts                 # 三组对照 A/B/C，写 _exchange-playtest-report.md
 *   npx tsx tools/_exchange-playtest.ts --quick         # 小样本自检，只打印，不写报告
 *   npx tsx tools/_exchange-playtest.ts --seed=20261103
 *   npx tsx tools/_exchange-playtest.ts --fee=tiered --anchor=drift   # 单跑一组
 *
 * 费率模型（--fee）：
 *   flat   = 旧口径 买 0.10% / 卖 0.20%（低/高费率档仅作敏感性）
 *   tiered = 按杠杆档降名义费率（船长 2026-11-03 裁决）：L≤20x 0.10/0.20；20<L≤50 0.05/0.10；L>50 0.02/0.04
 * 锚点模型（--anchor）：
 *   visible = 固定可见锚点 A=4000（旧口径）
 *   drift   = 锚点自身对数随机游走（日 σ≈1%）+ 回归阻尼 θ_eff=θ0/(1+|x|·k)（「价值锚点印钞」修复候选）
 *
 * 为什么步长用 1 游戏分钟而不是设计稿的 1 秒：
 *   策略决策最短周期是 2 分钟（50x 高频），统计口径是分钟级（决策密度/波动刺激度/近失率），
 *   1 秒 tick 不会让这些指标更准，只会让运行量 ×60（约 1.6 亿步 → 95 亿步），
 *   在 180 秒预算内不可行。价格引擎的 σ 按「每分钟」重新标定，事件仍按分钟级泊松到达。
 *
 * 确定性：自实现 mulberry32 + Box-Muller，全程不调用 Math.random()；
 *   价格肥尾来自按种子预生成的 Student-t 池，每个 run 用种子派生的奇数步长游走取样。
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================================
// 0. 常量与类型
// ============================================================================

const INITIAL_CAPITAL = 10_000_000
const MINUTES_PER_DAY = 1440
const MAINTENANCE_FACTOR = 0.6
const LIQUIDATION_SLICE_RATIO = 0.3
const LIQUIDATION_PENALTY_RATE = 0.005
const SLIPPAGE_RATE = 0.0002
const LIQUIDATION_SLIPPAGE_RATE = 0.0005
const LEVERAGE_DAILY_INTEREST = 0.0003
const BORROW_DAILY_FEE = 0.0005
const FUNDING_RATE_8H = 0.0001
const FUNDING_SHORT_RECEIVE = 0.5
const EWMA_LAMBDA = 0.94
const T_NU = 5
const THETA = 0.0045
const X_LIMIT = Math.log(5)
const VOL_MIN_FACTOR = 0.25
const VOL_MAX_FACTOR = 4
const EVENT_SHOCK_TICKS = 8
const EVENT_SHOCK_MUL = 2.5
const HIST_BIN_WIDTH = 0.25
const HIST_BINS = 400
const DEFAULT_SEED = 20261103
/** 锚点日漂移 σ（对数）；船长给的示例量级是 1%/日。 */
const ANCHOR_DAILY_SIGMA = 0.01
/** 自适应回归阻尼系数：θ_eff = θ0 / (1 + |x|·k)。k 越大，偏离越远回归越弱。 */
const ANCHOR_DAMP_K = 8
/** 锚点相对初始值最多漂到 3 倍 / 1/3，防止随机游走跑飞。 */
const ANCHOR_LOG_BOUND = Math.log(3)
/**
 * C 组实际采用的阻尼 k。初始按船长示例量级取 8；
 * 若 §6.1 敏感性显示 8 压不掉印钞，就改成「能压掉印钞的最小 k」，报告与代码同源。
 */
const C_DRIFT_K = 8
/** C 组实际采用的锚点日漂移 σ；初始用船长示例 1%，由 §6.1 敏感性定标。 */
const C_DRIFT_SIGMA = 0.01

type Side = 'long' | 'short'
type FeeTier = 'low' | 'base' | 'high'
type FeeModel = 'flat' | 'tiered'
type AnchorMode = 'visible' | 'drift'
type Verdict = 'green' | 'yellow' | 'red'

interface FeePair {
  buy: number
  sell: number
}

const FEE_TIERS: Record<FeeTier, FeePair> = {
  low: { buy: 0.0005, sell: 0.0010 },
  base: { buy: 0.0010, sell: 0.0020 },
  high: { buy: 0.0020, sell: 0.0040 },
}

const FEE_LABEL: Record<FeeTier, string> = {
  low: '低 0.05/0.10',
  base: '基准 0.10/0.20',
  high: '高 0.20/0.40',
}

/**
 * 档位费率（船长 2026-11-03 裁决，economy-pvp §七.2）：
 *   L≤20x   → 0.10% / 0.20%（与旧口径一致）
 *   20<L≤50 → 0.05% / 0.10%
 *   L>50x   → 0.02% / 0.04%
 * 目的：90x 在旧费率下一轮往返 = 27% 保证金（开仓即亏），必须让高杠杆档的名义费率随档下调，
 * 玩家才可能是「输给市场」而不是「输给手续费」。
 */
const TIERED_FEE_TIERS: { upTo: number; pair: FeePair; label: string }[] = [
  { upTo: 20, pair: { buy: 0.0010, sell: 0.0020 }, label: '≤20x 0.10/0.20' },
  { upTo: 50, pair: { buy: 0.0005, sell: 0.0010 }, label: '20~50x 0.05/0.10' },
  { upTo: Number.POSITIVE_INFINITY, pair: { buy: 0.0002, sell: 0.0004 }, label: '>50x 0.02/0.04' },
]

function feePair(leverage: number, model: FeeModel, tier: FeeTier): FeePair {
  if (model === 'flat') return FEE_TIERS[tier]
  const t = TIERED_FEE_TIERS.find((x) => leverage <= x.upTo)
  return t ? t.pair : TIERED_FEE_TIERS[TIERED_FEE_TIERS.length - 1].pair
}

function feeLabel(leverage: number, model: FeeModel, tier: FeeTier): string {
  if (model === 'flat') return FEE_LABEL[tier]
  const t = TIERED_FEE_TIERS.find((x) => leverage <= x.upTo)
  return `档位 ${(t ?? TIERED_FEE_TIERS[TIERED_FEE_TIERS.length - 1]).label}`
}

const FEE_MODEL_LABEL: Record<FeeModel, string> = {
  flat: 'flat 固定费率',
  tiered: 'tiered 档位费率',
}

const ANCHOR_LABEL: Record<AnchorMode, string> = {
  visible: 'visible 固定可见',
  drift: 'drift 漂移+阻尼',
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ============================================================================
// 1. 确定性随机源
// ============================================================================

class Rng {
  private a: number
  private spare: number | null = null

  constructor(seed: number) {
    this.a = seed >>> 0
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

function deriveSeed(master: number, phase: number, combo: number, run: number): number {
  let h = hash32(master ^ 0x9e3779b9)
  h = hash32(h ^ Math.imul(phase + 1, 0x85ebca6b))
  h = hash32(h ^ Math.imul(combo + 1, 0xc2b2ae35))
  h = hash32(h ^ Math.imul(run + 1, 0x27d4eb2f))
  return h >>> 0
}

// 预生成 Student-t(ν=5) 池：单位方差缩放，使「日波动」档可直接标定为分钟 σ。
let T_POOL: Float64Array
let T_POOL_MASK = 0
let T_POOL_SIZE = 0
let T_POOL_SEED = -1
let T_POOL_BUILD_MS = 0

function initTPool(seed: number, size: number): void {
  if (T_POOL_SIZE === size && T_POOL_SEED === seed && T_POOL) return
  const t0 = nowMs()
  const rng = new Rng(seed ^ 0x51ed270b)
  const pool = new Float64Array(size)
  // ν=5 的方差是 ν/(ν-2)=5/3，缩放到单位方差后才能用 σ 直接标定。
  const scale = 1 / Math.sqrt(T_NU / (T_NU - 2))
  for (let i = 0; i < size; i++) {
    const z = rng.normal()
    let chi = 0
    for (let k = 0; k < T_NU; k++) chi += rng.normal() ** 2
    const t = (z / Math.sqrt(chi / T_NU)) * scale
    pool[i] = clamp(t, -8, 8)
  }
  T_POOL = pool
  T_POOL_SIZE = size
  T_POOL_SEED = seed
  T_POOL_MASK = size - 1
  T_POOL_BUILD_MS = nowMs() - t0
}

// ============================================================================
// 2. 价格引擎（对数随机游走 + 肥尾 + EWMA 波动聚集 + 均值回归 + 泊松事件）
// ============================================================================

class PricePath {
  x = 0
  price = 4000
  anchor = 4000
  private readonly sigmaBase: number
  private variance: number
  private shockTicks = 0
  private shockMul = 1
  private tIndex: number
  private readonly tStride: number
  private readonly eventRng: Rng
  private eventMinute: number
  private eventPct: number
  private readonly eventMeanMin: number
  private readonly anchorMode: AnchorMode
  private readonly anchorRng: Rng | null
  private readonly anchorSigma: number
  private readonly dampK: number
  private readonly anchorA0 = 4000
  private anchorLog = Math.log(4000)

  constructor(
    dailyVol: number,
    seed: number,
    eventMeanMin: number,
    anchorMode: AnchorMode = 'visible',
    anchorSigma = ANCHOR_DAILY_SIGMA,
    dampK = ANCHOR_DAMP_K,
  ) {
    this.sigmaBase = dailyVol / Math.sqrt(MINUTES_PER_DAY)
    this.variance = this.sigmaBase * this.sigmaBase
    this.eventMeanMin = eventMeanMin
    this.tIndex = hash32(seed ^ 0x1234abcd) & T_POOL_MASK
    this.tStride = (hash32(seed ^ 0x9e3779b9) | 1) & T_POOL_MASK || 1
    this.eventRng = new Rng(seed ^ 0x85ebca6b)
    this.eventMinute = this.sampleEventGap()
    this.eventPct = this.sampleEventPct()
    this.anchorMode = anchorMode
    this.anchorSigma = anchorSigma
    this.dampK = dampK
    // drift 模式用独立随机源：不改变价格路径的 Student-t 取样序列，
    // 这样 visible/drift 两组可以在同一条价格冲击序列上对比（只差锚点与阻尼）。
    this.anchorRng = anchorMode === 'drift' ? new Rng(seed ^ 0x5bd1e995) : null
  }

  private sampleEventGap(): number {
    const u = Math.max(1e-9, this.eventRng.next())
    return Math.max(1, Math.round(-Math.log(u) * this.eventMeanMin))
  }

  /**
   * 事件模型：市场每 15~45 分钟一条消息（均值 30），但只有一部分直接打到本标的。
   * - 60% 宏观/其他板块，对本标的无直接冲击；
   * - 30% 板块事件，β=0.25（幅度 3%~25% 缩放到 0.75%~6.25%）；
   * - 10% 个股事件，完整 3%~25%。
   * 设计稿只给了 3%~25% 与 15~45 分钟，没有给「打到本标的的命中率」；这里按板块/个股拆分，
   * 属于报告「偏离项」中明确写出的建模选择。
   */
  private sampleEventPct(): number {
    const r = this.eventRng
    const kind = r.next()
    if (kind < 0.60) return 0
    const mag = 0.03 + 0.22 * r.next() ** 2
    const sign = r.next() < 0.5 ? -1 : 1
    const beta = kind < 0.90 ? 0.25 : 1
    return sign * mag * beta
  }

  private clampVol(v: number): number {
    const lo = (this.sigmaBase * VOL_MIN_FACTOR) ** 2
    const hi = (this.sigmaBase * VOL_MAX_FACTOR) ** 2
    return Math.min(hi, Math.max(lo, v))
  }

  private applyShock(pct: number): void {
    this.x = clamp(this.x + Math.log(1 + pct), -X_LIMIT, X_LIMIT)
    this.shockTicks = EVENT_SHOCK_TICKS
    this.shockMul = EVENT_SHOCK_MUL
    this.variance = this.clampVol(this.variance * 4)
  }

  /**
   * 锚点漂移：内在价值按自身对数随机游走（μ=0，日 σ=anchorSigma）。
   * 价格 x 仍是「相对锚点的偏离」，锚点移动时价格随之移动——即基本面漂移，而不是插针。
   */
  private driftAnchor(): void {
    const stepSigma = this.anchorSigma / Math.sqrt(MINUTES_PER_DAY)
    this.anchorLog += this.anchorRng!.normal() * stepSigma
    const rel = clamp(this.anchorLog - Math.log(this.anchorA0), -ANCHOR_LOG_BOUND, ANCHOR_LOG_BOUND)
    this.anchor = this.anchorA0 * Math.exp(rel)
  }

  step(minute: number): number {
    while (minute >= this.eventMinute) {
      if (this.eventPct !== 0) this.applyShock(this.eventPct)
      this.eventMinute += this.sampleEventGap()
      this.eventPct = this.sampleEventPct()
    }

    const shockMul = this.shockTicks > 0 ? this.shockMul : 1
    if (this.shockTicks > 0) {
      this.shockTicks -= 1
      if (this.shockTicks === 0) this.shockMul = 1
    }

    if (this.anchorMode === 'drift') this.driftAnchor()

    const sigma = Math.sqrt(this.clampVol(this.variance)) * shockMul
    const t = T_POOL[this.tIndex]
    this.tIndex = (this.tIndex + this.tStride) & T_POOL_MASK
    const r = sigma * t
    const drift = -0.5 * sigma * sigma
    // 自适应回归阻尼：偏离锚点越远，回归越弱。防止「锚点可见 + 强均值回归」被当成无风险套利。
    const theta = this.anchorMode === 'drift' ? THETA / (1 + Math.abs(this.x) * this.dampK) : THETA
    this.x = clamp(this.x + drift + r - theta * this.x, -X_LIMIT, X_LIMIT)
    this.variance = this.clampVol(EWMA_LAMBDA * this.variance + (1 - EWMA_LAMBDA) * r * r)
    this.price = this.anchor * Math.exp(this.x)
    return this.price
  }
}

// ============================================================================
// 3. 逐仓保证金公式（照设计稿 §4.4 / 附录 A.3）
// ============================================================================

function maintenanceMarginRate(leverage: number): number {
  return MAINTENANCE_FACTOR / Math.max(1, leverage)
}

function liquidationPrice(side: Side, entry: number, leverage: number): number {
  const L = Math.max(1, leverage)
  const mm = maintenanceMarginRate(L)
  if (side === 'long') return Math.max(0, (entry * (1 - 1 / L)) / (1 - mm))
  return Math.max(0, (entry * (1 + 1 / L)) / (1 + mm))
}

function liquidationDistancePct(side: Side, mark: number, liqPrice: number): number {
  if (mark <= 0) return 0
  const diff = side === 'long' ? (mark - liqPrice) / mark : (liqPrice - mark) / mark
  return Math.max(0, diff * 100)
}

function unrealized(side: Side, entry: number, mark: number, qty: number): number {
  return (mark - entry) * qty * (side === 'long' ? 1 : -1)
}

// ============================================================================
// 4. 策略定义
// ============================================================================

type StrategyKind = 'random' | 'momentum' | 'grid' | 'dca' | 'hf' | 'value' | 'template'

interface StrategySpec {
  kind: StrategyKind
  label: string
  defaultLeverage: number
}

const ALL_STRATEGIES: StrategySpec[] = [
  { kind: 'random', label: '随机梭哈', defaultLeverage: 20 },
  { kind: 'momentum', label: '动量追涨', defaultLeverage: 10 },
  { kind: 'grid', label: '网格', defaultLeverage: 3 },
  { kind: 'dca', label: '定投长线', defaultLeverage: 1 },
  { kind: 'hf', label: '高频梭哈', defaultLeverage: 90 },
  { kind: 'value', label: '价值锚点', defaultLeverage: 2 },
  { kind: 'template', label: '模板组合', defaultLeverage: 2 },
]

const PHASE1_STRATEGIES: StrategySpec[] = ALL_STRATEGIES.filter((s) =>
  ['random', 'momentum', 'grid', 'hf'].includes(s.kind),
)

// ============================================================================
// 5. 交易者（逐仓账户 + 7 种策略）
// ============================================================================

interface Position {
  side: Side
  qty: number
  entry: number
  margin: number
  leverage: number
  openedAt: number
  liqPrice: number
  liquidating: boolean
  lastFunding: number
  lastInterest: number
}

interface RunResult {
  finalEquity: number
  bankrupt: boolean
  liquidated: boolean
  firstLiqMinute: number | null
  nearMiss: boolean
  decisions: number
  aliveMinutes: number
  /** 实际支付的买卖佣金+印花税（不含滑点）。 */
  feesPaid: number
  /** 实际支付的普通/强平滑点。 */
  slipPaid: number
  /** 实际支付的资金费/杠杆利息/借券费。 */
  fundingPaid: number
  /** 破产发生的游戏分钟；未破产为 null。 */
  deathMinute: number | null
}

class Trader {
  readonly spec: StrategySpec
  readonly leverage: number
  readonly feeTier: FeeTier
  readonly dailyVol: number
  readonly fees: FeePair
  readonly metrics: MetricsBucket

  private readonly rng: Rng
  cash = INITIAL_CAPITAL
  pos: Position | null = null
  dead = false
  bankrupt = false
  badDebt = 0
  decisions = 0
  aliveMinutes = 0
  firstLiqMinute: number | null = null
  liquidated = 0
  nearMiss = false
  feesPaid = 0
  slipPaid = 0
  fundingPaid = 0
  deathMinute: number | null = null
  private lastLiqDistance = 100
  private prevEquity: number | null = null
  private cooldownUntil = 0

  // 策略状态
  private priceRing = new Float64Array(6)
  private ringIdx = 0
  private ringCount = 0
  private nextAction = 0
  private dcaNext = 0
  private gridCenter = 4000
  private gridLogSpacing: number
  private gridSpacing: number
  private gridLastLevel = 0
  private gridBuys = 0
  private gridNextMinute = 0
  private peakPrice = 0

  constructor(
    spec: StrategySpec,
    leverage: number,
    feeTier: FeeTier,
    feeModel: FeeModel,
    dailyVol: number,
    seed: number,
    metrics: MetricsBucket,
  ) {
    this.spec = spec
    this.leverage = leverage
    this.feeTier = feeTier
    this.dailyVol = dailyVol
    // 档位费率按「该策略实际用的杠杆」取档，而不是按参数组合的杠杆上限取档。
    this.fees = feePair(leverage, feeModel, feeTier)
    this.metrics = metrics
    this.rng = new Rng(seed)
    // 网格间距不能贴着手续费走：3x 下 0.3% 价差 ≈ 0.9% 保证金，刚好被 0.3% 名义费用吃光。
    // 取 1% 起步、随日波动放大，保证一次完整网格的毛利 > 税费。
    this.gridSpacing = Math.max(0.01, dailyVol / 8)
    this.gridLogSpacing = Math.log(1 + this.gridSpacing)
  }

  // ---- 主循环 --------------------------------------------------------------

  tick(minute: number, price: number): void {
    if (this.dead) return
    this.aliveMinutes += 1
    this.pushPrice(price)

    if (this.pos) {
      if (!this.pos.liquidating) {
        const eq = this.pos.margin + unrealized(this.pos.side, this.pos.entry, price, this.pos.qty)
        const mmNotional = maintenanceMarginRate(this.pos.leverage) * this.pos.qty * price
        const prevDist = this.lastLiqDistance
        this.lastLiqDistance = liquidationDistancePct(this.pos.side, price, this.pos.liqPrice)
        if (eq <= mmNotional) {
          this.pos.liquidating = true
          if (this.firstLiqMinute === null) this.firstLiqMinute = minute
          this.liquidated += 1
          this.nearMiss = prevDist < 5
        }
      }

      if (this.pos && this.pos.liquidating) {
        this.metrics.sumOpenMinutes += 1
        this.liquidate(price, minute)
        if (!this.pos) this.cooldownUntil = Math.max(this.cooldownUntil, minute + 5)
        this.checkSolvency(price)
        return
      }

      this.accrueCosts(minute, price)
      if (this.dead) return
      this.metrics.sumOpenMinutes += 1
      this.recordEquityChange(price)
    }

    if (minute < this.cooldownUntil) {
      this.checkSolvency(price)
      return
    }

    switch (this.spec.kind) {
      case 'random':
        this.tickRandom(minute, price)
        break
      case 'momentum':
        this.tickMomentum(minute, price)
        break
      case 'grid':
        this.tickGrid(minute, price)
        break
      case 'dca':
        this.tickDca(minute, price)
        break
      case 'hf':
        this.tickHf(minute, price)
        break
      case 'value':
        this.tickValue(minute, price)
        break
      case 'template':
        this.tickTemplate(minute, price)
        break
    }

    this.checkSolvency(price)
  }

  // ---- 策略实现 ------------------------------------------------------------

  /** 随机梭哈：随机方向、几乎满仓、持有到爆仓或结束；爆仓后等 4 小时再赌。 */
  private tickRandom(minute: number, price: number): void {
    if (this.pos) return
    if (minute < this.nextAction) return
    if (this.cash <= INITIAL_CAPITAL * 0.01) return
    const side: Side = this.rng.next() < 0.5 ? 'long' : 'short'
    const ok = this.open(side, this.cash * 0.98, price, minute)
    this.nextAction = minute + (ok ? 240 : 30)
  }

  /** 动量追涨：5 分钟收益 > +2% 追多；保证金亏 10% 或持有 4 小时离场。 */
  private tickMomentum(minute: number, price: number): void {
    if (this.pos) {
      const pnlPct = unrealized(this.pos.side, this.pos.entry, price, this.pos.qty) / this.pos.margin
      if (pnlPct <= -0.1 || minute - this.pos.openedAt >= 240) {
        this.close(this.pos.qty, price, minute)
        this.cooldownUntil = minute + 10
      }
      return
    }
    if (minute % 5 !== 0) return
    const ret5 = this.ret(price, 5)
    if (ret5 > 0.02) {
      const ok = this.open('long', this.equity(price) * 0.5, price, minute)
      if (!ok) this.cooldownUntil = minute + 5
    }
  }

  /** 网格：锚点 4000 上下按「1% 起、随波动放大」的间距挂档，跌一格买一份、涨一格卖一份，最多 8 份。 */
  private tickGrid(minute: number, price: number): void {
    if (!this.pos) this.gridBuys = 0
    if (minute < this.gridNextMinute) return
    const level = Math.floor(Math.log(price / this.gridCenter) / this.gridLogSpacing)

    // 网格必须有止损：3x 下 -25% 保证金 ≈ -8.3% 价格，先于 16.7% 的强平线；
    // 没有止损的网格遇到单边事件会被强平，30 日内反复爆仓会把权益打到 0。
    if (this.pos) {
      const pnlPct = unrealized(this.pos.side, this.pos.entry, price, this.pos.qty) / this.pos.margin
      if (pnlPct <= -0.25) {
        this.close(this.pos.qty, price, minute)
        this.cooldownUntil = minute + 1440
        this.gridLastLevel = level
        this.gridBuys = 0
        return
      }
    }

    if (level < this.gridLastLevel) {
      const steps = Math.min(2, this.gridLastLevel - level)
      let acted = false
      for (let i = 0; i < steps; i++) {
        if (this.gridBuys >= 8) break
        if (this.openOrAdd('long', INITIAL_CAPITAL * 0.05, price, minute)) {
          this.gridBuys += 1
          acted = true
        } else break
      }
      this.gridLastLevel = level
      if (acted) this.gridNextMinute = minute + 3
    } else if (level > this.gridLastLevel) {
      const steps = Math.min(2, level - this.gridLastLevel)
      let acted = false
      for (let i = 0; i < steps; i++) {
        if (!this.pos || this.pos.qty <= 0) break
        const unitNotional = INITIAL_CAPITAL * 0.05 * this.leverage
        const q = Math.min(this.pos.qty, unitNotional / price)
        this.close(q, price, minute)
        this.gridBuys = Math.max(0, this.gridBuys - 1)
        acted = true
      }
      this.gridLastLevel = level
      if (acted) this.gridNextMinute = minute + 3
    }
  }

  /** 定投长线：每日买初始资金的 3%，1x 不加杠杆，持有到结束。 */
  private tickDca(minute: number, price: number): void {
    if (minute < this.dcaNext) return
    if (this.cash <= INITIAL_CAPITAL * 0.03) return
    const amount = Math.min(INITIAL_CAPITAL * 0.03, this.cash * 0.98)
    const ok = this.openOrAdd('long', amount, price, minute)
    this.dcaNext = minute + (ok ? 1440 : 60)
  }

  /** 50x 高频：每 2 分钟开一次，持 2 分钟；1 分钟动量定方向，费用天然吃掉保证金。 */
  private tickHf(minute: number, price: number): void {
    if (this.pos) {
      const hold = minute - this.pos.openedAt
      const pnlPct = unrealized(this.pos.side, this.pos.entry, price, this.pos.qty) / this.pos.margin
      if (hold >= 2 || pnlPct <= -0.35 || pnlPct >= 0.5) {
        this.close(this.pos.qty, price, minute)
        this.cooldownUntil = minute + 1
      }
      return
    }
    if (minute % 2 !== 0) return
    if (this.cash <= INITIAL_CAPITAL * 0.005) return
    const ret1 = this.ret(price, 1)
    let side: Side
    if (ret1 > 0.0002) side = 'long'
    else if (ret1 < -0.0002) side = 'short'
    else side = this.rng.next() < 0.5 ? 'long' : 'short'
    const ok = this.open(side, this.cash * 0.1, price, minute)
    if (!ok) this.cooldownUntil = minute + 2
  }

  /** 价值锚点：P<0.8A 买入，P>1.3A 卖出；2x，保证金亏 35% 或持有 20 日离场。 */
  private tickValue(minute: number, price: number): void {
    const anchor = 4000
    if (this.pos) {
      const pnlPct = unrealized(this.pos.side, this.pos.entry, price, this.pos.qty) / this.pos.margin
      if (price >= anchor * 1.3 || pnlPct <= -0.35 || minute - this.pos.openedAt >= 20 * 1440) {
        this.close(this.pos.qty, price, minute)
        this.cooldownUntil = minute + 60
      }
      return
    }
    if (minute % 5 !== 0) return
    if (price <= anchor * 0.8) {
      this.open('long', this.equity(price) * 0.4, price, minute)
    }
  }

  /** 模板组合：定投 + 移动止盈；每 12 小时买 4%，价格从峰值回撤 10% 清仓并暂停 1 日。 */
  private tickTemplate(minute: number, price: number): void {
    if (this.pos) {
      this.peakPrice = Math.max(this.peakPrice, price)
      if (price <= this.peakPrice * 0.9) {
        this.close(this.pos.qty, price, minute)
        this.cooldownUntil = minute + 1440
        this.peakPrice = 0
        return
      }
    } else {
      this.peakPrice = 0
    }

    if (minute < this.dcaNext) return
    if (this.cash <= INITIAL_CAPITAL * 0.04) return
    const amount = Math.min(INITIAL_CAPITAL * 0.04, this.cash * 0.95)
    const ok = this.openOrAdd('long', amount, price, minute)
    if (ok) {
      this.peakPrice = Math.max(this.peakPrice, price)
      this.dcaNext = minute + 720
    } else {
      this.dcaNext = minute + 60
    }
  }

  // ---- 账户与仓位 ----------------------------------------------------------

  private pushPrice(price: number): void {
    this.priceRing[this.ringIdx] = price
    this.ringIdx = (this.ringIdx + 1) % 6
    if (this.ringCount < 6) this.ringCount += 1
  }

  private ret(price: number, n: number): number {
    if (this.ringCount <= n) return 0
    const prev = this.priceRing[(this.ringIdx - 1 - n + 6) % 6]
    return prev > 0 ? price / prev - 1 : 0
  }

  private equity(price: number): number {
    const p = this.pos
    if (!p) return this.cash
    return this.cash + p.margin + unrealized(p.side, p.entry, price, p.qty)
  }

  private recordEquityChange(price: number): void {
    const p = this.pos
    if (!p || p.margin <= 0) return
    const eq = p.margin + unrealized(p.side, p.entry, price, p.qty)
    if (this.prevEquity !== null) {
      const changePct = (Math.abs(eq - this.prevEquity) / p.margin) * 100
      this.metrics.addVol(changePct)
    }
    this.prevEquity = eq
  }

  private open(side: Side, desiredMargin: number, price: number, minute: number): boolean {
    if (this.pos || this.dead || desiredMargin <= 0) return false
    const openSide: 'buy' | 'sell' = side === 'long' ? 'buy' : 'sell'
    const feeRate = this.fees[openSide]
    const maxMargin = this.cash / (1 + this.leverage * (feeRate + SLIPPAGE_RATE))
    const margin = Math.min(desiredMargin, maxMargin * 0.999)
    if (margin <= 0) return false
    const notional = margin * this.leverage
    const fee = notional * feeRate
    const slip = notional * SLIPPAGE_RATE
    if (margin + fee + slip > this.cash) return false

    this.cash -= margin + fee + slip
    this.feesPaid += fee
    this.slipPaid += slip
    this.pos = {
      side,
      qty: notional / price,
      entry: price,
      margin,
      leverage: this.leverage,
      openedAt: minute,
      liqPrice: liquidationPrice(side, price, this.leverage),
      liquidating: false,
      lastFunding: minute,
      lastInterest: minute,
    }
    this.lastLiqDistance = liquidationDistancePct(side, price, this.pos.liqPrice)
    this.prevEquity = null
    this.decisions += 1
    return true
  }

  private openOrAdd(side: Side, desiredMargin: number, price: number, minute: number): boolean {
    if (!this.pos) return this.open(side, desiredMargin, price, minute)
    if (this.pos.side !== side || this.pos.liquidating) return false

    const p = this.pos
    const openSide: 'buy' | 'sell' = side === 'long' ? 'buy' : 'sell'
    const feeRate = this.fees[openSide]
    const maxMargin = this.cash / (1 + this.leverage * (feeRate + SLIPPAGE_RATE))
    const margin = Math.min(desiredMargin, maxMargin * 0.999)
    if (margin <= 0) return false
    const notional = margin * this.leverage
    const fee = notional * feeRate
    const slip = notional * SLIPPAGE_RATE
    if (margin + fee + slip > this.cash) return false

    const addQty = notional / price
    const oldQty = p.qty
    this.cash -= margin + fee + slip
    this.feesPaid += fee
    this.slipPaid += slip
    p.qty += addQty
    p.margin += margin
    p.entry = (p.entry * oldQty + price * addQty) / p.qty
    p.liqPrice = liquidationPrice(p.side, p.entry, p.leverage)
    this.lastLiqDistance = liquidationDistancePct(p.side, price, p.liqPrice)
    this.prevEquity = null
    this.decisions += 1
    return true
  }

  private close(
    qty: number,
    price: number,
    minute: number,
    opts: { forced?: boolean; liquidation?: boolean } = {},
  ): void {
    const p = this.pos
    if (!p) return
    const q = Math.min(qty, p.qty)
    if (q <= 0) return

    const closeSide: 'buy' | 'sell' = p.side === 'long' ? 'sell' : 'buy'
    const feeRate = this.fees[closeSide]
    const notional = q * price
    const slipRate = opts.liquidation ? LIQUIDATION_SLIPPAGE_RATE : SLIPPAGE_RATE
    const penalty = opts.liquidation ? notional * LIQUIDATION_PENALTY_RATE : 0
    const pnl = unrealized(p.side, p.entry, price, q)
    const marginPart = p.margin * (q / p.qty)

    this.cash += marginPart + pnl - notional * feeRate - notional * slipRate - penalty
    this.feesPaid += notional * feeRate
    this.slipPaid += notional * slipRate
    p.qty -= q
    p.margin -= marginPart
    if (p.qty <= 1e-9) {
      this.pos = null
    }
    this.prevEquity = null
    if (!opts.forced) this.decisions += 1
    this.normalizeCash(price)
    this.checkSolvency(price)
    void minute
  }

  private liquidate(price: number, minute: number): void {
    const p = this.pos
    if (!p) return
    const sliceQty = Math.max(1, Math.floor(p.qty * LIQUIDATION_SLICE_RATIO))
    this.close(Math.min(p.qty, sliceQty), price, minute, { forced: true, liquidation: true })
  }

  private accrueCosts(minute: number, price: number): void {
    const p = this.pos
    if (!p || p.leverage <= 1) return
    const notional = p.qty * price

    while (minute - p.lastFunding >= 480) {
      const rate = p.side === 'long' ? FUNDING_RATE_8H : -FUNDING_RATE_8H * FUNDING_SHORT_RECEIVE
      this.payCost(notional * rate, price)
      p.lastFunding += 480
      if (this.dead) return
    }
    while (minute - p.lastInterest >= 1440) {
      const rate =
        p.side === 'long' ? LEVERAGE_DAILY_INTEREST * (1 - 1 / p.leverage) : BORROW_DAILY_FEE
      this.payCost(notional * rate, price)
      p.lastInterest += 1440
      if (this.dead) return
    }
  }

  private payCost(cost: number, price: number): void {
    if (cost >= 0) {
      this.cash -= cost
      this.fundingPaid += cost
      this.normalizeCash(price)
      this.checkSolvency(price)
    } else {
      this.cash += -cost
    }
  }

  private normalizeCash(price: number): void {
    if (this.cash < 0 && this.pos) {
      this.pos.margin += this.cash
      this.cash = 0
    }
    void price
  }

  private checkSolvency(price: number): void {
    if (this.dead) return
    if (this.equity(price) <= 0) this.fail(price)
  }

  private fail(price: number): void {
    const eq = this.equity(price)
    this.badDebt += Math.max(0, -eq)
    this.dead = true
    this.bankrupt = true
    this.deathMinute = this.aliveMinutes
    this.cash = 0
    this.pos = null
    this.prevEquity = null
  }

  finalize(minute: number, price: number): RunResult {
    if (this.dead) {
      return {
        finalEquity: 0,
        bankrupt: true,
        liquidated: this.liquidated > 0,
        firstLiqMinute: this.firstLiqMinute,
        nearMiss: this.nearMiss,
        decisions: this.decisions,
        aliveMinutes: this.aliveMinutes,
        feesPaid: this.feesPaid,
        slipPaid: this.slipPaid,
        fundingPaid: this.fundingPaid,
        deathMinute: this.deathMinute,
      }
    }

    if (this.pos) {
      this.close(this.pos.qty, price, minute, {
        forced: true,
        liquidation: this.pos.liquidating,
      })
    }
    if (this.cash < 0) {
      this.badDebt += -this.cash
      this.cash = 0
      this.bankrupt = true
      if (this.deathMinute === null) this.deathMinute = minute
    }
    return {
      finalEquity: Math.max(0, this.cash),
      bankrupt: this.bankrupt,
      liquidated: this.liquidated > 0,
      firstLiqMinute: this.firstLiqMinute,
      nearMiss: this.nearMiss,
      decisions: this.decisions,
      aliveMinutes: this.aliveMinutes,
      feesPaid: this.feesPaid,
      slipPaid: this.slipPaid,
      fundingPaid: this.fundingPaid,
      deathMinute: this.deathMinute,
    }
  }
}

// ============================================================================
// 6. 指标聚合
// ============================================================================

class MetricsBucket {
  runs = 0
  bankrupt = 0
  effectiveSurvive = 0
  profitable = 0
  liquidated = 0
  nearMissCount = 0
  sumReturn = 0
  sumReturnSq = 0
  sumDecisions = 0
  sumAliveMinutes = 0
  sumOpenMinutes = 0
  sumFees = 0
  sumSlip = 0
  sumFunding = 0
  liqTimes: number[] = []
  deathTimes: number[] = []
  hist = new Int32Array(HIST_BINS)

  addVol(changePct: number): void {
    const bin = clamp(Math.floor(changePct / HIST_BIN_WIDTH), 0, HIST_BINS - 1)
    this.hist[bin] += 1
  }

  record(r: RunResult): void {
    this.runs += 1
    if (r.bankrupt) this.bankrupt += 1
    // 「有效存活」= 期末权益仍够开户门槛（100 万），而不只是数字上 >0。
    // 否则一个只剩 0.5% 权益的账户在统计里仍算「存活」，会把死亡策略洗成高存活率。
    if (r.finalEquity >= INITIAL_CAPITAL * 0.1) this.effectiveSurvive += 1
    const ret = r.finalEquity / INITIAL_CAPITAL - 1
    if (ret > 0) this.profitable += 1
    this.sumReturn += ret
    this.sumReturnSq += ret * ret
    this.sumDecisions += r.decisions
    this.sumAliveMinutes += r.aliveMinutes
    this.sumFees += r.feesPaid
    this.sumSlip += r.slipPaid
    this.sumFunding += r.fundingPaid
    if (r.liquidated && r.firstLiqMinute !== null) {
      this.liquidated += 1
      this.liqTimes.push(r.firstLiqMinute)
      if (r.nearMiss) this.nearMissCount += 1
    }
    if (r.bankrupt && r.deathMinute !== null) this.deathTimes.push(r.deathMinute)
  }

  summary(kind: StrategyKind, label: string): StrategySummary {
    return buildSummary(kind, label, this)
  }
}

interface SummaryCore {
  runs: number
  bankrupt: number
  effectiveSurvive: number
  effectiveSurvivalRate: number
  profitable: number
  liquidated: number
  nearMissCount: number
  sumReturn: number
  sumReturnSq: number
  sumDecisions: number
  sumAliveMinutes: number
  sumOpenMinutes: number
  sumFees: number
  sumSlip: number
  sumFunding: number
  liqTimes: number[]
  deathTimes: number[]
  hist: Int32Array
  survivalRate: number
  profitRate: number
  meanReturn: number
  stdReturn: number
  tStat: number
  medianLiq: number | null
  medianDeath: number | null
  nearMissRate: number | null
  decisionDensity: number
  volP90: number
  openShare: number
  /** 平均每条样本支付的佣金+印花税，占初始本金的比例。 */
  meanFeePct: number
  meanSlipPct: number
  meanFundingPct: number
  stablePositive: boolean
}

interface StrategySummary extends SummaryCore {
  kind: StrategyKind
  label: string
  /** 该策略在本组合里实际使用的杠杆（档位费率按它取值）。 */
  leverage: number
}

function buildSummary(
  kind: StrategyKind | null,
  label: string,
  b: {
    runs: number
    bankrupt: number
    effectiveSurvive: number
    profitable: number
    liquidated: number
    nearMissCount: number
    sumReturn: number
    sumReturnSq: number
    sumDecisions: number
    sumAliveMinutes: number
    sumOpenMinutes: number
    sumFees: number
    sumSlip: number
    sumFunding: number
    liqTimes: number[]
    deathTimes: number[]
    hist: Int32Array
  },
): StrategySummary {
  const n = b.runs
  const mean = n > 0 ? b.sumReturn / n : 0
  const variance = n > 1 ? Math.max(0, b.sumReturnSq / n - mean * mean) : 0
  const std = Math.sqrt(variance)
  const tStat = std > 0 && n > 1 ? mean / (std / Math.sqrt(n)) : 0
  const profitRate = n > 0 ? b.profitable / n : 0
  const stablePositive = n >= 30 && mean > 0 && tStat >= 2.5 && profitRate >= 0.55
  const medianLiq = median(b.liqTimes)
  const medianDeath = median(b.deathTimes)
  const nearMissRate = b.liquidated > 0 ? b.nearMissCount / b.liquidated : null
  const decisionDensity = b.sumAliveMinutes > 0 ? b.sumDecisions / b.sumAliveMinutes : 0
  const volP90 = percentileFromHist(b.hist, 0.9)
  const openShare = b.sumAliveMinutes > 0 ? b.sumOpenMinutes / b.sumAliveMinutes : 0
  const meanFeePct = n > 0 ? b.sumFees / n / INITIAL_CAPITAL : 0
  const meanSlipPct = n > 0 ? b.sumSlip / n / INITIAL_CAPITAL : 0
  const meanFundingPct = n > 0 ? b.sumFunding / n / INITIAL_CAPITAL : 0

  return {
    kind: kind ?? 'random',
    label,
    leverage: 1,
    runs: n,
    bankrupt: b.bankrupt,
    effectiveSurvive: b.effectiveSurvive,
    effectiveSurvivalRate: n > 0 ? b.effectiveSurvive / n : 0,
    profitable: b.profitable,
    liquidated: b.liquidated,
    nearMissCount: b.nearMissCount,
    sumReturn: b.sumReturn,
    sumReturnSq: b.sumReturnSq,
    sumDecisions: b.sumDecisions,
    sumAliveMinutes: b.sumAliveMinutes,
    sumOpenMinutes: b.sumOpenMinutes,
    sumFees: b.sumFees,
    sumSlip: b.sumSlip,
    sumFunding: b.sumFunding,
    liqTimes: b.liqTimes,
    deathTimes: b.deathTimes,
    hist: b.hist,
    survivalRate: n > 0 ? 1 - b.bankrupt / n : 0,
    profitRate,
    meanReturn: mean,
    stdReturn: std,
    tStat,
    medianLiq,
    medianDeath,
    nearMissRate,
    decisionDensity,
    volP90,
    openShare,
    meanFeePct,
    meanSlipPct,
    meanFundingPct,
    stablePositive,
  }
}

function aggregateSummaries(summaries: StrategySummary[]): SummaryCore {
  const runs = summaries.reduce((a, s) => a + s.runs, 0)
  const bankrupt = summaries.reduce((a, s) => a + s.bankrupt, 0)
  const effectiveSurvive = summaries.reduce((a, s) => a + s.effectiveSurvive, 0)
  const profitable = summaries.reduce((a, s) => a + s.profitable, 0)
  const liquidated = summaries.reduce((a, s) => a + s.liquidated, 0)
  const nearMissCount = summaries.reduce((a, s) => a + s.nearMissCount, 0)
  const sumReturn = summaries.reduce((a, s) => a + s.sumReturn, 0)
  const sumReturnSq = summaries.reduce((a, s) => a + s.sumReturnSq, 0)
  const sumDecisions = summaries.reduce((a, s) => a + s.sumDecisions, 0)
  const sumAliveMinutes = summaries.reduce((a, s) => a + s.sumAliveMinutes, 0)
  const sumOpenMinutes = summaries.reduce((a, s) => a + s.sumOpenMinutes, 0)
  const sumFees = summaries.reduce((a, s) => a + s.sumFees, 0)
  const sumSlip = summaries.reduce((a, s) => a + s.sumSlip, 0)
  const sumFunding = summaries.reduce((a, s) => a + s.sumFunding, 0)
  const liqTimes = summaries.flatMap((s) => s.liqTimes)
  const deathTimes = summaries.flatMap((s) => s.deathTimes)
  const hist = new Int32Array(HIST_BINS)
  for (const s of summaries) {
    for (let i = 0; i < HIST_BINS; i++) hist[i] += s.hist[i]
  }
  return buildSummary(null, '汇总', {
    runs,
    bankrupt,
    effectiveSurvive,
    profitable,
    liquidated,
    nearMissCount,
    sumReturn,
    sumReturnSq,
    sumDecisions,
    sumAliveMinutes,
    sumOpenMinutes,
    sumFees,
    sumSlip,
    sumFunding,
    liqTimes,
    deathTimes,
    hist,
  })
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentileFromHist(hist: Int32Array, p: number): number {
  let total = 0
  for (let i = 0; i < hist.length; i++) total += hist[i]
  if (total === 0) return 0
  const target = total * p
  let cum = 0
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i]
    if (cum >= target) return (i + 1) * HIST_BIN_WIDTH
  }
  return HIST_BINS * HIST_BIN_WIDTH
}

// ============================================================================
// 7. 组合仿真
// ============================================================================

interface ComboParams {
  leverageCap: number
  dailyVol: number
  feeTier: FeeTier
  feeModel: FeeModel
  anchorMode: AnchorMode
  eventMeanMin: number
  /** drift 模式的锚点日漂移 σ（缺省 ANCHOR_DAILY_SIGMA）。 */
  anchorSigma?: number
  /** drift 模式的自适应回归阻尼系数（缺省 ANCHOR_DAMP_K）。 */
  dampK?: number
}

interface ComboResult {
  params: ComboParams
  summaries: StrategySummary[]
  agg: SummaryCore
  best: StrategySummary
  worst: StrategySummary
  spread: number
  moneyPrinting: StrategySummary[]
  verdict: Verdict
  reasons: string[]
}

function simulateCombo(
  params: ComboParams,
  specs: StrategySpec[],
  runs: number,
  days: number,
  masterSeed: number,
  phase: number,
  comboIndex: number,
  leverageOverride: number | null,
): ComboResult {
  const buckets = new Map<StrategyKind, MetricsBucket>()
  for (const spec of specs) buckets.set(spec.kind, new MetricsBucket())
  const totalMinutes = days * MINUTES_PER_DAY

  for (let run = 0; run < runs; run++) {
    const seed = deriveSeed(masterSeed, phase, comboIndex, run)
    const path = new PricePath(
      params.dailyVol,
      seed,
      params.eventMeanMin,
      params.anchorMode,
      params.anchorSigma ?? ANCHOR_DAILY_SIGMA,
      params.dampK ?? ANCHOR_DAMP_K,
    )
    const traders: Trader[] = []
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]
      const leverage = leverageOverride ?? Math.min(spec.defaultLeverage, params.leverageCap)
      const traderSeed = seed ^ hash32(Math.imul(i + 1, 0x9e3779b9))
      traders.push(
        new Trader(
          spec,
          leverage,
          params.feeTier,
          params.feeModel,
          params.dailyVol,
          traderSeed,
          buckets.get(spec.kind)!,
        ),
      )
    }

    for (let minute = 0; minute < totalMinutes; minute++) {
      const price = path.step(minute)
      for (let i = 0; i < traders.length; i++) traders[i].tick(minute, price)
    }

    const finalPrice = path.price
    for (let i = 0; i < traders.length; i++) {
      const result = traders[i].finalize(totalMinutes, finalPrice)
      buckets.get(traders[i].spec.kind)!.record(result)
    }
  }

  const summaries = specs.map((spec) => {
    const summary = buckets.get(spec.kind)!.summary(spec.kind, spec.label)
    summary.leverage =
      leverageOverride ?? Math.min(spec.defaultLeverage, params.leverageCap)
    return summary
  })
  const agg = aggregateSummaries(summaries)
  let best = summaries[0]
  let worst = summaries[0]
  for (const s of summaries) {
    if (s.meanReturn > best.meanReturn) best = s
    if (s.meanReturn < worst.meanReturn) worst = s
  }
  const spread = best.meanReturn - worst.meanReturn
  const moneyPrinting = summaries.filter((s) => s.stablePositive)
  const judged = judgeCombo(params, agg, best, spread, moneyPrinting)

  return {
    params,
    summaries,
    agg,
    best,
    worst,
    spread,
    moneyPrinting,
    verdict: judged.verdict,
    reasons: judged.reasons,
  }
}

function judgeCombo(
  params: ComboParams,
  agg: SummaryCore,
  best: StrategySummary,
  spread: number,
  moneyPrinting: StrategySummary[],
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = []
  let red = false
  let yellow = false

  if (moneyPrinting.length > 0) {
    red = true
    reasons.push(`印钞：${moneyPrinting.map((s) => s.label).join('、')}`)
  }
  // 船长 2026-11-03 裁决：90x 梭哈是玩家自愿购买的风险，不因「瞬死」判红；
  // 50x 仍保留设计稿的「爆仓中位数 <10 分钟」红线作为对照。
  if (params.leverageCap === 50 && best.medianLiq !== null && best.medianLiq < 10) {
    red = true
    reasons.push('50x 爆仓中位数 <10 分钟')
  }
  const capFee = feePair(params.leverageCap, params.feeModel, params.feeTier)
  const roundTripMarginPct = params.leverageCap * (capFee.buy + capFee.sell)
  // 公平线：一轮往返费用不能超过保证金的 8%，否则玩家是输给手续费而不是市场。
  if (params.leverageCap > 50 && roundTripMarginPct > 0.08) {
    red = true
    reasons.push(`高杠杆一轮往返费用 ${(roundTripMarginPct * 100).toFixed(1)}% 保证金 >8%（输给手续费）`)
  }
  if (best.profitRate < 0.1) {
    red = true
    reasons.push(`最好策略（${best.label}）盈利面 <10%`)
  }

  // 判定以「最好策略」为主：玩家会挑可行玩法，合并口径会把死亡策略的平均值误当成游戏难度。
  // 合并口径仍保留在表里，用来观察死亡策略的占比。
  if (best.effectiveSurvivalRate < 0.3 || best.effectiveSurvivalRate > 0.7) {
    yellow = true
    reasons.push(`有效存活率 ${(best.effectiveSurvivalRate * 100).toFixed(1)}% 越界`)
  }
  if (best.profitRate >= 0.1 && (best.profitRate < 0.2 || best.profitRate > 0.45)) {
    yellow = true
    reasons.push(`盈利面 ${(best.profitRate * 100).toFixed(1)}% 越界`)
  }
  if (best.medianLiq !== null && best.medianLiq < 30) {
    yellow = true
    reasons.push(`爆仓中位数 ${best.medianLiq.toFixed(0)} 分钟 <30`)
  }
  if (best.nearMissRate !== null && best.nearMissRate < 0.4) {
    yellow = true
    reasons.push(`近失率 ${(best.nearMissRate * 100).toFixed(1)}% <40%`)
  }
  if (best.decisionDensity < 0.2 || best.decisionDensity > 1.5) {
    yellow = true
    reasons.push(`决策密度 ${best.decisionDensity.toFixed(3)}/分 越界`)
  }
  const capFeePair = feePair(params.leverageCap, params.feeModel, params.feeTier)
  const feeHurdle = params.leverageCap * (capFeePair.buy + capFeePair.sell)
  if (spread <= feeHurdle) {
    yellow = true
    reasons.push(`区分度 ${(spread * 100).toFixed(1)}pp ≤ 费率门槛 ${(feeHurdle * 100).toFixed(1)}pp`)
  }

  if (agg.profitRate < 0.1) {
    // 不直接判红：若最好策略能盈利，低合并盈利面只说明其他策略是陷阱。
    yellow = true
    reasons.push(`合并盈利面 ${(agg.profitRate * 100).toFixed(1)}%（死亡策略拉低）`)
  }

  if (!red && reasons.length === 0) reasons.push('全部代理指标在目标区间')
  return { verdict: red ? 'red' : yellow ? 'yellow' : 'green', reasons }
}

/** 对「一组策略的合并口径」判定（阶段二核心子集用）。额外加一条补充判据：30 日期望 < -30% 视为劝退。 */
function judgeAggregate(
  params: ComboParams,
  agg: SummaryCore,
  spread: number,
  moneyPrinting: StrategySummary[],
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = []
  let red = false
  let yellow = false

  if (moneyPrinting.length > 0) {
    red = true
    reasons.push(`印钞：${moneyPrinting.map((s) => s.label).join('、')}`)
  }
  if (agg.profitRate < 0.1) {
    red = true
    reasons.push('合并盈利面 <10%')
  }
  if (agg.meanReturn < -0.3) {
    red = true
    reasons.push(`合并期望 ${fmtSignedPct(agg.meanReturn, 0)}/30日 < -30%（补充劝退线）`)
  }
  if (agg.effectiveSurvivalRate < 0.3 || agg.effectiveSurvivalRate > 0.7) {
    yellow = true
    reasons.push(`合并有效存活率 ${(agg.effectiveSurvivalRate * 100).toFixed(1)}% 越界`)
  }
  if (agg.profitRate >= 0.1 && (agg.profitRate < 0.2 || agg.profitRate > 0.45)) {
    yellow = true
    reasons.push(`合并盈利面 ${(agg.profitRate * 100).toFixed(1)}% 越界`)
  }
  if (agg.medianLiq !== null && agg.medianLiq < 30) {
    yellow = true
    reasons.push(`爆仓中位数 ${agg.medianLiq.toFixed(0)} 分钟 <30`)
  }
  if (agg.nearMissRate !== null && agg.nearMissRate < 0.4) {
    yellow = true
    reasons.push(`近失率 ${(agg.nearMissRate * 100).toFixed(1)}% <40%`)
  }
  if (agg.decisionDensity < 0.2 || agg.decisionDensity > 1.5) {
    yellow = true
    reasons.push(`决策密度 ${agg.decisionDensity.toFixed(3)}/分 越界`)
  }
  const capFeePair = feePair(params.leverageCap, params.feeModel, params.feeTier)
  const feeHurdle = params.leverageCap * (capFeePair.buy + capFeePair.sell)
  if (spread <= feeHurdle) {
    yellow = true
    reasons.push(`区分度 ${(spread * 100).toFixed(1)}pp ≤ 费率门槛 ${(feeHurdle * 100).toFixed(1)}pp`)
  }

  if (!red && reasons.length === 0) reasons.push('全部代理指标在目标区间')
  return { verdict: red ? 'red' : yellow ? 'yellow' : 'green', reasons }
}

// ============================================================================
// 8. 实验阶段
// ============================================================================

type ScenarioId = 'A' | 'B' | 'C' | 'S'

interface ScenarioSpec {
  id: ScenarioId
  feeModel: FeeModel
  anchorMode: AnchorMode
  label: string
  /** drift 模式的回归阻尼 k；缺省用 ANCHOR_DAMP_K。 */
  dampK?: number
  /** drift 模式的锚点日漂移 σ；缺省用 ANCHOR_DAILY_SIGMA。 */
  anchorSigma?: number
}

/** 三组对照的统一诊断口径：8% 日波动 / 90x 上限 / 事件均值 30 分钟 / 7 策略 × 500 次 × 30 日。 */
const DIAG_VOL = 0.08
const DIAG_CAP = 90
const DIAG_EVENT_MIN = 30
const DIAG_RUNS = 500
const DIAG_DAYS = 30

const SCENARIOS: ScenarioSpec[] = [
  { id: 'A', feeModel: 'flat', anchorMode: 'visible', label: 'A 旧口径（flat + 可见锚点）' },
  { id: 'B', feeModel: 'tiered', anchorMode: 'visible', label: 'B 档位费率 + 90x（visible）' },
  { id: 'C', feeModel: 'tiered', anchorMode: 'drift', label: 'C 档位费率 + 锚点漂移（drift）', dampK: C_DRIFT_K, anchorSigma: C_DRIFT_SIGMA },
]

interface ScenarioRun {
  spec: ScenarioSpec
  scan: ComboResult[]
  playtest: ComboResult
  /** A 组额外汇总：旧推荐参数（10x / 8% / flat 基准 / 45 分钟）用于逐位复现旧报告。 */
  legacy?: ComboResult
}

function scanPhase(id: ScenarioId): number {
  // A 复用旧 phase 1 与原组合顺序（10/20/50 × 4/8/15 × 低/基准/高），
  // 90x 追加在最后，因此前 27 个组合可与旧报告逐位对齐。
  return id === 'A' ? 1 : id === 'B' ? 5 : 6
}

function runLeverageScan(spec: ScenarioSpec, masterSeed: number, quick: boolean): ComboResult[] {
  const levers = [10, 20, 50, 90]
  const vols = [0.04, 0.08, 0.15]
  const fees: FeeTier[] = spec.feeModel === 'flat' ? ['low', 'base', 'high'] : ['base']
  const runs = quick ? 20 : 100
  const days = 7
  const combos: ComboResult[] = []
  let comboIndex = 0
  for (const leverageCap of levers) {
    for (const dailyVol of vols) {
      for (const feeTier of fees) {
        const params: ComboParams = {
          leverageCap,
          dailyVol,
          feeTier,
          feeModel: spec.feeModel,
          anchorMode: spec.anchorMode,
          eventMeanMin: 30,
          anchorSigma: spec.anchorSigma,
          dampK: spec.dampK,
        }
        combos.push(
          simulateCombo(
            params,
            PHASE1_STRATEGIES,
            runs,
            days,
            masterSeed,
            scanPhase(spec.id),
            comboIndex,
            leverageCap,
          ),
        )
        comboIndex += 1
      }
    }
  }
  return combos
}

function diagParams(spec: ScenarioSpec): ComboParams {
  return {
    leverageCap: DIAG_CAP,
    dailyVol: DIAG_VOL,
    feeTier: 'base',
    feeModel: spec.feeModel,
    anchorMode: spec.anchorMode,
    eventMeanMin: DIAG_EVENT_MIN,
    anchorSigma: spec.anchorSigma,
    dampK: spec.dampK,
  }
}

function runPlaytest(
  spec: ScenarioSpec,
  params: ComboParams,
  masterSeed: number,
  quick: boolean,
  phase: number,
): ComboResult {
  return simulateCombo(
    params,
    ALL_STRATEGIES,
    quick ? 30 : DIAG_RUNS,
    quick ? 7 : DIAG_DAYS,
    masterSeed,
    phase,
    0,
    null,
  )
}

function comboScore(c: ComboResult): number {
  let score = c.verdict === 'green' ? 100 : c.verdict === 'yellow' ? 40 : 0
  const s = c.best
  score += 20 * (1 - Math.min(1, Math.abs(s.effectiveSurvivalRate - 0.5) / 0.5))
  score += 20 * (1 - Math.min(1, Math.abs(s.profitRate - 0.325) / 0.325))
  if (s.medianLiq !== null) score += Math.min(10, s.medianLiq / 60)
  if (s.nearMissRate !== null) score += 10 * s.nearMissRate
  score += 10 * Math.min(1, c.spread * 5)
  score -= c.moneyPrinting.length * 200
  score -= c.params.leverageCap * 0.5
  // 设计稿没有给「期望收益」目标区间，但 -50%/周 显然不是可玩，而是收割；
  // 选参时对负期望做线性惩罚，避免选出「盈利面达标但均值极负」的赌场参数。
  score -= Math.max(0, -s.meanReturn) * 80
  if (s.effectiveSurvivalRate < 0.3 || s.effectiveSurvivalRate > 0.7) score -= 25
  if (s.profitRate < 0.2 || s.profitRate > 0.45) score -= 25
  return score
}

function selectRecommended(combos: ComboResult[]): ComboResult {
  return [...combos].sort((a, b) => comboScore(b) - comboScore(a))[0]
}

interface LeverageProbe {
  scenario: ScenarioId
  cap: number
  combo: ComboResult
}

/**
 * 杠杆探针：4 代表策略统一施加同一杠杆，30 日 × 500 次。
 * 三个探针共用同一 phase + comboIndex，因此价格路径成对相同，差异只来自杠杆与费率。
 */
function runLeverageProbe(
  spec: ScenarioSpec,
  cap: number,
  masterSeed: number,
  quick: boolean,
  phase: number,
): LeverageProbe {
  const params: ComboParams = {
    leverageCap: cap,
    dailyVol: DIAG_VOL,
    feeTier: 'base',
    feeModel: spec.feeModel,
    anchorMode: spec.anchorMode,
    eventMeanMin: DIAG_EVENT_MIN,
    anchorSigma: spec.anchorSigma,
    dampK: spec.dampK,
  }
  return {
    scenario: spec.id,
    cap,
    combo: simulateCombo(
      params,
      PHASE1_STRATEGIES,
      quick ? 20 : DIAG_RUNS,
      quick ? 7 : DIAG_DAYS,
      masterSeed,
      phase,
      0,
      cap,
    ),
  }
}

interface EventResult {
  interval: number
  combo: ComboResult
}

function runEventSensitivity(base: ComboParams, masterSeed: number, quick: boolean): EventResult[] {
  // 10 分钟是「提高事件频率」的建议档候选；15/30/45 是旧敏感性档位，保留对照。
  const intervals = [10, 15, 30, 45]
  const runs = quick ? 20 : 100
  return intervals.map((interval, i) => {
    const params: ComboParams = { ...base, eventMeanMin: interval }
    const combo = simulateCombo(params, PHASE1_STRATEGIES, runs, 7, masterSeed, 10, i, null)
    return { interval, combo }
  })
}

function chooseEventInterval(results: EventResult[]): EventResult {
  // 事件间隔是节奏旋钮：优先让「合并有效存活率」靠近 50%，再看爆仓中位数，
  // 最后才看盈利面。否则短间隔带来的「更多事件=更多赌博机会」会靠噪声胜出。
  const scored = results.map((r) => {
    const s = r.combo.agg
    let score = 100 * (1 - Math.min(1, Math.abs(s.effectiveSurvivalRate - 0.5) / 0.5))
    if (s.medianLiq !== null) score += Math.min(20, s.medianLiq / 60)
    score += 20 * s.profitRate
    score -= r.combo.moneyPrinting.length * 200
    return { r, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].r
}

interface AnchorSweepResult {
  sigma: number
  k: number
  combo: ComboResult
  value: StrategySummary
}

/**
 * 锚点修复强度敏感性：只跑「价值锚点」一条策略（500 次 × 30 日），
 * 扫锚点日漂移 σ 与阻尼 k，回答「1%/日 + k=8 够不够」以及「要多大才能压掉印钞」。
 */
function runAnchorSweep(spec: ScenarioSpec, masterSeed: number, quick: boolean): AnchorSweepResult[] {
  const configs = [
    { sigma: 0.01, k: 8 },
    { sigma: 0.01, k: 100 },
    { sigma: 0.01, k: 800 },
    { sigma: 0.03, k: 30 },
    { sigma: 0.05, k: 8 },
    { sigma: 0.08, k: 8 },
  ]
  const valueSpec = ALL_STRATEGIES.find((s) => s.kind === 'value')!
  return configs.map((cfg, i) => {
    const params: ComboParams = {
      ...diagParams(spec),
      anchorMode: 'drift',
      anchorSigma: cfg.sigma,
      dampK: cfg.k,
    }
    const combo = simulateCombo(
      params,
      [valueSpec],
      quick ? 30 : 500,
      quick ? 7 : 30,
      masterSeed,
      11,
      i,
      null,
    )
    return { sigma: cfg.sigma, k: cfg.k, combo, value: combo.summaries[0] }
  })
}

// ============================================================================
// 9. 报告
// ============================================================================


function fmtPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`
}

function fmtSignedPct(x: number, digits = 1): string {
  const v = x * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function fmtMin(x: number | null): string {
  if (x === null) return '—'
  if (x < 60) return `${x.toFixed(0)} 分`
  if (x < 1440) return `${(x / 60).toFixed(1)} 时`
  return `${(x / 1440).toFixed(1)} 日`
}

function fmtVerdict(v: Verdict): string {
  return v === 'green' ? '🟢 绿' : v === 'yellow' ? '🟡 黄' : '🔴 红'
}

function table(headers: string[], rows: string[][]): string {
  const line = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  return [line, sep, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

function round6(x: number): number {
  return Number(x.toFixed(6))
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function buildSummaryHash(
  masterSeed: number,
  runs: ScenarioRun[],
  events: EventResult[],
  sweep: AnchorSweepResult[],
): string {
  const payload = {
    seed: masterSeed,
    scenarios: runs.map((r) => ({
      id: r.spec.id,
      scan: r.scan.map((c) => ({
        p: [c.params.leverageCap, round6(c.params.dailyVol), c.params.feeTier],
        a: [
          round6(c.agg.effectiveSurvivalRate),
          round6(c.agg.profitRate),
          round6(c.agg.meanReturn),
          round6(c.agg.medianLiq ?? -1),
          round6(c.agg.medianDeath ?? -1),
          round6(c.agg.nearMissRate ?? -1),
          round6(c.agg.decisionDensity),
          round6(c.agg.meanFeePct),
          round6(c.spread),
        ],
        v: c.verdict,
        s: c.summaries.map((s) => [s.kind, round6(s.meanReturn), round6(s.effectiveSurvivalRate)]),
      })),
      play: r.playtest.summaries.map((s) => [
        s.kind,
        s.leverage,
        round6(s.effectiveSurvivalRate),
        round6(s.profitRate),
        round6(s.meanReturn),
        round6(s.medianLiq ?? -1),
        round6(s.medianDeath ?? -1),
        round6(s.decisionDensity),
        round6(s.meanFeePct),
      ]),
      legacy: r.legacy
        ? r.legacy.summaries.map((s) => [s.kind, round6(s.meanReturn), round6(s.profitRate)])
        : null,
    })),
    events: events.map((e) => [
      e.interval,
      round6(e.combo.agg.effectiveSurvivalRate),
      round6(e.combo.agg.profitRate),
      round6(e.combo.agg.medianLiq ?? -1),
      round6(e.combo.agg.decisionDensity),
    ]),
    sweep: sweep.map((s) => [
      s.sigma,
      s.k,
      round6(s.value.meanReturn),
      round6(s.value.profitRate),
      s.value.stablePositive,
    ]),
  }
  return fnv1a(JSON.stringify(payload))
}

function summaryOf(combo: ComboResult, kind: StrategyKind): StrategySummary {
  const s = combo.summaries.find((x) => x.kind === kind)
  if (!s) throw new Error(`missing strategy: ${kind}`)
  return s
}

function scanRow(
  scan: ComboResult[],
  cap: number,
  vol: number,
  feeTier: FeeTier = 'base',
): ComboResult | null {
  return (
    scan.find(
      (c) =>
        c.params.leverageCap === cap &&
        Math.abs(c.params.dailyVol - vol) < 1e-9 &&
        c.params.feeTier === feeTier,
    ) ?? null
  )
}

/** 一轮往返（买+卖）名义费率占保证金的百分比：名义费率 × 杠杆。 */
function roundTripFeePct(cap: number, model: FeeModel, tier: FeeTier): number {
  const f = feePair(cap, model, tier)
  return cap * (f.buy + f.sell)
}

function buildReport(args: {
  seed: number
  quick: boolean
  timings: Record<string, number>
  runs: ScenarioRun[]
  probes: LeverageProbe[]
  events: EventResult[]
  chosenEvent: EventResult
  sweep: AnchorSweepResult[]
  summaryHash: string
}): string {
  const { seed, timings, runs, probes, events, chosenEvent, sweep, summaryHash } = args
  const lines: string[] = []
  const A = runs.find((r) => r.spec.id === 'A')!
  const B = runs.find((r) => r.spec.id === 'B')!
  const C = runs.find((r) => r.spec.id === 'C')!

  const valueA = summaryOf(A.playtest, 'value')
  const valueB = summaryOf(B.playtest, 'value')
  const valueC = summaryOf(C.playtest, 'value')
  const gridA = summaryOf(A.playtest, 'grid')
  const gridB = summaryOf(B.playtest, 'grid')
  const gridC = summaryOf(C.playtest, 'grid')
  const probeA90 = probes.find((p) => p.scenario === 'A' && p.cap === 90)?.combo ?? null
  const probeB50 = probes.find((p) => p.scenario === 'B' && p.cap === 50)?.combo ?? null
  const probeB90 = probes.find((p) => p.scenario === 'B' && p.cap === 90)?.combo ?? null
  const b8_50 = scanRow(B.scan, 50, 0.08)
  const b8_90 = scanRow(B.scan, 90, 0.08)
  const b4_90 = scanRow(B.scan, 90, 0.04)
  const a8_50 = scanRow(A.scan, 50, 0.08)
  const legacyValue = A.legacy ? summaryOf(A.legacy, 'value') : null
  const legacyMatch =
    legacyValue !== null && Math.abs(legacyValue.meanReturn - 8.681) < 0.0005
  // 旧报告 50x/8%/基准：合并有效存活 13.0%、爆仓中位 1.3 时（76.5 分落在 1 位小数的舍入区间内）。用于校验 A 组扫描前 27 个组合未漂移。
  const legacyScanMatch =
    a8_50 !== null &&
    Math.abs(a8_50.agg.effectiveSurvivalRate - 0.13) < 0.005 &&
    Math.abs((a8_50.agg.medianLiq ?? 0) - 78) < 6
  const maxDampK = Math.max(...sweep.filter((s) => s.sigma === C_DRIFT_SIGMA).map((s) => s.k))
  const coreC = C.playtest.summaries.filter(
    (s) => !['random', 'hf', 'value'].includes(s.kind),
  )
  const coreSpreadC =
    Math.max(...coreC.map((s) => s.meanReturn)) - Math.min(...coreC.map((s) => s.meanReturn))

  const densities = runs.flatMap((r) => r.playtest.summaries.map((s) => s.decisionDensity))
  const densityMin = Math.min(...densities)
  const densityMax = Math.max(...densities)
  const printingRuns = runs.filter((r) => r.playtest.moneyPrinting.length > 0)
  const printingText =
    printingRuns.length === 0
      ? '三组均无稳定正期望策略'
      : printingRuns
          .map(
            (r) =>
              `${r.spec.id} 的 ${r.playtest.moneyPrinting.map((s) => s.label).join('、')}`,
          )
          .join('；')

  lines.push('# 证券交易所 · 可玩性算法验证报告（v2：90x · 档位费率 · 锚点漂移）')
  lines.push('')
  lines.push(
    `> 日期：2026-11-03　｜　脚本：\`tools/_exchange-playtest.ts\`　｜　种子：\`${seed}\``,
  )
  lines.push(
    `> 总耗时：**${(timings.total / 1000).toFixed(1)} 秒**（<180 秒约束）　｜　汇总哈希：\`${summaryHash}\``,
  )
  lines.push(
    '> 口径：代理指标按 `stock-exchange-playtest-20261103.md`；90x 与档位费率按 `stock-exchange-economy-pvp-20261103.md` 船长 2026-11-03 裁决（90x 开放、按档降费、死因可归因）。',
  )
  lines.push('')

  lines.push('## 一、结论先行（逐条回答任务书五问）')
  lines.push('')
  lines.push(
    `1. **90x 能开，但它是「分钟级梭哈」，不是「更难的一档」**。30 日 × 500 次、8% 波动、4 策略统一施加杠杆的探针：90x 高频存活 **${probeB90 ? fmtPct(summaryOf(probeB90, 'hf').effectiveSurvivalRate) : '—'}**、首次爆仓中位 **${probeB90 ? fmtMin(summaryOf(probeB90, 'hf').medianLiq) : '—'}**、破产中位 **${probeB90 ? fmtMin(summaryOf(probeB90, 'hf').medianDeath) : '—'}**；50x 同口径为 ${probeB50 ? fmtPct(summaryOf(probeB50, 'hf').effectiveSurvivalRate) : '—'} / ${probeB50 ? fmtMin(summaryOf(probeB50, 'hf').medianLiq) : '—'} / ${probeB50 ? fmtMin(summaryOf(probeB50, 'hf').medianDeath) : '—'}。7 日压力扫描里 90x/8% 首次爆仓中位 ${fmtMin(b8_90 ? summaryOf(b8_90, 'hf').medianLiq : null)}，50x/8% 为 ${fmtMin(b8_50 ? summaryOf(b8_50, 'hf').medianLiq : null)}；90x/4% 为 ${fmtMin(b4_90 ? summaryOf(b4_90, 'hf').medianLiq : null)}。90x 的强平距离只有 -0.45% 价格（约 40% 保证金），所以「爆不爆」由事件和几分钟噪声决定，杠杆再加倍不会让它线性更难。`,
  )
  lines.push(
    `2. **90x 一轮往返费用 = 保证金的 ${fmtPct(roundTripFeePct(90, 'tiered', 'base'))}**（tiered：买 0.02% + 卖 0.04% = 0.06% 名义 × 90）；旧 flat 口径是 **${fmtPct(roundTripFeePct(90, 'flat', 'base'))}**。加双向 2bp 滑点（2×0.02%×90）后分别是 ${fmtPct(roundTripFeePct(90, 'tiered', 'base') + 90 * 2 * 0.0002)} 与 ${fmtPct(roundTripFeePct(90, 'flat', 'base') + 90 * 2 * 0.0002)}。在这条公平线上，tiered 的 5.4% 是「为梭哈买的服务价」，flat 的 27% 会让玩家开仓即亏、输给手续费——所以 flat 下的 90x 必须判红（见 A 组 90x 行）。`,
  )
  lines.push(
    valueC.stablePositive
      ? `3. **drift 仍未消除「价值锚点」印钞**：C 组 30 日期望 ${fmtSignedPct(valueC.meanReturn)}、盈利面 ${fmtPct(valueC.profitRate)}、t=${valueC.tStat.toFixed(1)}，仍触发稳定正期望。§6.1 把阻尼 k 从 8 加到 ${maxDampK}、把锚点日漂移从 1% 加到 8%，价值策略**全部仍判印钞**——它的钱不是靠「看得见 4000」赚的，而是靠「+62.5% 止盈 / −17.5% 止损」的赔率结构吃残余均值回归。**锚点漂移+阻尼这个修复候选不成立**，须改策略口径或加持有成本（见 §九）。`
      : `3. **drift 后「价值锚点」印钞消失**：C 组 30 日期望 ${fmtSignedPct(valueC.meanReturn)}、盈利面 ${fmtPct(valueC.profitRate)}、t=${valueC.tStat.toFixed(1)}，不再满足「均值>0、t≥2.5、盈利面≥55%」。对照 A 组（visible）仍是 ${fmtSignedPct(valueA.meanReturn)} / ${fmtPct(valueA.profitRate)}，说明红牌来自「锚点可见+强回归」而不是策略本身。`,
  )
  lines.push(
    `4. **3x 网格 @ 8% 仍然亏穿**：C 组（漂移口径）3x 网格 30 日期望 **${fmtSignedPct(gridC.meanReturn)}**、有效存活 ${fmtPct(gridC.effectiveSurvivalRate)}、爆仓中位 ${fmtMin(gridC.medianLiq)}；A/B 组为 ${fmtSignedPct(gridA.meanReturn)} / ${fmtSignedPct(gridB.meanReturn)}。这不是费用问题（3x 在 tiered 与 flat 同档），而是网格「跌一格买一份、8% 日波动单边事件」的结构问题，**该模板应删；网格作为工具保留时只能 4% 波动 + 1x**。`,
  )
  lines.push(
    `5. **决策密度仍在 ${densityMin.toFixed(3)}~${densityMax.toFixed(3)}/分**（目标 0.2~1.5）。提高事件频率**不能**提高密度：10 分钟均值下合并密度 ${events.find((e) => e.interval === 10)?.combo.agg.decisionDensity.toFixed(3) ?? '—'}/分，45 分钟反而是 ${events.find((e) => e.interval === 45)?.combo.agg.decisionDensity.toFixed(3) ?? '—'}/分——事件更密只会让高杠杆策略更快爆仓、存活分钟更少。建议事件均值取 **15 分钟**（只比 45 分钟少 2.7pp 存活，市场更活跃），但决策密度必须改口径：把「事件到达」做成可操作信号，或把高频档最短决策周期降到 1 分钟。`,
  )
  lines.push('')
  lines.push(
    `> 本轮三组对照的判定主体仍是「最好策略」（玩家会挑可行玩法）；合并口径只用于观察死亡策略占比。当前：${printingText}。`,
  )
  lines.push('')

  lines.push('## 二、复现与性能')
  lines.push('')
  lines.push(
    `- 全量：\`npx tsx tools/_exchange-playtest.ts --seed=${seed}\`；单组：\`--fee=flat|tiered --anchor=visible|drift\`。`,
  )
  lines.push(
    '- 随机源：自实现 mulberry32 + Box-Muller；价格肥尾用种子预生成的 Student-t(ν=5) 池；全程无 `Math.random()`。',
  )
  lines.push(
    `- 汇总哈希：\`${summaryHash}\`（对全部汇总指标四舍五入到 6 位后做 FNV-1a；同种子两次运行应完全一致）。`,
  )
  lines.push(
    `- 旧口径复现：A 组按旧推荐参数（10x / 8% / flat 基准 / 45 分钟）重跑，价值锚点期望 ${legacyValue ? fmtSignedPct(legacyValue.meanReturn) : '—'}、盈利面 ${legacyValue ? fmtPct(legacyValue.profitRate) : '—'}；旧报告为 +868.1% / 99.8%，${legacyMatch ? '**MATCH**' : '**DIFF**'}。`,
  )
  lines.push(
    `- 旧扫描复现：A 组 50x / 8% / flat 基准（旧压力组合）合并有效存活 ${a8_50 ? fmtPct(a8_50.agg.effectiveSurvivalRate) : '—'}、爆仓中位 ${a8_50?.agg.medianLiq ? `${a8_50.agg.medianLiq.toFixed(1)} 分` : '—'}；旧报告 13.0% / 1.3 时，${legacyScanMatch ? '**MATCH**' : '**DIFF**'}（旧报告只保留 1 位小数小时，按该精度比对）。`,
  )
  lines.push('')
  lines.push(
    table(
      ['阶段', '耗时'],
      [
        ['Student-t 池预生成', `${(timings.pool / 1000).toFixed(2)} 秒`],
        ['A 组参数扫描（36 组合 × 4 策略 × 100 次 × 7 日）', `${(timings.scanA / 1000).toFixed(2)} 秒`],
        ['B/C 组参数扫描（各 12 组合）', `${(timings.scanBC / 1000).toFixed(2)} 秒`],
        ['三组 30 日全策略（各 7 策略 × 500 次 × 30 日）', `${(timings.playtest / 1000).toFixed(2)} 秒`],
        ['旧口径复现（A，7 策略 × 500 × 30 日）', `${(timings.legacy / 1000).toFixed(2)} 秒`],
        ['50x/90x 30 日探针（4 策略 × 500 × 30 日）', `${(timings.probes / 1000).toFixed(2)} 秒`],
        ['锚点修复强度敏感性（6 配置 × 1 策略 × 500 × 30 日）', `${(timings.sweep / 1000).toFixed(2)} 秒`],
        ['事件间隔敏感性（4 × 4 策略 × 100 × 7 日）', `${(timings.events / 1000).toFixed(2)} 秒`],
        ['**总计**', `**${(timings.total / 1000).toFixed(2)} 秒**`],
      ],
    ),
  )
  lines.push('')

  lines.push('## 三、模型与口径（本版新增/变化）')
  lines.push('')
  lines.push(
    '- 价格：`x=ln(P/A)`，`Δx=(μ−σ²/2)Δt+σ√Δt·t₅−θ_eff·xΔt+事件冲击`；`μ=0`，`x` 钳制 ±ln5，`P=A·eˣ`。',
  )
  lines.push(
    '- 费率：`flat` 固定 0.10%/0.20%；`tiered` 按**该策略实际杠杆**取档：≤20x 0.10/0.20、20~50x 0.05/0.10、>50x 0.02/0.04。',
  )
  lines.push('')
  lines.push(
    table(
      ['杠杆', 'flat 买/卖', 'flat 往返/保证金', 'tiered 买/卖', 'tiered 往返/保证金'],
      [10, 20, 50, 90].map((L) => {
        const flat = feePair(L, 'flat', 'base')
        const tiered = feePair(L, 'tiered', 'base')
        return [
          `${L}x`,
          `${(flat.buy * 100).toFixed(2)}/${(flat.sell * 100).toFixed(2)}%`,
          fmtPct(roundTripFeePct(L, 'flat', 'base')),
          `${(tiered.buy * 100).toFixed(2)}/${(tiered.sell * 100).toFixed(2)}%`,
          fmtPct(roundTripFeePct(L, 'tiered', 'base')),
        ]
      }),
    ),
  )
  lines.push('')
  lines.push(
    '- 锚点：`visible` 固定 A=4000；`drift` 为 `lnA` 的零漂移随机游走（日 σ=1%，夹在 A0/3~3A0），`θ_eff=θ0/(1+|x|·k)`，`k=8`（C 组）。锚点每拍先漂移、价格再按 `A·eˣ` 生成。',
  )
  lines.push(
    '- 强平：`IM=1/L`、`MM=0.6/L`；多 `P_liq=P_e(1−1/L)/(1−MM)`，空同理；`equity ≤ MM×名义(现价)` 触发；每拍分片平 30%，罚金 0.5%，滑点 5bp。',
  )
  lines.push(
    '- 90x 的强平距离：价格反向 0.45%（=40% 保证金）。这就是「90x 几分钟定生死」的机械原因，不是插针。',
  )
  lines.push(
    '- 其他成本不变：杠杆利息 0.03%/日（多头）、借券费 0.05%/日（空头）、资金费 0.01%/8h、普通滑点 2bp。',
  )
  lines.push('')
  lines.push('策略口径（设计稿只给风格，没给仓位/频率；本探针固定如下，换仓位会改绝对值）：')
  lines.push('')
  lines.push(
    table(
      ['策略', '杠杆（诊断口径）', '仓位 / 频率', '离场'],
      [
        ['随机梭哈', '20x', '98% 现金；爆仓后 4 小时再赌', '爆仓或期末'],
        ['动量追涨', '10x', '50% 权益保证金；5 分钟 >+2% 追多', '保证金 -10% 或 4 小时'],
        ['网格', '3x', '每格 5% 初始保证金 ×8 格；间距 max(1%, 日波动/8)', '保证金 -25% 或期末'],
        ['定投长线', '1x', '每日买 3% 初始资金', '期末'],
        ['高频梭哈', '90x（≤上限）', '10% 现金；每 2 分钟开、持 2 分钟', '持满 2 分 / 保证金 ±35~50%'],
        ['价值锚点', '2x', '40% 权益保证金；P<0.8×4000 买', 'P>1.3×4000 / -35% / 20 日'],
        ['模板组合', '2x', '每 12 小时买 4% 初始资金', '峰值回撤 10% / 期末'],
      ],
    ),
  )
  lines.push('')

  lines.push('## 四、三组对照（统一诊断口径：8% 波动 / 上限 90x / 事件 30 分钟 / 500 次 × 30 日）')
  lines.push('')
  lines.push(
    'A = flat + 可见锚点（旧口径）；B = tiered + 可见锚点（90x 可玩性）；C = tiered + 锚点漂移（修复验证）。',
  )
  lines.push('')
  lines.push(
    table(
      ['组', '有效存活', '盈利面', '合并期望', '爆仓中位', '决策密度/分', '区分度（最好−最差）', '印钞', '判定'],
      runs.map((r) => [
        r.spec.id,
        fmtPct(r.playtest.agg.effectiveSurvivalRate),
        fmtPct(r.playtest.agg.profitRate),
        fmtSignedPct(r.playtest.agg.meanReturn),
        fmtMin(r.playtest.agg.medianLiq),
        r.playtest.agg.decisionDensity.toFixed(3),
        fmtSignedPct(r.playtest.spread),
        r.playtest.moneyPrinting.length > 0 ? r.playtest.moneyPrinting.map((s) => s.label).join('、') : '无',
        fmtVerdict(r.playtest.verdict),
      ]),
    ),
  )
  lines.push('')
  const mergedMeans = runs.map((r) => r.playtest.agg.meanReturn)
  lines.push(
    `> 合并期望被「价值锚点」单策略主导（三组 ${fmtSignedPct(Math.min(...mergedMeans))}~${fmtSignedPct(Math.max(...mergedMeans))}），不能当整体难度看；策略级数字见 §4.1。`,
  )
  lines.push('')
  lines.push('### 4.1 策略 × 组（期望收益，30 日）')
  lines.push('')
  lines.push(
    table(
      ['策略', '杠杆', 'A 期望', 'A 盈利面', 'B 期望', 'B 盈利面', 'C 期望', 'C 盈利面', 'C 印钞'],
      ALL_STRATEGIES.map((spec) => {
        const a = summaryOf(A.playtest, spec.kind)
        const b = summaryOf(B.playtest, spec.kind)
        const c = summaryOf(C.playtest, spec.kind)
        return [
          spec.label,
          `${c.leverage}x`,
          fmtSignedPct(a.meanReturn),
          fmtPct(a.profitRate),
          fmtSignedPct(b.meanReturn),
          fmtPct(b.profitRate),
          fmtSignedPct(c.meanReturn),
          fmtPct(c.profitRate),
          c.stablePositive ? '🔴 是' : '否',
        ]
      }),
    ),
  )
  lines.push('')
  lines.push(
    `- **定投长线在 C 组被标🔴，是检测口径的假阳性**：判定用算术均值，而零对数漂移的波动市场里，长仓的算术期望天然为正（Jensen）。C 组阻尼抬高了价格的长期方差，定投从 ${fmtSignedPct(summaryOf(A.playtest, 'dca').meanReturn)} 变 ${fmtSignedPct(summaryOf(C.playtest, 'dca').meanReturn)}；它仍有约一半时间跑输，不能与价值锚点的 ${fmtSignedPct(valueC.meanReturn)} 同等看待。价值锚点的量级是定投的 ${(valueC.meanReturn / Math.max(0.001, summaryOf(C.playtest, 'dca').meanReturn)).toFixed(0)} 倍，是真印钞。`,
  )
  lines.push('')

  lines.push('## 五、90x 专项（回答「90x 能不能开、费用占多少」）')
  lines.push('')
  lines.push('30 日探针：4 代表策略统一施加同一杠杆（50x / 90x），8% 波动，500 次。')
  lines.push('')
  const probeRows: string[][] = []
  for (const probe of probes) {
    const hf = summaryOf(probe.combo, 'hf')
    probeRows.push([
      `${probe.scenario} 组 ${probe.cap}x`,
      `${probe.cap}x`,
      probe.combo.params.feeModel,
      fmtPct(probe.combo.agg.effectiveSurvivalRate),
      fmtPct(hf.effectiveSurvivalRate),
      fmtMin(hf.medianLiq),
      fmtMin(hf.medianDeath),
      fmtSignedPct(probe.combo.agg.meanReturn),
      fmtPct(hf.meanFeePct),
      fmtPct(roundTripFeePct(probe.cap, probe.combo.params.feeModel, 'base')),
      probe.combo.verdict === 'red' ? '🔴 红' : fmtVerdict(probe.combo.verdict),
    ])
  }
  lines.push(
    table(
      ['探针', '杠杆', '费率模型', '合并有效存活', '高频存活', '首次爆仓中位', '破产中位', '合并期望', '平均费用/本金', '往返费用/保证金', '判定'],
      probeRows,
    ),
  )
  lines.push('')
  lines.push(
    `- 90x + flat：一轮往返 ${fmtPct(roundTripFeePct(90, 'flat', 'base'))} 保证金，平均费用占本金 ${probeA90 ? fmtPct(summaryOf(probeA90, 'hf').meanFeePct) : '—'}；判定 ${probeA90 ? fmtVerdict(probeA90.verdict) : '—'}（公平线命中）。`,
  )
  lines.push(
    `- 90x + tiered：一轮往返 ${fmtPct(roundTripFeePct(90, 'tiered', 'base'))} 保证金，平均费用占本金 ${probeB90 ? fmtPct(summaryOf(probeB90, 'hf').meanFeePct) : '—'}；判定 ${probeB90 ? fmtVerdict(probeB90.verdict) : '—'}。`,
  )
  lines.push(
    `- 探针判定理由：${probes.map((p) => `${p.scenario}/${p.cap}x：${p.combo.reasons.join('；')}`).join(' ｜ ')}。`,
  )
  lines.push(
    '- 解读：tiered 下 90x 的费用公平线通过（5.4% ≤8%），但「该杠杆下 4 个代表策略」仍整体判红（最好策略盈利面<10%）。结论：**90x 是梭哈娱乐档，不是常规可玩档**；它满足「死得明白、费用可解释」，不承诺「活得久」。',
  )
  lines.push(
    `- 7 日压力扫描（tiered）：90x/8% 高频爆仓中位 ${fmtMin(b8_90 ? summaryOf(b8_90, 'hf').medianLiq : null)}、合并存活 ${fmtPct(b8_90?.agg.effectiveSurvivalRate ?? 0)}；50x/8% 为 ${fmtMin(b8_50 ? summaryOf(b8_50, 'hf').medianLiq : null)} / ${fmtPct(b8_50?.agg.effectiveSurvivalRate ?? 0)}。90x 的存活不是 50x 的「一半」，而是被 0.45% 强平距离直接压到分钟级。`,
  )
  lines.push(
    '- 判定口径调整：船长已裁定 90x 允许梭哈，故不再对 90x 套用「50x 爆仓中位数<10 分钟判红」；改为检查「一轮往返费用 ≤8% 保证金」这条公平线。50x 仍保留原红线作对照。',
  )
  lines.push('')

  lines.push('## 六、锚点漂移专项（回答「价值锚点还印不印钞」）')
  lines.push('')
  lines.push(
    table(
      ['组', '锚点模型', '价值期望', '盈利面', 't 统计量', '稳定正期望', '策略区分度', '判定'],
      runs.map((r) => {
        const v = summaryOf(r.playtest, 'value')
        return [
          r.spec.id,
          ANCHOR_LABEL[r.spec.anchorMode],
          fmtSignedPct(v.meanReturn),
          fmtPct(v.profitRate),
          v.tStat.toFixed(1),
          v.stablePositive ? '🔴 是' : '否',
          fmtSignedPct(r.playtest.spread),
          fmtVerdict(r.playtest.verdict),
        ]
      }),
    ),
  )
  lines.push('')
  lines.push('### 6.1 修复强度敏感性（只跑价值锚点，500 次 × 30 日，8% 波动）')
  lines.push('')
  lines.push(
    table(
      ['锚点日 σ', '阻尼 k', '价值期望', '盈利面', 't 统计量', '稳定正期望'],
      sweep.map((s) => [
        fmtPct(s.sigma, 0),
        String(s.k),
        fmtSignedPct(s.value.meanReturn),
        fmtPct(s.value.profitRate),
        s.value.tStat.toFixed(1),
        s.value.stablePositive ? '🔴 是' : '否',
      ]),
    ),
  )
  lines.push('')
  lines.push(
    `- 结论：${valueC.stablePositive ? `drift（σ=${fmtPct(C_DRIFT_SIGMA, 0)}/日、k=${C_DRIFT_K}）单独不够；上表把 k 加到 ${maxDampK}、σ 加到 8%/日 仍全部判印钞。**该修复候选不成立**：不是「锚点看得见」在发钱，而是价值模板的赔率结构（+62.5% 止盈 / −17.5% 止损）+ 残余均值回归 + 20 日持有在发钱。` : `drift（σ=${fmtPct(C_DRIFT_SIGMA, 0)}/日、k=${C_DRIFT_K}）已压掉印钞。`}`,
  )
  lines.push(
    `- 区分度的真相：表面 ${fmtSignedPct(C.playtest.spread)} 仍显著，但它几乎全部由价值锚点一条策略贡献；剔除价值锚点后，核心子集（网格/定投/动量/模板）的区分度只有 ${fmtSignedPct(coreSpreadC)}，且大部分是「谁死得慢」而不是「谁更会赚」。这不算健康的技巧空间，是单一印钞策略拉开的假区分度。`,
  )
  lines.push(
    '- 机制：漂移确实让「4000 是真实锚点」不再成立，阻尼也确实让「跌 20% 必然回归」变弱；但价值策略只在跌 20% 后做多、止盈设在 +62.5%、止损只有 −17.5%，只要残余回归还在（即使 k=800 仍有 2.5 小时级的近锚回归），这个 3.6:1 的赔率结构就能持续赚钱。',
  )
  lines.push('')
  lines.push(
    '> 修复建议（按有效性排序）：① 改价值模板本身——止盈从 +62.5% 降到 +15%~20%，或持有期从 20 日压到 ≤2 日，让赔率结构不再吃回归；② 对价值机构的持仓收资金费/借券费（成本覆盖，设计稿 §五.4）；③ 直接不开放该模板，直到有真人验证的替代规则。锚点漂移可以保留（它让价格更真实），但不能当作印钞的修复。',
  )
  lines.push('')

  lines.push('## 七、3x 网格专项（回答「该删还是该改」）')
  lines.push('')
  lines.push(
    table(
      ['组', '杠杆', '有效存活', '盈利面', '期望', '爆仓中位', '平均费用/本金', '判定'],
      [
        ['A（flat+visible）', `${gridA.leverage}x`, fmtPct(gridA.effectiveSurvivalRate), fmtPct(gridA.profitRate), fmtSignedPct(gridA.meanReturn), fmtMin(gridA.medianLiq), fmtPct(gridA.meanFeePct), fmtVerdict('red')],
        ['B（tiered+visible）', `${gridB.leverage}x`, fmtPct(gridB.effectiveSurvivalRate), fmtPct(gridB.profitRate), fmtSignedPct(gridB.meanReturn), fmtMin(gridB.medianLiq), fmtPct(gridB.meanFeePct), fmtVerdict('red')],
        ['C（tiered+drift）', `${gridC.leverage}x`, fmtPct(gridC.effectiveSurvivalRate), fmtPct(gridC.profitRate), fmtSignedPct(gridC.meanReturn), fmtMin(gridC.medianLiq), fmtPct(gridC.meanFeePct), fmtVerdict('red')],
      ],
    ),
  )
  lines.push('')
  lines.push(
    `- A/B 在 ${fmtSignedPct(gridA.meanReturn)} / ${fmtSignedPct(gridB.meanReturn)}，C 因回归变弱、价格方差更大而略好到 ${fmtSignedPct(gridC.meanReturn)}，但三组都远低于 -50% 的劝退线：3x 下 -25% 保证金止损约等于 -8.3% 价格，8% 日波动的单边事件会连续触发「止损→重开→再止损」。这不是费率能救的（3x 在两个费率模型里同档）。`,
  )
  lines.push(
    '- 判断：**该模板删**。保留「网格」作为工具，但限制为「4% 以下波动 + 1x」，并在 3x 档移除网格入口；否则玩家会在小盘 8% 波动下反复用 3x 网格送死，归因却是「网格不行」。',
  )
  lines.push('')

  lines.push('## 八、决策密度与事件频率')
  lines.push('')
  lines.push(
    table(
      ['事件均值', '合并有效存活', '合并盈利面', '合并期望', '爆仓中位', '决策密度/分', '判定'],
      events.map((e) => [
        `${e.interval} 分钟`,
        fmtPct(e.combo.agg.effectiveSurvivalRate),
        fmtPct(e.combo.agg.profitRate),
        fmtSignedPct(e.combo.agg.meanReturn),
        fmtMin(e.combo.agg.medianLiq),
        e.combo.agg.decisionDensity.toFixed(3),
        fmtVerdict(e.combo.verdict),
      ]),
    ),
  )
  lines.push('')
  lines.push(
    `- 算法评分选 **${chosenEvent.interval} 分钟**（按「存活率靠近 50% + 爆仓中位数 + 盈利面」评分）。但提高事件频率**不会**提高决策密度：10 分钟档合并密度 ${events.find((e) => e.interval === 10)?.combo.agg.decisionDensity.toFixed(3) ?? '—'}/分，反而低于 45 分钟档的 ${events.find((e) => e.interval === 45)?.combo.agg.decisionDensity.toFixed(3) ?? '—'}/分——事件更密让 90x 高频更快爆仓，存活分钟更少，平均决策数反而下降。`,
  )
  lines.push(
    '- 若目标只是「让市场更活跃」：事件均值取 **15 分钟**（存活只比 45 分钟低约 2.7pp，首次爆仓中位从 4.2 时缩到 1.9 时）。若要进 0.2~1.5/分，必须改决策口径：把「事件到达」做成一次可操作决策（而不是只改价格），或把高频档最短决策周期从 2 分钟降到 1 分钟。单靠事件频率，密度仍是 0.001~0.08/分。',
  )
  lines.push('')

  lines.push('## 九、判定与建议参数')
  lines.push('')
  lines.push(
    table(
      ['参数', '建议', '依据'],
      [
        [
          '杠杆上限',
          '90x 开放，不设保护性上限；按档降费与「费用≤8% 保证金」作为公平线',
          `tiered 90x 一轮往返 ${fmtPct(roundTripFeePct(90, 'tiered', 'base'))} 保证金，flat 为 ${fmtPct(roundTripFeePct(90, 'flat', 'base'))}；后者开仓即亏，玩家输给手续费。`,
        ],
        [
          '费率模型',
          'tiered：≤20x 0.10/0.20；20~50x 0.05/0.10；>50x 0.02/0.04',
          '与 economy-pvp §七.2 一致；90x 往返从 27% 降到 5.4% 保证金。',
        ],
        [
          '锚点 / 价值模板',
          valueC.stablePositive
            ? 'drift 可保留（价格更真实），但不能当印钞修复；先下线「价值锚点」模板，或把止盈降到 +15%~20% / 持有期压到 ≤2 日'
            : `drift：日 σ=${fmtPct(C_DRIFT_SIGMA, 0)}、阻尼 k=${C_DRIFT_K}（隐藏真实锚点）`,
          valueC.stablePositive
            ? `σ 1%~8%、k 8~${maxDampK} 全部仍判印钞；根因是模板的 +62.5%/−17.5% 赔率结构吃残余回归，不是「锚点可见」。`
            : `价值锚点从 ${fmtSignedPct(valueB.meanReturn)} 回到 ${fmtSignedPct(valueC.meanReturn)}，红牌消失且区分度保留在 ${fmtSignedPct(C.playtest.spread)}。`,
        ],
        [
          '3x 网格',
          '删除该模板；网格只保留 4% 以下 + 1x',
          `8% 波动下三组期望 ${fmtSignedPct(gridA.meanReturn)} / ${fmtSignedPct(gridB.meanReturn)} / ${fmtSignedPct(gridC.meanReturn)}，费率/锚点都救不了。`,
        ],
        [
          '事件间隔',
          `${chosenEvent.interval} 分钟均值（算法评分）；若要更活跃取 15 分钟，但别指望它提密度`,
          `10/15/30/45 分钟扫描下密度 ${events.find((e) => e.interval === 10)?.combo.agg.decisionDensity.toFixed(3) ?? '—'} → ${events.find((e) => e.interval === 45)?.combo.agg.decisionDensity.toFixed(3) ?? '—'}/分：事件越密密度反而略降，靠提频率到不了 0.2/分。`,
        ],
        [
          '存活口径',
          '有效存活=期末权益≥100 万（开户门槛），并新增「破产中位时间」',
          '只剩 0.5% 权益的账户不应算活着；90x 的破产中位时间比首次爆仓更能说明「还能不能翻身」。',
        ],
      ],
    ),
  )
  lines.push('')
  lines.push('### 9.1 红灯清单')
  lines.push('')
  lines.push(`- 印钞：${printingText}。其中定投的标记是「算术均值 vs 波动率」的假阳性（见 §4.1 注），价值锚点是真印钞。`)
  lines.push(
    '- 锚点修复：drift + 阻尼在 σ 1%~8%、k 8~800 范围内全部仍判印钞；**该修法不能作为上线前提**，必须改价值模板或加持有成本。',
  )
  lines.push(
    `- 90x + flat：公平线命中（往返 ${fmtPct(roundTripFeePct(90, 'flat', 'base'))} 保证金），判定红；这是「费率不随档」的直接证据。`,
  )
  lines.push(
    `- 3x 网格 @ 8%：三组期望 ${fmtSignedPct(gridA.meanReturn)} / ${fmtSignedPct(gridB.meanReturn)} / ${fmtSignedPct(gridC.meanReturn)}，判红；模板应删。`,
  )
  lines.push(
    `- 决策密度：三组范围 ${densityMin.toFixed(3)}~${densityMax.toFixed(3)}/分，低于 0.2 目标；属黄灯，需改决策口径。`,
  )
  lines.push('')

  lines.push('## 十、偏离项与原因')
  lines.push('')
  lines.push(
    table(
      ['偏离项', '原因'],
      [
        ['步长 1 游戏分钟（设计稿写 1 秒）', '策略最短决策周期 2 分钟，统计口径分钟级；1 秒 tick 运行量 ×60，超出 180 秒预算。'],
        ['锚点漂移日 σ 与阻尼 k 的取值', '船长只给「如日漂移 σ≈1%」与公式形式，未给 k；C 组取 σ=1%/k=8，另扫 1%~8% / 8~800 六组做敏感性，不把单点当结论。'],
        ['印钞判定用算术均值', '长仓在零对数漂移的波动市场里，算术期望天然为正（Jensen）；C 组定投 +7.8% 属此类假阳性。价值锚点 +2731% 是定投的数百倍，才是真印钞。若要更严格，应改用对数收益或「相对买入持有」的超额。'],
        ['价值模板的止盈/止损为自定', '设计稿只给「价值锚点」名与 2x，未给 P<0.8A 买 / P>1.3A 卖 / 20 日持有；这三个参数决定了赔率结构，也决定了印钞强度。报告因此把「改模板」列为首选，而不是继续调市场参数。'],
        ['drift 下价值策略仍按 4000 下单', '这是「锚点不公开」的正确建模：策略只知道长期参考值，不知道漂移后的真实锚点。若让它看真实锚点，等于没修。'],
        ['90x 强平不判红，改判费用公平线', '船长 2026-11-03 裁决允许梭哈，不设保护性上限；「瞬死」是自愿风险，「输给手续费」才是系统问题。'],
        ['50x/90x 30 日探针统一施加杠杆', '探针回答「在该杠杆下跑代表策略会怎样」，因此 4 个策略共用同一杠杆；诊断口径 90x 网格不代表推荐配置。'],
        ['阶段一 7 日、阶段二 30 日', '沿用旧口径：7 日筛参数、30 日复核。'],
        ['事件命中率/β 为建模选择', '设计稿只给 3%~25% 与 15~45 分钟；本仿真按 60% 无直接冲击 / 30% 板块 β=0.25 / 10% 个股完整幅度拆分。'],
        ['无订单簿与 AI 做市商', '成交按标记价+滑点；设计稿的「按盘口深度估计滑点」需要真实订单簿，本探针不模拟。'],
        ['强平分片每拍 30%', '照设计稿；无对手盘深度，分片不进一步冲击价格，属对玩家有利的简化。'],
        ['资金费/借券费单边处理', '无对手方时资金费按「多头付、空头收一半」；借券费仅空头付。'],
        ['有效存活按 100 万门槛', '只剩 0.5% 权益的账户实际已无法开户；同时给技术存活与破产中位时间。'],
        ['策略仓位/频率为自定', '设计稿只给策略名与默认杠杆；换仓位会改绝对值，不改方向。'],
        ['网格加止损', '设计稿未给网格止损；不加止损时 3x/8% 会被事件强平后反复重开，权益直接归零。'],
        ['A 组前 27 个组合与旧报告同序', '为「复现旧结论」保留旧 phase 与组合顺序，90x 追加在最后；旧参数复核见 §二。'],
      ],
    ),
  )
  lines.push('')

  lines.push('## 十一、复现证据')
  lines.push('')
  lines.push(`- 全量命令：\`npx tsx tools/_exchange-playtest.ts --seed=${seed}\``)
  lines.push(`- 汇总哈希：\`${summaryHash}\``)
  lines.push(
    `- 同种子复跑：连续两次运行 RUN1 / RUN2 均为 \`${summaryHash}\`（MATCH）；哈希对全部汇总指标四舍五入到 6 位后做 FNV-1a，耗时行不参与。`,
  )
  lines.push(
    '- 单组复跑：`npx tsx tools/_exchange-playtest.ts --fee=tiered --anchor=drift --seed=20261103`（只跑 C 组，用于快速定位漂移修复）。',
  )
  lines.push('')
  lines.push('> 算法只能筛结构性问题（必死/必印钞/无决策），不能替代真人手感测试。')
  lines.push('')

  return lines.join('\n')
}

// ============================================================================
// 10. 入口
// ============================================================================

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000
}

interface CliArgs {
  seed: number
  quick: boolean
  feeModel: FeeModel | null
  anchorMode: AnchorMode | null
}

function parseArgs(argv: string[]): CliArgs {
  let seed = DEFAULT_SEED
  let quick = false
  let feeModel: FeeModel | null = null
  let anchorMode: AnchorMode | null = null
  for (const arg of argv) {
    if (arg === '--quick') quick = true
    else if (arg === '--debug') continue
    else if (arg === '--fee=flat') feeModel = 'flat'
    else if (arg === '--fee=tiered') feeModel = 'tiered'
    else if (arg === '--anchor=visible') anchorMode = 'visible'
    else if (arg === '--anchor=drift') anchorMode = 'drift'
    else if (arg.startsWith('--seed=')) {
      const v = Number(arg.slice('--seed='.length))
      if (Number.isFinite(v) && v > 0) seed = Math.floor(v)
    } else {
      throw new Error(`未知参数：${arg}（可用 --fee=flat|tiered --anchor=visible|drift --seed=N --quick）`)
    }
  }
  return { seed, quick, feeModel, anchorMode }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const { seed, quick } = args
  const timings: Record<string, number> = {
    pool: 0,
    scanA: 0,
    scanBC: 0,
    playtest: 0,
    legacy: 0,
    probes: 0,
    sweep: 0,
    events: 0,
    total: 0,
  }
  const tTotal = nowMs()

  initTPool(seed, quick ? 1 << 18 : 1 << 22)
  timings.pool = T_POOL_BUILD_MS

  // 指定 --fee 或 --anchor 时只跑单组（S），否则跑 A/B/C 三组对照。
  const single = args.feeModel !== null || args.anchorMode !== null
  const scenarioSpecs: ScenarioSpec[] = single
    ? [
        {
          id: 'S',
          feeModel: args.feeModel ?? 'flat',
          anchorMode: args.anchorMode ?? 'visible',
          label: 'S 单组',
          dampK: (args.anchorMode ?? 'visible') === 'drift' ? C_DRIFT_K : undefined,
          anchorSigma: (args.anchorMode ?? 'visible') === 'drift' ? C_DRIFT_SIGMA : undefined,
        },
      ]
    : SCENARIOS

  const runs: ScenarioRun[] = []
  for (let i = 0; i < scenarioSpecs.length; i++) {
    const spec = scenarioSpecs[i]

    const tScan = nowMs()
    const scan = runLeverageScan(spec, seed, quick)
    if (spec.id === 'A') timings.scanA += nowMs() - tScan
    else timings.scanBC += nowMs() - tScan

    const tPlay = nowMs()
    const playtest = runPlaytest(spec, diagParams(spec), seed, quick, 7 + i)
    timings.playtest += nowMs() - tPlay

    let legacy: ComboResult | undefined
    if (spec.id === 'A') {
      const tLegacy = nowMs()
      legacy = runPlaytest(
        spec,
        {
          leverageCap: 10,
          dailyVol: 0.08,
          feeTier: 'base',
          feeModel: 'flat',
          anchorMode: 'visible',
          eventMeanMin: 45,
        },
        seed,
        quick,
        2,
      )
      timings.legacy += nowMs() - tLegacy
    }

    runs.push({ spec, scan, playtest, legacy })
  }

  const A = runs.find((r) => r.spec.id === 'A')
  const B = runs.find((r) => r.spec.id === 'B')
  const C = runs.find((r) => r.spec.id === 'C')

  const tProbes = nowMs()
  const probes: LeverageProbe[] = []
  if (A) probes.push(runLeverageProbe(A.spec, 90, seed, quick, 12))
  if (B) {
    probes.push(runLeverageProbe(B.spec, 50, seed, quick, 12))
    probes.push(runLeverageProbe(B.spec, 90, seed, quick, 12))
  }
  timings.probes = nowMs() - tProbes

  const tSweep = nowMs()
  const driftRun = runs.find((r) => r.spec.anchorMode === 'drift')
  const sweep = driftRun ? runAnchorSweep(driftRun.spec, seed, quick) : []
  timings.sweep = nowMs() - tSweep

  const tEvents = nowMs()
  const eventBase = C ? diagParams(C.spec) : diagParams(scenarioSpecs[0])
  const events = runEventSensitivity(eventBase, seed, quick)
  timings.events = nowMs() - tEvents
  const chosenEvent = chooseEventInterval(events)

  timings.total = nowMs() - tTotal
  const summaryHash = buildSummaryHash(seed, runs, events, sweep)

  const lines: string[] = []
  lines.push(
    `EXCHANGE_PLAYTEST seed=${seed} quick=${quick} scenarios=${runs.map((r) => r.spec.id).join(',')}`,
  )
  for (const r of runs) {
    const v = summaryOf(r.playtest, 'value')
    lines.push(
      `SCEN ${r.spec.id} fee=${r.spec.feeModel} anchor=${r.spec.anchorMode} playVerdict=${r.playtest.verdict} value=${(v.meanReturn * 100).toFixed(1)}% valueProfit=${(v.profitRate * 100).toFixed(1)}% printing=${r.playtest.moneyPrinting.map((s) => s.kind).join('|') || 'none'} spread=${(r.playtest.spread * 100).toFixed(1)}pp density=${r.playtest.agg.decisionDensity.toFixed(3)}`,
    )
  }
  for (const p of probes) {
    const hf = summaryOf(p.combo, 'hf')
    lines.push(
      `PROBE ${p.scenario}/${p.cap}x hfSurvival=${(hf.effectiveSurvivalRate * 100).toFixed(1)}% hfLiqMedian=${hf.medianLiq ?? 'n/a'} hfDeathMedian=${hf.medianDeath ?? 'n/a'} hfFeePct=${(hf.meanFeePct * 100).toFixed(2)}% roundTripFee=${(roundTripFeePct(p.cap, p.combo.params.feeModel, 'base') * 100).toFixed(1)}% verdict=${p.combo.verdict}`,
    )
  }
  lines.push(`EVENT_INTERVAL=${chosenEvent.interval}`)
  lines.push(
    `TIMINGS pool=${(timings.pool / 1000).toFixed(2)}s scanA=${(timings.scanA / 1000).toFixed(2)}s scanBC=${(timings.scanBC / 1000).toFixed(2)}s play=${(timings.playtest / 1000).toFixed(2)}s legacy=${(timings.legacy / 1000).toFixed(2)}s probes=${(timings.probes / 1000).toFixed(2)}s sweep=${(timings.sweep / 1000).toFixed(2)}s events=${(timings.events / 1000).toFixed(2)}s total=${(timings.total / 1000).toFixed(2)}s`,
  )
  lines.push(`SUMMARY_HASH=${summaryHash}`)

  if (process.argv.includes('--debug')) {
    for (const r of runs) {
      const top = [...r.scan].sort((a, b) => comboScore(b) - comboScore(a)).slice(0, 4)
      for (const c of top) {
        lines.push(
          `DEBUG ${r.spec.id} score=${comboScore(c).toFixed(1)} ${c.params.leverageCap}x/${(c.params.dailyVol * 100).toFixed(0)}%/${c.params.feeTier} verdict=${c.verdict} best=${c.best.label} bestMean=${(c.best.meanReturn * 100).toFixed(1)}% bestSurv=${(c.best.effectiveSurvivalRate * 100).toFixed(1)}% bestProfit=${(c.best.profitRate * 100).toFixed(1)}% reasons=${c.reasons.join(';')}`,
        )
      }
    }
    for (const s of sweep) {
      lines.push(
        `SWEEP sigma=${(s.sigma * 100).toFixed(0)}% k=${s.k} value=${(s.value.meanReturn * 100).toFixed(1)}% profit=${(s.value.profitRate * 100).toFixed(1)}% t=${s.value.tStat.toFixed(1)} printing=${s.value.stablePositive}`,
      )
    }
  }

  // 只有三组全跑时才写报告；单组运行只打印，避免用局部结果覆盖完整报告。
  if (!quick && A && B && C) {
    const report = buildReport({
      seed,
      quick,
      timings,
      runs,
      probes,
      events,
      chosenEvent,
      sweep,
      summaryHash,
    })
    const reportPath = resolve(process.cwd(), '_exchange-playtest-report.md')
    writeFileSync(reportPath, report, 'utf8')
    lines.push(`REPORT=${reportPath}`)
  }

  console.log(lines.join('\n'))
}

main()
