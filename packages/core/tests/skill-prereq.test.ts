/**
 * **技能真前置**（**2026-09-22 船长令**：「**将同类效果的技能做成上下级关系**」＋裁定「**甲，lv1**」）。
 *
 * 钉三件事：
 * ① **未满足前置 ⇒ 入队被拒**，且拒绝文案把"还差哪条、要几级"写清楚（`core.engine.019`）；
 * ② **前置达标 ⇒ 放行**（门槛 = `PREREQ_MIN_LEVEL`，当前 Lv1）；
 * ③ **老档零迁移**：判据只看 `state.skills.trained` 的已练等级 ⇒ 已经练过前置的档天然解锁，
 *    不需要任何迁移键（这里用"直接把等级写进 trained"来模拟老档）；
 * ④ 数据侧的"效果同族才连线"由 `content:check` 的**技能书与前置契约**守（悬空 / 成环 / 父比子深三条）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { PREREQ_MIN_LEVEL, enqueueSkill, skillLockMissing } from '../src/engine'
import type { SkillDef } from '../src/types'
import { makeTestCtx, skill } from './helpers'

/** a（根）→ b（吃 a）→ c（吃 a 与 b，验"汇合"） */
const data: SkillDef[] = [
  skill('a'),
  { ...skill('b'), prereq: ['a'] as const },
  { ...skill('c'), prereq: ['a', 'b'] as const },
  skill('free'),
]

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const ctx = makeTestCtx({ skills: data, quietEvents: true })
  return { state, ctx }
}

describe('技能真前置（≥Lv1 才可入队）', () => {
  it('前置没练 ⇒ 拒绝，并写明还差哪条要几级', () => {
    const { state, ctx } = world()
    const r = enqueueSkill(state, 'b', 1, ctx.skills)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('需要先练')
    expect(r.error).toContain(`技能a Lv${PREREQ_MIN_LEVEL}`)
    expect(state.skills.queue.length).toBe(0)
  })

  it('**汇合**：两个前置差一个也不行（维修工程学那种双入线）', () => {
    const { state, ctx } = world()
    state.skills.trained['a'] = PREREQ_MIN_LEVEL // 只满足 a
    expect(enqueueSkill(state, 'c', 1, ctx.skills).ok).toBe(false)
    expect(skillLockMissing(state, data[2]!, ctx.skills).map((d) => d.id)).toEqual(['b'])
    state.skills.trained['b'] = PREREQ_MIN_LEVEL // b 也到位 ⇒ 放行
    expect(skillLockMissing(state, data[2]!, ctx.skills)).toEqual([])
    expect(enqueueSkill(state, 'c', 1, ctx.skills).ok).toBe(true)
  })

  it('**老档零迁移**：已练过前置的档天然解锁（直接写 trained 模拟老档）', () => {
    const { state, ctx } = world()
    state.skills.trained['a'] = 3 // 老档里早就练到 Lv3
    expect(enqueueSkill(state, 'b', 1, ctx.skills).ok).toBe(true)
  })

  it('根技能（无前置）不受影响', () => {
    const { state, ctx } = world()
    expect(skillLockMissing(state, data[0]!, ctx.skills)).toEqual([])
    expect(enqueueSkill(state, 'free', 1, ctx.skills).ok).toBe(true)
  })
})
