import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { INVASION_BEACON_TYPES, useInvasionBeacon } from '../src/consumables'
import {
  WEEKEND_DEBUG_AUTO_START_ENABLED, WEEKEND_FIRST_T0_WALL_MS, WEEKEND_WINDOW_MS,
  endWeekendEvent, ensureWeekendEvent, weekendFamilyForWindow, weekendRollOccupation, weekendTick,
} from '../src/weekendEvent'

const ctx = buildSimContext()
const hour = 3_600_000
const friday = new Date(2026, 9, 16, 20).getTime()
function fresh(debug = true) {
  const state = createInitialState({ nowWallMs: friday, seed: 41 })
  state.debugQuick = debug
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  return state
}

describe('暂时暂停调试入侵自动开场', () => {
  it('首调、首场历史特例和正常周窗口均不开调试新场，状态与随机数不变', () => {
    expect(WEEKEND_DEBUG_AUTO_START_ENABLED).toBe(false)
    for (const time of [friday, friday + 5 * 24 * hour, WEEKEND_FIRST_T0_WALL_MS!]) {
      const state = fresh()
      const before = structuredClone(state)
      expect(ensureWeekendEvent(state, ctx, time)).toBe(false)
      expect(state).toEqual(before)
      expect(weekendTick(state, ctx, time, time).started).toBe(false)
      expect(state).toEqual(before)
    }
  })

  it('已结束调试场即使经过一小时或多周也不重开，不覆盖旧结果', () => {
    const state = fresh()
    state.weekendEvent = { ...weekendRollOccupation(state, ctx, 3)!, seq: 3, startedAtWallMs: friday, contributed: {} }
    endWeekendEvent(state, friday + hour)
    const before = structuredClone(state)
    for (const time of [friday + 3 * hour, friday + 21 * 24 * hour]) {
      expect(ensureWeekendEvent(state, ctx, time)).toBe(false)
      expect(weekendTick(state, ctx, time, time).started).toBe(false)
      expect(state).toEqual(before)
    }
  })

  it('已有入侵不清除、不改族；进度完成后旗舰仍可现身', () => {
    const state = fresh()
    const rolled = weekendRollOccupation(state, ctx, 5, 'C')!
    state.weekendEvent = { ...rolled, seq: 5, startedAtWallMs: friday, contributed: Object.fromEntries([rolled.coreId, ...rolled.peripheryIds].map(id => [id, 1])) }
    const before = structuredClone(state.weekendEvent)
    expect(ensureWeekendEvent(state, ctx, friday + 1000)).toBe(false)
    expect(state.weekendEvent).toEqual(before)
    const tick = weekendTick(state, ctx, friday + 1000, friday)
    expect(tick.started).toBe(false)
    expect(tick.flagshipShown).toBe(true)
    expect(tick.flagshipAnchored).toBe(true)
    expect(state.weekendEvent).toMatchObject({ seq: 5, family: 'C', contributed: before.contributed })
  })

  it.each(INVASION_BEACON_TYPES)('$itemId手动启动保留；后续自动检查不替换该场', ({ itemId, familyId }) => {
    const state = fresh()
    state.warehouse.items[itemId] = 1
    expect(useInvasionBeacon(state, ctx, { itemId }).ok).toBe(true)
    expect(state.weekendEvent?.beaconLit).toBe(true)
    if (familyId) expect(state.weekendEvent?.family).toBe(familyId)
    expect(state.warehouse.items[itemId] ?? 0).toBe(0)
    const before = structuredClone(state.weekendEvent)
    expect(ensureWeekendEvent(state, ctx, friday + 1000)).toBe(false)
    expect(state.weekendEvent).toEqual(before)
  })

  it('正常模式仍按周排期、声望及窗口开场，关闭调试后也恢复正常规则', () => {
    const state = fresh(false)
    expect(ensureWeekendEvent(state, ctx, friday + hour)).toBe(true)
    expect(state.weekendEvent).toMatchObject({ startedAtWallMs: friday, family: weekendFamilyForWindow(friday) })
    const outside = fresh(false)
    expect(ensureWeekendEvent(outside, ctx, friday + WEEKEND_WINDOW_MS)).toBe(false)
    const lowStanding = fresh(false)
    lowStanding.standings.dsi = 0
    lowStanding.standingsEarned = { dsi: 0 }
    expect(ensureWeekendEvent(lowStanding, ctx, friday + hour)).toBe(false)
    const toggled = fresh()
    expect(ensureWeekendEvent(toggled, ctx, friday + hour)).toBe(false)
    toggled.debugQuick = false
    expect(ensureWeekendEvent(toggled, ctx, friday + hour)).toBe(true)
  })
})
