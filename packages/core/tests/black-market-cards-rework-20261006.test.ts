import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

type Row = { k: string; v: unknown }
type Info = { title: string; lines: Row[]; note: string; glyph: string; category: string }
const ui = 'apps/desktop/src/renderer/src/'

function moduleExports(file: string, scope: Record<string, unknown>) {
  const ast = ts.createSourceFile(file, readFileSync(resolve(ROOT, ui + file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const text = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast)).join('\n')
  const context = { ...scope, exports: {} }
  runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context)
  return context.exports as Record<string, (...args: any[]) => any>
}

describe('旗舰黑匣价值与旧报价边界', () => {
  it.each(['blackbox-h', 'blackbox-r', 'blackbox-universal'])('%s基础收价与市场目录同值、采购资格不变', id => {
    const ctx = buildSimContext(), price = id === 'blackbox-universal' ? 5_000_000 : 10_000_000
    expect(ctx.items.get(id)!.baseSellPriceIsk).toBe(price)
    expect(ctx.marketGoods.get(id)!.basePrice).toBe(price)
    expect(ctx.marketGoods.get(id)!.playerBuyable).toBe(false)
    expect(core.blackMarketCandidateGoods(ctx).some(g => g.key === id)).toBe(true)
    expect(core.UNIVERSAL_BLACKBOX_COST).toBe(30)
  })

  it('普通市场无压力/冲击/噪声时，两种旗舰匣的当前收购线同步为1000万', () => {
    const ctx = buildSimContext(), state = core.createInitialState({ nowWallMs: 0, seed: 3 })
    core.ensureMarket(state, ctx)
    for (const id of ['blackbox-h', 'blackbox-r']) {
      state.market.pools[id]!.noise = 0
      state.market.pools[id]!.shock = 0
      expect(core.buyLineOf(state, ctx, id)).toBe(10_000_000)
    }
  })

  it.each(['blackbox-h', 'blackbox-r'])('%s旧日板锁价与售罄随档保留，新日板采用新基价', id => {
    const ctx = buildSimContext(), now = new Date(2026, 9, 6, 12).getTime()
    const state = core.createInitialState({ nowWallMs: now, seed: 17 })
    state.standingsEarned = { dsi: 100 }; state.wallet.isk = 1e12
    state.blackMarket = { dayWallMs: core.blackMarketDayStart(now), offers: [{ goodKey: id, basePrice: 80_000_000,
      multiplier: 30, price: 2_400_000_000, sold: false }] }
    expect(core.ensureBlackMarket(state, ctx, now)).toBe(false)
    const money = state.wallet.isk
    expect(core.blackMarketBuy(state, ctx, id, state.blackMarket.dayWallMs, 2_400_000_000, now).ok).toBe(true)
    expect(state.wallet.isk).toBe(money - 2_400_000_000)
    expect(state.warehouse.items[id]).toBe(1)
    const loaded = core.loadSaveFile(core.serializeSaveFile(state, now)).state
    expect(loaded.blackMarket!.offers[0]).toEqual({ ...state.blackMarket.offers[0], sold: true })
    const narrow = { ...ctx, marketGoods: new Map([[id, ctx.marketGoods.get(id)!]]) }
    expect(core.ensureBlackMarket(loaded, narrow, core.blackMarketNextRefresh(loaded))).toBe(true)
    expect(loaded.blackMarket!.offers[0]!.basePrice).toBe(10_000_000)
    expect(loaded.blackMarket!.offers[0]!.price).toBe(10_000_000 * loaded.blackMarket!.offers[0]!.multiplier)
    expect(loaded.blackMarket!.offers[0]!.sold).toBe(false)
  })
})

describe('黑市详情复用仓库真实参数', () => {
  it.each(['zh', 'en'] as const)('%s全部候选保留详情，仅物品收价行在黑市场景关闭', locale => {
    const ctx = buildSimContext(locale)
    const tr = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id)
      .replace(/\{(\w+)\}/g, (m, key: string) => String(params?.[key] ?? m))
    const scope = { ...core, React: { createElement: (type: string, props: unknown, ...children: unknown[]) => ({ type, props, children }) }, tr,
      kindTextOfItem: (item: { kind: string }) => item.kind, slotText: String, rackText: String, shipRoleText: String, shipTierText: String,
      MODULE_SUBS: [], moduleSubKeyOf: () => '', subText: String, fmtDuration: String,
      itemGlyphName: (_id: string, kind: string) => kind, inventoryItemTone: () => 'currentColor', toneOf: () => 'currentColor',
      crestFamOf: () => undefined, rackDimKeyOf: () => 'high' }
    const display = moduleExports('ui/shipInfo.tsx', scope)
    const market = moduleExports('ui/marketGoodHover.tsx', { ...scope, ...display })
    for (const good of core.blackMarketCandidateGoods(ctx)) {
      const visible = market.marketGoodInfo!(ctx, good) as Info
      const hidden = market.marketGoodInfo!(ctx, good, true) as Info
      expect(hidden.title, good.key).toBe(visible.title)
      expect(hidden.note, good.key).toBe(visible.note)
      expect(hidden.glyph, good.key).toBeTruthy()
      expect(hidden.category, good.key).toBeTruthy()
      expect(hidden.lines, good.key).toEqual(visible.lines.filter(row => row.k !== tr('ui.shipInfo.086')))
      expect(hidden.lines.some(row => row.k === tr('ui.shipInfo.086')), good.key).toBe(false)
      if (good.kind === 'item') expect(hidden.lines).toEqual(display.itemInfoLines!(ctx.items.get(good.refId)!, (id: string) => ctx.items.get(id)?.name, false))
      if (good.kind === 'module') expect(hidden.lines).toEqual(display.moduleInfoLines!(ctx.modules.get(good.refId)!))
    }
  })

  it('商品卡无局部title，统一富详情且不渲染倍率、基准价', () => {
    const text = readFileSync(resolve(ROOT, ui + 'pages/BlackMarketPage.tsx'), 'utf8')
    const ast = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let card: ts.JsxElement | undefined
    const visit = (n: ts.Node) => {
      if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'article') card = n
      ts.forEachChild(n, visit)
    }
    visit(ast)
    expect(card).toBeDefined()
    expect(card!.getText(ast)).not.toMatch(/title=|data-tip=|\.basePrice|\.multiplier/)
    expect(text).toContain('good={g} hidePrices')
    expect(text).toContain('infoCardContent(detail.title, detail.lines, detail.note)')
    expect(text).toContain("aria-label={tr('ui.blackMarket.024')}")
  })
})
