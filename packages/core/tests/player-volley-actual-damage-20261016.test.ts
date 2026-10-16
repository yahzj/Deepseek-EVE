import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { applyDamage } from '../src/combatMath'
import type { Hp3 } from '../src/combatMath'
import { activeFoeSpecsOf, advanceBattleFor, applyFoeShot, applyPlayerUnitDamage, createBattleState, createPlayerSpec, startBattleFor } from '../src/combat'
import type { UnitSpec, WeaponSpec } from '../src/combat'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'
import { FOE_MOUNT_IDS } from '../src/foeMounts'
import { anomaly, makeTestCtx, ship } from './helpers'

const ctx = buildSimContext()
const sum = (hp: Hp3): number => hp.s + hp.a + hp.h

function world(hp: Hp3 = { s: 0, a: 0, h: 1000 }, resists: UnitSpec['resists'] = {}) {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const sid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = sid
  const spec = { ...createPlayerSpec(state, ctx, sid)!, hp, resists }
  const foe = { ...spec, tag: 'foe-0', side: 'foe' as const }
  const battle = createBattleState(spec, [foe], 0, 5000)
  const rt = battle.units.player!
  rt.hp = { ...hp }
  rt.hpMax = { ...hp }
  const hit = (raw: number, type: 'kinetic' | 'explosive' | 'plasma' = 'plasma', apply?: (raw: number) => Hp3) =>
    applyPlayerUnitDamage(state, battle, 'player', spec, raw, type, apply)
  return { state, sid, spec, battle, rt, hit }
}

describe('玩家齐射保护按实际掉血结算', () => {
  it.each([.5, .75, .9])('结构抗性%s先结算，不把80%%当作原伤上限', resist => {
    const w = world(undefined, { hull: { plasma: resist } })
    const dealt = w.hit(1000)
    expect(dealt).toBeCloseTo(1000 * (1 - resist), 8)
    expect(w.battle.meVolleyDmg!.player).toBeCloseTo(dealt, 8)
    expect(w.rt.hp.h).toBeCloseTo(1000 - dealt, 8)
  })

  it('克制增伤也先结算，满盾舰仍至少留下20%总血', () => {
    const w = world({ s: 1000, a: 0, h: 0 })
    expect(w.hit(600, 'kinetic')).toBe(800)
    expect(w.rt.hp).toEqual({ s: 200, a: 0, h: 0 })
    expect(w.battle.meVolleyDmg!.player).toBe(800)
  })

  it('负抗性放大的实伤受限，不会因原伤未触顶而超过80%', () => {
    const w = world(undefined, { hull: { plasma: -.5 } })
    expect(w.hit(700)).toBe(800)
    expect(w.rt.hp.h).toBe(200)
  })

  it('同一窗口逐发累加实伤，治疗不返还额度，清空窗口才恢复', () => {
    const w = world(undefined, { hull: { plasma: .5 } })
    expect(w.hit(1000)).toBe(500)
    w.rt.hp.h = 1000
    expect(w.hit(1000)).toBe(300)
    expect(w.rt.hp.h).toBe(700)
    expect(w.hit(1000)).toBe(0)
    w.battle.meVolleyDmg = {}
    expect(w.hit(1000)).toBe(500)
    expect(w.battle.meVolleyDmg!.player).toBe(500)
  })

  it('分舰计账，主控用尽后僚舰仍有自己的额度', () => {
    const w = world()
    w.battle.units['ally-1'] = { ...w.rt, tag: 'ally-1', hp: { ...w.rt.hp }, hpMax: { ...w.rt.hpMax! } }
    expect(w.hit(2000)).toBe(800)
    expect(applyPlayerUnitDamage(w.state, w.battle, 'ally-1', { ...w.spec, tag: 'ally-1' }, 2000, 'plasma')).toBe(800)
    expect(w.battle.meVolleyDmg).toEqual({ player: 800, 'ally-1': 800 })
  })

  it('跨层先扣护盾再扣装甲，额度不会按原伤落点反复重算', () => {
    const w = world({ s: 100, a: 200, h: 700 }, { shield: { plasma: .5 }, armor: { plasma: .75 }, hull: { plasma: .9 } })
    expect(w.hit(1e6)).toBe(800)
    expect(w.rt.hp).toEqual({ s: 0, a: 0, h: 200 })
  })

  it('未触顶保留原攻击落点与混伤结果，不重复套用抗性', () => {
    const w = world({ s: 950, a: 1000, h: 1000 }, { shield: { kinetic: .2 }, armor: { kinetic: .4 } })
    const before = { ...w.rt.hp }
    const expected = applyDamage(before, w.spec.resists, 1000, 'kinetic')
    expect(w.hit(1000, 'kinetic')).toBeCloseTo(expected.dealt, 8)
    expect(w.rt.hp).toEqual(expected.hp)
    const weapon = { gunCount: 8, shotsByType: { plasma: 60, kinetic: 40 } } as WeaponSpec
    const hp = { ...w.rt.hp }
    const next = applyFoeShot(hp, w.spec.resists, weapon, 500, 'plasma')
    expect(w.hit(500, 'plasma', raw => applyFoeShot(hp, w.spec.resists, weapon, raw, 'plasma'))).toBeCloseTo(sum(hp) - sum(next), 8)
    expect(w.rt.hp).toEqual(next)
  })

  it('混伤跨层超过额度时仍按实伤截取，不把余量换算成第二份原伤', () => {
    const w = world({ s: 100, a: 200, h: 700 }, { shield: { plasma: .5, kinetic: .75 }, armor: { plasma: .2, kinetic: .5 } })
    const weapon = { gunCount: 8, shotsByType: { plasma: 60, kinetic: 40 } } as WeaponSpec
    expect(w.hit(10000, 'plasma', raw => applyFoeShot(w.rt.hp, w.spec.resists, weapon, raw, 'plasma'))).toBe(800)
    expect(w.rt.hp).toEqual({ s: 0, a: 0, h: 200 })
  })

  it('额外破盾乘区在保护之前生效，破盾增伤不能穿透80%实际承伤限制', () => {
    const w = world({ s: 1000, a: 0, h: 0 })
    expect(w.hit(300, 'kinetic', raw => applyDamage(w.rt.hp, w.spec.resists, raw, 'kinetic', 2).hp)).toBe(800)
    expect(w.rt.hp.s).toBe(200)
  })

  it('低于额度的残血可被击沉，只记录实际剩余血量而不是溢出攻击', () => {
    const w = world()
    w.rt.hp.h = 100
    expect(w.hit(10000)).toBe(100)
    expect(w.rt.hp.h).toBe(0)
    expect(w.battle.meVolleyDmg!.player).toBe(100)
  })

  it.each(['mod-dc-3', 'mod-gravekeeper-rebirth'])('%s保底后才记账，窗口内保护与一次组件消耗保留', id => {
    const w = world()
    w.spec.hullSaveKit = 'repairkit-dc'
    w.spec.rebirthRepair = ctx.modules.get(id)!.rebirthRepair
    w.state.warehouse.items['repairkit-dc'] = 2
    w.rt.hp.h = 100
    expect(w.hit(1e6)).toBeCloseTo(99, 6)
    expect(w.rt.hp.h).toBeGreaterThanOrEqual(1)
    const used = w.battle.meVolleyDmg!.player!
    expect(used).toBeCloseTo(99, 6)
    expect(w.hit(1e6)).toBeCloseTo(0, 6)
    expect(w.battle.meVolleyDmg!.player).toBeCloseTo(used, 6)
    expect(w.state.warehouse.items['repairkit-dc']).toBe(1)
    expect(w.battle.dcKitsUsed).toBe(1)
    expect(!!w.battle.meRebirths?.player).toBe(id === 'mod-gravekeeper-rebirth')
    w.battle.lastTickGameMs = 1001
    w.battle.meVolleyDmg = {}
    expect(w.hit(1e6)).toBeCloseTo(1, 6)
    expect(w.rt.hp.h).toBe(0)
    expect(w.state.warehouse.items['repairkit-dc']).toBe(1)
  })

  it('满血被80%保护挡住时不提前消耗损管；无组件仍可致死', () => {
    const w = world()
    w.spec.hullSaveKit = 'repairkit-dc'
    w.state.warehouse.items['repairkit-dc'] = 2
    expect(w.hit(1e6)).toBe(800)
    expect(w.battle.dcKitsUsed ?? 0).toBe(0)
    expect(w.state.warehouse.items['repairkit-dc']).toBe(2)
    w.battle.meVolleyDmg = {}
    w.state.warehouse.items['repairkit-dc'] = 0
    expect(w.hit(1e6)).toBe(200)
    expect(w.rt.hp.h).toBe(0)
  })

  it('原生恢复不计入敌伤额度，零伤与失效目标不写入账本', () => {
    const w = world()
    expect(w.hit(0)).toBe(0)
    expect(applyPlayerUnitDamage(w.state, w.battle, 'missing', w.spec, 100, 'plasma')).toBe(0)
    expect(w.battle.meVolleyDmg).toBeUndefined()
  })

  it.each(['kinetic', 'explosive', 'plasma'] as const)('%s多种血层与抗性组合均遵守实际上限，未触顶结果不变', type => {
    for (const hp of [{ s: 13, a: 37, h: 50 }, { s: 99, a: 0, h: 1 }, { s: 0, a: 99, h: 1 }, { s: 0, a: 0, h: 100 }]) {
      for (const resist of [-.9, 0, .5, .9]) for (const raw of [1, 19.5, 80, 100, 1000, 1e9]) {
        const resists = { shield: { [type]: resist }, armor: { [type]: resist / 2 }, hull: { [type]: resist } }
        const w = world(hp, resists)
        const original = applyDamage(hp, resists, raw, type)
        const dealt = w.hit(raw, type)
        expect(dealt).toBeCloseTo(Math.min(original.dealt, sum(hp) * .8), 7)
        expect(sum(hp) - sum(w.rt.hp)).toBeCloseTo(dealt, 7)
        if (original.dealt <= sum(hp) * .8) expect(w.rt.hp).toEqual(original.hp)
        for (const key of ['s', 'a', 'h'] as const) expect(w.rt.hp[key]).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

function engineWorld(kind: 'beam' | 'gun' | 'drone' | 'acid', raw: number, shieldOnly = false) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const enemy: FoeShipDef = { id: 'volley-test-foe', name: '承伤测试舰', family: 'A', hullClassTier: 1,
    hp: 1e9, split: { s: 0, a: 0, h: 1 }, speedRatio: 0, tactic: 'orbit', shotDmg: raw,
    rangeMinM: 0, rangeMaxM: 100000, reloadMs: 100000, hitRate: 1, falloff: 1,
    dmgMix: kind === 'gun' ? { kinetic: 1 } : { plasma: 1 }, gunCount: 4 }
  if (kind === 'drone') enemy.drones = [{ count: 1, drone: { id: 'volley-test-drone', name: '承伤测试机', family: 'A', role: 'combat',
    defense: { shieldHp: 10, armorHp: 10, hullHp: 10, evasion: 0 }, dmg: raw,
    damageType: 'plasma', hitRate: 1, falloff: 1, maxRangeM: 100000, reloadMs: 100000 } }]
  if (kind === 'acid') {
    enemy.acidBurst = { attackRangeM: 100000, deathRangeM: 100000, damage: raw, hitRate: 1, corrosionPct: .15 }
    enemy.mounts = [FOE_MOUNT_IDS.acidShield]
  }
  const card = { ...anomaly('volley-test-card', 'galaxy-hub'), ships: [{ ship: enemy }] }
  const hull = { ...ship('sandcat', { shieldHp: shieldOnly ? 1000 : 0, armorHp: 0, hullHp: shieldOnly ? 0 : 1000, maxSpeedMps: 0, evasion: 0 }),
    hullResist: { plasma: .9, kinetic: .9 } }
  const base = makeTestCtx({ ships: [hull], anomalies: [card] })
  const context: SimContext = { ...base, balance: { ...base.balance, battle: { ...base.balance.battle,
    hitMin: 1, hitMax: 1, shieldRegenPerSec: 0, cannotEngageMs: 1e9 } } }
  const battle = startBattleFor(state, context, state.shipId, card.id, 0, 1000)!
  const foe = activeFoeSpecsOf(card, context.balance.battle, 0)[0]!
  for (const rt of Object.values(battle.units)) { delete rt.enteredAtMs; rt.weapons.fill(1e9) }
  battle.units[foe.tag]!.weapons[kind === 'drone' ? 1 : 0] = 0
  const tick = (t: number) => {
    state.gameMs = t
    advanceBattleFor(state, context, battle, state.shipId, card.id, null, undefined, undefined, { simulation: { distanceM: 1000, layer: 'h' } })
  }
  return { state, context, battle, tick }
}

describe('实际承伤的真引擎路径', () => {
  it.each(['beam', 'gun', 'drone', 'acid'] as const)('%s原伤5000经90%抗性后实收500，飘字与账本一致', kind => {
    const w = engineWorld(kind, 5000)
    w.tick(10)
    expect(w.battle.units.player!.hp.h).toBeCloseTo(500, 7)
    expect(w.battle.meVolleyDmg!.player).toBeCloseTo(500, 7)
    expect(w.battle.fx.filter(fx => fx.side === 'foe').reduce((n, fx) => n + (fx.dmg ?? 0), 0)).toBeCloseTo(500, 7)
    w.tick(110)
    expect(w.battle.meVolleyDmg).toEqual({})
  })

  it.each(['beam', 'gun', 'drone', 'acid'] as const)('%s更高原伤只在实际掉血800处封顶', kind => {
    const w = engineWorld(kind, 10000)
    w.tick(10)
    expect(w.battle.units.player!.hp.h).toBeCloseTo(200, 7)
    expect(w.battle.meVolleyDmg!.player).toBeCloseTo(800, 7)
  })

  it('真实酸液破盾增幅先计算，超额部分被保护截断，飘字只报实收', () => {
    const w = engineWorld('acid', 300, true)
    w.tick(10)
    expect(w.battle.units.player!.hp.s).toBe(200)
    expect(w.battle.meVolleyDmg!.player).toBe(800)
    expect(w.battle.fx.find(fx => fx.acidBurst)!.dmg).toBe(800)
    expect(w.battle.alienCorrosion).toBe(.15)
  })

  it('永陵高层在高抗目标上继续增伤，最终仍受实际掉血80%限制', () => {
    const base = ctx.anomalies.get('gravekeeper-flagship')!
    const slot = base.ships!.find(s => s.ship.id === 'foe-d-invasion-eternal-tomb')!
    const card: AnomalyDef = { ...base, id: 'eternal-actual-cap', waves: undefined, ships: [{ ...slot, wave: 0 }] }
    const hull = { ...ctx.ships.get('sh-thresher')!, shieldHp: 0, armorHp: 0, hullHp: 10000, hullResist: { plasma: .9, kinetic: .9 } }
    const context: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card), ships: new Map(ctx.ships).set(hull.id, hull) }
    const rows = [20, 25, 30, 40].map(n => {
      const state = createInitialState({ nowWallMs: 0, seed: 11 })
      state.shipId = addShipToFleet(state, hull.id)
      const b = startBattleFor(state, context, state.shipId, card.id, 0, 5000)!
      const f = activeFoeSpecsOf(card, context.balance.battle, 0)[0]!
      for (const rt of Object.values(b.units)) { delete rt.enteredAtMs; rt.weapons.fill(1e9) }
      b.units[f.tag]!.hp.s = 0
      b.units[f.tag]!.weapons[0] = 0
      b.foeShieldCapacitorActive = { [f.tag]: true }
      b.foeShieldCapacitorAttacks = { [`${f.tag}#0`]: n }
      state.gameMs = 10
      advanceBattleFor(state, context, b, state.shipId, card.id, null, undefined, undefined, { simulation: { distanceM: 5000, layer: 'h' } })
      expect(b.foeShieldCapacitorAttacks![`${f.tag}#0`]).toBe(n + 1)
      expect(b.stats.foeShots).toBe(8)
      return b.meVolleyDmg!.player!
    })
    expect(rows[0]).toBeCloseTo(1268.3, 6)
    expect(rows[1]).toBeCloseTo(2551.1, 6)
    expect(rows[2]).toBeCloseTo(5131.1, 6)
    expect(rows[3]).toBeCloseTo(8000, 6)
  })
})
