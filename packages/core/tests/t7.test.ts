/**
 * T7 换船守卫（模式甲落点）：扫描/远征/采矿在途一律拒绝直接切换驾驶并给出明确警告方向；
 * 空闲时正常切换。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { changeShip } from '../src/shipyard'
import { makeTestCtx, ship } from './helpers'

function world() {
  const ctx: SimContext = makeTestCtx({ ships: [ship('sh-falconet', { cargo: 120 })], quietEvents: true })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
  return { state, ctx }
}

describe('T7 换船守卫：在途移动不可直接切换驾驶', () => {
  it('空闲时正常切换', () => {
    const { state, ctx } = world()
    expect(state.shipId).toBe('sandcat')
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(state.shipId).toBe('sh-falconet')
  })

  it('扫描探索往返途中：拒绝并提示可先终止扫描（进度保留）', () => {
    const { state, ctx } = world()
    state.scanning = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: 600_000, startedAtGameMs: 0, originGalaxy: null }
    const r = changeShip(state, 'sh-falconet', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('扫描')
    expect(r.error).toContain('进度保留')
    expect(state.shipId).toBe('sandcat')
    // 终止扫描后即可切换
    state.scanning.active = false
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(true)
  })

  it('远征在途：拒绝并提示到活动栏「召回」（无战果）', () => {
    const { state, ctx } = world()
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
    const r = changeShip(state, 'sh-falconet', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('召回')
    expect(state.shipId).toBe('sandcat')
  })

  it('采矿作业中切换驾驶：直接成功（旧船自动返航善后，采矿结束）', () => {
    const { state, ctx } = world()
    state.mining = {
      active: true,
      beltId: 'belt-a',
      phase: 'outbound',
      cycleAccMs: 0,
      phaseAccMs: 0,
      tripUnits: 0,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
    }
    const r = changeShip(state, 'sh-falconet', ctx)
    expect(r.ok).toBe(true)
    expect(state.shipId).toBe('sh-falconet')
    expect(state.mining.active).toBe(false)
    // 旧船进入善后返航账本（本地带：返航基准 120s）
    expect(state.shipReturns['sandcat']).toEqual({ beltId: 'belt-a', legMs: 120_000, phaseAccMs: 0 })
  })
})
