import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, fitModule, loadSaveFile, serializeSaveFile } from '../src/index'
import { createPlayerSpec, createFoeSpecs, createBattleState, advanceBattleFor, battleArcsFor, applyMeWebDebuff } from '../src/combat'
import { weightedSum } from '../src/equipment'
import { battleSpeedBonusOf } from '../src/alienEquipment'
import { unitSpeedMulOf } from '../src/combat/movement'
import { anomaly, makeTestCtx, ship } from './helpers'

const ctx = buildSimContext()
const pulse = 'mod-wh-c-pulse', frame = 'mod-wh-c-frame', ramp = 'mod-alien-pressure-chamber'

function world(ids: string[]) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261103 })
  const uid = addShipToFleet(state, 'sh-wh-e-carrier')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  for (const id of ids) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(fitModule(state, id, ctx, { shipId: uid }).ok, id).toBe(true)
  }
  const spec = createPlayerSpec(state, ctx, uid)!
  const battle = createBattleState(spec, [{ ...spec, tag: 'foe-0', side: 'foe' }], 0, 2000)
  battle.distanceM = 2000
  return { state, uid, spec, battle }
}

describe('非推进器速度独立于点火周期', () => {
  it.each([[pulse, .1], [frame, .05]] as const)('%s无推进器时全程持续生效，不产生推进器标记', (id, bonus) => {
    const w = world([id])
    expect(w.spec.thrusterBoost).toBeUndefined()
    expect(w.spec.thrusterBoostMs).toBeUndefined()
    for (const now of [0, 10000, 59999, 60000, 119999, 120000]) {
      w.battle.lastTickGameMs = now
      expect(unitSpeedMulOf(w.spec, w.battle, ctx.balance.battle, 'me'), String(now)).toBeCloseTo(1 + bonus)
    }
  })

  it.each(['mod-prop-2', 'mod-mwd-1'])('混装%s时仅推进器周期启停，持续件仍沿同池折权', id => {
    const w = world([id, pulse, frame])
    const propulsion = ctx.modules.get(id)!
    const boostMs = propulsion.thrusterBoostMs ?? ctx.balance.battle.thrusterBoostMs
    const cooldownMs = propulsion.thrusterCooldownMs ?? ctx.balance.battle.thrusterCooldownMs
    const full = 1 + weightedSum([propulsion.speedBonusPct!, .1, .05])
    const sustained = 1 + weightedSum([.1, .05])
    expect(w.spec.thrusterBoost).toBeCloseTo(propulsion.speedBonusPct!)
    for (const [now, expected] of [[0, full], [boostMs - 1, full], [boostMs, sustained], [boostMs + cooldownMs - 1, sustained], [boostMs + cooldownMs, full]]) {
      w.battle.lastTickGameMs = now!
      expect(unitSpeedMulOf(w.spec, w.battle, ctx.balance.battle, 'me'), String(now)).toBeCloseTo(expected!)
    }
  })

  it('重复持续件仍多装递减，增压腔按原时间增长并在推进器冷却期保留', () => {
    const w = world(['mod-mwd-1', pulse, pulse, frame, ramp])
    const prop = ctx.modules.get('mod-mwd-1')!.speedBonusPct!
    for (const [now, pressure] of [[0, .05], [30000, .20], [60000, .35], [90000, .35]]) {
      w.battle.lastTickGameMs = now!
      expect(battleSpeedBonusOf(w.spec, w.battle, true)).toBeCloseTo(weightedSum([prop, .1, .1, .05, pressure!]))
      expect(battleSpeedBonusOf(w.spec, w.battle, false)).toBeCloseTo(weightedSum([.1, .1, .05, pressure!]))
    }
  })

  it('捕获网停机只移除推进器，持续件保留且整船减速仍生效，重建规格不污染装配', () => {
    const w = world(['mod-prop-2', pulse, frame, ramp])
    w.battle.lastTickGameMs = 60000
    const before = structuredClone(w.state.fleet[w.uid]!.fitted)
    const baseSpeed = w.spec.speedMps
    applyMeWebDebuff(w.spec, { byTag: 'foe-0', slowMul: .5, noThruster: true, noEvasion: true, rangeDownM: 0, atMs: 0 })
    expect(w.spec.thrusterBoost).toBe(0)
    expect(w.spec.speedBonusModules!.every(mod => mod.slot !== 'propulsion')).toBe(true)
    expect(battleSpeedBonusOf(w.spec, w.battle, true)).toBeCloseTo(weightedSum([.1, .05, .35]))
    expect(w.spec.speedMps).toBeCloseTo(baseSpeed * .5)
    expect(w.state.fleet[w.uid]!.fitted).toEqual(before)
    const restored = createPlayerSpec(w.state, ctx, w.uid)!
    expect(battleSpeedBonusOf(restored, w.battle, true)).toBeCloseTo(weightedSum([.6, .1, .05, .35]))
  })

  it('跨波和存档往返不丢持续收益，重建后仅原推进器继续按原相位启停', () => {
    const w = world(['mod-mwd-1', pulse, frame])
    w.battle.lastTickGameMs = 30000
    w.battle.waveIdx = 2
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: w.battle }
    const loaded = loadSaveFile(serializeSaveFile(w.state)).state
    const spec = createPlayerSpec(loaded, ctx, w.uid)!
    const battle = loaded.expedition.battle!
    expect(battle.waveIdx).toBe(2)
    expect(unitSpeedMulOf(spec, battle, ctx.balance.battle, 'me')).toBeCloseTo(1 + weightedSum([.1, .05]))
    expect(serializeSaveFile(loaded)).not.toContain('speedBonusModules')
  })

  it('真战斗步进、速度面板和推进器标记对持续件保持一致', () => {
    const testCtx = makeTestCtx({ quietEvents: true,
      ships: [ship('speed-bed', { shieldHp: 1e8, armorHp: 1e8, hullHp: 1e8, maxSpeedMps: 100, cpu: 1000, slots: { high: 0, mid: 1, low: 2 } })],
      modules: [ctx.modules.get(pulse)!, ctx.modules.get(frame)!, ctx.modules.get('mod-mwd-1')!],
      anomalies: [{ ...anomaly('speed-test', 'galaxy-hub'), foeHpOverride: 1e8, foeShotDmg: 0, foeSpeedMps: 0 }],
    })
    for (const mixed of [false, true]) {
      const state = createInitialState({ nowWallMs: 0, seed: 20261103 })
      state.fleet[state.shipId]!.fitted = { high: [], mid: mixed ? ['mod-mwd-1'] : [], low: [pulse, frame] }
      const spec = createPlayerSpec(state, testCtx, state.shipId)!
      const card = testCtx.anomalies.get('speed-test')!
      const battle = createBattleState(spec, createFoeSpecs(card, testCtx.balance.battle), 0, 2000)
      for (const now of [0, 30000, 65000, 70000]) {
        battle.lastTickGameMs = now
        state.gameMs = now + 10
        advanceBattleFor(state, testCtx, battle, state.shipId, card.id)
        const boosting = mixed && (now === 0 || now === 70000)
        const values = boosting ? [ctx.modules.get('mod-mwd-1')!.speedBonusPct!, .1, .05] : [.1, .05]
        expect(battle.meSpeedMps, `${mixed}:${now}`).toBe(Math.round(spec.speedMps * (1 + weightedSum(values))))
        const arcs = battleArcsFor(state, testCtx, { battle, anomaly: card, leaderShipId: state.shipId })!
        expect(arcs.myUnits[0]!.boosting, `${mixed}:${now}`).toBe(boosting)
      }
    }
  })
})
