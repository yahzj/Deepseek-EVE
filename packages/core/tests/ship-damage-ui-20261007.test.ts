import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { L10N } from '@whale/data'
import { cleanShipDamage, SHIP_DAMAGE_DEFS, SHIP_DAMAGE_PENALTY } from '../src/shipDamage'
import { ROOT } from './helpers/save-shell'

type Node = { type: string; props: Record<string, any>; children: unknown[] }
const nodes = (v: unknown): Node[] => Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' && 'children' in v
  ? [v as Node, ...(v as Node).children.flatMap(nodes)] : []

describe('战损详情真实组件', () => {
  it.each(['zh', 'en'] as const)('%s详情可展开、重复和非法值不占位，清单与富卡同源', locale => {
    const ast = ts.createSourceFile('ShipDamageMods.tsx', readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/ui/ShipDamageMods.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ShipDamageMods')!
    const createElement = (type: string, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children })
    const tr = (id: string, p?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (m,k: string) => String(p?.[k] ?? m))
    const scope = { exports: {}, result: undefined, React: { createElement }, cleanShipDamage, SHIP_DAMAGE_DEFS, SHIP_DAMAGE_PENALTY,
      tr, Glyph: 'Glyph', hoverTipProps: (tip: unknown) => ({ richTip: tip }),
      infoCardContent: (title: unknown, _lines: unknown[], note: unknown, extra: unknown) => createElement('InfoCard', {}, title, note, extra) }
    runInNewContext(ts.transpileModule(fn.getText(ast) + '\nglobalThis.result=ShipDamageMods', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText, scope)
    const component = scope.result as unknown as (p: unknown) => unknown
    expect(component({ ids: [] })).toBeNull()
    const content = nodes(component({ ids: ['shield', 'cargo', 'range', 'ghost', 'shield'] }))
    expect(content.filter(n => n.type === 'details')).toHaveLength(3)
    expect(content.filter(n => n.type === 'summary').map(n => n.props['data-damage-kind'])).toEqual(['shield','cargo','range'])
    expect(content.filter(n => n.type === 'InfoCard').every(n => n.children.some(v => typeof v === 'string' && v.includes('15%')))).toBe(true)
    expect(content.filter(n => n.type === 'InfoCard').every(n => n.children.includes(tr('ui.shipDamage.014')))).toBe(true)
    expect(content.filter(n => n.type === 'summary').every(n => n.props.richTip)).toBe(true)
  })
})
