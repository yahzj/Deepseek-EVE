/**
 * 交易所装配点（**双轨数据源**，2026-11-03 船长追加）。
 *
 * 解析顺序（与设计稿 §八 一致）：
 *   ① `localStorage['whale-idle:exch-src']`（值为 `mock` / `http`，或 JSON `{"mode","serverUrl"}`）
 *   ② 默认 `mock`
 * `http` 且没有服务器地址（或没有注入传输层）⇒ 返回**引导态错误**，**不静默回退**到模拟盘。
 *
 * 为什么 Mock 用模块级单例：调试页切导航会被卸载重挂（`key={page}`），若每次进页都新建客户端，
 * 资金/持仓/策略全丢。单例构造即启动行情引擎，页面卸载只退订、不停止（挂机语义）。
 */
import type { ExchangeClient } from './client'
import { MockExchangeClient } from './mock/MockExchangeClient'
import { HttpExchangeClient } from './http/HttpExchangeClient'
import { ExchangeOfflineError, NotConnectedTransport, type Transport } from './http/transport'

/** 数据源选择键（与游戏 v31 存档完全隔离） */
export const EXCHANGE_SOURCE_KEY = 'whale-idle:exch-src'
/** 服务器地址键（可选；与数据源选择分开，方便只切模式不改地址） */
export const EXCHANGE_SERVER_KEY = 'whale-idle:exch-server'

export type ExchangeMode = 'mock' | 'http'

export interface ExchangeSourceInfo {
  mode: ExchangeMode
  serverUrl: string | null
  origin: 'localStorage' | 'explicit' | 'default'
}

export interface ExchangeClientOptions {
  mode?: ExchangeMode
  serverUrl?: string | null
  /** F1 由桌面主进程注入；F0 不传 ⇒ HTTP 模式给引导态，不产生网络 */
  transport?: Transport
}

export interface ExchangeClientBundle {
  client: ExchangeClient
  source: ExchangeSourceInfo
  /** 非空 = 页面应显示引导态（服务器未配置 / 传输层未接入） */
  error: ExchangeOfflineError | null
}

interface StoredSource {
  mode: ExchangeMode
  serverUrl: string | null
}

function readStoredSource(): StoredSource | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(EXCHANGE_SOURCE_KEY)
    if (!raw) return null
    const fallbackUrl = window.localStorage.getItem(EXCHANGE_SERVER_KEY)
    if (raw === 'mock' || raw === 'http') return { mode: raw, serverUrl: fallbackUrl }
    const parsed = JSON.parse(raw) as { mode?: unknown; serverUrl?: unknown }
    const mode = parsed?.mode === 'http' ? 'http' : parsed?.mode === 'mock' ? 'mock' : null
    if (!mode) return null
    const url =
      typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim() !== ''
        ? parsed.serverUrl.trim()
        : fallbackUrl
    return { mode, serverUrl: url }
  } catch {
    return null
  }
}

/** 解析当前数据源（不创建客户端；页面/工具可单独调用做徽标与引导判断） */
export function resolveExchangeSource(opts: ExchangeClientOptions = {}): ExchangeSourceInfo {
  const stored = readStoredSource()
  const source: ExchangeSourceInfo = {
    mode: opts.mode ?? stored?.mode ?? 'mock',
    serverUrl: opts.serverUrl ?? stored?.serverUrl ?? null,
    origin: opts.mode !== undefined ? 'explicit' : stored ? 'localStorage' : 'default',
  }
  // http 但没有地址：只标记，不在这里回退；装配时返回引导错误
  return source
}

let sharedMock: MockExchangeClient | null = null
let sharedHttp: { key: string; client: HttpExchangeClient } | null = null

/**
 * 创建/复用交易所客户端。
 * - `mock`：全进程唯一实例；构造即启动 1 秒行情，页面卸载不停止。
 * - `http`：必须同时有服务器地址与传输层，否则返回引导态错误。
 */
export function createExchangeClient(opts: ExchangeClientOptions = {}): ExchangeClientBundle {
  const source = resolveExchangeSource(opts)
  if (source.mode === 'http') {
    if (!source.serverUrl) {
      return {
        client: new HttpExchangeClient(new NotConnectedTransport()),
        source,
        error: new ExchangeOfflineError('尚未配置交易所服务器地址：请先在云端设置里填写服务器地址'),
      }
    }
    if (!opts.transport) {
      // F0 没有真实传输层：明确给引导态，不能假装连上、也不回退 Mock
      return {
        client: new HttpExchangeClient(new NotConnectedTransport()),
        source,
        error: new ExchangeOfflineError(
          '服务器地址已配置，但联机传输层尚未接入（F1 由桌面主进程 IPC 提供）',
        ),
      }
    }
    const key = `${source.serverUrl}|${opts.transport.constructor.name}`
    if (sharedHttp === null || sharedHttp.key !== key) {
      sharedHttp = { key, client: new HttpExchangeClient(opts.transport) }
    }
    return { client: sharedHttp.client, source, error: null }
  }
  if (sharedMock === null) sharedMock = new MockExchangeClient()
  return { client: sharedMock, source, error: null }
}
