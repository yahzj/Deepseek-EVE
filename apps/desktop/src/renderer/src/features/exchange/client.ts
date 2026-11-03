/**
 * 证券交易所 · 前端唯一依赖面（**F0 可点击原型**）。
 *
 * 为什么要有这一层：总体设计（`docs/design/stock-exchange-server-20261103.md` §六）要求
 * 「UI 只依赖接口，不依赖实现」，将来把 Mock 换成 HTTP + WS 适配器时只改本文件的装配点。
 * 因此页面与 `components/` **只准 import 本文件**，不得 import `mock/` 下任何东西。
 *
 * 契约同构：类型与方法名照 `docs/design/stock-exchange-backend-spec-20261103.md` §十三写，
 * 原型允许简化，但**字段名不改**，避免换真机时界面跟着改名。
 *
 * 原型扩展（本批特有，接真机时删或替换）：
 * - `start()/stop()/onTick()/getSnapshot()`：Mock 的 1 秒 tick 是同步状态机，用同步快照读，
 *   避免「每秒 8 个 await + 乱序」的竞态；HTTP 适配器可改成轮询缓存后再返回同一快照。
 * - `getSnapshot()` 里的 `news / dividends / bonds / index` 对应将来的
 *   `/api/exchange/events`、分红流水、债券产品与指数条接口，现在先由 Mock 提供。
 */
export { ExchangeError } from './errors'

export type Side = 'buy' | 'sell'
export type OrderType = 'limit' | 'market' | 'stop' | 'take_profit' | 'conditional'
export type Tif = 'GTC' | 'IOC'

/** 订单来源：界面用它区分「手动 / 策略 / 条件单 / 强平」，对应设计稿 §6.1 的「小角标」 */
export type OrderSource = 'manual' | 'strategy' | 'conditional' | 'liquidation'

export interface StockQuote {
  code: string
  /** 原型期直接放中文名；转正时换 l10n id（与后端 `nameKey` 同槽位） */
  nameKey: string
  sector: string
  price: number
  open: number
  high: number
  low: number
  prevClose: number
  changePct: number
  volume24h: number
  maxLeverage: number
  shortable: boolean
  halted: boolean
  /** 内在价值锚点（均值回归目标） */
  anchor: number
  floatShares: number
}

export interface BookLevel { price: number; qty: number }
export interface OrderBookSnapshot { code: string; bids: BookLevel[]; asks: BookLevel[]; ts: number }

/** 现货持仓（原型扩展：`ExchangeAccount` 的 `positions` 只装杠杆仓，现货另列） */
export interface SpotHolding {
  code: string
  qty: number
  avgCost: number
  value: number
  /** 可卖数量（总持仓扣除挂单卖出锁定的部分）——原型扩展，界面「卖出」按它给量 */
  availableQty?: number
}

export interface ExchangePosition {
  /** 原型扩展：一行一个 (code, side) 逐仓仓位的稳定 id */
  id: string
  code: string
  side: 'long' | 'short'
  qty: number
  avgEntry: number
  leverage: number
  margin: number
  unrealizedPnl: number
  liquidationPrice: number
  /** 距强平百分比（正数，越小越危险）——原型扩展，界面直接显示 */
  liquidationDistancePct?: number
}

export interface ExchangeAccount {
  cash: number
  frozen: number
  debt: number
  equity: number
  /** 原型定义：权益 / 已用保证金（100% = 不赚不亏）；接真机时按服务端口径替换 */
  marginRatio: number
  creditGrade: number
  positions: ExchangePosition[]
  pendingWithdrawals: Array<{ id: string; amount: number; availableAt: number }>
  /** 原型扩展：现货持仓 */
  holdings: SpotHolding[]
}

export interface PlaceOrderRequest {
  clientOrderId: string
  code: string
  side: Side
  type: OrderType
  tif: Tif
  price?: number
  qty: number
  /** 1 = 现货；2/5/10/20/50 = 逐仓杠杆 */
  leverage?: number
  reduceOnly?: boolean
  postOnly?: boolean
  triggerPrice?: number
}

export interface ExchangeOrder {
  id: string
  clientOrderId: string
  code: string
  side: Side
  type: OrderType
  price: number | null
  qty: number
  qtyRemaining: number
  leverage: number
  /**
   * 回合制（2026-11-03）新增 `queued`（已进本回合队列、尚未撮合）与 `expired`
   * （回合结算未成交部分撤销并解冻）。Mock 仍只用原有状态，HTTP 适配器按服务端原样透传。
   */
  status:
    | 'open'
    | 'partial'
    | 'filled'
    | 'cancelled'
    | 'rejected'
    | 'trigger_pending'
    | 'queued'
    | 'expired'
  createdAt: number
  /** 以下为原型扩展（真机响应同样会带，界面用来显示来源与成交均价） */
  source?: OrderSource
  filledQty?: number
  avgFillPrice?: number
  triggerPrice?: number
  reduceOnly?: boolean
}

/**
 * 回合时钟（Go `GET /api/exchange/round` 与 WS `round` 帧）。
 * 字段名照服务端 `RoundView`；`usedOrders` 只在 REST 响应里出现（WS 广播是公共视图，不含配额）。
 */
export interface RoundInfo {
  roundNo: number
  startedAt: number
  nextRoundAt: number
  locked: boolean
  maxOrders: number
  /** 本回合已提交笔数（撤单不返还；WS 公共帧不带，缺省按 0 处理） */
  usedOrders?: number
  /** 回合长度（秒），服务端下发，默认 300 */
  roundSec: number
  /** 回合末锁定窗口（秒），默认 10 */
  lockSec: number
  /** 服务器毫秒时间，客户端据此校正倒计时 */
  serverTime: number
}

/** 批量提交结果（Go `POST /api/exchange/orders/batch`） */
export interface BatchOrderResult {
  roundNo: number
  /** 服务端返回的批量状态，当前恒为 `queued` */
  status: string
  accepted: number
  maxOrders: number
  usedOrders: number
  orders: ExchangeOrder[]
}

export interface StrategySpec {
  id?: string
  template: 'dca' | 'grid' | 'trailing_tp' | 'stop_loss' | 'momentum' | 'event_arb'
  code: string
  params: Record<string, number | string | boolean>
  enabled: boolean
}

export type ExchangeTopic = 'book' | 'trade' | 'price' | 'kline' | 'position' | 'margin' | 'event'
export type ExchangeEventType =
  | 'book'
  | 'trade'
  | 'price'
  | 'kline'
  | 'position'
  | 'margin_call'
  | 'event'
  | 'error'
  | 'reconnect'

export interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }

/**
 * 图表周期（2026-11-03 船长追加）：`分时 / M1 / H1 / D1 / D7 / D30`。
 * 分时 = 当日 00:00（本机真实日）起的 1 分钟线；其余为按周期聚合的 K 线。
 * 服务端将来只提供原始 K 线，指标一律前端现算（避免两端口径漂移）。
 */
export type ChartPeriod = 'intraday' | 'm1' | 'h1' | 'd1' | 'd7' | 'd30'

export interface DepositResult { nonce: string; applied: number; fee: number; cash: number; receiptHash: string }
export interface WithdrawResult { nonce: string; amount: number; fee: number; availableAt: number; receiptHash: string }
export type Unsubscribe = () => void

/** 公共成交流水的「吃单方」：`mm` = 做市商主动成交（玩家挂单被吃） */
export type TradeSource = OrderSource | 'mm'

/** 逐笔成交（公共成交流水；`source` 标出是谁吃的单） */
export interface TradeRecord {
  id: string
  ts: number
  code: string
  price: number
  qty: number
  side: Side
  source: TradeSource
}

/** 财经快讯（事件驱动的对外展示面） */
export interface NewsItem {
  id: string
  ts: number
  title: string
  body: string
  tone: 'good' | 'bad' | 'warn' | 'info'
  codes: string[]
}

export interface DividendRecord {
  id: string
  ts: number
  code: string
  amount: number
}

export interface BondProduct {
  id: string
  name: string
  /** 日化利率（0.0003 = 0.03%） */
  dailyRate: number
  note: string
}

export interface BondHolding {
  principal: number
  accrued: number
  purchasedAt: number | null
  rateDaily: number
}

export interface IndexQuote {
  value: number
  changePct: number
  high: number
  low: number
}

/**
 * 下单前馈计算结果（设计稿 6.2「前馈计算」要求随输入实时重算）。
 * 放在 Mock 侧算、界面只读结果：保证金/强平公式只能有**一个实现**，
 * 界面自己再算一遍迟早与撮合口径分叉。
 */
export interface OrderPreview {
  notional: number
  margin: number
  fee: number
  /** 本次对现金的影响：正 = 到账（卖出），负 = 支出（买入/开仓，含手续费） */
  settleAmount: number
  /** 现货单为 null */
  liquidationPrice: number | null
  /** 距强平百分比（正数，越小越危险）；现货为 null */
  liquidationDistancePct: number | null
  /** 按当前资金/持仓最多还能下多少股（用于 MAX 与「建议值」） */
  maxQty: number
  /** null = 可以下单；否则是给玩家看的原因（主按钮不置灰，点击时说明） */
  blockReason: string | null
}

/**
 * 整页快照。为什么整页一次取：原型是 1 秒 tick，页面每个 tick 重渲染一次，
 * 若拆成 8 个异步请求，组件间必然出现「盘口比价格晚一秒」的错位观感。
 */
export interface ExchangeSnapshot {
  ts: number
  tick: number
  index: IndexQuote
  stocks: StockQuote[]
  quote: StockQuote
  book: OrderBookSnapshot
  trades: TradeRecord[]
  klines: Kline[]
  account: ExchangeAccount
  /** 当前委托（open / partial / trigger_pending） */
  orders: ExchangeOrder[]
  /** 我的历史成交（最近 200 笔） */
  myTrades: TradeRecord[]
  dividends: DividendRecord[]
  strategies: StrategySpec[]
  bonds: BondHolding
  bondProduct: BondProduct
  news: NewsItem[]
  /** 手续费率（界面预览用，避免把数字写死在组件里） */
  feeRate: number
}

export interface MarginCallPayload {
  code: string
  side: 'long' | 'short'
  qty: number
  price: number
  fullyClosed: boolean
}

/**
 * 唯一依赖面。UI 只 import 这个接口与上面的 DTO。
 *
 * 注：查询方法按服务端契约返回 Promise；原型页面实际读 `getSnapshot()` 的同步快照。
 */
export interface ExchangeClient {
  readonly contractVersion: number
  // 查询
  getStocks(): Promise<StockQuote[]>
  getBook(code: string): Promise<OrderBookSnapshot>
  getTrades(code: string): Promise<TradeRecord[]>
  getKlines(code: string, interval: '1m' | '5m' | '1h', limit?: number): Promise<Kline[]>
  getAccount(): Promise<ExchangeAccount>
  getOrders(): Promise<ExchangeOrder[]>
  /**
   * 回合时钟（可选：只有联机客户端实现；Mock 不实现）。
   * 未来 UI 接入点见 `round.ts` 里的 `RoundClock`。
   */
  getRound?(): Promise<RoundInfo>
  // 交易
  deposit(amount: number, nonce: string): Promise<DepositResult>
  withdraw(amount: number, nonce: string): Promise<WithdrawResult>
  placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder>
  /**
   * 批量提交（可选：只有联机客户端实现；Go `POST /orders/batch` 全成全败，单批 ≤ 每回合配额）。
   * 未来 UI 接入点见 `round.ts` 里的 `OrderQueue`。
   */
  batchPlaceOrders?(reqs: PlaceOrderRequest[]): Promise<BatchOrderResult>
  cancelOrder(id: string): Promise<void>
  closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void>
  // 量化
  listStrategies(): Promise<StrategySpec[]>
  saveStrategy(spec: StrategySpec): Promise<StrategySpec>
  deleteStrategy(id: string): Promise<void>
  // 实时
  subscribe(codes: string[], topics: ExchangeTopic[], throttle?: '1s' | '5s' | '30s'): Unsubscribe
  on(type: ExchangeEventType, cb: (payload: unknown) => void): Unsubscribe

  // ── 原型扩展（接真机时替换为轮询/推送缓存） ──
  /**
   * 页面挂载通知：确保引擎在跑，并按真实流逝时间补算离页期间漏掉的拍。
   * 2026-11-03 挂机语义：Mock 引擎由模块单例持有（构造即启动），**离开页面不暂停**；
   * `stop()` 只表示页面卸载（Mock 里顺手落盘），**不停止行情**。
   */
  start(): void
  stop(): void
  onTick(cb: () => void): Unsubscribe
  getSnapshot(code: string): ExchangeSnapshot
  /** 六周期图表数据（同步读缓存：Mock 内存直读；HTTP 由订阅缓存提供，未连上时为空数组） */
  getChartSeries(code: string, period: ChartPeriod): Kline[]
  /** 「重置模拟账户」：回到 1,000 万启动资金；HTTP 实现没有本地账户可重置 */
  resetAccount(): void
  buyBond(amount: number): BondHolding
  redeemBond(): number
  /** 下单预览（保证金/名义/手续费/强平价/距强平/上限/不可下单原因） */
  previewOrder(req: PlaceOrderRequest): OrderPreview
}

/**
 * 装配点（2026-11-03 双轨数据源批）：已迁到 `factory.ts` —— `createExchangeClient({ mode, serverUrl })`
 * 按 `localStorage['whale-idle:exch-src']` 解析 Mock / HTTP，并保证 Mock 引擎是**模块单例**。
 * 页面与组件只 import 本文件的接口与 DTO，不 import `mock/` 或 `http/` 具体实现。
 */
