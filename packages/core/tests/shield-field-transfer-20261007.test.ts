import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/fleetBook'
import { createInitialState } from '../src/state'
import { advanceBattleFor, createPlayerSpec, pulseShieldFieldFor, startFleetBattleFor } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { UnitSpec } from '../src/combat'

const ctx = buildSimContext()

function world(high = ['mod-shieldfield-2'], count = 3) {
  const local = { ...ctx, balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  const fleet = Array.from({ length: count }, () => addShipToFleet(state, 'sh-megalodon'))
  state.shipId = fleet[0]!
  for (const id of fleet) state.fleet[id]!.fitted = { high: [], mid: [], low: [] }
  state.fleet[state.shipId]!.fitted.high = high
  const battle = startFleetBattleFor(state, local, fleet, 'ano-training', 0, 5000)!
  for (const unit of Object.values(battle.units)) unit.weapons = unit.weapons.map(() => 100_000)
  const specs: UnitSpec[] = fleet.map(id => {
    const spec = createPlayerSpec(state, ctx, id)!
    spec.tag = battle.myFleet!.find(entry => entry.shipId === id)!.tag
    battle.units[spec.tag]!.hpMax!.s = 1000
    return spec
  })
  const hp = (index: number) => battle.units[specs[index]!.tag]!.hp
  const pulse = (pct = .1) => pulseShieldFieldFor(battle, specs, { pct }, specs[0]!)
  return { state, fleet, battle, specs, hp, pulse, local }
}

describe('护盾力场转移与支付', () => {
  it('排除自身，多目标只支付一次，费用不吃抗性，目标各自封顶', () => {
    const w = world()
    w.hp(0).s = 500
    w.hp(1).s = 0
    w.hp(2).s = 970
    w.specs[0]!.resists.shield = { kinetic: .9, explosive: .9, plasma: .9 }
    w.pulse()
    expect([0, 1, 2].map(i => w.hp(i).s)).toEqual([400, 100, 1000])
  })

  it.each([0, 99.99, 100, 100.01])('当前盾%s：不足不发动，恰好够可扣至零', shield => {
    const w = world()
    w.hp(0).s = shield
    w.hp(1).s = 0
    w.hp(2).s = 0
    const before = structuredClone(w.battle.units)
    w.pulse()
    expect(w.hp(0).s).toBeCloseTo(shield < 100 ? shield : shield - 100)
    expect(w.hp(1).s).toBe(shield < 100 ? 0 : 100)
    for (const spec of w.specs) {
      expect(w.battle.units[spec.tag]!.hp.a).toBe(before[spec.tag]!.hp.a)
      expect(w.battle.units[spec.tag]!.hp.h).toBe(before[spec.tag]!.hp.h)
    }
  })

  it.each(['solo', 'full', 'dead', 'zero-cap'] as const)('%s无有效目标时完全不动血量', scenario => {
    const w = world(undefined, scenario === 'solo' ? 1 : 3)
    w.hp(0).s = 500
    for (const spec of w.specs.slice(1)) {
      const unit = w.battle.units[spec.tag]!
      unit.hp.s = scenario === 'full' ? 1000 : 0
      if (scenario === 'dead') unit.hp = { s: 0, a: 0, h: 0 }
      if (scenario === 'zero-cap') unit.hpMax!.s = 0
    }
    const before = structuredClone(w.battle.units)
    w.pulse()
    expect(w.battle.units).toEqual(before)
  })

  it('满盾使用运行态上限，费用固定不随恢复衰减；旧档无hpMax回落规格', () => {
    const w = world()
    w.hp(0).s = 600
    w.hp(1).s = 0
    w.hp(2).s = 0
    w.pulse(.05)
    expect([0, 1, 2].map(i => w.hp(i).s)).toEqual([500, 50, 50])
    delete w.battle.units[w.specs[0]!.tag]!.hpMax
    w.specs[0]!.hp.s = 2000
    w.pulse()
    expect([0, 1, 2].map(i => w.hp(i).s)).toEqual([300, 250, 250])
  })

  it('施放者死亡、战斗结束、无效恢复比例不支付也不恢复', () => {
    for (const scenario of ['dead', 'ended', 'pct'] as const) {
      const w = world()
      w.hp(0).s = 500
      w.hp(1).s = 0
      w.hp(2).s = 0
      if (scenario === 'dead') Object.assign(w.hp(0), { s: 0, a: 0, h: 0 })
      if (scenario === 'ended') w.battle.ended = 'me'
      const before = structuredClone(w.battle.units)
      w.pulse(scenario === 'pct' ? 0 : .1)
      expect(w.battle.units).toEqual(before)
    }
  })

  it('多舰互补允许，每路仍排除自身并各自支付', () => {
    const w = world()
    for (let i = 0; i < 3; i++) w.hp(i).s = 300
    w.pulse()
    pulseShieldFieldFor(w.battle, w.specs, { pct: .1 }, w.specs[1]!)
    expect([0, 1, 2].map(i => w.hp(i).s)).toEqual([300, 300, 500])
  })
})

describe('力场真实排程与读档', () => {
  it('同型号合并一路只扣一次，不同型号独立到期分别支付', () => {
    for (const high of [['mod-shieldfield-2', 'mod-shieldfield-2'], ['mod-shieldfield-2', 'mod-shieldfield-3']]) {
      const w = world(high)
      w.hp(0).s = 600
      w.hp(1).s = 0
      w.hp(2).s = 0
      const streams = w.battle.shieldFieldBy!.player!.streams
      for (const stream of streams) stream.nextPulseAtMs = 100
      w.state.gameMs = 100
      const expected = streams.reduce((sum, stream) => sum + 1000 * stream.pct, 0)
      advanceBattleFor(w.state, w.local, w.battle, w.state.shipId, 'ano-training')
      expect(w.hp(0).s).toBeCloseTo(600 - streams.length * 100, 6)
      expect(w.hp(1).s).toBeCloseTo(expected, 6)
      expect(streams.every(stream => stream.nextPulseAtMs! > w.battle.lastTickGameMs)).toBe(true)
    }
  })

  it('不足跳过后推进原排期，重载恢复足量不提前补跳、不重复支付', () => {
    const w = world()
    w.hp(0).s = 0
    w.hp(1).s = 0
    w.hp(2).s = 0
    const ledger = w.battle.shieldFieldBy!.player!
    ledger.streams[0]!.nextPulseAtMs = 100
    w.state.gameMs = 100
    advanceBattleFor(w.state, w.local, w.battle, w.state.shipId, 'ano-training')
    expect(w.hp(1).s).toBe(0)
    expect(ledger.streams[0]!.nextPulseAtMs).toBe(10100)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: w.battle }
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const battle = loaded.expedition.battle!
    expect(battle.shieldFieldBy).toEqual(w.battle.shieldFieldBy)
    battle.units.player!.hp.s = 100
    loaded.gameMs += 100
    advanceBattleFor(loaded, w.local, battle, loaded.shipId, 'ano-training')
    expect(battle.units[w.specs[1]!.tag]!.hp.s).toBe(0)
    expect(battle.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs).toBe(10100)
  })

  it('同拍两型号剩余盾只够第一路时，第二路跳过而不透支', () => {
    const w = world(['mod-shieldfield-2', 'mod-shieldfield-3'])
    w.hp(0).s = 150
    w.hp(1).s = 0
    w.hp(2).s = 0
    for (const stream of w.battle.shieldFieldBy!.player!.streams) stream.nextPulseAtMs = 100
    w.state.gameMs = 100
    advanceBattleFor(w.state, w.local, w.battle, w.state.shipId, 'ano-training')
    expect([0, 1, 2].map(i => w.hp(i).s)).toEqual([50, 100, 100])
    expect(w.battle.shieldFieldBy!.player!.streams.map(stream => stream.nextPulseAtMs)).toEqual([10100, 8100])
  })

  it('有效脉冲支付后完整存档往返保留血量和排程，下一拍不重复付费', () => {
    const w = world()
    w.hp(0).s = 600
    w.hp(1).s = 0
    w.hp(2).s = 0
    w.battle.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs = 100
    w.state.gameMs = 100
    advanceBattleFor(w.state, w.local, w.battle, w.state.shipId, 'ano-training')
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: w.battle }
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const battle = loaded.expedition.battle!
    for (const spec of w.specs) expect(battle.units[spec.tag]!.hp).toEqual(w.battle.units[spec.tag]!.hp)
    expect(battle.shieldFieldBy).toEqual(w.battle.shieldFieldBy)
    loaded.gameMs += 100
    advanceBattleFor(loaded, w.local, battle, loaded.shipId, 'ano-training')
    expect(battle.units.player!.hp.s).toBe(500)
    expect(battle.units[w.specs[1]!.tag]!.hp.s).toBe(100)
  })

  it('离线一段推进与逐拍推进的扣盾、恢复和周期账相同', () => {
    const stepped = world(['mod-shieldfield-2', 'mod-shieldfield-3'])
    const offline = world(['mod-shieldfield-2', 'mod-shieldfield-3'])
    for (const w of [stepped, offline]) {
      w.hp(0).s = 600
      w.hp(1).s = 0
      w.hp(2).s = 0
    }
    for (let time = 100; time <= 16000; time += 100) {
      stepped.state.gameMs = time
      advanceBattleFor(stepped.state, stepped.local, stepped.battle, stepped.state.shipId, 'ano-training')
    }
    offline.state.gameMs = 16000
    advanceBattleFor(offline.state, offline.local, offline.battle, offline.state.shipId, 'ano-training')
    expect(offline.battle.units).toEqual(stepped.battle.units)
    expect(offline.battle.shieldFieldBy).toEqual(stepped.battle.shieldFieldBy)
    expect(offline.hp(0).s).toBe(300)
  })
})
