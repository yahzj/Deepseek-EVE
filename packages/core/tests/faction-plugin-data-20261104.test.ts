import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, SHIP_BLUEPRINTS, MODULES, MARKET_GOODS, RARITY_TIER, L10N, l10nEntryText, buildSimContext, buildFactionCards, factionOfExclusive } from '@whale/data'
import * as core from '../src/index'
import { staticDocumentIssues } from '../../data/src/staticData'
import plugsDocument from '../../data/src/static/plugs.json'
import modulesDocument from '../../data/src/static/modules.json'
import marketDocument from '../../data/src/static/market.json'
import { MARKET_GOODS_0_TEXT_BINDINGS } from '../../data/src/market/bindings'

const ctx = buildSimContext()
const cases = [
  { family: 'A', id: 'plug-pirate-damage-management', old: 'plug-pirate-raider', nameId: 'mod.factionPlug.010', descId: 'mod.factionPlug.011', fields: { damageManagement: { penaltyReductionPct: .8, hullResistPerKind: .03, maxKinds: 10 } } },
  { family: 'C', id: 'plug-alien-nanobiomass', old: 'plug-alien-shield-coating', nameId: 'mod.factionPlug.012', descId: 'mod.factionPlug.013', fields: { armorCapacityPenaltyPct: .2, armorRegenPerSec: .01 } },
  { family: 'D', id: 'plug-gravekeeper-charge', old: 'plug-gravekeeper-capacitor', nameId: 'mod.factionPlug.014', descId: 'mod.factionPlug.015', fields: { chargedWeapons: { reloadMul: 2, damageMul: 2, falloffReductionPct: .5 } } },
  { family: 'E', id: 'plug-titan-drone-command', old: 'plug-titan-compression', nameId: 'mod.factionPlug.016', descId: 'mod.factionPlug.017', fields: { droneCommand: { sharePct: .5, targetWeightPerM3: .01 } } },
  { family: 'G', id: 'plug-deadarmy-reinforced-hull', old: 'plug-deadarmy-printing', nameId: 'mod.factionPlug.018', descId: 'mod.factionPlug.019', fields: { hullCapacityBonusPct: .4, recoveryDamageImmune: true } },
] as const

type Row = { k: string; v: unknown }
type View = { moduleInfoLines: (mod: core.ModuleDef) => Row[]; moduleShortEffect: (mod: core.ModuleDef) => string }
function display(locale: 'zh' | 'en'): View {
  const source = ['primitives', 'moduleEffects', 'moduleLines'].map(name => {
    const file = new URL(`../../../apps/desktop/src/renderer/src/features/ships/info/${name}.tsx`, import.meta.url)
    const ast = ts.createSourceFile(`${name}.tsx`, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    return ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join('\n')
  }).join('\n')
  const scope = { ...core, exports: {},
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
    tr: (id: string, params?: Record<string, string | number>) => (L10N[id] ? l10nEntryText(L10N[id]!, locale) : id)
      .replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
    slotText: String, rackText: String, MODULE_SUBS: [], moduleSubKeyOf: () => '', subText: () => '',
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  return scope.exports as View
}
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value && typeof value === 'object' && 'children' in value) return textOf((value as { children: unknown[] }).children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

describe('五族新插件数据与玩家参数接线', () => {
  it('静态字段合同及市场绑定完整，危机周期缩短25%而非保留25%', () => {
    for (const document of [plugsDocument, modulesDocument, marketDocument]) expect(staticDocumentIssues(document)).toEqual([])
    expect(marketDocument.groups.MARKET_GOODS_0.map(row => row.key).sort()).toEqual(Object.keys(MARKET_GOODS_0_TEXT_BINDINGS).sort())
    expect(ctx.modules.get('mod-gravekeeper-crisis')!.crisisOverload).toEqual({ rangeBonusPct: .4, damageBonusPct: .25, speedPenaltyPct: .4, droneInitialCutPct: .5, droneCycleCutPct: .25 })
    expect(ctx.modules.get('mod-lair-armor-c')).toMatchObject({ repairArmorHp: 10, repairIntervalMs: 5000, repairFree: true, repairIgnoresCapacityAmp: true })
  })

  it.each(cases)('$id字段、图纸、族图鉴、稀有度与获取门禁完整', entry => {
    const mod = ctx.modules.get(entry.id)!
    expect(mod).toMatchObject({ slot: 'plug', rack: 'low', cpuUse: 0, plugNonStacking: true, blueprintExchangeDisabled: true, ...entry.fields })
    const source = ctx.blueprints.get(`bp-${entry.old}`)!
    const card = buildFactionCards([], undefined).find(row => row.family === entry.family)!
    expect(card.modules).toContain(entry.id)
    for (const id of core.FOE_LAIR_GEAR[entry.family]) {
      expect(id.startsWith('bp-') || id.startsWith('sbp-') ? card.blueprints : card.modules).toContain(id)
    }
    expect(new Set(card.modules).size).toBe(card.modules.length)
    for (const prefix of ['bp-', 'bp-once-']) {
      const bp = ctx.blueprints.get(`${prefix}${entry.id}`)!
      expect(bp.moduleId).toBe(entry.id)
      expect(bp.materials).toEqual(source.materials)
      expect(bp.buildSeconds).toBe(source.buildSeconds)
      expect(bp.buildCostIsk).toBe(source.buildCostIsk)
      expect(bp.singleUse === true).toBe(prefix === 'bp-once-')
      expect(bp.unreleased).not.toBe(true)
      expect(card.blueprints).toContain(bp.id)
      expect(factionOfExclusive(bp.id)).toBe(entry.family)
      expect(RARITY_TIER[bp.id]).toBe(4)
    }
    expect(factionOfExclusive(mod.id)).toBe(entry.family)
    expect(RARITY_TIER[mod.id]).toBe(4)
    const state = core.createInitialState({ nowWallMs: 0, seed: 20261104 })
    state.standings.dsi = 1000
    expect(core.plugExchangeRowsOf(state, ctx).some(row => row.moduleId === mod.id)).toBe(false)
    expect(core.exchangePlugBlueprint(state, ctx, mod.id)).toMatchObject({ ok: false, errorId: 'core.plug.016' })
    expect(state.standings.dsi).toBe(1000)
    for (const id of [mod.id, `bp-${mod.id}`, `bp-once-${mod.id}`]) {
      expect(MARKET_GOODS.find(row => row.refId === id)).toMatchObject({ playerBuyable: false, playerSellable: false, blackMarketBuyable: false })
      expect(ctx.marketGoods.get(id)?.unreleased).not.toBe(true)
      expect([...ctx.marketGoods.values()].some(row => row.refId === id)).toBe(true)
    }
  })

  it('稀有度检查接纳真实市场外装备及舰船蓝图，仍拒绝伪造前缀与已删除键', () => {
    const file = new URL('../../../tools/content-check.ts', import.meta.url)
    const ast = ts.createSourceFile('content-check.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const block = ast.statements.find((node): node is ts.Block => ts.isBlock(node) && node.getText(ast).includes('const tableKeys = new Set(Object.keys(RARITY_TIER))'))!
    expect(block).toBeDefined()
    const declaration = block.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'blueprintIds'))!
    const loop = block.statements.find(node => ts.isForOfStatement(node) && node.getText(ast).includes('稀有度表多余键'))!
    expect(declaration).toBeDefined()
    expect(loop).toBeDefined()
    const bookIds = cases.flatMap(entry => [`bp-once-${entry.old}`, `bp-once-${entry.id}`])
    const stale = 'bp-once-plug-deleted-fixture'
    const ship = { id: 'sbp-off-market-fixture' }
    const failures: string[] = []
    runInNewContext(ts.transpileModule(`${declaration.getText(ast)}\n${loop.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      BLUEPRINTS, SHIP_BLUEPRINTS: [...SHIP_BLUEPRINTS, ship], refSet: new Set(), itemIds: new Set(),
      tableKeys: new Set([...bookIds, ship.id, stale]), check: (ok: boolean, message: string) => { if (!ok) failures.push(message) },
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain(stale)
    for (const id of bookIds) {
      expect(BLUEPRINTS.some(bp => bp.id === id)).toBe(true)
      expect(RARITY_TIER[id]).toBe(4)
    }
  })

  it.each(['zh', 'en'] as const)('%s新名称与说明按待译表回退中文，参数行来自字段且无残留槽', locale => {
    const local = buildSimContext(locale), view = display(locale)
    const pending = readFileSync(new URL('../../../docs/l10n-pending.md', import.meta.url), 'utf8')
    for (const entry of cases) {
      const mod = local.modules.get(entry.id)!
      for (const id of [entry.nameId, entry.descId]) {
        expect(L10N[id]).toMatchObject({ en: '', enDeferred: true })
        expect(pending).toContain(`| \`${id}\` |`)
      }
      expect(mod.name).toBe(L10N[entry.nameId]!.zh)
      expect(mod.description).toBe(L10N[entry.descId]!.zh)
      expect(mod.description).not.toMatch(/[0-9]/)
      for (const prefix of ['bp-', 'bp-once-']) expect(local.blueprints.get(`${prefix}${mod.id}`)!.name).toBe(ctx.blueprints.get(`${prefix}${mod.id}`)!.name)
      const rows = view.moduleInfoLines(mod)
      expect(rows.find(row => row.k === l10nEntryText(L10N['ui.shipInfo.076']!, locale))!.v).toBe(l10nEntryText(L10N['ui.factionPlug.007']!, locale))
      const text = rows.map(row => `${row.k}:${textOf(row.v)}`).join('|')
      expect(text).not.toMatch(/\b(?:ui|mod|bp)\.[A-Za-z]+\.\d{3}|\{\w+\}/)
      expect(view.moduleShortEffect(mod)).toContain(l10nEntryText(L10N['ui.factionPlug.007']!, locale))
      expect(view.moduleShortEffect(mod)).not.toContain(l10nEntryText(L10N['ui.shipInfo.179']!, locale))
    }
    // 改用非默认值，防止参数行只显示写死的已批准数字。
    const mods = (id: string) => MODULES.find(mod => mod.id === id)!
    const rows = (mod: core.ModuleDef) => view.moduleInfoLines(mod).map(row => `${row.k}:${textOf(row.v)}`).join('|')
    expect(rows({ ...mods(cases[0].id), damageManagement: { penaltyReductionPct: .7, hullResistPerKind: .04, maxKinds: 7 } })).toContain('70%')
    expect(rows({ ...mods(cases[0].id), damageManagement: { penaltyReductionPct: .7, hullResistPerKind: .04, maxKinds: 7 } })).toContain('4%')
    expect(rows({ ...mods(cases[1].id), armorCapacityPenaltyPct: .3, armorRegenPerSec: .009 })).toContain('0.9%')
    expect(rows(mods(cases[1].id))).toContain('1.0%')
    expect(rows({ ...mods(cases[2].id), chargedWeapons: { damageMul: 3, reloadMul: 4, falloffReductionPct: .6 } })).toMatch(/×3.*×4.*60%/)
    expect(rows({ ...mods(cases[3].id), droneCommand: { sharePct: .4, targetWeightPerM3: .02 } })).toMatch(/40%.*2%/)
    expect(rows({ ...mods(cases[4].id), hullCapacityBonusPct: .6 })).toContain('+60%')
    expect(rows(mods('mod-gravekeeper-crisis'))).toContain('75%')
    expect(textOf(view.moduleInfoLines(mods('mod-gravekeeper-crisis')).find(row => row.k === l10nEntryText(L10N['ui.gravekeeperGear.003']!, locale))!.v)).toContain(locale === 'zh' ? '战斗移动速度−40%' : 'combat movement speed −40%')
    expect(rows(mods('mod-lair-armor-c'))).toContain('10')
  })
})
