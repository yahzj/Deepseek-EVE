import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

type ViewNode = { type: string; props: Record<string, any>; children: unknown[] }
const jsx = { Fragment: 'Fragment', createElement: (type: string, props: object | null, ...children: unknown[]): ViewNode => ({ type, props: props ?? {}, children }) }
const nodes = (value: unknown): ViewNode[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'children' in value ? [value as ViewNode, ...(value as ViewNode).children.flatMap(nodes)] : []
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join('')
  : value && typeof value === 'object' && 'children' in value ? (value as ViewNode).children.map(text).join('')
  : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const file = (path: string) => readFileSync(resolve(ROOT, `apps/desktop/src/renderer/src/${path}`), 'utf8')

/** 沿用现有 UI 用例：编译真实函数，仅替换 React 外壳及 DOM，不复制组件实现。 */
function component(path: string, name: string, locale: 'zh' | 'en' = 'zh', extra: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(path, file(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  if (!fn) throw new Error(`Missing component: ${name}`)
  const values: any[] = []
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>()
  let cursor = 0
  let pending: Array<() => void> = []
  const tr = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id)
    .replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match))
  const close = { focus: vi.fn(), isConnected: true }
  const modal = { querySelector: () => close, contains: (target: unknown) => target === close }
  const root = {}, body = {}
  const document = { querySelector: vi.fn((): object | null => root), body,
    addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const leaveTip = vi.fn(), hideTip = vi.fn()
  const hoverContent = (def: { id: string }, hint?: unknown, _engine?: unknown, uid?: string) => jsx.createElement('ModuleInfo', { id: def.id, hint, uid })
  const scope = { ...core, React: jsx, exports: {}, result: undefined, tr, document, hideTip,
    window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    useState: (initial: unknown) => { const at = cursor++; if (!(at in values)) values[at] = initial; return [values[at], (value: unknown) => { values[at] = value }] },
    useRef: (initial: unknown) => { const at = cursor++; return values[at] ??= { current: initial } },
    useId: () => { cursor++; return 'damage-dialog' },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const at = cursor++, previous = effects.get(at)
      if (previous && deps.length === previous.deps.length && deps.every((dep, index) => Object.is(dep, previous.deps[index]))) return
      pending.push(() => { previous?.cleanup?.(); effects.set(at, { deps, cleanup: effect() ?? undefined }) })
    },
    createPortal: (value: unknown, target: unknown) => jsx.createElement('Portal', { target }, value),
    hoverTipProps: (richTip: unknown) => ({ richTip, onMouseLeave: leaveTip }),
    infoCardContent: (title: unknown, _lines: unknown[], note: unknown, extra: unknown) => jsx.createElement('InfoCard', {}, title, note, extra),
    moduleHoverContent: hoverContent, itemHoverContent: hoverContent, moduleShortEffect: () => '+10%',
    Glyph: 'Glyph', X: 'X', ShipDamageMods: 'ShipDamageMods', toneOf: () => 'currentColor', rackText: String, cmdText: () => '', ...extra }
  runInNewContext(ts.transpileModule(fn.getText(source) + `\nglobalThis.result=${name}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope)
  const render = (props: unknown): unknown => {
    cursor = 0; pending = []
    const result = (scope.result as unknown as (props: unknown) => unknown)(props)
    for (const node of nodes(result)) if (node.props.ref) node.props.ref.current = modal
    for (const effect of pending) effect()
    return result
  }
  return { render, tr, document, root, body, close, leaveTip, hideTip, hookCount: () => cursor,
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.() } }
}

function fixture(locale: 'zh' | 'en', slots: number, plugs: string[], damage: core.ShipDamageKind[]) {
  const ctx = buildSimContext(locale), state = core.createInitialState({ nowWallMs: 0, seed: 7 })
  const def = ctx.ships.get('sh-hammerhead')!
  ctx.ships = new Map(ctx.ships).set(def.id, { ...def, plugSlots: slots })
  state.fleet.target = { ...structuredClone(state.fleet[state.shipId]!), defId: def.id, plugs, damagePlugs: damage }
  return { state, ctx }
}

describe('战损并列卡格', () => {
  it.each(['zh', 'en'] as const)('%s固定卡格显示警告、名称和实际负值，清洗不占额外格', locale => {
    const view = component('ui/ShipDamageMods.tsx', 'ShipDamageMods', locale)
    expect(view.render({ ids: [] })).toBeNull()
    const hooks = view.hookCount()
    const ids = ['shield', 'cargo', 'range', 'ghost', 'shield']
    const before = [...ids]
    const result = nodes(view.render({ ids }))
    expect(view.hookCount()).toBe(hooks)
    const cards = result.filter(node => node.props['data-damage-kind'])
    expect(cards.map(card => card.props['data-damage-kind'])).toEqual(['shield', 'cargo', 'range'])
    expect(cards.every(card => card.type === 'button' && card.props['aria-haspopup'] === 'dialog')).toBe(true)
    expect(cards.every(card => card.props['aria-label'].includes(view.tr('ui.shipDamage.013')) && text(card).includes('-15%'))).toBe(true)
    for (const card of cards) {
      expect(nodes(card).some(node => node.type === 'Glyph' && node.props.name === 'ico-hint')).toBe(true)
      expect(text(card.props.richTip)).toContain('15%')
      expect(text(card.props.richTip)).toContain(view.tr('ui.shipDamage.014'))
      expect(card.props.title).toBeUndefined()
    }
    expect(result.some(node => node.type === 'details' || node.type === 'summary' || node.type === 'InfoCard')).toBe(false)
    expect(ids).toEqual(before)
    expect(view.render({ ids: undefined })).toBeNull()
    expect(view.hookCount()).toBe(hooks)
  })

  it('点击/触屏详情走 root portal，Tab/Escape/关闭/移除及卸载恢复焦点', () => {
    const view = component('ui/ShipDamageMods.tsx', 'ShipDamageMods')
    const props = { ids: ['shield'] }
    const trigger = { focus: vi.fn(), isConnected: true }
    const card = () => nodes(view.render(props)).find(node => node.props['data-damage-kind'])!
    const open = () => {
      card().props.onClick({ currentTarget: trigger })
      return nodes(view.render(props))
    }
    let result = open()
    expect(view.leaveTip).toHaveBeenCalledOnce()
    expect(view.hideTip).toHaveBeenCalledOnce()
    expect(result.find(node => node.type === 'Portal')!.props.target).toBe(view.root)
    expect(view.close.focus).toHaveBeenCalledOnce()
    const dialog = result.find(node => node.props.role === 'dialog')!
    expect(dialog.props['aria-modal']).toBe('true')
    expect(result.some(node => node.props.id === dialog.props['aria-labelledby'])).toBe(true)
    expect(card().props['aria-controls']).toBe(dialog.props.id)
    expect(card().props['aria-expanded']).toBe(true)
    expect(result.find(node => node.type === 'InfoCard')).toBe(result.find(node => node.props['data-damage-kind'])!.props.richTip)
    const key = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    for (const event of [key('Tab'), key('Tab', true)]) {
      dialog.props.onKeyDown(event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    const keepFocus = view.document.addEventListener.mock.calls.at(-1)![1] as (event: unknown) => void
    keepFocus({ target: {} })
    expect(view.close.focus).toHaveBeenCalledTimes(4)
    const escape = key('Escape')
    dialog.props.onKeyDown(escape)
    expect(escape.stopPropagation).toHaveBeenCalledOnce()
    expect(nodes(view.render(props)).some(node => node.type === 'Portal')).toBe(false)
    expect(trigger.focus).toHaveBeenCalledOnce()
    expect(view.document.removeEventListener).toHaveBeenCalledWith('focusin', keepFocus)
    result = open()
    result.find(node => node.type === 'button' && node.props['aria-label'] === view.tr('ui.FitPage.055'))!.props.onClick()
    view.render(props)
    expect(trigger.focus).toHaveBeenCalledTimes(2)
    result = open()
    result.find(node => node.props.className === 'app-modal-mask app-ship-damage-mask')!.props.onClick()
    view.render(props)
    expect(trigger.focus).toHaveBeenCalledTimes(3)
    view.document.querySelector.mockReturnValue(null)
    result = open()
    expect(result.find(node => node.type === 'Portal')!.props.target).toBe(view.body)
    view.render({ ids: [] })
    expect(trigger.focus).toHaveBeenCalledTimes(4)
    open()
    view.unmount()
    expect(trigger.focus).toHaveBeenCalledTimes(5)
  })

  it.each(['zh', 'en'] as const)('%s装配网格：满槽加3战损、零槽及普通计数仍独立', locale => {
    const view = component('pages/FitPage.tsx', 'PluginSlotsSection', locale)
    const engine = fixture(locale, 2, ['plug-cpu-core', 'plug-cpu-core'], ['shield', 'cargo', 'range'])
    const before = JSON.stringify(engine.state)
    const result = view.render({ engine, target: 'target' })
    const grid = nodes(result).find(node => node.props.className === 'app-fit-icongrid')!
    expect(nodes(grid).filter(node => node.props.className === 'app-fit-slot-icon is-filled is-readonly')).toHaveLength(2)
    expect(nodes(grid).at(-1)!.type).toBe('ShipDamageMods')
    expect(nodes(grid).at(-1)!.props.ids).toEqual(['shield', 'cargo', 'range'])
    expect(text(result)).toContain(view.tr('ui.Expedition.444', { p1: 2, p2: 2 }))
    expect(JSON.stringify(engine.state)).toBe(before)
    const zero = fixture(locale, 0, [], ['shield'])
    const onlyDamage = view.render({ engine: zero, target: 'target' })
    expect(nodes(onlyDamage).filter(node => node.type === 'ShipDamageMods')).toHaveLength(1)
    expect(nodes(onlyDamage).some(node => node.props.className?.includes('is-empty'))).toBe(false)
    expect(text(onlyDamage)).not.toContain(view.tr('ui.FitPage.184'))
    expect(text(onlyDamage)).not.toContain(view.tr('ui.FitPage.177'))
    zero.state.fleet.target!.damagePlugs = []
    expect(view.render({ engine: zero, target: 'target' })).toBeNull()
    const partial = fixture(locale, 2, ['plug-cpu-core'], ['shield'])
    expect(nodes(view.render({ engine: partial, target: 'target' })).filter(node => node.props.className === 'app-fit-slot-icon is-empty')).toHaveLength(1)
  })

  it.each(['zh', 'en'] as const)('%s舰船摘要：重复普通插件的数量与富卡只读，战损同网格', locale => {
    const view = component('pages/ShipPage.tsx', 'ShipPlugSummary', locale)
    const engine = fixture(locale, 3, ['plug-cpu-core', 'plug-cpu-core', 'plug-shield-plate'], ['cargo'])
    const before = JSON.stringify(engine.state)
    const result = view.render({ engine, uid: 'target' })
    const grid = nodes(result).find(node => node.props.className === 'app-fit-icongrid')!
    const ordinary = nodes(grid).filter(node => node.props['data-ship-plug-id'])
    expect(ordinary).toHaveLength(2)
    expect(text(ordinary.find(node => node.props['data-ship-plug-id'] === 'plug-cpu-core'))).toContain('×2')
    expect(ordinary.every(node => node.type === 'span' && !node.props.onClick && node.props.richTip?.props.uid === 'target')).toBe(true)
    expect(nodes(grid).at(-1)!.type).toBe('ShipDamageMods')
    expect(text(result)).toContain(view.tr('ui.Expedition.444', { p1: 3, p2: 3 }))
    expect(JSON.stringify(engine.state)).toBe(before)
    const onlyDamage = fixture(locale, 0, [], ['hull'])
    expect(nodes(view.render({ engine: onlyDamage, uid: 'target' })).some(node => node.type === 'ShipDamageMods')).toBe(true)
    onlyDamage.state.fleet.target!.damagePlugs = []
    expect(view.render({ engine: onlyDamage, uid: 'target' })).toBeNull()
    engine.state.fleet.target!.damagePlugs = []
    expect(nodes(view.render({ engine, uid: 'target' })).filter(node => node.props['data-ship-plug-id'])).toHaveLength(2)
  })

  it.each(['zh', 'en'] as const)('%s沉船：普通插件后、无人机前，同网格且仅有战损也保留组', locale => {
    const view = component('panels/WreckFitPanel.tsx', 'WreckFitPanel', locale)
    const engine = fixture(locale, 2, [], [])
    const entry: core.WreckLogEntry = { seq: 1, shipId: 'lost', shipName: 'Test', defId: 'sh-hammerhead', cause: 'wormhole-sunk', atGameMs: 0,
      fitted: { high: [], mid: [], low: [] }, plugs: ['plug-cpu-core', 'plug-cpu-core'], damagePlugs: ['shield'], droneLoad: { 'drone-scout': 2 } }
    const before = JSON.stringify(entry)
    const result = nodes(view.render({ engine, entry }))
    const grid = result.find(node => node.props.className === 'app-fit-icongrid' && nodes(node).some(child => child.type === 'ShipDamageMods'))!
    expect(nodes(grid).filter(node => node.props['data-wreck-fit-id'] === 'plug-cpu-core')).toHaveLength(2)
    expect(nodes(grid).at(-1)!.type).toBe('ShipDamageMods')
    expect(result.findIndex(node => node.type === 'ShipDamageMods')).toBeLessThan(result.findIndex(node => node.props['data-wreck-fit-id'] === 'drone-scout'))
    expect(JSON.stringify(entry)).toBe(before)
    entry.plugs = []
    const onlyDamage = nodes(view.render({ engine, entry }))
    expect(onlyDamage.some(node => node.props.className === 'app-wreck-fit-group' && text(node).includes(view.tr('ui.WreckLog.008')) && nodes(node).some(child => child.type === 'ShipDamageMods'))).toBe(true)
    entry.damagePlugs = []
    expect(nodes(view.render({ engine, entry })).some(node => node.type === 'ShipDamageMods')).toBe(false)
  })

  it('组件只挂在插件网格内，样式复用固定卡高，不另作展开清单', () => {
    for (const [path, name] of [['pages/FitPage.tsx', 'PluginSlotsSection'], ['pages/ShipPage.tsx', 'ShipPlugSummary'], ['panels/WreckFitPanel.tsx', 'WreckFitPanel']]) {
      const source = ts.createSourceFile(path!, file(path!), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const calls: ts.JsxSelfClosingElement[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'ShipDamageMods') calls.push(node)
        ts.forEachChild(node, visit)
      }
      visit(source)
      expect(calls).toHaveLength(1)
      let parent: ts.Node | undefined = calls[0]!.parent
      expect(ts.isJsxElement(parent!)).toBe(true)
      expect(parent!.getText(source)).toContain('className="app-fit-icongrid"')
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent
      expect((parent as ts.FunctionDeclaration).name?.text).toBe(name)
    }
    const css = file('styles-ship-damage.css')
    expect(css).not.toMatch(/(?:^|\n)\s*height\s*:|\btransform\s*:|\b[\d.]+v[wh]\b/)
    expect(file('ui/ShipDamageMods.tsx')).toContain("import '../styles-ship-damage.css'")
  })
})
