/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, shipLockedReason, addLog } from '../../state'
import type { SimContext, RackSlot, ModuleSlot } from '../../types'
import type { CommandResult } from '../../engine'
import { shipOperationBlockReason } from '../../shipActionPolicy'
import { isRackModule, rackOf, rackLabel, rackBays } from '../../labels'
import { countModule, uniqueConflictOf, ensureRackBays, wantedBaysOf, firstFreeBay, removeModule, addModule, fittedOf, slotLabel } from './stock'
import { moduleAllowedOnShip } from '../../shipFitting'
import { fleetDefOf } from '../../instances'
import { cpuOverloadText, fittedCpuUsed, cpuUseOf, droneCpuUsed, cpuBudgetOf } from './cpu'
import { trimDroneLoadToBay } from './drones'
import { V17_FAMILY_BAYS } from './repair'

export function fitModule(
  state: GameState,
  moduleId: string,
  ctx: SimContext,
  opts?: { rack?: RackSlot; index?: number; shipId?: string },
): CommandResult {
  // **进洞船只所有行为锁定**（船长 2026-09-13：「锁，进洞船只所有行为都锁定。包括维修。」）
  const blocked = shipOperationBlockReason(state, ctx, opts?.shipId ?? state.shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  const lock = shipLockedReason(state, opts?.shipId ?? state.shipId, '改装它')
  if (lock) return { ok: false, error: lock }
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001', errorParams: { p1: moduleId } }
  /**
   * **舰船插件不许走高/中/低槽**（**2026-09-27 船长报障**：「有部分船插会在装备栏显示」）。
   *
   * 插件在数据里为过体检契约声明了 `rack: 'low'`，而 `rackOf()` 优先返回 `def.rack` ⇒ 不拦的话
   * 低槽候选会把插件列出来、点下去就真写进 `fitted.low` ⇒ **插件变成可卸下**（破「不可拆卸、
   * 不可替换」）且绕过插件槽上限。⇒ 装配入口按单点 `isRackModule` 一律拒收，插件只走 `installPlug`。
   */
  if (!isRackModule(def)) {
    return {
      ok: false,
      error: `「${def.name}」是舰船插件，只能装进插件槽（装上去拆不下来，也不会占高/中/低槽）。`,
      errorId: 'core.equipment.030',
      errorParams: { p1: def.name },
    }
  }
  if (countModule(state, moduleId) < 1) {
    return { ok: false, error: `装备库里没有 ${def.name}，先去组装机造一件。`, errorId: 'core.equipment.002', errorParams: { p1: def.name } }
  }
  const shipId = opts?.shipId ?? state.shipId
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return { ok: false, error: '舰队里找不到该舰船，无法装配。', errorId: 'core.equipment.003' }
  if (!moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), def)) {
    return { ok: false, errorId: 'core.equipment.033', error: '该货舰不支持武器、战斗机群、进攻电子或全队护盾装备。' }
  }
  /**
   * **同舰唯一**（**2026-09-25 船长令**：「**损管只能装备一件**」）——单点判据见 `uniqueConflictOf`。
   */
  const clash = uniqueConflictOf(fitted, ctx, moduleId)
  if (clash) {
    return {
      ok: false,
      error: `损伤管制装置每舰只能装一件（已装 ${clash.name}）。`,
      errorId: 'core.equipment.028',
      errorParams: { p1: clash.name },
    }
  }
  const rack = opts?.rack ?? rackOf(def)
  // V18 韧性：位数组长度按船布局期望补齐（repair 链负责持久对齐；此处兜底运行态）
  const bays = ensureRackBays(fitted, rack, wantedBaysOf(state, ctx, shipId, rack))
  const shipDef = fleetDefOf(state, ctx, shipId)
  // 目标位
  let index = -1
  if (opts?.index !== undefined) {
    if (opts.index < 0 || opts.index >= bays.length || bays[opts.index] !== null) {
      return {
        ok: false,
        error: `该${rackLabel(rack)}位不可用（第 ${opts.index + 1} 位）。`,
        errorId: 'core.equipment.007',
        errorParams: { p1: rackLabel(rack), p2: opts.index + 1 },
      }
    }
    index = opts.index
  } else {
    index = firstFreeBay(fitted, rack)
    if (index < 0) {
      return {
        ok: false,
        error: `${rackLabel(rack)}已满（${bays.length}/${bays.length}）：先卸下再装。`,
        errorId: 'core.equipment.008',
        errorParams: { p1: rackLabel(rack), p2: bays.length, p3: bays.length },
      }
    }
  }
  // CPU 装配校验（2026-09-11 起走单点预演）：全位合计（含新件 + 该船无人机舱预占清单）
  // ≤ **预算总额**（船体 cpu ×「舰船系统工程」+ 已装协处理器加成）
  const cpuBase = shipDef?.cpu
  if (cpuBase !== undefined && cpuBase > 0) {
    const overload = cpuOverloadText(state, ctx, shipId, { addModuleId: moduleId })
    if (overload !== null) {
      const used =
        fittedCpuUsed(fitted, ctx, shipDef) + cpuUseOf(def, shipDef) + droneCpuUsed(state.fleet[shipId]?.droneLoad, ctx)
      return {
        ok: false,
        error: `装配超载：合计需 CPU ${used}，预算 ${cpuBudgetOf(state, ctx, shipId)}（无人机舱占用亦计入预算——卸下装备、清一部分无人机，或装一件「协处理器」扩容）。`,
        errorId: 'core.equipment.009',
        errorParams: { p1: used, p2: cpuBudgetOf(state, ctx, shipId) },
      }
    }
  }
  removeModule(state, moduleId)
  bays[index] = moduleId
  addLog(
    state,
    'fleet',
    `已装配 ${def.name}（${rackLabel(rack)}第 ${index + 1} 位）。`,
    'core.equipment.021',
    { p1: def.name, p2: rackLabel(rack), p3: index + 1 },
  )
  return { ok: true }
}

/** 玩家指令：按 槽类+位序 卸下某船某位的装备（放回装备库；shipId 缺省 = 当前驾驶船）。
 * ctx 传入时（UI/工具一律传）做两件事：
 * ① **CPU 双向校验**（2026-09-11 船长：「玩家是否会通过装卸这个配件'偷' CPU 容量」）——
 *    卸下会同时收回该件的协处理器加成，故先**预演最终状态**，超载则**拒绝卸下**并提示先卸别的
 *    （EVE 同款；UI 侧 `engine.unfitAtAt` 会用 `cpuOverloadText` 给出具体原因）；
 * ② 卸下「无人机甲板扩展」等导致机舱变小的件后，**超出容量的无人机自动卸下并退回仓库**。 */
export function unfitAt(
  state: GameState,
  rack: RackSlot,
  index: number,
  shipId: string = state.shipId,
  ctx?: SimContext,
): boolean {
  // **进洞船只所有行为锁定**（船长 2026-09-13：锁，进洞船只所有行为都锁定。包括维修。）
  const blocked = shipOperationBlockReason(state, ctx, shipId, 'configure')
  if (blocked) return false
  const lock = shipLockedReason(state, shipId, '卸下它的装备')
  if (lock) return false
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return false
  const bays = rackBays(fitted, rack)
  if (index < 0 || index >= bays.length) return false
  const moduleId = bays[index]
  if (moduleId === null) return false
  if (ctx && cpuOverloadText(state, ctx, shipId, { remove: { rack, index } }) !== null) return false
  bays[index] = null
  addModule(state, moduleId)
  addLog(
    state,
    'fleet',
    `已卸下并放回装备库（${rackLabel(rack)}第 ${index + 1} 位）。`,
    'core.equipment.022',
    { p1: rackLabel(rack), p2: index + 1 },
  )
  if (ctx) trimDroneLoadToBay(state, ctx, shipId)
  return true
}

/**
 * 玩家指令：**换装**（把某位旧件卸下、装上装备库里的新件）——一次成型、按**最终状态**校验。
 *
 * 为什么必须有这个命令（2026-09-11 船长指出装卸可"偷" CPU 之后）：
 * 界面原先的换装是「先 `unfitAt` 再 `fitModule`」两步，而 `unfitAt` 现在会为防套利拒绝
 * "卸下后超载"的操作 —— 于是「换一件协处理器」这类**最终状态合法、中间态非法**的换装会被卡住。
 * 本命令把两步并成一次预演（`cpuOverloadText` 同时给 remove + add），校验通过才落库。
 *
 * 校验顺序：装备库有货 → 目标位可用（旧件可为空 = 等价于装配）→ CPU 最终态不超载 →
 * 旧件放回装备库、新件从库中取出、写日志。
 */
export function swapModuleAt(
  state: GameState,
  moduleId: string,
  ctx: SimContext,
  opts: { rack: RackSlot; index: number; shipId?: string },
): CommandResult {
  // **进洞船只所有行为锁定**（船长 2026-09-13：「锁，进洞船只所有行为都锁定。包括维修。」）
  const blocked = shipOperationBlockReason(state, ctx, opts.shipId ?? state.shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  const lock = shipLockedReason(state, opts.shipId ?? state.shipId, '改装它')
  if (lock) return { ok: false, error: lock }
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001', errorParams: { p1: moduleId } }
  /**
   * **舰船插件不许走高/中/低槽**（**2026-09-27 船长报障**）：本函数是装配页候选卡的落点
   * （`engine.swapModuleTo` → 这里），而低槽候选此前会把插件列出来 ⇒ 不拦就会被写进 `fitted.low`。
   * 判据走单点 `isRackModule`（见 `labels.ts` 的说明）。
   */
  if (!isRackModule(def)) {
    return {
      ok: false,
      error: `「${def.name}」是舰船插件，只能装进插件槽（装上去拆不下来，也不会占高/中/低槽）。`,
      errorId: 'core.equipment.030',
      errorParams: { p1: def.name },
    }
  }
  const shipId = opts.shipId ?? state.shipId
  const fleet = state.fleet[shipId]
  const fitted = fleet?.fitted
  if (!fitted) return { ok: false, error: '舰队里找不到该舰船，无法换装。', errorId: 'core.equipment.004' }
  if (!moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), def)) {
    return { ok: false, errorId: 'core.equipment.033', error: '该货舰不支持武器、战斗机群、进攻电子或全队护盾装备。' }
  }
  const bays = ensureRackBays(fitted, opts.rack, wantedBaysOf(state, ctx, shipId, opts.rack))
  if (opts.index < 0 || opts.index >= bays.length) {
    return {
      ok: false,
      error: `该${rackLabel(opts.rack)}位不可用（第 ${opts.index + 1} 位）。`,
      errorId: 'core.equipment.007',
      errorParams: { p1: rackLabel(opts.rack), p2: opts.index + 1 },
    }
  }
  const oldId = bays[opts.index]
  if (oldId === moduleId) {
    return { ok: false, error: `${def.name} 已装在此位。`, errorId: 'core.equipment.010', errorParams: { p1: def.name } }
  }
  if (countModule(state, moduleId) < 1) {
    return { ok: false, error: `装备库里没有 ${def.name}，先去组装机造一件。`, errorId: 'core.equipment.002', errorParams: { p1: def.name } }
  }
  /**
   * **同舰唯一**（**2026-09-26 报障修复**）：换装路径此前**没查这条** ⇒ 玩家能把第二件损管
   * 塞进另一个低槽（玩家原话：「可以装多个损管」）。判据与「装上」共用单点 `uniqueConflictOf`；
   * `ignore` = 本槽（把损管换成另一款损管是合法的同槽替换）。
   */
  const clash = uniqueConflictOf(fitted, ctx, moduleId, { rack: opts.rack, index: opts.index })
  if (clash) {
    return {
      ok: false,
      error: `损伤管制装置每舰只能装一件（已装 ${clash.name}）。`,
      errorId: 'core.equipment.028',
      errorParams: { p1: clash.name },
    }
  }
  const overload = cpuOverloadText(state, ctx, shipId, {
    ...(oldId !== null ? { remove: { rack: opts.rack, index: opts.index } } : {}),
    addModuleId: moduleId,
  })
  if (overload !== null) return { ok: false, error: overload.error, errorId: overload.errorId, errorParams: overload.errorParams }
  if (oldId !== null) addModule(state, oldId)
  removeModule(state, moduleId)
  bays[opts.index] = moduleId
  addLog(
    state,
    'fleet',
    oldId !== null
      ? `已换装 ${ctx.modules.get(oldId)?.name ?? oldId} → ${def.name}（${rackLabel(opts.rack)}第 ${opts.index + 1} 位）。`
      : `已装配 ${def.name}（${rackLabel(opts.rack)}第 ${opts.index + 1} 位）。`,
  )
  return { ok: true }
}

/** 玩家指令：卸下当前船"某家族的第一件"（旧六槽语义的兼容入口；UI 位操作请用 unfitAt）。
 * 家族 → 固定兼容位（V17_FAMILY_BAYS：turret→high0 / miner→high1 / shield→mid0 /
 * propulsion→mid1 / armor→low0 / cargo→low1）。
 * ⚠ 这张表是**老档（v17 布局）的历史位**：采集器 / 打捞器 2026-09-13 曾一度改归低槽
 * （船长「给作业开」），**2026-09-14 船长「改回高槽」后作废** ⇒ 本表 miner→high1 与现行归槽一致，
 * 本函数仍只服务"老档里插在高槽的那一件"，新档请用 `unfitAt`。 */
export function unfitSlot(state: GameState, family: ModuleSlot): boolean {
  if (shipOperationBlockReason(state, undefined, state.shipId, 'configure')) return false
  const fitted = fittedOf(state)
  if (!fitted) return false
  const legacy = V17_FAMILY_BAYS[family]
  if (!legacy) return false // 无人机装置等新家族无 v17 兼容位：请用 unfitAt
  const bays = rackBays(fitted, legacy.rack)
  if (legacy.index >= bays.length || bays[legacy.index] === null) return false
  const moduleId = bays[legacy.index]!
  bays[legacy.index] = null
  addModule(state, moduleId)
  addLog(
    state,
    'fleet',
    `已卸下并放回装备库（${slotLabel(family)}）。`,
    'core.equipment.023',
    { p1: slotLabel(family) },
  )
  return true
}
