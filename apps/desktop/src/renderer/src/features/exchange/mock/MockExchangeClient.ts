/**
 * Mock 交易所客户端（F0 原型）——**纯前端、不接服务器、不写游戏存档**。
 *
 * 2026-11-03 追加批的三条硬语义：
 * ① **挂机**：1 秒 tick 由本类自己持有（模块单例构造即启动），页面只订阅/退订；
 *    离开页面不暂停，回来按流逝时间补算（单次上限 3600 拍）。
 * ② **持久化**：账户/持仓/委托/策略/债券/行情状态写 `localStorage['whale-idle:exch-mock']`，
 *    刷新不丢；与游戏 v31 存档完全隔离，页面提供「重置模拟账户」。
 * ③ **六周期**：启动铺 `分时/M1/H1/D1/D7/D30` 历史（每周期 400 根，分时按当日分钟数），
 *    之后每拍只更新各周期最新一根。
 *
 * 一拍（1 秒）的固定步序（步序错会出现"螺旋爆仓"或"行情不跟手"）：
 *   事件冲击 → 行情演进 → 做市商重挂五档 → 同步玩家挂单成交 → 条件单 → 量化策略
 *   → 强平 → 债券计息 → 分红。（广播由 `advance()` 在补算结束后统一发一次）
 *
 * 为什么这些顺序：价格先动，挂单才知道自己是否穿价；强平必须在策略之后（策略不能抢先
 * 替玩家躲强平）；分红/计息放最后，避免"刚成交就计一天利息"的奇怪读数。
 *
 * 随机源：全部走 `createRng(seed)`，禁止 `Math.random()`；同种子可复现整条剧情。
 */
import type {
  BondHolding,
  BondProduct,
  ChartPeriod,
  DividendRecord,
  ExchangeAccount,
  ExchangeClient,
  ExchangeEventType,
  ExchangeOrder,
  ExchangePosition,
  ExchangeSnapshot,
  ExchangeTopic,
  FundPlayResult,
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

/** 契约版本（与后端 `/api/exchange/meta` 对齐；现为版本 2） */
const CONTRACT_VERSION = 2
/** 手续费率（原型统一 5 bp，买/卖/开/平都收） */
const FEE_RATE = 0.0005
/** 原型专用虚拟资金：1000 万 ISK，不入存档 */
const START_CASH = 10_000_000
/** 债券日化 0.03%（原型观感值，不代表最终经济数值） */
const BOND_DAILY_RATE = 0.0003
/** 债券计息：游戏内 60 秒 = 1 日（原型示意，非最终数值） */
const TICKS_PER_GAME_DAY = 60
/** 分红：每 60 秒按现货持仓市值象征性派 0.04%（原型观感值） */
const DIVIDEND_INTERVAL_TICKS = 60
const DIVIDEND_RATE = 0.0004
/**
 * 模拟账户持久化（与游戏 v31 存档**完全隔离**；只存交易所自己的模拟盘状态）。
 * 需求（2026-11-03 双轨数据源批）：刷新不丢账户/持仓/委托，页面可一键重置回 1,000 万。
 */
const MOCK_SAVE_KEY = 'whale-idle:exch-mock'
const MOCK_SAVE_VERSION = 2
/** 离开页面/标签页后台后按流逝时间补算，单次上限 3600 拍（约 1 小时），避免恢复时长时间卡顿 */
const MAX_CATCHUP_TICKS = 3600
/** 每 5 拍落一次盘（localStorage 写太频繁会拖慢 1 秒 tick；pagehide 时另会补落一次） */
const SAVE_EVERY_TICKS = 5

interface StockDef {
  code: string
  name: string
  sector: string
  anchor: number
  /** 每秒基准波动率（由设计稿 60 秒口径折算：σ_60s / √60） */
  sigma: number
  mu: number
  theta: number
  floatShares: number
  maxLeverage: number
  shortable: boolean
  /** 做市商买卖价差（bp） */
  spreadBps: number
  /** 做市商每档基准数量（股） */
  levelQty: number
}

/**
 * 8 家标的（大盘、中盘、成长、散户阶梯价格与市值体系，涵盖军工、银行、能源、科技、算力、医疗、物流、材料八大板块）。
 * σ 的取值考虑"10 分钟里要看得见波动、又不至于 1 分钟就崩盘"：
 * 高波动成长/妖股更躁，大盘蓝筹更稳。
 */
const STOCK_DEFS: StockDef[] = [
  { code: 'SMHI', name: '星海重工', sector: '军工', anchor: 50_000, sigma: 0.0022, mu: 0.000004, theta: 0.00008, floatShares: 20_000_000, maxLeverage: 50, shortable: true, spreadBps: 30, levelQty: 5_000 },
  { code: 'GBCI', name: '银河信托', sector: '银行', anchor: 25_000, sigma: 0.0010, mu: 0.000002, theta: 0.00010, floatShares: 32_000_000, maxLeverage: 30, shortable: true, spreadBps: 20, levelQty: 10_000 },
  { code: 'UGMC', name: '联星能源', sector: '能源', anchor: 8_000, sigma: 0.0014, mu: 0.000003, theta: 0.00008, floatShares: 50_000_000, maxLeverage: 40, shortable: true, spreadBps: 30, levelQty: 30_000 },
  { code: 'ABSI', name: '深空蓝图', sector: '科技', anchor: 3_000, sigma: 0.0018, mu: 0.000005, theta: 0.00007, floatShares: 60_000_000, maxLeverage: 50, shortable: true, spreadBps: 25, levelQty: 50_000 },
  { code: 'NVSC', name: '量子算力', sector: '算力', anchor: 1_200, sigma: 0.0024, mu: 0.000006, theta: 0.00007, floatShares: 100_000_000, maxLeverage: 70, shortable: true, spreadBps: 35, levelQty: 80_000 },
  { code: 'CLON', name: '克隆生科', sector: '医疗', anchor: 500, sigma: 0.0026, mu: 0.000005, theta: 0.00008, floatShares: 120_000_000, maxLeverage: 80, shortable: true, spreadBps: 40, levelQty: 120_000 },
  { code: 'OJLS', name: '欧吉物流', sector: '物流', anchor: 200, sigma: 0.0012, mu: 0.000002, theta: 0.00009, floatShares: 200_000_000, maxLeverage: 60, shortable: false, spreadBps: 35, levelQty: 200_000 },
  { code: 'SPRK', name: '微光纳米', sector: '材料', anchor: 60, sigma: 0.0028, mu: 0.000004, theta: 0.00008, floatShares: 400_000_000, maxLeverage: 90, shortable: true, spreadBps: 50, levelQty: 500_000 },
]

const DEFAULT_CODE = STOCK_DEFS[0]!.code

interface StockState {
  def: StockDef
  model: PriceModel
  book: OrderBook
  /** 六周期 K 线（启动铺 400 根，1 秒 tick 只改最新一根；见 mock/history.ts） */
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
  /** 连续被强平的拍数：按设计稿分片 3 拍仍未清干净 ⇒ 剩余按标记价一次结算 */
  liqTicks: number
}

/** 订单内部态：比对外 DTO 多出挂单冻结与簿内 id（界面看不到，也不该看到） */
interface OrderState extends ExchangeOrder {
  filledValue: number
  frozenCash: number
  frozenShares: number
  /** 订单簿里的 id；空串 = 没有挂在簿上 */
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

/** 每只标的需要跨刷新延续的最小行情状态（K 线历史不存：启动时按现价重新铺图） */
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

/** `localStorage['whale-idle:exch-mock']` 的形状（版本不符直接忽略，不迁移旧原型数据） */
interface PersistedMockState {
  v: number
  savedAt: number
  tick: number
  cash: number
  frozen: number
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
  bond: BondHolding
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
  /** 对称事件：可整体反向（如"矿难"↔"新矿脉发现"） */
  flippable?: boolean
}

/** 板块联动事件（涵盖军工、银行、能源、科技、算力、医疗、物流、材料八大板块），冲击幅度在触发时再抖动 */
const EVENT_TEMPLATES: EventTemplate[] = [
  {
    title: '边境战事升级',
    body: '边境冲突扩大，军工订单排到明年；多条货运航线被迫绕行。',
    tone: 'warn',
    effects: [{ code: 'SMHI', pct: 0.05 }, { code: 'OJLS', pct: -0.025 }],
  },
  {
    title: '星际信贷评级调整',
    body: '银河信托资产质量获主流评级机构上调，跨星系流动性回暖。',
    tone: 'good',
    effects: [{ code: 'GBCI', pct: 0.04 }],
    flippable: true,
  },
  {
    title: '能源管网波动',
    body: '主要恒星聚变管网出力异常，能源板块现货供给预期震荡。',
    tone: 'bad',
    effects: [{ code: 'UGMC', pct: -0.04 }],
    flippable: true,
  },
  {
    title: '虫洞蓝图流出',
    body: '一份虫洞构造蓝图在黑市出现，科技板块估值被重新想象。',
    tone: 'good',
    effects: [{ code: 'ABSI', pct: 0.055 }],
    flippable: true,
  },
  {
    title: '量子算力突破',
    body: '新一代量子跃迁算法通过实证检验，全网算力需求集中爆发。',
    tone: 'good',
    effects: [{ code: 'NVSC', pct: 0.06 }],
    flippable: true,
  },
  {
    title: '基因编辑合规争议',
    body: '多星系道德委员会联合审查克隆技术，部分实验项目面临暂停。',
    tone: 'bad',
    effects: [{ code: 'CLON', pct: -0.05 }],
    flippable: true,
  },
  {
    title: '航路安全事件',
    body: '深空航路安全等级调整，物流企业保费与交付周期同步变化。',
    tone: 'bad',
    effects: [{ code: 'OJLS', pct: -0.035 }],
    flippable: true,
  },
  {
    title: '纳米合成工艺革新',
    body: '微光纳米公布低成本分子组装新工艺，超导材料量产预期大增。',
    tone: 'good',
    effects: [{ code: 'SPRK', pct: 0.07 }],
    flippable: true,
  },
]

const BOND_PRODUCT: BondProduct = {
  id: 'WHALE-BOND',
  name: '舰船债券 · 稳健型',
  dailyRate: BOND_DAILY_RATE,
  note: '原型示意：游戏内 60 秒按 1 日计息，不代表最终经济数值',
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
  /** 上一次真正推进行情的时间（用于离开页面后的补算） */
  private lastStepWall = Date.now()
  /** 补算期间静默广播：后台补 3600 拍时不要把强平提示连弹几十条 */
  private silent = false
  private readonly onPageHide = (): void => {
    this.persist()
  }
  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.catchUp()
  }
  private bond: BondHolding = {
    principal: 0,
    accrued: 0,
    purchasedAt: null,
    rateDaily: BOND_DAILY_RATE,
  }

  constructor(seed = 20261103) {
    this.seed = seed
    this.rng = createRng(seed)
    const saved = this.readPersisted()
    const now = Date.now()
    this.tick = saved?.tick ?? 0
    // 从持久化的 tick 接着走：订单/流水的 ts 不会因为刷新跳回过去
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
    // 首帧就把五档铺出来：否则进页后的第一秒盘口是全空的，像没连上
    this.refreshAllQuotes()
    if (saved) this.restoreRestingOrders()
    // 模块单例常驻：构造即启动，页面卸载不停（挂机语义见 start/stop 注释）
    this.startEngine()
  }

  /* ═══════════════ 生命周期与广播 ═══════════════ */

  /**
   * 页面挂载通知：确保引擎在跑，并按真实流逝时间补算离开页面期间漏掉的拍。
   * 引擎本身由模块单例持有（构造时启动），这里**不会**重复建定时器。
   */
  start(): void {
    this.startEngine()
    this.catchUp()
  }

  /**
   * 页面卸载通知。**不停止行情引擎**（2026-11-03 船长要求挂机语义：离开页面行情继续走），
   * 只顺手落一次盘，让刷新/重进时能接着玩。
   */
  stop(): void {
    this.persist()
  }

  /** 引擎只建一次定时器；监听器也只挂一次（模块单例，页面反复进出不会叠加） */
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

  /**
   * 按真实流逝时间补算（页面卸载/标签页后台/整机休眠后回来）。
   * 单次最多补 `MAX_CATCHUP_TICKS` 拍；超过上限的时间**直接丢弃**而不是排队补，
   * 否则切回页面要同步跑几万拍、界面会卡死（船长要求「避免长时间后台卡顿」）。
   */
  private catchUp(): void {
    const now = Date.now()
    const elapsed = Math.floor((now - this.lastStepWall) / 1000)
    if (elapsed <= 0) return
    const ticks = Math.min(elapsed, MAX_CATCHUP_TICKS)
    this.lastStepWall = elapsed > MAX_CATCHUP_TICKS ? now : this.lastStepWall + elapsed * 1000
    // 超过补算上限的时间直接跳过：把跳过的秒数补进 startTs，保证之后 K 线的桶仍落在真实时钟上
    if (elapsed > MAX_CATCHUP_TICKS) this.startTs += (elapsed - MAX_CATCHUP_TICKS) * 1000
    this.advance(ticks)
  }

  /** 连续跑 N 拍，只在最后广播一次 tick（补算时避免 N 次 React 重渲染） */
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

  /** 建 8 只标的的行情模型与六周期历史（有持久化状态时续上价格/模型状态） */
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
  }

  private seedOpeningNews(): void {
    this.news.push({
      id: 'NEWS-0',
      ts: this.ts(),
      title: '证券交易所开始试营业',
      body: '八家上市公司挂牌，行情每 1 秒刷新一次。本页为原型，虚拟资金不写入存档。',
      tone: 'info',
      codes: STOCK_DEFS.map((s) => s.code),
    })
  }

  /** 刷新后把挂单重新放回簿上（**不撮合**：挂了一夜的单不能按当前盘口立刻成交，否则账对不上） */
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
    if (saved.bond && Number.isFinite(saved.bond.principal)) this.bond = { ...saved.bond }
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
      bond: { ...this.bond },
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
      // 存储被禁/配额满：原型不因持久化失败而停摆
    }
  }

  private clearPersisted(): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(MOCK_SAVE_KEY)
    } catch {
      // 同上
    }
  }

  /**
   * 重置模拟账户（页面「重置模拟账户」按钮）：回到 1,000 万本金、清空持仓/委托/策略/流水，
   * 行情从锚点重新起跑。与游戏存档无关（数据只在本文件的 localStorage 键里）。
   */
  resetAccount(): void {
    this.clearPersisted()
    this.rng = createRng(this.seed)
    this.cash = START_CASH
    this.frozen = 0
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
    this.bond = { principal: 0, accrued: 0, purchasedAt: null, rateDaily: BOND_DAILY_RATE }
    this.buildStocks(this.startTs, null)
    this.indexOpen = this.indexValue()
    this.indexHigh = this.indexOpen
    this.indexLow = this.indexOpen
    this.seedOpeningNews()
    this.refreshAllQuotes()
    this.persist()
    this.emitTick()
  }

  /** 六周期图表数据（同步：页面每 tick 取一次，避免整页快照携带 6×400×4 根 K 线） */
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
    // 原型页用同步快照，不消费 subscription；保留实现只为契约完整（真机换成 WS 帧）
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
    // 补算期间不广播：后台一次补 3600 拍时，强平/条件单提示会连弹几十条
    if (this.silent) return
    const set = this.handlers.get(type)
    if (!set) return
    for (const cb of set) {
      try {
        cb(payload)
      } catch {
        // 回调异常不能打断行情引擎（否则整页停摆）
      }
    }
  }

  private emitTick(): void {
    for (const cb of this.tickListeners) {
      try {
        cb()
      } catch {
        /* 同上 */
      }
    }
    for (const cb of this.subscribers) {
      try {
        cb({ type: 'price', ts: this.ts(), tick: this.tick })
      } catch {
        /* 同上 */
      }
    }
  }

  /* ═══════════════ 一拍 ═══════════════ */

  private ts(): number {
    return this.startTs + this.tick * 1000
  }

  private step(): void {
    this.tick += 1
    const ts = this.ts()
    // 事件排在行情之前：本拍就能看到价格跳变，否则玩家会先看到新闻、下一秒才见行情
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
    this.accrueBond()
    this.maybePayDividends(ts)
    const index = this.indexValue()
    this.indexHigh = Math.max(this.indexHigh, index)
    this.indexLow = Math.min(this.indexLow, index)
  }

  /* ═══════════════ 行情与指数 ═══════════════ */

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

  /** 指数：按初始市值权重加权 8 只标的，基点 1000（原型自造，不接服务端指数） */
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

  /**
   * 某标的被挂单锁定的卖出股数（股票仍在现货持仓里，只是不可再卖）。
   * 为什么按订单现算而不是维护一个全局计数：全局数分不清是哪只票锁的，
   * 多标的挂单时会扣错仓——这里订单量很小，扫一遍足够。
   */
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

  /**
   * 市价单的参考成交价：买看卖一、卖看买一。
   * 为什么不用中间价：MAX/资金校验若按中间价算，市价买会被价差顶穿几十个基点，
   * 用「花光可用资金」时现金会小负——玩家会以为平台算错账。
   */
  private refPriceFor(st: StockState, side: Side): number {
    const snap = st.book.snapshot(this.ts(), 1)
    const level = side === 'buy' ? snap.asks[0] : snap.bids[0]
    return level?.price ?? st.price
  }

  /* ═══════════════ 挂单同步（玩家挂单被做市商/自己穿价成交） ═══════════════ */

  /**
   * 簿内剩余量与本地订单对账。
   *
   * 为什么不用撮合返回的 fills 直接回写：玩家挂单既可能被做市商报价穿价成交，也可能被
   * 自己另一笔反向单吃掉（原型只有一个账户）。统一以「簿内剩余量」为准，两种路径都不会漏账，
   * 成交价就是挂单价（maker 价），与撮合规则一致。
   */
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
      // 挂单时已把「数量 × 价 × (1+费)」从现金挪进冻结，成交只消耗冻结
      const release = cost * (1 + FEE_RATE)
      this.frozen = Math.max(0, this.frozen - release)
      order.frozenCash = Math.max(0, order.frozenCash - release)
      this.spotAdd(order.code, qty, price)
    } else {
      // 挂单时股票没动过（只锁可卖额度），成交这一刻才真正扣股
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

  /* ═══════════════ 下单 ═══════════════ */

  async placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    return this.placeOrderInternal(req, 'manual')
  }

  /**
   * 下单前馈（设计稿 6.2）：界面每次输入都调它，因此必须**不产生副作用**。
   * 强平价与「最多可开 N 股」都在这里算，避免界面自己复制公式后与撮合口径分叉。
   */
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
    const isLeverage = leverage > 1
    const posSide: 'long' | 'short' = req.side === 'sell' ? 'short' : 'long'
    const marketPrice = this.refPriceFor(st, req.side)
    const price = req.type === 'market' ? marketPrice : (req.price ?? marketPrice)
    const safePrice = Math.max(0.01, price)
    const qty = req.qty
    const notional = safePrice * qty
    const fee = notional * FEE_RATE
    const hold = this.spot.get(req.code)?.qty ?? 0
    // 挂单卖出只锁"可卖"额度：这里按「持仓 − 已锁」给上限，否则 MAX 会把锁定股再卖一次
    const availableSpot = Math.max(0, hold - this.lockedSharesOf(req.code))
    // 市价单预留 1% 吃档缓冲，MAX 才不会被逐档成交顶穿现金（同 placeSpot 的校验口径）
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
    const liq = isLeverage ? M.liquidationPrice(posSide, safePrice, leverage) : null
    const distance = liq !== null ? M.liquidationDistancePct(posSide, safePrice, liq) : null
    let blockReason: string | null = null
    const existing = this.positions.get(`${req.code}:${posSide}`)
    if (!Number.isInteger(qty) || qty <= 0) blockReason = T.toastInvalidQty
    else if (!(price > 0) || !Number.isFinite(price)) blockReason = T.toastInvalidPrice
    else if (isLeverage && leverage > st.def.maxLeverage) {
      blockReason = `${T.leverageUnavailable}（最高 ${st.def.maxLeverage}x）`
    } else if (isLeverage && req.side === 'sell' && !st.def.shortable) blockReason = T.noShort
    else if (isLeverage && req.reduceOnly !== true && existing && existing.leverage !== leverage) {
      // 同一方向已有仓位且杠杆不同：原型不做逐仓拆分，直接在前馈里说清楚
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
    if (leverage > 1 && req.side === 'sell' && !st.def.shortable) {
      throw new ExchangeError('not_shortable', T.noShort)
    }
    if (req.type === 'stop' || req.type === 'take_profit') {
      return this.placeTrigger(req, st, leverage, source)
    }
    if (req.type === 'market') {
      const marketPrice = this.refPriceFor(st, req.side)
      return leverage > 1
        ? this.placeLeverage(req, st, leverage, marketPrice, source, true)
        : this.placeSpot(req, st, marketPrice, source, true)
    }
    const price = req.price
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      throw new ExchangeError('bad_price', T.toastInvalidPrice)
    }
    const safePrice = round(price, 2)
    return leverage > 1
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

  /** 现货：市价吃簿；限价未成交部分留簿并冻结现金/股票 */
  private placeSpot(
    req: PlaceOrderRequest,
    st: StockState,
    price: number,
    source: OrderSource,
    market: boolean,
  ): OrderState {
    const ts = this.ts()
    const order = this.newOrder(req, 1, market ? null : price, ts, source)
    // 市价单会逐档吃上去：校验按买一/卖一 +1% 缓冲，避免"MAX 买完现金小负"
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
        // 挂单卖出只锁"可卖"额度，股票仍留在现货持仓里（否则权益会凭空少一截）
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

  /**
   * 杠杆：原型按 IOC 处理（吃不满就撤余量）。
   * 为什么不留簿：逐仓保证金要在成交那一刻锁定，留簿还要冻结保证金、支持改价/撤单，
   * 原型阶段性价比低；委托列表里看到的是"已成交/已撤销"，不影响强平与权益的可玩性。
   */
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

  /* ═══════════════ 平仓 / 强平 ═══════════════ */

  async closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void> {
    const pos = this.positions.get(`${code}:${side}`)
    if (!pos) throw new ExchangeError('no_position', T.toastNoPosition)
    this.closeInternal(code, side, qty ?? pos.qty, this.ts(), 'manual')
  }

  /**
   * 平仓：市价吃簿，吃不满的部分按标记价强制结算（服务端 6.3 接受滑点的口径）。
   * 返回实际平掉的股数与成交均价，供调用方（条件单/策略/强平）回写订单。
   */
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
    const res = st.book.submit(takerSide, closeQty, null, 'player', source, ts, false)
    let filledQty = closeQty - res.order.qty
    let filledValue = 0
    for (const f of res.fills) filledValue += f.price * f.qty
    if (filledQty < closeQty) {
      // 盘口不够深：剩余按标记价结算（原型不追求逐笔滑点归因）
      const rest = closeQty - filledQty
      filledValue += rest * st.price
      filledQty = closeQty
    }
    const avg = filledValue / closeQty
    const pnl = M.unrealizedPnl(side, pos.entry, avg, closeQty)
    const marginRelease = (pos.margin * closeQty) / pos.qty
    const fee = avg * closeQty * FEE_RATE
    this.cash += marginRelease + pnl - fee
    pos.margin -= marginRelease
    pos.qty -= closeQty
    if (pos.qty <= 1e-9) this.positions.delete(key)
    this.tradeSeq += 1
    this.myTrades.unshift({
      id: `MT-${this.tradeSeq}`,
      ts,
      code,
      price: round(avg, 2),
      qty: closeQty,
      side: takerSide,
      source,
    })
    if (this.myTrades.length > 200) this.myTrades.splice(200)
    return { qty: closeQty, avg }
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
      // 权益归零 ⇒ 一次清完；否则按 30% 分片，连续 3 拍还没清完就按标记价结算剩余
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
        // 极端情况（簿空 + 价格异常）跳过本拍，下一拍再判
      }
    }
  }

  /* ═══════════════ 条件单 ═══════════════ */

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
        // 平不掉就保持 pending，下一拍再试（不丢单）
      }
    }
  }

  /* ═══════════════ 量化策略 ═══════════════ */

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

  /* ═══════════════ 债券 / 分红 ═══════════════ */

  private accrueBond(): void {
    if (this.bond.principal <= 0) return
    this.bond.accrued += (this.bond.principal * BOND_DAILY_RATE) / TICKS_PER_GAME_DAY
  }

  buyBond(amountValue: number): BondHolding {
    const value = round(amountValue, 2)
    if (!(value > 0)) throw new ExchangeError('bad_amount', T.toastBondInvalid)
    if (value > this.cash) throw new ExchangeError('insufficient_cash', TF.bondNoCash)
    this.cash -= value
    this.bond.principal += value
    if (this.bond.purchasedAt === null) this.bond.purchasedAt = this.ts()
    return { ...this.bond }
  }

  redeemBond(): number {
    const total = this.bond.principal + this.bond.accrued
    if (total <= 0) return 0
    this.cash += total
    this.bond = { principal: 0, accrued: 0, purchasedAt: null, rateDaily: BOND_DAILY_RATE }
    return total
  }

  /** 保底基金（模拟盘）：用 nonce 哈希决定输赢，规则与线上一致（盈 3×、亏 1× 债券分钟利息）。 */
  async playFund(amountValue: number, nonce: string): Promise<FundPlayResult> {
    const amountValueFloor = Math.floor(amountValue)
    if (!(amountValueFloor > 0)) throw new ExchangeError('bad_amount', T.cashierInvalidAmount)
    if (amountValueFloor > this.cash) throw new ExchangeError('insufficient_cash', T.fundNoCash)
    const rateBp = Math.round(BOND_DAILY_RATE * 10_000)
    // FNV-1a：确定性、无 Math.random（引擎禁用裸随机）。
    let hash = 2_166_136_261
    const seed = `${nonce}:${this.ts()}`
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i)
      hash = Math.imul(hash, 16_777_619) >>> 0
    }
    const win = hash % 2 === 0
    const interest = Math.floor((amountValueFloor * rateBp) / 10_000)
    const profit = win ? interest * 3 : -interest
    this.cash += profit
    return {
      win,
      amount: amountValueFloor,
      profit,
      rateBp,
      evidence: `mock/nonce=${nonce.slice(0, 8)}`,
      cash: this.cash,
    }
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

  /* ═══════════════ 事件与快讯 ═══════════════ */

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

  /* ═══════════════ 账户与快照 ═══════════════ */

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
    const equity = this.cash + this.frozen + holdingsValue + positionsEquity + this.bond.principal + this.bond.accrued
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
      bonds: { ...this.bond },
      bondProduct: { ...BOND_PRODUCT },
      news: this.news.slice(0, 12),
      feeRate: FEE_RATE,
    }
  }

  /* ═══════════════ 查询 / 资金 / 撤单 ═══════════════ */

  async getStocks(): Promise<StockQuote[]> {
    return [...this.stocks.values()].map((s) => this.quoteOf(s))
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
    // 5 分钟线由 M1 现聚合（服务端契约里的 5m 档；原型不单独维护序列）
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
    // 与真实服务器 deductForWithdraw 对齐：出金只校验 cash >= amount，不额外收手续费
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
      // 挂单时只锁额度、没动持仓 ⇒ 撤单只需解锁
      order.frozenShares = 0
    }
    order.status = 'cancelled'
  }
}

