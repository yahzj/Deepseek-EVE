/**
 * 挂单瞬间的簿面核对（2026-09-10 船长定：与现有簿面对冲的挂单必须立即成交）。
 *
 * 修复背景：撮合此前只在每 60 秒窗口跑一次，而「挂单买」表单默认预填的正是当前最佳供应价——
 * 玩家挂出与在售卖单**同价**的买单却不会成交（还要等窗口，届时簿面已带 ±2% 抖动重铺，常常长期不成交）。
 *
 * 覆盖：买单同价/高于卖价立即成交（按簿面价付费）、部分成交后剩余挂单、卖单侧对称、
 * 不冲撞的挂单维持原样（不吃簿、不掷越线骰、留在挂单表）。
 */
import { describe, expect, it } from 'vitest'
import type { MarketGoodDef, SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { ensureMarket, listSellHolding, placeBuyOrder } from '../src/market'
import { countWare } from '../src/inventory'
import { makeTestCtx } from './helpers'

/** 单一商品目录（key 与物品 id 一致，价格 100，池商品） */
const GOOD: MarketGoodDef = {
  key: 'it-min-a',
  kind: 'item',
  refId: 'min-a',
  rarity: 'common',
  basePrice: 100,
  poolTarget: 3_000,
  supplyFlow: 500,
}

interface World {
  state: GameState
  ctx: SimContext
  /** 清空簿面并铺入指定卖单（供应）与收购单；数量足够时用于精确断言 */
  seed: (opts: { asks?: Array<[number, number]>; bids?: Array<[number, number]> }) => void
}

function world(): World {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  state.wallet.isk = 10_000_000
  const ctx = makeTestCtx({ marketGoods: [GOOD] })
  ensureMarket(state, ctx, { openAtGameMs: 0 })
  const seed = (opts: { asks?: Array<[number, number]>; bids?: Array<[number, number]> }): void => {
    const mk = state.market
    const life = state.gameMs + 30 * 60_000
    mk.npcSell[GOOD.key]!.splice(0, mk.npcSell[GOOD.key]!.length)
    mk.npcBuy[GOOD.key]!.splice(0, mk.npcBuy[GOOD.key]!.length)
    for (const [price, qty] of opts.asks ?? []) mk.npcSell[GOOD.key]!.push({ price, qty, expiresAtGameMs: life })
    for (const [price, qty] of opts.bids ?? []) mk.npcBuy[GOOD.key]!.push({ price, qty, expiresAtGameMs: life })
  }
  return { state, ctx, seed }
}

describe('挂单瞬间吃簿（2026-09-10 船长定）', () => {
  it('买单挂价 = 在售卖单同价 → 挂出即成交（不再挂单等待）', () => {
    const { state, ctx, seed } = world()
    seed({ asks: [[120, 10]] })
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, GOOD.key, 120, 10)
    expect(order).not.toBeNull()
    expect(state.orders).toHaveLength(0) // 全部即时成交 → 不进挂单表
    expect(state.wallet.isk).toBe(wallet0 - 120 * 10) // 按簿面价付
    expect(countWare(state, 'min-a')).toBe(10) // 货已入库
    expect(state.logs.some((l) => l.text.includes('买单已即时成交'))).toBe(true)
  })

  it('买单挂价高于卖单 → 按簿面价成交（玩家不按自己的高价买单）', () => {
    const { state, ctx, seed } = world()
    seed({ asks: [[120, 4]] })
    const wallet0 = state.wallet.isk
    placeBuyOrder(state, ctx, GOOD.key, 200, 4)
    expect(state.wallet.isk).toBe(wallet0 - 120 * 4) // 付簿面 120，不是限价 200
    expect(countWare(state, 'min-a')).toBe(4)
  })

  it('买多吃少：即时吃掉簿面、剩余数量继续挂单等待（预扣：挂价 × 挂量）', () => {
    const { state, ctx, seed } = world()
    seed({ asks: [[120, 3]] })
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, GOOD.key, 120, 10)!
    expect(order.filled).toBe(3)
    expect(order.qty).toBe(7) // 剩余挂在簿上
    expect(state.orders).toHaveLength(1)
    expect(state.orders[0]!.qty).toBe(7)
    // 2026-09-11 预扣冻结：挂单即扣 120×10，成交 3 件核销 360，剩余 840 仍冻在这张单上
    expect(state.wallet.isk).toBe(wallet0 - 120 * 10)
    expect(order.escrowIsk).toBe(120 * 7)
    expect(state.logs.some((l) => l.text.includes('余 7 件挂单'))).toBe(true)
  })

  it('多档卖单：按价格从低到高吃（等价于吃穿便宜的档位）；挂价高于成交价时价差退回', () => {
    const { state, ctx, seed } = world()
    seed({ asks: [[130, 2], [120, 2], [140, 2]] })
    const wallet0 = state.wallet.isk
    placeBuyOrder(state, ctx, GOOD.key, 135, 5)
    // 吃 120×2 + 130×2（140 档超过限价不吃），余 1 件挂单
    // 预扣 135×5 = 675；成交 4 件核销 135×4 = 540、实付 500 ⇒ 价差 40 退回 ⇒ 净扣 635
    expect(state.wallet.isk).toBe(wallet0 - (135 * 5) + (135 * 4 - (120 * 2 + 130 * 2)))
    expect(state.orders[0]!.escrowIsk).toBe(135) // 剩余 1 件的预扣还冻着
    expect(countWare(state, 'min-a')).toBe(4)
    expect(state.orders[0]!.qty).toBe(1)
  })

  it('买价低于卖单（不冲撞）→ 不吃簿、不成交，按原样挂在簿上（钱已预扣）', () => {
    const { state, ctx, seed } = world()
    seed({ asks: [[120, 10]] })
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, GOOD.key, 100, 3)!
    expect(order.filled).toBe(0)
    expect(state.orders).toHaveLength(1)
    // 预扣：挂单即扣 100×3；钱不是没花掉，而是**冻在这张单上**
    expect(state.wallet.isk).toBe(wallet0 - 100 * 3)
    expect(order.escrowIsk).toBe(300)
    expect(countWare(state, 'min-a')).toBe(0)
    expect(state.logs.some((l) => l.text.includes('已挂买单'))).toBe(true)
  })

  it('卖单侧对称：挂价 = 收购单同价 → 挂出即成交（扣贸易税、托管释放）', () => {
    const { state, ctx, seed } = world()
    seed({ bids: [[95, 10]] })
    state.warehouse.items['min-a'] = 10
    const wallet0 = state.wallet.isk
    const r = listSellHolding(state, ctx, GOOD.key, 95, 10)
    expect(r.ok).toBe(true)
    expect(r.filled).toBe(10)
    expect(r.resting).toBe(0)
    expect(state.orders).toHaveLength(0)
    expect(state.escrowItems[GOOD.key] ?? 0).toBe(0) // 托管已释放
    expect(state.wallet.isk).toBe(wallet0 + (95 * 10 - Math.round(95 * 10 * 0.05))) // 5% 贸易税（按毛额取整）
  })

  it('卖价低于收购单：按挂价成交（既有口径不变——卖单按自己挂的价拿钱）', () => {
    const { state, ctx, seed } = world()
    seed({ bids: [[95, 10]] })
    state.warehouse.items['min-a'] = 10
    const wallet0 = state.wallet.isk
    listSellHolding(state, ctx, GOOD.key, 90, 10)
    expect(state.wallet.isk).toBe(wallet0 + (90 * 10 - Math.round(90 * 10 * 0.05)))
  })

  it('卖单挂价高于收购簿（不冲撞）→ 不成交、货留在托管、订单留在挂单表', () => {
    const { state, ctx, seed } = world()
    seed({ bids: [[95, 10]] })
    state.warehouse.items['min-a'] = 5
    const wallet0 = state.wallet.isk
    const r = listSellHolding(state, ctx, GOOD.key, 200, 5)
    expect(r.ok).toBe(true)
    expect(r.filled).toBe(0)
    expect(state.orders).toHaveLength(1)
    expect(state.escrowItems[GOOD.key] ?? 0).toBe(5)
    expect(state.wallet.isk).toBe(wallet0)
  })
})
