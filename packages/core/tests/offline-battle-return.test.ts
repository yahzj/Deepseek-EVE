/**
 * 离线 × 战斗中：回归测试（2026-09-09 船长反馈"战斗中离线，上线后战斗已结束但船才开始返航"）。
 * 修复 = 结算转返航的计时起点从"结算时的 gameMs"改为"战斗停表时刻 battle.lastTickGameMs"，
 * 离线大步长下战斗结束后的离线剩余时间会正常"吃掉"返航（同帧跨阶段直接到港）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { simulateOffline } from '../src/simulation'
import { startExpedition } from '../src/expedition'
import { makeTestCtx, anomaly } from './helpers'

function world(seed = 7): { state: GameState; ctx: SimContext } {
  const ctx: SimContext = makeTestCtx({ quietEvents: true, anomalies: [anomaly('ano-weak3', 'galaxy-hub', { threat: 1, reward: 1_000 })] })
  const state: GameState = createInitialState({ nowWallMs: 0, seed })
  return { state, ctx }
}

/** 打到"交火中"（母港目标零航程：推进 1s 进入 battle，未分胜负） */
function enterBattle(state: GameState, ctx: SimContext): void {
  expect(startExpedition(state, 'ano-weak3', ctx).ok).toBe(true)
  advanceGame(state, 1_000, ctx)
  expect(state.expedition.phase).toBe('battle')
  expect(state.expedition.battle).not.toBeNull()
}

describe('战斗中离线：返航在离线期内结算（2026-09-09）', () => {
  it('战斗已分胜负、离线 10 分钟 → 同帧结算并完成返航到港（不再"上线才开始返航"）', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    const b = state.expedition.battle!
    const endedAt = b.lastTickGameMs // 停表时刻（≈ 1000ms）
    b.ended = 'me' // 模拟胜负已分、等待结算窗口（killcam）
    const logs0 = state.logs.length
    simulateOffline(state, 0, 10 * 60_000, ctx) // 离线 10 分钟 ≫ 本地返航 120s
    expect(state.expedition.active).toBe(false) // 已到港（或结算完成）
    expect(state.expedition.phase).not.toBe('back') // 不是"还在返航中"
    // 返航计时从战斗停表时刻起算：finishAt = endedAt + 本地返航段(120s) ≤ 离线末 → 未走"上线才返航"路径
    expect(state.logs.slice(logs0).some((l) => l.text.includes('携回') || l.text.includes('到站'))).toBe(true)
  })

  it('交火中直接离线 2 小时：整段（战斗+胜利返航）离线内全部结算，到港收工', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    simulateOffline(state, 0, 2 * 3_600_000, ctx)
    // 超弱敌必胜 + 母港本地返航 ≤120s，2 小时离线必然战斗打完并返航到港（修复前 = back 且刚到返航起点）
    expect(state.expedition.active).toBe(false)
    expect(state.expedition.phase).not.toBe('back')
  })
})
