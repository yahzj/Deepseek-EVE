/**
 * 交易所装配点（**双轨数据源**，2026-11-03 船长追加；同日追加「真实传输自动装配」）。
 *
 * 解析顺序（2026-11-04 可玩性批修订；与设计稿 §八 一致，新增云账号默认）：
 *   ① 显式 `opts.mode`（最高优先，联调/探针用）
 *   ② `localStorage['whale-idle:exch-src']`（玩家的显式选择：值为 `mock` / `http`，或 JSON
 *      `{"mode","serverUrl"}`；显式写 `mock` 就恒走模拟盘，尊重调试/演示意图）
 *   ③ 无显式值：**云账号已登录（会话有 token）⇒ 默认 `http`**，服务器地址取
 *      `readCloudPreferences().server`（未配置时 preferences 自己已回落到 `DEFAULT_CLOUD_SERVER`）；
 *      未登录 ⇒ 默认 `mock`
 * `http` 模式下：
 *   - 有服务器地址 + 已登录 ⇒ **自动创建 `RendererTransport`**（真实 fetch/WS，见其文件头），
 *     `ExchangePage` 一行不用改就能吃到真数据；
 *   - 没有服务器地址 / 没登录 / 显式注入了传输层时才按注入走 ⇒ 返回**引导态错误**，
 *     **不静默回退**到模拟盘。
 *
 * 为什么登录后默认 http（2026-11-04）：页面没有切换数据源的按钮（只有 mock 下的重置按钮），
 * 默认继续 mock 会让玩家永远进不了真实服务器，联机批次等于不可玩；登录态本身就是「要用云端」
 * 的信号。`origin = 'default'` 因此包含两种默认来源：登录后的 http 与未登录的 mock（枚举不变）。
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
  /**
   * 数据源决定的来源。`default` = 没有任何显式配置时的解析结果：
   * 云账号已登录 ⇒ `http`，未登录 ⇒ `mock`（详见文件头）。
   */
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

/**
 * 没有任何显式数据源时，按云账号登录态给出默认值：已登录 ⇒ `http` + 云端地址，未登录 ⇒ null。
 *
 * 只判断会话里**是否有 token**，不读取、不打印令牌内容。地址只做去空白；空地址/格式错误不在
 * 解析层兜底成模拟盘，仍返回 `http` 交给装配层报引导态（否则玩家会以为自己在联机）。
 * `readCloudPreferences()` 对「从未配置过服务器」已回落到 `DEFAULT_CLOUD_SERVER`，这里不重复。
 */
function resolveAccountDefault(): StoredSource | null {
  const prefs = readCloudPreferences()
  if (!prefs.session?.token) return null
  const server = typeof prefs.server === 'string' ? prefs.server.trim() : ''
  return { mode: 'http', serverUrl: server === '' ? null : server }
}

/** 解析当前数据源（不创建客户端；页面/工具可单独调用做徽标与引导判断） */
export function resolveExchangeSource(opts: ExchangeClientOptions = {}): ExchangeSourceInfo {
  const stored = readStoredSource()
  // 显式 opts.mode / localStorage 已表态时不再掺入账号默认，避免覆盖玩家的显式选择。
  const accountDefault = opts.mode === undefined && stored === null ? resolveAccountDefault() : null
  const mode: ExchangeMode = opts.mode ?? stored?.mode ?? accountDefault?.mode ?? 'mock'
  let serverUrl: string | null = opts.serverUrl ?? stored?.serverUrl ?? null
  // 显式 http 但没给地址（且 localStorage 也没有）时，登录态可作为地址来源；未登录仍留给引导态。
  if (serverUrl === null && mode === 'http' && accountDefault) {
    serverUrl = accountDefault.serverUrl
  }
  return {
    mode,
    serverUrl,
    origin: opts.mode !== undefined ? 'explicit' : stored ? 'localStorage' : 'default',
  }
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
