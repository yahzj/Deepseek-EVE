import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { applyActivityGate, mainActivityOf, type MainActivityKind } from './activityGate'
import { busyLabel } from './busyLabels'
import type { ActivityView } from './activity'
import { HOME_GALAXY_ID } from './state'

export type StationAction =
  | { kind: 'refine' | 'recycle' | 'unbox'; itemId: string }
  | { kind: 'manufacturing'; blueprintId: string }
  | { kind: 'lab'; recipeId: string }
  | { kind: 'hauling'; aSiteId: string | null; bSiteId: string | null }
  | { kind: 'siteDeliver'; siteId: string }

export interface PendingStationActivity {
  shipId: string
  action: StationAction
}

export function stationActionKind(action: StationAction): MainActivityKind {
  return action.kind === 'recycle' || action.kind === 'unbox' ? 'refine' : action.kind
}

/** 只认当前舰采矿/打捞及其停止返航，不把战斗或其他在途活动变成可排队。 */
export function stationActivityWaitsForReturn(state: GameState): boolean {
  if (state.mining.active && state.mining.beltId) return true
  if (state.salvaging.active && state.salvaging.galaxyId) return true
  const ret = state.shipReturns[state.shipId]
  return mainActivityOf(state) === null && !!ret && (ret.reason === 'miningStop' || ret.reason === 'salvageStop')
}

/** 前置已通过才登记；停机仍走原gate，航程由原返航账本推进。 */
export function queueStationActivity(state: GameState, ctx: SimContext, action: StationAction): CommandResult | null {
  if (!stationActivityWaitsForReturn(state)) return null
  const previousReturn = state.shipReturns[state.shipId]
  const current = state.mining.active ? state.mining : state.salvaging.active ? state.salvaging : null
  const progress = current?.phase === 'returning' ? current.phaseAccMs : current?.phase === 'outbound' ? current.phaseAccMs * 2 : 0
  const skip = applyActivityGate(state, stationActionKind(action), ctx)
  if (skip) return skip
  // 真值腿长由引擎修正；新建账保留已走相位，替换待办不触碰既有返航。
  if (!previousReturn && state.shipReturns[state.shipId]) {
    const ret = state.shipReturns[state.shipId]!
    ret.phaseAccMs = Math.max(0, progress)
    ret.legMs = Math.max(ret.legMs, ret.phaseAccMs + 1)
  }
  state.pendingStationActivity = { shipId: state.shipId, action: { ...action } }
  return { ok: true, queued: true }
}

export function cancelPendingStationActivity(state: GameState): boolean {
  if (!state.pendingStationActivity) return false
  delete state.pendingStationActivity
  return true
}

/** 等待目标与返航进度同源，取消只作用于待办。 */
export function pendingStationActivityView(state: GameState, ctx: SimContext): ActivityView | null {
  const pending = state.pendingStationActivity
  if (!pending || pending.shipId !== state.shipId || !state.fleet[pending.shipId]) return null
  const ret = state.shipReturns[pending.shipId]
  if (!ret) return null
  const action = pending.action
  let label: string
  let kind: ActivityView['kind']
  switch (action.kind) {
    case 'refine': case 'recycle': case 'unbox':
      label = ctx.items.get(action.itemId)?.name ?? action.itemId
      kind = 'refine'
      break
    case 'manufacturing':
      label = ctx.blueprints.get(action.blueprintId)?.name ?? ctx.shipBlueprints.get(action.blueprintId)?.name ?? action.blueprintId
      kind = 'manufacture'
      break
    case 'lab':
      label = ctx.labRecipes.get(action.recipeId)?.name ?? action.recipeId
      kind = 'lab'
      break
    case 'siteDeliver':
      label = ctx.stations.get(action.siteId)?.name ?? action.siteId
      kind = 'transit'
      break
    case 'hauling':
      label = [action.aSiteId, action.bSiteId].map(id => id === null ? ctx.galaxies.get(HOME_GALAXY_ID)?.name ?? HOME_GALAXY_ID : ctx.stations.get(id)?.name ?? id).join(' / ')
      kind = 'hauling'
  }
  const sub = busyLabel('unload')
  return {
    id: `pending-station-${pending.shipId}`, kind, label, sub: sub.error, subId: sub.errorId,
    percent: ret.legMs > 0 ? Math.min(100, Math.max(0, ret.phaseAccMs / ret.legMs * 100)) : 0,
    remainingMs: Math.max(0, ret.legMs - ret.phaseAccMs), stopable: true, stop: 'cancel-station-pending',
  }
}

/** 无内容表依赖的严格白名单，目标和权限在到港时重验。 */
export function cleanPendingStationActivity(raw: unknown): PendingStationActivity | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const text = (entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0
  if (!text(value.shipId) || !value.action || typeof value.action !== 'object') return undefined
  const action = value.action as Record<string, unknown>
  let clean: StationAction
  switch (action.kind) {
    case 'refine': case 'recycle': case 'unbox':
      if (!text(action.itemId)) return undefined
      clean = { kind: action.kind, itemId: action.itemId }
      break
    case 'manufacturing':
      if (!text(action.blueprintId)) return undefined
      clean = { kind: action.kind, blueprintId: action.blueprintId }
      break
    case 'lab':
      if (!text(action.recipeId)) return undefined
      clean = { kind: action.kind, recipeId: action.recipeId }
      break
    case 'siteDeliver':
      if (!text(action.siteId)) return undefined
      clean = { kind: action.kind, siteId: action.siteId }
      break
    case 'hauling':
      if (!(action.aSiteId === null || text(action.aSiteId)) || !(action.bSiteId === null || text(action.bSiteId))) return undefined
      if (action.aSiteId === action.bSiteId) return undefined
      clean = { kind: action.kind, aSiteId: action.aSiteId, bSiteId: action.bSiteId }
      break
    default: return undefined
  }
  return { shipId: value.shipId, action: clean }
}
