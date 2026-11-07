import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec } from '../src/combat/player/create'
import { shipWeaponRangeBonusesOf, SHIP_TIER_RANGE_BONUS } from '../src/ships/range'
import type { ShipDef, SimContext } from '../src/types'
import { applyMeJammerDebuff } from '../src/combat/foeRange'

const ctx = buildSimContext()
const types = ['kinetic', 'explosive', 'plasma'] as const
function world(tier: number, hullBonus?: ShipDef['weaponRangeBonusPct']) {
  const ship = { ...ctx.ships.get('sh-megalodon')!, id: 'range-test', tier, weaponRangeBonusPct: hullBonus,
    slots: { high: 6, mid: 5, low: 4 }, cpu: 1000, droneBayM3: 200 }
  const local: SimContext = { ...ctx, ships: new Map(ctx.ships).set(ship.id, ship) }
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  const uid = addShipToFleet(state, ship.id)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-2', 'mod-missile-2', 'mod-laser-2'], mid: [], low: [] }
  state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
  return { state, uid, local, ship }
}
describe('舰级额外战前武器射程', () => {
  it.each([1, 2, 3, 4, 5])('T%i的三系按档位合成且不修改船体特性，异常档位不外推', tier => {
    const own = { kinetic: .2, plasma: .1 }
    const ship = { tier, weaponRangeBonusPct: own }
    const bonus = shipWeaponRangeBonusesOf(ship)
    for (const type of types) expect(bonus[type] ?? 0).toBeCloseTo((own[type as keyof typeof own] ?? 0) + (tier - 1) * .05)
    expect(own).toEqual({ kinetic: .2, plasma: .1 })
    expect(SHIP_TIER_RANGE_BONUS[tier]).toBeCloseTo((tier - 1) * .05)
    expect(shipWeaponRangeBonusesOf({ tier: 99 })).toEqual({})
  })

  it.each([1, 2, 3, 4, 5])('T%i炮台/导弹/激光射程增加，伤害/装填/最短射程/无人机不变', tier => {
    const a = world(1), b = world(tier)
    const before = createPlayerSpec(a.state, a.local, a.uid)!
    const refs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
    const after = createPlayerSpec(b.state, b.local, b.uid, undefined, refs)!
    expect(after.weapons.filter(w => w.src !== 'drone')).toHaveLength(3)
    for (const [i, weapon] of after.weapons.entries()) {
      const old = before.weapons[i]!
      if (weapon.src === 'drone') expect(weapon).toEqual(old)
      else {
        expect(weapon.maxRangeM).toBe(Math.round(old.maxRangeM * (1 + (tier - 1) * .05)))
        expect(refs.weaponRanges[i]!.bonusMul).toBeCloseTo(1 + (tier - 1) * .05)
        expect({ ...weapon, maxRangeM: old.maxRangeM }).toEqual(old)
      }
    }
  })

  it('46艘实际目录均保留原船体特性，巨齿鲨三系20%+15%=35%', () => {
    for (const ship of ctx.ships.values()) {
      const before = structuredClone(ship)
      const merged = shipWeaponRangeBonusesOf(ship)
      for (const type of types) expect(merged[type] ?? 0).toBeCloseTo((ship.weaponRangeBonusPct?.[type] ?? 0) + SHIP_TIER_RANGE_BONUS[ship.tier]!)
      expect(ship).toEqual(before)
    }
    const meg = shipWeaponRangeBonusesOf(ctx.ships.get('sh-megalodon')!)
    for (const type of types) expect(meg[type]).toBeCloseTo(.35)
  })

  it('舰级与船体、同系装备及射程插件加算，电子战账本包含全部战前增益', () => {
    const w = world(4, { kinetic: .2 })
    const support = { ...ctx.modules.get('mod-stab-kin-2')!, id: 'test-range-support', slot: 'support' as const,
      rangeTypeBonusPct: { kinetic: .22 }, damageTypeBonusPct: undefined }
    w.local = { ...w.local, modules: new Map(w.local.modules).set(support.id, support) }
    w.state.fleet[w.uid]!.fitted.low = [support.id]
    w.state.fleet[w.uid]!.plugs = ['plug-rangefinder']
    const plug = ctx.modules.get('plug-rangefinder')!.plugRangeBonusPct!
    const refs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
    const spec = createPlayerSpec(w.state, w.local, w.uid, undefined, refs)!
    const index = spec.weapons.findIndex(w => w.moduleId === 'mod-turret-kin-2')
    const mul = 1 + .15 + .2 + .22 + plug
    expect(refs.weaponRanges[index]!.bonusMul).toBeCloseTo(mul)
    const base = ctx.modules.get('mod-turret-kin-2')!.maxRangeM!
    expect(spec.weapons[index]!.maxRangeM).toBe(Math.round(base * mul))
    const jammed = applyMeJammerDebuff(structuredClone(spec), .2, refs.weaponRanges)
    expect(jammed.weapons[index]!.maxRangeM).toBeGreaterThan(0)
    expect(jammed.weapons[index]!.maxRangeM).toBeLessThan(spec.weapons[index]!.maxRangeM)
  })

  it('基础炮不进入巨齿鲨式加成池，修理无人机与支援装置不获得战斗射程', () => {
    const w = world(5)
    w.state.fleet[w.uid]!.fitted = { high: [], mid: ['mod-shieldfield-2'], low: [] }
    w.state.fleet[w.uid]!.droneLoad = { 'drone-repair-mil': 1 }
    const spec = createPlayerSpec(w.state, w.local, w.uid)!
    expect(spec.weapons.find(w => w.src === 'base')!.maxRangeM).toBe(2500)
    expect(spec.weapons.find(w => w.repairDrone)!.maxRangeM).toBe(0)
  })
})
