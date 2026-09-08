/**
 * 离线结算 AI 核心作业统计（2026-09-08 船长定：离线报告按核心类型列出作业 + 预估收入）。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { startRefineRun } from '../src/industry'
import { countAiCore } from '../src/ai'
import { simulateOffline } from '../src/simulation'
import { newSettleStats } from '../src/settleStats'
import { makeTestCtx } from './helpers'

describe('离线结算：AI 核心作业统计（settleStats）', () => {
  it('AI 核心驱动的精炼炉按批统计并估收入', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx()
    // AI 核心一台 + 库存充足（默认炉：10 单位/批、6s/批 → AI 周期 15s）
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1 // 2026-09-08 AI 核心上限制：开 AI 炉需「AI 核心上限」资格
    state.warehouse.items['ore-a'] = 400
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)

    const stats = newSettleStats()
    // 离线 140 秒：AI 炉 15s/批 → 9 批（批到点才计）
    simulateOffline(state, 1_000_000, 1_000_000 + 140_000, ctx, undefined, { stats })

    expect(stats['basic']?.refineBatches).toBe(9)
    expect(stats['basic']?.miningTrips ?? 0).toBe(0)
    expect(stats['basic']?.income ?? 0).toBeGreaterThan(0)
    expect(stats['gamma']).toBeUndefined() // 其它类型不计
    expect(countAiCore(state, 'basic')).toBe(0) // AI 炉仍在转（料未尽），核心占用中
  })

  it('主控亲自运转的炉不计入 AI 统计', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx()
    state.warehouse.items['ore-a'] = 400
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)

    const stats = newSettleStats()
    simulateOffline(state, 5_000, 5_000 + 30_000, ctx, undefined, { stats })
    // 主控炉跑了 5 批（6s/批）但统计保持为空
    expect(state.refineRuns[0]?.batchesDone).toBeGreaterThan(0)
    expect(stats['basic']).toBeUndefined()
    expect(Object.keys(stats).length).toBe(0)
  })

  it('结算期结束后统计为空/正常推进不产生统计', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx()
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1 // 2026-09-08 AI 核心上限制：开 AI 炉需「AI 核心上限」资格
    state.warehouse.items['ore-a'] = 400
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    const stats = newSettleStats()
    simulateOffline(state, 5_000, 5_000 + 30_000, ctx, undefined, { stats })
    expect(stats['basic']?.refineBatches).toBe(2) // 30s / 15s
  })
})
