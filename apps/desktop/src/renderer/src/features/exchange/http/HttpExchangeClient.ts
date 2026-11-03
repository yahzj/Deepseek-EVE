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
  BatchOrderResult,
  BookLevel,
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
  FundPlayResult,
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
import { ExchangeError } from '../errors'
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

const EMPTY_BOND: BondHolding = { principal: 0, accrued: 0, purchasedAt: null, rateDaily: 0.0003 }

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
  // 服务端 OrderView 带 roundNo（回合制），前端 DTO 暂不外扩字段，避免 UI 跟着改名。
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
  const title = text(raw.title)
  if (id === '' && title === '') return null
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
  private round: RoundInfo | null = null
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
      // 快讯不依赖行情：首屏就并发补拉（WS `event` 只推本回合增量）。
      // 失败只丢弃快讯、不阻塞主快照，也不向页面抛错。
      const newsTask = this.loadNews().catch(() => undefined)
      const stocks = await this.getStocks()
      const code = stocks[0]?.code
      const [account, orders, strategies] = await Promise.all([
        this.getAccount(),
        this.getOrders().catch((): ExchangeOrder[] => []),
        this.listStrategies().catch((): StrategySpec[] => []),
      ])
      this.account = account
      this.orders = orders
      this.strategies = strategies
      const roundTask = this.getRound().catch(() => null)
      const metaTask = this.loadMeta().catch(() => undefined)
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
      await Promise.all([roundTask, metaTask, newsTask])
      this.emitTick()
    } catch (err) {
      // 连不上：界面由数据源徽标 + 引导态兜底；这里只上报，不伪造数据
      this.emit('error', err)
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

  /** 周期 → 服务端 K 线 interval（Go 支持 1m/5m/1h/1d/1w/1mo）；基础周期是 5m。 */
  private intervalOf(period: ChartPeriod): string {
    if (period === 'h1') return '1h'
    if (period === 'd1') return '1d'
    if (period === 'd7') return '1w'
    if (period === 'd30') return '1mo'
    return '1m'
  }

  private async loadChart(code: string, period: ChartPeriod): Promise<void> {
    const interval = this.intervalOf(period)
    const rows = await this.get<unknown>(
      `/klines/${encodeURIComponent(code)}?interval=${interval}&limit=400`,
    )
    const bars = Array.isArray(rows) ? (rows as Kline[]) : []
    this.chartCache.set(`${code}:${period}`, bars)
    if (period === 'm1') this.chartCache.set(`${code}:intraday`, bars)
  }

  getChartSeries(code: string, period: ChartPeriod): Kline[] {
    return this.chartCache.get(`${code}:${period}`) ?? []
  }

  /* ═══════════════ 查询 ═══════════════ */

  async getStocks(): Promise<StockQuote[]> {
    const raw = await this.get<unknown>('/stocks')
    const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.stocks) ? raw.stocks : null
    if (rows === null) throw new ExchangeError('malformed_response', '行情响应格式不正确')
    this.stocks = rows.map(normalizeStock).filter(isPresent)
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
    return this.orders
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
    this.emitTick()
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

  /** 撤单/批量提交/平仓后的账户刷新：失败不覆盖已成功的业务结果，等下一帧再更新。 */
  private async refreshAccount(): Promise<void> {
    try {
      await this.getAccount()
    } catch {
      /* 成败只看业务动作；刷新失败留给回合广播 */
    }
  }

  /* ═══════════════ 量化 ═══════════════ */

  async listStrategies(): Promise<StrategySpec[]> {
    const raw = await this.get<unknown>('/strategies')
    const rows = Array.isArray(raw) ? raw : []
    this.strategies = rows.map(normalizeStrategy).filter(isPresent)
    return this.strategies
  }

  async saveStrategy(spec: StrategySpec): Promise<StrategySpec> {
    const raw = await this.post<unknown>('/strategies', spec)
    const saved = normalizeStrategy(raw)
    if (saved === null) throw new ExchangeError('malformed_response', '策略保存响应格式不正确')
    this.strategies = [...this.strategies.filter((item) => item.id !== saved.id), saved]
    return saved
  }

  async deleteStrategy(id: string): Promise<void> {
    await this.del<void>(`/strategies/${encodeURIComponent(id)}`)
    this.strategies = this.strategies.filter((item) => item.id !== id)
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
    const quote = this.stocks.find((stock) => stock.code === code) ?? this.stocks[0] ?? emptyQuote(code)
    return {
      ts: this.ts,
      tick: this.tick,
      index: deriveIndex(this.stocks),
      stocks: this.stocks,
      quote,
      book: this.books.get(code) ?? { code, bids: [], asks: [], ts: this.ts },
      trades: this.trades.get(code) ?? [],
      klines: this.chartCache.get(`${code}:m1`) ?? [],
      account: this.account,
      // 回合制：`queued`（已在服务端本回合队列里、等撮合）也要显示为「当前委托」。
      orders: this.orders.filter(
        (order) =>
          order.status === 'queued' ||
          order.status === 'open' ||
          order.status === 'partial' ||
          order.status === 'trigger_pending',
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

  /** 联机债券走服务器；本轮 Go 未提供债券接口，同步接口先明确拒绝（页面有引导态兜底） */
  buyBond(_amount: number): BondHolding {
    throw new ExchangeError('not_supported', '联机模式暂未开放债券')
  }

  redeemBond(): number {
    throw new ExchangeError('not_supported', '联机模式暂未开放债券')
  }

  /**
   * 基金：服务端按实盘数据结算（盈利 3× 债券分钟利息、亏损 1×）。
   * 前端只等结果；「计算中…」动画在 FundCard 里做。
   */
  async playFund(amount: number, nonce: string): Promise<FundPlayResult> {
    return this.post<FundPlayResult>('/fund/play', { amount, nonce })
  }

  /**
   * 下单前馈：联机应以服务器返回为准（保证金/强平公式只能有一个实现）。
   * 这里只做界面不崩的保守占位；`blockReason` 明确写出「待服务器确认」。
   */
  previewOrder(req: PlaceOrderRequest): OrderPreview {
    const quote = this.stocks.find((stock) => stock.code === req.code)
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
