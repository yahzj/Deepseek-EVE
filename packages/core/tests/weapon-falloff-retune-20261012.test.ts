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
import { applyApprovedEquipmentRetune } from './helpers/approved-equipment-retune-20261019'

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
    // 后续2026-10-13批准直接调整护盾恢复，其他字段继续全表逐项核对。
    for (const row of rows) {
      if (row.id === 'mod-shieldchg-1') Object.assign(row, { shieldPulsePct: .08 })
      if (row.id === 'mod-shieldchg-2') Object.assign(row, { shieldPulsePct: .133 })
      if (row.id === 'mod-shieldchg-3') Object.assign(row, { shieldPulsePct: .213 })
      if (['mod-shieldfield-2', 'mod-shieldfield-3'].includes(row.id)) Object.assign(row, { shieldFieldPct: .067 })
    }
    // 守墓三件已独立完成验收，固定提交提供基线，不读取待测数据回填期望。
    const gravekeeper = JSON.parse(execFileSync('git', ['show', '0b17e83e:packages/data/src/static/modules.json'], { cwd: root, encoding: 'utf8' })) as typeof modules
    expected.groups.MODULES_0.push(...gravekeeper.groups.MODULES_0.filter(row =>
      ['mod-gravekeeper-rebirth', 'mod-gravekeeper-crisis', 'mod-gravekeeper-rail'].includes(row.id)))
    applyApprovedEquipmentRetune(expected)
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
    const expected = JSON.parse(execFileSync('git', ['show', `0b17e83e:${path}`], { cwd: root, encoding: 'utf8' }))
    if (path.endsWith('/foeShips.json')) Object.assign(expected.groups.parameters.find((row: { id: string }) => row.id === 'foe-d-invasion-eternal-tomb'), { split_s: .3, split_a: .4, split_h: .3 })
    if (path.endsWith('/foeMounts.json')) expected.groups.parameters.splice(
      expected.groups.parameters.findIndex((row: { id: string }) => row.id === 'foe-mount-ink-range-debuff') + 1, 0,
      { id: 'foe-mount-d-range-debuff', rangeDebuff_pct: .15 })
    if (path.endsWith('/foeMounts.json')) Object.assign(
      expected.groups.parameters.find((row: { id: string }) => row.id === 'foe-mount-d-shield-capacitor'),
      { shieldCapacitor_damageMul: 1.25 })
    if (path.endsWith('/items.json')) for (const family of ['r', 'c', 'h', 'd']) expected.groups.CONSUMABLES_0.push({
      id: `invasion-beacon-${family}`, kind: 'consumable', unitM3: .01, baseSellPriceIsk: 480000000 })
    expect(JSON.parse(readFileSync(new URL(path, root), 'utf8'))).toEqual(expected)
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
