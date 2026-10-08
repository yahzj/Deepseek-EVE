import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { activeFoeSpecsOf, createBattleState, createFoeSpecs, foesWithSupport, initFoeDronePools, resolveFoeRevive } from '../src/foeSpecs'
import { advanceFoeAbilityClocks, advanceFoeHatcheries, foeFleetSpeedMulOf, triggerAcidBurst } from '../src/alienCombat'
import { applyDamage } from '../src/combatMath'
import { advanceBattleFor, createPlayerSpec, pulseFoeRepair, startBattleFor } from '../src/combat'
import { cleanBattle } from '../src/saveBattleClean'
import { alienFixture } from '../../../tools/alien-invasion-fixture'

const ctx = buildSimContext()
const card = ctx.anomalies.get('alien-broodmother')!
function wave(index = 3) {
  const { state } = alienFixture(ctx, 'heavy', 611, 4)
  const foes = activeFoeSpecsOf(card, ctx.balance.battle, index)
  const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 0, 10000)
  battle.distanceM = 10000
  battle.waveIdx = index
  initFoeDronePools(battle, foes)
  return { battle, foes, state }
}
const down = (battle: ReturnType<typeof createBattleState>, tag: string) => { battle.units[tag]!.hp = { s: 0, a: 0, h: 0 } }
const lose = (battle: ReturnType<typeof createBattleState>, tag: string, index: number) => {
  Object.assign(battle.foeDronePools![tag]![index]!, { s: 0, a: 0, h: 0, alive: false })
}

describe('新波次和全队补损', () => {
  it('严格按船长波次及数量，不把加号拆成波次', () => {
    const expected = [
      ['alien-vanguard', [[['foe-alien-acid-burster', 5]], [['foe-alien-starcore-adult', 5]]]],
      ['alien-escort', [[['foe-alien-acid-burster', 4]], [['foe-alien-spore-hive', 2], ['foe-alien-brood-worker', 1]]]],
      ['alien-main', [[['foe-alien-acid-burster', 4]], [['foe-alien-hiveback', 1], ['foe-alien-spore-hive', 2], ['foe-alien-brood-worker', 2]]]],
      ['alien-broodmother', [[['foe-alien-acid-burster', 4]], [['foe-alien-maw', 1], ['foe-alien-starcore-adult', 2]], [['foe-alien-hiveback', 2], ['foe-alien-brood-worker', 1]], [['foe-alien-broodmother', 1], ['foe-alien-hiveback', 1], ['foe-alien-brood-worker', 2]]]],
    ] as const
    for (const [id, waves] of expected) {
      const entry = ctx.anomalies.get(id)!
      expect(entry.waves).toHaveLength(waves.length)
      for (let index = 0; index < waves.length; index++) {
        expect(entry.ships!.filter(slot => (slot.wave ?? 0) === index).map(slot => [slot.ship.id, slot.count])).toEqual(waves[index])
      }
    }
    expect(wave(2).foes.reduce((n, f) => n + f.weapons.filter(w => w.src === 'drone').length, 0)).toBe(16)
    expect(wave().foes.reduce((n, f) => n + f.weapons.filter(w => w.src === 'drone').length, 0)).toBe(20)
  })
  it('无限补损覆盖存活同伴，满血原槽位不耗背巢储备，不治疗活机', () => {
    const { battle, foes } = wave()
    const mother = foes[0]!, back = foes[1]!
    lose(battle, mother.tag, 0); lose(battle, back.tag, 0)
    battle.foeDronePools![back.tag]![1]!.h = 5
    advanceFoeHatcheries(battle, foes, 0)
    advanceFoeHatcheries(battle, foes, 8999)
    expect(battle.foeDronePools![back.tag]![0]!.alive).toBe(false)
    advanceFoeHatcheries(battle, foes, 9000)
    expect(battle.foeHatcheries![mother.tag]).toMatchObject({ left: 'unlimited', revived: 2 })
    expect(battle.foeHatcheries![back.tag]).toMatchObject({ left: 32, revived: 0 })
    expect(battle.foeDronePools![back.tag]![0]).toMatchObject({ alive: true, s: 6, a: 12, h: 20 })
    expect(battle.foeDronePools![back.tag]![1]!.h).toBe(5)
    expect(battle.foeDronePools![mother.tag]).toHaveLength(12)
  })
  it('无限补损同拍优先，两个背巢不重复扣；独立库存不足不透支', () => {
    const { battle, foes } = wave(2)
    for (const f of foes.slice(0, 2)) for (let i = 0; i < 8; i++) lose(battle, f.tag, i)
    advanceFoeHatcheries(battle, foes, 0)
    battle.foeHatcheries![foes[0]!.tag]!.left = 2
    battle.foeHatcheries![foes[1]!.tag]!.left = 3
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.foeHatcheries).toEqual(battle.foeHatcheries)
    advanceFoeHatcheries(loaded, foes, 12000)
    expect(Object.values(loaded.foeHatcheries!).map(l => l.left)).toEqual([0, 0])
    expect(Object.values(loaded.foeDronePools!).flat().filter(p => p.alive)).toHaveLength(5)
    expect(Object.values(loaded.foeHatcheries!).reduce((n, l) => n + l.revived, 0)).toBe(5)

    const full = wave()
    lose(full.battle, full.foes[1]!.tag, 0)
    advanceFoeHatcheries(full.battle, full.foes, 0)
    full.battle.foeHatcheries![full.foes[1]!.tag]!.nextAtMs = 9000
    advanceFoeHatcheries(full.battle, [...full.foes].reverse(), 9000)
    expect(full.battle.foeHatcheries![full.foes[1]!.tag]!.left).toBe(32)
  })
  it('载体死亡、换波和旧尸体机群不补；无限模式随档保留', () => {
    const { battle, foes } = wave()
    lose(battle, foes[1]!.tag, 0)
    advanceFoeHatcheries(battle, foes, 0)
    down(battle, foes[1]!.tag)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.foeHatcheries![foes[0]!.tag]!.left).toBe('unlimited')
    advanceFoeHatcheries(loaded, foes, 9000)
    expect(loaded.foeDronePools![foes[1]!.tag]![0]!.alive).toBe(false)
    lose(loaded, foes[0]!.tag, 0)
    advanceFoeHatcheries(loaded, [], 50000)
    expect(loaded.foeDronePools![foes[0]!.tag]![0]!.alive).toBe(false)
  })
})

describe('巢母成虫召唤与渐增机动', () => {
  it('每30秒最多召唤三架成虫，空位不足不超编，不复活工虫或背巢', () => {
    const { battle, foes, state } = wave()
    down(battle, foes[1]!.tag); down(battle, foes[2]!.tag); down(battle, foes[3]!.tag)
    battle.units['old-worker'] = { ...battle.units[foes[2]!.tag]!, tag: 'old-worker' }
    battle.foeAbilityClocks = { [foes[0]!.tag]: 29999 }
    resolveFoeRevive(state, battle, foes, ctx.balance.battle, 999999)
    expect(battle.foeReviveCount).toBeUndefined()
    battle.foeAbilityClocks[foes[0]!.tag] = 30000
    resolveFoeRevive(state, battle, foes, ctx.balance.battle, 999999)
    expect(battle.foeReviveCount).toBe(3)
    expect(foesWithSupport(battle, foes).filter(f => f.tag.startsWith('sup')).map(f => f.foeShipId)).toEqual(Array(3).fill('foe-alien-starcore-adult'))
    battle.foeAbilityClocks[foes[0]!.tag] = 60000
    resolveFoeRevive(state, battle, foes, ctx.balance.battle, 999999)
    expect(battle.foeReviveCount).toBe(3)
    battle.foeAbilityClocks[foes[0]!.tag] = 90000
    resolveFoeRevive(state, battle, foes, ctx.balance.battle, 999999)
    expect(battle.foeReviveCount).toBe(3)
    const revived = foesWithSupport(battle, foes).find(f => f.tag.startsWith('sup'))!
    down(battle, revived.tag)
    battle.foeAbilityClocks[foes[0]!.tag] = 120000
    resolveFoeRevive(state, battle, foes, ctx.balance.battle, 999999)
    expect(battle.foeReviveCount).toBe(4)
    expect(foesWithSupport(battle, foes).filter(f => f.foeShipId === 'foe-alien-starcore-adult' && battle.units[f.tag]!.hp.h > 0)).toHaveLength(3)
    expect(battle.units[foes[2]!.tag]!.hp.h).toBe(0)
  })
  it('空转不积蓄、巢母死亡不召唤，重载不重置节拍', () => {
    const { battle, foes, state } = wave()
    battle.foeAbilityClocks = { [foes[0]!.tag]: 30000 }
    resolveFoeRevive(state, battle, foes, ctx.balance.battle, 30000)
    down(battle, foes[2]!.tag)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.foeReviveAtMs).toBe(60000)
    loaded.foeAbilityClocks![foes[0]!.tag] = 59999
    resolveFoeRevive(state, loaded, foes, ctx.balance.battle, 900000)
    expect(loaded.foeReviveCount).toBeUndefined()
    down(loaded, foes[0]!.tag)
    loaded.foeAbilityClocks![foes[0]!.tag] = 60000
    resolveFoeRevive(state, loaded, foes, ctx.balance.battle, 900000)
    expect(loaded.foeReviveCount).toBeUndefined()
  })
  it.each([[0, 1], [999, 1], [1000, 1.015], [60000, 1.9], [120000, 2.8], [180000, 2.8]])('时长%s的全队倍率%s，死亡立即解除', (time, mul) => {
    const { battle, foes } = wave()
    battle.foeAbilityClocks = { [foes[0]!.tag]: time }
    expect(foeFleetSpeedMulOf(battle, foes)).toBeCloseTo(mul)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(foeFleetSpeedMulOf(loaded, foes)).toBeCloseTo(mul)
    down(loaded, foes[0]!.tag)
    expect(foeFleetSpeedMulOf(loaded, foes)).toBe(1)
  })
  it('实际入场之后才累计，演出和旧波时间不预充', () => {
    const { battle, foes } = wave()
    battle.units[foes[0]!.tag]!.enteredAtMs = 100000
    battle.foeWaveStartMs = 100000
    advanceFoeAbilityClocks(battle, foes, 100000)
    expect(battle.foeAbilityClocks![foes[0]!.tag]).toBe(0)
    battle.lastTickGameMs = 100000
    advanceFoeAbilityClocks(battle, foes, 1950)
    expect(battle.foeAbilityClocks![foes[0]!.tag]).toBe(1000)
    down(battle, foes[0]!.tag)
    advanceFoeAbilityClocks(battle, foes, 9999)
    expect(battle.foeAbilityClocks![foes[0]!.tag]).toBe(1000)
  })
  it('共享池巢母不能被护理，背巢可修；普通巢母仍走旧护理语义', () => {
    const { battle, foes } = wave()
    battle.foeOverride = { bossShipId: 'foe-alien-broodmother', bossHp: 150000 }
    battle.units[foes[0]!.tag]!.hp.a = 1
    battle.units[foes[1]!.tag]!.hp.a = 1
    const ledger = { pulses: 0, healed: 0 }
    pulseFoeRepair(battle, foes, ledger)
    expect(battle.units[foes[0]!.tag]!.hp.a).toBe(1)
    expect(battle.units[foes[1]!.tag]!.hp.a).toBeGreaterThan(1)
    delete battle.foeOverride
    battle.units[foes[1]!.tag]!.hp = { ...foes[1]!.hp }
    pulseFoeRepair(battle, foes, ledger)
    expect(battle.units[foes[0]!.tag]!.hp.a).toBeGreaterThan(1)
  })
  it('真推进末波只召唤成虫，不预积累首波时间且速度显示同源', () => {
    const { state } = alienFixture(ctx, 'heavy')
    const def = ctx.ships.get('sh-megalodon')!
    const local = { ...ctx, ships: new Map([...ctx.ships, [def.id, { ...def, shieldHp: 900000, armorHp: 900000, hullHp: 900000 }]]) }
    state.fleet[state.shipId]!.fitted = { high: [], mid: [], low: [] }
    state.gameMs = 200000
    const battle = startBattleFor(state, local, state.shipId, card.id, 0, 10000)!
    for (const [tag, unit] of Object.entries(battle.units)) if (unit.side === 'foe') delete battle.units[tag]
    battle.waveIdx = 3
    state.gameMs += 100
    advanceBattleFor(state, local, battle, state.shipId, card.id)
    const foes = activeFoeSpecsOf(card, local.balance.battle, 3)
    for (const f of foes.slice(2)) down(battle, f.tag)
    battle.units[foes[1]!.tag]!.hp.a *= .5
    const start = state.gameMs
    for (let delta = 100; delta <= 33000; delta += 100) {
      state.gameMs = start + delta
      advanceBattleFor(state, local, battle, state.shipId, card.id)
      if (delta === 30000) expect(battle.foeReviveCount).toBeUndefined()
    }
    expect(battle.foeReviveCount).toBe(2)
    expect(battle.foeAbilityClocks![foes[0]!.tag]).toBeLessThan(33000)
    for (let delta = 33100; delta <= 124000; delta += 100) {
      state.gameMs = start + delta
      advanceBattleFor(state, local, battle, state.shipId, card.id)
    }
    expect(battle.foeRepair?.healed ?? 0).toBe(0)
    expect(battle.foeReviveCount).toBe(2)
    const support = foesWithSupport(battle, foes).filter(f => f.tag.startsWith('sup'))
    expect(support.map(f => f.foeShipId)).toEqual(Array(2).fill('foe-alien-starcore-adult'))
    expect(support.every(f => (f.repairPct ?? 0) === 0)).toBe(true)
    expect(foeFleetSpeedMulOf(battle, foesWithSupport(battle, foes))).toBe(2.8)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.foeAbilityClocks).toEqual(battle.foeAbilityClocks)
    const alive = foesWithSupport(battle, foes).filter(f => battle.units[f.tag]!.hp.h > 0)
    const expected = alive.reduce((n, f) => n + f.speedMps * (battle.foeCharges?.[f.tag]?.on ? f.foeChargeMul ?? 1 : 1) * 2.8, 0) / alive.length
    expect(battle.foeSpeedMps).toBe(Math.round(expected))
  })
  it('单步离线推进与逐拍推进的巢母计时/复活/补损一致，旧无挂件不建时钟', () => {
    const { state } = alienFixture(ctx, 'heavy')
    const def = ctx.ships.get('sh-megalodon')!
    const local = { ...ctx, ships: new Map([...ctx.ships, [def.id, { ...def, shieldHp: 900000, armorHp: 900000, hullHp: 900000 }]]) }
    state.fleet[state.shipId]!.fitted = { high: [], mid: [], low: [] }
    const battle = startBattleFor(state, local, state.shipId, card.id, 0, 10000)!
    for (const [tag, unit] of Object.entries(battle.units)) if (unit.side === 'foe') delete battle.units[tag]
    battle.waveIdx = 3
    state.gameMs = 100
    advanceBattleFor(state, local, battle, state.shipId, card.id)
    const foes = activeFoeSpecsOf(card, local.balance.battle, 3)
    down(battle, foes[2]!.tag); down(battle, foes[3]!.tag)
    initFoeDronePools(battle, foes)
    lose(battle, foes[0]!.tag, 0); lose(battle, foes[1]!.tag, 0)
    const offline = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    const offlineState = structuredClone(state)
    for (let time = 200; time <= 70000; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, local, battle, state.shipId, card.id)
    }
    offlineState.gameMs = 70000
    advanceBattleFor(offlineState, local, offline, offlineState.shipId, card.id)
    expect(offline.foeAbilityClocks).toEqual(battle.foeAbilityClocks)
    expect(offline.foeReviveCount).toBe(battle.foeReviveCount)
    expect(offline.foeReviveAtMs).toBe(battle.foeReviveAtMs)
    expect(offline.foeHatcheries).toEqual(battle.foeHatcheries)
    expect(offline.units).toEqual(battle.units)
    const plain = wave(1)
    advanceFoeAbilityClocks(plain.battle, plain.foes, 5000)
    expect(plain.battle.foeAbilityClocks).toBeUndefined()
  })
})

describe('爆虫一次性动能伤害与保存', () => {
  it('建档伤害仅吃卡倍率，不生成循环炮台或乘炮口数', () => {
    for (const id of ['alien-vanguard', 'alien-escort', 'alien-main', 'alien-broodmother']) {
      const entry = ctx.anomalies.get(id)!
      const unit = createFoeSpecs(entry, ctx.balance.battle)[0]!
      expect(unit.acidBurst!.damage).toBeGreaterThan(0)
      expect(unit.weapons[0]!.shotDmg).toBe(0)
    }
  })
  it('未结算事件和已结算事件随档去重，旧记录不补打一发', () => {
    const { battle } = wave()
    const acid = { tag: 'test-acid', acidBurst: { attackRangeM: 250, deathRangeM: 300, corrosionPct: .15, damage: 300 } }
    battle.units[acid.tag] = { ...battle.units.player!, tag: acid.tag, side: 'foe' }
    battle.distanceM = 250
    triggerAcidBurst(battle, acid, 'attack', 1)
    expect(battle.alienCorrosion).toBeUndefined()
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))!.acidBursts![acid.tag]!.resolved).toBe(false)
    battle.acidBursts![acid.tag]!.resolved = true
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))!.acidBursts![acid.tag]!.resolved).toBe(true)
    delete battle.acidBursts![acid.tag]!.resolved
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))!.acidBursts![acid.tag]!.resolved).toBe(true)
  })
  it('真引擎第一发先扣血后腐蚀，重载不重打，未命中仍腐蚀', () => {
    const source = ctx.foeShips!.get('foe-alien-acid-burster')!
    const entry = { ...ctx.anomalies.get('alien-vanguard')!, id: 'acid-order', waves: undefined, ships: [{ ship: source, count: 1, dmgMul: 1 }] }
    const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [entry.id, entry]]), balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
    let hits = 0, misses = 0
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = alienFixture(local, 'heavy', seed)
      const battle = startBattleFor(state, local, state.shipId, entry.id, 0, 200)!
      battle.units.player!.hp.s = 0
      battle.units.player!.weapons = battle.units.player!.weapons.map(() => 100000)
      battle.distanceM = 200
      const spec = createPlayerSpec(state, local, state.shipId)!
      const before = { ...battle.units.player!.hp }
      const expected = applyDamage(before, spec.resists, 300, 'kinetic').hp
      state.gameMs = 100
      advanceBattleFor(state, local, battle, state.shipId, entry.id)
      const fx = battle.fx.find(f => f.side === 'foe' && f.type === 'kinetic')!
      if (fx.hit) { hits++; expect(battle.units.player!.hp).toEqual(expected) }
      else { misses++; expect(battle.units.player!.hp).toEqual(before) }
      expect(battle.alienCorrosion).toBe(.15)
      expect(battle.stats.foeShots).toBe(1)
      const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
      state.gameMs = 1000
      advanceBattleFor(state, local, loaded, state.shipId, entry.id)
      expect(loaded.stats.foeShots).toBe(1)
    }
    expect(hits).toBeGreaterThan(0)
    expect(misses).toBeGreaterThan(0)
  })
  it('同拍多爆虫共享原伤额度，近距死亡爆发也受损管免死保护', () => {
    const source = ctx.foeShips!.get('foe-alien-acid-burster')!
    const entry = { ...ctx.anomalies.get('alien-vanguard')!, id: 'acid-guard', waves: undefined, ships: [{ ship: source, count: 5, dmgMul: 20 }] }
    const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [entry.id, entry]]), balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
    const { state } = alienFixture(local, 'heavy', 611)
    state.fleet[state.shipId]!.fitted.low = ['mod-dc-3', 'mod-armor-kin-2']
    state.warehouse.items['repairkit-dc'] = 3
    const battle = startBattleFor(state, local, state.shipId, entry.id, 0, 200)!
    const spec = createPlayerSpec(state, local, state.shipId)!
    battle.units.player!.hp = { s: 0, a: 0, h: 5 }
    battle.units.player!.weapons = battle.units.player!.weapons.map(() => 100000)
    battle.distanceM = 200
    const foes = createFoeSpecs(entry, local.balance.battle)
    down(battle, foes[0]!.tag)
    triggerAcidBurst(battle, foes[0]!, 'killed', 0)
    state.gameMs = 100
    advanceBattleFor(state, local, battle, state.shipId, entry.id)
    expect(battle.acidBursts![foes[0]!.tag]!.cause).toBe('killed')
    expect(battle.stats.foeShots).toBe(5)
    expect(battle.dc!.player!.used).toBe(true)
    expect(battle.dcKitsUsed).toBe(1)
    expect(state.warehouse.items['repairkit-dc']).toBe(2)
    expect(battle.units.player!.hp.h).toBeGreaterThanOrEqual(1)
    expect(battle.meVolleyDmg!.player).toBeLessThanOrEqual((spec.hp.s + spec.hp.a + spec.hp.h) * .8)
    expect(Object.values(battle.acidBursts!).every(event => event.resolved)).toBe(true)
  })
})
