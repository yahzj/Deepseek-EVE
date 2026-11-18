import type { CoreBlockReason } from './engine'
import type { GameState } from './state'
import type { SimContext } from './types'
import { addLog, haltActivityForSwitch } from './state'
import { combatEscortBlock } from './combat/command/locks'
import { combatRosterOf, makeCombatSortie } from './combat/command/roster'
import { commandBudgetOf } from './combat/command/rules'
import { reconcileDeparture } from './departureReconcile'

export type MainActivityKind =
  | 'mining'
  | 'salvaging'
  | 'hauling'
  | 'wormholeScan'
  | 'standby'
  | 'refine'
  | 'manufacturing'
  | 'expedition'
  | 'deliver'
  | 'siteDeliver'
  | 'lab'

export const AUTO_HALT_KINDS: readonly MainActivityKind[] = [
  'mining',
  'salvaging',
  'wormholeScan',
  'standby',
  'siteDeliver',
]

export const WARN_KINDS: readonly MainActivityKind[] = [
  'hauling',
  'expedition',
  'deliver',
  'lab',
  'refine',
  'manufacturing',
]

export const INTERRUPTIBLE: Readonly<Record<MainActivityKind, boolean>> = {
  mining: true,
  salvaging: true,
  hauling: true,
  wormholeScan: true,
  standby: true,
  refine: true,
  manufacturing: true,
  expedition: false,
  deliver: false,
  siteDeliver: true,
  lab: true,
}

export const HALT_COST: Readonly<Record<MainActivityKind, string>> = {
  mining: '本趟原矿留在船上，舰船返港',
  salvaging: '本趟残骸留在船上，舰船返港',
  hauling: '本段报酬拿不到（报酬到站才结）',
  wormholeScan: '扫描进度保留',
  standby: '舰船召回母港',
  refine: '停炉——当前那一批的进度丢弃',
  manufacturing: '停线——当前那一批的进度丢弃',
  expedition: '远征无法中断',
  deliver: '投送不可取消',
  siteDeliver: '交付循环停止、舰船返港，本趟建材留在船上',
  lab: '停线——当前那一批的进度丢弃',
}

export const HALT_COST_ID: Readonly<Record<MainActivityKind, string>> = {
  mining: 'core.activity.007',
  salvaging: 'core.activity.008',
  hauling: 'core.activity.009',
  wormholeScan: 'core.activity.010',
  standby: 'core.activity.011',
  refine: 'core.activity.012',
  manufacturing: 'core.activity.013',
  expedition: 'core.activity.014',
  deliver: 'core.activity.015',
  siteDeliver: 'core.activity.016',
  lab: 'core.activity.017',
}

export const KIND_LABEL: Readonly<Record<MainActivityKind, string>> = {
  mining: '开采',
  salvaging: '打捞',
  hauling: '长途运输',
  wormholeScan: '扫描虫洞',
  standby: '掩护巡逻',
  refine: '亲自开炉',
  manufacturing: '亲自开线',
  expedition: '远征',
  deliver: '快递投送',
  siteDeliver: '建站交付',
  lab: '实验室',
}

export const ACTIVITY_LABEL_ID: Readonly<Record<MainActivityKind, string>> = {
  mining: 'ui.Expedition.144',
  salvaging: 'ui.Wormhole.107',
  hauling: 'ui.MapPage.006',
  wormholeScan: 'ui.MapPage.007',
  standby: 'core.activity.001',
  refine: 'core.activity.002',
  manufacturing: 'core.activity.003',
  expedition: 'core.activity.004',
  deliver: 'core.activity.005',
  siteDeliver: 'core.activity.006',
  lab: 'core.activity.018',
}

export function mainActivityOf(state: GameState): MainActivityKind | null {
  if (state.mining.active) return 'mining'
  if (state.salvaging.active) return 'salvaging'
  if (state.hauling.active) return 'hauling'
  if (state.sideTasks.deliver !== null) return 'deliver'
  if (state.transit.active && state.transit.delivery !== null) return 'siteDeliver'
  if (state.standby.active) return 'standby'
  if (state.wormholeScan?.active === true) return 'wormholeScan'
  if (state.expedition.active) return 'expedition'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return 'refine'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return 'manufacturing'
  if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return 'lab'
  return null
}

export function manualSlotOf(state: GameState): 'refine' | 'manufacturing' | 'lab' | null {
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return 'refine'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return 'manufacturing'
  if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return 'lab'
  return null
}

export function cannotInterruptReason(state: GameState): string | null {
  if (state.expedition.battle !== null) return '战斗中：这一场打完才能切换主控活动。'
  if (state.encounter.active && state.encounter.battle !== null && state.encounter.shipId === state.shipId) {
    return '战斗中：这一场打完才能切换主控活动。'
  }
  if (state.wormhole.run?.battle != null) return '战斗中：这一场打完才能切换主控活动。'
  if (state.wormhole.run != null) {
    return '本趟虫洞探索还没收场：先撤离，才能切换主控活动。'
  }
  if (state.transit.active && state.transit.delivery === null) return '换港返航途中：抵达后就能切换主控活动。'
  return null
}

export interface GateVerdict {
  action: 'ok' | 'halt' | 'confirm' | 'reject'
  current?: MainActivityKind
  message?: string
  messageId?: string
  messageParams?: Readonly<Record<string, string>>
  interruptible?: boolean
}

export const ACTIVITY_CONFIRM_ID = 'core.activityGate.002'

export function logAutoHalt(state: GameState, kind: MainActivityKind, detail?: CoreBlockReason): void {
  const p1 = KIND_LABEL[kind]
  const p2 = HALT_COST[kind]
  const p1Id = ACTIVITY_LABEL_ID[kind]
  const p2Id = HALT_COST_ID[kind]
  if (detail !== undefined && detail.error.length > 0) {
    const detailParams: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(detail.errorParams ?? {})) {
      if (typeof v === 'string' || typeof v === 'number') detailParams[k] = v
    }
    addLog(state, 'warn', `已自动停止「${p1}」：${p2}。（${detail.error}）`, 'core.activityGate.007', {
      p1,
      p1Id,
      p2,
      p2Id,
      p4: detail.error,
      ...(detail.errorId !== undefined ? { p4Id: detail.errorId, ...prefixParams(detailParams, 'p4') } : {}),
    })
    return
  }
  addLog(state, 'warn', `已自动停止「${p1}」：${p2}。`, 'core.activityGate.001', { p1, p1Id, p2, p2Id })
}

function prefixParams(src: Readonly<Record<string, string | number>>, prefix: string): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(src)) out[`${prefix}${k}`] = v
  return out
}

export function gateMainActivity(state: GameState, next: MainActivityKind): GateVerdict {
  return verdictOf(state, next)
}

function verdictOf(state: GameState, next: MainActivityKind | null): GateVerdict {
  reconcileDeparture(state)
  const locked = cannotInterruptReason(state)
  if (locked !== null) {
    const id = locked.includes('战斗中')
      ? 'core.activityGate.004'
      : locked.includes('虫洞')
        ? 'core.activityGate.005'
        : 'core.activityGate.006'
    return { action: 'reject', message: locked, messageId: id }
  }
  if (state.departure) return { action: 'reject', message: 'departure-in-progress', messageId: state.departure.progressMs < state.departure.undockMs ? 'core.departure.001' : 'core.departure.002' }
  if (state.hauling.active && state.hauling.fleetLeg && next !== 'hauling') return { action: 'reject', message: 'hauling-return-required', messageId: 'core.industrial.006' }
  const current = mainActivityOf(state)
  if (current === null) return { action: 'ok' }
  if (next !== null && current === next) return { action: 'ok' }
  const cost = HALT_COST[current]
  const costId = HALT_COST_ID[current]
  const label = KIND_LABEL[current]
  const labelId = ACTIVITY_LABEL_ID[current]
  if (AUTO_HALT_KINDS.includes(current)) return { action: 'halt', current }
  const interruptible = INTERRUPTIBLE[current] === true
  const messageId = interruptible ? ACTIVITY_CONFIRM_ID : 'core.activityGate.003'
  const message = interruptible
    ? `${label}进行中：切换会中断它——${cost}。再点一次即确认：自动停止并开始新活动。`
    : `${label}进行中：${cost}——这一趟不能中断，等它结束再切换。`
  return {
    action: interruptible ? 'confirm' : 'reject',
    current,
    message,
    messageId,
    messageParams: { p1: label, p1Id: labelId, p2: cost, p2Id: costId },
    interruptible,
  }
}

export function gateMainActivityHandoff(state: GameState, warnConfirmed = true): GateVerdict {
  const v = verdictOf(state, null)
  if (v.action === 'confirm' && warnConfirmed && v.current !== undefined) {
    return { action: 'halt', current: v.current }
  }
  return v
}

export interface ActivityGateSkip {
  ok: false
  error: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
}

function skipOf(v: GateVerdict): ActivityGateSkip {
  return {
    ok: false,
    error: v.message ?? '',
    ...(v.messageId !== undefined ? { errorId: v.messageId } : {}),
    ...(v.messageParams !== undefined ? { errorParams: v.messageParams } : {}),
  }
}

export function applyActivityGate(state: GameState, next: MainActivityKind, ctx?: SimContext): ActivityGateSkip | null {
  const v = gateMainActivity(state, next)
  if (ctx && (v.action === 'ok' || v.action === 'halt') && ['mining', 'salvaging', 'hauling', 'standby', 'deliver', 'siteDeliver'].includes(next)) {
    const squad = combatRosterOf(state)
    const budget = commandBudgetOf(state, ctx, squad)
    if (!budget.ok) return { ok: false, error: budget.error!, errorId: budget.errorId, errorParams: budget.errorParams }
    const blocked = combatEscortBlock(state, squad)
    if (blocked) return { ok: false, ...blocked }
  }
  if (v.action === 'ok') {
    delete state.pendingStationActivity
    if (ctx && ['mining', 'salvaging', 'hauling', 'standby', 'deliver', 'siteDeliver'].includes(next)) state.combatEscort = makeCombatSortie(combatRosterOf(state), state.shipId)
    return null
  }
  if (v.action === 'halt') {
    delete state.pendingStationActivity
    if (v.current !== undefined) haltAndLog(state, ctx, v.current)
    if (ctx && ['mining', 'salvaging', 'hauling', 'standby', 'deliver', 'siteDeliver'].includes(next)) state.combatEscort = makeCombatSortie(combatRosterOf(state), state.shipId)
    return null
  }
  return skipOf(v)
}

export function applyActivityHandoff(state: GameState, ctx: SimContext | undefined, warnConfirmed = true): ActivityGateSkip | null {
  const v = gateMainActivityHandoff(state, warnConfirmed)
  if (v.action === 'ok') {
    delete state.pendingStationActivity
    return null
  }
  if (v.action === 'halt') {
    delete state.pendingStationActivity
    if (v.current !== undefined) haltAndLog(state, ctx, v.current)
    return null
  }
  return skipOf(v)
}

export function haltCurrentActivity(state: GameState, ctx?: SimContext): MainActivityKind | null {
  const current = mainActivityOf(state)
  if (current === null) return null
  if (!AUTO_HALT_KINDS.includes(current) && INTERRUPTIBLE[current] !== true) return null
  haltAndLog(state, ctx, current)
  return current
}

function haltAndLog(state: GameState, ctx: SimContext | undefined, kind: MainActivityKind): void {
  void ctx
  haltActivityForSwitch(state, kind)
  logAutoHalt(state, kind)
}

export function pilotUnavailableReason(state: GameState): string | null {
  if (!state.fleet[state.shipId]) return '舰队里找不到当前驾驶的舰船——请到舰船页检查舰队。'
  if (state.aiAssignments[state.shipId] !== undefined) {
    return '当前驾驶的舰船正被 AI 执勤占用（采矿/打捞/掩护巡逻）——请先取消该船 AI 任务，或切换其它舰船。'
  }
  return null
}
