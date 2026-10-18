import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { activeFoeSpecsOf, advanceBattleFor, applyFoeOverride, createPlayerSpec, startBattleFor } from '../src/combat'
import { foeDesiredRange, foeStrengthOf, foeThreatOfAnomaly } from '../src/foeSpecs'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { ENEMY_FIELDS } from '../../../tools/data-editor-enemy-schema'
import { enemyEnginePreview } from '../../../tools/data-editor-enemy-preview'
import type { AnomalyDef, SimContext } from '../src/types'
import shipParameters from '../../data/src/static/foeShips.json'
import fleetParameters from '../../data/src/static/invasionFleets.json'

const ctx = buildSimContext(), bal = ctx.balance.battle
const newIds = ['foe-d-invasion-cruiser', 'foe-d-invasion-bastion', 'foe-d-invasion-oathkeeper', 'foe-d-invasion-eternal-tomb']
const legacyRanges = new Map([['foe-d-longship', 1062], ['foe-d-stasis', 2062], ['foe-d-throne', 1400]])
const cardIds = ['gravekeeper-drift', 'gravekeeper-line', 'gravekeeper-main', 'gravekeeper-flagship'] as const

describe('守墓旗舰末波与新舰100米近界', () => {
  it('静态参数只改四型近界和旗舰标签，不调血量、火力、经济档或其他卡', () => {
    const originalShips = JSON.parse(execFileSync('git', ['show', 'c2d777a8:packages/data/src/static/foeShips.json'], { encoding: 'utf8' })) as typeof shipParameters
    for (const row of originalShips.groups.parameters) if (newIds.includes(row.id)) row.rangeMinM = 100
    Object.assign(originalShips.groups.parameters.find(row => row.id === 'foe-d-invasion-eternal-tomb')!, { split_s: .3, split_a: .4, split_h: .3 })
    expect(shipParameters).toEqual(originalShips)
    const originalFleets = JSON.parse(execFileSync('git', ['show', 'c2d777a8:packages/data/src/static/invasionFleets.json'], { encoding: 'utf8' })) as typeof fleetParameters
    originalFleets.groups.parameters.find(row => row.id === 'gravekeeper-flagship')!.threat = 191
    expect(fleetParameters).toEqual(originalFleets)
  })

  it('末波为永陵/守誓/碑卫/碑卫，其他三波原编成及全部倍率保留', () => {
    const card = ctx.anomalies.get('gravekeeper-flagship')!
    expect(card.waves!.map(w => w.units)).toEqual([3, 3, 2, 4])
    expect(card.waves!.map((_, wave) => activeFoeSpecsOf(card, bal, wave).map(f => f.name))).toEqual([
      ['巡陵级', '巡陵级', '巡陵级'], ['守墓王座舰', '静滞卫舰', '静滞卫舰'],
      ['守誓级', '守墓王座舰'], ['永陵级', '守誓级', '碑卫级', '碑卫级'],
    ])
    for (const slot of card.ships!) {
      expect(slot.hpMul).toBe(1.759)
      expect(slot.dmgMul).toBe(1.759)
      expect(slot.speedMul).toBe(1.2)
      expect(slot.shieldResist).toEqual({ kinetic: .3 })
    }
    expect(card.threat).toBe(191)
    expect(foeThreatOfAnomaly(card, 10, bal)).toBe(191)
    expect(foeStrengthOf(card, bal).hp).toBe(134297)
    expect(foeStrengthOf(card, bal).dps).toBeCloseTo(543.0909090909091, 8)
  })

  it.each(cardIds)('%s新舰所有波次均为100米，旧长舰/静滞/王座近界不改', id => {
    const card = ctx.anomalies.get(id)!
    for (let wave = 0; wave < card.waves!.length; wave++) {
      for (const f of activeFoeSpecsOf(card, bal, wave)) {
        const near = newIds.includes(f.foeShipId!) ? 100 : legacyRanges.get(f.foeShipId!)!
        expect(near).toBeDefined()
        expect(f.foeRangeBand!.min).toBe(near)
        expect(f.weapons[0]!.minRangeM).toBe(near)
      }
    }
  })

  it.each([
    ['gravekeeper-drift', [2355, 3324]], ['gravekeeper-line', [2355, 3318]],
    ['gravekeeper-main', [3318, 3324, 7155]], ['gravekeeper-flagship', [2355, 4326, 7155, 5435]],
  ] as const)('%s按原公式自然得到各波期望，不新增钉值', (id, distances) => {
    const card = ctx.anomalies.get(id)!
    const state = createInitialState({ nowWallMs: 0 })
    const me = createPlayerSpec(state, ctx, state.shipId)!
    expect(card.ships!.every(slot => slot.desireRangeM === undefined)).toBe(true)
    expect(card.waves!.map((_, wave) => foeDesiredRange(me, activeFoeSpecsOf(card, bal, wave), bal))).toEqual(distances)
  })

  it.each(newIds)('%s真实100米正常开火、99米仍开火但受到近盲0.3惩罚', id => {
    const ship = ctx.foeShips!.get(id)!
    const card: AnomalyDef = { ...ctx.anomalies.get('gravekeeper-flagship')!, id: 'new-near-test', waves: undefined, ships: [{ ship }] }
    const pilot = { ...ctx.ships.get('sh-thresher')!, shieldHp: 0, armorHp: 0, hullHp: 1e9, hullResist: {} }
    const local: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card), ships: new Map(ctx.ships).set(pilot.id, pilot) }
    const damage = (distanceM: number) => {
      const state = createInitialState({ nowWallMs: 0, seed: 19 })
      state.shipId = addShipToFleet(state, pilot.id)
      const battle = startBattleFor(state, local, state.shipId, card.id, 0, distanceM)!
      for (const unit of Object.values(battle.units)) { delete unit.enteredAtMs; if (unit.side === 'me') unit.weapons.fill(1e9) }
      state.gameMs = 10
      advanceBattleFor(state, local, battle, state.shipId, card.id, null, undefined, undefined, { simulation: { distanceM, layer: 'h' } })
      expect(battle.stats.foeShots).toBe(ship.gunCount)
      return battle.meVolleyDmg!.player!
    }
    const full = damage(100)
    expect(full).toBeGreaterThan(0)
    const weapon = activeFoeSpecsOf(card, bal, 0)[0]!.weapons[0]!
    const group = weapon.shotDmg!
    const penalizedGroup = Math.ceil(group * .3)
    expect(damage(99)).toBeCloseTo(penalizedGroup, 8)
  })

  it('真实旗舰入口读191和新末波，共享池仍绝对30万，残池分层不变', () => {
    const now = new Date(2026, 9, 16, 20).getTime()
    const state = createInitialState({ nowWallMs: now, seed: 11 })
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standings.dsi = 100
    state.standingsEarned = { dsi: 100 }
    state.weekendEvent = { seq: 916, family: 'D', coreId: 'galaxy-maw', peripheryIds: [], startedAtWallMs: now,
      contributed: { 'galaxy-maw': 1 }, flagshipHpMax: 300000, flagshipHpDone: 80000 }
    const battle = weekendStartFlagshipBattle(state, ctx, now, [state.shipId])!
    expect(battle.foeOverride!.threat).toBe(191)
    expect(battle.foeOverride!.bossHp).toBe(220000)
    expect(battle.foeOverride!.bossMaxLayers).toEqual({ s: 90000, a: 120000, h: 90000 })
    const card = applyFoeOverride(ctx.anomalies.get('gravekeeper-flagship')!, battle.foeOverride)
    const specs = activeFoeSpecsOf(card, bal, 3)
    expect(specs.map(f => f.name)).toEqual(['永陵级', '守誓级', '碑卫级', '碑卫级'])
    expect(specs[0]!.hp).toEqual({ s: 10000, a: 120000, h: 90000 })
    expect(specs[0]!.foeReviveEscort).toEqual({ everyMs: 60000, all: true })
    expect(specs[1]!.foeRebirthProtocol).toBeDefined()
    expect(specs.slice(1).every(f => f.resists.armor!.kinetic === .75 && f.resists.hull!.kinetic === .75)).toBe(true)
  })

  it('编辑器来源条目与真实引擎预览同步新编成，四型近界来源也正确', () => {
    const meta = ENEMY_FIELDS.invasionFleets.find(row => row.id === 'gravekeeper-flagship')!
    expect(meta.entries!.slice(5).map(row => row.id)).toEqual(['foe-d-invasion-eternal-tomb', 'foe-d-invasion-oathkeeper', 'foe-d-invasion-bastion'])
    expect(meta.fields.find(f => f.key === 'threat')!.expression).toBe('191')
    for (const id of newIds) {
      const source = ENEMY_FIELDS.foeShips.find(row => row.id === id)!
      expect(source.fields.find(f => f.key === 'rangeMinM')!.expression).toBe('100')
      expect(source.references!.some(r => r.id === 'gravekeeper-flagship')).toBe(true)
    }
    const preview = enemyEnginePreview({ table: 'invasionFleets', id: 'gravekeeper-flagship', mode: 'flagship', depth: 1, role: 'ordinary' })
    expect(preview.rows.filter(row => row.wave === 4).map(row => [row.name, row.units])).toEqual([['永陵级', 1], ['守誓级', 1], ['碑卫级', 2]])
    expect(preview.rows.filter(row => row.wave === 4).every(row => row.range.startsWith('100-'))).toBe(true)
  })
})
