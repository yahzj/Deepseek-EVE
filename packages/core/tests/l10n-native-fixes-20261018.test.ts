import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, firstChainText, localizeCtx, L10N, wreckGroupText } from '@whale/data'
import { FIRST_TASKS, firstTaskText, FRAGMENT_RECIPES, WRECK_GROUPS } from '../src/index'
import { ROOT } from './helpers/save-shell'

const renderer = resolve(ROOT, 'apps/desktop/src/renderer/src')
const cjk = /[\u3400-\u9fff]/
const zh = buildSimContext(), en = buildSimContext('en')

// 沿用界面专项的真实源码执行方式；只替换当前语言，不重载被测常量。
function declarations(file: string, names: string[], scope: Record<string, unknown>) {
  const ast = ts.createSourceFile(file, readFileSync(resolve(renderer, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const selected = ast.statements.filter(node => ts.isVariableStatement(node)
    ? node.declarationList.declarations.some(d => names.includes(d.name.getText(ast)))
    : ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text))
  const context = { exports: {}, ...scope, result: {} as Record<string, any> }
  runInNewContext(ts.transpileModule(selected.map(node => node.getText(ast).replace(/^export\s+/, '')).join('\n') + `\nglobalThis.result={${names.join(',')}}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context)
  return context.result
}

describe('设置英文实机遗漏回归', () => {
  it('全部成就名称和说明覆盖，任务同名、探索家顶档正确，元数据及中文对象不变', () => {
    expect(en.achievements).toHaveLength(83)
    expect(localizeCtx(zh, 'zh')).toBe(zh)
    for (const original of zh.achievements!) {
      const translated = en.achievements!.find(a => a.id === original.id)!
      expect(translated.name, original.id).not.toMatch(cjk)
      expect(translated.note, original.id).not.toMatch(cjk)
      expect(translated.name).not.toMatch(/\bui\.|\{/)
      expect(translated.note).not.toMatch(/\bui\.|\{/)
      expect({ ...translated, name: original.name, note: original.note }).toEqual(original)
      if (original.source.kind === 'task') {
        const taskId = original.source.taskId
        expect(translated.name).toBe(firstTaskText(FIRST_TASKS.find(task => task.id === taskId)!, 'en', 'title'))
      }
      if (original.source.kind === 'milestone') expect(translated.note).toContain(String(original.source.target))
    }
    expect(en.achievements!.find(a => a.id === 'ach-chain-explorer-5')!.name).toBe('Legendary Explorer')
    expect(en.achievements!.find(a => a.id === 'ach-chain-digger-4')!.name).toBe('Veteran Miner')
    expect(en.achievements!.find(a => a.id === 'ach-ironman-closed')!.note).toContain('frozen')
    expect(zh.achievements![0]!.name).toBe('第一次扫描')
    for (const task of FIRST_TASKS) if (task.chain) {
      expect(firstChainText(task.chain.id, 'zh')).toBe(task.chain.name)
      expect(firstChainText(task.chain.id, 'en')).not.toMatch(cjk)
    }
  })

  it('燃料配方各有正确名称，所有残骸组有英文成分，不改变配方或池参数', () => {
    expect(en.labRecipes.get('jump-fuel')!.name).toBe(en.items.get('jump-fuel')!.name)
    expect(en.labRecipes.get('jump-fuel-dense')!.name).toBe('Condensed Jump Fuel')
    expect(en.labRecipes.get('jump-fuel-dense')!.name).not.toBe(en.labRecipes.get('jump-fuel')!.name)
    for (const [id, recipe] of en.labRecipes) {
      expect(recipe.name).not.toMatch(cjk)
      expect({ ...recipe, name: zh.labRecipes.get(id)!.name }).toEqual(zh.labRecipes.get(id))
    }
    for (const group of WRECK_GROUPS) {
      expect(wreckGroupText(group.key, 'en', 'note'), group.key).toBeTruthy()
      expect(wreckGroupText(group.key, 'en', 'note')).not.toMatch(cjk)
      expect(wreckGroupText(group.key, 'zh', 'note')).toBeUndefined()
    }
  })

  it('同一批已加载标签在中英往返后实时取词，属性过滤仍与当前语言对应', () => {
    let locale: 'zh' | 'en' = 'zh'
    const tr = (id: string) => L10N[id]?.[locale] ?? id
    const targets: Record<string, string[]> = {
      'pages/MapPage.tsx': ['MAP_TABS', 'BELT_SORT_LABEL', 'WRECK_SORT_LABEL'],
      'pages/ShipPage.tsx': ['SHIP_TABS'],
      'pages/FitPage.tsx': ['RACK_FAMILIES', 'HP_KEY_LABEL', 'TYPE_SN'],
      'pages/IndustryPage.tsx': ['FURNACE_TABS', 'ORE_KIND_LABEL'],
      'panels/StarMap.tsx': ['LABEL_MODES'],
      'panels/Expedition.tsx': ['TASK_TABS', 'TASK_SORT_LABEL'],
      'panels/appSettings.tsx': ['KIND_LABEL', 'KIND_DESC'],
      'panels/Handbook.tsx': ['NAV', 'SEARCH_PLACEHOLDER', 'COUNT_UNIT', 'BP_MAIN', 'FILTER_LABEL', 'guideNotesOf', 'ruleGroupsOf'],
      'panels/PrologueScreen.tsx': ['checkLinesOf', 'diagLinesOf'],
      'panels/MilestoneTasks.tsx': ['CHAIN_UNITS'],
      'ui/shipInfo.tsx': ['DMG_LABEL', 'FIT_MAIN_HIDDEN_KEYS', 'COMBAT_BASE_KEYS'],
      'ui/spaceBg.ts': ['TILE_SETS'],
      'panels/SignalSpace.tsx': ['SIGNAL_TEXT', 'GRID_LEGEND'],
      'panels/Wormhole.tsx': ['SIGNAL_TEXT', 'GRID_LEGEND'],
    }
    const modules = Object.fromEntries(Object.entries(targets).map(([file, names]) => [file, declarations(file, names, { tr, futureTr: tr })]))
    const subclasses = declarations('ui/labelsText.ts', ['SHIP_SUBCLASS_ID', 'shipSubClassText'], { tr })
    for (const language of ['zh', 'en', 'zh', 'en'] as const) {
      locale = language
      for (const module of Object.values(modules)) {
        const strings = JSON.stringify(module, (_key, value) => typeof value === 'function' ? [...value()] : value)
        if (language === 'en') expect(strings).not.toMatch(cjk)
      }
      const info = modules['ui/shipInfo.tsx']!
      expect(info.DMG_LABEL.kinetic).toBe(tr('ui.BattleScreen.002'))
      expect(info.FIT_MAIN_HIDDEN_KEYS()).toContain(tr('ui.FitPage.049'))
      expect(info.COMBAT_BASE_KEYS().has(tr('ui.FitPage.001'))).toBe(true)
      for (const key of Object.keys(subclasses.SHIP_SUBCLASS_ID)) {
        const text = subclasses.shipSubClassText(key)
        expect(text).toBe(L10N[subclasses.SHIP_SUBCLASS_ID[key]]![language])
        if (language === 'en') expect(text).not.toMatch(cjk)
      }
    }
  })

  it('回收碎片数量取真实配方，无人机数量与中英文单位均正确', () => {
    let locale: 'zh' | 'en' = 'zh'
    const tr = (id: string, params: Record<string, number> = {}) =>
      (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (slot, key: string) => String(params[key] ?? slot))
    const view = declarations('ui/wreckFlavor.tsx', ['FRAG_THREAT', 'fragNeed', 'fragClause', 'recycleFeatureOf'], { tr, FRAGMENT_RECIPES })
    const maps = { mods: new Map(), items: new Map([['drone', { name: 'Drone', kind: 'drone' }]]), droneUnits: 10 }
    for (const language of ['zh', 'en'] as const) {
      locale = language
      const fragments = view.recycleFeatureOf({ lowSec: true, threat: 41 }, maps).generic.join(' ')
      for (const tier of [2, 3]) expect(fragments).toContain(String(Object.values(FRAGMENT_RECIPES).find(r => r.tier === tier)!.need))
      const drone = view.recycleFeatureOf({ lowSec: true, threat: 41, lairGear: ['drone'] }, maps).named[0]
      expect(drone).toBe(locale === 'zh' ? 'Drone ×10 架' : 'Drone x10')
      if (locale === 'en') expect(fragments).not.toMatch(cjk)
    }
  })

  it('仓库和手册稀有度共用词条，黑匣用途不误译成出售插件', () => {
    for (const file of ['ui/itemView.tsx', 'panels/Handbook.tsx']) {
      const source = readFileSync(resolve(renderer, file), 'utf8')
      expect(source).toContain("aria-label={tr('ui.itemView.001', { p1: c.rarity })}")
      expect(source).not.toContain('aria-label={`稀有度')
    }
    expect(L10N['item.gravekeeper.002']!.en).toContain('manufacture ship plugs or sold')
    expect(L10N['item.gravekeeper.002']!.en).not.toContain('sell ship plugs')
  })

  it('不再允许渲染模块顶层提前执行取词，包括对象/数组/集合内的缓存', () => {
    const leaks: string[] = []
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = resolve(dir, entry.name)
        if (entry.isDirectory()) { walk(file); continue }
        if (!/\.tsx?$/.test(file)) continue
        const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
        function visit(node: ts.Node) {
          if (ts.isFunctionLike(node)) return
          if (ts.isCallExpression(node) && ['tr', 'futureTr'].includes(node.expression.getText(ast))) leaks.push(`${file}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}`)
          ts.forEachChild(node, visit)
        }
        // 启动时立即显示的加载提示不是缓存标签；只约束模块变量初始化，类实例内部另有生命周期。
        for (const statement of ast.statements) if (ts.isVariableStatement(statement)) visit(statement)
      }
    }
    walk(renderer)
    expect(leaks).toEqual([])
  })
})
