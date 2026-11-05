import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { commandCapacityOf } from '../src/combat/command/rules'
import { applyLegacyCommandCompensation } from '../src/combat/command/compensation'
import { hasSkillLicense } from '../src/skillLicense'
import { advanceSkillQueue } from '../src/skills/queue'
import { skillLevelTimeMs } from '../src/training'

const ctx = buildSimContext()
const skillId = 'fleet-command-coordination'

function legacy(earned: number) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261105 })
  delete state.skills.commandCompensationVersion
  state.standings = { dsi: 0 }
  state.standingsEarned = { dsi: earned }
  return state
}

function reload(state: ReturnType<typeof createInitialState>) {
  return loadSaveFile(serializeSaveFile(state, 0)).state
}

describe('旧存档编队协同指挥一次性补偿', () => {
  it.each([
    [0, 0], [39, 0], [40, 1], [59, 1], [60, 2], [79, 2], [80, 3], [99, 3], [100, 4], [999, 4],
  ])('累计声望%s按最高档补至%s级，不按档位叠加且不消耗资产', (earned, level) => {
    const state = legacy(earned!)
    const before = structuredClone(state)
    const loaded = reload(state)
    expect(loaded.skills.trained[skillId] ?? 0).toBe(level)
    expect(loaded.skills.commandCompensationVersion).toBe(1)
    expect(commandCapacityOf(loaded)).toBe(25 + 7 * level!)
    expect(loaded.skills.trained['fleet-command-basic']).toBeUndefined()
    expect(loaded.skills.trained['fleet-command-integration']).toBeUndefined()
    expect(loaded.wallet).toEqual(before.wallet)
    expect(loaded.standings).toEqual(before.standings)
    expect(loaded.standingsEarned).toEqual(before.standingsEarned)
    expect(loaded.warehouse).toEqual(before.warehouse)
    expect(loaded.skills.licenses).toEqual(before.skills.licenses)
    expect(loaded.version).toBe(CURRENT_STATE_VERSION)
    if (level! > 0) expect(hasSkillLicense(loaded, ctx.skills.get(skillId)!)).toBe(true)
    expect(state).toEqual(before)
    expect(reload(loaded)).toEqual(loaded)
  })

  it('使用累计声望而不是可支配余额，缺累计账时沿既有回填规则', () => {
    const spent = legacy(80)
    expect(reload(spent).skills.trained[skillId]).toBe(3)
    const balanceOnly = legacy(39)
    balanceOnly.standings.dsi = 1000
    expect(reload(balanceOnly).skills.trained[skillId]).toBeUndefined()
    delete balanceOnly.standingsEarned
    expect(reload(balanceOnly).skills.trained[skillId]).toBe(4)
  })

  it.each([0, 100, 1000])('新档即使声望达到%s，反复存读仍不补偿', earned => {
    const state = createInitialState({ nowWallMs: 0, seed: 55 })
    state.standingsEarned = { dsi: earned }
    expect(state.skills.commandCompensationVersion).toBe(1)
    expect(reload(reload(state)).skills.trained[skillId]).toBeUndefined()
  })

  it.each([0, 40, 60, 80])('首次在%s声望完成判定后，再涨到100不追加', earned => {
    const first = reload(legacy(earned))
    const level = first.skills.trained[skillId]
    first.standingsEarned!.dsi = 100
    expect(reload(first).skills.trained[skillId]).toBe(level)
  })

  it.each([1, 2, 3, 4, 5])('已有%s级只补不足，不降级、不额外相加', current => {
    const state = legacy(80)
    state.skills.trained[skillId] = current
    const loaded = reload(state)
    expect(loaded.skills.trained[skillId]).toBe(Math.max(current, 3))
    applyLegacyCommandCompensation(loaded)
    expect(loaded.skills.trained[skillId]).toBe(Math.max(current, 3))
  })

  it('提高等级时只清除已覆盖的训练工作，更高目标和其他技能原样保留', () => {
    const state = legacy(80)
    state.skills.trained[skillId] = 1
    state.skills.queue = [
      { skillId: 'mining', targetLevel: 2, progressMs: 1234 },
      { skillId, targetLevel: 2, progressMs: 2345 },
      { skillId, targetLevel: 3, progressMs: 0 },
      { skillId, targetLevel: 5, progressMs: 3456 },
      { skillId: 'refining', targetLevel: 1, progressMs: 4567 },
    ]
    state.skills.savedProgress = { [skillId]: 5678, mining: 6789 }
    const loaded = reload(state)
    expect(loaded.skills.trained[skillId]).toBe(3)
    expect(loaded.skills.queue).toEqual([
      { skillId: 'mining', targetLevel: 2, progressMs: 1234 },
      { skillId, targetLevel: 5, progressMs: 0 },
      { skillId: 'refining', targetLevel: 1, progressMs: 4567 },
    ])
    expect(loaded.skills.savedProgress).toEqual({ mining: 6789 })
    expect(reload(loaded)).toEqual(loaded)
  })

  it.each([3, 5])('已有%s级不需要提高，原训练与暂存进度不变', level => {
    const state = legacy(80)
    state.skills.trained[skillId] = level
    state.skills.queue = [{ skillId, targetLevel: 5, progressMs: 12345 }]
    state.skills.savedProgress = { [skillId]: 54321 }
    const loaded = reload(state)
    expect(loaded.skills.queue).toEqual(state.skills.queue)
    expect(loaded.skills.savedProgress).toEqual(state.skills.savedProgress)
  })

  it('补偿后的更高目标可继续训练，不会把原低级进度转到高级', () => {
    const state = legacy(60)
    state.skills.queue = [{ skillId, targetLevel: 4, progressMs: 400_000 }]
    const loaded = reload(state)
    const duration = skillLevelTimeMs(ctx.skills.get(skillId)!, 3)
    loaded.gameMs += duration
    advanceSkillQueue(loaded, duration, ctx)
    expect(loaded.skills.trained[skillId]).toBe(3)
    expect(loaded.skills.queue).toEqual([{ skillId, targetLevel: 4, progressMs: 0 }])
  })

  it('多次载入同一未处理原始旧档仅补到同一等级，不累加', () => {
    const text = serializeSaveFile(legacy(100), 0)
    const first = loadSaveFile(text).state
    const second = loadSaveFile(text).state
    expect(first.skills.trained[skillId]).toBe(4)
    expect(second.skills.trained).toEqual(first.skills.trained)
    expect(reload(first).skills.trained[skillId]).toBe(4)
  })
})
