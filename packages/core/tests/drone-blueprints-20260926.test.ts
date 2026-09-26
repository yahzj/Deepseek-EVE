/**
 * **制式无人机永久图纸（船长 2026-09-26 四条令）** —— 本文件钉五件事：
 *
 * 1. **永久性**：四条可学习、不限次（`singleUse` 缺省 ⇒ 不是"一次性图纸"），产物 = 制式四型无人机。
 * 2. **批产 100 架**（船长令「按照100架的批次」）。
 * 3. **书价口径**（船长令「**书价应该参考弹药的书价格，因为都是消耗品**」）：
 *    四条 = **一单（100 架）货值 ×2**，与 `blueprintTierCoefOf` 的「民用/基础档 ×2」同值
 *    （⇒ 未登记 `BLUEPRINT_PRICE_OVERRIDES`，走机械规则）。
 *    ⚠ 同日稍晚船长改的是**弹药 MK2 图纸**自己（100 批货值）并明确「**不套无人机**」⇒
 *    本批不再由弹药线反推，只锁机械系数（见第 2 条用例的注释）。
 * 4. **渠道 = 稀有订单**（船长令「放入稀有订单档」）：市场行 `rarity: 'rare'` · 数字档 **2（大众）** ·
 *    **无声望门槛**（不跟弹药 MK2 走奇货）。
 * 5. **料/价 ≈0.50**（消耗品锚；弹药线 0.53~0.57）：材料全取自精炼闭环（矿物 + 零件），
 *    落在 `content:check` 的 30%~60% 带内 ⇒ 自造一单省 ≈0.5 单货值、书价 2 单货值 ⇒ **约 4 单回本**
 *    （弹药 MK2 为 3.7 单）。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, ITEMS, MARKET_GOODS, RARITY_TIER } from '@whale/data'

const DRONE_BPS = ['bp-drone-scout', 'bp-drone-assault', 'bp-drone-heavy', 'bp-drone-sentry'] as const
const PRODUCTS: Record<string, { itemId: string; price: number; units: number; book: number }> = {
  'bp-drone-scout': { itemId: 'drone-scout', price: 900, units: 100, book: 180_000 },
  'bp-drone-assault': { itemId: 'drone-assault', price: 2_200, units: 100, book: 440_000 },
  'bp-drone-heavy': { itemId: 'drone-heavy', price: 5_000, units: 100, book: 1_000_000 },
  'bp-drone-sentry': { itemId: 'drone-sentry', price: 9_500, units: 100, book: 1_900_000 },
}
const bpOf = (id: string) => BLUEPRINTS.find((b) => b.id === id)!
const itemOf = (id: string) => ITEMS.find((i) => i.id === id)!
const goodOf = (id: string) => MARKET_GOODS.find((g) => g.key === id)!
const matCostOf = (id: string): number =>
  (bpOf(id).materials ?? []).reduce((s, m) => s + (itemOf(m.itemId).baseSellPriceIsk ?? 0) * m.count, 0)

describe('制式无人机永久图纸（2026-09-26 船长令）', () => {
  it('四条都在：永久（非一次性）· 产物 = 制式四型无人机 · 100 架/批', () => {
    for (const id of DRONE_BPS) {
      const bp = bpOf(id)
      expect(bp, `${id} 不在蓝图表里`).toBeTruthy()
      expect(bp.singleUse ?? false, `${id} 应为永久图纸`).toBe(false)
      expect(bp.itemId).toBe(PRODUCTS[id]!.itemId)
      expect(bp.outputUnits).toBe(100)
      expect(itemOf(bp.itemId!).kind).toBe('drone')
      expect(bp.buildSeconds ?? 0).toBeGreaterThan(0)
    }
  })

  it('书价 = 一单货值 ×2（民用/基础档系数），与市场行同值', () => {
    // ⚠ 2026-09-26 同日稍晚：船长把**弹药 MK2 图纸**改价为「100 批货值」（540,000/720,000/960,000）
    // 并明确「**不套无人机**」⇒ 无人机这四条**不再由弹药线反推**，直接走 `blueprintTierCoefOf` 的
    // 「民用/基础档 ×2」机械系数（故本文件不再断言弹药锚点，只锁这条系数与两处同价）。
    for (const id of DRONE_BPS) {
      const p = PRODUCTS[id]!
      const batchValue = p.price * p.units
      expect(itemOf(p.itemId).baseSellPriceIsk, `${p.itemId} 市场单价`).toBe(p.price)
      expect(bpOf(id).priceIsk, `${id} 书价`).toBe(batchValue * 2)
      expect(goodOf(id).basePrice, `${id} 市场行价须与定义同值`).toBe(bpOf(id).priceIsk)
      // 同一条倍率复核：书价 ÷（单价 × 200 架）
      expect(bpOf(id).priceIsk / (p.price * 200)).toBe(1)
    }
  })

  it('渠道 = 稀有订单 · 数字档 2（大众）· 无声望门槛', () => {
    for (const id of DRONE_BPS) {
      const g = goodOf(id)
      expect(g.kind).toBe('blueprint')
      expect(g.rarity, `${id} 应在稀有订单`).toBe('rare')
      expect(g.standingReq ?? 0, `${id} 不设声望门槛`).toBe(0)
      expect(RARITY_TIER[id], `${id} 数字档`).toBe(2)
      expect(g.unreleased ?? false).toBe(false) // 已上线（玩家可见目录里必须有）
    }
  })

  it('料/价 ≈0.50（30%~60% 带内）：自造一单省 ≈半单货值 ⇒ 书价 2 单 ⇒ 约 4 单回本', () => {
    for (const id of DRONE_BPS) {
      const p = PRODUCTS[id]!
      const batchValue = p.price * p.units
      const ratio = matCostOf(id) / batchValue
      expect(ratio, `${id} 料/价 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.3)
      expect(ratio, `${id} 料/价 ${(ratio * 100).toFixed(1)}%`).toBeLessThanOrEqual(0.6)
      const payback = bpOf(id).priceIsk / (batchValue - matCostOf(id))
      expect(payback, `${id} 回本单数`).toBeCloseTo(4, 0)
    }
  })

  it('材料只用精炼闭环里的东西（矿物 / 零件），不含成品无人机', () => {
    for (const id of DRONE_BPS) {
      for (const m of bpOf(id).materials ?? []) {
        const it = itemOf(m.itemId)
        expect(['mineral', 'part'], `${id} 的材料 ${m.itemId} 应为矿物或零件`).toContain(it.kind)
      }
    }
  })
})
