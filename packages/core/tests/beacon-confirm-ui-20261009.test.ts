import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { L10N } from '@whale/data'
import { ROOT } from './helpers/save-shell'

type UiNode = { type: unknown; props: Record<string, any>; children: unknown[] }
const nodes = (value: unknown): UiNode[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'children' in value ? [value as UiNode, ...(value as UiNode).children.flatMap(nodes)] : []
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join('')
  : value && typeof value === 'object' && 'children' in value ? (value as UiNode).children.map(text).join('')
  : typeof value === 'string' || typeof value === 'number' ? String(value) : ''

function sourceOf(path: string) {
  return ts.createSourceFile(path, readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src', path), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function render(code: string, locale: 'zh' | 'en', callbacks: Record<string, unknown>) {
  const scope = {
    exports: {}, result: undefined,
    React: { createElement: (type: unknown, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }), Fragment: 'Fragment' },
    tr: (id: string, params?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
    ...callbacks,
  }
  runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope)
  return scope.result
}

describe('信号发射器真实确认态', () => {
  it.each(['zh', 'en'] as const)('%s普通确认的取消按钮不串用投送说明，取消不点火', locale => {
    const source = sourceOf('panels/StarMap.tsx')
    let branch: ts.ConditionalExpression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isConditionalExpression(node) && node.condition.getText(source) === 'beaconAsk === galaxy.id') branch = node
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(branch).toBeDefined()
    const setBeaconAsk = vi.fn(), launchBeaconHere = vi.fn()
    const tree = render(`globalThis.result = (${branch!.whenTrue.getText(source)})`, locale, {
      galaxy: { id: 'galaxy-vault', name: 'Target System' }, setBeaconAsk, launchBeaconHere,
    })
    const buttons = nodes(tree).filter(node => node.type === 'button')
    expect(buttons).toHaveLength(2)
    expect(buttons.map(text)).toEqual([L10N['ui.ItemsPage.056']![locale], L10N['ui.beacon.008']![locale]])
    expect(text(tree)).toContain('Target System')
    expect(text(tree)).not.toContain(L10N['ui.Expedition.108']![locale])
    expect(text(tree)).not.toMatch(/\{p\d+\}|ui\./)
    buttons[1]!.props.onClick()
    expect(setBeaconAsk).toHaveBeenCalledWith(null)
    expect(launchBeaconHere).not.toHaveBeenCalled()
    buttons[0]!.props.onClick()
    expect(launchBeaconHere).toHaveBeenCalledOnce()
  })

  it.each(['zh', 'en'] as const)('%s高安警告保留目标、声望代价和取消/确认动作', locale => {
    const source = sourceOf('ui/beaconPrompt.tsx')
    const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BeaconHighSecPrompt')!
    const onCancel = vi.fn(), onConfirm = vi.fn()
    const tree = render(`${component.getText(source)}\nglobalThis.result = BeaconHighSecPrompt({ galaxyName: 'Target System', penalty: 10, onCancel, onConfirm })`, locale, { onCancel, onConfirm })
    const buttons = nodes(tree).filter(node => node.type === 'button')
    expect(buttons.map(text)).toEqual([L10N['ui.beacon.008']![locale], L10N['ui.beacon.009']![locale]])
    expect(text(tree)).toContain('Target System')
    expect(text(tree)).toContain('10')
    expect(text(tree)).not.toMatch(/\{p\d+\}|ui\./)
    buttons[0]!.props.onClick()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    buttons[1]!.props.onClick()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
