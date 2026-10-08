import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { L10N } from '@whale/data'
import { ROOT } from './helpers/save-shell'

const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/panels/BattleCycles.tsx'), 'utf8')
const css = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/styles-battle-cycles.css'), 'utf8')
const tooltip = ts.createSourceFile('Tooltip.tsx', readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/ui/Tooltip.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let delay = 0
for (const statement of tooltip.statements) if (ts.isVariableStatement(statement)) {
  for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(tooltip) === 'TIP_DELAY_MS') delay = Number(declaration.initializer!.getText(tooltip))
}

type Row = {
  id: string; ownerTag: string; shipId: string; ownerName: string; label: string; count: number
  cycleMs: number; remainingMs: number; percent: number; state: string; src?: string; aliveCount?: number
  kind?: string; targetTag?: string; targetName?: string; effectPct?: number; damageType?: string; minM?: number; maxM?: number
}
type Props = { weapons: Row[]; devices: Row[] }
type VNode = { type: string; props: Record<string, any>; children: unknown[]; host?: Host }
const nodes = (value: unknown): VNode[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'children' in value ? [value as VNode, ...(value as VNode).children.flatMap(nodes)] : []
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value)
  : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' && 'children' in value ? text((value as VNode).children) : ''
const weapon = (patch: Partial<Row> = {}): Row => ({ id: 'me:gun:0', ownerTag: 'me', shipId: 's1', ownerName: 'Leader', label: 'Railgun',
  src: 'turret', count: 1, minM: 0, maxM: 4000, cycleMs: 2400, remainingMs: 1200, percent: 50, state: 'reload', damageType: 'kinetic', ...patch })
const device = (patch: Partial<Row> = {}): Row => ({ id: 'escort:web:0', ownerTag: 'escort', shipId: 's2', ownerName: 'Escort', label: 'Snare Net',
  kind: 'web', count: 1, cycleMs: 8000, remainingMs: 3000, percent: 62.5, state: 'active', targetTag: 'foe:2', targetName: 'Broodmother', effectPct: 50, ...patch })

class Host {
  parent: Host | null = null
  offsetParent: Host | null = null
  offsetTop = 0
  offsetHeight = 36
  clientHeight = 600
  scrollTop = 0
  scrollLeft = 0
  focused = 0
  connected = true
  addEventListener = (_name: string, _fn: (event: unknown) => void, _options?: unknown): void => {}
  removeEventListener = (_name: string, _fn: (event: unknown) => void, _options?: unknown): void => {}
  vars = new Map<string, string>()
  style = { getPropertyValue: (key: string) => this.vars.get(key) ?? '', setProperty: (key: string, value: string) => this.vars.set(key, value) }
  contains(value: Host | null): boolean {
    for (let node = value; node; node = node.parent) if (node === this) return true
    return false
  }
  closest = (_selector: string): Host | null => null
  querySelector = (_selector: string): Host | null => null
  focus = (): void => { this.focused++ }
}

function harness(locale: 'zh' | 'en' = 'zh') {
  const slots: any[] = []
  const pending: Array<() => void> = []
  const timers = new Map<number, { at: number; fn: () => void }>()
  const listeners = new Map<string, Set<(event: any) => void>>()
  const observers: Array<{ callback: () => void; targets: Host[]; disconnected: boolean }> = []
  const hosts = { root: new Host(), scope: new Host(), trigger: new Host(), panel: new Host(), scroll: new Host(), screen: new Host(), controls: new Host(), outside: new Host() }
  let cursor = 0, now = 0, timerId = 0, canHover = true
  hosts.root.offsetTop = 84; hosts.root.offsetParent = hosts.screen
  hosts.trigger.offsetParent = hosts.root
  hosts.controls.offsetTop = 500; hosts.controls.offsetParent = hosts.screen
  hosts.root.closest = () => hosts.screen
  hosts.screen.querySelector = () => hosts.controls
  const document = {
    activeElement: hosts.outside,
    addEventListener: (name: string, fn: (e: any) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn) },
    removeEventListener: (name: string, fn: (e: any) => void) => listeners.get(name)?.delete(fn),
  }
  for (const host of Object.values(hosts)) host.focus = () => { host.focused++; document.activeElement = host }
  const depsChanged = (a?: unknown[], b?: unknown[]): boolean => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))
  const effect = (fn: () => void | (() => void), deps?: unknown[]): void => {
    const at = cursor++, previous = slots[at]
    if (!previous || depsChanged(previous.deps, deps)) pending.push(() => {
      previous?.cleanup?.()
      slots[at] = { deps, cleanup: fn() }
    })
  }
  const tr = (id: string, params?: Record<string, unknown>): string => (L10N[id]?.[locale] ?? id)
    .replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match))
  const react = {
    useState: (initial: unknown) => {
      const at = cursor++
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [slots[at], (value: unknown) => { slots[at] = typeof value === 'function' ? (value as (v: unknown) => unknown)(slots[at]) : value }]
    },
    useRef: (value: unknown) => { const at = cursor++; return slots[at] ??= { current: value } },
    useId: () => { const at = cursor++; return slots[at] ??= `cycles-${at}` },
    useEffect: effect, useLayoutEffect: effect,
  }
  const createElement = (type: string | ((props: any) => unknown), props: Record<string, any> | null, ...children: unknown[]): unknown =>
    typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children }
  const module = { exports: {} as { BattleCycles: (p: Props) => VNode } }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, {
    module, exports: module.exports, React: { createElement }, document, Node: Host,
    window: { matchMedia: () => ({ matches: canHover }) },
    setTimeout: (fn: () => void, wait: number) => { const id = ++timerId; timers.set(id, { at: now + wait, fn }); return id },
    clearTimeout: (id: number) => timers.delete(id),
    ResizeObserver: class {
      entry: (typeof observers)[number]
      constructor(callback: () => void) { this.entry = { callback, targets: [], disconnected: false }; observers.push(this.entry) }
      observe(host: Host) { this.entry.targets.push(host) }
      disconnect() { this.entry.disconnected = true }
    },
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'lucide-react') return { List: 'List', Pin: 'Pin', ChevronDown: 'ChevronDown' }
      if (id === '../i18n/locale') return { tr }
      if (id === '../ui/Tooltip') return { TIP_DELAY_MS: delay }
      if (id === '../ui/tones') return { DMG_COLOR: { kinetic: 'gold', explosive: 'red', plasma: 'cyan' } }
      if (id.endsWith('.css')) return {}
      throw new Error(`未声明依赖：${id}`)
    },
  })
  let tree: VNode
  let props: Props = { weapons: [weapon()], devices: [device()] }
  const bind = (value: unknown, parent: Host | null = null): void => {
    if (Array.isArray(value)) { value.forEach(v => bind(v, parent)); return }
    if (!value || typeof value !== 'object' || !('children' in value)) return
    const node = value as VNode
    const name = node.props.className ?? ''
    const host = name === 'app-battle-cycles' ? hosts.root : name === 'app-bc-weapons' ? hosts.scope
      : name.includes('app-bc-trigger') ? hosts.trigger : name === 'app-bc-popup' ? hosts.panel
        : name.includes('app-bc-device-scroll') ? hosts.scroll : new Host()
    host.parent = parent; node.host = host
    if (node.props.ref) node.props.ref.current = host
    node.children.forEach(child => bind(child, host))
  }
  const render = (next?: Props): VNode[] => {
    if (next) props = next
    cursor = 0
    tree = module.exports.BattleCycles(props)
    bind(tree)
    pending.splice(0).forEach(fn => fn())
    return nodes(tree)
  }
  const find = (name: string): VNode => nodes(tree).find(n => (n.props.className ?? '').split(' ').includes(name))!
  const dispatch = (name: string, event: any): void => { [...(listeners.get(name) ?? [])].forEach(fn => fn(event)) }
  const advance = (ms: number): void => {
    const end = now + ms
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at; timers.delete(next[0]); next[1].fn()
    }
    now = end
  }
  const key = (key: string, repeat = false) => ({ key, repeat, prevented: false, stopped: false,
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } })
  render()
  return { render, find, hosts, tr, dispatch, advance, key, timers, listeners, observers,
    hover: (pointerType = 'mouse') => find('app-bc-weapons').props.onPointerEnter({ pointerType }),
    leave: (relatedTarget: unknown = null) => find('app-bc-weapons').props.onPointerLeave({ currentTarget: hosts.scope, relatedTarget }),
    click: () => find('app-bc-trigger').props.onClick(), canHover: (value: boolean) => { canHover = value },
    active: () => document.activeElement,
    unmount: () => { slots.forEach(slot => slot?.cleanup?.()); Object.values(hosts).forEach(h => { h.connected = false }) },
  }
}

describe('战斗周期真实组件交互', () => {
  it('触屏离开到窗口对象不调用contains；悬停关闭、固定模式保持', () => {
    const view = harness()
    view.hosts.scope.contains = value => {
      if (value && !(value instanceof Host)) throw new TypeError('不是Node')
      return Host.prototype.contains.call(view.hosts.scope, value)
    }
    view.hover(); view.advance(delay); view.render()
    expect(() => view.leave({ window: true })).not.toThrow()
    view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    view.click(); view.render()
    expect(() => view.leave({ window: true })).not.toThrow()
    view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
  })

  it('停满统一延迟才展开；移入列表并滚动保持；离开整块关闭且无悬停遗留', () => {
    const view = harness()
    expect(delay).toBeGreaterThan(0)
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    view.hover(); view.advance(delay - 1); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    view.advance(1); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    expect(view.find('app-bc-trigger').props['aria-pressed']).toBe(false)
    view.leave(view.hosts.panel); view.hosts.panel.scrollTop = 60; view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    expect(view.hosts.panel.scrollTop).toBe(60)
    expect(view.active()).toBe(view.hosts.outside)
    view.leave(); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    view.hover(); view.advance(delay - 1); view.leave(); view.advance(1); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    expect(view.timers.size).toBe(0)
  })

  it('悬停后点击固定，离开仍开，内部点按不关闭，外部点按关闭且不夺焦', () => {
    const view = harness()
    view.hover(); view.advance(delay); view.render(); view.click(); view.render()
    expect(view.find('app-bc-popup').props['data-pinned']).toBe(true)
    view.leave(); view.dispatch('pointerdown', { target: view.hosts.panel }); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    view.hosts.outside.focus(); view.dispatch('pointerdown', { target: view.hosts.outside }); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    expect(view.active()).toBe(view.hosts.outside)
    expect(view.listeners.get('pointerdown')?.size).toBe(1)
    view.click(); view.render(); view.click(); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
  })

  it('触屏和无悬停设备仅点按展开；取消待发悬停，第二次点按收起', () => {
    const view = harness()
    view.hover('touch'); view.advance(delay); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    view.canHover(false); view.hover(); expect(view.timers.size).toBe(0)
    view.canHover(true); view.hover(); view.click(); view.render(); view.advance(delay); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    expect(view.find('app-bc-trigger').props['aria-pressed']).toBe(true)
    view.click(); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
  })

  it.each(['Enter', ' '])('%s打开且长按不重复；Escape只在焦点位于列表时归还入口', key => {
    const view = harness()
    view.hosts.trigger.focus()
    const event = view.key(key)
    view.find('app-bc-trigger').props.onKeyDown(event); view.render()
    expect(event.prevented).toBe(true)
    expect(view.find('app-bc-trigger').props['aria-expanded']).toBe(true)
    expect(view.active()).toBe(view.hosts.trigger)
    view.find('app-bc-trigger').props.onKeyDown(view.key(key, true)); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    view.hosts.panel.focus()
    const escape = view.key('Escape'); view.dispatch('keydown', escape); view.render()
    expect(escape.prevented && escape.stopped).toBe(true)
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    expect(view.active()).toBe(view.hosts.trigger)
    view.click(); view.render(); view.hosts.outside.focus(); view.dispatch('keydown', view.key('Escape')); view.render()
    expect(view.active()).toBe(view.hosts.outside)
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    expect(view.render().some(n => n.props['aria-modal'] || n.props.role === 'dialog')).toBe(false)
    view.click(); view.render()
    const tab = view.key('Tab'); view.dispatch('keydown', tab)
    expect(tab.prevented).toBe(false)
  })

  it('心跳更新周期、剩余、进度和真实目标，不关窗、不重挂、不夺焦、不重置滚动', () => {
    const view = harness()
    view.click(); view.render(); view.hosts.panel.focus()
    view.hosts.panel.scrollTop = 96; view.hosts.panel.scrollLeft = 32
    const before = view.find('app-bc-popup').host
    const focusCount = view.hosts.panel.focused
    const content = view.render({ weapons: [weapon({ cycleMs: 800, remainingMs: 150, percent: 81.25 })],
      devices: [device({ targetName: 'Worker', targetTag: 'foe:3', effectPct: 25, remainingMs: 1200, percent: 85 })] })
    expect(view.find('app-bc-popup').host).toBe(before)
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    expect(view.active()).toBe(view.hosts.panel)
    expect(view.hosts.panel.focused).toBe(focusCount)
    expect([view.hosts.panel.scrollTop, view.hosts.panel.scrollLeft]).toEqual([96, 32])
    const row = content.find(n => n.props['data-cycle-id'] === 'me:gun:0')!
    const deviceRow = content.find(n => n.props['data-battle-device-cycle'] === 'escort:web:0')!
    expect(row.props['data-cycle-ms']).toBe(800)
    expect(row.props['data-remaining-ms']).toBe(150)
    expect(nodes(row).find(n => n.props.className === 'app-bts-reload-fill')!.props.style.width).toBe('81.25%')
    expect(deviceRow.props.title).toContain(view.tr('ui.battleCycles.017', { p1: 'Worker' }))
    expect(deviceRow.props.title).toContain(view.tr('ui.battleCycles.018', { p1: 25 }))
    expect(view.listeners.get('keydown')?.size).toBe(1)
    expect(view.listeners.get('pointerdown')?.size).toBe(1)
    expect(view.observers).toHaveLength(1)
  })

  it('悬停列表获得键盘焦点后离开鼠标仍可内滚，焦点离开后收起', () => {
    const view = harness()
    view.hover(); view.advance(delay); view.render(); view.hosts.panel.focus(); view.leave(); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(false)
    view.find('app-bc-weapons').props.onBlur({ currentTarget: view.hosts.scope, relatedTarget: view.hosts.outside }); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
  })

  it('卸载清理未触发定时器、全局监听和尺寸观察器', () => {
    const pending = harness(); pending.hover(); pending.unmount(); pending.advance(delay)
    expect(pending.timers.size).toBe(0)
    const open = harness(); open.click(); open.render(); open.unmount()
    expect(open.listeners.get('pointerdown')?.size).toBe(0)
    expect(open.listeners.get('keydown')?.size).toBe(0)
    expect(open.observers.every(o => o.disconnected)).toBe(true)
  })

  it('待发悬停可由Escape或外部点按取消；关闭时不拦截战场键盘与焦点', () => {
    const view = harness()
    view.hover(); view.advance(delay - 1)
    const escape = view.key('Escape'); view.dispatch('keydown', escape); view.advance(1); view.render()
    expect(escape.prevented).toBe(true)
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    expect(view.active()).toBe(view.hosts.outside)
    view.hover(); view.dispatch('pointerdown', { target: view.hosts.outside }); view.advance(delay); view.render()
    expect(view.find('app-bc-popup').props.hidden).toBe(true)
    const closedEscape = view.key('Escape'); view.dispatch('keydown', closedEscape)
    expect(closedEscape.prevented).toBe(false)
    expect(view.timers.size).toBe(0)
  })
})

describe('战斗周期真实组件读数与局部布局', () => {
  it.each(['zh', 'en'] as const)('%s武器与装置读秒在各自进度条内，状态切换不增加尾列或改变计数占位', locale => {
    const view = harness(locale)
    for (const state of ['reload', 'ready', 'no-ammo', 'down']) {
      const content = view.render({ weapons: [weapon({ state })], devices: [device({ state: state === 'reload' ? 'cooldown' : state === 'no-ammo' ? 'no-stock' : state })] })
      for (const row of content.filter(n => n.props['data-cycle-id'])) {
        const track = nodes(row).find(n => String(n.props.className).split(' ').includes('app-bts-reload-track'))!
        const timer = nodes(track).filter(n => n.props.className === 'app-bts-reload-ms')
        expect(timer).toHaveLength(1)
        expect(nodes(row).filter(n => n.props.className === 'app-bts-reload-ms')).toEqual(timer)
        expect(row.children.some(child => child && typeof child === 'object' && (child as VNode).props?.className === 'app-bts-reload-ms')).toBe(false)
        expect(row.children.filter(child => child && typeof child === 'object' && (child as VNode).props?.className === 'app-bc-count')).toHaveLength(1)
        expect(text(timer)).toBe(state === 'reload' ? row.props['data-device-kind'] ? '3.0s' : '1.2s' : view.tr(`ui.battleCycles.${state === 'ready' ? '006' : state === 'down' ? '010' : row.props['data-device-kind'] ? '014' : '008'}`))
      }
    }
    expect(css).toMatch(/\.app-battle-cycles\[data-battle-cycles\] \.app-bts-reload-ms\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*justify-content:\s*center;/)
    expect(css).toMatch(/\.app-battle-cycles\[data-battle-cycles\] \.app-bts-reload-track\s*\{[^}]*position:\s*relative;[^}]*height:\s*18px;/)
  })

  it.each(['zh', 'en'] as const)('%s按tag分舰，重复武器不丢行；实际周期和机群损失可见', locale => {
    const view = harness(locale)
    const content = view.render({ weapons: [weapon(), weapon({ id: 'me:gun:1' }),
      weapon({ id: 'drone', src: 'drone', count: 4, aliveCount: 2 }),
      weapon({ id: 'other', ownerTag: 'escort', shipId: 's2', ownerName: 'Leader', state: 'no-ammo', remainingMs: 0, percent: 100 })], devices: [] })
    expect(content.filter(n => n.props['data-weapon-owner']).map(n => n.props['data-weapon-owner'])).toEqual(['me', 'escort'])
    expect(content.filter(n => n.props['data-cycle-id'])).toHaveLength(4)
    expect(text(content)).toContain(view.tr('ui.battleCycles.019', { p1: 2, p2: 4 }))
    expect(content.filter(n => n.props['data-cycle-id']).some(row => text(row).includes('1.2s'))).toBe(true)
    const blocked = content.find(n => n.props['data-cycle-id'] === 'other')!
    expect(text(blocked)).toContain(view.tr('ui.battleCycles.008'))
    expect(nodes(blocked).find(n => n.props.role === 'progressbar')).toBeUndefined()
    expect(view.render({ weapons: [], devices: [] }).some(n => text(n) === view.tr('ui.battleCycles.020'))).toBe(true)
  })

  it.each(['zh', 'en'] as const)('%s全部武器和装置状态明确，受阻和一次性状态不伪造就绪或倒计时', locale => {
    const view = harness(locale)
    const weaponStates = ['ready', 'reload', 'no-ammo', 'lost', 'down']
    const deviceStates = ['ready', 'active', 'cooldown', 'waiting', 'no-stock', 'stopped', 'down', 'used']
    const content = view.render({ weapons: weaponStates.map(state => weapon({ id: `w:${state}`, state, percent: 100, remainingMs: 0 })),
      devices: deviceStates.map(state => device({ id: `d:${state}`, state, percent: 100, remainingMs: 9000 })) })
    for (const row of content.filter(n => n.props['data-cycle-id'])) {
      const state = row.props['data-cycle-state']
      const progress = nodes(row).find(n => n.props.role === 'progressbar')
      if (progress) {
        expect(progress.props['aria-valuetext']).not.toMatch(/ui\./)
      }
      const timed = ['ready', 'reload', 'active', 'cooldown'].includes(state)
      if (progress) expect(progress.props['aria-valuenow']).toBe(timed ? 100 : 0)
      if (!timed) expect(text(row)).not.toContain('9.0s')
    }
    expect(text(content)).not.toMatch(/\{p\d+\}|ui\.battleCycles\./)
  })

  it('直接夹紧输入percent，不用remaining反推；非有限读数不泄露NaN，目标tag和零减速仍显示', () => {
    const view = harness()
    const content = view.render({ weapons: [weapon({ id: 'negative', percent: -10 }), weapon({ id: 'over', percent: 120 }),
      weapon({ id: 'bad', percent: NaN, cycleMs: Infinity, remainingMs: NaN }), weapon({ id: 'zero', remainingMs: 0, percent: 37 })],
      devices: [device({ targetName: undefined, targetTag: 'foe:real', effectPct: 0, count: 3 })] })
    const rows = content.filter(n => n.props['data-cycle-id'])
    expect(rows.slice(0, 4).map(row => nodes(row).find(n => n.props.role === 'progressbar')?.props['aria-valuenow'] ?? null)).toEqual([0, 100, null, 37])
    expect(text(content)).not.toMatch(/NaN|Infinity/)
    expect(rows[3]!.props['data-cycle-state']).toBe('reload')
    const deviceRow = content.find(n => n.props['data-battle-device-cycle'] === 'escort:web:0')!
    expect(deviceRow.props.title).toContain(view.tr('ui.battleCycles.017', { p1: 'foe:real' }))
    expect(deviceRow.props.title).toContain(view.tr('ui.battleCycles.018', { p1: 0 }))
    expect(text(content)).toContain('Snare Net×3')
    expect(content.find(n => n.props['data-target-tag'] === 'foe:real')).toBeDefined()
  })

  it.each(['zh', 'en'] as const)('%s基础舰炮走id；仅网显示减速，持续生效无到期不造倒计时；native选择器稳定', locale => {
    const view = harness(locale)
    const content = view.render({ weapons: [weapon({ src: 'base', label: '基础舰炮' })],
      devices: [device({ remainingMs: 0 }), device({ id: 'shield', kind: 'shield-charge', label: 'Shield Charger', effectPct: 20, targetName: undefined, targetTag: undefined }),
        device({ id: 'field', kind: 'shield-field', label: 'Shield Field', effectPct: 10, remainingMs: 1000, targetName: undefined, targetTag: undefined })] })
    const gun = content.find(n => n.props['data-battle-weapon-cycle'] === 'me:gun:0')!
    expect(text(gun)).toContain(view.tr('ui.battleCycles.023'))
    expect(view.find('app-bc-trigger').props['data-battle-weapons-trigger']).toBe(true)
    expect(view.find('app-bc-popup').props['data-battle-weapons-popup']).toBe(true)
    const web = content.find(n => n.props['data-battle-device-cycle'] === 'escort:web:0')!
    expect(web.props.title).toContain(view.tr('ui.battleCycles.018', { p1: 50 }))
    expect(text(web)).not.toContain('0.0s')
    expect(web.props['data-target-tag']).toBe('foe:2')
    expect(web.props['data-owner-tag']).toBe('escort')
    const shield = content.find(n => n.props['data-battle-device-cycle'] === 'shield')!
    const field = content.find(n => n.props['data-battle-device-cycle'] === 'field')!
    expect(text(shield)).not.toContain(view.tr('ui.battleCycles.018', { p1: 20 }))
    expect(text(field)).not.toContain(view.tr('ui.battleCycles.018', { p1: 10 }))
    expect(text(field)).toContain('1.0s')
  })

  it('四舰多装置自动换行并有竖向预算，目标改变不增减占位；短高与旋转读取逻辑尺寸', () => {
    const view = harness()
    const devices = Array.from({ length: 48 }, (_, i) => device({ id: `d${i}`, ownerTag: `u${i % 4}`, targetName: undefined, targetTag: undefined, effectPct: undefined }))
    const content = view.render({ weapons: [weapon()], devices })
    expect(content.filter(n => n.props['data-device-owner'])).toHaveLength(0)
    expect(content.filter(n => n.props['data-device-kind'])).toHaveLength(48)
    expect(view.hosts.root.style.getPropertyValue('--bc-popup-height')).toBe('300px')
    view.hosts.screen.clientHeight = 320; view.hosts.controls.offsetTop = 270
    view.observers[0].callback()
    expect(view.hosts.root.style.getPropertyValue('--bc-popup-height')).toBe('142px')
    view.hosts.trigger.offsetHeight = 44; view.observers[0].callback()
    expect(view.hosts.root.style.getPropertyValue('--bc-popup-height')).toBe('134px')
    expect(css).toContain('overflow: auto')
    expect(css).toMatch(/\.app-battle-screen \.app-bts-topdock\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*10;/)
    expect(css).toMatch(/\.app-battle-screen \.app-bts-topdock \.app-bts-legends\s*\{[^}]*height:\s*32px;[^}]*overflow-x:\s*auto;/)
    expect(css).toContain('touch-action: none')
    expect(css).toMatch(/\.app-battle-cycles\[data-battle-cycles\] \.app-bc-device-scroll\.app-bts-reloads\s*\{[^}]*flex-wrap:\s*wrap;[^}]*height:\s*auto;[^}]*max-height:\s*110px;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/)
    expect(css).toMatch(/\.app-battle-cycles\[data-battle-cycles\]\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*32px;/)
    expect(source).toContain('touch.inverse.b * (point.clientX - touch.x) + touch.inverse.d * (point.clientY - touch.y)')
    const down = view.key('ArrowDown')
    view.find('app-bc-device-scroll').props.onKeyDown({ ...down, currentTarget: view.hosts.scroll })
    expect(view.hosts.scroll.scrollTop).toBe(32)
    expect(view.hosts.scroll.scrollLeft).toBe(0)
    expect(css).toContain('.app-battle-cycles[data-battle-cycles] .app-btn.app-bc-trigger')
    expect(css).toContain('.app-root.is-mobile-rot .app-battle-cycles[data-battle-cycles]')
    expect(css).not.toMatch(/\d(?:vw|vh)\b|letter-spacing:\s*-/)
    expect(source).not.toMatch(/innerWidth|innerHeight|getBoundingClientRect|setInterval|aria-modal/)
    expect(source).toContain('app-bts-reload')
  })
})
