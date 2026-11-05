import { addLog, type GameState, type LogEntry, type LogKind, type LogParams } from './state'
import type { SimContext } from './types'
import { shortestTravelMinutes } from './travel'
export { reconcileDeparture } from './departureReconcile'

export type DepartureKind = 'mining' | 'salvaging' | 'expedition' | 'hauling' | 'deliver' | 'siteDeliver' | 'wormhole' | 'flagship'
export interface DepartureState {
  kind: DepartureKind
  shipId: string
  fromGalaxy: string
  fromSite: string | null
  toGalaxy: string
  undockMs: number
  gateMs: number
  progressMs: number
  arrivalLog?: Pick<LogEntry, 'kind' | 'text' | 'textId' | 'textParams'>
}

/** 船长确认：同星系 5 秒，每标称航程分钟增加 1 秒，上限 20 秒。 */
export function associationGateMs(ctx: SimContext, from: string, to: string): number {
  const minutes = shortestTravelMinutes(ctx, from, to)
  return Math.round(5_000 + Math.min(15, Math.max(0, Number.isFinite(minutes) ? minutes : 15)) * 1_000)
}

/** 在入口尚未清位置前取快照；作业或停止返航中不虚构停靠。 */
export function departureOrigin(state: GameState, ctx: SimContext): { galaxy: string; site: string | null; docked: boolean } {
  const m = state.mining, s = state.salvaging
  const galaxy = m.active && m.beltId ? ctx.belts.get(m.beltId)?.galaxyId
    : s.active ? s.galaxyId : state.awayGalaxy
  const site = state.dockedSite
  return { galaxy: galaxy ?? (site ? ctx.stations.get(site)?.galaxyId : undefined) ?? 'galaxy-hub', site,
    docked: !m.active && !s.active && !state.expedition.active && !state.hauling.active && !state.transit.active
      && !state.sideTasks.deliver && !state.shipReturns[state.shipId] && state.awayGalaxy === null }
}

export function beginDeparture(state: GameState, ctx: SimContext, kind: DepartureKind, toGalaxy: string,
  origin = departureOrigin(state, ctx)): number {
  const { undockMs, gateMs } = departureDurationMs(ctx, kind, origin.galaxy, toGalaxy, origin.docked)
  if (undockMs + gateMs === 0) return 0
  state.departure = { kind, shipId: state.shipId, fromGalaxy: origin.galaxy, fromSite: origin.site,
    toGalaxy, undockMs, gateMs, progressMs: 0 }
  return undockMs + gateMs
}

export function departureDurationMs(ctx: SimContext, kind: DepartureKind, from: string, to: string, docked = true) {
  const undockMs = docked ? 10_000 : 0
  const gateMs = kind === 'mining' || kind === 'salvaging' || kind === 'expedition' ? associationGateMs(ctx, from, to) : 0
  return { undockMs, gateMs, totalMs: undockMs + gateMs }
}

/** 只消费本活动的等待时间；允许同次大推进继续使用余量。 */
export function consumeDeparture(state: GameState, kind: DepartureKind, deltaMs: number): number {
  const leg = state.departure
  if (!leg || leg.kind !== kind) return deltaMs
  const take = Math.min(deltaMs, Math.max(0, leg.undockMs + leg.gateMs - leg.progressMs))
  leg.progressMs += take
  if (leg.progressMs >= leg.undockMs + leg.gateMs) {
    delete state.departure
    const log = leg.arrivalLog
    if (log) addLog(state, log.kind, log.text, log.textId, log.textParams)
  }
  return deltaMs - take
}

/** 抵达类日志随出发行程保存，取消不播报，真实到达后只播报一次。 */
export function departureArrivalLog(state: GameState, kind: LogKind, text: string, textId: string, textParams: LogParams): void {
  if (state.departure) state.departure.arrivalLog = { kind, text, textId, textParams }
  else addLog(state, kind, text, textId, textParams)
}

export function departureView(state: GameState) {
  const leg = state.departure
  if (!leg) return null
  const undocking = leg.progressMs < leg.undockMs
  const totalMs = undocking ? leg.undockMs : leg.gateMs
  const elapsed = undocking ? leg.progressMs : leg.progressMs - leg.undockMs
  return { kind: leg.kind, undocking, textId: undocking ? 'core.departure.001' : 'core.departure.002',
    remainingMs: Math.max(0, totalMs - elapsed), percent: Math.min(100, Math.max(0, elapsed / Math.max(1, totalMs) * 100)) }
}

/** 取消尚未离港的可取消活动时恢复原泊位；已离港交回各活动原召回规则。 */
export function cancelDeparture(state: GameState, kind: DepartureKind): boolean {
  const leg = state.departure
  if (!leg || leg.kind !== kind) return false
  const docked = leg.progressMs < leg.undockMs
  if (docked) { state.awayGalaxy = null; state.dockedSite = leg.fromSite }
  delete state.departure
  return docked
}

export function cleanDeparture(raw: unknown): DepartureState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!['mining', 'salvaging', 'expedition', 'hauling', 'deliver', 'siteDeliver', 'wormhole', 'flagship'].includes(String(r.kind))) return undefined
  if (typeof r.shipId !== 'string' || !r.shipId || typeof r.fromGalaxy !== 'string' || !r.fromGalaxy
    || typeof r.toGalaxy !== 'string' || !r.toGalaxy || !(r.fromSite === null || typeof r.fromSite === 'string')) return undefined
  if (![r.undockMs, r.gateMs, r.progressMs].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return undefined
  const undockMs = Math.min(10_000, Math.floor(r.undockMs as number))
  const gateMs = Math.min(20_000, Math.floor(r.gateMs as number))
  if (undockMs + gateMs <= 0) return undefined
  const log = r.arrivalLog && typeof r.arrivalLog === 'object' ? r.arrivalLog as Record<string, unknown> : undefined
  const validLog = log && ['core.mining.016', 'core.salvaging.015', 'core.expedition.040'].includes(String(log.textId))
    && ['industry', 'salvage', 'combat'].includes(String(log.kind)) && typeof log.text === 'string'
  const textParams = validLog && log.textParams && typeof log.textParams === 'object'
    ? Object.fromEntries(Object.entries(log.textParams).filter(([, value]) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))) : {}
  return { kind: r.kind as DepartureKind, shipId: r.shipId, fromGalaxy: r.fromGalaxy, fromSite: r.fromSite as string | null,
    toGalaxy: r.toGalaxy, undockMs, gateMs, progressMs: Math.min(undockMs + gateMs, Math.floor(r.progressMs as number)),
    ...(validLog ? { arrivalLog: { kind: log.kind as LogKind, text: log.text as string, textId: log.textId as string, textParams } } : {}) }
}
