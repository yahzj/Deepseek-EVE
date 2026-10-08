import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, BLUEPRINTS, L10N, l10nEntryText } from '@whale/data'
import { createInitialState } from '../src/state'
import { gateMainActivity, ACTIVITY_LABEL_ID, HALT_COST_ID } from '../src/activityGate'
import { fitModule, swapModuleAt } from '../src/equipment'
import { goStandbyAt, originGalaxyOf } from '../src/location'
import { installPlug, exchangePlugBlueprint, exchangeUniversalBlackBox } from '../src/plugs'
import { learnBlueprint, marketSellPreview, marketSellHolding, listSellHolding } from '../src/market'
import { claimFirstTask } from '../src/firstRewards'
import { signalSpaceTextId } from '../src/explorationText'

const path = new URL('../../../apps/desktop/src/renderer/src/i18n/locale.tsx', import.meta.url)
const source = ts.createSourceFile('locale.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['interpolate', 'textOf', 'tr', 'futureTr', 'paramText', 'resolveParamIds', 'cmdText'])
const code = source.statements.filter((n) => ts.isFunctionDeclaration(n) && names.has(n.name?.text ?? ''))
  .map((n) => n.getText(source)).join('\n')
function renderer(locale: 'zh' | 'en') {
  const bindings = { L10N, l10nEntryText, signalSpaceTextId, activeLocale: locale, exports: {} }
  runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, bindings)
  return bindings.exports as { cmdText: (r: any) => string; paramText: (v: string | number | undefined) => string }
}

describe('弹出提示真实参数取词', () => {
  it.each(['zh', 'en'] as const)('%s 长途运输首击警告不漏 ui.MapPage.006、不改确认判据', (locale) => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.hauling.active = true
    const before = JSON.stringify(state)
    const verdict = gateMainActivity(state, 'mining')
    expect(verdict.action).toBe('confirm')
    expect(verdict.messageId).toBe('core.activityGate.002')
    expect(JSON.stringify(state)).toBe(before)
    const text = renderer(locale).cmdText({ errorId: verdict.messageId, errorParams: verdict.messageParams, error: verdict.message })
    expect(text).toContain(L10N['ui.MapPage.006']![locale])
    expect(text).toContain(L10N['core.activity.009']![locale])
    expect(text).not.toMatch(/(?:ui|core)\.[\w.]+|\{\w+\}/)
  })
  it.each(['zh', 'en'] as const)('%s 所有活动id按登记取词，普通文本/未知id/数字仍保持', (locale) => {
    const r = renderer(locale)
    for (const id of [...Object.values(ACTIVITY_LABEL_ID), ...Object.values(HALT_COST_ID)]) {
      expect(r.paramText(id)).toBe(L10N[signalSpaceTextId(id)]![locale])
    }
    expect(r.paramText('ui.missing.999')).toBe('ui.missing.999')
    expect(r.paramText('ordinary text')).toBe('ordinary text')
    expect(r.paramText(12)).toBe('12')
    expect(r.paramText(undefined)).toBe('')
    expect(r.cmdText({ error: 'original' })).toBe('original')
    expect(r.cmdText({ errorId: 'core.market.001' })).toContain('{p1}')
  })
})

describe('真实错误入口不漏模板参数', () => {
  it.each(['zh', 'en'] as const)('%s 装配/换装/星系/市场/任务/插件失败包含真实参数、不扣账', (locale) => {
    const ctx = buildSimContext(locale)
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.moduleBay = {}
    const gun = [...ctx.modules.values()].find((m) => m.slot === 'turret')!
    const plug = [...ctx.modules.values()].find((m) => m.slot === 'plug')!
    const unseen = [...ctx.galaxies.keys()].find((id) => !state.exploredGalaxies.includes(id))!
    const r = renderer(locale)
    const fixtures: Array<[string, () => any]> = [
      [gun.name, () => fitModule(state, gun.id, ctx)],
      [gun.name, () => swapModuleAt(state, gun.id, ctx, { rack: 'high', index: 0 })],
      [plug.name, () => fitModule(state, plug.id, ctx)],
      ['missing-module', () => fitModule(state, 'missing-module', ctx)],
      ['missing-blueprint', () => learnBlueprint(state, ctx, 'missing-blueprint')],
      ['missing-good', () => marketSellHolding(state, ctx, 'missing-good', 1)],
      ['missing-good', () => marketSellPreview(state, ctx, 'missing-good', 1)],
      ['missing-good', () => listSellHolding(state, ctx, 'missing-good', 1, 1)],
      ['missing-task', () => claimFirstTask(state, ctx, 'missing-task')],
      [ctx.galaxies.get(unseen)!.name, () => goStandbyAt(state, unseen, ctx)],
      [ctx.galaxies.get(originGalaxyOf(state, ctx))!.name, () => goStandbyAt(state, originGalaxyOf(state, ctx), ctx)],
      [gun.name, () => installPlug(state, ctx, gun.id)],
      [plug.name, () => installPlug(state, ctx, plug.id)],
      ['30', () => exchangeUniversalBlackBox(state)],
    ]
    const bp = BLUEPRINTS.find((b) => b.moduleId === plug.id)!
    const plugCtx = { ...ctx, blueprints: new Map(ctx.blueprints).set(bp.id, bp) }
    fixtures.push(['8', () => exchangePlugBlueprint(state, plugCtx, plug.id)])
    const accounts = () => JSON.stringify({ wallet: state.wallet, warehouse: state.warehouse, modules: state.moduleBay,
      standings: state.standings, learned: state.learnedRecipes, mining: state.mining, hauling: state.hauling,
      orders: state.orders, plugs: state.fleet[state.shipId]?.plugs })
    for (const [expected, run] of fixtures) {
      const before = accounts()
      const result = run()
      expect(result.ok).toBe(false)
      const rendered = r.cmdText(result)
      expect(rendered).toContain(expected)
      expect(rendered).not.toMatch(/\{\w+\}|(?:ui|core)\.[\w.]+/)
      expect(accounts()).toBe(before)
    }
  })
})

describe('基本错误参数护栏', () => {
  it('执行实际检查器AST，旧漏参报红、合法基本/槽译文参数通过、变量不误报', () => {
    const text = readFileSync(new URL('../../../tools/param-miss-check.ts', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('param-miss-check.ts', text, ts.ScriptTarget.Latest, true)
    const start = ast.statements.findIndex((n) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(ast) === 'errorFindings'))
    const loop = ast.statements[start + 1]!
    const scanner = `${ast.statements[start]!.getText(ast)}\n${loop.getText(ast)}\nglobalThis.result = errorFindings`
    const examples = [
      "return {errorId:'core.equipment.002'}",
      "return {errorId:'core.equipment.002',errorParams:{p1:'Name'}}",
      "return {errorId:'core.equipment.002',errorParams:{p1Id:'ui.MapPage.006'}}",
      "return {errorId:'core.equipment.002',errorParams:params}",
      "return {errorId:'core.plug.010',errorParams:{p1:'Name',p2:8}}",
    ]
    for (const [index, example] of examples.entries()) {
      const scope = { ts, L10N, CORE_ROOTS: ['root'], walk: () => ['sample.ts'], readFileSync: () => example,
        relative: () => 'sample.ts', process: { cwd: () => '' }, result: [] as unknown[] }
      runInNewContext(ts.transpileModule(scanner, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
      expect(scope.result.length, example).toBe(index === 0 || index === 4 ? 1 : 0)
    }
  })
})

describe('提示文案与实际显示上下文', () => {
  it('实际手册说明在同一模块内切换语言后重取奇货两条译文', () => {
    const text = readFileSync(new URL('../../../apps/desktop/src/renderer/src/panels/Handbook.tsx', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('Handbook.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'guideGroupsOf')!
    let locale: 'zh' | 'en' = 'zh'
    const scope = { tr: (id: string) => L10N[id]![locale], result: undefined }
    runInNewContext(ts.transpileModule(`${fn.getText(ast)}\nglobalThis.result = guideGroupsOf`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    for (const next of ['zh','en','zh'] as const) {
      locale = next
      const groups = (scope.result as unknown as () => any[])()
      const paras = groups.flatMap((g) => g.entries.flatMap((e: any) => e.paras.map((p: string[]) => p[1])))
      expect(paras).toContain(L10N['ui.Handbook.154']![locale])
      expect(paras).toContain(L10N['ui.Handbook.155']![locale])
    }
  })
  it('奇货误译清单全部不含Enigma，真正谜质词条保留', () => {
    for (const id of ['022','028','065','066','068','069','098','100','104','109','136','156']) {
      expect(L10N[`ui.MarketPage.${id}`]!.en).not.toContain('Enigma')
    }
    for (const id of ['154','155']) expect(L10N[`ui.Handbook.${id}`]!.en).not.toContain('Enigma')
    expect(L10N['ui.Handbook.314']!.en).toContain('Enigma')
    expect(L10N['ui.MatterTechTab.005']!.en).toContain('Enigma')
  })
  it('真实无人机提示入口使用已有战后补货词条，碎片说明不承诺不重复掉落', () => {
    const text = readFileSync(new URL('../../../apps/desktop/src/renderer/src/ui/itemView.tsx', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('itemView.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'kindExtraNote')!
    for (const locale of ['zh','en'] as const) {
      const scope = { tr: (id: string) => L10N[id]![locale], exports: {} }
      runInNewContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
      expect((scope.exports as any).kindExtraNote('drone')).toBe(L10N['ui.itemView.004']![locale])
      expect(L10N['ui.ItemsPage.014']![locale]).not.toMatch(/卸|unload/i)
      expect(L10N['ui.MarketPage.026']![locale]).toMatch(/蓝图书架|Blueprint Library/)
    }
    expect(L10N['ui.itemView.003']!.zh).not.toContain('集齐前不会重复')
    expect(L10N['ui.itemView.003']!.zh).toContain('已学会对应蓝图')
  })
  it.each(['zh','en'] as const)('%s 实际市场标题保留搜索、领域、类别、槽位、功能全部条件', (locale) => {
    const text = readFileSync(new URL('../../../apps/desktop/src/renderer/src/pages/MarketPage.tsx', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('MarketPage.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let expression: ts.Expression | undefined
    function visit(n: ts.Node): void {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(ast) === 'MarketColumn') {
        const title = n.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(ast) === 'title')
        if (title?.initializer && ts.isJsxExpression(title.initializer) && title.initializer.expression?.getText(ast).includes('ui.hintAudit.002')) expression = title.initializer.expression
      }
      ts.forEachChild(n, visit)
    }
    visit(ast)
    expect(expression).toBeDefined()
    const scope = { tr: (id: string, p?: Record<string,string>) => (L10N[id]?.[locale] ?? id).replace('{p1}',p?.p1??''),
      query:'turret',kw:'turret',kind:'items',DOMAIN_ALL:'all',SUB_ALL:'sub-all',domainText:{items:locale==='zh'?'物品':'Items'},
      sub:'module',rack:'high',detail:'weapon',kindSubs:[{key:'module',label:'Equipment'}],rackOptions:[{key:'high',label:'High-slot modules'}],detailOptions:[{key:'weapon',label:'Weapons'}],
      subText:(s:{label:string})=>s.label,itemNameOf:()=>'',result:'' }
    runInNewContext(ts.transpileModule(`globalThis.result = ${expression!.getText(ast)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    expect(scope.result).toContain('turret')
    expect(scope.result).toContain('Equipment')
    expect(scope.result).toContain('High-slot modules')
    expect(scope.result).toContain('Weapons')
    expect(scope.result).not.toContain('全部')
  })
})
