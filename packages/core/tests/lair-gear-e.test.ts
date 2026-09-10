/**
 * E 族「泰坦巨构」专属装备三件（2026-09-10 船长逐件过审，档位「略高于 MK3」、仍低于 D 族）：
 * - **E1 巨构残骸炮**（修订）= 十秒一发的巨构重锤——装填 10 秒、名义 DPS = 攻坚炮台 MK3 的 109.5%，
 *   单发 19.1（= MK3 单发的 3.72 倍）；远端衰减 0.1（越远越打不中）、基础命中 0.70、CPU 22；
 * - **E2 深层机库** = 无人机舱 +95 m³ / CPU 50（比无人机甲板扩展 MK3 的 +70 还大三分之一）；
 * - **E3 巨构骨架** = **结构容量 +60%（引擎新能力 `hullHpBonus`，全游戏唯一加厚结构层）**
 *   ＋ 装甲容量 +30% / CPU 50 —— 灰鲭鲨三层血 174/113/168，略高于装甲增厚板 MK3、仍低于 D 族陵寝装甲层。
 * 注：真正卡放飞数量的是 CPU 带宽（每架 4/7/11/16 点），机库只保证带得够多。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, unfitAt } from '../src/index'
import { createPlayerSpec, type UnitSpec } from '../src/combat'
import { droneLoadM3 } from '../src/equipment'
import { FOE_LAIR_GEAR } from '../src/lairs'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-mako' // 灰鲭鲨：高 4 / 中 3 / 低 2，CPU 195
const CARRIER = 'sh-swarm' // 梭鱼级：机巢 160 m³ / CPU 320

function makeState(high: string[] = [], mid: string[] = [], low: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 9 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [...high, null, null, null, null].slice(0, 4) as (string | null)[],
    mid: [...mid, null, null, null].slice(0, 3) as (string | null)[],
    low: [...low, null, null].slice(0, 2) as (string | null)[],
  }
  return state
}

const dps = (m: { dmgMult?: number; reloadMs?: number }): number => (m.dmgMult ?? 0) / (m.reloadMs ?? 1)
const ehp = (s: UnitSpec): number => s.hp.s + s.hp.a + s.hp.h

describe('E 族巨构三件（2026-09-10 船长逐件过审）', () => {
  it('E 族池已配齐三件：巨构残骸炮 / 深层机库 / 巨构骨架', () => {
    expect(FOE_LAIR_GEAR.E).toEqual(['mod-lair-turret-e', 'mod-lair-hangar-e', 'mod-lair-frame-e'])
    for (const id of FOE_LAIR_GEAR.E) expect(ctx.modules.get(id)).toBeTruthy()
  })

  it('装填拉长到 10 秒，单发同比抬高——名义 DPS = 攻坚炮台 MK3 的 109.5%', () => {
    const e1 = ctx.modules.get('mod-lair-turret-e')!
    const mk3 = ctx.modules.get('mod-turret-kin-3')!
    expect(e1.reloadMs).toBe(10_000)
    expect(e1.dmgMult).toBe(19.1)
    // 单发 = MK3 的 3.72 倍
    expect(e1.dmgMult! / mk3.dmgMult!).toBeCloseTo(3.723, 2)
    // 装填 = MK3 的 3.40 倍
    expect(e1.reloadMs! / mk3.reloadMs!).toBeCloseTo(3.401, 2)
    // 总输出：略高于 MK3（+9.5%）
    const ratio = dps(e1) / dps(mk3)
    expect(ratio).toBeCloseTo(1.0946, 3)
    expect(ratio).toBeGreaterThan(1.05)
    expect(ratio).toBeLessThan(1.15)
  })

  it('远端衰减 0.1（越远越打不中）、基础命中 0.70、CPU 22', () => {
    const e1 = ctx.modules.get('mod-lair-turret-e')!
    expect(e1.falloff).toBe(0.1)
    expect(e1.hitRate).toBe(0.7)
    expect(e1.cpuUse).toBe(22)
    // 便宜得离谱：比 MK3 的一半还低
    expect(ctx.modules.get('mod-turret-kin-3')!.cpuUse!).toBeGreaterThan(22 * 2)
    // 与 D 族守墓者长炮的分工：E 射程更近、命中更低、衰减更差，但名义输出更高
    const d2 = ctx.modules.get('mod-lair-turret-d')!
    expect(e1.maxRangeM!).toBeLessThan(d2.maxRangeM!)
    expect(e1.hitRate!).toBeLessThan(d2.hitRate!)
    expect(e1.falloff!).toBeLessThan(d2.falloff!)
    expect(dps(e1)).toBeGreaterThan(dps(d2))
  })

  it('进战斗：射程带 / 命中 / 衰减 / 装填原样落地，弹种仍为爆炸系', () => {
    const state = makeState(['mod-lair-turret-e'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'turret')!
    expect(w.label).toBe('巨构残骸炮')
    expect(w.kind).toBe('gun')
    expect(w.hitRate).toBeCloseTo(0.7, 6)
    expect(w.falloff).toBeCloseTo(0.1, 6)
    expect(w.maxRangeM).toBe(9600)
    expect(w.minRangeM).toBe(900)
    expect(w.reloadMs).toBe(10_000)
    expect(Object.keys(w.shotsByType ?? {})).toEqual(['explosive'])
    expect(w.shotsByType!.explosive).toBeGreaterThan(0)
  })

  it('装填技术学缩短 10 秒长装填（−4%/级，与其它炮台同链）', () => {
    const state = makeState(['mod-lair-turret-e'])
    state.skills.trained['reload-drills'] = 5
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'turret')!
    expect(w.reloadMs).toBe(Math.max(100, Math.round(10_000 * 0.8)))
  })

  it('E2 深层机库：无人机舱 +95 m³ / CPU 50 —— 梭鱼 160→255，能装下 250 m³ 的整编机群', () => {
    const hangar = ctx.modules.get('mod-lair-hangar-e')!
    expect(hangar.droneBayBonusM3).toBe(95)
    expect(hangar.cpuUse).toBe(50)
    // 比无人机甲板扩展 MK3（+70）还大三分之一
    expect(hangar.droneBayBonusM3! / ctx.modules.get('mod-drone-rack-3')!.droneBayBonusM3!).toBeCloseTo(1.357, 3)

    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const uid = addShipToFleet(state, CARRIER)
    state.shipId = uid
    state.fleet[uid]!.fitted = { high: ['mod-lair-hangar-e', null, null, null], mid: [null, null, null], low: [null, null] }
    // 10×10（赤鸢）+ 5×20（猎鹰）+ 1×40（雷鸥）+ 2×5（蜂鸟）= 250 m³ ≤ 160 + 95
    state.fleet[uid]!.droneLoad = { 'drone-assault': 10, 'drone-heavy': 5, 'drone-sentry': 1, 'drone-scout': 2 }
    expect(droneLoadM3(state.fleet[uid]!.droneLoad!, ctx)).toBe(250)
    const spec = createPlayerSpec(state, ctx, uid)!
    expect(spec.weapons.filter((w) => w.src === 'drone')).toHaveLength(18) // 全编队放飞（CPU 带宽也够）

    // 卸下机库（舱 255 → 160）→ 超出部分按清单逆序卸下、退回仓库
    expect(unfitAt(state, 'high', 0, uid, ctx)).toBe(true)
    const after = createPlayerSpec(state, ctx, uid)!
    expect(after.weapons.filter((w) => w.src === 'drone').length).toBeLessThan(18)
  })

  it('E3 巨构骨架：装甲容量 +30%、结构容量 +60%（结构层首个容量模块）', () => {
    const frame = ctx.modules.get('mod-lair-frame-e')!
    expect(frame.armorHpBonus).toBe(0.3)
    expect(frame.hullHpBonus).toBe(0.6)
    expect(frame.cpuUse).toBe(50)

    const plain = createPlayerSpec(makeState(), ctx, SHIP)!
    const withFrame = createPlayerSpec(makeState([], [], ['mod-lair-frame-e']), ctx, SHIP)!
    expect(withFrame.hp.a / plain.hp.a).toBeCloseTo(1.3, 6)
    expect(withFrame.hp.h / plain.hp.h).toBeCloseTo(1.6, 6)
    expect(withFrame.hp.s).toBeCloseTo(plain.hp.s, 6) // 盾层不受影响
  })

  it('E3 三层总血：略高于装甲增厚板 MK3、仍低于 D 族陵寝装甲层', () => {
    const mk3 = createPlayerSpec(makeState([], [], ['mod-armor-plate-3']), ctx, SHIP)!
    const e3 = createPlayerSpec(makeState([], [], ['mod-lair-frame-e']), ctx, SHIP)!
    const d3 = createPlayerSpec(makeState([], [], ['mod-lair-armor-d']), ctx, SHIP)!
    // 裸船 174/87/105 = 366；MK3（甲 +80%）= 435.6；E3 = 455.1；D3（甲 +110%）= 461.7
    expect(ehp(mk3)).toBeCloseTo(435.6, 3)
    expect(ehp(e3)).toBeCloseTo(455.1, 3)
    expect(ehp(d3)).toBeCloseTo(461.7, 3)
    expect(ehp(e3)).toBeGreaterThan(ehp(mk3))
    expect(ehp(e3)).toBeLessThan(ehp(d3))
  })

  it('E3 同型多件加算：两件 = 结构容量 +120%（线性求和，与甲容同口径）', () => {
    const two = makeState([], [], ['mod-lair-frame-e'])
    two.fleet[two.shipId]!.fitted.low[1] = 'mod-lair-frame-e'
    const spec = createPlayerSpec(two, ctx, two.shipId)!
    const plain = createPlayerSpec(makeState(), ctx, SHIP)!
    expect(spec.hp.h / plain.hp.h).toBeCloseTo(2.2, 6)
    expect(spec.hp.a / plain.hp.a).toBeCloseTo(1.6, 6)
  })

  it('E3 结构容量与技能乘算：船体加固理论 +4%/级（满级再 ×1.2）', () => {
    const state = makeState([], [], ['mod-lair-frame-e'])
    state.skills.trained['hull-upgrades'] = 5
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const plain = createPlayerSpec(makeState(), ctx, SHIP)!
    expect(spec.hp.h / plain.hp.h).toBeCloseTo(1.6 * 1.2, 6)
  })
})
