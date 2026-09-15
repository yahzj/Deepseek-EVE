/**
 * 洞内产出链：虚空母矿 / 虚空晶 **只收不卖** ＋ 虚空晶产出量半量（2026-09-14 船长）。
 *
 * 船长原话：「**虚空晶和虚空母矿也添加只收不卖。**」＋「**市场不会出现虚空晶和母矿的卖单。**」
 * ＋「**然后精炼炉，虚空晶的产出量下调到一半**」＋（价格口径）「**价格不动。**」
 *
 * 口径（设计稿 `docs/design/void-chain-20260914.md`）：
 * - 市场两行 `playerBuyable: false`：**买不到**、**NPC 一笔卖单都不铺**（`market.seedCommonBook` 的门），
 *   但 **NPC 照常收购**（带回的母矿/晶体随时能卖）；价格一律不动；
 * - 精炼产出：虚空母矿 → 虚空晶 `perOre` **0.5 → 0.25**（副产物同位聚晶 1.0 / 星髓晶 0.25 不动）。
 */
import { describe, expect, it } from 'vitest'
import { ITEMS } from '@whale/data'
import { createInitialState, placeBuyOrder } from '../src/index'
import { addWare } from '../src/inventory'
import { advanceRefining, refineRate, startRefineRun } from '../src/industry'
import { buyAtMarket, ensureMarket } from '../src/market'
import { buildSimContext } from '@whale/data'

function world(): { state: ReturnType<typeof createInitialState>; ctx: ReturnType<typeof buildSimContext> } {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  ensureMarket(state, ctx)
  return { state, ctx }
}

/** NPC 簿面上的总量（卖单 = 玩家能买的；买单 = NPC 收购） */
function bookQty(book: Map<string, Array<{ qty: number }>> | Record<string, Array<{ qty: number }>>, key: string): number {
  const rows = book instanceof Map ? book.get(key) : book[key]
  return (rows ?? []).reduce((s, o) => s + o.qty, 0)
}

describe('洞内产出链（虚空母矿 / 虚空晶）只收不卖 ＋ 半量（2026-09-14 船长）', () => {
  it('数据口径：两条市场行只收不卖 · 精炼虚空晶 perOre = 0.25（副产物不动）', () => {
    const { ctx } = world()
    for (const key of ['ore-voidmother', 'min-voidcrystal']) {
      const def = ctx.marketGoods.get(key)
      expect(def, `${key} 应有市场行`).toBeTruthy()
      expect(def!.playerBuyable, `${key} 必须只收不卖`).toBe(false)
      // 价格口径：船长「价格不动」⇒ 基础价与收购倍率都保持原值
      expect(def!.basePrice, `${key} 基础价不动`).toBe(key === 'ore-voidmother' ? 1_300 : 1_800)
    }
    const ore = ITEMS.find((i) => i.id === 'ore-voidmother')!
    const row = (ore.refine ?? []).find((r) => r.mineralId === 'min-voidcrystal')
    expect(row?.perOre, '虚空晶产出量 0.25（原 0.5 的一半）').toBe(0.25)
    expect((ore.refine ?? []).find((r) => r.mineralId === 'min-isotope')?.perOre).toBe(1.0)
    expect((ore.refine ?? []).find((r) => r.mineralId === 'min-starcore')?.perOre).toBe(0.25)
  })

  it('市场簿面：两条 **一笔 NPC 卖单都不铺**，但**照常收购**（对照组：普通原矿两侧都有单）', () => {
    const { state } = world()
    for (const key of ['ore-voidmother', 'min-voidcrystal']) {
      expect(bookQty(state.market.npcSell, key), `${key} 不该有 NPC 卖单`).toBe(0)
      expect(bookQty(state.market.npcBuy, key), `${key} 应有 NPC 收购单`).toBeGreaterThan(0)
    }
    // 对照：普通原矿两侧都有（证明上一条不是"整个簿面都空"的假绿）
    expect(bookQty(state.market.npcSell, 'ore-veldspar')).toBeGreaterThan(0)
    expect(bookQty(state.market.npcBuy, 'ore-veldspar')).toBeGreaterThan(0)
    // 顺带修好的既有同类：只收不卖的洞内货柜也不该再挂卖单（改前开盘铺 2 件、买入被拦）
    expect(bookQty(state.market.npcSell, 'box-relic-a'), '只收不卖商品都不该有 NPC 卖单').toBe(0)
    expect(bookQty(state.market.npcBuy, 'box-relic-a')).toBeGreaterThan(0)
  })

  it('买入被拦（not-buyable）；玩家挂买单亦被拦 —— 现状口径（船长若要放开，改 placeBuyOrder 那条门）', () => {
    const { state, ctx } = world()
    expect(buyAtMarket(state, ctx, 'ore-voidmother', 1).blocked).toBe('not-buyable')
    expect(buyAtMarket(state, ctx, 'min-voidcrystal', 1).blocked).toBe('not-buyable')
    state.wallet.isk = 10_000_000
    expect(placeBuyOrder(state, ctx, 'ore-voidmother', 1_000, 10), '只收不卖商品不开放玩家挂买单').toBeNull()
  })

  it('端到端精炼：100 单位母矿 ⇒ 虚空晶 = floor(100 × 0.25 × 精炼率)（半量生效）', () => {
    const { state, ctx } = world()
    addWare(state, 'ore-voidmother', 100)
    const rate = refineRate(state, ctx)
    const r = startRefineRun(state, 'ore-voidmother', 'pilot', ctx)
    expect(r.ok, r.error ?? '').toBe(true)
    state.gameMs = 120_000
    advanceRefining(state, ctx)
    const got = state.warehouse.items['min-voidcrystal'] ?? 0
    expect(got, `虚空晶产出应为 floor(100×0.25×${rate})`).toBe(Math.floor(100 * 0.25 * rate))
    // 副产物照旧（同位聚晶 1.0 / 星髓晶 0.25）
    expect(state.warehouse.items['min-isotope'] ?? 0).toBe(Math.floor(100 * 1.0 * rate))
    expect(state.warehouse.items['min-starcore'] ?? 0).toBe(Math.floor(100 * 0.25 * rate))
  })
})
