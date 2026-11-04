/**
 * 回合时钟与本地排队（Go 回合制契约，2026-11-03）。**本批只导出，暂不接 UI。**
 *
 * 为什么单独成层：回合制把「什么时候能下单 / 这一回合还剩多少笔」变成两个跨组件状态，
 * 若直接写进 `ExchangePage.tsx`，页面会被倒计时与队列逻辑绑死，也违反本批「不改 UI」的红线。
 * 这里给出可测试的纯逻辑，下一批接界面时只做挂载与渲染。
 *
 * ── 未来 UI 接入点（下一批照着接，不需要改本文件契约）────────────────────
 * 1. 进入股市页：`const clock = new RoundClock(bundle.client); clock.start()`
 *    - 倒计时读 `clock.getState()?.remainingMs`（`lockInMs` 是「距锁定」）；
 *    - 新回合 / 锁定回调：`onRound` → 重拉全量快照；`onLock(true)` → 禁用下单按钮。
 * 2. 下单表单：不直接 `placeOrder`，先 `queue.add({...})`（本地最多 10 笔、与服务端配额同口径）；
 *    - 队列列表读 `queue.list()`；「提交本回合」按钮调 `await queue.flush(client, state.usedOrders)`；
 *    - 提交成功后 `queue` 自动清空，再 `client.getAccount()` / `getOrders()` 刷新读数。
 * 3. 服务端 WS `round` 帧：`HttpExchangeClient` 已缓存进 `getRoundView()`；等 UI 需要实时推送时，
 *    在页面订阅处调 `clock.handleRoundFrame(view)` 即可（本文件已实现，只是现在没人调用）。
 * 4. 回合内价格不变：不需要为了倒计时去轮询行情；`RoundClock` 只轮询 `/round`（默认 15 秒）
 *    并每秒本地推算，避免每回合打 300 次请求。
 * ────────────────────────────────────────────────────────────────────────
 */
import type { BatchOrderResult, ExchangeClient, PlaceOrderRequest, RoundInfo } from './client'
import { ExchangeError } from './errors'

/** 回合长度默认值（秒）：与服务端 `WHALE_EXCH_ROUND_SEC` 默认一致，实际以 `/round` 下发为准 */
export const DEFAULT_ROUND_SEC = 300
/** 回合末锁定窗口默认值（秒）：与服务端 `WHALE_EXCH_ROUND_LOCK_SEC` 一致 */
export const DEFAULT_LOCK_SEC = 10
/** 每账号每回合委托上限默认值：与服务端 `WHALE_EXCH_ROUND_MAX_ORDERS` 一致 */
export const MAX_ORDERS_PER_ROUND = 10

/** 计算后的回合状态（`getState()` 的返回值；倒计时字段每次读取都按当前时间重算） */
export interface RoundClockState {
  roundNo: number
  startedAt: number
  nextRoundAt: number
  roundSec: number
  lockSec: number
  /** 服务器毫秒时间（最近一次同步时的值） */
  serverTime: number
  /** 最近一次成功同步的本机时间 */
  syncedAt: number
  /** 距下一回合（毫秒） */
  remainingMs: number
  /** 距锁定窗口开始（毫秒）；已锁定时为 0 */
  lockInMs: number
  locked: boolean
  maxOrders: number
  usedOrders: number
  remainingOrders: number
}

export interface RoundClockOptions {
  /** `/round` 轮询间隔（毫秒），默认 15000；回合内价格不变，不需要更密 */
  pollMs?: number
  /** 本地倒计时刷新间隔（毫秒），默认 1000 */
  tickMs?: number
  /** 可注入时钟（探针/测试） */
  now?: () => number
  /** 每秒回调（UI 倒计时用） */
  onTick?: (state: RoundClockState) => void
  /** 进入新回合时回调（UI 应重拉全量快照） */
  onRound?: (state: RoundClockState) => void
  /** 进入/离开锁定窗口时回调（UI 应禁用/恢复下单） */
  onLock?: (locked: boolean, state: RoundClockState) => void
  /** 同步失败上报（不打断本地倒计时） */
  onError?: (error: unknown) => void
}

/** 只依赖 `getRound` 的最小客户端面（Mock 无此方法，RoundClock 会回报 not_supported） */
export interface RoundSource {
  getRound?: () => Promise<RoundInfo>
}

export class RoundClock {
  private readonly source: RoundSource
  private readonly options: RoundClockOptions
  private readonly now: () => number
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private info: RoundInfo | null = null
  /** 服务器时间 − 本机时间（毫秒），用于本地倒计时对齐 */
  private skewMs = 0
  private syncedAt = 0
  private syncedRoundNo = -1
  private usedOrders = 0
  private lastRoundNo = -1
  private lastLocked: boolean | null = null
  private syncing = false

  constructor(source: RoundSource, options: RoundClockOptions = {}) {
    this.source = source
    this.options = options
    this.now = options.now ?? (() => Date.now())
  }

  /** 启动：立即同步一次 `/round`，之后按 `pollMs` 轮询、按 `tickMs` 推进本地倒计时 */
  start(): void {
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(() => void this.sync(), Math.max(1_000, this.options.pollMs ?? 15_000))
    this.tickTimer = setInterval(() => this.announce(), Math.max(100, this.options.tickMs ?? 1_000))
    void this.sync()
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  /** 主动同步回合时钟（进入页面 / 收到回合广播 / 断线重连后调用） */
  async sync(): Promise<RoundClockState | null> {
    const fetchRound = this.source.getRound
    if (typeof fetchRound !== 'function') {
      this.options.onError?.(new ExchangeError('not_supported', '当前客户端未提供回合接口（仅联机模式）'))
      return this.getState()
    }
    // 同一时刻只允许一个在途请求，避免慢请求乱序覆盖新回合
    if (this.syncing) return this.getState()
    this.syncing = true
    try {
      const info = await fetchRound.call(this.source)
      this.applyServerRound(info)
      return this.getState()
    } catch (err) {
      this.options.onError?.(err)
      return this.getState()
    } finally {
      this.syncing = false
    }
  }

  /**
   * 处理服务端 WS `round` 帧（未来 UI 接入点 3）。
   * 广播是公共视图、不含 `usedOrders`：保留本地配额读数，别被 0 覆盖。
   */
  handleRoundFrame(view: RoundInfo): void {
    const usedOrders = view.usedOrders
    this.applyServerRound({
      ...view,
      usedOrders: typeof usedOrders === 'number' ? usedOrders : this.usedOrders,
    })
  }

  /** 读当前状态（每次都按本机时间重算倒计时；尚未同步过返回 null） */
  getState(): RoundClockState | null {
    const info = this.info
    if (info === null) return null
    const now = this.now()
    const serverNow = now + this.skewMs
    const roundSec = info.roundSec > 0 ? info.roundSec : DEFAULT_ROUND_SEC
    const lockSec = info.lockSec >= 0 ? info.lockSec : DEFAULT_LOCK_SEC
    const roundNo = Math.max(0, Math.floor(serverNow / (roundSec * 1_000)))
    const nextRoundAt = (roundNo + 1) * roundSec * 1_000
    const remainingMs = Math.max(0, nextRoundAt - serverNow)
    const lockInMs = Math.max(0, remainingMs - lockSec * 1_000)
    const locked = remainingMs <= lockSec * 1_000
    // 本地跨回合时配额归零（服务端按回合计数，下一次 sync 会给出权威值）
    const usedOrders = roundNo === this.syncedRoundNo ? this.usedOrders : 0
    const maxOrders = Math.max(1, Math.round(info.maxOrders || MAX_ORDERS_PER_ROUND))
    return {
      roundNo,
      startedAt: roundNo * roundSec * 1_000,
      nextRoundAt,
      roundSec,
      lockSec,
      serverTime: info.serverTime,
      syncedAt: this.syncedAt,
      remainingMs,
      lockInMs,
      locked,
      maxOrders,
      usedOrders,
      remainingOrders: Math.max(0, maxOrders - usedOrders),
    }
  }

  isLocked(): boolean {
    return this.getState()?.locked ?? false
  }

  private applyServerRound(info: RoundInfo): void {
    const now = this.now()
    this.info = info
    this.skewMs = info.serverTime - now
    this.syncedAt = now
    this.syncedRoundNo = info.roundNo
    this.usedOrders = Math.max(0, Math.round(info.usedOrders ?? this.usedOrders))
    this.announce()
  }

  /** 计算状态并派发回调（新回合 / 锁定切换 / 每秒 tick） */
  private announce(): void {
    const state = this.getState()
    if (state === null) return
    if (this.lastRoundNo !== state.roundNo) {
      this.lastRoundNo = state.roundNo
      this.options.onRound?.(state)
    }
    if (this.lastLocked !== state.locked) {
      this.lastLocked = state.locked
      this.options.onLock?.(state.locked, state)
    }
    this.options.onTick?.(state)
  }
}

/** 本地排队的一笔委托（`id` 即 `clientOrderId`，与请求一一对应） */
export interface QueuedOrder {
  id: string
  req: PlaceOrderRequest
  createdAt: number
}

export interface OrderQueueOptions {
  /** 本地上限，默认与服务端每回合配额一致（10 笔） */
  maxOrders?: number
  now?: () => number
}

/**
 * 本地委托队列：回合内先攒单，点「提交本回合」时一次批量发送。
 *
 * 硬约束：`clientOrderId` 必须由调用方生成（见 `makeClientOrderId`），队列靠它做重复校验；
 * 服务端批量接口是**全成全败**——失败时本队列**不清空**，玩家可修正后重试。
 */
export class OrderQueue {
  private readonly maxOrders: number
  private readonly now: () => number
  private queue: QueuedOrder[] = []

  constructor(options: OrderQueueOptions = {}) {
    this.maxOrders = Math.max(1, Math.floor(options.maxOrders ?? MAX_ORDERS_PER_ROUND))
    this.now = options.now ?? (() => Date.now())
  }

  get size(): number {
    return this.queue.length
  }

  get capacity(): number {
    return this.maxOrders
  }

  list(): readonly QueuedOrder[] {
    return this.queue
  }

  add(req: PlaceOrderRequest): QueuedOrder {
    if (this.queue.length >= this.maxOrders) {
      throw new ExchangeError(
        'queue_full',
        `本地排队已满：每回合最多 ${this.maxOrders} 笔，请先提交本回合`,
      )
    }
    this.validate(req)
    if (this.queue.some((item) => item.id === req.clientOrderId)) {
      throw new ExchangeError('duplicate_client_order_id', '同一批里有重复的 clientOrderId')
    }
    const order: QueuedOrder = { id: req.clientOrderId, req, createdAt: this.now() }
    this.queue = [...this.queue, order]
    return order
  }

  remove(id: string): boolean {
    const next = this.queue.filter((item) => item.id !== id)
    if (next.length === this.queue.length) return false
    this.queue = next
    return true
  }

  clear(): void {
    this.queue = []
  }

  /** 本回合还剩多少笔可提交（服务端已用配额 + 本地待提交一起扣） */
  remaining(usedOrders = 0): number {
    return Math.max(0, this.maxOrders - Math.max(0, Math.round(usedOrders)) - this.queue.length)
  }

  canSubmit(usedOrders = 0): boolean {
    const allowance = Math.max(0, this.maxOrders - Math.max(0, Math.round(usedOrders)))
    return this.queue.length > 0 && this.queue.length <= allowance
  }

  /**
   * 批量提交（`client.batchPlaceOrders`）。
   * 返回服务端结果；**只有成功才清空本地队列**（失败保留，避免丢玩家输入）。
   */
  async flush(client: Pick<ExchangeClient, 'batchPlaceOrders'>): Promise<BatchOrderResult> {
    if (this.queue.length === 0) {
      throw new ExchangeError('empty_queue', '本地队列为空，没有可提交的委托')
    }
    const submit = client.batchPlaceOrders
    if (typeof submit !== 'function') {
      throw new ExchangeError('not_supported', '当前客户端不支持批量提交（仅联机模式提供）')
    }
    const requests = this.queue.map((item) => item.req)
    const result = await submit.call(client, requests)
    this.queue = []
    return result
  }

  private validate(req: PlaceOrderRequest): void {
    if (req.clientOrderId.trim() === '') {
      throw new ExchangeError('bad_client_order_id', 'clientOrderId 不能为空')
    }
    if (req.code.trim() === '') {
      throw new ExchangeError('bad_code', '委托必须带标的代码')
    }
    if (!Number.isFinite(req.qty) || req.qty <= 0) {
      throw new ExchangeError('bad_qty', '委托数量必须是正整数股')
    }
    if (req.type === 'limit' && !(typeof req.price === 'number' && Number.isFinite(req.price) && req.price > 0)) {
      throw new ExchangeError('bad_price', '限价单必须带正数价格')
    }
  }
}

/**
 * 生成 `clientOrderId`（1~64 字符，服务端要求）。
 * 优先 `crypto.randomUUID()`（Electron/浏览器都有）；不可用时退回时间戳 + 随机串。
 */
export function makeClientOrderId(prefix = 'ex'): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`
  }
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}
