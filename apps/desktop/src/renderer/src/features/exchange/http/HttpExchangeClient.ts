import type {
  AgentView,
  BatchOrderResult,
  BookLevel,
  BondPosition,
  BondProduct,
  ChartPeriod,
  CompanyFlowEntry,
  CompanyFlowsResult,
  CompanyInfo,
  CompanyReport,
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

const CONTRACT_VERSION = 3
const DEFAULT_FEE_RATE = 0.0005
const DEFAULT_MAX_ORDERS = 10
const NEWS_FETCH_LIMIT = 20
const NEWS_CACHE_LIMIT = 30

const SIMPLE_KLINES_LIMIT = 240
const SEED_MAX_AGE_MS = 30 * 60 * 1000
const PRIVATE_REFRESH_MS = 10_000
const PRIVATE_FAIL_ANNOUNCE = 3

const EMPTY_INDEX: IndexQuote = { value: 1000, changePct: 0, high: 1000, low: 1000 }

const INDEX_BASE_KEY = 'whale-idle:exchange-index-base-v1'

const EMPTY_BOND_POSITION: BondPosition = {
  principal: 0,
  accrued: 0,
  value: 0,
  settledMinute: 0,
  openedAt: 0,
  minutes: 0,
  winDailyPpb: 120_000_000,
  loseDailyPpb: -120_000_000,
  winPermille: 998,
  lowDailyPpb: 12_000_000,
  principalCap: 100_000_000,
  dailyCap: 200_000_000,
  capUsed: 0,
  cash: 0,
}

const EMPTY_FUND_POSITION: FundPosition = {
  principal: 0,
  accrued: 0,
  value: 0,
  settledMinute: 0,
  openedAt: 0,
  minutes: 0,
  winDailyPpb: 514_300_000,
  loseDailyPpb: -400_000_000,
  winPercent: 70,
  lowDailyPpb: 24_000_000,
  principalCap: 100_000_000,
  dailyCap: 300_000_000,
  capUsed: 0,
  cash: 0,
}

const EMPTY_BOND_PRODUCT: BondProduct = {
  id: 'WHALE-BOND',
  name: '舰船债券 · 稳健型',
  dailyRate: 0.11952,
  lowDailyRate: 0.012,
  principalCap: 100_000_000,
  dailyCap: 200_000_000,
  note: '联机产品以服务器配置为准',
}

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
      :
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

function normalizeCompanyReport(raw: Record<string, unknown>): CompanyReport {
  return {
    id: text(raw.id),
    ts: num(raw.ts),
    weekKey: text(raw.weekKey),
    company: text(raw.company),
    name: text(raw.name),
    revenue: num(raw.revenue),
    cost: num(raw.cost),
    gross: num(raw.gross),
    prevAvgGross: num(raw.prevAvgGross),
    grossDeltaBp: num(raw.grossDeltaBp),
    anchorShiftBp: num(raw.anchorShiftBp),
    trades: num(raw.trades),
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
    positions: Array.isArray(raw.positions)
      ? (raw.positions.filter(isRecord) as unknown as ExchangeAccount['positions'])
      : [],
    pendingWithdrawals: Array.isArray(raw.pendingWithdrawals)
      ? (raw.pendingWithdrawals.filter(isRecord) as unknown as ExchangeAccount['pendingWithdrawals'])
      : [],
    holdings: Array.isArray(raw.holdings) ? raw.holdings.map(normalizeHolding).filter(isPresent) : [],
    dailyTradeLimit: num(raw.dailyTradeLimit, 5_000_000_000),
    dailyTradeUsed: num(raw.dailyTradeUsed),
    dailyBuyUsed:
      typeof raw.dailyBuyUsed === 'number' && Number.isFinite(raw.dailyBuyUsed)
        ? num(raw.dailyBuyUsed)
        : undefined,
    dailySellUsed:
      typeof raw.dailySellUsed === 'number' && Number.isFinite(raw.dailySellUsed)
        ? num(raw.dailySellUsed)
        : undefined,
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
  if (typeof raw.usedOrders === 'number' && Number.isFinite(raw.usedOrders)) {
    round.usedOrders = raw.usedOrders
  }
  return round
}

function normalizeNews(raw: unknown): NewsItem | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const title = text(raw.title)
  const body = text(raw.body)
  if (id === '' && title === '') return null
  if (!id.startsWith('AG-') && (title.includes('人格') || body.includes('人格'))) return null
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
    dailyTradeLimit: 5_000_000_000,
    dailyTradeUsed: 0,
    dailyBuyUsed: 0,
    dailySellUsed: 0,
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
  maxOrderQty = 10_000_000

  private readonly transport: Transport
  private readonly basePath: string
  private readonly tickListeners = new Set<() => void>()
  private readonly handlers = new Map<ExchangeEventType, Set<(payload: unknown) => void>>()
  private streamUnsub: Unsubscribe | null = null
  private lifecycleHolds = 0
  private privateTimer: ReturnType<typeof setInterval> | null = null
  private privateRefreshing = false
  private privateFails = 0

  private tick = 0
  private ts = Date.now()
  private stocks: StockQuote[] = []
  private indexState = this.loadIndexState()
  private books = new Map<string, OrderBookSnapshot>()
  private trades = new Map<string, TradeRecord[]>()
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
  private agents: AgentView[] = []
  private feeRate = DEFAULT_FEE_RATE
  private bootstrapping = false
  private lastBootstrapAt = 0
  private symbolLoading = new Set<string>()
  private chartLoading = new Set<string>()
  private pendingIntradayRefresh = false
  private intradayRefreshing = new Set<string>()
  private chartRequestedAt = new Map<string, number>()
  private chartCachedAt = new Map<string, number>()
  private chartPersistTimer = 0
  private chartsHydrated = false
  private seeded = false
  private refreshing = false
  private refreshCount = 0
  private lastVolume24h = new Map<string, number>()
  private static readonly CHART_CACHE_KEY = 'whale-idle:exch-charts:v1'
  private static readonly CHART_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

  constructor(
    transport: Transport,
    basePath = '/api/exchange',
    private readonly guest = false,
  ) {
    this.transport = transport
    this.basePath = basePath
  }


  private get<T>(path: string, anonymous = false): Promise<T> {
    return this.transport.request<T>({
      method: 'GET',
      path: this.basePath + path,
      anonymous: anonymous || undefined,
    })
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.transport.request<T>({ method: 'POST', path: this.basePath + path, body })
  }

  private del<T>(path: string): Promise<T> {
    return this.transport.request<T>({ method: 'DELETE', path: this.basePath + path })
  }


  start(withBootstrap = true): void {
    this.lifecycleHolds += 1
    if (this.lifecycleHolds === 1) {
      if (!this.chartsHydrated) {
        this.chartsHydrated = true
        this.hydrateCharts()
      }
      this.seedFromCache()
      try {
        this.streamUnsub = this.transport.subscribe(this.basePath + '/stream', (payload) =>
          this.onFrame(payload),
        )
      } catch (err) {
        this.emit('error', err)
      }
      this.startPrivateRefresh()
    }
    if (withBootstrap) void this.bootstrap()
    else if (this.lifecycleHolds === 1) void this.refreshLight()
  }

  stop(): void {
    if (this.lifecycleHolds === 0) return
    this.lifecycleHolds -= 1
    if (this.lifecycleHolds > 0) return
    this.stopPrivateRefresh()
    this.streamUnsub?.()
    this.streamUnsub = null
  }

  dispose(): void {
    this.lifecycleHolds = 0
    this.stopPrivateRefresh()
    this.streamUnsub?.()
    this.streamUnsub = null
  }

  private startPrivateRefresh(): void {
    if (this.guest || this.privateTimer !== null) return
    this.privateTimer = setInterval(() => void this.refreshPrivateData(), PRIVATE_REFRESH_MS)
  }

  private stopPrivateRefresh(): void {
    if (this.privateTimer === null) return
    clearInterval(this.privateTimer)
    this.privateTimer = null
  }

  private async refreshPrivateData(): Promise<void> {
    if (this.privateRefreshing) return
    if (typeof document !== 'undefined' && document.hidden === true) return
    this.privateRefreshing = true
    try {
      await Promise.all([this.getAccount(), this.getOrders()])
      this.notePrivateSync(false)
      this.emitTick()
    } catch (err) {
      this.notePrivateSync(true, err)
    } finally {
      this.privateRefreshing = false
    }
  }

  private async refreshLight(): Promise<void> {
    await Promise.all([
      this.getStocks().catch(() => undefined),
      this.guest ? Promise.resolve() : this.getRound().catch(() => null),
      this.guest ? Promise.resolve() : this.refreshPrivateData(),
    ])
    this.emitTick()
  }

  private notePrivateSync(failed: boolean, err?: unknown): void {
    if (!failed) {
      this.privateFails = 0
      return
    }
    if (this.privateFails > PRIVATE_FAIL_ANNOUNCE) return
    this.privateFails += 1
    if (this.privateFails !== PRIVATE_FAIL_ANNOUNCE) return
    this.emit(
      'error',
      err instanceof Error ? err : new ExchangeError('account_sync_pending', tr('ui.exchange.007')),
    )
  }

  retryBootstrap(): void {
    if (this.bootstrapping) return
    if (Date.now() - this.lastBootstrapAt < 4000) return
    void this.bootstrap()
  }

  async refreshMarketData(code: string): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const withCharts = this.refreshCount % 3 === 0
      this.refreshCount += 1
      await this.getStocks().catch(() => undefined)
      for (const stock of this.stocks) {
        if (!this.chartCache.has(`${stock.code}:m1`)) this.ensureSymbolData(stock.code)
      }
      await Promise.all([
        this.loadNews().catch(() => undefined),
        this.guest ? Promise.resolve() : this.loadBond().catch(() => undefined),
        this.guest ? Promise.resolve() : this.loadFund().catch(() => undefined),
        this.loadAgents().catch(() => undefined),
        code === ''
          ? Promise.resolve()
          : this.getBook(code)
              .then((book) => this.books.set(code, book))
              .catch(() => undefined),
        withCharts && code !== ''
          ? this.loadChart(code, 'm1', SIMPLE_KLINES_LIMIT).catch(() => undefined)
          : Promise.resolve(),
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
  }

  private async bootstrap(): Promise<void> {
    if (this.bootstrapping) return
    this.bootstrapping = true
    this.lastBootstrapAt = Date.now()
    try {
      const privateTask = this.guest
        ? Promise.resolve()
        : Promise.all([
            this.getAccount(),
            this.getOrders().catch((): ExchangeOrder[] => []),
            this.listStrategies().catch((): StrategySpec[] => []),
            this.getRound().catch(() => null),
            this.loadBond().catch(() => undefined),
            this.loadFund().catch(() => undefined),
          ]).then(([account, orders, strategies]) => {
            this.account = account
            this.orders = orders
            this.strategies = strategies
          })
      const bundled = await this.loadBootstrapBundle().catch(() => false)
      if (!bundled) await this.bootstrapLegacy()
      this.emitTick()
      await privateTask.catch((err: unknown) => this.emit('error', err))
      this.emitTick()
    } catch (err) {
      this.emit('error', err)
    } finally {
      this.bootstrapping = false
    }
  }

  private async loadBootstrapBundle(): Promise<boolean> {
    const code = this.stocks[0]?.code ?? ''
    const query =
      `?spark=${SIMPLE_KLINES_LIMIT}&m1=${SIMPLE_KLINES_LIMIT}&h1=2016` +
      (code === '' ? '' : `&code=${encodeURIComponent(code)}`)
    const raw = await this.get<unknown>(`/bootstrap${query}`, true)
    if (!isRecord(raw)) return false
    if (Array.isArray(raw.stocks)) {
      const stocks = raw.stocks.map(normalizeStock).filter(isPresent)
      if (stocks.length > 0) {
        this.stocks = stocks
        this.updateIntraCandles(stocks)
      }
    }
    if (Array.isArray(raw.news)) {
      const news = raw.news.map(normalizeNews).filter(isPresent).slice(0, NEWS_FETCH_LIMIT)
      this.mergeNews(news, false)
    }
    if (isRecord(raw.agents) && Array.isArray(raw.agents.agents)) {
      this.agents = raw.agents.agents.map(normalizeAgent).filter(isPresent)
    }
    this.applyMeta(raw.meta)
    if (isRecord(raw.charts)) this.applyBootstrapCharts(raw.charts)
    const book = normalizeBook(raw.book, code)
    if (book !== null) this.books.set(book.code, book)
    return this.stocks.length > 0
  }

  private async bootstrapLegacy(): Promise<void> {
    const stocks = await this.getStocks()
    this.emitTick()
    const code = stocks[0]?.code ?? ''
    const tasks: Promise<unknown>[] = [
      this.loadNews().catch(() => undefined),
      this.loadAgents().catch(() => undefined),
      this.loadMeta().catch(() => undefined),
    ]
    if (code !== '') {
      tasks.push(this.getBook(code).then((book) => this.books.set(code, book)).catch(() => undefined))
      tasks.push(this.loadChart(code, 'h1').catch(() => undefined))
    }
    for (const stock of stocks) {
      tasks.push(this.loadChart(stock.code, 'm1', SIMPLE_KLINES_LIMIT).catch(() => undefined))
    }
    await Promise.all(tasks)
  }

  private seedFromCache(): void {
    if (this.seeded) return
    this.seeded = true
    const getCached = this.transport.getCached
    if (typeof getCached !== 'function') return
    try {
      const cachedStocks = getCached<unknown>(this.basePath + '/stocks', SEED_MAX_AGE_MS)
      if (Array.isArray(cachedStocks) && this.stocks.length === 0) {
        const stocks = cachedStocks.map(normalizeStock).filter(isPresent)
        if (stocks.length > 0) {
          this.stocks = stocks
          this.updateIntraCandles(stocks)
        }
      }
      const cachedNews = getCached<unknown>(
        this.basePath + `/news?limit=${NEWS_FETCH_LIMIT}`,
        SEED_MAX_AGE_MS,
      )
      if (Array.isArray(cachedNews) && this.news.length === 0) {
        const news = cachedNews.map(normalizeNews).filter(isPresent).slice(0, NEWS_FETCH_LIMIT)
        this.mergeNews(news, false)
      }
      const cachedAgents = getCached<unknown>(this.basePath + '/agents', SEED_MAX_AGE_MS)
      if (isRecord(cachedAgents) && Array.isArray(cachedAgents.agents) && this.agents.length === 0) {
        this.agents = cachedAgents.agents.map(normalizeAgent).filter(isPresent)
      }
      this.applyMeta(getCached<unknown>(this.basePath + '/meta', SEED_MAX_AGE_MS))
      if (this.stocks.length > 0) this.emitTick()
    } catch {
    }
  }

  private applyBootstrapCharts(raw: Record<string, unknown>): void {
    const now = Date.now()
    for (const [code, value] of Object.entries(raw)) {
      if (!isRecord(value)) continue
      if (Array.isArray(value.m1)) {
        const m1 = value.m1 as Kline[]
        this.chartCache.set(`${code}:m1`, m1)
        this.chartCachedAt.set(`${code}:m1`, now)
        if (!this.chartCache.has(`${code}:intraday`)) {
          this.chartCache.set(`${code}:intraday`, m1.slice(-60).map((bar) => ({ ...bar })))
          this.chartCachedAt.set(`${code}:intraday`, now)
        }
      }
      if (Array.isArray(value.h1)) {
        this.chartCache.set(`${code}:h1`, value.h1 as Kline[])
        this.chartCachedAt.set(`${code}:h1`, now)
      }
    }
    this.schedulePersistCharts()
  }

  private async loadMeta(): Promise<void> {
    this.applyMeta(await this.get<unknown>('/meta', true))
  }

  private applyMeta(raw: unknown): void {
    if (!isRecord(raw)) return
    const maxQty = num(raw.maxQty, Number.NaN)
    if (Number.isFinite(maxQty) && maxQty > 0) this.maxOrderQty = Math.floor(maxQty)
    const feeRate =
      typeof raw.feeRate === 'string' ? Number.parseFloat(raw.feeRate) : num(raw.feeRate, Number.NaN)
    if (Number.isFinite(feeRate) && feeRate >= 0) {
      this.feeRate = feeRate
      return
    }
    const commissionBp = num(raw.commissionBp, Number.NaN)
    if (Number.isFinite(commissionBp) && commissionBp >= 0) this.feeRate = commissionBp / 10_000
  }

  private async loadNews(): Promise<void> {
    const raw = await this.get<unknown>(`/news?limit=${NEWS_FETCH_LIMIT}`, true)
    if (!Array.isArray(raw)) return
    const items = raw
      .map(normalizeNews)
      .filter(isPresent)
      .slice(0, NEWS_FETCH_LIMIT)
    this.mergeNews(items, false)
  }

  private async loadAgents(): Promise<void> {
    const raw = await this.get<unknown>('/agents', true)
    if (!isRecord(raw) || !Array.isArray(raw.agents)) return
    this.agents = raw.agents.map(normalizeAgent).filter(isPresent)
    this.emitTick()
  }

  private async loadBond(): Promise<void> {
    if (this.guest) return
    this.bond = await this.get<BondPosition>('/bond')
  }

  private async loadFund(): Promise<void> {
    if (this.guest) return
    this.funds = await this.get<FundPosition>('/fund')
  }

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

  private onFrame(payload: unknown): void {
    if (!isRecord(payload) || typeof payload.type !== 'string') return
    const data = payload.data
    switch (payload.type) {
      case 'round': {
        const round = normalizeRound(data)
        if (round !== null) {
          if (
            round.usedOrders === undefined &&
            this.round !== null &&
            this.round.roundNo === round.roundNo
          ) {
            round.usedOrders = this.round.usedOrders
          }
          this.round = round
        }
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
        const list = isRecord(data) && Array.isArray(data.agents) ? data.agents : null
        if (list !== null) this.agents = list.map(normalizeAgent).filter(isPresent)
        break
      }
      case 'event': {
        const news = normalizeNews(data)
        if (news !== null) this.mergeNews([news], true)
        break
      }
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

  private frameCode(rows: unknown[]): string | null {
    for (const row of rows) {
      if (isRecord(row) && typeof row.code === 'string' && row.code !== '') return row.code
    }
    return null
  }


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

  private async loadChart(code: string, period: ChartPeriod, limitOverride?: number): Promise<void> {
    const { interval, agg } = this.chartSource(period)
    const limit =
      limitOverride !== undefined
        ? Math.min(2016, Math.max(1, Math.floor(limitOverride)))
        : Math.min(2016, 2016 * agg)
    const rows = await this.get<unknown>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=${limit}`,
    )
    const bars = aggregateKlines(Array.isArray(rows) ? (rows as Kline[]) : [], agg)
    const key = `${code}:${period}`
    this.chartCache.set(key, bars)
    this.chartCachedAt.set(key, Date.now())
    if (period === 'm1' && !this.chartCache.has(`${code}:intraday`)) {
      const initIntraday = bars.slice(-60).map((b) => ({ ...b }))
      this.chartCache.set(`${code}:intraday`, initIntraday)
      this.chartCachedAt.set(`${code}:intraday`, Date.now())
    }
    this.schedulePersistCharts()
  }

  getChartSeries(code: string, period: ChartPeriod): Kline[] {
    return this.chartCache.get(`${code}:${period}`) ?? []
  }

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
    void this.loadChart(
      code,
      period,
      period === 'm1' || period === 'intraday' ? SIMPLE_KLINES_LIMIT : undefined,
    )
      .then(() => this.emitTick())
      .catch(() => {
      })
      .finally(() => {
        this.chartLoading.delete(key)
      })
  }

  refreshCharts(): void {
    this.pendingIntradayRefresh = true
    if (this.stocks.length > 0) this.flushIntradayRefresh()
  }

  private flushIntradayRefresh(): void {
    if (!this.pendingIntradayRefresh) return
    this.pendingIntradayRefresh = false
    for (const stock of this.stocks) {
      void this.refreshIntraday(stock.code)
    }
  }

  private async refreshIntraday(code: string): Promise<void> {
    if (this.intradayRefreshing.has(code)) return
    this.intradayRefreshing.add(code)
    try {
      const rows = await this.get<unknown>(`/klines/${encodeURIComponent(code)}?interval=1m&limit=240`)
      const bars = Array.isArray(rows) ? (rows as Kline[]) : []
      if (bars.length === 0) return
      this.chartCache.set(`${code}:intraday`, bars.slice(-60).map((b) => ({ ...b })))
      this.chartCachedAt.set(`${code}:intraday`, Date.now())
      this.chartRequestedAt.set(`${code}:intraday`, Date.now())
      this.schedulePersistCharts()
      this.emitTick()
    } catch {
    } finally {
      this.intradayRefreshing.delete(code)
    }
  }

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
        const cap = key.endsWith(':intraday')
          ? 240
          : key.endsWith(':m1')
            ? SIMPLE_KLINES_LIMIT
            : key.endsWith(':h1')
              ? 500
              : 0
        if (cap === 0) continue
        out[key] = { t: this.chartCachedAt.get(key) ?? Date.now(), bars: bars.slice(-cap) }
      }
      window.localStorage.setItem(HttpExchangeClient.CHART_CACHE_KEY, JSON.stringify(out))
    } catch {
    }
  }

  private updateIntraCandles(quotes: StockQuote[]): void {
    const now = Date.now()
    for (const quote of quotes) {
      const p = quote.price
      if (!Number.isFinite(p) || p <= 0) continue
      if (!this.chartCache.has(`${quote.code}:intraday`)) {
        const m1 = this.chartCache.get(`${quote.code}:m1`)
        if (m1 !== undefined && m1.length > 0) {
          this.chartCache.set(
            `${quote.code}:intraday`,
            m1.slice(-60).map((bar) => ({ ...bar })),
          )
        }
      }
      const prevVolume = this.lastVolume24h.get(quote.code) ?? quote.volume24h
      const volumeDelta = Math.max(0, quote.volume24h - prevVolume)
      this.lastVolume24h.set(quote.code, quote.volume24h)
      for (const [key, bars] of this.chartCache) {
        if (!key.startsWith(`${quote.code}:`) || bars.length === 0) continue
        const periodStr = key.slice(quote.code.length + 1) as ChartPeriod
        const last = bars[bars.length - 1]
        if (!last) continue
        const bucket = bucketStart(periodStr, now)
        if (periodStr === 'intraday') {
          if (bucket > last.t) {
            bars.push({ t: bucket, o: last.c, h: Math.max(last.c, p), l: Math.min(last.c, p), c: p, v: volumeDelta })
            if (bars.length > 200) bars.shift()
          } else if (bucket === last.t) {
            last.h = Math.max(last.h, p)
            last.l = Math.min(last.l, p)
            last.c = p
            last.v += volumeDelta
          }
          continue
        }
        if (volumeDelta <= 0) continue
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

  ensureSymbolData(code: string): void {
    if (code === '') return
    const needChart = !this.chartCache.has(`${code}:m1`)
    const needBook = !this.books.has(code)
    if (!needChart && !needBook) return
    if (this.symbolLoading.has(code)) return
    this.symbolLoading.add(code)
    const tasks: Promise<unknown>[] = []
    if (needChart) {
      tasks.push(this.loadChart(code, 'm1', SIMPLE_KLINES_LIMIT).then(() => this.emitTick()))
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


  async getStocks(): Promise<StockQuote[]> {
    const raw = await this.get<unknown>('/stocks', true)
    const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.stocks) ? raw.stocks : null
    if (rows === null) throw new ExchangeError('malformed_response', '行情响应格式不正确')
    this.stocks = rows.map(normalizeStock).filter(isPresent)
    this.flushIntradayRefresh()
    this.updateIntraCandles(this.stocks)
    return this.stocks
  }

  async getBook(code: string): Promise<OrderBookSnapshot> {
    const raw = await this.get<unknown>(`/book/${encodeURIComponent(code)}`, true)
    const book = normalizeBook(raw, code)
    if (book === null) throw new ExchangeError('malformed_response', '盘口响应格式不正确')
    this.books.set(book.code, book)
    return book
  }

  async getCompanies(): Promise<CompanyInfo[]> {
    const raw = await this.get<unknown>('/companies', true)
    const rows = Array.isArray(raw) ? raw.filter(isRecord) : []
    return rows.map((row) => ({
      company: String(row.company ?? ''),
      name: String(row.name ?? ''),
      sector: String(row.sector ?? ''),
      anchorShiftBp: Number(row.anchorShiftBp ?? 0),
      anchorPrice: Number(row.anchorPrice ?? 0),
      lastReport: isRecord(row.lastReport) ? normalizeCompanyReport(row.lastReport) : undefined,
    }))
  }

  async submitCompanyFlows(flows: CompanyFlowEntry[]): Promise<CompanyFlowsResult> {
    const raw = await this.post<unknown>('/company-flow', { flows })
    if (!isRecord(raw)) return { accepted: 0, ignored: flows.length }
    return {
      accepted: Number(raw.accepted ?? 0),
      ignored: Number(raw.ignored ?? 0),
      companies: Array.isArray(raw.companies) ? raw.companies.map((code) => String(code)) : undefined,
    }
  }

  async getTrades(code: string): Promise<TradeRecord[]> {
    const raw = await this.get<unknown>(`/trades/${encodeURIComponent(code)}?limit=50`, true)
    const rows = Array.isArray(raw) ? raw : []
    const trades = rows.map(normalizeTrade).filter(isPresent)
    this.trades.set(code, trades)
    return trades
  }

  async getKlines(code: string, interval: '1m' | '5m' | '1h', limit = 120): Promise<Kline[]> {
    const raw = await this.get<unknown>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=${limit}`,
      true,
    )
    const rows = Array.isArray(raw) ? (raw as Kline[]) : []
    if (interval === '1m') this.chartCache.set(`${code}:m1`, rows)
    if (interval === '1h') this.chartCache.set(`${code}:h1`, rows)
    return rows
  }

  async getAccount(): Promise<ExchangeAccount> {
    if (this.guest) return this.account
    const raw = await this.get<unknown>('/account')
    const account = normalizeAccount(raw)
    if (account === null) throw new ExchangeError('malformed_response', '账户信息响应格式不正确')
    this.account = account
    return account
  }

  async getOrders(): Promise<ExchangeOrder[]> {
    if (this.guest) return this.heldOrders ?? this.orders
    const raw = await this.get<unknown>('/orders')
    const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.orders) ? raw.orders : null
    if (rows === null) throw new ExchangeError('malformed_response', '委托列表响应格式不正确')
    this.orders = rows.map(normalizeOrder).filter(isPresent)
    return this.heldOrders ?? this.orders
  }

  async getRound(): Promise<RoundInfo> {
    if (this.guest) {
      if (this.round !== null) return this.round
      throw new ExchangeError('login_required', '尚未登录：登录后可以查询交易所回合读数')
    }
    const raw = await this.get<unknown>('/round')
    const round = normalizeRound(raw)
    if (round === null) throw new ExchangeError('malformed_response', '回合信息响应格式不正确')
    this.round = round
    this.emitTick()
    return round
  }

  getRoundView(): RoundInfo | null {
    return this.round
  }


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
    const source = isRecord(raw.order) ? raw.order : raw
    const order = normalizeOrder(source)
    if (order === null) throw new ExchangeError('malformed_response', '下单响应缺少委托字段')
    this.upsertOrder(order)
    if (Array.isArray(raw.trades)) this.appendMyTrades(raw.trades)
    try {
      await this.refreshAccount()
    } finally {
      this.emitTick()
    }
    void this.getRound().catch(() => undefined)
    return order
  }

  async batchPlaceOrders(reqs: PlaceOrderRequest[]): Promise<BatchOrderResult> {
    const raw = await this.post<unknown>('/orders/batch', { orders: reqs })
    if (!isRecord(raw)) throw new ExchangeError('malformed_response', '批量下单响应格式不正确')
    const rows = Array.isArray(raw.orders) ? raw.orders : []
    const orders = rows.map(normalizeOrder).filter(isPresent)
    for (const order of orders) this.upsertOrder(order)
    await this.refreshAccount()
    this.emitTick()
    const maxOrders = Math.max(1, Math.round(num(raw.maxOrders, this.round?.maxOrders ?? DEFAULT_MAX_ORDERS)))
    const usedOrders = Math.round(num(raw.usedOrders, Number.NaN))
    if (this.round !== null && Number.isFinite(usedOrders)) {
      this.round = { ...this.round, maxOrders, usedOrders }
    }
    return {
      roundNo: num(raw.roundNo),
      status: text(raw.status) !== '' ? text(raw.status) : 'queued',
      accepted: Math.round(num(raw.accepted, orders.length)),
      maxOrders,
      usedOrders: Number.isFinite(usedOrders) ? usedOrders : 0,
      orders,
    }
  }

  async cancelOrder(id: string): Promise<void> {
    await this.del<unknown>(`/orders/${encodeURIComponent(id)}`)
    this.orders = this.orders.map((order) =>
      order.id === id ? { ...order, status: 'cancelled' as const, qtyRemaining: 0 } : order,
    )
    await this.refreshAccount()
    this.emitTick()
  }

  async closePosition(code: string, side: 'long' | 'short', qty?: number, expectedPrice?: number): Promise<void> {
    await this.post<void>(`/positions/${encodeURIComponent(code)}/${side}/close`, { qty, expectedPrice })
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


  async listStrategies(): Promise<StrategySpec[]> {
    if (this.guest) return this.strategies
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


  private loadIndexState(): { day: number; base: number; last: number } {
    if (typeof window === 'undefined') return { day: -1, base: 1000, last: 1000 }
    try {
      const raw = window.localStorage.getItem(INDEX_BASE_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { day?: number; base?: number; last?: number }
        if (Number.isFinite(parsed.day) && Number.isFinite(parsed.base) && Number.isFinite(parsed.last)) {
          return { day: parsed.day as number, base: parsed.base as number, last: parsed.last as number }
        }
      }
    } catch {
    }
    return { day: -1, base: 1000, last: 1000 }
  }

  private deriveIndexContinuous(stocks: StockQuote[]): IndexQuote {
    if (stocks.length === 0) return EMPTY_INDEX
    const day = Math.floor(Date.now() / 86_400_000)
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
    if (this.indexState.day !== day) {
      const base = this.indexState.last > 0 ? this.indexState.last : 1000
      this.indexState = { day, base, last: base }
    }
    const ratio = ratioSum / count
    const value = this.indexState.base * ratio
    this.indexState.last = value
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(INDEX_BASE_KEY, JSON.stringify(this.indexState))
      } catch {
      }
    }
    return {
      value,
      changePct: (ratio - 1) * 100,
      high: this.indexState.base * (highSum / count),
      low: this.indexState.base * (lowSum / count),
    }
  }

  getSnapshot(code: string): ExchangeSnapshot {
    const quote = this.stocks.find((stock) => stock.code === code) ?? emptyQuote(code)
    return {
      ts: this.ts,
      tick: this.tick,
      index: this.deriveIndexContinuous(this.stocks),
      stocks: this.stocks,
      quote,
      book: this.books.get(code) ?? { code, bids: [], asks: [], ts: this.ts },
      trades: this.trades.get(code) ?? [],
      klines: this.chartCache.get(`${code}:m1`) ?? [],
      account: this.heldAccount ?? this.account,
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
      round: this.round,
    }
  }

  async getBondPosition(): Promise<BondPosition> {
    if (this.guest) return this.heldBond ?? this.bond
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

  async getFundPosition(): Promise<FundPosition> {
    if (this.guest) return this.heldFund ?? this.funds
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
    const fee = Math.floor(notional * feeRate)
    const shortOpen = req.short === true && req.side === 'sell'
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
