import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { advanceBattleFor, battleArcsFor, createPlayerSpec, startBattleFor } from '../src/combat'
import { playerGravekeeperSpecOf } from '../src/combat/gravekeeperGear'
import { beamPowerVsTargetOf } from '../src/combat/beam'
import { ceilFinalQuantity } from '../src/quantity'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { WeaponSpec } from '../src/combat/model'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
const crisis = 'mod-gravekeeper-crisis'
const weapons = ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3', null] as const

function world(moduleId: string | null, copies = 1) {
  const state = createInitialState({ nowWallMs: 0, seed: 1121 })
  const sid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = sid
  state.skills.trained = {}
  state.fleet[sid]!.fitted = { high: moduleId ? Array(copies).fill(moduleId) : [], mid: [crisis], low: [] }
  for (const id of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[id] = 100000
  const card = { ...ctx.anomalies.get('ano-training')!, id: 'crisis-weapon-target', ships: undefined,
    waves: undefined, foeHpOverride: 1e9, foeShotDmg: 0, threat: 20, tactic: 'orbit' as const,
    foeSpeedMps: 0, foeHpSplit: { s: 0, a: 0, h: 1 } }
  const local: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card),
    balance: { ...ctx.balance, battle: { ...ctx.balance.battle, hitMin: 1, hitMax: 1, shieldRegenPerSec: 0 } } }
  const spec = createPlayerSpec(state, local, sid)!
  const weapon = spec.weapons[0]!
  const distance = Math.max(1000, weapon.minRangeM + 1)
  const battle = startBattleFor(state, local, sid, card.id, 0, distance)!
  for (const rt of Object.values(battle.units)) {
    delete rt.enteredAtMs
    rt.weapons.fill(rt.side === 'me' ? 0 : 1e9)
  }
  return { state, sid, local, card, spec, weapon, distance, battle }
}

describe('危机超载射程和伤害只排除无人机', () => {
  it.each(weapons)('%s未空盾不加成，真实空盾首发按新规格结算且视图同源', moduleId => {
    const run = (active: boolean) => {
      const w = world(moduleId)
      if (active) w.battle.units.player!.hp.s = 0
      const shots: Array<{ weapon: WeaponSpec; damage: number }> = []
      w.state.gameMs = 10
      advanceBattleFor(w.state, w.local, w.battle, w.sid, w.card.id, null, undefined, undefined,
        { simulation: { distanceM: w.distance, layer: 'h', onShot: shot => shots.push(shot) } })
      expect(shots).toHaveLength(1)
      const applied = shots[0]!.weapon
      const range = Math.round(w.weapon.maxRangeM * (active ? 1.4 : 1))
      const raw = w.weapon.shotDmg ?? Object.values(w.weapon.shotsByType!)[0]!
      const boosted = active ? ceilFinalQuantity(raw * 1.25) : raw
      const expected = applied.kind === 'beam'
        ? Math.max(1, ceilFinalQuantity(boosted * beamPowerVsTargetOf(w.distance, { ...w.weapon, maxRangeM: range }, false)))
        : boosted
      expect(applied.maxRangeM).toBe(range)
      expect(applied.reloadMs).toBe(w.weapon.reloadMs)
      expect(shots[0]!.damage).toBe(expected)
      expect(w.battle.stats.meDmg).toBe(expected)
      expect(w.battle.meCrisisActive?.player === true).toBe(active)
      const view = battleArcsFor(w.state, w.local, { battle: w.battle, anomaly: w.card, leaderShipId: w.sid })!
      expect(view.weapons.find(row => row.src === w.weapon.src)!.maxM).toBe(range)
      return w.battle.stats.meDmg
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it.each(weapons)('%s扩展射程内可以开火，未生效和超出扩展射程都不开火', moduleId => {
    const run = (active: boolean, tooFar = false) => {
      const w = world(moduleId)
      const distance = tooFar ? Math.round(w.weapon.maxRangeM * 1.4) + 1 : w.weapon.maxRangeM + 1
      if (active) w.battle.units.player!.hp.s = 0
      w.state.gameMs = 10
      advanceBattleFor(w.state, w.local, w.battle, w.sid, w.card.id, null, undefined, undefined,
        { simulation: { distanceM: distance, layer: 'h' } })
      return w.battle.stats.meShots
    }
    expect(run(false)).toBe(0)
    expect(run(true)).toBe(1)
    expect(run(true, true)).toBe(0)
  })

  it('多门激光只乘一次危机倍率，未装备的队友不受益，往返后仍生效', () => {
    const w = world('mod-laser-3', 2)
    w.battle.units.player!.hp.s = 0
    w.state.gameMs = 10
    advanceBattleFor(w.state, w.local, w.battle, w.sid, w.card.id, null, undefined, undefined,
      { simulation: { distanceM: w.distance, layer: 'h' } })
    expect(w.battle.stats.meShots).toBe(2)
    const damage = w.battle.stats.meDmg
    w.battle.units.player!.weapons.fill(0)
    w.state.gameMs = 20
    advanceBattleFor(w.state, w.local, w.battle, w.sid, w.card.id, null, undefined, undefined,
      { simulation: { distanceM: w.distance, layer: 'h' } })
    expect(w.battle.stats.meShots).toBe(4)
    expect(w.battle.stats.meDmg).toBe(damage * 2)
    const before = JSON.stringify(w.spec)
    const active = playerGravekeeperSpecOf(w.battle, w.spec)
    expect(active.weapons[0]!.shotDmg).toBe(ceilFinalQuantity(w.weapon.shotDmg! * 1.25))
    expect(playerGravekeeperSpecOf(w.battle, w.spec).weapons).toEqual(active.weapons)
    expect(playerGravekeeperSpecOf(w.battle, { ...w.spec, tag: 'ally-1' }).weapons[0]).toEqual(w.weapon)
    expect(JSON.stringify(w.spec)).toBe(before)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: w.battle }
    const loaded = loadSaveFile(serializeSaveFile(w.state)).state.expedition.battle!
    expect(playerGravekeeperSpecOf(loaded, w.spec).weapons).toEqual(active.weapons)
  })

  it('攻击和维修无人机不增加单发、射程或维修量，只保留原周期加成', () => {
    const w = world(null)
    w.state.fleet[w.sid]!.droneLoad = { 'drone-scout': 1, 'drone-repair-mil': 1 }
    const spec = createPlayerSpec(w.state, w.local, w.sid)!
    const active = playerGravekeeperSpecOf({ ...w.battle, meCrisisActive: { player: true } }, spec)
    const drones = spec.weapons.flatMap((weapon, index) => weapon.src === 'drone' ? [index] : [])
    expect(drones).toHaveLength(2)
    expect(spec.weapons.some(weapon => weapon.repairDrone !== undefined)).toBe(true)
    for (const index of drones) {
      expect(active.weapons[index]!.maxRangeM).toBe(spec.weapons[index]!.maxRangeM)
      expect(active.weapons[index]!.shotDmg).toBe(spec.weapons[index]!.shotDmg)
      expect(active.weapons[index]!.repairDrone).toEqual(spec.weapons[index]!.repairDrone)
      expect(active.weapons[index]!.reloadMs).toBe(Math.round(spec.weapons[index]!.reloadMs * .75))
    }
  })

  it.each(['zh', 'en'] as const)('%s说明与参数行明确排除无人机，旧英文保留但暂不展示', locale => {
    const mod = buildSimContext(locale).modules.get(crisis)!
    expect(mod.description).toBe(L10N['mod.gravekeeperGear.007']!.zh)
    expect(mod.description).toContain('除无人机外所有武器')
    for (const id of ['mod.gravekeeperGear.007', 'ui.gravekeeperGear.010']) {
      expect(L10N[id]!.enDeferred).toBe(true)
      expect(L10N[id]!.en).toBe('')
    }
    expect(L10N['mod.gravekeeperGear.004']!.en).not.toBe('')
    expect(L10N['ui.gravekeeperGear.004']!.en).not.toBe('')
  })
})
