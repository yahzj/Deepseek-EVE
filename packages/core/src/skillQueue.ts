/**
 * **技能训练队列**（2026-10-02 从 `engine.ts` 拆出 · 批次 4n · 零行为变化）。
 *
 * 本文件 = 主循环里的**技能队列域**：队列推进（含技能加速自动续用）、前置/封锁判定、
 * 一键补齐计划、入队/移队/清队与队列视图类型——只依赖 state 类型 / types / training / tuning。
 * `engine.ts` 原样再导出（先例：fitted.ts），既有引用零改动。
 */

/* 以下为 2026-10-02 批次 4n 从 engine.ts 切接过来的整簇（advanceSkillQueue ~ 文件尾）。 */
import type { GameState, TrainingItem } from './state'
import { addLog, MAX_SKILL_LEVEL } from './state'
import type { SimContext, SkillCatalog, SkillDef } from './types'
import type { CommandResult } from './engine'
import { composeLog, logParamsOf } from './logParts'
import { skillLevelTimeMs, trainingTimeFactor } from './training'
import { tuningMul } from './tuning'
import { skillLicenseMissing, skillLicensePriceOf } from './skillLicense'
import { syncBoostRenew } from './consumables'

/** 界面隐藏且不可训练的技能 id（2026-09-05 批次三起战斗占位全部开放，当前为空；
 * 未来新占位条目在此登记——引擎禁训 + 界面过滤共用本清单）
 * （2026-10-02 批次 4n 从 engine.ts 迁来） */
export const HIDDEN_SKILL_IDS: readonly string[] = []

/** 技能队列推进（内部函数，不对外）
 *
 * ⚠ **2026-10-01（技能加速自动续用）**：第三参由 `SkillCatalog` 改成整个 `ctx` —— 因为"续用"判据要
 * 与这里的训练时长**同一套乘区**（`skillLevelTimeMs × trainingTimeFactor × tuningMul`），
 * 而那条判据住在 `consumables.syncBoostRenew`（自动补用的**唯一实现**）。改签名只影响本函数内部。 */
export function advanceSkillQueue(state: GameState, deltaMs: number, ctx: SimContext): void {
  const catalog = ctx.skills
  let remaining = deltaMs
  while (remaining > 0 && state.skills.queue.length > 0) {
    /**
     * **技能加速自动续用**（**2026-10-01 船长令**）：逐级检查一次 —— 放在"取队首"之后、
     * 算本级时长之前 ⇒ 补用的那一枚从**本级**就生效（无缝），在线每拍与离线大推进/分片同一条路径。
     * 开关关着 / 没料 / 还在生效期内 ⇒ 函数内部一步返回（零行为变化、零开销）。
     */
    syncBoostRenew(state, ctx)
    const item = state.skills.queue[0]!
    const def = catalog.get(item.skillId)
    // 数据表里没有这个技能：不阻塞队列，直接丢弃并警告
    if (!def) {
      state.skills.queue.shift()
      addLog(
        state,
        'warn',
        `队列中发现未知技能「${item.skillId}」，已自动移除。`,
        'core.engine.001',
        { p1: item.skillId },
      )
      continue
    }
    const current = state.skills.trained[item.skillId] ?? 0
    // 目标早已达到（正常流程中不会出现，属兜底）：出队
    if (current >= item.targetLevel) {
      state.skills.queue.shift()
      addLog(state, 'levelup', `训练完成：${def.name} 已达 Lv${item.targetLevel}。`, 'core.engine.002', {
        p1: def.name,
        p2: item.targetLevel,
      })
      continue
    }
    // 技能上限纵深防御（2026-09-10 玩家反馈"AI 核心调度学能升到 LV6"排查）：入队口与读档都已限制
    // ≤ MAX_SKILL_LEVEL，这里再夹一道——将来任何新增写入路径塞进超限目标时，等级也只停在 5 并出队，
    // 不会出现 Lv6（效果公式另有 Math.min(5, …)，见 ai.ts）。
    if (current >= MAX_SKILL_LEVEL) {
      state.skills.queue.shift()
      addLog(
        state,
        'warn',
        `${def.name} 已是 Lv${MAX_SKILL_LEVEL}（技能上限），队列中该项已自动移除。`,
        'core.engine.003',
        { p1: def.name, p2: MAX_SKILL_LEVEL },
      )
      continue
    }
    // 冲当前这一级还差多久（调试模式 debugQuick：每级固定 1 秒；高效学习法缩时）
    const levelMs = state.debugQuick
      ? 1000
      : Math.max(1, Math.round(skillLevelTimeMs(def, current + 1) * trainingTimeFactor(state) * tuningMul(state, 'skillTrainMs')))
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
      addLog(state, 'levelup', `${def.name} 提升至 Lv${newLevel}！`, 'core.engine.004', { p1: def.name, p2: newLevel })
      if (newLevel >= item.targetLevel) {
        // 已达队列目标：立即出队；富余时间继续给后面的队列项（不浪费）
        state.skills.queue.shift()
        addLog(state, 'levelup', `训练完成：${def.name} 已达 Lv${item.targetLevel}。`, 'core.engine.002', {
          p1: def.name,
          p2: item.targetLevel,
        })
      }
    }
    /**
     * **本级练完后再查一次**（2026-10-01）：队列可能刚刚被练空 —— 那样 `while` 条件会立刻跳出、
     * 前面那次 `syncBoostRenew` 就成了本拍唯一一次机会。"料尽 ⇒ 关开关"的判定要能落在
     * **队列清空的那一刻**（真档实测：离线一趟把队列练空后，开关会一直亮着）。
     */
    syncBoostRenew(state, ctx)
  }
  /**
   * **循环外的收尾检查**：本拍队列**本来就是空的**（或刚刚清空且上面那一拍没走到）时，
   * `while` 一次都不进 ⇒ 仍需一次判定，否则"开着开关、没料了"会一直亮着。
   * 队列空着且**还有料**时这里什么都不做（`syncBoostRenew` 内部只在"料尽"或"确实该补"时动手）。
   */
  syncBoostRenew(state, ctx)
}

/** 队列里已排入的"同技能条目数"（含队首；正在练的这一级也算已占位） */
function queuedSameCount(state: GameState, skillId: string): number {
  return state.skills.queue.reduce((n, q) => (q.skillId === skillId ? n + 1 : n), 0)
}

/** 玩家指令：把某技能"排入队列训练到第几级"（T2 连锁：必须逐级 +1 递增） */
/**
 * **前置技能的最低等级**（**2026-09-22 船长裁定：「甲，lv1」**）——"学过就能往下走"，
 * 不拖开局节奏。要更硬（如 Lv3）改这一个常数即可（`content:check` 与界面都读它）。
 */
export const PREREQ_MIN_LEVEL = 1

/**
 * **一条前置缺口**：缺哪个前置、它要求多少级（**2026-09-23 起判据按等级**，见 `SkillDef.prereqLevel`）。
 * 界面文案（置灰提示 / 入队拒绝）+ 一键补齐计划都读它，免得三处各写一套"要几级"。
 */
export interface SkillPrereqGap {
  def: SkillDef
  needLevel: number
}

/** 某前置要求的最低等级（`prereqLevel` 缺省 / 非法值一律回落 `PREREQ_MIN_LEVEL`） */
export function prereqNeedLevel(def: SkillDef, prereqId: string): number {
  const n = def.prereqLevel?.[prereqId]
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : PREREQ_MIN_LEVEL
}

/**
 * **该技能还差哪些前置**（**真前置的唯一判据**，界面置灰、入队校验、一键补齐共用这把尺）：
 * 返回**未达"各自要求等级"的前置**（都达标 ⇒ 空数组）。表里查不到的 id 一律忽略
 * （`content:check` 会把悬空前置点红，运行期不因此卡住玩家）。
 *
 * ⚠ 2026-09-23 形状变更：原返回 `SkillDef[]` ⇒ 现返回 `{ def, needLevel }[]`（前置可以有**不同**的
 * 等级门槛，界面要写"要几级"）；调用点四处已同步（入队校验 / 树页 / 测试）。
 */
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

/**
 * **入队判据**：前置"**轮到这一项之前**"能否到位（**2026-09-23 船长追加**：「「一并加入前置」要练目标一起排」）。
 *
 * 与 `skillLockMissing`（只看**已练**等级 ⇒ 界面置灰用）的区别：这里把**队列里已排的条数**也算进去——
 * 新项一律追加到队尾 ⇒ 队列里已有的条目都在它前面，它们会把前置练到要求的等级。
 * 于是"一键补齐（前置 + 目标本级）"能在**一次动作**里排完；**空队时两者完全一致**（老档/老手感不变）。
 */
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

/**
 * **顺序契约的第一处违反**（`null` ＝ 顺序成立）：逐项按"**排在它前面的同技能条数**"算可用等级。
 * `queueOrderOk`（挡下非法挪动）与 `queueMovePlan`（告诉玩家为什么挪不动）**共用这一把尺** ⇒ 判据只有一份。
 */
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

/**
 * **队列顺序是否成立**（逐项按"**排在它前面的同技能条数**"算可用等级）：
 * 供 `moveQueueItem` 挡掉"把吃前置的项挪到前置之前"这种会卡住队首的排法（2026-09-23 起队列允许
 * 排在后面的项依赖前面还没练的级，所以顺序本身成了一条要守的契约）。
 */
function queueOrderOk(state: GameState, catalog: SkillCatalog, queue: readonly TrainingItem[]): boolean {
  return firstOrderBlocker(state, catalog, queue) === null
}

/**
 * **一键补齐前置的计划**（**2026-09-23 船长**：「玩家选择某个技能后，如果该技能有前置技能，
 * 可以直接添加前置技能到训练队列。」）：
 *
 * 算出"把 `def` 变成可训练"要往队列里补哪些级，规则三条 ——
 * ① **拓扑序**：更深的前置排在前面（前置的前置先补完，才轮到它的上级）；
 * ② **复用不重复**：已练等级 + **队列里已排的条数**都算作"将会有"的等级 ⇒ 已排过的级不会重复入队；
 * ③ **逐级**：只补到各自的要求等级（`prereqNeedLevel`），且不超过 `MAX_SKILL_LEVEL`。
 *
 * **纯函数**：只看 `state.skills.trained` 与 `state.skills.queue`，不改任何状态；返回的每一步都能直接
 * 交给 `enqueueSkill` 依次执行（顺序即是入队顺序）。
 *
 * `opts.includeTarget`（**2026-09-23 船长追加**：「「一并加入前置」要练目标一起排」）⇒ 末尾再排上
 * **目标技能自己的下一级**（等级 = 已练 + 队列里已排条数 + 1，与 `trainNextLevel` 同一把尺）；
 * 缺省 `false` = 只出前置链（供其它调用点与单测用）。
 */
export function planPrereqChain(
  state: GameState,
  def: SkillDef,
  catalog: SkillCatalog,
  opts?: { includeTarget?: boolean },
): TrainingItem[] {
  const steps: TrainingItem[] = []
  /** 计划中的等级 = 已练 + 队列里已排的条数 + 本计划里已补的条数 */
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
      visit(pdef) // 更深的前置先补
      const need = prereqNeedLevel(d, pid)
      while (planned(pid) < need && planned(pid) < MAX_SKILL_LEVEL) {
        steps.push({ skillId: pid, targetLevel: planned(pid) + 1, progressMs: 0 })
      }
    }
  }
  visit(def)
  if (opts?.includeTarget === true && !HIDDEN_SKILL_IDS.includes(def.id)) {
    const next = planned(def.id) + 1
    // 满级/越限就不排目标（前置照旧排好）；其它非法情况由 `enqueueSkill` 兜底并把原因回给调用方
    if (next <= MAX_SKILL_LEVEL) steps.push({ skillId: def.id, targetLevel: next, progressMs: 0 })
  }
  return steps
}

/**
 * **队列跑完后各技能的最终等级**（= 已练 + 队列里该技能的条数）——取消级联的判据。
 * 为什么用"最终等级"而不是"当下等级"：队列是一条会跑完的链，判"这项到队首时前置够不够"
 * 等价于判"整条队列跑完后那个前置会到几级"（等级只升不降、且 `enqueueSkill` 已保证逐级）。
 */
function finalSkillLevels(state: GameState, queue: readonly TrainingItem[]): Map<string, number> {
  const lv = new Map<string, number>()
  for (const [id, n] of Object.entries(state.skills.trained)) lv.set(id, n)
  for (const it of queue) lv.set(it.skillId, (lv.get(it.skillId) ?? 0) + 1)
  return lv
}

/** 该项的前置（按最终等级判）是否已经不可能满足 */
function unmetPrereq(it: TrainingItem, lv: Map<string, number>, catalog: SkillCatalog): boolean {
  const def = catalog.get(it.skillId)
  if (!def) return false
  for (const pid of def.prereq ?? []) {
    if (!catalog.get(pid)) continue
    if ((lv.get(pid) ?? 0) < prereqNeedLevel(def, pid)) return true
  }
  return false
}

/**
 * **取消之前就已经不满足前置的那些项**（按对象身份收进 `Set`）。
 *
 * ⚠ **2026-09-26 修（玩家报障「只要取消任何技能，就会弹出"会连带取消 10 项"」）**：
 * 队列里可能本来就挂着"前置没满足"的项（老档入队早于前置系统 / 前置项早先被取消过而玩家点了「取消」
 * 没确认）。这些项**与本场取消毫无关系**，但原实现的判据是"剩余队列里所有前置不满足的项"
 * ⇒ 取消任何一项都会把它们列成"连带取消"，而且点「确认取消」会**真把它们删掉**（毁掉玩家排好的训练）。
 * 现在两处（`skillCancelImpact` 的确认条 / `removeQueueAt` 的级联执行）都先减掉这份基线：
 * **只报/只删"因为本次取消才变成不满足"的项**——与船长 2026-09-23 那条令（取消前置 ⇒ 依赖项一并取消）
 * 的本意一致（那条讲的是"被取消项的依赖者"，不是"队列里所有坏项"）。
 */
function preexistingUnmet(state: GameState, queue: readonly TrainingItem[], catalog: SkillCatalog): Set<TrainingItem> {
  const lv = finalSkillLevels(state, queue)
  return new Set(queue.filter((it) => unmetPrereq(it, lv, catalog)))
}

/**
 * **取消一项会连带取消哪些**（纯计划，给界面"先列清单再确认"用；2026-09-23 船长裁定**甲**：
 * 「清整个队列里所有不满足的依赖项（**含排在它前面的**）」）。
 *
 * 判据：把目标项拿掉后算 `finalSkillLevels` ⇒ 凡"前置的最终等级 < 其要求等级"的项都要取消；
 * 取消会让该技能的最终等级变小 ⇒ **迭代到不动点**（级联链）。
 * 返回 `also` 一律按**它们在队列里的先后**排列（含排在被取消项前面的）。
 *
 * ⚠ **只算"因本次取消才不满足"的项**（基线见 `preexistingUnmet`）：本来就不满足的项不列、也不会被删。
 */
export function skillCancelImpact(
  state: GameState,
  catalog: SkillCatalog,
  index: number,
): { target: TrainingItem; also: TrainingItem[] } | null {
  const queue = state.skills.queue
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return null
  const target = queue[index]!
  /** 取消之前就坏的项（与本次取消无关 ⇒ 不列、也不删） */
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
  const def = catalog.get(skillId)
  if (!def) return { ok: false, error: `未知技能：${skillId}（数据表里没有）。`, errorId: 'core.engine.005', errorParams: { p1: skillId } }
  if (HIDDEN_SKILL_IDS.includes(skillId)) {
    return { ok: false, error: `「${def.name}」尚在研发中，暂不可训练。`, errorId: 'core.engine.006', errorParams: { p1: def.name } }
  }
  /**
   * **真前置校验**（**2026-09-22 船长令**：「**将同类效果的技能做成上下级关系**」＋门槛 **Lv1**）：
   * 前置**全部**达到 `PREREQ_MIN_LEVEL` 才放行；缺哪条就把名字摆出来（界面置灰走同一把尺，见
   * `skillLockMissing`）。**老档零迁移**：判据只看 `skills.trained` 的已练等级 ⇒ 已经练过前置的档
   * 天然满足，不需要任何迁移键、也不回收已练技能。
   */
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
   * 收费档（rank4/5/6，rank6 为**预留档**）必须先买许可才能排训练；rank1~3 免许可。
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
    // 这一级已经练过：暂存的进度已无意义，顺手清掉
    delete state.skills.savedProgress[skillId]
    return {
      ok: false,
      error: `${def.name} 已是 Lv${current}，目标等级必须更高。`,
      errorId: 'core.engine.008',
      errorParams: { p1: def.name, p2: current },
    }
  }
  // T2 连锁校验：目标 = 已学 + 1 + 同技能已排条数（天然覆盖"重复目标/跳级"两种非法入队）
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
    // 该项是该技能在本队列的"第一占位"（练的正是暂存进度所属的那一级，可能排在别的技能后面）：
    // 有被取消后暂存的本级进度 → 附着上去，等它成为队首时自动续接
    const saved = state.skills.savedProgress[skillId]
    if (typeof saved === 'number' && saved > 0) {
      const levelMs = state.debugQuick
        ? 1000
        : Math.max(1, Math.round(skillLevelTimeMs(def, targetLevel) * trainingTimeFactor(state) * tuningMul(state, 'skillTrainMs')))
      item.progressMs = Math.min(saved, Math.max(0, levelMs - 1))
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

/**
 * 玩家指令：移除队列中第 index 项（0 = 正在练的队首）。
 * T2 语义：排在后面的同技能条目自动顺延一级；队首练到一半的进度——
 * 有顺延项则转交（顺延项继续冲同一级），没有则存入 savedProgress 等下次续接。
 *
 * **2026-09-23 追加：依赖级联**（船长令＋裁定甲）——传入 `catalog` 时，取消一项会**一并取消**
 * 队列里所有"前置最终等级不满足要求"的条目（**含排在被取消项前面的**），并迭代到不动点；
 * 传 `catalog` 缺省 = 不级联（老调用点与单测行为不变）。界面先用 `skillCancelImpact` 列出清单。
 */
export function removeQueueAt(state: GameState, index: number, catalog?: SkillCatalog): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= state.skills.queue.length) return false
  const queue = state.skills.queue
  /**
   * ⚠ **基线要在删之前取**（`preexistingUnmet` 的注释）：本来就是"前置不满足"的项**不随本次取消被删**
   * ——2026-09-26 玩家报障：取消任何一项都会连带删掉队列里那 10 项"前置没满足"的训练。
   */
  const pre = catalog ? preexistingUnmet(state, queue, catalog) : null
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
  let noteId: string | undefined
  if (index === 0 && removed.progressMs > 0) {
    // 队首的进度：交给顺延后接替同一级的条目，否则暂存待续接
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
  /**
   * **依赖级联**（**2026-09-23 船长令**：「训练队列内取消一个技能的同时会取消所有依赖其前置的后续技能的
   * 训练。（但是假设前置是 LV1，你取消的是 LV2 并不会移除后续的其他技能训练。）」；裁定**甲**：
   * 「清整个队列里所有不满足的依赖项（**含排在它前面的**）」）。
   *
   * 判据 = `skillCancelImpact` 那一把尺（**同一份实现**：界面先用它列确认条、这里照它执行），
   * 删一项会让相关技能的**最终等级**变小 ⇒ 迭代到不动点。
   * ⚠ **只清"因本次取消才不满足"的项**：取消之前就坏的项**原样留着**（见 `preexistingUnmet` 的 ⚠）。
   * `catalog` 缺省时不级联（老调用点/单测的行为不变 ⇒ 显式传入才启用新语义）。
   */
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
        // 同技能后续条目照旧顺延一级（与目标项同一套口径）
        for (let i = at; i < queue.length; i++) {
          const q = queue[i]!
          if (q.skillId === it.skillId) q.targetLevel -= 1
        }
        // 已练进度不丢：存进 savedProgress，重新排这一级时自动续接
        if (it.progressMs > 0) {
          const prev = state.skills.savedProgress[it.skillId] ?? 0
          state.skills.savedProgress[it.skillId] = Math.max(prev, it.progressMs)
        }
        cascaded.push(it)
      }
    }
  }
  const where = index === 0 ? '取消队首' : `移除第 ${index + 1} 位`
  /**
   * 甲案（2026-09-20）：多段拼接——`where` + 技能 + 目标级 + note + 顺延句，其中 `note` 是三种之一、
   * 末段可空 ⇒ 基础模板按"取消队首 / 移除第 N 位"分岔，末段挂着才带；空段不入链。
   * ⚠ 基础模板占用了 `p1`（位次）… ⇒ 段链从 `p4` 起排，免得段号与基础参数抢槽。
   */
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
  // 级联单独记一条（段链已占用 p4+，另起一条最省事，玩家在日志里也能一眼看到被连带取消了什么）
  if (cascaded.length > 0) {
    const names = cascaded.map((it) => `${catalog?.get(it.skillId)?.name ?? it.skillId} Lv${it.targetLevel}`).join('、')
    addLog(state, 'levelup', `连带取消 ${cascaded.length} 项依赖训练：${names}。`, 'core.engine.020', {
      p1: cascaded.length,
      p2: names,
    })
  }
  return true
}

/** 各技能"队内首条"的进度快照（仅当它在冲 已学+1 这一级时有效）——`moveQueueItem` 与 `queueMovePlan` 共用 */
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

/**
 * **挪一次队列的纯计算**（`from → to` ＋ 重算目标等级与进度归属）：返回**挪好的新数组**，不碰 `state`。
 * 等级规则：同技能按"新出现次序"重算（＝已学 ＋ 队内第 N 条）⇒ **逐级不可拆**；所以同技能相邻两条互换
 * 会得到与原来逐项相同的队列（`queueMovePlan` 判成"挪了等于没挪"，见下）。
 */
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
    // 重算目标等级：已学 + 队内第 N 条；再夹一道技能上限（正常入队已保证 ≤5，此处防异常档/将来新路径）
    it.targetLevel = Math.min(MAX_SKILL_LEVEL, (state.skills.trained[it.skillId] ?? 0) + r)
    const saved = progOf.get(it.skillId)
    it.progressMs = saved !== undefined && r === 1 && it.targetLevel === saved.targetLevel ? saved.progressMs : 0
  }
  return next
}

/**
 * 玩家指令：调整训练队列顺序（2026-09-08 船长：前移到顶可“交换式顶替”当前训练——
 * 原队首带着本级进度退回其空出的位置，零损失）。
 * 规则：在 0..len-1 之间移动任意条目（含队首）；移动后同技能条目按新出现次序
 * 重算目标等级（= 当前已学 + 第 N 条，保持连锁逐级与各级时长正确）；
 * 进度只跟随“该技能在队内的第一条”（目标 = 已学+1 者），其余条目进度清零。
 *
 * **2026-09-23 追加（顺序契约）**：传 `catalog` 时，挪完会校验「没有哪一项排在它要的前置之前」
 * （队列允许排在后面的项依赖前面还没练的级 ⇒ 顺序本身成了契约）；破了就**整单回滚并返回 false**。
 * ⚠ **2026-09-30 追加**：`false` 有两种成因（顺序契约 / 挪了等于没挪），界面要靠
 * `queueMovePlan` 提前问清楚 —— 别让玩家点了没反应。
 */
export function moveQueueItem(
  state: GameState,
  fromIndex: number,
  toIndex: number,
  catalog?: SkillCatalog,
): boolean {
  const queue = state.skills.queue
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false
  if (fromIndex === toIndex) return true
  if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return false
  // 先算"挪好的队列"（纯计算），校验通过才写回 ⇒ 破契约时 state 原样不动，不需要整单还原
  const next = reorderQueue(state, queue, fromIndex, toIndex, queueHeadProgress(queue))
  if (catalog && !queueOrderOk(state, catalog, next)) return false
  queue.splice(0, queue.length, ...next)
  return true
}

/**
 * **这一步挪不挪得动**（纯函数 · **2026-09-30 船长令**：「部分技能在队列中置顶无效」——
 * 让 ⇈/↑/↓ 说实话，别再"点了没反应"）。
 *
 * 回答两类"挪不动"，与 `moveQueueItem` **同一套判据**（`reorderQueue` ＋ `firstOrderBlocker`）：
 * ① `core.engine.023` **挪了等于没挪**：同技能在队列里按位置逐级排 ⇒ 把第 2..N 条往前挪一格
 *    会得到逐项相同的队列（相邻同级互换、或把块内一条挪到块首都是这种）；
 * ② `core.engine.022` **挪不过去**：这一步会让它排在它要的前置之前（顺序契约）——
 *    附上卡住它的前置与"需要几级 / 当前只有几级"。
 *
 * 返回结构沿用 `CommandResult` 的文案三件套（`error` / `errorId` / `errorParams`），
 * 界面直接 `cmdText(plan)` 取当期语言的说明（id 见 `packages/data/src/l10n/table.ts`）。
 *
 * ⚠ **计划比 `moveQueueItem` 严一档**：判"挪了等于没挪"时引擎照样返回 `true`（队列确实没变、也没报错），
 * 但这一步对玩家没有意义 ⇒ 计划判成不可挪，界面把按钮置灰并说明原因。
 */
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
    addLog(state, 'levelup', `已清空训练队列（${count} 项，队首进度已保留）。`, 'core.engine.013', { p1: count })
  }
  return count
}

/**
 * **记下"玩家第一次进实验室页面"**（**2026-09-30 船长令**：「当玩家第一次进入实验室页面时，给玩家发送一封通讯，
 * 来源不能是官方…为玩家详细说明下信号发射器和突触加速剂」）。
 *
 * 为什么放在 core：这是**随档事实**（`state.labOpened`），通讯的触发种 `labOpened` 只认它；
 * 置位点收成一个函数，两个入口（旧工业页的实验室子页、工业 HUD 的实验室页签）都调它 ⇒ 口径只有一份。
 * 返回是否**这一次**真的置位（`false` = 早就进过）——调用方拿它决定要不要写盘，别让每帧都落一次盘。
 * 送达本身仍由 `advanceComms` 的幂等记账（`commsDelivered`）保证只发一次。
 */
export function noteLabOpened(state: GameState): boolean {
  if (state.labOpened === true) return false
  state.labOpened = true
  return true
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
    /** 该条目已练毫秒（通常仅同技能“队内首条”承接进度时有值） */
    progressMs: number
    /** 该级剩余毫秒 = levelMs − progressMs */
    remainingMs: number
    /**
     * **轮到这一条开练还要等多久**（毫秒）＝ 它前面所有条目（含队首本级剩余）剩余之和。
     * ⚠ 这是**口径**、不是界面各算一遍：2026-09-30 训练队列每行要显示"轮到还需 ≈X"，
     * 前缀和必须与总时长同源，否则两处数字会互相打架（`totalRemainingMs` 就是这条前缀和的末项）。
     */
    etaMs: number
  }>
  /** **全队列剩余合计**（含队首本级剩余）——界面的"队列总时长"只认这一个出处 */
  totalRemainingMs: number
}