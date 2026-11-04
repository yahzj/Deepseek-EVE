import {
  DEFAULT_CLOUD_SERVER,
  FALLBACK_CLOUD_SERVER,
  readCloudPreferences,
} from './preferences'
import type { CloudAuthResponse, CloudProfile, CloudSave, CloudSaveVersion } from './types'
import type { MarketRelayRequest, MarketRelayResponse } from '@whale/core'
import { MARKET_RELAY_MAX_BYTES, marketRelayJsonWithinLimit, marketRelayRequestShape, marketRelayResponseShape } from '../market/relay/protocol'

// 兼容浏览器与 Node 的全局 fetch 类型，不要求引擎测试加载 DOM 类型库。
type CloudRequestInit = NonNullable<Parameters<typeof globalThis.fetch>[1]> & {
  cache?: 'no-store'
  referrerPolicy?: 'no-referrer'
}
type CloudResponse = Awaited<ReturnType<typeof globalThis.fetch>>

export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: unknown,
  ) {
    super(message)
    this.name = 'CloudApiError'
  }
}
export interface CloudApiOptions {
  server: string
  token?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface CloudApi {
  usernameAvailable(username: string, signal?: AbortSignal): Promise<{ available: boolean; reason?: string; message?: string }>
  signup(username: string, password: string, signal?: AbortSignal): Promise<CloudAuthResponse>
  login(username: string, password: string, signal?: AbortSignal): Promise<CloudAuthResponse>
  profile(signal?: AbortSignal): Promise<CloudProfile>
  logout(signal?: AbortSignal): Promise<void>
  redeemRecovery(code: string, deviceCode?: string, signal?: AbortSignal): Promise<CloudAuthResponse>
  rotateRecovery(signal?: AbortSignal): Promise<{ recoveryCode: string }>
  saveLatest(signal?: AbortSignal): Promise<CloudSave>
  saveVersions(signal?: AbortSignal): Promise<CloudSaveVersion[]>
  saveVersion(version: number, signal?: AbortSignal): Promise<CloudSave>
  uploadSave(data: string, baseVersion: number, signal?: AbortSignal): Promise<Pick<CloudSaveVersion, 'version' | 'size'>>
  chatHistory(channel: 'zh' | 'en', limit?: number, beforeId?: number, signal?: AbortSignal): Promise<CloudChatHistory>
  marketRelaySync(payload: MarketRelayRequest, signal?: AbortSignal): Promise<MarketRelayResponse>
}

export interface CloudChatMessage {
  id: number
  nickname: string
  text: string
  created_at: number
}

export interface CloudChatHistory {
  channel: 'zh' | 'en'
  messages: CloudChatMessage[]
  nextBeforeId?: number | null
}

const MAX_SAVE_BYTES = 10 * 1024 * 1024
// JSON 转义最坏可膨胀至六倍，另留响应元数据空间。
const MAX_RESPONSE_BYTES = 6 * MAX_SAVE_BYTES + 64 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

export function normalizeCloudServerURL(input: string): string {
  if (!input.trim()) return ''
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CloudApiError(0, 'invalid_server', 'invalid_server')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const local = hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  /**
   * 2026-11-04 船长决定「默认 IP 直连、失败回退域名」：域名走 Cloudflare，链路抖动时整站不可用，
   * 直连源站 IP 必须允许明文 HTTP（源站证书只签了域名）。因此 HTTP 放行范围从「仅回环」扩到
   * 「IP 字面量」；**域名仍必须 HTTPS**，不给明文开新口子。
   */
  const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || ipLiteral)))
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== '' && url.pathname !== '/')) {
    throw new CloudApiError(0, 'invalid_server', 'invalid_server')
  }
  const pageLocation = (globalThis as { location?: { protocol: string } }).location
  // HTTP 网页里的明文 IP 由浏览器的混合内容策略拒绝，这里只在**域名降级**时提前拦住；
  // 默认 IP 直连要留着，失败后由 createCloudApi 的回退逻辑换域名，不能在建 api 时就炸掉。
  if (pageLocation?.protocol === 'https:' && url.protocol !== 'https:' && !ipLiteral) {
    throw new CloudApiError(0, 'insecure_server', 'insecure_server')
  }
  return url.origin
}

/**
 * 只有「当前入口就是默认 IP 直连」才准备域名兜底：玩家自存的地址（含只存域名的旧会话）
 * 行为不变，仍然单点失败并把错误交给调用方。
 */
function resolveFallbackOrigin(origin: string): string | null {
  let primary: string
  let fallback: string
  try {
    primary = normalizeCloudServerURL(DEFAULT_CLOUD_SERVER)
    fallback = normalizeCloudServerURL(FALLBACK_CLOUD_SERVER)
  } catch {
    return null
  }
  if (!primary || !fallback || origin !== primary || fallback === origin) return null
  return fallback
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteInteger(value: unknown, min = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min
}

function profileShape(value: unknown): value is CloudProfile {
  return object(value) && finiteInteger(value.playerId, 1)
    && (typeof value.username === 'string' || value.username === null)
    && typeof value.nickname === 'string'
    && (value.email === undefined || typeof value.email === 'string' || value.email === null)
}

function authShape(value: unknown): value is CloudAuthResponse {
  if (!profileShape(value)) return false
  const auth = value as CloudAuthResponse
  return typeof auth.token === 'string' && auth.token.length > 0
    && (auth.recoveryCode === undefined || typeof auth.recoveryCode === 'string')
}

function saveShape(value: unknown): value is CloudSave {
  return object(value) && finiteInteger(value.version)
    && (value.version === 0 ? value.data === null
      : typeof value.data === 'string' && value.data.length > 0 && utf8Size(value.data) <= MAX_SAVE_BYTES)
    && (value.size === undefined || finiteInteger(value.size))
    && (value.createdAt === undefined || finiteInteger(value.createdAt))
}

function saveVersionShape(value: unknown): value is CloudSaveVersion {
  return object(value) && finiteInteger(value.version)
    && finiteInteger(value.size) && finiteInteger(value.createdAt)
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

async function readBoundedText(response: CloudResponse, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new CloudApiError(response.status, 'response_too_large', 'response_too_large')
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function recoveryDeviceCode(): string {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) throw new CloudApiError(0, 'crypto_unavailable', 'crypto_unavailable')
  const bytes = cryptoApi.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function createCloudApi(options: CloudApiOptions): CloudApi {
  const origin = normalizeCloudServerURL(options.server)
  if (!origin) throw new CloudApiError(0, 'invalid_server', 'invalid_server')
  const fetcher = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fallbackOrigin = resolveFallbackOrigin(origin)

  /**
   * 单次尝试：`request` 在网络层失败时会换 fallback 地址再调一次本函数，这里只管「打到某个
   * origin 上会发生什么」。令牌归属仍按调用方配置的 `origin` 判断——回退到域名时带的还是
   * 同一份会话令牌，也不会把令牌发给与配置无关的服务器。
   */
  async function attempt<T>(serverOrigin: string, path: string, init: CloudRequestInit, validate: (body: unknown) => body is T, signal?: AbortSignal, maxBytes = MAX_RESPONSE_BYTES): Promise<T> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const timer = setTimeout(abort, timeoutMs)
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    const preferences = readCloudPreferences()
    let savedServerMatches = false
    if (preferences.server) {
      try {
        savedServerMatches = normalizeCloudServerURL(preferences.server) === origin
      } catch {
        savedServerMatches = false
      }
    }
    const token = options.token ?? (savedServerMatches ? preferences.session?.token : undefined)
    if (token) headers.set('Authorization', `Bearer ${token}`)

    try {
      const requestInit: CloudRequestInit = {
        ...init, headers, signal: controller.signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      }
      const response = await fetcher(new URL(path, `${serverOrigin}/`), requestInit)
      const raw = await readBoundedText(response, maxBytes)
      let body: unknown
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        throw new CloudApiError(response.status, 'malformed_response', 'malformed_response')
      }
      if (!response.ok) {
        const code = object(body) && typeof body.code === 'string' ? body.code : 'request_failed'
        const extra: { latestVersion?: number; retryAfterMs?: number } = {}
        if (object(body) && finiteInteger(body.latestVersion)) extra.latestVersion = body.latestVersion
        if (response.status === 429) {
          if (object(body) && finiteInteger(body.retryAfterMs)) extra.retryAfterMs = body.retryAfterMs
          else {
            const retryAfter = response.headers.get('Retry-After')?.trim()
            if (retryAfter) {
              const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()
              if (finiteInteger(delay)) extra.retryAfterMs = delay
            }
          }
        }
        throw new CloudApiError(response.status, code, code, Object.keys(extra).length ? extra : undefined)
      }
      if (!validate(body)) throw new CloudApiError(response.status, 'malformed_response', 'malformed_response')
      return body
    } catch (error) {
      if (error instanceof CloudApiError) throw error
      if (controller.signal.aborted) throw new CloudApiError(0, 'timeout', 'timeout')
      throw new CloudApiError(0, 'network_error', 'network_error')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  /**
   * 默认 IP 直连失败时用域名**单次**重试，成功后照常返回（**不持久化切换服务器**，下一次仍先试
   * 默认地址，直连恢复后自动回到快路径）。
   * 重试边界：只有网络层失败（fetch throw / timeout）才换地址；4xx/5xx 与响应校验失败说明服务端
   * 已经应答，换主机重发会重复副作用（登录、上传存档），一律原样抛给调用方。调用方自己 abort 也
   * 不重试，否则「取消」会变成又一轮请求。两次都失败时抛第一次的错误。
   */
  async function request<T>(path: string, init: CloudRequestInit, validate: (body: unknown) => body is T, signal?: AbortSignal, maxBytes = MAX_RESPONSE_BYTES): Promise<T> {
    try {
      return await attempt(origin, path, init, validate, signal, maxBytes)
    } catch (error) {
      const networkFailure = error instanceof CloudApiError && error.status === 0
        && (error.code === 'network_error' || error.code === 'timeout')
      if (!networkFailure || fallbackOrigin === null || signal?.aborted) throw error
      try {
        return await attempt(fallbackOrigin, path, init, validate, signal, maxBytes)
      } catch {
        throw error
      }
    }
  }

  const json = (method: string, body?: unknown): CloudRequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const noContent = (body: unknown): body is Record<string, unknown> => object(body)

  return {
    usernameAvailable: (username, signal) => request(`/api/auth/username-available?name=${encodeURIComponent(username)}`, { method: 'GET' },
      (body): body is { available: boolean; reason?: string; message?: string } => object(body)
        && typeof body.available === 'boolean'
        && (body.reason === undefined || typeof body.reason === 'string')
        && (body.message === undefined || typeof body.message === 'string'), signal),
    signup: (username, password, signal) => request('/api/auth/signup', json('POST', { username, password }), authShape, signal),
    login: (username, password, signal) => request('/api/auth/login', json('POST', { username, password }), authShape, signal),
    profile: (signal) => request('/api/profile', { method: 'GET' }, profileShape, signal),
    logout: async (signal) => { await request('/api/auth/logout', json('POST'), noContent, signal) },
    redeemRecovery: (code, deviceCode = recoveryDeviceCode(), signal) => request('/api/auth/recovery/redeem', json('POST', { recoveryCode: code, deviceCode }),
      (body): body is CloudAuthResponse => object(body) && typeof body.token === 'string' && body.token.length > 0
        && finiteInteger(body.playerId, 1) && typeof body.nickname === 'string', signal).then(body => ({ ...body, username: null })),
    rotateRecovery: (signal) => request('/api/auth/recovery/rotate', json('POST'),
      (body): body is { recoveryCode: string } => object(body) && typeof body.recoveryCode === 'string', signal),
    saveLatest: (signal) => request('/api/saves/latest', { method: 'GET' }, saveShape, signal),
    saveVersions: async (signal) => {
      const body = await request('/api/saves/versions', { method: 'GET' },
        (value): value is { versions: CloudSaveVersion[] } => object(value) && Array.isArray(value.versions) && value.versions.every(saveVersionShape), signal)
      return body.versions
    },
    saveVersion: (version, signal) => {
      if (!finiteInteger(version)) throw new CloudApiError(0, 'invalid_version', 'invalid_version')
      return request(`/api/saves/versions/${version}`, { method: 'GET' }, saveShape, signal)
    },
    uploadSave: (data, baseVersion, signal) => {
      if (typeof data !== 'string' || utf8Size(data) > MAX_SAVE_BYTES) throw new CloudApiError(0, 'save_too_large', 'save_too_large')
      if (!finiteInteger(baseVersion)) throw new CloudApiError(0, 'invalid_base_version', 'invalid_base_version')
      return request('/api/saves', json('PUT', { data, baseVersion }),
        (body): body is Pick<CloudSaveVersion, 'version' | 'size'> => object(body)
          && finiteInteger(body.version) && finiteInteger(body.size), signal)
    },
    chatHistory: (channel, limit = 100, beforeId, signal) => {
      if (channel !== 'zh' && channel !== 'en') throw new CloudApiError(0, 'bad_channel', 'bad_channel')
      if (!finiteInteger(limit, 1) || limit > 100 || beforeId !== undefined && !finiteInteger(beforeId, 1)) {
        throw new CloudApiError(0, 'invalid_chat_cursor', 'invalid_chat_cursor')
      }
      const query = new URLSearchParams({ channel, limit: String(limit) })
      if (beforeId !== undefined) query.set('beforeId', String(beforeId))
      return request(`/api/chat/history?${query}`, { method: 'GET' },
        (body): body is CloudChatHistory => object(body)
          && body.channel === channel
          && Array.isArray(body.messages) && body.messages.length <= limit
          && body.messages.every((message) => object(message)
            && finiteInteger(message.id, 1)
            && typeof message.nickname === 'string' && message.nickname.length <= 128
            && typeof message.text === 'string' && message.text.length <= 500
            && finiteInteger(message.created_at))
          && (body.nextBeforeId === undefined || body.nextBeforeId === null || finiteInteger(body.nextBeforeId, 1)), signal, 512 * 1024)
    },
    marketRelaySync: (payload, signal) => {
      if (!marketRelayRequestShape(payload) || !marketRelayJsonWithinLimit(payload)) {
        throw new CloudApiError(0, 'invalid_market_relay_request', 'invalid_market_relay_request')
      }
      return request('/api/market/relay/sync', json('POST', payload),
        (body): body is MarketRelayResponse => marketRelayJsonWithinLimit(body) && marketRelayResponseShape(body, payload),
        signal, MARKET_RELAY_MAX_BYTES)
    },
  }
}

export function cloudChatSocketUrl(server: string, token: string): string {
  const origin = normalizeCloudServerURL(server)
  if (!origin) throw new CloudApiError(0, 'invalid_server', 'invalid_server')
  if (typeof token !== 'string' || !token.trim()) throw new CloudApiError(0, 'missing_token', 'missing_token')
  /**
   * 主入口已是 HTTPS 时 socket 就地走 wss，无需回退；只有主入口是明文 IP（旧默认模式）时，
   * 才借用回退域名把长连接升到 WSS，避免令牌在 socket 上明文传输。
   */
  const socketOrigin = origin.startsWith('https:') ? origin : (resolveFallbackOrigin(origin) ?? origin)
  const url = new URL('/api/chat/ws', socketOrigin)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const local = hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  if (url.protocol !== 'https:' && !local) throw new CloudApiError(0, 'insecure_server', 'insecure_server')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', token)
  return url.toString()
}
