import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { advanceBattleFor, ammoLoadTotals, battleArcsFor, createPlayerSpec, refundAmmo, startBattleFor, startFleetBattleFor } from '../src/combat'
import { battleAmmoIdsFor, consumeBattleAmmo, loadAmmoTier, resolveAmmoTier } from '../src/combatAmmo'
import { cleanBattle } from '../src/saveBattleClean'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'
import type { DamageType, ItemDef } from '../src/types'

const types = ['kinetic', 'explosive', 'plasma'] as const
const baseId = (type: DamageType) => `ammo-${type}-l`
const tierId = (type: DamageType, tier = 2) => `ammo-${type}-${tier}`
const keyOf = (type: DamageType) => type === 'kinetic' ? 'kin' : type === 'explosive' ? 'exp' : 'pla'

function world(type: DamageType = 'kinetic', guns = 1) {
  const bed = ship('ammo-audit-bed', { cpu: 1000, slots: { high: 8, mid: 2, low: 2 }, shieldHp: 1e8, armorHp: 1e8, hullHp: 1e8 })
  const weapon = moduleDef('ammo-audit-weapon', type === 'plasma' ? 'laser' : type === 'explosive' ? 'missile' : 'turret', 0, {
    rack: 'high', damageType: type, maxRangeM: 5000, minRangeM: 0, hitRate: 1, falloff: 1, reloadMs: 1000, dmgMult: 4,
  })
  // MK3仅作候选上下文夹具，不给三号注册正式内容。
  const items: ItemDef[] = [2, 3].map(tier => ({ id: tierId(type, tier), name: `Ammo ${type} MK${tier}`, kind: 'ammo', unitM3: .02, baseSellPriceIsk: 45, description: 'audit', damageType: type, dmg: tier === 2 ? 8 : 11 }))
  const foe = { ...anomaly('ammo-audit-foe', 'galaxy-hub', { threat: 20 }), foeHpOverride: 1e9 }
  const ctx = makeTestCtx({ quietEvents: true, ships: [bed], modules: [weapon], items, anomalies: [foe] })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, bed.id)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: Array.from({ length: guns }, () => weapon.id), mid: [], low: [] }
  state.warehouse.items = {}
  const need = ammoLoadTotals(createPlayerSpec(state, ctx, uid)!, ctx.balance.battle, state)[type]!
  return { state, ctx, uid, need, foe, bed, weapon }
}

describe('选档与取弹读取同一允许来源', () => {
  it.each(types)('%s：仓库模式忽略货仓高库存，回落仓库可用档并实际开火', type => {
    const { state, ctx, uid, foe } = world(type)
    state.resupplyFromWarehouse = true
    state.fleet[uid]!.ammoPref = { [type]: tierId(type) }
    state.fleet[uid]!.cargo[tierId(type)] = 10000
    state.warehouse.items[baseId(type)] = 25
    const resolve = resolveAmmoTier(state, ctx, uid, type, 100)
    const loaded = loadAmmoTier(structuredClone(state), ctx, uid, type, 100)
    expect(resolve).toMatchObject({ id: baseId(type), can: 25, fellBack: true })
    expect(loaded).toEqual({ id: baseId(type), loaded: 25, fellBack: true })
    const battle = startBattleFor(state, ctx, uid, foe.id, 0, 1000)!
    expect(battle.ammo[keyOf(type)]).toBe(25)
    expect(battle.ammoIds![type]).toBe(baseId(type))
    expect(state.warehouse.items[baseId(type)] ?? 0).toBe(0)
    expect(state.fleet[uid]!.cargo[tierId(type)]).toBe(10000)
    expect(state.logs.some(log => log.text.includes('本场改用'))).toBe(true)
    const src = type === 'plasma' ? 'laser' : type === 'explosive' ? 'missile' : 'turret'
    expect(battleArcsFor(state, ctx, { battle, anomaly: foe, leaderShipId: uid })!.me.find(w => w.src === src)!.type).toBe(type)
    battle.distanceM = 1000
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, uid, foe.id)
    expect(battle.ammo[keyOf(type)]).toBe(24)
    expect(battle.fx.some(fx => fx.side === 'me' && fx.src === src && fx.type === type)).toBe(true)
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items[baseId(type)]).toBe(24)
    expect(state.warehouse.items[tierId(type)] ?? 0).toBe(0)
  })

  it.each(types)('%s：货仓模式忽略仓库高库存，实取目标货仓25发', type => {
    const { state, ctx, uid } = world(type)
    state.resupplyFromWarehouse = false
    state.warehouse.items[baseId(type)] = 10000
    state.fleet[uid]!.cargo[tierId(type)] = 25
    const resolve = resolveAmmoTier(state, ctx, uid, type, 100)
    const loaded = loadAmmoTier(state, ctx, uid, type, 100)
    expect(resolve).toMatchObject({ id: tierId(type), can: 25, fellBack: true })
    expect(loaded).toEqual({ id: tierId(type), loaded: 25, fellBack: true })
    expect(state.fleet[uid]!.cargo[tierId(type)] ?? 0).toBe(0)
    expect(state.warehouse.items[baseId(type)]).toBe(10000)
  })

  it('同档两处各60、需求100：仓库模式预估与实际均60，货仓不动', () => {
    const { state, ctx, uid } = world()
    state.fleet[uid]!.cargo[baseId('kinetic')] = 60
    state.warehouse.items[baseId('kinetic')] = 60
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100).can).toBe(60)
    expect(loadAmmoTier(state, ctx, uid, 'kinetic', 100).loaded).toBe(60)
    expect(state.fleet[uid]!.cargo[baseId('kinetic')]).toBe(60)
  })

  it('非驾驶船独有货仓100发，实装本舰100发，驾驶舰与驾驶身份不变', () => {
    const { state, ctx, uid, bed, weapon, foe } = world()
    const other = addShipToFleet(state, bed.id)
    state.fleet[other]!.fitted = { high: [weapon.id], mid: [], low: [] }
    state.resupplyFromWarehouse = false
    state.fleet[other]!.cargo[baseId('kinetic')] = 100
    const loaded = loadAmmoTier(structuredClone(state), ctx, other, 'kinetic', 100)
    expect(loaded.loaded).toBe(100)
    const battle = startBattleFor(state, ctx, other, foe.id, 0)!
    expect(battle.ammo.kin).toBe(100)
    expect(state.shipId).toBe(uid)
    expect(state.fleet[other]!.cargo[baseId('kinetic')] ?? 0).toBe(0)
    expect(state.fleet[uid]!.cargo).toEqual({})
  })

  it('仅驾驶船有货，另一舰没有可取弹时停火，不扣驾驶舰库存', () => {
    const { state, ctx, uid, bed, weapon, foe } = world()
    const other = addShipToFleet(state, bed.id)
    state.fleet[other]!.fitted = { high: [weapon.id], mid: [], low: [] }
    state.resupplyFromWarehouse = false
    state.fleet[uid]!.cargo[baseId('kinetic')] = 100
    const battle = startBattleFor(state, ctx, other, foe.id, 0)!
    expect(battle.ammo.kin).toBe(0)
    expect(state.fleet[uid]!.cargo[baseId('kinetic')]).toBe(100)
    expect(state.fleet[other]!.cargo[baseId('kinetic')] ?? 0).toBe(0)
    expect(state.shipId).toBe(uid)
  })

  it.each(types)('%s：编队从各舰自身货仓预载，不重复扣主控，也不借仓库', type => {
    const { state, ctx, uid, bed, weapon, foe } = world(type)
    const other = addShipToFleet(state, bed.id)
    state.fleet[other]!.fitted = { high: [weapon.id], mid: [], low: [] }
    state.resupplyFromWarehouse = false
    state.fleet[uid]!.cargo[baseId(type)] = 31
    state.fleet[other]!.cargo[baseId(type)] = 17
    state.warehouse.items = { [tierId(type)]: 10000 }
    expect(resolveAmmoTier(state, ctx, uid, type, 100).can).toBe(31)
    expect(resolveAmmoTier(state, ctx, other, type, 100).can).toBe(17)
    const battle = startFleetBattleFor(state, ctx, [uid, other], foe.id, 0, 1000)!
    expect(battle.ammo[keyOf(type)]).toBe(48)
    expect(battle.ammoIds![type]).toBe(baseId(type))
    expect(state.fleet[uid]!.cargo[baseId(type)] ?? 0).toBe(0)
    expect(state.fleet[other]!.cargo[baseId(type)] ?? 0).toBe(0)
    expect(state.warehouse.items[tierId(type)]).toBe(10000)
    expect(state.shipId).toBe(uid)
    battle.distanceM = 1000
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, uid, foe.id)
    expect(battle.ammo[keyOf(type)]).toBe(46)
    expect(new Set(battle.fx.filter(f => f.side === 'me' && f.src === (type === 'plasma' ? 'laser' : type === 'explosive' ? 'missile' : 'turret')).map(f => f.tag))).toEqual(new Set(['player', 'ally-1']))
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items[baseId(type)]).toBe(46)
    expect(state.warehouse.items[tierId(type)]).toBe(10000)
  })

  it.each([undefined, true, false])('开关%s：无允许库存不借其他来源，选档查询不扣货', warehouse => {
    const { state, ctx, uid } = world()
    state.resupplyFromWarehouse = warehouse
    if (warehouse === false) state.warehouse.items[baseId('kinetic')] = 100
    else state.fleet[uid]!.cargo[baseId('kinetic')] = 100
    const before = structuredClone(state)
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100)).toMatchObject({ can: 0, fellBack: false })
    expect(loadAmmoTier(state, ctx, uid, 'kinetic', 100).loaded).toBe(0)
    expect(state).toEqual(before)
  })

  it('目标舰货仓两档都够时偏好优先，需求截断与实载一致', () => {
    const { state, ctx, uid, bed } = world()
    const other = addShipToFleet(state, bed.id)
    state.resupplyFromWarehouse = false
    state.fleet[other]!.cargo = { [baseId('kinetic')]: 200, [tierId('kinetic')]: 300 }
    state.fleet[other]!.ammoPref = { kinetic: tierId('kinetic') }
    const before = structuredClone(state)
    expect(resolveAmmoTier(state, ctx, other, 'kinetic', 25)).toMatchObject({ id: tierId('kinetic'), can: 25, fellBack: false })
    expect(state).toEqual(before)
    expect(loadAmmoTier(state, ctx, other, 'kinetic', 25)).toEqual({ id: tierId('kinetic'), loaded: 25, fellBack: false })
    expect(state.fleet[other]!.cargo).toEqual({ [baseId('kinetic')]: 200, [tierId('kinetic')]: 275 })
    expect(state.shipId).toBe(uid)
  })

  it.each(types)('%s：自动回落后中途重载不重新预载，伤害/耗弹与连续推进一致', type => {
    const { state, ctx, uid, foe } = world(type)
    state.fleet[uid]!.cargo[baseId(type)] = 10000
    state.warehouse.items[tierId(type)] = 25
    const battle = startBattleFor(state, ctx, uid, foe.id, 0, 1000)!
    expect(battle.ammoIds![type]).toBe(tierId(type))
    battle.distanceM = 1000
    for (let time = 100; time <= 1000; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, ctx, battle, uid, foe.id)
    }
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.ammo).toEqual(battle.ammo)
    expect(loaded.ammoIds).toEqual(battle.ammoIds)
    const loadedState = structuredClone(state)
    const inventory = structuredClone(state.warehouse.items)
    for (let time = 1100; time <= 3000; time += 100) {
      state.gameMs = loadedState.gameMs = time
      advanceBattleFor(state, ctx, battle, uid, foe.id)
      advanceBattleFor(loadedState, ctx, loaded, uid, foe.id)
    }
    expect(loaded.ammo).toEqual(battle.ammo)
    expect(loaded.stats).toEqual(battle.stats)
    expect(loaded.units).toEqual(battle.units)
    expect(state.warehouse.items).toEqual(inventory)
    expect(loadedState.warehouse.items).toEqual(inventory)
    expect(state.fleet[uid]!.cargo[baseId(type)]).toBe(10000)
  })
})

describe('正常回落与现行设计对照', () => {
  it.each(types)('%s：仓库同族实际货源一致时，基础10、MK2=50、MK3=100正常选MK3', type => {
    const { state, ctx, uid } = world(type)
    state.warehouse.items = { [baseId(type)]: 10, [tierId(type)]: 50, [tierId(type, 3)]: 100 }
    const r = loadAmmoTier(state, ctx, uid, type, 200)
    expect(r).toEqual({ loaded: 100, id: tierId(type, 3), fellBack: true })
    expect(state.warehouse.items[baseId(type)]).toBe(10)
    expect(state.warehouse.items[tierId(type)]).toBe(50)
    expect(state.warehouse.items[tierId(type, 3)] ?? 0).toBe(0)
  })

  it('同源两档都够时偏好优先，没有偏好仍基础优先', () => {
    const { state, ctx, uid } = world()
    state.warehouse.items = { [baseId('kinetic')]: 1000, [tierId('kinetic')]: 1000 }
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100).id).toBe(baseId('kinetic'))
    state.fleet[uid]!.ammoPref = { kinetic: tierId('kinetic') }
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100).id).toBe(tierId('kinetic'))
  })

  it('5门余3发按完整齐射停火，不扣剩余；无需归因为换档失败', () => {
    const { state, ctx, uid, foe } = world('kinetic', 5)
    state.warehouse.items[baseId('kinetic')] = 3
    const battle = startBattleFor(state, ctx, uid, foe.id, 0, 1000)!
    battle.distanceM = 1000
    for (let time = 100; time <= 1000; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, ctx, battle, uid, foe.id)
    }
    expect(battle.ammo.kin).toBe(3)
    expect(battle.fx.filter(f => f.side === 'me' && f.src === 'turret')).toHaveLength(0)
  })

  it('本场选定档打空，即使母港另一档还有货也不再次自动预载', () => {
    const { state, ctx, uid, need, foe } = world()
    state.fleet[uid]!.ammoPref = { kinetic: tierId('kinetic') }
    state.warehouse.items = { [baseId('kinetic')]: need * 2, [tierId('kinetic')]: need * 2 }
    const battle = startBattleFor(state, ctx, uid, foe.id, 0, 1000)!
    expect(battle.ammoIds!.kinetic).toBe(tierId('kinetic'))
    expect(consumeBattleAmmo(battle, 'player', 'kinetic', battle.ammo.kin)).toBe(true)
    const inventory = structuredClone(state.warehouse.items)
    battle.distanceM = 1000
    state.gameMs = 1000
    advanceBattleFor(state, ctx, battle, uid, foe.id)
    expect(battle.ammo.kin).toBe(0)
    expect(battle.ammoIds!.kinetic).toBe(tierId('kinetic'))
    expect(state.warehouse.items).toEqual(inventory)
  })

  it('显式有限物资快照不读仓库/货仓，回落只在该快照选择', () => {
    const { state, ctx, uid } = world()
    state.warehouse.items[baseId('kinetic')] = 10000
    state.fleet[uid]!.cargo[tierId('kinetic')] = 10000
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100, { [tierId('kinetic', 3)]: 25 })).toMatchObject({ id: tierId('kinetic', 3), can: 25 })
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100, {}).can).toBe(0)
    state.resupplyFromWarehouse = false
    expect(resolveAmmoTier(state, ctx, uid, 'kinetic', 100, { [tierId('kinetic', 3)]: 25 })).toMatchObject({ id: tierId('kinetic', 3), can: 25 })
  })
})

describe('普通编队混档的已知简化，不冒称新回归', () => {
  it('两舰各扣基础/MK2，合池后全队按主控基础伤害，未用MK2按基础退回', () => {
    const { state, ctx, uid, need, bed, weapon, foe } = world()
    const other = addShipToFleet(state, bed.id)
    state.fleet[other]!.fitted = { high: [weapon.id], mid: [], low: [] }
    state.fleet[other]!.ammoPref = { kinetic: tierId('kinetic') }
    state.warehouse.items = { [baseId('kinetic')]: need * 2, [tierId('kinetic')]: need * 2 }
    const before = structuredClone(state.warehouse.items)
    const battle = startFleetBattleFor(state, ctx, [uid, other], foe.id, 0)!
    expect(state.warehouse.items[baseId('kinetic')]).toBe(before[baseId('kinetic')]! - need)
    expect(state.warehouse.items[tierId('kinetic')]).toBe(before[tierId('kinetic')]! - need)
    expect(battle.ammo.kin).toBe(need * 2)
    expect(battleAmmoIdsFor(battle, 'ally-1')!.kinetic).toBe(baseId('kinetic'))
    const actual = createPlayerSpec(state, ctx, other, battleAmmoIdsFor(battle, 'ally-1'))!.weapons.find(w => w.kind === 'gun')!.shotsByType!.kinetic!
    const preferred = createPlayerSpec(state, ctx, other)!.weapons.find(w => w.kind === 'gun')!.shotsByType!.kinetic!
    expect(actual).toBeLessThan(preferred)
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items[baseId('kinetic')]).toBe(before[baseId('kinetic')]! + need)
    expect(state.warehouse.items[tierId('kinetic')]).toBe(before[tierId('kinetic')]! - need)
  })
})
