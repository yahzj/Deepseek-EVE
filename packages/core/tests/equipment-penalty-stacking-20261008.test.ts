import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { equipmentPenaltiesOf, fittedPenaltyPartsOf, stackWeight, cpuBudgetOf, addModule, fitModule } from '../src/equipment'
import { advanceBattleFor, createPlayerSpec, startFleetBattleFor } from '../src/combat'
import { fittedEffectParamsOf } from '../src/foeRange'
import { repairStatsFor, shieldChargeStreamsOf, shieldFieldStreamsOf, SHIELD_PULSE_MS } from '../src/combatRepair'
import { droneReviveCyclesOf, resolveDroneRevive } from '../src/droneRevive'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const CPU = 'mod-wh-e-cpu'

/** 足量测试槽与CPU只用于隔离叠加算法，非玩家配装推荐。 */
function world(high: string[] = ['mod-turret-kin-2'], mid: string[] = [], low: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: 33 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high, mid, low }
  state.fleet[uid]!.droneLoad = { 'drone-exile-bee': 1 }
  state.warehouse.items['repairkit-mil'] = 500
  for (const type of ['kinetic', 'explosive', 'plasma']) state.warehouse.items[`ammo-${type}-l`] = 50_000
  const local = { ...ctx, ships: new Map(ctx.ships), balance: { ...ctx.balance, battle: { ...ctx.balance.battle, shieldRegenPerSec: 0 } } }
  local.ships.set('sh-megalodon', { ...ctx.ships.get('sh-megalodon')!, cpu: 10_000, slots: { high: 12, mid: 12, low: 12 } })
  const spec = () => createPlayerSpec(state, local, uid)!
  return { state, uid, local, spec }
}

describe('装备负面累计与收益递减', () => {
  it('真实T4玄武六低槽合法安装五件巨构，首位保留而代价完整累计', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13 })
    const uid = addShipToFleet(state, 'sh-xuanwu')
    state.shipId = uid
    const ship = ctx.ships.get('sh-xuanwu')!
    expect(ship.tier).toBe(4)
    expect(ship.slots!.low).toBe(6)
    const base = cpuBudgetOf(state, ctx, uid)
    expect(base).toBe(ship.cpu)
    for (let i = 0; i < 5; i++) {
      addModule(state, CPU)
      expect(fitModule(state, CPU, ctx, { shipId: uid, rack: 'low', index: i + 1 }).ok).toBe(true)
    }
    expect(state.fleet[uid]!.fitted.low).toEqual([null, ...Array(5).fill(CPU)])
    expect(state.fleet[uid]!.plugs ?? []).toEqual([])
    expect(cpuBudgetOf(state, ctx, uid)).toBe(base + 450)
    expect(equipmentPenaltiesOf(state, ctx, uid).reload).toBeCloseTo(1.05 ** 5, 12)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(equipmentPenaltiesOf(back, ctx, uid)).toEqual(equipmentPenaltiesOf(state, ctx, uid))
    expect(back.fleet[uid]!.fitted.low).toEqual(state.fleet[uid]!.fitted.low)
    expect(back.fleet[uid]!.plugs ?? []).toEqual([])
    expect(cpuBudgetOf(back, ctx, uid)).toBe(base + 450)
  })
  it.each([0, 1, 2, 3, 5])('%s件巨构：5%逐件相乘，武器/基础炮/无人机/动态下限都生效', n => {
    const high = ['mod-turret-kin-2', 'mod-missile-2', 'mod-lair-laser-r']
    const a = world(high), b = world(high, [], Array(n).fill(CPU))
    const factor = 1.05 ** n
    expect(equipmentPenaltiesOf(b.state, b.local, b.uid).reload).toBeCloseTo(factor, 12)
    expect(cpuBudgetOf(b.state, b.local, b.uid) - cpuBudgetOf(a.state, a.local, a.uid)).toBe(n * 90)
    for (const [i, w] of a.spec().weapons.entries()) {
      const after = b.spec().weapons[i]!
      expect(after.reloadMs, `${w.src}周期`).toBe(Math.round(w.reloadMs * factor))
      if (w.overlayDrive) {
        expect(after.overlayDrive!.floorMs).toBe(Math.round(w.overlayDrive.floorMs * factor))
        expect(after.overlayDrive!.stepMs).toBeCloseTo(w.overlayDrive.stepMs * factor)
      }
    }
  })

  it('普通协处理器无周期代价，技能和射速修正不改变负面乘区', () => {
    const a = world(undefined, [], ['mod-cpu-3', 'mod-rof-3'])
    const b = world(undefined, [], ['mod-cpu-3', 'mod-rof-3', CPU, CPU])
    for (const s of [a.state, b.state]) { s.skills.trained['reload-drills'] = 5; s.skills.trained['drone-servicing'] = 5 }
    expect(equipmentPenaltiesOf(a.state, a.local, a.uid).reload).toBe(1)
    const gun = (w: typeof a) => w.spec().weapons.find(p => p.src === 'turret')!
    expect(gun(b).reloadMs).toBe(Math.round(gun(a).reloadMs * 1.05 ** 2))
  })

  it('全额容量族速度/射程负面逐件相乘，不新增收益递减', () => {
    const a = world(), b = world(undefined, ['mod-wh-a-shield', 'mod-wh-a-shield'], ['mod-lair-armor-d', 'mod-lair-armor-d'])
    const penalties = equipmentPenaltiesOf(b.state, b.local, b.uid)
    expect(penalties.speed).toBe(.75 ** 2)
    expect(penalties.range).toBe(.75 ** 2)
    expect(b.spec().speedMps / a.spec().speedMps).toBe(.75 ** 2)
    expect(b.spec().hp.s / a.spec().hp.s).toBeCloseTo(1 + 2 * .8)
    expect(b.spec().hp.a / a.spec().hp.a).toBeCloseTo(1 + 2 * 1.1)
  })

  it('推进器混装按收益强度排位，负面不另排位；反转槽顺序合计不变', () => {
    const a = world(undefined, ['mod-prop-3', 'mod-mwd-3'])
    const b = world(undefined, ['mod-mwd-3', 'mod-prop-3'])
    const p = equipmentPenaltiesOf(a.state, a.local, a.uid)
    expect(p.hit).toBeCloseTo(.6 * (1 - .2 * stackWeight(2)), 12)
    expect(equipmentPenaltiesOf(b.state, b.local, b.uid)).toEqual(p)
    const parts = fittedPenaltyPartsOf(a.state, a.local, a.uid)
    expect(parts.find(x => x.mod.id === 'mod-mwd-3')!.weight).toBe(1)
    expect(parts.find(x => x.mod.id === 'mod-prop-3')!.weight).toBe(stackWeight(2))
    const view = fittedEffectParamsOf(a.state, a.local, a.uid, ctx.modules.get('mod-prop-3')!, 1)
    expect(view.find(v => v.key === 'speed')!.eff).toBeCloseTo(stackWeight(2))
    expect(view.find(v => v.key === 'hitPenalty')!.eff).toBeCloseTo(.2 * stackWeight(2))
  })

  it('同族无负面件参与收益排位，已装负面参数与建档一致', () => {
    const w = world(undefined, ['mod-wh-a-scan', 'mod-track-3'])
    const scan = w.local.modules.get('mod-wh-a-scan')!
    const actual = fittedEffectParamsOf(w.state, w.local, w.uid, scan, 1).find(p => p.key === 'rangePenalty')!
    expect(actual.eff).toBe(.15)
    w.state.fleet[w.uid]!.fitted.mid = ['mod-wh-a-scan', 'mod-wh-a-scan', 'mod-track-3']
    const second = fittedEffectParamsOf(w.state, w.local, w.uid, scan, 2).find(p => p.key === 'rangePenalty')!
    expect(second.eff).toBeCloseTo(.15 * stackWeight(2))
    expect(equipmentPenaltiesOf(w.state, w.local, w.uid).range).toBeCloseTo(.85 * (1 - second.eff))
  })

  it('抗性仍逐件减百分点，缺口收益的边际权重同时折减负面', () => {
    const w = world(undefined, [], ['mod-wh-a-coat', 'mod-wh-a-coat', 'mod-wh-a-coat'])
    const sum = .15 * (1 + .72 + .72 ** 2)
    expect(equipmentPenaltiesOf(w.state, w.local, w.uid).resist).toBeCloseTo(sum, 12)
    expect(w.spec().resists.hull!.kinetic).toBeCloseTo(-sum)
    const eff = fittedEffectParamsOf(w.state, w.local, w.uid, ctx.modules.get('mod-wh-a-coat')!, 3).find(p => p.key === 'resistPenalty')!
    expect(eff.eff).toBeCloseTo(.15 * .72 ** 2)
    const before = w.spec().resists.hull!.kinetic!
    const back = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(createPlayerSpec(back, w.local, w.uid)!.resists.hull!.kinetic).toBe(before)
  })

  it('混装闪避件按同一收益池折减，不含技能/船体基础', () => {
    const w = world(undefined, ['mod-gyro-3'], ['mod-wh-a-coat', 'mod-wh-a-coat'])
    const p = equipmentPenaltiesOf(w.state, w.local, w.uid)
    expect(p.resist).toBeCloseTo(.15 + .15 * .72)
    w.state.skills.trained['evasive-maneuvering'] = 5
    expect(equipmentPenaltiesOf(w.state, w.local, w.uid)).toEqual(p)
  })
})

describe('全战斗主动周期和在途计时', () => {
  it.each([1, 2])('%s件巨构：充能/力场/维修/捕获网/储备甲板均乘一次', n => {
    const w = world(['mod-shieldfield-2', 'mod-drone-deck-3'], ['mod-shieldchg-2', 'mod-hullrep-2', 'mod-lair-web-h'], Array(n).fill(CPU))
    const factor = 1.05 ** n
    expect(repairStatsFor(w.state, w.local, w.uid)!.intervalMs).toBe(Math.round(5000 * factor))
    expect(shieldFieldStreamsOf(w.state, w.local, w.uid)[0]!.ms).toBe(Math.round(10000 * factor))
    expect(shieldChargeStreamsOf(w.state, w.local, w.uid)[0]!.ms).toBe(Math.round(SHIELD_PULSE_MS * factor))
    expect(droneReviveCyclesOf(w.state, w.local, w.uid)[0]).toBe(Math.round(9000 * factor))
    expect(w.spec().myCaptureWeb!.cycleMs).toBe(Math.round(ctx.modules.get('mod-lair-web-h')!.captureWebCycleMs! * factor))
  })

  it('逐舰周期各自计算，首跳与后续跳一致，往返不重复惩罚或重置进度', () => {
    const w = world(['mod-shieldfield-2'], ['mod-hullrep-2'], [CPU, CPU])
    const other = addShipToFleet(w.state, 'sh-megalodon')
    w.state.fleet[other]!.fitted = { high: ['mod-shieldfield-2'], mid: ['mod-hullrep-2'], low: [] }
    const b = startFleetBattleFor(w.state, w.local, [w.uid, other], 'ano-training', 0, 5000)!
    expect(b.repairBy!.player!.units[0]!.nextPulseAtMs).toBe(5513)
    expect(b.shieldFieldBy!.player!.streams[0]!.nextPulseAtMs).toBe(11025)
    const allyTag = b.myFleet!.find(e => e.shipId === other)!.tag
    expect(b.repairBy![allyTag]!.units[0]!.nextPulseAtMs).toBe(5000)
    for (const u of Object.values(b.units)) u.weapons = u.weapons.map(() => 100_000)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    w.state.gameMs = 6000
    advanceBattleFor(w.state, w.local, b, w.uid, 'ano-training')
    const at = b.repairBy!.player!.units[0]!.nextPulseAtMs
    expect(at).toBe(11026) // 每跳5513毫秒，逐跳取整而不是整段取整。
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const bb = loaded.expedition.battle!
    expect(bb.repairBy!.player!.units[0]!.nextPulseAtMs).toBe(at)
    loaded.gameMs = 12_000
    advanceBattleFor(loaded, w.local, bb, w.uid, 'ano-training')
    expect(bb.repairBy!.player!.units[0]!.nextPulseAtMs).toBe(16539)
    expect(bb.shieldFieldBy!.player!.streams[0]!.ms).toBe(11025)
  })

  it('旧在途护盾截止时刻保留，只将后续间隔更新到当前参数', () => {
    const w = world(['mod-shieldfield-2'], ['mod-shieldchg-2'], [CPU])
    const b = startFleetBattleFor(w.state, w.local, [w.uid], 'ano-training', 0, 5000)!
    const stream = b.shieldFieldBy!.player!.streams[0]!
    stream.ms = 10000; stream.nextPulseAtMs = 10000
    for (const u of Object.values(b.units)) u.weapons = u.weapons.map(() => 100_000)
    w.state.gameMs = 5000
    advanceBattleFor(w.state, w.local, b, w.uid, 'ano-training')
    expect(stream.nextPulseAtMs).toBe(10000)
    expect(stream.ms).toBe(10500)
    w.state.gameMs = 10_000
    advanceBattleFor(w.state, w.local, b, w.uid, 'ano-training')
    expect(stream.nextPulseAtMs).toBe(20500)
  })

  it('储备甲板在途周期截止时刻不重置，新周期读当前代价且往返不再放大', () => {
    const w = world(['mod-drone-deck-3'], [], [CPU, CPU])
    w.state.fleet[w.uid]!.droneLoad = { 'drone-exile-bee': 2 }
    w.state.warehouse.items['drone-exile-bee'] = 2
    const b = startFleetBattleFor(w.state, w.local, [w.uid], 'ano-training', 0, 5000)!
    const e = b.droneRevive!.player!
    const lost = Object.entries(b.dronePools!).filter(([, p]) => p.owner === 'player')
    expect(lost).toHaveLength(2)
    for (const [key, p] of lost) {
      Object.assign(p, { alive: false, s: 0, a: 0, h: 0 })
      e.q.push(key)
    }
    e.c = [9000]; e.t = [9000]
    resolveDroneRevive(w.state, w.local, b, 4000)
    expect(e.c).toEqual([9923])
    expect(e.t).toEqual([9000])
    resolveDroneRevive(w.state, w.local, b, 9000)
    expect(e.v['drone-exile-bee']).toBe(1)
    expect(e.t).toEqual([18923])
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const bb = loaded.expedition.battle!
    resolveDroneRevive(loaded, w.local, bb, 18923)
    expect(bb.droneRevive!.player!.c).toEqual([9923])
    expect(bb.droneRevive!.player!.v['drone-exile-bee']).toBe(2)
    expect(bb.droneRevive!.player!.t).toEqual([undefined])
    expect(loaded.warehouse.items['drone-exile-bee']).toBe(2)
  })

  it('叠光炮真实开火达到惩罚后的下限，连射间隔与推进器周期不改', () => {
    const w = world(['mod-lair-laser-r', 'mod-lair-beam-r'], ['mod-mwd-3'], [CPU, CPU])
    const card = { ...w.local.anomalies.get('ano-training')!, id: 'penalty-overlay-bed', threat: 60, ships: [{
      ship: { id: 'penalty-foe', name: '试验敌舰', family: 'A' as const, hullClassTier: 1 as const, hp: 1_000_000,
        shotDmg: 1, reloadMs: 5000, rangeMinM: 1, rangeMaxM: 3000, speedRatio: 0, tactic: 'orbit' as const,
        dmgMix: { kinetic: 10 }, split: { s: 0, a: 1, h: 0 }, falloff: 1, hitRate: 1 }, count: 1,
    }] }
    w.local.anomalies = new Map([...w.local.anomalies, [card.id, card]])
    const b = startFleetBattleFor(w.state, w.local, [w.uid], card.id, 0, 2500)!
    for (let t = 100; t <= 120_000; t += 100) { w.state.gameMs = t; advanceBattleFor(w.state, w.local, b, w.uid, card.id) }
    expect(Object.values(b.meOverlayReload ?? {}).some(v => v.r === Math.round(600 * 1.05 ** 2))).toBe(true)
    expect(w.spec().weapons.find(p => p.burst)!.burst!.gapMs).toBe(ctx.modules.get('mod-lair-beam-r')!.burst!.gapMs)
    expect(w.spec().thrusterCooldownMs).toBe(ctx.modules.get('mod-mwd-3')!.thrusterCooldownMs)
  })
})
