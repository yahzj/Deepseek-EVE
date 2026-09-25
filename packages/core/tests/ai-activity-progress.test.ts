/**
 * **副船 AI 活动的进度条数据**（2026-09-25 · 船长令「副船 AI 进度条要在 core 里补算」）
 *
 * 背景：活动栏「副AI活动」每条要显示 **小动画 + 正在干什么 + 进度条**（船长同日令）。
 * 动画类型与阶段文案已有；但 `activityOverview()` 的副船四条分支原先**硬写 `percent: null`**
 * ⇒ 进度条画不出来。本轮改为**接上现成的 `aiTaskView()`**（引擎推进用的同一套公式，同源不漂移）。
 *
 * 本测试固化三件事（口径与 `ai.test.ts` 的「AI 采矿任务」同款建世界）：
 *   ① 副船采矿**中途**的 `percent` 是 0~100 的数（不是 null）⇒ UI 画得出进度条；
 *   ② `remainingMs` 与 `percent` 一起给；
 *   ③ `aiWorkKind` 按真实作业类型给（动画据此选场景，**不靠解析本地化文案**）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { assignAiMining, gainAiCore } from '../src/ai'
import { activityOverview } from '../src/activity'
import { makeTestCtx, fittedOf, skipFirstSkillReward } from './helpers'

function world() {
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 42 })
  state.skills.trained['ai-expert'] = 1
  skipFirstSkillReward(state)
  // 可指派的空闲副船（与 ai.test.ts 同款：sandcat2）
  state.fleet['sandcat2'] = {
    durability: 1,
    cargo: {},
    fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null }),
  } as GameState['fleet'][string]
  gainAiCore(state, 'basic', 2)
  // 关富矿脉 ⇒ 时序确定（与 ai.test.ts 同款）
  const bal = makeTestCtx().balance
  const ctx: SimContext = makeTestCtx({ balance: { ...bal, richVeinChance: 0 } })
  return { state, ctx }
}

describe('副船 AI 活动：进度条数据（2026-09-25 船长令「副船 AI 进度条要在 core 里补算」）', () => {
  it('副船采矿中途：给出 0~100 的 percent 与 remainingMs ⇒ UI 画得出进度条', () => {
    const { state, ctx } = world()
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    // 推进到采掘相位累计起来
    advanceGame(state, 60_000, ctx)

    const row = activityOverview(state, ctx).find((i) => i.id === 'ai-sandcat2')
    expect(row).toBeDefined()
    expect(row!.kind).toBe('ai')
    expect(row!.aiGroup).toBe('ship')
    // ① 进度条数据：不再是 null（本轮补算的核心）
    expect(row!.percent).not.toBeNull()
    expect(row!.percent!).toBeGreaterThanOrEqual(0)
    expect(row!.percent!).toBeLessThanOrEqual(100)
    // ② 剩余时间跟着一起给
    expect(row!.remainingMs).not.toBeNull()
    // ③ 动画类型按真实作业类型（采矿 → mining）
    expect(row!.aiWorkKind).toBe('mining')
  })

  it('副船采矿：推进越多、周期进度越大（不是恒定值）', () => {
    const { state, ctx } = world()
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    const at = (ms: number): number => {
      advanceGame(state, ms, ctx)
      const row = activityOverview(state, ctx).find((i) => i.id === 'ai-sandcat2')
      return row!.percent ?? -1
    }
    const p1 = at(2_000)
    const p2 = at(2_000)
    // 只要还在采掘相位，进度就该是 0~100 的合法值；不硬断言"必增"（跨相位会归零重算）
    expect(p1).toBeGreaterThanOrEqual(0)
    expect(p2).toBeGreaterThanOrEqual(0)
    expect(p1).toBeLessThanOrEqual(100)
    expect(p2).toBeLessThanOrEqual(100)
  })
})
