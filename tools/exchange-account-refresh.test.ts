/**
 * 账户读数常驻刷新 + 客户端生命周期引用计数确定性用例（2026-11-08）。
 *
 * 跑法：node --import tsx --test tools/exchange-account-refresh.test.ts
 *
 * 背景（船长报障）：清仓后活动栏卡片与「我的下注 / 我的委托」仍显示 3 笔下注，
 * 刷新页面才归零。根因是账户/委托只有交易所页签在拉，页签一卸载就没人再拉 `/account`，
 * 共享快照冻在离页那一刻。本用例钉住四条契约：
 *
 * 1. 登录态 `start()` 后 `/account`、`/orders` 按固定节奏自动重拉，不依赖页签挂载；
 * 2. `start()/stop()` 按引用计数：页签卸载不断掉卡片持有的连接，最后一个释放才断流；
 * 3. 卡片用的轻量模式 `start(false)` 只拉行情/账户/回合，不预载 K 线；
 * 4. 私有接口连续失败到阈值才上报一次 `error`，不再静默保留旧持仓。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpExchangeClient } from '../apps/desktop/src/renderer/src/features/exchange/http/HttpExchangeClient'
import type { Transport, TransportRequest } from '../apps/desktop/src/renderer/src/features/exchange/http/transport'

const BASE = '/api/exchange'
/** 与 `HttpExchangeClient` 的常驻刷新间隔一致 */
const REFRESH_MS = 10_000

interface FakeOptions {
  /** `/stocks` 返回的标的（给「是否预载 K 线」那条用例用） */
  stocks?: unknown[]
  /** 私有接口是否一律失败（给「连续失败上报」那条用例用） */
  failPrivate?: boolean
}

class FakeTransport implements Transport {
  readonly requested: string[] = []
  subscribeCalls = 0
  unsubscribed = 0
  private readonly options: FakeOptions

  constructor(options: FakeOptions = {}) {
    this.options = options
  }

  count(path: string): number {
    return this.requested.filter((item) => item === BASE + path).length
  }

  async request<T>(req: TransportRequest): Promise<T> {
    this.requested.push(req.path)
    const privatePath =
      req.path === `${BASE}/account` ||
      req.path === `${BASE}/orders` ||
      req.path === `${BASE}/strategies` ||
      req.path === `${BASE}/round`
    if (privatePath && this.options.failPrivate === true) {
      throw new Error('account sync failed')
    }
    if (req.path === `${BASE}/stocks`) return (this.options.stocks ?? []) as unknown as T
    if (req.path === `${BASE}/account`) {
      return {
        cash: 1000,
        frozen: 0,
        debt: 0,
        equity: 1000,
        marginRatio: 0,
        creditGrade: 3,
        positions: [],
        holdings: [],
        pendingWithdrawals: [],
      } as unknown as T
    }
    if (req.path === `${BASE}/orders`) return [] as unknown as T
    return {} as unknown as T
  }

  subscribe(_path: string, _onMessage: (payload: unknown) => void): () => void {
    this.subscribeCalls += 1
    return () => {
      this.unsubscribed += 1
    }
  }
}

/** 让已排队的 Promise 链跑完（`setImmediate` 不受 mock timers 影响） */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

test('登录态启动后账户/委托按固定节奏自动重拉，停止后不再请求', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const transport = new FakeTransport()
  const client = new HttpExchangeClient(transport, BASE, false)

  client.start()
  await flush()
  await flush()
  const accountBefore = transport.count('/account')
  const ordersBefore = transport.count('/orders')

  t.mock.timers.tick(REFRESH_MS)
  await flush()
  await flush()
  assert.ok(transport.count('/account') > accountBefore, '一拍后应重新拉 /account')
  assert.ok(transport.count('/orders') > ordersBefore, '一拍后应重新拉 /orders')

  client.stop()
  await flush()
  await flush()
  const accountAfter = transport.count('/account')
  t.mock.timers.tick(REFRESH_MS * 3)
  await flush()
  await flush()
  assert.equal(transport.count('/account'), accountAfter, '最后一个持有者释放后不应再轮询')
})

test('start/stop 按引用计数：页签卸载不断掉卡片持有的连接', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const transport = new FakeTransport()
  const client = new HttpExchangeClient(transport, BASE, false)

  client.start(false) // 活动栏卡片
  client.start() // 交易所页签
  await flush()
  assert.equal(transport.subscribeCalls, 1, '同一客户端只开一条 WS')
  client.stop() // 页签卸载
  assert.equal(transport.unsubscribed, 0, '卡片仍在持有，不能断流')

  client.stop() // 卡片卸载
  assert.equal(transport.unsubscribed, 1, '最后一个持有者释放才断流')

  client.dispose() // 幂等：再释放不重复退订
  assert.equal(transport.unsubscribed, 1)
})

test('轻量模式（卡片）不预载 K 线，全量模式（页签）才预载', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const stocks = [{ code: 'CLON', price: 100, changePct: 0 }]

  const light = new FakeTransport({ stocks })
  const lightClient = new HttpExchangeClient(light, BASE, false)
  lightClient.start(false)
  for (let i = 0; i < 6; i += 1) await flush()
  assert.equal(light.count('/account'), 1, '轻量模式仍要拉账户读数')
  assert.ok(
    !light.requested.some((path) => path.startsWith(`${BASE}/klines`)),
    '轻量模式不该预载 K 线',
  )
  lightClient.dispose()

  const full = new FakeTransport({ stocks })
  const fullClient = new HttpExchangeClient(full, BASE, false)
  fullClient.start()
  for (let i = 0; i < 6; i += 1) await flush()
  assert.ok(
    full.requested.some((path) => path.startsWith(`${BASE}/klines`)),
    '全量模式（开页签）仍要预载 K 线',
  )
  fullClient.dispose()
})

test('私有接口连续失败到阈值只上报一次 error', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const transport = new FakeTransport({ failPrivate: true })
  const client = new HttpExchangeClient(transport, BASE, false)
  const errors: unknown[] = []
  client.on('error', (payload) => errors.push(payload))

  client.start()
  await flush()
  await flush()
  // 首屏 bootstrap 拉账户失败自己会报一次（既有行为），只统计它之后的「常驻刷新」上报。
  const baseline = errors.length

  for (let i = 0; i < 6; i += 1) {
    t.mock.timers.tick(REFRESH_MS)
    await flush()
    await flush()
  }
  assert.equal(errors.length - baseline, 1, '同一段连续失败只上报一次，不能每拍一弹')
  client.dispose()
})
