import type { Unsubscribe } from '../client'
import { ExchangeError } from '../errors'
import { readCloudPreferences } from '../../cloud/preferences'
import {
  ExchangeAuthError,
  ExchangeOfflineError,
  type Transport,
  type TransportRequest,
} from './transport'
import { marketCache, type MarketCache } from './MarketCache'


let exchangeOffline = false
const offlineListeners = new Set<(offline: boolean) => void>()
const reconnectListeners = new Set<() => void>()

export function isExchangeOffline(): boolean {
  return exchangeOffline
}

export function onExchangeOfflineChange(cb: (offline: boolean) => void): Unsubscribe {
  offlineListeners.add(cb)
  return () => {
    offlineListeners.delete(cb)
  }
}

export function onExchangeReconnect(cb: () => void): Unsubscribe {
  reconnectListeners.add(cb)
  return () => {
    reconnectListeners.delete(cb)
  }
}

function setExchangeOffline(next: boolean): void {
  if (exchangeOffline === next) return
  exchangeOffline = next
  for (const cb of [...offlineListeners]) {
    try {
      cb(next)
    } catch {
    }
  }
}

function notifyExchangeReconnect(): void {
  for (const cb of [...reconnectListeners]) {
    try {
      cb()
    } catch {
    }
  }
}

const FRAME_CACHE_PREFIX = 'frame:'

const PERSISTED_FRAME_TYPES = new Set(['round', 'stocks', 'book', 'account', 'orders', 'agents'])

const RESYNC_MAX_PATHS = 64

const RESYNC_DELAY_MS = 150

export interface VisibilitySource {
  isHidden(): boolean
  onChange(cb: (hidden: boolean) => void): () => void
}

export interface RendererTransportOptions {
  serverUrl: string
  fallbackServerUrl?: string
  /** 令牌来源；默认读云存档会话 `readCloudPreferences().session?.token` */
  tokenProvider?: () => string | null | undefined
  fetchImpl?: typeof fetch
  webSocketImpl?: typeof WebSocket | null
  visibility?: VisibilitySource
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  cache?: MarketCache
  allowAnonymous?: boolean
}

const REQUEST_TIMEOUT_MS = 15_000

interface StreamHandle {
  url: string
  path: string
  serverUrl: string
  onMessage: (payload: unknown) => void
  socket: WebSocket | null
  timer: ReturnType<typeof setTimeout> | null
  detachVisibility: (() => void) | null
  attempt: number
  stopped: boolean
  hidden: boolean
  everConnected: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function defaultVisibility(): VisibilitySource {
  if (typeof document === 'undefined') {
    return { isHidden: () => false, onChange: () => () => {} }
  }
  return {
    isHidden: () => document.visibilityState === 'hidden',
    onChange: (cb) => {
      const handler = (): void => cb(document.visibilityState === 'hidden')
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  }
}

function normalizeServerUrl(raw: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed === '') {
    throw new ExchangeOfflineError('尚未配置交易所服务器地址：请先在云端设置里填写服务器地址')
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new ExchangeOfflineError('交易所服务器地址格式不正确：请填写形如 https://host 的地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExchangeOfflineError('交易所服务器地址必须使用 http 或 https')
  }
  return parsed.origin
}

export class RendererTransport implements Transport {
  private readonly serverUrl: string
  private readonly fallbackServerUrl: string | null
  private readonly tokenProvider: () => string | null | undefined
  private readonly allowAnonymous: boolean
  private readonly fetchImpl: typeof fetch
  private readonly webSocketImpl: typeof WebSocket | null
  private readonly visibility: VisibilitySource
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly streams = new Set<StreamHandle>()
  private readonly cache: MarketCache
  private readonly recentGetPaths = new Map<string, number>()
  private readonly lastFrames = new Map<string, unknown>()
  private resyncTimer: ReturnType<typeof setTimeout> | null = null
  private resyncing = false

  constructor(options: RendererTransportOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl)
    this.fallbackServerUrl = this.resolveFallback(options.fallbackServerUrl)
    this.tokenProvider =
      options.tokenProvider ??
      (() => readCloudPreferences().session?.token ?? null)
    this.allowAnonymous = options.allowAnonymous === true
    this.fetchImpl =
      options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
    this.webSocketImpl =
      options.webSocketImpl !== undefined
        ? options.webSocketImpl
        : typeof WebSocket !== 'undefined'
          ? WebSocket
          : null
    this.visibility = options.visibility ?? defaultVisibility()
    this.reconnectBaseMs = Math.max(100, options.reconnectBaseMs ?? 1_000)
    this.reconnectMaxMs = Math.max(this.reconnectBaseMs, options.reconnectMaxMs ?? 30_000)
    this.cache = options.cache ?? marketCache
  }


  async request<T>(req: TransportRequest): Promise<T> {
    const token =
      req.anonymous === true ? '' : this.allowAnonymous ? this.optionalToken() : this.requireToken()
    if (token === '' && req.method !== 'GET') throw new ExchangeAuthError()
    const cacheable = req.method === 'GET'
    const servers = this.fallbackServerUrl === null
      ? [this.serverUrl]
      : [this.serverUrl, this.fallbackServerUrl]
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (token !== '') headers.Authorization = `Bearer ${token}`
    if (req.body !== undefined) headers['Content-Type'] = 'application/json'
    for (let index = 0; index < servers.length; index += 1) {
      const serverUrl = servers[index]!
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, REQUEST_TIMEOUT_MS)
      const detach = linkAbort(req.signal, controller)
      try {
        let response: Response
        try {
          response = await this.fetchImpl(this.httpUrlOf(req.path, serverUrl), {
            method: req.method,
            headers,
            body: req.body === undefined ? undefined : JSON.stringify(req.body),
            signal: controller.signal,
            cache: cacheable ? 'default' : 'no-store',
            credentials: 'omit',
            redirect: 'error',
          })
        } catch {
          const callerAborted = req.signal?.aborted === true
          const failure =
            timedOut || controller.signal.aborted
              ? new ExchangeError('timeout', '交易所请求超时：请稍后重试')
              : new ExchangeError('network_error', '无法连接交易所服务器：请检查网络或服务器地址')
          if (!callerAborted && index + 1 < servers.length) continue
          if (cacheable && !callerAborted) {
            const cached = this.cache.get<T>(req.path)
            if (cached !== undefined) {
              setExchangeOffline(true)
              return cached
            }
          }
          throw failure
        }
        setExchangeOffline(false)
        const text = await response.text().catch(() => '')
        let body: unknown
        if (text.trim() !== '') {
          try {
            body = JSON.parse(text)
          } catch {
            throw new ExchangeError('malformed_response', '交易所返回了无法解析的响应')
          }
        }
        if (!response.ok) {
          const code =
            isRecord(body) && typeof body.code === 'string' && body.code !== ''
              ? body.code
              : `http_${response.status}`
          const message =
            isRecord(body) && typeof body.message === 'string' && body.message !== ''
              ? body.message
              : `交易所请求失败（HTTP ${response.status}）`
          if (response.status === 401) throw new ExchangeAuthError(message)
          throw new ExchangeError(code, message)
        }
        if (cacheable && body !== undefined) {
          this.cache.put(req.path, body)
          this.rememberGetPath(req.path)
        }
        return body as T
      } finally {
        clearTimeout(timer)
        detach()
      }
    }
    throw new ExchangeError('network_error', '无法连接交易所服务器：请检查网络或服务器地址')
  }


  subscribe(path: string, onMessage: (payload: unknown) => void): Unsubscribe {
    const token = this.allowAnonymous ? this.optionalToken() : this.requireToken()
    if (this.webSocketImpl === null) {
      throw new ExchangeOfflineError('当前运行环境不支持 WebSocket，无法接收交易所推送')
    }
    const handle: StreamHandle = {
      url: this.wsUrlOf(path, token),
      path,
      serverUrl: this.serverUrl,
      onMessage,
      socket: null,
      timer: null,
      detachVisibility: null,
      attempt: 0,
      stopped: false,
      hidden: this.visibility.isHidden(),
      everConnected: false,
    }
    this.streams.add(handle)
    handle.detachVisibility = this.visibility.onChange((hidden) => this.onHidden(handle, hidden))
    if (!handle.hidden) this.connect(handle)
    return () => this.disposeStream(handle)
  }

  dispose(): void {
    for (const handle of Array.from(this.streams)) this.disposeStream(handle)
    if (this.resyncTimer !== null) {
      clearTimeout(this.resyncTimer)
      this.resyncTimer = null
    }
  }

  getCached<T>(path: string, maxAgeMs: number): T | undefined {
    return this.cache.getFresh<T>(path, maxAgeMs)
  }

  isOffline(): boolean {
    return isExchangeOffline()
  }

  onOfflineChange(cb: (offline: boolean) => void): Unsubscribe {
    return onExchangeOfflineChange(cb)
  }

  getLastFrame(type: string): unknown {
    if (this.lastFrames.has(type)) return this.lastFrames.get(type)
    return this.cache.get(`${FRAME_CACHE_PREFIX}${type}`)
  }

  private requireToken(): string {
    const token = this.optionalToken()
    if (token === '') throw new ExchangeAuthError()
    return token
  }

  private optionalToken(): string {
    const raw = this.tokenProvider()
    return typeof raw === 'string' ? raw.trim() : ''
  }

  private resolveFallback(raw: string | undefined): string | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null
    let origin: string
    try {
      origin = normalizeServerUrl(raw)
    } catch {
      return null
    }
    return origin === this.serverUrl ? null : origin
  }

  private httpUrlOf(path: string, serverUrl: string = this.serverUrl): string {
    return new URL(path, `${serverUrl}/`).toString()
  }

  private wsUrlOf(path: string, token: string, serverUrl: string = this.serverUrl): string {
    const url = new URL(path, `${serverUrl}/`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (token !== '') url.searchParams.set('token', token)
    return url.toString()
  }

  private switchStreamToFallback(handle: StreamHandle): boolean {
    const fallback = this.fallbackServerUrl
    if (fallback === null || handle.serverUrl === fallback) return false
    const target = new URL(fallback)
    const url = new URL(handle.url)
    url.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
    url.host = target.host
    handle.serverUrl = fallback
    handle.url = url.toString()
    return true
  }


  private rememberGetPath(path: string): void {
    this.recentGetPaths.delete(path)
    this.recentGetPaths.set(path, Date.now())
    if (this.recentGetPaths.size > RESYNC_MAX_PATHS) {
      const oldest = this.recentGetPaths.keys().next().value
      if (oldest !== undefined) this.recentGetPaths.delete(oldest)
    }
  }

  private rememberFrame(type: string, data: unknown): void {
    if (data === undefined) return
    this.lastFrames.set(type, data)
    if (PERSISTED_FRAME_TYPES.has(type)) this.cache.put(`${FRAME_CACHE_PREFIX}${type}`, data)
  }

  private scheduleResync(): void {
    if (this.resyncTimer !== null) return
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null
      void this.resync()
    }, RESYNC_DELAY_MS)
  }

  private async resync(): Promise<void> {
    if (this.resyncing) return
    this.resyncing = true
    try {
      notifyExchangeReconnect()
      for (const path of this.resyncPaths()) {
        if (this.streams.size === 0) break
        try {
          await this.request({ method: 'GET', path })
        } catch {
        }
      }
    } finally {
      this.resyncing = false
    }
  }

  private resyncPaths(): string[] {
    const seen = new Set<string>()
    const paths: string[] = []
    const push = (path: string): void => {
      if (path === '' || path.startsWith(FRAME_CACHE_PREFIX) || seen.has(path)) return
      seen.add(path)
      paths.push(path)
    }
    for (const path of [...this.recentGetPaths.keys()].reverse()) push(path)
    for (const path of this.cache.paths()) push(path)
    return paths.slice(0, RESYNC_MAX_PATHS)
  }

  private connect(handle: StreamHandle): void {
    if (handle.stopped || handle.hidden || handle.socket !== null) return
    const WebSocketImpl = this.webSocketImpl
    if (WebSocketImpl === null) return
    let socket: WebSocket
    try {
      socket = new WebSocketImpl(handle.url)
    } catch {
      if (!handle.everConnected && this.switchStreamToFallback(handle)) handle.attempt = 0
      this.scheduleReconnect(handle)
      return
    }
    handle.socket = socket
    socket.onopen = () => {
      setExchangeOffline(false)
      const reconnected = handle.everConnected
      handle.everConnected = true
      if (reconnected) this.scheduleResync()
    }
    socket.onmessage = (event: MessageEvent) => {
      handle.attempt = 0
      if (typeof event.data !== 'string') return
      let parsed: unknown
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }
      if (!isRecord(parsed) || typeof parsed.type !== 'string') return
      this.rememberFrame(parsed.type, parsed.data)
      try {
        handle.onMessage(parsed)
      } catch {
      }
    }
    socket.onerror = () => {
      try {
        socket.close()
      } catch {
      }
    }
    socket.onclose = () => {
      if (handle.socket === socket) handle.socket = null
      if (!handle.everConnected && this.switchStreamToFallback(handle)) handle.attempt = 0
      this.scheduleReconnect(handle)
    }
  }

  private scheduleReconnect(handle: StreamHandle): void {
    if (handle.stopped || handle.hidden || handle.timer !== null) return
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** Math.min(handle.attempt, 16),
    )
    handle.attempt += 1
    handle.timer = setTimeout(() => {
      handle.timer = null
      this.connect(handle)
    }, delay)
  }

  private onHidden(handle: StreamHandle, hidden: boolean): void {
    handle.hidden = hidden
    if (hidden) {
      if (handle.timer !== null) {
        clearTimeout(handle.timer)
        handle.timer = null
      }
      this.closeSocket(handle)
      return
    }
    if (handle.timer !== null) {
      clearTimeout(handle.timer)
      handle.timer = null
    }
    this.connect(handle)
  }

  private closeSocket(handle: StreamHandle): void {
    const socket = handle.socket
    handle.socket = null
    if (socket === null) return
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      socket.close()
    } catch {
    }
  }

  private disposeStream(handle: StreamHandle): void {
    if (handle.stopped) return
    handle.stopped = true
    this.streams.delete(handle)
    if (handle.timer !== null) {
      clearTimeout(handle.timer)
      handle.timer = null
    }
    handle.detachVisibility?.()
    handle.detachVisibility = null
    this.closeSocket(handle)
  }
}

function linkAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    controller.abort()
    return () => {}
  }
  const handler = (): void => controller.abort()
  signal.addEventListener('abort', handler, { once: true })
  return () => signal.removeEventListener('abort', handler)
}
