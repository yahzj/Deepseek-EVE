import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import * as core from '../src/index'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { injectStellarReadyTestState } from '../../../tools/stellar-search-fixture'
import { StellarPlanetArt, StellarPlanetPreview, STELLAR_KIND_IDS, STELLAR_PLANET_KIND_IDS } from './fixtures/stellar-art'

const root = new URL('../../../', import.meta.url)
type Node = { type: any; props: Record<string, any> }
const nodes = (value: any): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && value.props ? [value, ...nodes(value.props.children)] : []
function harness(locale: 'zh' | 'en' = 'zh', empty = false) {
  const ctx = buildSimContext(locale), state = core.createInitialState({ nowWallMs: 0, seed: 7 })
  if (!empty) injectStellarReadyTestState(state)
  const values: any[] = [], refs: any[] = []
  let cursor = 0, refCursor = 0
  const commands = vi.fn(() => ({ ok: true as const }))
  const onClose = vi.fn()
  const tr = (id: string) => L10N[id] ? l10nEntryText(L10N[id]!, locale) : id
  const scope = { exports: {} as { StellarExplorer: (props: any) => Node }, require: (id: string): any => {
    if (id === 'react') return { useState: (initial: any) => { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (value: any) => { values[i] = typeof value === 'function' ? value(values[i]) : value }] }, useRef: (initial: any) => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: initial }) }, useEffect: () => {} }
    if (id === 'react/jsx-runtime') return { jsx, jsxs, Fragment }
    if (id === '@whale/core') return { ...core, manufacturingRunViews: () => [] }
    if (id === 'lucide-react') return Object.fromEntries(['Copy', 'Crosshair', 'Play', 'Pause', 'Radar', 'Search', 'Trash2', 'X', 'Factory', 'Globe2'].map(name => [name, name]))
    if (id === '../i18n/locale') return { tr }
    if (id === '../i18n/fmt') return { fmtDuration: String, fmtInt: String }
    if (id === '../ui/planetText') return { pt: (key: string) => tr(core.PLANET_TEXT_IDS[key] ?? key) }
    if (id === '../ui/stellarArt') return { StellarPlanetArt, StellarPlanetPreview, STELLAR_KIND_IDS, STELLAR_PLANET_KIND_IDS }
    if (id === './StellarMap') return { StellarMap: 'stellar-map' }
    if (id === './PlanetaryPanel') return { PlanetaryPanel: 'planetary-panel' }
    if (id.endsWith('.css')) return {}
    throw new Error(id)
  }, navigator: { clipboard: { writeText: vi.fn() } } }
  const source = readFileSync(new URL('apps/desktop/src/renderer/src/panels/StellarExplorer.tsx', root), 'utf8')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
  let tree: Node
  const render = () => { cursor = 0; refCursor = 0; tree = scope.exports.StellarExplorer({ engine: { state, ctx }, catalog: ctx.planetary!, onCommand: commands, onClose }); return tree }
  render()
  const find = (predicate: (node: Node) => boolean) => nodes(tree).find(predicate)!
  const button = (id: string) => find(node => node.type === 'button' && node.props['aria-label'] === tr(id))
  return { state, ctx, render, find, button, commands, onClose, tr, all: () => nodes(tree) }
}

describe('星系星图探索指挥台', () => {
  it('确认期间背景点击不能关闭星图，撤销确认后恢复正常关闭', () => {
    const h = harness()
    const original = Object.values(h.state.planetary!.stellar!.systems).find(system => !core.stellarSystemDeveloped(h.state, system.id))!
    h.find(node => node.props['data-system-select'] !== undefined).props.onChange({ target: { value: original.id } }); h.render()
    h.button('ui.stellar.019').props.onClick(); h.render()
    const alert = h.find(node => node.props.role === 'alertdialog')
    expect(alert.props['aria-modal']).toBe('true')
    h.find(node => node.props.className === 'app-modal-mask app-stellar-mask').props.onClick()
    expect(h.onClose).not.toHaveBeenCalled()
    const buttons = nodes(alert).filter(node => node.type === 'button')
    expect(buttons[1]!.props.children).toBe(h.tr('ui.beacon.008'))
    buttons[1]!.props.onClick(); h.render()
    h.find(node => node.props.className === 'app-modal-mask app-stellar-mask').props.onClick()
    expect(h.onClose).toHaveBeenCalledOnce()
    expect(h.commands).not.toHaveBeenCalled()
  })
  it('星系/地表字号与确认/黑洞底色全部使用已定义主题变量', () => {
    const palette = readFileSync(new URL('packages/ui/src/index.css', root), 'utf8')
    const defined = new Set([...palette.matchAll(/^\s*(--wui[\w-]+)\s*:/gm)].map(match => match[1]))
    for (const name of ['styles-stellar-explorer.css', 'styles-stellar-map.css', 'styles-planetary.css']) {
      const css = readFileSync(new URL(`apps/desktop/src/renderer/src/${name}`, root), 'utf8')
      for (const match of css.matchAll(/var\((--wui[\w-]+)\)/g)) expect(defined.has(match[1]!), `${name}: ${match[1]}`).toBe(true)
    }
  })
  it('已开发标记只认已建成基地，不把准备殖民状态误报为开发完成', () => {
    const h = harness(), planet = h.state.planetary!.planets['system-v1-0-p2']!
    expect(core.stellarPlanetDeveloped(planet)).toBe(true)
    const prepared = { ...planet, cells: planet.cells.map(cell => ({ ...cell, building: undefined })) }
    expect(core.stellarPlanetDeveloped(prepared)).toBe(false)
    expect(core.stellarPlanetDeveloped(undefined)).toBe(false)
  })
  it.each(['zh', 'en'] as const)('%s任务、详情分区与原操作保留，新增词条待译回退', locale => {
    const h = harness(locale)
    for (const id of ['ui.stellarHud.001', 'ui.stellarHud.002', 'ui.stellarHud.003']) {
      expect(h.all().some(node => node.props['aria-label'] === h.tr(id) || node.props.children === h.tr(id) || (Array.isArray(node.props.children) && node.props.children.includes(h.tr(id))))).toBe(true)
      expect(L10N[id]!.enDeferred).toBe(true)
    }
    expect(h.find(node => node.props['data-search-launch'] !== undefined)).toBeDefined()
    expect(h.find(node => node.props['data-probe-manufacture'] !== undefined)).toBeDefined()
    const sidebar = h.find(node => node.type === 'aside')
    expect(nodes(sidebar).some(node => node.props['data-search-launch'] !== undefined)).toBe(false)
  })
  it('目标详探仅使用公开视图，地表返回不丢父选择', () => {
    const h = harness(), map = h.find(node => node.type === 'stellar-map')
    const body = map.props.system.bodies.find((entry: any) => entry.planetId === 'system-v1-0-p2')
    expect(body).toBeDefined()
    map.props.onSelect(body.planetId); h.render()
    const preview = h.find(node => node.type === StellarPlanetPreview)
    expect(preview.props).toEqual({ kind: body.kind })
    const open = h.find(node => node.props['data-open-surface'] !== undefined)
    expect(open.props.disabled).toBe(false)
    {
      open.props.onClick(); h.render()
      const panel = h.find(node => node.type === 'planetary-panel')
      expect(panel.props.initialPlanetId).toBe(body.planetId)
      panel.props.onClose(); h.render()
      expect(h.find(node => node.type === 'stellar-map').props.selectedId).toBe(body.planetId)
    }
  })
  it('放弃确认绑定原星系，切换后不会删除当前星系', () => {
    const h = harness(), select = h.find(node => node.props['data-system-select'] !== undefined)
    const systems = Object.values(h.state.planetary!.stellar!.systems)
    const original = systems.find(system => !core.stellarSystemDeveloped(h.state, system.id))!
    select.props.onChange({ target: { value: original.id } }); h.render()
    h.button('ui.stellar.019').props.onClick(); h.render()
    const next = systems.find(system => system.id !== original.id)!
    h.find(node => node.props['data-system-select'] !== undefined).props.onChange({ target: { value: next.id } }); h.render()
    const confirm = h.find(node => node.props.role === 'alertdialog')
    const yes = nodes(confirm).find(node => node.type === 'button')!
    expect(yes.props.disabled).toBe(false)
    yes.props.onClick()
    expect(h.commands).toHaveBeenLastCalledWith('discardSystem', [original.id])
  })
  it('过期任务确认不能取消新任务，暂停入口仍调用原命令', () => {
    const h = harness()
    h.state.planetary!.stellar!.search = { seq: 8, seed: 7, mode: 'specified', durationMs: 60000, progressMs: 10000, paused: false }
    h.render(); h.button('ui.stellar.010').props.onClick()
    expect(h.commands).toHaveBeenLastCalledWith('searchPause', [true])
    h.button('ui.stellar.012').props.onClick(); h.render()
    h.state.planetary!.stellar!.search!.seq = 9; h.render()
    const yes = nodes(h.find(node => node.props.role === 'alertdialog')).find(node => node.type === 'button')!
    expect(yes.props.disabled).toBe(true)
    h.commands.mockClear(); yes.props.onClick()
    expect(h.commands).not.toHaveBeenCalled()
  })
  it('空态保持主工作区，指定模式无效输入不能派出，气态不开放地表', () => {
    const h = harness('zh', true)
    expect(h.all().some(node => node.props.className === 'app-stellar-empty')).toBe(true)
    const mode = h.all().find(node => node.type === 'button' && node.props.children === h.tr('ui.stellar.007'))!
    mode.props.onClick(); h.render()
    expect(h.find(node => node.props['data-search-launch'] !== undefined).props.disabled).toBe(true)
    const ready = harness()
    const system = Object.values(ready.state.planetary!.stellar!.systems).find(system => system.bodies.some(body => body.kind === 'gas'))!
    expect(system).toBeDefined()
    ready.find(node => node.props['data-system-select'] !== undefined).props.onChange({ target: { value: system.id } }); ready.render()
    const map = ready.find(node => node.type === 'stellar-map'), gas = system.bodies.find(body => body.kind === 'gas')!
    map.props.onSelect(gas.planetId); ready.render()
    expect(ready.find(node => node.props['data-open-surface'] !== undefined).props.disabled).toBe(true)
  })
  it('七类外形各自独立，图案不读取隐藏条件；固定任务区不覆盖地图', () => {
    const arts = Object.keys(STELLAR_PLANET_KIND_IDS).map(kind => JSON.stringify(StellarPlanetArt({ kind: kind as keyof typeof STELLAR_PLANET_KIND_IDS })))
    expect(new Set(arts).size).toBe(7)
    const source = readFileSync(new URL('apps/desktop/src/renderer/src/ui/stellarArt.tsx', root), 'utf8')
    expect(source).not.toMatch(/\.trait|\.deposit|\.resource|\.hazard|\.habitability/)
    const css = readFileSync(new URL('apps/desktop/src/renderer/src/styles-stellar-explorer.css', root), 'utf8')
    expect(css).not.toMatch(/\b\d+(?:\.\d+)?(?:vw|vh)\b/)
    expect(css).toContain('height: 172px')
    expect(css).toContain('min-height: 180px')
    expect(css).not.toMatch(/app-stellar-taskdock[^}]*position:\s*(fixed|absolute)/)
  })
})
