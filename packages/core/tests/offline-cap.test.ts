/**
 * **离线结算上限（含技能加成）：结算与"超出上限"读数必须同源**（2026-09-22 船长报障
 * 「**技能的离线时间上限不生效好像**」）。
 *
 * 根因：加成原先只在 `simulateOffline` 内部算，而**引擎侧四处**（启动离线 / 读档 / 导入档 / 调试快进）
 * 各自用 `offlineSplit(…, 默认 8 小时)` 算"超出上限的未结算时长" ⇒ **结算按 16~32h 走、报告按 8h 报**，
 * 玩家看到的就是"技能没用"。修法 = 单点 `offlineCapMsOf(state)`，两处都读它。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { DEFAULT_OFFLINE_CAP_MS, offlineCapMsOf, offlineSplit, simulateOffline } from '../src/simulation'
import { createInitialState } from '../src/state'

const H = 3_600_000

describe('离线结算上限 · 技能加成与读数同源', () => {
  it('上限随两条技能加算（8h 基础 → 16h / 24h → 双满级 32h）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 3 })
    expect(offlineCapMsOf(s)).toBe(8 * H)
    s.skills.trained['offline-ops'] = 5
    expect(offlineCapMsOf(s)).toBe(16 * H)
    s.skills.trained['offline-ops'] = 0
    s.skills.trained['unattended-dispatch'] = 5
    expect(offlineCapMsOf(s)).toBe(24 * H)
    s.skills.trained['offline-ops'] = 5
    expect(offlineCapMsOf(s)).toBe(32 * H)
  })

  it('溢出读数与结算用的是同一个上限（船长报障的回归护栏）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    state.skills.trained['offline-ops'] = 5 // 上限 → 16h
    const gap = 20 * H
    // 引擎侧读数（修后同源）：20h 里只有 4h 超出
    const { deltaMs, overflowMs } = offlineSplit(gap, offlineCapMsOf(state))
    expect(deltaMs).toBe(16 * H)
    expect(overflowMs).toBe(4 * H)
    // 结算侧：走满 16h（而不是默认 8h）——两者必须一致
    const ctx = buildSimContext()
    simulateOffline(state, 1_000, 1_000 + gap, ctx)
    expect(state.gameMs).toBe(16 * H)
  })

  it('无技能时仍是默认 8 小时（老口径不变）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 4 })
    const ctx = buildSimContext()
    simulateOffline(state, 1_000, 1_000 + 20 * H, ctx)
    expect(state.gameMs).toBe(DEFAULT_OFFLINE_CAP_MS)
  })
})
