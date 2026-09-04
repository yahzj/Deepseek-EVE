/**
 * T5-B（v17）舰船实例查询：实例 uid → 船型数据 / 显示名。
 * 零依赖（只 import type + labels 纯字符串工具），任何模块可安全引用——
 * 避免 travel/location/shipyard 等模块相互引用造成环。
 */
import type { GameState } from './state'
import type { ShipDef, SimContext } from './types'
import { uidDefId, uidSeqNum } from './labels'

/** 该实例的船型数据（uid → fleet 条目 → def；fleet 外/数据缺失返回 undefined） */
export function fleetDefOf(state: GameState, ctx: SimContext, uid: string): ShipDef | undefined {
  const entry = state.fleet[uid]
  if (!entry) return undefined
  const defId = entry.defId ?? uidDefId(uid) // 容错：异常旧条目缺 defId 时按 uid 前缀解析
  return ctx.ships.get(defId)
}

/**
 * 一艘舰船的显示名（全链统一入口）：
 * 自定义名 ?? 船型名（同型第 2 艘起的实例自动带「 #N」；改名后完全由自定义名决定）。
 */
export function shipDisplayName(state: GameState, ctx: SimContext, uid: string): string {
  const entry = state.fleet[uid]
  if (!entry) return uid
  if (entry.customName) return entry.customName
  const defId = entry.defId ?? uidDefId(uid)
  const defName = ctx.ships.get(defId)?.name ?? defId
  const n = uidSeqNum(uid)
  return n > 1 ? `${defName} #${n}` : defName
}
