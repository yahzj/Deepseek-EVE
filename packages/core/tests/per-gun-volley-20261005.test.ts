import { describe, expect, it } from 'vitest'
import { ANOMALIES, buildSimContext, FOE_SHIPS } from '@whale/data'
import { advanceBattleFor, applyFoeShot, createFoeSpecs, createPlayerSpec, foeStrengthOf, startBattleFor } from '../src/combat'
import { volleyGunCountOf, volleyDamageShareOf } from '../src/combatVolley'
import { pushBattleFx } from '../src/combatFx'
import { createInitialState } from '../src/state'
import type { BattleFx, BattleState } from '../src/state'
import type { FoeShipDef } from '../src/types'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { fitModule } from '../src/equipment'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

function setup(count: number, hit: number, enemyCount = 1, beam = false, enemyBeam = false) {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  const cannon = moduleDef('gun-test', beam ? 'laser' : 'turret', 0, {
    rack: 'high', cpuUse: 1, damageType: beam ? 'plasma' : 'kinetic', hitRate: hit,
    dmgMult: 1, reloadMs: 2000, minRangeM: 0, maxRangeM: 20000, falloff: 1,
  })
  const foe: FoeShipDef = {
    id: 'foe-test', name: '测试敌舰', family: 'A', hullClassTier: 1, speedRatio: 1,
    hp: 1e9, split: { s: 0, a: 0, h: 1 }, shotDmg: 103, gunCount: enemyCount,
    hitRate: hit, reloadMs: 2000, rangeMinM: 1, rangeMaxM: 20000, falloff: 1,
    dmgMix: enemyBeam ? { plasma: 1 } : { kinetic: 1 }, tactic: 'orbit', evasion: 0,
  }
  const card = { ...anomaly('card-test', 'galaxy-hub', { threat: 20 }), ships: [{ ship: foe, count: 1 }] }
  const base = makeTestCtx({ ships: [ship('sandcat', { shieldHp: 0, armorHp: 0, hullHp: 1e9, cpu: 200,
    evasion: 0, hitBonus: 0, slots: { high: 8, mid: 0, low: 0 } })], modules: [cannon], anomalies: [card] })
  const ctx = { ...base, balance: { ...base.balance, battle: { ...base.balance.battle, shieldRegenPerSec: 0 } } }
  state.moduleBay[cannon.id] = count
  for (let i = 0; i < count; i++) expect(fitModule(state, cannon.id, ctx).ok).toBe(true)
  state.warehouse.items[beam ? 'ammo-plasma-l' : 'ammo-kinetic-l'] = 1e6
  const battle = startBattleFor(state, ctx, state.shipId, card.id, 0)!
  return { state, ctx, battle, card, foe }
}
function collect(run: ReturnType<typeof setup>, ms = 12000, distance?: number) {
  const events: BattleFx[] = []
  for (let at = 100; at <= ms; at += 100) {
    const seq = run.battle.fxSeq
    run.state.gameMs = at
    if (distance !== undefined) run.battle.distanceM = distance
    advanceBattleFor(run.state, run.ctx, run.battle, run.state.shipId, run.card.id)
    events.push(...run.battle.fx.filter((fx) => fx.seq >= seq && !fx.web && !fx.droneDown && !fx.blink))
  }
  return events
}
function volleys(events: BattleFx[]) {
  const grouped = new Map<number, BattleFx[]>()
  for (const event of events) {
    const list = grouped.get(event.atMs) ?? []
    list.push(event); grouped.set(event.atMs, list)
  }
  return [...grouped.values()]
}

describe('逐炮齐射守恒与独立命中', () => {
  it.each([0, 1, 5, 103, 103.75, 1000.125])('总伤%s按8门分摊不增加火力，允许低总伤出现0伤炮', (total) => {
    expect(Array.from({ length: 8 }, (_, index) => volleyDamageShareOf(total, 8, index)).reduce((n, d) => n + d, 0)).toBe(total)
  })
  it('炮数读取兼容玩家合并组与敌主炮，敌主炮不占原count轴', () => {
    expect(volleyGunCountOf({ count: 5 })).toBe(5)
    expect(volleyGunCountOf({ gunCount: 8 })).toBe(8)
    expect(volleyGunCountOf({})).toBe(1)
    expect(volleyGunCountOf({ count: NaN })).toBe(1)
  })
  it('玩家五炮一轮有五个事件且允许部分命中；耗弹仍每门一发', () => {
    const run = setup(5, 0.5)
    const loaded = run.battle.ammo.kin
    const groups = volleys(collect(run).filter((fx) => fx.side === 'me' && fx.src === 'turret'))
    expect(groups.length).toBeGreaterThan(2)
    expect(groups.every((g) => g.length === 5)).toBe(true)
    expect(groups.some((g) => g.some((e) => e.hit) && g.some((e) => !e.hit))).toBe(true)
    expect(loaded - run.battle.ammo.kin).toBe(groups.length * 5)
  })
  it('玩家激光仍必中，五门全中原始伤害总量与建档组伤一致', () => {
    const run = setup(5, 1, 1, true)
    const damage = createPlayerSpec(run.state, run.ctx, run.state.shipId)!.weapons.find((w) => w.src === 'laser')!.shotDmg!
    const groups = volleys(collect(run).filter((fx) => fx.side === 'me' && fx.src === 'laser'))
    expect(groups.every((g) => g.length === 5 && g.every((e) => e.hit))).toBe(true)
    for (const group of groups) expect(group.reduce((n,e) => n + (e.dmg ?? 0), 0)).toBeCloseTo(damage, 6)
  })
  it('敌方四炮独立命中并保留总伤字段，不把旧伤再乘炮数', () => {
    const run = setup(0, 0.5, 4)
    const groups = volleys(collect(run).filter((fx) => fx.side === 'foe'))
    expect(groups.every((g) => g.length === 4)).toBe(true)
    expect(groups.some((g) => g.some((e) => e.hit) && g.some((e) => !e.hit))).toBe(true)
    expect(createFoeSpecs(run.card, run.ctx.balance.battle)[0]!.weapons[0]!.shotDmg).toBe(103)
  })
  it('敌方八光束全中每轮实收合计103，而不是824', () => {
    const run = setup(0, 1, 8, false, true)
    const groups = volleys(collect(run).filter((fx) => fx.side === 'foe'))
    expect(groups.every((g) => g.length === 8 && g.every((e) => e.hit))).toBe(true)
    for (const group of groups) expect(group.reduce((n,e) => n + (e.dmg ?? 0), 0)).toBeCloseTo(103, 6)
  })
  it('射击次数统计与逐炮事件同口径，MISS不写伪伤害', () => {
    const run = setup(5, 0.5, 4)
    const events = collect(run)
    expect(run.battle.stats.meShots).toBe(events.filter((fx) => fx.side === 'me').length)
    expect(run.battle.stats.foeShots).toBe(events.filter((fx) => fx.side === 'foe').length)
    for (const event of events) if (!event.hit) expect(event.dmg).toBeUndefined()
  })
  it('敌舰三连发每发为四炮，100ms节奏与整轮总伤仍守恒', () => {
    const run = setup(0, 1, 4, false, true)
    run.foe.burst = { shots: 3, gapMs: 100 }
    const groups = volleys(collect(run).filter((fx) => fx.side === 'foe'))
    expect(groups.length).toBeGreaterThan(3)
    expect(groups.every((g) => g.length === 4)).toBe(true)
    expect(groups[1]![0]!.atMs - groups[0]![0]!.atMs).toBe(100)
    expect(groups[2]![0]!.atMs - groups[1]![0]!.atMs).toBe(100)
    const total = groups.slice(0, 3).flat().reduce((n,e) => n + (e.dmg ?? 0), 0)
    expect(total).toBeCloseTo(103 * 3, 6)
  })
  it('总伤低于炮数时仍显示每门光束，零伤炮不额外补成1点', () => {
    const run = setup(0, 1, 8, false, true)
    run.foe.shotDmg = 3
    const groups = volleys(collect(run).filter((fx) => fx.side === 'foe'))
    expect(groups.every((g) => g.length === 8)).toBe(true)
    for (const group of groups) expect(group.reduce((n,e) => n + (e.dmg ?? 0), 0)).toBeCloseTo(3, 6)
  })
  it('敌主炮混伤分成八炮，全中整组总伤仍为103', () => {
    const run = setup(0, 1, 8)
    run.foe.dmgMix = { kinetic: 6, explosive: 4 }
    const groups = volleys(collect(run).filter((fx) => fx.side === 'foe'))
    expect(groups.every((g) => g.length === 8)).toBe(true)
    for (const group of groups) expect(group.reduce((n,e) => n + (e.dmg ?? 0), 0)).toBeCloseTo(103, 6)
  })
  it('低伤多炮混伤保留原比例，分摊不把主副伤害取整放大', () => {
    const w = { label: '混伤组', kind: 'fixed' as const, fixedType: 'kinetic' as const, gunCount: 8,
      shotDmg: 13, shotsByType: { kinetic: 8, explosive: 5 }, hitRate: 1, reloadMs: 1000, minRangeM: 1, maxRangeM: 10000, falloff: 1 }
    let hp = { s: 0, a: 0, h: 1000 }
    for (let i = 0; i < 8; i++) hp = applyFoeShot(hp, { hull: { kinetic: 0.5 } }, w, volleyDamageShareOf(13, 8, i), 'kinetic')
    expect(1000 - hp.h).toBeCloseTo(8 * 0.5 + 5, 6)
  })
  it('整拍80%齐射保险按八炮共用额度，不逐炮重开', () => {
    const run = setup(0, 1, 8, false, true)
    run.foe.shotDmg = 1e12
    const initial = run.battle.units.player!.hp.h
    const groups = volleys(collect(run, 2000, 6000).filter((fx) => fx.side === 'foe'))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.reduce((n,e) => n + (e.dmg ?? 0), 0)).toBeCloseTo(initial * 0.8, 1)
    expect(run.battle.units.player!.hp.h).toBeGreaterThanOrEqual(initial * 0.2 - 1)
  })
  it('同轮炮打沉目标后接力新目标，不重复打已沉舰', () => {
    const run = setup(5, 1)
    run.foe.hp = 5
    run.card.ships = [{ ship: run.foe, count: 2 }]
    const battle = startBattleFor(run.state, run.ctx, run.state.shipId, run.card.id, 0)!
    run.battle = battle
    const hits = collect(run, 2000, 6000).filter((fx) => fx.side === 'me' && fx.src === 'turret' && fx.hit)
    expect(new Set(hits.map((fx) => fx.to)).size).toBe(2)
  })
  it('合并近防炮同轮打落后接力下一架，不因反击令牌消费丢掉剩余炮', () => {
    const run = setup(5, 1)
    run.ctx.modules.get('gun-test')!.antiDrone = 2
    run.foe.drones = [{ count: 2, drone: {
      id: 'drone-test', name: '测试机', family: 'A', role: 'combat', dmg: 1, damageType: 'kinetic',
      hitRate: 1, falloff: 1, maxRangeM: 20000, reloadMs: 2000,
      defense: { shieldHp: 0, armorHp: 0, hullHp: 1, evasion: 0 },
    } }]
    run.battle = startBattleFor(run.state, run.ctx, run.state.shipId, run.card.id, 0)!
    run.battle.droneHitAt = { me: 0 }
    const loaded = run.battle.ammo.kin
    const events = collect(run, 2000, 6000)
    expect(run.battle.foeDronePools!['foe-0']!.filter((p) => !p.alive)).toHaveLength(2)
    expect(events.filter((e) => e.side === 'me' && e.pd)).toHaveLength(2)
    expect(loaded - run.battle.ammo.kin).toBe(5)
  })
  it('五炮全体攻击按每目标逐炮判定，主目标MISS不阻断副目标', () => {
    const run = setup(5, 0.5)
    run.ctx.modules.get('gun-test')!.hitsAllFoes = true
    run.card.ships = [{ ship: run.foe, count: 3 }]
    run.battle = startBattleFor(run.state, run.ctx, run.state.shipId, run.card.id, 0)!
    const groups = volleys(collect(run, 12000, 6000).filter((fx) => fx.side === 'me' && fx.src === 'turret'))
    expect(groups.every((g) => g.length === 15)).toBe(true)
    expect(groups.some((g) => g.some((e) => e.hit) && g.some((e) => !e.hit))).toBe(true)
  })
  it('同拍数百炮事件不被旧48条环裁掉，硬上限和seq仍有界', () => {
    const run = setup(0, 1)
    for (let i = 0; i < 256; i++) pushBattleFx(run.battle, { atMs: 1000, side: 'foe', tag: 'foe-0', type: 'kinetic', hit: true })
    expect(run.battle.fx).toHaveLength(256)
    const first = run.battle.fx[0]!.seq
    expect(run.battle.fx[255]!.seq).toBe(first + 255)
    for (let i = 0; i < 300; i++) pushBattleFx(run.battle, { atMs: 1000, side: 'foe', tag: 'foe-0', type: 'kinetic', hit: true })
    expect(run.battle.fx).toHaveLength(512)
    pushBattleFx(run.battle, { atMs: 1100, side: 'foe', tag: 'foe-0', type: 'kinetic', hit: true })
    expect(run.battle.fx).toHaveLength(48)
  })
  it('超过48条的同拍炮火事件读档仍完整保留', () => {
    const run = setup(0, 1)
    run.state.expedition.active = true
    run.state.expedition.phase = 'battle'
    run.state.expedition.anomalyId = run.card.id
    run.state.expedition.battle = run.battle
    for (let i = 0; i < 256; i++) pushBattleFx(run.battle, { atMs: 1000, side: 'foe', tag: 'foe-0', type: 'kinetic', hit: true })
    const back = loadSaveFile(serializeSaveFile(run.state)).state
    expect(back.expedition.battle!.fx).toHaveLength(256)
  })
  it('进行中的战斗读档后逐炮继续，静态炮数不需另存', () => {
    const run = setup(5, 0.5, 4)
    collect(run, 5000)
    run.state.expedition.active = true
    run.state.expedition.phase = 'battle'
    run.state.expedition.anomalyId = run.card.id
    run.state.expedition.battle = run.battle
    const back = loadSaveFile(serializeSaveFile(run.state)).state
    const battle = back.expedition.battle as BattleState
    const seq = battle.fxSeq
    back.gameMs = 12000
    advanceBattleFor(back, run.ctx, battle, back.shipId, run.card.id)
    expect(volleys(battle.fx.filter((fx) => fx.seq >= seq && fx.side === 'me' && fx.src === 'turret')).every((g) => g.length === 5)).toBe(true)
  })
})

describe('势力敌舰炮数登记不改变舰级和敌卡名义火力', () => {
  const ctx = buildSimContext()
  it.each(FOE_SHIPS.map((s) => [s.id, s] as const))('%s有效炮数和舰级总伤守恒', (_id, foe) => {
    expect(Number.isInteger(foe.gunCount)).toBe(true)
    expect(foe.gunCount).toBeGreaterThanOrEqual(2)
    expect(foe.gunCount).toBeLessThanOrEqual(8)
    const card = { ...anomaly('single', 'galaxy-hub'), ships: [{ ship: foe, count: 1 }] }
    const old = { ...card, ships: [{ ship: { ...foe, gunCount: undefined }, count: 1 }] }
    expect(foeStrengthOf(card, ctx.balance.battle)).toEqual(foeStrengthOf(old, ctx.balance.battle))
  })
  it.each(ANOMALIES.filter((a) => a.ships?.length).map((a) => [a.id,a] as const))('%s全编成总血、DPS与旧炮数相同', (_id, card) => {
    const old = { ...card, ships: card.ships!.map((slot) => ({ ...slot, ship: { ...slot.ship, gunCount: undefined } })) }
    expect(foeStrengthOf(card, ctx.balance.battle)).toEqual(foeStrengthOf(old, ctx.balance.battle))
  })
})
