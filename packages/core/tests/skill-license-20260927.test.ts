/**
 * **技能训练许可**（**2026-09-27 船长令**：「我想让学习技能有成本」· 裁定**甲案**）。
 *
 * 船长原话：「当玩家想要升级某个技能时，需要先购买技能书…点之后直接付钱学会。购买了技能书后，这个技能
 * 就可以随意从LV1升级到LV5。技能书从RANK3到RANK5，价格分别为5万，20万，100万。rank1~2的技能不用技能书」
 * ＋ 同日改判「还是rank4~rank6需要钱吧，价格分别为50万，200万，1000万」＋ 裁定「rank6是预留的。
 * 不用改名。按照现有名称维持。其他没问题」。
 *
 * 钉六件事：
 * ① **价格表**：rank4 = 50 万 · rank5 = 200 万 · **rank6 = 1000 万（预留档）**；rank1~3 免许可；
 * ② **缺许可 ⇒ 入队被拒**（`core.engine.021`），队列一分不动；
 * ③ **甲案语义**：买许可买的是**资格**，不是等级 —— 付完钱技能仍是 Lv0，照样要排队练；
 * ④ **老档零迁移**：已练到 Lv≥1 视同已购（判据侧豁免，不写任何迁移键）⇒ 老玩家不会被卡住；
 * ⑤ **不白花钱**：免费档 / 已购 / 老档已练三种情形下买许可一律被拒且不动账；
 * ⑥ **存档**：`licenses` 落盘可读回；缺键（老档）在运行时也判得动、不抛。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { enqueueSkill, planPrereqChain } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  SKILL_LICENSE_PRICES,
  buySkillLicense,
  hasSkillLicense,
  skillLicenseMissing,
  skillLicensePriceOf,
} from '../src/skillLicense'
import type { SkillDef } from '../src/types'
import { makeTestCtx, skill } from './helpers'

/** r3（免许可）· r4（50 万）· r5（200 万）· r6（1000 万 · 预留档）· child（r4，吃 deep Lv1） */
const data: SkillDef[] = [
  skill('cheap', 3),
  skill('deep', 4),
  skill('deeper', 5),
  skill('future', 6),
  { ...skill('child', 4), prereq: ['deep'] as const },
]

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 20260927 })
  const ctx = makeTestCtx({ skills: data, quietEvents: true })
  return { state, ctx }
}

describe('技能训练许可（2026-09-27 船长令「我想让学习技能有成本」）', () => {
  it('① 价格表：rank4 = 50 万 · rank5 = 200 万 · rank6 = 1000 万（预留档）', () => {
    expect(skillLicensePriceOf(data[1]!)).toBe(500_000)
    expect(skillLicensePriceOf(data[2]!)).toBe(2_000_000)
    expect(skillLicensePriceOf(data[3]!)).toBe(10_000_000)
    expect(SKILL_LICENSE_PRICES[6]).toBe(10_000_000)
  })

  it('① rank1~3 免许可：不必买、直接入队；免费档也不接受购买（不给玩家白花钱）', () => {
    const { state, ctx } = world()
    expect(skillLicensePriceOf(data[0]!)).toBeNull()
    expect(skillLicenseMissing(state, data[0]!)).toBe(false)
    expect(enqueueSkill(state, 'cheap', 1, ctx.skills).ok).toBe(true)
    const r = buySkillLicense(state, ctx.skills, 'cheap')
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.skillLicense.002')
    expect(state.wallet.isk).toBe(10_000)
  })

  it('② 缺许可 ⇒ 入队被拒（core.engine.021），队列一分不动', () => {
    const { state, ctx } = world()
    state.wallet.isk = 10_000_000
    const r = enqueueSkill(state, 'deep', 1, ctx.skills)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.engine.021')
    expect(state.skills.queue.length).toBe(0)
  })

  it('③ **甲案**：买许可买的是资格不是等级 —— 扣钱、置位、记日志，技能仍是 Lv0 且改由玩家自己排队练', () => {
    const { state, ctx } = world()
    state.wallet.isk = 1_000_000
    const before = state.logs.length
    const r = buySkillLicense(state, ctx.skills, 'deep')
    expect(r.ok).toBe(true)
    expect(r.price).toBe(500_000)
    expect(state.wallet.isk).toBe(500_000)
    expect(state.skills.licenses['deep']).toBe(true)
    expect(state.logs.length).toBe(before + 1)
    expect(state.logs[state.logs.length - 1]!.textId).toBe('core.skillLicense.006')
    // 甲案要害：许可 ≠ 等级
    expect(state.skills.trained['deep'] ?? 0).toBe(0)
    expect(enqueueSkill(state, 'deep', 1, ctx.skills).ok).toBe(true)
  })

  it('⑤ 余额不足 ⇒ 拒绝且一分不动', () => {
    const { state, ctx } = world()
    state.wallet.isk = 499_999
    const r = buySkillLicense(state, ctx.skills, 'deep')
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.skillLicense.005')
    expect(state.wallet.isk).toBe(499_999)
    expect(state.skills.licenses['deep']).toBeUndefined()
  })

  it('⑤ 重复购买 ⇒ 拒绝（core.skillLicense.003）', () => {
    const { state, ctx } = world()
    state.wallet.isk = 2_000_000
    expect(buySkillLicense(state, ctx.skills, 'deeper').ok).toBe(true)
    expect(state.wallet.isk).toBe(0)
    const again = buySkillLicense(state, ctx.skills, 'deeper')
    expect(again.ok).toBe(false)
    expect(again.errorId).toBe('core.skillLicense.003')
  })

  it('④ **老档豁免**：已练到 Lv≥1 视同已购（零迁移键），且拒绝再买（不给玩家白花钱）', () => {
    const { state, ctx } = world()
    state.wallet.isk = 1_000_000
    state.skills.trained['deep'] = 1 // 模拟改动前就练过的老档：licenses 里什么都没有
    expect(state.skills.licenses['deep']).toBeUndefined()
    expect(hasSkillLicense(state, data[1]!)).toBe(true)
    expect(enqueueSkill(state, 'deep', 2, ctx.skills).ok).toBe(true)
    const r = buySkillLicense(state, ctx.skills, 'deep')
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.skillLicense.004')
    expect(state.wallet.isk).toBe(1_000_000)
  })

  it('未知技能 ⇒ 拒绝（core.skillLicense.001）', () => {
    const { state, ctx } = world()
    const r = buySkillLicense(state, ctx.skills, 'nope')
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.skillLicense.001')
  })

  it('**一键补齐前置**：缺许可的前置不排（避免"排一半被拒"）', () => {
    const { state, ctx } = world()
    const steps = planPrereqChain(state, data[4]!, ctx.skills, { includeTarget: true })
    expect(steps.filter((s) => s.skillId === 'deep').length).toBe(0)
  })

  it('⑥ 存档往返：licenses 落盘可读回；缺键（老档）判得动、不抛', () => {
    const { state, ctx } = world()
    state.wallet.isk = 1_000_000
    expect(buySkillLicense(state, ctx.skills, 'deep').ok).toBe(true)
    const text = serializeSaveFile(state, 0)
    expect(text).toContain('licenses')
    const back = loadSaveFile(text).state
    expect(back.skills.licenses['deep']).toBe(true)
    // 老档：整个键都不存在 ⇒ 判据从容返回"缺许可"，不抛
    const legacy = createInitialState({ nowWallMs: 0, seed: 5 })
    delete (legacy.skills as { licenses?: Record<string, true> }).licenses
    expect(skillLicenseMissing(legacy, data[1]!)).toBe(true)
    expect(skillLicenseMissing(legacy, data[0]!)).toBe(false)
  })
})
