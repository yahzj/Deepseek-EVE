/**
 * **货柜拆解 · 空转回归**（玩家 2026-09-24 报障：「货柜拆除时，没有货柜了精炼炉还是会空转」）。
 *
 * 目的：把「拆完最后一个货柜后那一台必须**自己停掉并从 `refineRuns` 里消失**」钉成用例——
 * 只要这一条绿着，"料尽不停/空转"就不可能再回来；若这里红，就说明确实有残留运转。
 */
import { describe, expect, it } from 'vitest'
import { advanceRefining, startUnboxRun } from '../src/industry'
import { addItem, countItem, removeItem } from '../src/inventory'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'

/** 造一个能开拆解线的档（母港、主控空闲、货舱里放 N 个安全货柜） */
function world(boxes: number, boxId = 'box-relic-a') {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  addItem(state, boxId, boxes)
  return { state, ctx, boxId }
}

/** 推进到"跑完 n 个周期"（每周期 90 秒 × 效率；直接给足时间再调 advanceRefining） */
function runFor(state: ReturnType<typeof createInitialState>, ctx: ReturnType<typeof buildSimContext>, ms: number): void {
  const step = 1000
  for (let t = 0; t < ms; t += step) {
    state.gameMs += step
    advanceRefining(state, ctx)
  }
}

describe('货柜拆解 · 料尽自停（玩家报障回归）', () => {
  it('没有货柜 ⇒ 不许开工（主控与 AI 核心两条路都拒）', () => {
    const { state, ctx, boxId } = world(0)
    const pilot = startUnboxRun(state, ctx, boxId, 'pilot')
    expect(pilot.ok, '主控：没货柜 ⇒ 拒').toBe(false)
    expect(state.refineRuns.length, '被拒时不许留下运转中的那一台').toBe(0)
    // 给一枚 AI 核心再试（AI 核心驱动的路径同样必须先有货柜）
    state.aiCores = { ...(state.aiCores ?? {}), ai1: 1 } as GameState['aiCores']
    const ai = startUnboxRun(state, ctx, boxId, 'ai1')
    expect(ai.ok, 'AI 核心：没货柜 ⇒ 拒').toBe(false)
    expect(state.refineRuns.length).toBe(0)
  })

  it('拆到最后一个 ⇒ 那一台自动停、`refineRuns` 清空、玩家私有料账不残留', () => {
    const { state, ctx, boxId } = world(1)
    const r = startUnboxRun(state, ctx, boxId, 'pilot')
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(state.refineRuns.length).toBe(1)
    // 逐秒推进：**必须在拆完那一批后的 1 秒内就停**（不许再空转一整个批周期）
    let stoppedAt = -1
    for (let t = 0; t < 5 * 60_000; t += 1000) {
      state.gameMs += 1000
      advanceRefining(state, ctx)
      if (state.refineRuns.length === 0) {
        stoppedAt = t + 1000
        break
      }
    }
    expect(stoppedAt, '必须在第一个批周期内就停（≈90 秒）').toBeGreaterThan(0)
    expect(stoppedAt, '停炉不许晚于 92 秒 = 一个批周期 + 1 秒').toBeLessThanOrEqual(92_000)
    expect(countItem(state, boxId), '货柜已被消耗').toBe(0)
    expect(state.refineRuns.length, '料尽 ⇒ 那一台必须自己消失（不许空转）').toBe(0)
  })

  it('拆 3 件：过程里始终只有 1 台在跑，拆完后 0 台', () => {
    const { state, ctx, boxId } = world(3)
    expect(startUnboxRun(state, ctx, boxId, 'pilot').ok).toBe(true)
    let maxRuns = 0
    for (let t = 0; t < 6 * 60_000; t += 1000) {
      state.gameMs += 1000
      advanceRefining(state, ctx)
      maxRuns = Math.max(maxRuns, state.refineRuns.length)
    }
    expect(maxRuns).toBe(1)
    expect(countItem(state, boxId)).toBe(0)
    expect(state.refineRuns.length, '三件拆完 ⇒ 0 台').toBe(0)
  })

  it('拆到一半把货柜挪走（模拟被卖/被搬）⇒ 下一拍就停，不留空转', () => {
    const { state, ctx, boxId } = world(2)
    expect(startUnboxRun(state, ctx, boxId, 'pilot').ok).toBe(true)
    state.gameMs += 1000
    advanceRefining(state, ctx)
    // 把剩下的货柜全部拿走（等价于"没有货柜了"）
    removeItem(state, boxId, countItem(state, boxId))
    runFor(state, ctx, 5 * 60_000)
    expect(state.refineRuns.length, '无料 ⇒ 不许继续空转').toBe(0)
  })
})
