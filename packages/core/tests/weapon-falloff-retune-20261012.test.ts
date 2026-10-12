import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule } from '../src/equipment'
import { createPlayerSpec } from '../src/playerSpec'
import { distFactor, droneHitChance, hitChance } from '../src/combatMath'
import { createFoeSpecs } from '../src/foeSpecs'
import modules from '../../data/src/static/modules.json'

const ctx = buildSimContext()
const root = new URL('../../../', import.meta.url)
const targets = [
  { id: 'mod-lair-turret-a', before: .35, after: .15 },
  { id: 'mod-wh-d-turret', before: .4, after: .2 },
  { id: 'mod-turret-civ', before: .5, after: .3 },
  { id: 'mod-turret-kin-1', before: .5, after: .3 },
  { id: 'mod-turret-kin-2', before: .5, after: .3 },
  { id: 'mod-turret-kin-3', before: .5, after: .3 },
  { id: 'mod-pd-e', before: .5, after: .3 },
  { id: 'mod-pd-e-2', before: .5, after: .3 },
  { id: 'mod-pd-e-3', before: .5, after: .3 },
  { id: 'mod-wh-e-pd', before: .5, after: .3 },
] as const

function historicalText(path: string): string {
  return execFileSync('git', ['show', `8fa27d79:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true })
}

describe('玩家动能武器远端命中倍率调整', () => {
  it('静态装备目录只改指定10件的falloff，基础命中与所有其他字段逐项守恒', () => {
    const expected = JSON.parse(historicalText('packages/data/src/static/modules.json')) as typeof modules
    const rows = Object.values(expected.groups).flat()
    for (const target of targets) {
      const mod = rows.find(row => row.id === target.id)!
      expect(mod.damageType).toBe('kinetic')
      expect(mod.falloff).toBe(target.before)
      mod.falloff = target.after
    }
    expect(modules).toEqual(expected)
    expect([...ctx.modules.values()].filter(mod => mod.damageType === 'kinetic' && mod.falloff === .5)).toEqual([])
  })

  it.each(targets)('$id真实装配建档只改远端倍率，近端/伤害/耗弹保持', target => {
    const state = createInitialState({ nowWallMs: 0, seed: 20261012 })
    state.shipId = addShipToFleet(state, 'sh-megalodon')
    state.moduleBay[target.id] = 1
    expect(fitModule(state, target.id, ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const oldModules = new Map(ctx.modules)
    oldModules.set(target.id, { ...oldModules.get(target.id)!, falloff: target.before })
    const before = createPlayerSpec(state, { ...ctx, modules: oldModules }, state.shipId)!
    const weapon = spec.weapons.find(row => row.moduleId === target.id)!
    const oldWeapon = before.weapons.find(row => row.moduleId === target.id)!
    expect(weapon).toBeDefined()
    expect(weapon.falloff).toBe(target.after)
    expect(spec.weapons.map(row => row === weapon ? { ...row, falloff: target.before } : row)).toEqual(before.weapons)
    expect(distFactor(weapon.minRangeM, weapon)).toBe(1)
    expect(distFactor(weapon.maxRangeM, weapon)).toBeCloseTo(target.after)
    const defender = { evasion: .1 }
    const bal = ctx.balance.battle
    expect(hitChance(weapon, spec, defender, weapon.minRangeM, bal)).toBeCloseTo(
      hitChance(oldWeapon, before, defender, oldWeapon.minRangeM, bal),
    )
    expect(hitChance(weapon, spec, defender, weapon.maxRangeM, bal)).toBeCloseTo(
      hitChance(oldWeapon, before, defender, oldWeapon.maxRangeM, bal) * target.after / target.before,
    )
    if (weapon.canHitDrones) {
      expect(droneHitChance(weapon, spec, .18, bal)).toBeCloseTo(droneHitChance(oldWeapon, before, .18, bal))
    }
  })

  it.each([
    'packages/data/src/static/foeShips.json',
    'packages/data/src/static/foeDrones.json',
    'packages/data/src/static/bounties.json',
    'packages/data/src/static/invasionFleets.json',
    'packages/data/src/static/wormholeFleets.json',
    'packages/core/src/static/foeMounts.json',
    'packages/data/src/static/items.json',
  ])('%s敌人、挂载与玩家无人机参数全表不变', path => {
    expect(JSON.parse(readFileSync(new URL(path, root), 'utf8'))).toEqual(JSON.parse(historicalText(path)))
  })

  it('亡军、隐藏遇袭与默认敌人远端倍率保持0.5；其他玩家动能与非动能保持原值', () => {
    for (const ship of FOE_SHIPS.filter(row => row.family === 'G')) expect(ship.falloff).toBe(.5)
    for (let n = 1; n <= 4; n++) {
      const specs = createFoeSpecs(ctx.anomalies.get(`enc-pirate-${n}`)!, ctx.balance.battle)
      expect(specs.length).toBeGreaterThan(0)
      for (const unit of specs) expect(unit.weapons[0]!.falloff).toBe(.5)
    }
    expect(ctx.balance.battle.foeFalloff).toBe(.5)
    expect(ctx.modules.get('mod-lair-turret-d')!.falloff).toBe(.6)
    expect(ctx.modules.get('mod-alien-acid-launcher')!.falloff).toBe(.5)
    expect(ctx.modules.get('mod-wh-a-frag')!.falloff).toBe(.5)
    expect(ctx.modules.get('mod-lair-pd-r')!.falloff).toBe(.5)
  })
})
