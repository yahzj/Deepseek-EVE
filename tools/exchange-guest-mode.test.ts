/**
 * 游客只读确定性用例（2026-11-05 游客行情批）。
 *
 * 跑法：node --import tsx --test tools/exchange-guest-mode.test.ts
 *
 * 钉住两条契约：
 * 1. 游客启动只拉公开行情，不产生 account/orders/strategies/round/bond/fund 的私有请求；
 * 2. 匿名传输放行只读、写请求在本地就抛未登录（绝不匿名下单）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpExchangeClient } from '../apps/desktop/src/renderer/src/features/exchange/http/HttpExchangeClient'
import { RendererTransport } from '../apps/desktop/src/renderer/src/features/exchange/http/RendererTransport'
import {
  ExchangeAuthError,
  type Transport,
  type TransportRequest,
} from '../apps/desktop/src/renderer/src/features/exchange/http/transport'

/** 记录请求且只回空行情：够 bootstrap 走完公开链路，又不依赖真实服务器。 */
class FakeTransport implements Transport {
  readonly requested: string[] = []

  async request<T>(req: TransportRequest): Promise<T> {
    this.requested.push(req.path)
    if (req.path.endsWith('/stocks') || req.path.endsWith('/news') || req.path.endsWith('/agents')) {
      return [] as unknown as T
    }
    return {} as unknown as T
  }

  subscribe(_path: string, _onMessage: (payload: unknown) => void): () => void {
    return () => {}
  }
}

test('游客启动只拉公开行情，不碰账户/委托/回合/理财', async () => {
  const transport = new FakeTransport()
  const client = new HttpExchangeClient(transport, '/api/exchange', true)
  client.start()
  await new Promise((resolve) => setTimeout(resolve, 30))
  client.stop()

  const privatePaths = ['/account', '/orders', '/strategies', '/round', '/bond', '/fund', '/positions']
  for (const path of privatePaths) {
    const hit = transport.requested.some(
      (p) => p === `/api/exchange${path}` || p.startsWith(`/api/exchange${path}/`),
    )
    assert.ok(!hit, `游客不该请求私有接口 ${path}`)
  }
  assert.ok(transport.requested.includes('/api/exchange/stocks'), '游客仍应拉公开行情')
})

test('匿名传输放行只读、写请求在本地就抛未登录', async () => {
  const calls: Array<{ url: string; method: string; auth: string | null }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('authorization'),
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  const transport = new RendererTransport({
    serverUrl: 'https://example.test',
    allowAnonymous: true,
    tokenProvider: () => null,
    fetchImpl,
  })

  await transport.request({ method: 'GET', path: '/api/exchange/stocks' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.auth, null, '游客请求不能带 Authorization')

  await assert.rejects(
    () => transport.request({ method: 'POST', path: '/api/exchange/orders', body: {} }),
    (err: unknown) => err instanceof ExchangeAuthError,
  )
  assert.equal(calls.length, 1, '写请求不该产生网络调用')
})
