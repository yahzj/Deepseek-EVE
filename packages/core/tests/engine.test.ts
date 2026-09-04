/**
 * 引擎核心（技能队列推进）的单元测试：模拟"在线点训练 + 长时间离线"两种场景。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame, clearSkillQueue, enqueueSkill, removeQueueAt, skillQueueStatus } from '../src/engine'
import { DEFAULT_TRAIN_BASE_MS } from '../src/training'
import { makeTestCtx, skill } from './helpers'

describe('训练队列推进', () => {
  it('入队后按秒推进：60 秒练到 1 级，再 120 秒升 2 级并自动出队', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx: SimContext = makeTestCtx({ skills: [skill('a')] })

    // T2 连锁：同一技能逐级入队（各项代表"练到该级"的一级）
    const r = enqueueSkill(state, 'a', 1, ctx.skills)
    expect(r.ok).toBe(true)
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(true)

    // 推 60 秒 → 到 1 级
    advanceGame(state, 60_000, ctx)
    expect(state.skills.trained['a']).toBe(1)
    expect(state.skills.queue).toHaveLength(1)
    expect(state.logs.some((l) => l.kind === 'levelup' && l.text.includes('Lv1'))).toBe(true)

    // 再推 120 秒 → 到 2 级，队列清空
    advanceGame(state, 120_000, ctx)
    expect(state.skills.trained['a']).toBe(2)
    expect(state.skills.queue).toHaveLength(0)
    expect(state.logs.some((l) => l.kind === 'queue' && l.text.includes('训练完成'))).toBe(true)

    // 游戏时间要精确等于推入的总时长
    expect(state.gameMs).toBe(180_000)
  })

  it('一次推入巨量时间（模拟离线），能连续跨级、跨技能结算', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ skills: [skill('a'), skill('b')] })
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'a', 2, ctx.skills)
    enqueueSkill(state, 'b', 1, ctx.skills)

    advanceGame(state, 999_999_999, ctx)

    expect(state.skills.trained['a']).toBe(2)
    expect(state.skills.trained['b']).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
    const levelups = state.logs.filter((l) => l.kind === 'levelup')
    expect(levelups).toHaveLength(3) // a: Lv1, Lv2；b: Lv1
  })

  it('队列项完成的瞬间，富余时间立即开始训练下一个技能（不浪费）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ skills: [skill('a'), skill('b')] })
    enqueueSkill(state, 'a', 1, ctx.skills) // a 到 1 级需 60 秒
    enqueueSkill(state, 'b', 1, ctx.skills) // b 到 1 级需 60 秒

    // 一次推 90 秒：a 用 60 秒完成并出队，剩下 30 秒立刻开始练 b
    advanceGame(state, 90_000, ctx)
    expect(state.skills.trained['a']).toBe(1)
    expect(state.skills.queue).toHaveLength(1) // b 仍在队首训练
    expect(state.skills.queue[0]!.skillId).toBe('b')
    expect(state.skills.queue[0]!.progressMs).toBe(30_000)

    // 再推 30 秒：b 完成，队列清空
    advanceGame(state, 30_000, ctx)
    expect(state.skills.trained['b']).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
    const doneLogs = state.logs.filter((l) => l.kind === 'queue' && l.text.includes('训练完成'))
    expect(doneLogs).toHaveLength(2)
  })

  it('非法指令都被拒绝：未知技能 / 等级越界 / 重复目标 / 目标不高于当前', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ skills: [skill('a')] })

    expect(enqueueSkill(state, '不存在的技能', 1, ctx.skills).ok).toBe(false)
    expect(enqueueSkill(state, 'a', 0, ctx.skills).ok).toBe(false)
    expect(enqueueSkill(state, 'a', 6, ctx.skills).ok).toBe(false)
    expect(enqueueSkill(state, 'a', 1.5, ctx.skills).ok).toBe(false)

    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    // 相同目标重复入队 → 拒绝
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(false)
    // 练完后，目标 1 <= 当前 1 → 拒绝
    advanceGame(state, DEFAULT_TRAIN_BASE_MS, ctx)
    expect(state.skills.trained['a']).toBe(1)
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(false)
    // 跳过 Lv2 直接排 Lv3 → 连锁规则拒绝
    expect(enqueueSkill(state, 'a', 3, ctx.skills).ok).toBe(false)
    // 该项练满即出队，队列已空
    expect(state.skills.queue).toHaveLength(0)
  })

  it('队列移除与清空：删队首时本级进度暂存待续接；清空保留队首进度并返回数量', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ skills: [skill('a'), skill('b'), skill('c')] })
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'b', 1, ctx.skills)
    enqueueSkill(state, 'c', 1, ctx.skills)
    expect(state.skills.queue).toHaveLength(3)

    // 先练 30 秒：a 冲 Lv1 到一半
    advanceGame(state, 30_000, ctx)
    expect(state.skills.queue[0]!.skillId).toBe('a')
    expect(state.skills.queue[0]!.progressMs).toBe(30_000)

    // 删队首（a）：没有同技能后继可承接 → 进度存入 savedProgress
    expect(removeQueueAt(state, 0)).toBe(true)
    expect(state.skills.queue).toHaveLength(2)
    expect(state.skills.queue[0]!.skillId).toBe('b')
    expect(state.skills.savedProgress['a']).toBe(30_000)

    // 越界删除返回 false
    expect(removeQueueAt(state, 99)).toBe(false)

    // 清空：队首 b 无进度 → 不多存；队列清空返回数量
    const removed = clearSkillQueue(state)
    expect(removed).toBe(2)
    expect(state.skills.queue).toHaveLength(0)
    expect(state.skills.savedProgress['a']).toBe(30_000)
  })

  it('队列状态查询：队首进度百分比、剩余时间、排队列表（真实下标与单级时长）都准确', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ skills: [skill('a'), skill('b')] })
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'a', 2, ctx.skills)
    enqueueSkill(state, 'a', 3, ctx.skills)
    enqueueSkill(state, 'b', 1, ctx.skills)

    // 练 30 秒：Lv1 冲了一半（总共需 60 秒）
    advanceGame(state, 30_000, ctx)
    let view = skillQueueStatus(state, ctx.skills)
    expect(view.head).not.toBeNull()
    expect(view.head!.skillId).toBe('a')
    expect(view.head!.currentLevel).toBe(0)
    expect(view.head!.intoLevel).toBe(1)
    expect(view.head!.targetLevel).toBe(1)
    expect(view.head!.progressMs).toBe(30_000)
    expect(view.head!.remainingMs).toBe(30_000)
    expect(view.head!.percent).toBe(50)
    expect(view.pending).toHaveLength(3)
    expect(view.pending[0]!.skillId).toBe('a')
    expect(view.pending[0]!.queueIndex).toBe(1)
    expect(view.pending[0]!.targetLevel).toBe(2)
    expect(view.pending[0]!.levelMs).toBe(120_000)
    expect(view.pending[2]!.skillId).toBe('b')
    expect(view.pending[2]!.queueIndex).toBe(3)
    expect(view.pending[2]!.levelMs).toBe(60_000)

    // 全部练完 → 队列空
    advanceGame(state, 999_999_999, ctx)
    view = skillQueueStatus(state, ctx.skills)
    expect(view.head).toBeNull()
    expect(view.pending).toHaveLength(0)
    expect(state.skills.trained['a']).toBe(3)
    expect(state.skills.trained['b']).toBe(1)
  })
})
