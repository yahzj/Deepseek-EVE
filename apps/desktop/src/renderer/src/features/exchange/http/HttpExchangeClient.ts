/**
 * HTTP / 联机适配器（**F0 只冻结形状**）。
 *
 * 硬约束：本文件**不直接**调用 `fetch` / `WebSocket` —— 一切请求与推送都经注入的
 * `Transport`（原型阶段是 `NotConnectedTransport`，F1 换成桌面主进程 IPC 实现）。
 * 这样渲染层保持零网络，CSP 与令牌落点留到 F1 裁决时只改 Transport 一处。
 *
 * 同步快照策略：页面每秒读 `getSnapshot()`，若每拍都发 REST 请求会乱序且昂贵 ⇒ 适配器维护
 * 订阅缓存，`getSnapshot()` 只读缓存；`start()` 拉一次全量快照并用 `subscribe()` 跟在后面。
 */
import type {
  BondHolding,
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
  IndexQuote,
  Kline,
  NewsItem,
  OrderBookSnapshot,
  OrderPreview,
  PlaceOrderRequest,
  StockQuote,
  StrategySpec,
  TradeRecord,
  Unsubscribe,
  WithdrawResult,
} from '../client'
import { ExchangeError } from '../errors'
import type { Transport } from './transport'

const CONTRACT_VERSION = 1
/** 与 Mock 同口径的默认手续费率（服务器 `meta` 下发时以服务器为准） */
const DEFAULT_FEE_RATE = 0.0005

const EMPTY_INDEX: IndexQuote = { value: 1000, changePct: 0, high: 1000, low: 1000 }

const EMPTY_BOND: BondHolding = { principal: 0, accrued: 0, purchasedAt: null, rateDaily: 0.0003 }

const EMPTY_BOND_PRODUCT: BondProduct = {
  id: 'WHALE-BOND',
  name: '舰船债券 · 稳健型',
  dailyRate: 0.0003,
  note: '联机产品以服务器配置为准',
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

export class HttpExchangeClient implements ExchangeClient {
  readonly contractVersion = CONTRACT_VERSION

  private readonly transport: Transport
  private readonly basePath: string
  private readonly tickListeners = new Set<() => void>()
  private readonly handlers = new Map<ExchangeEventType, Set<(payload: unknown) => void>>()
  private streamUnsub: Unsubscribe | null = null

  private tick = 0
  private ts = Date.now()
  private index: IndexQuote = EMPTY_INDEX
  private stocks: StockQuote[] = []
  private books = new Map<string, OrderBookSnapshot>()
  private trades = new Map<string, TradeRecord[]>()
  /** 图表缓存：键 = `${code}:${period}`（六周期各一份；服务端不给指标，前端现算） */
  private chartCache = new Map<string, Kline[]>()
  private account: ExchangeAccount = emptyAccount()
  private orders: ExchangeOrder[] = []
  private myTrades: TradeRecord[] = []
  private dividends: DividendRecord[] = []
  private strategies: StrategySpec[] = []
  private bond: BondHolding = { ...EMPTY_BOND }
  private bondProduct: BondProduct = { ...EMPTY_BOND_PRODUCT }
  private news: NewsItem[] = []
  private feeRate = DEFAULT_FEE_RATE

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
    if (this.streamUnsub !== null) return
    try {
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
    try {
      const stocks = await this.getStocks()
      const code = stocks[0]?.code
      const [account, orders, strategies] = await Promise.all([
        this.getAccount(),
        this.getOrders(),
        this.listStrategies(),
      ])
      this.account = account
      this.orders = orders
      this.strategies = strategies
      if (code) {
        await Promise.all([
          this.getBook(code).then((book) => this.books.set(code, book)),
          this.loadChart(code, 'm1'),
          this.loadChart(code, 'h1'),
          this.loadChart(code, 'd1'),
          this.loadChart(code, 'd7'),
          this.loadChart(code, 'd30'),
        ])
      }
      this.emitTick()
    } catch (err) {
      // 连不上：界面由数据源徽标 + 引导态兜底；这里只上报，不伪造数据
      this.emit('error', err)
    }
  }

  /** 推送帧：只做增量缓存，字段形状与 `ExchangeEventType` 对齐；未知帧忽略 */
  private onFrame(payload: unknown): void {
    if (payload === null || typeof payload !== 'object') return
    const frame = payload as { type?: unknown; data?: unknown }
    if (typeof frame.type !== 'string') return
    const data = frame.data
    this.ts = Date.now()
    this.tick += 1
    if (data !== null && typeof data === 'object') {
      const rec = data as Record<string, unknown>
      const code = typeof rec.code === 'string' ? rec.code : null
      if (frame.type === 'book' && code) {
        this.books.set(code, rec as unknown as OrderBookSnapshot)
      } else if (frame.type === 'trade' && code) {
        const list = this.trades.get(code) ?? []
        list.unshift(rec as unknown as TradeRecord)
        this.trades.set(code, list.slice(0, 100))
      } else if (frame.type === 'event') {
        this.news.unshift(rec as unknown as NewsItem)
        this.news = this.news.slice(0, 30)
      } else if (frame.type === 'margin_call') {
        this.emit('margin_call', rec)
      }
    }
    if (frame.type === 'price' || frame.type === 'book' || frame.type === 'trade') {
      this.emit(frame.type, data)
    }
    this.emitTick()
  }

  /* ═══════════════ 图表 ═══════════════ */

  /** 周期 → 服务端 K 线 interval（未来协议；原型不实际发请求） */
  private intervalOf(period: ChartPeriod): string {
    if (period === 'h1') return '1h'
    if (period === 'd1') return '1d'
    if (period === 'd7') return '1w'
    if (period === 'd30') return '1mo'
    return '1m'
  }

  private async loadChart(code: string, period: ChartPeriod): Promise<void> {
    const interval = this.intervalOf(period)
    const bars = await this.get<Kline[]>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=400`,
    )
    this.chartCache.set(`${code}:${period}`, bars)
    if (period === 'm1') this.chartCache.set(`${code}:intraday`, bars)
  }

  getChartSeries(code: string, period: ChartPeriod): Kline[] {
    return this.chartCache.get(`${code}:${period}`) ?? []
  }

  /* ═══════════════ 查询 ═══════════════ */

  async getStocks(): Promise<StockQuote[]> {
    const rows = await this.get<StockQuote[]>('/stocks')
    this.stocks = rows
    return rows
  }

  async getBook(code: string): Promise<OrderBookSnapshot> {
    const book = await this.get<OrderBookSnapshot>(`/book/${encodeURIComponent(code)}`)
    this.books.set(code, book)
    return book
  }

  async getTrades(code: string): Promise<TradeRecord[]> {
    const rows = await this.get<TradeRecord[]>(`/trades/${encodeURIComponent(code)}?limit=50`)
    this.trades.set(code, rows)
    return rows
  }

  async getKlines(code: string, interval: '1m' | '5m' | '1h', limit = 120): Promise<Kline[]> {
    const rows = await this.get<Kline[]>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=${limit}`,
    )
    if (interval === '1m') this.chartCache.set(`${code}:m1`, rows)
    if (interval === '1h') this.chartCache.set(`${code}:h1`, rows)
    return rows
  }

  async getAccount(): Promise<ExchangeAccount> {
    this.account = await this.get<ExchangeAccount>('/account')
    return this.account
  }

  async getOrders(): Promise<ExchangeOrder[]> {
    this.orders = await this.get<ExchangeOrder[]>('/orders')
    return this.orders
  }

  /* ═══════════════ 交易 ═══════════════ */

  deposit(amount: number, nonce: string): Promise<DepositResult> {
    return this.post<DepositResult>('/deposit', { amount, nonce })
  }

  withdraw(amount: number, nonce: string): Promise<WithdrawResult> {
    return this.post<WithdrawResult>('/withdraw', { amount, nonce })
  }

  async placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    const order = await this.post<ExchangeOrder>('/orders', req)
    this.orders = [order, ...this.orders.filter((o) => o.id !== order.id)]
    return order
  }

  async cancelOrder(id: string): Promise<void> {
    await this.del<void>(`/orders/${encodeURIComponent(id)}`)
    this.orders = this.orders.map((o) =>
      o.id === id ? { ...o, status: 'cancelled' as const } : o,
    )
  }

  async closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void> {
    await this.post<void>(`/positions/${encodeURIComponent(code)}/${side}/close`, { qty })
    await this.getAccount()
  }

  /* ═══════════════ 量化 ═══════════════ */

  async listStrategies(): Promise<StrategySpec[]> {
    this.strategies = await this.get<StrategySpec[]>('/strategies')
    return this.strategies
  }

  async saveStrategy(spec: StrategySpec): Promise<StrategySpec> {
    const saved = await this.post<StrategySpec>('/strategies', spec)
    this.strategies = [...this.strategies.filter((s) => s.id !== saved.id), saved]
    return saved
  }

  async deleteStrategy(id: string): Promise<void> {
    await this.del<void>(`/strategies/${encodeURIComponent(id)}`)
    this.strategies = this.strategies.filter((s) => s.id !== id)
  }

  /* ═══════════════ 实时订阅 ═══════════════ */

  subscribe(codes: string[], topics: ExchangeTopic[], throttle?: '1s' | '5s' | '30s'): Unsubscribe {
    const q = new URLSearchParams({
      codes: codes.join(','),
      topics: topics.join(','),
    })
    if (throttle) q.set('throttle', throttle)
    return this.transport.subscribe(this.basePath + '/stream?' + q.toString(), (payload) =>
      this.onFrame(payload),
    )
  }

  /* ═══════════════ 原型扩展（同步读缓存） ═══════════════ */

  getSnapshot(code: string): ExchangeSnapshot {
    const quote = this.stocks.find((s) => s.code === code) ?? this.stocks[0] ?? emptyQuote(code)
    return {
      ts: this.ts,
      tick: this.tick,
      index: this.index,
      stocks: this.stocks,
      quote,
      book: this.books.get(code) ?? { code, bids: [], asks: [], ts: this.ts },
      trades: this.trades.get(code) ?? [],
      klines: this.chartCache.get(`${code}:m1`) ?? [],
      account: this.account,
      orders: this.orders.filter(
        (o) => o.status === 'open' || o.status === 'partial' || o.status === 'trigger_pending',
      ),
      myTrades: this.myTrades,
      dividends: this.dividends,
      strategies: this.strategies,
      bonds: this.bond,
      bondProduct: this.bondProduct,
      news: this.news,
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

  /** 联机债券走服务器；原型 F0 没有真实传输，同步接口先明确拒绝（页面有引导态兜底） */
  buyBond(_amount: number): BondHolding {
    throw new ExchangeError('not_supported', '联机模式的债券操作待 F1 接入服务器')
  }

  redeemBond(): number {
    throw new ExchangeError('not_supported', '联机模式的债券操作待 F1 接入服务器')
  }

  /**
   * 下单前馈：联机应以服务器返回为准（保证金/强平公式只能有一个实现）。
   * 这里只做界面不崩的保守占位；`blockReason` 明确写出「待服务器确认」。
   */
  previewOrder(req: PlaceOrderRequest): OrderPreview {
    const quote = this.stocks.find((s) => s.code === req.code)
    const price = req.price ?? quote?.price ?? 0
    const notional = price * req.qty
    const leverage = Math.max(1, Math.round(req.leverage ?? 1))
    return {
      notional,
      margin: leverage > 1 ? notional / leverage : notional,
      fee: notional * this.feeRate,
      settleAmount: req.side === 'buy' ? -notional : notional,
      liquidationPrice: null,
      liquidationDistancePct: null,
      maxQty: 0,
      blockReason: '联机模式下由服务器计算保证金与强平价',
    }
  }
}
