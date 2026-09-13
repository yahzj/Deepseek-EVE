/**
 * 蓝图制造（M2/M5/V9 限时批次；v21 多工位并行，产物：装备或舰船）。
 *
 * 模型（中文说明）：
 * - V9 起蓝图 = 消耗品书：市场买回后放进"蓝图书架"，学习一本 → 永久学会该配方
 *   （learnedRecipes）；重复蓝图书只能放回市场交易，不能无限复制；
 * - 每次开工：立即扣除全部材料，耗时受工业理论缩短（开工锁定）；
 * - 2026-09-08 船长定：取消每次制造费（buildCostIsk 保留为数据遗留字段，不再校验/收取）；
 * - 到点自动完成：装备入装备库 / 舰船入船坞；
 * - v21（2026-09-05 船长拍板）：多张蓝图可同时制造（manufacturingRuns 逐线独立进度/
 *   取消）；2026-09-08 起同一蓝图也可开多条线（与精炼炉多炉并线一致）；
 * - 2026-09-08（船长拍板：与精炼炉机制完全相同，仅处理层不同）：制造线与炉同款劳动者制——
 *   worker = 'pilot'（主控亲自制造：全局限 1 条、与手动精炼/回收共用一个手动工作位、
 *   占主控不可离港作业）或 AiCoreType（一枚 AI 核心驱动一条线：核心出库占用并计入
 *   「AI 核心上限」——同时启用总数受 AI 核心上限技能约束、与 AI 副船任务共用，
 *   完成/取消自动归还）；
 * - 耗时链同炉：主控线 = 工业理论 × 批量生产学（现有公式）；AI 线 = 基础耗时 ÷ 核心效率再乘
 *   产线节拍学（原"工业自动化"）−5%/级（下限 60%）。
 * - 2026-09-09（船长拍板：组装机卡片滑动开关「连续生产」）：运行中的线可开 autoRepeat——
 *   完成一件自动续做同一蓝图（劳动者/核心持续占用，相位推进可跨离线大 delta 连续结算），
 *   到 达目标件数 / 材料不足 自动停线并写汇总日志；开关关闭 = 完成当前件后停止。
 * - 2026-09-10（船长定：开关与目标件数**从逐条制造线上移到整张生产卡**）：一张卡（= 一个蓝图）
 *   只有一个开关、一个目标件数与一个「本轮全卡合计」计数，**该卡全部制造线共用**（含主控亲自那条），
 *   开关打开后新开的线自动继承（判定实时读卡片配置）；标记 = state.manufacturingLoops[blueprintId]。
 *   逐线旧字段（autoRepeat/repeatGoal/produced）停用，仅读老档时归并（见 save.ts）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState, ManufacturingRunState } from './state'
import type { AiCoreType, BlueprintDef, ShipBlueprintDef, SimContext } from './types'
import { addWare, countWare, removeWare } from './inventory'
import { addModule } from './equipment'
import { addShipToFleet } from './shipyard'
import { formatDurationMs } from './time'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { isAtHomeLike } from './location'
import { addAiIncome, addAiMakeDone, type SettleStats } from './settleStats'

/** 市场基准价（离线结算预估收入用：装备/舰船粗估；找不到返回 0） */
function marketBasePrice(ctx: SimContext, kind: 'module' | 'ship', refId: string): number {
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === kind && g.refId === refId) return g.basePrice ?? 0
  }
  return 0
}

/** 制造类蓝图的公共形状（装备蓝图与舰船蓝图共有的字段） */
export interface BuildSpec {
  materials: BlueprintDef['materials']
  buildSeconds: number
  buildCostIsk: number
}

/** 按 id 解析一张可制造蓝图（先查装备/物品类蓝图，再查舰船蓝图；
 * 2026-09-05：弹药等物品类 = moduleId 缺省但带 itemId/outputUnits 的普通蓝图） */
export function findBuildable(
  ctx: SimContext,
  blueprintId: string,
): { kind: 'module' | 'ship' | 'item'; spec: BuildSpec; moduleId?: string; shipId?: string; itemId?: string; outputUnits?: number } | null {
  const bp = ctx.blueprints.get(blueprintId)
  if (bp) {
    if (bp.itemId !== undefined) {
      return { kind: 'item', spec: bp, itemId: bp.itemId, outputUnits: bp.outputUnits ?? 1 }
    }
    return { kind: 'module', spec: bp, moduleId: bp.moduleId }
  }
  const shipBp = ctx.shipBlueprints.get(blueprintId)
  if (shipBp) {
    return { kind: 'ship', spec: shipBp, shipId: shipBp.shipId }
  }
  return null
}

/** 商店/界面用：蓝图的单次可用性（普通蓝图恒 `ok`；一次性蓝图按"名下名额 + 书架那本书"判定） */
export interface RecipeCapability {
  /** ok = 可以开工；learned = 已永久学会（无需书）；consumeBook = 本次开工要吃掉一本一次性书 */
  kind: 'ok' | 'learned' | 'need-book' | 'exhausted' | 'no-book'
  /** 本次开工是否要吃一本一次性书 */
  consumeBook: boolean
}

/** 是否临时占驻某个正开着的制造线（取消/完成即释放）——写进蓝图书架文案 */
export function oneTimeBookInUse(state: GameState, blueprintId: string): boolean {
  return state.manufacturingRuns.some((r) => r.active && r.blueprintId === blueprintId)
}

/**
 * **一次性图纸的可用性**（2026-09-12 船长裁定；普通蓝图恒 `ok`：
 * 只由 `startManufacturing` 的"是否已学会"把关，本函数不改旧行为）。
 *
 * 口径（逐条对应船长裁定）：
 * - **已永久学会** ⇒ `learned`：一次性书**不消耗也不用**（2乙：不作"学习"用，也不当材料吞）；
 * - **名额未用尽 且 书架有这本书** ⇒ `ok` + `consumeBook`（1甲：学了才能造一次，书当场吃掉）；
 * - **名额已用尽** ⇒ `exhausted`（要再造就**再有一本**）；
 * - **书架没有** ⇒ `no-book`。
 */
export function recipeCapability(state: GameState, blueprintId: string, singleUse: boolean): RecipeCapability {
  if (!singleUse) return { kind: 'ok', consumeBook: false }
  if (state.learnedRecipes.includes(blueprintId)) return { kind: 'learned', consumeBook: false }
  // ⚠ **书在架上就是可用**（名额用完只表示"上一张已吃掉"；再获得一张 = 又能造一次）——
  // 所以"有书"必须优先于"名单已用尽"判定，否则重复获得的图纸会被误拒（本批用例抓到过）。
  const stock = state.blueprintStock[blueprintId] ?? 0
  if (stock > 0) return { kind: 'ok', consumeBook: true }
  if ((state.spentOneTimeRecipes ?? []).includes(blueprintId)) return { kind: 'exhausted', consumeBook: false }
  return { kind: 'no-book', consumeBook: false }
}

/** 玩家是否已学会某配方（学习蓝图书后永久可造；两类通用） */
export function ownsBlueprint(state: GameState, blueprintId: string): boolean {
  return state.learnedRecipes.includes(blueprintId)
}

/** 蓝图**定义**（两类通用；找不到返回 undefined） */
export function blueprintDefOf(
  ctx: SimContext,
  blueprintId: string,
): BlueprintDef | ShipBlueprintDef | undefined {
  return ctx.blueprints.get(blueprintId) ?? ctx.shipBlueprints.get(blueprintId)
}

/** 该蓝图是否一次性图纸（2026-09-12 船长定；缺省 false = 普通蓝图） */
export function isSingleUseBlueprint(ctx: SimContext, blueprintId: string): boolean {
  return blueprintDefOf(ctx, blueprintId)?.singleUse === true
}

/** 该蓝图当前能否开工（界面按钮可用性用；与 `startManufacturing` 同源判定） */
export function canStartBlueprint(state: GameState, ctx: SimContext, blueprintId: string): boolean {
  if (ownsBlueprint(state, blueprintId)) return true
  return recipeCapability(state, blueprintId, isSingleUseBlueprint(ctx, blueprintId)).kind === 'ok'
}

/**
 * **吃掉一本一次性书**并把名额记为已用尽（开工那一刻调用，与材料扣除同源）。
 * 返回 false = 书架已无书（调用方应视为开工失败）。
 */
function spendOneTimeBook(state: GameState, blueprintId: string): boolean {
  const c = state.blueprintStock[blueprintId] ?? 0
  if (c <= 0) return false
  if (c - 1 <= 0) delete state.blueprintStock[blueprintId]
  else state.blueprintStock[blueprintId] = c - 1
  const spent = (state.spentOneTimeRecipes ??= [])
  if (!spent.includes(blueprintId)) spent.push(blueprintId)
  return true
}

/** 蓝图显示名 */
function blueprintName(ctx: SimContext, blueprintId: string): string {
  return ctx.blueprints.get(blueprintId)?.name ?? ctx.shipBlueprints.get(blueprintId)?.name ?? blueprintId
}

/** 按当前技能计算制造耗时（毫秒），开工时锁定（工业理论 −5%/级 × 批量生产学 −4%/级 乘算） */
export function calcBuildDurationMs(state: GameState, ctx: SimContext, spec: BuildSpec): number {
  const bal = ctx.balance.manufacturing
  const level = state.skills.trained[bal.timeSkillId] ?? 0
  const batchLv = Math.min(5, state.skills.trained['batch-production'] ?? 0)
  // 2026-09-08（船长定：移除「最多缩短 60%」下限护栏；工业理论×批量生产学乘算本身有界）
  const ratio = Math.max(0, (1 - bal.timePerLevel * level) * (1 - 0.03 * batchLv))
  // 调试模式 debugQuick：制造固定 1 秒
  return state.debugQuick ? 1000 : Math.max(1, Math.round(spec.buildSeconds * 1000 * ratio))
}

/** 材料学（materials）−1.5%/级 × 组件标准化（component-standardization）−0.8%/级（2026-09-08 技能加成下调约 20%）：乘算折扣（下限 70%） */
export function materialFactor(state: GameState): number {
  const lv1 = Math.min(5, state.skills.trained['materials'] ?? 0)
  const lv2 = Math.min(5, state.skills.trained['component-standardization'] ?? 0)
  return Math.max(0.7, (1 - 0.015 * lv1) * (1 - 0.008 * lv2))
}

/** 材料学折扣后的实际需求数量（预览/扣料/取消退回同口径） */
export function matNeedCount(state: GameState, count: number): number {
  return Math.max(1, Math.floor(count * materialFactor(state)))
}

/** 材料缺口说明（界面提示用；材料从物品仓库取用；数量已按材料学折扣折算） */
export function missingMaterials(state: GameState, ctx: SimContext, spec: BuildSpec): string[] {
  const missing: string[] = []
  for (const need of spec.materials) {
    const needCount = matNeedCount(state, need.count)
    const have = countWare(state, need.itemId)
    if (have < needCount) {
      const name = ctx.items.get(need.itemId)?.name ?? need.itemId
      missing.push(`${name} 还差 ${(needCount - have).toLocaleString('zh-CN')} 单位`)
    }
  }
  return missing
}

/** 产物显示名（module=装备 / ship=舰船 / item=弹药等物品；记录缺失回退 fallback） */
function productNameOf(ctx: SimContext, b: NonNullable<ReturnType<typeof findBuildable>>, fallback: string): string {
  if (b.kind === 'item') return ctx.items.get(b.itemId ?? '')?.name ?? fallback
  if (b.kind === 'module') return ctx.modules.get(b.moduleId ?? '')?.name ?? fallback
  return ctx.ships.get(b.shipId ?? '')?.name ?? fallback
}

/**
 * 主控此刻是否正亲自开着一条制造线（主控忙判定：AI 核心驱动 / 旧作业不占主控）
 */
export function manufacturingManualActive(state: GameState): boolean {
  return state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')
}

/**
 * 玩家指令：开始制造（2026-09-08 劳动者制与精炼炉完全同款，仅处理层不同：worker = 'pilot'
 * 主控亲自（全局限 1 条、与手动精炼/回收共用手动工作位、占主控不可离港作业）或 AiCoreType
 * 一枚核心驱动一条线（同时启用数计入「AI 核心上限」——上限由 AI 核心上限技能决定、
 * 与 AI 副船任务共用；出库占用、完成/取消归还）；同一蓝图可多条线、
 * 不同蓝图不限，皆受劳动者约束；材料立即扣除（2026-09-08 船长定：取消每次制造费），
 * 时间到自动完成）。
 */
export function startManufacturing(
  state: GameState,
  blueprintId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  if (!isAtHomeLike(state, ctx)) {
    return { ok: false, error: '组装机随协会基地网络运转：需停靠空间站（母港或已建成副站）才能开工制造。' }
  }
  const buildable = findBuildable(ctx, blueprintId)
  if (!buildable) return { ok: false, error: `未知蓝图：${blueprintId}。` }
  // 配方可用性（2026-09-12 船长定）：普通蓝图 = 必须已学会；一次性图纸 = 有书 + 名额未用尽
  // （⚠ **已永久学会时，一次性书不消耗也不使用** —— 船长裁定「2乙」）
  const singleUse = isSingleUseBlueprint(ctx, blueprintId)
  const cap = recipeCapability(state, blueprintId, singleUse)
  if (!ownsBlueprint(state, blueprintId)) {
    if (singleUse) {
      // ⚠ **先看"书架有没有书"**：有书就能用掉（可能是重复获得的那张）；
      // 只有"书架没书"时才区分两种拒绝——名额已用尽（要再获得一张）／从未获得过。
      if (cap.kind !== 'ok') {
        if ((state.spentOneTimeRecipes ?? []).includes(blueprintId)) {
          return { ok: false, error: '这张一次性图纸的制造名额已用尽：需要再获得一张同名一次性图纸。' }
        }
        return { ok: false, error: '一次性图纸不在蓝图书架：请先获得这张图纸。' }
      }
    } else {
      return { ok: false, error: `尚未学会「${blueprintName(ctx, blueprintId)}」的配方：在市场买回蓝图书并学习后才能制造。` }
    }
  }
  if (worker === 'pilot') {
    // 主控亲自制造 = 全局限 1 条 + 与手动精炼/回收共用一个手动工作位 + 占主控工作位
    if (manufacturingManualActive(state)) {
      return { ok: false, error: '你已亲自开着一条制造线：先取消或等它完成才能再亲自开一条（AI 核心不受此限）。' }
    }
    if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
      return { ok: false, error: '你已亲自运转着一台精炼炉/回收炉：先停掉它才能亲自开制造线（AI 核心不受此限）。' }
    }
    if (state.mining.active) return { ok: false, error: '采矿作业中：先停止开采。' }
    if (state.salvaging.active) return { ok: false, error: '打捞作业中：先停止打捞（或等满仓自动返航）。' }
    if (state.expedition.active) return { ok: false, error: '远征作业中：先召回或等待结束。' }
    if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
    if (state.standby.active) return { ok: false, error: '掩护巡逻进行中：先召回。' }
    if (state.transit.active) return { ok: false, error: '返航行程中：先等抵达。' }
    if (state.hauling.active) return { ok: false, error: '长途运输进行中：先停止（活动栏「停止运输」，到站即止）再亲自制造。' }
  } else {
    const capBlock = aiCoreCapBlock(state, ctx, 'industry')
    if (capBlock) return { ok: false, error: capBlock }
    if (countAiCore(state, worker) <= 0) {
      return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入组装机。` }
    }
  }
  // 2026-09-08 船长定：取消每次制造费——开工不再校验/收取 buildCostIsk（蓝图数据字段保留为历史遗留）
  const missing = missingMaterials(state, ctx, buildable.spec)
  if (missing.length > 0) {
    return { ok: false, error: `材料不足：${missing.join('、')}。` }
  }
  // 耗时链：calcBuildDurationMs（工业理论 × 批量生产学）为共同基准；AI 先 ÷核心效率；
  // 产线节拍学 −5%/级（2026-09-08 船长定：手动与 AI 核心驱动同享）最后统一再乘一区（无下限护栏）
  let durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
  if (worker !== 'pilot') {
    const eff = aiEfficiency(state, ctx, worker)
    durationMs = Math.max(1, Math.round(durationMs / eff))
  }
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) durationMs = Math.max(1, Math.round(durationMs * Math.max(0, 1 - 0.05 * autoLv)))
  // AI 线：先占用核心（材料校验之后、扣料之前——失败不产生任何副作用）
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。` }
  }
  // 扣材料（物品仓库，按材料学折扣后数量）；制造费已于 2026-09-08 取消，不再扣款
  for (const need of buildable.spec.materials) {
    removeWare(state, need.itemId, matNeedCount(state, need.count))
  }
  // 一次性图纸：**开工那一刻吃掉这本书**（船长裁定「3甲」，与材料同源）；
  // 取消/失败**不退还**（书代表"一次制造资格"，材料才是可退的投入）
  if (cap.consumeBook && !spendOneTimeBook(state, blueprintId)) {
    return { ok: false, error: '一次性图纸不在蓝图书架：请先获得这张图纸。' }
  }

  state.manufacturingRuns.push({
    active: true,
    id: state.manufacturingSeq++,
    blueprintId,
    worker,
    finishAtGameMs: state.gameMs + durationMs,
    durationMs,
  })
  const productName = productNameOf(ctx, buildable, blueprintId)
  addLog(
    state,
    'trade',
    `制造开始：${productName}（蓝图「${blueprintName(ctx, blueprintId)}」）${cap.consumeBook ? '［一次性图纸：已消耗，本配方只能制造一次］' : ''}，${worker === 'pilot' ? '主控亲自开线' : `${aiCoreName(worker)}驱动`}，预计 ${formatDurationMs(durationMs)} 完成。`,
  )
  return { ok: true }
}

/**
 * 玩家指令：取消指定的制造线（v21 按线号定位；T1 活动窗口统一停止）。
 * 材料按蓝图清单全额退回物品仓库（2026-09-08 起开工不收取制造费，无退费一说）；
 * 产物不产生；AI 核心驱动的线取消时核心归还核心库（旧作业无线可退）。
 */
export function cancelManufacturing(state: GameState, ctx: SimContext, runId: number): CommandResult {
  const idx = state.manufacturingRuns.findIndex((r) => r.id === runId)
  if (idx < 0) return { ok: false, error: '没有找到该制造线（已完成或已取消）。' }
  const [mf] = state.manufacturingRuns.splice(idx, 1)
  const buildable = mf.blueprintId ? findBuildable(ctx, mf.blueprintId) : null
  const productName = buildable ? productNameOf(ctx, buildable, mf.blueprintId ?? '') : (mf.blueprintId ?? '')
  if (mf.worker !== undefined && mf.worker !== 'pilot') releaseAiCore(state, mf.worker)
  if (buildable) {
    // 退回 = 开工时实际扣除的数量（含材料学折扣），不多退
    for (const need of buildable.spec.materials) {
      addWare(state, need.itemId, matNeedCount(state, need.count))
    }
    addLog(
      state,
      'info',
      `已取消制造「${productName}」：材料全额退回物品仓库（按材料学折扣后的实际用量${mf.worker !== undefined && mf.worker !== 'pilot' ? '；AI 核心已归还核心库' : ''}）` +
        (mf.blueprintId && isSingleUseBlueprint(ctx, mf.blueprintId) ? '；⚠ 该一次性图纸开工时已消耗，取消不退。' : '。'),
    )
  } else {
    addLog(state, 'warn', '制造作业已取消（引用的蓝图记录缺失，无材料可退）。')
  }
  return { ok: true }
}

/**
 * 玩家指令：开/关这张生产卡的「循环制造」（2026-09-10 船长定：开关与目标件数挂在卡片上，
 * 作用于**该卡全部制造线**——含主控亲自那条；打开后新开的线自动继承；目标件数 = 全卡合计）。
 * - 从「关」到「开」= 开一批新循环：本轮合计 `produced` 与停因 `stopWhy` 一起清零；
 *   开关本来就开着时只更新目标件数（**不动**已累计的合计，避免改数字把进度重置）；
 * - 关闭 = 该卡在跑的线完成当前件后停（不写停因，属玩家主动收手）；
 * - 卡片无需正在生产：先开开关、后开线同样生效（预制循环）。
 */
export function setManufacturingLoop(
  state: GameState,
  blueprintId: string,
  on: boolean,
  goal?: number | null,
): CommandResult {
  if (typeof blueprintId !== 'string' || blueprintId.length === 0) {
    return { ok: false, error: '没有找到这张生产卡（蓝图记录缺失）。' }
  }
  const g = Number.isFinite(goal) ? Math.floor(goal ?? 0) : 0
  const prev = state.manufacturingLoops[blueprintId]
  if (on) {
    const already = prev?.on === true
    state.manufacturingLoops[blueprintId] = {
      on: true,
      goal: g > 0 ? g : undefined,
      produced: already ? (prev?.produced ?? 0) : 0,
      stopWhy: already ? prev?.stopWhy : undefined,
    }
  } else {
    state.manufacturingLoops[blueprintId] = {
      on: false,
      goal: g > 0 ? g : prev?.goal && prev.goal > 0 ? prev.goal : undefined,
      produced: prev?.produced ?? 0,
      stopWhy: undefined,
    }
  }
  return { ok: true }
}

/** 卡片级循环配置的只读视图（界面显示用；缺省 = 未开启过 → 不循环、无目标、合计 0） */
export interface ManufacturingLoopView {
  /** 开关是否打开 */
  on: boolean
  /** 目标件数（0 = 不限，直到材料不足） */
  goal: number
  /** 本轮全卡合计产出件数 */
  produced: number
  /** 上一次自动停线原因（空 = 无） */
  stopWhy: string
}

/** 取某张生产卡的循环配置视图（界面/文案统一走这里，不要各自读 state） */
export function manufacturingLoopOf(state: GameState, blueprintId: string | null): ManufacturingLoopView {
  const l = blueprintId ? state.manufacturingLoops[blueprintId] : undefined
  return {
    on: l?.on === true,
    goal: l?.goal && l.goal > 0 ? l.goal : 0,
    produced: l?.produced ?? 0,
    stopWhy: l?.stopWhy ?? '',
  }
}

/** 内部：取卡片循环配置（可写引用；无线/无配置返回 undefined） */
function loopRefOf(state: GameState, blueprintId: string | null): GameState['manufacturingLoops'][string] | undefined {
  return blueprintId ? state.manufacturingLoops[blueprintId] : undefined
}


/** 引擎内部调用：推进全部制造线（每次时间推进后调用；v21 多工位逐线检查到点；
 * AI 核心驱动的线到点完成即归还核心。stats = 离线结算统计器（可选，见 settleStats.ts）
 * 循环制造（2026-09-10 上移到卡片级）：开关与目标件数按蓝图读 state.manufacturingLoops，
 * 该卡全部线共用——完成一件后自动续做同一蓝图（劳动者保持占用、相位推进 finishAt 可跨大 delta
 * 连续结算多件），本轮合计 produced 逐件累加；停止条件 = 合计达目标件数 / 材料不足 / 记录缺失 /
 * 开关已关（完成最后一件即止）。自动停线时把 `on` 置假并记 `stopWhy`（每卡一条汇总日志），
 * 该卡其它线跑完当前件即止、核心归还。 */
export function advanceManufacturing(state: GameState, ctx: SimContext, stats?: SettleStats): void {
  for (let i = state.manufacturingRuns.length - 1; i >= 0; i--) {
    const mf = state.manufacturingRuns[i]!
    if (!mf.active || state.gameMs < mf.finishAtGameMs) continue

    const blueprintId = mf.blueprintId
    const worker = mf.worker
    const byCore = worker !== undefined && worker !== 'pilot'
    // 卡片级循环（2026-09-10 船长定）：同一张卡的线共用开关/目标/合计，实时读、不往线上写副本
    const loop = loopRefOf(state, blueprintId)
    const auto = loop?.on === true
    let guard = 0
    let stopWhy = '' // 收尾原因（非循环线恒为空；空 = 正常完成停止/开关已关）


    /** 结算当前这一件（产出入账 + 完成日志 + 离线统计）；记录缺失抛错由调用处 catch 语义处理 */
    const settlePiece = (buildable: NonNullable<ReturnType<typeof findBuildable>>): boolean => {
      const coreType = byCore ? (worker as AiCoreType) : undefined
      if (buildable.kind === 'module') {
        const moduleDef = buildable.moduleId ? ctx.modules.get(buildable.moduleId) : undefined
        if (!moduleDef) return false
        addModule(state, moduleDef.id)
        addLog(state, 'info', `制造完成：${moduleDef.name} 已放入装备库，可以到装配台安装了。`)
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, marketBasePrice(ctx, 'module', moduleDef.id))
        }
      } else if (buildable.kind === 'ship') {
        const shipDef = buildable.shipId ? ctx.ships.get(buildable.shipId) : undefined
        if (!shipDef) return false
        addShipToFleet(state, shipDef.id)
        addLog(state, 'info', `造船完成：${shipDef.name} 已停入船坞，可以到舰船页切换驾驶了。`)
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, marketBasePrice(ctx, 'ship', shipDef.id))
        }
      } else {
        // 2026-09-05 弹药蓝图：物品类产物按 outputUnits 批量入物品仓库
        const itemDef = buildable.itemId ? ctx.items.get(buildable.itemId) : undefined
        if (!itemDef) return false
        const n = Math.max(1, buildable.outputUnits ?? 1)
        addWare(state, itemDef.id, n)
        addLog(state, 'info', `制造完成：${itemDef.name} ×${n.toLocaleString('zh-CN')} 已放入物品仓库（弹药可出发预载装船）。`)
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, n * (itemDef.baseSellPriceIsk ?? 0))
        }
      }
      return true
    }

    while (state.gameMs >= mf.finishAtGameMs) {
      if (++guard > 100_000) {
        stopWhy = '连续推进超过保护上限，循环已中断'
        break
      }
      const buildable = blueprintId ? findBuildable(ctx, blueprintId) : null
      if (!buildable) {
        addLog(state, 'warn', '制造作业引用的蓝图记录缺失，产出已丢弃（异常）。')
        stopWhy = '蓝图记录缺失'
        break
      }
      // 本轮全卡合计（2026-09-10：卡片级计数，**开关打开期间**逐件累加——含首件；
      // 达成目标时停在"正好等于目标"的件数上，随后收尾的在跑件不再计入，故合计即停线依据）
      if (loop && loop.on === true) loop.produced = (loop.produced ?? 0) + 1
      if (!settlePiece(buildable)) {
        addLog(state, 'warn', '制造作业引用的产物记录缺失，产出已丢弃（异常）。')
        stopWhy = '产物记录缺失'
        break
      }
      if (!auto) break
      const goal = loop && loop.goal && loop.goal > 0 ? loop.goal : null
      if (goal !== null && (loop?.produced ?? 0) >= goal) {
        stopWhy = `已达成目标 ${goal} 件`
        break
      }
      const missing = missingMaterials(state, ctx, buildable.spec)
      if (missing.length > 0) {
        stopWhy = `材料不足（缺 ${missing.join('、')}）`
        break
      }
      // 续做下一件：即时扣料、按当前技能重算耗时并相位推进（劳动者/核心保持占用）
      let durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
      if (worker !== undefined && worker !== 'pilot') {
        const eff = aiEfficiency(state, ctx, worker)
        durationMs = Math.max(1, Math.round(durationMs / eff))
      }
      const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
      if (autoLv > 0) durationMs = Math.max(1, Math.round(durationMs * Math.max(0, 1 - 0.05 * autoLv)))
      for (const need of buildable.spec.materials) {
        removeWare(state, need.itemId, matNeedCount(state, need.count))
      }
      mf.finishAtGameMs += durationMs
      mf.durationMs = durationMs
    }

    // 收尾判定：单件线 / 开关已关 / 带停因（达目标/缺料/记录缺失）→ 移除线并归还核心；
    // 循环正常续产中（已重排下一件到点）→ 线保留到下一 tick
    const lineEnds = !auto || stopWhy !== ''
    if (!lineEnds) continue
    state.manufacturingRuns.splice(i, 1)
    if (byCore) releaseAiCore(state, worker)
    if (auto && stopWhy) {
      // 卡片级自动停线（2026-09-10 船长定：达成目标/材料不足 → 自动关开关 + 卡片上标停因）。
      // 同一 tick 内同卡多条线一起到点时**只结一次账**（后面的线读到 on=false 即自然收尾、不重复记日志）
      const rest = blueprintId
        ? state.manufacturingRuns.filter((r) => r.active && r.blueprintId === blueprintId).length
        : 0
      const b = blueprintId ? findBuildable(ctx, blueprintId) : null
      const nm = b ? productNameOf(ctx, b, blueprintId ?? '') : (blueprintId ?? '')
      if (loop && loop.on === true) {
        loop.on = false
        loop.stopWhy = stopWhy
        addLog(
          state,
          'info',
          `循环制造停止：${nm}（本卡合计 ${loop.produced ?? 0} 件）——${stopWhy}${
            rest > 0 ? `；本卡其余 ${rest} 条线跑完当前件即停` : ''
          }${byCore ? '；AI 核心已归还核心库' : ''}`,
        )
      }
    }
  }
}

/** 制造作业进度（界面显示用；v21 每条制造线一个 view） */
export interface ManufacturingView {
  active: boolean
  /** 稳定线号 */
  id: number
  blueprintId: string | null
  /** 产物显示名（装备/舰船/弹药等物品） */
  productName: string
  /** 产物类别（界面图标/说明用；2026-09-05 起含 item = 弹药等物品蓝图） */
  kind: 'module' | 'ship' | 'item' | null
  /** 劳动者：'pilot' = 主控亲自 / AiCoreType = AI 核心驱动；null = 旧作业（老档遗留，免占用跑到完） */
  worker: 'pilot' | AiCoreType | null
  /** 劳动者显示名（'主控' / 核心中文名 / '旧作业'） */
  workerLabel: string
  /** 剩余毫秒（到点前由引擎完成；显示端每秒刷新） */
  remainingMs: number
  /** 总耗时毫秒 */
  durationMs: number
  percent: number
  /** 本卡「循环制造」开关（2026-09-10 卡片级：同卡各线读到的是**同一个**开关，不是逐线状态） */
  loopOn: boolean
  /** 本卡循环目标件数（全卡合计口径；0/缺省 = 直到材料不足） */
  loopGoal: number
  /** 本卡本轮合计产出件数（开关打开期间累加；与同卡其它线共享） */
  loopProduced: number
}

function viewOf(state: GameState, ctx: SimContext, mf: ManufacturingRunState): ManufacturingView {
  const buildable = mf.blueprintId ? findBuildable(ctx, mf.blueprintId) : null
  const productName = buildable ? productNameOf(ctx, buildable, mf.blueprintId ?? '') : (mf.blueprintId ?? '')
  const remainingMs = Math.max(0, mf.finishAtGameMs - state.gameMs)
  const percent =
    mf.durationMs > 0 ? Math.min(100, Math.max(0, Math.round(((mf.durationMs - remainingMs) / mf.durationMs) * 100))) : 0
  const worker = mf.worker ?? null
  const loop = manufacturingLoopOf(state, mf.blueprintId)
  return {
    active: mf.active,
    id: mf.id,
    blueprintId: mf.blueprintId,
    productName,
    kind: buildable ? buildable.kind : null,
    worker,
    workerLabel: worker === null ? '旧作业' : worker === 'pilot' ? '主控' : aiCoreName(worker),
    remainingMs,
    durationMs: mf.durationMs,
    percent,
    loopOn: loop.on,
    loopGoal: loop.goal,
    loopProduced: loop.produced,
  }
}

/** 全部制造线视图（v21 多工位：工业页卡片逐线 / 活动栏逐条） */
export function manufacturingRunViews(state: GameState, ctx: SimContext): ManufacturingView[] {
  return state.manufacturingRuns.map((r) => viewOf(state, ctx, r))
}
