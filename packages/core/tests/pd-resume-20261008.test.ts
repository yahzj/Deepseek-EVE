import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceBattleFor, createBattleState, startBattleFor, startFleetBattleFor, type UnitSpec } from '../src/combat'
import { resolvePointDefense } from '../src/combatDrones'
import { foesWithSupport, seedUnit } from '../src/foeSpecs'
import { createInitialState, type BattleState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const me: UnitSpec = {
  tag: 'player', name: '防空夹具', side: 'me', hp: { s: 100, a: 100, h: 100 }, resists: {},
  weapons: [], agility: 0, evasion: 0, hitBonus: 0, signatureM: 100, scanResMm: 100, speedMps: 100, foeTactic: null,
}
const foe: UnitSpec = { ...me, tag: 'foe-0', side: 'foe', family: 'R', hullClassTier: 5 }

function pointDefense(cds = [400], artId = 'drone-assault') {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const foes = cds.map((_, i) => ({ ...foe, tag: `foe-${i}` }))
  const battle = createBattleState(me, foes, 0, 8000)
  battle.distanceM = 8000
  battle.dronePools = { 'player:0': { s: 100, a: 100, h: 100, alive: true, artId, evasion: 0 } }
  battle.pdCd = cds.slice()
  battle.droneHitAt = { foe: 0, me: 77 }
  const step = (at: number) => {
    battle.lastTickGameMs = at
    resolvePointDefense(state, battle, foes, bal, 100)
  }
  return { state, battle, foes, step, pool: battle.dronePools['player:0']! }
}

describe('敌方近防反击许可不空消费（船长2026-10-08确认）', () => {
  it('全队冷却未好时保留，转好后只还手一次，保留我方令牌', () => {
    const { battle, pool, step } = pointDefense()
    for (const at of [0, 100, 200]) {
      step(at)
      expect(pool.s).toBe(100)
      expect(battle.droneHitAt?.foe).toBe(0)
    }
    step(300)
    expect(pool.s).toBe(75)
    expect(battle.droneHitAt).toEqual({ foe: undefined, me: 77 })
    for (let at = 400; at <= 1500; at += 100) step(at)
    expect(pool.s).toBe(75)
  })

  it('许可只让实际还手当拍就绪的舰各一次，不给未就绪舰另攒机会', () => {
    const { battle, pool, step } = pointDefense([100, 100, 400])
    step(0)
    expect(pool.s).toBe(50)
    expect(battle.droneHitAt?.foe).toBeUndefined()
    for (let at = 100; at <= 1000; at += 100) step(at)
    expect(pool.s).toBe(50)
  })

  it('没有合法目标时保留，哨戒进射程后可以还手', () => {
    const { battle, pool, step } = pointDefense([100], 'drone-sentry')
    step(0)
    expect(pool.s).toBe(100)
    expect(battle.droneHitAt?.foe).toBe(0)
    battle.distanceM = 2500
    for (let at = 100; at <= 500; at += 100) step(at)
    expect(pool.s).toBe(75)
    expect(battle.droneHitAt?.foe).toBeUndefined()
  })

  it('哨戒在近防射程内无需令牌仍按周期受击', () => {
    const { battle, pool, step } = pointDefense([100], 'drone-sentry')
    battle.distanceM = 2500
    battle.droneHitAt = undefined
    for (let at = 0; at <= 1000; at += 100) step(at)
    expect(pool.s).toBe(25)
  })

  it('未命中也消耗许可，不能保留到命中为止', () => {
    const { state, battle, foes, pool } = pointDefense([100])
    const misses = { ...bal, pdAcc: 0, pdHitFloor: 0 }
    resolvePointDefense(state, battle, foes.map(f => ({ ...f, family: 'C' })), misses, 100)
    expect(pool.s).toBe(100)
    expect(battle.droneHitAt?.foe).toBeUndefined()
  })

  it('过期许可不能在冷却转好后还手', () => {
    const { battle, pool, step } = pointDefense([100])
    step(5001)
    expect(pool.s).toBe(100)
    expect(battle.pdCd).toEqual([500])
  })

  it('无许可时冷却仍推进，新攻击可以再次换一次反击', () => {
    const { battle, pool, step } = pointDefense([300])
    battle.droneHitAt = undefined
    step(0)
    expect(battle.pdCd).toEqual([200])
    step(100)
    battle.droneHitAt = { foe: 200 }
    step(200)
    expect(pool.s).toBe(75)
    for (let at = 300; at <= 600; at += 100) step(at)
    battle.droneHitAt = { foe: 700 }
    step(700)
    expect(pool.s).toBe(50)
  })

  it.each(['禁用', '死亡'] as const)('%s的敌舰不消耗反击许可', mode => {
    const { battle, pool, step, foes } = pointDefense([100])
    if (mode === '禁用') foes[0]!.foePointDefenseEnabled = false
    else battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    step(0)
    expect(pool.s).toBe(100)
    expect(battle.droneHitAt?.foe).toBe(0)
  })

  it('追加支援舰默认冷却槽补位，仍与原编成同序', () => {
    const { state, battle, foes, pool } = pointDefense([100])
    battle.foeReviveCount = 1
    seedUnit(battle, { ...foe, tag: 'sup1-foe-0' })
    const supported = foesWithSupport(battle, foes)
    resolvePointDefense(state, battle, supported, bal, 500)
    expect(battle.pdCd).toEqual([100, 500])
    expect(pool.s).toBe(50)
    expect(battle.droneHitAt?.foe).toBeUndefined()
  })
})

const ship: FoeShipDef = {
  id: 'test-pd-resume', name: '近防续战测试舰', family: 'R', hullClassTier: 5,
  speedRatio: 0.8, hp: 1_000_000, split: { s: 0.3, a: 0.4, h: 0.3 },
  shotDmg: 1, hitRate: 0.7, reloadMs: 4000, rangeMinM: 1, rangeMaxM: 2500, falloff: 0.5,
  dmgMix: { plasma: 1 }, tactic: 'orbit',
}

function resumeFixture(fleet = false, overrides: Partial<AnomalyDef> = {}) {
  const card: AnomalyDef = {
    ...ctx.anomalies.get('ano-training')!, id: 'ano-pd-resume', name: '防空续战卡', threat: 60, threatJudged: 60,
    ships: [{ ship, count: 1 }], waves: [{ units: 1, hpShare: 1 }], ...overrides,
  }
  const c: SimContext = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const squad = Array.from({ length: fleet ? 2 : 1 }, () => addShipToFleet(state, 'sh-sentinel'))
  state.shipId = squad[0]!
  for (const id of ['drone-warfare', 'drone-servicing', 'drone-durability', 'drone-reinforce', 'ship-systems-engineering']) state.skills.trained[id] = 5
  for (const uid of squad) {
    state.fleet[uid]!.fitted = { high: ['mod-drone-rack-3'], mid: [], low: [] }
    state.fleet[uid]!.droneLoad = { 'drone-assault': 2 }
  }
  const battle = fleet ? startFleetBattleFor(state, c, squad, card.id, 0)! : startBattleFor(state, c, state.shipId, card.id, 0)!
  expect(battle).toBeTruthy()
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle }
  return { state, battle, c, card }
}

function reload(state: ReturnType<typeof createInitialState>) {
  const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
  return { state: loaded, battle: loaded.expedition.battle! }
}

function hpOf(b: BattleState) {
  return Object.values(b.dronePools ?? {}).reduce((sum, p) => sum + p.s + p.a + p.h, 0)
}

describe('读档恢复敌方近防调度（不升级存档结构）', () => {
  it.each([false, true])('单船/编队=%s：重载保留伤情，续战补表并实际受击', fleet => {
    const f = resumeFixture(fleet)
    const pool = Object.values(f.battle.dronePools!)[0]!
    pool.s -= 3
    const savedPools = structuredClone(f.battle.dronePools)
    const back = reload(f.state)
    expect(back.battle.pdCd).toBeUndefined()
    expect(back.battle.dronePools).toEqual(savedPools)
    back.state.gameMs = 100
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.pdCd).toEqual([400])
    expect(back.battle.dronePools).toEqual(savedPools)
    for (let at = 200; at <= 10_000; at += 100) {
      back.state.gameMs = at
      advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    }
    expect(back.battle.ended).toBeNull()
    expect(hpOf(back.battle)).toBeLessThan(hpOf(f.battle))
  })

  it('低判据威胁不因展示威胁或缺表被开启', () => {
    const f = resumeFixture(false, { threat: 120, threatJudged: 20 })
    const back = reload(f.state)
    back.state.gameMs = 10_000
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.pdCd).toBeUndefined()
    expect(back.battle.dronePools).toEqual(f.battle.dronePools)
  })

  it('展示威胁低但判据达标时恢复', () => {
    const f = resumeFixture(false, { threat: 20, threatJudged: 60 })
    const back = reload(f.state)
    back.state.gameMs = 10_000
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.pdCd).toHaveLength(1)
    expect(hpOf(back.battle)).toBeLessThan(hpOf(f.battle))
  })

  it('显式禁用近防的敌舰读档后不造成机群伤害', () => {
    const f = resumeFixture(false, { wormholePdTags: [] })
    const back = reload(f.state)
    back.state.gameMs = 10_000
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.dronePools).toEqual(f.battle.dronePools)
  })

  it('没有机群池时不建近防表', () => {
    const f = resumeFixture()
    delete f.battle.dronePools
    const back = reload(f.state)
    back.state.gameMs = 100
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.pdCd).toBeUndefined()
  })

  it('空机群池时不建近防表', () => {
    const f = resumeFixture()
    f.battle.dronePools = {}
    const back = reload(f.state)
    back.state.gameMs = 100
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.pdCd).toBeUndefined()
  })

  it('已有调度不被每拍重置，集火锁保持', () => {
    const f = resumeFixture()
    f.battle.pdCd = [300]
    f.battle.pdFocus = ['player:0']
    f.state.gameMs = 100
    advanceBattleFor(f.state, f.c, f.battle, f.state.shipId, f.card.id)
    expect(f.battle.pdCd).toEqual([200])
    expect(f.battle.pdFocus).toEqual(['player:0'])
  })

  it('读档后切波重建为新波数量，之后再重载也按当前波恢复', () => {
    const f = resumeFixture(true, { ships: [{ ship, count: 1, wave: 0 }, { ship, count: 2, wave: 1 }],
      waves: [{ units: 1, hpShare: 0.5 }, { units: 2, hpShare: 0.5 }] })
    const back = reload(f.state)
    for (const unit of Object.values(back.battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    back.state.gameMs = 5000
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.waveIdx).toBe(1)
    expect(back.battle.pdCd).toHaveLength(2)
    const again = reload(back.state)
    again.state.gameMs += 100
    advanceBattleFor(again.state, f.c, again.battle, again.state.shipId, f.card.id)
    expect(again.battle.pdCd).toHaveLength(2)
  })

  it('支援舰随档保留，续战在原编成后补位且可以反击', () => {
    const f = resumeFixture()
    const supported = { ...foe, tag: 'sup1-foe-0', foeShipId: ship.id }
    seedUnit(f.battle, supported)
    f.battle.foeReviveCount = 1
    const back = reload(f.state)
    back.state.gameMs = 600
    back.battle.droneHitAt = { foe: 0 }
    advanceBattleFor(back.state, f.c, back.battle, back.state.shipId, f.card.id)
    expect(back.battle.pdCd).toHaveLength(2)
    expect(back.battle.units[supported.tag]).toBeTruthy()
    expect(hpOf(back.battle)).toBeLessThan(hpOf(f.battle))
  })
})
