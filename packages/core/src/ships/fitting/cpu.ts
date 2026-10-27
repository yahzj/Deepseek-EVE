/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import type { SimContext, FittedModules, RackSlot, ModuleDef } from '../../types'
import * as cpu from '../../equipmentCpu'
import type { CoreBlockReason } from '../../engine'
import { rackBays, rackOf } from '../../labels'

/**
 * 舰船系统工程（2026-09-05 一号按盘点补）：船体 CPU +5%/级——只提高预算、不改单件成本。
 * **本函数 = 船体预算（不含协处理器加成）**；装配/无人机/界面要看"总额"请用 `cpuBudgetOf`。
 */
export function effectiveCpu(state: GameState, ctx: SimContext, def: { cpu?: number } | undefined): number {
  return cpu.effectiveCpu(state, ctx, def)
}

/**
 * 该船 **CPU 预算总额** = 船体预算（含「舰船系统工程」）+ 已装**协处理器**加成之和
 * （`ModuleDef.cpuBonus`；2026-09-11 船长新增件）。
 *
 * `fittedOverride`：装配/卸下的**预演**用替身位数组（不传 = 读当前实际装配）。
 * ⚠ 预算随件走 ⇒ 任何"减少预算"的操作都必须先预演（见 `cpuOverloadText` / `unfitAt` / `swapModuleAt`），
 * 否则可"装协处理器涨预算 → 装满其它件 → 卸下协处理器"白拿预算。
 */
export function cpuBudgetOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  fittedOverride?: FittedModules | null,
): number {
  // 公开入口保留；纯预算与插件候选预演共用equipmentCpu，避免安装模块反向依赖装备命令。
  return cpu.cpuBudgetOf(state, ctx, shipId, fittedOverride)
}

/**
 * **CPU 超载预演**（单点口径：装配 / 卸载 / 换装 / 无人机装载四处共用）：
 * 按"假想的最终装配"算 占用 vs 预算，超了返回给玩家看的错误文案，否则 null。
 *
 * - `remove`：从该位拿掉一件（卸下 / 换装的旧件）；
 * - `addModuleId`：再装上这一件（装配 / 换装的新件，须已在装备库，从库中扣件由调用方负责）。
 * 两件事可同时给（换装 = 一减一增，按**最终状态**判定，避免合法换装被中间态卡住）。
 */
export function cpuOverloadText(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  plan?: { remove?: { rack: RackSlot; index: number }; addModuleId?: string },
): CoreBlockReason | null {
  const fleet = state.fleet[shipId]
  const shipDef = ctx.ships.get(fleet?.defId ?? shipId)
  if (!fleet || !shipDef || (shipDef.cpu ?? 0) <= 0) return null
  // 预演装配：克隆三类位数组（浅拷贝即可 —— 只改一个下标）
  const after: FittedModules = {
    high: [...fleet.fitted.high],
    mid: [...fleet.fitted.mid],
    low: [...fleet.fitted.low],
  }
  const add = plan?.addModuleId !== undefined ? ctx.modules.get(plan.addModuleId) : undefined
  if (plan?.remove) {
    const bays = rackBays(after, plan.remove.rack)
    if (plan.remove.index < 0 || plan.remove.index >= bays.length) return null
    bays[plan.remove.index] = null
  }
  if (plan?.addModuleId !== undefined) {
    if (!add) return null
    const rack = rackOf(add)
    const bays = rackBays(after, rack)
    const free = bays.findIndex((x) => x === null)
    if (free < 0) return null // 槽位满：由各自命令自己的文案处理
    bays[free] = add.id
  }
  const budget = cpuBudgetOf(state, ctx, shipId, after)
  const used = fittedCpuUsed(after, ctx, shipDef) + droneCpuUsed(fleet.droneLoad, ctx)
  if (used > budget) {
    return {
      error: `CPU 超载：合计需 ${used}，预算 ${budget}（协处理器只扩容、卸下即收回——先卸下其它装备或无人机）。`,
      errorId: 'core.equipment.032',
      errorParams: { p1: used, p2: budget },
    }
  }
  return null
}

/**
 * **单件 CPU 占用（含本船特性折算）**——装配校验 / 面板 / 战斗建档的**唯一口径**。
 *
 * 现行折算只有一条（船长 2026-09-16「侦查舰添加特性，隐秘行动装置所需CPU降低50%」，取整取**向上**）：
 * 带 `stealthMs` 的装置在本船 `stealthCpuMul` 生效时按 `ceil(cpuUse × 倍率)`；
 * 其余件、其余船一律返回原值（`ship` 缺省 ⇒ 原值）。**
 */
export function cpuUseOf(def: ModuleDef, ship?: { stealthCpuMul?: number }): number {
  return cpu.cpuUseOf(def, ship)
}

/** 全位 CPU 占用合计（与无人机放飞共用池；装配校验/战斗余量同源）。
 *  ⚠ 传 `ship`（本船舰船定义）时**含本船特性折算**（见 `cpuUseOf`）——凡"某一艘船"的读数都该传它。 */
export function fittedCpuUsed(
  fitted: FittedModules,
  ctx: SimContext,
  ship?: { stealthCpuMul?: number },
): number {
  return cpu.fittedCpuUsed(fitted, ctx, ship)
}

/** 2026-09-08 无人机舱大改：装载清单的 CPU 占用（与装配共用池；UI 预算/装配校验/战斗装载同源） */
export function droneCpuUsed(droneLoad: Record<string, number> | undefined, ctx: SimContext): number {
  return cpu.droneCpuUsed(droneLoad, ctx)
}
