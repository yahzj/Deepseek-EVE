/**
 * **T4 战列舰定案 · 巨齿鲨级（sh-megalodon）**（2026-09-13 船长「完善战列舰」裁定 · 二号 · d2）
 *
 * 本件钉住这一批的几件事，防后续改数据时悄悄漂掉：
 * ① **舰体定案**：照用 2026-09-12 外推值（14 槽 / 三层 1,273 / CPU 490 / 火力加成 0.85）
 *    + 补上**掠食者武装线的抗性签名**（护盾抗动能 0.5）——此前它是全仓唯一没有抗性的船；
 * ② **获取路径 = 仅图纸制造**（照皇带鱼级）：市场行 `playerBuyable: false` ⇒ `buyShip` 必须明确拒绝成品，
 *    且 `ships.ts priceIsk` 必须为 0（定制船口径，content:check 同源守）；
 * ③ **价格同源**：`ships.ts priceIsk` == 市场行价；蓝图书价 == 行价 × 4（>400 万档系数）；
 *    材料货值 == 行价 × 45%（全表统一锚，按物品站内收价计）；
 * ④ **T4 档价位全面上调 + 全舰工期阶梯重排**（船长 2026-09-13 四条裁定）：
 *    T4 三条线各按 T3 锚 ×15（武装/装甲）、×10（货舰）；
 *    工期按档带：T1 15~25 分 · T2 51~86 分 · T3 3~5 时 · T4 9~20 时 · T5 45 时，
 *    且 **T4 平均 ÷ T3 平均 落在 3~4 倍**（船长口径「T4 平均翻 3~4 倍」，去掉了 T3 的 4 小时封顶）。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, SHIPS, SHIP_BLUEPRINTS, buildSimContext } from '@whale/data'
import { buyShip } from '../src/industry'
import { createInitialState } from '../src/index'

const ctx = buildSimContext()

function shipOf(id: string) {
  const s = SHIPS.find((x) => x.id === id)
  expect(s, `舰船目录里没有 ${id}`).toBeTruthy()
  return s!
}
function goodOf(kind: 'ship' | 'blueprint', refId: string) {
  return MARKET_GOODS.find((g) => g.kind === kind && g.refId === refId)
}
function bpOfShip(shipId: string) {
  return SHIP_BLUEPRINTS.find((b) => b.shipId === shipId)
}
/** 材料货值（按物品站内收价 `baseSellPriceIsk` 计，与 content:check 的料/价同口径） */
function materialValue(bp: { materials: readonly { itemId: string; count: number }[] }): number {
  let v = 0
  for (const m of bp.materials) v += Math.max(1, Math.floor(m.count)) * (ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0)
  return v
}

describe('T4 战列舰定案 · 巨齿鲨级（2026-09-13）', () => {
  it('舰体：外推值照用 + 补上掠食者线的抗性签名', () => {
    const s = shipOf('sh-megalodon')
    expect(s.tier).toBe(4)
    expect(s.role).toBe('armed')
    expect(s.slots).toEqual({ high: 6, mid: 5, low: 3 }) // 14 槽（T4 平均值）
    expect((s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)).toBe(1_273) // T4 档位目标
    expect(s.cpu).toBe(490) // T3 350 × 1.4
    expect(s.powerBonus).toBe(0.85) // 阶梯 牛鲨 0.7 → T4 0.85
    expect(s.shieldResist?.kinetic).toBe(0.5) // 掠食者线签名（2026-09-13 补）
    expect(s.priceIsk).toBe(0) // 定制船口径：只收不卖 ⇒ 必须为 0
  })

  it('只卖图纸：成品不可直接购买（buyShip 给明确原因）', () => {
    const good = goodOf('ship', 'sh-megalodon')
    expect(good?.playerBuyable).toBe(false)
    expect(good?.standingReq).toBe(11)
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.wallet.isk = 1_000_000_000 // 钱够也不卖成品
    const r = buyShip(state, 'sh-megalodon', ctx)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('仅可制造')
  })

  it('图纸：书价 == 行价 × 4；材料货值 == 行价 × 45%；工期 20 时', () => {
    const bp = bpOfShip('sh-megalodon')
    expect(bp, '缺 sbp-megalodon（舰船蓝图必须有市场卡，否则 content:check 红）').toBeTruthy()
    expect(bp!.priceIsk).toBe(900_000_000)
    expect(goodOf('blueprint', 'sbp-megalodon')?.basePrice).toBe(900_000_000)
    const ratio = materialValue(bp!) / 225_000_000
    expect(ratio).toBeGreaterThan(0.44)
    expect(ratio).toBeLessThan(0.46)
    expect(bp!.buildSeconds).toBe(72_000) // T4 带 9~20 时的上沿
  })

  it('T4 档价位全面上调：三条线各按 T3 锚 ×15 / ×10', () => {
    expect(shipOf('sh-xuanwu').priceIsk).toBe(shipOf('sh-hawksbill').priceIsk * 15) // 装甲线：玳瑁 1.1M ×15
    expect(shipOf('sh-bowhead').priceIsk).toBe(shipOf('sh-humpback').priceIsk * 10) // 鲸盟货舰线：座头鲸 1.35M ×10
    expect(shipOf('sh-swordfish').priceIsk).toBe(shipOf('sh-sailfish').priceIsk * 10) // 蜃楼货舰线：旗鱼 0.48M ×10
    expect(goodOf('ship', 'sh-megalodon')?.basePrice).toBe(shipOf('sh-electricray').priceIsk * 15) // 武装线：电鳐 15M ×15
    for (const id of ['sh-xuanwu', 'sh-bowhead', 'sh-swordfish']) {
      expect(goodOf('ship', id)?.basePrice, `${id} 市场行价未跟上 ships.ts`).toBe(shipOf(id).priceIsk)
    }
  })

  it('T5 邓氏鱼仍是壳体：不上市场、不接蓝图、priceIsk 0（本轮不越界）', () => {
    expect(shipOf('sh-dunkleosteus').priceIsk).toBe(0)
    expect(goodOf('ship', 'sh-dunkleosteus')).toBeFalsy()
    expect(bpOfShip('sh-dunkleosteus')).toBeFalsy()
  })

  it('工期阶梯不漂：按档带 + T4 平均 ÷ T3 平均 落在 3~4 倍', () => {
    const band: Record<number, readonly [number, number]> = {
      1: [900, 1_500], // 15~25 分
      2: [3_060, 5_160], // 51~86 分
      3: [10_800, 18_000], // 3~5 时
      4: [32_400, 72_000], // 9~20 时
      5: [162_000, 162_000], // 45 时（T4 带下沿 ×5）
    }
    for (const bp of SHIP_BLUEPRINTS) {
      const s = shipOf(bp.shipId)
      const [lo, hi] = band[s.tier]!
      expect(bp.buildSeconds, `${s.name}（${bp.id}）工期 ${bp.buildSeconds}s 出带 ${lo}~${hi}`).toBeGreaterThanOrEqual(lo)
      expect(bp.buildSeconds, `${s.name}（${bp.id}）工期 ${bp.buildSeconds}s 出带 ${lo}~${hi}`).toBeLessThanOrEqual(hi)
    }
    const avg = (tier: number): number => {
      const list = SHIP_BLUEPRINTS.filter((bp) => shipOf(bp.shipId).tier === tier).map((bp) => bp.buildSeconds)
      return list.reduce((a, b) => a + b, 0) / list.length
    }
    const ratio = avg(4) / avg(3)
    expect(ratio).toBeGreaterThan(3) // 船长口径：T4 平均翻 3~4 倍
    expect(ratio).toBeLessThan(4)
  })
})
