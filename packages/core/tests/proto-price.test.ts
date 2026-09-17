/**
 * **异星原型装备的定价口径**（**2026-09-17 船长**：「**按照 MK3 的十五倍价格估算**」）。
 *
 * 由来：船长问「**异星装备的价格是否太低了？**」⇒ 取证读数（同槽 MK3 对照）显示两件工业件
 * **比它们取代的 MK3 还便宜**——采集器 +110% 卖 1.6M / MK3 +80% 卖 2.33M（每 +1% 效果 14,545 vs 29,125）·
 * 货舱 +180% 卖 1.5M / MK3 +140% 卖 2.4M（8,333 vs 17,143）；激光炮则本就大致合理（价 +25% ≈ 射程 +24%）。
 * 船长据此定一条**可复算的锚**：三件一律 = **同槽 MK3 行价 ×15**。
 *
 * 本件钉两件事：
 * ① **行价 = 同槽 MK3 行价 ×15**（±1% 容差，因 MK3 行价日后若调，这里要跟着走）；
 * ② **不连带改动**：三件仍是**奇货 + 声望 10 + 全价回收（demandMultiplier 1.0）+ 不可制造（无蓝图）**。
 *
 * ✅ 本文件不产生玩家可见文案。常驻读数：`npm run price:audit`（奇货原型件段）。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, SHIP_BLUEPRINTS, buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const goodOf = (refId: string) => MARKET_GOODS.find((g) => g.refId === refId)

/** 原型件 → 它要压过的同槽 MK3（×15 的基数） */
const PAIRS: ReadonlyArray<{ proto: string; mk3: string }> = [
  { proto: 'mod-miner-proto', mk3: 'mod-miner-3' },
  { proto: 'mod-cargo-proto', mk3: 'mod-cargo-3' },
  { proto: 'mod-laser-proto', mk3: 'mod-laser-3' },
]

describe('异星原型装备定价（2026-09-17 船长：MK3 ×15）', () => {
  it('① 三件行价 = 同槽 MK3 行价 ×15（±1%）', () => {
    for (const { proto, mk3 } of PAIRS) {
      const p = goodOf(proto)
      const m = goodOf(mk3)
      expect(p, `市场卡里应有 ${proto}`).toBeTruthy()
      expect(m, `市场卡里应有 ${mk3}`).toBeTruthy()
      const target = m!.basePrice! * 15
      const dev = Math.abs(p!.basePrice! - target) / target
      expect(dev, `${proto} 行价 ${p!.basePrice} 应 ≈ ${mk3} ${m!.basePrice} ×15 = ${Math.round(target)}`).toBeLessThan(0.01)
    }
  })

  it('② 不连带改动：仍奇货 · 声望 10 · 全价回收 · 不可制造（无蓝图）', () => {
    for (const { proto } of PAIRS) {
      const p = goodOf(proto)!
      expect(p.rarity, `${proto} 应仍是奇货`).toBe('exotic')
      expect(p.standingReq, `${proto} 声望应仍 10`).toBe(10)
      expect(p.demandMultiplier, `${proto} 应仍全价回收（1.0）`).toBe(1)
      // 不可制造：蓝图表里没有任何一张以它为产物
      const bp = SHIP_BLUEPRINTS.filter((b) => (b as { moduleId?: string }).moduleId === proto)
      expect(bp, `${proto} 不该有蓝图`).toHaveLength(0)
      // 玩家可见目录里在（奇货渠道会出供给单）
      expect(ctx.marketGoods.has(proto), `${proto} 应仍在玩家可见目录`).toBe(true)
    }
  })

  it('③ 抬价后不再"比被它取代的 MK3 便宜"（船长问的那条事实已翻转）', () => {
    for (const { proto, mk3 } of PAIRS) {
      expect(goodOf(proto)!.basePrice!, `${proto} 应显著贵过 ${mk3}`).toBeGreaterThan(goodOf(mk3)!.basePrice! * 10)
    }
  })
})
