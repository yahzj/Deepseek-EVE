import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { buySkillLicense, hasSkillLicense, skillLicenseMissing, skillLicensePriceOf, skillLicenseStandingBlock } from '../src/skillLicense'
import { advanceSkillQueue, enqueueSkill, planPrereqChain } from '../src/skills/queue'
import { COMMAND_SKILLS, commandCapacityOf } from '../src/combat/command/rules'
import { skillLevelTimeMs, totalTimeToLevel } from '../src/training'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const cases = [
  { id: 'fleet-command-basic', rank: 2, standing: 20, price: 50_000, perLevel: 5 },
  { id: 'fleet-command-coordination', rank: 3, standing: 40, price: 200_000, perLevel: 7 },
  { id: 'fleet-command-integration', rank: 5, standing: 60, price: 2_000_000, perLevel: 8 },
]

function world(earned: number) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261031 })
  state.standingsEarned = { dsi: earned }
  state.standings.dsi = 0
  state.wallet.isk = 10_000_000
  state.skills.trained = {}
  return state
}

describe('编队技能许可的声望与价格', () => {
  it.each(cases)('$id 配置、rank、许可价格与容量加成一致', row => {
    const def = ctx.skills.get(row.id)!
    expect(def).toMatchObject({ rank: row.rank, group: '舰船', branch: 'b-command', licensePriceIsk: row.price, licenseStandingReq: row.standing })
    expect(COMMAND_SKILLS.find(skill => skill.id === row.id)?.perLevel).toBe(row.perLevel)
    expect(skillLicensePriceOf(def)).toBe(row.price)
    const state = world(100)
    expect(skillLicenseMissing(state, def)).toBe(true)
    state.skills.trained[row.id] = 1
    expect(commandCapacityOf(state)).toBe(25 + row.perLevel)
  })

  it.each(cases)('$id 门槛差1拒绝且不改账本，恰好达标可购且不扣声望', row => {
    const state = world(row.standing - 1)
    state.standings.dsi = 999
    const before = structuredClone(state)
    const block = skillLicenseStandingBlock(state, ctx.skills.get(row.id)!)!
    expect(block.errorParams).toEqual({ p1: row.standing, standing: row.standing - 1 })
    expect(buySkillLicense(state, ctx.skills, row.id)).toEqual({ ok: false, ...block })
    expect(state).toEqual(before)
    state.standingsEarned!.dsi = row.standing
    state.standings.dsi = 0
    expect(buySkillLicense(state, ctx.skills, row.id)).toEqual({ ok: true, price: row.price })
    expect(state.wallet.isk).toBe(before.wallet.isk - row.price)
    expect(state.skills.licenses[row.id]).toBe(true)
    expect(state.skills.trained[row.id] ?? 0).toBe(0)
    expect(state.standings).toEqual({ dsi: 0 })
    expect(state.standingsEarned).toEqual({ dsi: row.standing })
    const bought = structuredClone(state)
    expect(buySkillLicense(state, ctx.skills, row.id).errorId).toBe('core.skillLicense.003')
    expect(state).toEqual(bought)
  })

  it.each(cases)('$id 余额差1失败原子性、恰好金额成功', row => {
    const state = world(row.standing)
    state.wallet.isk = row.price - 1
    const before = structuredClone(state)
    expect(buySkillLicense(state, ctx.skills, row.id).errorId).toBe('core.skillLicense.005')
    expect(state).toEqual(before)
    state.wallet.isk = row.price
    expect(buySkillLicense(state, ctx.skills, row.id).ok).toBe(true)
    expect(state.wallet.isk).toBe(0)
  })

  it.each(cases)('$id 入队及一键补齐不能绕过许可，许可购买不代练', row => {
    const state = world(row.standing)
    const def = ctx.skills.get(row.id)!
    for (const parent of def.prereq ?? []) state.skills.trained[parent] = 3
    expect(enqueueSkill(state, row.id, 1, ctx.skills)).toMatchObject({ ok: false, errorId: 'core.engine.021' })
    expect(state.skills.queue).toEqual([])
    expect(buySkillLicense(state, ctx.skills, row.id).ok).toBe(true)
    expect(enqueueSkill(state, row.id, 1, ctx.skills).ok).toBe(true)
    expect(state.skills.trained[row.id] ?? 0).toBe(0)
    if (row.id !== 'fleet-command-integration') {
      const next = ctx.skills.get(row.id === 'fleet-command-basic' ? 'fleet-command-coordination' : 'fleet-command-integration')!
      const fresh = world(100)
      expect(planPrereqChain(fresh, next, ctx.skills, { includeTarget: true }).some(step => step.skillId === row.id)).toBe(false)
    }
  })

  it.each(cases)('$id 已购与已练豁免及读档保留，不按新门槛回收', row => {
    const def = ctx.skills.get(row.id)!
    const bought = world(row.standing)
    expect(buySkillLicense(bought, ctx.skills, row.id).ok).toBe(true)
    const loaded = loadSaveFile(serializeSaveFile(bought, 0)).state
    loaded.standingsEarned = { dsi: 0 }
    expect(hasSkillLicense(loaded, def)).toBe(true)
    expect(skillLicenseStandingBlock(loaded, def)).toBeNull()
    const trained = world(0)
    trained.skills.trained[row.id] = 1
    for (const parent of def.prereq ?? []) trained.skills.trained[parent] = 3
    expect(hasSkillLicense(trained, def)).toBe(true)
    expect(buySkillLicense(trained, ctx.skills, row.id).errorId).toBe('core.skillLicense.004')
    expect(enqueueSkill(trained, row.id, 2, ctx.skills).ok).toBe(true)
  })

  it('其他低阶技能仍免许可，高阶仍按原rank价目表', () => {
    expect(skillLicensePriceOf(ctx.skills.get('navigation')!)).toBeNull()
    expect(skillLicensePriceOf(ctx.skills.get('evasion-maneuvering')!)).toBeNull()
    expect(skillLicensePriceOf(ctx.skills.get('accelerated-learning')!)).toBe(500_000)
    const state = world(0)
    expect(hasSkillLicense(state, ctx.skills.get('navigation')!)).toBe(true)
    expect(skillLicenseStandingBlock(state, ctx.skills.get('accelerated-learning')!)).toBeNull()
  })

  it('协同降为T3，前置仍为基础Lv3，旧训练工作量继续推进', () => {
    const def = ctx.skills.get('fleet-command-coordination')!
    expect(def.prereq).toEqual(['fleet-command-basic'])
    expect(def.prereqLevel).toEqual({ 'fleet-command-basic': 3 })
    expect(skillLevelTimeMs(def, 1)).toBe(465_000)
    expect(totalTimeToLevel(def, 0, 5)).toBe(40_455_000)
    expect(totalTimeToLevel({ ...def, rank: 4 }, 0, 5)).toBe(242_208_000)
    const state = world(0)
    state.skills.progressVersion = 1
    state.skills.trained['fleet-command-basic'] = 3
    state.skills.queue = [{ skillId: def.id, targetLevel: 1, progressMs: 500_000 }]
    state.gameMs = 1000
    advanceSkillQueue(state, 1000, ctx)
    expect(state.skills.trained[def.id]).toBe(1)
    expect(state.skills.queue).toEqual([])
  })
})
