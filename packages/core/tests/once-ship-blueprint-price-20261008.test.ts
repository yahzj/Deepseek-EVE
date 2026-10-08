import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSimContext, SHIP_BLUEPRINTS } from '@whale/data'
import staticMarket from '../../data/src/static/market.json'
import { createInitialState } from '../src/state'
import { ensureMarket, buyLineOf } from '../src/market'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const root = fileURLToPath(new URL('../../../', import.meta.url))
const before = JSON.parse(execFileSync('git', ['show', '8fa06c5f:packages/data/src/static/market.json'], { cwd: root, encoding: 'utf8' })) as typeof staticMarket
const once = SHIP_BLUEPRINTS.filter(bp => bp.singleUse === true)

describe('全部一次性舰船蓝图基础价10%', () => {
  it('34张均按舰船市场锚价计算，图纸与市场行同值，皇带鱼停售保留', () => {
    expect(once).toHaveLength(34)
    for (const bp of once) {
      const ship = [...ctx.marketGoods.values()].find(g => g.kind === 'ship' && g.refId === bp.shipId)!
      expect(bp.priceIsk, bp.id).toBe(Math.round(ship.basePrice * .1))
      expect(ctx.marketGoods.get(bp.id)!.basePrice).toBe(bp.priceIsk)
    }
    expect(ctx.marketGoods.get('sbp-once-colossal')!.playerBuyable).toBe(false)
    expect(ctx.marketGoods.get('sbp-once-colossal')!.basePrice).toBe(64_000_000)
  })

  it('静态市场只改对应34条基价，其他图纸/商品/资格保持原值', () => {
    const priceMap = new Map(once.map(bp => [bp.id, bp.priceIsk]))
    let changed = 0
    for (const [group, rows] of Object.entries(staticMarket.groups)) {
      const old = before.groups[group as keyof typeof before.groups]
      expect(rows).toHaveLength(old.length)
      for (const [index, row] of rows.entries()) {
        const price = row.kind === 'blueprint' ? priceMap.get(row.refId) : undefined
        expect(row, row.key).toEqual(price === undefined ? old[index] : { ...old[index], basePrice: price })
        if (price !== undefined) changed++
      }
    }
    expect(changed).toBe(34)
  })

  it('已有NPC锁价、玩家库存与挂单往返不追改，新基准收购价读新参数', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 4 })
    const id = 'sbp-once-colossal'
    ensureMarket(s, ctx)
    s.blueprintStock[id] = 2
    s.market.npcBuy[id] = [{ price: 320_000_000, qty: 1, expiresAtGameMs: 1_000_000 }]
    const beforeOrders = structuredClone(s.orders)
    ensureMarket(s, ctx)
    expect(s.market.npcBuy[id]![0]!.price).toBe(320_000_000)
    expect(buyLineOf(s, ctx, id)).toBe(64_000_000)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.blueprintStock[id]).toBe(2)
    expect(back.orders).toEqual(beforeOrders)
    expect(back.market.npcBuy[id]![0]!.price).toBe(320_000_000)
  })
})
