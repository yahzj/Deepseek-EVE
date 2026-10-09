import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { installPlug } from '../src/plugs'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceBattleFor, createBattleState, createPlayerSpec, pickMyUnitTarget, startFleetBattleFor } from '../src/combat'
import { WORMHOLE_BOSS_TARGETING_CHANCE, WORMHOLE_FAMILY_CARDS, WORMHOLE_FAMILY_TARGETING_CHANCE, wormholeAnomalyOf } from '../src/wormholeFoes'
import { wormholeExpeditionCard } from '../src/wormholeExpeditionFoes'
import type { UnitSpec } from '../src/combat'
import type { AnomalyDef, FoeShipDef, FoeTargetingMode } from '../src/types'

const ctx = buildSimContext()
const BEACON = 'plug-target-beacon'
const CONCEAL = 'plug-concealment'

function fleet(seed = 911) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ships = Array.from({ length: 4 }, () => addShipToFleet(state, 'sandcat'))
  state.shipId = ships[0]!
  for (const uid of ships) state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  state.moduleBay[BEACON] = 20
  state.moduleBay[CONCEAL] = 20
  return { state, ships }
}

function specsOf(w: ReturnType<typeof fleet>): UnitSpec[] {
  return w.ships.map((uid, index) => ({ ...createPlayerSpec(w.state, ctx, uid)!, tag: index === 0 ? 'player' : `ally-${index}` }))
}

function selections(w: ReturnType<typeof fleet>, specs: UnitSpec[], mode: FoeTargetingMode = 'random', chance = 1) {
  const battle = createBattleState(specs[0]!, [], 0, 1000, specs.slice(1))
  const counts = Object.fromEntries(specs.map(unit => [unit.tag, 0]))
  for (let i = 0; i < 12000; i++) counts[pickMyUnitTarget(w.state, battle, specs, mode, chance)!.tag]!++
  return counts
}

describe('靶标插件实际安装、重复件和选靶边界', () => {
  it.each([1, 2, 3])('%s件实际安装与重载后权重为3的件数次方，不改变回避或武器', count => {
    const w = fleet()
    const uid = w.ships[1]!
    const before = createPlayerSpec(w.state, ctx, uid)!
    for (let i = 0; i < count; i++) expect(installPlug(w.state, ctx, BEACON, uid).ok).toBe(true)
    expect(w.state.moduleBay[BEACON]).toBe(20 - count)
    const after = createPlayerSpec(w.state, ctx, uid)!
    expect(after.targetWeightMul).toBe(3 ** count)
    expect(after.evasion).toBe(before.evasion)
    expect(after.hitBonus).toBe(before.hitBonus)
    expect(after.weapons).toEqual(before.weapons)
    expect(createPlayerSpec(w.state, ctx, w.ships[0]!)!.targetWeightMul).toBeUndefined()
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(loaded.fleet[uid]!.plugs).toEqual(Array(count).fill(BEACON))
    expect(createPlayerSpec(loaded, ctx, uid)!.targetWeightMul).toBe(3 ** count)
  })

  it.each([[0, 0.25], [1, 0.5], [2, 0.75]] as const)('四舰中%s件，12000次实际选靶接近%s概率', (count, expected) => {
    const w = fleet()
    for (let i = 0; i < count; i++) expect(installPlug(w.state, ctx, BEACON, w.ships[1]!).ok).toBe(true)
    const counts = selections(w, specsOf(w))
    expect(counts['ally-1']! / 12000).toBeCloseTo(expected, 1)
    console.log(`[选靶核查] 四舰${count}件：${counts['ally-1']}/12000，理论${expected * 100}%`)
  })

  it('全队都装一件仍等权，靶标和隐匿同舰相乘为2.1', () => {
    const w = fleet()
    for (const uid of w.ships) expect(installPlug(w.state, ctx, BEACON, uid).ok).toBe(true)
    const counts = selections(w, specsOf(w))
    for (const count of Object.values(counts)) expect(count / 12000).toBeCloseTo(0.25, 1)
    expect(installPlug(w.state, ctx, CONCEAL, w.ships[1]!).ok).toBe(true)
    expect(createPlayerSpec(w.state, ctx, w.ships[1]!)!.targetWeightMul).toBeCloseTo(2.1, 10)
  })

  it.each([[0.4, 0.3], [0.1, 0.45]] as const)('倾向%s先筛候选：靶标大船不抢最小船分支，随机占比%s', (chance, expected) => {
    const w = fleet()
    expect(installPlug(w.state, ctx, BEACON, w.ships[1]!).ok).toBe(true)
    const specs = specsOf(w)
    specs.forEach((unit, index) => { unit.shipTier = index === 1 ? 4 : 1 })
    const counts = selections(w, specs, 'smallest', chance)
    expect(counts['ally-1']! / 12000).toBeCloseTo(expected, 1)
    console.log(`[选靶核查] 最小舰${chance * 100}%倾向：大船靶标${counts['ally-1']}/12000，理论${expected * 100}%`)
  })

  it.each(['smallest', 'largest', 'top-output', 'noncombat'] as const)('%s模式并列候选仍按插件权重抽取', mode => {
    const w = fleet()
    expect(installPlug(w.state, ctx, BEACON, w.ships[1]!).ok).toBe(true)
    const specs = specsOf(w)
    const counts = selections(w, specs, mode, 1)
    expect(counts['ally-1']! / 12000).toBeCloseTo(0.5, 1)
  })

  it('死亡或隐身的高权重船不入多舰候选池，单舰不额外消费选靶随机数', () => {
    const w = fleet()
    expect(installPlug(w.state, ctx, BEACON, w.ships[1]!).ok).toBe(true)
    const specs = specsOf(w)
    const battle = createBattleState(specs[0]!, [], 0, 1000, specs.slice(1))
    battle.units['ally-1']!.stealthUntilMs = 10000
    for (let i = 0; i < 1000; i++) expect(pickMyUnitTarget(w.state, battle, specs)?.tag).not.toBe('ally-1')
    delete battle.units['ally-1']!.stealthUntilMs
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    for (let i = 0; i < 1000; i++) expect(pickMyUnitTarget(w.state, battle, specs)?.tag).not.toBe('ally-1')
    const before = w.state.rng.count
    for (let i = 0; i < 10; i++) expect(pickMyUnitTarget(w.state, battle, [specs[0]!])?.tag).toBe('player')
    expect(w.state.rng.count).toBe(before)
  })
})

describe('真实开战与逐拍攻击目标', () => {
  it.each([
    [0, 'random', 1], [1, 'random', 1], [2, 'random', 1], [1, 'smallest', 0.1],
  ] as const)('非主控舰%s件、%s模式、概率%s：敌炮与敌机均消费该舰权重', (count, mode, chance) => {
    const w = fleet(8231)
    if (mode === 'smallest') {
      w.ships[1] = addShipToFleet(w.state, 'sh-xuanwu')
      w.state.fleet[w.ships[1]!]!.fitted = { high: [], mid: [], low: [] }
    }
    for (let i = 0; i < count; i++) expect(installPlug(w.state, ctx, BEACON, w.ships[1]!).ok).toBe(true)
    const model = ctx.foeShips!.get('foe-alien-hiveback')!
    const foe: FoeShipDef = {
      ...model, id: 'beacon-audit-foe', family: 'A', hp: 100000000, shotDmg: 4,
      gunCount: 4, reloadMs: 100, hitRate: 1, falloff: 1, rangeMinM: 1, rangeMaxM: 10000,
      mounts: [], droneFireShare: undefined,
      drones: [{ count: 4, drone: { ...model.drones![0]!.drone, family: 'A', reloadMs: 200, dmg: 1, maxRangeM: 10000 } }],
    }
    const card: AnomalyDef = {
      ...ctx.anomalies.get('ano-training')!, id: 'beacon-audit-card', ships: [{ ship: foe }],
      waves: undefined, foeTargeting: mode, foeTargetingChance: chance,
    }
    const ship = ctx.ships.get('sandcat')!
    const big = ctx.ships.get('sh-xuanwu')!
    // 合成耐久只隔离选靶，不评价这份配装的生存能力。
    const local = {
      ...ctx, ships: new Map(ctx.ships)
        .set(ship.id, { ...ship, shieldHp: 10000000, armorHp: 10000000, hullHp: 10000000 })
        .set(big.id, { ...big, shieldHp: 10000000, armorHp: 10000000, hullHp: 10000000 }),
      anomalies: new Map(ctx.anomalies).set(card.id, card),
    }
    const battle = startFleetBattleFor(w.state, local, w.ships, card.id, 0, 1000)!
    battle.distanceM = 1000
    const tally = { gun: { beacon: 0, total: 0 }, drone: { beacon: 0, total: 0 } }
    let seen = -1
    for (let time = 100; time <= 60000; time += 100) {
      w.state.gameMs = time
      advanceBattleFor(w.state, local, battle, w.state.shipId, card.id)
      for (const event of battle.fx) {
        if (event.seq <= seen) continue
        seen = event.seq
        if (event.side !== 'foe' || !event.to) continue
        const group = tally[event.src === 'drone' ? 'drone' : 'gun']
        group.total++
        if (event.to === 'ally-1') group.beacon++
      }
      expect(battle.ended).toBeNull()
    }
    const weight = 3 ** count
    const expected = weight / (weight + 3) * (mode === 'smallest' ? 1 - chance : 1)
    for (const [kind, group] of Object.entries(tally)) {
      expect(group.total).toBeGreaterThan(500)
      expect(group.beacon / group.total).toBeCloseTo(expected, 1)
      console.log(`[实际攻击核查] ${count}件/${mode}/${kind}：${group.beacon}/${group.total}，理论${expected * 100}%`)
    }
    expect(w.state.fleet[w.ships[1]!]!.plugs ?? []).toHaveLength(count)
  })
})

describe('10%生产配置与派生同源', () => {
  it('非随机基础卡一律10%，纯随机不新增倾向；普通和守卫常量均10%', () => {
    const biased = [...ctx.anomalies.values()].filter(card => card.foeTargeting !== undefined && card.foeTargeting !== 'random')
    expect(biased).toHaveLength(13)
    expect(biased.filter(card => card.region === 'inv')).toHaveLength(4)
    for (const card of biased) expect(card.foeTargetingChance, card.id).toBe(0.1)
    for (const card of ctx.anomalies.values()) {
      if (card.foeTargeting === 'random') expect(card.foeTargetingChance, card.id).toBeUndefined()
    }
    expect(WORMHOLE_FAMILY_TARGETING_CHANCE).toBe(0.1)
    expect(WORMHOLE_BOSS_TARGETING_CHANCE).toBe(0.1)
  })

  it('五族全部层级/用途派生：偏好仍按原族格，概率统一10%，纯random保持1', () => {
    for (const family of ['A', 'C', 'D', 'E', 'G'] as const) for (const depth of [1, 5, 10]) {
      const base = ctx.anomalies.get(WORMHOLE_FAMILY_CARDS[family].shallow!)!
      for (const kind of ['node', 'boss', 'extract'] as const) {
        const derived = wormholeAnomalyOf(base, depth, kind, 1)
        expect(derived.foeTargetingChance).toBe(derived.foeTargeting === 'random' ? 1 : 0.1)
      }
      for (const role of ['ordinary', 'elite', 'guard', 'patrol', 'event'] as const) {
        const derived = wormholeExpeditionCard(ctx, family, depth, role)
        expect(derived.foeTargetingChance).toBe(derived.foeTargeting === 'random' ? 1 : 0.1)
      }
    }
  })

  it('唯一偏好目标的总选中率是10%+90%的随机份额，不是10%', () => {
    const w = fleet()
    const specs = specsOf(w)
    specs[0]!.shipTier = 4
    const counts = selections(w, specs, 'largest', 0.1)
    expect(counts.player! / 12000).toBeCloseTo(0.325, 1)
    console.log(`[选靶核查] 10%最大舰倾向：唯一偏好目标${counts.player}/12000，理论32.5%`)
  })
})
