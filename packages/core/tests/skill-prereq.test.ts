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
import {
  PREREQ_MIN_LEVEL,
  enqueueSkill,
  planPrereqChain,
  removeQueueAt,
  moveQueueItem,
  skillCancelImpact,
  skillLockMissing,
} from '../src/engine'
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
    expect(skillLockMissing(state, data[2]!, ctx.skills).map((g) => g.def.id)).toEqual(['b'])
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

/**
 * **一键补齐前置 / 取消级联**（2026-09-23 船长令）：
 * 「玩家选择某个技能后，如果该技能有前置技能，可以直接添加前置技能到训练队列。训练队列内取消一个技能的
 *  同时会取消所有依赖其前置的后续技能的训练。（但是假设前置是 LV1，你取消的是 LV2 并不会移除后续的
 *  其他技能训练。）」＋裁定「③甲：逻辑按等级实现，数据侧本轮不标具体等级」＋「④甲：清整个队列里所有
 *  不满足的依赖项（含排在它前面的）＋ 会连带取消时先弹确认条列出」。
 */
describe('前置按等级：补齐计划与取消级联', () => {
  /** d → e（e 要求 d 到 Lv3，验"按等级"的判据） */
  const deep: SkillDef[] = [
    skill('d'),
    { ...skill('e'), prereq: ['d'] as const, prereqLevel: { d: 3 } },
  ]
  function deepWorld() {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx({ skills: deep, quietEvents: true })
    return { state, ctx }
  }

  it('补齐计划：按依赖顺序、逐级补到**要求等级**（不是只补一级）', () => {
    const { state, ctx } = deepWorld()
    const steps = planPrereqChain(state, deep[1]!, ctx.skills)
    expect(steps.map((s) => `${s.skillId}${s.targetLevel}`)).toEqual(['d1', 'd2', 'd3'])
    for (const s of steps) expect(enqueueSkill(state, s.skillId, s.targetLevel, ctx.skills).ok).toBe(true)
  })

  it('补齐计划：更深的前置排在前面（a → b → c 三层）', () => {
    const { state, ctx } = world()
    const steps = planPrereqChain(state, data[2]!, ctx.skills) // c 吃 a 与 b，b 又吃 a
    expect(steps.map((s) => `${s.skillId}${s.targetLevel}`)).toEqual(['a1', 'b1'])
  })

  it('**includeTarget：前置之后排上目标本级**（船长 2026-09-23 追加「一并加入前置要练目标一起排」）', () => {
    const { state, ctx } = world()
    const steps = planPrereqChain(state, data[2]!, ctx.skills, { includeTarget: true }) // c 吃 a、b
    expect(steps.map((s) => `${s.skillId}${s.targetLevel}`)).toEqual(['a1', 'b1', 'c1'])
    for (const s of steps) expect(enqueueSkill(state, s.skillId, s.targetLevel, ctx.skills).ok).toBe(true)
    // 再点一次：前置都在队列里 ⇒ 只追加目标本级 c2（已排到哪就接哪）
    expect(
      planPrereqChain(state, data[2]!, ctx.skills, { includeTarget: true }).map((s) => `${s.skillId}${s.targetLevel}`),
    ).toEqual(['c2'])
  })

  it('补齐计划：**已在队列里的前置复用、不重复入队**', () => {
    const { state, ctx } = world()
    expect(enqueueSkill(state, 'a', 1, ctx.skills).ok).toBe(true) // a 已排 Lv1
    const steps = planPrereqChain(state, data[1]!, ctx.skills) // b 只要 a ≥ 1
    expect(steps).toEqual([])
  })

  it('前置要求 Lv3：只排到 Lv1 仍算缺 ⇒ 计划补 Lv2/Lv3', () => {
    const { state, ctx } = deepWorld()
    state.skills.trained['d'] = 1
    expect(skillLockMissing(state, deep[1]!, ctx.skills).map((g) => g.needLevel)).toEqual([3])
    expect(planPrereqChain(state, deep[1]!, ctx.skills).map((s) => s.targetLevel)).toEqual([2, 3])
  })

  it('**取消 Lv1 ⇒ 依赖项一并取消**（含排在它前面的）', () => {
    const { state, ctx } = world()
    // 队列：c1（依赖 a、b）在最前，a1 与 b1 在后
    state.skills.queue = [
      { skillId: 'c', targetLevel: 1, progressMs: 0 },
      { skillId: 'a', targetLevel: 1, progressMs: 0 },
      { skillId: 'b', targetLevel: 1, progressMs: 0 },
    ]
    state.skills.trained['a'] = 0
    const impact = skillCancelImpact(state, ctx.skills, 1) // 取消 a
    expect(impact?.also.map((it) => it.skillId)).toEqual(['c', 'b']) // c 依赖 a；b 依赖 a（连锁）
    expect(removeQueueAt(state, 1, ctx.skills)).toBe(true)
    expect(state.skills.queue).toEqual([])
  })

  it('**取消 Lv2 不动"只要 Lv1"的后续项**（船长举的例子）', () => {
    const { state, ctx } = world()
    state.skills.trained['a'] = 1 // 前置 a 已经练到 Lv1
    state.skills.queue = [
      { skillId: 'a', targetLevel: 2, progressMs: 0 }, // 想继续把 a 练到 Lv2
      { skillId: 'b', targetLevel: 1, progressMs: 0 }, // b 只要 a ≥ 1
    ]
    expect(skillCancelImpact(state, ctx.skills, 0)?.also).toEqual([]) // 取消 a2 谁也带不走
    expect(removeQueueAt(state, 0, ctx.skills)).toBe(true)
    expect(state.skills.queue.map((it) => `${it.skillId}${it.targetLevel}`)).toEqual(['b1'])
  })

  it('顺序契约：不许把吃前置的项挪到前置之前（整单回滚）', () => {
    const { state, ctx } = world()
    state.skills.queue = [
      { skillId: 'a', targetLevel: 1, progressMs: 0 },
      { skillId: 'b', targetLevel: 1, progressMs: 0 }, // b 吃 a
    ]
    expect(moveQueueItem(state, 1, 0, ctx.skills)).toBe(false)
    expect(state.skills.queue.map((it) => it.skillId)).toEqual(['a', 'b']) // 原样还原
    // 无关技能（`free` 无前置）挪到最前 ⇒ 放行（a 仍在 b 前面，契约不破）
    state.skills.queue.push({ skillId: 'free', targetLevel: 1, progressMs: 0 })
    expect(moveQueueItem(state, 2, 0, ctx.skills)).toBe(true)
    expect(state.skills.queue.map((it) => it.skillId)).toEqual(['free', 'a', 'b'])
  })

  it('不传 catalog ⇒ 保持老语义（不级联）；传了才级联', () => {
    const { state, ctx } = world()
    state.skills.queue = [
      { skillId: 'c', targetLevel: 1, progressMs: 0 },
      { skillId: 'a', targetLevel: 1, progressMs: 0 },
    ]
    expect(removeQueueAt(state, 1)).toBe(true) // 老调用点：只删目标项
    expect(state.skills.queue.map((it) => it.skillId)).toEqual(['c'])
    const impact = skillCancelImpact(state, ctx.skills, 0)
    expect(impact?.target.skillId).toBe('c')
  })
})
