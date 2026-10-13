import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { blackMarketCandidateGoods, ensureBlackMarket, blackMarketBuy, blackMarketDayStart, blackMarketOfferQuantity, blackMarketNextRefresh, blackMarketUnlocked, isBlackMarketBulkResource } from '../src/blackMarket'
import { countWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { buyAtMarket, naturalHoldings } from '../src/market'

const ctx = buildSimContext()
const now = new Date(2026, 9, 13, 12).getTime()

function world() {
  const state = createInitialState({ nowWallMs: now, seed: 3 })
  state.standingsEarned = { dsi: 100 }
  state.wallet.isk = 1e14
  return state
}

describe('黑市大宗原料不作为单件商品出售', () => {
  it.each(['ore-nebulite', 'ore-voidshard'])('%s真实目录不再混入黑市候选', id => {
    expect(ctx.marketGoods.get(id)!.rarityTier).toBeGreaterThanOrEqual(4)
    expect(blackMarketCandidateGoods(ctx).some(g => g.refId === id)).toBe(false)
  })

  it('玩家报障种子3的新货架没有星幽矿，仍有9个去重商品', () => {
    const state = createInitialState({ nowWallMs: now, seed: 3 })
    state.standingsEarned = { dsi: 100 }
    ensureBlackMarket(state, ctx, now)
    expect(state.blackMarket!.offers.some(row => row.goodKey === 'ore-nebulite')).toBe(false)
    expect(state.blackMarket!.offers).toHaveLength(9)
    expect(new Set(state.blackMarket!.offers.map(row => row.goodKey)).size).toBe(9)
  })

  it('旧报价4495的星幽矿不能购买，不扣款、不入库、不删货架或同日补抽', () => {
    const state = createInitialState({ nowWallMs: now, seed: 3 })
    state.standingsEarned = { dsi: 100 }
    state.wallet.isk = 1e6
    state.blackMarket = { dayWallMs: blackMarketDayStart(now), offers: [
      { goodKey: 'ore-nebulite', basePrice: 145, multiplier: 31, price: 4495, sold: false },
    ] }
    const before = structuredClone(state)
    const offer = state.blackMarket.offers[0]!
    const result = blackMarketBuy(state, ctx, offer.goodKey, state.blackMarket.dayWallMs, offer.price, now, blackMarketOfferQuantity(offer))
    expect(result.errorId).toBe('core.blackMarket.004')
    expect(state).toEqual(before)
    expect(countWare(state, 'ore-nebulite')).toBe(0)
    expect(ensureBlackMarket(state, ctx, now)).toBe(false)
    expect(state).toEqual(before)
  })

  it.each(['ore', 'mineral', 'gas', 'ice'] as const)('%s提升到R5及黑市白名单也不得成为候选或成交，按refId而非货号判断', kind => {
    const item = [...ctx.items.values()].find(row => row.kind === kind && row.id !== 'ore-voidmother')!
    const original = [...ctx.marketGoods.values()].find(row => row.kind === 'item' && row.refId === item.id)!
    const good = { ...original, key: `bulk-${kind}`, rarityTier: 5 as const, playerBuyable: true, blackMarketBuyable: true }
    const custom = { ...ctx, marketGoods: new Map([[good.key, good]]) }
    expect(isBlackMarketBulkResource(custom, good)).toBe(true)
    expect(blackMarketCandidateGoods(custom)).toEqual([])
    const state = world()
    state.blackMarket = { dayWallMs: blackMarketDayStart(now), offers: [
      { goodKey: good.key, basePrice: good.basePrice, multiplier: 30, price: good.basePrice * 30, sold: false },
    ] }
    const before = structuredClone(state)
    expect(blackMarketBuy(state, custom, good.key, state.blackMarket.dayWallMs, good.basePrice * 30, now).errorId).toBe('core.blackMarket.004')
    expect(state).toEqual(before)
  })

  it('600个种子/日期组合没有四类原料，保持去重/九货/专属数量及独立随机源', () => {
    const exclusive = new Set(blackMarketCandidateGoods(ctx).filter(g => g.playerBuyable === false).map(g => g.key))
    for (const offset of [0, 1, 2]) for (let seed = 1; seed <= 200; seed++) {
      const wall = now + offset * 86400000
      const state = createInitialState({ nowWallMs: now, seed })
      state.standingsEarned = { dsi: 100 }
      const rng = structuredClone(state.rng)
      expect(ensureBlackMarket(state, ctx, wall)).toBe(true)
      const offers = state.blackMarket!.offers
      expect(offers).toHaveLength(9)
      expect(new Set(offers.map(o => o.goodKey)).size).toBe(9)
      expect(offers.filter(o => exclusive.has(o.goodKey)).length).toBeGreaterThanOrEqual(3)
      for (const offer of offers) expect(isBlackMarketBulkResource(ctx, ctx.marketGoods.get(offer.goodKey)!)).toBe(false)
      expect(state.rng).toEqual(rng)
    }
  })

  it('旧混合货架两次存档往返不删除条目/改价/恢复售罄，次日才自然换架', () => {
    const state = world(), good = ctx.marketGoods.get('mod-shieldfield-3')!
    state.blackMarket = { dayWallMs: blackMarketDayStart(now), offers: [
      { goodKey: 'ore-nebulite', basePrice: 145, multiplier: 31, price: 4495, sold: false },
      { goodKey: 'ore-voidshard', basePrice: 68, multiplier: 30, price: 2040, sold: true },
      { goodKey: good.key, basePrice: good.basePrice, multiplier: 60, price: good.basePrice * 60, sold: true },
    ] }
    const original = structuredClone(state.blackMarket)
    let loaded = loadSaveFile(serializeSaveFile(state, now)).state
    loaded = loadSaveFile(serializeSaveFile(loaded, now)).state
    expect(loaded.blackMarket).toEqual(original)
    expect(ensureBlackMarket(loaded, ctx, now + 1000)).toBe(false)
    expect(ensureBlackMarket(loaded, ctx, now - 86400000)).toBe(false)
    expect(loaded.blackMarket).toEqual(original)
    const money = loaded.wallet.isk, ware = structuredClone(loaded.warehouse), rng = structuredClone(loaded.rng)
    const next = blackMarketNextRefresh(loaded)
    expect(ensureBlackMarket(loaded, ctx, next)).toBe(true)
    expect(loaded.blackMarket!.dayWallMs).toBe(blackMarketDayStart(next))
    expect(loaded.blackMarket!.offers).toHaveLength(9)
    expect(loaded.blackMarket!.offers.every(o => !isBlackMarketBulkResource(ctx, ctx.marketGoods.get(o.goodKey)!))).toBe(true)
    expect(loaded.wallet.isk).toBe(money)
    expect(loaded.warehouse).toEqual(ware)
    expect(loaded.rng).toEqual(rng)
  })

  it('同日合法无人机原数量/锁价继续交付50架，其他报价与原料条目保持', () => {
    const state = world(), good = ctx.marketGoods.get('drone-exile-bee')!
    state.blackMarket = { dayWallMs: blackMarketDayStart(now), offers: [
      { goodKey: 'ore-nebulite', basePrice: 145, multiplier: 31, price: 4495, sold: false },
      { goodKey: good.key, quantity: 50, basePrice: good.basePrice, multiplier: 30, price: good.basePrice * 1500, sold: false },
    ] }
    const board = structuredClone(state.blackMarket)
    const offer = state.blackMarket.offers[1]!, stock = naturalHoldings(state, good), money = state.wallet.isk
    expect(blackMarketBuy(state, ctx, good.key, state.blackMarket.dayWallMs, offer.price, now, 50).ok).toBe(true)
    expect(naturalHoldings(state, good)).toBe(stock + 50)
    expect(state.wallet.isk).toBe(money - offer.price)
    expect(state.blackMarket.offers[0]).toEqual(board.offers[0])
    expect(state.blackMarket.offers[1]).toEqual({ ...board.offers[1], sold: true })
    expect(state.blackMarket.dayWallMs).toBe(board.dayWallMs)
  })

  it.each(['ore-nebulite', 'ore-voidshard'])('%s普通市场仍可买原料，不追改已成交数量', id => {
    const state = world()
    const result = buyAtMarket(state, ctx, id, 1)
    expect(result.bought).toBe(1)
    expect(countWare(state, id)).toBe(1)
    const loaded = loadSaveFile(serializeSaveFile(state, now)).state
    ensureBlackMarket(loaded, ctx, now)
    expect(countWare(loaded, id)).toBe(1)
  })
})

type UiNode = { type: string; props: Record<string, any>; children: unknown[] }
const nodes = (value: unknown): UiNode[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'children' in value
  ? [value as UiNode, ...(value as UiNode).children.flatMap(nodes)] : []

function pageFor(state: ReturnType<typeof world>) {
  const path = new URL('../../../apps/desktop/src/renderer/src/pages/BlackMarketPage.tsx', import.meta.url)
  const ast = ts.createSourceFile('page.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'BlackMarketPage')!
  const values: any[] = []
  let cursor = 0
  const tr = (id: string, p?: Record<string, unknown>) => (L10N[id]!.zh).replace(/\{(\w+)\}/g, (m, key: string) => String(p?.[key] ?? m))
  const scope = { React: { createElement: (type: string, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    tr, useL10n: () => {}, useEffect: () => {}, useRef: () => ({ current: null }),
    useState: (initial: any) => { const at = cursor++; if (!(at in values)) values[at] = initial; return [values[at], (next: any) => values[at] = next] },
    blackMarketNextRefresh, blackMarketUnlocked, blackMarketOfferQuantity, isBlackMarketBulkResource,
    fmtDuration: String, isk: String, cmdText: () => '', marketGoodDisplayName: (_ctx: unknown, key: string) => key,
    marketGoodInfo: (_ctx: unknown, good: any) => ({ title: good.key, lines: [], note: '', glyph: 'ore', category: '', tone: 'currentColor' }),
    Glyph: 'Glyph', MarketGoodHover: 'MarketGoodHover', MerchantMonitor: 'MerchantMonitor',
    infoCardContent: () => null, crestLabelOf: String, FOE_ACCENT: {}, exports: {}, result: undefined as any }
  runInNewContext(ts.transpileModule(fn.getText(ast) + '\nglobalThis.result = BlackMarketPage', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope)
  return () => { cursor = 0; return nodes(scope.result({ engine: { state, ctx }, onToast: () => {}, onBack: () => {} })) }
}

describe('旧黑市货架真实组件过滤', () => {
  it('只隐藏两种原料，其他商品锁价/顺序/售罄状态和全部存档字段不变', () => {
    const state = world(), good = ctx.marketGoods.get('mod-shieldfield-3')!
    const legal = { goodKey: good.key, basePrice: good.basePrice, multiplier: 42, price: good.basePrice * 42, sold: true }
    state.blackMarket = { dayWallMs: blackMarketDayStart(now), offers: [
      { goodKey: 'ore-nebulite', basePrice: 145, multiplier: 31, price: 4495, sold: false }, legal,
      { goodKey: 'ore-voidshard', basePrice: 68, multiplier: 30, price: 2040, sold: true },
    ] }
    const before = structuredClone(state), render = pageFor(state)
    const result = render()
    expect(result.filter(n => n.type === 'article')).toHaveLength(1)
    expect(result.filter(n => n.type === 'MarketGoodHover').map(n => n.props.good.key)).toEqual([good.key])
    expect(result.find(n => n.props.className === 'app-btn app-bm-buy')!.props.disabled).toBe(true)
    expect(result.some(n => n.children.includes(String(legal.price)))).toBe(true)
    expect(render().filter(n => n.type === 'article')).toHaveLength(1)
    expect(state).toEqual(before)
  })

  it('旧货架全部为原料时显示既有暂无商品提示，不空白也不补抽', () => {
    const state = world()
    state.blackMarket = { dayWallMs: blackMarketDayStart(now), offers: [
      { goodKey: 'ore-nebulite', basePrice: 145, multiplier: 31, price: 4495, sold: false },
    ] }
    const before = structuredClone(state), result = pageFor(state)()
    expect(result.filter(n => n.type === 'article')).toEqual([])
    expect(result.some(n => n.children.includes(L10N['ui.blackMarket.020']!.zh))).toBe(true)
    expect(state).toEqual(before)
    expect(ensureBlackMarket(state, ctx, now)).toBe(false)
    expect(state).toEqual(before)
  })
})
