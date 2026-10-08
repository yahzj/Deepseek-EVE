import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { alienFixture } from '../../../tools/alien-invasion-fixture'
import { createInitialState } from '../src/state'
import type { BattleState } from '../src/state'
import {
  advanceBattleFor,
  createBattleState,
  createFoeSpecs,
  createPlayerSpec,
  startBattleFor,
  startFleetBattleFor,
} from '../src/combat'
import { battleWeaponCyclesOf } from '../src/battleWeaponView'
import { stampFoeArrivalFx } from '../src/combatFx'
import { addShipToFleet } from '../src/fleetBook'
import { cpuBudgetOf, droneCpuUsed, equipmentPenaltiesOf, fittedCpuUsed } from '../src/equipment'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import type { FoeShipDef, ItemDef } from '../src/types'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

const CARD = 'ano-readiness'
const realCtx = buildSimContext()
type Mount = 'base' | 'gun' | 'beam' | 'PD' | 'drone' | 'mixed'

function world(mount: Mount = 'mixed', size = 1, waves = false) {
  const enemy: FoeShipDef = {
    id: 'foe-readiness', name: '装填测试靶舰', family: 'A', hullClassTier: 1,
    speedRatio: 0.01, hp: 1e6, split: { s: 0.2, a: 0.5, h: 0.3 },
    shotDmg: 1, hitRate: 1, reloadMs: 20_000,
    rangeMinM: 0, rangeMaxM: 4000, falloff: 1, dmgMix: { kinetic: 1 },
    tactic: 'orbit', desireRangeM: 1000,
    drones: [{ count: 1, drone: {
      id: 'foe-readiness-drone', name: '装填测试敌机', family: 'A', role: 'scout',
      defense: { shieldHp: 1e6, armorHp: 1e6, hullHp: 1e6, evasion: 0 },
      dmg: 1, damageType: 'kinetic', hitRate: 1, falloff: 1,
      maxRangeM: 4000, reloadMs: 20_000,
    } }],
  }
  const drone: ItemDef = {
    id: 'drone-readiness', name: '装填测试无人机', kind: 'drone', description: '测试夹具',
    unitM3: 5, baseSellPriceIsk: 1, cpuUse: 5, dmg: 3, damageType: 'kinetic',
    droneClass: 'scout', hitRate: 1, falloff: 1, maxRangeM: 4000, reloadMs: 1300,
    defense: { shieldHp: 100, armorHp: 100, hullHp: 100, evasion: 0 },
  }
  const weapon = { maxRangeM: 4000, minRangeM: 0, hitRate: 1, falloff: 1, dmgMult: 1, cpuUse: 5 }
  const ctx = makeTestCtx({
    quietEvents: true,
    ships: [ship('sandcat', {
      shieldHp: 1e6, armorHp: 1e6, hullHp: 1e6, maxSpeedMps: 1,
      cpu: 1000, droneBayM3: 100, slots: { high: 6, mid: 0, low: 3 },
    })],
    items: [drone],
    modules: [
      moduleDef('gun-readiness', 'turret', 0, { ...weapon, damageType: 'kinetic', reloadMs: 700, ammoPerShot: 2 }),
      moduleDef('beam-readiness', 'laser', 0, { ...weapon, damageType: 'plasma', reloadMs: 900 }),
      { ...moduleDef('pd-readiness', 'turret', 0, { ...weapon, damageType: 'explosive', reloadMs: 1100 }), antiDrone: 2 },
      moduleDef('cost-readiness', 'support', 0, { rack: 'low', cpuUse: 0, reloadPenaltyPct: 0.2 }),
    ],
    anomalies: [{
      ...anomaly(CARD, 'galaxy-hub', { threat: 1 }),
      ships: [{ ship: enemy, wave: 0 }, ...(waves ? [{ ship: enemy, wave: 1 }] : [])],
      ...(waves ? { waves: [{ units: 1, hpShare: 1 }, { units: 1, hpShare: 1 }] } : {}),
    }],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 20261008 })
  const ships = Array.from({ length: size }, (_, index) => {
    const uid = addShipToFleet(state, 'sandcat')
    state.fleet[uid]!.fitted = {
      high: [
        ...(mount === 'gun' || mount === 'mixed' ? ['gun-readiness', 'gun-readiness'] : []),
        ...(mount === 'beam' || mount === 'mixed' ? ['beam-readiness', 'beam-readiness'] : []),
        ...(mount === 'PD' || mount === 'mixed' ? ['pd-readiness'] : []),
      ], mid: [], low: Array.from({ length: index }, () => 'cost-readiness'),
    }
    if (mount === 'drone' || mount === 'mixed') state.fleet[uid]!.droneLoad = { [drone.id]: 2 }
    return uid
  })
  state.shipId = ships[0]!
  for (const type of ['kinetic', 'explosive', 'plasma']) state.warehouse.items[`ammo-${type}-l`] = 100_000
  const battle = size === 1
    ? startBattleFor(state, ctx, state.shipId, CARD, 0, 1000)!
    : startFleetBattleFor(state, ctx, ships, CARD, 0, 1000)!
  battle.distanceM = 1000
  const entries = ships.map((uid, index) => {
    const spec = createPlayerSpec(state, ctx, uid)!
    spec.tag = index === 0 ? 'player' : `ally-${index}`
    return { spec, shipId: uid, name: spec.name }
  })
  const advance = (atMs: number, target = battle) => {
    state.gameMs = atMs
    advanceBattleFor(state, ctx, target, state.shipId, CARD)
  }
  return { state, ctx, ships, battle, entries, advance }
}

function myShots(battle: BattleState) {
  return battle.fx.filter(event => event.side === 'me' && !event.web && !event.blink && !event.droneDown)
}

describe('开场装填专项（2026-10-08）', () => {
  it.each(['base', 'gun', 'beam', 'PD', 'drone'] as const)('%s：单船首发前不射击不扣弹，到点后实际开火', mount => {
    const w = world(mount)
    const spec = w.entries[0]!.spec
    const indices = spec.weapons.flatMap((weapon, index) => {
      const selected = mount === 'base' ? weapon.src === 'base'
        : mount === 'gun' ? weapon.kind === 'gun' && !weapon.canHitDrones
          : mount === 'beam' ? weapon.kind === 'beam'
            : mount === 'PD' ? weapon.canHitDrones : weapon.src === 'drone'
      return selected ? [index] : []
    })
    expect(indices).toHaveLength(mount === 'drone' ? 2 : 1)
    const weapon = spec.weapons[indices[0]!]!
    const cycle = weapon.reloadMs
    expect(w.battle.units.player!.weapons).toEqual(spec.weapons.map(p => Math.max(1, p.reloadMs)))
    expect(Object.values(w.battle.units).filter(u => u.side === 'foe').every(u => u.weapons.every(cd => cd === 0))).toBe(true)
    const rows = battleWeaponCyclesOf(w.battle, w.entries)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.state === 'reload' && row.remainingMs === row.cycleMs && row.percent === 0)).toBe(true)
    const ammo = { ...w.battle.ammo }
    const stock = { ...w.state.warehouse.items }

    w.advance(cycle - 1)
    for (const index of indices) expect(w.battle.units.player!.weapons[index]).toBe(1)
    expect(w.battle.stats.meShots).toBe(0)
    expect(w.battle.stats.meDmg).toBe(0)
    expect(myShots(w.battle)).toEqual([])
    expect(w.battle.ammo).toEqual(ammo)
    expect(w.state.warehouse.items).toEqual(stock)
    expect(w.battle.stats.foeShots).toBeGreaterThan(0)
    if (mount === 'PD') expect(w.battle.droneHitAt?.me).toBeDefined()

    // 沿用现有推进判据：本拍减到零，下一拍才允许首发。
    w.advance(cycle)
    for (const index of indices) expect(w.battle.units.player!.weapons[index]).toBe(0)
    expect(w.battle.stats.meShots).toBe(0)
    expect(w.battle.ammo).toEqual(ammo)
    w.advance(cycle + 1)
    const count = mount === 'drone' ? indices.length : weapon.count ?? 1
    expect(w.battle.stats.meShots).toBe(count)
    expect(myShots(w.battle)).toHaveLength(count)
    expect(myShots(w.battle).every(event => event.atMs === cycle + 1 && event.src === weapon.src)).toBe(true)
    for (const index of indices) expect(w.battle.units.player!.weapons[index]).toBe(cycle)
    expect(w.battle.ammo).toEqual({
      kin: ammo.kin - (mount === 'gun' ? count * (weapon.ammoPerShot ?? 1) : 0),
      pla: ammo.pla - (mount === 'beam' ? count : 0),
      exp: ammo.exp - (mount === 'PD' ? count : 0),
    })
    if (mount === 'PD') {
      expect(myShots(w.battle)[0]!.pd).toBe(true)
      expect(w.battle.mePdAnsweredBy?.[`player:${indices[0]}`]).toBe(w.battle.droneHitAt!.me)
    }
  })

  it('四舰混装：基础炮、同型双炮、双光束、近防和逐架无人机全部独立完成初始装填', () => {
    const w = world('mixed', 4)
    expect(w.battle.myFleet?.map(entry => entry.tag)).toEqual(['player', 'ally-1', 'ally-2', 'ally-3'])
    for (const { spec } of w.entries) {
      expect(spec.weapons).toHaveLength(6)
      expect(spec.weapons.map(p => p.src)).toEqual(['base', 'turret', 'turret', 'laser', 'drone', 'drone'])
      expect(w.battle.units[spec.tag]!.weapons).toEqual(spec.weapons.map(p => Math.max(1, p.reloadMs)))
      expect(w.battle.dronePools?.[`${spec.tag}:4`]?.alive).toBe(true)
      expect(w.battle.dronePools?.[`${spec.tag}:5`]?.alive).toBe(true)
    }
    const rows = battleWeaponCyclesOf(w.battle, w.entries)
    expect(rows).toHaveLength(20)
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(32)
    expect(rows.every(row => row.state === 'reload' && row.percent === 0)).toBe(true)
    expect(new Set(rows.filter(row => row.src === 'drone').map(row => row.ownerTag)).size).toBe(4)
    const earliest = Math.min(...w.entries.flatMap(entry => entry.spec.weapons.map(p => p.reloadMs)))
    const ammo = { ...w.battle.ammo }
    w.advance(earliest - 1)
    expect(w.battle.stats.meShots).toBe(0)
    expect(w.battle.ammo).toEqual(ammo)
    for (const { spec } of w.entries) expect(w.battle.units[spec.tag]!.weapons).toEqual(spec.weapons.map(p => p.reloadMs - earliest + 1))
    w.advance(earliest)
    expect(w.battle.stats.meShots).toBe(0)
    w.advance(earliest + 1)
    expect(w.battle.stats.meShots).toBe(2)
    expect(myShots(w.battle).map(event => event.tag)).toEqual(['player', 'player'])
    expect(w.battle.ammo).toEqual({ ...ammo, kin: ammo.kin - 4 })
    for (const { spec } of w.entries.slice(1)) expect(w.battle.units[spec.tag]!.weapons).toEqual(spec.weapons.map(p => p.reloadMs - earliest - 1))
    const deadlines = [...new Set(w.entries.flatMap(entry => entry.spec.weapons.map(p => p.reloadMs)))].sort((a, b) => a - b)
    for (const deadline of deadlines.filter(ms => ms > earliest)) {
      const due = w.entries.flatMap(({ spec }) => spec.weapons.flatMap((weapon, index) =>
        weapon.reloadMs === deadline ? [{ spec, weapon, index }] : []))
      w.advance(deadline - 1)
      for (const { spec, index } of due) expect(w.battle.units[spec.tag]!.weapons[index]).toBe(1)
      w.advance(deadline)
      for (const { spec, index } of due) expect(w.battle.units[spec.tag]!.weapons[index]).toBe(0)
      const shots = w.battle.stats.meShots
      w.advance(deadline + 1)
      expect(w.battle.stats.meShots).toBeGreaterThanOrEqual(shots + due.reduce((n, { weapon }) => n + (weapon.count ?? 1), 0))
      for (const { spec, weapon, index } of due) {
        expect(w.battle.units[spec.tag]!.weapons[index]).toBe(weapon.reloadMs)
        const type = weapon.fixedType ?? Object.keys(weapon.shotsByType ?? {})[0]
        expect(myShots(w.battle).some(event => event.atMs === deadline + 1 && event.tag === spec.tag && event.src === weapon.src && event.type === type)).toBe(true)
      }
    }
  })

  it('真实技能和装备：首轮读取最终reload，射速收益和两件巨构代价均只计一次', () => {
    const { state, ships } = alienFixture(realCtx, 'heavy', 108)
    const uid = ships[0]!
    const fleet = state.fleet[uid]!
    fleet.fitted = { high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-pd-e-2'], mid: [], low: [] }
    fleet.droneLoad = { 'drone-scout': 2 }
    for (const id of ['reload-drills', 'rapid-reload', 'drone-servicing', 'drone-servicing-integration']) state.skills.trained[id] = 0
    const raw = createPlayerSpec(state, realCtx, uid)!
    for (const id of ['reload-drills', 'rapid-reload', 'drone-servicing', 'drone-servicing-integration']) state.skills.trained[id] = 5
    const skilled = createPlayerSpec(state, realCtx, uid)!
    fleet.fitted.low = ['mod-rof-2']
    const accelerated = createPlayerSpec(state, realCtx, uid)!
    fleet.fitted.low.push('mod-wh-e-cpu', 'mod-wh-e-cpu')
    const final = createPlayerSpec(state, realCtx, uid)!
    const cost = equipmentPenaltiesOf(state, realCtx, uid).reload
    expect(cost).toBeCloseTo((1 + realCtx.modules.get('mod-wh-e-cpu')!.reloadPenaltyPct!) ** 2, 12)
    expect(fittedCpuUsed(fleet.fitted, realCtx, realCtx.ships.get('sh-megalodon')) + droneCpuUsed(fleet.droneLoad, realCtx)).toBeLessThanOrEqual(cpuBudgetOf(state, realCtx, uid))
    expect(final.weapons).toHaveLength(6)
    for (const [index, weapon] of final.weapons.entries()) {
      const base = raw.weapons[index]!
      expect(skilled.weapons[index]!.reloadMs).toBe(weapon.src === 'base' ? base.reloadMs : Math.round(base.reloadMs * 0.8 * 0.925))
      const div = weapon.kind === 'fixed' ? 1 : 1 + realCtx.modules.get('mod-rof-2')!.reloadCutPct!
      const expected = Math.round((base.reloadMs * (weapon.src === 'base' ? 1 : 0.8 * 0.925) / div) * cost)
      expect(weapon.reloadMs).toBe(expected)
      expect(weapon.reloadMs).toBeGreaterThan(accelerated.weapons[index]!.reloadMs)
    }
    const battle = startBattleFor(state, realCtx, uid, 'ano-training', 50_000, 1000)!
    expect(battle.startedAtGameMs).toBe(50_000)
    expect(battle.units.player!.weapons).toEqual(final.weapons.map(p => p.reloadMs))
    expect(battleWeaponCyclesOf(battle, [{ spec: final, shipId: uid, name: final.name }]).every(row => row.state === 'reload' && row.percent === 0)).toBe(true)
  })

  it('旧在途单船与四舰存档：零冷却和部分装填原样保留，不补开场延迟', () => {
    for (const size of [1, 4]) {
      const w = world('mixed', size)
      w.state.gameMs = w.battle.lastTickGameMs = 5000
      w.battle.stats.meShots = 9
      const pending = [0, 137, 211, 0, 503, 719]
      for (const { spec } of w.entries) w.battle.units[spec.tag]!.weapons = [...pending]
      w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: CARD, battle: w.battle }
      const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
      const battle = loaded.expedition.battle!
      expect(battle.lastTickGameMs).toBe(5000)
      expect(battle.stats.meShots).toBe(9)
      expect(battle.ammo).toEqual(w.battle.ammo)
      for (const { spec } of w.entries) expect(battle.units[spec.tag]!.weapons).toEqual(pending)
      loaded.gameMs = 5001
      advanceBattleFor(loaded, w.ctx, battle, loaded.shipId, CARD)
      expect(new Set(myShots(battle).filter(event => event.src === 'base').map(event => event.tag))).toEqual(new Set(w.entries.map(entry => entry.spec.tag)))
      for (const { spec } of w.entries) expect(battle.units[spec.tag]!.weapons[1]).toBe(136)
      loaded.gameMs = 5137
      advanceBattleFor(loaded, w.ctx, battle, loaded.shipId, CARD)
      for (const { spec } of w.entries) expect(battle.units[spec.tag]!.weapons[1]).toBe(0)
      const ammo = battle.ammo.kin
      loaded.gameMs = 5138
      advanceBattleFor(loaded, w.ctx, battle, loaded.shipId, CARD)
      expect(battle.ammo.kin).toBe(ammo - 4 * size)
      for (const { spec } of w.entries) expect(battle.units[spec.tag]!.weapons[1]).toBe(spec.weapons[1]!.reloadMs)
    }
  })

  it('换波只播种敌方：四舰已有装填继续倒数，已就绪的玩家武器不被重新延迟', () => {
    const w = world('mixed', 4, true)
    w.ctx.balance.battle.waveEnterGapMs = 0
    w.advance(100)
    w.battle.units.player!.weapons[0] = 0
    const before = w.entries.map(({ spec }) => [...w.battle.units[spec.tag]!.weapons])
    for (const unit of Object.values(w.battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    const ammo = { ...w.battle.ammo }
    w.advance(101)
    expect(w.battle.waveIdx).toBe(1)
    expect(w.battle.units['w1-foe-0']).toBeDefined()
    expect(w.battle.ended).toBeNull()
    for (const [index, { spec }] of w.entries.entries()) {
      expect(w.battle.units[spec.tag]!.weapons).toEqual(before[index]!.map((cd, wi) => cd === 0 ? spec.weapons[wi]!.reloadMs : cd - 1))
    }
    expect(myShots(w.battle)).toMatchObject([{ tag: 'player', src: 'base', atMs: 101 }])
    expect(w.battle.stats.meShots).toBe(1)
    expect(w.battle.ammo).toEqual(ammo)
  })

  it('正常、虫洞和真实旗舰建档入口共用玩家初始装填，非零开战时刻不提前抵扣', () => {
    const { state, ships } = alienFixture(realCtx, 'heavy', 109, 4)
    state.gameMs = 75_000
    state.weekendEvent = {
      seq: 1, startedAtWallMs: 0, coreId: 'galaxy-kor', peripheryIds: ['galaxy-home'],
      family: 'H', contributed: { 'galaxy-kor': 1, 'galaxy-home': 1 },
    }
    const normal = startBattleFor(state, realCtx, ships[0]!, 'ano-training', state.gameMs)!
    const wormhole = startFleetBattleFor(state, realCtx, ships, 'wh-alien-swarm', state.gameMs, null, { depth: 1, kind: 'node', waves: 1 })!
    const beforeArrival = wormhole.myFleet!.map(entry => [...wormhole.units[entry.tag]!.weapons])
    stampFoeArrivalFx(wormhole)
    expect(wormhole.myFleet!.map(entry => wormhole.units[entry.tag]!.weapons)).toEqual(beforeArrival)
    expect(Object.values(wormhole.units).filter(unit => unit.side === 'foe').every(unit => unit.enteredAtMs !== undefined)).toBe(true)
    const flagship = weekendStartFlagshipBattle(state, realCtx, new Date(2026, 9, 9, 20).getTime(), ships)!
    expect(normal.myFleet).toBeUndefined()
    expect(wormhole.wormhole).toMatchObject({ depth: 1, kind: 'node' })
    expect(wormhole.myFleet).toHaveLength(4)
    expect(flagship.wormhole).toBeUndefined()
    expect(flagship.myFleet).toHaveLength(4)
    expect(flagship.foeOverride?.waves).toHaveLength(4)
    for (const battle of [normal, wormhole, flagship]) {
      expect(battle.startedAtGameMs).toBe(state.gameMs)
      expect(battle.lastTickGameMs).toBe(state.gameMs)
      expect(battle.stats.meShots).toBe(0)
      const fleet = battle.myFleet ?? [{ tag: 'player', shipId: ships[0]! }]
      for (const entry of fleet) {
        const spec = createPlayerSpec(state, realCtx, entry.shipId)!
        expect(battle.units[entry.tag]!.weapons).toEqual(spec.weapons.map(p => Math.max(1, p.reloadMs)))
      }
    }
    const spec = createPlayerSpec(state, realCtx, ships[0]!)!
    const foes = createFoeSpecs(realCtx.anomalies.get('ano-training')!, realCtx.balance.battle)
    const direct = createBattleState({ ...spec, weapons: [{ ...spec.weapons[0]!, reloadMs: 0 }] }, foes, state.gameMs, 1000)
    expect(direct.units.player!.weapons).toEqual([1])
    for (const foe of foes) expect(direct.units[foe.tag]!.weapons).toEqual(foe.weapons.map(() => 0))
  })
})
