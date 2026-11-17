import { type GameState, shipLockedInWormhole, addLog } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { pilotUnavailableReason, haltCurrentActivity, applyActivityGate } from '../activityGate'
import { standingOf, DSI_FACTION_ID } from '../standing'
import { commandBudgetOf } from '../combat/command/rules'
import { combatRosterOf, makeCombatSortie } from '../combat/command/roster'
import { combatEscortBlock } from '../combat/command/locks'
import { detachExpeditionReturn } from '../combat/command/return'
import { startFleetBattleFor } from '../combat/startFleet'
import { actionBlockReason, markExplored } from '../explore'
import { bountyCooldownRemainingMs } from './cooldown'
import { type LairTier, isLairCandidate, lairNameOf } from '../lairs'
import { weekendZoneLiveAt } from '../weekendBounty'
import { weekendClockOf, weekendFoeCardsSelfPriced, weekendAssaultThreatOf } from '../weekendEvent'
import { withBattleRangeCheck } from '../battleRangeMemory'
import { isFactionBounty } from '../sideTasks'
import { originGalaxyOf } from '../location'
import { shortestTravelMinutes, travelLegMs } from '../travel'
import { ceilFinalQuantity } from '../quantity'
import { calcPower } from './tactics'
import { rollTravelEvent } from './travel'
import { shipDisplayName } from '../instances'
import { weekendBattleInvolvedOf } from '../weekendBattle'
import { startBattleFor, createPlayerSpec } from '../combat'
import { autoLoopInvasionGalaxy } from './loopState'
import { beginDeparture, departureOrigin, departureArrivalLog, reconcileDeparture } from '../departure'

export function expeditionPreflight(state: GameState, ctx: SimContext, anomalyId: string, galaxyId?: string): CommandResult {
  reconcileDeparture(state)
  if (state.departure) return { ok: false, errorId: state.departure.progressMs < state.departure.undockMs ? 'core.departure.001' : 'core.departure.002' }
  detachExpeditionReturn(state)
  if (!state.expedition.active && state.expedition.sortie) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。`, errorId: 'core.expedition.003', errorParams: { p1: anomalyId } }
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  const standing = standingOf(state, DSI_FACTION_ID)
  if (standing < anomaly.standingReq) {
    return {
      ok: false,
      error: `需要「深空工业协会」声望 ${anomaly.standingReq}（累计 ${standing}），多完成低级目标攒声望。`,
      errorId: 'core.expedition.036',
      errorParams: { p1: anomaly.standingReq, p2: standing },
    }
  }
  const block = actionBlockReason(state, galaxyId ?? anomaly.galaxyId)
  if (block) return { ok: false, error: block, ...(galaxyId !== undefined ? { errorId: 'core.invasionLoop.008' } : {}) }
  const cd = bountyCooldownRemainingMs(state, anomalyId)
  if (cd > 0) {
    return {
      ok: false,
      error: `「${anomaly.name}」冷却中：重复出击需等待约 ${Math.max(1, Math.round(cd / 1000))} 秒。`,
      errorId: 'core.expedition.037',
      errorParams: { p1: anomaly.name, p2: Math.max(1, Math.round(cd / 1000)) },
    }
  }
  return { ok: true }
}

export function startExpedition(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number; confirmActivitySwitch?: boolean },
): CommandResult {
  const invasionSeq = opts?.foeGalaxyId && weekendZoneLiveAt(state, opts.foeGalaxyId, weekendClockOf(state)) ? state.weekendEvent?.seq : undefined
  return withBattleRangeCheck(state, { kind: 'expedition', cardId: anomalyId, options: opts, invasionSeq }, staged => startExpeditionMutable(staged, anomalyId, ctx, opts))
}

export function startExpeditionMutable(state: GameState, anomalyId: string, ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number; confirmActivitySwitch?: boolean }): CommandResult {
  if (shipLockedInWormhole(state, state.shipId)) {
    return { ok: false, error: '主控在虫洞里（已锁定）：先暂停并召回整队，才能出击。', errorId: 'core.expedition.013' }
  }
  const departureFrom = departureOrigin(state, ctx)
  const pre = expeditionPreflight(state, ctx, anomalyId, opts?.foeGalaxyId)
  if (!pre.ok) return pre
  const squad = combatRosterOf(state)
  const budget = commandBudgetOf(state, ctx, squad)
  if (!budget.ok) return budget
  const blocked = combatEscortBlock(state, squad)
  if (blocked) return { ok: false, ...blocked }
  const anomaly = ctx.anomalies.get(anomalyId)!
  if (opts?.lairTier !== undefined && !isLairCandidate(anomaly)) {
    return { ok: false, error: '该目标不是敌人窝点，无法作为赏金任务目标。', errorId: 'core.expedition.010' }
  }
  const factionHit = opts?.lairTier === undefined && isFactionBounty(state, anomaly)
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  if (opts?.confirmActivitySwitch) haltCurrentActivity(state, ctx)
  const gateSkip = applyActivityGate(state, 'expedition', ctx)
  if (gateSkip) return gateSkip
  if (state.pendingActivityReturn && !departureFrom.docked) {
    delete state.shipReturns[state.shipId]
    state.pendingActivityReturn = null
    state.haltedBySwitch = null
  }
  const from = departureFrom.docked ? originGalaxyOf(state, ctx) : departureFrom.galaxy
  const targetGalaxy = opts?.foeGalaxyId ?? anomaly.galaxyId
  const outMinutes = shortestTravelMinutes(ctx, from, targetGalaxy)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。', errorId: 'core.expedition.024' }
  const fromName = ctx.galaxies.get(from)?.name ?? from
  state.awayGalaxy = null
  const outMs = travelLegMs(state, ctx, outMinutes)
  const now = state.gameMs
  const exp = state.expedition
  exp.active = true
  exp.sortie = makeCombatSortie(squad, state.shipId)
  exp.anomalyId = anomalyId
  if (opts?.foeGalaxyId !== undefined && opts.foeGalaxyId.length > 0) exp.foeGalaxyId = opts.foeGalaxyId
  else delete exp.foeGalaxyId
  if (opts?.rewardIskOverride !== undefined && Number.isFinite(opts.rewardIskOverride)) {
    exp.rewardIskOverride = Math.max(0, ceilFinalQuantity(opts.rewardIskOverride))
  } else delete exp.rewardIskOverride
  exp.phase = 'out'
  exp.battle = null
  exp.finishAtGameMs = now + beginDeparture(state, ctx, 'expedition', targetGalaxy, departureFrom)
  exp.outMs = outMs
  exp.combatMs = anomaly.combatSeconds * 1000
  exp.durationMs = outMs + exp.combatMs
  exp.power = calcPower(state, ctx)
  exp.eventId = rollTravelEvent(state, ctx)
  exp.eventFired = false
  exp.returnReason = undefined
  exp.lairTier = opts?.lairTier
  exp.factionActive = factionHit
  const preview = structuredClone(state)
  if (!beginBattleAtMutable(preview, ctx, anomalyId, state.shipId, exp.finishAtGameMs, opts?.desireM)) {
    return { ok: false, errorId: 'core.expedition.014' }
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const outName = opts?.lairTier ? lairNameOf(anomaly, opts.lairTier) : anomaly.name
  departureArrivalLog(
    state,
    'combat',
    `⚔ 远征开始（${outName}）：${shipName} 自「${fromName}」起航，立即抵达目标空域进入交火。胜利后自动返航最近空间站（母港或已建成副站，含去返全程，不可召回）；失利/撤退同样自动返航。`,
    'core.expedition.040',
    { p1: outName, p2: shipName, p3: fromName },
  )
  const result = { ok: true, battle: preview.expedition.battle! }
  return result
}

export function startExpeditionFromMining(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number },
): CommandResult {
  const invasionSeq = opts?.foeGalaxyId && weekendZoneLiveAt(state, opts.foeGalaxyId, weekendClockOf(state)) ? state.weekendEvent?.seq : undefined
  return withBattleRangeCheck(state, { kind: 'expedition', cardId: anomalyId, fromMining: true, options: opts, invasionSeq }, staged => startExpeditionFromMiningMutable(staged, anomalyId, ctx, opts))
}

export function startExpeditionFromMiningMutable(state: GameState, anomalyId: string, ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number }): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId)
  if (!pre.ok) return pre
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  const m = state.mining
  if (!m.active) return startExpedition(state, anomalyId, ctx, opts)
  const anomaly = ctx.anomalies.get(anomalyId)!
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  const from = belt?.galaxyId ?? null
  if (from !== null) {
    const reach = shortestTravelMinutes(ctx, from, anomaly.galaxyId)
    if (!Number.isFinite(reach)) return { ok: false, error: '目标星系不在矿带所在星系的已知航路内。', errorId: 'core.expedition.015' }
  }
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const trip = m.tripUnits
  const beltName = belt ? belt.name : '矿带'
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0
  state.awayGalaxy = from ?? 'galaxy-hub'
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const bountyTargetName = opts?.lairTier ? lairNameOf(anomaly, opts.lairTier) : anomaly.name
  addLog(
    state,
    'industry',
    `采矿已结束（${shipName} 转战悬赏「${bountyTargetName}」）：离开「${beltName}」${trip > 0 ? `——本趟采得的 ${trip} 单位${ore?.name ?? ''}仍在船上` : '（本趟尚无收获）'}，记得回港卸货。`,
    trip > 0 ? 'core.expedition.041' : 'core.expedition.042',
    trip > 0
      ? { p1: shipName, p2: bountyTargetName, p3: beltName, p4: trip, p5: ore?.name ?? '' }
      : { p1: shipName, p2: bountyTargetName, p3: beltName },
  )
  return startExpedition(state, anomalyId, ctx, opts)
}

export function beginBattleAt(state: GameState, ctx: SimContext, anomalyId: string, shipId: string, arrivalGameMs: number, desireM?: number): boolean {
  return withBattleRangeCheck(state, { kind: 'expedition-arrival', cardId: anomalyId, shipId }, staged => ({
    ok: beginBattleAtMutable(staged, ctx, anomalyId, shipId, arrivalGameMs, desireM),
  })).ok
}

export function beginBattleAtMutable(state: GameState, ctx: SimContext, anomalyId: string, shipId: string, arrivalGameMs: number, desireM?: number): boolean {
  const weekendAssault = weekendBattleInvolvedOf(state, ctx, anomalyId, state.wallMs ?? Date.now())
  const weekendEv = state.weekendEvent
  const weekendThreat =
    weekendAssault && weekendEv && !weekendFoeCardsSelfPriced(weekendEv.family)
      ? weekendAssaultThreatOf(weekendEv, weekendAssault.galaxyId)
      : undefined
  const squad = state.expedition.sortie?.shipIds ?? [shipId]
  const battle = squad.length > 1 ? startFleetBattleFor(state, ctx, squad, anomalyId, arrivalGameMs, desireM,
    undefined, weekendThreat !== undefined ? { threat: weekendThreat } : undefined, weekendAssault !== undefined) : startBattleFor(
    state,
    ctx,
    shipId,
    anomalyId,
    arrivalGameMs,
    desireM,
    weekendThreat !== undefined ? { threat: weekendThreat } : undefined,
    weekendAssault !== undefined,
  )
  if (!battle) return false
  const exp = state.expedition
  exp.phase = 'battle'
  exp.battle = battle
  const loopOnThisCard = state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === anomalyId
  const invasionLoopOn = autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined
  if (loopOnThisCard || invasionLoopOn) {
    exp.battle.hullEscapeFrac = 0.5
  }
  const anomaly = ctx.anomalies.get(anomalyId)
  const actualGalaxy = exp.foeGalaxyId ?? anomaly?.galaxyId
  if (actualGalaxy) markExplored(state, actualGalaxy)
  const loaded = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  const spec = createPlayerSpec(state, ctx, shipId, battle.ammoIds)
  const armed = spec?.weapons.some(w => w.src !== 'base' && !w.disabled) === true
  const baseEnabled = spec?.weapons.some(w => w.src === 'base' && !w.disabled) === true
  const targetName = anomaly ? (exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name) : ''
  const lairTail = exp.lairTier ? '（赏金任务目标：窝点守备强于常驻悬赏，注意弹药与修理件。）' : ''
  addLog(
    state,
    'combat',
    `⚔ 抵达目标（${targetName}）：进入交火。${armed ? (loaded > 0 ? `预载弹药 ${loaded} 发。` : '警告：未携带弹药，武器无法开火（基础舰炮可还击）。') : baseEnabled ? '未装配武器：仅基础舰炮还击。' : '高槽已装配装备，基础舰炮已禁用；未装配攻击武器。'}` +
      (exp.lairTier ? '（赏金任务目标：窝点守备强于常驻悬赏，注意弹药与修理件。）' : ''),
    !armed ? baseEnabled ? 'core.expedition.045' : 'core.expedition.062' : loaded > 0 ? 'core.expedition.043' : 'core.expedition.044',
    {
      p1: targetName,
      ...(armed && loaded > 0 ? { p2: loaded } : {}),
      p3: lairTail,
      ...(lairTail !== '' ? { p3Id: 'core.expedition.046' } : {}),
    },
  )
  return true
}
