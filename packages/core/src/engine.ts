
import { addLog } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import { advanceMining, advanceShipReturns, retireMiningShip } from './mining'
import { advanceStandby, advanceTransit, reconcileDockSanity, startSiteDeliverTrip, stationActivityReturnSite } from './location'
import { shipActuallyDocked } from './shipActionPolicy'
import { consumeDeparture, departureView, reconcileDeparture } from './departure'
import { mainActivityOf, manualSlotOf } from './activityGate'
import type { StationAction } from './stationActivityPending'
import { reconcilePilotShip } from './shipyard'
import { advanceManufacturing } from './industry/manufacturing/advance'
import { startManufacturing } from './industry/manufacturing/start'
import { advanceRefining, type UnboxResultRow } from './industry/refining/advance'
import { startRefineRun } from './industry/refining/start'
import { startRecycleRun } from './industry/refining/recycle'
import { startUnboxRun } from './industry/refining/unbox'
import { advanceLab, startLabRun } from './lab'
import { advancePlanetary, reconcilePlanetHome } from './planetRuntime'
import { advanceExpedition } from './expedition'
import { advanceWormhole } from './wormholeBattle'
import { advanceAi, AI_CORE_ORDER } from './ai'
import { advanceEvents, ensureEventSchedule } from './events'
import { advanceMarket } from './market/advance'
import { ensureBlackMarket } from './blackMarket'
import { repairSlotExpansionPlugs } from './equipment'
import { advanceEncounterWatch } from './encounters'
import { collectExposures } from './encounters/presence'
import { advanceIndustrialProtection } from './encounters/industrial'
import { fightEncounterMutable } from './encounters/commands'
import { timedRouteExposureOf } from './encounters/travelExposure'
import { HOME_GALAXY_ID } from './state'
import { advanceScanning, ensureTransitExplored } from './explore'
import { advanceWormholeScan, reconcileWormholeScanWelcome } from './wormholeScan'
import { advanceWormholeAuto } from './wormholeAuto'
import { advanceHauling, startHauling } from './hauling'
import { advanceWreckDrift } from './salvage'
import type { SettleStats } from './settleStats'
import { advanceSalvageOp, retireSalvageShip } from './salvaging'
import { advanceFindHumans, publishFindHumansWhenReady } from './onboarding'
import { advanceComms } from './comms'
import {  advanceFirstChains, claimableFirstTasks, peakFirst } from './firstTasks'
import { advanceAchievements } from './achievements/rules'
import { advanceMatterOreDrip, matterTechNodes } from './matterTech'
import { advanceSideTasks } from './sideTasks'
import { weekendTickBoss } from './weekendEvent'
import { weekendFlagshipBattleActive } from './weekendLaunch'
import { PlayerStationGameRuntime, advancePlayerStationGame } from './playerStation/gameRuntime'
import { trainingLevelProgress } from './skills/training'

function isPlayerInBattle(state: GameState): boolean {
  if (state.expedition.battle && !state.expedition.battle.ended) return true
  if (state.wormhole.run?.battle && !state.wormhole.run.battle.ended) return true
  const enc = state.encounter
  if (enc?.active === true && enc.battle && !enc.battle.ended) return true
  return false
}

export interface CoreBlockReason {
  error: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
}

export interface CommandResult {
  ok: boolean
  rangeConfirmation?: boolean
  queued?: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  code?: 'unknown-target' | 'path-blocked' | 'cargo-pending' | 'unsupported-rules'
  autoBattle?: boolean
  beacon?: boolean
  intercepted?: { target: string; known: boolean }
  ambush?: boolean
  taken?: number
  pendingBattle?: 'ruins' | 'node'
  dispersed?: number
  newlyFogged?: number
  exitScanned?: boolean
}


export function advanceGame(
  state: GameState,
  deltaMs: number,
  ctx: SimContext,
  opts?: {
    freezeBattle?: boolean
    settleStats?: SettleStats
    nowWallMs?: number
    battleSpeedX?: number
    offline?: boolean
    onUnboxResult?: (result: UnboxResultRow) => void
    onStationActivityStarted?: (action: StationAction) => void
  },
): void {
  let left = Math.floor(deltaMs)
  if (!Number.isFinite(left) || left <= 0) return
  while (left > 0) {
    reconcileDeparture(state)
    ensureEventSchedule(state, ctx)
    resolveActivityReturn(state, ctx)
    advancePendingStationActivity(state, ctx, opts?.onStationActivityStarted)
    let step = left
    if (state.playerStation?.active) {
      const station = new PlayerStationGameRuntime(state, ctx)
      station.advance(0)
      step = Math.min(step, Math.max(1, station.nextEventMs()))
      const training = state.skills.queue[0], skill = training && ctx.skills.get(training.skillId)
      if (training && skill) step = Math.min(step, Math.max(1, Math.ceil(trainingLevelProgress(state, skill, (state.skills.trained[skill.id] ?? 0) + 1, training.progressMs).remainingMs)))
      for (const run of state.manufacturingRuns) if (run.active) step = Math.min(step, Math.max(1, Math.ceil(run.finishAtGameMs - state.gameMs)))
      // 原采集/AI作业同样可能向共仓供料；有限分段保证新物资不补此前站内工时。
      if (state.mining.active || Object.keys(state.aiAssignments).length > 0 || state.refineRuns.some(run => run.active)) step = Math.min(step, 1000)
    }
    const departing = departureView(state)
    if (departing) step = Math.min(step, Math.max(1, departing.remainingMs))
    const exposedNow = collectExposures(state, ctx, opts?.nowWallMs ?? state.wallMs ?? Date.now()).length > 0
    const industrialActive = state.hauling.active || state.encounter.active || state.sideTasks.deliver !== null || exposedNow
    if (industrialActive) {
      const eventDue = ctx.balance.events.enabled === false ? left : Math.max(1, state.events.nextAtGameMs - state.gameMs)
      step = Math.min(step, state.encounter.battle ? 1000 : 60_000, eventDue)
      const fleet = state.hauling.fleetLeg
      const row = fleet?.path[fleet.pathIndex]
      if (row && !state.encounter.active) step = Math.min(step, Math.max(1, row.durationMs - row.progressMs))
      const delivery = state.sideTasks.deliver
      if (delivery && !state.encounter.active) {
        const duration = delivery.flightDurationMs ?? delivery.arriveAtGameMs - delivery.departAtGameMs
        const current = timedRouteExposureOf(ctx, HOME_GALAXY_ID, delivery.galaxyId, duration, duration - (delivery.arriveAtGameMs - state.gameMs))
        if (current) step = Math.min(step, current.remainingMs)
        step = Math.min(step, Math.max(1, delivery.arriveAtGameMs - state.gameMs))
      }
    }
    const pending = state.pendingStationActivity
    const returning = pending ? state.shipReturns[pending.shipId] : undefined
    if (returning) step = Math.min(step, Math.max(1, Math.ceil(returning.legMs - returning.phaseAccMs)))
    const search = state.planetary?.stellar?.search
    if (ctx.planetary && state.planetary?.runtimeVersion === 1 && search && !search.paused) {
      step = Math.min(step, Math.max(1, Math.ceil(search.durationMs - search.progressMs)))
      for (const run of state.manufacturingRuns) if (run.active && run.blueprintId === 'bp-deep-space-probe' && Number.isFinite(run.finishAtGameMs)) {
        step = Math.min(step, Math.max(1, Math.ceil(run.finishAtGameMs - state.gameMs)))
      }
    }
    const segmented = step !== left || left !== Math.floor(deltaMs)
    const stepOpts = segmented && opts?.nowWallMs !== undefined ? { ...opts, nowWallMs: opts.nowWallMs - left + step } : opts
    advanceGameStep(state, step, ctx, stepOpts)
    advancePendingStationActivity(state, ctx, opts?.onStationActivityStarted)
    left -= step
  }
}

function resolveActivityReturn(state: GameState, ctx: SimContext): void {
  const pending = state.pendingActivityReturn
  if (!pending) return
  state.pendingActivityReturn = null
  if (pending.kind === 'mining') retireMiningShip(state, ctx, { beltId: pending.id, preserveExisting: true, progress: pending.progress })
  else retireSalvageShip(state, ctx, { galaxyId: pending.id, preserveExisting: true, progress: pending.progress })
}

function advancePendingStationActivity(state: GameState, ctx: SimContext, onStarted?: (action: StationAction) => void): void {
  const pending = state.pendingStationActivity
  if (!pending) return
  if (!state.fleet[pending.shipId] || pending.shipId !== state.shipId || mainActivityOf(state) !== null || manualSlotOf(state) !== null) {
    delete state.pendingStationActivity
    return
  }
  if (state.shipReturns[pending.shipId]) return
  delete state.pendingStationActivity
  if (!shipActuallyDocked(state, ctx)) return
  state.haltedBySwitch = null
  let result: CommandResult
  const action = pending.action
  switch (action.kind) {
    case 'refine': result = startRefineRun(state, action.itemId, 'pilot', ctx); break
    case 'recycle': result = startRecycleRun(state, action.itemId, 'pilot', ctx); break
    case 'unbox': result = startUnboxRun(state, ctx, action.itemId, 'pilot'); break
    case 'manufacturing': result = startManufacturing(state, action.blueprintId, 'pilot', ctx); break
    case 'lab': result = startLabRun(state, ctx, action.recipeId, 'pilot'); break
    case 'hauling': result = startHauling(state, action.aSiteId, action.bSiteId, ctx, action.requestedM3); break
    case 'siteDeliver': result = startSiteDeliverTrip(state, ctx, action.siteId); break
  }
  if (!result.ok && result.error) addLog(state, 'warn', result.error, result.errorId, result.errorParams)
  if (result.ok && !result.queued) onStarted?.(action)
}

function advanceGameStep(state: GameState, deltaMs: number, ctx: SimContext, opts?: Parameters<typeof advanceGame>[3]): void {
  const d = Math.floor(deltaMs)
  if (!Number.isFinite(d) || d <= 0) return
  // 本段开始条件先结站内时间，不能用稍后技能/开矿/入库反算此前工时。
  if (state.playerStation?.active) advancePlayerStationGame(state, ctx, d)
  advanceIndustrialProtection(state, ctx, d, collectExposures(state, ctx).some(row => row.shipId === state.shipId && row.kind !== '扫描'))
  const pausedEncounter = (!!state.encounter.pirate || state.encounter.automatic === true) && state.encounter.active
  state.gameMs += d
  const departing = state.departure
  if (departing && departing.kind !== 'mining' && departing.kind !== 'salvaging' && departing.kind !== 'hauling') {
    consumeDeparture(state, departing.kind, d)
  }
  if (pausedEncounter) {
    if (state.transit.active) state.transit.finishAtGameMs += d
    if (state.standby.active) state.standby.finishAtGameMs += d
    if (state.sideTasks.deliver) state.sideTasks.deliver.arriveAtGameMs += d
  }
  const deferPlanetary = !!state.planetary?.stellar?.search
  if (ctx.planetary && !deferPlanetary) { advancePlanetary(state, d, ctx.planetary, state.gameMs - d); reconcilePlanetHome(state, ctx.planetary) }
  if (opts?.nowWallMs !== undefined && Number.isFinite(opts.nowWallMs)) state.wallMs = opts.nowWallMs
  ensureTransitExplored(state, ctx)
  advanceSkillQueue(state, d, ctx)
  resolveActivityReturn(state, ctx)
  if (!pausedEncounter) advanceMining(state, d, ctx)
  if (!pausedEncounter) advanceSalvageOp(state, d, ctx)
  advanceWreckDrift(state, ctx, d, state.salvaging.active ? state.salvaging.galaxyId : null)
  const waiting = state.pendingStationActivity
  const completing = waiting?.shipId === state.shipId && state.shipReturns[state.shipId] &&
    state.shipReturns[state.shipId]!.phaseAccMs + d >= state.shipReturns[state.shipId]!.legMs
  const returnSite = completing ? stationActivityReturnSite(state, ctx) : null
  advanceShipReturns(state, d, ctx)
  if (completing && !state.shipReturns[state.shipId]) { state.awayGalaxy = null; state.dockedSite = returnSite }
  reconcileDockSanity(state, ctx)
  reconcilePilotShip(state, ctx)
  advanceTransit(state, ctx)
  advanceStandby(state, ctx)
  advanceManufacturing(state, ctx, opts?.settleStats)
  if (ctx.planetary && deferPlanetary) { advancePlanetary(state, d, ctx.planetary, state.gameMs - d); reconcilePlanetHome(state, ctx.planetary) }
  advanceRefining(state, ctx, opts?.settleStats, opts?.onUnboxResult)
  advanceLab(state, ctx, opts?.settleStats)
  advanceMatterOreDrip(state, ctx, d)
  advanceExpedition(state, ctx, opts?.freezeBattle)
  advanceWormhole(state, ctx, opts?.freezeBattle, opts?.battleSpeedX)
  weekendTickBoss(state, opts?.nowWallMs, isPlayerInBattle(state), weekendFlagshipBattleActive(state))
  advanceScanning(state, ctx)
  // 最后一个扫描刚完成时只发现来源，不补算此前第二阶段时间。
  if (!state.playerStation?.active) advancePlayerStationGame(state, ctx, 0)
  reconcileWormholeScanWelcome(state)
  advanceWormholeScan(state, ctx, d)
  advanceWormholeAuto(state, ctx)
  advanceHauling(state, d, ctx)
  advanceAi(state, d, ctx, opts?.settleStats)
  advanceEncounterWatch(state, ctx, d, opts?.freezeBattle)
  repairSlotExpansionPlugs(state, ctx)
  advanceEvents(state, d, ctx, opts?.offline === true)
  if (state.encounter.automatic && !state.encounter.battle) fightEncounterMutable(state, ctx)
  advanceMarket(state, d, ctx)
  advanceSideTasks(state, ctx, opts?.nowWallMs)
  ensureBlackMarket(state, ctx, opts?.nowWallMs ?? state.savedAtWallMs)
  advanceComms(state, ctx)
  const readyNow = claimableFirstTasks(state, ctx)
  if (readyNow.length > 0) {
    const first = readyNow[0]!
    if (state.firstTaskReadyId !== first.id) {
      state.firstTaskReadyId = first.id
      addLog(state, 'levelup', `◆ 任务已达成：「${first.title}」——回「任务中心」点「完成」继续下一步。`, 'core.firstTasks.001', { p1: first.title })
    }
  }
  advanceFirstChains(state)
  publishFindHumansWhenReady(state)
  advanceFindHumans(state, ctx)
  reconcileMilestoneStats(state, ctx)
  advanceAchievements(state, ctx.achievements, opts?.nowWallMs)
}

function reconcileMilestoneStats(state: GameState, ctx: SimContext): void {
  let boxes = 0
  for (const n of Object.values(state.rareBoxesOpened ?? {})) boxes += n ?? 0
  peakFirst(state, 'rareBoxes', boxes)
  let built = 0
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites?.[site.id]
    if (prog && prog.stage >= site.tiers.length) built += 1
  }
  peakFirst(state, 'sitesBuilt', built)
  const nodes = matterTechNodes(ctx)
  if (nodes.length > 0) {
    let maxed = 0
    for (const n of nodes) if ((state.research?.levels?.[n.id] ?? 0) >= n.maxLevel) maxed += 1
    peakFirst(state, 'matterTechMaxed', maxed)
  }
  let kinds = 0
  for (const t of AI_CORE_ORDER) if ((state.aiCores?.[t] ?? 0) > 0) kinds += 1
  peakFirst(state, 'aiCoreKinds', kinds)
  const run = state.wormhole.run
  if (run) {
    peakFirst(state, 'whMaxDepth', run.depth)
    peakFirst(state, 'whBossClears', run.bossCleared ?? 0)
  }
  const settled = state.wormhole.lastSettle?.depth
  if (settled !== undefined) peakFirst(state, 'whMaxDepth', settled)
}

import { advanceSkillQueue } from './skills/queue'
export {
  HIDDEN_SKILL_IDS,
  PREREQ_MIN_LEVEL,
  clearSkillQueue,
  enqueueSkill,
  moveQueueItem,
  noteLabOpened,
  planPrereqChain,
  prereqNeedLevel,
  queueMovePlan,
  removeQueueAt,
  skillCancelImpact,
  skillLockMissing,
  skillLockMissingAtQueue,
} from './skills/queue'
export type { HeadTrainingInfo, QueueMovePlan, QueueView, SkillPrereqGap } from './skills/queue'

