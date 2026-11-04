import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/fleetBook'
import { createInitialState } from '../src/state'
import { installPlug } from '../src/plugs'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createBattleState, createPlayerSpec, startFleetBattleFor, advanceBattleFor } from '../src/combat'
import { pickMyUnitTarget, playerTargetWeightOf } from '../src/combat/targeting'
import { nextInt, nextRandom } from '../src/rng'
import type { UnitSpec } from '../src/combat/model'
import type { AnomalyDef, FoeShipDef, FoeTargetingMode } from '../src/types'

const ctx = buildSimContext()

function fleet(defIds = ['sh-shrike', 'sh-xuanwu'], seed = 10830) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids = defIds.map(id => addShipToFleet(state, id))
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: [], mid: [], low: [] }
  const specs = ids.map((id, index) => ({ ...createPlayerSpec(state, ctx, id)!, tag: index === 0 ? 'player' : `ally-${index}` }))
  const battle = createBattleState(specs[0]!, [], 0, 1000, specs.slice(1))
  return { state, ids, specs, battle }
}

function countsOf(w: ReturnType<typeof fleet>, mode: FoeTargetingMode = 'random', chance = 1) {
  const counts = Object.fromEntries(w.specs.map(spec => [spec.tag, 0]))
  for (let i = 0; i < 12000; i++) counts[pickMyUnitTarget(w.state, w.battle, w.specs, mode, chance)!.tag]!++
  return counts
}

describe('舰级基础权重与插件合成', () => {
  it('护卫至泰坦依次1/2/3/4/5，插件乘数不回写规格', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      const unit = { shipTier: tier, targetWeightMul: 2.1 }
      expect(playerTargetWeightOf({ shipTier: tier })).toBe(tier)
      expect(playerTargetWeightOf(unit)).toBeCloseTo(tier * 2.1, 12)
      expect(unit.targetWeightMul).toBe(2.1)
    }
  })

  it.each([undefined, 0, -1, 1.5, 6, NaN, Infinity])('非法舰级%s按1，不成为免选靶', shipTier => {
    expect(playerTargetWeightOf({ shipTier })).toBe(1)
    expect(playerTargetWeightOf({ shipTier, targetWeightMul: 3 })).toBe(3)
  })

  it.each([undefined, 0, -1, NaN, Infinity])('非法插件乘数%s回落舰级权重', targetWeightMul => {
    expect(playerTargetWeightOf({ shipTier: 4, targetWeightMul })).toBe(4)
  })

  it('有限插件相乘溢出时回落舰级基础值', () => {
    expect(playerTargetWeightOf({ shipTier: 5, targetWeightMul: Number.MAX_VALUE })).toBe(5)
  })

  it('真实舰体和运输船都按舰级，装插件和读档不重复乘基础值', () => {
    const w = fleet(['sh-shrike', 'sh-mako', 'sh-hammerhead', 'sh-xuanwu', 'sh-dunkleosteus', 'sh-swordfish'])
    w.state.moduleBay['plug-target-beacon'] = 2
    w.state.moduleBay['plug-concealment'] = 1
    const uid = w.ids[3]!
    const before = createPlayerSpec(w.state, ctx, uid)!
    expect(installPlug(w.state, ctx, 'plug-target-beacon', uid).ok).toBe(true)
    expect(installPlug(w.state, ctx, 'plug-concealment', uid).ok).toBe(true)
    const after = createPlayerSpec(w.state, ctx, uid)!
    expect(after.targetWeightMul).toBeCloseTo(2.1, 12)
    expect(playerTargetWeightOf(after)).toBeCloseTo(8.4, 12)
    expect(after.evasion).toBe(before.evasion)
    expect(after.hitBonus).toBe(before.hitBonus)
    expect(after.weapons).toEqual(before.weapons)
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    for (let i = 0; i < 3; i++) expect(playerTargetWeightOf(createPlayerSpec(loaded, ctx, uid)!)).toBeCloseTo(8.4, 12)
    const expected = [1, 2, 3, 8.4, 5, 4]
    w.ids.forEach((id, index) => expect(playerTargetWeightOf(createPlayerSpec(loaded, ctx, id)!)).toBeCloseTo(expected[index]!, 12))
  })
})

describe('舰级加权抽取及特殊倾向', () => {
  it.each([
    [['sh-shrike', 'sh-xuanwu'], [0.2, 0.8]],
    [['sh-shrike', 'sh-shrike', 'sh-xuanwu'], [1 / 6, 1 / 6, 4 / 6]],
    [['sh-hammerhead', 'sh-xuanwu'], [3 / 7, 4 / 7]],
  ])('真实舰级队伍%s符合相对权重', (ids, expected) => {
    const w = fleet(ids as string[])
    const counts = countsOf(w)
    w.specs.forEach((spec, index) => expect(Math.abs(counts[spec.tag]! / 12000 - expected[index]!)).toBeLessThan(0.02))
    expect(w.state.rng.count).toBe(12000)
  })

  it('同级无插件与旧均匀抽取逐次一致，仍每次只消耗一颗骰', () => {
    for (const id of ['sh-shrike', 'sh-mako', 'sh-hammerhead', 'sh-xuanwu', 'sh-dunkleosteus']) {
      const w = fleet(Array(4).fill(id))
      const rng = { ...w.state.rng }
      for (let i = 0; i < 1000; i++) expect(pickMyUnitTarget(w.state, w.battle, w.specs)?.tag).toBe(w.specs[nextInt(rng, 4)]!.tag)
      expect(w.state.rng).toEqual(rng)
    }
  })

  it('靶标护卫和隐匿战列仍与舰级基础相乘', () => {
    const w = fleet()
    w.specs[0]!.targetWeightMul = 3
    w.specs[1]!.targetWeightMul = 0.7
    const counts = countsOf(w)
    expect(Math.abs(counts.player! / 12000 - 3 / 5.8)).toBeLessThan(0.02)
  })

  it('最小舰倾向先筛选，失效部分按舰级加权且不增加骰数', () => {
    const w = fleet()
    const rng = { ...w.state.rng }
    for (let i = 0; i < 1000; i++) {
      const biased = nextRandom(rng) < 0.1
      const roll = nextRandom(rng)
      const expected = biased || roll < 1 / 5 ? 'player' : 'ally-1'
      expect(pickMyUnitTarget(w.state, w.battle, w.specs, 'smallest', 0.1)?.tag).toBe(expected)
    }
    expect(w.state.rng).toEqual(rng)
  })

  it.each(['smallest', 'largest'] as const)('%s铁律不能被高插件权重抢走', mode => {
    const w = fleet()
    w.specs[mode === 'smallest' ? 1 : 0]!.targetWeightMul = 1000
    for (let i = 0; i < 100; i++) expect(pickMyUnitTarget(w.state, w.battle, w.specs, mode)?.tag).toBe(mode === 'smallest' ? 'player' : 'ally-1')
  })

  it('最高输出倾向先筛候选，同输出才按舰级加权', () => {
    const w = fleet()
    w.specs[0]!.weapons = [{ label: '测试炮', kind: 'fixed', shotDmg: 1000, reloadMs: 1000, minRangeM: 1, maxRangeM: 10000, hitRate: 1, falloff: 1 }]
    w.specs[1]!.weapons = [{ ...w.specs[0]!.weapons[0]!, shotDmg: 1 }]
    for (let i = 0; i < 100; i++) expect(pickMyUnitTarget(w.state, w.battle, w.specs, 'top-output')?.tag).toBe('player')
    w.specs[1]!.weapons = structuredClone(w.specs[0]!.weapons)
    expect(Math.abs(countsOf(w, 'top-output')['ally-1']! / 12000 - 0.8)).toBeLessThan(0.02)
  })

  it('非战斗倾向内按舰级加权，没有非战斗船则退回全队', () => {
    const w = fleet(['sandcat', 'sh-swordfish', 'sh-dunkleosteus'])
    const counts = countsOf(w, 'noncombat')
    expect(counts['ally-2']).toBe(0)
    expect(Math.abs(counts['ally-1']! / 12000 - 0.8)).toBeLessThan(0.02)
    const combat = fleet()
    expect(Math.abs(countsOf(combat, 'noncombat')['ally-1']! / 12000 - 0.8)).toBeLessThan(0.02)
  })

  it('隐身/阵亡高权重船被排除，唯一可选目标和单舰不耗骰', () => {
    const w = fleet()
    w.battle.units['ally-1']!.stealthUntilMs = 10000
    for (let i = 0; i < 10; i++) expect(pickMyUnitTarget(w.state, w.battle, w.specs)?.tag).toBe('player')
    delete w.battle.units['ally-1']!.stealthUntilMs
    w.battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    for (let i = 0; i < 10; i++) expect(pickMyUnitTarget(w.state, w.battle, w.specs, 'largest', 0.1)?.tag).toBe('player')
    expect(w.state.rng.count).toBe(0)
    for (const mode of ['random', 'smallest', 'largest', 'top-output', 'noncombat'] as const) {
      expect(pickMyUnitTarget(w.state, w.battle, [w.specs[0]!], mode, 0.1)?.tag).toBe('player')
    }
    expect(w.state.rng.count).toBe(0)
    w.battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(pickMyUnitTarget(w.state, w.battle, w.specs)).toBeNull()
  })
})

describe('真实建档、敌炮敌机和捕获网', () => {
  it('敌炮与敌机使用舰级权重，捕获网跟随同次炮击目标，读档不中断', () => {
    const w = fleet()
    const model = ctx.foeShips!.get('foe-alien-hiveback')!
    const foe: FoeShipDef = { ...model, id: 'tier-weight-test-foe', family: 'A', hp: 1e8, shotDmg: 1,
      gunCount: 1, reloadMs: 100, hitRate: 1, falloff: 1, rangeMinM: 1, rangeMaxM: 10000,
      mounts: ['foe-mount-capture-web'], droneFireShare: undefined,
      drones: [{ count: 4, drone: { ...model.drones![0]!.drone, family: 'A', reloadMs: 200, dmg: 1, maxRangeM: 10000 } }] }
    const card: AnomalyDef = { ...ctx.anomalies.get('ano-training')!, id: 'tier-weight-test-card',
      ships: [{ ship: foe }], waves: undefined, foeTargeting: 'random' }
    const ships = new Map(ctx.ships)
    for (const id of ['sh-shrike', 'sh-xuanwu']) ships.set(id, { ...ships.get(id)!, shieldHp: 1e7, armorHp: 1e7, hullHp: 1e7 })
    const local = { ...ctx, ships, anomalies: new Map(ctx.anomalies).set(card.id, card) }
    const battle = startFleetBattleFor(w.state, local, w.ids, card.id, 0, 1000)!
    expect(battle).toBeTruthy()
    battle.distanceM = 1000
    const tally = { gun: { big: 0, total: 0 }, drone: { big: 0, total: 0 } }
    let seen = -1
    let webChecked = false
    for (let time = 100; time <= 60000; time += 100) {
      w.state.gameMs = time
      advanceBattleFor(w.state, local, battle, w.state.shipId, card.id)
      for (const event of battle.fx) {
        if (event.seq <= seen) continue
        seen = event.seq
        if (event.side !== 'foe' || !event.to) continue
        if (event.web) {
          const shot = battle.fx.find(fx => fx.seq > event.seq && fx.tag === event.tag && fx.side === 'foe' && !fx.web && fx.src !== 'drone')
          expect(shot?.to).toBe(event.to)
          webChecked = true
          continue
        }
        const group = tally[event.src === 'drone' ? 'drone' : 'gun']
        group.total++
        if (event.to === 'ally-1') group.big++
      }
      expect(battle.ended).toBeNull()
    }
    expect(webChecked).toBe(true)
    for (const group of Object.values(tally)) {
      expect(group.total).toBeGreaterThan(100)
      expect(Math.abs(group.big / group.total - 0.8)).toBeLessThan(0.05)
    }
    w.state.encounter = { ...w.state.encounter, active: true, shipId: w.state.shipId,
      galaxyId: 'galaxy-redring', name: '选靶合成战斗', anomalyId: card.id, battle }
    const restored = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(restored.encounter.battle?.myFleet?.map(entry => entry.shipId)).toEqual(w.ids)
    const restoredSpecs: UnitSpec[] = restored.encounter.battle!.myFleet!.map(entry => ({ ...createPlayerSpec(restored, local, entry.shipId)!, tag: entry.tag }))
    expect(restoredSpecs.map(playerTargetWeightOf)).toEqual([1, 4])
    const rng = { ...restored.rng }
    const original = { ...restored, rng: { ...rng } }
    for (let i = 0; i < 100; i++) {
      expect(pickMyUnitTarget(restored, restored.encounter.battle!, restoredSpecs)?.tag)
        .toBe(pickMyUnitTarget(original, restored.encounter.battle!, restoredSpecs)?.tag)
    }
    // 捕获网账本按既有规则读档重置；续战等价另用不带网的同类敌炮/敌机夹具隔离选靶。
    const plain = fleet()
    const plainCard = { ...card, ships: [{ ship: { ...foe, mounts: [] } }] }
    const plainCtx = { ...local, anomalies: new Map(local.anomalies).set(card.id, plainCard) }
    const plainBattle = startFleetBattleFor(plain.state, plainCtx, plain.ids, card.id, 0, 1000)!
    plain.state.gameMs = 60000
    advanceBattleFor(plain.state, plainCtx, plainBattle, plain.state.shipId, card.id)
    plain.state.encounter = { ...plain.state.encounter, active: true, shipId: plain.state.shipId,
      galaxyId: 'galaxy-redring', name: '选靶续战夹具', anomalyId: card.id, battle: plainBattle }
    const resumed = loadSaveFile(serializeSaveFile(plain.state, 0)).state
    plain.state.gameMs = resumed.gameMs = 65000
    advanceBattleFor(plain.state, plainCtx, plainBattle, plain.state.shipId, card.id)
    advanceBattleFor(resumed, plainCtx, resumed.encounter.battle!, resumed.shipId, card.id)
    expect(resumed.rng).toEqual(plain.state.rng)
    expect(resumed.encounter.battle!.ended).toEqual(plainBattle.ended)
    expect(Object.values(resumed.encounter.battle!.units).map(unit => unit.hp)).toEqual(Object.values(plainBattle.units).map(unit => unit.hp))
  })
})
