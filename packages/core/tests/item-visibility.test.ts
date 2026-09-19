/**
 * **未上线闸门 · 物品目录级**（2026-09-13 立 · **2026-09-14 虫洞上线后翻面**）。
 *
 * 背景（实测泄露）：市场卡标了 `unreleased` 只管得住 `ctx.marketGoods`（市场页/图鉴/挂单/任务/事件），
 * 而**工业页「可精炼资源」网格 / 舰船页 AI 精炼炉下拉 / 组装机材料提示 / 手册物品图鉴**
 * 都是直接扫 `ctx.items` 全目录的（判据 = 有没有精炼配方）——于是虚空母矿连卡带"虫洞"描述
 * 一起挂在玩家可见的工业页上。本文件钉住两条口径：
 *
 * ① **给玩家看的枚举走 `visibleItemDefs` / `itemReleased`**（`unreleased` 机制本身仍然有效——
 *    别的未上线内容照旧靠它挡）；② **引擎内部照用 `ctx.items` 全目录**（虫洞背包按体积换算、
 * 精炼扣料都不受影响）——"闸门"只挡展示面，不挡玩法。
 *
 * ⚠ **2026-09-14**：船长解除虫洞不可见 ⇒ 虚空母矿那条**从"必须挡住"翻成"必须可见"**
 * （见文件末那条用例的注释）；闸门语义本身由第二条用例继续守。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, buildSimContext } from '@whale/data'
import { itemReleased, visibleItemDefs } from '../src/inventory'
import { recycleProfileOf } from '../src/salvage'
import { WORMHOLE_ORE_ITEM_ID } from '../src/wormhole'

const ctx = buildSimContext()

describe('物品目录级可见性（2026-09-13 立闸 · 2026-09-14 虫洞上线后翻面）', () => {
  it('虚空母矿：**上线后给玩家看的目录里必须有它**（同日引擎全目录里当然也有）', () => {
    /**
     * ⚠ **2026-09-14 船长解闸**（「可以解除虫洞对玩家的不可见状态了」）：当年这条钉的是"虚空母矿
     * 挡在 `visibleItemDefs` 之外"，**现在翻成反向断言**——它必须在目录里（工业页「可精炼资源」/
     * AI 精炼炉下拉 / 组装机材料提示 / 手册物品图鉴都走同一份 `visibleItemDefs`）。
     * 泛用闸门语义（`itemReleased`）由下一条用例继续钉住，`unreleased` 机制本身没有退休。
     */
    const visibleIds = visibleItemDefs(ctx).map((d) => d.id)
    expect(visibleIds, '虚空母矿没进玩家可见目录').toContain(WORMHOLE_ORE_ITEM_ID)
    const ore = ctx.items.get(WORMHOLE_ORE_ITEM_ID)
    expect(ore, '物品目录里没有虚空母矿').toBeTruthy()
    expect(ore!.refine?.length ?? 0).toBeGreaterThan(0)
    expect(itemReleased(ore)).toBe(true)
    // 玩法面照旧：全目录里也在（虫洞按体积换算背包格、精炼扣料都读 ctx.items）
    expect(ctx.items.has(WORMHOLE_ORE_ITEM_ID)).toBe(true)
    expect(ore!.unitM3).toBe(1)
    expect(Object.keys(visibleItemDefs(ctx)).length).toBeGreaterThan(20) // 目录其余照旧
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

  /**
   * **洞内稀有残骸必须可见**（2026-09-15 三号修 · 船长报障「**精炼炉好像缺少虫洞的稀有残骸回收**」）。
   *
   * 根因：`data/src/context.ts` 给洞内件注册时留着施工期 `unreleased: true`（虫洞 2026-09-14 上线时
   * 漏摘这一个字段），而精炼炉「残骸回收」列表走**玩家可见目录**（`visibleItemDefs`）⇒
   * 打捞带回仓库的洞内稀有残骸**在回收列表里看不到**、高级箱开不了（手册物品图鉴同样看不到）。
   * 本用例钉两侧：**玩家可见目录里有它** ＋ **它确实是高级箱画像**（`recycleProfileOf(...).rare`）。
   */
  it('洞内稀有残骸（`wreck-rare-*-wh`）：在玩家可见目录里，且是高级箱画像', () => {
    const whWrecks = [...ctx.items.values()].filter((d) => d.id.startsWith('wreck-rare-') && d.id.endsWith('-wh'))
    expect(whWrecks.length, '一件洞内稀有残骸都没有（`context.ts` 的 13 组注册断了？）').toBe(5)
    const visibleIds = new Set(visibleItemDefs(ctx).map((d) => d.id))
    for (const def of whWrecks) {
      expect(itemReleased(def), `${def.id}（${def.name}）仍被闸门挡着`).toBe(true)
      expect(visibleIds.has(def.id), `${def.id} 不在玩家可见目录（精炼炉看不到它）`).toBe(true)
      expect(recycleProfileOf(ctx, def.id)?.rare, `${def.id} 不是高级箱画像（回收档位判错）`).toBe(true)
    }
  })
})
