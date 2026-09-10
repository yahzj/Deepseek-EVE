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
  it('rank=1：系数 1/2/4/16/64（船长 2026-09-05 曲线）', () => {
    const a = def('a')
    expect(skillLevelTimeMs(a, 1)).toBe(60_000)
    expect(skillLevelTimeMs(a, 2)).toBe(120_000)
    expect(skillLevelTimeMs(a, 3)).toBe(240_000)
    expect(skillLevelTimeMs(a, 4)).toBe(960_000) // ×16
    expect(skillLevelTimeMs(a, 5)).toBe(3_840_000) // ×64
  })

  it('rank=2 时每级时间随难度翻倍（体现难度系数）', () => {
    const a = def('a', 2)
    expect(skillLevelTimeMs(a, 1)).toBe(120_000)
    expect(skillLevelTimeMs(a, 2)).toBe(240_000)
    expect(skillLevelTimeMs(a, 4)).toBe(1_920_000) // 60s×2×16
  })

  it('自定义 baseMs 可以覆盖默认 60 秒', () => {
    const a = def('a', 1, 5_000)
    expect(skillLevelTimeMs(a, 1)).toBe(5_000)
  })

  it('rank=1 从 0 练到 5 级合计 87 分钟', () => {
    const a = def('a')
    expect(totalTimeToLevel(a, 0, 5)).toBe(5_220_000) // 60s × (1+2+4+16+64)
  })

  it('目标不高于当前等级时总时长为 0', () => {
    const a = def('a')
    expect(totalTimeToLevel(a, 3, 3)).toBe(0)
    expect(totalTimeToLevel(a, 3, 2)).toBe(0)
  })

  it('每个 rank 档都有专属基础时长，且「满级总时长」随 rank 严格递增（防新增 rank 漏配档底）', () => {
    // 2026-09-10 加：rank 5（AI 核心调度学）此前漏配档底 → 落默认 60 秒档，
    // 满级 7.25h 反而比 rank3（11.2h）/rank4（67.3h）便宜，与「低档快高档慢」相反。
    const totals = [1, 2, 3, 4, 5].map((r) => totalTimeToLevel(def('x', r), 0, 5))
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]!).toBeGreaterThan(totals[i - 1]!)
    }
    // 逐档锚点（小时，便于人读）
    const hours = totals.map((t) => t / 3_600_000)
    expect(hours[0]).toBeCloseTo(1.45, 2) // r1 ≈1.4h
    expect(hours[1]).toBeCloseTo(2.9, 1) // r2 ≈2.9h
    expect(hours[2]).toBeCloseTo(11.24, 1) // r3 ≈11.2h
    expect(hours[3]).toBeCloseTo(67.28, 1) // r4 ≈67.3h
    expect(hours[4]).toBeCloseTo(89.66, 1) // r5 ≈89.7h（阶梯 ×2/×4/×6/×8）
  })

  it('rank5 档底 742 秒：Lv1 单级 3,710,000ms、满级 322,770,000ms', () => {
    const a = def('a', 5)
    expect(skillLevelTimeMs(a, 1)).toBe(3_710_000) // 742s × rank5 × 系数1
    expect(skillLevelTimeMs(a, 5)).toBe(742_000 * 5 * 64)
    expect(totalTimeToLevel(a, 0, 5)).toBe(742_000 * 5 * 87)
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
