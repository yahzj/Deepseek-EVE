import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { adjustDroneLoad, fitModule } from '../src/equipment'
import { createPlayerSpec } from '../src/combat/player/create'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { advanceBattleFor } from '../src/combat/advance'
import { pulseRepairDroneFor, repairStatsFor, pulseShieldChargeFor, pulseShieldFieldFor, repairUsageText } from '../src/combat/combatRepair'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const droneId = 'drone-repair-mil'
const cardId = 'ano-voidedge-warden'

function world(count = 2) {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  state.fleet = {}
  const lead = addShipToFleet(state, 'sh-wh-g-destroyer')
  const wing = addShipToFleet(state, 'sh-hammerhead')
  const other = addShipToFleet(state, 'sh-hammerhead')
  state.shipId = lead
  state.warehouse.items[droneId] = 10
  state.warehouse.items['repairkit-mil'] = 100
  expect(adjustDroneLoad(state, ctx, droneId, count, lead).ok).toBe(true)
  const battle = startFleetBattleFor(state, ctx, [lead, wing, other], cardId, 0)!
  state.encounter = { ...state.encounter, active: true, shipId: lead, anomalyId: cardId, galaxyId: 'galaxy-voidedge', battle }
  for (const unit of Object.values(battle.units)) {
    if (unit.side === 'foe') unit.weapons.fill(1_000_000)
  }
  const spec = createPlayerSpec(state, ctx, lead)!
  const droneIndexes = spec.weapons.flatMap((w, i) => w.repairDrone ? [i] : [])
  for (let i = 0; i < battle.units.player!.weapons.length; i++) if (!droneIndexes.includes(i)) battle.units.player!.weapons[i] = 1_000_000
  for (const tag of ['ally-1', 'ally-2']) battle.units[tag]!.weapons.fill(1_000_000)
  return { state, lead, wing, other, battle, droneIndexes }
}

function advance(state: ReturnType<typeof world>['state'], ms: number) {
  state.gameMs += ms
  advanceBattleFor(state, ctx, state.encounter.battle!, state.shipId, cardId)
}

describe('修理无人机与后勤输出', () => {
  it('40m³和8CPU进入正式装载校验，80m³后勤可装2架而不能装3架', () => {
    const { state, lead } = world()
    expect(ctx.ships.get('sh-wh-g-destroyer')!.droneBayM3).toBe(80)
    expect(ctx.ships.get('sh-wh-g-destroyer')!.repairOutputBonusPct).toBe(.5)
    expect(ctx.ships.get('sh-wh-g-destroyer')!.repairPulseTargetsFleet).toBeUndefined()
    expect(ctx.items.get(droneId)).toMatchObject({ unitM3: 40, cpuUse: 8, repairIntervalMs: 10000 })
    state.encounter.active = false
    expect(adjustDroneLoad(state, ctx, droneId, 1, lead).ok).toBe(false)
    expect(state.fleet[lead]!.droneLoad![droneId]).toBe(2)
    expect([...ctx.ships.values()].filter(s => s.repairOutputBonusPct).map(s => s.id)).toEqual(['sh-wh-g-destroyer'])
  })

  it('每架独立脉冲、每次扣1组件，后勤甲壳各15，零武器伤害和攻击统计', () => {
    const { state, battle, droneIndexes } = world()
    const target = battle.units['ally-1']!
    target.hp.a -= 100; target.hp.h -= 100
    const before = { ...target.hp }
    advance(state, 9900)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
    advance(state, 1200)
    expect(target.hp.a - before.a).toBe(30)
    expect(target.hp.h - before.h).toBe(30)
    expect(state.warehouse.items['repairkit-mil']).toBe(98)
    expect(battle.stats.meShots).toBe(0)
    expect(battle.repairDroneBy!.player!.kitsUsed).toBe(2)
    expect(repairUsageText(battle, ctx)).toContain('×2')
    expect(droneIndexes.every(i => battle.dronePools![`player:${i}`]!.launched)).toBe(true)
  })

  it('逐架重新选靶，甲壳满/仅盾伤/尸体/母舰均不消耗组件', () => {
    const { state, battle, lead, wing, other } = world()
    const specs = [lead, wing, other].map((id, index) => ({ ...createPlayerSpec(state, ctx, id)!, tag: index ? `ally-${index}` : 'player' }))
    const repair = specs[0]!.weapons.find(w => w.repairDrone)!.repairDrone!
    battle.units.player!.hp.a = 0
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    battle.units['ally-2']!.hp.s = 0
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
    battle.units['ally-1']!.hp = { ...battle.units['ally-1']!.hpMax!, a: battle.units['ally-1']!.hpMax!.a - 5 }
    battle.units['ally-2']!.hp.a -= 10
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    expect(state.warehouse.items['repairkit-mil']).toBe(98)
    expect(battle.units['ally-1']!.hp.a).toBe(battle.units['ally-1']!.hpMax!.a)
    expect(battle.units['ally-2']!.hp.a).toBe(battle.units['ally-2']!.hpMax!.a)
  })

  it('无人机被击落或母舰阵亡均停修，无料不修且不扣空账', () => {
    const { state, battle, droneIndexes } = world()
    battle.units['ally-1']!.hp.a -= 100
    for (const i of droneIndexes) battle.dronePools![`player:${i}`]!.alive = false
    advance(state, 12000)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
    for (const i of droneIndexes) battle.dronePools![`player:${i}`]!.alive = true
    state.warehouse.items['repairkit-mil'] = 0
    const before = battle.units['ally-1']!.hp.a
    advance(state, 12000)
    expect(battle.units['ally-1']!.hp.a).toBe(before)
    state.warehouse.items['repairkit-mil'] = 10
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    advance(state, 12000)
    expect(state.warehouse.items['repairkit-mil']).toBe(10)
  })

  it('关闭仓库补给仅扣母舰货仓', () => {
    const { state, battle, lead, wing } = world(1)
    const specs = [lead, wing].map((id, i) => ({ ...createPlayerSpec(state, ctx, id)!, tag: i ? 'ally-1' : 'player' }))
    const repair = specs[0]!.weapons.find(w => w.repairDrone)!.repairDrone!
    battle.units['ally-1']!.hp.a -= 100
    state.resupplyFromWarehouse = false
    state.fleet[lead]!.cargo['repairkit-mil'] = 1
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    expect(state.fleet[lead]!.cargo['repairkit-mil'] ?? 0).toBe(0)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
  })

  it('维修技能与后勤加成乘算，攻击伤害技能不增加修理量', () => {
    const { state, lead } = world(1)
    state.skills.trained['hull-quick-repair'] = 5
    state.skills.trained['repair-engineering'] = 5
    state.skills.trained['drone-warfare'] = 5
    state.skills.trained['drone-strike'] = 5
    const drone = createPlayerSpec(state, ctx, lead)!.weapons.find(w => w.repairDrone)!
    expect(drone.repairDrone).toMatchObject({ armor: 23, hull: 23 })
    expect(drone.reloadMs).toBe(10000)
    expect(drone.shotDmg).toBe(0)
  })

  it('信号空间脉冲仅扣本趟组件，缺料不回退母港仓库', () => {
    const { state, battle, lead, wing } = world(1)
    const specs = [lead, wing].map((id, i) => ({ ...createPlayerSpec(state, ctx, id)!, tag: i ? 'ally-1' : 'player' }))
    const repair = specs[0]!.weapons.find(w => w.repairDrone)!.repairDrone!
    battle.units['ally-1']!.hp.a -= 100
    battle.wormhole = { cardId: 'wh-exile-blockade', depth: 1, kind: 'node', waves: 1 }
    const run = { fleet: [lead, wing], supplyVersion: 1, supplies: { items: { 'repairkit-mil': 1 }, carried: {}, consumed: {}, deployed: {}, recovered: {}, leftBehind: {}, found: {} } }
    state.wormhole.run = run as unknown as NonNullable<typeof state.wormhole.run>
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    expect(run.supplies.consumed).toEqual({ 'repairkit-mil': 1 })
    const before = battle.units['ally-1']!.hp.a
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    expect(battle.units['ally-1']!.hp.a).toBe(before)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
  })

  it('战中回读保留机体、冷却和组件账，在线分步与离线预算续算一致', () => {
    const { state } = world()
    state.encounter.battle!.units['ally-1']!.hp.a -= 100
    advance(state, 11500)
    const restored = loadSaveFile(serializeSaveFile(state)).state
    expect(restored.encounter.battle!.repairDroneBy).toEqual(state.encounter.battle!.repairDroneBy)
    expect(restored.encounter.battle!.dronePools).toEqual(state.encounter.battle!.dronePools)
    for (let i = 0; i < 150; i++) advance(state, 100)
    advance(restored, 15000)
    expect(restored.encounter.battle!.units).toEqual(state.encounter.battle!.units)
    expect(restored.warehouse).toEqual(state.warehouse)
    expect(restored.encounter.battle!.repairDroneBy).toEqual(state.encounter.battle!.repairDroneBy)
  })

  it('后勤维修装置只修自身，加成同步作用于自回盾和盾投送，费用不加成', () => {
    const { state, lead, battle } = world(1)
    state.encounter.active = false
    state.moduleBay['mod-hullrep-1'] = 1
    expect(fitModule(state, 'mod-hullrep-1', ctx, { shipId: lead }).ok).toBe(true)
    expect(repairStatsFor(state, ctx, lead)!.units[0]!.armorPerPulse).toBe(15)
    const spec = createPlayerSpec(state, ctx, lead)!
    battle.units.player!.hp.s = 0
    pulseShieldChargeFor(battle, spec, { streams: [{ modelId: '', pct: .1, ms: 15000 }], pulses: 0 })
    expect(battle.units.player!.hp.s).toBe(Math.ceil(spec.hp.s * .15))
    battle.units.player!.hp.s = spec.hp.s
    const ally = { ...spec, tag: 'ally-1' }
    battle.units['ally-1']!.hp.s = 0
    pulseShieldFieldFor(battle, [spec, ally], { pct: .1 }, spec)
    expect(battle.units['ally-1']!.hp.s).toBe(Math.ceil(spec.hp.s * .15))
  })
})
