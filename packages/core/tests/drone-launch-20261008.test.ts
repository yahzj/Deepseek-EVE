import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { createBattleState, createPlayerSpec, advanceBattleFor, startBattleFor, startFleetBattleFor, battleArcsFor, BATTLE_STEP_MS } from '../src/combat'
import { initDroneLaunch, releaseDroneLaunch, requeueDroneLaunch, droneLaunchGapMsOf } from '../src/droneLaunch'
import { buildDronePoolsFor, resolvePointDefense } from '../src/combatDrones'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { addShipToFleet } from '../src/fleetBook'
import { resolveDroneRevive } from '../src/droneRevive'
import { battleWeaponCyclesOf } from '../src/battleWeaponView'
import type { AnomalyDef, FoeShipDef } from '../src/types'

const ctx = buildSimContext()
function queue() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const uid = addShipToFleet(state, 'sh-nautilus')
  state.shipId = uid
  state.fleet[uid]!.droneLoad = { 'drone-scout': 2, 'drone-sentry': 1 }
  const spec = createPlayerSpec(state, ctx, uid)!
  const foe = { ...spec, tag: 'foe-0', side: 'foe' as const, family: 'R' as const, hullClassTier: 5 }
  const battle = createBattleState(spec, [foe], 0, 1000)
  battle.distanceM = 1000
  battle.dronePools = {}
  buildDronePoolsFor(ctx, spec, battle.dronePools, 1, 1)
  initDroneLaunch(battle, [spec])
  const indices = spec.weapons.flatMap((w, i) => w.src === 'drone' ? [i] : [])
  expect(indices).toHaveLength(3)
  return { state, uid, spec, battle, foe, indices }
}

describe('首次无人机出击队列', () => {
  it('500ms逐架，哨戒同队列；放出之后不限制再次攻击', () => {
    const { battle, spec, indices } = queue()
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(false)
    expect(releaseDroneLaunch(battle, spec, indices[0]!)).toBe(true)
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(false)
    battle.lastTickGameMs = 499
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(false)
    battle.lastTickGameMs = 500
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(true)
    expect(releaseDroneLaunch(battle, spec, indices[2]!)).toBe(false)
    battle.lastTickGameMs = 1000
    expect(releaseDroneLaunch(battle, spec, indices[2]!)).toBe(true)
    expect(releaseDroneLaunch(battle, spec, indices[0]!)).toBe(true)
    expect(battle.droneLaunchBy!.player!.q).toEqual([])
  })
  it('迟到获得机会不补发整群，下一架从实际释放时刻等待', () => {
    const { battle, spec, indices } = queue()
    battle.lastTickGameMs = 20_000
    expect(releaseDroneLaunch(battle, spec, indices[0]!)).toBe(true)
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(false)
    expect(battle.droneLaunchBy!.player!.nextAtMs).toBe(20_500)
  })
  it('各舰独立，死亡队头跳过，复活追加队尾', () => {
    const { battle, spec, indices } = queue()
    const ally = { ...spec, tag: 'ally-1' }
    buildDronePoolsFor(ctx, ally, battle.dronePools!, 1, 1)
    initDroneLaunch(battle, [spec, ally])
    expect(releaseDroneLaunch(battle, spec, indices[0]!)).toBe(true)
    expect(releaseDroneLaunch(battle, ally, indices[0]!)).toBe(true)
    const key = `player:${indices[1]}`
    battle.dronePools![key]!.alive = false
    battle.lastTickGameMs = 500
    expect(releaseDroneLaunch(battle, spec, indices[2]!)).toBe(true)
    battle.dronePools![key]!.alive = true
    requeueDroneLaunch(battle, key)
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(false)
    battle.lastTickGameMs = 1000
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(true)
  })
  it('待出击状态和队列往返不漂，不因读档重开等待', () => {
    const { state, battle, spec, indices } = queue()
    releaseDroneLaunch(battle, spec, indices[0]!)
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(back.droneLaunchBy).toEqual(battle.droneLaunchBy)
    expect(back.dronePools).toEqual(battle.dronePools)
    back.lastTickGameMs = 499
    expect(releaseDroneLaunch(back, spec, indices[1]!)).toBe(false)
    back.lastTickGameMs = 500
    expect(releaseDroneLaunch(back, spec, indices[1]!)).toBe(true)
  })
  it('旧档没有首次记录时按已放飞续战，复活才排队', () => {
    const { battle, spec, indices } = queue()
    delete battle.droneLaunchBy
    for (const p of Object.values(battle.dronePools!)) delete p.launched
    expect(releaseDroneLaunch(battle, spec, indices[2]!)).toBe(true)
    requeueDroneLaunch(battle, `player:${indices[0]}`)
    expect(battle.dronePools![`player:${indices[0]}`]!.launched).toBe(false)
    expect(releaseDroneLaunch(battle, spec, indices[0]!)).toBe(true)
    expect(battle.droneLaunchBy!.player!.gapMs).toBe(500)
  })
  it('储备甲板真实复活点撤销首次放飞并追加队尾', () => {
    const { state, uid, battle, spec, indices } = queue()
    state.fleet[uid]!.fitted.high = ['mod-drone-deck-3']
    const key = `player:${indices[0]}`
    releaseDroneLaunch(battle, spec, indices[0]!)
    battle.dronePools![key]!.alive = false
    battle.droneReviveStock = { 'drone-scout': 1 }
    battle.droneRevive = { player: { q: [key], t: [1], c: [9000], v: {}, shipId: uid } }
    resolveDroneRevive(state, ctx, battle, 1)
    expect(battle.dronePools![key]!.alive).toBe(true)
    expect(battle.dronePools![key]!.launched).toBe(false)
    expect(battle.droneLaunchBy!.player!.q.at(-1)).toBe(key)
    expect(releaseDroneLaunch(battle, spec, indices[0]!)).toBe(false)
  })
  it('冻结/临时离开前移战斗时钟时，等待余额不减少', () => {
    const { battle, spec, indices } = queue()
    releaseDroneLaunch(battle, spec, indices[0]!)
    battle.startedAtGameMs += 3_600_000
    battle.lastTickGameMs += 3_600_000
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(false)
    battle.lastTickGameMs += 500
    expect(releaseDroneLaunch(battle, spec, indices[1]!)).toBe(true)
  })
  it('待出击机不被防空选中，已释放的机仍可受击', () => {
    const { state, battle, foe, spec, indices } = queue()
    const before = structuredClone(battle.dronePools)
    battle.pdCd = [100]
    battle.droneHitAt = { foe: 0 }
    resolvePointDefense(state, battle, [foe], ctx.balance.battle, 100)
    expect(battle.dronePools).toEqual(before)
    expect(battle.droneHitAt!.foe).toBe(0)
    releaseDroneLaunch(battle, spec, indices[0]!)
    resolvePointDefense(state, battle, [foe], ctx.balance.battle, 500)
    expect(battle.dronePools).not.toEqual(before)
  })
  it.each([0, 1, 2, 3, 30])('%s件机库逐件乘算，装填不变，等待下限10ms', n => {
    const hangar = ctx.modules.get('mod-wh-a-hangar')!
    expect(hangar.droneCycleCutPct).toBe(.2)
    expect(droneLaunchGapMsOf(Array(n).fill(hangar))).toBe(Math.max(10, Math.round(500 * .8 ** n)))
    const { state, uid } = queue()
    const local = { ...ctx, ships: new Map(ctx.ships) }
    local.ships.set('sh-nautilus', { ...ctx.ships.get('sh-nautilus')!, cpu: 10_000, slots: { high: 4, mid: 4, low: 30 } })
    const before = createPlayerSpec(state, local, uid)!
    state.fleet[uid]!.fitted.low = Array(n).fill(hangar.id)
    const after = createPlayerSpec(state, local, uid)!
    expect(after.weapons.filter(w => w.src === 'drone').map(w => w.reloadMs)).toEqual(before.weapons.filter(w => w.src === 'drone').map(w => w.reloadMs))
    expect(after.droneLaunchGapMs).toBe(droneLaunchGapMsOf(Array(n).fill(hangar)))
  })
})

const inert: FoeShipDef = { id: 'launch-test-foe', name: '出击靶舰', family: 'R', hullClassTier: 5,
  hp: 1e9, split: { s: .3, a: .4, h: .3 }, speedRatio: 0, tactic: 'orbit',
  shotDmg: 0, rangeMinM: 0, rangeMaxM: 2500, reloadMs: 1e9, hitRate: 0, falloff: 1, dmgMix: { kinetic: 1 } }
function live(hangars = 0, count = 2, size = 1) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const ids = Array.from({ length: size }, () => addShipToFleet(state, 'sh-nautilus'))
  state.shipId = ids[0]!
  state.skills.trained['drone-servicing'] = 5
  for (const uid of ids) {
    state.fleet[uid]!.droneLoad = { 'drone-scout': count, 'drone-sentry': 1 }
    state.fleet[uid]!.fitted.low = Array(hangars).fill('mod-wh-a-hangar')
  }
  const card: AnomalyDef = { ...ctx.anomalies.get('ano-training')!, id: 'launch-test', threat: 20, threatJudged: 20,
    ships: [{ ship: inert, count: 1 }], waves: undefined }
  const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
  const battle = size === 1 ? startBattleFor(state, local, state.shipId, card.id, 0, 1000)!
    : startFleetBattleFor(state, local, ids, card.id, 0, 1000)!
  battle.distanceM = 1000
  const events: typeof battle.fx = []
  let seq = -1
  const advance = (ms: number) => {
    state.gameMs = ms
    advanceBattleFor(state, local, battle, state.shipId, card.id)
    for (const event of battle.fx) if (event.seq > seq) { seq = event.seq; if (event.side === 'me' && event.src === 'drone' && !event.droneDown) events.push(event) }
  }
  return { state, local, battle, events, ids, card, advance }
}

describe('主树100毫秒版本实际首次出击', () => {
  it('先装填，两架首发3700/4200毫秒，后续仍按原攻击周期', () => {
    expect(BATTLE_STEP_MS).toBe(100)
    const w = live()
    for (let time = 100; time <= 8000; time += 100) w.advance(time)
    const times = w.events.filter(event => event.artId === 'drone-scout').map(event => event.atMs)
    expect(times.slice(0, 2)).toEqual([3700, 4200])
    expect(times.slice(2, 4)).toEqual([7400, 7900])
    expect(w.events.filter(event => event.artId === 'drone-sentry')[0]!.atMs).toBeGreaterThanOrEqual(7000)
  })
  it.each([[0, 500], [1, 400], [2, 400], [3, 300]])('%i机库实际相邻首发%i毫秒，非整拍向后量化', (hangars, gap) => {
    const w = live(hangars)
    for (let time = 100; time <= 5000; time += 100) w.advance(time)
    const pair = w.events.filter(event => event.artId === 'drone-scout').slice(0, 2)
    expect(pair).toHaveLength(2)
    expect(pair[1]!.atMs - pair[0]!.atMs).toBe(gap)
  })
  it('射程外积压，回到射程同拍只出一架，下一架再等500毫秒', () => {
    const w = live()
    w.battle.distanceM = 20000
    w.battle.myDesireM = 20000
    for (let time = 100; time <= 6000; time += 100) w.advance(time)
    expect(w.events).toHaveLength(0)
    w.battle.distanceM = 1000
    w.battle.myDesireM = 1000
    w.advance(6100)
    expect(w.events).toHaveLength(1)
    w.advance(6500)
    expect(w.events).toHaveLength(1)
    w.advance(6600)
    expect(w.events).toHaveLength(2)
  })
  it('四舰各自逐架排队，长步离线与分拍的首次时刻相同', () => {
    const online = live(0, 4, 4), offline = live(0, 4, 4)
    for (let time = 100; time <= 5500; time += 100) online.advance(time)
    offline.advance(5500)
    expect(offline.battle.dronePools).toEqual(online.battle.dronePools)
    expect(offline.battle.droneLaunchBy).toEqual(online.battle.droneLaunchBy)
    const get = (events: typeof online.events) => events.filter(e => e.artId === 'drone-scout').map(e => [e.tag, e.atMs])
    expect(get(offline.events)).toEqual(get(online.events))
    for (const tag of ['player', 'ally-1', 'ally-2', 'ally-3']) {
      expect(online.events.filter(e => e.tag === tag && e.artId === 'drone-scout').map(e => e.atMs)).toEqual([3700, 4200, 4700, 5200])
    }
  })
  it('已放飞数随真实队列增长；混合同型聚合不被待出击零冷却覆盖', () => {
    const w = live()
    const arcs = () => battleArcsFor(w.state, w.local, { battle: w.battle, anomaly: w.card, leaderShipId: w.state.shipId })!
    expect(arcs().myUnits[0]!.drones.find(d => d.artId === 'drone-scout')).toMatchObject({ count: 2, deployed: 0 })
    for (let time = 100; time <= 3700; time += 100) w.advance(time)
    expect(arcs().myUnits[0]!.drones.find(d => d.artId === 'drone-scout')).toMatchObject({ count: 2, deployed: 1 })
    const spec = createPlayerSpec(w.state, w.local, w.state.shipId)!
    const row = battleWeaponCyclesOf(w.battle, [{ spec, shipId: w.state.shipId, name: spec.name }]).find(r => r.src === 'drone' && r.label.includes('蜂鸟'))!
    expect(row.state).toBe('reload')
    expect(row.remainingMs).toBeGreaterThan(0)
    expect(row.aliveCount).toBe(2)
    w.advance(4200)
    expect(arcs().myUnits[0]!.drones.find(d => d.artId === 'drone-scout')!.deployed).toBe(2)
  })
})

