import type { CloudAuthResponse } from './types'

export interface CloudPreferences {
  server: string
  session: CloudAuthResponse | null
}

const SERVER_KEY = 'whale.cloud.server'
export const CLOUD_SESSION_CHANGE_EVENT = 'whale-cloud-session-change'
/**
 * 默认入口（2026-11-04 换新域名）：`https://game.bajibaji.party` 直连源站 nginx
 * （Let's Encrypt 正式证书，不经 Cloudflare），全程 HTTPS 加密。
 */
export const DEFAULT_CLOUD_SERVER = 'https://game.bajibaji.party'
/**
 * 兜底入口（源站 IP 明文 HTTP，经 nginx 80 反代）：仅在**请求遇到网络层失败**时用一次，
 * 不写回偏好、不替换 `DEFAULT_CLOUD_SERVER`，所以玩家可见的「服务器」始终是默认地址。
 */
export const FALLBACK_CLOUD_SERVER = 'http://123.207.188.192'
const SESSION_PREFIX = 'whale.cloud.session:'
let memoryServer: string | undefined
const memorySessions = new Map<string, CloudAuthResponse | null>()

function notifyPreferencesChanged(): void {
  try {
    const events = globalThis as typeof globalThis & { dispatchEvent?: (event: Event) => boolean }
    events.dispatchEvent?.(new Event(CLOUD_SESSION_CHANGE_EVENT))
  } catch {
    // 无事件能力的测试或运行环境仍保留内存中的最新会话。
  }
}

export interface CloudStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): CloudStorage | null {
  try {
    return (globalThis as { localStorage?: CloudStorage }).localStorage ?? null
  } catch {
    return null
  }
}
function sessionKey(server: string): string {
  return SESSION_PREFIX + server
}

function currentServer(store: CloudStorage | null): string {
  if (memoryServer !== undefined) return memoryServer
  if (!store) return DEFAULT_CLOUD_SERVER
  try {
    return store.getItem(SERVER_KEY) ?? DEFAULT_CLOUD_SERVER
  } catch {
    return DEFAULT_CLOUD_SERVER
  }
}

function readSession(server: string, store: CloudStorage | null): CloudAuthResponse | null {
  if (!server) return null
  if (memorySessions.has(server)) return memorySessions.get(server) ?? null
  if (!store) return memorySessions.get(server) ?? null
  try {
    const raw = store.getItem(sessionKey(server))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isSession(value)) return null
    return value
  } catch {
    return memorySessions.get(server) ?? null
  }
}

function isSession(value: unknown): value is CloudAuthResponse {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<CloudAuthResponse>
  return typeof session.token === 'string'
    && Number.isSafeInteger(session.playerId)
    && (typeof session.username === 'string' || session.username === null)
    && typeof session.nickname === 'string'
}

export function readCloudPreferences(): CloudPreferences {
  const store = storage()
  const server = currentServer(store)
  return { server, session: readSession(server, store) }
}

/** 只在跨窗口存储事件中清理对应缓存，本窗口的只读存储回退仍以内存为准。 */
export function refreshCloudPreferences(storageKey?: string | null): CloudPreferences {
  if (storageKey == null) {
    memoryServer = undefined
    memorySessions.clear()
  } else if (storageKey === SERVER_KEY) {
    memoryServer = undefined
  } else if (storageKey.startsWith(SESSION_PREFIX)) {
    memorySessions.delete(storageKey.slice(SESSION_PREFIX.length))
  }
  return readCloudPreferences()
}

export function saveCloudSession(server: string, session: CloudAuthResponse | null): void {
  const store = storage()
  const persistentSession = session ? {
    token: session.token,
    playerId: session.playerId,
    username: session.username,
    nickname: session.nickname,
    ...(session.email === undefined ? {} : { email: session.email }),
  } : null
  memorySessions.set(server, persistentSession)
  if (store) {
    try {
      if (persistentSession) store.setItem(sessionKey(server), JSON.stringify(persistentSession))
      else store.removeItem(sessionKey(server))
    } catch {
      // 写入或删除失败时，内存覆盖仍优先，防止重新读出旧凭据。
    }
  }
  notifyPreferencesChanged()
}

export function saveCloudServer(server: string): void {
  memoryServer = server
  const store = storage()
  if (store) {
    try {
      store.setItem(SERVER_KEY, server)
    } catch {
      // 当前进程继续使用刚选定的服务器，不回读旧地址。
    }
  }
  notifyPreferencesChanged()
}
