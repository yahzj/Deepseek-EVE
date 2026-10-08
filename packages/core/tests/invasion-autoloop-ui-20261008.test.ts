import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { activityOverview, type ActivityView } from '../src/activity'
import { autoLoopInvasionPlanOf, setAutoLoopInvasion, bountyCooldownMsFor } from '../src/expedition'
import { ROOT } from './helpers/save-shell'

type Node = { type: unknown; props: Record<string, any>; children: unknown[] }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'children' in value ? [value as Node, ...(value as Node).children.flatMap(nodes)] : []
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join('')
  : value && typeof value === 'object' && 'children' in value ? (value as Node).children.map(text).join('')
  : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const sourceOf = (path: string) => ts.createSourceFile(path, readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src', path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** 编译真实活动行和动作，替换React外壳，不复制进度或按钮实现。 */
function rowRenderer(layout: string, locale: 'zh' | 'en') {
  const src = sourceOf(`panels/${layout}.tsx`)
  const component = src.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === layout) as ts.FunctionDeclaration
  const row = component.body!.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(src) === 'renderItem')!
  const stop = src.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'doStop')!
  const icons = src.statements.filter(ts.isVariableStatement).find(node => node.declarationList.declarations.some(node => node.name.getText(src) === 'KIND_ICON'))!
  const labels = sourceOf('panels/activityStopLabel.ts')
  const labelFn = labels.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'stopLabel')!
  const routes = sourceOf('ui/activityGo.ts')
  const routeFn = routes.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'goFor')!
  const tr = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match))
  const engine = { invasionLoopAt: vi.fn(() => ({ ok: true })), bountyLoopAt: vi.fn(() => ({ ok: true })) }
  const onGoPage = vi.fn(), onToast = vi.fn()
  const scope = { result: undefined, React: { createElement: (type: unknown, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    tr, cmdText: () => '', engine, onToast, onGoPage, onOpenWormhole: undefined,
    Glyph: 'Glyph', NAV_TONES: {}, ICO_TONES: {}, fmtDuration: (ms: number) => `${Math.ceil(ms / 1000)}s`,
    haulAsk: false, retreatAsk: false, setHaulAsk: () => {}, setRetreatAsk: () => {} }
  const code = [icons.getText(src), stop.getText(src), labelFn.getText(labels).replace(/^export\s+/, ''), routeFn.getText(routes).replace(/^export\s+/, ''), `const ${row.getText(src)};`, 'globalThis.result=renderItem'].join('\n')
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  const localize = (view: ActivityView): ActivityView => ({ ...view, label: view.labelId ? tr(view.labelId, view.labelParams) : view.label,
    sub: view.subId ? tr(view.subId, { ...view.subParams, ...(view.subParams?.p2Id ? { p2: tr(String(view.subParams.p2Id)) } : {}) }) : view.sub })
  return { render: (v: ActivityView) => (scope.result as unknown as (v: ActivityView) => unknown)(localize(v)), engine, onGoPage, onToast }
}

describe.each(['ActivityBar', 'ActivityBarClassic'])('%s入侵循环活动行', layout => {
  it.each(['zh', 'en'] as const)('%s显示真实百分比和剩余秒，停止只关入侵，点击跳星图', locale => {
    const ctx = buildSimContext(locale), now = Date.now()
    const state = createInitialState({ nowWallMs: now, seed: 7 })
    state.weekendEvent = { seq: 1, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: {} }
    setAutoLoopInvasion(state, ctx, 'galaxy-redring', now)
    const plan = autoLoopInvasionPlanOf(state, ctx, now)
    if (plan.status !== 'ready') throw new Error('未生成循环计划')
    const cd = bountyCooldownMsFor(state, ctx)
    state.bountyCooldowns[plan.dispatch.cardId] = state.gameMs + cd / 2
    const view = activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!
    const component = rowRenderer(layout, locale)
    const rendered = component.render(view), list = nodes(rendered)
    expect(list.find(node => node.props.className === 'app-activitybar-fill')!.props.style.width).toBe('50%')
    expect(text(rendered)).toContain('50%')
    expect(text(rendered)).toContain(`${Math.ceil(cd / 2 / 1000)}s`)
    expect(text(rendered)).toContain(ctx.galaxies.get('galaxy-redring')!.name)
    expect(text(rendered)).not.toMatch(/\{p\d+\}|ui\.invasionLoop/)
    if (locale === 'en') {
      expect(text(rendered)).toContain('Invasion repeat assault')
      expect(text(rendered)).not.toMatch(/[\u4e00-\u9fff]/)
    }
    list[0]!.props.onClick()
    expect(component.onGoPage).toHaveBeenCalledWith('map', 'star', undefined)
    const click = { stopPropagation: vi.fn() }
    list.find(node => node.type === 'button')!.props.onClick(click)
    expect(click.stopPropagation).toHaveBeenCalledOnce()
    expect(component.engine.invasionLoopAt).toHaveBeenCalledWith(null)
    expect(component.engine.bountyLoopAt).not.toHaveBeenCalled()
    expect(component.onToast).toHaveBeenCalledOnce()
    const waiting = { ...view, percent: null, remainingMs: null }
    expect(nodes(component.render(waiting)).some(node => node.props.className === 'app-activitybar-fill')).toBe(false)
  })
})
