import { describe, expect, it } from 'vitest'
import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { addShipToFleet } from '../../packages/core/src/fleetBook'
import { addModule, fitModule, fittedCpuUsed, cpuBudgetOf, adjustDroneLoad, droneCpuUsed, droneLoadM3 } from '../../packages/core/src/equipment'
import { startFleetBattleFor, advanceBattleFor } from '../../packages/core/src/combat'
import { STATION_SECURITY_SOURCES } from '../../packages/core/src/playerStation/security'
import { SECURITY_SHIPS, SECURITY_SUPPLIES, SECURITY_LOADOUTS, SECURITY_DRONES, securitySourceName, resolveSecurityBattle } from './security-baseline'

describe('玩家站安全真实战斗适配', () => {
  it('三艘现有船独立定义，来源和补给都存在于真实内容表', () => {
    const ctx = buildSimContext()
    expect(SECURITY_SHIPS).toHaveLength(3)
    for (const ship of SECURITY_SHIPS) {
      expect(ctx.ships.get(ship.defId)?.name).toBe(ship.name)
      expect(ship.trainingTags).toContain('fire-control')
      expect([1, 2, 3]).toContain(ship.tier)
    }
    for (const source of STATION_SECURITY_SOURCES) expect(securitySourceName(source.id)).toBe(ctx.anomalies.get(source.id)?.name)
    expect(securitySourceName('unknown')).toBe('unknown')
    for (const id of Object.keys(SECURITY_SUPPLIES)) expect(ctx.items.has(id)).toBe(true)
    expect(SECURITY_SHIPS[2]!.trainingTags).toEqual(['fire-control', 'damage-control', 'drones'])
  })
  it('适配结果逐项等于原多舰战斗引擎，报告用弹不超过每舰60发', () => {
    const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 20261121 })
    state.fleet = {}; state.warehouse.items = {}; state.resupplyFromWarehouse = false
    const ids = SECURITY_SHIPS.slice(0, 2).map(ship => {
      const id = addShipToFleet(state, ship.defId)
      for (const moduleId of SECURITY_LOADOUTS[ship.id]!) {
        addModule(state, moduleId, 1)
        expect(fitModule(state, moduleId, ctx, { shipId: id }).ok).toBe(true)
      }
      expect(fittedCpuUsed(state.fleet[id]!.fitted, ctx)).toBeLessThanOrEqual(cpuBudgetOf(state, ctx, id))
      state.fleet[id]!.cargo = { 'ammo-kinetic-l': 60 }
      return id
    })
    state.shipId = ids[0]!
    const source = STATION_SECURITY_SOURCES[0]!.id
    const battle = startFleetBattleFor(state, ctx, ids, source, 0)!
    for (let elapsed = 1000; elapsed <= 30 * 60_000 && !battle.ended; elapsed += 1000) {
      state.gameMs = elapsed; advanceBattleFor(state, ctx, battle, state.shipId, source)
    }
    const result = resolveSecurityBattle(SECURITY_SHIPS.slice(0, 2).map(ship => ship.id), source)
    expect(result.outcome).toBe(battle.ended === 'me' ? 'victory' : 'defeat')
    expect(result.durationMs).toBe(battle.lastTickGameMs - battle.startedAtGameMs)
    expect(result.ammoUsed?.['ammo-kinetic-l'] ?? 0).toBe(battle.ammoLoaded!.kin - battle.ammo.kin)
    expect(result.ammoUsed?.['ammo-kinetic-l'] ?? 0).toBeLessThanOrEqual(120)
    for (const id of Object.keys(result.reward)) expect(ctx.items.has(id)).toBe(true)
  })
  it('所有来源可得真实胜败，增量实际改变交火，不污染其他调用', () => {
    const id = SECURITY_SHIPS[0]!.id
    for (const source of STATION_SECURITY_SOURCES) {
      const base = resolveSecurityBattle([id], source.id)
      const boosted = resolveSecurityBattle([id], source.id, { [id]: { damagePct: 10, defensePct: 10 } })
      expect(['victory', 'defeat']).toContain(base.outcome)
      expect(boosted.outcome).toBe('victory')
      expect(boosted.durationMs).toBeLessThan(base.durationMs)
      expect(base.ammoUsed?.['ammo-kinetic-l'] ?? 0).toBeLessThanOrEqual(60)
      expect(resolveSecurityBattle([id], source.id)).toEqual(base)
    }
  })
  it('无船员增量也能清完三个来源，整编与单舰均受有限弹药约束', () => {
    const id = SECURITY_SHIPS[2]!.id
    expect(resolveSecurityBattle([SECURITY_SHIPS[0]!.id], STATION_SECURITY_SOURCES[2]!.id).outcome).toBe('defeat')
    for (const source of STATION_SECURITY_SOURCES) {
      expect(resolveSecurityBattle([id], source.id).outcome).toBe('victory')
      const fleet = resolveSecurityBattle(SECURITY_SHIPS.map(ship => ship.id), source.id)
      expect(fleet.outcome).toBe('victory')
      expect(fleet.ammoUsed?.['ammo-kinetic-l'] ?? 0).toBeLessThanOrEqual(180)
    }
  })
  it('伤害和防御增量分别实际参与交火，不只改变展示字段', () => {
    const id = SECURITY_SHIPS[0]!.id, source = STATION_SECURITY_SOURCES[2]!.id
    const base = resolveSecurityBattle([id], source)
    const fire = resolveSecurityBattle([id], source, { [id]: { damagePct: 10, defensePct: 0 } })
    const armor = resolveSecurityBattle([id], source, { [id]: { damagePct: 0, defensePct: 10 } })
    expect(fire.outcome).toBe('victory')
    expect(fire.durationMs).toBeLessThan(base.durationMs)
    expect(armor.durationMs).toBeGreaterThan(base.durationMs)
    expect(armor.ammoUsed?.['ammo-kinetic-l'] ?? 0).toBeLessThanOrEqual(60)
  })
  it('第三舰真实装载维修和无人机，原入口核对CPU与机舱，原引擎有维修账和作战机群', () => {
    const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 20261121 })
    state.fleet = {}; state.resupplyFromWarehouse = false; state.warehouse.items = {}
    const definition = SECURITY_SHIPS[2]!, id = addShipToFleet(state, definition.defId)
    state.shipId = id
    for (const moduleId of SECURITY_LOADOUTS[id]!) {
      addModule(state, moduleId, 1)
      expect(fitModule(state, moduleId, ctx, { shipId: id }).ok).toBe(true)
    }
    for (const [droneId, count] of Object.entries(SECURITY_DRONES[id]!)) {
      state.warehouse.items[droneId] = count
      expect(adjustDroneLoad(state, ctx, droneId, count, id).ok).toBe(true)
    }
    const ship = state.fleet[id]!
    expect(fittedCpuUsed(ship.fitted, ctx) + droneCpuUsed(ship.droneLoad, ctx)).toBeLessThanOrEqual(cpuBudgetOf(state, ctx, id))
    expect(droneLoadM3(ship.droneLoad, ctx)).toBeLessThanOrEqual(ctx.ships.get(id)!.droneBayM3!)
    ship.cargo = { 'ammo-kinetic-l': 60, 'repairkit-mil': 4 }
    const source = STATION_SECURITY_SOURCES[2]!.id
    const battle = startFleetBattleFor(state, ctx, [id], source, 0)!
    expect(battle.repairBy!.player!.units.some(unit => unit.moduleId === 'mod-hullrep-1')).toBe(true)
    expect(Object.values(battle.dronePools ?? {}).some(pool => pool.artId === 'drone-scout')).toBe(true)
    battle.units.player!.hp.a = 1
    battle.units.player!.hp.h = 1
    state.gameMs = 10_000
    advanceBattleFor(state, ctx, battle, id, source)
    expect(battle.repairBy!.player!.kitsUsed).toBeGreaterThan(0)
    expect(battle.repairBy!.player!.kitsUsed).toBeLessThanOrEqual(4)
    for (const row of STATION_SECURITY_SOURCES) {
      const result = resolveSecurityBattle([id], row.id)
      expect(result.outcome).toBe('victory')
      expect(result.ammoUsed?.['ammo-kinetic-l'] ?? 0).toBeLessThanOrEqual(60)
      expect(result.ammoUsed?.['repairkit-mil'] ?? 0).toBeLessThanOrEqual(4)
    }
  })
  it('拒绝重复船、外来船、外来来源及非法增量', () => {
    const id = SECURITY_SHIPS[0]!.id, source = STATION_SECURITY_SOURCES[0]!.id
    for (const ids of [[], [id, id], ['missing']]) expect(() => resolveSecurityBattle(ids, source)).toThrow()
    expect(() => resolveSecurityBattle([id], 'ano-training')).toThrow()
    for (const damagePct of [-1, Infinity, NaN, 11]) expect(() => resolveSecurityBattle([id], source, { [id]: { damagePct, defensePct: 0 } })).toThrow()
    expect(() => resolveSecurityBattle([id], source, { other: { damagePct: 0, defensePct: 0 } })).toThrow()
  })
})
