import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceMarket, ensureMarket, marketQuote } from '../src/market'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const rows = [
  { key: 'min-darkiron', old: 3120, target: 16000, flow: 26, price: 780 },
  { key: 'min-starcore', old: 15960, target: 48000, flow: 133, price: 245 },
  { key: 'min-voidcrystal', old: 1560, target: 48000, flow: 13, price: 5400 },
  { key: 'drone-scout', old: 480, target: 18000, flow: 4, price: 900 },
  { key: 'drone-assault', old: 240, target: 18000, flow: 2, price: 2200 },
  { key: 'drone-heavy', old: 120, target: 12000, flow: 1, price: 5000 },
  { key: 'drone-sentry', old: 120, target: 9000, flow: 1, price: 9500 },
] as const

describe('七池目标容量与旧档自然回归', () => {
  it.each(rows)('$key仅扩容量，价格、流量、常驻渠道与开盘供货量不变', ({ key, target, flow, price }) => {
    const good = ctx.marketGoods.get(key)!
    expect(good.poolTarget).toBe(target)
    expect(good.supplyFlow).toBe(flow)
    expect(good.basePrice).toBe(price)
    expect(good.kind).toBe('item')
    expect(good.rarity).toBe('common')
    expect(good.demandMultiplier).toBe(key.startsWith('drone-') ? 0.6 : undefined)
    // 2026-10-06虚空晶出售改走独立限额；七池的经济容量/价格/收购流量保持。
    expect(good.playerBuyable).toBeUndefined()
    const state = createInitialState({ nowWallMs: 1791100000000, seed: 10403 })
    ensureMarket(state, ctx)
    expect(state.market.pools[key]!.q).toBe(target)
    expect(marketQuote(state, ctx, key).sellQty).toBe(key === 'min-voidcrystal' ? 3000 : Math.max(1, Math.round(flow * 0.8)))
  })

  it.each(rows)('$key旧库存读档/开盘不补满，30分钟偏离新目标减半且钱包仓库不变', ({ key, old, target }) => {
    const good = ctx.marketGoods.get(key)!
    const legacyCtx = { ...ctx, marketGoods: new Map([[key, { ...good, poolTarget: old }]]) }
    const currentCtx = { ...ctx, marketGoods: new Map([[key, good]]) }
    const state = createInitialState({ nowWallMs: 1791100000000, seed: 10403 })
    ensureMarket(state, legacyCtx)
    const back = loadSaveFile(serializeSaveFile(state)).state
    const wallet = back.wallet.isk, warehouse = structuredClone(back.warehouse)
    ensureMarket(back, currentCtx)
    expect(back.market.pools[key]!.q).toBe(old)
    back.gameMs += 30 * 60000
    advanceMarket(back, 30 * 60000, currentCtx)
    expect(back.market.pools[key]!.q).toBeCloseTo((target + old) / 2, 6)
    expect(back.wallet.isk).toBe(wallet)
    expect(back.warehouse).toEqual(warehouse)
    expect(loadSaveFile(serializeSaveFile(back)).state.market.pools[key]!.q).toBeCloseTo(back.market.pools[key]!.q, 6)
  })

  it('已有空池与积压池不会因目录改动重新铺满', () => {
    for (const row of rows) for (const stock of [0, row.target * 3]) {
      const state = createInitialState({ nowWallMs: 1791100000000, seed: 10403 })
      ensureMarket(state, ctx)
      state.market.pools[row.key]!.q = stock
      const back = loadSaveFile(serializeSaveFile(state)).state
      ensureMarket(back, ctx)
      expect(back.market.pools[row.key]!.q).toBe(stock)
    }
  })
})
