import { ceilFinalQuantity } from './quantity'
import { tuningMul } from './tuning'
import { addLog, HOME_GALAXY_ID, salvageHalt } from './state'
import { applyActivityGate, pilotUnavailableReason } from './activityGate'
import { beginDeparture, consumeDeparture, cancelDeparture, departureOrigin, departureArrivalLog, reconcileDeparture } from './departure'
import type { CommandResult } from './engine'
import type { GameState, WorkReturnProgress } from './state'
import type { SimContext } from './types'
import { addItem, addWare, freeCargoM3Of, unloadWorkFleetToWarehouse } from './inventory'
import { workFleetShipIds, workFleetReturnMs } from './workFleet'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { actionBlockReason, markExplored } from './explore'
import { bumpFirst } from './firstTasks'
import {  shipDisplayName } from './instances'
import { addModule, allFittedModules, adjustDroneLoad, fitModule, repairSlotExpansionPlugs } from './equipment'
import { shipSlotsWithPlugsOf } from './plugs'
import { restoreShipFromWreck } from './fleetBook'
import { hasSalvageableShipWreck, trySalvagePlayerWreckOf } from './shipWrecks'
import { PLUG_BLACKBOX_ITEM_ID } from './blackbox'
import { nextRandom, pickWeighted } from './rng'
import {
  pullRareWreck,
  rareStockForTargetOf,
  RARE_WRECK_VOLUME_M3,
  recycleTierOf,
  salvageRoundMulOf,
  salvageRoundPull,
  rollIntactHullLoot,
  wreckBaseDensity,
  WRECK_VOLUME_PER_THREAT,
  wreckDensityOf,
  wreckGroupOfCard,
  wreckItemIdOf,
  wreckYieldMultiplierOf,
  weekendWreckDensityOf,
  weekendWreckPoolsOf,
  weekendRareWreckCountOf,
  chargeWeekendWreckByVolume,
  WEEKEND_WRECK_TARGET,
  wreckGroupStockOf,
  wreckGroupStocksOf,
} from './salvage'
import { workReturnLeg } from './trips'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from './jumpFuel'

export function legMsFor(state: GameState, ctx: SimContext, galaxyId: string, shipId?: string): number {
  if (state.debugQuick) return 1000
  const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
  const travel = Number.isFinite(mins) ? mins : 0
  return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, travel, shipId))
}

export function outboundLegMsFor(state: GameState, ctx: SimContext, galaxyId: string, shipId?: string): number {
  if (state.debugQuick) return 1000
  return Math.max(1, Math.round(legMsFor(state, ctx, galaxyId, shipId) / 2))
}

export function salvageReturnMs(state: GameState, ctx: SimContext, galaxyId: string, fuelMul = state.salvaging.fuelMul ?? 1): number {
  return workFleetReturnMs(state, ctx, id => legMsFor(state, ctx, galaxyId, id) + outboundLegMsFor(state, ctx, galaxyId, id), fuelMul)
}

export function salvagerCyclesOf(state: GameState, ctx: SimContext, shipId: string): number[] {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return []
  const rigLv = Math.min(5, state.skills.trained['salvage-rigging'] ?? 0)
  const rigUpLv = Math.min(5, state.skills.trained['salvager-overclock'] ?? 0)
  const rigFactor = (rigLv > 0 ? Math.max(0, 1 - 0.03 * rigLv) : 1) * (rigUpLv > 0 ? Math.max(0, 1 - 0.01 * rigUpLv) : 1)
  const cycles: number[] = []
  for (const def of allFittedModules(fleetShip.fitted, ctx)) {
    if (def.slot === 'salvager') cycles.push(Math.max(100, Math.round((def.salvageCycleMs ?? 10_000) * rigFactor)))
  }
  return cycles
}

export function salvageFleetCyclesOf(state: GameState, ctx: SimContext, preview = false): number[] {
  return workFleetShipIds(state, preview).flatMap(id => salvagerCyclesOf(state, ctx, id))
}

function wreckPoolOf(
  ctx: SimContext,
  galaxyId: string,
  state?: GameState,
  nowWallMs?: number,
  target?: string,
): Array<{ anomalyId: string; threat: number }> {
  const pool: Array<{ anomalyId: string; threat: number }> = []
  const seen = new Set<string>()
  for (const a of ctx.anomalies.values()) {
    if (a.hidden) continue
    if (a.galaxyId !== galaxyId) continue
    pool.push({ anomalyId: a.id, threat: Math.max(1, a.threat) })
    seen.add(a.id)
  }
  if (state && nowWallMs !== undefined) {
    for (const bucket of weekendWreckPoolsOf(state, galaxyId).filter((p) => p.density > 0)) {
      for (const a of ctx.anomalies.values()) {
        if (a.hidden !== true || a.region !== 'inv') continue
        if (bucket.family !== null && a.foeFamily !== bucket.family) continue
        if (seen.has(a.id)) continue
        seen.add(a.id)
        pool.push({ anomalyId: a.id, threat: Math.max(1, a.threat) })
      }
    }
  }
  if (target === undefined) return pool
  return pool.filter((p) => {
    if (target === WEEKEND_WRECK_TARGET) return ctx.anomalies.get(p.anomalyId)?.hidden === true
    return wreckGroupOfCard(p.anomalyId, ctx)?.key === target
  })
}

function ordinaryBaseVolumeM3Of(ctx: SimContext, galaxyId: string): number {
  const groups = new Map<string, Array<{ anomalyId: string; threat: number }>>()
  const pool = wreckPoolOf(ctx, galaxyId)
  for (const card of pool) {
    const key = wreckGroupOfCard(card.anomalyId, ctx)?.key
    if (key === undefined) continue
    const rows = groups.get(key) ?? []
    rows.push(card)
    groups.set(key, rows)
  }
  const meanOf = (rows: typeof pool): number => {
    const weight = rows.reduce((sum, card) => sum + card.threat, 0)
    return weight > 0 ? rows.reduce((sum, card) => sum + ordinaryCardVolumeM3Of(card.threat) * card.threat, 0) / weight : 0
  }
  if (groups.size === 0) return meanOf(pool)
  return [...groups.values()].reduce((sum, rows) => sum + meanOf(rows), 0) / groups.size
}

function ordinaryCardVolumeM3Of(threat: number): number {
  return Math.max(0.1, Math.round(Math.max(1, threat) * WRECK_VOLUME_PER_THREAT * 100) / 100)
}

function autoTargetPickOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  pool: ReadonlyArray<{ anomalyId: string; threat: number }>,
): { anomalyId: string; threat: number; bucketKey?: string } | null {
  if (hasSalvageableShipWreck(state, galaxyId)) return null
  if (weekendWreckDensityOf(state, galaxyId) > 0) {
    const candidates = weekendWreckPoolsOf(state, galaxyId).filter((bucket) => bucket.density > 0).map((bucket) => ({
      ...bucket,
      cards: pool.filter((p) => {
        const card = ctx.anomalies.get(p.anomalyId)
        return card?.hidden === true && card.region === 'inv' && (bucket.family === null || card.foeFamily === bucket.family)
      }),
    })).filter((bucket) => bucket.cards.length > 0)
    const bucket = candidates.length === 1 ? candidates[0] : pickWeighted(state.rng, candidates, (p) => p.density, { bound: 'lte' })
    if (bucket) {
      const chosen = pickWeighted(state.rng, bucket.cards, (p) => p.threat, { bound: 'lte' }) ?? bucket.cards[0]!
      return { ...chosen, bucketKey: bucket.key }
    }
  }
  const shares = wreckGroupStocksOf(state, ctx, galaxyId).filter(
    (r) => r.groupKey !== WEEKEND_WRECK_TARGET && r.stockM3 > 0,
  )
  if (shares.length === 0) return null
  const byGroup = pickWeighted(state.rng, shares, (r) => r.stockM3, { bound: 'lte' }) ?? shares[0]!
  const inGroup = pool.filter((p) => wreckGroupOfCard(p.anomalyId, ctx)?.key === byGroup.groupKey)
  if (inGroup.length === 0) return null
  return pickWeighted(state.rng, inGroup, (p) => p.threat, { bound: 'lte' }) ?? inGroup[0]!
}

export function wreckUnitsOf(volumeM3: number): number {
  if (!(volumeM3 > 0)) return 0
  return Math.max(1, ceilFinalQuantity(volumeM3))
}

function salvageTargetOkOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target: string | undefined,
): boolean {
  if (target === undefined) return true
  return wreckGroupStockOf(state, ctx, galaxyId, target) > 0.05
}

export function wreckTargetsOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
): Array<{ groupKey: string; stockM3: number }> {
  return wreckGroupStocksOf(state, ctx, galaxyId)
}

export function setSalvageTarget(
  state: GameState,
  ctx: SimContext,
  target: string | undefined,
): string | undefined {
  const s = state.salvaging
  if (!s.active || s.galaxyId === null) return s.targetGroup
  s.targetGroup = salvageTargetOkOf(state, ctx, s.galaxyId, target) ? target : undefined
  return s.targetGroup
}

export function startSalvageOp(
  state: GameState,
  galaxyId: string,
  ctx: SimContext,
  targetGroup?: string,
): CommandResult {
  reconcileDeparture(state)
  if (state.departure) return { ok: false, errorId: 'core.departure.001' }
  const departureFrom = departureOrigin(state, ctx)
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.salvaging.001', errorParams: { p1: galaxyId } }
  if (state.salvaging.active) {
    const prevGalaxy = state.salvaging.galaxyId ? ctx.galaxies.get(state.salvaging.galaxyId) : undefined
    const prevName = prevGalaxy?.name ?? '原星系'
    const info = salvageHalt(state)
    addLog(
      state,
      'warn',
      `已切换打捞点：停掉「${prevName}」的打捞（本趟约 ${Math.round((info?.tripM3 ?? 0) * 100) / 100} m³ 当量留在船上），改去「${galaxy.name}」。`,
      'core.salvaging.028',
      { p1: prevName, p2: galaxy.name, p3: Math.round((info?.tripM3 ?? 0) * 100) / 100 },
    )
  }
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  if (salvageFleetCyclesOf(state, ctx, true).length === 0) {
    return { ok: false, error: '打捞需要打捞器：先到「装配」页给驾驶船的高槽装一台（MK1/2/3）再出发。', errorId: 'core.salvaging.003' }
  }
  const exploreBlock = actionBlockReason(state, galaxyId)
  if (exploreBlock) return { ok: false, error: exploreBlock }
  if (galaxyId !== HOME_GALAXY_ID) {
    const travel = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
    if (!Number.isFinite(travel)) {
      return {
        ok: false,
        error: `「${galaxy.name}」没有从母港可达的航线，无法前往打捞。`,
        errorId: 'core.salvaging.010',
        errorParams: { p1: galaxy.name },
      }
    }
  }
  if (wreckPoolOf(ctx, galaxyId, state, Date.now()).length === 0) {
    return {
      ok: false,
      error: `「${galaxy.name}」没有可打捞的敌群残骸（该星系无悬赏目标）。`,
      errorId: 'core.salvaging.011',
      errorParams: { p1: galaxy.name },
    }
  }
  const oldReturn = state.shipReturns[state.shipId]
  const restartingReturn = !state.mining.active && !state.salvaging.active &&
    (oldReturn?.reason === 'miningStop' || oldReturn?.reason === 'salvageStop')
  const gateSkip = applyActivityGate(state, 'salvaging', ctx)
  if (gateSkip) return gateSkip
  if (!departureFrom.docked && state.pendingActivityReturn) {
    delete state.shipReturns[state.shipId]
    state.pendingActivityReturn = null
    state.haltedBySwitch = null
  }
  if (restartingReturn) { state.pendingActivityReturn = null; state.haltedBySwitch = null }
  if (state.haltedBySwitch?.kind === 'salvaging') {
  state.haltedBySwitch = null
} else {
  delete state.shipReturns[state.shipId]
  state.haltedBySwitch = null
}
  const s = state.salvaging
  s.active = true
  s.galaxyId = galaxyId
  s.phase = 'salvaging'
  delete s.fuelMul
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  s.deviceClockVersion = 2
  s.targetGroup = salvageTargetOkOf(state, ctx, galaxyId, targetGroup) ? targetGroup : undefined
  s.autoCycle = s.autoCycle !== false
  s.stopAfterTrip = s.stopAfterTrip === true
  beginDeparture(state, ctx, 'salvaging', galaxyId, departureFrom)
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const density = wreckDensityOf(state, galaxyId, ctx)
  const salvagers = salvageFleetCyclesOf(state, ctx).length
  const outSec = Math.max(1, Math.round(outboundLegMsFor(state, ctx, galaxyId) / 1000))
  const retSec = Math.max(1, Math.round(legMsFor(state, ctx, galaxyId) / 1000))
  const loopNote = s.stopAfterTrip
    ? ' 已勾选「本次返航卸货后停止」：卸完这一趟即收工。'
    : s.autoCycle
      ? ' 已启用自动循环：满舱自动返航卸货，卸完自动开始下一趟（可随时手动停止）。'
      : ' 自动循环已关闭：卸完这一趟即收工。'
  const loopNoteId = s.stopAfterTrip ? 'core.salvaging.012' : s.autoCycle ? 'core.salvaging.013' : 'core.salvaging.014'
  departureArrivalLog(
    state,
    'salvage',
    `开始打捞：${galaxy.name}（残骸密度 ${density.toFixed(1)}）。${shipName} 已抵达目标空域，立即开始持续打捞` +
      `（${salvagers} 台打捞器；满载返航约 ${retSec + outSec} 秒，去程时间已并入返航）。${loopNote}`,
    'core.salvaging.015',
    {
      p1: galaxy.name,
      p2: density.toFixed(1),
      p3: shipName,
      p4: salvagers,
      p5: retSec + outSec,
      p6: loopNote,
      p6Id: loopNoteId,
    },
  )
  void loopNoteId
  return { ok: true }
}

export function setSalvageAutoCycle(state: GameState, autoCycle: boolean): void {
  state.salvaging.autoCycle = autoCycle
  if (!autoCycle) state.salvaging.stopAfterTrip = false
}

export function setSalvageStopAfterTrip(state: GameState, stopAfterTrip: boolean): void {
  state.salvaging.stopAfterTrip = stopAfterTrip
  if (stopAfterTrip) state.salvaging.autoCycle = true
}

function armReturnLeg(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  progress: WorkReturnProgress,
): number | null {
  const ship = state.fleet[state.shipId]
  if (!ship) return null
  const leg = workReturnLeg(state, 'salvage', salvageReturnMs(state, ctx, galaxyId, 1), progress)
  state.shipReturns[state.shipId] = { beltId: null, ...leg, reason: 'salvageStop' }
  return Math.max(0, Math.round((leg.legMs - leg.phaseAccMs) / 1000))
}

export function stopSalvageOp(state: GameState, ctx: SimContext): boolean {
  const stayedAtPort = cancelDeparture(state, 'salvaging')
  const info = salvageHalt(state)
  if (info === null) return false
  const galaxy = info.galaxyId ? ctx.galaxies.get(info.galaxyId) : undefined
  const phaseNote =
    info.phase === 'returning' ? '（返航途中，货物留在船上）' : info.phase === 'outbound' ? '（出航途中）' : ''
  const phaseNoteId =
    info.phase === 'returning' ? 'core.mining.019' : info.phase === 'outbound' ? 'core.mining.020' : undefined
  const remainSec = info.galaxyId === null || stayedAtPort ? null : armReturnLeg(state, ctx, info.galaxyId, info)
  state.salvaging.tripM3 = 0
  addLog(
    state,
    'salvage',
    `已停止打捞（${galaxy?.name ?? ''}）。本趟共捞约 ${Math.round(info.tripM3 * 100) / 100} m³ 当量${phaseNote}。`,
    'core.salvaging.016',
    {
      p1: galaxy?.name ?? '',
      p2: Math.round(info.tripM3 * 100) / 100,
      p3: phaseNote,
      ...(phaseNoteId !== undefined ? { p3Id: phaseNoteId } : {}),
    },
  )
  if (remainSec !== null) {
    const shipName = shipDisplayName(state, ctx, state.shipId)
    const haveCargo = info.tripM3 > 0
    addLog(
      state,
      'salvage',
      `打捞已停止：${shipName} 从「${galaxy?.name ?? ''}」返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSec} 秒后到港。`,
      'core.salvaging.029',
      {
        p1: shipName,
        p2: galaxy?.name ?? '',
        p3: haveCargo ? '（卸空货仓）' : '',
        ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
        p4: remainSec,
      },
    )
  }
  return true
}

export function retireSalvageShip(
  state: GameState,
  ctx: SimContext,
  opts?: { galaxyId?: string; preserveExisting?: boolean; fallbackLegMs?: number; progress?: WorkReturnProgress },
): boolean {
  const s = state.salvaging
  const galaxyId = opts?.galaxyId ?? s.galaxyId
  const snapshot = opts?.progress ?? (opts?.galaxyId ? state.pendingActivityReturn?.progress : undefined)
  const progress = snapshot ?? s
  if (!galaxyId) return false
  if (opts?.preserveExisting === true && state.shipId in state.shipReturns) {
    const retFix = state.shipReturns[state.shipId]!
    const leg = workReturnLeg(state, 'salvage', salvageReturnMs(state, ctx, galaxyId, 1), progress)
    retFix.legMs = leg.legMs
    retFix.phaseAccMs = snapshot ? leg.phaseAccMs : Math.min(leg.legMs, Math.max(retFix.phaseAccMs, leg.phaseAccMs))
    const galaxyNameFix = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
    const shipNameFix = shipDisplayName(state, ctx, state.shipId)
    const shipFix = state.fleet[state.shipId]
    const haveCargoFix = shipFix ? Object.keys(shipFix.cargo).some((k) => (shipFix.cargo[k] ?? 0) > 0) : false
    const remainSecFix = Math.max(0, Math.round((retFix.legMs - retFix.phaseAccMs) / 1000))
    addLog(
      state,
      'salvage',
      `打捞已停止：${shipNameFix} 从「${galaxyNameFix}」返航空间站${haveCargoFix ? '（卸空货仓）' : ''}——约 ${remainSecFix} 秒后到港。`,
      'core.salvaging.029',
      {
        p1: shipNameFix,
        p2: galaxyNameFix,
        p3: haveCargoFix ? '（卸空货仓）' : '',
        ...(haveCargoFix ? { p3Id: 'core.salvaging.018' } : {}),
        p4: remainSecFix,
      },
    )
    resetOp(state)
    return true
  }
  if (opts?.galaxyId === undefined && (!s.active || !s.galaxyId)) return false
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  const baseMs = opts?.fallbackLegMs !== undefined ? Math.max(1, Math.round(opts.fallbackLegMs)) : salvageReturnMs(state, ctx, galaxyId, 1)
  const { legMs, phaseAccMs } = workReturnLeg(state, 'salvage', baseMs, progress)
  const oldShip = state.fleet[state.shipId]
  const haveCargo = oldShip ? Object.keys(oldShip.cargo).some((k) => (oldShip.cargo[k] ?? 0) > 0) : false
  state.shipReturns[state.shipId] = {
    beltId: null,
    legMs: Math.max(1, legMs),
    phaseAccMs: Math.min(legMs, Math.max(0, phaseAccMs)),
    reason: 'salvageStop',
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const remainSec = Math.max(0, Math.round((legMs - phaseAccMs) / 1000))
  resetOp(state)
  const auto = opts?.galaxyId !== undefined
  if (auto) {
    addLog(
      state,
      'salvage',
      `打捞已停止：${shipName} 从「${galaxyName}」返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSec} 秒后到港。`,
      'core.salvaging.029',
      {
        p1: shipName,
        p2: galaxyName,
        p3: haveCargo ? '（卸空货仓）' : '',
        ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
        p4: remainSec,
      },
    )
  } else {
    addLog(
      state,
      'salvage',
      `打捞已随换船结束：${shipName} 从「${galaxyName}」自动返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSec} 秒后到港。`,
      'core.salvaging.017',
      {
        p1: shipName,
        p2: galaxyName,
        p3: haveCargo ? '（卸空货仓）' : '',
        ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
        p4: remainSec,
      },
    )
  }
  return true
}

export function assayChanceOf(state: GameState, ctx: SimContext, cycleMsReal: number): number {
  const lv = Math.min(5, state.skills.trained['wreck-assaying'] ?? 0)
  return Math.min(1, (Math.max(0, cycleMsReal) / 60_000) * ctx.balance.intactHullRatePerMin * Math.pow(1.2, lv))
}

export function pullOneWreck(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  cycleMsReal: number,
  cargoFreeM3?: number,
): { itemId: string; mul: number; volumeM3: number } | null {
  let target = state.salvaging.targetGroup
  if (target !== undefined && target !== WEEKEND_WRECK_TARGET &&
    (weekendWreckDensityOf(state, galaxyId) > 0 || weekendRareWreckCountOf(state, galaxyId) > 0)) {
    state.salvaging.targetGroup = undefined
    target = undefined
  }
  if (
    target !== undefined &&
    wreckGroupStockOf(state, ctx, galaxyId, target) <= 0.05 &&
    rareStockForTargetOf(state, ctx, galaxyId, target) <= 0
  ) {
    state.salvaging.targetGroup = undefined
    target = undefined
  }
  if (state.shipWrecks && hasSalvageableShipWreck(state, galaxyId)) {
    const salvage = trySalvagePlayerWreckOf(state, ctx, galaxyId)
    if (salvage.kind === 'item') {
      if (salvage.isModule) {
        addModule(state, salvage.itemId, salvage.units)
      } else {
        addWare(state, salvage.itemId, salvage.units)
      }
      const itemName = salvage.isModule
        ? (ctx.modules.get(salvage.itemId)?.name ?? salvage.itemId)
        : (ctx.items.get(salvage.itemId)?.name ?? salvage.itemId)
      addLog(state, 'warn', `打捞舰船残骸：捞回 ${itemName} ×${salvage.units}。`, 'core.salvaging.030', {
        p1: itemName,
        p2: salvage.units,
      })
      return { itemId: salvage.itemId, mul: 1, volumeM3: 0 }
    }
    if (salvage.kind === 'plugs') {
      addWare(state, PLUG_BLACKBOX_ITEM_ID, salvage.blackBoxes)
      const name = ctx.items.get(PLUG_BLACKBOX_ITEM_ID)?.name ?? PLUG_BLACKBOX_ITEM_ID
      addLog(state, 'warn', `舰船残骸里的插件换回了 ${name} ×${salvage.blackBoxes}。`, 'core.salvaging.032', {
        p1: name,
        p2: salvage.blackBoxes,
      })
      addLog(state, 'warn', `打捞舰船残骸：捞回 ${name} ×${salvage.blackBoxes}。`, 'core.salvaging.030', {
        p1: name,
        p2: salvage.blackBoxes,
      })
      return { itemId: PLUG_BLACKBOX_ITEM_ID, mul: 1, volumeM3: 0 }
    }
    if (salvage.kind === 'ship') {
      if (salvage.defId !== undefined) {
        const restoredId = restoreShipFromWreck(state, {
          defId: salvage.defId,
          durability: salvage.durability,
          armorPct: salvage.armorPct,
          customName: salvage.customName,
          recoveryRules: salvage.recoveryRules,
          damagePlugs: salvage.damagePlugs,
          ...(salvage.plugs !== undefined ? { plugs: salvage.plugs } : {}),
        })
        repairSlotExpansionPlugs(state, ctx)
        if (salvage.recoveryRules === 2) {
          const restored = state.fleet[restoredId]!
          const slots = shipSlotsWithPlugsOf(state, ctx, restoredId)
          for (const rack of ['high', 'mid', 'low'] as const) restored.fitted[rack] = Array(slots[rack]).fill(null)
          const jobs = (['high', 'mid', 'low'] as const).flatMap(rack => (salvage.fitted?.[rack] ?? [])
            .flatMap((id, index) => id ? [{ id, rack, index }] : []))
          jobs.sort((a, b) => (ctx.modules.get(b.id)?.cpuBonus ?? 0) - (ctx.modules.get(a.id)?.cpuBonus ?? 0))
          let returned = 0
          for (const job of jobs) {
            addModule(state, job.id)
            if (!fitModule(state, job.id, ctx, { shipId: restoredId, rack: job.rack, index: job.index }).ok) returned++
          }
          for (const [id, n] of Object.entries(salvage.droneLoad ?? {})) {
            addWare(state, id, n)
            adjustDroneLoad(state, ctx, id, n, restoredId)
          }
          addLog(state, 'warn', `舰船回收：装备保全 ${salvage.keptModules ?? 0} 件，损失 ${salvage.lostModules ?? 0} 件，${returned} 件退回装备库。`,
            'core.shipRecovery.001', { p1: salvage.keptModules ?? 0, p2: salvage.lostModules ?? 0, p3: returned })
          if (restored.damagePlugs?.length) {
            addLog(state, 'warn', `回收舰船附有 ${restored.damagePlugs.length} 个战损插件，常规维修不会清除。`,
              'core.shipRecovery.002', { p1: restored.damagePlugs.length })
          }
        }
      }
      addLog(state, 'warn', `舰船残骸里捞回了一艘还能修的船：${salvage.wreckName}——已拖回母港入队。`, 'core.salvaging.031', {
        p1: salvage.wreckName,
      })
      return { itemId: '', mul: 1, volumeM3: 0 }
    }
    return { itemId: '', mul: 1, volumeM3: 0 }
  }
  const rareVolumeM3 = RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume')
  const rareId = pullRareWreck(state, galaxyId, ctx, target,
    cargoFreeM3 === undefined || wreckUnitsOf(rareVolumeM3) <= cargoFreeM3)
  if (rareId) {
    const mulRare = salvageRoundMulOf(state, ctx, galaxyId)
    return { itemId: rareId, mul: mulRare, volumeM3: rareVolumeM3 }
  }
  const pool = wreckPoolOf(ctx, galaxyId, state, Date.now(), target)
  if (pool.length === 0) return null
  const chosen: { anomalyId: string; threat: number; bucketKey?: string } =
    (target === undefined || target === WEEKEND_WRECK_TARGET ? autoTargetPickOf(state, ctx, galaxyId, pool) : null) ??
    pickWeighted(state.rng, pool, (p) => p.threat, { bound: 'lte' }) ??
    pool[0]!
  const group = wreckGroupOfCard(chosen.anomalyId, ctx)
  if (!group) return null
  const fromWeekend = ctx.anomalies.get(chosen.anomalyId)?.hidden === true
  const bucketKey = chosen.bucketKey ?? (fromWeekend ? weekendWreckPoolsOf(state, galaxyId)
    .find((p) => p.density > 0 && (p.family === null || p.family === group.family))?.key : undefined)
  if (fromWeekend && bucketKey === undefined) return null
  const mul = salvageRoundMulOf(state, ctx, galaxyId, target, fromWeekend ? bucketKey : undefined)
  const wreckId = wreckItemIdOf(group.key)
  const baseM3 = fromWeekend ? ordinaryBaseVolumeM3Of(ctx, galaxyId) : ordinaryCardVolumeM3Of(chosen.threat)
  const diveLv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  const yieldMul = wreckYieldMultiplierOf(recycleTierOf(wreckBaseDensity(galaxyId, ctx)))
  let volumeM3 = baseM3 * mul * (1 + 0.12 * diveLv) * yieldMul
  if (fromWeekend) {
    const left = weekendWreckPoolsOf(state, galaxyId).find((p) => p.key === bucketKey)?.density ?? 0
    volumeM3 = Math.min(wreckUnitsOf(volumeM3), left)
  }
  if (cargoFreeM3 !== undefined && wreckUnitsOf(volumeM3) > cargoFreeM3) {
    const room = Math.floor(Math.max(0, cargoFreeM3))
    if (room === 0) return { itemId: wreckId, mul, volumeM3 }
    volumeM3 = Math.min(volumeM3, room)
  }
  if (nextRandom(state.rng) < assayChanceOf(state, ctx, cycleMsReal)) {
    const gains = rollIntactHullLoot(state, ctx, chosen.anomalyId)
    if (gains) addLog(state, 'salvage', `完好舰体！${gains}。`, 'core.salvaging.019', { p1: gains })
  }
  if (fromWeekend) volumeM3 = chargeWeekendWreckByVolume(state, galaxyId, volumeM3, bucketKey)
  else salvageRoundPull(state, ctx, galaxyId, target)
  return { itemId: wreckId, mul, volumeM3 }
}

export function advanceSalvageOp(state: GameState, deltaMs: number, ctx: SimContext): void {
  const s = state.salvaging
  if (!s.active || deltaMs <= 0) return
  if (!state.fleet[state.shipId]) {
    resetOp(state)
    addLog(state, 'warn', '找不到当前舰船，打捞作业已停止。', 'core.salvaging.020')
    return
  }
  let remaining = deltaMs
  let guard = 0
  while (s.active && remaining > 0) {
    remaining = consumeDeparture(state, 'salvaging', remaining)
    if (remaining <= 0) break
    if (++guard > 100_000) break
    const galaxyId = s.galaxyId
    if (!galaxyId) {
      resetOp(state)
      addLog(state, 'warn', '找不到打捞目标星系，作业已停止。', 'core.salvaging.021')
      return
    }
    if (s.phase === 'outbound' || s.phase === 'returning') {
      const outFull = outboundLegMsFor(state, ctx, galaxyId)
      const leg =
        s.phase === 'outbound'
          ? outFull
          : salvageReturnMs(state, ctx, galaxyId)
      const need = leg - s.phaseAccMs
      if (remaining < need) {
        s.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      s.phaseAccMs = 0
      if (s.phase === 'returning') {
        const moved = unloadWorkFleetToWarehouse(state, ctx)
        const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
        addLog(
          state,
          'salvage',
          `打捞自动返港：${galaxyName} 残骸已卸入物品仓库（共 ${moved.toLocaleString('zh-CN')} m³ 当量）。`,
          'core.salvaging.022',
          { p1: galaxyName, p2: moved.toLocaleString('zh-CN') },
        )
        if (s.stopAfterTrip || s.autoCycle === false) {
          addLog(
            state,
            'salvage',
            s.stopAfterTrip ? '自动循环已结束（按设定返港后停止）。' : '本次打捞结束（未开启自动循环）。',
            s.stopAfterTrip ? 'core.salvaging.023' : 'core.salvaging.024',
          )
          resetOp(state)
          break
        }
        s.phase = 'salvaging'
        s.cycleAccMs = 0
        s.tripM3 = 0
        s.deviceAccMs = {}
        s.deviceClockVersion = 2
        delete s.fuelMul
        beginDeparture(state, ctx, 'salvaging', galaxyId, { galaxy: HOME_GALAXY_ID, site: null, docked: true })
        continue
      }
      markExplored(state, galaxyId)
      s.phase = 'salvaging'
      s.cycleAccMs = 0
      continue
    }

    if (wreckPoolOf(ctx, galaxyId, state, Date.now()).length === 0) {
      resetOp(state)
      addLog(state, 'warn', '该星系的敌群情报缺失，打捞作业已停止。', 'core.salvaging.025')
      return
    }
    const devices = workFleetShipIds(state).flatMap(shipId => salvagerCyclesOf(state, ctx, shipId)
      .map((cycleMs, index) => ({ shipId, cycleMs, key: JSON.stringify([shipId, index, cycleMs]) })))
    if (devices.length === 0) {
      resetOp(state)
      addLog(state, 'warn', '未找到可用的打捞器，打捞作业已停止。', 'core.salvaging.026')
      return
    }
    if (s.deviceClockVersion !== 2) {
      const legacy = s.deviceAccMs
      s.deviceAccMs = {}
      for (const device of devices) {
        s.deviceAccMs[device.key] = device.shipId === state.shipId
          ? (legacy[String(device.cycleMs)] ?? 0) + s.cycleAccMs : 0
      }
      s.deviceClockVersion = 2
    }
    const deviceKeys = new Set(devices.map(row => row.key))
    for (const key of Object.keys(s.deviceAccMs)) if (!deviceKeys.has(key)) delete s.deviceAccMs[key]
    for (const { key, cycleMs } of devices) s.deviceAccMs[key] = Math.min(cycleMs, Math.max(0, s.deviceAccMs[key] ?? 0))
    const need = Math.min(...devices.map(({ key, cycleMs }) => Math.max(0, cycleMs - (s.deviceAccMs[key] ?? 0))))
    const take = Math.min(remaining, need)
    for (const { key } of devices) s.deviceAccMs[key] = (s.deviceAccMs[key] ?? 0) + take
    remaining -= take
    const stepMs = Math.min(...devices.map(row => row.cycleMs))
    s.cycleAccMs = Math.min(...devices.filter(row => row.cycleMs === stepMs).map(row => s.deviceAccMs[row.key] ?? 0))
    if (take < need) break
    for (const { shipId, cycleMs, key } of devices) {
      while ((s.deviceAccMs[key] ?? 0) >= cycleMs) {
        s.deviceAccMs[key] = (s.deviceAccMs[key] ?? 0) - cycleMs
        const freeM3 = freeCargoM3Of(state, ctx, shipId)
        const pulled = pullOneWreck(state, ctx, galaxyId, cycleMs, freeM3)
        if (pulled) bumpFirst(state, 'salvageRuns')
        if (!pulled) {
          resetOp(state)
          addLog(state, 'warn', '该星系的敌群情报缺失，打捞作业已停止。', 'core.salvaging.025')
          return
        }
        if (pulled.volumeM3 <= 0) continue
        if (wreckUnitsOf(pulled.volumeM3) > freeM3) {
          s.phase = 'returning'
          s.phaseAccMs = 0
          const baseMs = salvageReturnMs(state, ctx, galaxyId, 1)
          s.fuelMul = beginJumpFuelLeg(state, 'salvage', baseMs)
          const mergedSec = Math.round(jumpFuelLegMsOf(baseMs, s.fuelMul) / 1000)
          addLog(
            state,
            'salvage',
            `货仓装不下下一轮打捞（余 ${Math.round(freeM3)} m³ ／ 每轮 ${Math.round(pulled.volumeM3)} m³）：自动返航卸货（本趟约 ${Math.round(s.tripM3 * 100) / 100} m³，约 ${mergedSec} 秒，去程已并入返航）。`,
            'core.salvaging.027',
            {
              p1: Math.round(freeM3),
              p2: Math.round(pulled.volumeM3),
              p3: Math.round(s.tripM3 * 100) / 100,
              p4: mergedSec,
            },
          )
          break
        }
        addItem(state, pulled.itemId, wreckUnitsOf(pulled.volumeM3), shipId)
        s.tripM3 += pulled.volumeM3
      }
      if (s.phase === 'returning') break
    }
    if (s.phase === 'salvaging') s.cycleAccMs = Math.min(...devices.filter(row => row.cycleMs === stepMs).map(row => s.deviceAccMs[row.key] ?? 0))
  }
}

function resetOp(state: GameState): void {
  const s = state.salvaging
  s.active = false
  s.galaxyId = null
  s.phase = 'salvaging'
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  delete s.deviceClockVersion
  s.targetGroup = undefined
  delete s.fuelMul
}
