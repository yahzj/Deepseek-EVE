import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { ensureMarket, marketQuote, marketTradingGoods } from '../src/market'
import { markedIds, toggleMark } from '../src/marks'
import type { GameState } from '../src/state'
import type { MarketGoodDef, SimContext } from '../src/types'

type Engine = { state: GameState; ctx: SimContext }
type Order = (engine: Engine, goods: MarketGoodDef[]) => MarketGoodDef[]

function functionsOf(path: string, names: string[]): string {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return source.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''),
  ).map(node => node.getText(source)).join('\n')
}

const scope = { exports: {} as { stockedFirst: Order; rareOrderRows: Order }, marketQuote, markedIds }
runInNewContext(ts.transpileModule([
  functionsOf('apps/desktop/src/renderer/src/ui/marks.tsx', ['pinMarked']),
  functionsOf('apps/desktop/src/renderer/src/pages/MarketPage.tsx', ['stockedFirst', 'rareOrderRows']),
  'exports.stockedFirst = stockedFirst; exports.rareOrderRows = rareOrderRows;',
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, scope)
const { stockedFirst, rareOrderRows } = scope.exports

function world(locale: 'zh' | 'en', stocked: boolean) {
  const ctx = buildSimContext(locale)
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  ensureMarket(state, ctx)
  const goods = marketTradingGoods(ctx)
  for (const good of goods) {
    // 限额供应会按独立余额重铺簿面，合成库存须同时设定余额。
    const limited = state.market.pools[good.key]?.limitedSupply
    if (limited) limited.remaining = stocked ? 1 : 0
    state.market.npcSell[good.key] = stocked && good.playerBuyable !== false ? [{
      price: good.basePrice, qty: 1, expiresAtGameMs: 60_000,
    }] : []
  }
  return { engine: { state, ctx }, goods }
}

const channels = [
  { rarity: 'common', first: 'ore-veldspar', firstStocked: 'ore-veldspar', inserted: ['mod-drone-launch-1', 'bp-drone-launch-1'] },
  { rarity: 'rare', first: 'jump-fuel', firstStocked: 'jump-fuel', inserted: ['mod-drone-launch-2', 'mod-laser-calibration-2', 'bp-drone-launch-2', 'bp-laser-calibration-2'] },
  { rarity: 'exotic', first: 'invasion-beacon', firstStocked: 'mod-pd-e-3', inserted: ['mod-drone-launch-3', 'mod-laser-calibration-3', 'bp-drone-launch-3', 'bp-laser-calibration-3'] },
] as const

describe.each(['zh', 'en'] as const)('%s 市场目录基础顺序', locale => {
  describe.each([false, true])('统一现货=%s，无收藏', stocked => {
    it.each(channels)('$rarity 新装备及蓝图不抢占原目录首位', channel => {
      const { engine, goods } = world(locale, stocked)
      expect(engine.state.marks.goods).toEqual([])
      const input = goods.filter(good => good.rarity === channel.rarity)
      const order = channel.rarity === 'common' ? stockedFirst : rareOrderRows
      const keys = order(engine, input).map(good => good.key)
      const first = stocked ? channel.firstStocked : channel.first
      expect(keys[0]).toBe(first)
      for (const key of channel.inserted) {
        expect(keys, key).toContain(key)
        expect(keys.indexOf(key), key).toBeGreaterThan(keys.indexOf(first))
      }
    })

    it('跨渠道搜索仍保持原目录顺序，窄化到同类装备时加速器排在同档无人机战术之后', () => {
      const { engine, goods } = world(locale, stocked)
      expect(stockedFirst(engine, goods)[0]?.key).toBe('ore-veldspar')
      for (const tier of [1, 2, 3]) {
        const ids = [`mod-drone-tac-${tier}`, `mod-drone-launch-${tier}`, `bp-drone-tac-${tier}`, `bp-drone-launch-${tier}`]
        const keys = stockedFirst(engine, goods.filter(good => ids.includes(good.key))).map(good => good.key)
        expect(keys).toHaveLength(ids.length)
        expect(keys.indexOf(ids[1]!)).toBeGreaterThan(keys.indexOf(ids[0]!))
        expect(keys.indexOf(ids[3]!)).toBeGreaterThan(keys.indexOf(ids[2]!))
      }
    })
  })
})

describe('市场现货与收藏优先保持', () => {
  it.each([stockedFirst, rareOrderRows])('有货先于无货，手动收藏仅置顶精确商品，取消后还原且不改输入', order => {
    const { engine, goods } = world('zh', false)
    const ids = ['mod-drone-tac-2', 'mod-drone-launch-2', 'bp-drone-launch-2']
    const input = goods.filter(good => ids.includes(good.key))
    const before = input.map(good => good.key)
    engine.state.market.npcSell['mod-drone-tac-2'] = [{ price: 455000, qty: 1, expiresAtGameMs: 60_000 }]
    expect(order(engine, input)[0]?.key).toBe('mod-drone-tac-2')
    expect(toggleMark(engine.state, engine.ctx, 'goods', 'mod-drone-launch-2').ok).toBe(true)
    expect(order(engine, input).map(good => good.key)).toEqual(['mod-drone-launch-2', 'mod-drone-tac-2', 'bp-drone-launch-2'])
    expect(engine.state.marks.goods).toEqual(['mod-drone-launch-2'])
    expect(input.map(good => good.key)).toEqual(before)
    toggleMark(engine.state, engine.ctx, 'goods', 'mod-drone-launch-2')
    expect(order(engine, input)[0]?.key).toBe('mod-drone-tac-2')
  })

  it('稀有列依旧有货奇货、其余有货、无货奇货、其余无货，收藏在最前', () => {
    const { engine, goods } = world('zh', false)
    const ids = ['mod-drone-launch-2', 'mod-laser-calibration-2', 'mod-drone-launch-3', 'mod-laser-calibration-3']
    const input = ids.map(id => goods.find(good => good.key === id)!)
    for (const id of ['mod-drone-launch-2', 'mod-drone-launch-3']) {
      engine.state.market.npcSell[id] = [{ price: 1, qty: 1, expiresAtGameMs: 60_000 }]
    }
    expect(rareOrderRows(engine, input).map(good => good.key)).toEqual([
      'mod-drone-launch-3', 'mod-drone-launch-2', 'mod-laser-calibration-3', 'mod-laser-calibration-2',
    ])
    toggleMark(engine.state, engine.ctx, 'goods', 'mod-laser-calibration-2')
    expect(rareOrderRows(engine, input)[0]?.key).toBe('mod-laser-calibration-2')
  })
})
