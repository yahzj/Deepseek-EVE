import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { FIRST_TASKS, firstTaskBoard, firstTaskProgress, firstTaskText, claimableFirstTasks } from '../src/firstTasks'
import { createInitialState } from '../src/state'

interface Element {
  type: string
  props: Record<string, unknown>
  children: unknown[]
}
type Target = { page: string; mapTab?: string; shipTab?: string; industrySec?: string; skillGroup?: string }
const source = ts.createSourceFile('FirstTasks.tsx', readFileSync(new URL('../../../apps/desktop/src/renderer/src/panels/FirstTasks.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['FIRST_JUMPS', 'FIRST_GOAL_IDS', 'FirstTasks']
const statements = source.statements.filter((node) => ts.isFunctionDeclaration(node) ? names.includes(node.name?.text ?? '') :
  ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && names.includes(d.name.text)))
if (statements.length !== names.length) throw new Error('任务跳转生产入口缺失')
const code = statements.map((node) => node.getText(source).replace(/^export\s+/, '')).join('\n') + '\nglobalThis.result = FirstTasks'

function render(task: string, locale: 'zh' | 'en') {
  const ctx = buildSimContext(locale)
  const state = createInitialState({ nowWallMs: 0, seed: 7, prologue: true })
  const index = FIRST_TASKS.findIndex((d) => d.id === task)
  for (const d of FIRST_TASKS.slice(0, index)) state.importantTasks[d.id] = { done: true }
  const jumps: Target[] = []
  const bindings = {
    React: { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }) },
    tr: (id: string, params?: Record<string, string | number>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (m, k: string) => String(params?.[k] ?? m)),
    useL10n: () => ({ locale }),
    firstTaskBoard, firstTaskProgress, firstTaskText, claimableFirstTasks,
    result: undefined,
  }
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, bindings)
  const component = bindings.result as unknown as (props: object) => Element
  const root = component({ engine: { state, ctx }, onToast: () => {}, onJump: (t: Target) => jumps.push(t) })
  const nodes: Element[] = []
  function visit(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value !== null && typeof value === 'object' && 'children' in value) {
      const node = value as Element
      nodes.push(node)
      node.children.forEach(visit)
    }
  }
  visit(root)
  return { nodes, jumps }
}
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object' && 'children' in node) return textOf((node as Element).children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

describe('第一次任务跳转与目标行', () => {
  it('任务 id、顺序、判据、奖励、起手道具及链定义与改稿前逐项一致', () => {
    function policy(text: string): string[] {
      const ast = ts.createSourceFile('firstTasks.ts', text, ts.ScriptTarget.Latest, true)
      const array = ast.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations])
        .find((d) => d.name.getText(ast) === 'FIRST_TASKS')?.initializer
      if (!array || !ts.isArrayLiteralExpression(array)) throw new Error('任务表不存在')
      const copy = new Set(['detail', 'detailEn'])
      const printer = ts.createPrinter({ removeComments: true })
      return array.elements.map((element) => {
        if (!ts.isObjectLiteralExpression(element)) throw new Error('任务不是静态对象')
        const fields = element.properties.filter((p) => !ts.isPropertyAssignment(p) || !copy.has(p.name.getText(ast)))
        return printer.printNode(ts.EmitHint.Unspecified, ts.factory.updateObjectLiteralExpression(element, fields), ast)
      })
    }
    const before = execFileSync('git', ['show', 'c182264d:packages/core/src/firstTasks.ts'], { encoding: 'utf8' })
    const after = readFileSync(new URL('../src/firstTasks.ts', import.meta.url), 'utf8')
    expect(policy(after)).toEqual(policy(before))
  })
  it.each(FIRST_TASKS)('$id 两种语言显示目标，按钮没有缓存上次语言', (task) => {
    for (const locale of ['zh', 'en'] as const) {
      const { nodes } = render(task.id, locale)
      expect(nodes.some((node) => textOf(node).includes(L10N['ui.firstTasks.001']![locale]))).toBe(true)
      const buttons = nodes.filter((node) => node.type === 'button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
      if (locale === 'en') expect(buttons.map(textOf).join('')).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
  it('造船的两个实际按钮分别打开书架与造船厂', () => {
    const { nodes, jumps } = render('first-ship', 'zh')
    for (const label of ['蓝图书架', '造船厂']) {
      const button = nodes.find((node) => node.type === 'button' && textOf(node).includes(label))!
      expect(button).toBeDefined()
      ;(button.props.onClick as () => void)()
    }
    expect(jumps.map((t) => t.industrySec)).toEqual(['shelf', 'shipyard'])
  })
  it('采矿准备按钮按舰队、装配、矿带传参', () => {
    const { nodes, jumps } = render('first-mine', 'zh')
    for (const button of nodes.filter((node) => node.type === 'button' && node.props.disabled === undefined)) (button.props.onClick as () => void)()
    expect(jumps.map((t) => [t.page, t.shipTab ?? t.mapTab])).toEqual([['ship', 'fleet'], ['fit', undefined], ['map', 'mine']])
  })
  it('技能分类从真实技能取数，非写死工程名', () => {
    const { nodes, jumps } = render('first-skill', 'en')
    const button = nodes.find((node) => node.type === 'button' && node.props.disabled === undefined)!
    ;(button.props.onClick as () => void)()
    expect(jumps[0]!.skillGroup).toBe(buildSimContext('en').skills.get('ai-expert')!.group)
  })
  it('App 教程装配跳转覆盖此前选择并选当前驾驶船', () => {
    const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../../../apps/desktop/src/renderer/src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let callback: ts.ArrowFunction | undefined
    function visit(node: ts.Node): void {
      if (ts.isJsxAttribute(node) && node.name.getText(app) === 'onJump' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) callback = node.initializer.expression
      ts.forEachChild(node, visit)
    }
    visit(app)
    if (!callback) throw new Error('教程跳转桥缺失')
    const calls: unknown[] = []
    const bridge = {
      engine: { state: { shipId: 'CURRENT-SHIP' } },
      setIndFocus: () => {}, focusSkillGroup: () => {},
      setFitShipId: (id: string) => calls.push(['fit', id]),
      changePage: (page: string) => calls.push(['page', page]),
      changeMapTab: () => {}, changeShipTab: () => {},
      result: undefined,
    }
    runInNewContext(ts.transpileModule(`globalThis.result = ${callback.getText(app)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, bridge)
    ;(bridge.result as unknown as (target: Target) => void)({ page: 'fit' })
    expect(calls).toEqual([['fit', 'CURRENT-SHIP'], ['page', 'fit']])
  })
})
