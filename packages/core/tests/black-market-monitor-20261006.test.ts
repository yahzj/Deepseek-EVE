import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { blackMarketBuy, blackMarketUnlocked, blackMarketNextRefresh, ensureBlackMarket } from '../src/blackMarket'
import { ROOT } from './helpers/save-shell'
import { resolve } from 'node:path'

type Node = { type: string; props: Record<string, any>; children: unknown[] }
const ui = 'apps/desktop/src/renderer/src/'
const tr = (id: string) => L10N[id]?.zh ?? id
const jsx = { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children }) }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'children' in value
  ? [value as Node, ...(value as Node).children.flatMap(nodes)] : []

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(resolve(ROOT, ui + path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function execute(text: string, scope: Record<string, any>) {
  runInNewContext(ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, scope)
}
function component(path: string, name: string, scope: Record<string, any>) {
  const ast = source(path)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!
  execute(fn.getText(ast) + `\nglobalThis.result = ${name}`, scope)
  return scope.result as (props: any) => Node
}

describe('黑市监视器与入口真实组件行为', () => {
  it.each([99, 100])('累计声望%s的入口在限定奇货之后，搜索激活仍可进入', (standing) => {
    const ast = source('pages/MarketPage.tsx')
    let navigation: ts.JsxElement | undefined
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.getText(ast).includes('app-subtabs app-mkt-tabs')) navigation = node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(navigation).toBeDefined()
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.standingsEarned = { dsi: standing }
    let opened = 0, visible = false
    const scope = { React: jsx, exports: {}, tr, blackMarketUnlocked, state, mktTab: 'exotic', filterActive: true,
      changeMarketTab: () => {}, Glyph: 'Glyph', engine: { openBlackMarketAt: () => opened++ }, setBlackMarketOpen: (next: boolean) => visible = next, result: undefined }
    execute('globalThis.result = ' + navigation!.getText(ast), scope)
    const buttons = nodes(scope.result).filter(n => n.type === 'button')
    expect(buttons).toHaveLength(standing === 100 ? 5 : 4)
    expect(buttons[3]!.children.flat()).toContainEqual(expect.objectContaining({ type: 'span', children: [tr('ui.MarketPage.028')] }))
    const entry = buttons.find(n => n.props.className.includes('app-bm-entry'))
    if (standing === 100) {
      entry!.props.onClick()
      expect(opened).toBe(1)
      expect(visible).toBe(true)
    } else expect(entry).toBeUndefined()
  })

  it('切换普通市场标签真实执行清搜索/恢复全部分类，不把筛选结果留在标签下面', () => {
    const ast = source('pages/MarketPage.tsx')
    let callback: ts.ArrowFunction | undefined
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'changeMarketTab') callback = node.initializer as ts.ArrowFunction
      ts.forEachChild(node, visit)
    }
    visit(ast)
    const changes: unknown[] = []
    const scope = { setKw: (v: unknown) => changes.push(v), changeKind: (v: unknown) => changes.push(v), setMktTab: (v: unknown) => changes.push(v), DOMAIN_ALL: 'all', result: undefined }
    execute('globalThis.result = ' + callback!.getText(ast), scope)
    ;(scope.result as unknown as (tab: string) => void)('rare')
    expect(changes).toEqual(['', 'all', 'rare'])
  })

  it('SVG监视器保持章鱼人身份，剪裁/扫描标识逐组件唯一，成交嘴形改变', () => {
    let seq = 0
    const scope = { React: jsx, exports: {}, useId: () => `:r${seq++}:`, tr, result: undefined }
    const monitor = component('ui/MerchantMonitor.tsx', 'MerchantMonitor', scope)
    const idle = nodes(monitor({ mood: 'idle' })), deal = nodes(monitor({ mood: 'deal' }))
    expect(idle[0]!.props['aria-label']).toBe(tr('ui.blackMarket.023'))
    expect(idle.find(n => n.type === 'svg')!.props.viewBox).toBe('0 0 420 350')
    const ids = (rows: Node[]) => rows.filter(n => n.props.id).map(n => n.props.id)
    expect(ids(idle).some(id => ids(deal).includes(id))).toBe(false)
    const mouth = (rows: Node[]) => rows.find(n => n.props.className === 'app-bm-merchant-mouth')!.props.d
    expect(mouth(idle)).not.toBe(mouth(deal))
    expect(idle.some(n => n.type === 'pre' || n.type === 'filter')).toBe(false)
  })

  it('九卡选货到购买调用保持原报价与日期，商人mood随选货/成交切换', () => {
    const ctx = buildSimContext(), now = Date.now()
    const state = createInitialState({ nowWallMs: now, seed: 7 })
    state.standingsEarned = { dsi: 100 }; state.wallet.isk = 1e14
    ensureBlackMarket(state, ctx, now)
    const values: unknown[] = []
    let cursor = 0
    const calls: unknown[][] = []
    const scope = { React: jsx, exports: {}, tr, useL10n: () => {}, useEffect: () => {}, useRef: () => ({ current: null }),
      useState: (initial: unknown) => { const at = cursor++; if (!(at in values)) values[at] = initial; return [values[at], (v: unknown) => values[at] = v] },
      blackMarketUnlocked, blackMarketNextRefresh, fmtDuration: String, isk: String, cmdText: () => '',
      marketGoodDisplayName: (_ctx: unknown, key: string) => key,
      marketGoodInfo: (_ctx: unknown, good: { key: string }) => ({ title: good.key, lines: [], note: '说明', category: '类别', glyph: 'blueprint', tone: 'currentColor' }),
      infoCardContent: () => null, crestLabelOf: String, FOE_ACCENT: {},
      Glyph: 'Glyph', MerchantMonitor: 'MerchantMonitor', MarketGoodHover: 'MarketGoodHover', result: undefined }
    const page = component('pages/BlackMarketPage.tsx', 'BlackMarketPage', scope)
    const engine = { state, ctx, buyBlackMarketAt: (key: string, day: number, price: number) => {
      calls.push([key, day, price]); return blackMarketBuy(state, ctx, key, day, price, now)
    } }
    const render = () => { cursor = 0; return nodes(page({ engine, onToast: () => {}, onBack: () => {} })) }
    const cards = render().filter(n => n.type === 'article')
    expect(cards).toHaveLength(9)
    const before = { ...state.blackMarket!.offers[0]! }, money = state.wallet.isk
    nodes(cards[0]).find(n => n.props.className === 'app-bm-select')!.props.onClick()
    expect(render().find(n => n.type === 'MerchantMonitor')!.props.mood).toBe('pitch')
    const purchase = nodes(cards[0]).find(n => n.props.className === 'app-btn app-bm-buy')!
    purchase.props.onClick({ currentTarget: {} })
    const confirm = render().find(n => n.props.className === 'app-bm-confirm-actions')!
    nodes(confirm).filter(n => n.type === 'button')[1]!.props.onClick()
    expect(calls).toEqual([[before.goodKey, state.blackMarket!.dayWallMs, before.price]])
    expect(state.wallet.isk).toBe(money - before.price)
    expect(render().find(n => n.type === 'MerchantMonitor')!.props.mood).toBe('deal')
    expect(render().filter(n => n.type === 'article' && n.props.className.includes('is-sold'))).toHaveLength(1)
  })
})
