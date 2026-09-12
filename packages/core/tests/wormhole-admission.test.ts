/**
 * **虫洞 · 入场与背包口径**（B 批 · 2026-09-13 开工）。
 *
 * 锁住设计稿 `docs/design/wormhole-extraction-endgame-20260912.md` §4/§5 的四组口径：
 * ① 质量折算表与**档位上限**（T5 禁入，哪怕它的折算质量为 0）；② 总质量上限 16,000；
 * ③ 回合公式 `floor(55 × (1 − 质量 ÷ 16,000 × 0.53))`（设计稿实测表逐格复现）；
 * ④ 背包格 = `floor(货仓 ÷ 500)` 与"每格只装一种物品"的占格算法。
 *
 * ⚠ 施工期铁律：虫洞**对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），
 * 本文件不起任何玩家可见文案；拍板权在船长。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  wormholeAdmission,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeShipMass,
  wormholeSlotsUsed,
  wormholeStepCost,
  wormholeTurnBudget,
  wormholeUnitsPerSlot,
} from '../src/wormhole'

const ctx = buildSimContext()

/** 真实船型取样（档位走 `ShipDef.tier`，与舰种契约同源） */
const T1 = 'sandcat' // 沙猫级采矿艇（T1 护卫舰；船型 id 不带 sh- 前缀）
const T2 = 'sh-mako' // 灰鲭鲨级护卫舰（T2 驱逐舰）
const T3 = 'sh-thresher' // 长尾鲨级导弹巡洋舰（T3 巡洋舰）
const T4 = 'sh-swordfish' // 剑鱼级大型货舰（T4 战列舰）
const T5 = 'sh-colossal' // 皇带鱼级旗舰货舰（T5 旗舰）

describe('虫洞 · 入场校验（档位 / 质量 / 艘数）', () => {
  it('质量折算表 = 船长定值（T1 500 · T2 1,500 · T3 3,500 · T4 7,000 · T5 禁入）', () => {
    expect(wormholeShipMass(ctx.ships.get(T1)!)).toBe(500)
    expect(wormholeShipMass(ctx.ships.get(T2)!)).toBe(1_500)
    expect(wormholeShipMass(ctx.ships.get(T3)!)).toBe(3_500)
    expect(wormholeShipMass(ctx.ships.get(T4)!)).toBe(7_000)
    // T5 的折算质量按 0 记（"质量为 0"绝不能被当成"能带"）——它由档位那一步拦下
    expect(wormholeShipMass(ctx.ships.get(T5)!)).toBe(0)
  })

  it('旗舰（T5）禁入 —— 即便折算质量为 0 也拦得住', () => {
    const r = wormholeAdmission(ctx, [T5])
    expect(r.ok).toBe(false)
    expect(r.code).toBe('tier-too-high')
  })

  it('设计稿 §4 的编成表逐行复现（总质量 / 回合预算）', () => {
    const cases: Array<{ ships: string[]; mass: number; turns: number }> = [
      { ships: [T1, T1, T1, T1], mass: 2_000, turns: 51 },
      { ships: [T1, T1, T1, T2], mass: 3_000, turns: 49 },
      { ships: [T2, T2, T2, T2], mass: 6_000, turns: 44 },
      { ships: [T3, T3, T2, T2], mass: 10_000, turns: 36 },
      { ships: [T3, T3, T3, T1], mass: 11_000, turns: 34 },
      { ships: [T3, T3, T3, T3], mass: 14_000, turns: 29 },
      { ships: [T4, T4], mass: 14_000, turns: 29 },
      { ships: [T4, T4, T2], mass: 15_500, turns: 26 },
    ]
    for (const c of cases) {
      const r = wormholeAdmission(ctx, c.ships)
      expect(r.ok, `${c.ships.join('+')} 应可入场`).toBe(true)
      expect(r.totalMass, `${c.ships.join('+')} 总质量`).toBe(c.mass)
      expect(r.turnBudget, `${c.ships.join('+')} 回合预算`).toBe(c.turns)
    }
    // 越线：2×T4 + 1×T3 = 17,500 > 16,000
    const over = wormholeAdmission(ctx, [T4, T4, T3])
    expect(over.ok).toBe(false)
    expect(over.code).toBe('mass-over-cap')
    expect(over.turnBudget).toBe(wormholeTurnBudget(17_500))
  })

  it('艘数上限与空编队', () => {
    expect(wormholeAdmission(ctx, []).code).toBe('no-ship')
    expect(wormholeAdmission(ctx, [T1, T1, T1, T1, T1]).code).toBe('too-many-ships')
    expect(wormholeAdmission(ctx, ['sh-not-exist']).code).toBe('unknown-ship')
  })

  it('回合公式边界：空载 = 55、满载 = floor(55×0.47) = 25、超载按上限夹住', () => {
    expect(wormholeTurnBudget(0)).toBe(55)
    expect(wormholeTurnBudget(WORMHOLE_TOTAL_MASS_CAP)).toBe(Math.floor(55 * 0.47))
    expect(wormholeTurnBudget(99_999)).toBe(wormholeTurnBudget(WORMHOLE_TOTAL_MASS_CAP))
  })
})

describe('虫洞 · 回合消耗口径', () => {
  it('每节点 1 + 每多打一波 +1 + 每捡一堆 +1', () => {
    expect(wormholeStepCost(1, 0)).toBe(1) // 一个节点、一波、没捡
    expect(wormholeStepCost(3, 0)).toBe(3) // 三波 ⇒ 1 + 2
    expect(wormholeStepCost(1, 2)).toBe(3) // 捡两堆 ⇒ 1 + 2
    expect(wormholeStepCost(3, 2)).toBe(5) // 全叠上
    expect(wormholeStepCost(0, 0)).toBe(1) // 异常输入不产生负开销
  })
})

describe('虫洞 · 背包格模型（每格 500 m³、每格只装一种物品）', () => {
  it('格数 = floor(货仓合计 ÷ 500)', () => {
    expect(wormholeBagSlots(10_900)).toBe(21) // 4×T3 武装巡洋舰（设计稿 §4.4）
    expect(wormholeBagSlots(34_000)).toBe(68) // 4×T3 货运
    expect(wormholeBagSlots(19_900)).toBe(39) // 3 武装 + 1 货舰
    expect(wormholeBagSlots(499)).toBe(0)
    expect(wormholeBagSlots(0)).toBe(0)
  })

  it('每格上限与占格：虚空母矿 500 个/格（虫洞唯一产出）', () => {
    // 虚空母矿 1 m³/单位 ⇒ 一格 500 个（设计稿 §5.4 读数：一格 = 500 单位 ⇒ 250 虚空晶）
    expect(wormholeUnitsPerSlot(1)).toBe(500)
    expect(wormholeSlotsUsed(1, 500)).toBe(1)
    expect(wormholeSlotsUsed(1, 501)).toBe(2)
    // 原材料（0.01 m³/单位）同格能装 50,000 个——"轻便高值产物"这一侧也自洽
    expect(wormholeUnitsPerSlot(0.01)).toBe(50_000)
    expect(wormholeSlotsUsed(0.01, 50_000)).toBe(1)
  })

  it('占格算法不静默吞非法体积（返回 Infinity ⇒ 由上层拦下）', () => {
    expect(wormholeSlotsUsed(0, 10)).toBe(Number.POSITIVE_INFINITY)
    expect(wormholeSlotsUsed(-1, 10)).toBe(Number.POSITIVE_INFINITY)
    expect(wormholeSlotsUsed(1, 0)).toBe(0)
  })

  it('背包占用汇总：N / M 与溢出判定（未知物品视为溢出，不静默通过）', () => {
    const u = wormholeBagUsage(ctx, [{ itemId: 'ore-voidmother', units: 1_000 }], 2)
    expect(u).toEqual({ used: 2, capacity: 2, overflow: false })
    const over = wormholeBagUsage(ctx, [{ itemId: 'ore-voidmother', units: 1_001 }], 2)
    expect(over.overflow).toBe(true)
    const unknown = wormholeBagUsage(ctx, [{ itemId: 'no-such-item', units: 1 }], 2)
    expect(unknown.overflow).toBe(true)
    expect(WORMHOLE_SLOT_M3).toBe(500)
  })
})
