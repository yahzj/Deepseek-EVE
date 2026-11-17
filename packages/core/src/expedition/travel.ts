import { type GameState, HOME_GALAXY_ID, addLog } from '../state'
import type { SimContext, TravelEventDef } from '../types'
import { nearestStationGalaxyId, builtSiteAtGalaxy } from '../location'
import { shortestTravelMinutes, travelLegMs } from '../travel'
import { RETURN_LEG_MUL } from '../balance'
import { nextRandom, pickWeighted, nextInt } from '../rng'
import { ceilFinalQuantity } from '../quantity'
import { addItem } from '../inventory'

export const LOCAL_RETURN_MS = 120_000

export function localLegMs(state: GameState, fullMs: number): number {
  return state.debugQuick ? 1_000 : fullMs
}

export function returnBaseGalaxy(state: GameState, ctx: SimContext, fromGalaxy: string): string {
  return nearestStationGalaxyId(state, ctx, fromGalaxy)
}

export function returnBackMs(state: GameState, ctx: SimContext, targetGalaxy: string): { ms: number; base: string } {
  const base = returnBaseGalaxy(state, ctx, targetGalaxy)
  if (base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) return { ms: localLegMs(state, LOCAL_RETURN_MS), base }
  const mins = shortestTravelMinutes(ctx, base, targetGalaxy)
  const ms = Number.isFinite(mins) ? travelLegMs(state, ctx, mins) * RETURN_LEG_MUL : 0
  return { ms, base }
}

export function landAtReturnBase(state: GameState, ctx: SimContext, baseGalaxy: string): void {
  state.awayGalaxy = null
  state.dockedSite = builtSiteAtGalaxy(state, ctx, baseGalaxy)
}

export function rollTravelEvent(state: GameState, ctx: SimContext): string | null {
  if (ctx.travelEvents.length === 0) return null
  const luckLv = Math.min(5, state.skills.trained['galactic-happenings'] ?? 0)
  const chance = ctx.balance.travelEventChance * (1 + 0.15 * luckLv)
  if (nextRandom(state.rng) >= chance) return null
  const total = ctx.travelEvents.reduce((sum, e) => sum + e.weight, 0)
  if (total <= 0) return ctx.travelEvents[0]!.id
  return pickWeighted(state.rng, ctx.travelEvents, (e) => e.weight)?.id ?? ctx.travelEvents[0]!.id
}

export function maybeFireTravelEvent(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  if (!exp.active || !exp.eventId || exp.eventFired) return
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
