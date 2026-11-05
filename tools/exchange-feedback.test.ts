/** 股市真实回执与图表按需请求回归；node --import tsx --test tools/exchange-feedback.test.ts */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpExchangeClient } from '../apps/desktop/src/renderer/src/features/exchange/http/HttpExchangeClient'
import type { Transport, TransportRequest } from '../apps/desktop/src/renderer/src/features/exchange/http/transport'

const account = (cash: number) => ({ cash, frozen: 1000 - cash, holdings: [], positions: [] })
const order = { id: 'o1', code: 'SPRK', side: 'buy', type: 'market', qty: 1, qtyRemaining: 1, status: 'queued' }
const request = { clientOrderId: 'once', code: 'SPRK', side: 'buy' as const, type: 'market' as const, tif: 'IOC' as const, qty: 1 }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test('订单与账户在释放进度保持后同时显示，重复释放无副作用', async () => {
  let cash = 1000
  let resolveAccount!: (value: unknown) => void
  const transport: Transport = {
    request: async <T>(req: TransportRequest): Promise<T> => {
      if (req.method === 'POST') { cash = 900; return order as T }
      if (cash === 1000) return account(cash) as T
      return new Promise((resolve) => { resolveAccount = resolve }) as Promise<T>
    },
    subscribe: () => () => {},
  }
  const client = new HttpExchangeClient(transport)
  await client.getAccount()
  const release = client.holdAccountUpdates()
  const task = client.placeOrder(request)
  await flush()
  assert.equal(client.getSnapshot('SPRK').account.cash, 1000)
  assert.equal(client.getSnapshot('SPRK').orders.length, 0)
  resolveAccount(account(900))
  await task
  assert.equal(client.getSnapshot('SPRK').account.cash, 1000)
  assert.equal(client.getSnapshot('SPRK').orders.length, 0)
  release(); release()
  assert.equal(client.getSnapshot('SPRK').account.cash, 900)
  assert.equal(client.getSnapshot('SPRK').orders.length, 1)
})

test('理财申购与赎回同步账户，嵌套保持直到所有动作完成', async () => {
  let cash = 1000
  const transport: Transport = {
    request: async <T>(req: TransportRequest): Promise<T> => {
      if (req.method === 'POST') { cash = req.path.endsWith('/open') ? cash - 100 : cash + 100; return { principal: 100, value: 100 } as T }
      return account(cash) as T
    },
    subscribe: () => () => {},
  }
  const client = new HttpExchangeClient(transport)
  await client.getAccount()
  const a = client.holdAccountUpdates(), b = client.holdAccountUpdates()
  await client.openBond(100, 'b1')
  await client.openFund(100, 'f1')
  assert.equal((await client.getBondPosition()).principal, 0)
  assert.equal((await client.getFundPosition()).principal, 0)
  a()
  assert.equal(client.getSnapshot('SPRK').account.cash, 1000)
  b()
  assert.equal(client.getSnapshot('SPRK').account.cash, 800)
  await client.redeemBond('b2')
  await client.redeemFund('f2')
  assert.equal(client.getSnapshot('SPRK').account.cash, 1000)
})

test('账户同步失败明确报告已受理，交易不重发', async () => {
  let posts = 0, reads = 0
  const client = new HttpExchangeClient({
    request: async <T>(req: TransportRequest): Promise<T> => {
      if (req.method === 'POST') { posts++; return order as T }
      reads++; throw new Error('offline')
    },
    subscribe: () => () => {},
  })
  await assert.rejects(client.placeOrder(request), { code: 'account_sync_pending' })
  assert.equal(posts, 1)
  assert.equal(reads, 3)
  assert.equal(client.getSnapshot('SPRK').orders.length, 1)
})

test('各标的 H1/日/周正确请求且缓存避免重复请求', async () => {
  const paths: string[] = []
  const bars = [{ t: 1000, o: 10, h: 12, l: 9, c: 11, v: 4 }]
  const client = new HttpExchangeClient({
    request: async <T>(req: TransportRequest): Promise<T> => { paths.push(req.path); return bars as T },
    subscribe: () => () => {},
  })
  for (const code of ['SPRK', 'NVSC']) for (const period of ['h1', 'd1', 'd7'] as const) {
    client.ensureChartData(code, period)
    await flush()
    assert.deepEqual(client.getChartSeries(code, period), bars)
    client.ensureChartData(code, period)
  }
  assert.equal(paths.length, 6)
  for (const interval of ['1h', '1d', '1w']) assert.equal(paths.filter((path) => path.includes(`interval=${interval}&`)).length, 2)
})

test('空历史缓存允许重试，不永久锁死；失败请求不写成成功缓存', async () => {
  const originalNow = Date.now
  let now = originalNow(), calls = 0
  Date.now = () => now
  try {
    const client = new HttpExchangeClient({
      request: async <T>(): Promise<T> => { calls++; if (calls === 1) return [] as T; if (calls === 2) throw new Error('offline'); return [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }] as T },
      subscribe: () => () => {},
    })
    for (let i = 0; i < 3; i++) { client.ensureChartData('SPRK', 'h1'); await flush(); now += 6000 }
    assert.equal(calls, 3)
    assert.equal(client.getChartSeries('SPRK', 'h1').length, 1)
  } finally { Date.now = originalNow }
})
