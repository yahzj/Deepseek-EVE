/**
 * **洞内非商品**（2026-09-14 船长报障 → 修复后加的守卫）：谜质储存器 / AI 核心实物 / 洞内货柜
 * 在市场里的可见性与可买性。
 *
 * 背景（值得记住）：这批卡原先是"补卡 + `unreleased` 施工期闸门"，注释写着「上线动作 = 删这个字段」；
 * 上线那批照注释删了 ⇒ 它们成了 `rarity: 'common'` 的**常驻现货**，市场按"单件平价品"铺供应单
 * （价 = `basePrice 1` ×1.06 ≈ **1 信用点**）⇒ 1 块钱就能买走谜质储存器/货柜/AI 核心实物。
 * 船长原话：「**谜质出现在了市场内，还有一些虫洞专属产物也出现在市场内并且可以购买**」＋
 * 「**AI核心已经存在了**」＋「谜质则不一样，**需要设置不出现在市场**」。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { buyAtMarket } from '../src/market'
import { WORMHOLE_CORE_ITEM_IDS } from '../src/wormholeSalvage'
import { WORMHOLE_MATTER_DEVICE_IDS } from '../src/wormholeMatter'

const ctx = buildSimContext()

/** 跑一段市场时间（供应单按窗口铺），再试买 */
function freshMarket(): ReturnType<typeof createInitialState> {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  state.wallet.isk = 1_000_000_000_000
  for (let i = 0; i < 40; i++) advanceGame(state, 30_000, ctx, { nowWallMs: 0 })
  return state
}

describe('虫洞 · 洞内非商品（市场可见性）', () => {
  it('① 谜质储存器与 AI 核心实物**不在市场目录**（玩家看不到也买不到）', () => {
    expect(WORMHOLE_MATTER_DEVICE_IDS.length).toBeGreaterThan(0)
    expect(WORMHOLE_CORE_ITEM_IDS.length).toBeGreaterThan(0)
    for (const id of [...WORMHOLE_MATTER_DEVICE_IDS, ...WORMHOLE_CORE_ITEM_IDS]) {
      expect(ctx.marketGoods.get(id), `${id} 不该出现在市场目录`).toBeUndefined()
    }
    // 试买也买不到（目录里没有 ⇒ 报"没现货"，不会成交）
    const state = freshMarket()
    for (const id of ['mat-chrono', 'mat-drone-net', ...WORMHOLE_CORE_ITEM_IDS]) {
      const r = buyAtMarket(state, ctx, id, 1)
      expect(r.bought, `${id} 不该买得到`).toBe(0)
    }
  })

  it('② 洞内货柜：在目录里、**只收不卖**、且有像样的价（不是 1 信用点）', () => {
    const boxes = ['box-relic-a', 'box-relic-c', 'box-relic-d', 'box-relic-e', 'box-relic-g', 'box-bp-shallow', 'box-bp-mid', 'box-bp-deep']
    for (const key of boxes) {
      const good = ctx.marketGoods.get(key)
      expect(good, `${key} 应有市场行`).toBeDefined()
      expect(good!.playerBuyable, `${key} 必须只收不卖`).toBe(false)
      expect(good!.basePrice ?? 0, `${key} 的基础价不能是 1 信用点`).toBeGreaterThan(1_000_000)
    }
    // 层档越高箱越值钱（浅 < 中 < 深）
    const shallow = ctx.marketGoods.get('box-bp-shallow')!.basePrice!
    const mid = ctx.marketGoods.get('box-bp-mid')!.basePrice!
    const deep = ctx.marketGoods.get('box-bp-deep')!.basePrice!
    expect(mid).toBeGreaterThan(shallow)
    expect(deep).toBeGreaterThan(mid)
  })

  it('③ 货柜买不到（`not-buyable`），但**能卖给收购单**（挂卖可达口径不受影响）', () => {
    const state = freshMarket()
    for (const key of ['box-relic-a', 'box-bp-deep']) {
      const r = buyAtMarket(state, ctx, key, 1)
      expect(r.bought, `${key} 不该买得到`).toBe(0)
      expect(r.blocked).toBe('not-buyable')
    }
    // 只收不卖的商品在收购侧照常（`playerSellable` 未动 ⇒ 挂卖可达契约的另一半仍成立）
    for (const key of ['box-relic-a', 'box-bp-deep']) {
      expect(ctx.marketGoods.get(key)!.playerSellable).not.toBe(false)
    }
  })
})
