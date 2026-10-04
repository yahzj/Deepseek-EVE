import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, BLUEPRINTS, L10N } from '@whale/data'
import * as core from '../src/index'

type Node = { type: string; props: Record<string, any>; children: unknown[] }
type Mode = 'grid' | 'list'
const ctx = buildSimContext()
const language = { value: 'zh' as 'zh' | 'en' }
const tr = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[language.value] ?? id)
  .replace(/\{(\w+)\}/g, (m, key: string) => String(params?.[key] ?? m))
function load(path: string, name?: string): string {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return ast.statements.filter((n) => name ? ts.isFunctionDeclaration(n) && n.name?.text === name : !ts.isImportDeclaration(n))
    .map((n) => n.getText(ast)).join('\n')
}
function evaluate(code: string, bindings: Record<string, unknown>): void {
  runInNewContext(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, bindings)
}
const bindings = { ...core, exports: {}, tr }
evaluate(load('apps/desktop/src/renderer/src/ui/itemSubs.ts'), bindings)
const filters = bindings.exports as Record<string, any>

function nodesOf(root: unknown): Node[] {
  const result: Node[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value && typeof value === 'object' && 'children' in value) {
      const node = value as Node
      result.push(node)
      node.children.forEach(visit)
    }
  }
  visit(root)
  return result
}
const textOf = (value: unknown): string => Array.isArray(value) ? value.map(textOf).join('') :
  value && typeof value === 'object' && 'children' in value ? textOf((value as Node).children) :
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

function warehouse(mode: Mode) {
  const baseContext = buildSimContext()
  const context = { ...baseContext, items: new Map(baseContext.items) }
  const base = context.items.values().next().value!
  context.items.set('new-unclassified', { ...base, id: 'new-unclassified', name: 'New Item', kind: 'new-kind' } as any)
  const state = core.createInitialState({ seed: 7, nowWallMs: 0, prologue: true })
  state.warehouse.items = Object.fromEntries([...context.items.keys()].map((id) => [id, 5]))
  state.moduleBay = Object.fromEntries([...context.modules.keys()].map((id) => [id, 1]))
  const values: unknown[] = []
  const notices: string[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  const components = Object.fromEntries(['Panel', 'ItemHover', 'ModuleHover', 'ItemGlyphGrid', 'RowGlyph', 'HintIcon',
    'ItemViewBar', 'InfoTable', 'ItemActionModal', 'SellQtyModal', 'RedeemFragmentButton', 'Glyph'].map((name) => [name, name]))
  const scope = {
    ...core, ...filters, ...components, tr,
    React: { createElement: (type: string, props: Record<string, any> | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children }) },
    useState: (initial: unknown) => {
      const at = cursor++
      if (!(at in values)) values[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [values[at], (value: unknown) => { values[at] = value }]
    },
    useEffect: (effect: () => void) => { effects.push(effect) },
    useL10n: () => ({ t: tr }), useItemView: () => [mode, () => {}],
    sortModEntries: (rows: unknown[]) => rows, slotText: (slot: string) => slot,
    kindText: (kind: string) => kind, kindExtraNote: () => undefined,
    itemRarityTierOf: () => undefined, itemBuyQuote: () => undefined,
    itemGlyphName: (_id: string, kind: string) => kind, inventoryItemTone: () => '',
    itemHoverContent: () => '', moduleHoverContent: () => '', crestFamOf: () => undefined,
    isk: String, m3: String, cmdText: () => '',
    result: undefined,
  }
  evaluate(load('apps/desktop/src/renderer/src/pages/ItemsPage.tsx', 'WarehouseView') + '\nglobalThis.result = WarehouseView', scope)
  const engine = { state, ctx: context, fragmentRedeemRows: () => [], loadWareToCargoFit: (id: string) => core.loadWarehouseToCargoFit(state, id, context) }
  const render = (): Node[] => {
    cursor = 0
    effects = []
    const root = (scope.result as unknown as (props: unknown) => unknown)({ engine, onToast: (text: string) => notices.push(text), onGotoMarket: () => {} })
    effects.forEach((effect) => effect())
    return nodesOf(root)
  }
  const click = (label: string): void => {
    const node = render().find((n) => n.type === 'button' && textOf(n.children) === label)
    if (!node) throw new Error(`标签不存在：${label}`)
    node.props.onClick()
  }
  const ids = (): string[] => render().flatMap((node) => node.type === 'ItemHover' ? [node.props.item.id] :
    node.type === 'ModuleHover' ? [node.props.mod.id] : node.type === 'ItemGlyphGrid' ? node.props.cells.map((c: any) => c.key) : []).sort()
  return { render, click, ids, context, state, notices }
}

describe('真实领域与子分类判定', () => {
  it('全部市场商品恰好落入一个领域及一个二级分类', () => {
    for (const good of ctx.marketGoods.values()) {
      const domains = [filters.DOMAIN_ITEM, filters.DOMAIN_SHIP].filter((domain) => filters.marketDomainPasses(ctx, good, domain, filters.SUB_ALL))
      expect(domains, good.key).toHaveLength(1)
      const options = domains[0] === filters.DOMAIN_ITEM ? filters.ITEM_DOMAIN_SUBS : filters.SHIP_DOMAIN_SUBS
      expect(options.filter((s: any) => filters.marketDomainPasses(ctx, good, domains[0], s.key)), good.key).toHaveLength(1)
    }
  })
  it('所有已知装备都有已登记功能，不把无人机新槽位和护盾力场误归其他', () => {
    for (const def of ctx.modules.values()) {
      const key = filters.moduleSubKeyOf(def.slot, def.id)
      expect(key, def.id).not.toBe('other')
      expect(filters.MODULE_SUBS.some((s: any) => s.key === key)).toBe(true)
    }
    expect(filters.moduleSubKeyOf('support', 'brand-new-module')).toBe('other')
    expect(filters.moduleSubKeyOf('new-slot', 'brand-new-module')).toBe('other')
  })
  it('未知物品及未知舰船角色归其他，不猜成采矿舰', () => {
    expect(filters.itemCategoryOf({ kind: 'new-kind' })).toBe('other')
    expect(filters.shipRolePasses({ role: 'new-role' }, 'other')).toBe(true)
    expect(filters.shipRolePasses({}, 'other')).toBe(true)
    expect(filters.shipRolePasses({ role: 'armed', shieldHp: 10, armorHp: 20 }, 'armored')).toBe(true)
  })
  it('市场保留功能、槽位、货柜和蓝图学习筛选，且插件蓝图不落低槽', () => {
    const state = core.createInitialState({ nowWallMs: 0, seed: 1 })
    const gun = [...ctx.marketGoods.values()].find((g) => g.kind === 'module' && ctx.modules.get(g.refId)?.slot === 'turret')!
    expect(filters.marketDomainPasses(ctx, gun, filters.DOMAIN_ITEM, 'module', state, 'weapon', 'high')).toBe(true)
    expect(filters.marketDomainPasses(ctx, gun, filters.DOMAIN_ITEM, 'module', state, 'weapon', 'low')).toBe(false)
    const box = [...ctx.marketGoods.values()].find((g) => g.kind === 'item' && filters.containerSubKeyOf(g.refId) === 'safe')!
    expect(filters.marketDomainPasses(ctx, box, filters.DOMAIN_ITEM, 'container', state, 'safe')).toBe(true)
    expect(filters.marketDomainPasses(ctx, box, filters.DOMAIN_ITEM, 'container', state, 'military')).toBe(false)
    const bp = [...ctx.marketGoods.values()].find((g) => g.kind === 'blueprint' && ctx.blueprints.get(g.refId)?.singleUse !== true)!
    expect(filters.marketDomainPasses(ctx, bp, filters.DOMAIN_ITEM, 'blueprint', state, 'unlearned')).toBe(true)
    state.learnedRecipes.push(bp.refId)
    expect(filters.marketDomainPasses(ctx, bp, filters.DOMAIN_ITEM, 'blueprint', state, 'learned')).toBe(true)
    const plugBp = BLUEPRINTS.find((bp) => ctx.modules.get(bp.moduleId ?? '')?.slot === 'plug')!
    const testCtx = { ...ctx, blueprints: new Map(ctx.blueprints).set(plugBp.id, plugBp) }
    const plug = { kind: 'blueprint', refId: plugBp.id }
    expect(filters.marketDomainPasses(testCtx, plug, filters.DOMAIN_ITEM, 'blueprint', state, 'plug')).toBe(true)
    expect(filters.marketDomainPasses(testCtx, plug, filters.DOMAIN_ITEM, 'blueprint', state, 'low')).toBe(false)
  })
})

describe('真实仓库组件点击与两种视图', () => {
  it.each(['list', 'grid'] as const)('%s 模式全部条目只出现一次，所有二级标签真实过滤内容', (mode) => {
    const view = warehouse(mode)
    const expectedAll = [...view.context.items.keys(), ...view.context.modules.keys()].sort()
    expect(view.ids()).toEqual(expectedAll)
    for (const category of filters.ITEM_DOMAIN_SUBS.filter((s: any) => s.key !== 'blueprint')) {
      view.click(filters.subText(category))
      const pool = category.key === 'module' ? [...view.context.modules.keys()] : [...view.context.items.keys()]
      for (const sub of filters.SUBS_OF_KIND[category.key] ?? []) {
        const expected = pool.filter((id) => filters.itemBucketPasses(view.context, id, category.key) && filters.itemSubPasses(view.context, id, category.key, sub.key)).sort()
        if (!expected.length) continue
        view.click(filters.subText(sub, (id: string) => view.context.items.get(id)?.name))
        expect(view.ids(), `${category.key}/${sub.key}`).toEqual(expected)
      }
    }
  })
  it('未知物品在列表中保留装船、出售及丢弃；卖空父类后回到全部', () => {
    const view = warehouse('list')
    view.click(tr('ui.hud.137'))
    expect(view.ids()).toEqual(['new-unclassified'])
    const item = view.render().find((n) => n.type === 'ItemHover')!
    expect(nodesOf(item).filter((n) => n.type === 'button').map((n) => textOf(n.children))).toContain(tr('ui.ItemsPage.027'))
    expect(nodesOf(item).filter((n) => n.type === 'button').map((n) => textOf(n.children))).toContain(tr('ui.ItemsPage.025'))
    delete view.state.warehouse.items['new-unclassified']
    view.render()
    expect(view.ids().length).toBeGreaterThan(1)
  })
  it('英文标签读取 id，不缓存市场领域的中文', () => {
    language.value = 'en'
    try {
      expect(filters.MARKET_DOMAIN_TABS.map((s: any) => filters.subText(s))).toEqual(['Items', 'Ships'])
    } finally { language.value = 'zh' }
  })
  it('仓库装船失败区分空间不足与缺货，不改变装货判据', () => {
    const view = warehouse('list')
    const id = [...view.context.items.values()].find((d) => d.kind === 'ore')!.id
    view.state.fleet[view.state.shipId]!.cargo = { [id]: 1e9 }
    const item = view.render().find((n) => n.type === 'ItemHover' && n.props.item.id === id)!
    const load = nodesOf(item).find((n) => n.type === 'button' && textOf(n.children) === tr('ui.ItemsPage.025'))!
    load.props.onClick()
    expect(view.notices.at(-1)).toBe(tr('ui.hintAudit.010'))
    delete view.state.warehouse.items[id]
    load.props.onClick()
    expect(view.notices.at(-1)).toBe(tr('ui.ItemsPage.012'))
  })
  it.each(['zh','en'] as const)('%s 锁定舰船装货保持库存并给出双语拒因', (locale) => {
    language.value = locale
    try {
      const view = warehouse('list')
      const id = [...view.context.items.values()].find((d) => d.kind === 'ore')!.id
      view.state.wormhole.run = { fleet: [view.state.shipId] } as any
      const before = JSON.stringify([view.state.warehouse,view.state.fleet[view.state.shipId]!.cargo])
      const item = view.render().find((n) => n.type === 'ItemHover' && n.props.item.id === id)!
      nodesOf(item).find((n) => n.type === 'button' && textOf(n.children) === tr('ui.ItemsPage.025'))!.props.onClick()
      expect(view.notices.at(-1)).toBe(tr('ui.hintAudit.012'))
      expect(JSON.stringify([view.state.warehouse,view.state.fleet[view.state.shipId]!.cargo])).toBe(before)
    } finally { language.value = 'zh' }
  })
})

describe('真实货仓空态提示', () => {
  it.each(['list','grid'] as const)('%s 视图区分真空仓与筛选无匹配', (mode) => {
    for (const empty of [false,true]) {
      const context = buildSimContext()
      const state = core.createInitialState({ nowWallMs: 0, seed: 7 })
      const item = [...context.items.values()].find((d) => d.kind === 'ore')!
      state.fleet[state.shipId]!.cargo = empty ? {} : { [item.id]: 1 }
      let cursor = 0
      const components = Object.fromEntries(['Panel','ProgressBar','ItemHover','ModuleHover','ItemGlyphGrid','RowGlyph','HintIcon','Glyph',
        'ItemViewBar','ItemActionModal','InfoTable','SellQtyModal','RedeemFragmentButton'].map((n)=>[n,n]))
      const scope = { ...core,...filters,...components,tr,exports:{},
        React:{createElement:(type:string,props:Record<string,unknown>|null,...children:unknown[]):Node=>({type,props:props??{},children})},
        useState:(initial:unknown)=>[cursor++===1?'consume':typeof initial==='function'?(initial as ()=>unknown)():initial,()=>{}],
        useEffect:()=>{},useL10n:()=>({t:tr}),useItemView:()=>[mode,()=>{}],
        itemRarityTierOf:()=>undefined,itemBuyQuote:()=>undefined,kindExtraNote:()=>undefined,
        itemGlyphName:()=>'',inventoryItemTone:()=>'',slotText:()=>'',crestFamOf:()=>undefined,
        itemHoverContent:()=>'',moduleHoverContent:()=>'',isk:String,m3:String,cmdText:()=>'',result:undefined,
      }
      evaluate(load('apps/desktop/src/renderer/src/pages/CargoPage.tsx')+'\nglobalThis.result = CargoPage',scope)
      const nodes=nodesOf((scope.result as unknown as (props:object)=>unknown)({engine:{state,ctx:context,fragmentRedeemRows:()=>[]},onToast:()=>{},onGotoMarket:()=>{}}))
      const messages=nodes.filter((n)=>n.props.className==='app-dim app-inv-empty').map(textOf)
      expect(messages).toContain(tr(empty?'ui.CargoPage.049':'ui.hintAudit.001'))
      if(!empty)expect(messages).not.toContain(tr('ui.CargoPage.049'))
    }
  })
})
