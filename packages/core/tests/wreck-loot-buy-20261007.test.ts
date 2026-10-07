import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import staticMarket from '../../data/src/static/market.json'
import { createInitialState } from '../src/state'
import { addModule } from '../src/equipment'
import { addWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ensureMarket, buyLineOf, askLineOf, listSellHolding, cancelOrder, marketSellHolding, advanceMarket } from '../src/market'
import { startRecycleRun, advanceRefining } from '../src/industry'
import { ensureBlackMarket } from '../src/blackMarket'
import { RECYCLE_BASE_MODULES, RECYCLE_CYCLE_MS, rareBoxThemePoolOf, recycleProfileOf, rollRareBoxExtra, rollIntactHullLoot } from '../src/salvage'
import { WRECK_GROUPS } from '../src/wreckGroups'

const ctx = buildSimContext()
const caps = ['mod-shieldfield-2', 'mod-shieldfield-3', 'mod-stealth-3', 'mod-dc-3', 'mod-warpcomp-3']
const keys = ['r-inv', 'h-hi', 'c-inv', 'd-hi']
const root = fileURLToPath(new URL('../../../', import.meta.url))
const beforeMarket = JSON.parse(execFileSync('git', ['show', '31c6cf55:packages/data/src/static/market.json'], { cwd: root, encoding: 'utf8' })) as typeof staticMarket

describe('残骸主题出货', () => {
  it.each(WRECK_GROUPS)('$key完好基础出货有默认池，主题不再独占；低安层保留', group => {
    const state = createInitialState({ nowWallMs: 0, seed: 700 })
    state.moduleBay = {}
    for (let i = 0; i < 500; i++) rollIntactHullLoot(state, ctx, group.members[0]!)
    const got = Object.keys(state.moduleBay)
    for (const id of RECYCLE_BASE_MODULES) expect(got, group.key).toContain(id)
    for (const id of group.theme.modules ?? []) expect(got).toContain(id)
    expect(got.some(id => id.startsWith('mod-lair-'))).toBe(false)
    expect(Object.values(state.moduleBay).reduce((n, value) => n + value, 0)).toBeGreaterThanOrEqual(500)
    if (!recycleProfileOf(ctx, `wreck-${group.key}`)!.lowSec) {
      expect(Object.values(state.moduleBay).reduce((n, value) => n + value, 0)).toBe(500)
    }
  })

  it.each(keys)('%s稀有独立四件池完整，普通主题仍只有原件', key => {
    const plain = recycleProfileOf(ctx, `wreck-${key}`)!
    const rare = recycleProfileOf(ctx, `wreck-rare-${key}`)!
    expect(plain.rareTheme).toBeUndefined()
    expect(plain.theme.modules).toHaveLength(1)
    expect(rare.rareTheme).toHaveLength(4)
    expect(new Set(rare.rareTheme).size).toBe(4)
    expect(rareBoxThemePoolOf(rare)).toEqual(rare.rareTheme)
    for (const id of rare.rareTheme!) {
      expect(ctx.modules.has(id), id).toBe(true)
      expect(id.endsWith('-2'), id).toBe(true)
      expect(rare.lairGear).not.toContain(id)
    }
    const state = createInitialState({ nowWallMs: 0, seed: 711 })
    const withoutGear = { ...rare, lairGear: [] }
    const counts = new Map<string, number>()
    for (let i = 0; i < 1000; i++) {
      const extra = rollRareBoxExtra(state, ctx, withoutGear)!
      expect(extra.modules).toHaveLength(1)
      const id = extra.modules[0]!
      expect(rare.rareTheme).toContain(id)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect(counts.size).toBe(4)
    for (const count of counts.values()) expect(count).toBeGreaterThan(150)
  })

  it('真实炉每30m3一箱，原专属及普通掉落限制和钱包不变', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 720 })
    state.moduleBay = {}
    const before = state.wallet.isk
    const id = 'wreck-rare-r-inv'
    addWare(state, id, 30 * 200)
    expect(startRecycleRun(state, id, 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 204 && state.refineRuns.length; i++) {
      state.gameMs += RECYCLE_CYCLE_MS
      advanceRefining(state, ctx)
    }
    expect(state.refineRuns).toHaveLength(0)
    expect(state.rareBoxesOpened[id]).toBe(200)
    expect(state.wallet.isk).toBe(before)
    for (const member of recycleProfileOf(ctx, id)!.rareTheme!) expect(state.moduleBay[member]).toBeGreaterThan(0)
  })

  it('独立稀有主题优先，空专用池让位地区回落，未登记组不改变顺序', () => {
    const profile = recycleProfileOf(ctx, 'wreck-rare-r-inv')!
    expect(rareBoxThemePoolOf(profile, ['fallback'])).toEqual(profile.rareTheme)
    expect(rareBoxThemePoolOf({ ...profile, rareTheme: [] }, ['fallback'])).toEqual(['fallback'])
    const original = recycleProfileOf(ctx, 'wreck-rare-a-lo')!
    expect(rareBoxThemePoolOf(original)).toEqual([...original.theme.mk2 ?? [], ...original.theme.modules ?? []])
  })
})

describe('专属补缺计入待售托管', () => {
  const pool = ['mod-lair-laser-r', 'mod-lair-blink-r', 'mod-lair-beam-r', 'mod-lair-pd-r']
  const target = pool[1]!
  function pending(alias = false) {
    const state = createInitialState({ nowWallMs: 0, seed: 730 })
    const marketGoods = new Map(ctx.marketGoods)
    const key = alias ? 'alias-blink' : target
    if (alias) {
      const def = marketGoods.get(target)!
      marketGoods.delete(target)
      marketGoods.set(key, { ...def, key })
    }
    const local = { ...ctx, marketGoods }
    ensureMarket(state, local)
    for (const id of pool) addModule(state, id)
    const result = listSellHolding(state, local, key, 10400000, 1)
    expect(result.ok).toBe(true)
    expect(result.resting).toBe(1)
    return { state, local, key, orderId: result.orderId! }
  }
  it.each([false, true])('托管%s目录别名不影响，已集齐不能仅因挂单锁定一件', alias => {
    const { state, local, key } = pending(alias)
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.escrowItems[key]).toBe(1)
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const extra = rollRareBoxExtra(back, local, recycleProfileOf(local, 'wreck-rare-r-inv')!)!
      for (const id of extra.modules) if (pool.includes(id)) seen.add(id)
    }
    expect([...seen].sort()).toEqual([...pool].sort())
    expect(back.escrowItems[key]).toBe(1)
  })
  it('撤单返库仍持有，真正售完后按原当前持有规则补缺', () => {
    const { state, local, orderId } = pending()
    expect(cancelOrder(state, local, orderId)).toBe(true)
    expect(state.moduleBay[target]).toBe(1)
    delete state.moduleBay[target]
    state.escrowItems[target] = 0
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      for (const id of rollRareBoxExtra(state, local, recycleProfileOf(local, 'wreck-rare-r-inv')!)!.modules) {
        if (pool.includes(id)) seen.add(id)
      }
    }
    expect([...seen]).toEqual([target])
  })
  it('未持有另一件时，已挂待售件不挤占真正缺件', () => {
    const { state, local } = pending()
    delete state.moduleBay[pool[0]!]
    for (let i = 0; i < 300; i++) {
      const gear = rollRareBoxExtra(state, local, recycleProfileOf(local, 'wreck-rare-r-inv')!)!.modules.filter(id => pool.includes(id))
      for (const id of gear) expect(id).toBe(pool[0])
    }
  })
  it.each(['item', 'blueprint'] as const)('%s托管同样参与集齐判定，不改装配数量', kind => {
    const id = kind === 'item' ? 'drone-exile-bee' : 'bp-lair-g-drone'
    const state = createInitialState({ nowWallMs: 0, seed: 740 })
    ensureMarket(state, ctx)
    if (kind === 'item') addWare(state, id, 10)
    else state.blueprintStock[id] = 1
    expect(listSellHolding(state, ctx, id, ctx.marketGoods.get(id)!.basePrice).ok).toBe(true)
    const profile = { ...recycleProfileOf(ctx, 'wreck-rare-g-lo')!, lairGear: [id, target], theme: {} }
    let hits = 0
    for (let i = 0; i < 500; i++) {
      const extra = rollRareBoxExtra(state, ctx, profile)!
      expect(extra.drones).toHaveLength(0)
      expect(extra.blueprints).toHaveLength(0)
      if (extra.modules.includes(target)) hits++
    }
    expect(hits).toBeGreaterThan(0)
  })
})

describe('收购价格精确配置', () => {
  it('相对主树只修改53行的demandMultiplier，全部基价和其他参数不变', () => {
    let special = 0, capped = 0
    for (const [group, rows] of Object.entries(staticMarket.groups)) {
      const before = beforeMarket.groups[group as keyof typeof beforeMarket.groups]!
      expect(rows).toHaveLength(before.length)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]! as Record<string, unknown>
        const old = before[i]! as Record<string, unknown>
        let multiplier = old.demandMultiplier
        const id = String(row.refId)
        if (row.kind === 'module' && (id.startsWith('mod-lair-') || id.startsWith('mod-wh-'))) { multiplier = .25; special++ }
        if (caps.includes(String(row.key))) { multiplier = 2000000 / Number(row.basePrice); capped++ }
        expect(row, String(row.key)).toEqual({ ...old, demandMultiplier: multiplier })
      }
    }
    expect(special).toBe(48)
    expect(capped).toBe(5)
  })
  it.each(caps)('%s基准买价200万，供应基准与原值相同，行情仍正常浮动', key => {
    const state = createInitialState({ nowWallMs: 0, seed: 750 })
    ensureMarket(state, ctx)
    expect(buyLineOf(state, ctx, key)).toBe(2000000)
    expect(askLineOf(state, ctx, key)).toBe(ctx.marketGoods.get(key)!.basePrice)
    state.market.pools[key]!.noise = .1
    expect(buyLineOf(state, ctx, key)).toBe(2200000)
  })
  it('黑市候选、倍率、购买总价不因NPC收购折扣变化', () => {
    const marketGoods = new Map(ctx.marketGoods)
    for (const old of Object.values(beforeMarket.groups).flat()) {
      const current = marketGoods.get(old.key)
      if (current) marketGoods.set(old.key, { ...current, demandMultiplier: old.demandMultiplier })
    }
    const a = createInitialState({ nowWallMs: 0, seed: 760 }), b = structuredClone(a)
    a.standingsEarned = { ...(a.standingsEarned ?? {}), dsi: 100 }
    b.standingsEarned = { ...(b.standingsEarned ?? {}), dsi: 100 }
    const now = new Date(2026, 9, 7, 12).getTime()
    ensureBlackMarket(a, ctx, now)
    ensureBlackMarket(b, { ...ctx, marketGoods }, now)
    expect(a.blackMarket).toEqual(b.blackMarket)
  })
  it('原NPC买单和玩家锁价不追改，部分成交只核销实售托管', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 770 })
    ensureMarket(state, ctx)
    const key = 'mod-lair-blink-r'
    state.market.npcBuy[key] = [{ price: 10400000, qty: 1, expiresAtGameMs: 360000 }]
    addModule(state, key, 2)
    const result = marketSellHolding(state, ctx, key, 2)
    expect(result.ok).toBe(true)
    expect(state.wallet.isk).toBeGreaterThan(9000000)
    expect(state.escrowItems[key]).toBe(1)
    expect(state.orders.find(order => order.good === key)?.price).toBe(10400000)
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.escrowItems[key]).toBe(1)
    expect(back.orders.find(order => order.good === key)?.price).toBe(10400000)
  })
  it('旧NPC报价自然到期后新买单读新倍率，不重置玩家订单', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 780 })
    ensureMarket(state, ctx)
    const key = 'mod-lair-blink-r'
    state.market.npcBuy[key] = [{ price: 10400000, qty: 1, expiresAtGameMs: 60000 }]
    const prices: number[] = []
    for (let i = 0; i < 1440; i++) {
      state.gameMs += 60000
      advanceMarket(state, 60000, ctx)
      for (const quote of state.market.npcBuy[key]!) prices.push(quote.price)
    }
    expect(prices.length).toBeGreaterThan(0)
    for (const price of prices) expect(price).toBeLessThan(4000000)
    expect(state.market.npcSell[key]).toEqual([])
  })
})
