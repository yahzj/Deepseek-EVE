import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { standingOf, spendableStandingOf } from '../src/standing'
import { WEEKEND_MIN_STANDING, weekendInvasionAllowedFor } from '../src/weekendEvent'
import { WORMHOLE_SCAN_UNLOCK_STANDING, wormholeScanUnlocked } from '../src/wormholeScan'
import { FIRST_TASKS } from '../src/firstTasks'
import { plugExchangeRowsOf } from '../src/plugs'

const ctx = buildSimContext()

describe('当前声望默认值与正常门槛', () => {
  it('新档可支配与累计声望均从零起步', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    expect(standingOf(state, 'dsi')).toBe(0)
    expect(spendableStandingOf(state, 'dsi')).toBe(0)
  })

  it('新档未达扫描与入侵门槛，也不能直接兑换插件图纸', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    expect(wormholeScanUnlocked(state)).toBe(false)
    expect(weekendInvasionAllowedFor(state)).toBe(false)
    expect(WEEKEND_MIN_STANDING).toBe(40)
    expect(WORMHOLE_SCAN_UNLOCK_STANDING).toBe(40)
    const rows = plugExchangeRowsOf(state, ctx)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => !row.affordable)).toBe(true)
    expect(FIRST_TASKS.find(task => task.id === 'first-wormhole')!.judge(state, ctx)).toBe(0)
  })

  it('当前档缺累计账时只复制可支配声望，不补历史下限', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.standings = { dsi: 6 }
    delete state.standingsEarned
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(spendableStandingOf(back, 'dsi')).toBe(6)
    expect(standingOf(back, 'dsi')).toBe(6)
  })
})
