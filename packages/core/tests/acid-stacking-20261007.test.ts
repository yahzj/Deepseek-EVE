import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { applyAlienCorrosion, triggerAcidBurst } from '../src/alienCombat'
import { advanceBattleFor, createPlayerSpec, startBattleFor, startFleetBattleFor } from '../src/combat'
import { applyDamage, RESIST_FLOOR } from '../src/combatMath'
import { createBattleState, createFoeSpecs } from '../src/foeSpecs'
import { cleanBattle } from '../src/saveBattleClean'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { alienFixture } from '../../../tools/alien-invasion-fixture'

const ctx = buildSimContext()

function acidBattle(count = 8) {
  const source = ctx.foeShips!.get('foe-alien-acid-burster')!
  const card = { ...ctx.anomalies.get('alien-vanguard')!, id: 'acid-stacking', waves: undefined,
    ships: [{ ship: source, count, dmgMul: 1 }] }
  const ship = ctx.ships.get('sh-megalodon')!
  const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]),
    ships: new Map([...ctx.ships, [ship.id, { ...ship, shieldHp: 900_000, armorHp: 900_000, hullHp: 900_000 }]]),
    balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
  const { state } = alienFixture(local, 'heavy', 611)
  state.fleet[state.shipId]!.fitted = { high: [], mid: [], low: [] }
  const battle = startBattleFor(state, local, state.shipId, card.id, 0, 200)!
  battle.distanceM = 200
  battle.units.player!.hp.s = 0
  return { state, local, card, battle }
}

describe('爆虫腐蚀逐只累加与负抗性', () => {
  it('按百分点叠加，只补新增差值，盾不变，低于零后实际增伤', () => {
    const { state, local } = acidBattle()
    const spec = createPlayerSpec(state, local, state.shipId)!
    spec.resists = { shield: { kinetic: .5 }, armor: { kinetic: .4 }, hull: { kinetic: 0 } }
    applyAlienCorrosion(spec, .15)
    applyAlienCorrosion(spec, .6)
    applyAlienCorrosion(spec, .6)
    expect(spec.resists.shield!.kinetic).toBe(.5)
    expect(spec.resists.armor!.kinetic).toBeCloseTo(-.2)
    expect(spec.resists.hull!.kinetic).toBeCloseTo(-.6)
    expect(applyDamage({ s: 0, a: 1000, h: 1000 }, spec.resists, 100, 'kinetic').dealt).toBeCloseTo(90)
    applyAlienCorrosion(spec, 3)
    for (const layer of ['armor', 'hull'] as const) {
      for (const type of ['kinetic', 'explosive', 'plasma'] as const) expect(spec.resists[layer]![type]).toBe(RESIST_FLOOR)
    }
    expect(applyDamage({ s: 0, a: 0, h: 1000 }, spec.resists, 100, 'kinetic').dealt).toBeCloseTo(190)
  })

  it('纯状态入口逐只叠加，主动/死亡触发去重，累计超过90个百分点可重载', () => {
    const { state, local, card } = acidBattle()
    const foes = createFoeSpecs(card, local.balance.battle).map(foe => ({ ...foe, acidBurst: { ...foe.acidBurst!, damage: 0 } }))
    const battle = createBattleState(createPlayerSpec(state, local, state.shipId)!, foes, 0, 200)
    battle.distanceM = 200
    for (const foe of foes) {
      expect(triggerAcidBurst(battle, foe, 'attack', 1)).toBe(true)
      expect(triggerAcidBurst(battle, foe, 'killed', 2)).toBe(false)
    }
    expect(battle.alienCorrosion).toBeCloseTo(1.2)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.alienCorrosion).toBeCloseTo(1.2)
    expect(loaded.acidBursts).toEqual(battle.acidBursts)
    expect(triggerAcidBurst(loaded, foes[0]!, 'killed', 3)).toBe(false)
    expect(loaded.alienCorrosion).toBeCloseTo(1.2)
  })

  it('真实同拍多爆虫先伤害再叠加，每只发专属动能事件，重载不补打', () => {
    const { state, local, card, battle } = acidBattle()
    const base = createPlayerSpec(state, local, state.shipId)!
    const foes = createFoeSpecs(card, local.balance.battle)
    let expected = { ...battle.units.player!.hp }
    state.gameMs = 100
    advanceBattleFor(state, local, battle, state.shipId, card.id)
    const events = battle.fx.filter(fx => fx.side === 'foe')
    expect(events).toHaveLength(8)
    for (const [index, event] of events.entries()) {
      expect(event).toMatchObject({ acidBurst: true, type: 'kinetic', to: 'player' })
      expect(event.src).toBeUndefined()
      const spec = { ...base, resists: structuredClone(base.resists) }
      applyAlienCorrosion(spec, index * .15)
      const damage = foes.find(foe => foe.tag === event.tag)!.acidBurst!.damage!
      if (event.hit) expected = applyDamage(expected, spec.resists, damage, 'kinetic').hp
    }
    expect(battle.units.player!.hp.a).toBeCloseTo(expected.a)
    expect(battle.units.player!.hp.h).toBeCloseTo(expected.h)
    expect(battle.alienCorrosion).toBeCloseTo(1.2)
    expect(battle.stats.foeShots).toBe(8)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.alienCorrosion).toBeCloseTo(1.2)
    expect(loaded.fx.filter(fx => fx.acidBurst).map(fx => fx.to)).toEqual(Array(8).fill('player'))
    state.gameMs = 1000
    advanceBattleFor(state, local, loaded, state.shipId, card.id)
    expect(loaded.stats.foeShots).toBe(8)
    expect(loaded.alienCorrosion).toBeCloseTo(1.2)
  })

  it('近距被击杀与主动自毁均叠加，新战斗清除', () => {
    const { state, local, card, battle } = acidBattle(4)
    const foes = createFoeSpecs(card, local.balance.battle)
    battle.units[foes[0]!.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(triggerAcidBurst(battle, foes[0]!, 'killed', 0)).toBe(true)
    state.gameMs = 100
    advanceBattleFor(state, local, battle, state.shipId, card.id)
    expect(battle.alienCorrosion).toBeCloseTo(.6)
    expect(battle.acidBursts![foes[0]!.tag]!.cause).toBe('killed')
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))!.alienCorrosion).toBeCloseTo(.6)
    const next = createBattleState(createPlayerSpec(state, local, state.shipId)!, foes, 1000, 200)
    expect(next.alienCorrosion).toBeUndefined()
  })

  it('真实编队换波累计并全队生效，完整存档往返不丢超过90个百分点的腐蚀', () => {
    const { local, card } = acidBattle(4)
    const multi = { ...card, waves: [{ units: 4, hpShare: .5 }, { units: 4, hpShare: .5 }],
      ships: [0, 1].map(wave => ({ ship: card.ships[0]!.ship, count: 4, wave, dmgMul: 1 })) }
    const context = { ...local, anomalies: new Map([...local.anomalies, [card.id, multi]]) }
    const { state, ships } = alienFixture(context, 'heavy', 611, 4)
    for (const shipId of ships) state.fleet[shipId]!.fitted = { high: [], mid: [], low: [] }
    const battle = startFleetBattleFor(state, context, ships, card.id, 0, 200)!
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle }
    for (let time = 100; time <= 8000 && (battle.waveIdx ?? 0) === 0; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, context, battle, state.shipId, card.id)
    }
    expect(battle.waveIdx).toBe(1)
    expect(battle.alienCorrosion).toBeCloseTo(.6)
    for (let time = state.gameMs + 100; time <= 16000 && (battle.alienCorrosion ?? 0) < 1.19; time += 100) {
      state.gameMs = time
      battle.distanceM = 200
      advanceBattleFor(state, context, battle, state.shipId, card.id)
    }
    expect(battle.alienCorrosion).toBeCloseTo(1.2)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(loaded.alienCorrosion).toBeCloseTo(1.2)
    expect(loaded.acidBursts).toEqual(battle.acidBursts)
    for (const shipId of ships) {
      const spec = createPlayerSpec(state, context, shipId)!
      const shield = structuredClone(spec.resists.shield)
      applyAlienCorrosion(spec, loaded.alienCorrosion!)
      expect(spec.resists.shield).toEqual(shield)
      expect(spec.resists.armor!.kinetic).toBe(RESIST_FLOOR)
      expect(spec.resists.hull!.kinetic).toBe(RESIST_FLOOR)
    }
  })

  it.each([NaN, Infinity, -1, 0])('非法腐蚀%s仍被读档拒绝', value => {
    const { battle } = acidBattle()
    battle.alienCorrosion = value
    expect(cleanBattle(battle)!.alienCorrosion).toBeUndefined()
  })
})
