/**
 * Mock 交易所客户端（F0 原型）——**纯前端、内存状态、不接服务器、不写存档**。
 *
 * 一拍（1 秒）的固定步序（步序错会出现"螺旋爆仓"或"行情不跟手"）：
 *   事件冲击 → 行情演进 → 做市商重挂五档 → 同步玩家挂单成交 → 条件单 → 量化策略
 *   → 强平 → 债券计息 → 分红 → 广播
 *
 * 为什么这些顺序：价格先动，挂单才知道自己是否穿价；强平必须在策略之后（策略不能抢先
 * 替玩家躲强平）；分红/计息放最后，避免"刚成交就计一天利息"的奇怪读数。
 *
 * 随机源：全部走 `createRng(seed)`，禁止 `Math.random()`；同种子可复现整条剧情。
 */
import type {
  BondHolding,
  BondProduct,
  DividendRecord,
  ExchangeAccount,
  ExchangeClient,
  ExchangeEventType,
  ExchangeOrder,
  ExchangePosition,
  ExchangeSnapshot,
  ExchangeTopic,
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
  synthKlines,
  type PriceModel,
  type Rng,
} from './priceEngine'
import { OrderBook } from './book'
import * as M from './margin'

/** 契约版本（与后端 `/api/exchange/meta` 对齐；原型固定 1） */
const CONTRACT_VERSION = 1
/** 手续费率（原型统一 5 bp，买/卖/开/平都收） */
const FEE_RATE = 0.0005
/** 原型专用虚拟资金：1000 万 cr，不入存档 */
const START_CASH = 10_000_000
/** 每根 K 线的 tick 数（1 秒 × 60 = 1 分钟） */
const TICKS_PER_BAR = 60
/** 债券日化 0.03%（原型观感值，不代表最终经济数值） */
const BOND_DAILY_RATE = 0.0003
/** 债券计息：游戏内 60 秒 = 1 日（原型示意，非最终数值） */
const TICKS_PER_GAME_DAY = 60
/** 分红：每 60 秒按现货持仓市值象征性派 0.04%（原型观感值） */
const DIVIDEND_INTERVAL_TICKS = 60
const DIVIDEND_RATE = 0.0004

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
 * 4 家标的（船长指定代码与板块；公司名为原型占位，转正时换成正式设定）。
 * σ 的取值考虑"10 分钟里要看得见波动、又不至于 1 分钟就崩盘"：
 * 军工最躁、采矿最稳，与设计稿「军工科研 1.6% / 常规 0.9% / 蓝筹 0.5%（60 秒）」同序。
 */
const STOCK_DEFS: StockDef[] = [
  { code: 'SMHI', name: '星海重工', sector: '军工', anchor: 124.5, sigma: 0.0022, mu: 0.000004, theta: 0.00008, floatShares: 320_000_000, maxLeverage: 50, shortable: true, spreadBps: 30, levelQty: 60_000 },
  { code: 'UGMC', name: '联星矿业', sector: '采矿', anchor: 45.2, sigma: 0.0013, mu: 0.000002, theta: 0.00009, floatShares: 680_000_000, maxLeverage: 20, shortable: true, spreadBps: 40, levelQty: 120_000 },
  { code: 'OJLS', name: '欧吉物流', sector: '物流', anchor: 88.2, sigma: 0.0014, mu: 0.000002, theta: 0.00009, floatShares: 450_000_000, maxLeverage: 20, shortable: true, spreadBps: 35, levelQty: 80_000 },
  { code: 'ABSI', name: '深空蓝图', sector: '科技', anchor: 210.0, sigma: 0.0019, mu: 0.000006, theta: 0.00007, floatShares: 180_000_000, maxLeverage: 50, shortable: true, spreadBps: 25, levelQty: 35_000 },
]

const DEFAULT_CODE = STOCK_DEFS[0]!.code

interface StockState {
  def: StockDef
  model: PriceModel
  book: OrderBook
  klines: Kline[]
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  volume: number
  /** 当前 K 线所属的分钟序号（-1 = 还没有当根） */
  barIndex: number
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

interface EventTemplate {
  title: string
  body: string
  tone: 'good' | 'bad' | 'warn' | 'info'
  effects: Array<{ code: string; pct: number }>
  /** 对称事件：可整体反向（如"矿难"↔"新矿脉发现"） */
  flippable?: boolean
}

/** 四类板块联动事件（战事/矿石/航路/虫洞），冲击幅度在触发时再抖动 */
const EVENT_TEMPLATES: EventTemplate[] = [
  {
    title: '边境战事升级',
    body: '边境冲突扩大，军工订单排到明年；多条货运航线被迫绕行。',
    tone: 'warn',
    effects: [{ code: 'SMHI', pct: 0.05 }, { code: 'OJLS', pct: -0.025 }],
  },
  {
    title: '矿区产出波动',
    body: '主力矿带作业状态突变，采矿板块产量预期被重新定价。',
    tone: 'bad',
    effects: [{ code: 'UGMC', pct: -0.04 }],
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
    title: '虫洞蓝图流出',
    body: '一份虫洞构造蓝图在黑市出现，科技板块估值被重新想象。',
    tone: 'good',
    effects: [{ code: 'ABSI', pct: 0.055 }],
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

  private readonly rng: Rng
  private readonly startTs: number
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
  private bond: BondHolding = {
    principal: 0,
    accrued: 0,
    purchasedAt: null,
    rateDaily: BOND_DAILY_RATE,
  }

  constructor(seed = 20261103) {
    this.rng = createRng(seed)
    this.startTs = Date.now()
    for (const def of STOCK_DEFS) {
      const model = createPriceModel(def.code, def.anchor, def.sigma, def.mu, def.theta)
      const klines = synthKlines(model, this.rng, 90, this.startTs)
      const first = klines[0]!
      const last = klines[klines.length - 1]!
      this.stocks.set(def.code, {
        def,
        model,
        book: new OrderBook(def.code),
        klines,
        price: last.c,
        prevClose: first.o,
        open: first.o,
        high: klines.reduce((mx, k) => Math.max(mx, k.h), last.c),
        low: klines.reduce((mn, k) => Math.min(mn, k.l), last.c),
        volume: 0,
        barIndex: -1,
      })
    }
    this.indexOpen = this.indexValue()
    this.indexHigh = this.indexOpen
    this.indexLow = this.indexOpen
    // 首帧就把五档铺出来：否则进页后的第一秒盘口是全空的，像没连上
    const ts = this.ts()
    for (const st of this.stocks.values()) {
      st.book.refreshQuotes(st.price, st.def.spreadBps, st.def.levelQty, this.rng, ts)
    }
    this.news.push({
      id: 'NEWS-0',
      ts: this.startTs,
      title: '证券交易所开始试营业',
      body: '四家上市公司挂牌，行情每 1 秒刷新一次。本页为原型，虚拟资金不写入存档。',
      tone: 'info',
      codes: STOCK_DEFS.map((s) => s.code),
    })
  }

  /* ═══════════════ 生命周期与广播 ═══════════════ */

  start(): void {
    if (this.timer !== null) return
    this.timer = window.setInterval(() => this.step(), 1000)
  }

  stop(): void {
    if (this.timer === null) return
    window.clearInterval(this.timer)
    this.timer = null
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
      this.updateKline(st, price, volume, ts)
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
    this.emitTick()
  }

  private updateKline(st: StockState, price: number, volume: number, ts: number): void {
    const bar = Math.floor(this.tick / TICKS_PER_BAR)
    if (bar !== st.barIndex) {
      st.klines.push({ t: ts, o: price, h: price, l: price, c: price, v: volume })
      st.barIndex = bar
      if (st.klines.length > 150) st.klines.splice(0, st.klines.length - 150)
      return
    }
    const k = st.klines[st.klines.length - 1]
    if (!k) return
    k.h = Math.max(k.h, price)
    k.l = Math.min(k.l, price)
    k.c = price
    k.v += volume
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

  /** 指数：按初始市值权重加权 4 只标的，基点 1000（原型自造，不接服务端指数） */
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
      if (!(lower < upper) || grids < 2 || grids > 12 || !(qty > 0)) {
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
      klines: st.klines.slice(-120),
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
    const bars = st.klines
    if (interval === '1m') return bars.slice(-limit)
    const size = interval === '5m' ? 5 : 60
    const out: Kline[] = []
    for (let i = 0; i < bars.length; i += size) {
      const group = bars.slice(i, i + size)
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
    const fee = amountValue * 0.001
    if (amountValue + fee > this.cash) throw new ExchangeError('insufficient_cash', T.toastNoCash)
    this.cash -= amountValue + fee
    return { nonce, amount: amountValue, fee, availableAt: this.ts() + 60_000, receiptHash: `mock-${nonce}` }
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

