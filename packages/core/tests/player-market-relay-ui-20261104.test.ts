import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const root = resolve(__dirname, '../../..')
type Node = { type: unknown; props: Record<string, any> }
type TestQuote = { buy?: number | undefined; sell?: number | undefined; buyDepth: number; sellDepth: number; buyQty: number; sellQty: number }
const good = { key: 'relic', kind: 'item', refId: 'relic', rarity: 'common', playerBuyable: false, playerSellable: false } as any

function renderDetail(g: any, quote: TestQuote = { buy: 90, sell: 500, buyDepth: 1, sellDepth: 1, buyQty: 2, sellQty: 3 }, standingReq?: number, bmStanding?: number, buyResult = { ok: true } as { ok: boolean; error?: string }) {
  const effects: Array<() => void> = []
  const toast = vi.fn()
  const buyGoodAt = vi.fn(() => buyResult)
  const state = {
    wallet: { isk: 20_000 }, skills: { trained: {} },
    market: {
      npcBuy: { [g.key]: [{ price: 90, qty: 2, expiresAtGameMs: 10_000 }] },
      npcSell: { [g.key]: [{ price: 500, qty: 3, expiresAtGameMs: 10_000, relay: { quoteId: 'q1' } }] },
      pools: {}, priceHistory: {},
    },
  }
  const engine = {
    state, ctx: { balance: { market: { taxSkillAId: 'a', taxSkillBId: 'b' } } },
    buyGoodAt, buyOrderBlocked: vi.fn(() => null), placeBuyOrderAt: vi.fn(),
    placeSellOrderAt: vi.fn(() => ({ ok: true })), sellHoldingAt: vi.fn(() => ({ ok: true })),
    sellPreviewAt: vi.fn(() => ({ ok: true, avail: 0, want: 0, fillable: 0, orders: 0, gross: 0, tax: 0, net: 0, leftover: 0 })),
  }
  const marketLockNote = vi.fn(() => standingReq ? { textId: 'standing.lock', params: { p1: standingReq } } : null)
  const bmGateNote = vi.fn(() => bmStanding ? { textId: 'standing.bm', params: { p1: bmStanding } } : null)
  const marketQuote = vi.fn(() => quote)
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const hooks = {
    useEffect: (callback: () => void) => { effects.push(callback) },
    useLayoutEffect: () => {},
    useState: (initial: unknown) => [initial, vi.fn()],
    useRef: () => ({ current: null }),
  }
  const module = { exports: {} as { MarketDetail: (props: unknown) => Node } }
  const source = readFileSync(resolve(root, 'apps/desktop/src/renderer/src/features/market/MarketDetail.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  runInNewContext(code, {
    exports: module.exports, module, window: {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    require: (id: string) => {
      if (id === 'react') return hooks
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@whale/core') return {
        askLineOf: () => 100, buyLineOf: () => 80, ceilFinalQuantity: Math.ceil,
        marketLockNote, bmGateNote, marketHistory: () => [], marketQuote,
        marketTrend: () => 0, naturalHoldings: () => 4, shipStoredCount: () => 0,
      }
      if (id === '@whale/ui') return { Panel: 'Panel' }
      if (id === '../../ui/marketGoodHover') return { marketGoodDisplayName: () => 'Relic' }
      if (id === '../../pages/common') return { isk: (n: number) => String(Math.ceil(n)) }
      if (id === '../../i18n/fmt') return { fmtInt: String }
      if (id === '../../ui/Hint') return { HintIcon: 'HintIcon' }
      if (id === '../../i18n/locale') return { tr: (key: string, params?: unknown) => params ? `${key}:${JSON.stringify(params)}` : key, cmdText: (result: { error?: string }) => result.error ?? '' }
      if (id === './readouts') return {
        fleetCountOf: () => 0, placeOrderToast: () => '', taxTipText: () => 'tax-scope',
      }
      if (id === './PriceChart') return { PriceChart: 'PriceChart' }
      throw new Error(`unexpected dependency: ${id}`)
    },
  })
  const tree = module.exports.MarketDetail({ engine, onToast: toast, good: g })
  const nodes: Node[] = []
  function visit(node: any): void {
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (!node || typeof node !== 'object' || !node.props) return
    nodes.push(node)
    visit(node.props.children)
    visit(node.props.right)
    visit(node.props.hint)
  }
  visit(tree)
  return { nodes, engine, toast, marketLockNote, bmGateNote, marketQuote, effects }
}

function renderGoodRow(g: any, quote: TestQuote) {
  const state = { market: {}, skills: { trained: {} }, standing: {} }
  const engine = { state, ctx: {} }
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const module = { exports: {} as { GoodRow: (props: unknown) => Node } }
  const source = readFileSync(resolve(root, 'apps/desktop/src/renderer/src/features/market/GoodRow.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  runInNewContext(code, {
    exports: module.exports, module,
    require: (id: string) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@whale/core') return {
        bmGateNote: () => null, marketLockNote: () => null, marketQuote: () => quote, marketTrend: () => 0,
      }
      if (id === '../../ui/marketGoodHover') return { MarketGoodHover: ({ children }: any) => children, marketGoodDisplayName: () => 'Relic' }
      if (id === '../../pages/common') return { isk: (n: number) => String(Math.ceil(n)) }
      if (id === '../../i18n/fmt') return { fmtInt: String }
      if (id === '../../ui/Glyphs') return { Glyph: 'Glyph', ICO_TONES: {} }
      if (id === '../../ui/marks') return { MarkStar: 'MarkStar' }
      if (id === '../../i18n/locale') return { tr: (key: string) => key }
      if (id === './readouts') return { myStockOf: () => 0, earliestSellRemaining: () => undefined, fmtClock: String }
      if (id === './filters') return { kindTextOf: () => 'item' }
      return {}
    },
  })
  const tree = module.exports.GoodRow({ engine, good: g })
  const nodes: Node[] = []
  function visit(node: any): void {
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (!node || typeof node !== 'object' || !node.props) return
    nodes.push(node)
    visit(node.props.children)
  }
  visit(tree)
  return nodes
}

function allText(nodes: Node[]): string {
  return nodes.map(node => `${node.props.title ?? ''} ${typeof node.props.children === 'string' ? node.props.children : ''}`).join(' ')
}

describe('player market local UI', () => {
  it('shows the final remote quote, quantity and total in the existing order book without source labels', () => {
    const p = renderDetail(good)
    const sellRow = p.nodes.find(node => node.props.className === 'app-mkt-depth is-click' && node.props.title?.startsWith('ui.MarketPage.048'))!
    expect(sellRow.props.title).toContain('500 × 3 = 1500')
    expect(p.nodes.some(node => node.props.className === 'app-mkt-depth-qty' && node.props.children === '3')).toBe(true)
    expect(allText(p.nodes)).not.toMatch(/NPC|玩家订单|外来订单|来源/)
    expect(allText(p.nodes)).not.toMatch(/relay|连接失败|同步失败/i)
    expect(p.nodes.some(node => node.props.className === 'app-mkt-confirm-mask')).toBe(false)
    expect(p.nodes.find(node => node.type === 'HintIcon')?.props.tip).toBe('tax-scope')
  })

  it('keeps the ordinary standingReq purchase gate active for market buys', () => {
    const p = renderDetail({ ...good, standingReq: 12 }, undefined, 12)
    const buy = p.nodes.find(node => node.type === 'button' && node.props.className === 'app-btn is-primary is-small')!
    buy.props.onClick()
    expect(p.engine.buyGoodAt).not.toHaveBeenCalled()
    expect(p.toast).toHaveBeenCalledWith(expect.stringContaining('standing.lock'), true)
  })

  it('leaves bmStanding enforcement to the current core purchase path', () => {
    const p = renderDetail({ ...good, bmStanding: 20 }, undefined, undefined, 20, { ok: false, error: 'standing gate' })
    const buy = p.nodes.find(node => node.type === 'button' && node.props.className === 'app-btn is-primary is-small')!
    buy.props.onClick()
    expect(p.engine.buyGoodAt).toHaveBeenCalledWith('relic', 1)
    expect(p.toast).toHaveBeenCalledWith('standing gate', true)
  })

  it('allows buying an NPC-nonbuyable good when no standing gate applies', () => {
    const p = renderDetail(good)
    const buy = p.nodes.find(node => node.type === 'button' && node.props.className === 'app-btn is-primary is-small')!
    expect(buy.props.disabled).toBe(false)
    buy.props.onClick()
    expect(p.engine.buyGoodAt).toHaveBeenCalledWith('relic', 1)
  })

  it('renders an ordinary empty-quote label instead of the NPC-only restriction', () => {
    const rerendered = renderDetail(good, { buy: 90, sell: undefined, buyDepth: 1, sellDepth: 0, buyQty: 2, sellQty: 0 })
    expect(allText(rerendered.nodes)).toContain('ui.MarketPage.032')
    expect(allText(rerendered.nodes)).not.toContain('ui.MarketPage.031')
  })

  it('shows an ordinary no-stock quote in the market list with no source distinction', () => {
    const nodes = renderGoodRow(good, { buy: 90, sell: undefined, buyDepth: 1, sellDepth: 0, buyQty: 2, sellQty: 0 })
    expect(allText(nodes)).toContain('ui.MarketPage.032')
    expect(allText(nodes)).not.toContain('ui.MarketPage.031')
    expect(allText(nodes)).not.toMatch(/NPC|玩家订单|外来订单|来源/)
  })
})
