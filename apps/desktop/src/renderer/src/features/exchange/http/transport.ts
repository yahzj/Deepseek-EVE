/**
 * 交易传输层（F0 只冻结形状，**不发任何网络请求**）。
 *
 * 为什么单独抽出 `Transport`：`HttpExchangeClient` 不应该知道请求到底走 `fetch`、WebSocket
 * 还是桌面主进程 IPC（CSP 与令牌落点是 F1 的裁决，见主设计稿 D6）。这里只约定
 * 「发一个请求 / 订阅一路推送」，原型阶段注入 `NotConnectedTransport` 即可保证零网络。
 */
import type { Unsubscribe } from '../client'
import { ExchangeError } from '../errors'

/** 交易所服务器未连接 / 未配置（页面据此显示引导态，不静默回退到模拟盘） */
export class ExchangeOfflineError extends ExchangeError {
  constructor(message = '交易所服务器未连接：请先在云端设置里填写服务器地址') {
    super('exchange_offline', message)
    this.name = 'ExchangeOfflineError'
  }
}

/**
 * 未登录 / 令牌失效（2026-11-03 联机批）。
 *
 * 为什么单独一个类型：引导态要能区分「服务器没配」和「登录没做」——前者让玩家去填地址，
 * 后者让玩家去登录；两者都**不允许**静默回退到模拟盘。服务端 401 也归到这里。
 */
export class ExchangeAuthError extends ExchangeError {
  constructor(message = '尚未登录：请先在云端设置里登录账号，再进入股市') {
    super('unauthorized', message)
    this.name = 'ExchangeAuthError'
  }
}

export interface TransportRequest {
  method: 'GET' | 'POST' | 'DELETE'
  /** 服务器相对路径（如 `/api/exchange/stocks`）；由 Transport 负责拼 baseUrl 与鉴权头 */
  path: string
  body?: unknown
  signal?: AbortSignal
  /**
   * 公开只读请求：即使已登录也不带 Authorization。
   * 跨源 GET 带上这个头会多一次 CORS 预检，首屏几十个请求会翻倍。
   */
  anonymous?: boolean
}

export interface Transport {
  request<T>(req: TransportRequest): Promise<T>
  /** 订阅服务端推送；返回退订函数。实现方负责重连与降频 */
  subscribe(path: string, onMessage: (payload: unknown) => void): Unsubscribe
  /** 读最近一次成功 GET 的本地缓存（可限定时效）；实现方不支持时返回 undefined。 */
  getCached?<T>(path: string, maxAgeMs: number): T | undefined
}

/**
 * 未接入传输（原型默认）：所有请求**确定性地失败**，且不产生任何网络副作用。
 * 不要在这里偷偷回退到 Mock —— 页面必须能区分「模拟盘」与「服务器没连上」。
 */
export class NotConnectedTransport implements Transport {
  async request<T>(_req: TransportRequest): Promise<T> {
    throw new ExchangeOfflineError()
  }

  subscribe(_path: string, _onMessage: (payload: unknown) => void): Unsubscribe {
    throw new ExchangeOfflineError()
  }
}
