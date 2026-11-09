/**
 * 交易所装配点（2026-11-05 游客行情批：**移除模拟盘**，未登录只能看公开行情）。
 *
 * 船长 2026-11-05 令：「股市系统的模拟盘可以去掉了，做成没有登录就只能看，不能操作。」
 * 因此数据源只剩真实服务器一条路，按登录态分成两种身份：
 *   - `account`：云账号已登录（会话有 token）⇒ Bearer 令牌，账户/委托/回合/理财/策略全可用；
 *   - `guest`：未登录 ⇒ 匿名只读：REST 不带 `Authorization`、WS 不带 `token`，只收公开行情帧；
 *     需要登录的接口（account/orders/round/bond/fund/strategies）**根本不发**
 *     （见 `HttpExchangeClient` 的 `guest` 分支），写接口由传输层直接拒绝。
 *
 * 服务器地址：`opts.serverUrl` → 云存档设置里的 server → `DEFAULT_CLOUD_SERVER`；
 * 地址解析失败才返回引导态错误（`ExchangePage` 的 <ExchangeGuide>），不再有「未登录 ⇒ 引导页」。
 *
 * 为什么 HTTP 客户端按「地址 + 身份」复用：切页会重新调 `createExchangeClient()`，
 * 不复用会把 WS 和行情缓存全丢；但登录前后身份不同，必须换实例——否则登录后仍复用匿名连接。
 * `MockExchangeClient` 不再进运行时装配（`mock/` 模块本身保留：tools 的夹具与回放仍在用）。
 */
import type { ExchangeClient } from './client'
import { DEFAULT_CLOUD_SERVER, FALLBACK_CLOUD_SERVER, readCloudPreferences } from '../cloud/preferences'
import { HttpExchangeClient } from './http/HttpExchangeClient'
import { RendererTransport } from './http/RendererTransport'
import { ExchangeOfflineError, NotConnectedTransport, type Transport } from './http/transport'

/** 当前会话身份：登录后用账号令牌，未登录只读公开行情 */
export type ExchangeAuth = 'account' | 'guest'

export interface ExchangeSourceInfo {
  serverUrl: string
  /** `account` = 已登录可操作；`guest` = 未登录，页面只读 */
  auth: ExchangeAuth
}

export interface ExchangeClientOptions {
  serverUrl?: string | null
  /** 显式注入传输层（联调/探针/将来主进程 IPC 代理） */
  transport?: Transport
  /** 强制游客只读（探针/测试）；默认按云账号会话里有没有 token 判断 */
  guest?: boolean
}

export interface ExchangeClientBundle {
  client: ExchangeClient
  source: ExchangeSourceInfo
  /** 非空 = 页面应显示引导态（服务器地址不可用 / 传输层未接入） */
  error: ExchangeOfflineError | null
}

/**
 * 解析当前数据源（不创建客户端；页面/工具可单独调用做徽标与游客判断）。
 *
 * 只判断会话里**是否有 token**，不读取、不打印令牌内容；地址为空时回落默认服务器，
 * 保证「未登录也能看到真实公开行情」不会因为没填地址而变成空白页。
 */
export function resolveExchangeSource(opts: ExchangeClientOptions = {}): ExchangeSourceInfo {
  const prefs = readCloudPreferences()
  const configured =
    typeof opts.serverUrl === 'string' ? opts.serverUrl.trim() : prefs.server.trim()
  const serverUrl = configured === '' ? DEFAULT_CLOUD_SERVER : configured
  const guest = opts.guest ?? !prefs.session?.token
  return { serverUrl, auth: guest ? 'guest' : 'account' }
}

let sharedHttp: { key: string; client: HttpExchangeClient } | null = null

/**
 * 创建/复用交易所客户端。
 * - 已登录/游客都走 `RendererTransport`（`allowAnonymous` 在游客时放行只读）；
 * - 地址不可解析时返回引导态错误，不静默回退到任何本地行情。
 */
export function createExchangeClient(opts: ExchangeClientOptions = {}): ExchangeClientBundle {
  const source = resolveExchangeSource(opts)
  const guest = source.auth === 'guest'

  let transport = opts.transport
  if (!transport) {
    try {
      transport = new RendererTransport({
        serverUrl: source.serverUrl,
        // 默认 IP 直连失败时换域名各试一次（不写回设置，见 RendererTransport.request）。
        fallbackServerUrl: FALLBACK_CLOUD_SERVER,
        // 游客只读：没令牌也允许 GET/WS，写请求仍抛 ExchangeAuthError。
        allowAnonymous: true,
      })
    } catch (err) {
      return {
        client: new HttpExchangeClient(new NotConnectedTransport(), '/api/exchange', true),
        source,
        error:
          err instanceof ExchangeOfflineError
            ? err
            : new ExchangeOfflineError('交易所服务器地址不可用：请检查云端设置里的服务器地址'),
      }
    }
  }

  // 身份进 key：登录/退出后必须换新实例，否则会继续复用上一个身份的连接与快照。
  const playerId = readCloudPreferences().session?.playerId ?? 'anon'
  const key = `${source.serverUrl}|${source.auth}|${playerId}|${transport.constructor.name}`
  if (sharedHttp === null || sharedHttp.key !== key) {
    // 旧实例必须硬释放：它可能还挂着引用计数（卡片或页签未卸载），
    // 不释放会带着上一个身份的 token 继续后台轮询。
    sharedHttp?.client.dispose()
    sharedHttp = { key, client: new HttpExchangeClient(transport, '/api/exchange', guest) }
  }
  return { client: sharedHttp.client, source, error: null }
}
