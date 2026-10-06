import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

type Node = { type: string; props: Record<string, any>; children: unknown[] }
const nodes = (v: unknown): Node[] => Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' && 'children' in v
  ? [v as Node, ...(v as Node).children.flatMap(nodes)] : []
const jsx = { createElement: (type: string, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) }

describe('沉船真实卡牌组件', () => {
  it.each(['zh', 'en'] as const)('%s逐位含空格/重复插件、点击详情同富卡、取消不覆盖且再次确认保存', locale => {
    const ctx = buildSimContext(locale), state = core.createInitialState({ nowWallMs: 0, seed: 7 })
    const entry: core.WreckLogEntry = { seq: 1, shipId: 'lost', shipName: '测试', defId: 'sh-hammerhead', cause: 'wormhole-sunk', atGameMs: 0,
      fitted: { high: ['mod-turret-kin-1', null, 'mod-gone'], mid: [], low: [] }, plugs: ['plug-cpu-core', 'plug-cpu-core'], droneLoad: { 'drone-scout': 2 } }
    state.wreckLog = [entry]
    const source = ts.createSourceFile('WreckFitPanel.tsx', readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/panels/WreckFitPanel.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'WreckFitPanel')!
    const values: unknown[] = []; let cursor = 0
    const tr = (id: string, p?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (m, k: string) => String(p?.[k] ?? m))
    const content = (def: { id: string }) => jsx.createElement('InfoTable', { model: def.id })
    const scope = { ...core, React: jsx, tr, exports: {}, result: undefined,
      useState: (initial: unknown) => { const at = cursor++; if (!(at in values)) values[at] = initial; return [values[at], (value: unknown) => values[at] = value] },
      useEffect: () => {}, useRef: () => ({ current: null }), createPortal: (v: unknown) => v,
      document: { querySelector: () => ({}) }, cmdText: (r: core.CommandResult) => r.error ?? '',
      Glyph: 'Glyph', toneOf: () => 'currentColor', rackText: String, hoverTipProps: (tip: unknown) => ({ richTip: tip }),
      moduleHoverContent: content, itemHoverContent: content }
    runInNewContext(ts.transpileModule(fn.getText(source) + '\nglobalThis.result=WreckFitPanel', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
    const page = scope.result as unknown as (p: unknown) => Node
    const engine = { state, ctx, saveWreckFitPresetAt: (seq: number, name?: string, expected?: core.ShipFitPreset) => core.saveWreckFitPreset(state, ctx, seq, name, expected) }
    const render = () => { cursor = 0; return nodes(page({ engine, entry })) }
    const cards = () => render().filter(n => n.props['data-wreck-fit-id'])
    expect(cards().filter(n => n.props['data-wreck-fit-id'] === 'plug-cpu-core')).toHaveLength(2)
    expect(render().some(n => n.props.className === 'app-fit-slot-icon is-empty app-wreck-fit-card')).toBe(true)
    const gun = cards().find(n => n.props['data-wreck-fit-id'] === 'mod-turret-kin-1')!
    gun.props.onClick({ currentTarget: {} })
    expect(render().some(n => n.type === 'InfoTable' && n.props.model === 'mod-turret-kin-1')).toBe(true)
    render().find(n => n.type === 'button' && n.props['aria-label'] === tr('ui.FitPage.055'))!.props.onClick()
    const showSave = () => render().find(n => n.props['data-wreck-fit-save'] !== undefined)!.props.onClick({ currentTarget: {} })
    showSave()
    render().find(n => n.type === 'input')!.props.onChange({ target: { value: '重建' } })
    render().find(n => n.props['data-wreck-fit-confirm'] !== undefined)!.props.onClick()
    expect(state.fitPresets!['sh-hammerhead']![0]!.plugs).toEqual(entry.plugs)
    state.fitPresets!['sh-hammerhead']![0]!.fitted.high = ['mod-turret-kin-2']
    const old = structuredClone(state.fitPresets)
    showSave()
    render().find(n => n.props['data-wreck-fit-confirm'] !== undefined)!.props.onClick()
    expect(state.fitPresets).toEqual(old)
    render().find(n => n.type === 'button' && n.children.includes(tr('ui.blackMarket.011')))!.props.onClick()
    expect(state.fitPresets).toEqual(old)
    showSave()
    render().find(n => n.props['data-wreck-fit-confirm'] !== undefined)!.props.onClick()
    render().find(n => n.props['data-wreck-fit-confirm'] !== undefined)!.props.onClick()
    expect(state.fitPresets!['sh-hammerhead']![0]!.fitted.high).toEqual(entry.fitted!.high)
  })
})
