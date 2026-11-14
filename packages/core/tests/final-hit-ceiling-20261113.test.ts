import { describe, expect, it } from 'vitest'
import { applyDamage, applyDamageExact, finalizeHitDamage } from '../src/combat/combatMath'
import { applyFoeShot, applyFoeUnitDamage, applyPlayerUnitDamage } from '../src/combat/damage'
import { createBattleState, createPlayerSpec } from '../src/combat'
import type { WeaponSpec } from '../src/combat'
import { createInitialState } from '../src/state'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const hp = { s: 0, a: 0, h: 100 }
describe('抗性后整次命中只取整一次', () => {
  it.each([.01, .2, 1.01, 9.8])('原伤%s在抗性后取整，零伤不保底', raw => {
    const resists = { hull: { kinetic: .3 } }
    const result = applyDamage(hp, resists, raw, 'kinetic')
    expect(result.dealt).toBe(Math.ceil(raw * .7))
    expect(result.hp.h).toBe(100 - result.dealt)
    expect(applyDamage(hp, resists, 0, 'kinetic').dealt).toBe(0)
  })
  it('跨层不逐层取整，旧档小数残血清零且不超扣', () => {
    const before = { s: .2, a: .3, h: 100 }
    const exact = applyDamageExact(before, {}, .8, 'plasma')
    const result = applyDamage(before, {}, .8, 'plasma')
    expect(result.dealt).toBe(1)
    expect(result.hp.h).toBeCloseTo(99.5, 12)
    expect(exact.dealt).toBeCloseTo(.8, 12)
    expect(applyDamage({ s: 0, a: 0, h: .3 }, {}, 1, 'kinetic')).toEqual({ hp: { s: 0, a: 0, h: 0 }, dealt: .3 })
  })
  it('混伤两分量0.24加0.16只扣1点，不各自保底1点', () => {
    const weapon = { shotsByType: { kinetic: 60, plasma: 40 } } as WeaponSpec
    const resists = { hull: { kinetic: .6, plasma: .6 } }
    expect(applyFoeShot(hp, resists, weapon, 1, 'kinetic').h).toBe(99)
    expect(applyFoeShot(hp, resists, { ...weapon, gunCount: 8 }, 1, 'kinetic').h).toBe(99)
  })
  it('玩家附伤与主伤只取整一次，并统一记伤害与死亡', () => {
    const state = createInitialState({ nowWallMs: 0 })
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const foe = { ...spec, tag: 'foe-0', side: 'foe' as const, hp, resists: { hull: { kinetic: .6, plasma: .6 } } }
    const battle = createBattleState(spec, [foe], 0, 1000)
    const result = applyFoeUnitDamage(battle, foe, .6, 'kinetic', 0, { dmg: .4, type: 'plasma' })
    expect(result.dealt).toBe(1)
    expect(battle.units[foe.tag]!.hp.h).toBe(99)
    expect(result.killedNow).toBe(false)
  })
  it('齐射上限不足1点不超额，损管后只扣整数实伤', () => {
    const state = createInitialState({ nowWallMs: 0 })
    const spec = { ...createPlayerSpec(state, ctx, state.shipId)!, hp, hullSaveKit: 'repairkit-dc' }
    const battle = createBattleState(spec, [], 0, 1000)
    battle.units.player!.hp.h = 10
    state.warehouse.items['repairkit-dc'] = 2
    const dealt = applyPlayerUnitDamage(state, battle, 'player', spec, 1000, 'plasma')
    expect(dealt).toBe(9)
    expect(battle.units.player!.hp.h).toBe(1)
    expect(state.warehouse.items['repairkit-dc']).toBe(1)
    const other = { ...spec, hp: { s: 0, a: 0, h: 101 }, hullSaveKit: undefined }
    const capped = createBattleState(other, [], 0, 1000)
    expect(applyPlayerUnitDamage(state, capped, 'player', other, 1000, 'plasma')).toBe(80)
    expect(applyPlayerUnitDamage(state, capped, 'player', other, 1000, 'plasma')).toBe(0)
  })
  it('尾差扣血不修改输入，镀膜账不超装甲，零变化不产生伤害', () => {
    const before = { s: 0, a: 10, h: 100, coating: { armor: 10, maxArmor: 10 } }
    const after = { ...before, a: 9.8 }
    const result = finalizeHitDamage(before, after)
    expect(result.hp.a).toBeCloseTo(9, 12)
    expect(result.hp.coating!.armor).toBeCloseTo(9, 12)
    expect(after.a).toBe(9.8)
    expect(finalizeHitDamage(before, before).dealt).toBe(0)
  })
  it('持续恢复后的小数血量再次命中，重复收口不会因相减噪声多扣一点', () => {
    const state = createInitialState({ nowWallMs: 0 })
    const before = { s: 1234.5678, a: 321.123, h: 654.321 }
    const spec = { ...createPlayerSpec(state, ctx, state.shipId)!, hp: before }
    const battle = createBattleState(spec, [], 0, 1000)
    const exact = applyDamage(before, {}, .1, 'kinetic')
    expect(exact.dealt).toBe(1)
    expect(finalizeHitDamage(before, exact.hp).dealt).toBe(1)
    expect(applyPlayerUnitDamage(state, battle, 'player', spec, .1, 'kinetic', raw => applyDamage(before, {}, raw, 'kinetic').hp)).toBe(1)
    expect(battle.meVolleyDmg!.player).toBe(1)
  })
  it('多种分层、正负抗性和混伤组合均只取整总量一次', () => {
    const weapon = { shotsByType: { kinetic: 60, plasma: 40 } } as WeaponSpec
    for (const before of [hp, { s: .3, a: 7.8, h: 91.9 }, { s: 21.2345, a: 32.6543, h: 100.1 }]) {
      for (const resist of [-.9, 0, .5, .9]) for (const raw of [.1, 1.1, 10.7, 1000]) {
        const resists = { shield: { kinetic: resist, plasma: resist }, armor: { kinetic: resist, plasma: resist }, hull: { kinetic: resist, plasma: resist } }
        const first = applyDamageExact(before, resists, raw * .6, 'kinetic').hp
        const after = applyDamageExact(first, resists, raw * .4, 'plasma').hp
        const expected = finalizeHitDamage(before, after)
        const actual = applyFoeShot(before, resists, weapon, raw, 'kinetic')
        expect(actual.s).toBeCloseTo(expected.hp.s, 10)
        expect(actual.a).toBeCloseTo(expected.hp.a, 10)
        expect(actual.h).toBeCloseTo(expected.hp.h, 10)
        const total = before.s + before.a + before.h
        if (expected.dealt < total) expect(Number.isInteger(expected.dealt)).toBe(true)
        expect(total - actual.s - actual.a - actual.h).toBeCloseTo(expected.dealt, 10)
      }
    }
  })
})
