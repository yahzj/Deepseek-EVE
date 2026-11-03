import type { CloudAuthResponse } from './types'

export interface CloudPreferences {
  server: string
  session: CloudAuthResponse | null
}

const SERVER_KEY = 'whale.cloud.server'
// 公网正式入口（Cloudflare → 腾讯云源站，HTTPS）；本地联调时可临时改回 http://127.0.0.1:8787。
export const DEFAULT_CLOUD_SERVER = 'https://shit.fuckrapper.online'
const SESSION_PREFIX = 'whale.cloud.session:'
let memoryServer: string | undefined
const memorySessions = new Map<string, CloudAuthResponse | null>()

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
  if (!store) return
  try {
    if (persistentSession) store.setItem(sessionKey(server), JSON.stringify(persistentSession))
    else store.removeItem(sessionKey(server))
  } catch {
    // 写入或删除失败时，内存覆盖仍优先，防止重新读出旧凭据。
  }
}

export function saveCloudServer(server: string): void {
  memoryServer = server
  const store = storage()
  if (!store) return
  try {
    store.setItem(SERVER_KEY, server)
  } catch {
    // 当前进程继续使用刚选定的服务器，不回读旧地址。
  }
}
