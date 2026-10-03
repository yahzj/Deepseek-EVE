/** 执行生产旋转层 update；模拟视口事件，不改浏览器/个人文件。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers/save-shell'

function viewport() {
  const source = ts.createSourceFile('App.tsx', readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let update: ts.ArrowFunction | undefined
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'update' && node.initializer && ts.isArrowFunction(node.initializer)
      && node.initializer.getText(source).includes('mobSizeRef')) update = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!update) throw new Error('生产手机视口入口不存在')
  const values = new Map<string, string>()
  const window = { innerWidth: 390, innerHeight: 844, visualViewport: { width: 390, height: 844, scale: 1, offsetTop: 0, offsetLeft: 0 },
    screen: { orientation: { type: 'portrait-primary' } },
    matchMedia: () => ({ matches: true }), setTimeout: () => 1, clearTimeout: () => {} }
  let rotated = false
  const size = { current: null as { w: number; h: number } | null }
  const bindings = { window, Date, screen: { orientation: { type: 'portrait-primary' } },
    setMobileRot: (next: boolean) => { rotated = next }, rootRef: { current: { style: {
      setProperty: (key: string, value: string) => { values.set(key, value) }, removeProperty: (key: string) => { values.delete(key) },
    } } }, mobSizeRef: size, mobPendRef: { current: null }, mobTimerRef: { current: 0 },
    MOB_BIG_CHANGE_PX: 96, MOB_SIZE_DEAD_PX: 8, MOB_RESIZE_SETTLE_MS: 300, result: undefined }
  const js = ts.transpileModule(`const update = ${update.getText(source)}; globalThis.result = update`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(js, bindings)
  const run = bindings.result as unknown as () => void
  return { window, size, run, values, rotated: () => rotated }
}

describe('手机旋转视口稳定性', () => {
  it('捏合改变视觉宽高时尺寸必须冻结，不重复缩小整个布局', () => {
    const p = viewport()
    p.run()
    const scale = p.values.get('--mob-scale')
    const height = p.values.get('--mob-h')
    p.window.visualViewport = { width: 260, height: 562, scale: 1.5, offsetTop: 0, offsetLeft: 0 }
    p.run()
    expect(p.values.get('--mob-scale')).toBe(scale)
    expect(p.values.get('--mob-h')).toBe(height)
  })
  it('键盘导致 innerHeight 小于宽度，但物理仍竖屏时不能退出旋转', () => {
    const p = viewport()
    p.run()
    p.window.innerHeight = 300
    p.window.visualViewport.height = 300
    p.run()
    expect(p.rotated()).toBe(true)
  })
  it('可见尺寸不变的重复事件不改变缩放', () => {
    const p = viewport()
    p.run()
    const before = [...p.values]
    for (let i = 0; i < 20; i++) p.run()
    expect([...p.values]).toEqual(before)
  })
})
