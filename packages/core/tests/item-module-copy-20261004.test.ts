import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ITEMS, MODULES, L10N, EN_ITEMS_ALL, EN_MODULES, buildSimContext } from '@whale/data'
import * as core from '../src/index'
import { idLiteralsIn, stripComments } from '../../../tools/text-scan'

function historical<T>(file: string, symbol: string, bindings: Record<string, unknown> = {}): T {
  const text = execFileSync('git', ['show', `d2ab64f1:${file}`], { encoding: 'utf8' })
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const code = ast.statements.filter((s) => !ts.isImportDeclaration(s)).map((s) => s.getText(ast).replace(/^export\s+/, '')).join('\n') + `\nglobalThis.result = ${symbol}`
  const context = { ...bindings, result: undefined }
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.result as T
}

describe('物品装备说明双语与数据守恒', () => {
  it('英文覆盖的物品和装备名称仅信号谜质采用后续已确认改名，其余保持改稿前定名', () => {
    const text = execFileSync('git', ['show', 'd2ab64f1:packages/data/src/l10n.ts'], { encoding: 'utf8' })
    const ast = ts.createSourceFile('l10n.ts', text, ts.ScriptTarget.Latest, true)
    for (const [symbol, live] of [['EN_ITEMS', EN_ITEMS_ALL], ['EN_MODULES', EN_MODULES]] as const) {
      const declaration = ast.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations]).find((d) => d.name.getText(ast) === symbol)!
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) throw new Error('英文表不是静态对象')
      for (const field of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(field) || !ts.isStringLiteral(field.name) || !ts.isObjectLiteralExpression(field.initializer)) continue
        const name = field.initializer.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'name')?.initializer
        if (name && ts.isStringLiteral(name)) {
          const expected = symbol === 'EN_ITEMS' && field.name.text === 'mat-wh-essence' ? 'Signal Enigma' : name.text
          expect(live[field.name.text]?.name, field.name.text).toBe(expected)
        }
      }
    }
  })
  it('111 种物品除 description、已确认的信号谜质改名和旗舰黑匣价值外所有字段逐项不变', () => {
    const before = historical<typeof ITEMS>('packages/data/src/items.ts', 'ITEMS')
    // 2026-10-06船长确认：两种旗舰黑匣基础价值下调，§21仅改信号谜质显示名。
    const adjusted = before.map(item => {
      if (['blackbox-h', 'blackbox-r'].includes(item.id)) return { ...item, baseSellPriceIsk: 10_000_000 }
      return item.id === 'mat-wh-essence' ? { ...item, name: '信号谜质' } : item
    })
    const strip = (entries: typeof ITEMS) => entries.map(({ description: _description, ...rest }) => rest)
    const added = new Set(['ammo-kinetic-3', 'ammo-explosive-3', 'ammo-plasma-3'])
    expect(ITEMS.filter(item => added.has(item.id)).map(item => item.id).sort()).toEqual([...added].sort())
    expect(strip(ITEMS.filter(item => !added.has(item.id)))).toEqual(strip(adjusted))
  })
  it('170 件装备含插件，除 description 外所有字段逐项不变', () => {
    const plugs = historical<typeof MODULES>('packages/data/src/plugs.ts', 'SHIP_PLUGS')
    const before = historical<typeof MODULES>('packages/data/src/modules.ts', 'MODULES', { SHIP_PLUGS: plugs })
    const strip = (entries: typeof MODULES) => entries.map(({ description: _description, ...rest }) => rest)
    expect(strip(MODULES)).toEqual(strip(before))
  })
  it.each(ITEMS)('$id 物品说明中英唯一表接线一致，名称不变', (item) => {
    const pair = Object.entries(L10N).find(([id, entry]) => (id.startsWith('item.copy.') || id.startsWith('item.signalSpace.') || id.startsWith('item.ammoMk3.')) && entry.zh === item.description)
    expect(pair, item.id).toBeDefined()
    expect(EN_ITEMS_ALL[item.id]?.description).toBe(pair![1].en)
    expect(buildSimContext('en').items.get(item.id)?.description).toBe(pair![1].en)
    expect(pair![1].en).not.toMatch(/[\u4e00-\u9fff]/)
  })
  it.each(MODULES)('$id 装备说明中英唯一表接线一致', (module) => {
    const pair = Object.entries(L10N).find(([id, entry]) => (id.startsWith('mod.copy.') || id.startsWith('mod.signalSpace.')) && entry.zh === module.description)
    expect(pair, module.id).toBeDefined()
    expect(EN_MODULES[module.id]?.description).toBe(pair![1].en)
    expect(buildSimContext('en').modules.get(module.id)?.description).toBe(pair![1].en)
    expect(pair![1].en).not.toMatch(/[\u4e00-\u9fff]/)
  })
  it('本批说明无重复手写数字、跨件比较与推销承诺', () => {
    for (const entry of [...ITEMS, ...MODULES]) {
      expect(entry.description).not.toMatch(/[0-9]|全宇宙|必备|正解|一舱.*船|稳赚|比制式|比.*MK\d/)
    }
  })
  it('id 扫描认 item/mod，注释和动态模板不当静态引用', () => {
    const source = stripComments("// 'item.copy.999'\nL10N['item.copy.001'];L10N[\"mod.copy.001\"];tr('ui.x.001');`mod.copy.${n}`")
    expect(idLiteralsIn(source).map((entry) => entry.id)).toEqual(['item.copy.001', 'mod.copy.001', 'ui.x.001'])
  })
})

type Row = { k: string; v: unknown }
const language = { value: 'zh' as 'zh' | 'en' }
const file = new URL('../../../apps/desktop/src/renderer/src/ui/shipInfo.tsx', import.meta.url)
const source = ts.createSourceFile('shipInfo.tsx', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const code = source.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(source)).join('\n')
const bindings = {
  ...core, exports: {},
  React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props, children }) },
  tr: (id: string, params?: Record<string, string | number>) => (L10N[id]?.[language.value] ?? id).replace(/\{(\w+)\}/g, (m, key: string) => String(params?.[key] ?? m)),
  kindTextOfItem: (item: (typeof ITEMS)[number]) => item.kind,
  slotText: (slot: string) => slot, rackText: (rack: string) => rack,
  shipRoleText: () => '', shipTierText: () => '',
  MODULE_SUBS: [], moduleSubKeyOf: () => '', subText: () => '',
}
runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, bindings)
const display = bindings.exports as { itemInfoLines: (item: (typeof ITEMS)[number]) => Row[]; moduleInfoLines: (module: (typeof MODULES)[number]) => Row[] }
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value && typeof value === 'object' && 'children' in value) return textOf((value as { children: unknown[] }).children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
describe('真实参数行承接说明数字', () => {
  it('加速剂/燃料/发射器和货柜的中英行从实际单点取值', () => {
    for (const locale of ['zh', 'en'] as const) {
      language.value = locale
      const rowsOf = (id: string) => display.itemInfoLines(ITEMS.find((item) => item.id === id)!).map((row) => textOf(row.v)).join('|')
      expect(rowsOf('synaptic-accelerant')).toContain(String(core.SYNAPTIC_ACCELERANT_MS / 3_600_000))
      expect(rowsOf('synaptic-accelerant')).toContain(`×${core.SYNAPTIC_ACCELERANT_MUL}`)
      expect(rowsOf('jump-fuel')).toContain(`×${core.JUMP_FUEL_SPEED_MUL}`)
      expect(rowsOf('invasion-beacon')).toContain(String(core.HIGH_SEC_PENALTY))
      expect(rowsOf('box-relic-a')).toContain('3 × 2')
      expect(rowsOf('box-bp-shallow')).toContain('2 × 1')
    }
  })
  it('护盾投射量、掠袭机库容量和墨潮电子舱下限仍显示', () => {
    language.value = 'zh'
    const rowsOf = (id: string) => display.moduleInfoLines(MODULES.find((module) => module.id === id)!).map((row) => textOf(row.v)).join('|')
    expect(rowsOf('mod-drone-shield-2')).toContain('70%')
    expect(rowsOf('mod-drone-shield-3')).toContain('100%')
    expect(rowsOf('mod-wh-a-hangar')).toContain('40')
    expect(rowsOf('mod-lair-ecm-h')).toContain('15%')
    expect(rowsOf('mod-lair-ecm-h')).toContain(String(core.FOE_RANGE_DEBUFF_FLOOR_M))
    expect(rowsOf('mod-lair-beam-r')).toContain('3 发')
    expect(rowsOf('mod-lair-beam-r')).toContain('0.1 秒')
    expect(rowsOf('mod-lair-blink-r')).toContain('2000 m')
    expect(rowsOf('mod-lair-blink-r')).toContain('12 秒')
    expect(rowsOf('mod-lair-laser-r')).toContain('0.6')
    expect(rowsOf('mod-shieldchg-2')).toContain('20%')
    expect(rowsOf('mod-shieldfield-3')).toContain('8')
    expect(rowsOf('plug-rangefinder')).toContain('20%')
  })
  it.each(MODULES)('$id 详情参数行标签不重名，避免新行重复旧行', (module) => {
    language.value = 'zh'
    const keys = display.moduleInfoLines(module).map((row) => row.k)
    expect(new Set(keys).size, `${module.id}: ${keys.join(', ')}`).toBe(keys.length)
  })
})
