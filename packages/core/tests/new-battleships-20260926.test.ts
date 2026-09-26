/**
 * **两艘新官方战列舰（船长 2026-09-26 四条令）** —— 本文件钉五件事：
 *
 * 1. **虎鲸级指挥舰 `sh-orca`** = 设定里的「**战列巡洋舰**」（船长原话：「这是之前设定文档里有的内容，
 *    **依旧属于战列舰级别**，但是**速度更快，其他属性全面落后战列舰**」；该说法**不进可见文案**）：
 *    T4 档 · 槽位 **4/5/4**（船长：「槽位调整为454」）· 三层血 1,050（低于巨齿鲨 1,273）·
 *    CPU 420（< 490）· 质量 16M（< 22M）· 货 2,400（< 4,000）· **速度 245（> 巨齿鲨 175）**；
 *    子分类 `指挥舰` + **全队单发 +20%**（`fleetDamageBonusPct`；与陵卫指挥舰同值）。
 * 2. **旋齿鲨级装甲战列舰 `sh-helicoprion`**（船长：「命名还是以鲨系为主可以往古代种或者奇幻种走」）：
 *    T4 装甲线 · 槽位 **5/3/6** · 三层血 1,273（= T4 战斗舰中位，**不牵动**非战斗舰目标表 1,018）·
 *    甲向（甲 700 > 盾 200）· 甲层动能抗 0.35（装甲线 T4 档位）· **不得带单发加成**（装甲线契约）·
 *    与玄武（4/4/6 · 甲 493/结构 614 · 速度 100 · 货 15,200 的堡垒货舰）区分：**快、甲厚、货小**。
 * 3. **阶梯与契约**：两艘都守 T4（槽位高/中/低各 1~7 · 总血 1,273/1,050 由中位口径放行 · CPU 整数 · 质量落档）。
 * 4. **渠道**：虎鲸级照巨齿鲨（**仅图纸制造**：成品只收不卖 · `priceIsk = 0`）· 旋齿鲨级照玄武（现货在售）。
 *    两者的永久图纸与一次性图纸都在奇货 · 数字档 4 · T4 门槛 25；一次性图纸价 = 行价 ×50%（船长 2026-09-14 口径）。
 * 5. **图形与挂点**：两艘都必须有独立 SVG 形与挂点（船长 2026-09-16：「每艘需要单独的SVG图形」）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const ship = (id: string) => ctx.ships.get(id)!
const bp = (id: string) => ctx.shipBlueprints.get(id)!
const good = (refId: string) => [...ctx.marketGoods.values()].find((g) => g.refId === refId)
const totalHp = (id: string) => {
  const s = ship(id)
  return (s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)
}
const slotsOf = (id: string) => {
  const s = ship(id).slots!
  return s.high + s.mid + s.low
}

describe('虎鲸级指挥舰（战巡口径 · 2026-09-26 船长令）', () => {
  it('T4 · 4/5/4（13 槽）· 子分类指挥舰 · 全队单发 +20%', () => {
    const s = ship('sh-orca')
    expect(s.name).toBe('虎鲸级指挥舰')
    expect(s.tier).toBe(4)
    expect(s.role).toBe('armed')
    expect(s.subClass).toBe('指挥舰')
    expect(s.slots).toEqual({ high: 4, mid: 5, low: 4 })
    expect(slotsOf('sh-orca')).toBe(13)
    expect(s.fleetDamageBonusPct).toBe(0.2)
  })

  it('「速度更快、其余全面落后巨齿鲨」：逐项对照读数', () => {
    const orca = ship('sh-orca')
    const mega = ship('sh-megalodon')
    expect(orca.maxSpeedMps!).toBeGreaterThan(mega.maxSpeedMps!) // 245 > 175
    expect(totalHp('sh-orca')).toBeLessThan(totalHp('sh-megalodon')) // 1,050 < 1,273
    expect(slotsOf('sh-orca')).toBeLessThan(slotsOf('sh-megalodon')) // 13 < 14
    expect(orca.cpu!).toBeLessThan(mega.cpu!) // 420 < 490
    expect(orca.massKg!).toBeLessThan(mega.massKg!) // 16M < 22M
    // ⚠ 货舱是**例外**：船长 2026-09-26 令「虎鲸级货仓提高到4700」⇒ 4,700 > 巨齿鲨 4,000
    expect(orca.cargoM3).toBe(4700)
    expect(orca.cargoM3).toBeGreaterThan(mega.cargoM3)
    // T4 武装舰单发加成是档位阶梯契约值（0.35），两艘一致
    expect(orca.powerBonus).toBe(0.35)
    expect(mega.powerBonus).toBe(0.35)
  })

  it('指挥舰光环：虎鲸级与陵卫指挥舰同为 +20%（船长 2026-09-26 令）', () => {
    expect(ship('sh-orca').fleetDamageBonusPct).toBe(0.2)
    expect(ship('sh-wh-d-destroyer').fleetDamageBonusPct).toBe(0.2) // 陵卫指挥舰：0.15 → 0.20
    // 其余船一个都不带（光环只挂指挥舰）
    const others = [...ctx.ships.values()].filter((s) => s.fleetDamageBonusPct !== undefined).map((s) => s.id).sort()
    expect(others).toEqual(['sh-orca', 'sh-wh-d-destroyer'])
  })
})

describe('旋齿鲨级装甲战列舰（T4 装甲线 · 2026-09-26 船长令）', () => {
  it('T4 · 5/3/6（14 槽）· 甲向 · 甲层抗性 0.35 · 无单发加成', () => {
    const s = ship('sh-helicoprion')
    expect(s.name).toBe('旋齿鲨级装甲战列舰')
    expect(s.tier).toBe(4)
    expect(s.role).toBe('armored')
    expect(s.slots).toEqual({ high: 5, mid: 3, low: 6 })
    expect(totalHp('sh-helicoprion')).toBe(1273)
    expect(s.armorHp!).toBeGreaterThan(s.shieldHp!) // 甲向（装甲线判据）
    expect(s.armorHp!).toBeGreaterThan(s.hullHp!) // 700 > 373
    expect(s.armorResist?.kinetic).toBeCloseTo(0.35, 6)
    expect(s.powerBonus).toBeUndefined() // 装甲线不得带档位单发加成
  })

  it('与玄武分工明确：更快 · 甲更厚 · 货更小（同为 T4 装甲战列舰）', () => {
    const heli = ship('sh-helicoprion')
    const xuan = ship('sh-xuanwu')
    expect(heli.maxSpeedMps!).toBeGreaterThan(xuan.maxSpeedMps!) // 150 > 100
    expect(heli.armorHp!).toBeGreaterThan(xuan.armorHp!) // 700 > 493
    expect(heli.cargoM3).toBeLessThan(xuan.cargoM3) // 3,600 < 15,200
    expect(totalHp('sh-helicoprion')).toBe(totalHp('sh-xuanwu')) // 都是 T4 中位 1,273
  })
})

describe('两艘的渠道 / 图纸 / 图形挂点', () => {
  it('渠道：虎鲸只收不卖（仅图纸制造）· 旋齿鲨现货在售；价与定义同值', () => {
    const orca = good('sh-orca')!
    const heli = good('sh-helicoprion')!
    expect(orca.playerBuyable).toBe(false)
    expect(ship('sh-orca').priceIsk).toBe(0) // 只收不卖 ⇒ 定义价必须 0（content:check 契约）
    expect(heli.playerBuyable ?? true).toBe(true)
    expect(ship('sh-helicoprion').priceIsk).toBe(heli.basePrice)
  })

  it('图纸四条齐备：永久 + 一次性（价 = 行价 ×50%）· 都在奇货', () => {
    for (const [bpId, shipId] of [
      ['sbp-orca', 'sh-orca'],
      ['sbp-helicoprion', 'sh-helicoprion'],
    ] as const) {
      expect(bp(bpId).shipId).toBe(shipId)
      expect(bp(bpId).singleUse ?? false).toBe(false)
      expect(good(bpId)!.rarity).toBe('exotic')
      expect(good(bpId)!.basePrice).toBe(bp(bpId).priceIsk)
    }
    for (const [bpId, shipId] of [
      ['sbp-once-orca', 'sh-orca'],
      ['sbp-once-helicoprion', 'sh-helicoprion'],
    ] as const) {
      expect(bp(bpId).shipId).toBe(shipId)
      expect(bp(bpId).singleUse).toBe(true)
      expect(good(bpId)!.basePrice).toBe(ship(shipId).priceIsk === 0 ? 75_000_000 : 45_000_000)
    }
  })

  it('图形与挂点：两艘都有独立 SVG 形与 engines/muzzles', () => {
    // ⚠ 不 import `.tsx`（core 包 tsconfig 无 `--jsx`）⇒ 读源码文本断言 key 存在；
    //    几何层面的覆盖由 `content:check` 的「舰船图形契约」（45 艘船形与挂点齐备）硬守。
    const root = join(__dirname, '..', '..', '..')
    const artSrc = readFileSync(join(root, 'apps', 'desktop', 'src', 'renderer', 'src', 'ui', 'shipArt.tsx'), 'utf8')
    const mountSrc = readFileSync(join(root, 'apps', 'desktop', 'src', 'renderer', 'src', 'ui', 'shipMounts.ts'), 'utf8')
    for (const id of ['sh-orca', 'sh-helicoprion']) {
      expect(artSrc.includes(`'${id}':`), `${id} 缺独立 SVG 形`).toBe(true)
      expect(mountSrc.includes(`'${id}':`), `${id} 缺挂点`).toBe(true)
    }
    expect(mountSrc.includes("engines: [{ x: 32, y: 50 }"), '虎鲸级挂点应为双喷口').toBe(true)
  })
})
