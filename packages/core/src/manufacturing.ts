/**
 * 蓝图制造（M2/M5/V9 限时批次；v21 多工位并行，产物：装备或舰船）。
 *
 * 模型（中文说明）：
 * - V9 起蓝图 = 消耗品书：市场买回后放进"蓝图书架"，学习一本 → 永久学会该配方
 *   （learnedRecipes）；重复蓝图书只能放回市场交易，不能无限复制；
 * - 每次开工：立即扣除全部材料与制造费，耗时受工业理论缩短（开工锁定）；
 * - 到点自动完成：装备入装备库 / 舰船入船坞；
 * - v21（2026-09-05 船长拍板）：多张蓝图可同时制造（manufacturingRuns 逐线独立进度/
 *   取消）；2026-09-08 起同一蓝图也可开多条线（与精炼炉多炉并线一致）；
 * - 2026-09-08（船长拍板：与精炼炉机制完全相同，仅处理层不同）：制造线与炉同款劳动者制——
 *   worker = 'pilot'（主控亲自制造：全局限 1 条、与手动精炼/回收共用一个手动工作位、
 *   占主控不可离港作业）或 AiCoreType（一枚 AI 核心驱动一条线：核心出库占用、不占副船名额、
 *   完成/取消自动归还，核心库存即并行上限）；
 * - 耗时链同炉：主控线 = 工业理论 × 批量生产学（现有公式）；AI 线 = 基础耗时 ÷ 核心效率再乘
 *   工业自动化 −5%/级（下限 60%）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState, ManufacturingRunState } from './state'
import type { AiCoreType, BlueprintDef, ShipBlueprintDef, SimContext } from './types'
import { addWare, countWare, removeWare } from './inventory'
import { addModule } from './equipment'
import { addShipToFleet } from './shipyard'
import { formatDurationMs } from './time'
import { aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { isAtHome } from './location'

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

/** 玩家是否已学会某配方（学习蓝图书后永久可造；两类通用） */
export function ownsBlueprint(state: GameState, blueprintId: string): boolean {
  return state.learnedRecipes.includes(blueprintId)
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
  const ratio = Math.max(bal.minTimeRatio, (1 - bal.timePerLevel * level) * (1 - 0.04 * batchLv))
  // 调试模式 debugQuick：制造固定 1 秒
  return state.debugQuick ? 1000 : Math.max(1, Math.round(spec.buildSeconds * 1000 * ratio))
}

/** 材料学（materials）−2%/级 × 组件标准化（component-standardization）−1%/级：乘算折扣（下限 70%） */
export function materialFactor(state: GameState): number {
  const lv1 = Math.min(5, state.skills.trained['materials'] ?? 0)
  const lv2 = Math.min(5, state.skills.trained['component-standardization'] ?? 0)
  return Math.max(0.7, (1 - 0.02 * lv1) * (1 - 0.01 * lv2))
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

/** 产物显示名（module=装备 / ship=舰船 / item=弹药等物品；数据缺失回退 fallback） */
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
 * 一枚核心驱动一条线（核心库存即并行上限，出库占用、完成/取消归还）；同一蓝图可多条线、
 * 不同蓝图不限，皆受劳动者约束；材料与制造费立即扣除，时间到自动完成）。
 */
export function startManufacturing(
  state: GameState,
  blueprintId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  if (!isAtHome(state)) {
    return { ok: false, error: '组装机在母港：回到母港才能开工制造。' }
  }
  const buildable = findBuildable(ctx, blueprintId)
  if (!buildable) return { ok: false, error: `未知蓝图：${blueprintId}。` }
  if (!ownsBlueprint(state, blueprintId)) {
    return { ok: false, error: `尚未学会「${blueprintName(ctx, blueprintId)}」的配方：在市场买回蓝图书并学习后才能制造。` }
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
  } else if (countAiCore(state, worker) <= 0) {
    return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入组装机。` }
  }
  if (state.wallet.isk < buildable.spec.buildCostIsk) {
    return { ok: false, error: `制造费不足：需要 ${buildable.spec.buildCostIsk.toLocaleString('zh-CN')} ISK。` }
  }
  const missing = missingMaterials(state, ctx, buildable.spec)
  if (missing.length > 0) {
    return { ok: false, error: `材料不足：${missing.join('、')}。` }
  }
  // 耗时链同炉：主控 = 工业理论 × 批量生产学；AI = ÷核心效率 再乘 工业自动化 −5%/级（下限 60%）
  let durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
  if (worker !== 'pilot') {
    const eff = aiEfficiency(state, ctx, worker)
    durationMs = Math.max(1, Math.round(durationMs / eff))
    const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
    if (autoLv > 0) durationMs = Math.max(1, Math.round(durationMs * Math.max(0.6, 1 - 0.05 * autoLv)))
  }
  // AI 线：先占用核心（材料/费用校验之后、扣料之前——失败不产生任何副作用）
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。` }
  }
  // 扣材料（物品仓库，按材料学折扣后数量）与制造费
  for (const need of buildable.spec.materials) {
    removeWare(state, need.itemId, matNeedCount(state, need.count))
  }
  state.wallet.isk -= buildable.spec.buildCostIsk

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
    `制造开始：${productName}（蓝图「${blueprintName(ctx, blueprintId)}」），${worker === 'pilot' ? '主控亲自开线' : `${aiCoreName(worker)}驱动`}，预计 ${formatDurationMs(durationMs)} 完成。`,
  )
  return { ok: true }
}

/**
 * 玩家指令：取消指定的制造线（v21 按线号定位；T1 活动窗口统一停止）。
 * 材料按蓝图清单全额退回物品仓库；已付制造费不退；产物不产生；
 * AI 核心驱动的线取消时核心归还核心库（旧作业无线可退）。
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
      `已取消制造「${productName}」：材料全额退回物品仓库（按材料学折扣后的实际用量；制造费不退${mf.worker !== undefined && mf.worker !== 'pilot' ? '；AI 核心已归还核心库' : ''}）。`,
    )
  } else {
    addLog(state, 'warn', '制造作业已取消（引用的蓝图数据缺失，无材料可退）。')
  }
  return { ok: true }
}

/** 引擎内部调用：推进全部制造线（每次时间推进后调用；v21 多工位逐线检查到点；
 * AI 核心驱动的线到点完成即归还核心） */
export function advanceManufacturing(state: GameState, ctx: SimContext): void {
  for (let i = state.manufacturingRuns.length - 1; i >= 0; i--) {
    const mf = state.manufacturingRuns[i]!
    if (!mf.active || state.gameMs < mf.finishAtGameMs) continue

    const blueprintId = mf.blueprintId
    const buildable = blueprintId ? findBuildable(ctx, blueprintId) : null
    state.manufacturingRuns.splice(i, 1)
    if (mf.worker !== undefined && mf.worker !== 'pilot') releaseAiCore(state, mf.worker)
    if (!buildable) {
      addLog(state, 'warn', '制造作业引用的蓝图数据缺失，产出已丢弃（数据异常）。')
      continue
    }

    if (buildable.kind === 'module') {
      const moduleDef = buildable.moduleId ? ctx.modules.get(buildable.moduleId) : undefined
      if (!moduleDef) {
        addLog(state, 'warn', '制造作业引用的装备数据缺失，产出已丢弃（数据异常）。')
        continue
      }
      addModule(state, moduleDef.id)
      addLog(state, 'info', `制造完成：${moduleDef.name} 已放入装备库，可以到装配台安装了。`)
    } else if (buildable.kind === 'ship') {
      const shipDef = buildable.shipId ? ctx.ships.get(buildable.shipId) : undefined
      if (!shipDef) {
        addLog(state, 'warn', '制造作业引用的舰船数据缺失，产出已丢弃（数据异常）。')
        continue
      }
      addShipToFleet(state, shipDef.id)
      addLog(state, 'info', `造船完成：${shipDef.name} 已停入船坞，可以到舰船页切换驾驶了。`)
    } else {
      // 2026-09-05 弹药蓝图：物品类产物按 outputUnits 批量入物品仓库
      const itemDef = buildable.itemId ? ctx.items.get(buildable.itemId) : undefined
      if (!itemDef) {
        addLog(state, 'warn', '制造作业引用的物品数据缺失，产出已丢弃（数据异常）。')
        continue
      }
      const n = Math.max(1, buildable.outputUnits ?? 1)
      addWare(state, itemDef.id, n)
      addLog(state, 'info', `制造完成：${itemDef.name} ×${n.toLocaleString('zh-CN')} 已放入物品仓库（弹药可出发预载装船）。`)
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
}

function viewOf(state: GameState, ctx: SimContext, mf: ManufacturingRunState): ManufacturingView {
  const buildable = mf.blueprintId ? findBuildable(ctx, mf.blueprintId) : null
  const productName = buildable ? productNameOf(ctx, buildable, mf.blueprintId ?? '') : (mf.blueprintId ?? '')
  const remainingMs = Math.max(0, mf.finishAtGameMs - state.gameMs)
  const percent =
    mf.durationMs > 0 ? Math.min(100, Math.max(0, Math.round(((mf.durationMs - remainingMs) / mf.durationMs) * 100))) : 0
  const worker = mf.worker ?? null
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
  }
}

/** 全部制造线视图（v21 多工位：工业页卡片逐线 / 活动栏逐条） */
export function manufacturingRunViews(state: GameState, ctx: SimContext): ManufacturingView[] {
  return state.manufacturingRuns.map((r) => viewOf(state, ctx, r))
}
