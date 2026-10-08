import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { BattleState } from '../src/state'
import type { AnomalyDef, FoeShipDef } from '../src/types'
import { advanceBattleFor, BATTLE_STEP_MS, createPlayerSpec, startBattleFor, startFleetBattleFor } from '../src/combat'
import { BATTLE_ARRIVAL_FLY_MS } from '../src/combatFx'
import { addShipToFleet } from '../src/fleetBook'
import { initDroneLaunch } from '../src/droneLaunch'
import { activeFoeSpecsOf, seedUnit } from '../src/foeSpecs'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const base = buildSimContext()
const target: FoeShipDef = {
  id: 'foe-wave-cadence', name: '换波节奏靶舰', family: 'A', hullClassTier: 5,
  hp: 1e9, split: { s: .2, a: .5, h: .3 }, speedRatio: 0, tactic: 'orbit', desireRangeM: 1000,
  shotDmg: 1, reloadMs: 1e9, rangeMinM: 1, rangeMaxM: 2500, hitRate: 0, falloff: 1, dmgMix: { kinetic: 1 },
}
function world(size = 1, gap = base.balance.battle.waveEnterGapMs ?? 0) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261008 })
  const ids = Array.from({ length: size }, () => addShipToFleet(state, 'sh-nautilus'))
  state.shipId = ids[0]!
  for (const id of ids) {
    const unit = state.fleet[id]!
    unit.fitted.high = ['mod-turret-kin-1', 'mod-laser-1']
    unit.droneLoad = { 'drone-scout': 2 }
  }
  for (const type of ['kinetic', 'plasma']) state.warehouse.items[`ammo-${type}-l`] = 100000
  const card: AnomalyDef = { ...base.anomalies.get('ano-training')!, id: 'ano-wave-cadence', threat: 1, threatJudged: 1,
    ships: Array.from({ length: 4 }, (_, wave) => ({ ship: target, wave })),
    waves: Array.from({ length: 4 }, () => ({ units: 1, hpShare: .25 })),
  }
  const ctx = { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]),
    balance: { ...base.balance, battle: { ...base.balance.battle, waveEnterGapMs: gap } } }
  const battle = size === 1 ? startBattleFor(state, ctx, state.shipId, card.id, 0, 1000)!
    : startFleetBattleFor(state, ctx, ids, card.id, 0, 1000)!
  battle.distanceM = 1000
  const entries = ids.map((id, index) => ({ id, tag: index === 0 ? 'player' : `ally-${index}`, spec: createPlayerSpec(state, ctx, id)! }))
  // 隔离换波边界：保留真实初始建档，设置上一波打到一半时的不同装填余额。
  for (const [owner, entry] of entries.entries()) battle.units[entry.tag]!.weapons = entry.spec.weapons.map((_, index) => 150 + index * 170 + owner * 30)
  for (const pool of Object.values(battle.dronePools ?? {})) pool.launched = true
  for (const queue of Object.values(battle.droneLaunchBy ?? {})) queue.q = []
  const events: BattleState['fx'] = []
  let seq = -1
  const advance = (time: number, current = battle) => {
    state.gameMs = time
    advanceBattleFor(state, ctx, current, state.shipId, card.id)
    for (const event of current.fx) if (event.seq > seq) {
      seq = event.seq
      if (event.side === 'me' && !event.droneDown && !event.web && !event.blink) events.push(event)
    }
  }
  const clear = (current = battle) => {
    for (const unit of Object.values(current.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
  }
  return { state, ctx, battle, entries, events, advance, clear, gap }
}
const clocks = (battle: BattleState) => Object.fromEntries(Object.values(battle.units).filter(unit => unit.side === 'me').map(unit => [unit.tag, [...unit.weapons]]))

describe('换波保留玩家装填相位', () => {
  it.each([1, 4])('%i舰：转场与入场结束前不压平各武器/无人机余额，原有池与队列不重建', size => {
    const w = world(size)
    const before = clocks(w.battle), pools = structuredClone(w.battle.dronePools), queues = structuredClone(w.battle.droneLaunchBy)
    const ammo = structuredClone(w.battle.ammo)
    w.battle.meBurstFired = { 'player#1': 1 }
    w.battle.meOverlayReload = { 'player#2': { r: 1600, f: 2 } }
    w.clear(); w.advance(10)
    const end = w.battle.waveClearAt!
    w.advance(end - 1)
    expect(clocks(w.battle)).toEqual(before)
    w.advance(end)
    expect(w.battle.waveIdx).toBe(1)
    expect(clocks(w.battle)).toEqual(before)
    w.advance(end + BATTLE_ARRIVAL_FLY_MS)
    expect(clocks(w.battle)).toEqual(before)
    expect(w.battle.dronePools).toEqual(pools)
    expect(w.battle.droneLaunchBy).toEqual(queues)
    expect(w.battle.meBurstFired).toEqual({ 'player#1': 1 })
    expect(w.battle.meOverlayReload).toEqual({ 'player#2': { r: 1600, f: 2 } })
    expect(w.battle.ammo).toEqual(ammo)
    expect(w.events).toEqual([])
    w.advance(end + BATTLE_ARRIVAL_FLY_MS + BATTLE_STEP_MS)
    for (const entry of w.entries) expect(w.battle.units[entry.tag]!.weapons).toEqual(before[entry.tag]!.map(cd => cd - BATTLE_STEP_MS))
  })
  it('四波：两架已出击同型无人机的相位差不会在每波缩成同步', () => {
    const w = world()
    const drones = w.entries[0]!.spec.weapons.flatMap((weapon, index) => weapon.src === 'drone' ? [index] : [])
    expect(drones).toHaveLength(2)
    for (let wave = 1; wave < 4; wave++) {
      const before = [...w.battle.units.player!.weapons]
      const at = w.state.gameMs
      w.clear(); w.advance(at + 10)
      const end = w.battle.waveClearAt!
      w.advance(end); w.advance(end + BATTLE_ARRIVAL_FLY_MS)
      expect(w.battle.waveIdx).toBe(wave)
      expect(w.battle.units.player!.weapons).toEqual(before)
      const start = end + BATTLE_ARRIVAL_FLY_MS
      const seq = w.events.length
      for (let time = start + 10; time <= start + Math.max(...drones.map(index => before[index]!)) + 10; time += 10) w.advance(time)
      const shots = w.events.slice(seq).filter(event => event.src === 'drone')
      expect(shots).toHaveLength(2)
      expect(shots[1]!.atMs - shots[0]!.atMs).toBe(before[drones[1]!]! - before[drones[0]!]!)
      expect(shots[1]!.atMs).toBeGreaterThan(shots[0]!.atMs)
    }
  })
  it('转场中存档往返后继续保留余额和已出击状态', () => {
    const w = world()
    w.clear(); w.advance(10)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-wave-cadence', battle: w.battle }
    const back = loadSaveFile(serializeSaveFile(w.state, 0)).state.expedition.battle!
    const before = clocks(back)
    const end = back.waveClearAt!
    w.advance(end, back); w.advance(end + BATTLE_ARRIVAL_FLY_MS, back)
    expect(clocks(back)).toEqual(before)
    expect(back.dronePools).toEqual(w.battle.dronePools)
    expect(back.droneLaunchBy).toEqual(w.battle.droneLaunchBy)
  })
  it('零转场窗口直接延续剩余装填，不重装一轮或清零', () => {
    const w = world(1, 0), before = clocks(w.battle)
    w.clear(); w.advance(10)
    expect(w.battle.waveIdx).toBe(1)
    expect(w.battle.units.player!.weapons).toEqual(before.player!.map(cd => cd - 10))
  })
  it('真实首次队列自然错开500ms，已经放飞的两架无人机后续三波都保持差值', () => {
    const w = world()
    const spec = { ...w.entries[0]!.spec, tag: 'player' }
    const droneIndices = spec.weapons.flatMap((weapon, index) => weapon.src === 'drone' ? [index] : [])
    w.battle.units.player!.weapons = spec.weapons.map(weapon => weapon.reloadMs)
    initDroneLaunch(w.battle, [spec])
    const initialEnd = Math.max(...droneIndices.map(index => spec.weapons[index]!.reloadMs)) + 700
    for (let time = 10; time <= initialEnd; time += 10) w.advance(time)
    const first = w.events.filter(event => event.src === 'drone')
    expect(first).toHaveLength(2)
    expect(first[1]!.atMs - first[0]!.atMs).toBe(500)
    for (let wave = 1; wave < 4; wave++) {
      const before = [...w.battle.units.player!.weapons]
      const earliest = Math.min(...droneIndices.map(index => before[index]!))
      const latest = Math.max(...droneIndices.map(index => before[index]!))
      expect(latest - earliest).toBe(500)
      const previous = w.events.length
      w.clear(); w.advance(w.state.gameMs + 10)
      const end = w.battle.waveClearAt!
      w.advance(end); w.advance(end + BATTLE_ARRIVAL_FLY_MS)
      const resume = end + BATTLE_ARRIVAL_FLY_MS
      for (let time = resume + 10; time <= resume + latest + 20; time += 10) w.advance(time)
      const next = w.events.slice(previous).filter(event => event.src === 'drone')
      expect(next).toHaveLength(2)
      expect(next[0]!.atMs).toBe(resume + earliest + 10)
      expect(next[1]!.atMs - next[0]!.atMs).toBe(500)
      expect(w.battle.droneLaunchBy!.player!.q).toEqual([])
    }
  })
  it('正在等转场的同一存档：分拍与单次长步到同一时刻，玩家时钟与弹药一致', () => {
    const online = world(), offline = world()
    online.clear(); offline.clear(); online.advance(10); offline.advance(10)
    const end = online.battle.waveClearAt!
    expect(offline.battle.waveClearAt).toBe(end)
    const spawn = end + 100, finish = spawn + BATTLE_ARRIVAL_FLY_MS + 1000
    for (let time = 20; time < end; time += 100) online.advance(time)
    online.advance(spawn); offline.advance(spawn)
    for (let time = spawn + 100; time <= finish; time += 100) online.advance(time)
    online.advance(finish); offline.advance(finish)
    expect(clocks(offline.battle)).toEqual(clocks(online.battle))
    expect(offline.battle.ammo).toEqual(online.battle.ammo)
    expect(offline.battle.stats).toEqual(online.battle.stats)
    expect(offline.battle.droneLaunchBy).toEqual(online.battle.droneLaunchBy)
    expect(offline.events).toEqual(online.events)
  })
  it('下一波首次可攻击后才延续连发的发间装填，不重开第一发', () => {
    const w = world()
    const source = base.modules.get('mod-laser-1')!
    const modules = new Map(w.ctx.modules)
    modules.set(source.id, { ...source, burst: { shots: 3, gapMs: 100 } })
    w.ctx.modules = modules
    const wi = w.entries[0]!.spec.weapons.findIndex(weapon => weapon.kind === 'beam')
    expect(wi).toBeGreaterThan(0)
    w.battle.units.player!.weapons[wi] = 40
    w.battle.meBurstFired = { [`player#${wi}`]: 1 }
    w.clear(); w.advance(10)
    const end = w.battle.waveClearAt!
    w.advance(end); w.advance(end + BATTLE_ARRIVAL_FLY_MS + 50)
    expect(w.battle.meBurstFired![`player#${wi}`]).toBe(2)
    expect(w.battle.units.player!.weapons[wi]).toBe(90)
  })
  it('已可攻击但射程外：仍沿用正常装填推进；不把所有等待都暂停', () => {
    const w = world(1, 0)
    w.clear(); w.advance(10)
    w.battle.distanceM = 50000
    w.battle.myDesireM = 50000
    w.advance(1500)
    expect(w.battle.units.player!.weapons.every(cd => cd === 0)).toBe(true)
    expect(w.events).toEqual([])
  })
  it('主编队已灭仅有召唤舰入场：不是换波，不暂停原装填推进', () => {
    const w = world(1, 0)
    w.clear(); w.advance(10)
    const source = activeFoeSpecsOf(w.ctx.anomalies.get('ano-wave-cadence')!, w.ctx.balance.battle, 1)[0]!
    seedUnit(w.battle, { ...source, tag: `sup1-${source.tag}` }, { enterReload: true, arrivedAtMs: w.state.gameMs })
    w.battle.foeReviveCount = 1
    w.battle.units[source.tag]!.hp = { s: 0, a: 0, h: 0 }
    const before = clocks(w.battle).player!
    w.advance(110)
    expect(w.battle.waveIdx).toBe(1)
    expect(w.battle.units.player!.weapons).toEqual(before.map(cd => Math.max(0, cd - 100)))
  })
})
