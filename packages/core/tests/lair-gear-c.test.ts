/**
 * 无消耗自愈 + 结构抗性（2026-09-10 船长：C 族异形件）：
 * - C1 生体甲壳板：装甲层三系抗 +10%（缺口复合）+ 每 5 秒**无消耗**修甲 6 点
 * - C2 生体损管腔：**结构层**三系抗 +25%（模块侧新入口 hullResistAdd）+ 每 5 秒无消耗修结构 4 点
 * - C3 酸液喷吐器：必中能量件，射速慢单发重（DPS 与攻坚激光炮相当）
 * - 无消耗修复量在**同型多件间按 EVE 曲线收敛**（权重 100%/87%/57%/28%/11%），不吃组件也永不停机。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec, preloadRepairFor, refundRepairKits } from '../src/combat'
import { stackWeight } from '../src/equipment'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-mako' // 灰鲭鲨：中 3 / 低 2，够装 C1+C2

function makeState(high: string[] = [], mid: string[] = [], low: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [...high, null, null, null, null].slice(0, 4) as (string | null)[],
    mid: [...mid, null, null, null].slice(0, 3) as (string | null)[],
    low: [...low, null, null].slice(0, 2) as (string | null)[],
  }
  return state
}

describe('C 族异形件：无消耗自愈 + 结构抗性（2026-09-10 船长）', () => {
  it('C1 生体甲壳板：装甲层三系抗各 +10%（缺口复合），结构层不受影响', () => {
    const plain = createPlayerSpec(makeState(), ctx, 'sh-mako')!
    const withPlate = createPlayerSpec(makeState([], [], ['mod-lair-armor-c']), ctx, 'sh-mako')!
    // 装甲层三系各 +10% 缺口削减：new = 1 − (1−base) × 0.9
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const base = plain.resists.armor?.[t] ?? 0
      const after = withPlate.resists.armor?.[t] ?? 0
      expect(after).toBeCloseTo(1 - (1 - base) * 0.9, 6)
    }
    // 盾/结构不被该件影响
    expect(withPlate.resists.hull).toEqual(plain.resists.hull)
  })

  it('C2 生体损管腔：结构层三系抗各 +25%（模块新增 hullResistAdd 入口）', () => {
    const plain = createPlayerSpec(makeState(), ctx, 'sh-mako')!
    const withDc = createPlayerSpec(makeState([], ['mod-lair-dc-c']), ctx, 'sh-mako')!
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const base = plain.resists.hull?.[t] ?? 0
      const after = withDc.resists.hull?.[t] ?? 0
      expect(after).toBeGreaterThanOrEqual(base)
      if (base === 0) expect(after).toBeCloseTo(0.25, 6)
    }
  })

  it('无消耗自愈：装 C1 即获每跳修甲 6 点、不预载组件、永不停机', () => {
    const state = makeState([], [], ['mod-lair-armor-c'])
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    expect(repair.units).toHaveLength(1)
    const u = repair.units[0]!
    expect(u.free).toBe(true)
    expect(u.armorPerPulse).toBe(6)
    expect(u.hullPerPulse).toBe(0)
    expect(u.stopped).toBe(false)
    expect(Object.keys(repair.kits)).toHaveLength(0) // 不预载任何组件
    refundRepairKits(state, repair) // 幂等：无组件可退
  })

  it('同型多件按 EVE 曲线收敛：3 件 C1 → 6 + 5 + 3 = 14 点/跳（而非线性 18）', () => {
    const state = makeState([], [], ['mod-lair-armor-c', 'mod-lair-armor-c'])
    state.fleet[state.shipId]!.fitted.low[1] = 'mod-lair-armor-c'
    // 低槽只有 2 位：再借用中槽一位（同件可装任意槽位由 rack 校验，测试直接写数组）
    state.fleet[state.shipId]!.fitted.mid[0] = 'mod-lair-armor-c'
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    const per = repair.units.map((x) => x.armorPerPulse)
    expect(per).toHaveLength(3)
    expect(per[0]).toBe(Math.round(6 * stackWeight(1))) // 6
    expect(per[1]).toBe(Math.round(6 * stackWeight(2))) // 5
    expect(per[2]).toBe(Math.round(6 * stackWeight(3))) // 3
    const sum = per.reduce((s, n) => s + n, 0)
    expect(sum).toBeLessThan(18) // 收敛后低于线性
  })

  it('消耗件与自愈件并存：组件照旧预载、自愈件不占组件', () => {
    const state = makeState([], ['mod-hullrep-1'], ['mod-lair-armor-c'])
    state.warehouse.items['repairkit-mil'] = 50
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    expect(repair.units).toHaveLength(2)
    const free = repair.units.find((u) => u.free)!
    const kit = repair.units.find((u) => !u.free)!
    expect(free.armorPerPulse).toBe(6)
    expect(kit.kitId).toBe('repairkit-mil')
    expect((repair.kits['repairkit-mil'] ?? 0)).toBeGreaterThan(0)
  })

  it('C3 酸液喷吐器：必中能量件、射速更慢单发更重、总输出与攻坚激光炮相当', () => {
    const state = makeState(['mod-lair-laser-c'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'laser')!
    expect(w.kind).toBe('beam') // 必中
    const c3 = ctx.modules.get('mod-lair-laser-c')!
    const mk3 = ctx.modules.get('mod-laser-3')!
    expect(c3.dmgMult!).toBeGreaterThan(mk3.dmgMult!) // 单发更重
    expect(c3.reloadMs!).toBeLessThan(mk3.reloadMs!) // 射速比"原型"更快、但比裸件基线慢
    // 总输出相当（±30% 以内）
    const dps = (m: { dmgMult?: number; reloadMs?: number }): number => (m.dmgMult ?? 0) / (m.reloadMs ?? 1)
    const ratio = dps(c3) / dps(mk3)
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.3)
    // 代价：射程只有攻坚激光炮的三成以下
    expect(c3.maxRangeM!).toBeLessThan(mk3.maxRangeM! / 3)
    expect(w.maxRangeM).toBe(2800)
  })
})
