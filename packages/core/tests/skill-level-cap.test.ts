/**
 * 技能等级上限回归测试（2026-09-10 玩家反馈"我的 AI 核心调度学能升到 LV6"排查收口）。
 *
 * 排查结论：Lv6 在引擎侧到不了——入队口（enqueueSkill 目标 1~5）、连锁逐级校验、读档夹紧
 * （save.ts trained/queue 一律 ≤ MAX_SKILL_LEVEL）三处都守住了；玩家看到的是技能页按钮文案
 * 用的是 lastQueued + 1（Lv4 且已排 Lv5 时写出「追加→Lv6」，点了被拒）。
 *
 * 本文件把"学不到 Lv6"钉成契约，并覆盖当天补的两道纵深防御：
 * ① 队列里被塞进超限目标（异常档/将来新增写入路径）时，推进也只停在 Lv5，且该项自动出队并留警告；
 * ② moveQueueItem 重算目标时夹紧到上限，不会把同技能多余条目推成 Lv6。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { MAX_SKILL_LEVEL } from '../src/state'
import { advanceGame, enqueueSkill, moveQueueItem } from '../src/engine'
import { makeTestCtx, skill } from './helpers'

/** 静默事件的世界：队列推进时间/日志可精确断言 */
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const ctx = makeTestCtx({ skills: [skill('a'), skill('b')], quietEvents: true })
  return { state, ctx }
}

describe('技能等级上限（MAX_SKILL_LEVEL = 5）', () => {
  it('入队口拒绝 Lv6：目标必须是 1 ~ 5 的整数', () => {
    const { state, ctx } = world()
    for (const bad of [0, 6, 7, 2.5]) {
      const r = enqueueSkill(state, 'a', bad, ctx.skills)
      expect(r.ok).toBe(false)
      expect(r.error).toContain(`1 ~ ${MAX_SKILL_LEVEL}`)
    }
    expect(state.skills.queue.length).toBe(0)
  })

  it('正常练满 5 级后停在 Lv5（队列出清，且再排不上）', () => {
    const { state, ctx } = world()
    // rank1：Lv1..Lv5 合计 87 分钟；多给一小时余量
    for (let lv = 1; lv <= MAX_SKILL_LEVEL; lv++) {
      expect(enqueueSkill(state, 'a', lv, ctx.skills).ok).toBe(true)
    }
    advanceGame(state, 148 * 60_000, ctx)
    expect(state.skills.trained['a']).toBe(MAX_SKILL_LEVEL)
    expect(state.skills.queue.length).toBe(0)
    // 满级后：连锁追加（目标 6）照样被拒
    expect(enqueueSkill(state, 'a', MAX_SKILL_LEVEL + 1, ctx.skills).ok).toBe(false)
    expect(state.skills.trained['a']).toBe(MAX_SKILL_LEVEL)
  })

  it('队列被塞入超限目标（Lv6）时：推进只到 Lv5，该项自动出队并留警告', () => {
    const { state, ctx } = world()
    state.skills.trained['a'] = 4
    // 直接注入异常目标：模拟异常档 / 将来新增的写入路径绕过入队校验
    state.skills.queue = [{ skillId: 'a', targetLevel: MAX_SKILL_LEVEL + 1, progressMs: 0 }]
    advanceGame(state, 5 * 60 * 60_000, ctx)
    expect(state.skills.trained['a']).toBe(MAX_SKILL_LEVEL) // 不会变成 6
    expect(state.skills.queue.length).toBe(0) // 越限项被移除，不会卡在队首空转
    expect(state.logs.some((l) => l.kind === 'warn' && l.text.includes('技能上限'))).toBe(true)
  })

  it('moveQueueItem 重算目标时夹紧上限：异常队列重排后不会出现 Lv6', () => {
    const { state } = world()
    state.skills.trained['a'] = 4
    // 同技能两条超限条目（异常态：正常入队不允许同技能排到 5 之后再排）
    state.skills.queue = [
      { skillId: 'a', targetLevel: 5, progressMs: 0 },
      { skillId: 'a', targetLevel: 6, progressMs: 0 },
    ]
    expect(moveQueueItem(state, 1, 0)).toBe(true)
    expect(state.skills.queue.map((q) => q.targetLevel)).toEqual([5, 5])
    for (const q of state.skills.queue) expect(q.targetLevel).toBeLessThanOrEqual(MAX_SKILL_LEVEL)
  })
})
