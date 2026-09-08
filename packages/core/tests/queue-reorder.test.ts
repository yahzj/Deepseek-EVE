/**
 * 训练队列调整顺序（2026-09-08 船长：显示总时长 + 上移/下移，前移到顶 = 交换式顶替当前训练）。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { enqueueSkill, moveQueueItem, skillQueueStatus } from '../src/engine'
import { makeTestCtx, skill } from './helpers'

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const ctx = makeTestCtx({ skills: [skill('a'), skill('b'), skill('c')], quietEvents: true })
  return { state, ctx }
}

function totalOf(state: GameState, ctx: SimContext): number {
  const v = skillQueueStatus(state, ctx.skills)
  return (v.head !== null ? v.head.remainingMs : 0) + v.pending.reduce((s, p) => s + p.remainingMs, 0)
}

describe('训练队列：调整顺序（moveQueueItem）', () => {
  it('前移到顶 = 交换式顶替：新条目开练，原训练带进度退回排队（同技能目标重算、总时长守恒）', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true) // 队首（正在训练）
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(true) // 连锁：已学0+已排1
    state.skills.queue[0]!.progressMs = 30_000 // 队首 a 练了 30s（单级 60s 档）
    const before = totalOf(state, ctx)

    // 把 b（下标1）移到队首（下标0）——顶替训练中的 a
    expect(moveQueueItem(state, 1, 0)).toBe(true)
    const v = skillQueueStatus(state, ctx.skills)
    expect(v.head?.skillId).toBe('b')
    expect(state.skills.queue[0]!.progressMs).toBe(0)
    // a 退回排队：首条目标 Lv1 并继承进度
    const a1 = state.skills.queue.find((q) => q.skillId === 'a' && q.targetLevel === 1)
    const a2 = state.skills.queue.find((q) => q.skillId === 'a' && q.targetLevel === 2)
    expect(a1).toBeDefined()
    expect(a1!.progressMs).toBe(30_000)
    expect(a2).toBeDefined()
    expect(a2!.progressMs).toBe(0)
    expect(totalOf(state, ctx)).toBe(before) // 各级时长集合不变 → 总时长守恒
  })

  it('排队区内任意移动：目标重算保持逐级、非法下标拒绝', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'c', 1, ctx.skills).ok).toBe(true)
    expect(moveQueueItem(state, 1, 2)).toBe(true) // b 移到队尾
    expect(state.skills.queue.map((q) => q.skillId)).toEqual(['a', 'c', 'b'])
    expect(state.skills.queue.map((q) => q.targetLevel)).toEqual([1, 1, 1])
    expect(moveQueueItem(state, -1, 1)).toBe(false)
    expect(moveQueueItem(state, 0, 99)).toBe(false)
    expect(state.skills.queue.map((q) => q.skillId)).toEqual(['a', 'c', 'b'])
  })

  it('同技能块打散后仍逐级连续（跨技能插入不破坏连锁）', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    // 把第二条 a（idx1）移到 b 之后：队形 [a,b,a]
    expect(moveQueueItem(state, 1, 2)).toBe(true)
    expect(state.skills.queue.map((q) => q.skillId)).toEqual(['a', 'b', 'a'])
    expect(state.skills.queue.filter((q) => q.skillId === 'a').map((q) => q.targetLevel)).toEqual([1, 2])
  })
})
