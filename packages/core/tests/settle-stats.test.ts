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
import { startManufacturing } from '../src/manufacturing'
import { newSettleStats } from '../src/settleStats'
import { makeTestCtx, skipFirstSkillReward } from './helpers'

describe('离线结算：AI 核心作业统计（settleStats）', () => {
  it('AI 核心驱动的精炼炉按批统计并估收入', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx()
    // AI 核心一台 + 库存充足（默认炉：10 单位/批、6s/批 → AI 周期 15s）
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1 // 2026-09-08 AI 核心上限制：开 AI 炉需「AI 核心上限」资格
    // 只考机制、不考「第一次」奖励：预置该任务已完成（否则引擎首拍送一枚基础 AI 核心）
    skipFirstSkillReward(state)
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
    // 只考机制、不考「第一次」奖励：预置该任务已完成（否则引擎首拍送一枚基础 AI 核心）
    skipFirstSkillReward(state)
    state.warehouse.items['ore-a'] = 400
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    const stats = newSettleStats()
    simulateOffline(state, 5_000, 5_000 + 30_000, ctx, undefined, { stats })
    expect(stats['basic']?.refineBatches).toBe(2) // 30s / 15s
  })

  it('造船完成计入 shipsDone，产出入的是舰船仓库（2026-09-14 船长「补」）', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx()
    // 默认测试舰船蓝图 sbp-a（造 sandcat2 · 60s · 材料 min-a ×5）——AI 核心驱动 + 材料备足
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1 // 开 AI 线需「AI 核心上限」资格
    // 只考机制、不考「第一次」奖励：预置该任务已完成（否则引擎首拍送一枚基础 AI 核心）
    skipFirstSkillReward(state)
    state.learnedRecipes.push('sbp-a')
    state.warehouse.items['min-a'] = 50
    expect(startManufacturing(state, 'sbp-a', 'basic', ctx).ok).toBe(true)
    const fleetBefore = Object.keys(state.fleet).length

    const stats = newSettleStats()
    simulateOffline(state, 0, 300_000, ctx, undefined, { stats })

    expect(stats['basic']?.makeDone).toBe(1)
    expect(stats['basic']?.shipsDone).toBe(1)
    expect(state.shipStore?.['sandcat2']).toBe(1) // 入舰船仓库（不再直接进舰队）
    expect(Object.keys(state.fleet).length).toBe(fleetBefore)
    expect(state.logs.some((l) => l.text.includes('已入舰船仓库'))).toBe(true) // 逐件日志写明去处
  })

  it('装备制造只计 makeDone，不计 shipsDone', () => {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx()
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1
    // 只考机制、不考「第一次」奖励：预置该任务已完成（否则引擎首拍送一枚基础 AI 核心）
    skipFirstSkillReward(state)
    state.learnedRecipes.push('bp-b') // 造 mod-b · 300s · 材料 min-b ×8
    state.warehouse.items['min-b'] = 80
    expect(startManufacturing(state, 'bp-b', 'basic', ctx).ok).toBe(true)

    const stats = newSettleStats()
    simulateOffline(state, 0, 3_600_000, ctx, undefined, { stats })

    expect(stats['basic']?.makeDone).toBe(1)
    expect(stats['basic']?.shipsDone).toBe(0)
    expect(state.shipStore ?? {}).toEqual({})
  })
})
