import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as core from '../src/index'

type Element = { type: string; props: Record<string, any>; children: unknown[] }
type Locale = 'zh' | 'en'
function source(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function codeOf(path: string, names?: string[]): string {
  const ast = source(path)
  return ast.statements.filter(node => names ?
    ts.isFunctionDeclaration(node) ? names.includes(node.name?.text ?? '') :
      ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast))) :
    !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
}
function evaluate(code: string, bindings: Record<string, unknown>): void {
  runInNewContext(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, bindings)
}
function nodesOf(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodesOf)
  if (value && typeof value === 'object' && 'children' in value) {
    const node = value as Element
    return [node, ...node.children.flatMap(nodesOf)]
  }
  return []
}
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value && typeof value === 'object' && 'children' in value) return textOf((value as Element).children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
function renderer(locale: Locale) {
  const tr = (id: string, params?: Record<string, string | number>) => (L10N[id]?.[locale] ?? id)
    .replace(/\{(\w+)\}/g, (m, key: string) => String(params?.[key] ?? m))
  const scope = { ...core, exports: {}, tr }
  evaluate(codeOf('apps/desktop/src/renderer/src/ui/itemSubs.ts'), scope)
  const values: unknown[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  return {
    bindings: {
      ...core, ...scope.exports, tr, exports: {},
      React: { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }) },
      useState: (initial: unknown) => {
        const at = cursor++
        if (!(at in values)) values[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial
        return [values[at], (next: unknown) => { values[at] = typeof next === 'function' ? (next as (old: unknown) => unknown)(values[at]) : next }]
      },
      useRef: (initial: unknown) => {
        const at = cursor++
        if (!(at in values)) values[at] = { current: initial }
        return values[at]
      },
      useMemo: (fn: () => unknown) => fn(),
      useEffect: (fn: () => void) => { effects.push(fn) },
      useL10n: () => ({ locale }),
      Panel: 'Panel', HintIcon: 'HintIcon', RedeemFragmentButton: 'RedeemFragmentButton',
    },
    render: (component: (props: object) => unknown, props: object) => {
      cursor = 0
      effects = []
      const nodes = nodesOf(component(props))
      effects.forEach(effect => effect())
      return nodes
    },
  }
}
function shelf(locale: Locale, navigation = true) {
  const base = buildSimContext(locale)
  const ctx = { ...base, marketGoods: new Map(base.marketGoods) }
  const state = core.createInitialState({ seed: 7, nowWallMs: 0, prologue: true })
  const blueprints = [...ctx.blueprints.values(), ...ctx.shipBlueprints.values()]
  state.blueprintStock = Object.fromEntries(blueprints.map(bp => [bp.id, 3]))
  state.learnedRecipes = blueprints.filter((bp, i) => i % 2 === 0 && !bp.singleUse).map(bp => bp.id)
  const jumps: string[] = [], crafts: string[] = [], sales: string[] = []
  const ui = renderer(locale)
  evaluate(codeOf('apps/desktop/src/renderer/src/panels/Industry.tsx', ['bpGoodKey', 'BlueprintShelfPanel']), ui.bindings)
  const component = (ui.bindings.exports as { BlueprintShelfPanel: (props: object) => unknown }).BlueprintShelfPanel
  const engine = {
    ctx, state, allBlueprints: [...ctx.blueprints.values()], allShipBlueprints: [...ctx.shipBlueprints.values()],
    fragmentRedeemRows: () => core.fragmentRedeemRowsOf(state, ctx),
    sellHoldingAt: (key: string) => { sales.push(key); return { ok: true } },
    learnBlueprintAt: (id: string) => core.learnBlueprint(state, ctx, id),
  }
  const props = { engine, onToast: () => {}, onGotoCraft: (id: string) => crafts.push(id),
    ...(navigation ? { onGotoMarket: (key: string) => jumps.push(key) } : {}) }
  return { ctx, state, blueprints, jumps, crafts, sales, ui, engine,
    render: () => ui.render(component, props),
  }
}

describe('蓝图书架市场入口', () => {
  it.each(['zh', 'en'] as const)('%s 全目录书卡按市场资格导航，普通/一次性/已学重复书均可达且不改资产', locale => {
    const view = shelf(locale)
    const before = JSON.stringify(view.state)
    const cards = view.render().filter(node => node.props.className?.split(' ').includes('app-shelf-card'))
    expect(cards).toHaveLength(view.blueprints.length)
    let expected = 0
    for (const bp of view.blueprints) {
      const card = cards.find(node => node.props.key === bp.id)!
      const buttons = nodesOf(card).filter(node => node.type === 'button')
      const jump = buttons.find(node => textOf(node) === L10N['ui.CargoPage.001']![locale])
      const good = core.marketGoodOf(view.ctx, 'blueprint', bp.id)
      const canJump = !!good && good.unreleased !== true && good.playerSellable !== false
      expect(!!jump, bp.id).toBe(canJump)
      if (jump) {
        expect(jump.props.title).toBe(L10N['ui.CargoPage.002']![locale])
        jump.props.onClick()
        expect(view.jumps.at(-1)).toBe(good!.key)
        expected++
      }
      expect(buttons.some(node => textOf(node) === L10N['ui.Industry.018']![locale]), bp.id).toBe(!bp.singleUse && good?.playerSellable !== false)
      expect(buttons.some(node => textOf(node) === L10N['ui.Industry.016']![locale]), bp.id).toBe(!bp.singleUse && !core.ownsBlueprint(view.state, bp.id))
    }
    expect(expected).toBeGreaterThan(100)
    expect(view.sales).toEqual([])
    expect(view.crafts).toEqual([])
    expect(JSON.stringify(view.state)).toBe(before)
  })

  it('使用市场key而非假设key等于蓝图ID，缺导航/无市场/未上线/不可卖/碎片不出入口', () => {
    const view = shelf('zh')
    const sample = view.blueprints.find(bp => !bp.singleUse && core.marketGoodOf(view.ctx, 'blueprint', bp.id))!
    const original = core.marketGoodOf(view.ctx, 'blueprint', sample.id)!
    view.ctx.marketGoods.delete(original.key)
    view.ctx.marketGoods.set('different-market-key', { ...original, key: 'different-market-key' })
    view.state.blueprintStock = { [sample.id]: 2 }
    const jump = () => view.render().find(node => node.type === 'button' && textOf(node) === L10N['ui.CargoPage.001']!.zh)
    jump()!.props.onClick()
    expect(view.jumps).toEqual(['different-market-key'])
    for (const blocked of [{ unreleased: true }, { playerSellable: false }]) {
      view.ctx.marketGoods.set('different-market-key', { ...original, key: 'different-market-key', ...blocked })
      expect(jump()).toBeUndefined()
    }
    view.ctx.marketGoods.delete('different-market-key')
    expect(jump()).toBeUndefined()
    expect(shelf('zh', false).render().some(node => node.type === 'button' && textOf(node) === L10N['ui.CargoPage.001']!.zh)).toBe(false)
    view.state.blueprintStock = {}
    const fragment = core.fragmentRedeemRowsOf(view.state, view.ctx)[0]!
    view.state.learnedRecipes = []
    view.state.warehouse.items[fragment.fragmentItemId] = fragment.need
    const cards = view.render().filter(node => node.props.className?.includes('is-frag'))
    expect(cards).toHaveLength(1)
    expect(nodesOf(cards[0]).some(node => node.type === 'button' && textOf(node) === L10N['ui.CargoPage.001']!.zh)).toBe(false)
  })

  it('工业页透传到App现有市场聚焦桥，不调用出售命令', () => {
    const page = source('apps/desktop/src/renderer/src/pages/IndustryPage.tsx')
    let passed: ts.JsxAttribute | undefined
    const findShelf = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === 'BlueprintShelfPanel') {
        passed = node.attributes.properties.find((attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText(page) === 'onGotoMarket')
      }
      ts.forEachChild(node, findShelf)
    }
    findShelf(page)
    expect(passed?.initializer?.getText(page)).toBe('{onGotoMarket}')
    const app = source('apps/desktop/src/renderer/src/App.tsx')
    let callback: ts.Expression | undefined
    const findIndustry = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === 'IndustryPage') {
        const attr = node.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(app) === 'onGotoMarket')
        if (attr?.initializer && ts.isJsxExpression(attr.initializer)) callback = attr.initializer.expression
      }
      ts.forEachChild(node, findIndustry)
    }
    findIndustry(app)
    expect(callback).toBeDefined()
    const calls: unknown[] = []
    const scope = { result: undefined, setMktFocus: (fn: (old: object) => object) => calls.push(fn({ key: 'old', seq: 4 })), changePage: (page: string) => calls.push(page) }
    evaluate(`globalThis.result = ${callback!.getText(app)}`, scope)
    ;(scope.result as unknown as (key: string) => void)('different-market-key')
    expect(calls).toEqual([{ key: 'different-market-key', seq: 5 }, 'market'])
  })

  it.each([false, true])('现有市场聚焦桥在窄屏=%s时打开对应详情，资产不变', narrow => {
    const view = shelf('zh')
    const bp = view.blueprints.find(bp => bp.singleUse && core.marketGoodOf(view.ctx, 'blueprint', bp.id))!
    const good = core.marketGoodOf(view.ctx, 'blueprint', bp.id)!
    core.ensureMarket(view.state, view.ctx)
    const before = JSON.stringify(view.state)
    const ui = renderer('zh')
    const scope = { ...ui.bindings, window: { matchMedia: () => ({ matches: narrow, addEventListener: () => {}, removeEventListener: () => {} }) },
      pinMarked: (_state: unknown, _kind: string, rows: unknown[]) => rows,
      taxTipText: () => '', fmtClock: String, nextSupplyIn: () => 0, goodDisplayName: (ctx: core.SimContext, key: string) => core.goodName(ctx, key),
      MarketColumn: 'MarketColumn', MarketDetail: 'MarketDetail', MyOrders: 'MyOrders', BlackMarketPage: 'BlackMarketPage', isk: String,
    }
    evaluate(codeOf('apps/desktop/src/renderer/src/pages/MarketPage.tsx', ['KIND_OPTIONS', 'stockedFirst', 'MarketPage']), scope)
    const component = (scope.exports as { MarketPage: (props: object) => unknown }).MarketPage
    let used = 0
    const props = { engine: view.engine, onToast: () => {}, focusKey: good.key, focusSeq: 1, onFocusUsed: () => { used++ } }
    let nodes: Element[] = []
    for (let i = 0; i < 3; i++) nodes = ui.render(component, props)
    expect(used).toBe(1)
    expect(nodes.find(node => node.type === 'input' && node.props.type === 'search')?.props.value).toBe(good.key)
    expect(nodes.filter(node => node.type === 'MarketDetail').map(node => node.props.good.key)).toEqual([good.key])
    expect(nodes.some(node => node.props.className?.includes('app-mkt-detail-modal'))).toBe(narrow)
    expect(JSON.stringify(view.state)).toBe(before)
  })

  it.each(['module', 'ship', 'item', 'single-module', 'single-ship'] as const)('%s 跳转后的市场挂卖只取书架库存，撤单退书不改学习及制造', kind => {
    const view = shelf('zh')
    const single = kind.startsWith('single-')
    const product = single ? kind.slice(7) : kind
    const bp = view.blueprints.find(bp => (bp.singleUse === true) === single &&
      (product === 'ship' ? 'shipId' in bp : product === 'module' ? 'moduleId' in bp && !!bp.moduleId : 'itemId' in bp && !!bp.itemId) &&
      core.marketGoodOf(view.ctx, 'blueprint', bp.id)?.playerSellable !== false &&
      !!core.marketGoodOf(view.ctx, 'blueprint', bp.id))!
    expect(bp).toBeDefined()
    view.state.blueprintStock = { [bp.id]: 3 }
    const button = view.render().find(node => node.type === 'button' && textOf(node) === L10N['ui.CargoPage.001']!.zh)!
    button.props.onClick()
    const key = view.jumps[0]!
    const good = view.ctx.marketGoods.get(key)!
    core.ensureMarket(view.state, view.ctx)
    view.state.market.npcBuy[key] = []
    const learned = [...view.state.learnedRecipes]
    const spent = [...(view.state.spentOneTimeRecipes ?? [])]
    const manufacturing = JSON.stringify(view.state.manufacturingRuns)
    expect(core.marketSellHolding(view.state, view.ctx, key, 1).ok).toBe(false)
    expect(view.state.blueprintStock[bp.id]).toBe(3)
    expect(view.state.escrowItems[key] ?? 0).toBe(0)
    const result = core.listSellHolding(view.state, view.ctx, key, good.basePrice, 2)
    expect(result.ok).toBe(true)
    expect(result.resting).toBe(2)
    expect(view.state.blueprintStock[bp.id]).toBe(1)
    expect(view.state.escrowItems[key]).toBe(2)
    expect(core.cancelOrder(view.state, view.ctx, result.orderId!)).toBe(true)
    expect(view.state.blueprintStock[bp.id]).toBe(3)
    expect(view.state.escrowItems[key] ?? 0).toBe(0)
    expect(view.state.learnedRecipes).toEqual(learned)
    expect(view.state.spentOneTimeRecipes ?? []).toEqual(spent)
    expect(JSON.stringify(view.state.manufacturingRuns)).toBe(manufacturing)
  })
})
