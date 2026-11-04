import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as publicMarket from '../src/market'
import * as pricing from '../src/market/pricing'
import * as orders from '../src/market/orders'
import * as trading from '../src/market/trading'
import * as holdings from '../src/market/holdings'
import * as ships from '../src/market/ships'
import * as publicCatalog from '../../data/src/marketCatalog'
import * as catalog from '../../data/src/market/catalog'
import * as bindings from '../../data/src/market/bindings'
import document from '../../data/src/static/market.json'
import { tableOf } from '../../../tools/content-schema'
import { readImplementation } from '../../../tools/source-implementation'
import { ROOT } from './helpers/save-shell'

describe('市场域目录与兼容契约', () => {
  it('旧入口与实际实现保持同一函数和目录身份', () => {
    for (const module of [pricing, orders, trading, holdings, ships]) {
      for (const [name, value] of Object.entries(module)) {
        if (name in publicMarket) expect((publicMarket as Record<string, unknown>)[name], name).toBe(value)
      }
    }
    for (const name of ['MARKET_GOODS_RAW', 'MARKET_GOODS', 'buildMarketGoodsCatalog'] as const) {
      expect(publicCatalog[name], name).toBe(catalog[name])
    }
    expect(readImplementation(resolve(ROOT, 'packages/core/src/market.ts'))).toContain('function advanceMarket')
    expect(readImplementation(resolve(ROOT, 'packages/data/src/marketCatalog.ts'))).toContain('function buildMarketGoodsCatalog')
  })

  it('绑定精确覆盖JSON分组，新增修理机与原始目录保持原序', () => {
    const raw = document.groups.MARKET_GOODS_RAW_0
    const extra = document.groups.MARKET_GOODS_0
    expect([...Object.keys(bindings.MARKET_GOODS_RAW_0_TEXT_BINDINGS)]).toHaveLength(raw.length)
    expect([...Object.keys(bindings.MARKET_GOODS_0_TEXT_BINDINGS)]).toHaveLength(extra.length)
    for (const [rows, map] of [[raw, bindings.MARKET_GOODS_RAW_0_TEXT_BINDINGS], [extra, bindings.MARKET_GOODS_0_TEXT_BINDINGS]] as const) {
      expect(Object.keys(map).sort()).toEqual(rows.map(row => row.key).sort())
    }
    const added = new Set(['drone-repair-mil', 'bp-once-drone-repair-mil', 'bp-drone-repair-mil'])
    expect([...raw, ...extra].filter(row => !added.has(row.key))).toHaveLength(570)
    expect([...raw, ...extra].filter(row => row.key === 'drone-repair-mil')).toHaveLength(1)
    expect(catalog.MARKET_GOODS_RAW.map(row => row.key)).toEqual(raw.map(row => row.key))
    const offset = raw.length + publicCatalog.WRECK_BUY_GOODS.length
    expect(catalog.MARKET_GOODS.slice(offset, offset + extra.length).map(row => row.key)).toEqual(extra.map(row => row.key))
    const plugs = catalog.MARKET_GOODS.slice(offset + extra.length)
    expect(plugs).toHaveLength(34)
    expect(plugs.every(row => row.unreleased && (row.key.startsWith('plug-') || row.key.startsWith('bp-plug-')))).toBe(true)
    expect(catalog.MARKET_GOODS).toHaveLength(raw.length + extra.length + publicCatalog.WRECK_BUY_GOODS.length + plugs.length)
  })

  it('参数CLI登记实际绑定文件，虚空晶周期仍为代码表达式', () => {
    expect(tableOf('market')!.files).toEqual(['packages/data/src/market/bindings.ts'])
    const file = resolve(ROOT, tableOf('market')!.files[0]!)
    const text = readFileSync(file, 'utf8')
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    let fields: ts.ObjectLiteralExpression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) && node.name.text === 'min-voidcrystal') fields = node.initializer as ts.ObjectLiteralExpression
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(fields).toBeDefined()
    const every = fields!.properties.find((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && node.name.getText(ast) === 'limitedSupplyEveryMs')!
    expect(every).toBeDefined()
    expect(ts.isNumericLiteral(every.initializer)).toBe(false)
  })

  it('三个旧入口只有具名出口，新目录每份实现不超过800行', () => {
    for (const file of ['packages/core/src/market.ts', 'packages/data/src/marketCatalog.ts', 'apps/desktop/src/renderer/src/pages/MarketPage.tsx']) {
      const ast = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
      expect(ast.statements.length).toBeGreaterThan(0)
      expect(ast.statements.every(ts.isExportDeclaration), file).toBe(true)
    }
    for (const dir of ['packages/core/src/market', 'packages/data/src/market', 'apps/desktop/src/renderer/src/features/market']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        const file = resolve(ROOT, dir, name)
        expect(readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).length, file).toBeLessThanOrEqual(800)
      }
    }
  })
})
