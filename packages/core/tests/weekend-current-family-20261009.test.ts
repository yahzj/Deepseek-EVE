import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ensureWeekendEvent, weekendFamilyForWindow, weekendFoePoolOf } from '../src/weekendEvent'
import { weekendAssaultSpecOf } from '../src/weekendBattle'
import { setStanding } from './helpers'

const ctx = buildSimContext()
const t0 = new Date(2026, 9, 9, 20).getTime()

function fresh() {
  const state = createInitialState({ nowWallMs: t0, seed: 20261009 })
  state.debugQuick = false
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  setStanding(state, 'dsi', 60)
  return state
}

describe('本周入侵族与普通旧场保留（2026-10-09）', () => {
  it('最新普通客户端在20:00新开场为C，核心与外围均使用C族卡', () => {
    const state = fresh()
    expect(weekendFamilyForWindow(t0)).toBe('C')
    expect(ensureWeekendEvent(state, ctx, t0)).toBe(true)
    const ev = state.weekendEvent!
    expect(ev.family).toBe('C')
    expect(ev.startedAtWallMs).toBe(t0)
    for (const id of [ev.coreId, ...ev.peripheryIds]) {
      const spec = weekendAssaultSpecOf(state, ctx, id)!
      expect(ctx.anomalies.has(spec.cardId)).toBe(true)
      expect(weekendFoePoolOf('C', id === ev.coreId)).toContain(spec.cardId)
    }
  })

  it('旧客户端已开启的本周H场，升级读档后仍保留H，不会被新排期自动追改', () => {
    const state = fresh()
    ensureWeekendEvent(state, ctx, t0)
    state.weekendEvent!.family = 'H'
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    const before = structuredClone(loaded.weekendEvent)
    expect(weekendFamilyForWindow(t0)).toBe('C')
    expect(ensureWeekendEvent(loaded, ctx, t0 + 30 * 60_000)).toBe(false)
    expect(loaded.weekendEvent).toEqual(before)
    expect(loaded.weekendEvent!.family).toBe('H')
  })

  it('授权只改family后，读档与后续排期检查保留C及原场进度', () => {
    const state = fresh()
    ensureWeekendEvent(state, ctx, t0)
    const ev = state.weekendEvent!
    ev.family = 'H'
    ev.contributed[ev.coreId] = 0.3
    ev.flagshipHpMax = 150_000
    ev.flagshipHpDone = 12_345
    const before = structuredClone(ev)
    ev.family = 'C'
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    expect(ensureWeekendEvent(loaded, ctx, t0 + 30 * 60_000)).toBe(false)
    expect(loaded.weekendEvent).toMatchObject({ ...before, family: 'C' })
  })
})
