import type {
  BondPosition,
  BondProduct,
  ChartPeriod,
  CompanyFlowEntry,
  CompanyFlowsResult,
  CompanyInfo,
  DividendRecord,
  ExchangeAccount,
  ExchangeClient,
  ExchangeEventType,
  ExchangeOrder,
  ExchangePosition,
  ExchangeSnapshot,
  ExchangeTopic,
  FundPosition,
  IndexQuote,
  Kline,
  MarginCallPayload,
  NewsItem,
  OrderBookSnapshot,
  OrderPreview,
  OrderSource,
  PlaceOrderRequest,
  Side,
  SpotHolding,
  StockQuote,
  StrategySpec,
  TradeRecord,
  Unsubscribe,
} from '../client'
import { ExchangeError } from '../errors'
import { T, TF } from '../texts'
import { amount, round } from '../format'
import {
  applyEventShock,
  createPriceModel,
  createRng,
  stepPrice,
  type PriceModel,
  type Rng,
} from './priceEngine'
import { buildStockSeries, updateStockSeries, type StockSeries } from './history'
import { OrderBook } from './book'
import * as M from './margin'

const CONTRACT_VERSION = 3
const FEE_RATE = 0.0005
const START_CASH = 10_000_000
const DAILY_TRADE_LIMIT = 5_000_000_000
const UTC_DAY_MS = 86_400_000
const SAVINGS_PRINCIPAL_CAP = 100_000_000
const BOND_WIN_DAILY_PPB = 120_000_000
const BOND_LOSE_DAILY_PPB = -120_000_000
const BOND_LOW_DAILY_PPB = 12_000_000
const BOND_DAILY_CAP = 200_000_000
const BOND_DAILY_RATE = 0.11952
const FUND_WIN_DAILY_PPB = 514_300_000
const FUND_LOSE_DAILY_PPB = -400_000_000
const FUND_WIN_PERCENT = 70
const FUND_LOW_DAILY_PPB = 24_000_000
const FUND_DAILY_CAP = 300_000_000
const DIVIDEND_INTERVAL_TICKS = 60
const DIVIDEND_RATE = 0.0004
const MOCK_SAVE_KEY = 'whale-idle:exch-mock'
const MOCK_SAVE_VERSION = 2
const MAX_CATCHUP_TICKS = 3600

function dailyRatePpb(seed: string, day: number, threshold: number, win: number, loss: number): number {
  let hash = 2_166_136_261
  const text = `${seed}:${day}`
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return hash % 1000 < threshold ? win : loss
}

function accrueDaily(
  principal: number,
  accrued: number,
  remainder: bigint,
  capDay: number,
  capUsed: number,
  fromMs: number,
  toMs: number,
  principalCap: number,
  lowDailyPpb: number,
  dailyCap: number,
  rateOf: (day: number) => number,
): { accrued: number; remainder: bigint; capDay: number; capUsed: number } {
  if (principal <= 0 || toMs <= fromMs) return { accrued, remainder, capDay, capUsed }
  const denominator = 86_400_000n * 1_000_000_000n
  const highPrincipal = Math.min(principal, principalCap)
  const lowPrincipal = principal - highPrincipal
  let residual = remainder
  let total = BigInt(accrued)
  let used = BigInt(capUsed)
  let currentCapDay = capDay
  const cap = BigInt(dailyCap)
  for (let cursor = fromMs; cursor < toMs;) {
    const day = Math.floor(cursor / UTC_DAY_MS)
    const end = Math.min(toMs, (day + 1) * UTC_DAY_MS)
    if (currentCapDay !== day) {
      currentCapDay = day
      used = 0n
    }
    const duration = BigInt(end - cursor)
    const numerator =
      BigInt(highPrincipal) * BigInt(rateOf(day)) * duration +
      BigInt(lowPrincipal) * BigInt(lowDailyPpb) * duration +
      residual
    let whole = numerator / denominator
    let nextResidual = numerator % denominator
    if (nextResidual < 0n) {
      whole -= 1n
      nextResidual += denominator
    }
    if (whole > 0n) {
      const remaining = cap - used
      if (whole > remaining) {
        whole = remaining > 0n ? remaining : 0n
        nextResidual = 0n
      }
      used += whole
    }
    total += whole
    residual = nextResidual
    cursor = end
  }
  return { accrued: Number(total), remainder: residual, capDay: currentCapDay, capUsed: Number(used) }
}

function visibleAccrued(accrued: number, remainder: bigint): number {
  const denominator = 86_400_000n * 1_000_000_000n
  return Number((BigInt(accrued) * denominator + remainder) / denominator)
}
const SAVE_EVERY_TICKS = 5

interface StockDef {
  code: string
  name: string
  sector: string
  anchor: number
  sigma: number
  mu: number
  theta: number
  floatShares: number
  maxLeverage: number
  shortable: boolean
  spreadBps: number
  levelQty: number
}

const STOCK_DEFS: StockDef[] = [
  { code: 'XJZG', name: '星舰重工', sector: '军工', anchor: 50_000, sigma: 0.0022, mu: 0.000004, theta: 0.00008, floatShares: 20_000_000, maxLeverage: 50, shortable: true, spreadBps: 30, levelQty: 5_000 },
  { code: 'XGYH', name: '星港银行', sector: '银行', anchor: 25_000, sigma: 0.0010, mu: 0.000002, theta: 0.00010, floatShares: 32_000_000, maxLeverage: 30, shortable: true, spreadBps: 20, levelQty: 10_000 },
  { code: 'XJKY', name: '星际矿业', sector: '矿业', anchor: 8_000, sigma: 0.0014, mu: 0.000003, theta: 0.00008, floatShares: 50_000_000, maxLeverage: 40, shortable: true, spreadBps: 30, levelQty: 30_000 },
  { code: 'LTGF', name: '蓝图工坊', sector: '科技', anchor: 3_000, sigma: 0.0018, mu: 0.000005, theta: 0.00007, floatShares: 60_000_000, maxLeverage: 50, shortable: true, spreadBps: 25, levelQty: 50_000 },
  { code: 'ZHSL', name: '智核算力', sector: '算力', anchor: 1_200, sigma: 0.0024, mu: 0.000006, theta: 0.00007, floatShares: 100_000_000, maxLeverage: 70, shortable: true, spreadBps: 35, levelQty: 80_000 },
  { code: 'XGWX', name: '星港维修', sector: '维修', anchor: 500, sigma: 0.0026, mu: 0.000005, theta: 0.00008, floatShares: 120_000_000, maxLeverage: 80, shortable: true, spreadBps: 40, levelQty: 120_000 },
  { code: 'XMWL', name: '星门物流', sector: '物流', anchor: 200, sigma: 0.0012, mu: 0.000002, theta: 0.00009, floatShares: 200_000_000, maxLeverage: 60, shortable: false, spreadBps: 35, levelQty: 200_000 },
  { code: 'NMCL', name: '纳米材料', sector: '材料', anchor: 60, sigma: 0.0028, mu: 0.000004, theta: 0.00008, floatShares: 400_000_000, maxLeverage: 90, shortable: true, spreadBps: 50, levelQty: 500_000 },
]

const DEFAULT_CODE = STOCK_DEFS[0]!.code

interface StockState {
  def: StockDef
  model: PriceModel
  book: OrderBook
  series: StockSeries
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  volume: number
}

interface SpotState {
  qty: number
  avgCost: number
}

interface PositionState {
  id: string
  code: string
  side: 'long' | 'short'
  qty: number
  entry: number
  leverage: number
  margin: number
  liqTicks: number
}

interface OrderState extends ExchangeOrder {
  filledValue: number
  frozenCash: number
  frozenShares: number
  bookOrderId: string
}

interface StrategyState {
  spec: StrategySpec
  nextTick: number
  activated: boolean
  high: number
  gridBuyCount: number
  gridSellCount: number
  lastError: string
}

interface PersistedStockState {
  code: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  volume: number
  x: number
  varianceEwma: number
}

interface PersistedMockState {
  v: number
  savedAt: number
  tick: number
  cash: number
  frozen: number
  dailyTurnoverDay?: number
  dailyTurnoverUsed?: number
  spot: Array<{ code: string; qty: number; avgCost: number }>
  positions: Array<{
    id: string
    code: string
    side: 'long' | 'short'
    qty: number
    entry: number
    leverage: number
    margin: number
  }>
  orders: OrderState[]
  myTrades: TradeRecord[]
  dividends: DividendRecord[]
  strategies: Array<{
    spec: StrategySpec
    nextTick: number
    activated: boolean
    high: number
    gridBuyCount: number
    gridSellCount: number
    lastError: string
  }>
  bond: BondPosition & { accruedRemainder?: string; settledAt?: number; capDay?: number }
  fund?: { principal: number; accrued: number; accruedRemainder?: string; capDay?: number; capUsed?: number; settledMinute: number; settledAt?: number; openedAt: number }
  news: NewsItem[]
  seq: { order: number; strategy: number; trade: number; news: number }
  nextEventTick: number
  index: { open: number; high: number; low: number }
  stocks: PersistedStockState[]
}

interface EventTemplate {
  title: string
  body: string
  tone: 'good' | 'bad' | 'warn' | 'info'
  effects: Array<{ code: string; pct: number }>
  flippable?: boolean
}

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    title: '边境战事升级',
    body: '军工长单激增，部分干线货运航路绕行。',
    tone: 'warn',
    effects: [{ code: 'XJZG', pct: 0.05 }, { code: 'XMWL', pct: -0.025 }],
  },
  {
    title: '星际信贷评级调整',
    body: '跨星系信贷评级调升，市场流动性持续宽松。',
    tone: 'good',
    effects: [{ code: 'XGYH', pct: 0.04 }],
    flippable: true,
  },
  {
    title: '能源管网波动',
    body: '恒星聚变管网出力异常，能源现货供给收紧。',
    tone: 'bad',
    effects: [{ code: 'XJKY', pct: -0.04 }],
    flippable: true,
  },
  {
    title: '折跃专利公开',
    body: '前沿折跃专利披露，装备重估提振科技板块。',
    tone: 'good',
    effects: [{ code: 'LTGF', pct: 0.055 }],
    flippable: true,
  },
  {
    title: '智核算力突破',
    body: '新一代跃迁算法落地，算力采购订单爆发。',
    tone: 'good',
    effects: [{ code: 'ZHSL', pct: 0.06 }],
    flippable: true,
  },
  {
    title: '基因编辑合规排查',
    body: '多星区启动专项排查，部分管线研发进度放缓。',
    tone: 'bad',
    effects: [{ code: 'XGWX', pct: -0.05 }],
    flippable: true,
  },
  {
    title: '航路安全预警',
    body: '航路安全等级调整，干线物流保费相应上浮。',
    tone: 'bad',
    effects: [{ code: 'XMWL', pct: -0.035 }],
    flippable: true,
  },
  {
    title: '超导合成工艺革新',
    body: '分子组装工艺突破，超导材料量产全面提速。',
    tone: 'good',
    effects: [{ code: 'NMCL', pct: 0.07 }],
    flippable: true,
  },
]

const BOND_PRODUCT: BondProduct = {
  id: 'WHALE-BOND',
  name: '舰船债券 · 稳健型',
  dailyRate: BOND_DAILY_RATE,
  lowDailyRate: BOND_LOW_DAILY_PPB / 1_000_000_000,
  principalCap: SAVINGS_PRINCIPAL_CAP,
  dailyCap: BOND_DAILY_CAP,
  note: '每日 99.8% +12% / 0.2% −12% · 超出 1 亿 +1.2% · 每日封顶 2 亿',
}

const clampPrice = (p: number): number => Math.max(0.01, round(p, 2))

export class MockExchangeClient implements ExchangeClient {
  readonly contractVersion = CONTRACT_VERSION

  private rng: Rng
  private startTs: number
  private readonly seed: number
  private readonly stocks = new Map<string, StockState>()
  private readonly spot = new Map<string, SpotState>()
  private readonly positions = new Map<string, PositionState>()
  private readonly orders: OrderState[] = []
  private readonly myTrades: TradeRecord[] = []
  private readonly dividends: DividendRecord[] = []
  private readonly news: NewsItem[] = []
  private readonly strategies = new Map<string, StrategyState>()
  private readonly tickListeners = new Set<() => void>()
  private readonly subscribers = new Set<(payload: unknown) => void>()
  private readonly handlers = new Map<ExchangeEventType, Set<(payload: unknown) => void>>()

  private cash = START_CASH
  private frozen = 0
  private dailyTurnoverDay = -1
  private dailyTurnoverUsed = 0
  private quotaExemptDepth = 0
  private tick = 0
  private timer: number | null = null
  private orderSeq = 0
  private strategySeq = 0
  private tradeSeq = 0
  private newsSeq = 0
  private nextEventTick = 6
  private indexOpen = 1000
  private indexHigh = 1000
  private indexLow = 1000
  private lastStepWall = Date.now()
  private silent = false
  private readonly onPageHide = (): void => {
    this.persist()
  }
  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.catchUp()
  }
  private bond: { principal: number; accrued: number; accruedRemainder: bigint; capDay: number; capUsed: number; settledMinute: number; settledAt: number; openedAt: number } = { principal: 0, accrued: 0, accruedRemainder: 0n, capDay: 0, capUsed: 0, settledMinute: 0, settledAt: 0, openedAt: 0 }
  private readonly bondNonces = new Map<string, number>()
  private fund: { principal: number; accrued: number; accruedRemainder: bigint; capDay: number; capUsed: number; settledMinute: number; settledAt: number; openedAt: number } = { principal: 0, accrued: 0, accruedRemainder: 0n, capDay: 0, capUsed: 0, settledMinute: 0, settledAt: 0, openedAt: 0 }
  private readonly fundNonces = new Map<string, number>()

  constructor(seed = 20261103) {
    this.seed = seed
    this.rng = createRng(seed)
    const saved = this.readPersisted()
    const now = Date.now()
    this.tick = saved?.tick ?? 0
    this.startTs = now - this.tick * 1000
    this.buildStocks(now, saved)
    if (saved) this.applyPersisted(saved)
    else this.seedOpeningNews()
    const savedIndex = saved?.index
    this.indexOpen =
      savedIndex && Number.isFinite(savedIndex.open) ? savedIndex.open : this.indexValue()
    this.indexHigh =
      savedIndex && Number.isFinite(savedIndex.high) ? savedIndex.high : this.indexOpen
    this.indexLow =
      savedIndex && Number.isFinite(savedIndex.low) ? savedIndex.low : this.indexOpen
    this.refreshAllQuotes()
    if (saved) this.restoreRestingOrders()
    this.startEngine()
  }


  start(): void {
    this.startEngine()
    this.catchUp()
  }

  stop(): void {
    this.persist()
  }

  private startEngine(): void {
    if (this.timer !== null) return
    if (typeof window !== 'undefined') {
      this.timer = window.setInterval(() => this.onTimer(), 1000)
      window.addEventListener('pagehide', this.onPageHide)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }
  }

  private onTimer(): void {
    this.catchUp()
    this.persistIfNeeded()
  }

  private catchUp(): void {
    const now = Date.now()
    const elapsed = Math.floor((now - this.lastStepWall) / 1000)
    if (elapsed <= 0) return
    const ticks = Math.min(elapsed, MAX_CATCHUP_TICKS)
    this.lastStepWall = elapsed > MAX_CATCHUP_TICKS ? now : this.lastStepWall + elapsed * 1000
    if (elapsed > MAX_CATCHUP_TICKS) this.startTs += (elapsed - MAX_CATCHUP_TICKS) * 1000
    this.advance(ticks)
  }

  private advance(count: number): void {
    if (count <= 0) return
    this.silent = count > 1
    for (let i = 0; i < count; i++) this.step()
    this.silent = false
    this.emitTick()
  }

  private persistIfNeeded(): void {
    if (this.tick % SAVE_EVERY_TICKS === 0) this.persist()
  }

  private refreshAllQuotes(): void {
    const ts = this.ts()
    for (const st of this.stocks.values()) {
      st.book.refreshQuotes(st.price, st.def.spreadBps, st.def.levelQty, this.rng, ts)
    }
  }

  private buildStocks(now: number, saved: PersistedMockState | null): void {
    this.stocks.clear()
    for (const def of STOCK_DEFS) {
      const savedStock = saved?.stocks.find((s) => s.code === def.code)
      const model = createPriceModel(def.code, def.anchor, def.sigma, def.mu, def.theta)
      if (savedStock) {
        if (Number.isFinite(savedStock.x)) model.x = savedStock.x
        if (Number.isFinite(savedStock.varianceEwma) && savedStock.varianceEwma > 0) {
          model.varianceEwma = savedStock.varianceEwma
        }
      }
      const endPrice =
        savedStock && Number.isFinite(savedStock.price) && savedStock.price > 0
          ? savedStock.price
          : def.anchor
      const series = buildStockSeries(model, this.rng, now, endPrice, def.levelQty)
      const m1 = series.series.m1
      const first = m1[0]!
      const last = m1[m1.length - 1]!
      this.stocks.set(def.code, {
        def,
        model,
        book: new OrderBook(def.code),
        series,
        price: endPrice,
        prevClose: savedStock?.prevClose ?? first.o,
        open: savedStock?.open ?? first.o,
        high: savedStock?.high ?? m1.reduce((mx, k) => Math.max(mx, k.h), last.c),
        low: savedStock?.low ?? m1.reduce((mn, k) => Math.min(mn, k.l), last.c),
        volume: savedStock?.volume ?? 0,
      })
    }
    for (const state of this.stocks.values()) {
      state.book.setPlayerFillQuota((price, requestedQty) =>
        this.quotaExemptDepth > 0 ? requestedQty : this.consumeDailyTurnover(price, requestedQty),
      )
    }
  }

  private consumeDailyTurnover(price: number, requestedQty: number): number {
    const day = Math.floor(this.ts() / UTC_DAY_MS)
    this.refreshDailyTurnoverDay(day)
    const capacity = Math.floor((DAILY_TRADE_LIMIT - this.dailyTurnoverUsed) / price)
    const qty = Math.min(requestedQty, Math.max(0, capacity))
    this.dailyTurnoverUsed += price * qty
    return qty
  }

  private refreshDailyTurnoverDay(day = Math.floor(this.ts() / UTC_DAY_MS)): void {
    if (day !== this.dailyTurnoverDay) {
      this.dailyTurnoverDay = day
      this.dailyTurnoverUsed = 0
    }
  }

  private seedOpeningNews(): void {
    this.news.push({
      id: 'NEWS-0',
      ts: this.ts(),
      title: '深空证券交易所正式开市',
      body: '首批八家龙头企业挂牌上市，全网撮合交易系统平稳运转。',
      tone: 'info',
      codes: STOCK_DEFS.map((s) => s.code),
    })
  }

  private restoreRestingOrders(): void {
    for (const order of this.orders) {
      if (order.status !== 'open' && order.status !== 'partial') continue
      if (order.qtyRemaining <= 0 || order.price === null || order.price <= 0) continue
      const st = this.stocks.get(order.code)
      if (!st) continue
      const owner = order.source === 'strategy' ? 'strategy' : 'player'
      const resting = st.book.restoreResting(order.side, order.price, order.qtyRemaining, owner)
      order.bookOrderId = resting.id
    }
  }

  private applyPersisted(saved: PersistedMockState): void {
    if (Number.isFinite(saved.cash)) this.cash = saved.cash
    if (Number.isFinite(saved.frozen)) this.frozen = saved.frozen
    this.dailyTurnoverDay = Number.isFinite(saved.dailyTurnoverDay) ? saved.dailyTurnoverDay! : Math.floor(Date.now() / UTC_DAY_MS)
    this.dailyTurnoverUsed = Math.min(DAILY_TRADE_LIMIT, Math.max(0, saved.dailyTurnoverUsed ?? 0))
    for (const s of Array.isArray(saved.spot) ? saved.spot : []) {
      if (!s || typeof s.code !== 'string' || !(s.qty > 0)) continue
      this.spot.set(s.code, { qty: s.qty, avgCost: s.avgCost })
    }
    for (const p of Array.isArray(saved.positions) ? saved.positions : []) {
      if (!p || typeof p.code !== 'string' || !(p.qty > 0)) continue
      this.positions.set(`${p.code}:${p.side}`, {
        id: p.id,
        code: p.code,
        side: p.side,
        qty: p.qty,
        entry: p.entry,
        leverage: p.leverage,
        margin: p.margin,
        liqTicks: 0,
      })
    }
    this.orders.length = 0
    for (const o of Array.isArray(saved.orders) ? saved.orders : []) {
      if (!o || typeof o.id !== 'string') continue
      this.orders.push({ ...o, bookOrderId: '' })
    }
    this.myTrades.length = 0
    if (Array.isArray(saved.myTrades)) this.myTrades.push(...saved.myTrades.slice(0, 100))
    this.dividends.length = 0
    if (Array.isArray(saved.dividends)) this.dividends.push(...saved.dividends.slice(0, 60))
    this.strategies.clear()
    for (const s of Array.isArray(saved.strategies) ? saved.strategies : []) {
      if (!s?.spec?.id) continue
      this.strategies.set(s.spec.id, {
        spec: s.spec,
        nextTick: s.nextTick ?? this.tick + 3,
        activated: s.activated === true,
        high: s.high ?? 0,
        gridBuyCount: s.gridBuyCount ?? 0,
        gridSellCount: s.gridSellCount ?? 0,
        lastError: s.lastError ?? '',
      })
    }
    if (saved.bond && Number.isFinite(saved.bond.principal)) this.bond = { principal: saved.bond.principal, accrued: saved.bond.accrued, accruedRemainder: BigInt(saved.bond.accruedRemainder ?? '0'), capDay: saved.bond.capDay ?? 0, capUsed: saved.bond.capUsed ?? 0, settledMinute: saved.bond.settledMinute, settledAt: saved.bond.settledAt ?? saved.bond.settledMinute * 60_000, openedAt: saved.bond.openedAt }
    if (saved.fund && Number.isFinite(saved.fund.principal)) this.fund = { ...saved.fund, accruedRemainder: BigInt(saved.fund.accruedRemainder ?? '0'), capDay: saved.fund.capDay ?? 0, capUsed: saved.fund.capUsed ?? 0, settledAt: saved.fund.settledAt ?? saved.fund.settledMinute * 60_000 }
    this.news.length = 0
    if (Array.isArray(saved.news)) this.news.push(...saved.news.slice(0, 12))
    if (this.news.length === 0) this.seedOpeningNews()
    const seq = saved.seq
    if (seq) {
      this.orderSeq = seq.order ?? 0
      this.strategySeq = seq.strategy ?? 0
      this.tradeSeq = seq.trade ?? 0
      this.newsSeq = seq.news ?? 0
    }
    if (Number.isFinite(saved.nextEventTick)) this.nextEventTick = saved.nextEventTick
  }

  private readPersisted(): PersistedMockState | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(MOCK_SAVE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as PersistedMockState
      if (!parsed || parsed.v !== MOCK_SAVE_VERSION) return null
      if (!Array.isArray(parsed.stocks) || !Array.isArray(parsed.orders)) return null
      return parsed
    } catch {
      return null
    }
  }

  private toPersisted(): PersistedMockState {
    return {
      v: MOCK_SAVE_VERSION,
      savedAt: Date.now(),
      tick: this.tick,
      cash: this.cash,
      frozen: this.frozen,
      dailyTurnoverDay: this.dailyTurnoverDay,
      dailyTurnoverUsed: this.dailyTurnoverUsed,
      spot: [...this.spot.entries()].map(([code, hold]) => ({ code, qty: hold.qty, avgCost: hold.avgCost })),
      positions: [...this.positions.values()].map((p) => ({
        id: p.id,
        code: p.code,
        side: p.side,
        qty: p.qty,
        entry: p.entry,
        leverage: p.leverage,
        margin: p.margin,
      })),
      orders: this.orders.slice(0, 200),
      myTrades: this.myTrades.slice(0, 100),
      dividends: this.dividends.slice(0, 60),
      strategies: [...this.strategies.values()],
      bond: { ...this.bondView(), accrued: this.bond.accrued, accruedRemainder: this.bond.accruedRemainder.toString(), capDay: this.bond.capDay, settledAt: this.bond.settledAt },
      fund: { ...this.fund, accruedRemainder: this.fund.accruedRemainder.toString() },
      news: this.news.slice(0, 12),
      seq: {
        order: this.orderSeq,
        strategy: this.strategySeq,
        trade: this.tradeSeq,
        news: this.newsSeq,
      },
      nextEventTick: this.nextEventTick,
      index: { open: this.indexOpen, high: this.indexHigh, low: this.indexLow },
      stocks: [...this.stocks.values()].map((st) => ({
        code: st.def.code,
        price: st.price,
        prevClose: st.prevClose,
        open: st.open,
        high: st.high,
        low: st.low,
        volume: st.volume,
        x: st.model.x,
        varianceEwma: st.model.varianceEwma,
      })),
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(MOCK_SAVE_KEY, JSON.stringify(this.toPersisted()))
    } catch {
    }
  }

  private clearPersisted(): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(MOCK_SAVE_KEY)
    } catch {
    }
  }

  resetAccount(): void {
    this.clearPersisted()
    this.rng = createRng(this.seed)
    this.cash = START_CASH
    this.frozen = 0
    this.dailyTurnoverDay = Math.floor(Date.now() / UTC_DAY_MS)
    this.dailyTurnoverUsed = 0
    this.tick = 0
    this.startTs = Date.now()
    this.lastStepWall = this.startTs
    this.orderSeq = 0
    this.strategySeq = 0
    this.tradeSeq = 0
    this.newsSeq = 0
    this.nextEventTick = 6
    this.spot.clear()
    this.positions.clear()
    this.orders.length = 0
    this.myTrades.length = 0
    this.dividends.length = 0
    this.news.length = 0
    this.strategies.clear()
    this.bond = { principal: 0, accrued: 0, accruedRemainder: 0n, capDay: 0, capUsed: 0, settledMinute: 0, settledAt: 0, openedAt: 0 }
    this.fund = { principal: 0, accrued: 0, accruedRemainder: 0n, capDay: 0, capUsed: 0, settledMinute: 0, settledAt: 0, openedAt: 0 }
    this.buildStocks(this.startTs, null)
    this.indexOpen = this.indexValue()
    this.indexHigh = this.indexOpen
    this.indexLow = this.indexOpen
    this.seedOpeningNews()
    this.refreshAllQuotes()
    this.persist()
    this.emitTick()
  }

  getChartSeries(code: string, period: ChartPeriod): Kline[] {
    const st = this.stocks.get(code)
    if (!st) return []
    return st.series.series[period].slice()
  }

  onTick(cb: () => void): Unsubscribe {
    this.tickListeners.add(cb)
    return () => {
      this.tickListeners.delete(cb)
    }
  }

  subscribe(_codes: string[], _topics: ExchangeTopic[], _throttle?: '1s' | '5s' | '30s'): Unsubscribe {
    const cb = (_payload: unknown): void => undefined
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  on(type: ExchangeEventType, cb: (payload: unknown) => void): Unsubscribe {
    const set = this.handlers.get(type) ?? new Set<(payload: unknown) => void>()
    set.add(cb)
    this.handlers.set(type, set)
    return () => {
      set.delete(cb)
    }
  }

  private emit(type: ExchangeEventType, payload: unknown): void {
    if (this.silent) return
    const set = this.handlers.get(type)
    if (!set) return
    for (const cb of set) {
      try {
        cb(payload)
      } catch {
      }
    }
  }

  private emitTick(): void {
    for (const cb of this.tickListeners) {
      try {
        cb()
      } catch {
      }
    }
    for (const cb of this.subscribers) {
      try {
        cb({ type: 'price', ts: this.ts(), tick: this.tick })
      } catch {
      }
    }
  }


  private ts(): number {
    return this.startTs + this.tick * 1000
  }

  private step(): void {
    this.tick += 1
    const ts = this.ts()
    this.maybeSpawnEvent(ts)
    for (const st of this.stocks.values()) {
      const price = clampPrice(stepPrice(st.model, this.rng))
      st.price = price
      st.high = Math.max(st.high, price)
      st.low = Math.min(st.low, price)
      st.book.refreshQuotes(price, st.def.spreadBps, st.def.levelQty, this.rng, ts)
      const volume = Math.max(1, Math.round(st.def.levelQty * (0.04 + this.rng.next() * 0.12)))
      st.volume += volume
      updateStockSeries(st.series, ts, price, volume)
    }
    this.syncRestingOrders()
    this.runConditionalOrders(ts)
    this.runStrategies(ts)
    this.checkLiquidations(ts)
    this.settleBond()
    this.maybePayDividends(ts)
    const index = this.indexValue()
    this.indexHigh = Math.max(this.indexHigh, index)
    this.indexLow = Math.min(this.indexLow, index)
  }


  private quoteOf(st: StockState): StockQuote {
    return {
      code: st.def.code,
      nameKey: st.def.name,
      sector: st.def.sector,
      price: st.price,
      open: st.open,
      high: st.high,
      low: st.low,
      prevClose: st.prevClose,
      changePct: st.prevClose > 0 ? (st.price / st.prevClose - 1) * 100 : 0,
      volume24h: st.volume,
      maxLeverage: st.def.maxLeverage,
      shortable: st.def.shortable,
      halted: false,
      anchor: st.def.anchor,
      floatShares: st.def.floatShares,
    }
  }

  private indexValue(): number {
    let num = 0
    let den = 0
    for (const st of this.stocks.values()) {
      const w = st.def.anchor * st.def.floatShares
      num += w * (st.price / st.def.anchor)
      den += w
    }
    return den > 0 ? (1000 * num) / den : 1000
  }

  private buildIndex(): IndexQuote {
    const value = this.indexValue()
    return {
      value,
      changePct: this.indexOpen > 0 ? (value / this.indexOpen - 1) * 100 : 0,
      high: this.indexHigh,
      low: this.indexLow,
    }
  }

  private lockedSharesOf(code: string): number {
    let locked = 0
    for (const o of this.orders) {
      if (o.code === code && (o.status === 'open' || o.status === 'partial')) locked += o.frozenShares
    }
    return locked
  }

  private priceOf(code: string): number {
    return this.stocks.get(code)?.price ?? 0
  }

  private refPriceFor(st: StockState, side: Side): number {
    const snap = st.book.snapshot(this.ts(), 1)
    const level = side === 'buy' ? snap.asks[0] : snap.bids[0]
    return level?.price ?? st.price
  }


  private syncRestingOrders(): void {
    const ts = this.ts()
    for (const order of this.orders) {
      if (order.status !== 'open' && order.status !== 'partial') continue
      if (order.bookOrderId === '') continue
      const st = this.stocks.get(order.code)
      if (!st) continue
      const remaining = st.book.restingQty(order.bookOrderId)
      const filledNow = order.qtyRemaining - remaining
      if (filledNow <= 0) continue
      const fillPrice = order.price ?? st.price
      this.applyRestingFill(order, filledNow, fillPrice, ts)
      order.qtyRemaining = Math.max(0, remaining)
      order.status = order.qtyRemaining === 0 ? 'filled' : 'partial'
      if (order.qtyRemaining === 0) order.bookOrderId = ''
    }
  }

  private applyRestingFill(order: OrderState, qty: number, price: number, ts: number): void {
    const cost = qty * price
    if (order.side === 'buy') {
      const release = cost * (1 + FEE_RATE)
      this.frozen = Math.max(0, this.frozen - release)
      order.frozenCash = Math.max(0, order.frozenCash - release)
      this.spotAdd(order.code, qty, price)
    } else {
      order.frozenShares = Math.max(0, order.frozenShares - qty)
      this.spotRemove(order.code, qty)
      this.cash += cost * (1 - FEE_RATE)
    }
    order.filledQty = (order.filledQty ?? 0) + qty
    order.filledValue += cost
    order.avgFillPrice = order.filledQty > 0 ? order.filledValue / order.filledQty : undefined
    this.recordMyTrade(order, qty, price, ts)
  }

  private recordMyTrade(order: OrderState, qty: number, price: number, ts: number): void {
    this.tradeSeq += 1
    this.myTrades.unshift({
      id: `MT-${this.tradeSeq}`,
      ts,
      code: order.code,
      price: round(price, 2),
      qty,
      side: order.side,
      source: order.source ?? 'manual',
    })
    if (this.myTrades.length > 200) this.myTrades.splice(200)
  }


  async placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    return this.placeOrderInternal(req, 'manual')
  }

  previewOrder(req: PlaceOrderRequest): OrderPreview {
    const st = this.stocks.get(req.code)
    if (!st) {
      return {
        notional: 0,
        margin: 0,
        fee: 0,
        settleAmount: 0,
        liquidationPrice: null,
        liquidationDistancePct: null,
        maxQty: 0,
        blockReason: `未知标的：${req.code}`,
      }
    }
    const leverage = Math.max(1, Math.round(req.leverage ?? 1))
    const isLeverage = leverage > 1 || req.short === true
    const posSide: 'long' | 'short' = req.side === 'sell' ? 'short' : 'long'
    const marketPrice = this.refPriceFor(st, req.side)
    const price = req.type === 'market' ? marketPrice : (req.price ?? marketPrice)
    const safePrice = Math.max(0.01, price)
    const qty = req.qty
    const notional = safePrice * qty
    const fee = notional * FEE_RATE
    const hold = this.spot.get(req.code)?.qty ?? 0
    const availableSpot = Math.max(0, hold - this.lockedSharesOf(req.code))
    const maxPrice = req.type === 'market' ? safePrice * 1.01 : safePrice
    const maxQty = isLeverage
      ? M.maxOpenQty(this.cash, leverage, maxPrice, FEE_RATE)
      : req.side === 'sell'
        ? availableSpot
        : Math.floor(this.cash / (maxPrice * (1 + FEE_RATE)))
    const margin = isLeverage ? notional / leverage + fee : req.side === 'buy' ? notional + fee : 0
    const settleAmount = isLeverage
      ? -(notional / leverage + fee)
      : req.side === 'buy'
        ? -(notional + fee)
        : notional - fee
    const liq = leverage > 1 ? M.liquidationPrice(posSide, safePrice, leverage) : null
    const distance = liq !== null ? M.liquidationDistancePct(posSide, safePrice, liq) : null
    let blockReason: string | null = null
    const existing = this.positions.get(`${req.code}:${posSide}`)
    if (!Number.isInteger(qty) || qty <= 0) blockReason = T.toastInvalidQty
    else if (!(price > 0) || !Number.isFinite(price)) blockReason = T.toastInvalidPrice
    else if (isLeverage && leverage > st.def.maxLeverage) {
      blockReason = `${T.leverageUnavailable}（最高 ${st.def.maxLeverage}x）`
    } else if (isLeverage && req.side === 'sell' && !st.def.shortable) blockReason = T.noShort
    else if (isLeverage && req.reduceOnly !== true && existing && existing.leverage !== leverage) {
      blockReason = TF.leverageConflict(`${existing.leverage}x`)
    } else if (!isLeverage && req.side === 'sell' && availableSpot < qty) {
      blockReason = TF.maxSellQty(amount(Math.floor(availableSpot)))
    } else if (!isLeverage && req.side === 'buy' && this.cash < notional + fee) {
      blockReason = `${T.toastNoCash}，${TF.maxQty(amount(maxQty))}`
    } else if (isLeverage && this.cash < notional / leverage + fee) {
      blockReason = `${T.toastNoCash}，${TF.maxQty(amount(maxQty))}`
    }
    return {
      notional,
      margin,
      fee,
      settleAmount,
      liquidationPrice: liq,
      liquidationDistancePct: distance,
      maxQty,
      blockReason,
    }
  }

  private placeOrderInternal(req: PlaceOrderRequest, source: OrderSource): ExchangeOrder {
    const st = this.stocks.get(req.code)
    if (!st) throw new ExchangeError('unknown_code', `未知标的：${req.code}`)
    if (!Number.isInteger(req.qty) || req.qty <= 0) throw new ExchangeError('bad_qty', T.toastInvalidQty)
    const leverage = Math.max(1, Math.round(req.leverage ?? 1))
    if (leverage > st.def.maxLeverage) {
      throw new ExchangeError('leverage_not_allowed', `${T.leverageUnavailable}（${st.def.code} 最高 ${st.def.maxLeverage}x）`)
    }
    if ((leverage > 1 || req.short === true) && req.side === 'sell' && !st.def.shortable) {
      throw new ExchangeError('not_shortable', T.noShort)
    }
    if (req.type === 'stop' || req.type === 'take_profit') {
      return this.placeTrigger(req, st, leverage, source)
    }
    if (req.type === 'market') {
      const marketPrice = this.refPriceFor(st, req.side)
      return leverage > 1 || req.short === true
        ? this.placeLeverage(req, st, leverage, marketPrice, source, true)
        : this.placeSpot(req, st, marketPrice, source, true)
    }
    const price = req.price
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      throw new ExchangeError('bad_price', T.toastInvalidPrice)
    }
    const safePrice = round(price, 2)
    return leverage > 1 || req.short === true
      ? this.placeLeverage(req, st, leverage, safePrice, source, false)
      : this.placeSpot(req, st, safePrice, source, false)
  }

  private newOrder(
    req: PlaceOrderRequest,
    leverage: number,
    price: number | null,
    ts: number,
    source: OrderSource,
  ): OrderState {
    this.orderSeq += 1
    return {
      id: `EX-${this.orderSeq}`,
      clientOrderId: req.clientOrderId,
      code: req.code,
      side: req.side,
      type: req.type,
      price,
      qty: req.qty,
      qtyRemaining: req.qty,
      leverage,
      status: 'open',
      createdAt: ts,
      source,
      filledQty: 0,
      avgFillPrice: undefined,
      triggerPrice: req.triggerPrice,
      reduceOnly: req.reduceOnly,
      filledValue: 0,
      frozenCash: 0,
      frozenShares: 0,
      bookOrderId: '',
    }
  }

  private placeSpot(
    req: PlaceOrderRequest,
    st: StockState,
    price: number,
    source: OrderSource,
    market: boolean,
  ): OrderState {
    const ts = this.ts()
    const order = this.newOrder(req, 1, market ? null : price, ts, source)
    const checkPrice = market ? price * 1.01 : price
    if (req.side === 'buy') {
      const need = req.qty * checkPrice * (1 + FEE_RATE)
      if (this.cash < need) {
        const maxQty = Math.floor(this.cash / (checkPrice * (1 + FEE_RATE)))
        throw new ExchangeError('insufficient_cash', `${T.toastNoCash}，${TF.maxQty(amount(maxQty))}`)
      }
    } else {
      const hold = this.spot.get(st.def.code)?.qty ?? 0
      const available = Math.max(0, hold - this.lockedSharesOf(st.def.code))
      if (available < req.qty) throw new ExchangeError('insufficient_holding', TF.maxSellQty(amount(Math.floor(available))))
    }
    const allowRest = !market
    const res = st.book.submit(req.side, req.qty, market ? null : price, 'player', source, ts, allowRest)
    const filledQty = req.qty - res.order.qty
    if (filledQty === 0 && market) throw new ExchangeError('no_liquidity', T.toastNoLiquidity)
    let filledValue = 0
    for (const f of res.fills) filledValue += f.price * f.qty
    const avg = filledQty > 0 ? filledValue / filledQty : price

    if (req.side === 'buy') {
      if (filledQty > 0) {
        this.cash -= filledValue * (1 + FEE_RATE)
        this.spotAdd(st.def.code, filledQty, avg)
        this.recordFills(res.fills, order, ts)
      }
      const rest = allowRest ? res.order.qty : 0
      if (rest > 0) {
        const freeze = rest * price * (1 + FEE_RATE)
        this.cash -= freeze
        this.frozen += freeze
        order.frozenCash = freeze
        order.bookOrderId = res.order.id
      }
    } else {
      if (filledQty > 0) {
        this.cash += filledValue * (1 - FEE_RATE)
        this.spotRemove(st.def.code, filledQty)
        this.recordFills(res.fills, order, ts)
      }
      const rest = allowRest ? res.order.qty : 0
      if (rest > 0) {
        order.frozenShares = rest
        order.bookOrderId = res.order.id
      }
    }
    order.filledQty = filledQty
    order.filledValue = filledValue
    order.avgFillPrice = filledQty > 0 ? avg : undefined
    order.qtyRemaining = req.qty - filledQty
    order.status = order.qtyRemaining === 0 ? 'filled' : filledQty > 0 ? 'partial' : 'open'
    this.orders.unshift(order)
    return order
  }

  private placeLeverage(
    req: PlaceOrderRequest,
    st: StockState,
    leverage: number,
    price: number,
    source: OrderSource,
    market: boolean,
  ): OrderState {
    const ts = this.ts()
    const side: 'long' | 'short' = req.side === 'buy' ? 'long' : 'short'
    const key = `${req.code}:${side}`

    if (req.reduceOnly === true) {
      const pos = this.positions.get(key)
      if (!pos) throw new ExchangeError('no_position', TF.reduceOnlyInvalid)
      const qty = Math.min(req.qty, pos.qty)
      const closed = this.closeInternal(req.code, side, qty, ts, source)
      const order = this.newOrder(req, leverage, market ? null : price, ts, source)
      order.reduceOnly = true
      order.filledQty = closed.qty
      order.filledValue = closed.qty * closed.avg
      order.avgFillPrice = closed.avg
      order.qtyRemaining = req.qty - closed.qty
      order.status = order.qtyRemaining === 0 ? 'filled' : 'cancelled'
      this.orders.unshift(order)
      return order
    }

    const existing = this.positions.get(key)
    if (existing && existing.leverage !== leverage) {
      throw new ExchangeError('leverage_conflict', TF.leverageConflict(`${existing.leverage}x`))
    }
    const needMargin = (req.qty * (market ? price * 1.01 : price)) / leverage + req.qty * price * FEE_RATE
    if (this.cash < needMargin) {
      const maxQty = M.maxOpenQty(this.cash, leverage, market ? price * 1.01 : price, FEE_RATE)
      throw new ExchangeError('insufficient_cash', `${T.toastNoCash}，${TF.maxQty(amount(maxQty))}`)
    }
    const order = this.newOrder(req, leverage, market ? null : price, ts, source)
    const res = st.book.submit(req.side, req.qty, market ? null : price, 'player', source, ts, false)
    const filledQty = req.qty - res.order.qty
    if (filledQty === 0) throw new ExchangeError('no_liquidity', T.toastNoLiquidity)
    let filledValue = 0
    for (const f of res.fills) filledValue += f.price * f.qty
    const avg = filledValue / filledQty
    const margin = (filledQty * avg) / leverage
    const fee = filledQty * avg * FEE_RATE
    this.cash -= margin + fee
    if (existing) {
      const totalQty = existing.qty + filledQty
      existing.entry = (existing.entry * existing.qty + avg * filledQty) / totalQty
      existing.qty = totalQty
      existing.margin += margin
    } else {
      this.positions.set(key, {
        id: `${req.code}-${side}-${++this.orderSeq}`,
        code: req.code,
        side,
        qty: filledQty,
        entry: avg,
        leverage,
        margin,
        liqTicks: 0,
      })
    }
    this.recordFills(res.fills, order, ts)
    order.filledQty = filledQty
    order.filledValue = filledValue
    order.avgFillPrice = avg
    order.qtyRemaining = req.qty - filledQty
    order.status = order.qtyRemaining === 0 ? 'filled' : 'cancelled'
    this.orders.unshift(order)
    return order
  }

  private placeTrigger(
    req: PlaceOrderRequest,
    st: StockState,
    leverage: number,
    source: OrderSource,
  ): OrderState {
    const trigger = req.triggerPrice
    if (trigger === undefined || !Number.isFinite(trigger) || trigger <= 0) {
      throw new ExchangeError('bad_trigger', TF.triggerPriceInvalid)
    }
    const ts = this.ts()
    const posSide: 'long' | 'short' = req.side === 'sell' ? 'long' : 'short'
    const hasPos = this.positions.has(`${req.code}:${posSide}`)
    const hold = this.spot.get(st.def.code)?.qty ?? 0
    if (!hasPos && hold < req.qty) throw new ExchangeError('no_position', TF.reduceOnlyInvalid)
    const order = this.newOrder(req, leverage, round(trigger, 2), ts, source)
    order.triggerPrice = round(trigger, 2)
    order.reduceOnly = true
    order.status = 'trigger_pending'
    this.orders.unshift(order)
    return order
  }

  private recordFills(fills: Array<{ price: number; qty: number }>, order: OrderState, ts: number): void {
    for (const f of fills) this.recordMyTrade(order, f.qty, f.price, ts)
  }


  async closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void> {
    const pos = this.positions.get(`${code}:${side}`)
    if (!pos) throw new ExchangeError('no_position', T.toastNoPosition)
    this.closeInternal(code, side, qty ?? pos.qty, this.ts(), 'manual')
  }

  private closeInternal(
    code: string,
    side: 'long' | 'short',
    qty: number,
    ts: number,
    source: OrderSource,
  ): { qty: number; avg: number } {
    const key = `${code}:${side}`
    const pos = this.positions.get(key)
    if (!pos) throw new ExchangeError('no_position', T.toastNoPosition)
    const closeQty = Math.min(Math.max(0, qty), pos.qty)
    if (closeQty <= 0) return { qty: 0, avg: pos.entry }
    const st = this.stocks.get(code)
    if (!st) throw new ExchangeError('unknown_code', `未知标的：${code}`)
    const takerSide: Side = side === 'long' ? 'sell' : 'buy'
    if (source === 'liquidation') this.quotaExemptDepth += 1
    let res: ReturnType<typeof st.book.submit>
    try {
      res = st.book.submit(takerSide, closeQty, null, 'player', source, ts, false)
    } finally {
      if (source === 'liquidation') this.quotaExemptDepth -= 1
    }
    let filledQty = closeQty - res.order.qty
    let filledValue = 0
    for (const f of res.fills) filledValue += f.price * f.qty
    if (filledQty < closeQty) {
      const rest = closeQty - filledQty
      const fallbackQty = source === 'liquidation'
        ? rest
        : this.consumeDailyTurnover(st.price, rest)
      filledValue += fallbackQty * st.price
      filledQty += fallbackQty
    }
    if (filledQty <= 0) return { qty: 0, avg: pos.entry }
    const avg = filledValue / filledQty
    const pnl = M.unrealizedPnl(side, pos.entry, avg, filledQty)
    const marginRelease = (pos.margin * filledQty) / pos.qty
    const fee = avg * filledQty * FEE_RATE
    this.cash += marginRelease + pnl - fee
    pos.margin -= marginRelease
    pos.qty -= filledQty
    if (pos.qty <= 1e-9) this.positions.delete(key)
    this.tradeSeq += 1
    this.myTrades.unshift({
      id: `MT-${this.tradeSeq}`,
      ts,
      code,
      price: round(avg, 2),
      qty: filledQty,
      side: takerSide,
      source,
    })
    if (this.myTrades.length > 200) this.myTrades.splice(200)
    return { qty: filledQty, avg }
  }

  private checkLiquidations(ts: number): void {
    for (const pos of [...this.positions.values()]) {
      const st = this.stocks.get(pos.code)
      if (!st) continue
      const mark = st.price
      const upnl = M.unrealizedPnl(pos.side, pos.entry, mark, pos.qty)
      if (!M.isLiquidatable(pos.margin, upnl, pos.qty, mark, pos.leverage)) {
        pos.liqTicks = 0
        continue
      }
      const equityBefore = M.positionEquity(pos.margin, upnl)
      pos.liqTicks += 1
      const sliceQty =
        equityBefore <= 0 || pos.liqTicks >= 3 ? pos.qty : M.liquidationSliceQty(pos.qty)
      try {
        const closed = this.closeInternal(pos.code, pos.side, sliceQty, ts, 'liquidation')
        const payload: MarginCallPayload = {
          code: pos.code,
          side: pos.side,
          qty: closed.qty,
          price: round(mark, 2),
          fullyClosed: !this.positions.has(`${pos.code}:${pos.side}`),
        }
        this.emit('margin_call', payload)
      } catch {
      }
    }
  }


  private runConditionalOrders(ts: number): void {
    for (const order of this.orders) {
      if (order.status !== 'trigger_pending') continue
      const st = this.stocks.get(order.code)
      const trigger = order.triggerPrice
      if (!st || trigger === undefined) continue
      const hit =
        order.type === 'stop'
          ? order.side === 'sell'
            ? st.price <= trigger
            : st.price >= trigger
          : order.side === 'sell'
            ? st.price >= trigger
            : st.price <= trigger
      if (!hit) continue
      const posSide: 'long' | 'short' = order.side === 'sell' ? 'long' : 'short'
      const pos = this.positions.get(`${order.code}:${posSide}`)
      if (!pos) {
        order.status = 'cancelled'
        continue
      }
      try {
        const qty = Math.min(order.qty - (order.filledQty ?? 0), pos.qty)
        if (qty <= 0) {
          order.status = 'cancelled'
          continue
        }
        const closed = this.closeInternal(order.code, posSide, qty, ts, 'conditional')
        order.filledQty = (order.filledQty ?? 0) + closed.qty
        order.filledValue += closed.qty * closed.avg
        order.avgFillPrice = order.filledValue / order.filledQty
        order.qtyRemaining = Math.max(0, order.qty - order.filledQty)
        order.status = order.qtyRemaining === 0 ? 'filled' : 'partial'
      } catch {
      }
    }
  }


  private runStrategies(ts: number): void {
    for (const s of this.strategies.values()) {
      if (!s.spec.enabled) continue
      try {
        this.runStrategy(s, ts)
        s.lastError = ''
      } catch (err) {
        s.lastError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  private runStrategy(s: StrategyState, ts: number): void {
    const st = this.stocks.get(s.spec.code)
    if (!st) return
    const params = s.spec.params
    if (s.spec.template === 'dca') {
      if (this.tick < s.nextTick) return
      const budget = Math.max(1, Number(params.amount ?? 50_000))
      const qty = Math.floor(budget / st.price)
      if (qty >= 1) {
        this.placeOrderInternal(
          { clientOrderId: `stg-${s.spec.id ?? ''}-${this.tick}`, code: s.spec.code, side: 'buy', type: 'market', tif: 'IOC', qty, leverage: 1 },
          'strategy',
        )
      }
      s.nextTick = this.tick + Math.max(3, Math.round(Number(params.intervalSec ?? 20)))
      return
    }
    if (s.spec.template === 'grid') {
      const base = Number(params.basePrice ?? st.price)
      const lower = Number(params.lowerPct ?? -6)
      const upper = Number(params.upperPct ?? 6)
      const grids = Math.max(2, Math.round(Number(params.grids ?? 4)))
      const qty = Math.max(1, Math.round(Number(params.qty ?? 100)))
      const stepPct = (upper - lower) / grids
      const levelPrice = (i: number): number => base * (1 + (lower + i * stepPct) / 100)
      if (s.gridBuyCount < grids && st.price <= levelPrice(s.gridBuyCount)) {
        this.placeOrderInternal(
          { clientOrderId: `stg-${s.spec.id ?? ''}-g${this.tick}`, code: s.spec.code, side: 'buy', type: 'market', tif: 'IOC', qty, leverage: 1 },
          'strategy',
        )
        s.gridBuyCount += 1
        return
      }
      if (s.gridBuyCount > s.gridSellCount && st.price >= levelPrice(s.gridSellCount + 1)) {
        const hold = Math.max(0, (this.spot.get(s.spec.code)?.qty ?? 0) - this.lockedSharesOf(s.spec.code))
        const sellQty = Math.min(qty, hold)
        if (sellQty > 0) {
          this.placeOrderInternal(
            { clientOrderId: `stg-${s.spec.id ?? ''}-s${this.tick}`, code: s.spec.code, side: 'sell', type: 'market', tif: 'IOC', qty: sellQty, leverage: 1 },
            'strategy',
          )
        }
        s.gridSellCount += 1
      }
      return
    }
    if (s.spec.template === 'trailing_tp') {
      const base = Number(params.basePrice ?? st.price)
      const activatePct = Number(params.activatePct ?? 3)
      const trailPct = Number(params.trailPct ?? 1.5)
      if (!s.activated) {
        if (st.price >= base * (1 + activatePct / 100)) {
          s.activated = true
          s.high = st.price
        }
        return
      }
      s.high = Math.max(s.high, st.price)
      if (st.price > s.high * (1 - trailPct / 100)) return
      const hold = Math.max(0, (this.spot.get(s.spec.code)?.qty ?? 0) - this.lockedSharesOf(s.spec.code))
      const pos = this.positions.get(`${s.spec.code}:long`)
      const wanted = Math.max(0, Math.round(Number(params.qty ?? 0)))
      const qty = wanted > 0 ? wanted : hold > 0 ? hold : (pos?.qty ?? 0)
      if (qty > 0) {
        if (hold > 0) {
          this.placeOrderInternal(
            { clientOrderId: `stg-${s.spec.id ?? ''}-t${this.tick}`, code: s.spec.code, side: 'sell', type: 'market', tif: 'IOC', qty: Math.min(qty, hold), leverage: 1 },
            'strategy',
          )
        } else if (pos) {
          this.closeInternal(s.spec.code, 'long', Math.min(qty, pos.qty), ts, 'strategy')
        }
      }
      s.activated = false
      s.high = st.price
    }
  }

  private normalizeStrategy(spec: StrategySpec): StrategySpec {
    if (!this.stocks.has(spec.code)) throw new ExchangeError('unknown_code', `未知标的：${spec.code}`)
    const template = spec.template
    if (template !== 'dca' && template !== 'grid' && template !== 'trailing_tp') {
      throw new ExchangeError('unsupported_template', '原型仅支持定投 / 网格 / 移动止盈三种模板')
    }
    const params: Record<string, number | string | boolean> = { ...spec.params }
    if (params.basePrice === undefined) params.basePrice = this.priceOf(spec.code)
    if (template === 'dca') {
      const amountValue = Number(params.amount ?? 50_000)
      const interval = Number(params.intervalSec ?? 20)
      if (!(amountValue > 0) || !(interval >= 3)) {
        throw new ExchangeError('bad_strategy', T.strategyParamsInvalid)
      }
      params.amount = amountValue
      params.intervalSec = Math.round(interval)
    } else if (template === 'grid') {
      const lower = Number(params.lowerPct ?? -6)
      const upper = Number(params.upperPct ?? 6)
      const grids = Math.round(Number(params.grids ?? 4))
      const qty = Math.round(Number(params.qty ?? 100))
      if (!(lower < upper) || grids < 2 || grids > 50 || !(qty > 0)) {
        throw new ExchangeError('bad_strategy', T.strategyParamsInvalid)
      }
      params.lowerPct = lower
      params.upperPct = upper
      params.grids = grids
      params.qty = qty
    } else {
      const activatePct = Number(params.activatePct ?? 3)
      const trailPct = Number(params.trailPct ?? 1.5)
      const qty = Math.round(Number(params.qty ?? 0))
      if (!(activatePct > 0) || !(trailPct > 0) || !(trailPct < activatePct) || qty < 0) {
        throw new ExchangeError('bad_strategy', T.strategyParamsInvalid)
      }
      params.activatePct = activatePct
      params.trailPct = trailPct
      params.qty = qty
    }
    return {
      id: spec.id ?? `STG-${++this.strategySeq}`,
      template,
      code: spec.code,
      params,
      enabled: spec.enabled,
    }
  }

  async saveStrategy(spec: StrategySpec): Promise<StrategySpec> {
    const normalized = this.normalizeStrategy(spec)
    const id = normalized.id!
    const existing = this.strategies.get(id)
    if (existing) {
      existing.spec = normalized
      existing.nextTick = Math.max(existing.nextTick, this.tick + 2)
    } else {
      this.strategies.set(id, {
        spec: normalized,
        nextTick: this.tick + 3,
        activated: false,
        high: 0,
        gridBuyCount: 0,
        gridSellCount: 0,
        lastError: '',
      })
    }
    return normalized
  }

  async deleteStrategy(id: string): Promise<void> {
    this.strategies.delete(id)
  }

  async listStrategies(): Promise<StrategySpec[]> {
    return [...this.strategies.values()].map((s) => s.spec)
  }


  private settleBond(): void {
    const now = this.ts()
    const nowMinute = Math.floor(now / 60_000)
    if (this.bond.principal <= 0) {
      this.bond.settledMinute = nowMinute
      this.bond.settledAt = now
      return
    }
    const from = Math.max(this.bond.settledAt || Math.floor(this.bond.openedAt / 60_000) * 60_000, this.bond.openedAt)
    if (now <= from) return
    const settled = accrueDaily(
      this.bond.principal,
      this.bond.accrued,
      this.bond.accruedRemainder,
      this.bond.capDay,
      this.bond.capUsed,
      from,
      now,
      SAVINGS_PRINCIPAL_CAP,
      BOND_LOW_DAILY_PPB,
      BOND_DAILY_CAP,
      (day) => dailyRatePpb('bond', day, 998, BOND_WIN_DAILY_PPB, BOND_LOSE_DAILY_PPB),
    )
    this.bond.accrued = settled.accrued
    this.bond.accruedRemainder = settled.remainder
    this.bond.capDay = settled.capDay
    this.bond.capUsed = settled.capUsed
    this.bond.settledMinute = nowMinute
    this.bond.settledAt = now
  }

  private bondView(): BondPosition {
    const accrued = visibleAccrued(this.bond.accrued, this.bond.accruedRemainder)
    const minutes =
      this.bond.principal > 0
        ? Math.max(0, this.bond.settledMinute - Math.floor(this.bond.openedAt / 60_000))
        : 0
    return {
      principal: this.bond.principal,
      accrued,
      value: this.bond.principal + accrued,
      settledMinute: this.bond.settledMinute,
      openedAt: this.bond.openedAt,
      minutes,
      winDailyPpb: BOND_WIN_DAILY_PPB,
      loseDailyPpb: BOND_LOSE_DAILY_PPB,
      winPermille: 998,
      lowDailyPpb: BOND_LOW_DAILY_PPB,
      principalCap: SAVINGS_PRINCIPAL_CAP,
      dailyCap: BOND_DAILY_CAP,
      capUsed: this.bond.capUsed,
      cash: this.cash,
    }
  }

  async getBondPosition(): Promise<BondPosition> {
    this.settleBond()
    return this.bondView()
  }

  async openBond(amountValue: number, nonce: string): Promise<BondPosition> {
    const value = Math.floor(amountValue)
    if (!(value > 0)) throw new ExchangeError('bad_amount', T.toastBondInvalid)
    const replayed = this.bondNonces.get(nonce)
    if (replayed !== undefined) {
      if (replayed !== value) throw new ExchangeError('nonce_conflict', T.toastBondInvalid)
      this.settleBond()
      return this.bondView()
    }
    if (value > this.cash) throw new ExchangeError('insufficient_cash', TF.bondNoCash)
    this.settleBond()
    if (this.bond.principal <= 0) {
      this.bond.openedAt = this.ts()
      this.bond.settledMinute = Math.floor(this.ts() / 60_000)
      this.bond.settledAt = this.ts()
    }
    this.bond.principal += value
    this.cash -= value
    this.bondNonces.set(nonce, value)
    return this.bondView()
  }

  async redeemBond(nonce: string): Promise<BondPosition> {
    const replayed = this.bondNonces.get(nonce)
    if (replayed !== undefined) {
      this.settleBond()
      return this.bondView()
    }
    if (this.bond.principal <= 0) throw new ExchangeError('no_bond_position', T.toastBondInvalid)
    this.settleBond()
    const payout = Math.max(0, this.bond.principal + visibleAccrued(this.bond.accrued, this.bond.accruedRemainder))
    this.cash += payout
    this.bond = { principal: 0, accrued: 0, accruedRemainder: 0n, capDay: 0, capUsed: 0, settledMinute: 0, settledAt: 0, openedAt: 0 }
    this.bondNonces.set(nonce, 0)
    return this.bondView()
  }

  private settleFund(): void {
    const now = this.ts()
    const nowMinute = Math.floor(now / 60_000)
    if (this.fund.principal <= 0) {
      this.fund.settledMinute = nowMinute
      this.fund.settledAt = now
      return
    }
    const from = Math.max(this.fund.settledAt || Math.floor(this.fund.openedAt / 60_000) * 60_000, this.fund.openedAt)
    if (now <= from) return
    const settled = accrueDaily(
      this.fund.principal,
      this.fund.accrued,
      this.fund.accruedRemainder,
      this.fund.capDay,
      this.fund.capUsed,
      from,
      now,
      SAVINGS_PRINCIPAL_CAP,
      FUND_LOW_DAILY_PPB,
      FUND_DAILY_CAP,
      (day) => dailyRatePpb('fund', day, FUND_WIN_PERCENT * 10, FUND_WIN_DAILY_PPB, FUND_LOSE_DAILY_PPB),
    )
    this.fund.accrued = settled.accrued
    this.fund.accruedRemainder = settled.remainder
    this.fund.capDay = settled.capDay
    this.fund.capUsed = settled.capUsed
    this.fund.settledMinute = nowMinute
    this.fund.settledAt = now
  }

  private fundView(): FundPosition {
    const accrued = visibleAccrued(this.fund.accrued, this.fund.accruedRemainder)
    const minutes = this.fund.principal > 0 ? Math.max(0, this.fund.settledMinute - Math.floor(this.fund.openedAt / 60_000)) : 0
    return {
      principal: this.fund.principal,
      accrued,
      value: this.fund.principal + accrued,
      settledMinute: this.fund.settledMinute,
      openedAt: this.fund.openedAt,
      minutes,
      winDailyPpb: FUND_WIN_DAILY_PPB,
      loseDailyPpb: FUND_LOSE_DAILY_PPB,
      winPercent: FUND_WIN_PERCENT,
      lowDailyPpb: FUND_LOW_DAILY_PPB,
      principalCap: SAVINGS_PRINCIPAL_CAP,
      dailyCap: FUND_DAILY_CAP,
      capUsed: this.fund.capUsed,
      cash: this.cash,
    }
  }

  async getFundPosition(): Promise<FundPosition> {
    this.settleFund()
    return this.fundView()
  }

  async openFund(amountValue: number, nonce: string): Promise<FundPosition> {
    const amountValueFloor = Math.floor(amountValue)
    if (!(amountValueFloor > 0)) throw new ExchangeError('bad_amount', T.cashierInvalidAmount)
    const replayed = this.fundNonces.get(nonce)
    if (replayed !== undefined) {
      if (replayed !== amountValueFloor) throw new ExchangeError('nonce_conflict', T.fundNoCash)
      this.settleFund()
      return this.fundView()
    }
    if (amountValueFloor > this.cash) throw new ExchangeError('insufficient_cash', T.fundNoCash)
    this.settleFund()
    if (this.fund.principal <= 0) {
      this.fund.openedAt = this.ts()
      this.fund.accrued = 0
      this.fund.accruedRemainder = 0n
      this.fund.settledAt = this.ts()
      this.fund.settledMinute = Math.floor(this.ts() / 60_000)
    }
    this.fund.principal += amountValueFloor
    this.cash -= amountValueFloor
    this.fundNonces.set(nonce, amountValueFloor)
    return this.fundView()
  }

  async redeemFund(nonce: string): Promise<FundPosition> {
    const replayed = this.fundNonces.get(nonce)
    if (replayed !== undefined) {
      this.settleFund()
      return this.fundView()
    }
    if (this.fund.principal <= 0) throw new ExchangeError('no_fund_position', T.fundNoCash)
    this.settleFund()
    const payout = Math.max(0, this.fund.principal + visibleAccrued(this.fund.accrued, this.fund.accruedRemainder))
    this.cash += payout
    this.fund = { principal: 0, accrued: 0, accruedRemainder: 0n, capDay: 0, capUsed: 0, settledMinute: 0, settledAt: 0, openedAt: 0 }
    this.fundNonces.set(nonce, 0)
    return this.fundView()
  }


  private maybePayDividends(ts: number): void {
    if (this.tick % DIVIDEND_INTERVAL_TICKS !== 0) return
    for (const [code, hold] of this.spot) {
      if (hold.qty <= 0) continue
      const st = this.stocks.get(code)
      if (!st) continue
      const payout = hold.qty * st.price * DIVIDEND_RATE
      this.cash += payout
      this.dividends.unshift({ id: `DIV-${this.tick}-${code}`, ts, code, amount: payout })
    }
    if (this.dividends.length > 100) this.dividends.splice(100)
  }


  private maybeSpawnEvent(ts: number): void {
    if (this.tick < this.nextEventTick) return
    const template = EVENT_TEMPLATES[Math.floor(this.rng.next() * EVENT_TEMPLATES.length)]!
    const flip = template.flippable === true && this.rng.next() < 0.5
    const scale = 0.7 + this.rng.next() * 0.6
    const effects = template.effects.map((e) => ({ code: e.code, pct: e.pct * (flip ? -1 : 1) * scale }))
    for (const effect of effects) {
      const st = this.stocks.get(effect.code)
      if (st) applyEventShock(st.model, effect.pct)
    }
    const tone: NewsItem['tone'] = flip
      ? template.tone === 'bad'
        ? 'good'
        : template.tone === 'good'
          ? 'bad'
          : 'warn'
      : template.tone
    this.newsSeq += 1
    const news: NewsItem = {
      id: `NEWS-${this.newsSeq}`,
      ts,
      title: template.title,
      body: template.body,
      tone,
      codes: effects.map((e) => e.code),
    }
    this.news.unshift(news)
    if (this.news.length > 30) this.news.splice(30)
    this.nextEventTick = this.tick + 14 + Math.floor(this.rng.next() * 14)
    this.emit('event', news)
  }


  private spotAdd(code: string, qty: number, price: number): void {
    const hold = this.spot.get(code) ?? { qty: 0, avgCost: 0 }
    const totalQty = hold.qty + qty
    hold.avgCost = totalQty > 0 ? (hold.avgCost * hold.qty + price * qty) / totalQty : price
    hold.qty = totalQty
    this.spot.set(code, hold)
  }

  private spotRemove(code: string, qty: number): void {
    const hold = this.spot.get(code)
    if (!hold) return
    hold.qty = Math.max(0, hold.qty - qty)
    if (hold.qty <= 1e-9) this.spot.delete(code)
  }

  private buildAccount(): ExchangeAccount {
    this.refreshDailyTurnoverDay()
    const positions: ExchangePosition[] = []
    let usedMargin = 0
    let positionsEquity = 0
    for (const pos of this.positions.values()) {
      const mark = this.priceOf(pos.code)
      const upnl = M.unrealizedPnl(pos.side, pos.entry, mark, pos.qty)
      const liq = M.liquidationPrice(pos.side, pos.entry, pos.leverage)
      positions.push({
        id: pos.id,
        code: pos.code,
        side: pos.side,
        qty: pos.qty,
        avgEntry: pos.entry,
        leverage: pos.leverage,
        margin: pos.margin,
        unrealizedPnl: upnl,
        liquidationPrice: liq,
        liquidationDistancePct: M.liquidationDistancePct(pos.side, mark, liq),
      })
      usedMargin += pos.margin
      positionsEquity += pos.margin + upnl
    }
    const holdings: SpotHolding[] = []
    let holdingsValue = 0
    for (const [code, hold] of this.spot) {
      if (hold.qty <= 0) continue
      const value = hold.qty * this.priceOf(code)
      holdingsValue += value
      holdings.push({
        code,
        qty: hold.qty,
        avgCost: hold.avgCost,
        value,
        availableQty: Math.max(0, hold.qty - this.lockedSharesOf(code)),
      })
    }
    const equity =
      this.cash +
      this.frozen +
      holdingsValue +
      positionsEquity +
      this.bond.principal +
      this.bond.accrued +
      this.fund.principal +
      this.fund.accrued
    return {
      cash: this.cash,
      frozen: this.frozen,
      debt: this.cash < 0 ? -this.cash : 0,
      equity,
      marginRatio: usedMargin > 0 ? equity / usedMargin : 0,
      creditGrade: 3,
      positions,
      pendingWithdrawals: [],
      holdings,
      dailyTradeLimit: DAILY_TRADE_LIMIT,
      dailyTradeUsed: this.dailyTurnoverUsed,
    }
  }

  private currentOrders(): ExchangeOrder[] {
    return this.orders.filter(
      (o) => o.status === 'open' || o.status === 'partial' || o.status === 'trigger_pending',
    )
  }

  getSnapshot(code: string): ExchangeSnapshot {
    const st = this.stocks.get(code) ?? this.stocks.get(DEFAULT_CODE)!
    const ts = this.ts()
    return {
      ts,
      tick: this.tick,
      index: this.buildIndex(),
      stocks: [...this.stocks.values()].map((s) => this.quoteOf(s)),
      quote: this.quoteOf(st),
      book: st.book.snapshot(ts),
      trades: st.book.trades(20),
      klines: st.series.series.m1.slice(-120),
      account: this.buildAccount(),
      orders: this.currentOrders(),
      myTrades: this.myTrades.slice(0, 100),
      dividends: this.dividends.slice(0, 60),
      strategies: [...this.strategies.values()].map((s) => s.spec),
      bonds: this.bondView(),
      funds: this.fundView(),
      bondProduct: { ...BOND_PRODUCT },
      news: this.news.slice(0, 12),
      agents: [],
      feeRate: FEE_RATE,
    }
  }


  async getStocks(): Promise<StockQuote[]> {
    return [...this.stocks.values()].map((s) => this.quoteOf(s))
  }

  async getCompanies(): Promise<CompanyInfo[]> {
    return [...this.stocks.values()].map((st) => ({
      company: st.def.code,
      name: st.def.name,
      sector: st.def.sector,
      anchorShiftBp: 0,
      anchorPrice: st.def.anchor,
    }))
  }

  async submitCompanyFlows(flows: CompanyFlowEntry[]): Promise<CompanyFlowsResult> {
    return { accepted: 0, ignored: flows.length }
  }

  async getBook(code: string): Promise<OrderBookSnapshot> {
    const st = this.stocks.get(code)
    if (!st) throw new ExchangeError('unknown_code', `未知标的：${code}`)
    return st.book.snapshot(this.ts())
  }

  async getTrades(code: string): Promise<TradeRecord[]> {
    const st = this.stocks.get(code)
    if (!st) throw new ExchangeError('unknown_code', `未知标的：${code}`)
    return st.book.trades(50)
  }

  async getKlines(code: string, interval: '1m' | '5m' | '1h', limit = 120): Promise<Kline[]> {
    const st = this.stocks.get(code)
    if (!st) throw new ExchangeError('unknown_code', `未知标的：${code}`)
    if (interval === '1m') return st.series.series.m1.slice(-limit)
    if (interval === '1h') return st.series.series.h1.slice(-limit)
    const bars = st.series.series.m1
    const out: Kline[] = []
    for (let i = 0; i < bars.length; i += 5) {
      const group = bars.slice(i, i + 5)
      const first = group[0]!
      const last = group[group.length - 1]!
      out.push({
        t: first.t,
        o: first.o,
        h: group.reduce((mx, g) => Math.max(mx, g.h), first.h),
        l: group.reduce((mn, g) => Math.min(mn, g.l), first.l),
        c: last.c,
        v: group.reduce((sum, g) => sum + g.v, 0),
      })
    }
    return out.slice(-limit)
  }

  async getAccount(): Promise<ExchangeAccount> {
    return this.buildAccount()
  }

  async getOrders(): Promise<ExchangeOrder[]> {
    return this.currentOrders()
  }

  async deposit(amountValue: number, nonce: string): Promise<{ nonce: string; applied: number; fee: number; cash: number; receiptHash: string }> {
    if (!(amountValue > 0)) throw new ExchangeError('bad_amount', '入金金额必须大于 0')
    this.cash += amountValue
    return { nonce, applied: amountValue, fee: 0, cash: this.cash, receiptHash: `mock-${nonce}` }
  }

  async withdraw(amountValue: number, nonce: string): Promise<{ nonce: string; amount: number; fee: number; availableAt: number; receiptHash: string }> {
    if (!(amountValue > 0)) throw new ExchangeError('bad_amount', '出金金额必须大于 0')
    if (amountValue > this.cash) throw new ExchangeError('insufficient_cash', T.toastNoCash)
    this.cash -= amountValue
    return { nonce, amount: amountValue, fee: 0, availableAt: this.ts() + 60_000, receiptHash: `mock-${nonce}` }
  }

  async cancelOrder(id: string): Promise<void> {
    const order = this.orders.find((o) => o.id === id)
    if (!order) return
    if (order.status !== 'open' && order.status !== 'partial' && order.status !== 'trigger_pending') return
    if (order.bookOrderId !== '') {
      const st = this.stocks.get(order.code)
      st?.book.cancel(order.bookOrderId)
      order.bookOrderId = ''
    }
    if (order.side === 'buy') {
      if (order.frozenCash > 0) {
        this.frozen = Math.max(0, this.frozen - order.frozenCash)
        this.cash += order.frozenCash
        order.frozenCash = 0
      }
    } else if (order.frozenShares > 0) {
      order.frozenShares = 0
    }
    order.status = 'cancelled'
  }
}

