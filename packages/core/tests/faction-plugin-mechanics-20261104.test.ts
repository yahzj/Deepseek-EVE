import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet, restoreShipFromWreck } from '../src/fleetBook'
import type { ModuleDef, SimContext } from '../src/types'
import type { UnitSpec } from '../src/combat/model'
import { createPlayerSpec } from '../src/combat/player/create'
import { createBattleState } from '../src/combat/foes/state'
import { stepBattle } from '../src/combat/step'
import { meOverlayReloadOf } from '../src/combat/blink'
import { firePlayerPhase } from '../src/combat/playerFire'
import { cargoCapacityM3Of } from '../src/inventory'
import { SHIP_DAMAGE_DEFS, shipDamageEffects, shipDamageHullResistOf } from '../src/shipDamage'
import { hullRecoveryChanceOf, noteShipWreck, reinforceChanceOfFitted, trySalvagePlayerWreckOf } from '../src/shipWrecks'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const A = 'plug-pirate-damage-management'
const C = 'plug-alien-nanobiomass'
const D = 'plug-gravekeeper-charge'
const E = 'plug-titan-drone-command'
const G = 'plug-deadarmy-reinforced-hull'
const SHIP = 'sh-hammerhead'
const base = buildSimContext()
const modules = new Map(base.modules)
function addModule(id: string, fields: Partial<ModuleDef>) {
  modules.set(id, { id, name: id, description: '', slot: 'support', ...fields })
}
addModule('test-armor', { slot: 'armor', armorHpBonus: .5 })
addModule('test-hull', { hullHpBonus: .5 })
addModule('test-resist', { hullResistAdd: { kinetic: .5, plasma: .1 }, allResistPenaltyPct: .07 })
addModule('test-calibration', { laserFalloffBonus: .2 })
addModule('test-reload-cost', { reloadPenaltyPct: .25 })
addModule('test-drone-control', { slot: 'drone-tac', droneDmgBonus: .2 })
addModule('test-kinetic-missile', { ...base.modules.get('mod-turret-kin-1')!, id: 'test-kinetic-missile', slot: 'missile' })
addModule('test-explosive-missile', { ...base.modules.get('mod-turret-kin-1')!, id: 'test-explosive-missile', slot: 'missile', damageType: 'explosive' })
const ctx: SimContext = { ...base, modules, ships: new Map(base.ships).set(SHIP, {
  ...base.ships.get(SHIP)!, shieldHp: 100, armorHp: 100, hullHp: 100, cargoM3: 100,
  maxSpeedMps: 100, cpu: 100000, droneBayM3: 1000, droneDmgBonus: .12,
  hullResist: { kinetic: .4, plasma: .86, explosive: .2 }, slots: { high: 16, mid: 16, low: 16 },
}) }

function world(plugs: string[] = [], seed = 19) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.skills.trained = {}
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const fleet = state.fleet[uid]!
  fleet.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  fleet.plugs = [...plugs]
  const spec = (local = ctx) => createPlayerSpec(state, local, uid)!
  return { state, uid, fleet, spec }
}

function foeOf(me: UnitSpec): UnitSpec {
  return { ...me, tag: 'foe-0', side: 'foe', hp: { s: 0, a: 0, h: 1e9 },
    weapons: [{ label: '', kind: 'fixed', shotDmg: 0, minRangeM: 0, maxRangeM: 10000,
      hitRate: 0, falloff: 1, reloadMs: 1e9 }], evasion: 0, armorRegenPerSec: undefined, speedMps: 0 }
}

describe('势力插件 A：战损管理', () => {
  it.each(SHIP_DAMAGE_DEFS.map(def => def.id))('%s重复战损每件仍乘0.99，六属性全部接管理参数', kind => {
    const w = world([A, A])
    const before = w.spec()
    const cargo = cargoCapacityM3Of(w.state, ctx, w.uid)
    const damage = [kind, kind]
    w.fleet.damagePlugs = damage
    const after = w.spec()
    expect(after.hp.s).toBe(Math.ceil(before.hp.s * (kind === 'shield' ? .99 ** 2 : 1)))
    expect(after.hp.a).toBe(Math.ceil(before.hp.a * (kind === 'armor' ? .99 ** 2 : 1)))
    expect(after.hp.h).toBe(Math.ceil(before.hp.h * (kind === 'hull' ? .99 ** 2 : 1)))
    expect(after.speedMps).toBeCloseTo(before.speedMps * (kind === 'speed' ? .99 ** 2 : 1), 12)
    expect(cargoCapacityM3Of(w.state, ctx, w.uid)).toBe(Math.ceil(cargo * (kind === 'cargo' ? .99 ** 2 : 1)))
    after.weapons.forEach((weapon, i) => expect(weapon.maxRangeM).toBe(Math.round(before.weapons[i]!.maxRangeM * (kind === 'range' ? .99 ** 2 : 1))))
    for (const type of ['kinetic', 'plasma'] as const) expect(after.resists.hull![type]).toBeCloseTo(before.resists.hull![type]! + .03, 12)
    expect(after.resists.hull!.explosive).toBe(before.resists.hull!.explosive)
    expect(w.fleet.damagePlugs).toBe(damage)
    expect(damage).toEqual([kind, kind])
    w.fleet.plugs = [A]
    expect(w.spec()).toEqual(after)
  })

  it('抗性在装备、舰种技能和代价之后加百分点并封顶90%，不将重复件计为新类型', () => {
    const w = world()
    w.fleet.fitted.low = ['test-resist']
    w.state.skills.trained['cruiser-ops'] = 5
    w.fleet.damagePlugs = ['armor', 'armor', 'range']
    const before = w.spec()
    w.fleet.plugs = [A, A]
    const after = w.spec()
    for (const type of ['kinetic', 'plasma'] as const) expect(after.resists.hull![type]).toBeCloseTo(before.resists.hull![type]! + .06, 12)
    expect(after.resists.shield).toEqual(before.resists.shield)
    expect(after.resists.armor).toEqual(before.resists.armor)
    w.fleet.damagePlugs = SHIP_DAMAGE_DEFS.flatMap(def => [def.id, def.id])
    expect(w.spec().resists.hull!.plasma).toBe(.9)
    expect(w.spec().resists.hull!.explosive).toBe(before.resists.hull!.explosive)
  })

  it('类型上限独立于战损件数，未装备时保留5%旧行为，改名定义仍生效', () => {
    const management = ctx.modules.get(A)!.damageManagement!
    const damage = SHIP_DAMAGE_DEFS.flatMap(def => Array(20).fill(def.id))
    expect(shipDamageHullResistOf(damage, management)).toBeCloseTo(.18, 12)
    expect(shipDamageHullResistOf(damage, { ...management, maxKinds: 2 })).toBe(.06)
    expect(shipDamageEffects(['shield', 'shield']).shield).toBeCloseTo(.95 ** 2, 12)
    expect(shipDamageEffects(Array(100).fill('shield'), management).shield).toBeCloseTo(.99 ** 100, 12)
    const renamed = { ...ctx.modules.get(A)!, id: 'test-damage-management' }
    const local = { ...ctx, modules: new Map(ctx.modules).set(renamed.id, renamed) }
    const w = world([renamed.id, renamed.id])
    w.fleet.damagePlugs = ['cargo', 'cargo']
    expect(cargoCapacityM3Of(w.state, local, w.uid)).toBe(99)
    expect(w.spec(local).resists.hull!.kinetic).toBeCloseTo(.43, 12)
  })
})

describe('势力插件 C/G：最终容量与恢复', () => {
  it('C在镀膜与盾甲战损合成后乘0.8，重复插件不叠加，整数边界不多1', () => {
    const w = world(['plug-alien-shield-coating'])
    w.fleet.fitted.low = ['test-armor']
    w.fleet.damagePlugs = ['shield', 'shield', 'armor', 'armor']
    const before = w.spec()
    w.fleet.plugs!.push(C, C)
    const after = w.spec()
    expect(after.hp.a).toBe(Math.ceil(before.hp.a * .8))
    expect(after.shieldArmorHp).toBe(Math.ceil(before.shieldArmorHp! * .8))
    expect(after.hp.s).toBe(before.hp.s)
    expect(after.armorRegenPerSec).toBe(.01)
    w.fleet.plugs = ['plug-alien-shield-coating', C]
    expect(w.spec()).toEqual(after)
    const exact = world([C, C])
    expect(exact.spec().hp.a).toBe(80)
  })

  it('C每秒按战斗最终最大装甲的1%恢复，零甲活船可回、封顶，阵亡不复活', () => {
    const w = world([C, C, 'plug-alien-shield-coating'])
    const me = w.spec()
    me.weapons = []
    const foe = foeOf(me)
    const b = createBattleState(me, [foe], 0, 1000)
    b.units[foe.tag]!.weapons[0] = 1e9
    const rt = b.units[me.tag]!
    rt.hp = { s: 0, a: 0, h: 1 }
    rt.hpMax!.a = 777
    stepBattle(w.state, b, [me], [foe], 1000, 1000, ctx.balance.battle, 1000)
    expect(rt.hp.a).toBeCloseTo(777 * .01, 12)
    rt.hp.a = 776
    stepBattle(w.state, b, [me], [foe], 1000, 1000, ctx.balance.battle, 1000)
    expect(rt.hp.a).toBe(777)
    rt.hp = { s: 0, a: 0, h: 0 }
    stepBattle(w.state, b, [me], [foe], 1000, 1000, ctx.balance.battle, 1000)
    expect(rt.hp).toEqual({ s: 0, a: 0, h: 0 })
  })

  it('G在普通结构插件、装备、技能与战损之后乘1.4，重复不叠加且无浮点进位', () => {
    const w = world(['plug-hull-plate'])
    w.fleet.fitted.low = ['test-hull']
    w.state.skills.trained['hull-upgrades'] = 5
    w.fleet.damagePlugs = ['hull', 'hull']
    const before = w.spec()
    w.fleet.plugs!.push(G, G)
    const after = w.spec()
    expect(after.hp.h).toBe(Math.ceil(before.hp.h * 1.4))
    expect(after.hp.s).toBe(before.hp.s)
    expect(after.hp.a).toBe(before.hp.a)
    w.fleet.plugs = ['plug-hull-plate', G]
    expect(w.spec()).toEqual(after)
    expect(world([G, G]).spec().hp.h).toBe(140)
  })
})

describe('势力插件 D：舰载武器蓄能', () => {
  it('动能导弹、动能近防和所有激光近防均翻倍，爆破导弹与无人机不变', () => {
    const w = world()
    w.fleet.fitted.high = ['test-kinetic-missile', 'test-explosive-missile', 'mod-pd-e', 'mod-lair-pd-r']
    w.fleet.droneLoad = { 'drone-scout': 1 }
    const before = w.spec()
    expect(before.weapons).toHaveLength(5)
    w.fleet.plugs = [D, D]
    const after = w.spec()
    for (const [i, old] of before.weapons.entries()) {
      const next = after.weapons[i]!
      const affected = old.moduleId !== 'test-explosive-missile' && old.src !== 'drone'
      expect(next.reloadMs).toBe(old.reloadMs * (affected ? 2 : 1))
      expect(next.falloff).toBeCloseTo(affected ? 1 - (1 - old.falloff) * .5 : old.falloff, 12)
      if (old.shotDmg !== undefined) expect(next.shotDmg).toBe(old.shotDmg * (affected ? 2 : 1))
      for (const type of ['kinetic', 'explosive'] as const) if (old.shotsByType?.[type] !== undefined) {
        expect(next.shotsByType?.[type]).toBe(old.shotsByType[type]! * (affected ? 2 : 1))
      }
      expect(next.canHitDrones).toBe(old.canHitDrones)
      expect(next.antiDroneMul).toBe(old.antiDroneMul)
    }
    w.fleet.plugs = [D]
    expect(w.spec()).toEqual(after)
    w.fleet.fitted.high = []
    const chargedBase = w.spec().weapons.find(weapon => weapon.src === 'base')!
    w.fleet.plugs = []
    expect(w.spec().weapons.find(weapon => weapon.src === 'base')).toEqual(chargedBase)
  })

  it('校准仪合成后再减半远端衰减，叠光步长、下限与装备周期代价一起翻倍', () => {
    const w = world()
    w.fleet.fitted.high = ['mod-lair-laser-r']
    w.fleet.fitted.low = ['test-calibration', 'test-calibration', 'test-reload-cost']
    const before = w.spec()
    const old = before.weapons[0]!
    expect(old.overlayDrive).toBeDefined()
    expect(old.falloff).toBeGreaterThan(ctx.modules.get('mod-lair-laser-r')!.falloff!)
    w.fleet.plugs = [D, D]
    const after = w.spec()
    const next = after.weapons[0]!
    expect(next.falloff).toBeCloseTo(1 - (1 - old.falloff) * .5, 12)
    expect(next.overlayDrive).toEqual({ stepMs: old.overlayDrive!.stepMs * 2, floorMs: old.overlayDrive!.floorMs * 2 })
    const oldBattle = createBattleState(before, [], 0, 1000)
    const nextBattle = createBattleState(after, [], 0, 1000)
    for (let i = 0; i < 40; i++) {
      expect(meOverlayReloadOf(after, after.tag, 0, nextBattle, next.reloadMs)).toBe(
        2 * meOverlayReloadOf(before, before.tag, 0, oldBattle, old.reloadMs))
    }
    expect(nextBattle.meOverlayReload![`${after.tag}#0`]!.r).toBe(next.overlayDrive!.floorMs)
  })

  it('三连发实际发间隔翻倍，整轮装填仍走翻倍周期，定义不被改写', () => {
    const w = world([D, D])
    w.fleet.fitted.high = ['mod-lair-beam-r']
    const me = w.spec()
    const beam = me.weapons[0]!
    expect(beam.burst).toEqual({ shots: 3, gapMs: 200 })
    expect(ctx.modules.get('mod-lair-beam-r')!.burst).toEqual({ shots: 3, gapMs: 100 })
    const foes = [foeOf(me)]
    const b = createBattleState(me, foes, 0, 1000)
    b.ammo.pla = 100
    b.distanceM = 1000
    b.units[me.tag]!.weapons[0] = 0
    const fired: number[] = []
    const dt = 10
    for (let ms = 0; ms <= beam.reloadMs + 500; ms += dt) {
      b.lastTickGameMs = ms
      const shots = b.stats.meShots
      firePlayerPhase(w.state, b, [me], foes, me, ctx.balance.battle, dt, null, { me: false, foe: false }, unit => unit, false)
      if (b.stats.meShots > shots) fired.push(ms)
    }
    expect(fired.slice(0, 3)).toEqual([0, 200, 400])
    expect(fired[3]! - fired[2]!).toBe(beam.reloadMs + dt)
  })
})

describe('势力插件 G：残骸快照的回收战损免疫', () => {
  it('只在整船成功后免新增战损，保留重复旧件，回收率与黑匣件数不变', () => {
    let recovered = 0, failed = 0, ordinaryAdded = 0
    for (let seed = 1; seed <= 80; seed++) {
      const outcomes = [false, true].map(immune => {
        const w = world([], seed)
        const plugs = immune ? [G, G] : ['plug-cpu-core', 'plug-cpu-core']
        const rec = noteShipWreck(w.state, { galaxyId: 'galaxy-hub', shipId: 'test-lost', shipName: '测试船', defId: SHIP,
          plugs, damagePlugs: ['hull', 'hull', 'cargo'] })
        expect(reinforceChanceOfFitted(undefined, ctx, plugs)).toBe(0)
        expect(hullRecoveryChanceOf(rec, w.state)).toBe(.25)
        const result = trySalvagePlayerWreckOf(w.state, ctx, 'galaxy-hub')
        return { ...w, result }
      })
      const [ordinary, immune] = outcomes
      expect(immune!.result.kind).toBe(ordinary!.result.kind)
      const result = immune!.result
      if (result.kind === 'ship') {
        recovered++
        expect(result.damagePlugs).toEqual(['hull', 'hull', 'cargo'])
        expect(result.plugs).toEqual([G, G])
        if (ordinary!.result.kind === 'ship' && ordinary!.result.damagePlugs!.length > 3) ordinaryAdded++
        const uid = restoreShipFromWreck(immune!.state, { ...result, defId: result.defId! })
        expect(loadSaveFile(serializeSaveFile(immune!.state, 0)).state.fleet[uid]!.damagePlugs).toEqual(['hull', 'hull', 'cargo'])
      } else {
        failed++
        expect(result).toEqual({ kind: 'plugs', blackBoxes: 2 })
      }
    }
    expect(recovered).toBeGreaterThan(0)
    expect(failed).toBeGreaterThan(0)
    expect(ordinaryAdded).toBeGreaterThan(0)
  })
})

describe('势力插件 E：本舰无人机有效增幅来源', () => {
  it('舰体、装备和两种伤害技能的乘积减1，不含光环或打印惩罚，重复只写一份元参数', () => {
    const w = world([E, E])
    w.fleet.fitted.high = ['test-drone-control', 'test-drone-control']
    w.fleet.droneLoad = { 'drone-scout': 1 }
    w.state.skills.trained['drone-warfare'] = 5
    w.state.skills.trained['drone-strike'] = 5
    const mult = 1.4 * 1.12 * 1.25 * 1.2
    const before = w.spec()
    expect(before.droneDamageBonusPct).toBeCloseTo(mult - 1, 12)
    expect(before.droneCommand).toEqual({ sharePct: .5, targetWeightPerM3: .01 })
    const shot = before.weapons.find(weapon => weapon.src === 'drone')!.shotDmg!
    expect(shot).toBe(Math.ceil(ctx.items.get('drone-scout')!.dmg! * 2 * mult))
    w.fleet.plugs!.push('plug-deadarmy-printing')
    const printed = w.spec()
    expect(printed.droneDamageBonusPct).toBe(before.droneDamageBonusPct)
    expect(printed.weapons.find(weapon => weapon.src === 'drone')!.shotDmg).toBe(Math.ceil(shot * .9))
    w.fleet.plugs = [E, 'plug-deadarmy-printing']
    expect(w.spec()).toEqual(printed)
    const auraCtx = { ...ctx, ships: new Map(ctx.ships).set(SHIP, { ...ctx.ships.get(SHIP)!, fleetDamageBonusPct: .9 }) }
    expect(w.spec(auraCtx).droneDamageBonusPct).toBeCloseTo(mult - 1, 12)
    const plain = world()
    plain.fleet.droneLoad = undefined
    expect(plain.spec().droneDamageBonusPct).toBeCloseTo(.12, 12)
    expect(plain.spec().droneCommand).toBeUndefined()
  })
})
