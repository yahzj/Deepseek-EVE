import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { buildSimContext, MODULES, ITEMS, FACTION_CODEX } from '@whale/data'
import { visibleItemDefs } from '../src/inventory'
import { handbookContentOrderOf } from '../../../apps/desktop/src/renderer/src/ui/handbookOrder'

const newIds = new Set(['mod-alien-acid-launcher', 'mod-alien-pressure-chamber', 'drone-jawclaw'])

describe('手册新入侵装备稳定后排', () => {
  it.each(['zh', 'en'] as const)('%s两件模块在各自同类末尾，原有次序及源目录不变', locale => {
    const ctx = buildSimContext(locale)
    const before = [...ctx.modules.values()]
    const original = before.map(mod => mod.id)
    const ordered = handbookContentOrderOf(before, mod => mod.id)
    for (const [id, slot] of [['mod-alien-acid-launcher', 'turret'], ['mod-alien-pressure-chamber', 'support']]) {
      expect(ordered.filter(mod => mod.slot === slot).at(-1)!.id).toBe(id)
    }
    expect(ordered.filter(mod => !newIds.has(mod.id)).map(mod => mod.id)).toEqual(original.filter(id => !newIds.has(id)))
    expect(ordered.map(mod => mod.id).sort()).toEqual([...original].sort())
    expect(before.map(mod => mod.id)).toEqual(original)
    expect([...ctx.modules.keys()]).toEqual(original)
    expect(ordered.find(mod => mod.id === 'mod-alien-acid-launcher')).toBe(ctx.modules.get('mod-alien-acid-launcher'))
  })
  it.each(['zh', 'en'] as const)('%s无人机保持制式与原势力顺序，新机在末尾', locale => {
    const ctx = buildSimContext(locale)
    const drones = visibleItemDefs(ctx).filter(item => item.kind === 'drone')
    const ordered = handbookContentOrderOf(drones, item => item.id)
    expect(ordered.at(-1)!.id).toBe('drone-jawclaw')
    expect(ordered.slice(0, -1)).toEqual(drones.filter(item => item.id !== 'drone-jawclaw'))
    const reversedNew = [drones.at(-1)!, ...drones.slice(0, -1)]
    expect(handbookContentOrderOf(reversedNew, item => item.id)).toEqual(ordered)
  })
  it('势力详情新三件在既有专属内容之后，源登记与其他族顺序不变', () => {
    const ids = FACTION_CODEX.C!.modules
    const ordered = handbookContentOrderOf(ids, id => id)
    expect(ordered.filter(id => !newIds.has(id))).toEqual(ids.filter(id => !newIds.has(id)))
    expect(ordered.slice(-3)).toEqual(ids.filter(id => newIds.has(id)))
    for (const [family, entry] of Object.entries(FACTION_CODEX)) {
      if (family !== 'C') expect(handbookContentOrderOf(entry.modules, id => id)).toEqual(entry.modules)
    }
  })
  it('三个视图入口同源，列表沿用卡片次序，不改变数据目录', () => {
    const file = new URL('../../../apps/desktop/src/renderer/src/panels/Handbook.tsx', import.meta.url)
    const source = ts.createSourceFile('Handbook.tsx', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const calls: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'handbookContentOrderOf') calls.push(node.arguments[0]!.getText(source))
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(calls).toEqual(['card.modules', 'visibleItemDefs(engine.ctx)', 'engine.modules'])
    const list = source.getText().split('function renderList(')[1]!.split("if (tab === 'ships')")[0]!
    expect(list).toContain('{orderedItems')
    expect(list).toContain('{orderedModules')
    expect(list).not.toMatch(/\{engine\.(items|modules)/)
    expect(MODULES[0]!.id).toBe('mod-alien-acid-launcher')
    expect(ITEMS.filter(item => item.kind === 'drone').at(-1)!.id).toBe('drone-jawclaw')
  })
  it('空数组及不含新件原样保持；重复条目不丢，排序幂等', () => {
    expect(handbookContentOrderOf([], String)).toEqual([])
    const ids = ['old-b', 'mod-alien-acid-launcher', 'old-a', 'drone-jawclaw', 'mod-alien-acid-launcher']
    const ordered = handbookContentOrderOf(ids, String)
    expect(ordered).toEqual(['old-b', 'old-a', 'mod-alien-acid-launcher', 'drone-jawclaw', 'mod-alien-acid-launcher'])
    expect(handbookContentOrderOf(ordered, String)).toEqual(ordered)
  })
})
