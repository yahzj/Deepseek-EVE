import { describe, expect, it } from 'vitest'
import { buildSimContext, MODULES } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec } from '../src/playerSpec'
import { cpuBudgetOf, droneBayTotalM3, repairDeprecatedModules, stackingOf, stackWeight } from '../src/equipment'
import { cargoCapacityM3Of, cargoUsedM3Of } from '../src/inventory'
import { plugEffectPartsOf } from '../src/plugEffects'
import { supportEffectPartsOf } from '../src/stacking'
import { fittedEffectParamsOf } from '../src/foeRange'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const supportIds = [
  ...['kin', 'exp', 'pla'].flatMap(type => [1, 2, 3].map(tier => `mod-stab-${type}-${tier}`)),
  'mod-rof-1', 'mod-rof-2', 'mod-rof-3', 'mod-wh-d-loader', 'mod-wh-d-steady', 'mod-wh-g-ballistic',
]
const plugIds = ['plug-shield-plate', 'plug-armor-plate', 'plug-hull-plate', 'plug-firepower',
  'plug-sight', 'plug-rangefinder', 'plug-thruster', 'plug-titan-compression']
function world(low: string[] = [], plugs: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: 23 })
  const uid = addShipToFleet(state, 'sh-wh-a-frigate')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-3', 'mod-missile-3', 'mod-laser-3'], mid: [], low }
  state.fleet[uid]!.plugs = plugs
  const local = { ...ctx, ships: new Map(ctx.ships) }
  local.ships.set('sh-wh-a-frigate', { ...ctx.ships.get('sh-wh-a-frigate')!, cpu: 10000,
    slots: { high: 6, mid: 6, low: 6 }, plugSlots: 8, droneBayM3: 10 })
  const spec = () => createPlayerSpec(state, local, uid)!
  return { state, uid, local, spec }
}
const sumWeights = (n: number) => Array.from({ length: n }, (_, i) => stackWeight(i + 1)).reduce((a, b) => a + b, 0)

describe('指定支援件效果池', () => {
  it.each(supportIds)('%s 单件仍满额，重复安装按效果池递减', id => {
    const mod = ctx.modules.get(id)!
    expect(stackingOf(mod).group).toBe('weighted')
    for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
      for (const family of ['damage', 'range'] as const) {
        const value = family === 'damage' ? mod.damageTypeBonusPct?.[type] : mod.rangeTypeBonusPct?.[type]
        if (!value) continue
        const parts = supportEffectPartsOf([mod, mod], `${family}:${type}`)
        expect(parts.map(p => p.value * p.weight)).toEqual([value, value * stackWeight(2)])
      }
    }
    if (mod.reloadCutPct) expect(supportEffectPartsOf([mod, mod], 'reload').map(p => p.value * p.weight))
      .toEqual([mod.reloadCutPct, mod.reloadCutPct * stackWeight(2)])
  })

  it('混装强件优先，同效果换型号不绕过；动能与能量分别计算', () => {
    const defs = ['mod-stab-kin-3', 'mod-wh-d-steady', 'mod-wh-g-ballistic', 'mod-stab-pla-3'].map(id => ctx.modules.get(id)!)
    expect(supportEffectPartsOf(defs, 'damage:kinetic').map(p => p.weight)).toEqual([stackWeight(3), stackWeight(2), 1, 1])
    expect(supportEffectPartsOf(defs, 'damage:plasma').map(p => p.weight)).toEqual([1, 1, 1, stackWeight(2)])
    expect(supportEffectPartsOf([...defs].reverse(), 'damage:kinetic').reduce((n, p) => n + p.value * p.weight, 0))
      .toBeCloseTo(.22 + .18 * stackWeight(2) + .15 * stackWeight(3), 12)
  })

  it('真实建档的伤害、装填与射程使用折权读数；插件池不挤占普通装备权重', () => {
    const base = world(), fitted = world(['mod-wh-g-ballistic', 'mod-wh-g-ballistic', 'mod-rof-3', 'mod-wh-d-loader'],
      ['plug-firepower', 'plug-firepower', 'plug-rangefinder', 'plug-rangefinder'])
    const original = base.spec(), after = fitted.spec(), w2 = stackWeight(2)
    const gain = 1 + .22 * (1 + w2)
    const fire = 1 + .15 * (1 + w2)
    const reload = 1 + .18 + .12 * w2
    for (const weapon of after.weapons) {
      const before = original.weapons.find(w => w.moduleId === weapon.moduleId)!
      expect(weapon.reloadMs).toBe(Math.round(before.reloadMs / reload))
      if (weapon.src === 'turret') {
        const ammo = ctx.items.get('ammo-kinetic-l')!.dmg!
        const gun = ctx.modules.get(weapon.moduleId!)!
        const hull = ctx.ships.get('sh-wh-a-frigate')!
        expect(weapon.shotsByType!.kinetic).toBe(Math.ceil(ammo * gun.dmgMult! * (1 + hull.powerBonus!) * gain * fire))
        const hullBonus = ctx.ships.get('sh-wh-a-frigate')!.weaponRangeBonusPct?.kinetic ?? 0
        expect(weapon.maxRangeM).toBe(Math.round(ctx.modules.get(weapon.moduleId!)!.maxRangeM! *
          (1 + hullBonus + .22 * (1 + w2) + .2 * (1 + w2))))
      }
    }
    expect(fittedEffectParamsOf(fitted.state, fitted.local, fitted.uid, ctx.modules.get('mod-wh-g-ballistic')!, 2))
      .toEqual(expect.arrayContaining([
        { key: 'damage:kinetic', raw: .22, eff: .22 * w2 },
        { key: 'range:kinetic', raw: .22, eff: .22 * w2 },
      ]))
  })

  it('范围外生体脉搏加速器保留速度族和原装填加算', () => {
    const mod = ctx.modules.get('mod-wh-c-pulse')!
    expect(stackingOf(mod)).toEqual({ group: 'weighted', kind: 'speed' })
    const a = world(), b = world([mod.id, mod.id])
    expect(b.spec().weapons[0]!.reloadMs).toBe(Math.round(a.spec().weapons[0]!.reloadMs / (1 + 2 * mod.reloadCutPct!)))
  })

  it('已装弱件按实际强度排名，双属性件的每种伤害权重独立', () => {
    const w = world(['mod-stab-kin-3', 'mod-wh-d-steady', 'mod-wh-g-ballistic'])
    const weak = fittedEffectParamsOf(w.state, w.local, w.uid, ctx.modules.get('mod-stab-kin-3')!, 1)
    expect(weak).toContainEqual({ key: 'damage:kinetic', raw: .15, eff: .15 * stackWeight(3) })
    const dual = fittedEffectParamsOf(w.state, w.local, w.uid, ctx.modules.get('mod-wh-d-steady')!, 2)
    expect(dual).toContainEqual({ key: 'damage:kinetic', raw: .18, eff: .18 * stackWeight(2) })
    expect(dual).toContainEqual({ key: 'damage:plasma', raw: .18, eff: .18 })
    const other = addShipToFleet(w.state, 'sh-wh-a-frigate')
    w.state.fleet[other]!.fitted = { high: ['mod-turret-kin-3'], mid: [], low: ['mod-stab-kin-3'] }
    expect(fittedEffectParamsOf(w.state, w.local, other, ctx.modules.get('mod-stab-kin-3')!, 1))
      .toContainEqual({ key: 'damage:kinetic', raw: .15, eff: .15 })
  })
})

describe('插件独立效果池与例外', () => {
  it.each(plugIds)('%s 单件不变，五件同型按同一权重投影，原数据不被修改', id => {
    const raw = ctx.modules.get(id)!, snapshot = JSON.stringify(raw)
    const rows = plugEffectPartsOf(Array(5).fill(id), ctx)
    expect(rows.map(p => p.weight)).toEqual([1, 2, 3, 4, 5].map(stackWeight))
    for (const field of ['shieldHpAdd', 'armorHpAdd', 'hullHpAdd', 'damageBonusPct', 'hitBonusPct',
      'plugRangeBonusPct', 'speedAddMps', 'cargoCapacityBonusPct', 'droneBayBonusM3', 'cpuPenalty', 'speedPenaltyMps'] as const) {
      if (raw[field] === undefined) continue
      expect(rows[0]!.effective[field]).toBe(raw[field])
      expect(rows.reduce((n, row) => n + row.effective[field]!, 0)).toBeCloseTo(raw[field]! * sumWeights(5), 10)
    }
    expect(JSON.stringify(raw)).toBe(snapshot)
  })

  it('护盾/装甲/结构/速度分池；装甲减速随装甲收益权重，空间压缩整件同权', () => {
    const ids = ['plug-shield-plate', 'plug-armor-plate', 'plug-thruster', 'plug-armor-plate',
      'plug-titan-compression', 'plug-thruster', 'plug-titan-compression', 'plug-hull-plate']
    const rows = plugEffectPartsOf(ids, ctx)
    expect(rows.map(p => p.weight)).toEqual([1, 1, 1, stackWeight(2), 1, stackWeight(2), stackWeight(2), 1])
    const armor = rows[3]!, capacity = rows[6]!
    expect(armor.effective.speedPenaltyMps).toBe(20 * stackWeight(2))
    for (const key of ['cargoCapacityBonusPct', 'droneBayBonusM3', 'cpuPenalty', 'speedPenaltyMps'] as const) {
      expect(capacity.effective[key]! / capacity.mod[key]!).toBeCloseTo(stackWeight(2), 12)
    }
  })

  it('协处理和选靶仍全额，四件势力插件仍去重且不抢普通效果的权重', () => {
    const ids = ['plug-cpu-core', 'plug-cpu-core', 'plug-target-beacon', 'plug-target-beacon',
      'plug-concealment', 'plug-concealment']
    const w = world([], ids)
    expect(cpuBudgetOf(w.state, w.local, w.uid)).toBe(10000 + 160)
    expect(w.spec().targetWeightMul).toBeCloseTo(3 ** 2 * .7 ** 2, 12)
    for (const mod of MODULES.filter(m => m.plugNonStacking)) {
      const rows = plugEffectPartsOf([mod.id, mod.id, 'plug-shield-plate'], ctx)
      expect(rows).toHaveLength(2)
      expect(rows[0]!.effective).toEqual(mod)
      expect(rows[1]!.weight).toBe(1)
    }
  })

  it('护盾取整、命中原乘算、CPU与容量共用折权，不因读数修改库存与已装列表', () => {
    const base = world(), w = world([], ['plug-shield-plate', 'plug-shield-plate', 'plug-sight', 'plug-sight'])
    expect(w.spec().hp.s).toBe(Math.ceil(base.spec().hp.s + 120 * sumWeights(2)))
    expect(w.spec().weapons[0]!.eqHitMul).toBeCloseTo(1.15 * (1 + .15 * stackWeight(2)), 12)
    w.state.fleet[w.uid]!.plugs = ['plug-titan-compression', 'plug-titan-compression']
    const before = JSON.stringify(w.state)
    expect(cpuBudgetOf(w.state, w.local, w.uid)).toBeCloseTo(10000 - 20 * sumWeights(2), 12)
    expect(droneBayTotalM3(w.local.ships.get('sh-wh-a-frigate'), w.state.fleet[w.uid]!.fitted, w.local, w.state.fleet[w.uid]!.plugs))
      .toBeCloseTo(10 + 120 * sumWeights(2), 12)
    expect(cargoCapacityM3Of(w.state, w.local, w.uid)).toBe(Math.ceil(ctx.ships.get('sh-wh-a-frigate')!.cargoM3 * (1 + .25 * sumWeights(2))))
    expect(JSON.stringify(w.state)).toBe(before)
  })

  it('旧装配存读保留重复插件与超量货物，无人机容量纠正只完整退库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 24 })
    const uid = addShipToFleet(state, 'sh-wh-a-frigate')
    state.fleet[uid]!.plugs = ['plug-titan-compression', 'plug-titan-compression']
    state.fleet[uid]!.cargo = { 'ore-veldspar': 100000 }
    state.fleet[uid]!.droneLoad = { 'drone-scout': 200 }
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const before = JSON.stringify(loaded.fleet[uid]!.cargo)
    const owned = (loaded.fleet[uid]!.droneLoad?.['drone-scout'] ?? 0) + (loaded.warehouse.items['drone-scout'] ?? 0)
    expect(cargoUsedM3Of(loaded, ctx, uid)).toBeGreaterThan(cargoCapacityM3Of(loaded, ctx, uid))
    repairDeprecatedModules(loaded, ctx)
    expect(loaded.fleet[uid]!.plugs).toEqual(state.fleet[uid]!.plugs)
    expect(JSON.stringify(loaded.fleet[uid]!.cargo)).toBe(before)
    expect((loaded.fleet[uid]!.droneLoad?.['drone-scout'] ?? 0) + (loaded.warehouse.items['drone-scout'] ?? 0)).toBe(owned)
  })
})
