import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholePreparationPlan, wormholePreparationFillPlan, wormholeEnterPrepared } from '../src/wormholePreparation'
import { adjustDroneLoad } from '../src/equipment'
import { wormholeEnter, wormholeExtract, wormholeLeave, wormholeResume } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import { ammoLoadTotals, createPlayerSpec, advanceBattleFor, applyDcGuard, battleArcsFor, settleDroneLosses, droneRecoveryRate, startFleetBattleFor } from '../src/combat'
import { pulseRepairsFor, preloadRepairFor, repairKitAvailableOf } from '../src/combatRepair'
import { battleAmmoAvailable, battleAmmoIdsFor, consumeBattleAmmo, settleWormholeBattleAmmo } from '../src/combatAmmo'
import { wormholeSupplyCells, takeWormholeSupply, restoreWormholeSupply, settleWormholeDroneRevives } from '../src/wormholeSupplies'
import { wormholeHoldUsage, wormholeHoldStow, wormholeTempAddShape, wormholeTempStowPiece } from '../src/wormholeSalvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { droneReviveNoteLoss, resolveDroneRevive } from '../src/droneRevive'
import { wormholeGroundBoard } from '../src/wormholeGround'

const ctx = buildSimContext()
const BASE = 'ammo-kinetic-l'
const MK2 = 'ammo-kinetic-2'

function setup(count = 2) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const fleet = Array.from({ length: count }, () => addShipToFleet(state, 'sh-thresher'))
  state.shipId = fleet[0]!
  for (const uid of fleet) state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  const need = ammoLoadTotals(createPlayerSpec(state, ctx, fleet[0]!)!, ctx.balance.battle, state).kinetic!
  return { state, fleet, need }
}

function prepare(state: GameState, fleet: string[], targets: Record<string, number>, unload: string[] = []) {
  const plan = wormholePreparationPlan(state, ctx, fleet, { targets, unload })
  expect(plan.ok, JSON.stringify(plan)).toBe(true)
  const result = wormholeEnterPrepared(state, ctx, fleet, 7, plan)
  expect(result.ok).toBe(true)
  return state.wormhole.run!
}

function start(state: GameState) {
  const run = state.wormhole.run!
  const cell = run.grid!.cells.find((c) => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
  cell.place = 'ship'
  expect(wormholeStartBattle(state, ctx, 'node', state.gameMs).ok).toBe(true)
  return run.battle!
}

function finish(state: GameState, won: boolean) {
  const battle = state.wormhole.run!.battle!
  for (const unit of Object.values(battle.units)) {
    if (unit.side === (won ? 'foe' : 'me')) unit.hp = { s: 0, a: 0, h: 0 }
  }
  battle.ended = won ? 'me' : 'foe'
  state.gameMs += 60_000
  advanceWormhole(state, ctx)
}

function droneTotal(state: GameState, id: string): number {
  return Object.values(state.fleet).reduce((n, ship) => n + (ship.droneLoad?.[id] ?? 0), 0) +
    (state.wormhole.run?.supplies?.items[id] ?? 0) + (state.warehouse.items[id] ?? 0)
}

function loseDrone(state: GameState, battle: BattleState, key: string, nowMs: number): void {
  const pool = battle.dronePools![key]!
  expect(pool.alive).toBe(true)
  pool.alive = false
  pool.s = 0; pool.a = 0; pool.h = 0
  const tag = key.slice(0, key.indexOf(':'))
  const id = pool.artId!
  battle.droneLostBy ??= {}
  const lost = battle.droneLostBy[tag] ??= {}
  lost[id] = (lost[id] ?? 0) + 1
  droneReviveNoteLoss(state, battle, key, nowMs)
}

describe('虫洞有限物资 · 原子整备', () => {
  it('四艘鹦鹉螺补齐一套同型备用，预览不扣货或改现役，入场只扣一次', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const fleet = Array.from({ length: 4 }, () => addShipToFleet(state, 'sh-nautilus'))
    state.shipId = fleet[0]!
    state.warehouse.items['drone-scout'] = 100
    for (const uid of fleet) expect(adjustDroneLoad(state, ctx, 'drone-scout', 8, uid).ok).toBe(true)
    const before = structuredClone(state)
    const request = { targets: {}, unload: [] }
    const plan = wormholePreparationFillPlan(state, ctx, fleet, request)
    expect(plan.deployedDrones).toEqual({ 'drone-scout': 32 })
    expect(plan.items['drone-scout']).toBe(32)
    expect(plan.fromWarehouse['drone-scout']).toBe(32)
    expect(plan.cells).toBe(1)
    expect(plan.ok).toBe(true)
    expect(request).toEqual({ targets: {}, unload: [] })
    expect(state).toEqual(before)
    expect(wormholePreparationFillPlan(state, ctx, fleet, plan.request)).toEqual(plan)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).ok).toBe(true)
    expect(state.warehouse.items['drone-scout']).toBe(36)
    expect(state.wormhole.run!.supplies!.items['drone-scout']).toBe(32)
    expect(fleet.map(uid => state.fleet[uid]!.droneLoad)).toEqual(fleet.map(uid => before.fleet[uid]!.droneLoad))
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).ok).toBe(false)
    expect(state.warehouse.items['drone-scout']).toBe(36)
  })

  it('混合机型分别汇总，仅所选舰队机型补齐，重复舰船仍非法', () => {
    const { state, fleet } = setup(2)
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 2, 'drone-assault': 1 }
    state.fleet[fleet[1]!]!.droneLoad = { 'drone-heavy': 2 }
    const outside = addShipToFleet(state, 'sh-nautilus')
    state.fleet[outside]!.droneLoad = { 'drone-sentry': 4 }
    state.warehouse.items = { 'drone-scout': 100, 'drone-assault': 100, 'drone-heavy': 100, 'drone-sentry': 100 }
    const plan = wormholePreparationFillPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(plan.request.targets).toEqual({ 'drone-scout': 2, 'drone-assault': 1, 'drone-heavy': 2 })
    expect(plan.deployedDrones).toEqual(plan.request.targets)
    expect(plan.request.targets['drone-sentry']).toBeUndefined()
    const repeated = wormholePreparationFillPlan(state, ctx, [fleet[0]!, fleet[0]!], { targets: {}, unload: [] })
    expect(repeated.ok).toBe(false)
    expect(repeated.request.targets).toEqual({ 'drone-scout': 2, 'drone-assault': 1 })
  })

  it('已有舰载备用计入总目标，多于一套不降低，不额外加一套', () => {
    const { state, fleet } = setup(2)
    for (const uid of fleet) state.fleet[uid]!.droneLoad = { 'drone-scout': 2 }
    state.fleet[fleet[0]!]!.cargo['drone-scout'] = 3
    state.warehouse.items['drone-scout'] = 10
    const plan = wormholePreparationFillPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(plan.items['drone-scout']).toBe(4)
    expect(plan.fromWarehouse['drone-scout']).toBe(1)
    state.fleet[fleet[1]!]!.cargo['drone-scout'] = 5
    const more = wormholePreparationFillPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(more.items['drone-scout']).toBe(8)
    expect(more.fromWarehouse['drone-scout']).toBeUndefined()
  })

  it('手填/模板明确数量含0与卸港选择不被补齐覆盖，也不推荐弹药或组件', () => {
    const { state, fleet } = setup(2)
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 2 }
    state.fleet[fleet[1]!]!.droneLoad = { 'drone-assault': 2 }
    state.warehouse.items = { 'drone-scout': 100, 'drone-assault': 100, [BASE]: 100 }
    const request = { targets: { 'drone-scout': 0, 'drone-assault': 7, [BASE]: 20 }, unload: [] }
    expect(wormholePreparationFillPlan(state, ctx, fleet, request).request).toEqual(request)
    state.fleet[fleet[0]!]!.cargo['drone-scout'] = 2
    const unload = wormholePreparationFillPlan(state, ctx, fleet, { targets: {}, unload: ['drone-scout'] })
    expect(unload.items['drone-scout']).toBeUndefined()
    expect(unload.request.targets).toEqual({ 'drone-assault': 2 })
    expect(unload.request.unload).toEqual(['drone-scout'])
  })

  it('缺货仍保留一套目标与准确缺额，拒绝不扣货、不擅自降低目标', () => {
    const { state, fleet } = setup(2)
    for (const uid of fleet) state.fleet[uid]!.droneLoad = { 'drone-scout': 4 }
    state.fleet[fleet[0]!]!.cargo['drone-scout'] = 2
    state.warehouse.items['drone-scout'] = 3
    const before = structuredClone(state)
    const plan = wormholePreparationFillPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(plan.items['drone-scout']).toBe(8)
    expect(plan.shortage['drone-scout']).toBe(3)
    expect(plan.rows.find(row => row.itemId === 'drone-scout')).toMatchObject({ target: 8, onboard: 2, needed: 6, available: 3, missing: 3 })
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).code).toBe('invalid-plan')
    expect(state).toEqual(before)
    state.warehouse.items['drone-scout'] = 0
    expect(wormholePreparationFillPlan(state, ctx, fleet, plan.request).request.targets['drone-scout']).toBe(8)
  })

  it('补齐导致超容不删其它清单，也不自动部署空机舱', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 2 }
    state.warehouse.items = { 'drone-scout': 100, 'repairkit-mil': 2500 }
    const before = structuredClone(state)
    const plan = wormholePreparationFillPlan(state, ctx, fleet, { targets: { 'repairkit-mil': 2500 }, unload: [] })
    expect(plan.cells).toBe(6)
    expect(plan.capacity).toBe(5)
    expect(plan.ok).toBe(false)
    expect(plan.items).toEqual({ 'repairkit-mil': 2500, 'drone-scout': 2 })
    expect(state).toEqual(before)
    delete state.fleet[fleet[0]!]!.droneLoad
    const empty = wormholePreparationFillPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(empty.deployedDrones).toEqual({})
    expect(empty.items).toEqual({})
  })

  it('重复舰船与负数/小数/非有限数量都拒绝', () => {
    const { state, fleet } = setup(1)
    expect(wormholePreparationPlan(state, ctx, [fleet[0]!, fleet[0]!], { targets: {}, unload: [] }).ok).toBe(false)
    for (const n of [-1, 0.5, NaN, Infinity]) {
      const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { [BASE]: n }, unload: [] })
      expect(plan.ok).toBe(false)
    }
  })

  it('准备请求改动也必须重新确认，不能借旧快照多带', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 200
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { [BASE]: 20 }, unload: [] })
    plan.request.targets[BASE] = 100
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).code).toBe('stale-plan')
    expect(state.warehouse.items[BASE]).toBe(200)
  })
  it('预览不扣料，确认只转移一次，已有僚舰货不复制', () => {
    const { state, fleet } = setup()
    state.fleet[fleet[1]!]!.cargo[BASE] = 80
    state.warehouse.items[BASE] = 200
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { [BASE]: 120 }, unload: [] })
    expect(plan.fromWarehouse[BASE]).toBe(40)
    expect(state.warehouse.items[BASE]).toBe(200)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).ok).toBe(true)
    expect(state.wormhole.run!.supplies!.items[BASE]).toBe(120)
    expect(state.fleet[fleet[1]!]!.cargo[BASE]).toBeUndefined()
    expect(state.warehouse.items[BASE]).toBe(160)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).ok).toBe(false)
    expect(state.warehouse.items[BASE]).toBe(160)
  })

  it('库存或装配改变使预览过期，失败不扣任何一份货', () => {
    const { state, fleet } = setup()
    state.warehouse.items[BASE] = 200
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { [BASE]: 120 }, unload: [] })
    state.fleet[fleet[0]!]!.ammoPref = { kinetic: MK2 }
    const before = structuredClone(state)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('缺货与超容分别可见，不自动买货或降档', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 500
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { [MK2]: 100 }, unload: [] })
    expect(plan.shortage[MK2]).toBe(100)
    expect(plan.rows).toContainEqual({ itemId: MK2, target: 100, onboard: 0, warehouse: 0, needed: 100, available: 0, missing: 100 })
    expect(plan.request.targets[MK2]).toBe(100)
    expect(plan.ok).toBe(false)
    state.warehouse.items['repairkit-civ'] = 1_000_000
    const full = wormholePreparationPlan(state, ctx, fleet, { targets: { 'repairkit-civ': 1_000_000 }, unload: [] })
    expect(full.cells).toBeGreaterThan(full.capacity)
    expect(full.ok).toBe(false)
    expect(state.warehouse.items[BASE]).toBe(500)
  })

  it('舰载与仓库可追加读数同源，缺弹/作业不足只是软警告', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.cargo[BASE] = 10
    state.warehouse.items[BASE] = 5
    const before = structuredClone(state)
    const short = wormholePreparationPlan(state, ctx, fleet, { targets: { [BASE]: 20 }, unload: [] })
    expect(short.rows[0]).toEqual({ itemId: BASE, target: 20, onboard: 10, warehouse: 5, needed: 10, available: 5, missing: 5 })
    expect(state).toEqual(before)
    const empty = wormholePreparationPlan(state, ctx, fleet, { targets: {}, unload: [BASE] })
    expect(empty.ok).toBe(true)
    expect(empty.warnings).toContainEqual({ code: 'no-salvager' })
    expect(empty.warnings).toContainEqual({ code: 'ammo-empty', shipId: fleet[0], itemId: BASE })
  })

  it('未知舰货必须明确卸港，装备回装备库，不静默删除', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.cargo['mod-turret-kin-1'] = 2
    const bad = wormholePreparationPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(bad.invalid).toContain('mod-turret-kin-1')
    const before = state.moduleBay['mod-turret-kin-1'] ?? 0
    prepare(state, fleet, {}, ['mod-turret-kin-1'])
    expect(state.moduleBay['mod-turret-kin-1']).toBe(before + 2)
    expect(state.fleet[fleet[0]!]!.cargo).toEqual({})
  })

  it('库存虫洞只在成功时消耗且不复用', () => {
    const { state, fleet } = setup(1)
    state.wormholeStock = [{ id: 'test-hole', seed: 7, depth: 1, family: 'C', archetype: 'vein', foundAtGameMs: 0 }]
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: {}, unload: [] })
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan, 'missing').ok).toBe(false)
    expect(state.wormholeStock).toHaveLength(1)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan, 'test-hole').ok).toBe(true)
    expect(state.wormholeStock).toEqual([])
    expect(state.wormhole.run!.family).toBe('C')
  })
})

describe('虫洞有限物资 · 弹药与结算', () => {
  it('两舰不同档保留原id，原档伤害重建，未用量原样回趟', () => {
    const { state, fleet, need } = setup()
    state.fleet[fleet[1]!]!.ammoPref = { kinetic: MK2 }
    state.warehouse.items[BASE] = need
    state.warehouse.items[MK2] = need
    const run = prepare(state, fleet, { [BASE]: need, [MK2]: need })
    const battle = start(state)
    expect(battle.expeditionAmmo!.stock).toEqual({ [BASE]: need, [MK2]: need })
    expect(battleAmmoIdsFor(battle, 'player')!.kinetic).toBe(BASE)
    expect(battleAmmoIdsFor(battle, 'ally-1')!.kinetic).toBe(MK2)
    const baseSpec = createPlayerSpec(state, ctx, fleet[0]!, battleAmmoIdsFor(battle, 'player'))!
    const mkSpec = createPlayerSpec(state, ctx, fleet[1]!, battleAmmoIdsFor(battle, 'ally-1'))!
    expect(mkSpec.weapons.find((w) => w.shotsByType)?.shotsByType!.kinetic).toBeGreaterThan(baseSpec.weapons.find((w) => w.shotsByType)!.shotsByType!.kinetic!)
    finish(state, true)
    expect(run.supplies!.items).toEqual({ [BASE]: need, [MK2]: need })
    expect(state.warehouse.items[BASE]).toBeUndefined()
    expect(state.warehouse.items[MK2]).toBeUndefined()
  })

  it('同id共享一次预载，开火只扣实际档，弹尽不能借另一档', () => {
    const { state, fleet, need } = setup()
    state.fleet[fleet[1]!]!.ammoPref = { kinetic: MK2 }
    state.warehouse.items = { [BASE]: need, [MK2]: need }
    prepare(state, fleet, { [BASE]: need, [MK2]: need })
    const battle = start(state)
    expect(consumeBattleAmmo(battle, 'player', 'kinetic', need)).toBe(true)
    expect(battleAmmoAvailable(battle, 'player', 'kinetic')).toBe(0)
    expect(consumeBattleAmmo(battle, 'player', 'kinetic', 1)).toBe(false)
    expect(battleAmmoAvailable(battle, 'ally-1', 'kinetic')).toBe(need)
  })

  it('真实逐拍战斗扣原id，射程视图按各舰实际档取数', () => {
    const { state, fleet } = setup()
    state.fleet[fleet[1]!]!.ammoPref = { kinetic: MK2 }
    state.warehouse.items = { [BASE]: 1000, [MK2]: 1000 }
    prepare(state, fleet, { [BASE]: 1000, [MK2]: 1000 })
    const battle = start(state)
    const before = { ...battle.expeditionAmmo!.stock }
    for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 1e9, a: 1e9, h: 1e9 }
    for (let n = 0; n < 20 && !battle.ended; n++) {
      state.gameMs += 1000
      advanceBattleFor(state, ctx, battle, fleet[0]!, battle.wormhole!.cardId)
    }
    expect(battle.expeditionAmmo!.stock[BASE]).toBeLessThan(before[BASE]!)
    expect(battle.expeditionAmmo!.stock[MK2]).toBeLessThan(before[MK2]!)
    expect(battle.ammo.kin).toBe((battle.expeditionAmmo!.stock[BASE] ?? 0) + (battle.expeditionAmmo!.stock[MK2] ?? 0))
    const arcs = battleArcsFor(state, ctx, { battle, anomaly: ctx.anomalies.get(battle.wormhole!.cardId)!, leaderShipId: fleet[0]! })!
    expect(arcs.myUnits[1]!.ammoIds!.kinetic).toBe(MK2)
  })

  it('母港有货也不能使用，仓库开关切换不补弹', () => {
    const { state, fleet } = setup()
    state.fleet[fleet[1]!]!.cargo[BASE] = 20
    state.warehouse.items[MK2] = 100_000
    prepare(state, fleet, {})
    const battle = start(state)
    expect(battle.ammo.kin).toBe(20)
    expect(battleAmmoIdsFor(battle, 'player')!.kinetic).toBe(BASE)
    state.resupplyFromWarehouse = false
    expect(battleAmmoAvailable(battle, 'player', 'kinetic')).toBe(20)
    expect(state.warehouse.items[MK2]).toBe(100_000)
  })

  it('预载仍占货仓，实际消耗后释放，不按舰重复占格', () => {
    const { state, fleet } = setup()
    state.warehouse.items[BASE] = 25_000
    prepare(state, fleet, { [BASE]: 25_000 })
    expect(wormholeSupplyCells(state, ctx)).toBe(1)
    const battle = start(state)
    expect(wormholeSupplyCells(state, ctx)).toBe(1)
    expect(wormholeHoldUsage(state, ctx).used).toBe(1)
    expect(consumeBattleAmmo(battle, 'player', 'kinetic', 1)).toBe(true)
    expect(wormholeSupplyCells(state, ctx)).toBe(1)
    finish(state, true)
    expect(state.wormhole.run!.supplies!.consumed[BASE]).toBe(1)
  })

  it('货柜放置只扣一次补给空间，暂存转货仓用同一容量', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items['repairkit-mil'] = 1500
    prepare(state, fleet, { 'repairkit-mil': 1500 })
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ used: 3, capacity: 5 })
    expect(wormholeHoldStow(state, ctx, 'box-bp-shallow').ok).toBe(true)
    expect(wormholeHoldUsage(state, ctx).used).toBe(5)
    expect(wormholeHoldStow(state, ctx, 'ai-core-gamma').ok).toBe(false)
    const other = setup(1)
    other.state.warehouse.items['repairkit-mil'] = 1500
    prepare(other.state, other.fleet, { 'repairkit-mil': 1500 })
    expect(wormholeTempAddShape(other.state, ctx, 'box-bp-shallow').ok).toBe(true)
    const piece = wormholeGroundBoard(other.state.wormhole.run!)!.placements[0]!
    expect(wormholeTempStowPiece(other.state, ctx, piece.id).ok).toBe(true)
  })

  it('沉船縮容对补给也判超载，不自动吞货', () => {
    const { state, fleet } = setup()
    state.warehouse.items['repairkit-mil'] = 3000
    const run = prepare(state, fleet, { 'repairkit-mil': 3000 })
    const battle = start(state)
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    finish(state, true)
    expect(run.supplies!.items['repairkit-mil']).toBe(3000)
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ used: 6, capacity: 5, overload: true })
  })

  it('余弹回收按id且重复结算幂等', () => {
    const { state, fleet, need } = setup(1)
    state.warehouse.items[BASE] = need
    const run = prepare(state, fleet, { [BASE]: need })
    const battle = start(state)
    consumeBattleAmmo(battle, 'player', 'kinetic', 10)
    settleWormholeBattleAmmo(state, battle, 0.5)
    expect(run.supplies!.items[BASE]).toBe(need - 5)
    expect(run.supplies!.consumed[BASE]).toBe(5)
    settleWormholeBattleAmmo(state, battle, 0.5)
    expect(run.supplies!.items[BASE]).toBe(need - 5)
  })

  it('全损不退款，母港无关库存不动', () => {
    const { state, fleet, need } = setup(1)
    state.warehouse.items[BASE] = need + 100
    prepare(state, fleet, { [BASE]: need })
    start(state)
    finish(state, false)
    expect(state.wormhole.run).toBeNull()
    expect(state.warehouse.items[BASE]).toBe(100)
  })

  it('撤离归还未用补给，不把携入弹药记收益', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 200
    const run = prepare(state, fleet, { [BASE]: 100 })
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(state.warehouse.items[BASE]).toBe(200)
    expect(state.wormhole.lastSettle!.oreIsk).toBe(0)
    expect(state.wormhole.lastSettle!.suppliesReturned).toEqual({ [BASE]: 100 })
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.wormhole.lastSettle!.suppliesReturned).toEqual({ [BASE]: 100 })
    advanceWormhole(state, ctx)
    expect(state.warehouse.items[BASE]).toBe(200)
  })

  it('连续战斗消耗同一趟，停火余弹不重装为满额', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 12
    const run = prepare(state, fleet, { [BASE]: 12 })
    const first = start(state)
    consumeBattleAmmo(first, 'player', 'kinetic', 7)
    finish(state, true)
    const next = start(state)
    expect(next.ammo.kin).toBe(5)
    consumeBattleAmmo(next, 'player', 'kinetic', 5)
    finish(state, true)
    expect(run.supplies!.items[BASE]).toBeUndefined()
    expect(run.supplies!.consumed[BASE]).toBe(12)
    expect(start(state).ammo.kin).toBe(0)
  })

  it('非法扣弹/退料不能凭空增库存', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 20
    const run = prepare(state, fleet, { [BASE]: 20 })
    const battle = start(state)
    for (const n of [-1, NaN, Infinity, 0.5]) expect(consumeBattleAmmo(battle, 'player', 'kinetic', n)).toBe(false)
    expect(battle.ammo.kin).toBe(20)
    expect(takeWormholeSupply(run.supplies!, BASE, -1)).toBe(0)
    expect(restoreWormholeSupply(run.supplies!, BASE, Infinity)).toBe(0)
  })
})

describe('虫洞有限物资 · 维修与兼容', () => {
  it('原机与备用机均损毁且回收为0，新趟不再留出不存在的机体', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.warehouse.items['drone-scout'] = 100
    prepare(state, fleet, { 'drone-scout': 1 })
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    for (let n = 0; n < 2; n++) {
      loseDrone(state, battle, key, n * 10_000)
      resolveDroneRevive(state, ctx, battle, n * 10_000 + 9_000)
    }
    expect(battle.droneRevive!.player!.v['drone-scout']).toBe(1)
    expect(battle.dronePools![key]!.alive).toBe(false)
    finish(state, true)
    expect(state.fleet[fleet[0]!]!.droneLoad?.['drone-scout'] ?? 0).toBe(0)
    expect(state.droneLossReport).toMatchObject({ total: 2, recovered: 0, gone: 2, revived: 1, survivors: 0 })
    expect(state.warehouse.items['drone-scout']).toBe(99)
  })

  it.each([0, 5].flatMap((level) => [0, 1, 3, 6].flatMap((reserve) =>
    [false, true].map((lastLoss) => ({ level, reserve, lastLoss })),
  )))('新趟机体守恒：回收学$level，备用$reserve，末次击落$lastLoss', ({ level, reserve, lastLoss }) => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.skills.trained['drone-recovery'] = level
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': reserve })
    const before = droneTotal(state, 'drone-scout')
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    for (let n = 0; n < reserve; n++) {
      loseDrone(state, battle, key, n * 10_000)
      resolveDroneRevive(state, ctx, battle, n * 10_000 + 9_000)
    }
    if (lastLoss) loseDrone(state, battle, key, reserve * 10_000)
    const killed = reserve + Number(lastLoss)
    const back = Math.round(killed * droneRecoveryRate(state))
    const alive = Number(!lastLoss)
    finish(state, true)
    expect(droneTotal(state, 'drone-scout')).toBe(before - killed + back)
    expect(state.fleet[fleet[0]!]!.droneLoad?.['drone-scout'] ?? 0).toBe(Math.min(1, alive + back))
    expect(run.supplies!.items['drone-scout'] ?? 0).toBe(Math.max(0, alive + back - 1))
    expect(state.warehouse.items['drone-scout']).toBe(100 - reserve)
    const settled = structuredClone({ supplies: run.supplies, load: state.fleet[fleet[0]!]!.droneLoad })
    settleDroneLosses(state, ctx, fleet[0]!, battle)
    expect({ supplies: run.supplies, load: state.fleet[fleet[0]!]!.droneLoad }).toEqual(settled)
  })

  it('混合机型保持高价值回收优先，实际损坏次数不被出发清单截断', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1, 'drone-assault': 1 }
    state.warehouse.items['drone-scout'] = 10
    const run = prepare(state, fleet, { 'drone-scout': 1 })
    const battle = start(state)
    const scout = Object.keys(battle.dronePools!).find((k) => battle.dronePools![k]!.artId === 'drone-scout')!
    const assault = Object.keys(battle.dronePools!).find((k) => battle.dronePools![k]!.artId === 'drone-assault')!
    loseDrone(state, battle, scout, 0)
    resolveDroneRevive(state, ctx, battle, 9_000)
    loseDrone(state, battle, scout, 10_000)
    loseDrone(state, battle, assault, 10_000)
    finish(state, true)
    expect(state.droneLossReport).toMatchObject({ total: 3, recovered: 1, gone: 2, revived: 1 })
    expect(state.droneLossReport!.rows).toEqual([
      expect.objectContaining({ id: 'drone-assault', lost: 1, back: 1, gone: 0 }),
      expect.objectContaining({ id: 'drone-scout', lost: 2, back: 0, gone: 2 }),
    ])
    expect(state.fleet[fleet[0]!]!.droneLoad).toEqual({ 'drone-assault': 1 })
    expect(run.supplies!.items).toEqual({})
    expect(state.warehouse.items['drone-scout']).toBe(9)
  })

  it('旧趟沿用原结算且未启用新补给账', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.warehouse.items['drone-scout'] = 1
    expect(wormholeEnter(state, ctx, fleet, 7).ok).toBe(true)
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    loseDrone(state, battle, key, 0)
    resolveDroneRevive(state, ctx, battle, 9_000)
    loseDrone(state, battle, key, 10_000)
    finish(state, true)
    expect(state.wormhole.run!.supplyVersion).toBeUndefined()
    expect(state.fleet[fleet[0]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
  })

  it('100%回收不超原编制，额外回收机回本趟库存且重复收口不重发', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': 2 })
    const before = droneTotal(state, 'drone-scout')
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    for (let n = 0; n < 2; n++) {
      loseDrone(state, battle, key, n * 10_000)
      resolveDroneRevive(state, ctx, battle, n * 10_000 + 9_000)
    }
    settleDroneLosses(state, ctx, fleet[0]!, battle, 1)
    expect(state.droneLossReport).toMatchObject({ rate: 1, total: 2, recovered: 2, gone: 0, revived: 2, returnedToSupply: { 'drone-scout': 2 } })
    expect(state.fleet[fleet[0]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
    expect(run.supplies!.items['drone-scout']).toBe(2)
    expect(run.supplies!.recovered['drone-scout']).toBe(2)
    expect(droneTotal(state, 'drone-scout')).toBe(before)
    const prior = structuredClone(run.supplies)
    settleWormholeDroneRevives(state, battle)
    settleDroneLosses(state, ctx, fleet[0]!, battle, 1)
    expect(run.supplies).toEqual(prior)
    finish(state, true)
    expect(run.supplies).toEqual(prior)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const twice = loadSaveFile(serializeSaveFile(loaded, 0)).state
    expect(twice.wormhole.run!.supplies).toEqual(prior)
    expect(state.warehouse.items['drone-scout']).toBe(98)
    expect(wormholeExtract(loaded.wormhole.run!).ok).toBe(true)
    advanceWormhole(loaded, ctx)
    expect(loaded.warehouse.items['drone-scout']).toBe(100)
    expect(loaded.wormhole.lastSettle).toMatchObject({ oreIsk: 0, suppliesReturned: { 'drone-scout': 2 } })
    advanceWormhole(loaded, ctx)
    expect(loaded.warehouse.items['drone-scout']).toBe(100)
  })

  it.each(['bay', 'cpu'] as const)('安置受%s限制时机体回本趟，不超容、不丢货或退母港', (limit) => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = []
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 4 }
    const run = prepare(state, fleet, {})
    const before = droneTotal(state, 'drone-scout')
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    loseDrone(state, battle, key, 0)
    const ship = ctx.ships.get('sh-thresher')!
    const smallCtx = { ...ctx, ships: new Map(ctx.ships) }
    smallCtx.ships.set(ship.id, { ...ship, ...(limit === 'bay' ? { droneBayM3: 5 } : { cpu: 4 }) })
    settleDroneLosses(state, smallCtx, fleet[0]!, battle, 1)
    expect(state.fleet[fleet[0]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
    expect(run.supplies!.items['drone-scout']).toBe(3)
    expect(droneTotal(state, 'drone-scout')).toBe(before)
    expect(state.warehouse.items['drone-scout']).toBeUndefined()
  })

  it('四舰战后共享最后一架备用，逐舰重复结算不超发', () => {
    const { state, fleet } = setup(4)
    for (const uid of fleet) state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': 1 })
    const battle = start(state)
    for (const key of Object.keys(battle.dronePools!)) loseDrone(state, battle, key, 0)
    const before = droneTotal(state, 'drone-scout')
    finish(state, true)
    expect(droneTotal(state, 'drone-scout')).toBe(before - 4)
    expect(fleet.map((uid) => state.fleet[uid]!.droneLoad?.['drone-scout'] ?? 0)).toEqual([1, 0, 0, 0])
    expect(run.supplies!.items['drone-scout']).toBeUndefined()
    expect(run.supplies!.deployed['drone-scout']).toBe(1)
    const prior = structuredClone(run.supplies)
    for (const entry of battle.myFleet!) settleDroneLosses(state, ctx, entry.shipId, battle, 0, entry.tag)
    expect(run.supplies).toEqual(prior)
    expect(state.warehouse.items['drone-scout']).toBe(99)
  })

  it('复位舰沉没后不回收其机体，全损也不向母港退备用', () => {
    for (const won of [true, false]) {
      const { state, fleet } = setup(2)
      state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
      state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
      state.skills.trained['drone-recovery'] = 5
      state.warehouse.items['drone-scout'] = 100
      const run = prepare(state, fleet, { 'drone-scout': 2 })
      const battle = start(state)
      const key = Object.keys(battle.dronePools!)[0]!
      loseDrone(state, battle, key, 0)
      resolveDroneRevive(state, ctx, battle, 9_000)
      loseDrone(state, battle, key, 10_000)
      battle.units.player!.hp = { s: 0, a: 0, h: 0 }
      finish(state, won)
      expect(state.fleet[fleet[0]!]).toBeUndefined()
      expect(state.warehouse.items['drone-scout']).toBe(98)
      if (won) {
        expect(run.supplies!.items['drone-scout']).toBe(1)
        expect(run.supplies!.recovered).toEqual({})
      } else expect(state.wormhole.run).toBeNull()
    }
  })

  it('反复复位战中读档与不停机结算一致，核销标记往返不重扣', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.skills.trained['drone-recovery'] = 5
    state.warehouse.items['drone-scout'] = 100
    prepare(state, fleet, { 'drone-scout': 3 })
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    for (let n = 0; n < 3; n++) {
      loseDrone(state, battle, key, n * 10_000)
      resolveDroneRevive(state, ctx, battle, n * 10_000 + 9_000)
    }
    loseDrone(state, battle, key, 30_000)
    const readback = loadSaveFile(serializeSaveFile(state, 0)).state
    finish(state, true)
    finish(readback, true)
    expect(readback.wormhole.run!.supplies).toEqual(state.wormhole.run!.supplies)
    expect(readback.fleet[fleet[0]!]!.droneLoad).toEqual(state.fleet[fleet[0]!]!.droneLoad)
    expect(readback.wormhole.run!.supplies!.items['drone-scout']).toBe(1)
    expect(readback.warehouse.items['drone-scout']).toBe(97)

    const next = start(readback)
    const nextKey = Object.keys(next.dronePools!)[0]!
    loseDrone(readback, next, nextKey, 0)
    resolveDroneRevive(readback, ctx, next, 9_000)
    settleWormholeDroneRevives(readback, next)
    const afterDebit = loadSaveFile(serializeSaveFile(readback, 0)).state
    expect(afterDebit.wormhole.run!.battle!.expeditionAmmo!.revivesSettled).toBe(true)
    settleWormholeDroneRevives(afterDebit, afterDebit.wormhole.run!.battle!)
    expect(afterDebit.wormhole.run!.supplies!.deployed['drone-scout']).toBe(4)
    expect(afterDebit.wormhole.run!.supplies!.items['drone-scout']).toBeUndefined()
  })

  it('真实防空节拍：实际击落超过出发架数，复位与回收后总存量守恒', () => {
    const { state, fleet } = setup(1)
    state.skills.trained['drone-servicing'] = 5
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': 3 })
    const before = droneTotal(state, 'drone-scout')
    const card = 'ano-vault-sentinel'
    run.depth = 4
    const battle = startFleetBattleFor(state, ctx, fleet, card, 0, null, { depth: run.depth, kind: 'node', waves: 1 })!
    run.battle = battle
    expect(battle.pdCd?.length).toBeGreaterThan(0)
    // 只延长观测窗口，不改防空或机体数值；此用例不用于衡量整场胜率。
    for (const unit of Object.values(battle.units)) {
      unit.hp = { s: 1e9, a: 1e9, h: 1e9 }
      unit.hpMax = { ...unit.hp }
    }
    for (let n = 0; n < 5000 && !battle.ended; n++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, battle, fleet[0]!, card)
    }
    const killed = battle.droneLostBy?.player?.['drone-scout'] ?? 0
    const revived = battle.droneRevive!.player!.v['drone-scout'] ?? 0
    expect(killed).toBeGreaterThan(1)
    expect(revived).toBeGreaterThan(0)
    expect(revived).toBeLessThanOrEqual(3)
    const back = Math.round(killed * droneRecoveryRate(state))
    finish(state, true)
    expect(state.droneLossReport).toMatchObject({ total: killed, recovered: back, gone: killed - back, revived })
    expect(droneTotal(state, 'drone-scout')).toBe(before - killed + back)
    expect(state.warehouse.items['drone-scout']).toBe(97)
    console.log(`[读数] 新趟真实防空：损坏${killed}、复位${revived}、回收${back}；总机体${before}→${droneTotal(state, 'drone-scout')}，母港97架不变。`)
  })

  it('暂停/换驾驶/母港补仓不改变本趟携入库存', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 100
    const run = prepare(state, fleet, { [BASE]: 20 })
    wormholeLeave(state)
    state.shipId = 'sandcat'
    state.warehouse.items[BASE] += 10_000
    expect(wormholeResume(state, ctx).ok).toBe(true)
    expect(run.supplies!.items[BASE]).toBe(20)
    expect(start(state).ammo.kin).toBe(20)
  })
  it('损管只用本趟组件，不借母港', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items['repairkit-dc'] = 10
    const run = prepare(state, fleet, { 'repairkit-dc': 1 })
    const battle = start(state)
    const spec = createPlayerSpec(state, ctx, fleet[0]!)!
    spec.hullSaveKit = 'repairkit-dc'
    spec.shipId = fleet[0]
    spec.tag = 'player'
    applyDcGuard(state, battle, 'player', spec, { s: 0, a: 0, h: 10 }, 100_000, 'kinetic')
    expect(run.supplies!.items['repairkit-dc']).toBeUndefined()
    expect(run.supplies!.consumed['repairkit-dc']).toBe(1)
    expect(state.warehouse.items['repairkit-dc']).toBe(9)
  })

  it('储备甲板全队只拍本趟一份，战中不扣实货，沉船仍核销复位', () => {
    const { state, fleet } = setup()
    for (const uid of fleet) {
      state.fleet[uid]!.fitted.high = ['mod-drone-deck-3']
      state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
    }
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': 1 })
    const battle = start(state)
    expect(battle.droneReviveStock).toEqual({ 'drone-scout': 1 })
    for (const [key, p] of Object.entries(battle.dronePools!)) {
      p.alive = false
      p.s = 0; p.a = 0; p.h = 0
      droneReviveNoteLoss(state, battle, key, 0)
    }
    resolveDroneRevive(state, ctx, battle, 100_000)
    const total = Object.values(battle.droneRevive!).reduce((n, e) => n + (e.v['drone-scout'] ?? 0), 0)
    expect(total).toBe(1)
    expect(run.supplies!.items['drone-scout']).toBe(1)
    const tag = Object.entries(battle.droneRevive!).find(([, e]) => e.v['drone-scout'] === 1)![0]
    battle.units[tag]!.hp = { s: 0, a: 0, h: 0 }
    finish(state, true)
    expect(run.supplies!.items['drone-scout']).toBeUndefined()
    expect(run.supplies!.deployed['drone-scout']).toBe(1)
    expect(run.supplies!.consumed['drone-scout']).toBeUndefined()
    expect(state.warehouse.items['drone-scout']).toBe(99)
  })

  it('反复复位不超备用数，随后战后补机只取剩余本趟库存', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-drone-deck-3']
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 1 }
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': 3 })
    const battle = start(state)
    const key = Object.keys(battle.dronePools!)[0]!
    for (let n = 0; n < 4; n++) {
      const p = battle.dronePools![key]!
      p.alive = false
      p.s = 0; p.a = 0; p.h = 0
      battle.droneLostBy = { player: { 'drone-scout': n + 1 } }
      droneReviveNoteLoss(state, battle, key, n * 10_000)
      resolveDroneRevive(state, ctx, battle, n * 10_000 + 9_000)
    }
    expect(battle.droneRevive!.player!.v['drone-scout']).toBe(3)
    finish(state, true)
    expect(run.supplies!.items['drone-scout']).toBeUndefined()
    expect(run.supplies!.deployed['drone-scout']).toBe(3)
    const after = structuredClone(run.supplies)
    settleDroneLosses(state, ctx, fleet[0]!, battle)
    expect(run.supplies).toEqual(after)
    expect(state.warehouse.items['drone-scout']).toBe(97)
    expect(start(state).droneReviveStock).toEqual({})
  })

  it('无储备甲板的战损补机也只从共享本趟余量取', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 4 }
    state.warehouse.items['drone-scout'] = 100
    const run = prepare(state, fleet, { 'drone-scout': 1 })
    const battle = start(state)
    battle.droneLostBy = { player: { 'drone-scout': 4 } }
    finish(state, true)
    expect(run.supplies!.items['drone-scout']).toBeUndefined()
    expect(run.supplies!.deployed['drone-scout']).toBe(1)
    expect(state.fleet[fleet[0]!]!.droneLoad!['drone-scout']).toBeLessThan(4)
    expect(state.warehouse.items['drone-scout']).toBe(99)
  })
  it('维修从本趟按需扣，母港开关不兜底，满甲结构不耗件', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-hullrep-1']
    state.warehouse.items['repairkit-mil'] = 500
    const run = prepare(state, fleet, { 'repairkit-mil': 1 })
    const battle = start(state)
    const spec = createPlayerSpec(state, ctx, fleet[0]!)!
    spec.tag = 'player'
    const repair = preloadRepairFor(state, ctx, fleet[0]!, 240_000)!
    expect(repairKitAvailableOf(state, fleet[0]!, 'repairkit-mil')).toBe(1)
    pulseRepairsFor(state, ctx, battle, spec, repair)
    expect(run.supplies!.items['repairkit-mil']).toBe(1)
    battle.units.player!.hp.a = 0
    pulseRepairsFor(state, ctx, battle, spec, repair)
    expect(run.supplies!.items['repairkit-mil']).toBeUndefined()
    const before = battle.units.player!.hp.a
    pulseRepairsFor(state, ctx, battle, spec, repair)
    expect(battle.units.player!.hp.a).toBe(before)
    expect(state.warehouse.items['repairkit-mil']).toBe(499)
  })

  it('旧入口不写新标记，原仓库取用不变', () => {
    const { state, fleet, need } = setup(1)
    state.warehouse.items[BASE] = need
    expect(wormholeEnter(state, ctx, fleet, 7).ok).toBe(true)
    const battle = start(state)
    expect(state.wormhole.run!.supplyVersion).toBeUndefined()
    expect(battle.expeditionAmmo).toBeUndefined()
    finish(state, true)
    expect(state.warehouse.items[BASE]).toBe(need)
  })

  it('准备/战中/战后双轮存读不丢账或重装', () => {
    const { state, fleet, need } = setup(1)
    state.warehouse.items[BASE] = need * 2
    prepare(state, fleet, { [BASE]: need * 2 })
    const battle = start(state)
    consumeBattleAmmo(battle, 'player', 'kinetic', 5)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const twice = loadSaveFile(serializeSaveFile(loaded, 0)).state
    expect(twice.wormhole.run!.supplies).toEqual(state.wormhole.run!.supplies)
    expect(twice.wormhole.run!.battle!.expeditionAmmo).toEqual(battle.expeditionAmmo)
    finish(twice, true)
    expect(twice.wormhole.run!.supplies!.items[BASE]).toBe(need * 2 - 5)
    expect(twice.warehouse.items[BASE]).toBeUndefined()
    const final = loadSaveFile(serializeSaveFile(twice, 0)).state
    expect(final.wormhole.run!.supplies).toEqual(twice.wormhole.run!.supplies)
  })

  it('未知新趟标记不降为旧供货，空库存不会补造', () => {
    const { state, fleet } = setup(1)
    state.warehouse.items[BASE] = 10_000
    prepare(state, fleet, {})
    const file = JSON.parse(serializeSaveFile(state, 0))
    file.state.wormhole.run.supplyVersion = 99
    delete file.state.wormhole.run.supplies
    const loaded = loadSaveFile(JSON.stringify(file)).state
    expect(loaded.wormhole.run!.supplyVersion).toBe(1)
    expect(start(loaded).ammo.kin).toBe(0)
    expect(loaded.warehouse.items[BASE]).toBe(10_000)
  })
})
