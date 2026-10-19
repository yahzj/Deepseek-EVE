import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import modules from '../../data/src/static/modules.json'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec } from '../src/playerSpec'
import { advanceBattleFor, startFleetBattleFor } from '../src/combat'
import { shieldChargeStreamsOf, shieldFieldStreamsOf, SHIELD_FIELD_COST_PCT, SHIELD_REGEN_FLOOR_PCT } from '../src/combatRepair'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { battleDeviceCyclesOf } from '../src/battleDeviceView'
import type { BattleShieldChargeLedger } from '../src/state'
import { applyApprovedEquipmentRetune } from './helpers/approved-equipment-retune-20261019'

const ctx = buildSimContext()

function world(kind: 'shield-charge' | 'shield-field') {
  const local = { ...ctx, ships: new Map([...ctx.ships].map(([id, def]) => [id,
    id === 'sh-megalodon' ? { ...def, shieldHp: 1500 } : def])),
    balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
  const state = createInitialState({ nowWallMs: 0, seed: 1013 })
  const ids = [addShipToFleet(state, 'sh-megalodon'), addShipToFleet(state, 'sh-megalodon')]
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: [], mid: [], low: [] }
  state.fleet[ids[0]!]!.fitted = kind === 'shield-charge'
    ? { high: [], mid: ['mod-shieldchg-1', 'mod-shieldchg-3'], low: [] }
    : { high: ['mod-shieldfield-2', 'mod-shieldfield-3'], mid: [], low: [] }
  const battle = startFleetBattleFor(state, local, ids, 'ano-training', 0, 5000)!
  for (const unit of Object.values(battle.units)) unit.weapons.fill(1e9)
  battle.units.player!.hp.s = kind === 'shield-field' ? 750 : 0
  battle.units['ally-1']!.hp.s = 0
  return { local, state, battle, ids }
}

describe('护盾直接调参的数据与公式契约', () => {
  it('固定基线只调整批准的五个比例，后续守墓三件单列，其余装备字段不变', () => {
    const expected = JSON.parse(execFileSync('git', ['show', '4b31d1a5:packages/data/src/static/modules.json'], { encoding: 'utf8' })) as typeof modules
    for (const row of Object.values(expected.groups).flat()) {
      if (row.id === 'mod-shieldchg-1') Object.assign(row, { shieldPulsePct: .08 })
      if (row.id === 'mod-shieldchg-2') Object.assign(row, { shieldPulsePct: .133 })
      if (row.id === 'mod-shieldchg-3') Object.assign(row, { shieldPulsePct: .213 })
      if (['mod-shieldfield-2', 'mod-shieldfield-3'].includes(row.id)) Object.assign(row, { shieldFieldPct: .067 })
    }
    const approved = JSON.parse(execFileSync('git', ['show', 'e3db904e:packages/data/src/static/modules.json'], { encoding: 'utf8' })) as typeof modules
    const additions = ['mod-gravekeeper-rebirth', 'mod-gravekeeper-crisis', 'mod-gravekeeper-rail']
    for (const key of Object.keys(expected.groups) as Array<keyof typeof expected.groups>) {
      const rows = approved.groups[key].filter(row => additions.includes(row.id))
      expected.groups[key].push(...rows)
    }
    expect(Object.values(expected.groups).flat().filter(row => additions.includes(row.id)).map(row => row.id)).toEqual(additions)
    applyApprovedEquipmentRetune(expected)
    expect(modules).toEqual(expected)
    expect(SHIELD_FIELD_COST_PCT).toBe(.067)
    expect(ctx.balance.battle.shieldRegenPerSec).toBe(.012)
    expect(SHIELD_REGEN_FLOOR_PCT).toBe(.006)
  })

  it.each([1, 1000, 1501])('容量%s只用现行参数，被动不反推旧血量、半盾以下下限生效', cap => {
    for (const fraction of [0, .001, .1, .5, .75, .999, 1]) {
      const w = world('shield-charge')
      delete w.battle.shieldChargeBy
      delete w.battle.shieldCharge
      w.battle.units.player!.hpMax!.s = cap
      w.battle.units.player!.hp.s = cap * fraction
      const local = { ...w.local, balance: { ...w.local.balance, battle: { ...w.local.balance.battle, shieldRegenPerSec: .012 } } }
      const before = cap * fraction
      const rate = fraction === 0 ? 0 : Math.max(before * .012, cap * .006)
      w.state.gameMs = 10
      advanceBattleFor(w.state, local, w.battle, w.ids[0]!, 'ano-training')
      expect(w.battle.units.player!.hp.s).toBeCloseTo(Math.min(cap, before + rate * .01), 9)
    }
  })
})

describe('在途护盾比例更新保留血量、冷却和随档账本', () => {
  it.each(['shield-charge', 'shield-field'] as const)('%s逐型号旧比例更新，不提前发动且后续使用现行衰减', kind => {
    const w = world(kind)
    const initial = kind === 'shield-charge' ? w.battle.shieldChargeBy!.player! : w.battle.shieldFieldBy!.player!
    initial.streams.forEach((stream, i) => { stream.pct = .9; stream.nextPulseAtMs = 100 + i * 100 })
    initial.pulses = 3
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: w.battle }
    const state = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const battle = state.expedition.battle!
    const ledger = kind === 'shield-charge' ? battle.shieldChargeBy!.player! : battle.shieldFieldBy!.player!
    const current = (kind === 'shield-charge' ? shieldChargeStreamsOf : shieldFieldStreamsOf)(state, w.local, w.ids[0]!)
    const hpBefore = structuredClone(battle.units)
    state.gameMs = 90
    advanceBattleFor(state, w.local, battle, w.ids[0]!, 'ano-training')
    expect(ledger.streams.map(s => s.pct)).toEqual(current.map(s => s.pct))
    expect(ledger.streams.map(s => s.nextPulseAtMs)).toEqual([100, 200])
    expect(ledger.pulses).toBe(3)
    for (const tag of Object.keys(hpBefore)) expect(battle.units[tag]!.hp).toEqual(hpBefore[tag]!.hp)
    state.gameMs = 100
    advanceBattleFor(state, w.local, battle, w.ids[0]!, 'ano-training')
    expect(ledger.pulses).toBe(4)
    expect(ledger.streams[0]!.nextPulseAtMs).toBe(100 + current[0]!.ms)
    expect(ledger.streams[1]!.nextPulseAtMs).toBe(200)
    state.gameMs = 200
    advanceBattleFor(state, w.local, battle, w.ids[0]!, 'ano-training')
    const gain = current.reduce((sum, s) => sum + Math.ceil(1500 * s.pct), 0)
    expect(battle.units.player!.hp.s).toBeCloseTo(kind === 'shield-charge' ? gain : 750 - 2 * Math.ceil(1500 * .067), 9)
    expect(battle.units['ally-1']!.hp.s).toBeCloseTo(kind === 'shield-field' ? gain : 0, 9)
    expect(ledger.pulses).toBe(5)
    expect(ledger.streams.map(s => s.nextPulseAtMs)).toEqual(current.map((s, i) => 100 + i * 100 + s.ms))
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(back.units).toEqual(battle.units)
    expect(kind === 'shield-charge' ? back.shieldChargeBy : back.shieldFieldBy).toEqual(kind === 'shield-charge' ? battle.shieldChargeBy : battle.shieldFieldBy)
  })

  it.each(['shield-charge', 'shield-field'] as const)('%s旧空型号合并流保留单路时钟，视图只读现行合计', kind => {
    const w = world(kind)
    const ledger: BattleShieldChargeLedger = { streams: [{ modelId: '', pct: .9, ms: 99000, nextPulseAtMs: 100 }], pulses: 2 }
    if (kind === 'shield-charge') {
      w.battle.shieldCharge = ledger
      delete w.battle.shieldChargeBy
    } else w.battle.shieldFieldBy!.player = ledger
    const current = (kind === 'shield-charge' ? shieldChargeStreamsOf : shieldFieldStreamsOf)(w.state, w.local, w.ids[0]!)
    const combined = current.reduce((sum, s) => sum + s.pct, 0)
    const spec = createPlayerSpec(w.state, w.local, w.ids[0]!)!
    const snapshot = structuredClone(w.battle)
    const view = battleDeviceCyclesOf(w.state, w.local, w.battle, [{ spec, shipId: w.ids[0]!, name: spec.name }],
      () => ({ boosting: false, remainMs: 0, cycleMs: 0, posMs: 0 })).find(row => row.kind === kind)!
    expect(view.effectPct).toBeCloseTo(combined * 100, 10)
    expect(view.remainingMs).toBe(100)
    expect(w.battle).toEqual(snapshot)
    w.state.gameMs = 100
    advanceBattleFor(w.state, w.local, w.battle, w.ids[0]!, 'ano-training')
    expect(ledger.streams).toHaveLength(1)
    expect(ledger.streams[0]!.pct).toBeCloseTo(combined, 10)
    expect(ledger.streams[0]!.nextPulseAtMs).toBe(100 + Math.min(...current.map(s => s.ms)))
    expect(ledger.pulses).toBe(3)
    expect(w.battle.units.player!.hp.s).toBeCloseTo(kind === 'shield-charge' ? Math.ceil(1500 * combined) : 750 - Math.ceil(1500 * .067), 9)
    expect(w.battle.units['ally-1']!.hp.s).toBeCloseTo(kind === 'shield-field' ? Math.ceil(1500 * combined) : 0, 9)
  })
})
