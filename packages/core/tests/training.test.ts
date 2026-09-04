/**
 * 训练时长公式的单元测试（自动验证，无需打开游戏）。
 */
import { describe, expect, it } from 'vitest'
import type { SkillDef } from '../src/types'
import { skillLevelTimeMs, totalTimeToLevel, totalQueueTimeMs } from '../src/training'

/** 测试用：快速造一条技能定义 */
function def(id: string, rank = 1, baseMs?: number): SkillDef {
  return { id, name: `技能${id}`, group: '测试组', rank, description: '测试用技能', ...(baseMs !== undefined ? { baseMs } : {}) }
}

describe('训练时长公式', () => {
  it('rank=1：1 级 60 秒，2 级 120 秒（指数增长）', () => {
    const a = def('a')
    expect(skillLevelTimeMs(a, 1)).toBe(60_000)
    expect(skillLevelTimeMs(a, 2)).toBe(120_000)
    expect(skillLevelTimeMs(a, 3)).toBe(240_000)
  })

  it('rank=2 时每级时间翻倍（体现难度系数）', () => {
    const a = def('a', 2)
    expect(skillLevelTimeMs(a, 1)).toBe(120_000)
    expect(skillLevelTimeMs(a, 2)).toBe(240_000)
  })

  it('自定义 baseMs 可以覆盖默认 60 秒', () => {
    const a = def('a', 1, 5_000)
    expect(skillLevelTimeMs(a, 1)).toBe(5_000)
  })

  it('rank=1 从 0 练到 5 级合计 31 分钟', () => {
    const a = def('a')
    expect(totalTimeToLevel(a, 0, 5)).toBe(1_860_000) // 60s × (1+2+4+8+16)
  })

  it('目标不高于当前等级时总时长为 0', () => {
    const a = def('a')
    expect(totalTimeToLevel(a, 3, 3)).toBe(0)
    expect(totalTimeToLevel(a, 3, 2)).toBe(0)
  })

  it('队列总时长 = 各项剩余时长之和', () => {
    const cat = new Map([['a', def('a', 1)], ['b', def('b', 2)]])
    const trained = { a: 1 }
    const queue = [
      { skillId: 'a', targetLevel: 2 }, // 需 120 秒（1→2）
      { skillId: 'b', targetLevel: 1 }, // 需 120 秒（rank2 的 1 级）
    ]
    expect(totalQueueTimeMs(trained, queue, cat)).toBe(240_000)
  })

  it('队列里含未知技能时自动跳过不报错', () => {
    const cat = new Map<string, SkillDef>([['a', def('a')]])
    const queue = [{ skillId: '不存在', targetLevel: 5 }]
    expect(totalQueueTimeMs({}, queue, cat)).toBe(0)
  })
})
