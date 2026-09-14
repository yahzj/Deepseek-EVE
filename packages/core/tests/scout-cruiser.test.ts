/**
 * **鹦鹉螺级测绘巡洋舰（sh-nautilus）· 协会测绘处侦察线**（2026-09-13 船长裁定 · 二号 · d2）
 *
 * 船长原话（照抄）：「**添加一艘新的巡洋舰，子分类为侦查舰。所属为深空工业协会 · 测绘处。
 * 最主要的效果就是虫洞扫码范围+1.槽位合计为10个。无人机舱稍大。**」＋追加：「**货仓可以乘*3**」
 * 「**采矿提高到39单位**」「**船和蓝图放入奇货**」「**跟虫洞挂 unreleased**」。
 *
 * 本件钉四件事：
 * ① **舰体定案**：T3 / armed / 子分类「侦察舰」· **10 槽**（4/3/3）· 机舱 **80**（同级 50）·
 *    货舱 **6,600 m³**（原案 ×3）· 循环 14 秒产 **39** 单位 · 行价 9,000,000（贴长尾鲨级）；
 * ② **主效果实测生效**：`wormholeScanRadiusBonus: 1` ⇒ 对编队**求和**；入洞（`wormholeStartRun`）
 *    与深入下层（`wormholeDescend`）都真的把 `grid.scanRadius` 抬 1 圈，两艘可叠加；
 * ③ **价格同源**：蓝图书价 = 行价 × 4；材料货值 = 行价 × 45%；工期落 T3 带（3~5 时）；
 * ④ **施工期闸门**：舰体 / 图纸 / 市场两行**四处 `unreleased` 同步** ⇒ 玩家可见目录与
 *    `ctx.marketGoods` 里都没有它（"未上线闸门"双向一致）。
 *
 * ⚠ 施工期铁律：虫洞对玩家不可见；本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, SHIPS, SHIP_BLUEPRINTS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { wormholeDescend, wormholeScanBonusOf, wormholeStartRun } from '../src/wormhole'

const ctx = buildSimContext()
const T1 = 'sandcat' // 无扫码加成的基准船
const SCOUT = 'sh-nautilus'

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

describe('鹦鹉螺级测绘巡洋舰（2026-09-13 船长新增）', () => {
  it('舰体定案：T3 侦察舰 · 10 槽 · 机舱 80 · 货舱 6,600 · 产 39/14 秒', () => {
    const s = shipOf(SCOUT)
    expect(s.name).toBe('鹦鹉螺级测绘巡洋舰')
    expect(s.tier).toBe(3)
    expect(s.role).toBe('armed')
    expect(s.subClass).toBe('侦察舰') // 协会功能舰写子分类（契约已放宽为"白名单 + 非虫洞登记表"）
    expect(s.slots).toEqual({ high: 4, mid: 3, low: 3 })
    expect(s.droneBayM3).toBe(80) // 「无人机舱稍大」（同级巡洋 50）
    expect(s.cargoM3).toBe(6_600) // 「货仓可以乘*3」
    expect(s.cycleSeconds).toBe(14)
    expect(s.oreUnitsPerCycle).toBe(39) // 「采矿提高到39单位」
    expect(s.priceIsk).toBe(9_000_000)
    expect(s.wormholeScanRadiusBonus).toBe(1) // 主效果
    expect(s.powerBonus).toBe(0.55)
    expect(s.droneDmgBonus).toBe(0.1)
    expect((s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)).toBe(610)
    expect(s.shieldResist?.kinetic).toBe(0.25)
  })

  it('主效果实测生效：编队求和；入洞与深入下层都把扫描半径抬 1 圈（两艘可叠加）', () => {
    // 基线：全 T1 编队 ⇒ 无加成
    const base = wormholeStartRun(ctx, [T1, T1], 42)
    expect(base.ok).toBe(true)
    const baseScan = base.run!.grid!.scanRadius
    expect(wormholeScanBonusOf(ctx, base.run!.fleet)).toBe(0)
    // 带 1 艘鹦鹉螺 ⇒ +1 圈
    const one = wormholeStartRun(ctx, [T1, SCOUT], 42)
    expect(one.ok).toBe(true)
    expect(wormholeScanBonusOf(ctx, one.run!.fleet)).toBe(1)
    expect(one.run!.grid!.scanRadius).toBe(baseScan + 1)
    // 两艘 ⇒ +2 圈（船长口径：编队即生效、可叠加）
    const two = wormholeStartRun(ctx, [SCOUT, SCOUT], 42)
    expect(two.ok).toBe(true)
    expect(wormholeScanBonusOf(ctx, two.run!.fleet)).toBe(2)
    expect(two.run!.grid!.scanRadius).toBe(baseScan + 2)
    // 深入下层同样带上扫码加成（2026-09-13 接线：`wormholeDescend` 收 scanBonus）
    // ⚠ `wormholeDescend` 的第一入参是 `state`（2026-09-13 星云批：一次性提示要写进 state）
    // ⇒ 直接把刚起好的 run 挂进一个普通存档，再走真正的深入路径。
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wormhole.run = one.run!
    const run = one.run!
    run.bossCleared = run.depth
    expect(wormholeDescend(state, 42, wormholeScanBonusOf(ctx, run.fleet)).ok).toBe(true)
    expect(run.grid!.scanRadius).toBe(baseScan + 1)
  })

  it('价格同源：蓝图 = 行价 × 4；材料货值 = 行价 × 45%；工期落 T3 带', () => {
    const bp = bpOfShip(SCOUT)
    expect(bp, '缺 sbp-nautilus').toBeTruthy()
    expect(bp!.priceIsk).toBe(36_000_000)
    expect(goodOf('blueprint', 'sbp-nautilus')?.basePrice).toBe(36_000_000)
    expect(goodOf('ship', SCOUT)?.basePrice).toBe(shipOf(SCOUT).priceIsk)
    const value = bp!.materials.reduce(
      (a, m) => a + Math.max(1, Math.floor(m.count)) * (ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
      0,
    )
    const ratio = value / 9_000_000
    expect(ratio).toBeGreaterThan(0.44)
    expect(ratio).toBeLessThan(0.46)
    expect(bp!.buildSeconds).toBe(16_920) // T3 带 3~5 时（同价同档 ⇒ 与长尾鲨级同值）
  })

  it('施工期闸门：舰体/图纸/市场两行四处 unreleased 同步，玩家买不到', () => {
    expect(shipOf(SCOUT).unreleased).toBe(true)
    expect(bpOfShip(SCOUT)?.unreleased).toBe(true)
    expect(goodOf('ship', SCOUT)?.unreleased).toBe(true)
    expect(goodOf('blueprint', 'sbp-nautilus')?.unreleased).toBe(true)
    // 玩家可见市场目录（buildMarketGoodsCatalog 过滤 unreleased）里没有它们
    expect(ctx.marketGoods.has('ship-nautilus')).toBe(false)
    expect(ctx.marketGoods.has('sbp-nautilus')).toBe(false)
    // 且它是**奇货 + 数字 4**（船长裁定：两行都留 4）
    expect(goodOf('ship', SCOUT)?.rarity).toBe('exotic')
    expect(goodOf('blueprint', 'sbp-nautilus')?.rarity).toBe('exotic')
  })
})
