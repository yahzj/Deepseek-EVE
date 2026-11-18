export const MARKET_CACHE_KEY = 'whale-idle:exch-cache:v1'

export const MARKET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const MARKET_CACHE_MAX_BYTES = 3 * 1024 * 1024

export const MARKET_CACHE_WRITE_DEBOUNCE_MS = 300

export interface MarketCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface MarketCacheEntry {
  t: number
  data: unknown
}

export interface MarketCacheStats {
  entries: number
  bytes: number
  savedAt: number
  oldestAt: number | null
  ttlMs: number
  maxBytes: number
  storageAvailable: boolean
  writeBroken: boolean
}

export interface MarketCacheOptions {
  storage?: MarketCacheStorage | null
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

function defaultStorage(): MarketCacheStorage | null {
  try {
    const store = (globalThis as { localStorage?: MarketCacheStorage }).localStorage
    return store ?? null
  } catch {
    return null
  }
}

function byteLength(text: string): number {
  const Encoder = (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder
  if (typeof Encoder === 'function') return new Encoder().encode(text).length
  return text.length * 2
}

function isEntry(value: unknown): value is MarketCacheEntry {
  return isRecord(value) && typeof value.t === 'number' && Number.isFinite(value.t) && 'data' in value
}

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

  prune(): number {
    this.load()
    const removed = this.evictExpired() + this.evictToFit()
    if (removed > 0) {
      this.dirty = true
      this.scheduleFlush()
    }
    return removed
  }

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
      this.writeBroken = true
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }


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

export const marketCache = new MarketCache()
