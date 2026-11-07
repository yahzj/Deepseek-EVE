import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import { createInitialState, type GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { signalSpaceTextId } from '../src/explorationText'

const base = '../../../apps/desktop/src/renderer/src/features/industry/'
const read = (name: string) => readFileSync(new URL(base + name, import.meta.url), 'utf8')
const source = read('blueprintPolicy.tsx')
const ast = ts.createSourceFile('blueprintPolicy.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const scope = { exports: {} }
runInNewContext(ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, scope)
const policy = scope.exports as {
  factionPlugBlueprintKind: (ctx: SimContext, id: string) => 'single' | 'unavailable' | null
  manufacturingBlueprintVisible: (state: GameState, ctx: SimContext, id: string) => boolean
}
const ctx = buildSimContext()
const plugs = [...ctx.modules.values()].filter(mod => mod.slot === 'plug' && mod.blueprintExchangeDisabled)

describe('势力插件制造目录与获取提示', () => {
  it('10件势力插件只有一次性版本可获取，普通插件仍保留永久兑换目录', () => {
    const state = createInitialState({ nowWallMs: 0 })
    expect(plugs).toHaveLength(10)
    for (const plug of plugs) {
      const permanent = `bp-${plug.id}`, single = `bp-once-${plug.id}`
      expect(ctx.blueprints.has(permanent), permanent).toBe(true)
      expect(ctx.blueprints.has(single), single).toBe(true)
      expect(policy.factionPlugBlueprintKind(ctx, permanent)).toBe('unavailable')
      expect(policy.manufacturingBlueprintVisible(state, ctx, permanent)).toBe(false)
      expect(policy.factionPlugBlueprintKind(ctx, single)).toBe('single')
      expect(policy.manufacturingBlueprintVisible(state, ctx, single)).toBe(true)
    }
    for (const id of ['bp-plug-shield-plate', 'bp-turret-kin-1', 'unknown']) {
      expect(policy.factionPlugBlueprintKind(ctx, id)).toBeNull()
      expect(policy.manufacturingBlueprintVisible(state, ctx, id)).toBe(true)
    }
  })

  it.each(['learned', 'stock', 'running'] as const)('%s旧资产保留，状态变化后不使用静态缓存，判据不改状态', kind => {
    const id = `bp-${plugs[0]!.id}`
    const state = createInitialState({ nowWallMs: 0 })
    expect(policy.manufacturingBlueprintVisible(state, ctx, id)).toBe(false)
    if (kind === 'learned') state.learnedRecipes.push(id)
    if (kind === 'stock') state.blueprintStock[id] = 1
    if (kind === 'running') state.manufacturingRuns.push({ active: true, blueprintId: id } as GameState['manufacturingRuns'][number])
    const before = structuredClone(state)
    expect(policy.manufacturingBlueprintVisible(state, ctx, id)).toBe(true)
    expect(state).toEqual(before)
    state.learnedRecipes = []
    state.blueprintStock = {}
    state.manufacturingRuns = []
    expect(policy.manufacturingBlueprintVisible(state, ctx, id)).toBe(false)
  })

  it('两套列表在静态目录缓存之后使用同一个动态可见性判据，计数和子筛选不包含隐藏条目', () => {
    const classic = read('ManufacturingPanel.tsx'), hud = read('useIndustryHud.tsx')
    expect(classic).toContain('items.filter(it => manufacturingBlueprintVisible(state, engine.ctx, it.id))')
    expect(classic).toContain('const visible = availableItems')
    expect(classic).toContain('availableItems.some(')
    expect(hud).toContain('shelfRows.filter(row => manufacturingBlueprintVisible(state, ctx, row.id))')
    expect(hud).toContain('const shelfShown = availableShelfRows.filter(')
    expect(hud).toContain('shelfRows: availableShelfRows')
  })

  it.each(['zh', 'en'] as const)('%s真实卡片缺图分支：势力一次性跳信号空间，普通插件跳声望商店，门槛不足不跳转', locale => {
    const card = read('BlueprintCard.tsx')
    const ast = ts.createSourceFile('BlueprintCard.tsx', card, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let branch: ts.ConditionalExpression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isConditionalExpression(node) && node.condition.getText(ast) === 'blackMarketBlueprint') branch = node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(branch).toBeDefined()
    const code = ts.transpileModule(`result=(${branch!.getText(ast)})`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
    } }).outputText
    const render = (faction: boolean, unlocked: boolean) => {
      let signal = 0, shop = 0
      const bindings = { blackMarketBlueprint: false, plugBlueprint: !faction, whBlueprint: faction, whUnlocked: unlocked,
        whStanding: 0, WORMHOLE_SCAN_UNLOCK_STANDING: 40,
        tr: (id: string) => l10nEntryText(L10N[signalSpaceTextId(id)]!, locale),
        React: { createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children }) },
        handleGotoWormhole: () => { if (unlocked) signal++ }, onGotoPlugExchange: () => { shop++ },
        result: undefined as unknown,
      }
      runInNewContext(code, bindings)
      return { node: bindings.result as { props: { disabled?: boolean; onClick: () => void }; children: string[] }, counts: () => [signal, shop] }
    }
    const single = render(true, true)
    expect(single.node.children.join('')).toBe(l10nEntryText(L10N['ui.signalSpace.049']!, locale))
    expect(single.node.props.disabled).toBe(false)
    single.node.props.onClick()
    expect(single.counts()).toEqual([1, 0])
    const locked = render(true, false)
    expect(locked.node.props.disabled).toBe(true)
    locked.node.props.onClick()
    expect(locked.counts()).toEqual([0, 0])
    const ordinary = render(false, true)
    expect(ordinary.node.children.join('')).toBe(l10nEntryText(L10N['ui.IndustryPage.126']!, locale))
    ordinary.node.props.onClick()
    expect(ordinary.counts()).toEqual([0, 1])
    expect(card).toContain("factionPlugKind === 'single'")
    expect(card).toContain("&& factionPlugKind === null")
  })
})
