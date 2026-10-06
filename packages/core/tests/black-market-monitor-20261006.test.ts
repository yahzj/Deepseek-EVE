import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

function source(path: string, text?: string) {
  return ts.createSourceFile(path, text ?? readFileSync(resolve(ROOT, ui + path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function execute(text: string, scope: Record<string, any>) {
  runInNewContext(ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, scope)
}
function component(path: string, name: string, scope: Record<string, any>, text?: string) {
  const ast = source(path, text)
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

  it('SVG监视器保持章鱼人身份，剪裁/扫描标识逐组件唯一，三姿态复用同一通讯头像', () => {
    let seq = 0
    const scope = { React: jsx, exports: {}, useId: () => `:r${seq++}:`, tr, Glyph: 'Glyph', result: undefined }
    const monitor = component('ui/MerchantMonitor.tsx', 'MerchantMonitor', scope)
    const idle = nodes(monitor({ mood: 'idle' })), deal = nodes(monitor({ mood: 'deal' }))
    expect(idle[0]!.props['aria-label']).toBe(tr('ui.blackMarket.023'))
    expect(idle.find(n => n.type === 'svg')!.props.viewBox).toBe('0 0 420 350')
    const ids = (rows: Node[]) => rows.filter(n => n.props.id).map(n => n.props.id)
    expect(ids(idle).some(id => ids(deal).includes(id))).toBe(false)
    const avatar = (rows: Node[]) => rows.find(n => n.type === 'Glyph')!
    expect(avatar(idle).props).toEqual(avatar(deal).props)
    expect(avatar(idle).props.name).toBe('faction-octopus')
    expect(idle.some(n => n.type === 'pre' || n.type === 'filter')).toBe(false)
  })

  it.each(['idle', 'pitch', 'deal'])('%s姿态只重绘商人，上一版监视器/扫描/剪裁结构逐项不变', mood => {
    const path = 'ui/MerchantMonitor.tsx'
    const before = execFileSync('git', ['show', `c5f8be83:${ui + path}`], { cwd: ROOT, encoding: 'utf8' })
    const scope = () => ({ React: jsx, exports: {}, useId: () => ':monitor:', tr, Glyph: 'Glyph', result: undefined })
    const previous = component(path, 'MerchantMonitor', scope(), before)({ mood })
    const current = component(path, 'MerchantMonitor', scope())({ mood })
    const shell = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shell)
      if (value && typeof value === 'object' && 'children' in value) {
        const node = value as Node
        if (node.props.className === 'app-bm-merchant-image') return 'merchant-image'
        return { ...node, children: node.children.map(shell) }
      }
      return value
    }
    expect(shell(current)).toEqual(shell(previous))
  })

  it('通讯头像加兜帽和单片镜，选货只改整体姿态，不重画五官或保留机器人', () => {
    const monitor = component('ui/MerchantMonitor.tsx', 'MerchantMonitor', { React: jsx, exports: {}, useId: () => ':r:', tr, Glyph: 'Glyph', result: undefined })
    const idle = nodes(monitor({ mood: 'idle' })), pitch = nodes(monitor({ mood: 'pitch' })), deal = nodes(monitor({ mood: 'deal' }))
    for (const className of ['app-bm-comms-portrait', 'app-bm-merchant-hood', 'app-bm-merchant-hood-opening', 'app-bm-merchant-monocle']) {
      expect(idle.some(n => n.props.className === className), className).toBe(true)
    }
    const head = (rows: Node[]) => rows.find(n => n.props.className === 'app-bm-comms-portrait')!
    expect(head(idle).props.transform).toBeUndefined()
    expect(head(pitch).props.transform).not.toBe(head(deal).props.transform)
    expect(idle.filter(n => n.type === 'Glyph')).toHaveLength(1)
    expect(idle.some(n => String(n.props.className).startsWith('app-bm-robot-'))).toBe(false)
    expect(idle.some(n => ['app-bm-merchant-mouth', 'app-bm-merchant-eyes'].includes(n.props.className))).toBe(false)
    const monocle = idle.find(n => n.props.className === 'app-bm-merchant-monocle')!
    expect(nodes(monocle).find(n => n.type === 'circle')!.props).toMatchObject({ cx: '14.94', cy: '8.25' })
  })

  it('共享章鱼图形与通讯头像调用保留，不修改原五官和腕足', () => {
    for (const path of ['ui/Glyphs.tsx', 'panels/CommsReader.tsx']) {
      const before = execFileSync('git', ['show', `b994234f:${ui + path}`], { cwd: ROOT, encoding: 'utf8' })
      const avatar = (ast: ts.SourceFile) => {
        let found: ts.Node | undefined
        const visit = (node: ts.Node) => {
          if (path.endsWith('Glyphs.tsx') && ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === 'faction-octopus') found = node.initializer
          if (path.endsWith('CommsReader.tsx') && ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'Glyph' && node.getText(ast).includes('entry.glyph')) found = node
          ts.forEachChild(node, visit)
        }
        visit(ast)
        expect(found, path).toBeDefined()
        return found!.getText(ast).replace(/\r\n/g, '\n')
      }
      expect(avatar(source(path)), path).toBe(avatar(source(path, before)))
    }
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
    const merchantChildren = () => render().find(n => n.props.className === 'app-bm-merchant')!.children
      .map(n => (n as Node).props.className ?? (n as Node).type)
    expect(merchantChildren()).toEqual(['app-bm-sign', 'MerchantMonitor', 'app-bm-speech'])
    const purchase = nodes(cards[0]).find(n => n.props.className === 'app-btn app-bm-buy')!
    purchase.props.onClick({ currentTarget: {} })
    expect(nodes(render().find(n => n.props.className === 'app-modal app-bm-confirm')).some(n => n.children.includes(before.goodKey))).toBe(true)
    const confirm = render().find(n => n.props.className === 'app-bm-confirm-actions')!
    nodes(confirm).filter(n => n.type === 'button')[1]!.props.onClick()
    expect(calls).toEqual([[before.goodKey, state.blackMarket!.dayWallMs, before.price]])
    expect(state.wallet.isk).toBe(money - before.price)
    expect(render().find(n => n.type === 'MerchantMonitor')!.props.mood).toBe('deal')
    expect(merchantChildren()).toEqual(['app-bm-sign', 'MerchantMonitor', 'app-bm-speech'])
    expect(render().filter(n => n.type === 'article' && n.props.className.includes('is-sold'))).toHaveLength(1)
  })
})
