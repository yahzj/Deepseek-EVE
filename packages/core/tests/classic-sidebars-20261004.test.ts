import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ROOT, runSaveModule } from './helpers/save-shell'

interface Api {
  readClassicNavPrefs(): { desktop: boolean; mobile: boolean }
  useClassicNavCollapse(enabled: boolean, mobile: boolean): { collapsed: boolean; toggle(): void }
  useClassicLogVisibility(closed: boolean, enabled: boolean): { closed: boolean; faded: boolean }
}

// 运行真实 hook，外部时钟、媒体查询和存储替换；每轮执行依赖变化的 effect。
function harness(raw: string | null = null) {
  const stored = new Map<string, string>(raw === null ? [] : [['whale-idle:classic-nav-prefs', raw]])
  const states: unknown[] = [], effects: Array<{ deps: unknown[]; cleanup?: () => void }> = []
  let cursor = 0, changed = false, pending: Array<() => void> = []
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const body = { classList: { contains: () => false } }
  const react = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next: unknown) => {
        const value = typeof next === 'function' ? next(states[index]) : next
        if (!Object.is(states[index], value)) { states[index] = value; changed = true }
      }]
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++, old = effects[index]
      if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return
      pending.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: fn() || undefined } })
    },
    useLayoutEffect(fn: () => (() => void) | void, deps: unknown[]) { react.useEffect(fn, deps) },
  }
  const api = runSaveModule<Api>('apps/desktop/src/renderer/src/ui/classicSidebars.ts', { react }, {
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
    window: { matchMedia: () => media, setTimeout, clearTimeout,
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16), cancelAnimationFrame: clearTimeout },
    document: { body }, MutationObserver: class { observe() {} disconnect() {} },
  })
  function render<T>(fn: () => T): T {
    let result!: T
    for (let i = 0; i < 10; i++) {
      cursor = 0; changed = false; pending = []; result = fn()
      for (const effect of pending) effect()
      if (!changed) return result
    }
    throw new Error('hook 未收敛')
  }
  return { api, render, media, body, stored }
}

afterEach(() => vi.useRealTimers())
describe('旧版导航滚动区与底部工具区结构', () => {
  const source = ts.createSourceFile('AppShell.tsx', readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/ui/AppShell.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function elements(node: ts.Node, tag?: string): ts.JsxElement[] {
    const found: ts.JsxElement[] = []
    function visit(n: ts.Node) { if (ts.isJsxElement(n) && (!tag || n.openingElement.tagName.getText(source) === tag)) found.push(n); ts.forEachChild(n, visit) }
    visit(node)
    return found
  }
  const hasClass = (node: ts.JsxElement, name: string) => node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'className' && p.initializer?.getText(source).includes(name))
  it('列表和底部是两个兄弟区域，唯一开关在底部而非滚动区', () => {
    const nav = elements(source, 'nav').find(n => n.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'id' && p.initializer?.getText(source) === '"classic-navigation"'))!
    const children = nav.children.filter(ts.isJsxElement)
    expect(children).toHaveLength(2)
    expect(hasClass(children[0]!, 'app-classic-nav-scroll')).toBe(true)
    expect(hasClass(children[1]!, 'app-classic-nav-footer')).toBe(true)
    expect(elements(children[0]!, 'button').some(n => hasClass(n, 'app-classic-nav-toggle'))).toBe(false)
    expect(elements(children[1]!, 'button').filter(n => hasClass(n, 'app-classic-nav-toggle'))).toHaveLength(1)
  })
  it('滚动条留位按实际宽度更新，尺寸不变不写；现代版不监听且卸载清理', () => {
    let effect: ts.ArrowFunction | undefined
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && n.expression.getText(source) === 'useLayoutEffect' && n.arguments[0] && ts.isArrowFunction(n.arguments[0]) && n.arguments[0].getText(source).includes('--classic-nav-scrollbar')) effect = n.arguments[0]
      ts.forEachChild(n, visit)
    }
    visit(source)
    expect(effect).toBeDefined()
    const value = new Map<string, string>(), setProperty = vi.fn((k: string, v: string) => value.set(k, v))
    const nav = { style: { getPropertyValue: (k: string) => value.get(k) ?? '', setProperty } }
    const scroll = { offsetWidth: 168, clientWidth: 160 }
    let update!: () => void
    const observe = vi.fn(), disconnect = vi.fn()
    const bindings = { classicNavRef: { current: nav }, classicNavScrollRef: { current: scroll }, layoutKind: 'classic',
      ResizeObserver: class { constructor(fn: () => void) { update = fn } observe = observe; disconnect = disconnect }, run: undefined as unknown as () => (() => void) | undefined }
    const js = ts.transpileModule(`globalThis.run = ${effect!.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(js, bindings)
    const cleanup = bindings.run()!
    expect(observe).toHaveBeenCalledWith(scroll)
    expect(value.get('--classic-nav-scrollbar')).toBe('8px')
    update(); expect(setProperty).toHaveBeenCalledTimes(1)
    scroll.clientWidth = 168; update(); expect(value.get('--classic-nav-scrollbar')).toBe('0px')
    cleanup(); expect(disconnect).toHaveBeenCalledOnce()
    bindings.layoutKind = 'modern'; bindings.run(); expect(observe).toHaveBeenCalledTimes(1)
  })
  it('手机不再套窄版导航规则，两套导航沿用网页版样式', () => {
    const css = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/styles.css'), 'utf8')
    expect(css).not.toContain('.app-root.is-layout-classic.is-mobile-layout .app-nav-side')
    expect(css).not.toContain('.app-root.is-layout-modern.is-mobile-layout .app-nav-side')
    expect(css).not.toContain('.app-root.is-layout-modern.is-mobile-layout .app-left-col')
    expect(css).not.toContain('.app-root.is-mobile-rot .app-nav-side')
    expect(css).toContain('.app-root.is-layout-classic .app-classic-nav-scroll')
    expect(css).toContain('.app-nav-side .app-nav-item')
  })
})
describe('旧版导航偏好与日志显示时序', () => {
  it.each([null, '{bad', '[]', 'null', '{"desktop":"true","mobile":1}'])('缺省/损坏偏好 %s 保持展开', (raw) => {
    expect(harness(raw).api.readClassicNavPrefs()).toEqual({ desktop: false, mobile: false })
  })
  it('桌面和手机独立保存，现代版不写导航偏好', () => {
    const h = harness()
    h.render(() => h.api.useClassicNavCollapse(false, false))
    expect(h.stored.size).toBe(0)
    h.render(() => h.api.useClassicNavCollapse(true, false)).toggle()
    expect(h.render(() => h.api.useClassicNavCollapse(true, false)).collapsed).toBe(true)
    expect(h.render(() => h.api.useClassicNavCollapse(true, true)).collapsed).toBe(false)
    h.render(() => h.api.useClassicNavCollapse(true, true)).toggle()
    h.render(() => h.api.useClassicNavCollapse(true, true))
    expect(JSON.parse(h.stored.get('whale-idle:classic-nav-prefs')!)).toEqual({ desktop: true, mobile: true })
  })
  it('先淡出保留原占位，结束后收起，展开先占位再淡入', () => {
    vi.useFakeTimers()
    const h = harness()
    h.render(() => h.api.useClassicLogVisibility(false, true))
    expect(h.render(() => h.api.useClassicLogVisibility(true, true))).toEqual({ closed: false, faded: true })
    vi.advanceTimersByTime(139)
    expect(h.render(() => h.api.useClassicLogVisibility(true, true)).closed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(h.render(() => h.api.useClassicLogVisibility(true, true))).toEqual({ closed: true, faded: true })
    expect(h.render(() => h.api.useClassicLogVisibility(false, true))).toEqual({ closed: false, faded: true })
    vi.advanceTimersByTime(32)
    expect(h.render(() => h.api.useClassicLogVisibility(false, true))).toEqual({ closed: false, faded: false })
  })
  it('快速反向取消旧定时器，不会被迟到回调重新关闭', () => {
    vi.useFakeTimers()
    const h = harness()
    h.render(() => h.api.useClassicLogVisibility(false, true))
    h.render(() => h.api.useClassicLogVisibility(true, true))
    vi.advanceTimersByTime(50)
    h.render(() => h.api.useClassicLogVisibility(false, true))
    vi.advanceTimersByTime(500)
    expect(h.render(() => h.api.useClassicLogVisibility(false, true))).toEqual({ closed: false, faded: false })
    h.render(() => h.api.useClassicLogVisibility(true, true)); vi.advanceTimersByTime(140)
    h.render(() => h.api.useClassicLogVisibility(true, true))
    h.render(() => h.api.useClassicLogVisibility(false, true)); vi.advanceTimersByTime(16)
    h.render(() => h.api.useClassicLogVisibility(true, true)); vi.advanceTimersByTime(500)
    expect(h.render(() => h.api.useClassicLogVisibility(true, true)).closed).toBe(true)
  })
  it.each(['reduce', 'no-fx', 'disabled'])('%s 直接切换，不挂收起定时器', (mode) => {
    vi.useFakeTimers()
    const h = harness()
    h.media.matches = mode === 'reduce'
    h.body.classList.contains = () => mode === 'no-fx'
    expect(h.render(() => h.api.useClassicLogVisibility(true, mode !== 'disabled'))).toEqual({ closed: true, faded: true })
    expect(h.render(() => h.api.useClassicLogVisibility(false, mode !== 'disabled'))).toEqual({ closed: false, faded: false })
    expect(vi.getTimerCount()).toBe(0)
  })
})
