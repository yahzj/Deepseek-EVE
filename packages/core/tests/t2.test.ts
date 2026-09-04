/**
 * T2 技能队列改造的单元测试：
 * 连锁入队（逐级 +1）、取消队首进度保留/顺延承接、重排续接、清空保留、存档容错、
 * 旧档跳级条目的引擎兜底。rank1 单级时长：Lv1=60s、Lv2=120s、Lv3=240s。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame, clearSkillQueue, enqueueSkill, removeQueueAt } from '../src/engine'
import { loadSaveFile, SAVE_FORMAT } from '../src/save'
import { makeTestCtx, skill } from './helpers'

/** 静默事件的世界：队列推进时间/日志可精确断言 */
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const ctx = makeTestCtx({ skills: [skill('a'), skill('b')], quietEvents: true })
  return { state, ctx }
}

describe('T2 连锁入队校验', () => {
  it('同一技能只允许逐级 +1：跳级、重复目标都被拒绝', () => {
    const { state, ctx } = world()

    // 空队直接排 Lv2 → 拒绝（需先排 Lv1）
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(false)
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)

    // 重复目标 → 拒绝
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(false)
    // 跳过 Lv2 排 Lv4 → 拒绝
    expect(enqueueSkill(state, 'a', 4, ctx.skills).ok).toBe(false)

    // 逐级追加到 3
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'a', 2, ctx.skills).ok).toBe(false)
    expect(enqueueSkill(state, 'a', 3, ctx.skills).ok).toBe(true)

    expect(state.skills.queue.map((q) => q.targetLevel)).toEqual([1, 2, 3])
  })

  it('不同技能互不干扰：技能 a 在排队时，技能 b 仍可正常排自己的 Lv1', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'a', 2, ctx.skills)
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
    // b 的连锁续级照常可用（只数 b 自己的条目：0 已学 + 1 已排 + 1 = Lv2）
    expect(enqueueSkill(state, 'b', 2, ctx.skills).ok).toBe(true)
    expect(enqueueSkill(state, 'b', 4, ctx.skills).ok).toBe(false) // b 仍禁止跳级
    expect(state.skills.queue.map((q) => q.skillId)).toEqual(['a', 'a', 'b', 'b'])
  })
})

describe('T2 取消与进度保留', () => {
  it('取消队首且没有同技能后继：进度存入 savedProgress，重排同一级自动续接并清空暂存', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    advanceGame(state, 30_000, ctx) // Lv1 练到一半
    expect(removeQueueAt(state, 0)).toBe(true)
    expect(state.skills.queue).toHaveLength(0)
    expect(state.skills.savedProgress['a']).toBe(30_000)

    // 重排同一级：进度自动附着
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true)
    expect(state.skills.savedProgress).toEqual({})
    expect(state.skills.queue[0]!.progressMs).toBe(30_000)

    // 再练 30 秒即升 1 级（而不是 60 秒）
    advanceGame(state, 30_000, ctx)
    expect(state.skills.trained['a']).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
  })

  it('取消队首且后继隔在别的技能后面：同技能后继顺延一级并承接进度，其它条目不动', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'b', 1, ctx.skills)
    enqueueSkill(state, 'a', 2, ctx.skills)
    advanceGame(state, 30_000, ctx) // a 的 Lv1 练到一半

    expect(removeQueueAt(state, 0)).toBe(true)
    // b→Lv1 原样保留；a→Lv2 顺延为 a→Lv1 并承接 30 秒
    expect(state.skills.queue.map((q) => ({ skillId: q.skillId, targetLevel: q.targetLevel, progressMs: q.progressMs }))).toEqual([
      { skillId: 'b', targetLevel: 1, progressMs: 0 },
      { skillId: 'a', targetLevel: 1, progressMs: 30_000 },
    ])
    expect(state.skills.savedProgress).toEqual({})

    // 之后无需重新入队，队列自动把 a 练到 1 级收尾
    advanceGame(state, 60_000, ctx) // b 完成（用满 60 秒）
    advanceGame(state, 30_000, ctx) // a 用掉剩余 30 秒进度升 1 级
    expect(state.skills.trained['a']).toBe(1)
    expect(state.skills.trained['b']).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
  })

  it('取消零进度的队首：后继直接顺延一级，无进度转移', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'a', 2, ctx.skills)
    expect(removeQueueAt(state, 0)).toBe(true)
    expect(state.skills.queue).toHaveLength(1)
    expect(state.skills.queue[0]!.targetLevel).toBe(1)
    expect(state.skills.queue[0]!.progressMs).toBe(0)
    expect(state.skills.savedProgress).toEqual({})
  })

  it('取消中间项：后续同技能条目顺延一级填补空位；别的技能条目不受影响', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    enqueueSkill(state, 'b', 1, ctx.skills)
    enqueueSkill(state, 'a', 2, ctx.skills)
    enqueueSkill(state, 'a', 3, ctx.skills)

    // 取消第 3 位（a→Lv2）：a→Lv3 顺延为 a→Lv2；b 不动
    expect(removeQueueAt(state, 2)).toBe(true)
    expect(state.skills.queue.map((q) => ({ skillId: q.skillId, targetLevel: q.targetLevel }))).toEqual([
      { skillId: 'a', targetLevel: 1 },
      { skillId: 'b', targetLevel: 1 },
      { skillId: 'a', targetLevel: 2 },
    ])

    // 取消中间的 b：同技能无后继，什么都不顺延
    expect(removeQueueAt(state, 1)).toBe(true)
    expect(state.skills.queue.map((q) => ({ skillId: q.skillId, targetLevel: q.targetLevel }))).toEqual([
      { skillId: 'a', targetLevel: 1 },
      { skillId: 'a', targetLevel: 2 },
    ])
  })

  it('清空队列保留队首进度；重新排同一级可续接', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    advanceGame(state, 30_000, ctx)
    expect(clearSkillQueue(state)).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
    expect(state.skills.savedProgress['a']).toBe(30_000)

    enqueueSkill(state, 'a', 1, ctx.skills)
    expect(state.skills.queue[0]!.progressMs).toBe(30_000)
    advanceGame(state, 30_000, ctx)
    expect(state.skills.trained['a']).toBe(1)
  })

  it('续接项排在其它技能后面时进度先附着，轮到它才消耗', () => {
    const { state, ctx } = world()
    enqueueSkill(state, 'a', 1, ctx.skills)
    advanceGame(state, 30_000, ctx)
    removeQueueAt(state, 0) // a 暂存 30 秒

    enqueueSkill(state, 'b', 1, ctx.skills) // 先排 b
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true) // 再排 a（非队首）
    expect(state.skills.queue[1]!.progressMs).toBe(30_000)
    expect(state.skills.savedProgress).toEqual({})

    advanceGame(state, 60_000, ctx) // b 练满 60 秒 → 出队，a 顶着 30 秒进度成为队首
    expect(state.skills.queue[0]!.progressMs).toBe(30_000)
    advanceGame(state, 30_000, ctx) // a 补足 30 秒升 1 级
    expect(state.skills.trained['a']).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
  })
})

describe('T2 兼容与兜底', () => {
  it('旧档风格的"跳级条目"（直接排 Lv3）仍能一路练到底，不阻塞队列', () => {
    const { state, ctx } = world()
    // 绕过连锁校验直接构造 = 模拟旧版本存出来的队列
    state.skills.queue.push({ skillId: 'a', targetLevel: 3, progressMs: 0 })
    advanceGame(state, 60_000 + 120_000 + 240_000, ctx)
    expect(state.skills.trained['a']).toBe(3)
    expect(state.skills.queue).toHaveLength(0)
    expect(state.gameMs).toBe(420_000)
  })

  it('存档容错：savedProgress 只收正数毫秒并封顶一天；缺失自动补空对象', () => {
    const text = JSON.stringify({
      format: SAVE_FORMAT,
      version: 16,
      savedAtWallMs: 0,
      state: {
        skills: {
          trained: {},
          queue: [],
          savedProgress: { a: 12_345, x: '垃圾', y: -3, q: 0, z: 99_999_999_999 },
        },
      },
    })
    const loaded = loadSaveFile(text)
    expect(loaded.state.skills.savedProgress).toEqual({ a: 12_345, z: 86_400_000 })

    const text2 = JSON.stringify({ format: SAVE_FORMAT, version: 16, savedAtWallMs: 0, state: { skills: {} } })
    expect(loadSaveFile(text2).state.skills.savedProgress).toEqual({})
  })
})
