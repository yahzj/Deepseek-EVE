import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HttpExchangeClient } from '../../apps/desktop/src/renderer/src/features/exchange/http/HttpExchangeClient'
import { SimpleTrade } from '../../apps/desktop/src/renderer/src/features/exchange/components/SimpleTrade'
import { TradePanel } from '../../apps/desktop/src/renderer/src/features/exchange/components/TradePanel'
import { BotPanel } from '../../apps/desktop/src/renderer/src/features/exchange/components/bot/BotPanel'
import type { StrategySpec } from '../../apps/desktop/src/renderer/src/features/exchange/client'

let cash = 1000
let posts = 0
let receipt: (() => void) | undefined
let fail = false
let lastQty = 0
let strategyWrites = 0
let strategies: StrategySpec[] = [{ id: 'real', template: 'dca', code: 'SPRK', enabled: true, params: { amount: 100, intervalSec: 300 }, runtime: { lastRound: 1, events: [{ roundNo: 1, ts: 1000, status: 'filled', reason: 'submitted', side: 'buy', qty: 10, filledQty: 10 }] } }]
const client = new HttpExchangeClient({
  async request(r) {
    if (r.path.endsWith('/strategies') && r.method === 'GET') return strategies as never
    if (r.path.endsWith('/strategies') && r.method === 'POST') { strategyWrites++; const body = r.body as StrategySpec; strategies = strategies.map(s => s.id === body.id ? body : s); return body as never }
    if (r.path.endsWith('/strategies/real') && r.method === 'DELETE') { strategyWrites++; strategies = []; return {} as never }
    if (r.path.endsWith('/orders/preview')) { const body = r.body as { qty?: number; investment?: number }; return { qty: body.investment ? 7 : body.qty, notional: 70, margin: 14, fee: 1, settleAmount: -15, maxQty: 80, liquidationPrice: 8, liquidationDistancePct: 20, blockReason: null } as never }
    if (r.method === 'POST') {
      posts += 1
      lastQty = (r.body as { qty: number }).qty
      await new Promise<void>((resolve) => { receipt = resolve })
      if (fail) throw Error('合成拒单')
      cash -= 100
      return { id: 'o' + posts, code: 'SPRK', side: 'buy', type: 'market', qty: 10, qtyRemaining: 10, status: 'queued' } as never
    }
    if (r.path.endsWith('/account')) return { cash, frozen: 1000 - cash, positions: [], holdings: [] } as never
    if (r.path.endsWith('/stocks')) return [{ code: 'SPRK', price: 10, maxLeverage: 90, shortable: true }] as never
    return [] as never
  },
  subscribe: () => () => {},
})

function Fixture() {
  const [mode, setMode] = useState('simple')
  const [, setTick] = useState(0)
  useEffect(() => client.onTick(() => setTick((n) => n + 1)), [])
  Object.assign(window, { fixture: {
    setMode,
    complete: () => receipt?.(),
    reject: () => { fail = true; receipt?.() },
    cash: () => client.getSnapshot('SPRK').account.cash,
    posts: () => posts,
    lastQty: () => lastQty,
    accept: () => { fail = false; receipt?.() },
    strategyWrites: () => strategyWrites,
  } })
  const props = { client, snap: client.getSnapshot('SPRK'), code: 'SPRK', onToast: () => {} }
  return <div className="ex-page">
    {mode === 'simple' ? <SimpleTrade {...props} /> : mode === 'bot' ? <BotPanel {...props} alwaysOpen /> : <TradePanel {...props} pickedPrice={null} />}
  </div>
}

void (async () => {
  await client.getAccount()
  await client.getStocks()
  createRoot(document.getElementById('root')!).render(<Fixture />)
})()
