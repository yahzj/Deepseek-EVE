import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/classicNavTouch.ts', import.meta.url), 'utf8')
function harness(rotation = false, scale = 1) {
  const listeners = new Map<string, (e: any) => void>()
  const capture = new Set<number>()
  const style = rotation ? 'rotate' : 'plain'
  const root = {}
  const host = { getComputedStyle: () => ({ transform: style }), setTimeout: () => 1, clearTimeout: vi.fn(),
    addEventListener: (n: string, fn: (e: any) => void) => listeners.set(n, fn),
    removeEventListener: (n: string) => listeners.delete(n) }
  const scroll = { ownerDocument: { defaultView: host }, scrollHeight: 1000, clientHeight: 200, scrollTop: 50,
    classList: { add: vi.fn(), remove: vi.fn() }, contains: (target: unknown) => target === scroll,
    closest: () => root, setPointerCapture: vi.fn((id: number) => capture.add(id)),
    hasPointerCapture: (id: number) => capture.has(id), releasePointerCapture: vi.fn((id: number) => capture.delete(id)),
    addEventListener: host.addEventListener, removeEventListener: host.removeEventListener }
  class Matrix {
    a = rotation ? 0 : scale
    b = rotation ? -scale : 0
    inverse() { return { b: rotation ? 1 / scale : 0, d: rotation ? 0 : 1 / scale } }
  }
  const scope = { DOMMatrix: Matrix, exports: {} }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
  const cleanup = (scope.exports as any).bindClassicNavTouchScroll(scroll)
  const fire = (name: string, props: object = {}) => {
    const e = { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100, target: scroll,
      cancelable: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...props }
    listeners.get(name)?.(e)
    return e
  }
  return { scroll, fire, cleanup, listeners, capture }
}

describe('旧版单指导航拖动真逻辑', () => {
  it.each([false,true])('旋转%s 位移按实际缩放换算，拖后点击拦截，下一次轻点恢复', (rot) => {
    const h = harness(rot, 0.5)
    h.fire('pointerdown')
    const move = h.fire('pointermove', rot ? { clientX: 80 } : { clientY: 80 })
    expect(h.scroll.scrollTop).toBe(90)
    expect(move.preventDefault).toHaveBeenCalledOnce()
    expect(h.capture.has(1)).toBe(true)
    h.fire('pointerup')
    expect(h.capture.size).toBe(0)
    expect(h.fire('click').preventDefault).toHaveBeenCalledOnce()
    h.fire('pointerdown'); h.fire('pointerup')
    expect(h.fire('click').preventDefault).not.toHaveBeenCalled()
  })
  it('8物理像素以下不捕获不滚动，不会误吞轻点', () => {
    const h = harness(false, 0.5)
    h.fire('pointerdown')
    h.fire('pointermove', { clientY: 93 })
    expect(h.scroll.scrollTop).toBe(50)
    expect(h.capture.size).toBe(0)
    h.fire('pointerup')
    expect(h.fire('click').preventDefault).not.toHaveBeenCalled()
  })
  it('横向偏移和鼠标不接管；满容器不启用拖动', () => {
    const h = harness()
    h.fire('pointerdown', { pointerType: 'mouse' })
    h.fire('pointermove', { pointerType: 'mouse', clientY: 30 })
    expect(h.scroll.scrollTop).toBe(50)
    h.fire('pointerdown')
    h.fire('pointermove', { clientX: 20 })
    expect(h.scroll.scrollTop).toBe(50)
    h.fire('pointerup')
    h.scroll.scrollHeight = 200
    h.fire('pointerdown'); h.fire('pointermove', { clientY: 20 })
    expect(h.capture.size).toBe(0)
  })
  it('上下边界封顶、取消/卸载清理捕获与监听', () => {
    const h = harness()
    h.fire('pointerdown'); h.fire('pointermove', { clientY: -1000 })
    expect(h.scroll.scrollTop).toBe(800)
    h.fire('pointercancel'); expect(h.capture.size).toBe(0)
    h.fire('pointerdown'); h.fire('pointermove', { clientY: 1100 })
    expect(h.scroll.scrollTop).toBe(0)
    h.cleanup()
    expect(h.capture.size).toBe(0)
    expect(h.listeners.size).toBe(0)
    expect(h.scroll.classList.remove).toHaveBeenCalledWith('is-touch-scroll')
  })
  it('第二指即使在列表外也终止拖动，全部抬手后才允许下一次拖', () => {
    const h = harness()
    h.fire('pointerdown'); h.fire('pointermove', { clientY: 80 })
    h.fire('pointerdown', { pointerId: 2, target: {} })
    expect(h.capture.size).toBe(0)
    h.fire('pointermove', { clientY: 20 })
    expect(h.scroll.scrollTop).toBe(70)
    h.fire('pointerup'); h.fire('pointerup', { pointerId: 2 })
    h.fire('pointerdown'); h.fire('pointermove', { clientY: 80 })
    expect(h.scroll.scrollTop).toBe(90)
  })
  it('外壳仅在旧版手机绑定，底部工具区不在拖动区域', () => {
    const shell = readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/AppShell.tsx', import.meta.url), 'utf8')
    expect(shell).toContain("layoutKind === 'classic' && mobileLog !== null")
    expect(shell).toContain('bindClassicNavTouchScroll(scroll)')
  })
})
