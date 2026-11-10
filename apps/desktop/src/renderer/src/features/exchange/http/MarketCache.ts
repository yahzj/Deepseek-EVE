/**
 * 交易所本地只读缓存（2026-11-04 离线缓存批）。
 *
 * 为什么单独一个文件：`RendererTransport` 只该关心「请求怎么发」，而「数据在断网时怎么留」
 * 是另一件事——localStorage 读写、7 天保留、3MB 上限、写盘防抖都在这里收口，传输层只调
 * `get / put / drop / prune`。缓存**只服务读路径**：只允许 GET 成功响应与 WS 最新帧写入，
 * 4xx/5xx 一律不进缓存（鉴权/业务错误不能被离线数据掩盖）。
 *
 * 安全纪律：键是请求 path（含 query），值只有响应体本身；**不存 token、不存 Authorization**。
 * 账户类响应会落盘，这是离线渲染所需；同机换账号时旧账户数据可能短时可见，属已知限制。
 *
 * 存储结构（v1，便于将来迁移时整键丢弃）：
 * ```json
 * { "savedAt": 1730000000000, "entries": { "/api/exchange/stocks": { "t": 1730000000000, "data": [] } } }
 * ```
 */
export const MARKET_CACHE_KEY = 'whale-idle:exch-cache:v1'

/** 条目保留时长：7 天（超过即删，即使还没到 3MB 上限）。 */
export const MARKET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 序列化总大小上限：3MB；超出按 `t` 最旧淘汰。 */
export const MARKET_CACHE_MAX_BYTES = 3 * 1024 * 1024

/** 写盘防抖：每 2 秒轮询成功都写一次 localStorage 会拖慢渲染，这里合并成 300ms 一次。 */
export const MARKET_CACHE_WRITE_DEBOUNCE_MS = 300

/** 结构上只依赖这两个方法，探针可注入内存实现（不要求真 localStorage）。 */
export interface MarketCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface MarketCacheEntry {
  /** 写入时间（毫秒时间戳）；过期判断只看它，不信任 HTTP 缓存头。 */
  t: number
  data: unknown
}

export interface MarketCacheStats {
  /** 当前条目数（含 WS 帧条目） */
  entries: number
  /** 按当前结构序列化后的字节数（UTF-8） */
  bytes: number
  /** 最近一次成功写盘的时间；从未写盘为 0 */
  savedAt: number
  /** 最旧条目的写入时间；无条目为 null */
  oldestAt: number | null
  ttlMs: number
  maxBytes: number
  /** 是否拿得到 localStorage（隐私模式/无 DOM 时为 false，缓存只留在内存） */
  storageAvailable: boolean
  /** 写盘是否已静默降级（配额满且重试失败）；内存缓存仍继续工作 */
  writeBroken: boolean
}

export interface MarketCacheOptions {
  /** 注入点（探针/测试）；`null` 表示禁用落盘，只留内存 */
  storage?: MarketCacheStorage | null
  /** 注入点（测试过期用）；默认 `Date.now` */
  now?: () => number
  ttlMs?: number
  maxBytes?: number
  debounceMs?: number
}

interface MarketCacheEnvelope {
  savedAt: number
  entries: Record<string, MarketCacheEntry>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 取运行环境的 localStorage；拿不到（无 DOM / 隐私模式抛错）返回 null，缓存退化为内存态。 */
function defaultStorage(): MarketCacheStorage | null {
  try {
    const store = (globalThis as { localStorage?: MarketCacheStorage }).localStorage
    return store ?? null
  } catch {
    return null
  }
}

/** UTF-8 字节数；没有 TextEncoder 时按 UTF-16 双字节保守估算。 */
function byteLength(text: string): number {
  const Encoder = (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder
  if (typeof Encoder === 'function') return new Encoder().encode(text).length
  return text.length * 2
}

/** 旧条目/损坏数据一律视为不可用，避免一条坏记录让整个缓存报废。 */
function isEntry(value: unknown): value is MarketCacheEntry {
  return isRecord(value) && typeof value.t === 'number' && Number.isFinite(value.t) && 'data' in value
}

/** 拒绝原型污染键（缓存键来自请求 path，正常不会出现，但落盘数据不可信）。 */
function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

export class MarketCache {
  private readonly injectedStorage: MarketCacheStorage | null | undefined
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxBytes: number
  private readonly debounceMs: number

  private readonly entries = new Map<string, MarketCacheEntry>()
  private savedAt = 0
  private loaded = false
  private dirty = false
  private writeBroken = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private resolvedStorage: MarketCacheStorage | null = null

  constructor(options: MarketCacheOptions = {}) {
    this.injectedStorage = options.storage
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = Math.max(1, options.ttlMs ?? MARKET_CACHE_TTL_MS)
    this.maxBytes = Math.max(1_024, options.maxBytes ?? MARKET_CACHE_MAX_BYTES)
    this.debounceMs = Math.max(0, options.debounceMs ?? MARKET_CACHE_WRITE_DEBOUNCE_MS)
  }

  /* ═══════════════ 读 ═══════════════ */

  /** 取未过期条目；过期的当场删除（写盘交给防抖），没有则返回 undefined。 */
  get<T = unknown>(path: string): T | undefined {
    this.load()
    const entry = this.entries.get(path)
    if (entry === undefined) return undefined
    if (this.isExpired(entry.t)) {
      this.entries.delete(path)
      this.markDirty()
      return undefined
    }
    return entry.data as T
  }

  /**
   * 取「最近 maxAgeMs 内」写过的条目，用于首屏缓存秒开。
   * 与 `get` 的区别：这里额外收紧时效——7 天缓存可以离线兜底，但不能拿来当今天的行情展示。
   */
  getFresh<T = unknown>(path: string, maxAgeMs: number): T | undefined {
    this.load()
    const entry = this.entries.get(path)
    if (entry === undefined) return undefined
    if (this.isExpired(entry.t)) {
      this.entries.delete(path)
      this.markDirty()
      return undefined
    }
    const age = this.now() - entry.t
    if (age < 0 || age > Math.max(0, maxAgeMs)) return undefined
    return entry.data as T
  }

  /** 供重连补拉用：按写入时间新→旧列出所有缓存 path（含 WS 帧伪键，调用方自行过滤）。 */
  paths(): string[] {
    this.load()
    return [...this.entries.entries()]
      .sort((a, b) => b[1].t - a[1].t)
      .map(([path]) => path)
  }

  stats(): MarketCacheStats {
    this.load()
    let oldestAt: number | null = null
    for (const entry of this.entries.values()) {
      if (oldestAt === null || entry.t < oldestAt) oldestAt = entry.t
    }
    return {
      entries: this.entries.size,
      bytes: byteLength(this.serialize()),
      savedAt: this.savedAt,
      oldestAt,
      ttlMs: this.ttlMs,
      maxBytes: this.maxBytes,
      storageAvailable: this.storage() !== null,
      writeBroken: this.writeBroken,
    }
  }

  /* ═══════════════ 写 ═══════════════ */

  /** 写入一条（内存立即生效，落盘 300ms 防抖合并）；`undefined` 视为「没有数据」直接忽略。 */
  put(path: string, data: unknown): void {
    if (path === '' || data === undefined) return
    this.load()
    this.entries.set(path, { t: this.now(), data })
    this.markDirty()
  }

  drop(path: string): void {
    this.load()
    if (this.entries.delete(path)) this.markDirty()
  }

  /** 清过期 + 超限淘汰；返回删除条数。可由调用方在启动/定时维护时主动调用。 */
  prune(): number {
    this.load()
    const removed = this.evictExpired() + this.evictToFit()
    if (removed > 0) {
      this.dirty = true
      this.scheduleFlush()
    }
    return removed
  }

  /** 立刻落盘（防抖窗口内的挂起写入也会一并合并）；探针/退出前可显式调用。 */
  flush(): void {
    this.load()
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.dirty = false
    try {
      this.persist()
    } catch {
      // 序列化失败（不可序列化数据）或存储异常：静默降级，内存缓存继续服务本次会话。
      this.writeBroken = true
    }
  }

  /** 取消挂起的写盘定时器（探针/测试用）；不会丢弃内存数据。 */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /* ═══════════════ 内部：加载 / 持久化 ═══════════════ */

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    const store = this.storage()
    if (store === null) return
    let raw: string | null
    try {
      raw = store.getItem(MARKET_CACHE_KEY)
    } catch {
      return
    }
    if (raw === null || raw === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!isRecord(parsed) || !isRecord(parsed.entries)) return
    if (typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
      this.savedAt = parsed.savedAt
    }
    let dropped = false
    for (const [path, value] of Object.entries(parsed.entries)) {
      if (path === '' || isUnsafeKey(path) || !isEntry(value)) {
        dropped = true
        continue
      }
      if (this.isExpired(value.t)) {
        dropped = true
        continue
      }
      this.entries.set(path, { t: value.t, data: value.data })
    }
    if (dropped) {
      this.dirty = true
      this.scheduleFlush()
    }
  }

  private storage(): MarketCacheStorage | null {
    if (this.injectedStorage !== undefined) return this.injectedStorage
    if (this.resolvedStorage === null) this.resolvedStorage = defaultStorage()
    return this.resolvedStorage
  }

  private isExpired(t: number): boolean {
    return this.now() - t > this.ttlMs
  }

  private markDirty(): void {
    this.dirty = true
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.debounceMs)
  }

  private persist(): void {
    const store = this.storage()
    if (store === null || this.writeBroken) return
    this.evictExpired()
    this.evictToFit()
    this.savedAt = this.now()
    try {
      store.setItem(MARKET_CACHE_KEY, this.serialize())
    } catch {
      // 配额满：先丢掉最旧四分之一（保留最新一条）再试一次；仍失败就本次会话只留内存缓存（静默降级）。
      this.dropOldestFraction(0.25)
      try {
        store.setItem(MARKET_CACHE_KEY, this.serialize())
      } catch {
        this.writeBroken = true
      }
    }
  }

  private serialize(): string {
    return JSON.stringify(this.envelope())
  }

  private envelope(): MarketCacheEnvelope {
    const entries: Record<string, MarketCacheEntry> = {}
    for (const [path, entry] of this.entries) entries[path] = entry
    return { savedAt: this.savedAt, entries }
  }

  private evictExpired(): number {
    let removed = 0
    for (const [path, entry] of [...this.entries]) {
      if (this.isExpired(entry.t)) {
        this.entries.delete(path)
        removed += 1
      }
    }
    return removed
  }

  /** 超过 3MB 时按 `t` 最旧淘汰；正常情况只需淘汰 1~2 条。 */
  private evictToFit(): number {
    let removed = 0
    while (this.entries.size > 0 && byteLength(this.serialize()) > this.maxBytes) {
      const oldest = this.oldestPath()
      if (oldest === undefined) break
      this.entries.delete(oldest)
      removed += 1
    }
    return removed
  }

  private dropOldestFraction(fraction: number): void {
    // 保留最新一条：配额满时宁可这次不落盘，也不能把刚拿到的行情从内存里删掉。
    const removable = Math.max(0, this.entries.size - 1)
    const count = Math.min(removable, Math.max(1, Math.ceil(this.entries.size * fraction)))
    for (let i = 0; i < count; i += 1) {
      const oldest = this.oldestPath()
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }

  private oldestPath(): string | undefined {
    let oldest: string | undefined
    let oldestT = Number.POSITIVE_INFINITY
    for (const [path, entry] of this.entries) {
      if (entry.t < oldestT) {
        oldestT = entry.t
        oldest = path
      }
    }
    return oldest
  }
}

/** 传输层默认共用的缓存实例：一个渲染进程一个交易所会话，无需各自一份。 */
export const marketCache = new MarketCache()
