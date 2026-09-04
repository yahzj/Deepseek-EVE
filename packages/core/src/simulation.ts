/**
 * 离线结算工具。
 *
 * 离线规则（M1/M2）：关掉游戏再打开时，按"真实离开时长"补进度，但最多只结算 8 小时：
 * - 技能队列照常推进（升级事件会出现在日志里）；
 * - 采矿作业若在挖，会按循环批量结算产出（货舱满了会停在离线期间——日志会记满舱）；
 * - 制造作业到点自动完成出装备；
 * - 结算完成后写摘要：离线多久、采集到哪些矿石、超出上限多少未结算。
 */

import { addLog } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import { advanceGame } from './engine'
import { countItem } from './inventory'
import { formatDurationMs } from './time'

// 兼容历史引用：formatDurationMs 现定义在 time.ts（避免模块循环依赖）
export { formatDurationMs } from './time'

/** 默认离线结算上限：8 小时（毫秒） */
export const DEFAULT_OFFLINE_CAP_MS = 8 * 60 * 60 * 1000

/** 把一段真实离开时长切成"可结算部分 + 超出上限被放弃的部分" */
export function offlineSplit(
  rawGapMs: number,
  capMs: number = DEFAULT_OFFLINE_CAP_MS,
): { deltaMs: number; overflowMs: number } {
  const raw = Math.max(0, Math.floor(rawGapMs))
  const cap = Math.max(0, Math.floor(capMs))
  return { deltaMs: Math.min(raw, cap), overflowMs: Math.max(0, raw - cap) }
}

/**
 * 读档后的离线结算入口：
 * 1. 真实时钟没往前走（含回拨）→ 不做任何事；
 * 2. 推进游戏（技能升级/采矿产出/满舱事件的日志自然出现）；
 * 3. 前后对比物品栏，把离线期间采到的矿石写进摘要日志。
 */
export function simulateOffline(
  state: GameState,
  lastSavedWallMs: number,
  nowWallMs: number,
  ctx: SimContext,
  capMs: number = DEFAULT_OFFLINE_CAP_MS,
): void {
  const rawGap = nowWallMs - lastSavedWallMs
  if (rawGap <= 0) return
  const { deltaMs, overflowMs } = offlineSplit(rawGap, capMs)
  if (deltaMs <= 0) return

  // 记录结算前的数量（当前船货仓 + 物品仓库），用于结算后对比出"离线得了什么"
  const beforeCounts = new Map<string, number>()
  const snapshot = (map: Record<string, number>): void => {
    for (const [id, units] of Object.entries(map)) {
      if (units > 0) beforeCounts.set(id, (beforeCounts.get(id) ?? 0) + units)
    }
  }
  snapshot(state.fleet[state.shipId]?.cargo ?? {})
  snapshot(state.warehouse.items)

  // 记录结算前的日志条数（必须在写"离线归来"之前取，否则把这条也算进去）
  const before = state.logs.length
  addLog(state, 'info', `离线归来：已离开 ${formatDurationMs(rawGap)}，开始结算……`)
  advanceGame(state, deltaMs, ctx)
  // 事件数 = 总新增 - 1（减去"离线归来"本身）
  const eventCount = state.logs.length - before - 1

  // 离线期间物品只增不减（采矿自动入仓/卸货），正差即产出
  const gained: string[] = []
  const after = new Map<string, number>()
  const snapshotAfter = (map: Record<string, number>): void => {
    for (const [id, units] of Object.entries(map)) {
      if (units > 0) after.set(id, (after.get(id) ?? 0) + units)
    }
  }
  snapshotAfter(state.fleet[state.shipId]?.cargo ?? {})
  snapshotAfter(state.warehouse.items)
  for (const [id, unitsNow] of after) {
    const unitsBefore = beforeCounts.get(id) ?? 0
    if (unitsNow > unitsBefore) gained.push(`${ctx.items.get(id)?.name ?? id}×${unitsNow - unitsBefore}`)
  }
  const minedText = gained.length > 0 ? `；离线采集 ${gained.join('、')}` : ''
  const tail = overflowMs > 0 ? `；超出上限的 ${formatDurationMs(overflowMs)} 未结算` : ''
  addLog(state, 'info', `离线结算完成：推进 ${formatDurationMs(deltaMs)}${tail}${minedText}，期间发生 ${eventCount} 条事件。`)
}
