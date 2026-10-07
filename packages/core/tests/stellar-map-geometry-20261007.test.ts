import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Fragment } from 'react'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import {
  beginStellarGesture, clampStellarView, inverseMapMatrix, locateStellarView, mapPointThrough,
  moveStellarGesture, nextStellarBodyId, reframeMapInverse, stellarBodyAt, stellarHitRadius, stellarOrdinalLabels, stellarViewBox, zoomStellarView,
  type MapMatrix, type MapPoint, type StellarMapView,
} from '../../../apps/desktop/src/renderer/src/panels/stellarMapView'

const identity: MapMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const fit: StellarMapView = { zoom: 1, pan: { x: 0, y: 0 } }
const normalized = (view: StellarMapView, point: MapPoint): MapPoint => {
  const box = stellarViewBox(view)
  return { x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height }
}

describe('星系视口与缩放锚点', () => {
  it('初始适应固定世界坐标，缩放不改变天体', () => {
    expect(stellarViewBox(fit)).toEqual({ x: 0, y: 0, width: 1000, height: 700 })
    const body = { x: 670, y: 240 }, before = { ...body }
    zoomStellarView(fit, 4, body)
    expect(body).toEqual(before)
  })
  it.each([{ x: 500, y: 350 }, { x: 740, y: 230 }, { x: 50, y: 60 }, { x: 950, y: 640 }])(
    '缩放保持锚点相对位置 %j', anchor => {
      const before = normalized(fit, anchor)
      const after = normalized(zoomStellarView(fit, 2, anchor), anchor)
      expect(after.x).toBeCloseTo(before.x)
      expect(after.y).toBeCloseTo(before.y)
    })
  it('平移后的反向缩放仍围绕同一锚点', () => {
    const view = { zoom: 3, pan: { x: 80, y: -60 } }, anchor = { x: 560, y: 270 }
    const before = normalized(view, anchor)
    const after = normalized(zoomStellarView(view, 2, anchor), anchor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
  it('缩放限制、异常值及适应恢复都有有限坐标', () => {
    expect(clampStellarView({ zoom: 0.1, pan: { x: 999, y: -999 } })).toEqual(fit)
    expect(clampStellarView({ zoom: 20, pan: { x: Infinity, y: NaN } })).toEqual({ zoom: 4, pan: { x: 0, y: 0 } })
    expect(clampStellarView({ zoom: NaN, pan: { x: 40, y: 30 } })).toEqual(fit)
  })
  it.each([{ x: 50, y: 60 }, { x: 950, y: 640 }])('余量允许边缘天体定位到中央 %j', point => {
    const after = locateStellarView({ zoom: 4, pan: { x: 0, y: 0 } }, point)
    expect(normalized(after, point)).toEqual({ x: 0.5, y: 0.5 })
    expect(zoomStellarView(after, 1, point)).toEqual(fit)
  })
  it('无限拖动不能永久丢失世界', () => {
    const view = clampStellarView({ zoom: 4, pan: { x: 1e10, y: -1e10 } })
    const box = stellarViewBox(view)
    expect(box.x).toBeLessThan(1000)
    expect(box.x + box.width).toBeGreaterThan(0)
    expect(box.y).toBeLessThan(700)
    expect(box.y + box.height).toBeGreaterThan(0)
    expect(clampStellarView({ ...view, zoom: 1 })).toEqual(fit)
  })
})

describe('逆矩阵、拖动及双指交互', () => {
  it('矩阵往返覆盖旋转、缩放和屏幕平移', () => {
    const matrix = { a: 0, b: -0.7, c: 0.7, d: 0, e: 30, f: 840 }
    const point = { x: 230, y: 120 }
    const restored = mapPointThrough(mapPointThrough(point, matrix), inverseMapMatrix(matrix)!)
    expect(restored.x).toBeCloseTo(point.x)
    expect(restored.y).toBeCloseTo(point.y)
    expect(inverseMapMatrix({ ...identity, a: 0 })).toBeNull()
  })
  it('6px 前保持单击，越界才平移，阈值按屏幕像素', () => {
    const view = { zoom: 2, pan: { x: 0, y: 0 } }
    const gesture = beginStellarGesture([{ id: 1, x: 100, y: 100 }], view, { ...identity, a: 10, d: 10 })
    expect(moveStellarGesture(gesture, [{ id: 1, x: 103, y: 104 }])).toEqual({ view, moved: false })
    expect(moveStellarGesture(gesture, [{ id: 1, x: 106, y: 100 }])).toEqual({
      moved: true, view: { zoom: 2, pan: { x: -60, y: 0 } },
    })
  })
  it('手机旋转后屏幕横向拖动进入逻辑纵轴', () => {
    const gesture = beginStellarGesture([{ id: 1, x: 100, y: 100 }], { zoom: 2, pan: { x: 0, y: 0 } },
      { a: 0, b: 2, c: -2, d: 0, e: 200, f: -200 })
    expect(moveStellarGesture(gesture, [{ id: 1, x: 120, y: 100 }]).view.pan).toEqual({ x: 0, y: -40 })
  })
  it('双指扩张围绕中点，移动中点同时平移', () => {
    const view = { zoom: 2, pan: { x: 0, y: 0 } }
    const gesture = beginStellarGesture([{ id: 1, x: 400, y: 350 }, { id: 2, x: 600, y: 350 }], view, identity)
    expect(moveStellarGesture(gesture, [{ id: 1, x: 300, y: 350 }, { id: 2, x: 700, y: 350 }]).view)
      .toEqual({ zoom: 4, pan: { x: 0, y: 0 } })
    expect(moveStellarGesture(gesture, [{ id: 1, x: 340, y: 370 }, { id: 2, x: 740, y: 370 }]).view)
      .toEqual({ zoom: 4, pan: { x: -20, y: -10 } })
  })
  it('非中央中点固定锚定，并在触及上限后仍可平移', () => {
    const view = { zoom: 2, pan: { x: 0, y: 0 } }
    const gesture = beginStellarGesture([{ id: 1, x: 550, y: 300 }, { id: 2, x: 650, y: 300 }], view, identity)
    const after = moveStellarGesture(gesture, [{ id: 1, x: 450, y: 300 }, { id: 2, x: 750, y: 300 }]).view
    expect(normalized(after, { x: 600, y: 300 })).toEqual(normalized(view, { x: 600, y: 300 }))
    const moved = moveStellarGesture(gesture, [{ id: 1, x: 470, y: 300 }, { id: 2, x: 770, y: 300 }]).view
    expect(moved.pan.x).toBeCloseTo(after.pan.x - 10)
  })
  it('双指减少后重置单指起点，原位不跳变且保留拖后禁止误选', () => {
    const view = { zoom: 3, pan: { x: 45, y: -30 } }
    const gesture = beginStellarGesture([{ id: 2, x: 730, y: 410 }], view, { ...identity, a: 0.5, d: 0.5 }, true)
    expect(moveStellarGesture(gesture, [{ id: 2, x: 730, y: 410 }])).toEqual({ view, moved: true })
    expect(moveStellarGesture(gesture, [{ id: 2, x: 750, y: 410 }]).view.pan).toEqual({ x: 35, y: -30 })
  })
  it('指针同一事件内减指，用当前视口修正尚未提交的CTM', () => {
    const rendered = stellarViewBox(fit)
    const next = stellarViewBox({ zoom: 2, pan: { x: 100, y: -20 } })
    const inverse = reframeMapInverse(identity, rendered, next)
    expect(mapPointThrough({ x: 500, y: 350 }, inverse)).toEqual({ x: 600, y: 330 })
    const rebased = beginStellarGesture([{ id: 2, x: 500, y: 350 }], { zoom: 2, pan: { x: 100, y: -20 } }, inverse, true)
    expect(moveStellarGesture(rebased, [{ id: 2, x: 520, y: 350 }]).view.pan).toEqual({ x: 90, y: -20 })
  })
  it('重合双指没有除零或无穷缩放', () => {
    const gesture = beginStellarGesture([{ id: 1, x: 500, y: 350 }, { id: 2, x: 500, y: 350 }], fit, identity)
    expect(moveStellarGesture(gesture, [{ id: 1, x: 490, y: 350 }, { id: 2, x: 510, y: 350 }]).view).toEqual(fit)
  })
  it('命中区在屏幕与逻辑空间均至少40px，兼容旋转与非等比缩放', () => {
    expect(stellarHitRadius({ a: 0, b: 4, c: -4, d: 0, e: 0, f: 0 })).toBe(80)
    expect(stellarHitRadius({ ...identity, a: 0.5, d: 0.25 }, identity)).toBe(20)
    expect(stellarHitRadius({ ...identity, a: 3, d: 2 })).toBe(60)
  })
})

describe('编号键盘选择与标签避让', () => {
  it('重叠命中区按距离选择天体，绘制顺序不会覆盖相邻天体中心', () => {
    const bodies = [{ planetId: 'a', x: 500, y: 350 }, { planetId: 'b', x: 515, y: 350 }]
    expect(stellarBodyAt(bodies, { x: 500, y: 350 }, 50)).toBe('a')
    expect(stellarBodyAt(bodies, { x: 515, y: 350 }, 50)).toBe('b')
    expect(stellarBodyAt(bodies, { x: 600, y: 350 }, 50)).toBeUndefined()
  })
  it('高倍率下可见星球外缘仍可选择，不缩进40px命中区内', () => {
    expect(stellarBodyAt([{ planetId: 'gas', x: 500, y: 350, radius: 13 }], { x: 512, y: 350 }, 5)).toBe('gas')
  })
  it('按稳定编号循环选择，不排序或改写原始天体数组', () => {
    const bodies = [{ planetId: 'c', ordinal: 3 }, { planetId: 'a', ordinal: 1 }, { planetId: 'b', ordinal: 2 }]
    const before = structuredClone(bodies)
    expect(nextStellarBodyId(bodies, undefined, 1)).toBe('a')
    expect(nextStellarBodyId(bodies, undefined, -1)).toBe('c')
    expect(nextStellarBodyId(bodies, 'c', 1)).toBe('a')
    expect(nextStellarBodyId(bodies, 'a', -1)).toBe('c')
    expect(nextStellarBodyId([], 'a', 1)).toBeUndefined()
    expect(bodies).toEqual(before)
  })
  it('靠边标签换方向，拥挤标签隐藏，选中项优先', () => {
    const bodies = [{ planetId: 'a', ordinal: 1, x: 50, y: 690, radius: 10 },
      { planetId: 'b', ordinal: 2, x: 50, y: 655, radius: 10 }]
    const labels = stellarOrdinalLabels(bodies, stellarViewBox(fit), 1, 'a')
    expect(labels[0]!.planetId).toBe('a')
    expect(labels[0]!.y + labels[0]!.height).toBeLessThanOrEqual(700)
    for (const label of labels) {
      expect(label.x).toBeGreaterThanOrEqual(0)
      expect(label.y).toBeGreaterThanOrEqual(0)
      expect(label.x + label.width).toBeLessThanOrEqual(1000)
      expect(label.y + label.height).toBeLessThanOrEqual(700)
    }
  })
  it('标签不覆盖恒星或相邻天体', () => {
    const body = { planetId: 'a', ordinal: 1, x: 500, y: 300, radius: 10 }
    const labels = stellarOrdinalLabels([body], stellarViewBox(fit), 1, 'a', [{ x: 500, y: 340, radius: 22 }])
    expect(labels).toHaveLength(1)
    expect(labels[0]!.y + labels[0]!.height).toBeLessThan(body.y - body.radius)
  })
})

// 真组件的事件闭包在轻量 hook 宿主内执行；不读取存档，不模拟浏览器观感。
interface TestNode {
  type: string | ((props: TestProps) => TestNode)
  key: string | null
  props: TestProps
  ref?: { current: unknown }
}
type TestProps = Record<string, any>
interface HookSlot { value?: any; deps?: unknown[]; cleanup?: () => void }

function componentHarness() {
  let slots: HookSlot[] = [], index = 0, key: string | null = null
  let pending: (() => void)[] = []
  let props: TestProps, tree: TestNode
  let rendered = stellarViewBox(fit)
  const captures = new Set<number>()
  const listeners = new Map<string, (event: any) => void>()
  const effects: Array<() => void> = []
  const hooks = {
    useState(initial: any) {
      const at = index++
      if (!slots[at]) slots[at] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[at]!.value, (value: any) => pending.push(() => {
        slots[at]!.value = typeof value === 'function' ? value(slots[at]!.value) : value
      })]
    },
    useRef(initial: any) {
      const at = index++
      if (!slots[at]) slots[at] = { value: { current: initial } }
      return slots[at]!.value
    },
    useLayoutEffect(effect: () => (() => void) | void, deps?: unknown[]) {
      const at = index++, old = slots[at]
      const changed = !deps || !old?.deps || deps.some((dep, n) => !Object.is(dep, old.deps![n]))
      if (changed) effects.push(() => {
        old?.cleanup?.()
        slots[at] = { deps, cleanup: effect() ?? undefined }
      })
    },
  }
  const svg = {
    clientHeight: 700,
    getScreenCTM() { return { ...matrix(), inverse: () => inverseMapMatrix(matrix())! } },
    getCTM() { return matrix() },
    closest: () => null,
    focus: vi.fn(),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  }
  function matrix(): MapMatrix {
    const zoom = 1000 / rendered.width
    return { a: zoom, b: 0, c: 0, d: zoom, e: -rendered.x * zoom, f: -rendered.y * zoom }
  }
  const source = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src/renderer/src/panels/StellarMap.tsx', import.meta.url)), 'utf8')
  const output = { exports: {} as { StellarMap: (p: TestProps) => TestNode },
    require: (name: string) => {
      if (name === 'react') return hooks
      if (name === 'react/jsx-runtime') return { jsx, jsxs, Fragment }
      if (name === '../i18n/locale') return { tr: (id: string) => id }
      if (name === 'lucide-react') return { ZoomIn: 'zoom-in', ZoomOut: 'zoom-out' }
      if (name === '../ui/Glyphs') return { Glyph: 'glyph' }
      if (name === './stellarMapView') return { beginStellarGesture, clampStellarView, inverseMapMatrix, locateStellarView,
        mapInverseScale: (inv: MapMatrix) => stellarHitRadius(inv) / 20, mapPointThrough, moveStellarGesture, nextStellarBodyId,
        reframeMapInverse, stellarBodyAt, stellarHitRadius, stellarOrdinalLabels, stellarViewBox, zoomStellarView,
        STELLAR_MAP_CENTER: { x: 500, y: 350 }, STELLAR_ZOOM_MIN: 1, STELLAR_ZOOM_MAX: 4 }
      if (name.endsWith('.css')) return {}
      throw new Error(name)
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, removeEventListener() {} },
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText, output)

  function nodes(node: any): TestNode[] {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap(nodes)
    return [node, ...nodes(node.props?.children)]
  }
  function render(nextProps = props): void {
    props = nextProps
    const outer = output.exports.StellarMap(props)
    if (key !== outer.key) {
      slots.forEach(slot => slot.cleanup?.())
      slots = []; pending = []; key = outer.key
    }
    for (const update of pending.splice(0)) update()
    index = 0
    tree = (outer.type as (p: TestProps) => TestNode)(outer.props)
    const node = nodes(tree).find(n => n.type === 'svg')!
    node.ref!.current = svg
    const [x, y, width, height] = node.props.viewBox.split(' ').map(Number)
    rendered = { x, y, width, height }
    for (const effect of effects.splice(0)) effect()
  }
  function find(predicate: (node: TestNode) => boolean): TestNode { return nodes(tree).find(predicate)! }
  const svgNode = () => find(node => node.type === 'svg')
  function pointer(handler: string, id: number, x: number, y: number, body?: string): void {
    svgNode().props[handler]({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0,
      currentTarget: svg, target: { closest: () => body ? { getAttribute: () => body } : null },
      preventDefault: vi.fn() })
  }
  function clickBody(id: string): void {
    let stopped = false
    svgNode().props.onClickCapture({ preventDefault() {}, stopPropagation() { stopped = true } })
    if (!stopped) find(node => node.props['data-stellar-body'] === id).props.onClick()
  }
  return { render, pointer, clickBody, find, svgNode, captures, listeners,
    clickTool: (id: string) => find(node => node.type === 'button' && node.props['aria-label'] === id).props.onClick(),
    selected: () => nodes(tree).find(node => node.props['aria-pressed'])?.props['data-stellar-body'],
    viewBox: () => rendered,
    key: (key: string, body?: string) => svgNode().props.onKeyDown({ key, currentTarget: svg,
      target: { closest: () => body ? { getAttribute: () => body } : null }, preventDefault() {}, stopPropagation() {} }),
  }
}

const makeSystem = (id: string) => ({ id, kind: 'single', starClass: 'yellow', seed: 0,
  stars: [{ x: 500, y: 350, radius: 20 }], bodies: [
    { planetId: `${id}-a`, ordinal: 1, kind: 'rocky', orbit: 170, x: 670, y: 350 },
    { planetId: `${id}-b`, ordinal: 2, kind: 'gas', orbit: 240, x: 260, y: 350 },
  ] })

describe('真组件事件与会话记忆', () => {
  it('空父选中值恢复各星系独立视口及选中项，并通知父面板', () => {
    const host = componentHarness(), onSelect = vi.fn(), a = makeSystem('a'), b = makeSystem('b')
    host.render({ system: a, selectedId: '', onSelect })
    host.pointer('onPointerDown', 1, 670, 350, 'a-a')
    host.pointer('onPointerUp', 1, 670, 350, 'a-a')
    host.render()
    host.clickTool('ui.stellar.050'); host.render()
    const aBox = { ...host.viewBox() }
    expect(host.selected()).toBe('a-a')
    host.render({ system: b, selectedId: '', onSelect })
    expect(host.viewBox()).toEqual(stellarViewBox(fit))
    expect(host.selected()).toBeUndefined()
    host.key('ArrowRight'); host.render()
    expect(host.selected()).toBe('b-a')
    host.render({ system: a, selectedId: '', onSelect })
    expect(host.viewBox()).toEqual(aBox)
    expect(host.selected()).toBe('a-a')
    expect(onSelect).toHaveBeenLastCalledWith('a-a')
  })
  it('点击、父选中变更和数据刷新不自动平移或适应', () => {
    const host = componentHarness(), onSelect = vi.fn(), system = makeSystem('refresh')
    host.render({ system, onSelect })
    host.clickTool('ui.stellar.050'); host.render()
    const before = { ...host.viewBox() }
    host.clickBody('refresh-a'); host.render()
    expect(host.viewBox()).toEqual(before)
    host.render({ system: structuredClone(system), selectedId: 'refresh-b', onSelect })
    host.render()
    expect(host.selected()).toBe('refresh-b')
    expect(host.viewBox()).toEqual(before)
  })
  it('低于阈值的单击选择一次，超过阈值的拖动不误选', () => {
    const host = componentHarness(), onSelect = vi.fn()
    host.render({ system: makeSystem('drag'), onSelect })
    host.pointer('onPointerDown', 1, 670, 350, 'drag-a')
    expect(host.captures.has(1)).toBe(true)
    host.pointer('onPointerUp', 1, 673, 354, 'drag-a')
    host.clickBody('drag-a'); host.render()
    expect(onSelect).toHaveBeenCalledTimes(1)
    host.clickTool('ui.stellar.050'); host.render()
    host.pointer('onPointerDown', 2, 260, 350, 'drag-b')
    host.pointer('onPointerMove', 2, 310, 350, 'drag-b')
    host.pointer('onPointerUp', 2, 310, 350, 'drag-b')
    host.clickBody('drag-b'); host.render()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(host.selected()).toBe('drag-a')
    expect(host.captures.size).toBe(0)
  })
  it('双指快速抬起后单指不跳变，仍不产生选中', () => {
    const host = componentHarness(), onSelect = vi.fn()
    host.render({ system: makeSystem('pinch'), onSelect })
    host.pointer('onPointerDown', 1, 400, 350)
    host.pointer('onPointerDown', 2, 600, 350)
    host.pointer('onPointerMove', 1, 300, 350)
    host.pointer('onPointerUp', 1, 300, 350)
    host.pointer('onPointerMove', 2, 615, 350)
    host.render()
    expect(host.viewBox().width).toBeCloseTo(1000 / 1.5)
    expect(host.viewBox().x).toBeCloseTo(190)
    host.pointer('onPointerUp', 2, 615, 350)
    host.clickBody('pinch-a')
    expect(onSelect).not.toHaveBeenCalled()
    expect(host.captures.size).toBe(0)
  })
  it('取消手势和丢失捕获后不选中，下一次单击正常', () => {
    const host = componentHarness(), onSelect = vi.fn()
    host.render({ system: makeSystem('cancel'), onSelect })
    host.pointer('onPointerDown', 1, 670, 350, 'cancel-a')
    host.pointer('onLostPointerCapture', 1, 670, 350)
    host.clickBody('cancel-a')
    expect(onSelect).not.toHaveBeenCalled()
    host.pointer('onPointerDown', 2, 670, 350, 'cancel-a')
    host.pointer('onPointerUp', 2, 670, 350, 'cancel-a')
    expect(onSelect).toHaveBeenCalledOnce()
  })
  it('键盘编号选择、缩放、Home、天体Enter及滚轮入口可用', () => {
    const host = componentHarness(), onSelect = vi.fn()
    host.render({ system: makeSystem('keys'), onSelect })
    host.key('ArrowRight'); host.render()
    expect(host.selected()).toBe('keys-a')
    host.key('+'); host.render()
    expect(host.viewBox().width).toBe(800)
    host.key('ArrowDown'); host.render()
    expect(host.selected()).toBe('keys-b')
    host.key('Enter', 'keys-a'); host.render()
    expect(onSelect).toHaveBeenLastCalledWith('keys-a')
    const preventDefault = vi.fn()
    host.listeners.get('wheel')!({ deltaY: -120, deltaMode: 0, preventDefault })
    host.render()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(host.viewBox().width).toBeLessThan(800)
    host.key('Home'); host.render()
    expect(host.viewBox()).toEqual(stellarViewBox(fit))
    expect(host.selected()).toBe('keys-a')
  })
  it('漂流群没有伪恒星或轨道，气态行星有显式环，几何不读traits', () => {
    const host = componentHarness(), onSelect = vi.fn()
    const system = { ...makeSystem('rogue'), kind: 'rogue' }
    host.render({ system, onSelect })
    const stars = host.find(node => node.props.className?.startsWith('app-stellar-map-stars'))
    const orbits = host.find(node => node.props.className === 'app-stellar-map-orbits')
    expect(stars.props.children).toBe(false)
    expect(orbits.props.children).toBe(false)
    expect(host.find(node => node.props.className === 'app-stellar-map-gas-ring')).toBeDefined()
    const source = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src/renderer/src/panels/StellarMap.tsx', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/trait|habitability|resource|planetSurvey/)
  })
  it.each(['single', 'binary', 'white-dwarf', 'neutron', 'black-hole'])('星系图示支持 %s 且不改写恒星坐标', kind => {
    const host = componentHarness(), system = { ...makeSystem(kind), kind }
    if (kind === 'binary') system.stars = [{ x: 470, y: 350, radius: 18 }, { x: 530, y: 350, radius: 14 }]
    const before = structuredClone(system)
    host.render({ system, onSelect: vi.fn() })
    const stars = host.find(node => node.props.className?.startsWith('app-stellar-map-stars'))
    expect(stars.props.children).toHaveLength(kind === 'binary' ? 2 : 1)
    if (kind === 'black-hole') expect(host.find(node => node.props.className === 'app-stellar-map-horizon')).toBeDefined()
    if (kind === 'neutron') expect(host.find(node => node.props.className === 'app-stellar-map-beam')).toBeDefined()
    expect(system).toEqual(before)
  })
  it('布局只使用百分比和逻辑尺寸，视口内部裁切且保留触屏按钮尺寸', () => {
    const css = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src/renderer/src/styles-stellar-map.css', import.meta.url)), 'utf8')
    expect(css).not.toMatch(/\b\d+(?:\.\d+)?(?:vw|vh)\b/)
    expect(css).toContain('min-height: 280px')
    expect(css).toContain('touch-action: none')
    expect(css).toContain('width: 44px')
    expect(css).toContain('height: 44px')
  })
})
