
import type { GameState, TrainingItem } from '../state'
import { addLog, MAX_SKILL_LEVEL } from '../state'
import type { SimContext, SkillCatalog, SkillDef } from '../types'
import type { CommandResult } from '../engine'
import { composeLog, logParamsOf } from '../logParts'
import { normalizeTrainingProgress, trainingLevelProgress } from './training'
import { skillLicenseMissing, skillLicensePriceOf } from './license'
import { syncBoostRenew, SYNAPTIC_ACCELERANT_RENEW_TAIL_MS } from '../consumables'
import { DEEP_SPACE_SKILL_IDS, probeManufacturingUnlocked } from '../probeManufacturing'

export const HIDDEN_SKILL_IDS: readonly string[] = []

export function advanceSkillQueue(state: GameState, deltaMs: number, ctx: SimContext): void {
  const catalog = ctx.skills
  const endGameMs = state.gameMs
  const endWallMs = state.wallMs
  let remaining = deltaMs
  state.gameMs = endGameMs - deltaMs
  try {
    normalizeTrainingProgress(state)
    for (;;) {
      if (endWallMs !== undefined) state.wallMs = endWallMs - remaining
      syncBoostRenew(state, ctx)
      if (remaining <= 0) break
      const boostRemainMs = Math.max(0, (state.skillBoostUntilMs ?? 0) - state.gameMs)
      let step = remaining
      if (boostRemainMs > 0) {
        step = Math.min(step, boostRemainMs)
        if (state.boostAutoRenew === true && boostRemainMs > SYNAPTIC_ACCELERANT_RENEW_TAIL_MS) {
          step = Math.min(step, boostRemainMs - SYNAPTIC_ACCELERANT_RENEW_TAIL_MS)
        }
      }
      if (state.skills.queue.length === 0) {
        state.gameMs += step
        remaining -= step
        continue
      }
      const item = state.skills.queue[0]!
      const def = catalog.get(item.skillId)
      if (!def) {
        state.skills.queue.shift()
        addLog(state, 'warn', `队列中发现未知技能「${item.skillId}」，已自动移除。`, 'core.engine.001', { p1: item.skillId })
        continue
      }
      const current = state.skills.trained[item.skillId] ?? 0
      if (current >= item.targetLevel) {
        state.skills.queue.shift()
        addLog(state, 'levelup', `训练完成：${def.name} 已达 Lv${item.targetLevel}。`, 'core.engine.002', {
          p1: def.name,
          p2: item.targetLevel,
        })
        continue
      }
      if (current >= MAX_SKILL_LEVEL) {
        state.skills.queue.shift()
        addLog(state, 'warn', `${def.name} 已是 Lv${MAX_SKILL_LEVEL}（技能上限），队列中该项已自动移除。`,
          'core.engine.003', { p1: def.name, p2: MAX_SKILL_LEVEL })
        continue
      }
      const progress = trainingLevelProgress(state, def, current + 1, item.progressMs)
      const needMs = progress.remainingMs
      step = Math.min(step, needMs)
      state.gameMs += step
      remaining -= step
      if (endWallMs !== undefined) state.wallMs = endWallMs - remaining
      if (step + 1e-7 < needMs) {
        item.progressMs = Math.min(progress.totalWorkMs, item.progressMs + step * progress.workPerMs)
      } else {
        item.progressMs = 0
        const newLevel = current + 1
        state.skills.trained[item.skillId] = newLevel
        addLog(state, 'levelup', `${def.name} 提升至 Lv${newLevel}！`, 'core.engine.004', { p1: def.name, p2: newLevel })
        if (newLevel >= item.targetLevel) {
          state.skills.queue.shift()
          addLog(state, 'levelup', `训练完成：${def.name} 已达 Lv${item.targetLevel}。`, 'core.engine.002', {
            p1: def.name,
            p2: item.targetLevel,
          })
        }
      }
    }
  } finally {
    state.gameMs = endGameMs
    state.wallMs = endWallMs
  }
}

function queuedSameCount(state: GameState, skillId: string): number {
  return state.skills.queue.reduce((n, q) => (q.skillId === skillId ? n + 1 : n), 0)
}

export const PREREQ_MIN_LEVEL = 1

export interface SkillPrereqGap {
  def: SkillDef
  needLevel: number
}

export function prereqNeedLevel(def: SkillDef, prereqId: string): number {
  const n = def.prereqLevel?.[prereqId]
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : PREREQ_MIN_LEVEL
}

export function skillLockMissing(
  state: GameState,
  def: SkillDef,
  catalog: SkillCatalog,
): readonly SkillPrereqGap[] {
  const pre = def.prereq
  if (pre === undefined || pre.length === 0) return []
  const out: SkillPrereqGap[] = []
  for (const pid of pre) {
    const pdef = catalog.get(pid)
    if (!pdef) continue
    const needLevel = prereqNeedLevel(def, pid)
    if ((state.skills.trained[pid] ?? 0) < needLevel) out.push({ def: pdef, needLevel })
  }
  return out
}

export function skillLockMissingAtQueue(
  state: GameState,
  def: SkillDef,
  catalog: SkillCatalog,
): readonly SkillPrereqGap[] {
  const pre = def.prereq
  if (pre === undefined || pre.length === 0) return []
  const out: SkillPrereqGap[] = []
  for (const pid of pre) {
    const pdef = catalog.get(pid)
    if (!pdef) continue
    const needLevel = prereqNeedLevel(def, pid)
    if ((state.skills.trained[pid] ?? 0) + queuedSameCount(state, pid) < needLevel) {
      out.push({ def: pdef, needLevel })
    }
  }
  return out
}

function firstOrderBlocker(
  state: GameState,
  catalog: SkillCatalog,
  queue: readonly TrainingItem[],
): { skillId: string; needLevel: number; haveLevel: number } | null {
  const before = new Map<string, number>()
  for (const it of queue) {
    const def = catalog.get(it.skillId)
    if (def) {
      for (const pid of def.prereq ?? []) {
        if (!catalog.get(pid)) continue
        const needLevel = prereqNeedLevel(def, pid)
        const haveLevel = (state.skills.trained[pid] ?? 0) + (before.get(pid) ?? 0)
        if (haveLevel < needLevel) return { skillId: pid, needLevel, haveLevel }
      }
    }
    before.set(it.skillId, (before.get(it.skillId) ?? 0) + 1)
  }
  return null
}

function queueOrderOk(state: GameState, catalog: SkillCatalog, queue: readonly TrainingItem[]): boolean {
  return firstOrderBlocker(state, catalog, queue) === null
}

export function planPrereqChain(
  state: GameState,
  def: SkillDef,
  catalog: SkillCatalog,
  opts?: { includeTarget?: boolean },
): TrainingItem[] {
  const steps: TrainingItem[] = []
  const planned = (id: string): number =>
    (state.skills.trained[id] ?? 0) +
    queuedSameCount(state, id) +
    steps.reduce((n, s) => (s.skillId === id ? n + 1 : n), 0)
  const seen = new Set<string>()
  const visit = (d: SkillDef): void => {
    if (seen.has(d.id)) return
    seen.add(d.id)
    for (const pid of d.prereq ?? []) {
      const pdef = catalog.get(pid)
      if (!pdef) continue
      /**
       * ⚠ **2026-09-27 训练许可**：缺许可的前置**不排**（排了也会被 `enqueueSkill` 拒）——
       * 跳过它连同它的更上游，让玩家先在界面买许可；目标入队时会明确报"需要先练 X"，路径不绕。
       */
      if (skillLicenseMissing(state, pdef)) continue
      visit(pdef)
      const need = prereqNeedLevel(d, pid)
      while (planned(pid) < need && planned(pid) < MAX_SKILL_LEVEL) {
        steps.push({ skillId: pid, targetLevel: planned(pid) + 1, progressMs: 0 })
      }
    }
  }
  visit(def)
  if (opts?.includeTarget === true && !HIDDEN_SKILL_IDS.includes(def.id)) {
    const next = planned(def.id) + 1
    if (next <= MAX_SKILL_LEVEL) steps.push({ skillId: def.id, targetLevel: next, progressMs: 0 })
  }
  return steps
}

function finalSkillLevels(state: GameState, queue: readonly TrainingItem[]): Map<string, number> {
  const lv = new Map<string, number>()
  for (const [id, n] of Object.entries(state.skills.trained)) lv.set(id, n)
  for (const it of queue) lv.set(it.skillId, (lv.get(it.skillId) ?? 0) + 1)
  return lv
}

function unmetPrereq(it: TrainingItem, lv: Map<string, number>, catalog: SkillCatalog): boolean {
  const def = catalog.get(it.skillId)
  if (!def) return false
  for (const pid of def.prereq ?? []) {
    if (!catalog.get(pid)) continue
    if ((lv.get(pid) ?? 0) < prereqNeedLevel(def, pid)) return true
  }
  return false
}

function preexistingUnmet(state: GameState, queue: readonly TrainingItem[], catalog: SkillCatalog): Set<TrainingItem> {
  const lv = finalSkillLevels(state, queue)
  return new Set(queue.filter((it) => unmetPrereq(it, lv, catalog)))
}

export function skillCancelImpact(
  state: GameState,
  catalog: SkillCatalog,
  index: number,
): { target: TrainingItem; also: TrainingItem[] } | null {
  const queue = state.skills.queue
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return null
  const target = queue[index]!
  const pre = preexistingUnmet(state, queue, catalog)
  let rest = queue.filter((_, i) => i !== index)
  const also: TrainingItem[] = []
  for (;;) {
    const lv = finalSkillLevels(state, rest)
    const hit = rest.filter((it) => !pre.has(it) && unmetPrereq(it, lv, catalog))
    if (hit.length === 0) break
    also.push(...hit)
    rest = rest.filter((it) => !hit.includes(it))
  }
  return { target, also }
}

export function enqueueSkill(
  state: GameState,
  skillId: string,
  targetLevel: number,
  catalog: SkillCatalog,
): CommandResult {
  normalizeTrainingProgress(state)
  const def = catalog.get(skillId)
  if (!def) return { ok: false, error: `未知技能：${skillId}（数据表里没有）。`, errorId: 'core.engine.005', errorParams: { p1: skillId } }
  if (DEEP_SPACE_SKILL_IDS.includes(skillId) && !probeManufacturingUnlocked(state)) return { ok: false, error: '深空搜索尚未解锁。', errorId: 'ui.stellar.059' }
  if (HIDDEN_SKILL_IDS.includes(skillId)) {
    return { ok: false, error: `「${def.name}」尚在研发中，暂不可训练。`, errorId: 'core.engine.006', errorParams: { p1: def.name } }
  }
  const locked = skillLockMissingAtQueue(state, def, catalog)
  if (locked.length > 0) {
    const names = locked.map((g) => `${g.def.name} Lv${g.needLevel}`).join('、')
    return {
      ok: false,
      error: `「${def.name}」需要先练：${names}。`,
      errorId: 'core.engine.019',
      errorParams: { p1: def.name, p2: names },
    }
  }
  /**
   * **训练许可校验**（**2026-09-27 船长令**：「我想让学习技能有成本」）——
   * rank收费档与显式定价技能均须先买许可；其余低阶技能免许可。
   * 判据 `skillLicenseMissing` 与界面按钮**共用同一把尺**；老档「已练到 Lv≥1」视同已购（零迁移）。
   * ⚠ 位置放在**真前置之后**：缺前置与缺许可同时存在时仍先报前置（既有报错顺序与用例一字不变）。
   */
  if (skillLicenseMissing(state, def)) {
    const price = skillLicensePriceOf(def) ?? 0
    return {
      ok: false,
      error: `「${def.name}」需要先购买训练许可（${price.toLocaleString('zh-CN')} 信用点）才能训练。`,
      errorId: 'core.engine.021',
      errorParams: { p1: def.name, p2: price.toLocaleString('zh-CN') },
    }
  }
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_SKILL_LEVEL) {
    return {
      ok: false,
      error: `目标等级必须是 1 ~ ${MAX_SKILL_LEVEL} 的整数。`,
      errorId: 'core.engine.007',
      errorParams: { p1: MAX_SKILL_LEVEL },
    }
  }
  const current = state.skills.trained[skillId] ?? 0
  if (targetLevel <= current) {
    delete state.skills.savedProgress[skillId]
    return {
      ok: false,
      error: `${def.name} 已是 Lv${current}，目标等级必须更高。`,
      errorId: 'core.engine.008',
      errorParams: { p1: def.name, p2: current },
    }
  }
  const queued = queuedSameCount(state, skillId)
  const nextExpected = current + 1 + queued
  if (targetLevel !== nextExpected) {
    if (queued > 0) {
      return {
        ok: false,
        error: `「${def.name}」队列里已排到 Lv${current + queued}，连锁训练需逐级入队：请排 Lv${nextExpected}。`,
        errorId: 'core.engine.009',
        errorParams: { p1: def.name, p2: current + queued, p3: nextExpected },
      }
    }
    return {
      ok: false,
      error: `连锁训练需逐级入队：${def.name} 当前 Lv${current}，请先排 Lv${nextExpected}（不能直接跳练 Lv${targetLevel}）。`,
      errorId: 'core.engine.010',
      errorParams: { p1: def.name, p2: current, p3: nextExpected, p4: targetLevel },
    }
  }
  const item: TrainingItem = { skillId, targetLevel, progressMs: 0 }
  if (queued === 0) {
    const saved = state.skills.savedProgress[skillId]
    if (typeof saved === 'number' && saved > 0) {
      const totalWorkMs = trainingLevelProgress(state, def, targetLevel, 0).totalWorkMs
      item.progressMs = Math.min(saved, Math.max(0, totalWorkMs - 1))
      delete state.skills.savedProgress[skillId]
    }
  }
  state.skills.queue.push(item)
  if (state.skills.queue.length === 1) {
    addLog(state, 'levelup', `开始训练：${def.name} → Lv${targetLevel}。`, 'core.engine.011', {
      p1: def.name,
      p2: targetLevel,
    })
  } else {
    addLog(state, 'levelup', `排入队列第 ${state.skills.queue.length} 位：${def.name} → Lv${targetLevel}。`, 'core.engine.012', {
      p1: state.skills.queue.length,
      p2: def.name,
      p3: targetLevel,
    })
  }
  return { ok: true }
}

export function removeQueueAt(state: GameState, index: number, catalog?: SkillCatalog): boolean {
  normalizeTrainingProgress(state)
  if (!Number.isInteger(index) || index < 0 || index >= state.skills.queue.length) return false
  const queue = state.skills.queue
  const pre = catalog ? preexistingUnmet(state, queue, catalog) : null
  const [removed] = queue.splice(index, 1)
  if (!removed) return false
  const demoted: TrainingItem[] = []
  for (let i = index; i < queue.length; i++) {
    const q = queue[i]!
    if (q.skillId === removed.skillId) {
      q.targetLevel -= 1
      demoted.push(q)
    }
  }
  let note = ''
  let noteId: string | undefined
  if (index === 0 && removed.progressMs > 0) {
    const successor = demoted.find((q) => q.targetLevel === removed.targetLevel)
    if (successor) {
      successor.progressMs = removed.progressMs
      note = '已练进度由顺延项承接。'
      noteId = 'core.engine.017'
    } else {
      const prev = state.skills.savedProgress[removed.skillId] ?? 0
      state.skills.savedProgress[removed.skillId] = Math.max(prev, removed.progressMs)
      note = '本级已练进度已保留，重新训练同一级时自动续接。'
      noteId = 'core.engine.018'
    }
  }
  const cascaded: TrainingItem[] = []
  if (catalog) {
    for (;;) {
      const lv = finalSkillLevels(state, queue)
      const hit = queue.filter((it) => !(pre?.has(it) ?? false) && unmetPrereq(it, lv, catalog))
      if (hit.length === 0) break
      for (const it of hit) {
        const at = queue.indexOf(it)
        if (at < 0) continue
        queue.splice(at, 1)
        for (let i = at; i < queue.length; i++) {
          const q = queue[i]!
          if (q.skillId === it.skillId) q.targetLevel -= 1
        }
        if (it.progressMs > 0) {
          const prev = state.skills.savedProgress[it.skillId] ?? 0
          state.skills.savedProgress[it.skillId] = Math.max(prev, it.progressMs)
        }
        cascaded.push(it)
      }
    }
  }
  const where = index === 0 ? '取消队首' : `移除第 ${index + 1} 位`
  const composed = composeLog(
    `${where}：${removed.skillId}（目标 Lv${removed.targetLevel}）。`,
    [
      note === '' ? null : { text: note, id: noteId },
      demoted.length > 0 ? { text: '后续同技能队列已顺延一级。', id: 'core.engine.016' } : null,
    ],
  )
  addLog(state, 'levelup', composed.text, index === 0 ? 'core.engine.014' : 'core.engine.015', {
    p1: index + 1,
    p2: removed.skillId,
    p3: removed.targetLevel,
    ...logParamsOf(composed),
  })
  if (cascaded.length > 0) {
    const names = cascaded.map((it) => `${catalog?.get(it.skillId)?.name ?? it.skillId} Lv${it.targetLevel}`).join('、')
    addLog(state, 'levelup', `连带取消 ${cascaded.length} 项依赖训练：${names}。`, 'core.engine.020', {
      p1: cascaded.length,
      p2: names,
    })
  }
  return true
}

function queueHeadProgress(queue: readonly TrainingItem[]): Map<string, { progressMs: number; targetLevel: number }> {
  const out = new Map<string, { progressMs: number; targetLevel: number }>()
  const seen = new Set<string>()
  for (const it of queue) {
    if (seen.has(it.skillId)) continue
    seen.add(it.skillId)
    if (it.progressMs > 0) out.set(it.skillId, { progressMs: it.progressMs, targetLevel: it.targetLevel })
  }
  return out
}

function reorderQueue(
  state: GameState,
  queue: readonly TrainingItem[],
  fromIndex: number,
  toIndex: number,
  progOf: ReadonlyMap<string, { progressMs: number; targetLevel: number }>,
): TrainingItem[] {
  const next = queue.map((it) => ({ ...it }))
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved!)
  const ranks = new Map<string, number>()
  for (const it of next) {
    const r = (ranks.get(it.skillId) ?? 0) + 1
    ranks.set(it.skillId, r)
    it.targetLevel = Math.min(MAX_SKILL_LEVEL, (state.skills.trained[it.skillId] ?? 0) + r)
    const saved = progOf.get(it.skillId)
    it.progressMs = saved !== undefined && r === 1 && it.targetLevel === saved.targetLevel ? saved.progressMs : 0
  }
  return next
}

export function moveQueueItem(
  state: GameState,
  fromIndex: number,
  toIndex: number,
  catalog?: SkillCatalog,
): boolean {
  normalizeTrainingProgress(state)
  const queue = state.skills.queue
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false
  if (fromIndex === toIndex) return true
  if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return false
  const next = reorderQueue(state, queue, fromIndex, toIndex, queueHeadProgress(queue))
  if (catalog && !queueOrderOk(state, catalog, next)) return false
  queue.splice(0, queue.length, ...next)
  return true
}

export interface QueueMovePlan {
  readonly ok: boolean
  readonly error?: string
  readonly errorId?: string
  readonly errorParams?: Readonly<Record<string, string | number>>
}

export function queueMovePlan(
  state: GameState,
  fromIndex: number,
  toIndex: number,
  catalog: SkillCatalog,
): QueueMovePlan {
  const queue = state.skills.queue
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= queue.length ||
    toIndex >= queue.length
  ) {
    return {
      ok: false,
      error: '队列里没有这一条（下标越界）。',
      errorId: 'core.engine.024',
      errorParams: {},
    }
  }
  if (fromIndex === toIndex) return { ok: true }
  const next = reorderQueue(state, queue, fromIndex, toIndex, queueHeadProgress(queue))
  const same = next.every((it, i) => it.skillId === queue[i]!.skillId && it.targetLevel === queue[i]!.targetLevel)
  if (same) {
    return {
      ok: false,
      error: '挪了等于没挪：同一技能在队列里按位置逐级排，这一步与它前一条等价。',
      errorId: 'core.engine.023',
      errorParams: {},
    }
  }
  const blocker = firstOrderBlocker(state, catalog, next)
  if (blocker !== null) {
    const name = catalog.get(blocker.skillId)?.name ?? blocker.skillId
    return {
      ok: false,
      error: `挪不过去：这条会排在它要的前置之前 —— ${name} 需 Lv${blocker.needLevel}，当前只有 Lv${blocker.haveLevel}。`,
      errorId: 'core.engine.022',
      errorParams: { p1: name, p2: blocker.needLevel, p3: blocker.haveLevel },
    }
  }
  return { ok: true }
}

export function clearSkillQueue(state: GameState): number {
  normalizeTrainingProgress(state)
  const count = state.skills.queue.length
  if (count > 0) {
    const head = state.skills.queue[0]!
    if (head.progressMs > 0) {
      const prev = state.skills.savedProgress[head.skillId] ?? 0
      state.skills.savedProgress[head.skillId] = Math.max(prev, head.progressMs)
    }
    state.skills.queue = []
    addLog(state, 'levelup', `已清空训练队列（${count} 项，队首进度已保留）。`, 'core.engine.013', { p1: count })
  }
  return count
}

export function noteLabOpened(state: GameState): boolean {
  if (state.labOpened === true) return false
  state.labOpened = true
  return true
}

export interface HeadTrainingInfo {
  skillId: string
  skillName: string
  targetLevel: number
  currentLevel: number
  intoLevel: number
  levelTimeMs: number
  progressMs: number
  remainingMs: number
  percent: number
}

export interface QueueView {
  head: HeadTrainingInfo | null
  pending: Array<{
    queueIndex: number
    skillId: string
    skillName: string
    targetLevel: number
    levelMs: number
    progressMs: number
    remainingMs: number
    etaMs: number
  }>
  totalRemainingMs: number
}
