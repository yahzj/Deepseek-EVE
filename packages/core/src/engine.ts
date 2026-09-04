/**
 * 引擎心脏：时间的推进与技能队列的全部操作。
 *
 * 重要设计（中文说明）：
 * - advanceGame 不关心"你是在线 1 秒还是离线 8 小时"，只按给的毫秒数推进。
 *   在线时界面每 1 秒调一次；离线时读档后调一次（大数值）——同一套逻辑，无需特判。
 * - 队列是严格的"先到先练"：队首正在训练，后面的排队；练完自动出队、练下一个。
 * - 队列项的进度只记"当前这一级"练了多少，升一级清零重计，逻辑简单不易错。
 * - T2 连锁训练：同一技能可以多次入队，但目标等级必须逐级 +1 递增
 *   （下一个可排的目标 = 已学等级 + 1 + 队列中同技能条数），跨级与重复目标会被拒绝；
 * - T2 取消语义：移除某条训练后，排在它后面的同技能条目自动顺延一级（填补空位）；
 *   取消正在练的队首时，本级进度转交给顺延项承接；没有顺延项则存入
 *   skills.savedProgress，下次把该技能重新排为队首时自动续接（没有"暂停"状态位）。
 */

import { addLog, MAX_SKILL_LEVEL } from './state'
import type { GameState, TrainingItem } from './state'
import type { SimContext, SkillCatalog } from './types'
import { skillLevelTimeMs } from './training'
import { advanceMining, advanceShipReturns } from './mining'
import { advanceStandby, advanceTransit } from './location'
import { advanceManufacturing } from './manufacturing'
import { advanceRefining } from './industry'
import { advanceExpedition } from './expedition'
import { advanceAi } from './ai'
import { advanceEvents } from './events'
import { advanceMarket } from './market'
import { advanceEncounterWatch } from './encounters'
import { advanceScanning, ensureTransitExplored } from './explore'

/** 指令执行结果：界面按钮点完拿这个决定是提示错误还是无事发生 */
export interface CommandResult {
  ok: boolean
  error?: string
}

/** 界面隐藏且不可训练的技能 id（战斗线预留占位：护盾/能量/船体加固，战斗数值接入后移除）——
 * 数据表保留条目便于回归；引擎禁训 + 界面过滤共用本清单（见 core/engine.enqueueSkill） */
export const HIDDEN_SKILL_IDS: readonly string[] = ['shield-operation', 'energy-management', 'hull-upgrades']

/**
 * 把游戏时间推进 deltaMs 毫秒（技能队列、主控采矿、换船善后返航、制造、主控远征、AI 副船任务、
 * 随机事件与市场）。非法/负数/0 的时长会被安全忽略。
 */
export function advanceGame(state: GameState, deltaMs: number, ctx: SimContext): void {
  const d = Math.floor(deltaMs)
  if (!Number.isFinite(d) || d <= 0) return
  state.gameMs += d
  // V13 探索：在途作业的星系视为已探明（读档/迁移恢复兜底）
  ensureTransitExplored(state, ctx)
  advanceSkillQueue(state, d, ctx.skills)
  advanceMining(state, d, ctx)
  // T4 换船善后：自动返航中的旧船独立于新作业推进（到港自动卸货）
  advanceShipReturns(state, d, ctx)
  // T8 显式返航行程（野外→空间站）
  advanceTransit(state, ctx)
  advanceStandby(state, ctx)
  advanceManufacturing(state, ctx)
  advanceRefining(state, ctx)
  advanceExpedition(state, ctx)
  advanceScanning(state, ctx)
  advanceAi(state, d, ctx)
  // B1 低安遭遇：在场记录维护（事件到点判定前刷新）+ 遭遇推进（待决超时自动文字结算 / 战斗推演）
  advanceEncounterWatch(state, ctx, d)
  // 随机事件（到达式触发；B1 低安遭遇占用其到点时机的判定入口；先于市场窗口撮合）
  advanceEvents(state, d, ctx)
  // 市场按窗口推进（离线大推进同样覆盖：订单过期/池回归/内部消化/补单/挂单撮合）
  advanceMarket(state, d, ctx)
}

/** 技能队列推进（内部函数，不对外） */
function advanceSkillQueue(state: GameState, deltaMs: number, catalog: SkillCatalog): void {
  let remaining = deltaMs
  while (remaining > 0 && state.skills.queue.length > 0) {
    const item = state.skills.queue[0]!
    const def = catalog.get(item.skillId)
    // 数据表里没有这个技能：不阻塞队列，直接丢弃并警告
    if (!def) {
      state.skills.queue.shift()
      addLog(state, 'warn', `队列中发现未知技能「${item.skillId}」，已自动移除。`)
      continue
    }
    const current = state.skills.trained[item.skillId] ?? 0
    // 目标早已达到（正常流程中不会出现，属兜底）：出队
    if (current >= item.targetLevel) {
      state.skills.queue.shift()
      addLog(state, 'queue', `训练完成：${def.name} 已达 Lv${item.targetLevel}。`)
      continue
    }
    // 冲当前这一级还差多久（调试模式 debugQuick：每级固定 1 秒）
    const levelMs = state.debugQuick ? 1000 : skillLevelTimeMs(def, current + 1)
    const needMs = Math.max(0, levelMs - item.progressMs)
    if (remaining < needMs) {
      // 时间不够升一级：只记下这级练到一半的进度
      item.progressMs += remaining
      remaining = 0
    } else {
      // 时间足够：升一级
      remaining -= needMs
      item.progressMs = 0
      const newLevel = current + 1
      state.skills.trained[item.skillId] = newLevel
      addLog(state, 'levelup', `${def.name} 提升至 Lv${newLevel}！`)
      if (newLevel >= item.targetLevel) {
        // 已达队列目标：立即出队；富余时间继续给后面的队列项（不浪费）
        state.skills.queue.shift()
        addLog(state, 'queue', `训练完成：${def.name} 已达 Lv${item.targetLevel}。`)
      }
    }
  }
}

/** 队列里已排入的"同技能条目数"（含队首；正在练的这一级也算已占位） */
function queuedSameCount(state: GameState, skillId: string): number {
  return state.skills.queue.reduce((n, q) => (q.skillId === skillId ? n + 1 : n), 0)
}

/** 玩家指令：把某技能"排入队列训练到第几级"（T2 连锁：必须逐级 +1 递增） */
export function enqueueSkill(
  state: GameState,
  skillId: string,
  targetLevel: number,
  catalog: SkillCatalog,
): CommandResult {
  const def = catalog.get(skillId)
  if (!def) return { ok: false, error: `未知技能：${skillId}（数据表里没有）。` }
  if (HIDDEN_SKILL_IDS.includes(skillId)) {
    return { ok: false, error: `「${def.name}」尚在研发中（战斗线预留），暂不可训练。` }
  }
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_SKILL_LEVEL) {
    return { ok: false, error: `目标等级必须是 1 ~ ${MAX_SKILL_LEVEL} 的整数。` }
  }
  const current = state.skills.trained[skillId] ?? 0
  if (targetLevel <= current) {
    // 这一级已经练过：暂存的进度已无意义，顺手清掉
    delete state.skills.savedProgress[skillId]
    return { ok: false, error: `${def.name} 已是 Lv${current}，目标等级必须更高。` }
  }
  // T2 连锁校验：目标 = 已学 + 1 + 同技能已排条数（天然覆盖"重复目标/跳级"两种非法入队）
  const queued = queuedSameCount(state, skillId)
  const nextExpected = current + 1 + queued
  if (targetLevel !== nextExpected) {
    if (queued > 0) {
      return {
        ok: false,
        error: `「${def.name}」队列里已排到 Lv${current + queued}，连锁训练需逐级入队：请排 Lv${nextExpected}。`,
      }
    }
    return {
      ok: false,
      error: `连锁训练需逐级入队：${def.name} 当前 Lv${current}，请先排 Lv${nextExpected}（不能直接跳练 Lv${targetLevel}）。`,
    }
  }
  const item: TrainingItem = { skillId, targetLevel, progressMs: 0 }
  if (queued === 0) {
    // 该项是该技能在本队列的"第一占位"（练的正是暂存进度所属的那一级，可能排在别的技能后面）：
    // 有被取消后暂存的本级进度 → 附着上去，等它成为队首时自动续接
    const saved = state.skills.savedProgress[skillId]
    if (typeof saved === 'number' && saved > 0) {
      const levelMs = state.debugQuick ? 1000 : skillLevelTimeMs(def, targetLevel)
      item.progressMs = Math.min(saved, Math.max(0, levelMs - 1))
      delete state.skills.savedProgress[skillId]
    }
  }
  state.skills.queue.push(item)
  if (state.skills.queue.length === 1) {
    addLog(state, 'queue', `开始训练：${def.name} → Lv${targetLevel}。`)
  } else {
    addLog(state, 'queue', `排入队列第 ${state.skills.queue.length} 位：${def.name} → Lv${targetLevel}。`)
  }
  return { ok: true }
}

/**
 * 玩家指令：移除队列中第 index 项（0 = 正在练的队首）。
 * T2 语义：排在后面的同技能条目自动顺延一级；队首练到一半的进度——
 * 有顺延项则转交（顺延项继续冲同一级），没有则存入 savedProgress 等下次续接。
 */
export function removeQueueAt(state: GameState, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= state.skills.queue.length) return false
  const queue = state.skills.queue
  const [removed] = queue.splice(index, 1)
  if (!removed) return false
  // 被删项之后的同技能条目：全部顺延一级，填补被取消的那级空位
  const demoted: TrainingItem[] = []
  for (let i = index; i < queue.length; i++) {
    const q = queue[i]!
    if (q.skillId === removed.skillId) {
      q.targetLevel -= 1
      demoted.push(q)
    }
  }
  let note = ''
  if (index === 0 && removed.progressMs > 0) {
    // 队首的进度：交给顺延后接替同一级的条目，否则暂存待续接
    const successor = demoted.find((q) => q.targetLevel === removed.targetLevel)
    if (successor) {
      successor.progressMs = removed.progressMs
      note = '已练进度由顺延项承接。'
    } else {
      const prev = state.skills.savedProgress[removed.skillId] ?? 0
      state.skills.savedProgress[removed.skillId] = Math.max(prev, removed.progressMs)
      note = '本级已练进度已保留，重新训练同一级时自动续接。'
    }
  }
  const where = index === 0 ? '取消队首' : `移除第 ${index + 1} 位`
  addLog(state, 'queue', `${where}：${removed.skillId}（目标 Lv${removed.targetLevel}）。${note}${demoted.length > 0 ? '后续同技能队列已顺延一级。' : ''}`)
  return true
}

/** 玩家指令：清空整个训练队列，返回移除了几项（队首进度保留，可续接） */
export function clearSkillQueue(state: GameState): number {
  const count = state.skills.queue.length
  if (count > 0) {
    const head = state.skills.queue[0]!
    if (head.progressMs > 0) {
      const prev = state.skills.savedProgress[head.skillId] ?? 0
      state.skills.savedProgress[head.skillId] = Math.max(prev, head.progressMs)
    }
    state.skills.queue = []
    addLog(state, 'queue', `已清空训练队列（${count} 项，队首进度已保留）。`)
  }
  return count
}

/** 给界面用的当前训练状态 */
export interface HeadTrainingInfo {
  skillId: string
  skillName: string
  targetLevel: number
  /** 已学等级 */
  currentLevel: number
  /** 正在冲击的等级 = currentLevel + 1 */
  intoLevel: number
  /** 冲击该级所需总毫秒 */
  levelTimeMs: number
  /** 该级已练毫秒 */
  progressMs: number
  /** 距该级完成还差毫秒 */
  remainingMs: number
  /** 该级进度 0~100 */
  percent: number
}

export interface QueueView {
  /** 队首（正在训练）；空队列为 null */
  head: HeadTrainingInfo | null
  /** 排队中的项目（不含正在练的队首） */
  pending: Array<{
    /** 在 queue 数组中的真实下标（界面做"移出该条"时直接用） */
    queueIndex: number
    skillId: string
    skillName: string
    targetLevel: number
    /** 该条目对应那一级的单级训练时长（毫秒） */
    levelMs: number
  }>
}

/** 只读查询：把队列翻译成界面容易直接显示的结构 */
export function skillQueueStatus(state: GameState, catalog: SkillCatalog): QueueView {
  const queue = state.skills.queue
  if (queue.length === 0) return { head: null, pending: [] }
  const item = queue[0]!
  const def = catalog.get(item.skillId)
  const currentLevel = state.skills.trained[item.skillId] ?? 0
  const intoLevel = currentLevel + 1
  const levelTimeMs = def ? skillLevelTimeMs(def, intoLevel) : 0
  const remainingMs = Math.max(0, levelTimeMs - item.progressMs)
  const percent = levelTimeMs > 0 ? Math.min(100, Math.max(0, (item.progressMs / levelTimeMs) * 100)) : 0
  const head: HeadTrainingInfo = {
    skillId: item.skillId,
    skillName: def ? def.name : `未知技能「${item.skillId}」`,
    targetLevel: item.targetLevel,
    currentLevel,
    intoLevel,
    levelTimeMs,
    progressMs: item.progressMs,
    remainingMs,
    percent,
  }
  const pending = queue.slice(1).map((p: TrainingItem, i) => {
    const pDef = catalog.get(p.skillId)
    return {
      queueIndex: i + 1,
      skillId: p.skillId,
      skillName: pDef?.name ?? `未知技能「${p.skillId}」`,
      targetLevel: p.targetLevel,
      levelMs: pDef ? skillLevelTimeMs(pDef, p.targetLevel) : 0,
    }
  })
  return { head, pending }
}
