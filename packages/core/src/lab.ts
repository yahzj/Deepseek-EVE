/**
 * **实验室**（**2026-09-29 船长令**：「为工业新增子页面：'实验室'。玩家可以在实验室生产燃料。
 * 实验室的生产卡片和其他工业卡片类似」）。
 *
 * ⚠ **2026-10-01 船长令：归「组装机型」**（原话：「**实验室本质上也是一个组装机，建议按照组装机的来。
 * 之后所有的新的生产，优先采用组装机的。除非是将原矿/冰/云转化为原材料这种一转多的情况。**」）——
 * 于是与 `manufacturing.ts`（组装机/造船厂）**同构**：
 * - **一条线 = 一批**：开工整批扣料 → 到点出一批 → **线即结束**（要连续跑 ⇒ 开**循环**）；
 * - **只吃物品仓库**（`removeWare`；**不碰货仓**——组装机同款；炉子那一族才「货仓优先」）；
 * - **退料账 `spentMaterials`**：停机/换线/取消时**按实际扣的那种退**（与组装机同一本账的语义）；
 * - **循环**：`state.labLoops[recipeId]`（卡片级：目标批数 / 缺料 / 产物封顶 ⇒ 自停并写停因）。
 *
 * 只在两处**刻意与炉子同款**（它们是"产线"的共性，不是组装机专有）：停靠门槛 `stationIndustryBlocked`、
 * 单批周期吃「产线节拍学」等技能乘区（见 `LAB_CYCLE_SKILLS` / `LAB_YIELD_SKILLS` 两张登记表）；
 * **解锁门槛**照旧 = **已建成空间站 ≥ 1 座**。
 *
 * 配方数据在 `packages/data/src/labRecipes.ts`（`ctx.labRecipes`）。
 */
import type { GameState, LabRunState } from './state'
import type { SimContext, LabRecipeDef, AiCoreType } from './types'
import type { CommandResult } from './engine'
import { addLog, haltActivityForSwitch, refundMaterialsToWarehouse, MAX_SKILL_LEVEL } from './state'
import { addWare, countWare, removeWare } from './inventory'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { addAiIncome, addAiLabBatch, type SettleStats } from './settleStats'
import { stationIndustryBlocked } from './location'
import { applyActivityGate, logAutoHalt } from './activityGate'
/** 燃料产物的封顶判据（`LAB_OUTPUT_CAP` 登记表用；**单向依赖**：实验室 → 燃料，反向没有） */
import { jumpFuelCapOf, jumpFuelWareOf } from './jumpFuel'
/** 已建成空间站座数 = 跃迁燃料链的解锁门槛（复用 `sideTasks` 的同名实现，不另写一份判据） */
import { builtStationCount } from './sideTasks'
/** 谜质科技的效果门（T5「解锁新的燃料配方」按 `requiresTech` 关键字判；见 `labRecipeUnlocked`） */
import { matterTechEffectActive } from './matterTech'

/** 实验室是否已解锁（**唯一判据**：已建成空间站 ≥ 1 座） */
export function labUnlocked(state: GameState, ctx: SimContext): boolean {
  return builtStationCount(state, ctx) >= 1
}

/**
 * **配方是否已解锁**（**2026-09-30 船长令**：「再添加一个 T5 是解锁新的燃料配方」）。
 *
 * 判据 = 配方声明的 `requiresTech` 效果关键字**至少点过一级**（走 `matterTechEffectActive`，
 * 也就是"按效果关键字汇总"的既有口径——**core 不认节点 id**，改节点名/挪层都不影响这里）。
 * **没声明 `requiresTech` 的配方恒开** ⇒ 老配方零变化。
 *
 * 消费点两处：`startLabRun` 的开工拒绝（`core.lab.019`）与工业页实验室卡片的"锁着"显示。
 */
export function labRecipeUnlocked(state: GameState, ctx: SimContext, recipe: LabRecipeDef): boolean {
  return recipe.requiresTech === undefined || matterTechEffectActive(state, ctx, recipe.requiresTech)
}

/**
 * **该配方要求的那条谜质科技的名字**（界面"锁着"提示用；无门槛/找不到 ⇒ `undefined`）。
 * 与 `labRecipeUnlocked` 同一判据来源（按 `requiresTech` 关键字找节点）⇒ 数据侧改节点名即热更，
 * 界面不写死任何节点名。
 */
export function labTechRequirementOf(ctx: SimContext, recipe: LabRecipeDef): string | undefined {
  if (recipe.requiresTech === undefined) return undefined
  for (const n of ctx.matterTech?.values() ?? []) if (n.effect === recipe.requiresTech) return n.name
  return undefined
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
  // 2026-09-30：第二张燃料配方（`jump-fuel-dense`）同属"燃料类" ⇒ 一并吃这两条燃料专精技能
  { id: 'fuel-catalytic-cracking', perLevel: 0.04, recipes: ['jump-fuel', 'jump-fuel-dense'] },
]

/**
 * **提高单批产出的技能**（乘算叠加）。原先实验室**完全不读技能**（`labBatchUnitsOf` 忽略等级）
 * ⇒ 产量类技能没有插口，本表就是那个插口。
 */
export const LAB_YIELD_SKILLS: readonly LabSkillRow[] = [
  { id: 'fuel-yield-engineering', perLevel: 0.06, recipes: ['jump-fuel', 'jump-fuel-dense'] },
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
 * **产物存量封顶登记表**（键 = **产物物品 id**）：产物现存达到上限 ⇒ **自动停线**（船长 2026-09-30 裁「甲」）。
 *
 * 为什么是登记表而不是写死在 `advanceLab` 里：实验室是"配方驱动"的通用产线，**不该认识燃料**；
 * 将来别的消耗品要封顶，在这里加一行即可（判据与日志 id 都跟着走）。
 *
 * ⚠ **键从"配方 id"改成"产物物品 id"**（2026-09-30）：T5 加了第二张燃料配方后，两张配方**同产物**
 * ⇒ 按配方 id 登记要写两行、日后加第三张还得再补一行（漏一行就是"这条线能越过上限"）。按产物登记
 * 则一条覆盖全部同产物配方（`jump-fuel` 那一行同时管 `jump-fuel` 与 `jump-fuel-dense`）。
 */
const LAB_OUTPUT_CAP: Readonly<Record<string, { readonly stockOf: (s: GameState) => number; readonly capOf: (s: GameState) => number }>> = {
  'jump-fuel': { stockOf: jumpFuelWareOf, capOf: jumpFuelCapOf },
}

/** 本配方的产物是否**已放不下下一批**（没登记封顶的配方恒为 false） */
export function labOutputCapped(state: GameState, recipe: LabRecipeDef): boolean {
  const cap = LAB_OUTPUT_CAP[recipe.outputItemId]
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
  const cap = LAB_OUTPUT_CAP[recipe.outputItemId]
  if (!cap) return undefined
  return { stock: cap.stockOf(state), cap: cap.capOf(state) }
}

/**
 * 某材料的可用量（**物品仓库**；**2026-10-01 起与组装机同款：只吃物品仓库、不吃货仓**）。
 *
 * 为什么改：船长 2026-10-01 裁「实验室本质上也是一个组装机，建议按照组装机的来」——
 * 组装机开工是 `removeWare`（只仓库），而实验室原先跟炉子那一套「货仓优先 → 仓库」
 * ⇒ 玩家的**船上货舱**会被站内实验线悄悄吃掉（"材料被占用"那类报障最可能的来源）。
 * 生产要用的料请先在物品页「全部卸入仓库」。
 */
export function labMaterialAvailable(state: GameState, itemId: string): number {
  return countWare(state, itemId)
}

/**
 * **扣本批的材料**（整批 BOM · 只吃物品仓库）：扣不动就**整体回滚**并返回 null（绝不留半扣）。
 * 实验室配方**没有等价组、也不吃"材料学"折扣**（那两条是组装机的乘区，见 `manufacturing.ts`）
 * ⇒ 退回时按账退（`spentMaterials`）与按配方现算**逐字等值**，两条路都可以。
 */
function spendBatchMaterials(
  state: GameState,
  recipe: LabRecipeDef,
): { itemId: string; count: number }[] | null {
  const taken: { itemId: string; count: number }[] = []
  for (const m of recipe.materials) {
    const units = Math.max(1, Math.floor(m.units))
    if (!removeWare(state, m.itemId, units)) {
      for (const t of taken) addWare(state, t.itemId, t.count)
      return null
    }
    taken.push({ itemId: m.itemId, count: units })
  }
  return taken
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
  /** 本批剩余毫秒 */
  remainingMs: number
  /** 本批进度 0~100 */
  percent: number
  /** 按当前库存还能跑几批（**下一批**用；本批的料已扣走） */
  affordable: number
  /** 料尽（下一批跑不动）⇒ 界面把卡片标成待停 */
  starving: boolean
  /** 本卡「循环实验」开关（与组装机同款：同配方的线读到的是同一个开关） */
  loopOn: boolean
  /** 本卡循环目标批数（0/缺省 = 直到材料不足或产物封顶） */
  loopGoal: number
  /** 本卡本轮合计产出批数 */
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

/* ───────── 循环实验（**2026-10-01 船长令**：实验室按组装机那套 ⇒ 一线一批 ＋ 卡片级循环开关） ─────────
 * 与 `manufacturing.setManufacturingLoop` / `manufacturingLoopOf` **同构**（键换成配方 id），
 * 语义也照抄：从「关」到「开」= 开一轮新循环（合计与停因清零）；本来就开着时只改目标（不动已累计的合计）；
 * 关闭 = 在跑那批做完即停（玩家主动收手，不写停因）；卡片无需正在生产（先开开关、后开线同样生效）。
 */

/** 玩家指令：开/关某个配方的「循环实验」（目标批数 = 该配方全部线的合计） */
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

/** 卡片级循环配置的只读视图（界面显示用；缺省 = 未开启过 ⇒ 不循环、无目标、合计 0） */
export interface LabLoopView {
  on: boolean
  goal: number
  produced: number
  stopWhy: string
}

/** 取某配方的循环配置视图（界面/文案统一走这里，不要各自读 state） */
export function labLoopOf(state: GameState, recipeId: string | null): LabLoopView {
  const l = recipeId ? state.labLoops?.[recipeId] : undefined
  return {
    on: l?.on === true,
    goal: l?.goal && l.goal > 0 ? l.goal : 0,
    produced: l?.produced ?? 0,
    stopWhy: l?.stopWhy ?? '',
  }
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
  /**
   * **谜质科技门槛**（2026-09-30 船长令 · T5「解锁新的燃料配方」）：没研究到 ⇒ 拒绝开工。
   * 放在"材料够不够"之前：材料不足是临时状态，科技没点才是玩家真正要先解决的那件事。
   */
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
    /** 主控 = 手动工作位：与精炼炉/回收炉/拆解台/制造线共用**同一个名额**（统一判据 + 统一日志）
     *  ⚠ **2026-10-01**：门禁的档改成 `'lab'`（原先借 `'refine'`）——实验室自己也进了主控登记表，
     *  起线时按"实验室"这一项去判（两档同为"先警告再切"，行为不变；占位与文案从此对得上）。 */
    const gateSkip = applyActivityGate(state, 'lab')
    if (gateSkip) return gateSkip
    /**
     * **同一档再开一条 = 换线**（与 `startRefineRun` 的"换炉"同款）：门禁见到"同一项"一律放行
     * （`current === next`）⇒ 这一档要自己收口，保证 **pilot 至多 1 条手动线**这条不变量。
     *
     * ⚠ **2026-10-01 修**（接入活动栏同批）：原先固定停 `'lab'` 那一档、日志却写 `'refine'`
     * ——`'lab'` 档只摘实验线，日志于是报「已自动停止『亲自开炉』」（停的与报的不是同一条）。
     * 现在**按实际在跑的手动线**指名停机、分别记日志；清空手动工作位仍走 `'refine'` 那一档
     * （它同时摘精炼炉与实验线，含老档炉内预占料的退料）。
     */
    const pilotRefine = (state.refineRuns ?? []).some((r) => r.active && r.worker === 'pilot')
    const pilotLab = (state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')
    if (pilotRefine || pilotLab) {
      haltActivityForSwitch(state, 'refine')
      if (pilotRefine) logAutoHalt(state, 'refine')
      if (pilotLab) logAutoHalt(state, 'lab')
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
  /**
   * **开工整批扣料**（**2026-10-01 船长令**：实验室按组装机那套）——只吃物品仓库，扣不动就回滚并拒绝。
   * 上面那道 `labAffordableBatches` 已按同一把尺预检过；走到这里失败 = 库存竞态 ⇒ 照实报，不留半扣。
   */
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

/**
 * **停一条实验线**（手动停）：**退回本批已扣的料** ＋ AI 核心归还。
 * `ctx` 只占位（与 `stopRefineRun` 同签名，便于界面统一调用）——退料读的是线自己的账
 * `LabRunState.spentMaterials`（与组装机同一本账的语义），**不需要 ctx**。
 */
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

/**
 * **推进实验室**（引擎每拍调一次；与 `advanceRefining` / `advanceManufacturing` 并列）。
 *
 * **一条线 = 一批**（2026-10-01 船长令：按组装机那套）：到点 ⇒ 产物入物品仓库 ⇒ **线即结束**；
 * 只有**本配方的循环开关开着**时才续做下一批（续做那一刻**再扣下一批的料**，缺料/封顶/达标则自停并写停因）。
 * 料在这条线开工时已整批扣走 ⇒ 停机退料读的是线自己的账（`stopLabRun` / `haltActivityForSwitch`）。
 *
 * `stats` = 离线结算统计器（AI 核心驱动的批数与估收入进离线简报；主控亲自那条不计——与另两条产线同口径）。
 *
 * ⚠ **大跨步要一口气推完**（离线结算 / 调试快进都是一次 `advanceGame` 跨几小时）⇒ `while` ＋ 保护上限，
 * 与另两条产线同款。
 */
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

      /** ── ① 结算这一批 ── */
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

      /** ── ② 循环判定（开关关着 ⇒ 一批一线，到此结束） ── */
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
      else if (labOutputCapped(state, recipe)) {
        const capped = labOutputStockOf(state, recipe)
        stopWhy = `${outName} 的仓库余量放不下下一批（${(capped?.stock ?? 0).toLocaleString('zh-CN')} / ${(capped?.cap ?? 0).toLocaleString('zh-CN')} 单位）`
      } else if (labAffordableBatches(state, recipe) <= 0) {
        const missing = labMissingMaterials(state, ctx, recipe)
        stopWhy = `材料不足（缺 ${missing.map((m) => m.name).join('、')}）`
      }
      if (stopWhy === '') {
        /** ── ③ 续做下一批：**即时扣料 ＋ 按当前技能重算周期**（与组装机续做同款） ── */
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
      /** ── ④ 自停：关开关 ＋ 写停因 ＋ 一条日志（与组装机的"卡片级停线"同款） ── */
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

/** AI 核心驱动的线 ⇒ 归还核心（主控那条不动；收成一处，免得每条出口各写一遍） */
function releaseAiCoreIfCore(state: GameState, r: LabRunState): void {
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
}
