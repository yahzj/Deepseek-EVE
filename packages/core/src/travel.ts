/**
 * 星图航行（V12.1）：飞船跃迁速度 × 航行加速技能族 → 星系间实际耗时。
 * 设计依据（EVE 语义趋同）：data 船表已带 warpSpeedAus（AU/s，2.8~3.9，V10.5b 数据补强时填入）；
 * 实际耗时 = 标称分钟 × 60s × (warpRefAus / 船跃迁) × ∏(1 − cutPerLevel × 技能等级)。
 * - 无跃迁数据的船（测试替身/未知 id）→ 按 warpRefAus 计（因子 1.0，行为与旧版一致，测试不破坏）；
 * - 只缩放"星系际航行"耗时：采矿带内周转基础、交火等固定时长不缩放；
 * - 星图最短路径规划仍用静态边权 travelMinutes（本模块只决定"走完要多久"）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import { fleetDefOf } from './instances'

/** 星系间最短航程（分钟；图论静态边权，V12.1 起仅路径规划用，实际耗时见 travelLegMs） */
export function shortestTravelMinutes(ctx: SimContext, fromGalaxyId: string, toGalaxyId: string): number {
  if (fromGalaxyId === toGalaxyId) return 0
  const adjacency = new Map<string, Array<{ to: string; minutes: number }>>()
  const ensure = (id: string): void => {
    if (!adjacency.has(id)) adjacency.set(id, [])
  }
  for (const edge of ctx.galaxyEdges) {
    ensure(edge.from)
    ensure(edge.to)
    adjacency.get(edge.from)!.push({ to: edge.to, minutes: edge.travelMinutes })
    adjacency.get(edge.to)!.push({ to: edge.from, minutes: edge.travelMinutes })
  }
  if (!adjacency.has(fromGalaxyId) || !adjacency.has(toGalaxyId)) return Infinity
  const dist = new Map<string, number>()
  const visited = new Set<string>()
  dist.set(fromGalaxyId, 0)
  for (;;) {
    let current: string | null = null
    let best = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d
        current = id
      }
    }
    if (current === null) break
    if (current === toGalaxyId) return best
    visited.add(current)
    for (const next of adjacency.get(current)!) {
      if (visited.has(next.to)) continue
      const alt = best + next.minutes
      if (alt < (dist.get(next.to) ?? Infinity)) dist.set(next.to, alt)
    }
  }
  return Infinity
}

/** 当前有效跃迁速度（AU/s）：取船表 warpSpeedAus，缺省回落到基准（不加速也不减速） */
export function warpSpeedAus(state: GameState, ctx: SimContext, shipId?: string | null): number {
  const bal = ctx.balance.travel
  // v17：shipId 是舰队实例 uid → 经实例查船型数据（defId 兜底兼容直传 defId 的旧调用）
  const def = fleetDefOf(state, ctx, shipId ?? state.shipId) ?? ctx.ships.get(shipId ?? state.shipId)
  const raw = def?.warpSpeedAus
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return bal.warpRefAus
  return Math.min(12, Math.max(0.5, raw))
}

/** 航行时间因子（<1 = 更快；>1 = 更慢；下限 minFactor 防极端组合压没航程） */
export function travelTimeFactor(state: GameState, ctx: SimContext, shipId?: string | null): number {
  const bal = ctx.balance.travel
  // 防御：极旧的自定义 balance 无 travel 段 → 不缩放（因子 1.0）
  if (!bal || typeof bal.warpRefAus !== 'number' || !Array.isArray(bal.skillIds)) return 1
  let f = bal.warpRefAus / warpSpeedAus(state, ctx, shipId)
  for (const skillId of bal.skillIds) {
    const lv = state.skills.trained[skillId] ?? 0
    if (lv > 0) f *= 1 - bal.cutPerLevel * lv
  }
  return Math.max(bal.minFactor, f)
}

/** 标称分钟 → 实际航行毫秒（星系际航行唯一换算入口；调用点负责"出发时锁定"语义） */
export function travelLegMs(state: GameState, ctx: SimContext, travelMinutes: number, shipId?: string | null): number {
  if (!Number.isFinite(travelMinutes) || travelMinutes <= 0) return 0
  if (state.debugQuick) return 1000 // 调试模式：星系际航行固定 1 秒
  return Math.max(1, Math.round(travelMinutes * 60_000 * travelTimeFactor(state, ctx, shipId)))
}

/** 展示用：标称分钟 → 实际分钟（四舍五入；UI 的"单程约 X 分钟"用） */
export function travelMinutesEff(
  state: GameState,
  ctx: SimContext,
  travelMinutes: number,
  shipId?: string | null
): number {
  if (!Number.isFinite(travelMinutes) || travelMinutes <= 0) return travelMinutes
  if (state.debugQuick) return 1 // 调试模式展示：1 分钟
  return Math.max(1, Math.round(travelMinutes * travelTimeFactor(state, ctx, shipId)))
}
