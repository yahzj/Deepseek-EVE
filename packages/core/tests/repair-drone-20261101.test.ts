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
import { rarityTierOf } from '../../data/src/rarityTier'
import { resolvePointDefense } from '../src/combat/combatDrones'
import { createFoeSpecs } from '../src/foeSpecs'
import { ceilFinalQuantity } from '../src/quantity'
import { planBattleFx } from '../../../apps/desktop/src/renderer/src/features/combat/battleSfxPlan'

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
  it('军用修理无人机仍为R2，修理量与周期同时翻倍，价格不变', () => {
    expect(rarityTierOf(droneId)).toBe(2)
    expect(ctx.marketGoods.get(droneId)).toMatchObject({ kind: 'item', refId: droneId, rarity: 'rare', rarityTier: 2, basePrice: 42000 })
    expect(ctx.marketGoods.get(droneId)!.playerBuyable).not.toBe(false)
    expect(ctx.items.get(droneId)).toMatchObject({ unitM3: 40, cpuUse: 8, repairArmorHp: 20, repairHullHp: 20, repairIntervalMs: 20000 })
  })
  it('40m³和8CPU进入正式装载校验，80m³后勤可装2架而不能装3架', () => {
    const { state, lead } = world()
    expect(ctx.ships.get('sh-wh-g-destroyer')!.droneBayM3).toBe(80)
    expect(ctx.ships.get('sh-wh-g-destroyer')!.repairOutputBonusPct).toBe(.5)
    expect(ctx.ships.get('sh-wh-g-destroyer')!.repairPulseTargetsFleet).toBeUndefined()
    expect(ctx.items.get(droneId)).toMatchObject({ unitM3: 40, cpuUse: 8, repairIntervalMs: 20000 })
    state.encounter.active = false
    expect(adjustDroneLoad(state, ctx, droneId, 1, lead).ok).toBe(false)
    expect(state.fleet[lead]!.droneLoad![droneId]).toBe(2)
    expect([...ctx.ships.values()].filter(s => s.repairOutputBonusPct).map(s => s.id)).toEqual(['sh-wh-g-destroyer'])
  })

  it('每架独立20秒脉冲、每次扣1组件，后勤甲壳各30，零攻击统计', () => {
    const { state, battle, droneIndexes } = world()
    const target = battle.units['ally-1']!
    target.hp.a -= 100; target.hp.h -= 100
    const before = { ...target.hp }
    advance(state, 19900)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
    advance(state, 1200)
    expect(target.hp.a - before.a).toBe(60)
    expect(target.hp.h - before.h).toBe(60)
    expect(state.warehouse.items['repairkit-mil']).toBe(98)
    expect(battle.stats.meShots).toBe(0)
    expect(battle.repairDroneBy!.player!.kitsUsed).toBe(2)
    expect(repairUsageText(battle, ctx)).toContain('×2')
    expect(droneIndexes.every(i => battle.dronePools![`player:${i}`]!.launched)).toBe(true)
    const events = battle.fx.filter(event => event.repair)
    expect(events).toHaveLength(2)
    expect(events.every(event => event.tag === 'player' && event.to === 'ally-1')).toBe(true)
    for (const event of events) {
      expect(event.repair).toMatchObject({ armor: 30, hull: 30 })
      expect(event.dmg).toBeUndefined()
      expect(planBattleFx(event)).toEqual([])
    }
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
    advance(state, 22000)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
    for (const i of droneIndexes) battle.dronePools![`player:${i}`]!.alive = true
    state.warehouse.items['repairkit-mil'] = 0
    const before = battle.units['ally-1']!.hp.a
    advance(state, 22000)
    expect(battle.units['ally-1']!.hp.a).toBe(before)
    state.warehouse.items['repairkit-mil'] = 10
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    advance(state, 22000)
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

  it('修理容量倍率取受修舰各层，不取母舰容量，技能与后勤只乘一次', () => {
    const { state, lead, wing, other, battle, droneIndexes } = world(1)
    state.skills.trained['hull-quick-repair'] = 5
    state.skills.trained['repair-engineering'] = 5
    state.fleet[lead]!.fitted.low = ['mod-armor-plate-3', 'mod-armor-plate-3']
    state.fleet[wing]!.fitted.low = ['mod-armor-plate-3', 'mod-lair-frame-e']
    state.fleet[wing]!.plugs = ['plug-hull-plate']
    const specs = [lead, wing, other].map((id, i) => ({ ...createPlayerSpec(state, ctx, id)!, tag: i ? `ally-${i}` : 'player' }))
    const target = specs[1]!, base = ctx.ships.get('sh-hammerhead')!
    expect(target.repairCapacityMul!.a).toBeCloseTo(target.hp.a / base.armorHp!, 12)
    expect(target.repairCapacityMul!.h).toBeCloseTo(target.hp.h / base.hullHp!, 12)
    const rt = battle.units[target.tag]!
    rt.hpMax = { ...target.hp }
    rt.hp = { s: 0, a: 1, h: 1 }
    const repair = specs[0]!.weapons.find(w => w.repairDrone)!.repairDrone!
    const expectedA = ceilFinalQuantity(20 * 1.5 * 1.5 * target.repairCapacityMul!.a)
    const expectedH = ceilFinalQuantity(20 * 1.5 * 1.5 * target.repairCapacityMul!.h)
    const before = { ...rt.hp }
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair, { artId: droneId, index: droneIndexes[0]! })
    expect(rt.hp.a - before.a).toBe(expectedA)
    expect(rt.hp.h - before.h).toBe(expectedH)
    expect(state.warehouse.items['repairkit-mil']).toBe(99)
    const event = battle.fx.at(-1)!
    expect(event).toMatchObject({ tag: 'player', to: target.tag, artId: droneId, repair: { armor: expectedA, hull: expectedH } })
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state.encounter.battle!
    expect(restored.fx.at(-1)!.repair).toEqual(event.repair)
    expect(restored.repairDroneBy).toEqual(battle.repairDroneBy)
  })

  it('受修舰普通维修装置与修理机使用相同容量倍率，残血不降低额度', () => {
    const { state, lead, wing, other, battle } = world(1)
    state.fleet[wing]!.fitted.mid = ['mod-hullrep-1']
    state.fleet[wing]!.fitted.low = ['mod-armor-plate-3', 'mod-lair-frame-e']
    const specs = [lead, wing, other].map((id, i) => ({ ...createPlayerSpec(state, ctx, id)!, tag: i ? `ally-${i}` : 'player' }))
    const rt = battle.units['ally-1']!
    rt.hpMax = { ...specs[1]!.hp }
    rt.hp = { s: 0, a: 1, h: 1 }
    const repair = { armor: 10, hull: 10, kitId: 'repairkit-mil' }
    const device = repairStatsFor(state, ctx, wing)!.units[0]!
    pulseRepairDroneFor(state, battle, specs, specs[0]!, repair)
    expect(rt.hp.a - 1).toBe(device.armorPerPulse)
    expect(rt.hp.h - 1).toBe(device.hullPerPulse)
  })

  it.each([2499, 2500, 2501, 9000])('交战距离%s米时修理机仅在2500米内可受击，反击令牌不能越界', distance => {
    for (const token of [false, true]) {
      const { state, battle, droneIndexes } = world(1)
      const key = `player:${droneIndexes[0]}`
      const pool = battle.dronePools![key]!
      pool.launched = true
      pool.evasion = 0
      const before = pool.s + pool.a + pool.h
      battle.distanceM = distance
      battle.pdCd = [0]
      battle.lastTickGameMs = 1000
      if (token) battle.droneHitAt = { foe: 1000 }
      const foe = createFoeSpecs(ctx.anomalies.get(cardId)!, ctx.balance.battle)[0]!
      const bal = { ...ctx.balance.battle, pdAcc: 1, pdDmg: 5 }
      resolvePointDefense(state, battle, [foe], bal, 100)
      expect(pool.s + pool.a + pool.h < before).toBe(distance <= 2500)
      expect(pool.alive).toBe(true)
    }
  })

  it('混合机群远距仍可反击攻击机，不能选中修理机，也不沿用越界锁定', () => {
    const { state, battle, droneIndexes } = world(1)
    const key = `player:${droneIndexes[0]}`
    const repair = battle.dronePools![key]!
    repair.launched = true
    const before = structuredClone(repair)
    battle.dronePools!['ally-1:99'] = { ...repair, owner: 'ally-1', artId: 'drone-scout', evasion: 0 }
    battle.distanceM = 2501
    battle.pdCd = [0]
    battle.pdFocus = [key]
    battle.lastTickGameMs = 1000
    battle.droneHitAt = { foe: 1000 }
    const foe = createFoeSpecs(ctx.anomalies.get(cardId)!, ctx.balance.battle)[0]!
    resolvePointDefense(state, battle, [foe], { ...ctx.balance.battle, pdAcc: 1 }, 100)
    expect(repair).toEqual(before)
    expect(battle.pdFocus![0]).toBe('ally-1:99')
    expect(battle.dronePools!['ally-1:99']!.s).toBeLessThan(before.s)
  })

  it('维修技能与后勤加成乘算，攻击伤害技能不增加修理量', () => {
    const { state, lead } = world(1)
    state.skills.trained['hull-quick-repair'] = 5
    state.skills.trained['repair-engineering'] = 5
    state.skills.trained['drone-warfare'] = 5
    state.skills.trained['drone-strike'] = 5
    const drone = createPlayerSpec(state, ctx, lead)!.weapons.find(w => w.repairDrone)!
    expect(drone.repairDrone).toMatchObject({ armor: 45, hull: 45 })
    expect(drone.reloadMs).toBe(20000)
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
    advance(state, 21500)
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
