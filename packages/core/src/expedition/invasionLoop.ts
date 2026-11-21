import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { weekendClockOf, weekendProgressAt } from '../weekendEvent'
import { autoLoopInvasionGalaxy, autoLoopWaitLabel, stopAutoLoopInvasion } from './loopState'
import { weekendZoneLiveAt, weekendAssaultDrawOf, weekendNoteAssaultDispatch } from '../weekendBounty'
import { bountyCooldownRemainingMs, bountyCooldownMsFor } from './cooldown'
import { manualSlotOf } from '../activityGate'
import type { CommandResult } from '../engine'
import { cargoUnitM3 } from '../inventory'
import { startLoopBattle } from './loop'

export function autoLoopInvasionPlanOf(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number = weekendClockOf(state),
  requestedGalaxyId: string | null = autoLoopInvasionGalaxy(state),
) {
  const ev = state.weekendEvent
  if (requestedGalaxyId === null) return { status: 'off' as const, galaxyId: null }
  if (!ev || ev.endedAtWallMs !== undefined) return { status: 'ended' as const, galaxyId: null }
  if (!weekendZoneLiveAt(state, requestedGalaxyId, nowWallMs)) return { status: 'invalid' as const, galaxyId: null }
  const remaining = ev.peripheryIds.filter(id => weekendProgressAt(state, ev, id, nowWallMs) < 1)
  const galaxyId = remaining.length > 0
    ? remaining.includes(requestedGalaxyId) ? requestedGalaxyId : remaining[0]!
    : weekendProgressAt(state, ev, ev.coreId, nowWallMs) < 1 ? ev.coreId : null
  if (galaxyId === null) return { status: 'complete' as const, galaxyId: null }
  const dispatch = weekendAssaultDrawOf(state, ctx, galaxyId, nowWallMs)
  if (!dispatch) return { status: 'invalid' as const, galaxyId: null }
  const remainingMs = bountyCooldownRemainingMs(state, dispatch.cardId)
  const totalMs = Math.max(1, bountyCooldownMsFor(state, ctx))
  return {
    status: 'ready' as const,
    galaxyId,
    dispatch,
    remainingMs,
    percent: remainingMs > 0 ? Math.min(100, Math.max(0, Math.round((1 - remainingMs / totalMs) * 100))) : null,
    waitFor: autoLoopWaitLabel(state) ?? (manualSlotOf(state) === 'lab' ? '实验室作业' : null),
  }
}

export function setAutoLoopInvasion(state: GameState, ctx: SimContext, galaxyId: string | null, nowWallMs = weekendClockOf(state)): CommandResult {
  const ev = state.weekendEvent
  if (galaxyId === null) {
    if (ev) delete ev.autoLoopGalaxyId
    addLog(state, 'combat', '重复出击已停止。', 'core.weekend.034')
    return { ok: true }
  }
  if (!ev || ev.endedAtWallMs !== undefined) {
    return { ok: false, error: '入侵活动已结束。', errorId: 'core.weekend.030' }
  }
  if (!weekendZoneLiveAt(state, galaxyId, nowWallMs)) {
    return { ok: false, error: '该星系当前没有被入侵。', errorId: 'core.weekend.031' }
  }
  const plan = autoLoopInvasionPlanOf(state, ctx, nowWallMs, galaxyId)
  if (plan.status === 'complete') return { ok: false, error: '外围与核心星系均已收复，旗舰需手动挑战。', errorId: 'core.invasionLoop.007' }
  if (plan.status !== 'ready') return { ok: false, error: '该星系当前没有被入侵。', errorId: 'core.weekend.031' }
  if (state.autoLoopAnomalyId !== null) {
    state.autoLoopAnomalyId = null
    state.autoLoopDroneFloor = null
    addLog(state, 'combat', '已停止常驻悬赏的重复清剿——改跑入侵重复出击。', 'core.weekend.032')
  }
  ev.autoLoopGalaxyId = plan.galaxyId
  const name = ctx.galaxies.get(plan.galaxyId)?.name ?? plan.galaxyId
  addLog(
    state,
    'combat',
    `重复出击已开启，从「${name}」开始；收复后自动切换，先外围、后核心，不自动挑战旗舰。`,
    'core.weekend.033',
    { p1: name },
  )
  return { ok: true }
}

export function advanceAutoLoopInvasion(state: GameState, ctx: SimContext, nowWallMs = weekendClockOf(state)): string | null {
  const currentGalaxyId = autoLoopInvasionGalaxy(state)
  if (currentGalaxyId === null) return null
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) {
    stopAutoLoopInvasion(state, '入侵活动已结束。', 'core.weekend.030')
    return '入侵活动已结束'
  }
  if (autoLoopWaitLabel(state) !== null) return null
  const plan = autoLoopInvasionPlanOf(state, ctx, nowWallMs)
  if (plan.status === 'complete') {
    delete ev.autoLoopGalaxyId
    const text = '外围与核心星系均已收复，重复出击已停止；旗舰需手动挑战。'
    addLog(state, 'combat', text, 'core.invasionLoop.002')
    state.autoLoopStopNotice = text
    return text
  }
  if (plan.status !== 'ready') {
    stopAutoLoopInvasion(state, '该星系当前没有被入侵。', 'core.weekend.031')
    return '该星系当前没有被入侵'
  }
  if (plan.waitFor !== null) return null
  const { galaxyId, dispatch } = plan
  if (galaxyId !== currentGalaxyId) {
    ev.autoLoopGalaxyId = galaxyId
    const from = ctx.galaxies.get(currentGalaxyId)?.name ?? currentGalaxyId
    const to = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
    const reclaimed = weekendProgressAt(state, ev, currentGalaxyId, nowWallMs) >= 1
    addLog(state, 'combat', reclaimed
      ? `「${from}」已收复，重复出击目标改为「${to}」。`
      : `重复出击先收复外围，目标改为「${to}」。`,
    reclaimed ? 'core.invasionLoop.001' : 'core.invasionLoop.003', reclaimed ? { p1: from, p2: to } : { p1: to })
  }
  const drawn = ctx.anomalies.get(dispatch.cardId)
  if (plan.remainingMs > 0) return null
  const lootM3 = (drawn?.loot ?? []).reduce((sum, row) => {
    const def = ctx.items.get(row.itemId)
    return sum + row.units * (def ? cargoUnitM3(state, def) : 0)
  }, 0)
  const r = startLoopBattle(state, dispatch.cardId, ctx, lootM3, {
    foeGalaxyId: galaxyId,
    ...(dispatch.rewardIsk > 0 ? { rewardIskOverride: dispatch.rewardIsk } : {}),
  })
  if (r.loopBlock) {
    const pre = r.loopBlock
    stopAutoLoopInvasion(state, pre.notice, pre.noticeId, pre.noticeParams)
    return pre.reason
  }
  if (!r.ok) {
    if (r.rangeConfirmation) return null
    if (bountyCooldownRemainingMs(state, dispatch.cardId) > 0) return null
    stopAutoLoopInvasion(state, r.error ?? '无法再出发。', r.errorId, r.errorParams)
    return r.error ?? '无法再出发'
  }
  weekendNoteAssaultDispatch(state)
  return null
}
