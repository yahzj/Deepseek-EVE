import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { alienFixture } from '../../../tools/alien-invasion-fixture'
import { advanceBattleFor, startBattleFor, carryVolleyOverflow } from '../src/combat'
import { createFoeSpecs, foeThreatOfAnomaly } from '../src/foeSpecs'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendApplyBattleOutcome, weekendFlagshipSpecOf } from '../src/weekendBattle'
import { weekendFoePoolOf, weekendFamilyForWindow } from '../src/weekendEvent'
import { weekendBountyCardsOf, weekendBoardRowsOf } from '../src/weekendBounty'
import { WRECK_GROUP_BY_KEY, WRECK_GROUP_OF_MEMBER } from '../src/wreckGroups'
import { injectWeekendWreck, recycleProfileOf, rollRecycleCoreGain } from '../src/salvage'
import { pullOneWreck } from '../src/salvaging'
import { materialGroupIdsOf } from '../src/manufacturing'
import { cleanBattle } from '../src/saveBattleClean'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const now = new Date(2026, 9, 9, 20).getTime()
const cardIds = ['alien-vanguard', 'alien-escort', 'alien-main', 'alien-broodmother']

describe('异形入侵真实接线', () => {
  it('独立区域池、周轮换与回收身份完整', () => {
    expect(weekendFamilyForWindow(now)).toBe('C')
    expect(weekendFamilyForWindow(new Date(2026, 9, 16, 20).getTime())).toBe('H')
    expect(weekendFoePoolOf('C', false)).toEqual(['alien-vanguard', 'alien-escort'])
    expect(weekendFoePoolOf('C', true)).toEqual(['alien-escort', 'alien-main'])
    for (const id of cardIds) {
      expect(ctx.anomalies.get(id)?.hidden).toBe(true)
      expect(WRECK_GROUP_OF_MEMBER.get(id)).toBe('c-inv')
      expect(ctx.anomalies.get(id)?.threat).toBe(foeThreatOfAnomaly(ctx.anomalies.get(id)!, id === 'alien-broodmother' ? 10 : 3, ctx.balance.battle))
    }
  })
  it('两载体炮数/火力/机群加成与孵化挂载真实消费', () => {
    for (const [id, guns, gunDmg, count, droneDmg, cycle, stock, charge] of [
      ['foe-alien-hiveback', 1, 91, 8, 209, 20000, 32, 1.5],
      ['foe-alien-broodmother', 2, 279, 12, 423, 15000, 'unlimited', 1.25],
    ] as const) {
      const ship = ctx.foeShips!.get(id)!
      const base = { ...ctx.anomalies.get('alien-vanguard')!, ships: [{ ship, count: 1, firepowerAnchor: id.endsWith('hiveback') ? 228 : 558 }] }
      const unit = createFoeSpecs(base, ctx.balance.battle)[0]!
      expect(unit.weapons[0]).toMatchObject({ gunCount: guns, shotDmg: gunDmg, maxRangeM: 6000 })
      const drones = unit.weapons.filter(w => w.src === 'drone')
      expect(drones).toHaveLength(count)
      expect(drones.reduce((n, w) => n + w.shotDmg!, 0)).toBe(droneDmg)
      expect(drones[0]).toMatchObject({ fixedType: 'kinetic', hitRate: .89, maxRangeM: 6000, foeDroneRangeBonusPct: .5 })
      expect(unit.foeHatchery).toEqual({ cycleMs: cycle, stock, fleet: true })
      expect(unit.foeChargeMul).toBe(charge)
    }
  })
  function acidWorld(distance: number, kill = false) {
    const { state } = alienFixture(ctx, 'laser')
    const ship = ctx.foeShips!.get('foe-alien-acid-burster')!
    const card: AnomalyDef = { ...ctx.anomalies.get('alien-vanguard')!, id: 'acid-test', waves: undefined, ships: [{ ship }] }
    const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
    const battle = startBattleFor(state, local, state.shipId, card.id, 0, distance)!
    battle.distanceM = distance
    const acid = Object.values(battle.units).find(u => u.side === 'foe')!
    if (kill) {
      acid.hp = { s: 0, a: 0, h: 1 }
      // 本例隔离炮火致死触发，开场装填另有专项。
      battle.units.player!.weapons = battle.units.player!.weapons.map(() => 0)
    }
    else battle.units.player!.weapons = battle.units.player!.weapons.map(() => 100000)
    state.gameMs = 100
    advanceBattleFor(state, local, battle, state.shipId, card.id)
    return battle
  }
  it('真推进主动攻击自毁，动能爆发和腐蚀实际结算', () => {
    const battle = acidWorld(250)
    expect(Object.values(battle.acidBursts ?? {}).map(r => r.cause)).toEqual(['attack'])
    expect(battle.stats.foeShots).toBe(1)
    expect(battle.fx.some(fx => fx.tag === 'foe-0' && fx.type === 'kinetic')).toBe(true)
    expect(battle.acidBursts?.['foe-0']?.resolved).toBe(true)
    expect(battle.alienCorrosion).toBe(.15)
  })
  it('真炮火近距击杀触发、远距击杀不触发', () => {
    expect(Object.values(acidWorld(275, true).acidBursts ?? {}).map(r => r.cause)).toEqual(['killed'])
    expect(acidWorld(1000, true).alienCorrosion).toBeUndefined()
  })
  it('溢火链击杀爆虫也走唯一死亡入口', () => {
    const battle = acidWorld(500)
    const ship = ctx.foeShips!.get('foe-alien-acid-burster')!
    const specs = createFoeSpecs({ ...ctx.anomalies.get('alien-vanguard')!, waves: undefined, ships: [{ ship, count: 2 }] }, ctx.balance.battle)
    const extra = specs[1]!
    battle.units[extra.tag] = { tag: extra.tag, side: 'foe', name: extra.name, hp: { s: 0, a: 0, h: 1 }, weapons: [0] }
    battle.distanceM = 300
    carryVolleyOverflow(battle, specs, specs[0]!.tag, 'plasma', 500, { s: 0, a: 0, h: 1 })
    expect(battle.acidBursts?.[extra.tag]?.cause).toBe('killed')
  })
  it('实际孵化推进补回原槽位，不放大机群数量', () => {
    const { state } = alienFixture(ctx, 'heavy')
    const ship = ctx.foeShips!.get('foe-alien-hiveback')!
    const card = { ...ctx.anomalies.get('alien-main')!, id: 'hatchery-test', waves: undefined, ships: [{ ship, firepowerAnchor: 228 }] }
    const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
    const battle = startBattleFor(state, local, state.shipId, card.id, 0, 10000)!
    const pool = battle.foeDronePools!['foe-0']![0]!
    pool.alive = false; pool.s = pool.a = pool.h = 0
    for (let time = 100; time <= 20300; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, local, battle, state.shipId, card.id)
      if (time < 20000) expect(battle.foeHatcheries?.['foe-0']?.revived ?? 0).toBe(0)
    }
    expect(battle.foeHatcheries?.['foe-0']?.revived).toBe(1)
    expect(battle.foeHatcheries?.['foe-0']?.left).toBe(31)
    expect(battle.foeDronePools!['foe-0']).toHaveLength(8)
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))?.foeHatcheries).toEqual(battle.foeHatcheries)
  })
  it('后续波工虫建立护理账本并只护理当前波', () => {
    const { state } = alienFixture(ctx, 'heavy')
    const battle = startBattleFor(state, ctx, state.shipId, 'alien-escort', 0, 5000)!
    expect(battle.foeRepair).toBeUndefined()
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    let damaged = false
    for (let time = 100; time <= 10000; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, ctx, battle, state.shipId, 'alien-escort')
      if (battle.waveIdx === 1 && !damaged) {
        const target = Object.values(battle.units).find(u => u.foeShipId === 'foe-alien-spore-hive')!
        target.hp.a *= .5
        battle.units.player!.weapons = battle.units.player!.weapons.map(() => 100000)
        damaged = true
      }
    }
    expect(battle.waveIdx).toBe(1)
    expect(battle.foeRepair?.pulses).toBeGreaterThan(0)
    expect(battle.foeRepair?.healed).toBeGreaterThan(0)
    for (const [tag, unit] of Object.entries(battle.units)) if (unit.side === 'foe' && !tag.startsWith('w1-')) expect(unit.hp).toEqual({ s: 0, a: 0, h: 0 })
  })
  it('巢母残血继承、死亡事实发本族黑匣且只发一次', () => {
    const { state, ships } = alienFixture(ctx, 'heavy', 611, 4)
    state.weekendEvent = { seq: 81, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: [], contributed: { 'galaxy-kor': 1 }, flagshipAtWallMs: now, flagshipHpMax: 150000, flagshipHpDone: 149000 }
    const battle = weekendStartFlagshipBattle(state, ctx, now, ships)!
    expect(battle.foeOverride?.bossShipId).toBe('foe-alien-broodmother')
    expect(battle.foeOverride?.bossHpLayers).toEqual({ s: 0, a: 0, h: 1000 })
    expect(battle.foeOverride?.bossMaxLayers).toEqual({ s: 30000, a: 82500, h: 37500 })
    battle.waveIdx = 3
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, 'alien-broodmother')
    expect(Object.values(battle.units).find(u => u.foeShipId === 'foe-alien-broodmother')?.hpMax?.h).toBeCloseTo(1000, 8)
    for (let time = 200; time <= 60_000 && !battle.bossDownAtMs; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, ctx, battle, state.shipId, 'alien-broodmother')
    }
    expect(battle.bossDownAtMs).toBeDefined()
    weekendApplyBattleOutcome(state, ctx, 'alien-broodmother', true, now, battle, { kind: 'flagship', galaxyId: 'galaxy-kor' })
    expect(state.warehouse.items['blackbox-c']).toBe(1)
    weekendApplyBattleOutcome(state, ctx, 'alien-broodmother', true, now, battle, { kind: 'flagship', galaxyId: 'galaxy-kor' })
    expect(state.warehouse.items['blackbox-c']).toBe(1)
    expect(materialGroupIdsOf('blackbox-c')).toContain('blackbox-h')
  })
  it('结束后C入侵残骸仍独立归类，普通无势力或核心', () => {
    const { state } = alienFixture(ctx)
    injectWeekendWreck(state, 'galaxy-redring', 40, 'C')
    const wreck = pullOneWreck(state, ctx, 'galaxy-redring', 0)!
    expect(wreck.itemId).toBe('wreck-c-inv')
    const ordinary = recycleProfileOf(ctx, 'wreck-c-inv')!
    expect(ordinary.lairGear).toBeUndefined()
    expect(ordinary.theme.modules).toEqual(['mod-armor-plate-2'])
    expect(recycleProfileOf(ctx, 'wreck-rare-c-inv')!.lairGear).toEqual(['mod-lair-armor-c', 'mod-lair-dc-c', 'mod-lair-laser-c'])
    for (let i = 0; i < 100; i++) expect(rollRecycleCoreGain('wreck-rare-c-inv', i)).toBeUndefined()
    expect(WRECK_GROUP_BY_KEY.get('c-wh')?.members).not.toContain('alien-main')
  })
  it('C独立卡同星系板面去重，旗舰入口用真T5', () => {
    const { state } = alienFixture(ctx)
    state.weekendEvent = { seq: 81, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: {} }
    const card = ctx.anomalies.get('ano-redring-raiders')!
    const rows = weekendBountyCardsOf(state, ctx, [card, { ...card, id: 'other' }], 'galaxy-redring', now)
    expect(weekendBoardRowsOf(rows, () => true)).toHaveLength(1)
    state.weekendEvent.contributed = { 'galaxy-kor': 1, 'galaxy-redring': 1 }
    expect(weekendFlagshipSpecOf(state, ctx, now)?.cardId).toBe('alien-broodmother')
  })
})
