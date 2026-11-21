import type { Unsubscribe } from '../client'
import { ExchangeError } from '../errors'

export class ExchangeOfflineError extends ExchangeError {
  constructor(message = '交易所服务器未连接：请先在云端设置里填写服务器地址') {
    super('exchange_offline', message)
    this.name = 'ExchangeOfflineError'
  }
}

export class ExchangeAuthError extends ExchangeError {
  constructor(message = '尚未登录：请先在云端设置里登录账号，再进入股市') {
    super('unauthorized', message)
    this.name = 'ExchangeAuthError'
  }
}

export interface TransportRequest {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  body?: unknown
  signal?: AbortSignal
  anonymous?: boolean
}

export interface Transport {
  request<T>(req: TransportRequest): Promise<T>
  subscribe(path: string, onMessage: (payload: unknown) => void): Unsubscribe
  getCached?<T>(path: string, maxAgeMs: number): T | undefined
}

export class NotConnectedTransport implements Transport {
  async request<T>(_req: TransportRequest): Promise<T> {
    throw new ExchangeOfflineError()
  }

  subscribe(_path: string, _onMessage: (payload: unknown) => void): Unsubscribe {
    throw new ExchangeOfflineError()
  }
}
