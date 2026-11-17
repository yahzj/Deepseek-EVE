import type { BatchOrderResult, ExchangeClient, PlaceOrderRequest, RoundInfo } from './client'
import { ExchangeError } from './errors'

export const DEFAULT_ROUND_SEC = 300
export const DEFAULT_LOCK_SEC = 10
export const MAX_ORDERS_PER_ROUND = 10

export interface RoundClockState {
  roundNo: number
  startedAt: number
  nextRoundAt: number
  roundSec: number
  lockSec: number
  serverTime: number
  syncedAt: number
  remainingMs: number
  lockInMs: number
  locked: boolean
  maxOrders: number
  usedOrders: number
  remainingOrders: number
}

export interface RoundClockOptions {
  pollMs?: number
  tickMs?: number
  now?: () => number
  onTick?: (state: RoundClockState) => void
  onRound?: (state: RoundClockState) => void
  onLock?: (locked: boolean, state: RoundClockState) => void
  onError?: (error: unknown) => void
}

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

  async sync(): Promise<RoundClockState | null> {
    const fetchRound = this.source.getRound
    if (typeof fetchRound !== 'function') {
      this.options.onError?.(new ExchangeError('not_supported', '当前客户端未提供回合接口（仅联机模式）'))
      return this.getState()
    }
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

  handleRoundFrame(view: RoundInfo): void {
    const usedOrders = view.usedOrders
    this.applyServerRound({
      ...view,
      usedOrders: typeof usedOrders === 'number' ? usedOrders : this.usedOrders,
    })
  }

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

export interface QueuedOrder {
  id: string
  req: PlaceOrderRequest
  createdAt: number
}

export interface OrderQueueOptions {
  maxOrders?: number
  now?: () => number
}

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

  remaining(usedOrders = 0): number {
    return Math.max(0, this.maxOrders - Math.max(0, Math.round(usedOrders)) - this.queue.length)
  }

  canSubmit(usedOrders = 0): boolean {
    const allowance = Math.max(0, this.maxOrders - Math.max(0, Math.round(usedOrders)))
    return this.queue.length > 0 && this.queue.length <= allowance
  }

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

export function makeClientOrderId(prefix = 'ex'): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`
  }
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}
