/**
 * **实验室**（**2026-09-29 船长令**：「为工业新增子页面：'实验室'。玩家可以在实验室生产燃料。
 * 实验室的生产卡片和其他工业卡片类似」）。
 *
 * 与精炼炉（`industry.ts`）的分工：**精炼炉 = 单资源按批扣料**；**实验室 = 一张配方表的 BOM 一括投料**。
 * 相同的地方刻意做成同一口径，免得玩家学两套：
 * - **多工位并行**（`state.labRuns` 数组，台号 `state.labSeq` 稳定分配）；
 * - **劳动者**：`'pilot'`（主控亲自运转，全局限 1 台、与精炼炉共用"手动工作位"那一个名额）
 *   或 AI 核心类型（占核心、效率折算、停线归还）；
 * - **停靠门槛**：随协会基地网络运转（`stationIndustryBlocked`；AI 核心驱动不受此限）；
 * - **料尽自停**：每批到点若**任一**材料不足一批 ⇒ 停线并留日志（余料留在货仓/仓库）。
 *
 * 只在两处**刻意不同**：
 * 1. **技能**：吃**产线节拍学**（`industrial-automation`，每级 −5% 周期，与精炼炉同一条通用产线技能）；
 *    **不吃**「炉膛扩容学 / 炉膛倍增学 / 炉心熔炼学 / 炉温精调学」——那四条是**炉子**的技能，
 *    实验室不是炉子（要放开是另一条令）；
 * 2. **解锁门槛**：**已建成空间站 ≥ 1 座**（船长令：「需要玩家建设第一个空间站后才解锁相关内容」）
 *    —— 缺省（首座站未建成）时本页不渲染、动作也全部拒绝。
 *
 * 配方数据在 `packages/data/src/labRecipes.ts`（`ctx.labRecipes`）；第一版只有「超空间折跃燃料」一张。
 */
import type { GameState, LabRunState } from './state'
import type { SimContext, LabRecipeDef, AiCoreType } from './types'
import type { CommandResult } from './engine'
import { addLog, haltActivityForSwitch, MAX_SKILL_LEVEL } from './state'
import { addWare, countItem, countWare, removeItem, removeWare } from './inventory'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { stationIndustryBlocked } from './location'
import { applyActivityGate, logAutoHalt } from './activityGate'
/** 燃料产物的封顶判据（`LAB_OUTPUT_CAP` 登记表用；**单向依赖**：实验室 → 燃料，反向没有） */
import { jumpFuelCapOf, jumpFuelWareOf } from './jumpFuel'
/** 已建成空间站座数 = 跃迁燃料链的解锁门槛（复用 `sideTasks` 的同名实现，不另写一份判据） */
import { builtStationCount } from './sideTasks'

/** 实验室是否已解锁（**唯一判据**：已建成空间站 ≥ 1 座） */
export function labUnlocked(state: GameState, ctx: SimContext): boolean {
  return builtStationCount(state, ctx) >= 1
}

/* ───────── 实验室技能乘区（**2026-09-30 船长问「新功能是否模块化？降低耦合」的落法**） ───────── */

/**
 * **一条实验室技能乘区**。`recipes` 缺省 = **全实验室**（所有配方都吃）；填了 = **只对这些配方生效**
 * （船长 2026-09-30：「燃料合成节拍学叫燃料了，自然只对燃料生效」）。
 */
export interface LabSkillRow {
  readonly id: string
  /** 每级值（周期类按"缩短比例"，产出类按"提高比例"） */
  readonly perLevel: number
  /** 作用域：配方 id 列表；缺省 = 全实验室 */
  readonly recipes?: readonly string[]
}

/**
 * **缩短实验周期的技能**（乘算叠加）。加技能 = 这里加一行 ⇒ 引擎与界面自动生效，**不再写死技能 id**。
 *
 * - `industrial-automation` 产线节拍学：**全实验室**（它原本就管精炼炉与组装机；实验室在 2026-09-29
 *   落地时就吃了它，说明漏写「实验室」，本批补文案——见工作文档的 ⟪文案调整⟫ 台账）；
 * - `fuel-catalytic-cracking` 催化裂解学：**只对燃料配方**（船长令）。
 */
export const LAB_CYCLE_SKILLS: readonly LabSkillRow[] = [
  { id: 'industrial-automation', perLevel: 0.05 },
  { id: 'fuel-catalytic-cracking', perLevel: 0.04, recipes: ['jump-fuel'] },
]

/**
 * **提高单批产出的技能**（乘算叠加）。原先实验室**完全不读技能**（`labBatchUnitsOf` 忽略等级）
 * ⇒ 产量类技能没有插口，本表就是那个插口。
 */
export const LAB_YIELD_SKILLS: readonly LabSkillRow[] = [
  { id: 'fuel-yield-engineering', perLevel: 0.06, recipes: ['jump-fuel'] },
]

/** 某条技能行对某个配方是否生效（作用域判据的单点） */
function labSkillApplies(row: LabSkillRow, recipe: LabRecipeDef): boolean {
  return row.recipes === undefined || row.recipes.includes(recipe.id)
}

/** 某条技能行的等级（夹在 0~`MAX_SKILL_LEVEL`） */
function labSkillLevel(state: GameState, id: string): number {
  return Math.max(0, Math.min(MAX_SKILL_LEVEL, state.skills.trained[id] ?? 0))
}

/** 周期乘区（≤1；`Π(1 − perLevel × 等级)`） */
function labCycleMulOf(state: GameState, recipe: LabRecipeDef): number {
  let mul = 1
  for (const row of LAB_CYCLE_SKILLS) {
    if (!labSkillApplies(row, recipe)) continue
    const lv = labSkillLevel(state, row.id)
    if (lv > 0) mul *= Math.max(0, 1 - row.perLevel * lv)
  }
  return mul
}

/** 产出乘区（≥1；`Π(1 + perLevel × 等级)`） */
function labYieldMulOf(state: GameState, recipe: LabRecipeDef): number {
  let mul = 1
  for (const row of LAB_YIELD_SKILLS) {
    if (!labSkillApplies(row, recipe)) continue
    const lv = labSkillLevel(state, row.id)
    if (lv > 0) mul *= 1 + row.perLevel * lv
  }
  return mul
}

/**
 * **产物存量封顶登记表**（键 = 配方 id）：产物现存达到上限 ⇒ **自动停线**（船长 2026-09-30 裁「甲」）。
 *
 * 为什么是登记表而不是写死在 `advanceLab` 里：实验室是"配方驱动"的通用产线，**不该认识燃料**；
 * 将来别的消耗品要封顶，在这里加一行即可（判据与日志 id 都跟着走）。
 */
const LAB_OUTPUT_CAP: Readonly<Record<string, { readonly stockOf: (s: GameState) => number; readonly capOf: (s: GameState) => number }>> = {
  'jump-fuel': { stockOf: jumpFuelWareOf, capOf: jumpFuelCapOf },
}

/** 本配方的产物是否**已放不下下一批**（没登记封顶的配方恒为 false） */
export function labOutputCapped(state: GameState, recipe: LabRecipeDef): boolean {
  const cap = LAB_OUTPUT_CAP[recipe.id]
  if (!cap) return false
  /**
   * 判据 = **下一批放不下**（而不是"现有量已经 ≥ 上限"）——这样仓库**永远不会越过上限**
   * （船长报障原话是「燃料生产并不受上限的影响」，越限一批仍算不受影响）；
   * 存量恰好等于上限时也判"满"（`+batch > cap`）。
   */
  return cap.stockOf(state) + labBatchUnitsOf(state, recipe) > cap.capOf(state)
}

/** 本配方产物的现有量 / 上限（界面读数用；没登记封顶的配方返回 undefined） */
export function labOutputStockOf(state: GameState, recipe: LabRecipeDef): { stock: number; cap: number } | undefined {
  const cap = LAB_OUTPUT_CAP[recipe.id]
  if (!cap) return undefined
  return { stock: cap.stockOf(state), cap: cap.capOf(state) }
}

/** 某材料的可用量（货仓 ＋ 物品仓库；与精炼炉 `oreAvailable` 同一把尺） */
export function labMaterialAvailable(state: GameState, itemId: string): number {
  return countItem(state, itemId) + countWare(state, itemId)
}

/** 扣取某材料（**货仓优先**，与精炼炉的取料口径一致） */
function takeMaterial(state: GameState, itemId: string, units: number): void {
  let left = Math.max(0, Math.floor(units))
  const inCargo = Math.min(left, countItem(state, itemId))
  if (inCargo > 0) {
    removeItem(state, itemId, inCargo)
    left -= inCargo
  }
  if (left > 0) removeWare(state, itemId, left)
}

/** 当前材料够跑几批（取各材料的下限；`Infinity` 不可能出现——空材料表 ⇒ 0） */
export function labAffordableBatches(state: GameState, recipe: LabRecipeDef): number {
  if (recipe.materials.length === 0) return 0
  let min = Number.POSITIVE_INFINITY
  for (const m of recipe.materials) {
    const per = Math.max(1, Math.floor(m.units))
    min = Math.min(min, Math.floor(labMaterialAvailable(state, m.itemId) / per))
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0
}

/** 缺哪几样料（界面提示用；空表 = 料齐） */
export function labMissingMaterials(
  state: GameState,
  ctx: SimContext,
  recipe: LabRecipeDef,
): Array<{ itemId: string; name: string; need: number; have: number }> {
  const out: Array<{ itemId: string; name: string; need: number; have: number }> = []
  for (const m of recipe.materials) {
    const have = labMaterialAvailable(state, m.itemId)
    if (have < m.units) {
      out.push({ itemId: m.itemId, name: ctx.items.get(m.itemId)?.name ?? m.itemId, need: m.units, have })
    }
  }
  return out
}

/** 单批周期（毫秒，已按 AI 核心效率与 `LAB_CYCLE_SKILLS` 的乘区折算）
 *  ⚠ **2026-09-30 船长令**：「实验室的生产能被调试开启缩短到 1 秒」——`debugQuick`（调试面板「1 秒化」）
 *  的既有触点原本漏了实验室（mining/travel/ai/salvaging/expedition/manufacturing/explore/wormholeScan/
 *  training 都有，lab 没有）⇒ 这里补上，口径与其它产线一致：调试下一批 1 秒。 */
function labCycleMsOf(state: GameState, ctx: SimContext, recipe: LabRecipeDef, worker: 'pilot' | AiCoreType): number {
  if (state.debugQuick) return 1000
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  const ms = Math.max(1, Math.round(recipe.cycleMs / eff))
  return Math.max(1, Math.round(ms * labCycleMulOf(state, recipe)))
}

/** 单批产物单位（基准值 × `LAB_YIELD_SKILLS` 乘区；向下取整到 1 单位） */
function labBatchUnitsOf(state: GameState, recipe: LabRecipeDef): number {
  return Math.max(1, Math.floor(recipe.outputUnits * labYieldMulOf(state, recipe)))
}

/**
 * **某配方当前的在产速率**（单位/时）= Σ 在跑的实验线「单批产出 × 3,600,000 ÷ 单批周期」。
 *
 * ⚠ 读的是**产线自己存下来的** `batchUnits` / `cycleMs`（起线那一刻按当时技能与劳动者算好的），
 * **不重算**——否则读数会与引擎真正在跑的节奏对不上（技能中途升级时也如此，口径 = 实际在产的节奏）。
 */
export function labOutputPerHourOf(state: GameState, ctx: SimContext, recipeId?: string): number {
  let perHour = 0
  for (const r of state.labRuns ?? []) {
    if (!r.active) continue
    if (recipeId !== undefined && r.recipeId !== recipeId) continue
    if (!ctx.labRecipes.has(r.recipeId)) continue
    if (r.cycleMs <= 0) continue
    perHour += (r.batchUnits * 3_600_000) / r.cycleMs
  }
  return Math.round(perHour)
}

/** 实验线视图（工业页「实验室」卡片读它） */
export interface LabRunView {
  id: number
  recipeId: string
  recipeName: string
  outputItemId: string
  outputName: string
  worker: 'pilot' | AiCoreType
  batchUnits: number
  cycleMs: number
  batchesDone: number
  /** 本批剩余毫秒 */
  remainingMs: number
  /** 本批进度 0~100 */
  percent: number
  /** 按当前库存还能跑几批 */
  affordable: number
  /** 料尽（下一批跑不动）⇒ 界面把卡片标成待停 */
  starving: boolean
}

export function labRunViews(state: GameState, ctx: SimContext): LabRunView[] {
  const rows: LabRunView[] = []
  for (const r of state.labRuns ?? []) {
    if (!r.active) continue
    const recipe = ctx.labRecipes.get(r.recipeId)
    if (!recipe) continue
    const remainingMs = Math.max(0, r.finishAtGameMs - state.gameMs)
    rows.push({
      id: r.id,
      recipeId: r.recipeId,
      recipeName: recipe.name,
      outputItemId: recipe.outputItemId,
      outputName: ctx.items.get(recipe.outputItemId)?.name ?? recipe.outputItemId,
      worker: r.worker,
      batchUnits: r.batchUnits,
      cycleMs: r.cycleMs,
      batchesDone: r.batchesDone,
      remainingMs,
      percent: r.cycleMs > 0 ? Math.min(100, Math.max(0, Math.round(((r.cycleMs - remainingMs) / r.cycleMs) * 100))) : 0,
      affordable: labAffordableBatches(state, recipe),
      starving: labAffordableBatches(state, recipe) <= 0,
    })
  }
  return rows
}

/**
 * **起一条实验线**（工业页「实验室」卡片的开工动作）。
 *
 * 校验顺序（与精炼炉同款：**先判据后位置**——统一停机本身会把船带回空间站）：
 * ① 已解锁 ② 配方存在 ③ 材料够一批 ④ 劳动者名额（主控 = 手动工作位那一个名额 / AI 核心 = 工位上限）
 * ⑤ 停靠门槛。
 */
export function startLabRun(
  state: GameState,
  ctx: SimContext,
  recipeId: string,
  worker: 'pilot' | AiCoreType,
): CommandResult {
  if (!labUnlocked(state, ctx)) {
    return { ok: false, error: '实验室需在首座空间站建成后投入使用。', errorId: 'core.lab.010' }
  }
  const recipe = ctx.labRecipes.get(recipeId)
  if (!recipe) {
    return { ok: false, error: `未知实验室配方：${recipeId}。`, errorId: 'core.lab.011', errorParams: { p1: recipeId } }
  }
  if (labAffordableBatches(state, recipe) <= 0) {
    const missing = labMissingMaterials(state, ctx, recipe)
    const need = missing.map((m) => `${m.name} ${m.have}/${m.need}`).join('、')
    return {
      ok: false,
      error: `材料不足一批：${need}。`,
      errorId: 'core.lab.012',
      errorParams: { p1: need },
    }
  }
  /**
   * **放不下下一批 ⇒ 起线直接拒绝**（**2026-09-30 船长裁「甲」**：满仓时实验室自动停线；
   * 起线这一步同样要拦，否则"开一条立刻就停"的空转更费解）。上限判据走 `LAB_OUTPUT_CAP` 登记表。
   */
  const capped = labOutputStockOf(state, recipe)
  if (labOutputCapped(state, recipe)) {
    return {
      ok: false,
      error: `${recipe.name} 的仓库余量放不下下一批（${(capped?.stock ?? 0).toLocaleString('zh-CN')} / ${(capped?.cap ?? 0).toLocaleString('zh-CN')} 单位）：先消耗或卖出再开工。`,
      errorId: 'core.lab.018',
      /**
       * ⚠ **槽位必须与模板一一对应**（**2026-09-30 船长报障「提示里有错误的 {p3}」**）：
       * 模板是「{p1} 的仓库余量放不下下一批（{p2} / {p3} 单位）：…」⇒ p1 = **配方名**、p2 = 存量、p3 = 上限；
       * 原先只喂了 p1/p2（而且喂的是存量/上限）⇒ 玩家看到「5,400 的仓库余量…（6,000 / **{p3}** 单位）」。
       */
      errorParams: {
        p1: recipe.name,
        p2: (capped?.stock ?? 0).toLocaleString('zh-CN'),
        p3: (capped?.cap ?? 0).toLocaleString('zh-CN'),
      },
    }
  }
  if (worker === 'pilot') {
    /** 主控 = 手动工作位：与精炼炉/回收炉/拆解台/制造线共用**同一个名额**（统一判据 + 统一日志） */
    const gateSkip = applyActivityGate(state, 'refine')
    if (gateSkip) return gateSkip
    if ((state.refineRuns ?? []).some((r) => r.active && r.worker === 'pilot') || (state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) {
      haltActivityForSwitch(state, 'lab')
      logAutoHalt(state, 'refine')
    }
  } else {
    const capBlock = aiCoreCapBlock(state, ctx, 'industry')
    if (capBlock) return { ok: false, error: capBlock }
    if (countAiCore(state, worker) <= 0) {
      return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入实验室。`, errorId: 'core.lab.014', errorParams: { p1: aiCoreName(worker) } }
    }
  }
  if (stationIndustryBlocked(worker, state, ctx)) {
    return {
      ok: false,
      error: '实验室随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。',
      errorId: 'core.lab.013',
    }
  }
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。`, errorId: 'core.lab.014', errorParams: { p1: aiCoreName(worker) } }
  }
  const cycleMs = labCycleMsOf(state, ctx, recipe, worker)
  const runs = (state.labRuns ??= [])
  runs.push({
    active: true,
    id: (state.labSeq ??= 1),
    worker,
    recipeId,
    batchUnits: labBatchUnitsOf(state, recipe),
    cycleMs,
    finishAtGameMs: state.gameMs + cycleMs,
    batchesDone: 0,
  })
  state.labSeq = (state.labSeq ?? 1) + 1
  return { ok: true }
}

/** **停一条实验线**（手动停；AI 核心归还）。`ctx` 只占位（与 `stopRefineRun` 同签名，便于界面统一调用） */
export function stopLabRun(state: GameState, ctx: SimContext, runId: number): CommandResult {
  void ctx
  const runs = state.labRuns ?? []
  const idx = runs.findIndex((r) => r.id === runId)
  if (idx < 0) return { ok: false, error: '这条实验线已经停了。', errorId: 'core.lab.015' }
  const r = runs[idx]!
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
  const done = r.batchesDone
  const recipe = r.recipeId
  runs.splice(idx, 1)
  addLog(state, 'industry', `实验室停线（手动）：${recipe} 已完成 ${done} 批${r.worker === 'pilot' ? '' : '；AI 核心已归还核心库'}。`, 'core.lab.002', {
    p1: recipe,
    p2: done,
  })
  return { ok: true }
}

/**
 * **推进实验室**（引擎每拍调一次；与 `advanceRefining` 并列）。
 *
 * 每批到点：**一括扣齐 BOM** ⇒ 产物入物品仓库 ⇒ 批数 +1；**任一材料不足一批** ⇒ 停线
 * （余料留在货仓/仓库，日志写明已完成批数）。
 */
export function advanceLab(state: GameState, ctx: SimContext): void {
  const runs = state.labRuns
  if (!runs || runs.length === 0) return
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (!r.active) {
      runs.splice(i, 1)
      continue
    }
    const recipe = ctx.labRecipes.get(r.recipeId)
    if (!recipe) {
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      runs.splice(i, 1)
      addLog(state, 'industry', '实验室运转异常：配方记录缺失，该线已停（AI 核心已归还）。', 'core.lab.016')
      continue
    }
    let guard = 0
    while (r.active && state.gameMs >= r.finishAtGameMs) {
      if (++guard > 100_000) break
      /**
       * **产物到上限 ⇒ 停线**（**2026-09-30 船长裁「甲」**：与"料尽自停"同款，留一条日志）。
       * 判据来自 `LAB_OUTPUT_CAP` 登记表（燃料 = 物品仓库上限，见 `jumpFuel.ts`）。
       */
      if (labOutputCapped(state, recipe)) {
        const capped = labOutputStockOf(state, recipe)
        const done = r.batchesDone
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        runs.splice(i, 1)
        addLog(
          state,
          'industry',
          `实验室停线：${recipe.outputItemId} 的仓库余量放不下下一批（${(capped?.stock ?? 0).toLocaleString('zh-CN')} / ${(capped?.cap ?? 0).toLocaleString('zh-CN')} 单位；${recipe.name} 已完成 ${done} 批）${r.worker === 'pilot' ? '。' : '；AI 核心已归还核心库。'}`,
          'core.lab.017',
          {
            p1: recipe.name,
            p2: (capped?.stock ?? 0).toLocaleString('zh-CN'),
            p3: (capped?.cap ?? 0).toLocaleString('zh-CN'),
            p4: done,
          },
        )
        break
      }
      if (labAffordableBatches(state, recipe) <= 0) {
        const done = r.batchesDone
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        runs.splice(i, 1)
        addLog(
          state,
          'industry',
          `实验室停线：材料耗尽（${recipe.name} 已完成 ${done} 批，共 ${(done * r.batchUnits).toLocaleString('zh-CN')} 单位）${r.worker === 'pilot' ? '。' : '；AI 核心已归还核心库。'}`,
          'core.lab.001',
          { p1: recipe.name, p2: done, p3: (done * r.batchUnits).toLocaleString('zh-CN') },
        )
        break
      }
      for (const m of recipe.materials) takeMaterial(state, m.itemId, m.units)
      addWare(state, recipe.outputItemId, r.batchUnits)
      r.batchesDone += 1
      r.finishAtGameMs += r.cycleMs
    }
  }
}
