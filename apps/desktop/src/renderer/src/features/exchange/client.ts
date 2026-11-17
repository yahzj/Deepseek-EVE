export { ExchangeError } from './errors'

export type Side = 'buy' | 'sell'
export type OrderType = 'limit' | 'market' | 'stop' | 'take_profit' | 'conditional'
export type Tif = 'GTC' | 'IOC'

export type OrderSource = 'manual' | 'strategy' | 'conditional' | 'liquidation'

export interface StockQuote {
  code: string
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
  anchor: number
  floatShares: number
}

export interface BookLevel { price: number; qty: number }
export interface OrderBookSnapshot { code: string; bids: BookLevel[]; asks: BookLevel[]; ts: number }

export interface CompanyReport {
  id: string
  ts: number
  weekKey: string
  company: string
  name: string
  revenue: number
  cost: number
  gross: number
  prevAvgGross: number
  grossDeltaBp: number
  anchorShiftBp: number
  trades: number
}

export interface CompanyInfo {
  company: string
  name: string
  sector: string
  anchorShiftBp: number
  anchorPrice: number
  lastReport?: CompanyReport
}

export interface CompanyFlowEntry {
  good: string
  side: 'buy' | 'sell'
  amount: number
  count: number
}

export interface CompanyFlowsResult {
  accepted: number
  ignored: number
  companies?: string[]
}

export interface SpotHolding {
  code: string
  qty: number
  avgCost: number
  value: number
  availableQty?: number
}

export interface ExchangePosition {
  id: string
  code: string
  side: 'long' | 'short'
  qty: number
  avgEntry: number
  leverage: number
  margin: number
  unrealizedPnl: number
  liquidationPrice: number
  liquidationDistancePct?: number
}

export interface ExchangeAccount {
  cash: number
  frozen: number
  debt: number
  equity: number
  marginRatio: number
  creditGrade: number
  positions: ExchangePosition[]
  pendingWithdrawals: Array<{ id: string; amount: number; availableAt: number }>
  holdings: SpotHolding[]
  dailyTradeLimit: number
  dailyTradeUsed: number
  dailyBuyUsed?: number
  dailySellUsed?: number
}

export interface PlaceOrderRequest {
  clientOrderId: string
  code: string
  side: Side
  type: OrderType
  tif: Tif
  price?: number
  qty: number
  leverage?: number
  short?: boolean
  reduceOnly?: boolean
  postOnly?: boolean
  triggerPrice?: number
  guaranteed?: boolean
  expectedPrice?: number
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
  roundNo?: number
  short?: boolean
  source?: OrderSource
  filledQty?: number
  avgFillPrice?: number
  triggerPrice?: number
  reduceOnly?: boolean
}

export interface RoundInfo {
  roundNo: number
  startedAt: number
  nextRoundAt: number
  locked: boolean
  maxOrders: number
  usedOrders?: number
  roundSec: number
  lockSec: number
  serverTime: number
}

export interface BatchOrderResult {
  roundNo: number
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
  runtime?: {
    lastRound: number
    events: Array<{ roundNo: number; ts: number; status: string; reason: string; side?: Side; qty?: number; filledQty?: number; orderId?: number }>
  }
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

export type ChartPeriod = 'intraday' | 'm1' | 'm5' | 'h5' | 'd5' | 'd35' | 'h1' | 'd1' | 'd7' | 'd30'

export interface DepositResult { nonce: string; applied: number; fee: number; cash: number; receiptHash: string }
export interface WithdrawResult { nonce: string; amount: number; fee: number; availableAt: number; receiptHash: string }

export interface FundPosition {
  principal: number
  accrued: number
  value: number
  settledMinute: number
  openedAt: number
  minutes: number
  winDailyPpb: number
  loseDailyPpb: number
  winPercent: number
  lowDailyPpb?: number
  principalCap?: number
  dailyCap?: number
  capUsed?: number
  cash: number
}
export type Unsubscribe = () => void

export type TradeSource = OrderSource | 'mm'

export interface TradeRecord {
  id: string
  ts: number
  code: string
  price: number
  qty: number
  side: Side
  source: TradeSource
}

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

export interface AgentHolding {
  code: string
  qty: number
  avgCost: number
  price: number
  value: number
}

export interface AgentAction {
  id: number
  roundNo: number
  code: string
  side: string
  qty: number
  price: number
  reason: string
  createdAt: number
}

export interface AgentView {
  persona: string
  name: string
  callsign: string
  role: string
  mood: string
  cash: number
  frozen: number
  initialCash: number
  positionValue: number
  equity: number
  pnl: number
  lastRound: number
  lastActionAt: number
  holdings: AgentHolding[]
  recentActions: AgentAction[]
}

export interface BondProduct {
  id: string
  name: string
  dailyRate: number
  lowDailyRate?: number
  principalCap?: number
  dailyCap?: number
  note: string
}

export interface BondHolding {
  principal: number
  accrued: number
  purchasedAt: number | null
  rateDaily: number
}

export interface BondPosition {
  principal: number
  accrued: number
  value: number
  settledMinute: number
  openedAt: number
  minutes: number
  winDailyPpb: number
  loseDailyPpb: number
  winPermille: number
  lowDailyPpb?: number
  principalCap?: number
  dailyCap?: number
  capUsed?: number
  cash: number
}

export interface IndexQuote {
  value: number
  changePct: number
  high: number
  low: number
}

export interface OrderPreview {
  qty?: number
  notional: number
  margin: number
  fee: number
  settleAmount: number
  liquidationPrice: number | null
  liquidationDistancePct: number | null
  maxQty: number
  blockReason: string | null
}

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
  orders: ExchangeOrder[]
  myTrades: TradeRecord[]
  dividends: DividendRecord[]
  strategies: StrategySpec[]
  bonds: BondPosition
  funds: FundPosition
  bondProduct: BondProduct
  news: NewsItem[]
  agents: AgentView[]
  feeRate: number
  round?: RoundInfo | null
}

export interface MarginCallPayload {
  code: string
  side: 'long' | 'short'
  qty: number
  price: number
  fullyClosed: boolean
}

export interface ExchangeClient {
  readonly contractVersion: number
  readonly maxOrderQty?: number
  getStocks(): Promise<StockQuote[]>
  getBook(code: string): Promise<OrderBookSnapshot>
  getTrades(code: string): Promise<TradeRecord[]>
  getKlines(code: string, interval: '1m' | '5m' | '1h', limit?: number): Promise<Kline[]>
  getCompanies?(): Promise<CompanyInfo[]>
  submitCompanyFlows?(flows: CompanyFlowEntry[]): Promise<CompanyFlowsResult>
  getAccount(): Promise<ExchangeAccount>
  getOrders(): Promise<ExchangeOrder[]>
  getRound?(): Promise<RoundInfo>
  holdAccountUpdates?(): () => void
  deposit(amount: number, nonce: string): Promise<DepositResult>
  withdraw(amount: number, nonce: string): Promise<WithdrawResult>
  placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder>
  batchPlaceOrders?(reqs: PlaceOrderRequest[]): Promise<BatchOrderResult>
  cancelOrder(id: string): Promise<void>
  closePosition(code: string, side: 'long' | 'short', qty?: number, expectedPrice?: number): Promise<void>
  listStrategies(): Promise<StrategySpec[]>
  saveStrategy(spec: StrategySpec): Promise<StrategySpec>
  deleteStrategy(id: string): Promise<void>
  subscribe(codes: string[], topics: ExchangeTopic[], throttle?: '1s' | '5s' | '30s'): Unsubscribe
  on(type: ExchangeEventType, cb: (payload: unknown) => void): Unsubscribe

  start(withBootstrap?: boolean): void
  stop(): void
  dispose?(): void
  retryBootstrap?(): void
  ensureSymbolData?(code: string): void
  ensureChartData?(code: string, period: ChartPeriod): void
  refreshCharts?(): void
  refreshMarketData?(code: string): void
  onTick(cb: () => void): Unsubscribe
  getSnapshot(code: string): ExchangeSnapshot
  getChartSeries(code: string, period: ChartPeriod): Kline[]
  getBondPosition(): Promise<BondPosition>
  openBond(amount: number, nonce: string): Promise<BondPosition>
  redeemBond(nonce: string): Promise<BondPosition>
  getFundPosition(): Promise<FundPosition>
  openFund(amount: number, nonce: string): Promise<FundPosition>
  redeemFund(nonce: string): Promise<FundPosition>
  previewOrder(req: PlaceOrderRequest): OrderPreview
  fetchOrderPreview?(req: PlaceOrderRequest & { investment?: number }): Promise<OrderPreview>
}

