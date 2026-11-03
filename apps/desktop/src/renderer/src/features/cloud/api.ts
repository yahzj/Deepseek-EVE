import { readCloudPreferences } from './preferences'
import type { CloudAuthResponse, CloudProfile, CloudSave, CloudSaveVersion } from './types'

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
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== '' && url.pathname !== '/')) {
    throw new CloudApiError(0, 'invalid_server', 'invalid_server')
  }
  const pageLocation = (globalThis as { location?: { protocol: string } }).location
  if (pageLocation?.protocol === 'https:' && url.protocol !== 'https:') {
    throw new CloudApiError(0, 'insecure_server', 'insecure_server')
  }
  return url.origin
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

async function readBoundedText(response: CloudResponse): Promise<string> {
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
      if (size > MAX_RESPONSE_BYTES) {
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

  async function request<T>(path: string, init: CloudRequestInit, validate: (body: unknown) => body is T, signal?: AbortSignal): Promise<T> {
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
      const response = await fetcher(new URL(path, `${origin}/`), requestInit)
      const raw = await readBoundedText(response)
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
  }
}
