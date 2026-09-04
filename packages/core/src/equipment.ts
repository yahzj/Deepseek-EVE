/**
 * 装备：入库/出库/装配/加成。
 *
 * 规则（中文说明，v7 + V10）：
 * - 装配位置在"当前驾驶的船"上（fleet[shipId].fitted），换船看到的是那艘船的装备；
 * - 装备库（moduleBay）是空间站库存：制造完成先入库，装配时取出；
 * - 弃船会连 fitted 一起遗失（moduleBay 不丢）；
 * - 槽位（v10 起六槽定死）：miner/cargo/turret 三槽立即生效（产量/容量/火力），
 *   shield/armor/propulsion 三槽为占位家族：可装配、效果随战斗系统开放；
 * - 加成查询统一返回按槽 Record：调用方只取自己关心的槽位（行为与旧三字段一致）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { ModuleDef, ModuleSlot, SimContext } from './types'
import { MODULE_SLOTS, SLOT_LABELS, slotLabel as labelOf } from './labels'
import { currentShipState } from './inventory'

/** 槽位顺序（界面展示用） */
export { MODULE_SLOTS } from './labels'

/** 槽位中文名（界面与日志共用） */
export function slotLabel(slot: ModuleSlot): string {
  return labelOf(slot)
}

/** 装备库数量查询 */
export function countModule(state: GameState, moduleId: string): number {
  return state.moduleBay[moduleId] ?? 0
}

/** 装备入库（制造完成/卸下） */
export function addModule(state: GameState, moduleId: string, count = 1): void {
  if (count <= 0) return
  state.moduleBay[moduleId] = countModule(state, moduleId) + count
}

/** 装备出库（装配/取出），数量不足返回 false */
export function removeModule(state: GameState, moduleId: string, count = 1): boolean {
  const current = countModule(state, moduleId)
  if (count <= 0 || current < count) return false
  const rest = current - count
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  return true
}

/** 玩家指令：把装备库里的装备装到当前船的对应槽位（同槽旧件自动退回装备库） */
export function fitModule(state: GameState, moduleId: string, ctx: SimContext): CommandResult {
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。` }
  if (countModule(state, moduleId) < 1) {
    return { ok: false, error: `装备库里没有 ${def.name}，先去制造台造一件。` }
  }
  const fitted = fittedOf(state)
  if (!fitted) return { ok: false, error: '当前舰船数据缺失，无法装配。' }
  const slot = def.slot
  if (fitted[slot] === moduleId) {
    return { ok: false, error: `${def.name} 已经装在该槽位上了。` }
  }
  const prevId = fitted[slot]
  if (prevId !== null) {
    // 旧件退回装备库，再装新的
    fitted[slot] = null
    addModule(state, prevId)
  }
  removeModule(state, moduleId)
  fitted[slot] = moduleId
  addLog(state, 'info', `已装配 ${def.name}（${slotLabel(slot)}）。`)
  return { ok: true }
}

/** 玩家指令：卸下当前船某槽位的装备（放回装备库） */
export function unfitSlot(state: GameState, slot: ModuleSlot): boolean {
  const fitted = fittedOf(state)
  if (!fitted) return false
  const moduleId = fitted[slot]
  if (moduleId === null) return false
  fitted[slot] = null
  addModule(state, moduleId)
  addLog(state, 'info', `已卸下并放回装备库（${slotLabel(slot)}）。`)
  return true
}

/** 指定船（缺省当前驾驶船）的装备加成：按槽返回（仅生效槽位有消费者，占位槽加成保留数值） */
export function fittedBonuses(
  state: GameState,
  ctx: SimContext,
  shipId: string = state.shipId,
): Record<ModuleSlot, number> {
  const result = {} as Record<ModuleSlot, number>
  for (const slot of MODULE_SLOTS) result[slot] = 0
  const fitted = state.fleet[shipId]?.fitted ?? null
  if (!fitted) return result
  for (const slot of MODULE_SLOTS) {
    const moduleId = fitted[slot]
    if (moduleId === null) continue
    const def = ctx.modules.get(moduleId)
    if (!def || def.slot !== slot) continue
    result[slot] = def.bonus
  }
  return result
}

/** 当前驾驶船的 fitted（空船时返回 null） */
function fittedOf(state: GameState): GameState['fleet'][string]['fitted'] | null {
  return currentShipState(state)?.fitted ?? null
}

export { SLOT_LABELS }
