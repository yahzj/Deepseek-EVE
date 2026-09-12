/**
 * 舰种表契约（2026-09-11 船长定案）：
 * 舰种收敛 **5 档**、**敌我共用**，档位 = 既有 `ShipDef.tier`，按**等效质量**落档
 * （等效质量 = massKg×(armored?0.65:1)；区间 0.4~2.4M / 2.4~5.8M / 5.8~13M / 13~29M / ≥29M）。
 * 本测试钉住三件事：①5 档命名与基准速度逐一正确（340/295/258/205/155）；
 * ②等效质量换算与越界兜底行为；③**全部 27 艘船的 tier 与等效质量落档一致**（数据侧错标即在测试里现形）。
 * 本批**零行为变化**：表只建在数据层，尚未接线到任何引擎读取点。
 */
import { describe, expect, it } from 'vitest'
import {
  SHIPS,
  HULL_CLASS_NAME,
  HULL_CLASS_BASE_SPEED,
  HULL_CLASS_MASS_RANGE,
  equivalentMassOf,
  hullClassTierOfTier,
  hullClassOf,
} from '@whale/data'

/** 等效质量落在哪一档（与 content:check「舰种契约」同一套落档口径，独立写一遍防"同源漏判"） */
function tierOfEquivalentMass(eq: number): 1 | 2 | 3 | 4 | 5 {
  for (const t of [5, 4, 3, 2, 1] as const) {
    if (eq >= HULL_CLASS_MASS_RANGE[t][0]) return t
  }
  throw new Error(`等效质量 ${eq} 落不进任何舰种档`)
}

describe('舰种表（2026-09-11 船长定案：5 档·敌我共用）', () => {
  it('五档命名：护卫舰 / 驱逐舰 / 巡洋舰 / 战列舰 / 旗舰', () => {
    expect([1, 2, 3, 4, 5].map((t) => HULL_CLASS_NAME[t as 1])).toEqual([
      '护卫舰',
      '驱逐舰',
      '巡洋舰',
      '战列舰',
      '旗舰',
    ])
  })

  it('基准速度：340 / 295 / 258 / 205 / 155，且全部落在合理值域 100~500', () => {
    expect([1, 2, 3, 4, 5].map((t) => HULL_CLASS_BASE_SPEED[t as 1])).toEqual([
      340, 295, 258, 205, 155,
    ])
    for (const t of [1, 2, 3, 4, 5] as const) {
      expect(HULL_CLASS_BASE_SPEED[t]).toBeGreaterThanOrEqual(100)
      expect(HULL_CLASS_BASE_SPEED[t]).toBeLessThanOrEqual(500)
    }
  })

  it('等效质量区间接续无缝：0.4~2.4M / 2.4~5.8M / 5.8~13M / 13~29M / ≥29M（最高档上界 ∞）', () => {
    expect(HULL_CLASS_MASS_RANGE[1]).toEqual([400_000, 2_400_000])
    expect(HULL_CLASS_MASS_RANGE[2]).toEqual([2_400_000, 5_800_000])
    expect(HULL_CLASS_MASS_RANGE[3]).toEqual([5_800_000, 13_000_000])
    expect(HULL_CLASS_MASS_RANGE[4]).toEqual([13_000_000, 29_000_000])
    expect(HULL_CLASS_MASS_RANGE[5]).toEqual([29_000_000, Infinity])
    for (const t of [1, 2, 3, 4] as const) {
      expect(HULL_CLASS_MASS_RANGE[t][1]).toBe(HULL_CLASS_MASS_RANGE[(t + 1) as 2][0])
    }
  })

  it('等效质量换算：甲壳重装 ×0.65，其余 ×1；缺 massKg 按 0 计', () => {
    expect(equivalentMassOf({ massKg: 6_000_000, role: 'armored' })).toBe(3_900_000)
    expect(equivalentMassOf({ massKg: 6_000_000, role: 'armed' })).toBe(6_000_000)
    expect(equivalentMassOf({ massKg: 6_000_000, role: 'hauler' })).toBe(6_000_000)
    expect(equivalentMassOf({ role: 'industrial' })).toBe(0)
  })

  it('越界 tier 兜底到最近的合法档（≤1→1、≥5→5、非有限数→1）', () => {
    expect(hullClassTierOfTier(0)).toBe(1)
    expect(hullClassTierOfTier(-3)).toBe(1)
    expect(hullClassTierOfTier(3)).toBe(3)
    expect(hullClassTierOfTier(7)).toBe(5)
    expect(hullClassTierOfTier(Number.NaN)).toBe(1)
    expect(hullClassOf({ tier: 4 })).toBe('战列舰')
    expect(hullClassOf({ tier: 99 })).toBe('旗舰')
  })

  // 2026-09-12：25 → **27**（船长「T4,T5 可以先立个模子」⇒ 新增两具壳体：巨齿鲨级战列舰 / 邓氏鱼级旗舰）
  it('27 艘船的 tier 与其等效质量落档区间一一一致', () => {
    expect(SHIPS.length).toBe(27)
    const bad = SHIPS.filter((s) => s.tier !== tierOfEquivalentMass(equivalentMassOf(s))).map(
      (s) =>
        `${s.name}（质量 ${s.massKg} → 等效 ${equivalentMassOf(s)}，实际 tier ${s.tier}）`,
    )
    expect(bad).toEqual([])
  })

  it('每艘船的舰种名 = 其 tier 对应命名（归类统计 护卫 5 / 驱逐 7 / 巡洋 9 / 战列 4 / 旗舰 2）', () => {
    const count: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const s of SHIPS) {
      count[s.tier] += 1
      expect(hullClassOf(s)).toBe(HULL_CLASS_NAME[s.tier as 1])
    }
    expect(count).toEqual({ 1: 5, 2: 7, 3: 9, 4: 4, 5: 2 })
  })
})
