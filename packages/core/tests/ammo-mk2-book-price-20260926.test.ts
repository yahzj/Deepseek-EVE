/**
 * **弹药 MK2 图纸改价（船长 2026-09-26 令）** —— 本文件钉四件事：
 *
 * 1. **书价 = 100 批（12,000 发）的货值**（船长原话：「**MK2图纸价格按照一百批弹药的倍率乘上去**」
 *    ＋「**不是市场订单，是我描述错误，是100批，12000发**」＋「**不套无人机，就是单纯MK2弹药**」
 *    ＋「**按你推荐**」⇒ 选甲案）。
 *    - 动能 MK2：12,000 × 45 = **540,000**（原 9,000）· 爆破 MK2：12,000 × 60 = **720,000**（原 12,750）
 *      · 能量 MK2：12,000 × 80 = **960,000**（原 18,000）。
 *    - **旧口径作废**：原值 = 2026-09-09「补给线 ×1.5」单批口径的冻结落账
 *      （9,000/12,750/18,000；船长 2026-09-11 复核「弹药蓝图回滚到 1.5 倍」那次的口径）。
 * 2. **基础弹三条不动**（1,350 / 1,650 / 1,950 —— 船长「单纯 MK2 弹药」）。
 * 3. **渠道与档不变**：仍是奇货 `exotic` · 数字档 4（本次只改价，不改渠道）。
 * 4. **两处同价**：`blueprints.ts priceIsk` == 市场行 `basePrice`（`content:check` 的硬契约）、
 *    且三条都在 `BLUEPRINT_PRICE_OVERRIDES` 里留痕（口径偏离机械系数 ⇒ 必须登记）。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, BLUEPRINT_PRICE_OVERRIDES, ITEMS, MARKET_GOODS, RARITY_TIER } from '@whale/data'

const bpOf = (id: string) => BLUEPRINTS.find((b) => b.id === id)!
const itemOf = (id: string) => ITEMS.find((i) => i.id === id)!
const goodOf = (id: string) => MARKET_GOODS.find((g) => g.key === id)!

/** 三条 MK2：蓝图 id → { 弹药 id, 单发价, 旧书价, 新书价 } */
const MK2: Record<string, { ammo: string; unit: number; was: number; now: number }> = {
  'bp-ammo-kinetic-2': { ammo: 'ammo-kinetic-2', unit: 45, was: 9_000, now: 540_000 },
  'bp-ammo-explosive-2': { ammo: 'ammo-explosive-2', unit: 60, was: 12_750, now: 720_000 },
  'bp-ammo-plasma-2': { ammo: 'ammo-plasma-2', unit: 80, was: 18_000, now: 960_000 },
}
const BASE_AMMO: Record<string, number> = {
  'bp-ammo-kinetic': 1_350,
  'bp-ammo-explosive': 1_650,
  'bp-ammo-plasma': 1_950,
}

describe('弹药 MK2 图纸改价：书价 = 100 批货值（2026-09-26 船长令）', () => {
  it('三条 MK2：书价 = 12,000 发 × 单发价（= 100 批 × 120 发）', () => {
    for (const [bpId, m] of Object.entries(MK2)) {
      const bp = bpOf(bpId)
      expect(bp.outputUnits, `${bpId} 一批 = 120 发`).toBe(120)
      expect(itemOf(m.ammo).baseSellPriceIsk, `${m.ammo} 单发价`).toBe(m.unit)
      expect(itemOf(m.ammo).kind).toBe('ammo')
      expect(bp.priceIsk, `${bpId} 新书价`).toBe(m.now)
      expect(bp.priceIsk, `${bpId} = 100 批（12,000 发）货值`).toBe(m.unit * 120 * 100)
      // 与旧口径的对照（旧值 = 2026-09-09「单批 ×1.5」按**当时**现货价冻结的落账）——只作留痕断言：
      // 新价必然高于旧价（本次是上调），且旧值不可由今天的单价反推（价格漂移过：如动能 50 → 45）。
      expect(m.now).toBeGreaterThan(m.was)
    }
  })

  it('两处同价：定义价 = 市场行价，且三条都在覆盖表里留痕', () => {
    for (const bpId of Object.keys(MK2)) {
      expect(goodOf(bpId).basePrice, `${bpId} 市场行`).toBe(bpOf(bpId).priceIsk)
      expect(BLUEPRINT_PRICE_OVERRIDES[bpId]?.price, `${bpId} 覆盖表`).toBe(bpOf(bpId).priceIsk)
      expect(BLUEPRINT_PRICE_OVERRIDES[bpId]?.reason ?? '').toContain('2026-09-26')
    }
  })

  it('基础弹三条一字未动（船长「单纯 MK2 弹药」）', () => {
    for (const [bpId, price] of Object.entries(BASE_AMMO)) {
      expect(bpOf(bpId).priceIsk, `${bpId} 基础弹书价`).toBe(price)
      expect(goodOf(bpId).basePrice).toBe(price)
      expect(BLUEPRINT_PRICE_OVERRIDES[bpId]?.price).toBe(price)
    }
  })

  it('渠道与数字档不变：仍奇货 exotic · 档 4（本批只改价）', () => {
    for (const bpId of Object.keys(MK2)) {
      expect(goodOf(bpId).rarity).toBe('exotic')
      expect(RARITY_TIER[bpId]).toBe(4)
    }
  })
})
