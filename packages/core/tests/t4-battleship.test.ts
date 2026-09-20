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
    expect(s.powerBonus, '武装舰档位阶梯：T4 ⇒ +35%').toBe(0.35)
    // 2026-09-17 船长：「移除每条船的 50 动能抗性」⇒ 掠食者线的盾动能 0.5 已移除（线签名改为按档位给单发）
    expect(s.shieldResist, '盾层 50 动能抗已移除').toBeUndefined()
    expect(s.priceIsk).toBe(0) // 定制船口径：只收不卖 ⇒ 必须为 0
  })

  it('只卖图纸：成品不可直接购买（buyShip 给明确原因）', () => {
    const good = goodOf('ship', 'sh-megalodon')
    expect(good?.playerBuyable).toBe(false)
    expect(good?.standingReq).toBe(20) // 2026-09-13 声望按档：T4 = 20（原 11）
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

  it('价位阶梯：三条线各按同定位锚抬升（2026-09-13 价位重排后的口径）', () => {
    expect(shipOf('sh-xuanwu').priceIsk).toBe(shipOf('sh-hawksbill').priceIsk * 15) // 装甲线：玳瑁 6M ×15 = 90M
    // ⚠ 蝠鲼（**货舰**）锚**货舰线**（剑鱼），不是矿舰——船长 2026-09-13：「蝠鲼级重载货舰是货船，
    //   不应该对应矿舰」；系数 = 保持今天 13.5M ÷ 4.8M 的同档比 2.8125。
    expect(shipOf('sh-bowhead').priceIsk).toBe(shipOf('sh-swordfish').priceIsk * 2.8125) // 67.5M
    expect(shipOf('sh-swordfish').priceIsk).toBe(shipOf('sh-sailfish').priceIsk * 10) // 蜃楼货舰线：旗鱼 2.4M ×10 = 24M
    expect(shipOf('sh-humpback').priceIsk).toBe(900_000 * 10) // 工业线：鲸吞 0.9M ×10 = 9M（矿舰锚矿舰）
    expect(goodOf('ship', 'sh-megalodon')?.basePrice).toBe(shipOf('sh-electricray').priceIsk * 15) // 武装线：电鳐 15M ×15
    for (const id of ['sh-xuanwu', 'sh-bowhead', 'sh-swordfish', 'sh-hawksbill', 'sh-sailfish', 'sh-humpback']) {
      expect(goodOf('ship', id)?.basePrice, `${id} 市场行价未跟上 ships.ts`).toBe(shipOf(id).priceIsk)
    }
  })

  it('T5 旗舰与声望档位：皇带鱼 = 旗舰基准 8 亿 ×0.8；T3/T4/T5 门槛 12/20/35', () => {
    expect(shipOf('sh-colossal').priceIsk).toBe(0) // 定制船口径（只收不卖 ⇒ priceIsk 必须 0）
    expect(goodOf('ship', 'sh-colossal')?.basePrice).toBe(640_000_000) // 8 亿 ×0.8（非战斗下浮）
    expect(goodOf('ship', 'sh-colossal')?.standingReq).toBe(35)
    expect(goodOf('ship', 'sh-xuanwu')?.standingReq).toBe(20)
    expect(goodOf('blueprint', 'sbp-xuanwu')?.standingReq).toBe(25)
    expect(goodOf('ship', 'sh-hawksbill')?.standingReq).toBe(12)
    expect(goodOf('blueprint', 'sbp-hawksbill')?.standingReq).toBe(15)
    expect(goodOf('ship', 'sh-whiteshark')?.standingReq).toBe(7) // T2 保留门槛（大白鲨）
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
    // 2026-09-20 零件体系：使用零件的舰船（专属 15 艘 + 皇带鱼）建造时间砍到 1/5 ⇒ 出旧带是设计
    const partTimeShips = new Set(
      SHIP_BLUEPRINTS.filter((b) => b.id.startsWith('sbp-wh-') || b.id.includes('colossal')).map((b) => b.id),
    )
    for (const bp of SHIP_BLUEPRINTS) {
      const s = shipOf(bp.shipId)
      if (partTimeShips.has(bp.id)) continue
      const [lo, hi] = band[s.tier]!
      expect(bp.buildSeconds, `${s.name}（${bp.id}）工期 ${bp.buildSeconds}s 出带 ${lo}~${hi}`).toBeGreaterThanOrEqual(lo)
      expect(bp.buildSeconds, `${s.name}（${bp.id}）工期 ${bp.buildSeconds}s 出带 ${lo}~${hi}`).toBeLessThanOrEqual(hi)
    }
    const avg = (tier: number): number => {
      const list = SHIP_BLUEPRINTS.filter((bp) => shipOf(bp.shipId).tier === tier && !partTimeShips.has(bp.id)).map((bp) => bp.buildSeconds)
      return list.reduce((a, b) => a + b, 0) / list.length
    }
    const ratio = avg(4) / avg(3)
    expect(ratio).toBeGreaterThan(3) // 船长口径：T4 平均翻 3~4 倍
    expect(ratio).toBeLessThan(4)
  })

  it('零件体系（2026-09-20 船长「大幅减少使用零件的舰船的建造时间」）：使用零件的舰船工期 = 原值 1/5', () => {
    // 皇带鱼（永久 + 一次性）：45 时 → 9 时
    expect(bpOfShip('sh-colossal')?.buildSeconds).toBe(32_400)
    expect(SHIP_BLUEPRINTS.filter((b) => b.id === 'sbp-once-colossal')[0]?.buildSeconds).toBe(32_400)
    // 专属舰三档：T1 20 分 → 4 分 · T2 70 分 → 14 分 · T3 4 时 → 48 分
    expect(bpOfShip('sh-wh-a-frigate')?.buildSeconds).toBe(240)
    expect(bpOfShip('sh-wh-a-destroyer')?.buildSeconds).toBe(840)
    expect(bpOfShip('sh-wh-a-cruiser')?.buildSeconds).toBe(2_880)
  })
})
