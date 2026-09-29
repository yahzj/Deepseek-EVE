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
import { addLog, haltActivityForSwitch } from './state'
import { addWare, countItem, countWare, removeItem, removeWare } from './inventory'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { stationIndustryBlocked } from './location'
import { applyActivityGate, logAutoHalt } from './activityGate'
/** 已建成空间站座数 = 跃迁燃料链的解锁门槛（复用 `sideTasks` 的同名实现，不另写一份判据） */
import { builtStationCount } from './sideTasks'

/** 实验室是否已解锁（**唯一判据**：已建成空间站 ≥ 1 座） */
export function labUnlocked(state: GameState, ctx: SimContext): boolean {
  return builtStationCount(state, ctx) >= 1
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

/** 单批周期（毫秒，已按 AI 核心效率与产线节拍学折算） */
function labCycleMsOf(state: GameState, ctx: SimContext, recipe: LabRecipeDef, worker: 'pilot' | AiCoreType): number {
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  let ms = Math.max(1, Math.round(recipe.cycleMs / eff))
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) ms = Math.max(1, Math.round(ms * Math.max(0, 1 - 0.05 * autoLv)))
  return ms
}

/** 单批产物单位（基准值原样；实验室不吃炉膛那几条技能，见文件头注） */
function labBatchUnitsOf(recipe: LabRecipeDef): number {
  return Math.max(1, Math.floor(recipe.outputUnits))
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
    batchUnits: labBatchUnitsOf(recipe),
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
