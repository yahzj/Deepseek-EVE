/**
 * 训练队列调整顺序（2026-09-08 船长：显示总时长 + 上移/下移，前移到顶 = 交换式顶替当前训练）。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { enqueueSkill, moveQueueItem, queueMovePlan, skillQueueStatus } from '../src/engine'
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

/**
 * **队列读数单点**（2026-09-30：训练队列每行要显示「轮到还需 ≈X」，界面不再各算一遍）——
 * 总时长与"轮到还需"是**同一条前缀和**，末项必须收口到总时长，否则两处数字会互相打架。
 */
describe('训练队列：总时长与“轮到还需”同源（skillQueueStatus）', () => {
  it('etaMs = 前面所有条目剩余之和；末项 + 自身剩余 = 全队列总时长', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true) // 队首（rank1 Lv1 = 60s 档）
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 2, ctx.skills).ok).toBe(true) // 同技能连排：Lv2 时长更长
    state.skills.queue[0]!.progressMs = 30_000 // 队首练了一半

    const v = skillQueueStatus(state, ctx.skills)
    expect(v.head!.remainingMs).toBe(30_000)
    expect(v.totalRemainingMs).toBe(totalOf(state, ctx)) // 与测试里手算的口径一致
    expect(v.pending).toHaveLength(2)
    // 第一条排队项：等队首练完
    expect(v.pending[0]!.etaMs).toBe(v.head!.remainingMs)
    // 第二条排队项：队首 + 第一条
    expect(v.pending[1]!.etaMs).toBe(v.pending[0]!.etaMs + v.pending[0]!.remainingMs)
    // 收口：末项 eta + 末项自身剩余 = 总时长
    expect(v.pending[1]!.etaMs + v.pending[1]!.remainingMs).toBe(v.totalRemainingMs)
    // 逐项单调不减
    expect(v.pending[1]!.etaMs).toBeGreaterThanOrEqual(v.pending[0]!.etaMs)
  })

  it('空队列：总时长为 0（不是 undefined），排队列表为空', () => {
    const { ctx } = world()
    const empty = skillQueueStatus(createInitialState({ nowWallMs: 0, seed: 1 }), ctx.skills)
    expect(empty.head).toBeNull()
    expect(empty.pending).toHaveLength(0)
    expect(empty.totalRemainingMs).toBe(0)
  })
})

/**
 * **挪不挪得动**（**2026-09-30 船长报障**「部分技能在队列中置顶无效」＋裁定甲「让 ⇈/↑/↓ 说实话」）——
 * `queueMovePlan` 是界面置灰与说明的唯一出处，判据与 `moveQueueItem` 同源（`reorderQueue` ＋ `firstOrderBlocker`）。
 * 两种"挪不动"：① 会排在它要的前置之前（顺序契约）② 同技能多级按位置逐级排 ⇒ 挪了等于没挪。
 */
describe('训练队列：挪不挪得动（queueMovePlan）', () => {
  it('顺序契约：把"吃前置的项"挪到前置之前 ⇒ 挪不过去（带卡点），moveQueueItem 同样拒绝且队列原样', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({
      skills: [skill('a'), { ...skill('b'), prereq: ['a'], prereqLevel: { a: 1 } }],
      quietEvents: true,
    })
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true) // 队列允许"依赖前面还没练的级"
    const plan = queueMovePlan(state, 1, 0, ctx.skills)
    expect(plan.ok).toBe(false)
    expect(plan.errorId).toBe('core.engine.022')
    expect(plan.errorParams).toMatchObject({ p1: '技能a', p2: 1, p3: 0 })
    expect(moveQueueItem(state, 1, 0, ctx.skills)).toBe(false)
    expect(state.skills.queue.map((q) => q.skillId)).toEqual(['a', 'b'])
  })

  it('同技能多级：往前挪一格判成"挪了等于没挪"（引擎执行了，但队列逐项不变）', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    const sig = (): string => state.skills.queue.map((q) => `${q.skillId}#${q.targetLevel}`).join(',')
    const before = sig()
    const plan = queueMovePlan(state, 1, 0, ctx.skills)
    expect(plan.ok).toBe(false)
    expect(plan.errorId).toBe('core.engine.023')
    expect(moveQueueItem(state, 1, 0, ctx.skills)).toBe(true)
    expect(sig()).toBe(before) // 计划判"没意义"的依据：结果确实逐项相同
  })

  it('挪得动：计划说 ok，引擎真挪（两者一致）', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    expect(queueMovePlan(state, 1, 0, ctx.skills).ok).toBe(true)
    expect(moveQueueItem(state, 1, 0, ctx.skills)).toBe(true)
    expect(state.skills.queue.map((q) => q.skillId)).toEqual(['b', 'a'])
  })

  it('越界下标 ⇒ 判成挪不动（越界原因），不抛错', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(queueMovePlan(state, 0, 5, ctx.skills).errorId).toBe('core.engine.024')
    expect(queueMovePlan(state, -1, 0, ctx.skills).ok).toBe(false)
    expect(queueMovePlan(state, 0, 0, ctx.skills).ok).toBe(true) // 原地 = 无需挪
  })
})
