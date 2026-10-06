/**
 * 洞内产出链：母矿只收不卖，虚空晶2026-10-06改走限额慢补货；精炼半量保持。
 *
 * 船长原话：「**虚空晶和虚空母矿也添加只收不卖。**」＋「**市场不会出现虚空晶和母矿的卖单。**」
 * ＋「**然后精炼炉，虚空晶的产出量下调到一半**」＋（价格口径）「**价格不动。**」
 *
 * 口径（设计稿 `docs/design/void-chain-20260914.md`）：
 * - 市场母矿 `playerBuyable: false`；虚空晶出售上限3000枚、每6分钟补1枚。
 *   两者NPC收购照常；现行价格保持，虚空晶旧只收不卖部分已由新裁定覆盖。
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

describe('洞内产出链：母矿只收不卖、虚空晶限额慢补货，精炼半量保持', () => {
  it('数据口径：母矿只收不卖，虚空晶限额供应 · 精炼虚空晶 perOre = 0.25', () => {
    const { ctx } = world()
    for (const key of ['ore-voidmother', 'min-voidcrystal']) {
      const def = ctx.marketGoods.get(key)
      expect(def, `${key} 应有市场行`).toBeTruthy()
      if (key === 'ore-voidmother') expect(def!.playerBuyable).toBe(false)
      else {
        expect(def!.playerBuyable).not.toBe(false)
        expect(def!.limitedSupplyCap).toBe(3000)
      }
      // 2026-09-28 船长令「把虚空母矿排除在体积平衡」⇒ 市场行价回到原值 1,300（收购 ≈780）；
      // 2026-10-01 船长裁「甲」⇒ 虚空晶行情价 1,800 → **5,400**（与 items.ts 基准价一物一价，修"精炼显示亏本"）
      expect(def!.basePrice, `${key} 基础价`).toBe(key === 'ore-voidmother' ? 1_300 : 5_400)
    }
    const ore = ITEMS.find((i) => i.id === 'ore-voidmother')!
    const row = (ore.refine ?? []).find((r) => r.mineralId === 'min-voidcrystal')
    expect(row?.perOre, '虚空晶产出量 0.25（2026-09-14 船长：产出量下调到一半）').toBe(0.25)
    expect((ore.refine ?? []).find((r) => r.mineralId === 'min-isotope')?.perOre).toBe(1.0)
    expect((ore.refine ?? []).find((r) => r.mineralId === 'min-starcore')?.perOre).toBe(0.25)
    expect(ore.unitM3, '虚空母矿体积（排除在体积平衡之外 ⇒ 恒 1 m³/单位）').toBe(1)
  })

  /**
   * **精炼面板口径必须有正收益**（**2026-10-01 船长报障**：「**虚空母矿精炼虚空晶为什么是亏损**」）。
   *
   * 面板走 `yieldView.marginPctOf`：**两侧都按当前行情价**（取不到行情才回落物品基准价）。根因 = 虚空晶
   * 有两个价源且没同步（`items.ts` 09-15 抬到 3,600、`marketCatalog.ts` 仍是 1,800）⇒ 面板按 1,800 算，
   * 母矿按行情 1,300 算 ⇒ **显示 −56%**。船长裁「**甲**」= 一物一价 5,400。本条钉住这条口径，防止再漂。
   */
  it('精炼面板口径（按行情价算）：100 母矿 ⇒ 25 虚空晶 ＋ 100 同位聚晶 ＋ 25 星髓晶，**净额为正**', () => {
    const { ctx } = world()
    const ore = ITEMS.find((i) => i.id === 'ore-voidmother')!
    const mkt = (id: string): number => ctx.marketGoods.get(id)?.basePrice ?? ctx.items.get(id)?.baseSellPriceIsk ?? 0
    const batch = ore.refineBatchUnits ?? 100
    const cost = batch * mkt(ore.id)
    const value = (ore.refine ?? []).reduce((s, r) => s + batch * r.perOre * mkt(r.mineralId), 0)
    expect(cost, '料 = 100 母矿 × 行情 1,300').toBe(130_000)
    expect(value, '产物 = 25×5,400 ＋ 100×55 ＋ 25×245').toBe(146_625)
    expect(value - cost, '面板必须显示正收益').toBeGreaterThan(0)
  })

  it('市场簿面：母矿不铺卖单，虚空晶初始3000枚，两者照常收购', () => {
    const { state } = world()
    for (const key of ['ore-voidmother', 'min-voidcrystal']) {
      expect(bookQty(state.market.npcSell, key)).toBe(key === 'ore-voidmother' ? 0 : 3000)
      expect(bookQty(state.market.npcBuy, key), `${key} 应有 NPC 收购单`).toBeGreaterThan(0)
    }
    // 对照：普通原矿两侧都有（证明上一条不是"整个簿面都空"的假绿）
    expect(bookQty(state.market.npcSell, 'ore-veldspar')).toBeGreaterThan(0)
    expect(bookQty(state.market.npcBuy, 'ore-veldspar')).toBeGreaterThan(0)
    // 顺带修好的既有同类：只收不卖的洞内货柜也不该再挂卖单（改前开盘铺 2 件、买入被拦）
    expect(bookQty(state.market.npcSell, 'box-relic-a'), '只收不卖商品都不该有 NPC 卖单').toBe(0)
    expect(bookQty(state.market.npcBuy, 'box-relic-a')).toBeGreaterThan(0)
  })

  it('母矿买入与挂买单仍被拦；虚空晶可买入', () => {
    const { state, ctx } = world()
    expect(buyAtMarket(state, ctx, 'ore-voidmother', 1).blocked).toBe('not-buyable')
    state.wallet.isk = 10_000_000
    expect(buyAtMarket(state, ctx, 'min-voidcrystal', 1).bought).toBe(1)
    expect(placeBuyOrder(state, ctx, 'ore-voidmother', 1_000, 10), '只收不卖商品不开放玩家挂买单').toBeNull()
  })

  it('端到端精炼：100 单位母矿 ⇒ 虚空晶 = floor(100 × 0.25 × 精炼率)', () => {
    const { state, ctx } = world()
    addWare(state, 'ore-voidmother', 100)
    const rate = refineRate(state, ctx)
    const r = startRefineRun(state, 'ore-voidmother', 'pilot', ctx)
    expect(r.ok, r.error ?? '').toBe(true)
    state.gameMs = 120_000
    advanceRefining(state, ctx)
    const got = state.warehouse.items['min-voidcrystal'] ?? 0
    expect(got, `虚空晶产出应为 floor(100×0.25×${rate})`).toBe(Math.floor(100 * 0.25 * rate))
    // 副产物同回原值（同位聚晶 1.0 / 星髓晶 0.25）
    expect(state.warehouse.items['min-isotope'] ?? 0).toBe(Math.floor(100 * 1.0 * rate))
    expect(state.warehouse.items['min-starcore'] ?? 0).toBe(Math.floor(100 * 0.25 * rate))
  })
})
