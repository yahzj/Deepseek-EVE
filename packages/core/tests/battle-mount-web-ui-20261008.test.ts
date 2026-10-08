import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { ROOT } from './helpers/save-shell'

type Node = { type: unknown; props: Record<string, any>; children: unknown[] }
const React = { Fragment: 'fragment', createElement: (type: unknown, props: Record<string, any> | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children }) }
const nodes = (value: any): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value?.children ? [value, ...value.children.flatMap(nodes)] : []
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.children ? value.children.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const file = (name: string) => readFileSync(resolve(ROOT, `apps/desktop/src/renderer/src/panels/${name}`), 'utf8')
function evaluate(source: string, globals: Record<string, unknown>) {
  const scope = { React, exports: {}, ...globals, result: undefined }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, scope)
  return scope.result as unknown
}
describe('战斗挂载行、手册机动和双向网线', () => {
  it.each(['zh', 'en'] as const)('%s每件挂载独立且名称着色，效果正文不重复名称', locale => {
    const source = ts.createSourceFile('mounts.tsx', file('battleMounts.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const declaration = source.statements.find(n => ts.isFunctionDeclaration(n))!
    const names = ['A', 'B'], pairs = [['装置A', 'Module A'], ['装置B', 'Module B']]
    const tree = evaluate(declaration.getText(source) + '\nglobalThis.result=BattleMountLines({names,pairs})', {
      names, pairs, UI_TONES: { matBattle: 'special-tone' },
      mountNamesTextOf: (_names: string[], values: string[][]) => values.map(p => p[locale === 'en' ? 1 : 0]),
      mountEffectTextByName: (name: string) => name === 'A' ? 'effect' : null,
    })
    const lines = nodes(tree).filter(n => 'data-battle-mount' in n.props)
    expect(lines).toHaveLength(2)
    expect(lines.every(line => nodes(line).find(n => n.type === 'strong')?.props.style.color === 'special-tone')).toBe(true)
    expect(text(lines[0])).toBe((locale === 'en' ? 'Module A' : '装置A') + ': effect')
    expect(text(lines[1])).toBe(locale === 'en' ? 'Module B' : '装置B')
  })
  it('手册的机动行只留240m/s，不展示倍率后缀', () => {
    const ast = ts.createSourceFile('handbook.tsx', file('handbookDetail.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'FoeBody')!
    const ctx = buildSimContext(), def = ctx.foeShips!.get('foe-alien-broodmother')!
    const tree = evaluate(fn.getText(ast) + '\nglobalThis.result=FoeBody({cell:{raw:def},engine:{ctx}})', {
      ctx, def, ShipSprite: 'sprite', DmgChip: 'damage', foeBriefLinesOfShip: () => null,
      mountLabelText: () => '', tr: (id: string) => L10N[id]?.zh ?? id,
    })
    const speed = nodes(tree).find(n => n.props.className === 'app-detail-row' && text(n.children[0]) === L10N['ui.FitPage.049']!.zh)!
    expect(text(speed.children[1])).toBe('240 m/s')
  })
  it('真实BattleScreen网线表达式解析主控、僚舰和敌舰两个方向', () => {
    const ast = ts.createSourceFile('battle.tsx', file('BattleScreen.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let initializer: ts.Expression | undefined
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'webEls') initializer = node.initializer
      ts.forEachChild(node, visit)
    }
    visit(ast)
    const links = [{ from: 'ally-1', to: 'foe-0', fromName: 'Escort', toName: 'Mother', slowPct: .5 },
      { from: 'foe-0', to: 'player', fromName: 'Mother', toName: 'Lead', slowPct: .9 }]
    const result = evaluate(`globalThis.result=${initializer!.getText(ast)}`, {
      arcs: { webLinks: links }, foeAnchorByTag: new Map([['foe-0', { x: 800, y: 100 }]]),
      meAnchorOfTag: (tag: string) => tag === 'ally-1' ? { x: 200, y: 300 } : tag === 'player' ? { x: 300, y: 100 } : undefined,
      tr: (_id: string, values: Record<string, unknown>) => `${values.from}/${values.to}`,
    }) as Node[]
    expect(result).toHaveLength(2)
    expect(result[0]!.props).toMatchObject({ 'data-web-from': 'ally-1', 'data-web-to': 'foe-0', style: { left: 200, top: 300 } })
    expect(result[1]!.props).toMatchObject({ 'data-web-from': 'foe-0', 'data-web-to': 'player', style: { left: 800, top: 100 } })
    expect(result[0]!.props.title).toBe('Escort/Mother')
  })
})
