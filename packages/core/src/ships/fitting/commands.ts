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
  const blocked = shipOperationBlockReason(state, ctx, opts?.shipId ?? state.shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  const lock = shipLockedReason(state, opts?.shipId ?? state.shipId, '改装它')
  if (lock) return { ok: false, error: lock }
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001', errorParams: { p1: moduleId } }
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
  const bays = ensureRackBays(fitted, rack, wantedBaysOf(state, ctx, shipId, rack))
  const shipDef = fleetDefOf(state, ctx, shipId)
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

export function unfitAt(
  state: GameState,
  rack: RackSlot,
  index: number,
  shipId: string = state.shipId,
  ctx?: SimContext,
): boolean {
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

export function swapModuleAt(
  state: GameState,
  moduleId: string,
  ctx: SimContext,
  opts: { rack: RackSlot; index: number; shipId?: string },
): CommandResult {
  const blocked = shipOperationBlockReason(state, ctx, opts.shipId ?? state.shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  const lock = shipLockedReason(state, opts.shipId ?? state.shipId, '改装它')
  if (lock) return { ok: false, error: lock }
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001', errorParams: { p1: moduleId } }
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

export function unfitSlot(state: GameState, family: ModuleSlot): boolean {
  if (shipOperationBlockReason(state, undefined, state.shipId, 'configure')) return false
  const fitted = fittedOf(state)
  if (!fitted) return false
  const legacy = V17_FAMILY_BAYS[family]
  if (!legacy) return false
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
