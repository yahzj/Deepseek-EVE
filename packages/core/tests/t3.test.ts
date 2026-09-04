/**
 * T3 货仓归属：按船只读查询（货仓内容/占用/容量含货舱装备加成）+ 船忙态判定（shipBusyLabel）。
 */
import { describe, expect, it } from 'vitest'
import type { AiCoreType } from '../src/types'
import { createInitialState } from '../src/state'
import { emptyFitted } from '../src/labels'
import { cargoCapacityM3Of, cargoItemsOf, cargoOfShip, cargoUsedM3Of } from '../src/inventory'
import { shipBusyLabel } from '../src/activity'
import { startMining } from '../src/mining'
import { makeTestCtx, ship } from './helpers'

/** 默认舰队 = 驾驶船（sandcat，800 m³）+ 初始附赠武装艇 sh-falconet（data 无 def）；ctx 另带一艘货船 def */
function world() {
  const ctx = makeTestCtx({ ships: [ship('bighauler', { cargo: 500 })], quietEvents: true })
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  // 测试船入舰队（停泊状态）
  state.fleet['bighauler'] = { durability: 1, cargo: {}, fitted: emptyFitted() }
  return { state, ctx }
}

describe('T3 按船货仓只读查询', () => {
  it('cargoOfShip / 占用 / 容量：各自按船的货物与船体+货舱槽装备计算，互不影响', () => {
    const { state, ctx } = world()
    // 驾驶船 sandcat：装 50 单位矿甲（1 m³/单位）
    state.fleet.sandcat.cargo['ore-a'] = 50
    // 副船 bighauler：装 100 单位矿甲，且货舱槽装了 +30% 的 mod-b
    state.fleet.bighauler.cargo['ore-b'] = 100
    state.fleet.bighauler.fitted = { ...emptyFitted(), cargo: 'mod-b' }

    expect(cargoOfShip(state, 'sandcat')).toEqual({ 'ore-a': 50 })
    expect(cargoOfShip(state, 'bighauler')).toEqual({ 'ore-b': 100 })
    // 驾驶船口径（旧函数）仍指当前驾驶船
    expect(cargoItemsOf(state)).toEqual({ 'ore-a': 50 })

    expect(cargoUsedM3Of(state, ctx, 'sandcat')).toBe(50)
    expect(cargoUsedM3Of(state, ctx, 'bighauler')).toBe(100)
    expect(cargoCapacityM3Of(state, ctx, 'sandcat')).toBe(800)
    // 500 m³ × (1 + 0.3) = 650
    expect(cargoCapacityM3Of(state, ctx, 'bighauler')).toBe(650)

    // 数据表缺 def 的船（sh-falconet）：容量按 0、货仓照读
    expect(cargoCapacityM3Of(state, ctx, 'sh-falconet')).toBe(0)
    expect(cargoOfShip(state, 'sh-falconet')).toEqual({})
    // 不存在的船全按空
    expect(cargoOfShip(state, 'ghost')).toEqual({})
    expect(cargoUsedM3Of(state, ctx, 'ghost')).toBe(0)
    expect(cargoCapacityM3Of(state, ctx, 'ghost')).toBe(0)
  })
})

describe('T3 shipBusyLabel：船忙态判定', () => {
  it('驾驶船：空闲 null；采矿中/出航/返航；扫描中；远征去程/交火/返航', () => {
    const { state, ctx } = world()
    const piloted = state.shipId
    expect(shipBusyLabel(state, ctx, piloted)).toBeNull()

    // 采矿（主控）：T4 起开工先显式出航（30s 行程）
    const r = startMining(state, 'belt-a', ctx)
    expect(r.ok).toBe(true)
    expect(shipBusyLabel(state, ctx, piloted)).toBe('采矿·出航中')
    state.mining.phase = 'mining'
    expect(shipBusyLabel(state, ctx, piloted)).toBe('采矿中')
    state.mining.phase = 'returning'
    expect(shipBusyLabel(state, ctx, piloted)).toBe('采矿·返航中')
    state.mining.active = false

    // 扫描探索
    state.scanning = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: 600_000, startedAtGameMs: 0, originGalaxy: null }
    expect(shipBusyLabel(state, ctx, piloted)).toBe('扫描探索中')
    state.scanning.active = false

    // 远征（主控）
    state.expedition = {
      active: true,
      anomalyId: 'ano-a',
      finishAtGameMs: 120_000,
      durationMs: 240_000,
      outMs: 120_000,
      combatMs: 60_000,
      power: 1,
      eventId: null,
      eventFired: false,
      phase: 'out',
      battle: null,
    }
    expect(shipBusyLabel(state, ctx, piloted)).toBe('远征·出航中')
    state.expedition.phase = 'battle'
    expect(shipBusyLabel(state, ctx, piloted)).toBe('远征·交火中')
    state.expedition.phase = 'back'
    expect(shipBusyLabel(state, ctx, piloted)).toBe('远征·返航中')
  })

  it('副船：AI 采矿/远征各阶段有徽标；闲置副船与未知船 null', () => {
    const { state, ctx } = world()
    expect(shipBusyLabel(state, ctx, 'bighauler')).toBeNull()
    expect(shipBusyLabel(state, ctx, 'ghost-ship')).toBeNull()

    const assign = (shipId: string, task: unknown, core: AiCoreType = 'basic') => {
      state.aiAssignments[shipId] = {
        coreType: core,
        startedAtGameMs: 0,
        task: task as never,
      }
    }
    assign('bighauler', { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 })
    expect(shipBusyLabel(state, ctx, 'bighauler')).toBe('AI 采矿中')
    state.aiAssignments['bighauler']!.task = {
      kind: 'mining',
      beltId: 'belt-a',
      phase: 'returning',
      cycleAccMs: 0,
      phaseAccMs: 0,
      tripUnits: 0,
    }
    expect(shipBusyLabel(state, ctx, 'bighauler')).toBe('AI 采矿·返航中')

    assign('bighauler', {
      kind: 'expedition',
      anomalyId: 'ano-a',
      finishAtGameMs: 120_000,
      outMs: 120_000,
      power: 1,
      phase: 'battle',
      battle: null,
    })
    expect(shipBusyLabel(state, ctx, 'bighauler')).toBe('AI 远征·交火中')
    state.aiAssignments['bighauler']!.task = {
      kind: 'expedition',
      anomalyId: 'ano-a',
      finishAtGameMs: 120_000,
      outMs: 120_000,
      power: 1,
      phase: 'out',
      battle: null,
    }
    expect(shipBusyLabel(state, ctx, 'bighauler')).toBe('AI 远征·去程中')
  })
})
