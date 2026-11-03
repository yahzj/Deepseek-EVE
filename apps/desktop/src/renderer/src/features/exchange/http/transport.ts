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

export interface TransportRequest {
  method: 'GET' | 'POST' | 'DELETE'
  /** 服务器相对路径（如 `/api/exchange/stocks`）；由 Transport 负责拼 baseUrl 与鉴权头 */
  path: string
  body?: unknown
  signal?: AbortSignal
}

export interface Transport {
  request<T>(req: TransportRequest): Promise<T>
  /** 订阅服务端推送；返回退订函数。实现方负责重连与降频 */
  subscribe(path: string, onMessage: (payload: unknown) => void): Unsubscribe
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
