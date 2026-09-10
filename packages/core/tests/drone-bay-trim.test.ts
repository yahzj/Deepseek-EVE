/**
 * 机舱容量联动（2026-09-10 船长：卸下「无人机甲板扩展」后，超出机舱的无人机也要卸下）：
 * 机舱容量变小（卸甲板扩展 / 旧档槽位裁短）→ 超出容量的无人机自动按清单逆序卸下、退回仓库，
 * 并写事件日志 + 一次性提示；卸非甲板件（不影响机舱）不得触发。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, countWare, createInitialState, unfitAt, trimDroneLoadToBay } from '../src/index'
import { droneLoadM3 } from '../src/equipment'

const ctx = buildSimContext()

/** 梭鱼：机巢 160；甲板扩展 MK2 ×2 → 230。清单 220 m³（赤鸢×10 + 猎鹰×4 + 雷鸥×1）。 */
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  const uid = addShipToFleet(state, 'sh-swarm')
  state.shipId = uid
  const entry = state.fleet[uid]!
  entry.fitted = {
    high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2'],
    mid: [null, null, null],
    low: [null, null],
  }
  entry.droneLoad = { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }
  state.moduleBay['mod-drone-rack-2'] = 0
  return { state, uid }
}

describe('机舱容量联动：卸下甲板扩展自动卸下超出的无人机（2026-09-10 船长）', () => {
  it('卸一件甲板扩展（230→195 m³）→ 超出的雷鸥自动卸下并退回仓库', () => {
    const { state, uid } = world()
    expect(droneLoadM3(state.fleet[uid]!.droneLoad, ctx)).toBe(220) // 10×10+4×20+1×40
    expect(countWare(state, 'drone-sentry')).toBe(0)

    expect(unfitAt(state, 'high', 0, uid, ctx)).toBe(true) // 卸下第 1 位甲板扩展 → 容量 195

    // 逆序剔除：先卸清单末位的雷鸥（40 m³）→ 180 ≤ 195
    expect(state.fleet[uid]!.droneLoad).toEqual({ 'drone-assault': 10, 'drone-heavy': 4 })
    expect(countWare(state, 'drone-sentry')).toBe(1) // 退回仓库
    expect(state.logs.some((l) => l.text.includes('无人机舱容量缩小'))).toBe(true)
    expect(state.droneLossNotice).toContain('机舱容量不足')
  })

  it('卸到只剩船体机巢（195→160 m³ 再卸第二件）→ 继续自动卸下，直到装得下', () => {
    const { state, uid } = world()
    unfitAt(state, 'high', 0, uid, ctx) // 230→195（卸雷鸥后 180）
    unfitAt(state, 'high', 1, uid, ctx) // 195→160 → 180 仍超 → 再卸猎鹰（20）→ 160 装得下
    const load = state.fleet[uid]!.droneLoad!
    expect(droneLoadM3(load, ctx)).toBeLessThanOrEqual(160)
    expect(countWare(state, 'drone-sentry')).toBe(1)
    expect(countWare(state, 'drone-heavy')).toBe(1) // 卸下 1 架猎鹰退回仓库
  })

  it('卸不影响机舱的件（战术导控）→ 不触发任何卸下', () => {
    const { state, uid } = world()
    const before = JSON.stringify(state.fleet[uid]!.droneLoad)
    expect(unfitAt(state, 'high', 2, uid, ctx)).toBe(true) // 第 3 位 = 战术导控
    expect(JSON.stringify(state.fleet[uid]!.droneLoad)).toBe(before)
    expect(state.droneLossNotice).toBeUndefined()
    expect(state.logs.some((l) => l.text.includes('无人机舱容量缩小'))).toBe(false)
  })

  it('不超容时不动作（幂等）：直接调用整理函数返回 null', () => {
    const { state, uid } = world()
    expect(trimDroneLoadToBay(state, ctx, uid)).toBeNull()
    expect(state.fleet[uid]!.droneLoad).toEqual({ 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 })
  })

  it('未传 ctx（旧调用面）→ 只卸装备、不动机群（向后兼容）', () => {
    const { state, uid } = world()
    expect(unfitAt(state, 'high', 0, uid)).toBe(true)
    expect(state.fleet[uid]!.droneLoad).toEqual({ 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 })
  })
})
