/**
 * **未上线闸门 · 物品目录级**（2026-09-13 补 · 船长铁律「数据走 `unreleased` 闸门」）。
 *
 * 背景（实测泄露）：市场卡标了 `unreleased` 只管得住 `ctx.marketGoods`（市场页/图鉴/挂单/任务/事件），
 * 而**工业页「可精炼资源」网格 / 舰船页 AI 精炼炉下拉 / 组装机材料提示 / 手册物品图鉴**
 * 都是直接扫 `ctx.items` 全目录的（判据 = 有没有精炼配方）——于是虚空母矿连卡带"虫洞"描述
 * 一起挂在玩家可见的工业页上。本文件钉住修好后的两条口径：
 *
 * ① **给玩家看的枚举走 `visibleItemDefs` / `itemReleased`**，未上线物品不进；
 * ② **引擎内部照用 `ctx.items` 全目录**（虫洞背包按体积换算、精炼扣料都不受影响）——
 *    "闸门"只挡展示面，不挡玩法，否则会把洞内那条线一起弄坏。
 *
 * ⚠ 施工期铁律：本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, buildSimContext } from '@whale/data'
import { itemReleased, visibleItemDefs } from '../src/inventory'
import { WORMHOLE_ORE_ITEM_ID } from '../src/wormhole'

const ctx = buildSimContext()

describe('未上线闸门 · 物品目录级（2026-09-13）', () => {
  it('虚空母矿：**给玩家看的目录里没有它、引擎全目录里还有它**', () => {
    // ① 展示面：挡在 visibleItemDefs 之外（工业页可精炼资源 / AI 精炼炉下拉 / 组装机提示 / 手册图鉴都走这里）
    const visibleIds = visibleItemDefs(ctx).map((d) => d.id)
    expect(visibleIds).not.toContain(WORMHOLE_ORE_ITEM_ID)
    // 且它本来有资格进那些列表（有精炼配方）——证明"没进"是闸门挡的，不是它自己不合格
    const hidden = ctx.items.get(WORMHOLE_ORE_ITEM_ID)
    expect(hidden, '物品目录里没有虚空母矿').toBeTruthy()
    expect((hidden!.refine?.length ?? 0)).toBeGreaterThan(0)
    expect(itemReleased(hidden)).toBe(false)
    // ② 玩法面：全目录照旧（虫洞按体积换算背包格、精炼扣料都读 ctx.items）
    expect(ctx.items.has(WORMHOLE_ORE_ITEM_ID)).toBe(true)
    expect(hidden!.unitM3).toBe(1)
    expect(Object.keys(visibleItemDefs(ctx)).length).toBeGreaterThan(20) // 目录其余照旧可见
  })

  it('`itemReleased` 语义：没标 = 可见；标了 = 不可见；查不到 = 不可见', () => {
    expect(itemReleased({})).toBe(true)
    expect(itemReleased({ unreleased: false })).toBe(true)
    expect(itemReleased({ unreleased: true })).toBe(false)
    expect(itemReleased(undefined)).toBe(false)
    expect(itemReleased(null)).toBe(false)
  })

  it('两道闸门必须同步：物品标了未上线 ⇒ 它的市场卡也必须标（否则"列表里看不见、市场却能买"）', () => {
    const marketOf = new Map(MARKET_GOODS.filter((g) => g.kind === 'item').map((g) => [g.refId, g]))
    for (const def of ctx.items.values()) {
      if (itemReleased(def)) continue
      const good = marketOf.get(def.id)
      if (!good) continue // 无市场卡（残骸等）：只有物品闸门这一道，够了
      expect(good.unreleased, `${def.id}（${def.name}）物品卡标了未上线，市场卡却没标`).toBe(true)
    }
  })
})
