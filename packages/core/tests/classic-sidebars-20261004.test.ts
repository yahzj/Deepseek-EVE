import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSaveModule } from './helpers/save-shell'

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
