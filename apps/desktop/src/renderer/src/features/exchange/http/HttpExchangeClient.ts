/**
 * HTTP / 联机适配器（2026-11-03 联机批：按 Go 交易所真实契约对齐）。
 *
 * 硬约束不变：本文件**不直接**调用 `fetch` / `WebSocket` —— 一切请求与推送都经注入的
 * `Transport`（F1 由 `factory.ts` 自动装配 `RendererTransport`，F0 的占位实现是
 * `NotConnectedTransport`）。这样将来若改走桌面主进程 IPC，只换 Transport 一处。
 *
 * 同步快照策略：页面每秒读 `getSnapshot()`，每拍都发 REST 会乱序且昂贵 ⇒ 适配器维护
 * 订阅缓存，`getSnapshot()` 只读缓存；`start()` 拉一次全量快照并用 `subscribe()` 跟在后面。
 *
 * 契约对齐（2026-11-03 回合制，以 `whale-server-go/internal/exchange/api.go` 为准）：
 *   - `GET  /round` → `{roundNo,startedAt,nextRoundAt,locked,maxOrders,usedOrders,roundSec,lockSec,serverTime}`
 *   - `GET  /orders` → **裸数组** OrderView[]（G0 的 `/orders/mine` 是 `{orders:[]}` 别名）
 *   - `POST /orders` → `PlaceOrderResponse`（OrderView 字段**扁平**在顶层 + `trades/replayed/selfTradeBlocked`）
 *   - `POST /orders/batch` → `{roundNo,status,accepted,maxOrders,usedOrders,orders[]}`
 *   - `DELETE /orders/{id}` → `{orderId,status}`
 *   - `GET /account` → `{cash,frozen,debt,equity,marginRatio,creditGrade,positions,holdings,openOrders,pendingWithdrawals}`
 *   - WS `/stream` → `{type,data}`；type ∈ round/stocks/book/trades/account/orders/event，
 *     其中 `stocks` 是数组、`trades` 是「该标的的成交数组」、`book` 是单标的盘口。
 *   - `GET  /news?limit=20` → **裸数组** NewsItem[]（新→旧；WS `event` 只推本回合增量，
 *     首屏靠这次补拉，两者按 id 去重合并）。
 *   - 价格/金额**不做缩放**：服务器整数单位就是信用点，显示交给现有 UI（`format.ts`）。
 */
import type {
  AgentView,
  BatchOrderResult,
  BookLevel,
  BondPosition,
  BondProduct,
  ChartPeriod,
  DepositResult,
  DividendRecord,
  ExchangeAccount,
  ExchangeClient,
  ExchangeEventType,
  ExchangeOrder,
  ExchangeSnapshot,
  ExchangeTopic,
  FundPosition,
  IndexQuote,
  Kline,
  NewsItem,
  OrderBookSnapshot,
  OrderPreview,
  OrderSource,
  PlaceOrderRequest,
  RoundInfo,
  SpotHolding,
  StockQuote,
  StrategySpec,
  TradeRecord,
  TradeSource,
  Unsubscribe,
  WithdrawResult,
} from '../client'
import { bucketStart } from '../chartPeriods'
import { ExchangeError } from '../errors'
import { T } from '../texts'
import { tr } from '../../../i18n/locale'
import type { Transport } from './transport'

const CONTRACT_VERSION = 1
/** 与 Mock 同口径的默认手续费率（服务器 `meta` 下发时以服务器为准） */
const DEFAULT_FEE_RATE = 0.0005
/** 回合制默认配额（服务器 `/round`、`/meta` 下发时以服务器为准） */
const DEFAULT_MAX_ORDERS = 10
/** 首屏快讯条数（`GET /news?limit=`）与缓存上限（WS 实时帧与首屏历史共用一份缓存） */
const NEWS_FETCH_LIMIT = 20
const NEWS_CACHE_LIMIT = 30

const EMPTY_INDEX: IndexQuote = { value: 1000, changePct: 0, high: 1000, low: 1000 }

const EMPTY_BOND_POSITION: BondPosition = {
  principal: 0,
  accrued: 0,
  value: 0,
  settledMinute: 0,
  openedAt: 0,
  minutes: 0,
  minuteBp: 3,
  cash: 0,
}

/** 基金空仓占位：本金与收益为 0，供左侧活动栏判断「是否已申购」 */
const EMPTY_FUND_POSITION: FundPosition = {
  principal: 0,
  accrued: 0,
  value: 0,
  settledMinute: 0,
  openedAt: 0,
  minutes: 0,
  winBp: 16,
  loseBp: -7,
  winPercent: 70,
  expectedBp: 9,
  bondBp: 3,
  cash: 0,
}

const EMPTY_BOND_PRODUCT: BondProduct = {
  id: 'WHALE-BOND',
  name: '舰船债券 · 稳健型',
  dailyRate: 0.0003,
  note: '联机产品以服务器配置为准',
}

/** 前端主题 → Go WS topics（K 线不推送，随回合快照刷新） */
const SERVER_TOPIC: Record<ExchangeTopic, string | null> = {
  book: 'book',
  trade: 'trades',
  price: 'stocks',
  kline: null,
  position: 'account',
  margin: 'account',
  event: 'event',
}

const ORDER_STATUSES: ReadonlySet<ExchangeOrder['status']> = new Set<ExchangeOrder['status']>([
  'open',
  'partial',
  'filled',
  'cancelled',
  'rejected',
  'trigger_pending',
  'queued',
  'expired',
])

const ORDER_TYPES = new Set<string>(['limit', 'market', 'stop', 'take_profit', 'conditional'])
const ORDER_SOURCES: ReadonlySet<OrderSource> = new Set<OrderSource>([
  'manual',
  'strategy',
  'conditional',
  'liquidation',
])
const TRADE_SOURCES: ReadonlySet<TradeSource> = new Set<TradeSource>([
  'manual',
  'strategy',
  'conditional',
  'liquidation',
  'mm',
])

/* ═══════════════ 解析小工具（服务端字段 → 前端 DTO） ═══════════════ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeOrder(raw: unknown): ExchangeOrder | null {
  if (!isRecord(raw)) return null
  const id =
    typeof raw.id === 'string' ? raw.id : typeof raw.id === 'number' ? String(raw.id) : ''
  const code = text(raw.code)
  if (id === '' || code === '') return null
  const side = raw.side === 'sell' ? 'sell' : raw.side === 'buy' ? 'buy' : null
  if (side === null) return null
  const status: ExchangeOrder['status'] =
    typeof raw.status === 'string' && ORDER_STATUSES.has(raw.status as ExchangeOrder['status'])
      ? (raw.status as ExchangeOrder['status'])
      : // 未知状态不能吞掉订单，按「挂单中」保守显示
        'open'
  const type =
    typeof raw.type === 'string' && ORDER_TYPES.has(raw.type)
      ? (raw.type as ExchangeOrder['type'])
      : 'limit'
  const source: OrderSource =
    typeof raw.source === 'string' && ORDER_SOURCES.has(raw.source as OrderSource)
      ? (raw.source as OrderSource)
      : 'manual'
  const order: ExchangeOrder = {
    id,
    clientOrderId: text(raw.clientOrderId),
    code,
    side,
    type,
    price: typeof raw.price === 'number' && Number.isFinite(raw.price) ? raw.price : null,
    qty: num(raw.qty),
    qtyRemaining: num(raw.qtyRemaining),
    leverage: Math.max(1, Math.round(num(raw.leverage, 1))),
    status,
    createdAt: num(raw.createdAt),
    source,
    filledQty: num(raw.filledQty),
    reduceOnly: raw.reduceOnly === true,
  }
  if (typeof raw.triggerPrice === 'number' && Number.isFinite(raw.triggerPrice)) {
    order.triggerPrice = raw.triggerPrice
  }
  // 委托管理列表要按回合分组、区分「开空」与「卖出」，这两个字段不能丢。
  const roundNo = num(raw.roundNo, 0)
  if (roundNo > 0) order.roundNo = Math.round(roundNo)
  if (raw.short === true) order.short = true
  return order
}

function normalizeTrade(raw: unknown): TradeRecord | null {
  if (!isRecord(raw)) return null
  const code = text(raw.code)
  const price = num(raw.price, Number.NaN)
  const qty = num(raw.qty, Number.NaN)
  if (code === '' || !Number.isFinite(price) || !Number.isFinite(qty)) return null
  const id =
    typeof raw.id === 'string'
      ? raw.id
      : typeof raw.id === 'number'
        ? String(raw.id)
        : `${code}:${num(raw.ts)}:${price}:${qty}`
  const source: TradeSource =
    typeof raw.source === 'string' && TRADE_SOURCES.has(raw.source as TradeSource)
      ? (raw.source as TradeSource)
      : 'manual'
  return {
    id,
    ts: num(raw.ts),
    code,
    price,
    qty,
    side: raw.side === 'sell' ? 'sell' : 'buy',
    source,
  }
}

function normalizeStock(raw: unknown): StockQuote | null {
  if (!isRecord(raw)) return null
  const code = text(raw.code)
  if (code === '') return null
  const price = num(raw.price)
  return {
    code,
    nameKey: text(raw.nameKey) !== '' ? text(raw.nameKey) : code,
    sector: text(raw.sector) !== '' ? text(raw.sector) : '—',
    price,
    open: num(raw.open, price),
    high: num(raw.high, price),
    low: num(raw.low, price),
    prevClose: num(raw.prevClose, num(raw.basePrice, price)),
    changePct: num(raw.changePct),
    volume24h: num(raw.volume24h),
    maxLeverage: Math.max(1, Math.round(num(raw.maxLeverage, 1))),
    shortable: raw.shortable === true,
    halted: raw.halted === true,
    anchor: num(raw.anchor, price),
    floatShares: num(raw.floatShares),
  }
}

function normalizeBookLevel(raw: unknown): BookLevel | null {
  if (!isRecord(raw)) return null
  const price = num(raw.price, Number.NaN)
  const qty = num(raw.qty, Number.NaN)
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null
  return { price, qty }
}

function normalizeBook(raw: unknown, fallbackCode: string): OrderBookSnapshot | null {
  if (!isRecord(raw)) return null
  const code = text(raw.code) !== '' ? text(raw.code) : fallbackCode
  if (code === '') return null
  return {
    code,
    bids: Array.isArray(raw.bids) ? raw.bids.map(normalizeBookLevel).filter(isPresent) : [],
    asks: Array.isArray(raw.asks) ? raw.asks.map(normalizeBookLevel).filter(isPresent) : [],
    ts: num(raw.ts, Date.now()),
  }
}

function normalizeHolding(raw: unknown): SpotHolding | null {
  if (!isRecord(raw)) return null
  const code = text(raw.code)
  if (code === '') return null
  const holding: SpotHolding = {
    code,
    qty: num(raw.qty),
    avgCost: num(raw.avgCost),
    value: num(raw.value),
  }
  if (typeof raw.availableQty === 'number' && Number.isFinite(raw.availableQty)) {
    holding.availableQty = raw.availableQty
  }
  return holding
}

function normalizeAccount(raw: unknown): ExchangeAccount | null {
  if (!isRecord(raw)) return null
  return {
    cash: num(raw.cash),
    frozen: num(raw.frozen),
    debt: num(raw.debt),
    equity: num(raw.equity),
    marginRatio: num(raw.marginRatio),
    creditGrade: Math.round(num(raw.creditGrade, 3)),
    // G1 现货：服务端 `positions` 固定空数组；保留解析入口，将来杠杆仓直接接。
    positions: Array.isArray(raw.positions)
      ? (raw.positions.filter(isRecord) as unknown as ExchangeAccount['positions'])
      : [],
    pendingWithdrawals: Array.isArray(raw.pendingWithdrawals)
      ? (raw.pendingWithdrawals.filter(isRecord) as unknown as ExchangeAccount['pendingWithdrawals'])
      : [],
    holdings: Array.isArray(raw.holdings) ? raw.holdings.map(normalizeHolding).filter(isPresent) : [],
  }
}

function normalizeRound(raw: unknown): RoundInfo | null {
  if (!isRecord(raw)) return null
  const roundNo = num(raw.roundNo, Number.NaN)
  if (!Number.isFinite(roundNo) || roundNo < 0) return null
  const round: RoundInfo = {
    roundNo,
    startedAt: num(raw.startedAt),
    nextRoundAt: num(raw.nextRoundAt),
    locked: raw.locked === true,
    maxOrders: Math.max(1, Math.round(num(raw.maxOrders, DEFAULT_MAX_ORDERS))),
    roundSec: num(raw.roundSec, 300),
    lockSec: num(raw.lockSec, 10),
    serverTime: num(raw.serverTime, Date.now()),
  }
  // WS 广播是公共回合视图，不含 usedOrders：保持 undefined，别伪造 0 覆盖本地配额。
  if (typeof raw.usedOrders === 'number' && Number.isFinite(raw.usedOrders)) {
    round.usedOrders = raw.usedOrders
  }
  return round
}

function normalizeNews(raw: unknown): NewsItem | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  // 船长指令（2026-11-04）：快讯中关于人格的文案都要去掉，AG- 开头的人格行为快讯直接不接收
  if (id.startsWith('AG-')) return null
  const title = text(raw.title)
  const body = text(raw.body)
  if (id === '' && title === '') return null
  if (title.includes('人格') || body.includes('人格')) return null
  // 后端 tone ∈ good/bad/neutral；前端 DTO 只有 good/bad/warn/info，
  // `neutral` 与未知值一并归到 `info`（快讯栏按中性色渲染，不引入新 tone）。
  const tone =
    raw.tone === 'good' || raw.tone === 'bad' || raw.tone === 'warn'
      ? raw.tone
      : 'info'
  return {
    id: id !== '' ? id : `event:${num(raw.ts)}:${title}`,
    ts: num(raw.ts),
    title,
    body: text(raw.body),
    tone,
    codes: Array.isArray(raw.codes) ? raw.codes.filter((code): code is string => typeof code === 'string') : [],
  }
}

/** 人格摘要（`agents` 帧）：字段缺失时用空值兜底，不让单个人格脏数据拖垮整帧。 */
function normalizeAgent(raw: unknown): AgentView | null {
  if (!isRecord(raw)) return null
  const persona = text(raw.persona)
  if (persona === '') return null
  const holdings = Array.isArray(raw.holdings)
    ? raw.holdings.filter(isRecord).map((item) => ({
        code: text(item.code),
        qty: num(item.qty),
        avgCost: num(item.avgCost),
        price: num(item.price),
        value: num(item.value),
      }))
    : []
  const recentActions = Array.isArray(raw.recentActions)
    ? raw.recentActions.filter(isRecord).map((item) => ({
        id: num(item.id),
        roundNo: num(item.roundNo),
        code: text(item.code),
        side: text(item.side),
        qty: num(item.qty),
        price: num(item.price),
        reason: text(item.reason),
        createdAt: num(item.createdAt),
      }))
    : []
  return {
    persona,
    name: text(raw.name),
    callsign: text(raw.callsign),
    role: text(raw.role),
    mood: text(raw.mood),
    cash: num(raw.cash),
    frozen: num(raw.frozen),
    initialCash: num(raw.initialCash),
    positionValue: num(raw.positionValue),
    equity: num(raw.equity),
    pnl: num(raw.pnl),
    lastRound: num(raw.lastRound),
    lastActionAt: num(raw.lastActionAt),
    holdings,
    recentActions,
  }
}

function normalizeStrategy(raw: unknown): StrategySpec | null {
  if (!isRecord(raw)) return null
  const template = text(raw.template)
  const code = text(raw.code)
  if (template === '' || code === '') return null
  const params = isRecord(raw.params)
    ? (raw.params as Record<string, number | string | boolean>)
    : {}
  const strategy: StrategySpec = {
    template: template as StrategySpec['template'],
    code,
    params,
    enabled: raw.enabled === true,
  }
  if (typeof raw.id === 'string' && raw.id !== '') strategy.id = raw.id
  if (isRecord(raw.runtime)) {
    strategy.runtime = {
      lastRound: num(raw.runtime.lastRound),
      events: Array.isArray(raw.runtime.events) ? raw.runtime.events.filter(isRecord).map((event) => ({
        roundNo: num(event.roundNo), ts: num(event.ts), status: text(event.status), reason: text(event.reason),
        side: event.side === 'sell' ? 'sell' : 'buy', qty: num(event.qty), filledQty: num(event.filledQty), orderId: num(event.orderId),
      })) : [],
    }
  }
  return strategy
}

/**
 * 指数条：Go 不提供指数接口（`/stocks` 只有 4 只标的），这里按**等权价格比率**合成，
 * 基准 1000。只是读数的派生逻辑，不改 UI 结构；换成服务器指数接口时删掉本函数即可。
 */
function deriveIndex(stocks: StockQuote[]): IndexQuote {
  if (stocks.length === 0) return EMPTY_INDEX
  const base = 1000
  let ratioSum = 0
  let highSum = 0
  let lowSum = 0
  let count = 0
  for (const stock of stocks) {
    const reference = stock.prevClose > 0 ? stock.prevClose : stock.price
    if (reference <= 0) continue
    ratioSum += stock.price / reference
    highSum += (stock.high > 0 ? stock.high : stock.price) / reference
    lowSum += (stock.low > 0 ? stock.low : stock.price) / reference
    count += 1
  }
  if (count === 0) return EMPTY_INDEX
  const ratio = ratioSum / count
  return {
    value: base * ratio,
    changePct: (ratio - 1) * 100,
    high: base * (highSum / count),
    low: base * (lowSum / count),
  }
}

function emptyAccount(): ExchangeAccount {
  return {
    cash: 0,
    frozen: 0,
    debt: 0,
    equity: 0,
    marginRatio: 0,
    creditGrade: 3,
    positions: [],
    pendingWithdrawals: [],
    holdings: [],
  }
}

function emptyQuote(code: string): StockQuote {
  return {
    code,
    nameKey: code,
    sector: '—',
    price: 0,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    changePct: 0,
    volume24h: 0,
    maxLeverage: 1,
    shortable: false,
    halted: true,
    anchor: 0,
    floatShares: 0,
  }
}

/** 把服务端基础周期 K 线按倍数聚合成更大周期的 OHLCV（H5/D5/D35 用）。 */
function aggregateKlines(rows: Kline[], factor: number): Kline[] {
  if (factor <= 1 || rows.length === 0) return rows
  const out: Kline[] = []
  for (let i = 0; i < rows.length; i += factor) {
    const group = rows.slice(i, i + factor)
    const first = group[0]!
    const last = group[group.length - 1]!
    let high = first.h
    let low = first.l
    let volume = 0
    for (const bar of group) {
      if (bar.h > high) high = bar.h
      if (bar.l < low) low = bar.l
      volume += bar.v
    }
    out.push({ t: first.t, o: first.o, h: high, l: low, c: last.c, v: volume })
  }
  return out
}

export class HttpExchangeClient implements ExchangeClient {
  readonly contractVersion = CONTRACT_VERSION

  private readonly transport: Transport
  private readonly basePath: string
  private readonly tickListeners = new Set<() => void>()
  private readonly handlers = new Map<ExchangeEventType, Set<(payload: unknown) => void>>()
  private streamUnsub: Unsubscribe | null = null

  private tick = 0
  private ts = Date.now()
  private stocks: StockQuote[] = []
  private books = new Map<string, OrderBookSnapshot>()
  private trades = new Map<string, TradeRecord[]>()
  /** 图表缓存：键 = `${code}:${period}`（六周期各一份；服务端不给指标，前端现算） */
  private chartCache = new Map<string, Kline[]>()
  private account: ExchangeAccount = emptyAccount()
  private orders: ExchangeOrder[] = []
  private accountHolds = 0
  private heldAccount: ExchangeAccount | null = null
  private heldOrders: ExchangeOrder[] | null = null
  private heldTrades: TradeRecord[] | null = null
  private heldBond: BondPosition | null = null
  private heldFund: FundPosition | null = null
  private round: RoundInfo | null = null
  private myTrades: TradeRecord[] = []
  private dividends: DividendRecord[] = []
  private strategies: StrategySpec[] = []
  private bond: BondPosition = { ...EMPTY_BOND_POSITION }
  private funds: FundPosition = { ...EMPTY_FUND_POSITION }
  private bondProduct: BondProduct = { ...EMPTY_BOND_PRODUCT }
  private news: NewsItem[] = []
  /** 六人格公开摘要：只在回合末 `agents` 帧到达时更新，其余时间保持上一回合。 */
  private agents: AgentView[] = []
  private feeRate = DEFAULT_FEE_RATE
  /** bootstrap 进行中/最近一次时间：看门狗重试防止并发风暴 */
  private bootstrapping = false
  private lastBootstrapAt = 0
  /** 正在补拉数据的标的（防止切换标的时重复请求） */
  private symbolLoading = new Set<string>()
  /** 正在按需补拉的周期（key = code:period）：切到未缓存周期时只发一次请求 */
  private chartLoading = new Set<string>()
  private chartRequestedAt = new Map<string, number>()
  /** K 线本地缓存（7 天 TTL，跨重启秒开图表）；key = code:period */
  private chartCachedAt = new Map<string, number>()
  private chartPersistTimer = 0
  private chartsHydrated = false
  private refreshing = false
  private refreshCount = 0
  /** 上次看到的 24h 累计成交量：用增量推算本拍成交量，喂给当前 K 线桶 */
  private lastVolume24h = new Map<string, number>()
  private static readonly CHART_CACHE_KEY = 'whale-idle:exch-charts:v1'
  private static readonly CHART_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

  constructor(transport: Transport, basePath = '/api/exchange') {
    this.transport = transport
    this.basePath = basePath
  }

  /* ═══════════════ 传输原语 ═══════════════ */

  private get<T>(path: string): Promise<T> {
    return this.transport.request<T>({ method: 'GET', path: this.basePath + path })
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.transport.request<T>({ method: 'POST', path: this.basePath + path, body })
  }

  private del<T>(path: string): Promise<T> {
    return this.transport.request<T>({ method: 'DELETE', path: this.basePath + path })
  }

  /* ═══════════════ 生命周期 ═══════════════ */

  start(): void {
    if (!this.chartsHydrated) {
      this.chartsHydrated = true
      // 先灌 7 天内的本地 K 线缓存，图表秒开；随后 bootstrap 用网络数据覆盖。
      this.hydrateCharts()
    }
    if (this.streamUnsub !== null) return
    try {
      // 不传 topics/codes：Go 侧默认订阅 round/stocks/book/trades/account/orders/event 全量；
      // token 由 Transport 统一补进 query（渲染层不碰会话存储）。
      this.streamUnsub = this.transport.subscribe(this.basePath + '/stream', (payload) =>
        this.onFrame(payload),
      )
    } catch (err) {
      this.emit('error', err)
    }
    void this.bootstrap()
  }

  stop(): void {
    this.streamUnsub?.()
    this.streamUnsub = null
  }

  /**
   * 手动/看门狗重试首屏数据：HMR 半更新或首拉失败时，页面不必重启客户端即可恢复。
   * 4 秒节流 + 并发保护，避免页面空数据时每帧重试打爆服务器。
   */
  retryBootstrap(): void {
    if (this.bootstrapping) return
    if (Date.now() - this.lastBootstrapAt < 4000) return
    void this.bootstrap()
  }

  /**
   * 每分钟刷新一次行情（5 分钟回合共 5 次）：行情/账户/委托/快讯/盘口 + 全部标的 m1 K 线。
   * 玩家操作额度仍由回合决定（每回合 10 单，5 分钟共 10 手）。
   */
  async refreshMarketData(code: string): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      // 行情/账户/盘口 10 秒一次；K 线较重，每 3 次（约 30 秒）刷一次。
      const withCharts = this.refreshCount % 3 === 0
      this.refreshCount += 1
      const stocksTask = this.getStocks().catch(() => undefined)
      const [account, orders] = await Promise.all([
        this.getAccount().catch(() => null),
        this.getOrders().catch((): ExchangeOrder[] => []),
      ])
      if (account !== null) this.account = account
      this.orders = orders
      await stocksTask
      await Promise.all([
        this.loadNews().catch(() => undefined),
        this.loadBond().catch(() => undefined),
        this.loadFund().catch(() => undefined),
        // 对手盘面板跟着行情一起刷：WS `agents` 帧只在回合末来一次，页面开着不动会像卡死。
        this.loadAgents().catch(() => undefined),
        code === ''
          ? Promise.resolve()
          : this.getBook(code)
              .then((book) => this.books.set(code, book))
              .catch(() => undefined),
        ...(withCharts
          ? this.stocks.map((stock) => this.loadChart(stock.code, 'm1').catch(() => undefined))
          : []),
      ])
      this.emitTick()
    } finally {
      this.refreshing = false
    }
  }

  onTick(cb: () => void): Unsubscribe {
    this.tickListeners.add(cb)
    return () => {
      this.tickListeners.delete(cb)
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
    const set = this.handlers.get(type)
    if (!set) return
    for (const cb of set) {
      try {
        cb(payload)
      } catch {
        // 回调异常不得打断推送处理
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
  }

  private async bootstrap(): Promise<void> {
    if (this.bootstrapping) return
    this.bootstrapping = true
    this.lastBootstrapAt = Date.now()
    try {
      // 快讯不依赖行情：首屏就并发补拉（WS `event` 只推本回合增量）。
      // 失败只丢弃快讯、不阻塞主快照，也不向页面抛错。
      const newsTask = this.loadNews().catch(() => undefined)
      // 人格摘要同理：WS `agents` 只在回合末推一次，首屏补拉，否则「对手盘」要等 5 分钟。
      const agentsTask = this.loadAgents().catch(() => undefined)
      // 债券持仓：顶部「债券价值」与理财卡片都要用，首屏补拉（之后按分钟随行情刷新）。
      const bondTask = this.loadBond().catch(() => undefined)
      // 基金持仓：左侧活动栏要显示收益，首屏补拉（之后与行情同频刷新）。
      const fundTask = this.loadFund().catch(() => undefined)
      const stocks = await this.getStocks()
      const code = stocks[0]?.code
      // 行情图/盘口尽早并行：不再等 account/orders 往返后才开始拉 5 个周期 K 线，首屏更快。
      const chartTasks: Promise<unknown>[] = []
      if (code) {
        chartTasks.push(
          this.getBook(code).then((book) => this.books.set(code, book)),
          this.loadChart(code, 'm1'),
          this.loadChart(code, 'm5'),
          this.loadChart(code, 'h1'),
          this.loadChart(code, 'd1'),
          this.loadChart(code, 'd7'),
        )
      }
      // 其余三只标的的图表后台预载，玩家切股票时不再等网络。
      for (const stock of stocks.slice(1)) this.ensureSymbolData(stock.code)
      const roundTask = this.getRound().catch(() => null)
      const metaTask = this.loadMeta().catch(() => undefined)
      const [account, orders, strategies] = await Promise.all([
        this.getAccount(),
        this.getOrders().catch((): ExchangeOrder[] => []),
        this.listStrategies().catch((): StrategySpec[] => []),
      ])
      this.account = account
      this.orders = orders
      this.strategies = strategies
      await Promise.all([...chartTasks, roundTask, metaTask, newsTask, agentsTask, bondTask, fundTask])
      this.emitTick()
    } catch (err) {
      // 连不上：界面由数据源徽标 + 引导态兜底；这里只上报，不伪造数据
      this.emit('error', err)
    } finally {
      this.bootstrapping = false
    }
  }

  private async loadMeta(): Promise<void> {
    const raw = await this.get<unknown>('/meta')
    if (!isRecord(raw)) return
    const feeRate =
      typeof raw.feeRate === 'string' ? Number.parseFloat(raw.feeRate) : num(raw.feeRate, Number.NaN)
    if (Number.isFinite(feeRate) && feeRate >= 0) {
      this.feeRate = feeRate
      return
    }
    const commissionBp = num(raw.commissionBp, Number.NaN)
    if (Number.isFinite(commissionBp) && commissionBp >= 0) this.feeRate = commissionBp / 10_000
  }

  /**
   * 首屏快讯：`GET /news` 返回**裸数组** `NewsItem[]`（新→旧，后端持久化）。
   * WS `event` 每回合只推增量，所以打开页面时补拉一次历史，否则快讯栏要等下一回合才有内容。
   * 失败由调用方 `.catch` 吞掉：快讯不是主流程，不能拖垮行情/账户快照。
   */
  private async loadNews(): Promise<void> {
    const raw = await this.get<unknown>(`/news?limit=${NEWS_FETCH_LIMIT}`)
    if (!Array.isArray(raw)) return
    const items = raw
      .map(normalizeNews)
      .filter(isPresent)
      .slice(0, NEWS_FETCH_LIMIT)
    this.mergeNews(items, false)
  }

  /**
   * 首屏人格摘要：`GET /agents` 返回 `{roundNo, agents[]}`（六人格公开视图）。
   * WS `agents` 只在回合末推一次，打开页面时补拉一次，否则「对手盘」页签要等下一回合才有内容。
   * 失败由调用方 `.catch` 吞掉：人格面板是辅助信息，不能拖垮行情/账户快照。
   */
  private async loadAgents(): Promise<void> {
    const raw = await this.get<unknown>('/agents')
    if (!isRecord(raw) || !Array.isArray(raw.agents)) return
    this.agents = raw.agents.map(normalizeAgent).filter(isPresent)
    this.emitTick()
  }

  /**
   * 债券持仓：首屏与每轮行情刷新时拉一次，写入 `this.bond` 供顶部「债券价值」读。
   * 申购/赎回后的即时反馈由 `BondCard` 直接使用接口返回值，不依赖这里。
   */
  private async loadBond(): Promise<void> {
    this.bond = await this.get<BondPosition>('/bond')
  }

  /** 基金持仓：与债券同口径（首屏 + 每轮行情刷新），供左侧活动栏与卡片读。 */
  private async loadFund(): Promise<void> {
    this.funds = await this.get<FundPosition>('/fund')
  }

  /**
   * 合并快讯并按 `id` 去重：`/news` 首屏与 WS `event` 实时帧会重叠（同一回合事件已落库）。
   * `prepend = true` 用于实时帧（新条目在前）；首屏历史追加在已收到的实时条目之后。
   * 重复 `id` 保留先出现的一份，避免滚动栏里同一条快讯出现两次。
   */
  private mergeNews(items: NewsItem[], prepend: boolean): void {
    if (items.length === 0) return
    const seen = new Set<string>()
    const merged: NewsItem[] = []
    const push = (item: NewsItem): void => {
      if (seen.has(item.id)) return
      seen.add(item.id)
      merged.push(item)
    }
    if (prepend) {
      for (const item of items) push(item)
      for (const item of this.news) push(item)
    } else {
      for (const item of this.news) push(item)
      for (const item of items) push(item)
    }
    this.news = merged.slice(0, NEWS_CACHE_LIMIT)
  }

  /**
   * 推送帧：只做增量缓存。
   * 回合制下每回合末一次性广播 round/stocks/book/trades/account/orders(+event)；
   * 回合内只可能收到心跳与私有帧，`getSnapshot()` 始终读缓存。
   */
  private onFrame(payload: unknown): void {
    if (!isRecord(payload) || typeof payload.type !== 'string') return
    const data = payload.data
    switch (payload.type) {
      case 'round': {
        const round = normalizeRound(data)
        if (round !== null) this.round = round
        break
      }
      case 'stocks': {
        if (Array.isArray(data)) {
          this.stocks = data.map(normalizeStock).filter(isPresent)
          this.updateIntraCandles(this.stocks)
        }
        break
      }
      case 'book': {
        const book = normalizeBook(data, '')
        if (book !== null) {
          this.books.set(book.code, book)
          this.emit('book', data)
        }
        break
      }
      case 'trades': {
        if (Array.isArray(data)) {
          const code = this.frameCode(data)
          if (code !== null) {
            this.trades.set(code, data.map(normalizeTrade).filter(isPresent).slice(0, 100))
          }
        }
        break
      }
      case 'account': {
        const account = normalizeAccount(data)
        if (account !== null) this.account = account
        break
      }
      case 'orders': {
        const list = Array.isArray(data)
          ? data
          : isRecord(data) && Array.isArray(data.orders)
            ? data.orders
            : null
        if (list !== null) this.orders = list.map(normalizeOrder).filter(isPresent)
        break
      }
      case 'agents': {
        // 回合末广播一次的六人格摘要：{roundNo, agents[]}
        const list = isRecord(data) && Array.isArray(data.agents) ? data.agents : null
        if (list !== null) this.agents = list.map(normalizeAgent).filter(isPresent)
        break
      }
      case 'event': {
        const news = normalizeNews(data)
        if (news !== null) this.mergeNews([news], true)
        break
      }
      // ── 旧帧兼容（F0 原型口径；Go 现在发 trades 复数帧） ──
      case 'trade': {
        const trade = normalizeTrade(data)
        if (trade !== null) {
          const list = this.trades.get(trade.code) ?? []
          this.trades.set(trade.code, [trade, ...list].slice(0, 100))
          this.emit('trade', trade)
        }
        break
      }
      case 'price': {
        this.emit('price', data)
        break
      }
      case 'margin_call': {
        this.emit('margin_call', data)
        break
      }
      default:
        return
    }
    this.ts = Date.now()
    this.tick += 1
    this.emitTick()
  }

  /** 成交帧的 code 从数组第一条取（Go 按标的分别广播）。 */
  private frameCode(rows: unknown[]): string | null {
    for (const row of rows) {
      if (isRecord(row) && typeof row.code === 'string' && row.code !== '') return row.code
    }
    return null
  }

  /* ═══════════════ 图表 ═══════════════ */

  /** 周期 → 服务端基础 interval + 聚合倍数（Go 支持 1m/5m/1h/1d/1w/1mo；H5/D5/D35 走聚合）。 */
  private chartSource(period: ChartPeriod): { interval: string; agg: number } {
    if (period === 'm5') return { interval: '5m', agg: 1 }
    if (period === 'h5') return { interval: '1h', agg: 5 }
    if (period === 'd5') return { interval: '1d', agg: 5 }
    if (period === 'd35') return { interval: '1d', agg: 35 }
    if (period === 'h1') return { interval: '1h', agg: 1 }
    if (period === 'd1') return { interval: '1d', agg: 1 }
    if (period === 'd7') return { interval: '1w', agg: 1 }
    if (period === 'd30') return { interval: '1mo', agg: 1 }
    return { interval: '1m', agg: 1 }
  }

  private async loadChart(code: string, period: ChartPeriod): Promise<void> {
    const { interval, agg } = this.chartSource(period)
    // 支持 7 天完整展示（5m 级别 7 天为 2016 根），不超过服务端 2016 上限
    const limit = Math.min(2016, 2016 * agg)
    const rows = await this.get<unknown>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=${limit}`,
    )
    const bars = aggregateKlines(Array.isArray(rows) ? (rows as Kline[]) : [], agg)
    const key = `${code}:${period}`
    this.chartCache.set(key, bars)
    this.chartCachedAt.set(key, Date.now())
    if (period === 'm1' && !this.chartCache.has(`${code}:intraday`)) {
      // 分时图初始用 m1 历史切片做底，独立数组，后续由 10 秒行情步进独立追加高频点
      const initIntraday = bars.slice(-60).map((b) => ({ ...b }))
      this.chartCache.set(`${code}:intraday`, initIntraday)
      this.chartCachedAt.set(`${code}:intraday`, Date.now())
    }
    this.schedulePersistCharts()
  }

  getChartSeries(code: string, period: ChartPeriod): Kline[] {
    return this.chartCache.get(`${code}:${period}`) ?? []
  }

  /**
   * 按需补拉当前周期；有效缓存一分钟内复用，空缓存和失败请求五秒后可重试。
   * 配合图表周期 effect，覆盖预加载未包含的 H1/日/周线，并防止请求风暴。
   */
  ensureChartData(code: string, period: ChartPeriod): void {
    if (code === '') return
    const key = `${code}:${period}`
    if (this.chartLoading.has(key)) return
    const now = Date.now()
    const bars = this.chartCache.get(key)
    if (bars && bars.length > 0 && now - (this.chartCachedAt.get(key) ?? 0) < 60_000) return
    if (now - (this.chartRequestedAt.get(key) ?? 0) < 5_000) return
    this.chartRequestedAt.set(key, now)
    this.chartLoading.add(key)
    void this.loadChart(code, period)
      .then(() => this.emitTick())
      .catch(() => {
        /* 失败保留空缓存，下次切到该周期会重试 */
      })
      .finally(() => {
        this.chartLoading.delete(key)
      })
  }

  /** 启动时把 7 天内的本地 K 线缓存灌回内存：先出图，再由网络刷新覆盖。 */
  private hydrateCharts(): void {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(HttpExchangeClient.CHART_CACHE_KEY)
      if (raw === null) return
      const parsed = JSON.parse(raw) as Record<string, { t?: number; bars?: Kline[] }>
      const now = Date.now()
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry === null || typeof entry.t !== 'number' || !Array.isArray(entry.bars)) continue
        if (now - entry.t > HttpExchangeClient.CHART_CACHE_TTL_MS) continue
        this.chartCache.set(key, entry.bars)
        this.chartCachedAt.set(key, entry.t)
      }
    } catch {
      /* 缓存损坏按没有处理，不阻塞行情 */
    }
  }

  private schedulePersistCharts(): void {
    if (typeof window === 'undefined' || this.chartPersistTimer !== 0) return
    this.chartPersistTimer = window.setTimeout(() => {
      this.chartPersistTimer = 0
      this.persistCharts()
    }, 800)
  }

  private persistCharts(): void {
    try {
      const out: Record<string, { t: number; bars: Kline[] }> = {}
      for (const [key, bars] of this.chartCache) {
        out[key] = { t: this.chartCachedAt.get(key) ?? Date.now(), bars }
      }
      window.localStorage.setItem(HttpExchangeClient.CHART_CACHE_KEY, JSON.stringify(out))
    } catch {
      /* 配额/隐私模式失败不影响行情 */
    }
  }

  /**
   * 回合内 10 秒行情步进时，实时更新内存缓存中正在生成的当前 K 线（M1 / M5 / intraday 等）。
   * 让图表最右侧的活跃蜡烛针头实时上下伸缩，不需等待 30 秒 HTTP 轮询即可平滑反应价格变动。
   */
  private updateIntraCandles(quotes: StockQuote[]): void {
    const now = Date.now()
    for (const quote of quotes) {
      const p = quote.price
      if (!Number.isFinite(p) || p <= 0) continue
      // ponytail: 用 24h 累计量增量推算本拍量，跨桶调用会记到当前桶；要逐笔精确需服务端推送成交量
      const prevVolume = this.lastVolume24h.get(quote.code) ?? quote.volume24h
      const volumeDelta = Math.max(0, quote.volume24h - prevVolume)
      this.lastVolume24h.set(quote.code, quote.volume24h)
      for (const [key, bars] of this.chartCache) {
        if (!key.startsWith(`${quote.code}:`) || bars.length === 0) continue
        const periodStr = key.slice(quote.code.length + 1) as ChartPeriod
        const last = bars[bars.length - 1]
        if (!last) continue
        const bucket = bucketStart(periodStr, now)
        if (last.t === bucket) {
          last.h = Math.max(last.h, p)
          last.l = Math.min(last.l, p)
          last.c = p
          last.v += volumeDelta
        } else if (bucket > last.t) {
          bars.push({ t: bucket, o: p, h: p, l: p, c: p, v: volumeDelta })
          if (bars.length > 200) bars.shift()
        }
      }
    }
  }

  /**
   * 切换标的后补拉该标的数据：bootstrap 只拉了首只标的的 K 线/盘口，
   * 切到其它标的后不补拉就会一直显示「行情初始化中…」、盘口为空。
   * 幂等：已缓存/进行中直接返回；完成后 emitTick 触发重渲染。
   */
  ensureSymbolData(code: string): void {
    if (code === '') return
    const needChart = !this.chartCache.has(`${code}:m1`)
    const needBook = !this.books.has(code)
    if (!needChart && !needBook) return
    if (this.symbolLoading.has(code)) return
    this.symbolLoading.add(code)
    const tasks: Promise<unknown>[] = []
    if (needChart) {
      tasks.push(
        // m1 先到先渲染，其余周期后台补齐，切标的时图表不必等 5 个请求全回来。
        this.loadChart(code, 'm1').then(() => this.emitTick()),
        this.loadChart(code, 'm5'),
        this.loadChart(code, 'h5'),
        this.loadChart(code, 'd5'),
        this.loadChart(code, 'd35'),
      )
    }
    if (needBook) {
      tasks.push(
        this.getBook(code).then((book) => {
          this.books.set(code, book)
          this.emitTick()
        }),
      )
    }
    void Promise.all(tasks)
      .catch(() => undefined)
      .finally(() => {
        this.symbolLoading.delete(code)
        this.emitTick()
      })
  }

  /* ═══════════════ 查询 ═══════════════ */

  async getStocks(): Promise<StockQuote[]> {
    const raw = await this.get<unknown>('/stocks')
    const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.stocks) ? raw.stocks : null
    if (rows === null) throw new ExchangeError('malformed_response', '行情响应格式不正确')
    this.stocks = rows.map(normalizeStock).filter(isPresent)
    this.updateIntraCandles(this.stocks)
    return this.stocks
  }

  async getBook(code: string): Promise<OrderBookSnapshot> {
    const raw = await this.get<unknown>(`/book/${encodeURIComponent(code)}`)
    const book = normalizeBook(raw, code)
    if (book === null) throw new ExchangeError('malformed_response', '盘口响应格式不正确')
    this.books.set(book.code, book)
    return book
  }

  async getTrades(code: string): Promise<TradeRecord[]> {
    const raw = await this.get<unknown>(`/trades/${encodeURIComponent(code)}?limit=50`)
    const rows = Array.isArray(raw) ? raw : []
    const trades = rows.map(normalizeTrade).filter(isPresent)
    this.trades.set(code, trades)
    return trades
  }

  async getKlines(code: string, interval: '1m' | '5m' | '1h', limit = 120): Promise<Kline[]> {
    const raw = await this.get<unknown>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=${limit}`,
    )
    const rows = Array.isArray(raw) ? (raw as Kline[]) : []
    if (interval === '1m') this.chartCache.set(`${code}:m1`, rows)
    if (interval === '1h') this.chartCache.set(`${code}:h1`, rows)
    return rows
  }

  async getAccount(): Promise<ExchangeAccount> {
    const raw = await this.get<unknown>('/account')
    const account = normalizeAccount(raw)
    if (account === null) throw new ExchangeError('malformed_response', '账户信息响应格式不正确')
    this.account = account
    return account
  }

  async getOrders(): Promise<ExchangeOrder[]> {
    const raw = await this.get<unknown>('/orders')
    // 契约是裸数组；兼容 G0 别名 `{orders: []}`（服务端同时保留 /orders/mine）。
    const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.orders) ? raw.orders : null
    if (rows === null) throw new ExchangeError('malformed_response', '委托列表响应格式不正确')
    this.orders = rows.map(normalizeOrder).filter(isPresent)
    return this.heldOrders ?? this.orders
  }

  /** 回合时钟（可选接口）：拉取当前回合，WS `round` 帧也会刷新同一份缓存。 */
  async getRound(): Promise<RoundInfo> {
    const raw = await this.get<unknown>('/round')
    const round = normalizeRound(raw)
    if (round === null) throw new ExchangeError('malformed_response', '回合信息响应格式不正确')
    this.round = round
    return round
  }

  /** 同步读最近一次回合视图（WS 帧缓存）；未同步过返回 null。 */
  getRoundView(): RoundInfo | null {
    return this.round
  }

  /* ═══════════════ 交易 ═══════════════ */

  deposit(amount: number, nonce: string): Promise<DepositResult> {
    return this.post<DepositResult>('/deposit', { amount, nonce })
  }

  withdraw(amount: number, nonce: string): Promise<WithdrawResult> {
    return this.post<WithdrawResult>('/withdraw', { amount, nonce })
  }

  holdAccountUpdates(): () => void {
    if (this.accountHolds++ === 0) {
      this.heldAccount = this.account
      this.heldOrders = this.orders
      this.heldTrades = this.myTrades
      this.heldBond = this.bond
      this.heldFund = this.funds
    }
    let released = false
    return () => {
      if (released) return
      released = true
      if (--this.accountHolds === 0) {
        this.heldAccount = null
        this.heldOrders = null
        this.heldTrades = null
        this.heldBond = null
        this.heldFund = null
        this.emitTick()
      }
    }
  }

  async placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    const raw = await this.post<unknown>('/orders', req)
    if (!isRecord(raw)) throw new ExchangeError('malformed_response', '下单响应格式不正确')
    // Go 的 PlaceOrderResponse 把 OrderView 字段扁平在顶层（另外带 trades/replayed/selfTradeBlocked）；
    // 兼容将来包一层 `{order:{...}}` 的形状。
    const source = isRecord(raw.order) ? raw.order : raw
    const order = normalizeOrder(source)
    if (order === null) throw new ExchangeError('malformed_response', '下单响应缺少委托字段')
    this.upsertOrder(order)
    if (Array.isArray(raw.trades)) this.appendMyTrades(raw.trades)
    try {
      await this.refreshAccount()
    } finally {
      // 账户刷新失败也保留服务器已受理的订单，不把成功提交丢成未知状态。
      this.emitTick()
    }
    return order
  }

  /** 批量提交（可选接口）：`{orders:[...]}` → 全成全败；返回本批 `queued` 委托。 */
  async batchPlaceOrders(reqs: PlaceOrderRequest[]): Promise<BatchOrderResult> {
    const raw = await this.post<unknown>('/orders/batch', { orders: reqs })
    if (!isRecord(raw)) throw new ExchangeError('malformed_response', '批量下单响应格式不正确')
    const rows = Array.isArray(raw.orders) ? raw.orders : []
    const orders = rows.map(normalizeOrder).filter(isPresent)
    for (const order of orders) this.upsertOrder(order)
    await this.refreshAccount()
    this.emitTick()
    return {
      roundNo: num(raw.roundNo),
      status: text(raw.status) !== '' ? text(raw.status) : 'queued',
      accepted: Math.round(num(raw.accepted, orders.length)),
      maxOrders: Math.max(1, Math.round(num(raw.maxOrders, this.round?.maxOrders ?? DEFAULT_MAX_ORDERS))),
      usedOrders: Math.round(num(raw.usedOrders)),
      orders,
    }
  }

  async cancelOrder(id: string): Promise<void> {
    // Go 返回 `{orderId,status}`；撤单成功即解冻，刷新账户让「可用资金」立刻正确。
    await this.del<unknown>(`/orders/${encodeURIComponent(id)}`)
    this.orders = this.orders.map((order) =>
      order.id === id ? { ...order, status: 'cancelled' as const, qtyRemaining: 0 } : order,
    )
    await this.refreshAccount()
    this.emitTick()
  }

  async closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void> {
    await this.post<void>(`/positions/${encodeURIComponent(code)}/${side}/close`, { qty })
    await this.refreshAccount()
    this.emitTick()
  }

  private upsertOrder(order: ExchangeOrder): void {
    const index = this.orders.findIndex((item) => item.id === order.id)
    if (index < 0) {
      this.orders = [order, ...this.orders]
      return
    }
    const next = [...this.orders]
    next[index] = order
    this.orders = next
  }

  private appendMyTrades(rows: unknown[]): void {
    const fills = rows.map(normalizeTrade).filter(isPresent)
    if (fills.length === 0) return
    const seen = new Set(this.myTrades.map((trade) => trade.id))
    const fresh = fills.filter((trade) => !seen.has(trade.id))
    if (fresh.length > 0) this.myTrades = [...fresh, ...this.myTrades].slice(0, 200)
  }

  /** 业务已受理后单独重试读取；不重发交易，避免重复扣款。 */
  private async refreshAccount(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.getAccount()
        return
      } catch {
        if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, 300))
      }
    }
    throw new ExchangeError('account_sync_pending', tr('ui.exchange.007'))
  }

  /* ═══════════════ 量化 ═══════════════ */

  async listStrategies(): Promise<StrategySpec[]> {
    const raw = await this.get<unknown>('/strategies')
    const rows = Array.isArray(raw) ? raw : []
    this.strategies = rows.map(normalizeStrategy).filter(isPresent)
    this.emitTick()
    return this.strategies
  }

  async saveStrategy(spec: StrategySpec): Promise<StrategySpec> {
    const raw = await this.post<unknown>('/strategies', spec)
    const saved = normalizeStrategy(raw)
    if (saved === null) throw new ExchangeError('malformed_response', '策略保存响应格式不正确')
    this.strategies = [...this.strategies.filter((item) => item.id !== saved.id), saved]
    this.emitTick()
    return saved
  }

  async deleteStrategy(id: string): Promise<void> {
    await this.del<void>(`/strategies/${encodeURIComponent(id)}`)
    this.strategies = this.strategies.filter((item) => item.id !== id)
    await this.refreshAccount()
    await this.getOrders()
    this.emitTick()
  }

  /* ═══════════════ 实时订阅 ═══════════════ */

  subscribe(codes: string[], topics: ExchangeTopic[], throttle?: '1s' | '5s' | '30s'): Unsubscribe {
    const query = new URLSearchParams()
    if (codes.length > 0) query.set('codes', codes.join(','))
    const serverTopics = Array.from(
      new Set(
        topics
          .map((topic) => SERVER_TOPIC[topic])
          .filter((topic): topic is string => topic !== null && topic !== ''),
      ),
    )
    if (serverTopics.length > 0) query.set('topics', serverTopics.join(','))
    if (throttle) query.set('throttle', throttle)
    const suffix = query.toString()
    return this.transport.subscribe(
      this.basePath + '/stream' + (suffix !== '' ? '?' + suffix : ''),
      (payload) => this.onFrame(payload),
    )
  }

  /* ═══════════════ 原型扩展（同步读缓存） ═══════════════ */

  getSnapshot(code: string): ExchangeSnapshot {
    const quote = this.stocks.find((stock) => stock.code === code) ?? emptyQuote(code)
    return {
      ts: this.ts,
      tick: this.tick,
      index: deriveIndex(this.stocks),
      stocks: this.stocks,
      quote,
      book: this.books.get(code) ?? { code, bids: [], asks: [], ts: this.ts },
      trades: this.trades.get(code) ?? [],
      klines: this.chartCache.get(`${code}:m1`) ?? [],
      account: this.heldAccount ?? this.account,
      // 回合制：`queued`（已在服务端本回合队列里、等撮合）也要显示为「当前委托」。
      orders: (this.heldOrders ?? this.orders).filter(
        (order) =>
          order.status === 'queued' ||
          order.status === 'open' ||
          order.status === 'partial' ||
          order.status === 'trigger_pending',
      ),
      myTrades: this.heldTrades ?? this.myTrades,
      dividends: this.dividends,
      strategies: this.strategies,
      bonds: this.heldBond ?? this.bond,
      funds: this.heldFund ?? this.funds,
      bondProduct: this.bondProduct,
      news: this.news,
      agents: this.agents,
      feeRate: this.feeRate,
    }
  }

  /**
   * 联机账户由服务器管理，没有「本地模拟账户」可重置 ⇒ 明确拒绝，不假装成功。
   * 页面只在 `模拟盘` 徽标下显示重置按钮，正常走不到这里。
   */
  resetAccount(): void {
    throw new ExchangeError('not_supported', '联机账户由服务器管理，没有可重置的本地模拟账户')
  }

  /**
   * 债券：放置型持仓，服务端按真实分钟固定 3bp 单利结算；本金锁定、随时可赎。
   * 2026-11-04 船长令：债券也走交易所现金（入金后的钱），不再用本地存档直接买。
   */
  async getBondPosition(): Promise<BondPosition> {
    const position = await this.get<BondPosition>('/bond')
    this.bond = position
    return this.heldBond ?? position
  }

  async openBond(amount: number, nonce: string): Promise<BondPosition> {
    const position = await this.post<BondPosition>('/bond/open', { amount, nonce })
    await this.refreshAccount()
    this.bond = position
    this.emitTick()
    return position
  }

  async redeemBond(nonce: string): Promise<BondPosition> {
    const position = await this.post<BondPosition>('/bond/redeem', { nonce })
    await this.refreshAccount()
    this.bond = position
    this.emitTick()
    return position
  }

  /**
   * 基金：放置型持仓。服务端按真实分钟逐分钟结算（70% +16bp / 30% −7bp），
   * 查询时惰性结算到当前分钟；本金锁定，随时可赎。
   */
  async getFundPosition(): Promise<FundPosition> {
    const position = await this.get<FundPosition>('/fund')
    this.funds = position
    return this.heldFund ?? position
  }

  async openFund(amount: number, nonce: string): Promise<FundPosition> {
    const position = await this.post<FundPosition>('/fund/open', { amount, nonce })
    await this.refreshAccount()
    this.funds = position
    this.emitTick()
    return position
  }

  async redeemFund(nonce: string): Promise<FundPosition> {
    const position = await this.post<FundPosition>('/fund/redeem', { nonce })
    await this.refreshAccount()
    this.funds = position
    this.emitTick()
    return position
  }

  /**
   * 下单前馈：联机模式真正的保证金/强平/费率以实现只有服务端一份，
   * fetchOrderPreview 读取服务器真实冻结校验；同步 previewOrder 仅用于等待回执前的占位估算。
   */
  async fetchOrderPreview(req: PlaceOrderRequest & { investment?: number }): Promise<OrderPreview> {
    return this.post<OrderPreview>('/orders/preview', req)
  }

  previewOrder(req: PlaceOrderRequest): OrderPreview {
    const quote = this.stocks.find((stock) => stock.code === req.code)
    const price = req.price ?? quote?.price ?? 0
    const qty = Number.isFinite(req.qty) ? Math.max(0, Math.round(req.qty)) : 0
    const notional = price * qty
    const leverage = Math.max(1, Math.round(req.leverage ?? 1))
    const margin = leverage > 1 ? notional / leverage : notional
    const feeRate = Number.isFinite(this.feeRate) && this.feeRate > 0 ? this.feeRate : 0
    // 与 Go `feeOf` 同口径：成交名义 × 费率后向下取整（matching.go:69-74），
    // 预览里保留整数，避免显示 99.9999 被格式化成 100.00 与成交差 1 点。
    const fee = Math.floor(notional * feeRate)
    // 开空 = side=sell + short=true（1x 全额也算，与 Go `checkShortOpenLocked` 同口径）；
    // 不带 short 的卖单是「卖出持有/平多」。
    const shortOpen = req.short === true && req.side === 'sell'
    // 现金影响估算：买入/开空=支出（杠杆开仓只占保证金）；现货卖出=到账扣费；
    // 杠杆平仓真实金额取决于开仓价，界面按释放保证金近似。
    const settleAmount = shortOpen
      ? -(margin + fee)
      : req.side === 'sell'
        ? leverage > 1
          ? margin - fee
          : notional - fee
        : -(margin + fee)
    const account = this.account
    const cash = account ? Math.max(0, account.cash) : 0
    let maxQty = 0
    if (price > 0) {
      if (shortOpen) {
        // 开空按「每股占用 = 名义/杠杆 + 卖出档手续费」估算可开股数
        const budgetPerShare = price / leverage + price * feeRate
        maxQty = budgetPerShare > 0 ? Math.max(0, Math.floor(cash / budgetPerShare)) : 0
      } else if (req.side === 'sell' && leverage > 1) {
        const position = account?.positions.find((p) => p.code === req.code && p.side === 'long')
        maxQty = position ? Math.max(0, Math.floor(position.qty)) : 0
      } else if (req.side === 'sell') {
        const holding = account?.holdings.find((h) => h.code === req.code)
        maxQty = holding ? Math.max(0, Math.floor(holding.availableQty ?? holding.qty)) : 0
      } else {
        const budgetPerShare = leverage > 1 ? price / leverage + price * feeRate : price * (1 + feeRate)
        maxQty = budgetPerShare > 0 ? Math.max(0, Math.floor(cash / budgetPerShare)) : 0
      }
    }
    // 前端只拦「确定不可能成功」的情况：未纳入券源池直接挡下，券源余量交给服务端。
    const blockReason = shortOpen && quote !== undefined && !quote.shortable ? T.noShort : null
    return {
      notional,
      margin,
      fee,
      settleAmount,
      liquidationPrice: null,
      liquidationDistancePct: null,
      maxQty,
      blockReason,
    }
  }
}
