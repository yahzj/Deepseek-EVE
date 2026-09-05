/**
 * 序章·苏醒 core 阶段 2（2026-09-05 船长确认）：教程步骤机、重要任务结算（交付/试炼）、
 * 跳过全额结算、教学战加成判定回归测试。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  createInitialState,
  advanceGame,
  startMining,
  ONB_AWAKEN,
  ONB_MINE,
  ONB_DELIVER,
  ONB_REPAIR,
  ONB_TRIAL,
  ONB_SKILL,
  ONB_EPILOGUE,
  ONB_DONE,
  TUTORIAL_DELIVER_ITEM,
  TUTORIAL_DELIVER_N,
  TUTORIAL_REWARD_ISK,
  TUTORIAL_REWARD_TURRET,
  TUTORIAL_REWARD_AMMO,
  TUTORIAL_REWARD_AMMO_N,
  beginTutorialAfterAwaken,
  deliverTutorialOre,
  claimTutorialTrialReward,
  onTutorialSkillPageOpened,
  advanceOnboardingAuto,
  finishTutorial,
  skipTutorial,
  isTutorialBattle,
  applyTutorialBuff,
  TUTORIAL_BATTLE_HIT_BONUS,
  TUTORIAL_BATTLE_EVASION_BONUS,
} from '../src/index'

describe('序章·苏醒 步骤机与结算（core 阶段 2）', () => {
  const ctx = buildSimContext()

  it('唤醒演出完成 → 进入采集步骤', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    expect(s.onboarding.step).toBe(ONB_AWAKEN)
    expect(beginTutorialAfterAwaken(s).ok).toBe(true)
    expect(s.onboarding.step).toBe(ONB_MINE)
  })

  it('采集达标自动推进到交付；交付任务扣矿发奖（4,000 ISK + AI 核心），去重防双发', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_MINE
    s.warehouse.items[TUTORIAL_DELIVER_ITEM] = TUTORIAL_DELIVER_N + 5
    advanceOnboardingAuto(s, ctx)
    expect(s.onboarding.step).toBe(ONB_DELIVER)
    const r = deliverTutorialOre(s, ctx)
    expect(r.ok).toBe(true)
    expect(s.warehouse.items[TUTORIAL_DELIVER_ITEM]).toBe(5)
    expect(s.wallet.isk).toBe(TUTORIAL_REWARD_ISK)
    expect(s.aiCores.basic).toBe(1)
    expect(s.onboarding.step).toBe(ONB_REPAIR)
    // 双发防护 + 不足防护
    expect(deliverTutorialOre(s, ctx).ok).toBe(false)
    s.onboarding.step = ONB_DELIVER
    s.importantTasks = {}
    expect(deliverTutorialOre(s, ctx).ok).toBe(false) // 仓库不足
  })

  it('隼枭修满 → 自动进入试炼步骤', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_REPAIR
    s.fleet['sh-falconet']!.armorPct = 1
    s.fleet['sh-falconet']!.durability = 1
    advanceOnboardingAuto(s, ctx)
    expect(s.onboarding.step).toBe(ONB_TRIAL)
  })

  it('教学战判定与加成：仅 步骤4+演习场+主控 生效', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_TRIAL
    expect(isTutorialBattle(s, 'ano-training', 'sh-falconet')).toBe(true)
    expect(isTutorialBattle(s, 'ano-training', 'sandcat')).toBe(false) // 副船无加成
    expect(isTutorialBattle(s, 'ano-vault-sentinel', 'sh-falconet')).toBe(false)
    const spec = { hitBonus: 0.1, evasion: 0.13 }
    applyTutorialBuff(spec)
    expect(spec.hitBonus).toBeCloseTo(0.1 + TUTORIAL_BATTLE_HIT_BONUS, 5)
    expect(spec.evasion).toBeCloseTo(0.13 + TUTORIAL_BATTLE_EVASION_BONUS, 5)
  })

  it('试炼胜利奖励：炮台+动能弹 120，推进到技能归档；幂等', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_TRIAL
    claimTutorialTrialReward(s, 'ano-training')
    expect(s.moduleBay[TUTORIAL_REWARD_TURRET]).toBe(1)
    expect(s.warehouse.items[TUTORIAL_REWARD_AMMO]).toBe(TUTORIAL_REWARD_AMMO_N)
    expect(s.onboarding.step).toBe(ONB_SKILL)
    claimTutorialTrialReward(s, 'ano-training') // 幂等
    expect(s.moduleBay[TUTORIAL_REWARD_TURRET]).toBe(1)
    // 非教学目标不触发
    s.importantTasks = {}
    s.moduleBay = {}
    claimTutorialTrialReward(s, 'ano-other')
    expect(s.moduleBay[TUTORIAL_REWARD_TURRET]).toBeUndefined()
  })

  it('技能页确认 → 归档 AI 专家 Lv1 并进入分身步骤', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_SKILL
    expect(onTutorialSkillPageOpened(s).ok).toBe(true)
    expect(s.skills.trained['ai-expert']).toBe(1)
    expect(s.onboarding.step).toBe(6) // ONB_DIVIDE
    expect(onTutorialSkillPageOpened(s).ok).toBe(false)
  })

  it('收尾演出完成 → step 99', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_EPILOGUE
    expect(finishTutorial(s).ok).toBe(true)
    expect(s.onboarding.step).toBe(ONB_DONE)
  })

  it('教学首单采矿：采足交付量即返港停止(不等满舱),卸货后自动推进到交付步骤', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 3, prologue: true })
    s.onboarding.step = ONB_MINE
    s.shipId = 'sandcat'
    expect(startMining(s, 'belt-fortune', ctx).ok).toBe(true)
    let guard = 0
    while (s.mining.active && guard++ < 4000) advanceGame(s, 1000, ctx)
    expect(s.mining.active).toBe(false)
    expect(s.fleet['sandcat']!.cargo[TUTORIAL_DELIVER_ITEM] ?? 0).toBe(0) // 已卸空
    expect(s.warehouse.items[TUTORIAL_DELIVER_ITEM] ?? 0).toBeGreaterThanOrEqual(TUTORIAL_DELIVER_N)
    expect(s.onboarding.step).toBe(ONB_DELIVER)
  })

  it('跳过=全额结算并修船（去重），非教程态拒绝', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    s.onboarding.step = ONB_MINE
    expect(skipTutorial(s, ctx).ok).toBe(true)
    expect(s.onboarding.step).toBe(ONB_DONE)
    expect(s.wallet.isk).toBe(TUTORIAL_REWARD_ISK)
    expect(s.aiCores.basic).toBe(1)
    expect(s.moduleBay[TUTORIAL_REWARD_TURRET]).toBe(1)
    expect(s.warehouse.items[TUTORIAL_REWARD_AMMO]).toBe(TUTORIAL_REWARD_AMMO_N)
    expect(s.skills.trained['ai-expert']).toBe(1)
    expect(s.fleet['sh-falconet']!.armorPct).toBe(1)
    expect(s.fleet['sh-falconet']!.durability).toBe(1)
    // 已完成后不能再跳
    expect(skipTutorial(s, ctx).ok).toBe(false)
    const s2 = createInitialState({ nowWallMs: 0, seed: 2 })
    expect(skipTutorial(s2, ctx).ok).toBe(false) // 经典开局未开始
  })
})
