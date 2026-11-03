/**
 * 交易所装配点（**双轨数据源**，2026-11-03 船长追加；同日追加「真实传输自动装配」）。
 *
 * 解析顺序（与设计稿 §八 一致）：
 *   ① `localStorage['whale-idle:exch-src']`（值为 `mock` / `http`，或 JSON `{"mode","serverUrl"}`）
 *   ② 默认 `mock`
 * `http` 模式下：
 *   - 有服务器地址 + 已登录 ⇒ **自动创建 `RendererTransport`**（真实 fetch/WS，见其文件头），
 *     `ExchangePage` 一行不用改就能吃到真数据；
 *   - 没有服务器地址 / 没登录 / 显式注入了传输层时才按注入走 ⇒ 返回**引导态错误**，
 *     **不静默回退**到模拟盘。
 *
 * 为什么 Mock 用模块级单例：调试页切导航会被卸载重挂（`key={page}`），若每次进页都新建客户端，
 * 资金/持仓/策略全丢。单例构造即启动行情引擎，页面卸载只退订、不停止（挂机语义）。
 * HTTP 客户端同样按「服务器地址 + 传输层类型」复用，避免切页重建连接。
 */
import type { ExchangeClient } from './client'
import { readCloudPreferences } from '../cloud/preferences'
import { MockExchangeClient } from './mock/MockExchangeClient'
import { HttpExchangeClient } from './http/HttpExchangeClient'
import { RendererTransport } from './http/RendererTransport'
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
  /**
   * 显式注入传输层（联调/探针/将来主进程 IPC 代理）。不传时 `http` 模式会自动装配
   * `RendererTransport`；未登录/无地址仍返回引导态，不产生网络。
   */
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
 * - `http`：有地址且已登录时**自动装配** `RendererTransport`；否则返回引导态错误。
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

    let transport = opts.transport
    if (!transport) {
      // 渲染层真实传输（2026-11-03 联机批）：有地址还得先登录——交易所全部私有接口都要
      // 与云存档同一个 Bearer token；没登录就进股市只会拿到 401，不如直接给引导态。
      const token = readCloudPreferences().session?.token
      if (!token) {
        return {
          client: new HttpExchangeClient(new NotConnectedTransport()),
          source,
          error: new ExchangeOfflineError(
            '尚未登录：请先在云端设置里登录账号，再进入股市（联机交易需要账号令牌）',
          ),
        }
      }
      try {
        transport = new RendererTransport({ serverUrl: source.serverUrl })
      } catch (err) {
        return {
          client: new HttpExchangeClient(new NotConnectedTransport()),
          source,
          error:
            err instanceof ExchangeOfflineError
              ? err
              : new ExchangeOfflineError('交易所服务器地址不可用：请检查云端设置里的服务器地址'),
        }
      }
    }

    const key = `${source.serverUrl}|${transport.constructor.name}`
    if (sharedHttp === null || sharedHttp.key !== key) {
      sharedHttp = { key, client: new HttpExchangeClient(transport) }
    }
    return { client: sharedHttp.client, source, error: null }
  }
  if (sharedMock === null) sharedMock = new MockExchangeClient()
  return { client: sharedMock, source, error: null }
}
