import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

type Node = { type: string; props: Record<string, any>; children: unknown[] }
const jsx = { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children }) }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'children' in value
  ? [value as Node, ...(value as Node).children.flatMap(nodes)] : []
function load(file: string, name: string, scope: Record<string, unknown>) {
  const ast = ts.createSourceFile(file, readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/' + file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!
  const context = { ...scope, exports: {}, result: undefined }
  runInNewContext(ts.transpileModule(fn.getText(ast) + `\nglobalThis.result=${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context)
  return context.result as unknown as (...args: any[]) => any
}

describe('三档弹药真实装配组件', () => {
  it.each(['zh', 'en'] as const)('%s三系各三档、真实设置/读数/保存，MK3不误亮基础弹按钮', locale => {
    const ctx = buildSimContext(locale), state = core.createInitialState({ nowWallMs: 0, seed: 7 })
    state.shipId = core.addShipToFleet(state, 'sh-hammerhead')
    state.fleet[state.shipId]!.fitted = { high: ['mod-turret-kin-1', 'mod-missile-1', 'mod-laser-1'], mid: [], low: [] }
    for (const type of ['kinetic', 'explosive', 'plasma']) state.warehouse.items[`ammo-${type}-3`] = 1000
    const tr = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (m, key: string) => String(params?.[key] ?? m))
    const view = load('pages/FitPage.tsx', 'AmmoTierSection', { ...core, React: jsx, tr, cmdText: () => '', fmt: String, DmgChip: 'DmgChip', DMG_LABEL: {},
      AMMO_TYPES: ['kinetic', 'explosive', 'plasma'] })
    const engine = { state, ctx, setAmmoTierAt: (type: core.DamageType, id: string | null, ship: string) => core.setAmmoTier(state, ctx, type, id, ship) }
    const render = () => nodes(view({ engine, target: state.shipId, onToast: () => {} }))
    expect(render().filter(n => n.props.className?.includes('app-fit-ammotier-opt') && n.type === 'button')).toHaveLength(9)
    for (const type of ['kinetic', 'explosive', 'plasma']) {
      const item = ctx.items.get(`ammo-${type}-3`)!
      const button = render().find(n => n.type === 'button' && n.children.includes(item.name))!
      expect(button.props.title).toContain('1000')
      button.props.onClick()
      const buttons = render().filter(n => n.type === 'button' && n.children.some(v => typeof v === 'string' && core.ammoTiersOf(ctx, type as core.DamageType).some(t => t.name === v)))
      expect(buttons.map(n => n.props['aria-pressed'])).toEqual([false, false, true])
      expect(state.fleet[state.shipId]!.ammoPref![type as core.DamageType]).toBe(item.id)
    }
    expect(core.loadSaveFile(core.serializeSaveFile(state)).state.fleet[state.shipId]!.ammoPref).toEqual(state.fleet[state.shipId]!.ammoPref)
  })
  it('普通市场与图鉴跳转均排除独占图纸，成品及旧商品跳转保留', () => {
    const ctx = buildSimContext()
    const jump = load('ui/marketJump.ts', 'handMarketKeyOf', { marketGoodOf: core.marketGoodOf })
    for (const type of ['kinetic', 'explosive', 'plasma']) {
      const bp = `bp-ammo-${type}-3`, item = `ammo-${type}-3`
      expect(core.marketTradingGoods(ctx).some(g => g.key === bp)).toBe(false)
      expect(jump(ctx, 'blueprints', bp)).toBeNull()
      expect(jump(ctx, 'items', item)).toBe(item)
      expect(jump(ctx, 'blueprints', `bp-ammo-${type}-2`)).toBe(`bp-ammo-${type}-2`)
    }
  })
  it('工业同一书架关闭不可出售入口、缺书时标明黑市来源，不把它当无市场渠道', () => {
    const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/panels/Industry.tsx'), 'utf8')
    expect(source).toContain("marketGoodOf(engine.ctx, 'blueprint', id)")
    expect(source).toContain('const noResale = marketGood?.playerSellable === false')
    expect(source).toContain('{!su && !noResale ? (')
    expect(source).toContain("tr(noResale ? 'ui.ammoMk3.002' : 'ui.Industry.012')")
    expect(source).toContain(') : blackMarketBlueprint ? (')
    expect(source).toContain("tr('ui.ammoMk3.001')")
  })
})
