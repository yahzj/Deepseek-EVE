import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule } from '../src/equipment'
import { advanceBattleFor, applyDamage, beamPowerFactor, createPlayerSpec } from '../src/combat'
import { advanceFittingRange, createFittingRange, fittingRangeStats, RANGE_DURATION_MS } from '../src/fittingRange'

const ctx = buildSimContext()
function fixture(high = ['mod-laser-3'], drones = false) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const leader = addShipToFleet(state, 'sh-megalodon')
  const uid = addShipToFleet(state, 'sh-wh-e-carrier')
  state.shipId = leader
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  for (const id of high) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(fitModule(state, id, ctx, { shipId: uid }).ok, id).toBe(true)
  }
  state.fleet[uid]!.ammoPref = { plasma: 'ammo-plasma-3', explosive: 'ammo-explosive-3' }
  if (drones) state.fleet[uid]!.droneLoad = { 'drone-jawclaw': 3 }
  state.fleet[uid]!.armorPct = .6
  state.fleet[uid]!.durability = .8
  state.fleet[uid]!.cargo = { 'min-tritanium': 20 }
  state.skills.trained['gunnery'] = 3
  state.mining.active = true
  const range = createFittingRange(state, ctx, uid, '靶机')!
  expect(range).not.toBeNull()
  return { state, uid, leader, range }
}
function run(range: NonNullable<ReturnType<typeof createFittingRange>>, ms = RANGE_DURATION_MS) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) advanceFittingRange(range, Math.min(100, ms - elapsed))
  return fittingRangeStats(range)
}

describe('隔离装配靶场', () => {
  it('使用非主控装配目标，复制技能/插件/战损/弹药，运行和重置不碰来源或共享内容', () => {
    const { state, uid, range } = fixture(['mod-alien-acid-launcher'], true)
    state.fleet[uid]!.plugs = ['mod-plug-turret-1']
    const before = structuredClone(state), balance = structuredClone(ctx.balance)
    const second = createFittingRange(state, ctx, uid, '靶机')!
    expect(second.state.shipId).toBe(uid)
    expect(Object.keys(second.state.fleet)).toEqual([uid])
    expect(second.state.skills).toEqual(state.skills)
    expect(second.state.fleet[uid]).toEqual(state.fleet[uid])
    expect(second.state.mining.active).toBe(false)
    expect(second.battle.ammoIds!.explosive).toBe('ammo-explosive-3')
    expect(createPlayerSpec(second.state, second.ctx, uid)!.weapons).toEqual(createPlayerSpec(state, ctx, uid)!.weapons)
    run(range)
    run(second)
    expect(state).toEqual(before)
    expect(ctx.balance).toEqual(balance)
    expect(second.battle.ended).toBeNull()
    expect(second.battle.stats.foeShots).toBe(0)
    expect(second.battle.stats.foeHits).toBe(0)
    expect(second.state.wallet.isk).toBe(createInitialState({ nowWallMs: 0 }).wallet.isk)
    expect(second.state.expedition.phase).toBe('battle')
    expect(second.ctx.anomalies.get('fitting-range-target')).toMatchObject({ rewardIsk: 0, standingGain: 0, loot: [] })
  })
  it('包含首次装填等待，暂停冻结，满60秒停止，重建清零且无法开启不存在的船', () => {
    const { state, uid, range } = fixture()
    expect(fittingRangeStats(range)).toMatchObject({ elapsedMs: 0, damage: 0, shots: 0, dps: 0 })
    advanceFittingRange(range, 10)
    expect(range.battle.stats.meShots).toBe(0)
    range.paused = true
    const before = structuredClone(range.state)
    advanceFittingRange(range, 5000)
    expect(range.state).toEqual(before)
    range.paused = false
    advanceFittingRange(range, NaN)
    advanceFittingRange(range, -100)
    const stats = run(range)
    expect(stats.elapsedMs).toBe(60000)
    expect(stats.damage).toBeGreaterThan(0)
    expect(stats.dps).toBeCloseTo(stats.damage / 60)
    expect(range.paused).toBe(true)
    advanceFittingRange(range, 1000)
    expect(fittingRangeStats(range)).toEqual(stats)
    expect(fittingRangeStats(createFittingRange(state, ctx, uid, '靶机')!).shots).toBe(0)
    expect(createFittingRange(state, ctx, 'missing', '靶机')).toBeNull()
  })
  it.each(['s', 'a', 'h'] as const)('零抗性%s层保留真实激光衰减与层克制，逐武器账与总伤害一致', layer => {
    const { range } = fixture()
    range.layer = layer
    const weapon = createPlayerSpec(range.state, range.ctx, range.uid)!.weapons.find(w => w.moduleId === 'mod-laser-3')!
    const raw = Math.max(1, Math.round(weapon.shotDmg! * beamPowerFactor(5000, weapon)))
    const expected = applyDamage({ s: layer === 's' ? 1e12 : 0, a: layer === 'a' ? 1e12 : 0, h: layer === 'h' ? 1e12 : 0 }, {}, raw, 'plasma').dealt
    const stats = run(range)
    expect(stats.hits).toBe(stats.shots)
    expect(stats.damage).toBeCloseTo(stats.shots * expected, 4)
    expect(stats.weapons.reduce((sum, row) => sum + row.damage, 0)).toBeCloseTo(stats.damage, 4)
    expect(range.battle.units['foe-0']!.hp[layer]).toBe(10000)
  })
  it('固定距离不移动，射程外停火；距离/测试层可调整，不重置已有累计', () => {
    const { range } = fixture()
    range.distanceM = 50000
    run(range, 10000)
    expect(range.battle.distanceM).toBe(50000)
    expect(range.battle.stats.meDmg).toBe(0)
    range.distanceM = 5000
    run(range, 10000)
    const damage = range.battle.stats.meDmg
    expect(damage).toBeGreaterThan(0)
    range.layer = 'a'
    run(range, 10000)
    expect(range.battle.stats.meDmg).toBeGreaterThan(damage)
    expect(range.battle.units['foe-0']!.hp).toEqual({ s: 0, a: 10000, h: 0 })
    range.distanceM = -100
    advanceFittingRange(range, 100)
    expect(range.battle.distanceM).toBe(0)
  })
  it('墙钟不整步长仍能结束，纯货舰无虚构武器；正常炮台近盲停火', () => {
    const { range } = fixture(['mod-turret-kin-3'])
    range.distanceM = 0
    run(range, 20000)
    expect(fittingRangeStats(range).weapons.some(row => row.moduleId === 'mod-turret-kin-3')).toBe(false)
    for (let i = 0; i < 1500 && !range.paused; i++) advanceFittingRange(range, 50.37)
    expect(range.paused).toBe(true)
    expect(range.battle.lastTickGameMs).toBe(60000)
    const state = createInitialState({ nowWallMs: 0 })
    const uid = addShipToFleet(state, 'sh-bowhead')
    const noGuns = createFittingRange(state, ctx, uid, '靶机')!
    expect(noGuns).not.toBeNull()
    expect(run(noGuns).damage).toBe(0)
  })
  it('无人机按真实启动队列出击，酸蚀持续叠加，所有输出可归属且靶机不会死亡', () => {
    const { range } = fixture(['mod-alien-acid-launcher', 'mod-drone-launch-3'], true)
    range.layer = 'a'
    const before = createPlayerSpec(range.state, range.ctx, range.uid)!
    expect(before.droneLaunchGapMs).toBe(210)
    advanceFittingRange(range, 200)
    expect(range.battle.stats.meShots).toBe(0)
    const stats = run(range)
    expect(stats.weapons.filter(row => row.src === 'drone').length).toBeGreaterThan(0)
    expect(stats.weapons.filter(row => row.artId === 'drone-jawclaw')).toHaveLength(1)
    expect(stats.weapons.some(row => row.moduleId === 'mod-alien-acid-launcher' && row.damage > 0)).toBe(true)
    expect(stats.weapons.reduce((n, row) => n + row.shots, 0)).toBe(stats.shots)
    expect(stats.weapons.reduce((n, row) => n + row.hits, 0)).toBe(stats.hits)
    expect(stats.weapons.reduce((n, row) => n + row.damage, 0)).toBeCloseTo(stats.damage, 4)
    expect(range.battle.foeAcidLayers!['foe-0']!.length).toBeGreaterThan(0)
    expect(range.battle.ended).toBeNull()
  })
  it('未传模拟选项时仍执行普通伤害和距离逻辑', () => {
    const { range } = fixture()
    range.battle.distanceM = 5000
    range.state.gameMs = 20000
    advanceBattleFor(range.state, range.ctx, range.battle, range.uid, 'fitting-range-target')
    expect(range.battle.units['foe-0']!.hp.s).toBeLessThan(10000)
    expect(range.results).toEqual({})
  })
})
