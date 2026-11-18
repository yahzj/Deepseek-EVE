import { ceilFinalQuantity } from './quantity'
import type { GameState, LabRunState } from './state'
import type { SimContext, LabRecipeDef, AiCoreType } from './types'
import type { CommandResult } from './engine'
import { addLog, haltActivityForSwitch, refundMaterialsToWarehouse, MAX_SKILL_LEVEL } from './state'
import { addWare, countWare, removeWare } from './inventory'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { addAiIncome, addAiLabBatch, type SettleStats } from './settleStats'
import { stationIndustryBlocked, stationActivityStartBlockReason } from './location'
import { queueStationActivity } from './stationActivityPending'
import { applyActivityGate, logAutoHalt } from './activityGate'
import { jumpFuelCapOf, jumpFuelWareOf } from './jumpFuel'
import { builtStationCount } from './sideTasks'
import { matterTechEffectActive } from './matterTech'

export function labUnlocked(state: GameState, ctx: SimContext): boolean {
  return builtStationCount(state, ctx) >= 1
}

export function labRecipeUnlocked(state: GameState, ctx: SimContext, recipe: LabRecipeDef): boolean {
  return recipe.requiresTech === undefined || matterTechEffectActive(state, ctx, recipe.requiresTech)
}

export function labTechRequirementOf(ctx: SimContext, recipe: LabRecipeDef): string | undefined {
  if (recipe.requiresTech === undefined) return undefined
  for (const n of ctx.matterTech?.values() ?? []) if (n.effect === recipe.requiresTech) return n.name
  return undefined
}


export interface LabSkillRow {
  readonly id: string
  readonly perLevel: number
  readonly recipes?: readonly string[]
}

export const LAB_CYCLE_SKILLS: readonly LabSkillRow[] = [
  { id: 'industrial-automation', perLevel: 0.05 },
  { id: 'fuel-catalytic-cracking', perLevel: 0.04, recipes: ['jump-fuel', 'jump-fuel-dense'] },
]

export const LAB_YIELD_SKILLS: readonly LabSkillRow[] = [
  { id: 'fuel-yield-engineering', perLevel: 0.06, recipes: ['jump-fuel', 'jump-fuel-dense'] },
]

function labSkillApplies(row: LabSkillRow, recipe: LabRecipeDef): boolean {
  return row.recipes === undefined || row.recipes.includes(recipe.id)
}

function labSkillLevel(state: GameState, id: string): number {
  return Math.max(0, Math.min(MAX_SKILL_LEVEL, state.skills.trained[id] ?? 0))
}

function labCycleMulOf(state: GameState, recipe: LabRecipeDef): number {
  let mul = 1
  for (const row of LAB_CYCLE_SKILLS) {
    if (!labSkillApplies(row, recipe)) continue
    const lv = labSkillLevel(state, row.id)
    if (lv > 0) mul *= Math.max(0, 1 - row.perLevel * lv)
  }
  return mul
}

function labYieldMulOf(state: GameState, recipe: LabRecipeDef): number {
  let mul = 1
  for (const row of LAB_YIELD_SKILLS) {
    if (!labSkillApplies(row, recipe)) continue
    const lv = labSkillLevel(state, row.id)
    if (lv > 0) mul *= 1 + row.perLevel * lv
  }
  return mul
}

const LAB_OUTPUT_CAP: Readonly<Record<string, { readonly stockOf: (s: GameState) => number; readonly capOf: (s: GameState) => number }>> = {
  'jump-fuel': { stockOf: jumpFuelWareOf, capOf: jumpFuelCapOf },
}

export function labOutputCapped(state: GameState, recipe: LabRecipeDef, ctx: SimContext, excludeRun?: LabRunState): boolean {
  const cap = LAB_OUTPUT_CAP[recipe.outputItemId]
  if (!cap) return false
  const reserved = (state.labRuns ?? []).reduce((sum, run) => {
    if (!run.active || run === excludeRun || ctx.labRecipes.get(run.recipeId)?.outputItemId !== recipe.outputItemId) return sum
    return sum + run.batchUnits
  }, 0)
  return cap.stockOf(state) + reserved + labBatchUnitsOf(state, recipe) > cap.capOf(state)
}

export function labOutputStockOf(state: GameState, recipe: LabRecipeDef): { stock: number; cap: number } | undefined {
  const cap = LAB_OUTPUT_CAP[recipe.outputItemId]
  if (!cap) return undefined
  return { stock: cap.stockOf(state), cap: cap.capOf(state) }
}

export function labMaterialAvailable(state: GameState, itemId: string): number {
  return countWare(state, itemId)
}

function spendBatchMaterials(
  state: GameState,
  recipe: LabRecipeDef,
): { itemId: string; count: number }[] | null {
  const taken: { itemId: string; count: number }[] = []
  for (const m of recipe.materials) {
    const units = Math.max(1, ceilFinalQuantity(m.units))
    if (!removeWare(state, m.itemId, units)) {
      for (const t of taken) addWare(state, t.itemId, t.count)
      return null
    }
    taken.push({ itemId: m.itemId, count: units })
  }
  return taken
}

export function labAffordableBatches(state: GameState, recipe: LabRecipeDef): number {
  if (recipe.materials.length === 0) return 0
  let min = Number.POSITIVE_INFINITY
  for (const m of recipe.materials) {
    const per = Math.max(1, ceilFinalQuantity(m.units))
    min = Math.min(min, Math.floor(labMaterialAvailable(state, m.itemId) / per))
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0
}

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

export function labCycleMsOf(state: GameState, ctx: SimContext, recipe: LabRecipeDef, worker: 'pilot' | AiCoreType): number {
  if (state.debugQuick) return 1000
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  const ms = Math.max(1, Math.round(recipe.cycleMs / eff))
  return Math.max(1, Math.round(ms * labCycleMulOf(state, recipe)))
}

export function labBatchUnitsOf(state: GameState, recipe: LabRecipeDef): number {
  return Math.max(1, ceilFinalQuantity(recipe.outputUnits * labYieldMulOf(state, recipe)))
}

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

export interface LabRunView {
  id: number
  recipeId: string
  recipeName: string
  outputItemId: string
  outputName: string
  worker: 'pilot' | AiCoreType
  batchUnits: number
  cycleMs: number
  remainingMs: number
  percent: number
  affordable: number
  starving: boolean
  loopOn: boolean
  loopGoal: number
  loopProduced: number
}

export function labRunViews(state: GameState, ctx: SimContext): LabRunView[] {
  const rows: LabRunView[] = []
  for (const r of state.labRuns ?? []) {
    if (!r.active) continue
    const recipe = ctx.labRecipes.get(r.recipeId)
    if (!recipe) continue
    const remainingMs = Math.max(0, r.finishAtGameMs - state.gameMs)
    const loop = labLoopOf(state, r.recipeId)
    rows.push({
      id: r.id,
      recipeId: r.recipeId,
      recipeName: recipe.name,
      outputItemId: recipe.outputItemId,
      outputName: ctx.items.get(recipe.outputItemId)?.name ?? recipe.outputItemId,
      worker: r.worker,
      batchUnits: r.batchUnits,
      cycleMs: r.cycleMs,
      remainingMs,
      percent: r.cycleMs > 0 ? Math.min(100, Math.max(0, Math.round(((r.cycleMs - remainingMs) / r.cycleMs) * 100))) : 0,
      affordable: labAffordableBatches(state, recipe),
      starving: labAffordableBatches(state, recipe) <= 0,
      loopOn: loop.on,
      loopGoal: loop.goal,
      loopProduced: loop.produced,
    })
  }
  return rows
}


export function setLabLoop(state: GameState, recipeId: string, on: boolean, goal?: number | null): CommandResult {
  if (typeof recipeId !== 'string' || recipeId.length === 0) {
    return { ok: false, error: '没有找到这张配方卡（记录缺失）。', errorId: 'core.lab.020' }
  }
  const g = Number.isFinite(goal) ? Math.floor(goal ?? 0) : 0
  const prev = (state.labLoops ??= {})[recipeId]
  if (on) {
    const already = prev?.on === true
    state.labLoops[recipeId] = {
      on: true,
      goal: g > 0 ? g : undefined,
      produced: already ? (prev?.produced ?? 0) : 0,
      stopWhy: already ? prev?.stopWhy : undefined,
    }
  } else {
    state.labLoops[recipeId] = {
      on: false,
      goal: g > 0 ? g : prev?.goal && prev.goal > 0 ? prev.goal : undefined,
      produced: prev?.produced ?? 0,
      stopWhy: undefined,
    }
  }
  return { ok: true }
}

export interface LabLoopView {
  on: boolean
  goal: number
  produced: number
  stopWhy: string
}

export function labLoopOf(state: GameState, recipeId: string | null): LabLoopView {
  const l = recipeId ? state.labLoops?.[recipeId] : undefined
  return {
    on: l?.on === true,
    goal: l?.goal && l.goal > 0 ? l.goal : 0,
    produced: l?.produced ?? 0,
    stopWhy: l?.stopWhy ?? '',
  }
}

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
  if (!labRecipeUnlocked(state, ctx, recipe)) {
    return {
      ok: false,
      error: `「${recipe.name}」需要先在扫描虫洞的谜质科技里研究对应科技。`,
      errorId: 'core.lab.019',
      errorParams: { p1: recipe.name },
    }
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
  const capped = labOutputStockOf(state, recipe)
  const replaced = worker === 'pilot' ? state.labRuns?.find(run => run.active && run.worker === 'pilot') : undefined
  if (labOutputCapped(state, recipe, ctx, replaced)) {
    return {
      ok: false,
      error: `${recipe.name} 的仓库余量放不下下一批（${(capped?.stock ?? 0).toLocaleString('zh-CN')} / ${(capped?.cap ?? 0).toLocaleString('zh-CN')} 单位）：先消耗或卖出再开工。`,
      errorId: 'core.lab.018',
      errorParams: {
        p1: recipe.name,
        p2: (capped?.stock ?? 0).toLocaleString('zh-CN'),
        p3: (capped?.cap ?? 0).toLocaleString('zh-CN'),
      },
    }
  }
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'lab')
    if (dockBlock) return { ok: false, ...dockBlock }
    const queued = queueStationActivity(state, ctx, { kind: 'lab', recipeId })
    if (queued) return queued
    const gateSkip = applyActivityGate(state, 'lab', ctx)
    if (gateSkip) return gateSkip
    const pilotRefine = (state.refineRuns ?? []).some((r) => r.active && r.worker === 'pilot')
    const pilotLab = (state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')
    if (pilotRefine || pilotLab) {
      haltActivityForSwitch(state, 'refine')
      if (pilotRefine) logAutoHalt(state, 'refine')
      if (pilotLab) logAutoHalt(state, 'lab')
    }
  } else {
    const capBlock = aiCoreCapBlock(state, ctx, 'industry')
    if (capBlock) return { ok: false, error: capBlock.error, errorId: capBlock.errorId, errorParams: capBlock.errorParams }
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
  const spentMaterials = spendBatchMaterials(state, recipe)
  if (spentMaterials === null) {
    const missing = labMissingMaterials(state, ctx, recipe)
    const need = missing.map((m) => `${m.name} ${m.have}/${m.need}`).join('、')
    return { ok: false, error: `材料不足一批：${need}。`, errorId: 'core.lab.012', errorParams: { p1: need } }
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
    spentMaterials,
  })
  state.labSeq = (state.labSeq ?? 1) + 1
  return { ok: true }
}

export function stopLabRun(state: GameState, ctx: SimContext, runId: number): CommandResult {
  void ctx
  const runs = state.labRuns ?? []
  const idx = runs.findIndex((r) => r.id === runId)
  if (idx < 0) return { ok: false, error: '这条实验线已经停了。', errorId: 'core.lab.015' }
  const r = runs[idx]!
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
  refundMaterialsToWarehouse(state, r.spentMaterials ?? [])
  const recipe = r.recipeId
  const refunded = (r.spentMaterials ?? []).length > 0
  runs.splice(idx, 1)
  addLog(
    state,
    'industry',
    refunded
      ? `实验室停线：${recipe} 本批的料已退回物品仓库${r.worker === 'pilot' ? '。' : '；AI 核心已归还核心库。'}`
      : `实验室停线：${recipe}（本批没有已扣的料）${r.worker === 'pilot' ? '。' : '；AI 核心已归还核心库。'}`,
    refunded ? 'core.lab.021' : 'core.lab.022',
    { p1: recipe },
  )
  return { ok: true }
}

export function advanceLab(state: GameState, ctx: SimContext, stats?: SettleStats): void {
  const runs = state.labRuns
  if (!runs || runs.length === 0) return
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (!r.active) {
      releaseAiCoreIfCore(state, r)
      refundMaterialsToWarehouse(state, r.spentMaterials ?? [])
      runs.splice(i, 1)
      continue
    }
    const recipe = ctx.labRecipes.get(r.recipeId)
    if (!recipe) {
      releaseAiCoreIfCore(state, r)
      refundMaterialsToWarehouse(state, r.spentMaterials ?? [])
      runs.splice(i, 1)
      addLog(state, 'industry', '实验室运转异常：配方记录缺失，该线已停（本批材料已退回，AI 核心已归还）。', 'core.lab.016')
      continue
    }
    if (state.gameMs < r.finishAtGameMs) continue
    let guard = 0
    while (r.active && state.gameMs >= r.finishAtGameMs) {
      if (++guard > 100_000) break

      const cap = LAB_OUTPUT_CAP[recipe.outputItemId]
      if (cap && cap.stockOf(state) + r.batchUnits > cap.capOf(state)) {
        r.deliveryBlocked = true
        break
      }
      if (r.deliveryBlocked) {
        r.finishAtGameMs = state.gameMs
        delete r.deliveryBlocked
      }
      addWare(state, recipe.outputItemId, r.batchUnits)
      r.spentMaterials = []
      const outName = ctx.items.get(recipe.outputItemId)?.name ?? recipe.outputItemId
      addLog(
        state,
        'industry',
        `实验室出料：${recipe.name} ×${r.batchUnits.toLocaleString('zh-CN')} ${outName} 已放入物品仓库。`,
        'core.lab.023',
        { p1: recipe.name, p2: r.batchUnits.toLocaleString('zh-CN'), p3: outName },
      )
      if (r.worker !== 'pilot') {
        addAiLabBatch(stats, r.worker)
        addAiIncome(stats, r.worker, r.batchUnits * (ctx.items.get(recipe.outputItemId)?.baseSellPriceIsk ?? 0))
      }

      const loop = state.labLoops?.[r.recipeId]
      if (loop?.on !== true) {
        releaseAiCoreIfCore(state, r)
        runs.splice(i, 1)
        break
      }
      loop.produced = (loop.produced ?? 0) + 1
      const goal = loop.goal && loop.goal > 0 ? loop.goal : null
      let stopWhy = ''
      if (goal !== null && loop.produced >= goal) stopWhy = `已达成目标 ${goal} 批`
      else if (labOutputCapped(state, recipe, ctx, r)) {
        const capped = labOutputStockOf(state, recipe)
        stopWhy = `${outName} 的仓库余量放不下下一批（${(capped?.stock ?? 0).toLocaleString('zh-CN')} / ${(capped?.cap ?? 0).toLocaleString('zh-CN')} 单位）`
      } else if (labAffordableBatches(state, recipe) <= 0) {
        const missing = labMissingMaterials(state, ctx, recipe)
        stopWhy = `材料不足（缺 ${missing.map((m) => m.name).join('、')}）`
      }
      if (stopWhy === '') {
        const next = spendBatchMaterials(state, recipe)
        if (next === null) stopWhy = '材料不足（扣料失败）'
        else {
          r.spentMaterials = next
          r.batchUnits = labBatchUnitsOf(state, recipe)
          r.cycleMs = labCycleMsOf(state, ctx, recipe, r.worker)
          r.finishAtGameMs += r.cycleMs
          continue
        }
      }
      loop.on = false
      loop.stopWhy = stopWhy
      releaseAiCoreIfCore(state, r)
      runs.splice(i, 1)
      addLog(
        state,
        'industry',
        `循环实验停止：${recipe.name}——${stopWhy}（本配方合计 ${loop.produced} 批）${r.worker === 'pilot' ? '。' : '；AI 核心已归还核心库。'}`,
        'core.lab.024',
        { p1: recipe.name, p2: stopWhy, p3: loop.produced },
      )
      break
    }
  }
}

function releaseAiCoreIfCore(state: GameState, r: LabRunState): void {
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
}
