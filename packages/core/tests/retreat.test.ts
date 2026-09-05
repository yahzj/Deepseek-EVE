/**
 * 战斗中"撤退"（Q1乙 轻损 / Q3甲 同时停连击）：仅损失少量耐久（≈战败扣损的半量）、无弃船骰、
 * 耐久下限保护（绝不 ≤0 弃船）、转自动返航。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { retreatBattle, startExpedition } from '../src/expedition'
import { durabilityOf } from '../src/shipyard'
import { makeTestCtx } from './helpers'

function world() {
  const ctx: SimContext = makeTestCtx({ quietEvents: true })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
  return { state, ctx }
}

/** 打到"交火中"（母港目标零航程：推进 1s 进入 battle，未分胜负） */
function enterBattle(state: GameState, ctx: SimContext): void {
  expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
  advanceGame(state, 1_000, ctx)
  expect(state.expedition.phase).toBe('battle')
  expect(state.expedition.battle).not.toBeNull()
}

describe('战斗中撤退（轻损）', () => {
  it('非交火状态拒绝；撤退成功后转返航、耐久只扣约一半且不低于下限、无弃船', () => {
    const { state, ctx } = world()
    expect(retreatBattle(state, ctx).ok).toBe(false) // 无战斗
    enterBattle(state, ctx)
    const before = durabilityOf(state, state.shipId)
    expect(retreatBattle(state, ctx).ok).toBe(true)
    const after = durabilityOf(state, state.shipId)
    expect(state.expedition.phase).toBe('back') // 自动返航
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
    // 扣损约为战败骰（15%~30%）的一半：约 7.5%~15%
    const lost = before - after
    expect(lost).toBeLessThan(0.16)
    expect(state.fleet[state.shipId]).toBeDefined() // 绝不弃船
    expect(state.logs.some((l) => l.kind === 'warn' && l.text.includes('撤退'))).toBe(true)
  })

  it('耐久扣到 ≤0 时压到 5% 下限（保护性钳制，不弃船）并显著告警', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    // P0 承伤持久化：耐久=结构层——把本场玩家单位结构打到 0（甲 0、仅剩盾）模拟结构崩坏
    const u = state.expedition.battle!.units['player']!
    u.hp = { s: 500, a: 0, h: 0 }
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(durabilityOf(state, state.shipId)).toBe(0.05)
    expect(state.logs.some((l) => l.text.includes('濒临崩溃'))).toBe(true)
  })

  it('战斗已分胜负（结算窗口）时不可撤退；撤退同时停止连续出击', () => {
    const { state, ctx } = world()
    state.autoLoopAnomalyId = 'ano-a'
    enterBattle(state, ctx)
    // 手工处决：全灭敌方 → 下一拍 ended='me'（处于慢镜结算窗口）
    const b = state.expedition.battle!
    const units = Object.values(b.units) as Array<{
      side: string
      hp: { s: number; a: number; h: number }
    }>
    for (const u of units) {
      if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    }
    advanceGame(state, 100, ctx)
    expect(b.ended).toBe('me')
    const r = retreatBattle(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('胜负')

    // 重新进入未分胜负的战斗并撤退 → 连击停环
    state.expedition.active = false
    state.expedition.battle = null
    state.autoLoopAnomalyId = 'ano-a'
    enterBattle(state, ctx)
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(state.autoLoopAnomalyId).toBeNull()
  })
})
