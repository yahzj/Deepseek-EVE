/**
 * 蓝图制造（M2/M5/V9：限时批次作业，支持两种产物——装备 与 舰船）。
 *
 * 模型（中文说明）：
 * - V9 起蓝图 = 消耗品书：市场买回后放进"蓝图书架"，学习一本 → 永久学会该配方
 *   （learnedRecipes）；重复蓝图书只能放回市场交易，不能无限复制；
 * - 每次开工：立即扣除全部材料与制造费，耗时受工业理论缩短（开工锁定）；
 * - 到点自动完成：装备入装备库 / 舰船入船坞；
 * - 同时只允许一个制造作业。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { BlueprintDef, ShipBlueprintDef, SimContext } from './types'
import { addWare, countWare, removeWare } from './inventory'
import { addModule } from './equipment'
import { addShipToFleet } from './shipyard'
import { formatDurationMs } from './time'

/** 制造类蓝图的公共形状（装备蓝图与舰船蓝图共有的字段） */
export interface BuildSpec {
  materials: BlueprintDef['materials']
  buildSeconds: number
  buildCostIsk: number
}

/** 按 id 解析一张可制造蓝图（先查装备蓝图，再查舰船蓝图） */
export function findBuildable(
  ctx: SimContext,
  blueprintId: string,
): { kind: 'module' | 'ship'; spec: BuildSpec; moduleId?: string; shipId?: string } | null {
  const bp = ctx.blueprints.get(blueprintId)
  if (bp) {
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

/** 玩家指令：开始制造（材料与制造费立即扣除，时间到自动完成） */
export function startManufacturing(state: GameState, blueprintId: string, ctx: SimContext): CommandResult {
  const buildable = findBuildable(ctx, blueprintId)
  if (!buildable) return { ok: false, error: `未知蓝图：${blueprintId}。` }
  if (!ownsBlueprint(state, blueprintId)) {
    return { ok: false, error: `尚未学会「${blueprintName(ctx, blueprintId)}」的配方：在市场买回蓝图书并学习后才能制造。` }
  }
  if (state.manufacturing.active) return { ok: false, error: '制造作业进行中，完成一件后才能开始下一件。' }
  if (state.wallet.isk < buildable.spec.buildCostIsk) {
    return { ok: false, error: `制造费不足：需要 ${buildable.spec.buildCostIsk.toLocaleString('zh-CN')} ISK。` }
  }
  const missing = missingMaterials(state, ctx, buildable.spec)
  if (missing.length > 0) {
    return { ok: false, error: `材料不足：${missing.join('、')}。` }
  }

  // 扣材料（物品仓库，按材料学折扣后数量）与制造费
  for (const need of buildable.spec.materials) {
    removeWare(state, need.itemId, matNeedCount(state, need.count))
  }
  state.wallet.isk -= buildable.spec.buildCostIsk

  const durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
  state.manufacturing = {
    active: true,
    blueprintId,
    finishAtGameMs: state.gameMs + durationMs,
    durationMs,
  }
  const productName =
    buildable.kind === 'module'
      ? ctx.modules.get(buildable.moduleId ?? '')?.name ?? blueprintId
      : ctx.ships.get(buildable.shipId ?? '')?.name ?? blueprintId
  addLog(state, 'trade', `制造开始：${productName}（蓝图「${blueprintName(ctx, blueprintId)}」），预计 ${formatDurationMs(durationMs)} 完成。`)
  return { ok: true }
}

/**
 * 玩家指令：取消制造作业（T1 活动窗口统一停止）。
 * 材料按蓝图清单全额退回物品仓库；已付制造费不退；产物不产生。
 */
export function cancelManufacturing(state: GameState, ctx: SimContext): CommandResult {
  const mf = state.manufacturing
  if (!mf.active || mf.blueprintId === null) {
    return { ok: false, error: '当前没有进行中的制造作业。' }
  }
  const buildable = findBuildable(ctx, mf.blueprintId)
  const productName =
    buildable && buildable.kind === 'module'
      ? ctx.modules.get(buildable.moduleId ?? '')?.name ?? mf.blueprintId
      : buildable && buildable.kind === 'ship'
        ? ctx.ships.get(buildable.shipId ?? '')?.name ?? mf.blueprintId
        : mf.blueprintId
  mf.active = false
  mf.blueprintId = null
  mf.finishAtGameMs = 0
  mf.durationMs = 0
  if (buildable) {
    // 退回 = 开工时实际扣除的数量（含材料学折扣），不多退
    for (const need of buildable.spec.materials) {
      addWare(state, need.itemId, matNeedCount(state, need.count))
    }
    addLog(state, 'info', `已取消制造「${productName}」：材料全额退回物品仓库（按材料学折扣后的实际用量；制造费不退）。`)
  } else {
    addLog(state, 'warn', '制造作业已取消（引用的蓝图数据缺失，无材料可退）。')
  }
  return { ok: true }
}

/** 引擎内部调用：检查制造作业是否到点完成（每次时间推进后调用） */
export function advanceManufacturing(state: GameState, ctx: SimContext): void {
  const mf = state.manufacturing
  if (!mf.active) return
  if (state.gameMs < mf.finishAtGameMs) return

  const blueprintId = mf.blueprintId
  const buildable = blueprintId ? findBuildable(ctx, blueprintId) : null
  mf.active = false
  mf.blueprintId = null
  mf.finishAtGameMs = 0
  mf.durationMs = 0
  if (!buildable) {
    addLog(state, 'warn', '制造作业引用的蓝图数据缺失，产出已丢弃（数据异常）。')
    return
  }

  if (buildable.kind === 'module') {
    const moduleDef = buildable.moduleId ? ctx.modules.get(buildable.moduleId) : undefined
    if (!moduleDef) {
      addLog(state, 'warn', '制造作业引用的装备数据缺失，产出已丢弃（数据异常）。')
      return
    }
    addModule(state, moduleDef.id)
    addLog(state, 'info', `制造完成：${moduleDef.name} 已放入装备库，可以到装配台安装了。`)
  } else {
    const shipDef = buildable.shipId ? ctx.ships.get(buildable.shipId) : undefined
    if (!shipDef) {
      addLog(state, 'warn', '制造作业引用的舰船数据缺失，产出已丢弃（数据异常）。')
      return
    }
    addShipToFleet(state, shipDef.id)
    addLog(state, 'info', `造船完成：${shipDef.name} 已停入船坞，可以到舰船页切换驾驶了。`)
  }
}

/** 制造作业进度（界面显示用） */
export interface ManufacturingView {
  active: boolean
  blueprintId: string | null
  /** 产物显示名（装备或舰船） */
  productName: string
  /** 制造的是装备还是舰船（界面图标/说明用） */
  kind: 'module' | 'ship' | null
  /** 剩余毫秒（到点前由引擎完成；显示端每秒刷新） */
  remainingMs: number
  /** 总耗时毫秒 */
  durationMs: number
  percent: number
}

export function manufacturingStatus(state: GameState, ctx: SimContext): ManufacturingView {
  const mf = state.manufacturing
  if (!mf.active || mf.blueprintId === null) {
    return { active: false, blueprintId: null, productName: '', kind: null, remainingMs: 0, durationMs: 0, percent: 0 }
  }
  const buildable = findBuildable(ctx, mf.blueprintId)
  const productName =
    buildable && buildable.kind === 'module'
      ? ctx.modules.get(buildable.moduleId ?? '')?.name ?? mf.blueprintId
      : buildable && buildable.kind === 'ship'
        ? ctx.ships.get(buildable.shipId ?? '')?.name ?? mf.blueprintId
        : mf.blueprintId
  const remainingMs = Math.max(0, mf.finishAtGameMs - state.gameMs)
  const durationMs = Math.max(1, mf.durationMs)
  const percent = Math.min(100, Math.max(0, ((durationMs - remainingMs) / durationMs) * 100))
  return {
    active: true,
    blueprintId: mf.blueprintId,
    productName,
    kind: buildable ? buildable.kind : null,
    remainingMs,
    durationMs,
    percent,
  }
}
