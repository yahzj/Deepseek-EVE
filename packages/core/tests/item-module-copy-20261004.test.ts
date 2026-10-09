import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ITEMS, MODULES, L10N, EN_ITEMS_ALL, EN_MODULES, EN_BLUEPRINTS, buildSimContext, l10nEntryText } from '@whale/data'
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
    const added = new Set(['ammo-kinetic-3', 'ammo-explosive-3', 'ammo-plasma-3', 'blackbox-c', 'deep-space-probe', 'drone-jawclaw'])
    expect(ITEMS.filter(item => added.has(item.id)).map(item => item.id).sort()).toEqual([...added].sort())
    expect(strip(ITEMS.filter(item => !added.has(item.id)))).toEqual(strip(adjusted))
  })
  it('旧装备字段仅按已确认值调整，新增七件另由装备专项约束', () => {
    const plugs = historical<typeof MODULES>('packages/data/src/plugs.ts', 'SHIP_PLUGS')
    const before = historical<typeof MODULES>('packages/data/src/modules.ts', 'MODULES', { SHIP_PLUGS: plugs })
    const strip = (entries: typeof MODULES) => entries.map(({ description: _description, ...rest }) => rest)
    const adjusted = before.map(mod => {
      if (mod.id === 'mod-wh-e-cpu') return { ...mod, reloadPenaltyPct: .05 }
      if (mod.id === 'mod-lair-blink-r') return { ...mod, blink: { ...mod.blink!, cooldownMs: 16000 } }
      return mod.id === 'mod-wh-a-hangar' ? { ...mod, droneCycleCutPct: .2 } : mod
    })
    const newIds = new Set(['mod-drone-launch-1', 'mod-drone-launch-2', 'mod-drone-launch-3', 'mod-laser-calibration-2', 'mod-laser-calibration-3', 'mod-alien-acid-launcher', 'mod-alien-pressure-chamber'])
    expect(MODULES.filter(mod => newIds.has(mod.id))).toHaveLength(7)
    expect(strip(MODULES.filter(mod => !newIds.has(mod.id)))).toEqual(strip(adjusted))
  })
  it.each(ITEMS)('$id 物品说明中英唯一表接线一致，名称不变', (item) => {
    const pair = Object.entries(L10N).find(([id, entry]) => (id.startsWith('item.') || id === 'ui.stellar.002') && entry.zh === item.description)
    expect(pair, item.id).toBeDefined()
    const [id, entry] = pair!
    const expected = l10nEntryText(entry, 'en')
    expect(EN_ITEMS_ALL[item.id]?.description).toBe(expected)
    expect(buildSimContext('en').items.get(item.id)?.description).toBe(expected)
    if (entry.enDeferred === true) {
      expect(entry.en).toBe('')
      const backlog = readFileSync(new URL('../../../docs/l10n-pending.md', import.meta.url), 'utf8')
      expect(backlog).toContain(`| \`${id}\` |`)
      expect(expected).toBe(entry.zh)
    } else {
      expect(expected).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
  it.each(MODULES)('$id 装备说明中英唯一表接线一致', (module) => {
    const pair = Object.entries(L10N).find(([id, entry]) => id.startsWith('mod.') && entry.zh === module.description)
    expect(pair, module.id).toBeDefined()
    const [id, entry] = pair!
    const expected = l10nEntryText(entry, 'en')
    expect(buildSimContext('en').modules.get(module.id)?.description).toBe(expected)
    if (entry.enDeferred) {
      expect(entry.en).toBe('')
      expect(readFileSync(new URL('../../../docs/l10n-pending.md', import.meta.url), 'utf8')).toContain(`| \`${id}\` |`)
    } else {
      expect(EN_MODULES[module.id]?.description).toBe(expected)
      expect(expected).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
  it('本批说明无重复手写数字、跨件比较与推销承诺', () => {
    for (const entry of [...ITEMS, ...MODULES]) {
      let description = entry.description
      // 船长2026-10-09批准该说明明确每剂持续时间，仅为这一项核验后放行数字。
      if (entry.id === 'synaptic-accelerant') {
        expect(description).toBe(L10N['item.synaptic.001']!.zh)
        const hours = String(core.SYNAPTIC_ACCELERANT_MS / 3_600_000)
        expect(description.match(/[0-9]+/g)).toEqual([hours])
        expect(description).toContain(`每枚增加${hours}小时有效时间`)
        description = description.replace(hours, '')
      }
      expect(description, entry.id).not.toMatch(/[0-9]|全宇宙|必备|正解|一舱.*船|稳赚|比制式|比.*MK\d/)
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
  tr: (id: string, params?: Record<string, string | number>) => (L10N[id] ? l10nEntryText(L10N[id]!, language.value) : id).replace(/\{(\w+)\}/g, (m, key: string) => String(params?.[key] ?? m)),
  kindTextOfItem: (item: (typeof ITEMS)[number]) => item.kind,
  slotText: (slot: string) => slot, rackText: (rack: string) => rack,
  shipRoleText: () => '', shipTierText: () => '',
  MODULE_SUBS: [], moduleSubKeyOf: () => '', subText: () => '',
}
runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, bindings)
const display = bindings.exports as { itemInfoLines: (item: (typeof ITEMS)[number]) => Row[]; moduleInfoLines: (module: (typeof MODULES)[number], engine?: unknown, shipId?: string, ordinal?: number) => Row[]; moduleShortEffect: (module: (typeof MODULES)[number]) => string }
const subSource = ts.createSourceFile('itemSubs.ts', readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/itemSubs.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const subCode = subSource.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(subSource)).join('\n')
const subBindings = { ...core, exports: {}, tr: bindings.tr }
runInNewContext(ts.transpileModule(subCode, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, subBindings)
const filters = subBindings.exports as { moduleSubKeyOf: (slot: core.ModuleSlot, id: string) => string }
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value && typeof value === 'object' && 'children' in value) return textOf((value as { children: unknown[] }).children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
describe('真实参数行承接说明数字', () => {
  it('无人机启动提示保留多装递减、不误套全队60%封顶；电子压制提示保持', () => {
    language.value = 'zh'
    for (const id of ['mod-drone-launch-1', 'mod-drone-launch-2', 'mod-drone-launch-3']) {
      const text = display.moduleInfoLines(MODULES.find(mod => mod.id === id)!).map(row => `${row.k}${textOf(row.v)}`).join('|')
      expect(text).toContain('无人机启动时间')
      expect(text).toContain('多装递减')
      expect(text).not.toMatch(/60%|上限|封顶|首次出击/)
    }
    const ecm = MODULES.find(mod => core.stackingOf(mod).kind === 'ecm')!
    expect(ecm).toBeDefined()
    expect(display.moduleInfoLines(ecm).map(row => textOf(row.v)).join('|')).toContain('60%')
  })
  it.each(['zh', 'en'] as const)('%s 全目录的速度加成只显示一次，不把非推进器误称加力推进', locale => {
    language.value = locale
    const speedModules = MODULES.filter(module => (module.speedBonusPct ?? 0) > 0)
    expect(speedModules.filter(module => module.slot !== 'propulsion').map(module => module.id)).toEqual(['mod-alien-pressure-chamber', 'mod-wh-c-pulse', 'mod-wh-c-frame'])
    expect(filters.moduleSubKeyOf('armor', 'mod-wh-c-frame')).toBe('armor')
    expect(filters.moduleSubKeyOf('support', 'mod-wh-c-pulse')).toBe('support-aux')
    for (const module of speedModules) {
      const rows = display.moduleInfoLines(module)
      const afterburner = rows.filter(row => row.k === L10N['ui.shipInfo.020']![locale])
      const speed = rows.filter(row => row.k === L10N['ui.shipInfo.075']![locale])
      expect(afterburner, module.id).toHaveLength(module.slot === 'propulsion' ? 1 : 0)
      if (module.speedRamp) {
        expect(speed, module.id).toHaveLength(0)
        const ramp = rows.find(row => row.k === l10nEntryText(L10N['ui.alienLoot.003']!, locale))!
        expect(ramp).toBeDefined()
        expect(textOf(ramp.v)).toContain('+5% → +35%，60秒达到峰值')
        expect(display.moduleShortEffect(module)).toContain('+5% → +35%，60秒达到峰值')
        expect(rows.map(row => textOf(row.v)).join('|')).not.toMatch(/点火|冷却|burning|cooldown/i)
        expect(display.moduleShortEffect(module)).not.toMatch(/点火|冷却|burning|cooldown/i)
        continue
      }
      expect(speed, module.id).toHaveLength(module.slot === 'propulsion' ? 0 : 1)
      const value = textOf((speed[0] ?? afterburner[0])!.v)
      const pct = `${Math.round(module.speedBonusPct! * 100)}%`
      expect(value, module.id).toContain(pct)
      expect(value, module.id).toMatch(locale === 'zh' ? /点火/ : /burning/)
      expect(display.moduleShortEffect(module), module.id).toContain(pct)
      const cycle = core.thrusterCycleSeconds(core.DEFAULT_BALANCE.battle, core.thrusterCycleOfModule(module))
      const period = L10N['ui.shipInfo.183']![locale].replace('{p1}', String(cycle.boost)).replace('{p2}', String(cycle.cooldown))
      expect(display.moduleShortEffect(module), module.id).toContain(period)
      expect(textOf(rows[0]!.v), module.id).toBe(`${module.slot}（${module.rack}）`)
      if (module.slot === 'propulsion') expect(filters.moduleSubKeyOf(module.slot, module.id)).toBe('prop')
    }
  })
  it('中英已装周期与负面值均从真实核心读取，不漏槽或保留最大值旧提示', () => {
    const ctx = buildSimContext()
    const state = core.createInitialState({ nowWallMs: 0, seed: 12 })
    const uid = core.addShipToFleet(state, 'sh-megalodon')
    state.shipId = uid
    state.fleet[uid]!.fitted = { high: ['mod-shieldfield-2'], mid: ['mod-prop-3', 'mod-prop-3'], low: ['mod-wh-e-cpu', 'mod-wh-e-cpu', 'mod-wh-a-coat', 'mod-wh-a-coat'] }
    const engine = { state, ctx }
    for (const locale of ['zh', 'en'] as const) {
      language.value = locale
      const rows = display.moduleInfoLines(ctx.modules.get('mod-shieldfield-2')!, engine, uid)
      const cycle = rows.find(row => row.k === L10N['ui.equipmentPenalty.001']![locale])!
      expect(textOf(cycle.v)).toContain('11.025')
      for (const [id, ordinal] of [['mod-prop-3', 2], ['mod-wh-a-coat', 2], ['mod-wh-e-cpu', 2]] as const) {
        const values = display.moduleInfoLines(ctx.modules.get(id)!, engine, uid, ordinal).map(row => textOf(row.v)).join('|')
        expect(values).not.toMatch(/\{p\d+\}|只取最重|heaviest of several|下限 0|floor 0/)
        if (id === 'mod-wh-a-coat') expect(values).toContain('11%')
        if (id === 'mod-wh-e-cpu') expect(values).toContain('5%')
      }
    }
  })
  it('护盾力场费用与结算常量同源，装备/图纸中英都排除自身', () => {
    for (const locale of ['zh', 'en'] as const) {
      language.value = locale
      for (const tier of [2, 3]) {
        const id = `mod-shieldfield-${tier}`
        const rows = display.moduleInfoLines(MODULES.find(module => module.id === id)!).map(row => textOf(row.v)).join('|')
        expect(rows).toContain(`${Math.round(core.SHIELD_FIELD_COST_PCT * 100)}%`)
        expect(rows).toContain(locale === 'zh' ? '其他存活舰船' : 'other surviving fleet ship')
        expect(rows).not.toMatch(/\{p\d\}/)
        const bp = `bp-shieldfield-${tier}`
        expect(buildSimContext(locale).blueprints.get(bp)!.description).toBe(L10N['mod.copy.027']![locale])
        expect(EN_BLUEPRINTS[bp]!.description).toBe(L10N['mod.copy.027']!.en)
      }
    }
  })
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
    expect(rowsOf('mod-lair-blink-r')).toContain('16 秒')
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
