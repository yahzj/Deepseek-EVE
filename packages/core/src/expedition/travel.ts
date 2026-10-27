/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, HOME_GALAXY_ID, addLog } from '../state'
import type { SimContext, TravelEventDef } from '../types'
import { nearestStationGalaxyId, builtSiteAtGalaxy } from '../location'
import { shortestTravelMinutes, travelLegMs } from '../travel'
import { RETURN_LEG_MUL } from '../balance'
import { nextRandom, pickWeighted, nextInt } from '../rng'
import { ceilFinalQuantity } from '../quantity'
import { addItem } from '../inventory'

/** 本地悬赏返航段（2026-09-08 船长定）：目标星系 = 返航基准（母港本地/建成站本地）时，
 * 返港固定 120s（= balance.mining.localLegMs 本地满载单程，对齐矿工本地返航成本；防零航程白刷）。
 * 2026-09-10 修复：调试模式（debugQuick）下与采矿/打捞/返航空间站的本地腿同口径压到 1 秒——
 * 此前写死 120s，调试时"战斗后的返航"永远 2 分钟，改不动。 */
export const LOCAL_RETURN_MS = 120_000

/** 本地段时长的调试快进（与 travelLegMs / miningReturnLegMs / legMsFor 的 debugQuick 口径一致） */
export function localLegMs(state: GameState, fullMs: number): number {
  return state.debugQuick ? 1_000 : fullMs
}

/** 自动返航基准（2026-09-08 船长定：所有自动返航一律选"最近已建成空间站"，无建成副站 = 母港） */
export function returnBaseGalaxy(state: GameState, ctx: SimContext, fromGalaxy: string): string {
  return nearestStationGalaxyId(state, ctx, fromGalaxy)
}

/** 从"战场星系"转入返航段的统一时长：基准 = 目标星系最近已建成站；
 * 目标星系即基准（母港本地 / 建成站本地）→ 固定 LOCAL_RETURN_MS（调试模式 1 秒）；
 * 否则 **单程 × `RETURN_LEG_MUL`**（2026-09-14 船长「修正倍率回1倍」⇒ 现值 1×；旧值 2× 作废）。
 * 航路不可达时返回 0（调用方用 `outMs × RETURN_LEG_MUL` 兜底）。 */
export function returnBackMs(state: GameState, ctx: SimContext, targetGalaxy: string): { ms: number; base: string } {
  const base = returnBaseGalaxy(state, ctx, targetGalaxy)
  if (base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) return { ms: localLegMs(state, LOCAL_RETURN_MS), base }
  const mins = shortestTravelMinutes(ctx, base, targetGalaxy)
  const ms = Number.isFinite(mins) ? travelLegMs(state, ctx, mins) * RETURN_LEG_MUL : 0
  return { ms, base }
}

/** 返航到港落点（2026-09-08：基准星系有已建成副站 → 停靠该站；否则母港） */
export function landAtReturnBase(state: GameState, ctx: SimContext, baseGalaxy: string): void {
  state.awayGalaxy = null
  state.dockedSite = builtSiteAtGalaxy(state, ctx, baseGalaxy)
}

/** 出发抽"途中事件"（沿用 M5；去程取消后在出发瞬间触发） */
export function rollTravelEvent(state: GameState, ctx: SimContext): string | null {
  if (ctx.travelEvents.length === 0) return null
  // 星际奇遇学（galactic-happenings）：途中事件触发率 ×1.15/级
  const luckLv = Math.min(5, state.skills.trained['galactic-happenings'] ?? 0)
  const chance = ctx.balance.travelEventChance * (1 + 0.15 * luckLv)
  if (nextRandom(state.rng) >= chance) return null
  const total = ctx.travelEvents.reduce((sum, e) => sum + e.weight, 0)
  if (total <= 0) return ctx.travelEvents[0]!.id // ⚠ 与改前一致：total ≤ 0 时**在抽随机数之前**早退
  // 2026-09-12 审计 B3：改走单点 `pickWeighted`（与原先手写扣减循环 `roll -= w; roll < 0` 逐位一致）；
  // 无中选兜底 = 首个事件（与改前末尾 return 相同）
  return pickWeighted(state.rng, ctx.travelEvents, (e) => e.weight)?.id ?? ctx.travelEvents[0]!.id
}

export function maybeFireTravelEvent(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  if (!exp.active || !exp.eventId || exp.eventFired) return
  // 旧档/遗留去程相位在此按"中点时刻"触发；新指令（去程取消）由 startExpedition 出发瞬间直接触发
  if (state.gameMs < exp.finishAtGameMs - Math.floor(exp.outMs / 2)) return
  const eventDef = ctx.travelEvents.find((e) => e.id === exp.eventId)
  exp.eventFired = true
  if (!eventDef) return
  applyTravelEvent(state, ctx, eventDef)
}

export function applyTravelEvent(state: GameState, ctx: SimContext, eventDef: TravelEventDef): void {
  const effect = eventDef.effect
  if (effect.kind === 'none') {
    addLog(state, 'event', eventDef.text)
    return
  }
  if (effect.kind === 'isk') {
    const span = Math.max(0, effect.max - effect.min)
    const amount = ceilFinalQuantity(effect.min + nextInt(state.rng, span + 1))
    state.wallet.isk += amount
    addLog(state, 'trade', `${eventDef.text}（+${amount.toLocaleString('zh-CN')} 信用点）`, 'core.expedition.038', {
      p1: eventDef.text,
      p2: amount.toLocaleString('zh-CN'),
    })
    return
  }
  if (effect.kind === 'mineral') {
    const def = ctx.items.get(effect.itemId)
    if (!def) {
      addLog(state, 'warn', '途中事件出了岔子，本次事件落空。', 'core.expedition.025')
      return
    }
    const units = ceilFinalQuantity(effect.units)
    addItem(state, effect.itemId, units)
    addLog(state, 'event', `${eventDef.text}（获得 ${def.name}×${units}）`, 'core.expedition.039', {
      p1: eventDef.text,
      p2: def.name,
      p3: units,
    })
  }
}
