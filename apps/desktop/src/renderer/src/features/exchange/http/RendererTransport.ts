/**
 * 渲染层真实传输（2026-11-03 联机批）：渲染进程直连 Go 交易所的 fetch + WebSocket 实现。
 *
 * 为什么终于可以在这里发网络：F0 的 `Transport` 只是形状契约，要求「请求与推送都不直接写在
 * `HttpExchangeClient` 里」。现在真正需要联网，实现集中在**这一个文件**：
 *   - REST：`serverUrl + path`，`Authorization: Bearer <token>`，非 2xx 解析 `{code,message}`。
 *   - WS：`ws(s)://…/api/exchange/stream?<调用方已有 query>&token=<token>`，帧 `{type,data}`
 *     原样回调；指数退避重连（1s→30s）；页面隐藏暂停、恢复可见自动重连。
 * 这样 CSP / 令牌落点将来若改走桌面主进程 IPC，只替换本文件即可，客户端与页面不动。
 *
 * 离线缓存（2026-11-04）：GET 成功响应写入 `MarketCache`（localStorage，7 天/3MB）。只有
 * **网络层失败**（fetch throw / timeout）才回退缓存并标记离线；4xx/5xx 一律不回退不缓存。
 * WS 最新帧按 type 留存（白名单帧落盘），断线重连成功后按最近 GET 清单补拉一轮。
 *
 * 令牌纪律：只从 `tokenProvider` 现取，**不写入任何日志、错误消息或 URL 以外的地方**；
 * 本文件不调用 `console.*`。WS 的 token 只能进 query（浏览器 WebSocket 不支持自定义头），
 * 这是与 Go 服务端约定的唯一通道（`GET /api/exchange/stream` 读 `token`）。
 */
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

/* ═══════════════ 离线状态与重连事件（模块级） ═══════════════ */

/**
 * 为什么是模块级而不是实例级：`factory` 只在页面打开时建一次 transport，但页面内可能有多个
 * 读取方（将来接「离线数据」徽标），它们拿不到实例。模块级状态让 `isExchangeOffline()` 在
 * 任何地方都能读，且多个 transport（改服务器地址后重建）共享同一份链路认知。
 */
let exchangeOffline = false
const offlineListeners = new Set<(offline: boolean) => void>()
const reconnectListeners = new Set<() => void>()

/** 只读：当前是否在用本地缓存顶替实时数据（网络层不可达）。 */
export function isExchangeOffline(): boolean {
  return exchangeOffline
}

/** 订阅离线状态变化；返回退订函数。供将来 UI 显示「离线数据」徽标。 */
export function onExchangeOfflineChange(cb: (offline: boolean) => void): Unsubscribe {
  offlineListeners.add(cb)
  return () => {
    offlineListeners.delete(cb)
  }
}

/** 订阅「WS 断线重连成功」；传输层会同时按缓存清单补拉一轮，订阅方可自行再刷首屏。 */
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
      // 订阅方异常不得影响请求主流程
    }
  }
}

function notifyExchangeReconnect(): void {
  for (const cb of [...reconnectListeners]) {
    try {
      cb()
    } catch {
      // 同上
    }
  }
}

/** WS 帧在缓存里的伪键前缀：与真实 GET path 隔开，补拉时不会被当成 RPC 重放。 */
const FRAME_CACHE_PREFIX = 'frame:'

/**
 * 哪些帧值得落盘：回合末一次性广播的行情/盘口/账户/委托帧体积小、恢复价值高；
 * trades/event 帧只留在内存（`getLastFrame`），避免每回合把大数组写进 3MB 限额。
 */
const PERSISTED_FRAME_TYPES = new Set(['round', 'stocks', 'book', 'account', 'orders', 'agents'])

/** 重连补拉的路径上限：宁可少拉，也不要在弱网恢复瞬间打出一波几十个请求。 */
const RESYNC_MAX_PATHS = 64

/** 重连后稍等再补拉，给 WS 首帧/服务端限流一点余量。 */
const RESYNC_DELAY_MS = 150

/** 页面可见性来源：默认读 `document`；探针/测试可注入假实现。 */
export interface VisibilitySource {
  isHidden(): boolean
  /** 注册可见性变化回调（参数 = 现在是否隐藏）；返回解绑函数 */
  onChange(cb: (hidden: boolean) => void): () => void
}

export interface RendererTransportOptions {
  /** 交易所服务器根地址（如 `https://shit.fuckrapper.online`）；空串视为引导态 */
  serverUrl: string
  /** 令牌来源；默认读云存档会话 `readCloudPreferences().session?.token` */
  tokenProvider?: () => string | null | undefined
  /** 注入点（探针/测试/将来主进程代理）；默认全局 `fetch` */
  fetchImpl?: typeof fetch
  /** 注入点；默认全局 `WebSocket`（拿不到时订阅会抛引导态错误） */
  webSocketImpl?: typeof WebSocket | null
  /** 注入点；默认读 `document.visibilityState` */
  visibility?: VisibilitySource
  /** 指数退避起点（毫秒），默认 1000 */
  reconnectBaseMs?: number
  /** 指数退避上限（毫秒），默认 30000 */
  reconnectMaxMs?: number
  /** 注入点（探针/测试）：默认用本模块共享的 localStorage 缓存 `marketCache` */
  cache?: MarketCache
}

/** 单次 REST 请求超时：回合制下行情接口不该慢于这个值，卡住就报可重试错误 */
const REQUEST_TIMEOUT_MS = 15_000

interface StreamHandle {
  url: string
  onMessage: (payload: unknown) => void
  socket: WebSocket | null
  timer: ReturnType<typeof setTimeout> | null
  detachVisibility: (() => void) | null
  attempt: number
  stopped: boolean
  hidden: boolean
  /** 是否已经成功连上过一次；只有「连过又断」的重连才补拉（首连由 client 自己 bootstrap） */
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

/** 去掉首尾空白与末尾斜杠；空串/非法协议直接抛引导态错误。 */
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
  // 只取 origin：交易所契约里所有路由都是根绝对路径（`/api/exchange/...`），
  // 带路径前缀的地址会让请求悄悄落到错误位置，这里直接忽略 path 更可预期。
  return parsed.origin
}

export class RendererTransport implements Transport {
  private readonly serverUrl: string
  private readonly tokenProvider: () => string | null | undefined
  private readonly fetchImpl: typeof fetch
  private readonly webSocketImpl: typeof WebSocket | null
  private readonly visibility: VisibilitySource
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly streams = new Set<StreamHandle>()
  private readonly cache: MarketCache
  /** 本实例最近成功过的 GET path（旧→新），重连补拉的清单来源之一 */
  private readonly recentGetPaths = new Map<string, number>()
  /** WS 最新帧（内存态，按 type 覆盖）；`getLastFrame` 与将来的快照恢复用 */
  private readonly lastFrames = new Map<string, unknown>()
  private resyncTimer: ReturnType<typeof setTimeout> | null = null
  private resyncing = false

  constructor(options: RendererTransportOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl)
    this.tokenProvider =
      options.tokenProvider ??
      (() => readCloudPreferences().session?.token ?? null)
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

  /* ═══════════════ REST ═══════════════ */

  async request<T>(req: TransportRequest): Promise<T> {
    // 先取令牌：未登录不该产生任何网络请求（也避免把匿名请求打到生产服务器）。
    const token = this.requireToken()
    const url = this.httpUrlOf(req.path)
    /** 只有 GET 响应进缓存；下单/划转等写请求永远不缓存、也绝不回退。 */
    const cacheable = req.method === 'GET'
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    const detach = linkAbort(req.signal, controller)
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      }
      if (req.body !== undefined) headers['Content-Type'] = 'application/json'
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method: req.method,
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        })
      } catch {
        // 调用方主动取消（切标的/卸载）不该拿缓存冒充结果，仍按原样报错。
        const callerAborted = req.signal?.aborted === true
        const failure =
          timedOut || controller.signal.aborted
            ? new ExchangeError('timeout', '交易所请求超时：请稍后重试')
            : new ExchangeError('network_error', '无法连接交易所服务器：请检查网络或服务器地址')
        // 只有网络层失败才回退（fetch throw / timeout）；4xx/5xx 在下面单独分支，绝不回退。
        if (cacheable && !callerAborted) {
          const cached = this.cache.get<T>(req.path)
          if (cached !== undefined) {
            setExchangeOffline(true)
            return cached
          }
        }
        throw failure
      }
      // 收到任何响应（含 4xx/5xx）就说明链路通了：离线标记可以撤掉。
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
        // 401 统一走未登录错误：页面/调用方能据此引导重新登录，而不是当成普通业务错误。
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

  /* ═══════════════ WebSocket ═══════════════ */

  subscribe(path: string, onMessage: (payload: unknown) => void): Unsubscribe {
    const token = this.requireToken()
    if (this.webSocketImpl === null) {
      throw new ExchangeOfflineError('当前运行环境不支持 WebSocket，无法接收交易所推送')
    }
    const handle: StreamHandle = {
      url: this.wsUrlOf(path, token),
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

  /** 测试/退出用：关闭全部连接与定时器（页面正常只需退订各自的流）。 */
  dispose(): void {
    for (const handle of Array.from(this.streams)) this.disposeStream(handle)
    if (this.resyncTimer !== null) {
      clearTimeout(this.resyncTimer)
      this.resyncTimer = null
    }
  }

  /** 只读：当前是否在用本地缓存顶替实时数据（供「离线数据」徽标等读取）。 */
  isOffline(): boolean {
    return isExchangeOffline()
  }

  /** 订阅离线状态变化；返回退订函数。 */
  onOfflineChange(cb: (offline: boolean) => void): Unsubscribe {
    return onExchangeOfflineChange(cb)
  }

  /** 取某类 WS 帧的最新数据（先内存后落盘缓存），供重启/断网后恢复快照。 */
  getLastFrame(type: string): unknown {
    if (this.lastFrames.has(type)) return this.lastFrames.get(type)
    return this.cache.get(`${FRAME_CACHE_PREFIX}${type}`)
  }

  private requireToken(): string {
    const raw = this.tokenProvider()
    const token = typeof raw === 'string' ? raw.trim() : ''
    if (token === '') throw new ExchangeAuthError()
    return token
  }

  private httpUrlOf(path: string): string {
    return new URL(path, `${this.serverUrl}/`).toString()
  }

  private wsUrlOf(path: string, token: string): string {
    const url = new URL(path, `${this.serverUrl}/`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // 保留调用方已有的 codes/topics/throttle，只补 token（Go 只从 query 读令牌）。
    url.searchParams.set('token', token)
    return url.toString()
  }

  /* ═══════════════ 本地缓存 / 离线补拉 ═══════════════ */

  private rememberGetPath(path: string): void {
    this.recentGetPaths.delete(path)
    this.recentGetPaths.set(path, Date.now())
    if (this.recentGetPaths.size > RESYNC_MAX_PATHS) {
      const oldest = this.recentGetPaths.keys().next().value
      if (oldest !== undefined) this.recentGetPaths.delete(oldest)
    }
  }

  /** WS 帧按 type 覆盖留存；白名单内的帧同时落盘，重启后仍能读到最近一次广播。 */
  private rememberFrame(type: string, data: unknown): void {
    if (data === undefined) return
    this.lastFrames.set(type, data)
    if (PERSISTED_FRAME_TYPES.has(type)) this.cache.put(`${FRAME_CACHE_PREFIX}${type}`, data)
  }

  /** 重连补拉：断线期间可能已跨过回合结算，用最近读过的 GET 路径把行情/盘口/账户补齐。 */
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
        // 页面已关/全部退订后不再补拉，避免后台空转。
        if (this.streams.size === 0) break
        try {
          await this.request({ method: 'GET', path })
        } catch {
          // 单条失败（含无缓存可回退）不阻塞其余路径；离线状态由 request 统一维护。
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
    // 最近读过的路径优先；重启后本实例还没读过时，用落盘缓存里的 GET 路径兜底。
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
      this.scheduleReconnect(handle)
      return
    }
    handle.socket = socket
    socket.onopen = () => {
      // 链路恢复：撤掉离线标记；「连过又断」的重连补拉一轮（首连由 client 自己 bootstrap）。
      setExchangeOffline(false)
      const reconnected = handle.everConnected
      handle.everConnected = true
      if (reconnected) this.scheduleResync()
    }
    socket.onmessage = (event: MessageEvent) => {
      // 收到有效帧才重置退避：只「连上」不足以说明链路健康（服务端可能立刻拒绝）。
      handle.attempt = 0
      if (typeof event.data !== 'string') return
      let parsed: unknown
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }
      if (!isRecord(parsed) || typeof parsed.type !== 'string') return
      // 先留存最新帧：断网/重开后 `getLastFrame` 仍能拿到最近一次广播的行情/账户。
      this.rememberFrame(parsed.type, parsed.data)
      try {
        handle.onMessage(parsed)
      } catch {
        // 回调异常不得打断推送接收
      }
    }
    socket.onerror = () => {
      // 浏览器随后会触发 close；这里主动收口，保证按退避重连而不是静默挂着。
      try {
        socket.close()
      } catch {
        /* 已关闭 */
      }
    }
    socket.onclose = () => {
      if (handle.socket === socket) handle.socket = null
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
      // 页面隐藏：断开并停止重连，避免后台空耗与无意义重试。
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
      /* 已关闭 */
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

/** 让外部 `AbortSignal` 也能中断本次请求（不覆盖超时计时器）。 */
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
