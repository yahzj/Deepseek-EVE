/**
 * 序章·苏醒（2026-09-05 船长拍板）——教程步骤机 + 重要任务结算（core 侧，可测）。
 *
 * 步骤常量：-1 未开始（老档/经典开局）／0 序章演出（UI）／1 采集 → 2 交付 → 3 修复 →
 * 4 试炼 → 5 技能归档 → 6 分身 → 7 收尾演出（UI）→ 99 完成。
 *
 * 规则要点：
 * - 教程期间 UI 锁线性引导（渲染层）；本模块负责状态判定/自动推进与奖励发放（幂等）；
 * - 教学战（步骤 4 + ano-training + 主控）给玩家舰 命中/回避 +0.5（仅该战）；
 * - 跳过教程 = 全额结算（发齐所有未领奖励 + 隼枭修至完好），step → 99；
 * - 奖励发放均以 importantTasks 的 done 标记去重，不双发。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { addLog } from './state'
import { addWare } from './inventory'
import { isAtHome } from './location'

/** -1 = 未开始（老档/经典）；以下为教程进行态 */
export const ONB_OFF = -1
export const ONB_AWAKEN = 0 // 序章演出（黑屏→醒来→自检→PRTS；由渲染层推进到 1）
export const ONB_MINE = 1 // 采集：切沙猫→丰饶之环采矿→返港卸货
export const ONB_DELIVER = 2 // 交付：任务中心交「补给协议·首批矿物」
export const ONB_REPAIR = 3 // 修复：港内维修隼枭至完好
export const ONB_TRIAL = 4 // 试炼：演习场讨伐令（教学战加成）
export const ONB_SKILL = 5 // 技能归档：人工智能专家 Lv1 特典
export const ONB_DIVIDE = 6 // 分身：给沙猫指派 AI 采矿
export const ONB_EPILOGUE = 7 // 收尾演出（渲染层播放后调用 finishTutorial）
export const ONB_DONE = 99

/** 任务 ① 交付物：母港矿带（丰饶之环）富凡晶石；一趟约采 190~210 单位，教学交付 20 单位 */
export const TUTORIAL_DELIVER_ITEM = 'ore-veldspar'
export const TUTORIAL_DELIVER_N = 20
export const TUTORIAL_REWARD_ISK = 4_000
/** 任务 ② 奖励：轻型炮台（动能）MK1 ×1 + 动能弹 120 */
export const TUTORIAL_REWARD_TURRET = 'mod-turret-kin-1'
export const TUTORIAL_REWARD_AMMO = 'ammo-kinetic-l'
export const TUTORIAL_REWARD_AMMO_N = 120
/** S5 特典技能（AI 副船指挥门槛技能） */
export const TUTORIAL_SKILL_ID = 'ai-expert'
/** 教学战加成（船长 2026-09-05：命中/回避各 +0.5，仅教学战；模拟 6/6 种子稳胜 ≤25s） */
export const TUTORIAL_BATTLE_HIT_BONUS = 0.5
export const TUTORIAL_BATTLE_EVASION_BONUS = 0.5

/** 重要任务状态键（importantTasks） */
export const TASK_ORE_DELIVER = 'tut-ore-deliver'
export const TASK_TRIAL_WIN = 'tut-trial-win'

const isTaskDone = (state: GameState, key: string): boolean => state.importantTasks[key]?.done === true

function markDone(state: GameState, key: string): void {
  const prev = state.importantTasks[key]
  state.importantTasks[key] = { done: true, delivered: prev?.delivered ?? undefined }
}

/** 教程是否进行中（1..7） */
export function tutorialActive(state: GameState): boolean {
  return state.onboarding.step >= ONB_MINE && state.onboarding.step <= ONB_EPILOGUE
}

/** 教程等待段是否可加速（采集/返航等；渲染引擎时间泵 ×6 用） */
export function tutorialAccelWait(state: GameState): boolean {
  const s = state.onboarding.step
  if (s === ONB_MINE) {
    // 采集/返航途中（不在港）加速；已回港等交付不再加速
    return !isAtHome(state)
  }
  return false
}

/** 教学战判定：教程步骤 4、目标是演习场讨伐令、主控驾驶、任务未领 */
export function isTutorialBattle(state: GameState, anomalyId: string | null, shipId: string): boolean {
  return (
    state.onboarding.step === ONB_TRIAL &&
    anomalyId === 'ano-training' &&
    shipId === state.shipId &&
    !isTaskDone(state, TASK_TRIAL_WIN)
  )
}

/** 教学战加成注入（对玩家 UnitSpec：命中/回避）——调用方在每拍重建规格处使用 */
export function applyTutorialBuff(spec: { hitBonus: number; evasion: number }): void {
  spec.hitBonus += TUTORIAL_BATTLE_HIT_BONUS
  spec.evasion += TUTORIAL_BATTLE_EVASION_BONUS
}

/** 渲染层：序章演出完成（起名落定）→ 进入采集步骤 */
export function beginTutorialAfterAwaken(state: GameState): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) return { ok: false, error: '当前不在序章演出阶段。' }
  state.onboarding.step = ONB_MINE
  addLog(state, 'info', '自检完成——行动建议：采集矿石维持运转。导航：母港星域·丰饶之环。')
  return { ok: true }
}

/** 任务 ①：交付富凡晶石（从仓库扣除），发放 4,000 ISK + 基础 AI 核心 ×1 */
export function deliverTutorialOre(state: GameState, ctx: SimContext): CommandResult {
  if (state.onboarding.step < ONB_DELIVER || state.onboarding.step >= ONB_DONE) {
    return { ok: false, error: '「补给协议·首批矿物」还未到交付阶段。' }
  }
  if (isTaskDone(state, TASK_ORE_DELIVER)) return { ok: false, error: '「补给协议·首批矿物」已完成交付。' }
  const have = state.warehouse.items[TUTORIAL_DELIVER_ITEM] ?? 0
  if (have < TUTORIAL_DELIVER_N) {
    return { ok: false, error: `仓库富凡晶石不足（${have}/${TUTORIAL_DELIVER_N}）——先回港卸货。` }
  }
  state.warehouse.items[TUTORIAL_DELIVER_ITEM] = have - TUTORIAL_DELIVER_N
  state.wallet.isk += TUTORIAL_REWARD_ISK
  state.aiCores.basic = (state.aiCores.basic ?? 0) + 1
  markDone(state, TASK_ORE_DELIVER)
  const oreName = ctx.items.get(TUTORIAL_DELIVER_ITEM)?.name ?? TUTORIAL_DELIVER_ITEM
  addLog(
    state,
    'trade',
    `◆ 重要任务完成「补给协议·首批矿物」：交付 ${oreName}×${TUTORIAL_DELIVER_N}，+${TUTORIAL_REWARD_ISK.toLocaleString('zh-CN')} ISK、基础 AI 核心 ×1。`,
  )
  if (state.onboarding.step === ONB_DELIVER) state.onboarding.step = ONB_REPAIR
  return { ok: true }
}

/** 任务 ②：演习场讨伐令取胜奖励（结算钩子调用；幂等）——轻型炮台 MK1 + 动能弹 120 */
export function claimTutorialTrialReward(state: GameState, anomalyId: string | null): void {
  if (anomalyId !== 'ano-training' || isTaskDone(state, TASK_TRIAL_WIN)) return
  const s = state.onboarding.step
  if (s < ONB_TRIAL || s >= ONB_DONE) return
  markDone(state, TASK_TRIAL_WIN)
  state.moduleBay[TUTORIAL_REWARD_TURRET] = (state.moduleBay[TUTORIAL_REWARD_TURRET] ?? 0) + 1
  addWare(state, TUTORIAL_REWARD_AMMO, TUTORIAL_REWARD_AMMO_N)
  addLog(
    state,
    'trade',
    `◆ 重要任务完成「试炼·演习场讨伐令」：协会发放 轻型炮台 MK1 ×1、动能弹 ×${TUTORIAL_REWARD_AMMO_N}。`,
  )
  if (s === ONB_TRIAL) state.onboarding.step = ONB_SKILL
}

/** S5 特典：恢复记忆档案 → 人工智能专家 Lv1（免书免训练费，仅教程一次；幂等） */
export function grantTutorialSkill(state: GameState): boolean {
  if (state.onboarding.step < ONB_SKILL || state.onboarding.step >= ONB_DONE) return false
  const cur = state.skills.trained[TUTORIAL_SKILL_ID] ?? 0
  if (cur >= 1) return false
  state.skills.trained[TUTORIAL_SKILL_ID] = 1
  addLog(state, 'levelup', '记忆档案恢复：「人工智能专家」已归档至 Lv1——你可以指挥一艘 AI 副船了。')
  return true
}

/** S5 推进：玩家已进入技能页确认特典（渲染层在 step=5 且用户到达技能页时调用）→ 归档并进入分身步骤 */
export function onTutorialSkillPageOpened(state: GameState): CommandResult {
  if (state.onboarding.step !== ONB_SKILL) return { ok: false, error: '当前不在技能归档步骤。' }
  grantTutorialSkill(state)
  state.onboarding.step = ONB_DIVIDE
  addLog(state, 'info', '把基础 AI 核心装入沙猫，指派采矿作业——那是你的第一个分身。')
  return { ok: true }
}

/** 教程自动推进（每次游戏推进后调用；廉价，仅教程进行中执行） */
export function advanceOnboardingAuto(state: GameState, ctx: SimContext): void {
  const s = state.onboarding.step
  if (s < ONB_MINE || s >= ONB_DONE) return
  if (s === ONB_MINE) {
    // 采集完成：仓库已有 ≥20 富凡晶石（已返港卸货）→ 提示交付
    if ((state.warehouse.items[TUTORIAL_DELIVER_ITEM] ?? 0) >= TUTORIAL_DELIVER_N) {
      state.onboarding.step = ONB_DELIVER
      addLog(state, 'info', '采集达标：前往星图「任务中心」·重要任务交付「补给协议·首批矿物」。')
    }
    return
  }
  if (s === ONB_REPAIR) {
    const f = state.fleet['sh-falconet']
    if (f && (f.armorPct ?? 0) >= 0.999 && f.durability >= 0.999) {
      state.onboarding.step = ONB_TRIAL
      addLog(state, 'info', '隼枭已修复完好。前往「战斗悬赏」接受演习场讨伐令（试炼）。')
    }
    return
  }
  // 注：ONB_SKILL（技能归档）与 ONB_DELIVER（交付）由玩家动作驱动（onTutorialSkillPageOpened /
  // deliverTutorialOre），不在自动推进里瞬跳，保证引导节奏。
  if (s === ONB_DIVIDE) {
    if (Object.keys(state.aiAssignments).length > 0) {
      state.onboarding.step = ONB_EPILOGUE
      addLog(state, 'info', '分身已就位。')
    }
    return
  }
  // 忽略 ctx 未用告警
  void ctx
}

/** 渲染层：收尾演出播完 → 教程完成（全解锁） */
export function finishTutorial(state: GameState): CommandResult {
  if (state.onboarding.step !== ONB_EPILOGUE) return { ok: false, error: '收尾演出尚未开始。' }
  state.onboarding.step = ONB_DONE
  addLog(state, 'system', '序章·苏醒 完成。你，一艘不该存在的旧时代舰船 AI，开始了新的航程。')
  return { ok: true }
}

/** 跳过教程：全额结算（发齐未领奖励 + 隼枭修至完好），幂等；战斗进行中拒绝 */
export function skipTutorial(state: GameState, ctx: SimContext): CommandResult {
  const s = state.onboarding.step
  if (s < ONB_MINE || s >= ONB_DONE) return { ok: false, error: '教程尚未开始或已完成。' }
  if (state.expedition.battle) return { ok: false, error: '交火中不能跳过教程——战斗结束回港后再试。' }
  // 奖励去重：任务 ① 未领则补发
  if (!isTaskDone(state, TASK_ORE_DELIVER)) {
    state.wallet.isk += TUTORIAL_REWARD_ISK
    state.aiCores.basic = (state.aiCores.basic ?? 0) + 1
    markDone(state, TASK_ORE_DELIVER)
  }
  if (!isTaskDone(state, TASK_TRIAL_WIN)) {
    state.moduleBay[TUTORIAL_REWARD_TURRET] = (state.moduleBay[TUTORIAL_REWARD_TURRET] ?? 0) + 1
    addWare(state, TUTORIAL_REWARD_AMMO, TUTORIAL_REWARD_AMMO_N)
    markDone(state, TASK_TRIAL_WIN)
  }
  const cur = state.skills.trained[TUTORIAL_SKILL_ID] ?? 0
  if (cur < 1) {
    state.skills.trained[TUTORIAL_SKILL_ID] = 1
    addLog(state, 'levelup', '记忆档案恢复：「人工智能专家」已归档至 Lv1。')
  }
  const fal = state.fleet['sh-falconet']
  if (fal) {
    fal.armorPct = 1
    fal.durability = 1
  }
  state.onboarding.step = ONB_DONE
  addLog(state, 'system', '教程已跳过：教程奖励已全额结算，隼枭已修复完好。祝航程顺利。')
  return { ok: true }
}
