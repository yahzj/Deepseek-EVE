import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createBattleState, createFoeSpecs } from '../src/foeSpecs'
import { triggerAcidBurst, applyAlienCorrosion, advanceFoeHatcheries } from '../src/alienCombat'
import { cleanBattle } from '../src/saveBattleClean'
import { foeDroneRangeOf } from '../src/foeRange'
import type { UnitSpec } from '../src/combat'

const ctx = buildSimContext()
const spec = (): UnitSpec => createFoeSpecs(ctx.anomalies.get('ink-harass')!, ctx.balance.battle)[0]!
const acid = { tag: 'foe-0', acidBurst: { attackRangeM: 250, deathRangeM: 300, corrosionPct: 0.15 } }
function world(distanceM = 250) {
  const player = { ...spec(), tag: 'player', side: 'me' as const }
  const foe = { ...spec(), tag: 'foe-0' }
  const battle = createBattleState(player, [foe], 0, 200)
  battle.distanceM = distanceM
  return { battle, player, foe }
}

describe('酸液爆虫与腐蚀', () => {
  it.each([250, 249.99])('主动攻击包含边界 %s，只触发一次', distance => {
    const { battle } = world(distance)
    expect(triggerAcidBurst(battle, acid, 'attack', 100)).toBe(true)
    expect(battle.units['foe-0']!.hp).toEqual({ s: 0, a: 0, h: 0 })
    expect(triggerAcidBurst(battle, acid, 'killed', 100)).toBe(false)
    expect(battle.acidBursts?.['foe-0']?.cause).toBe('attack')
    expect(battle.alienCorrosion).toBe(.15)
  })
  it.each([250.01, 301])('主动攻击不越界 %s', distance => {
    expect(triggerAcidBurst(world(distance).battle, acid, 'attack', 100)).toBe(false)
  })
  it.each([300, 275])('近距被击杀包含边界 %s', distance => {
    const { battle } = world(distance)
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    expect(triggerAcidBurst(battle, acid, 'killed', 100)).toBe(true)
    expect(triggerAcidBurst(battle, acid, 'killed', 101)).toBe(false)
  })
  it('远距死亡不触发，下一只爆虫追加腐蚀', () => {
    const { battle } = world(300.01)
    expect(triggerAcidBurst(battle, acid, 'killed', 100)).toBe(false)
    battle.distanceM = 250
    triggerAcidBurst(battle, acid, 'attack', 101)
    battle.units['foe-1'] = { ...battle.units['foe-0']!, hp: { s: 10, a: 10, h: 10 }, tag: 'foe-1' }
    triggerAcidBurst(battle, { ...acid, tag: 'foe-1' }, 'attack', 102)
    expect(battle.alienCorrosion).toBe(.3)
  })
  it('仅装甲全抗减少，不影响盾和结构；同一规格重复施加不累扣', () => {
    const { player } = world()
    player.resists = { shield: { kinetic: .5 }, armor: { kinetic: .4 }, hull: { explosive: -.85 } }
    applyAlienCorrosion(player, .15)
    applyAlienCorrosion(player, .15)
    expect(player.resists.shield?.kinetic).toBe(.5)
    expect(player.resists.armor?.kinetic).toBeCloseTo(.25)
    expect(player.resists.armor?.plasma).toBe(-.15)
    expect(player.resists.hull).toEqual({ explosive: -.85 })
  })
  it('腐蚀和死亡原因存档往返保留', () => {
    const { battle } = world()
    triggerAcidBurst(battle, acid, 'attack', 123)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.alienCorrosion).toBe(.15)
    expect(loaded.acidBursts).toEqual(battle.acidBursts)
    expect(triggerAcidBurst(loaded, acid, 'attack', 124)).toBe(false)
  })
})

describe('有限孵化巢', () => {
  function setup() {
    const { battle } = world()
    const foes = [{ tag: 'foe-0', foeHatchery: { cycleMs: 12_000, stock: 2 } }]
    battle.foeDronePools = { 'foe-0': [0, 1].map(() => ({ s: 0, a: 0, h: 0, maxS: 6, maxA: 12, maxH: 20, evasion: .45, alive: false })) }
    return { battle, foes }
  }
  it('群体补回，原槽位满血，额度有限', () => {
    const { battle, foes } = setup()
    advanceFoeHatcheries(battle, foes, 0)
    advanceFoeHatcheries(battle, foes, 11_999)
    expect(battle.foeDronePools!['foe-0']!.filter(p => p.alive)).toHaveLength(0)
    advanceFoeHatcheries(battle, foes, 12_000)
    expect(battle.foeDronePools!['foe-0']![0]).toMatchObject({ s: 6, a: 12, h: 20, alive: true })
    expect(battle.foeDronePools!['foe-0']!.filter(p => p.alive)).toHaveLength(2)
    expect(battle.foeHatcheries?.['foe-0']).toMatchObject({ left: 0, revived: 2 })
    battle.foeDronePools!['foe-0']![0]!.alive = false
    advanceFoeHatcheries(battle, foes, 99_000)
    expect(battle.foeDronePools!['foe-0']![0]!.alive).toBe(false)
  })
  it('重载保留排期和额度；离线到点补齐当时战损', () => {
    const { battle, foes } = setup()
    advanceFoeHatcheries(battle, foes, 0)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.foeHatcheries).toEqual(battle.foeHatcheries)
    advanceFoeHatcheries(loaded, foes, 24_000)
    expect(loaded.foeHatcheries?.['foe-0']).toMatchObject({ left: 0, revived: 2 })
    expect(loaded.foeDronePools!['foe-0']).toHaveLength(2)
  })
  it('母舰死亡和战斗结束均不补回', () => {
    const { battle, foes } = setup()
    advanceFoeHatcheries(battle, foes, 0)
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    advanceFoeHatcheries(battle, foes, 24_000)
    expect(battle.foeHatcheries?.['foe-0']?.nextAtMs).toBeUndefined()
    expect(battle.foeHatcheries?.['foe-0']?.revived).toBe(0)
    battle.ended = 'me'
    advanceFoeHatcheries(battle, foes, 50_000)
    expect(battle.foeHatcheries?.['foe-0']?.revived).toBe(0)
  })
  it('没有战损不积蓄周期', () => {
    const { battle, foes } = setup()
    for (const p of battle.foeDronePools!['foe-0']!) p.alive = true
    advanceFoeHatcheries(battle, foes, 90_000)
    expect(battle.foeHatcheries?.['foe-0']?.nextAtMs).toBeUndefined()
    battle.foeDronePools!['foe-0']![0]!.alive = false
    advanceFoeHatcheries(battle, foes, 100_000)
    expect(battle.foeHatcheries?.['foe-0']?.nextAtMs).toBe(112_000)
  })
  it('机群静态加成与电子压制加算，不重复乘9000', () => {
    const { battle } = world()
    const weapon = { ...spec().weapons[0]!, maxRangeM: 6000, foeDroneRangeBonusPct: .5 }
    expect(foeDroneRangeOf(battle, weapon)).toBe(9000)
    battle.meFoeRangeDebuff = .15
    expect(foeDroneRangeOf(battle, weapon)).toBe(8100)
    battle.meFoeRangeDebuff = .6
    expect(foeDroneRangeOf(battle, weapon)).toBe(5400)
  })
})
