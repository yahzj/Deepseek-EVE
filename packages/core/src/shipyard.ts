import { ceilFinalQuantity } from './quantity'
import { bumpFirst } from './firstTasks'
import { addLog, DEFAULT_START_SHIP_ID, shipLockedReason } from './state'
import { cannotInterruptReason } from './activityGate'
import { shipOperationBlockReason } from './shipActionPolicy'
import { detachExpeditionReturn, detachWorkReturn } from './combat/command/return'
import type { CommandResult, CoreBlockReason } from './engine'
import type { GameState, WreckLogCause } from './state'
import { noteWreckLog } from './shipWrecks'
import type { SimContext } from './types'
import { allFittedIds, uidDefId } from './labels'
import { allFittedModules } from './equipment'
import { fleetDefOf, shipDisplayName } from './instances'
import { createPlayerSpec } from './combat'
import { retireSalvageShip } from './salvaging'
import { retireMiningShip } from './mining'
import { cancelHaulingOnSwitch } from './hauling'
import { cancelAiTask } from './aiCores'
import { countWare, removeWare } from './inventory'
import { quickRepairFactor } from './repair'
import { noteOfflineRepairKits } from './offlineCombatStats'
import { plugBlockReasonOf } from './plugs'
import {
  noteShipWreck,
  reinforceChanceOfFitted,
} from './shipWrecks'

export { addShipToFleet, allocateShipUid, restoreShipFromWreck, isShipLocked, shipStoredCount } from './fleetBook'
import { addShipToFleet, isShipLocked, shipStoredCount, stationShipRemovalBlock } from './fleetBook'

export { fleetDefOf } from './instances'

export { shipDisplayName } from './instances'

export function renameShip(state: GameState, uid: string, name: string | null): CommandResult {
  const entry = state.fleet[uid]
  if (!entry) return { ok: false, error: '机库里没有这艘船。', errorId: 'core.shipyard.001' }
  if (name === null) {
    if (entry.customName === null) return { ok: false, error: '该船用的就是默认名。', errorId: 'core.shipyard.002' }
    entry.customName = null
    addLog(state, 'fleet', '已恢复默认船名。', 'core.shipyard.015')
    return { ok: true }
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, error: '船名不能为空。', errorId: 'core.shipyard.003' }
  if ([...trimmed].length > 10) return { ok: false, error: '船名最多 10 个字。', errorId: 'core.shipyard.004' }
  entry.customName = trimmed
  addLog(state, 'fleet', `该船已命名为「${trimmed}」。`, 'core.shipyard.016', { p1: trimmed })
  return { ok: true }
}

export function ownsShip(state: GameState, shipId: string): boolean {
  return shipId in state.fleet
}

export function changeShipBlockReason(state: GameState, shipId: string, ctx: SimContext): CoreBlockReason | null {
  if (state.departure) return { error: 'departure-in-progress', errorId: state.departure.progressMs < state.departure.undockMs ? 'core.departure.001' : 'core.departure.002' }
  if (state.hauling.active && state.hauling.fleetLeg) return { error: 'hauling-return-required', errorId: 'core.industrial.006' }
  const lock = shipLockedReason(state, shipId, '换驾驶到它')
  if (lock) return { error: lock }
  if (shipId === state.shipId) {
    const alreadyName = shipDisplayName(state, ctx, shipId)
    return { error: `正在驾驶的就是 ${alreadyName}。`, errorId: 'core.shipyard.034', errorParams: { p1: alreadyName } }
  }
  if (!ownsShip(state, shipId)) {
    const defName = ctx.ships.get(uidDefId(shipId))?.name ?? shipId
    return {
      error: `机库里没有 ${defName}——先到商店购买，或用舰船蓝图制造一艘。`,
      errorId: 'core.shipyard.035',
      errorParams: { p1: defName },
    }
  }
  const def = fleetDefOf(state, ctx, shipId)
  if (!def) return { error: `未知舰船：${shipId}。`, errorId: 'core.shipyard.036', errorParams: { p1: shipId } }
  const assignments = { ...state.aiAssignments }
  const targetTask = assignments[shipId]?.task
  if (targetTask?.kind !== 'expedition' || targetTask.phase !== 'battle' && targetTask.battle === null) delete assignments[shipId]
  const targetBlock = shipOperationBlockReason({ ...state, aiAssignments: assignments }, ctx, shipId, 'configure')
  if (targetBlock) return targetBlock
  const lockReason = cannotInterruptReason(state)
  if (lockReason !== null) {
    const id = lockReason.includes('战斗中')
      ? 'core.activityGate.004'
      : lockReason.includes('虫洞')
        ? 'core.activityGate.005'
        : 'core.activityGate.006'
    return { error: lockReason, errorId: id }
  }
  if (state.expedition.active && state.expedition.phase !== 'back') {
    return {
      error:
        '远征出击/交火中：切换驾驶会中断本次远征（无战果）。请先在顶部活动栏召回远征（交火中可撤退），或等战报返回后再换船。',
      errorId: 'core.shipyard.005',
    }
  }
  if (state.standby.active) {
    return { error: '舰船正前往掩护巡逻星系途中——到港后再换船。', errorId: 'core.shipyard.006' }
  }
  const returning = state.shipReturns[state.shipId] !== undefined
  const projected = state.hauling.active
    ? { ...state, awayGalaxy: null, dockedSite: state.hauling.fromSiteId }
    : returning ? { ...state, awayGalaxy: null, dockedSite: null } : state
  if (projected.awayGalaxy !== null) {
    const where = state.transit.active
      ? state.transit.delivery
        ? '正在交付航线途中'
        : '正在返航空间站途中'
      : `停留在「${ctx.galaxies.get(projected.awayGalaxy)?.name ?? projected.awayGalaxy}」星系（野外）`
    const awayName = ctx.galaxies.get(projected.awayGalaxy)?.name ?? projected.awayGalaxy
    const whereId = state.transit.active ? (state.transit.delivery ? 'core.shipyard.037' : 'core.shipyard.038') : 'core.shipyard.039'
    return {
      error: `驾驶船${where}——请先「返航空间站」再换船。`,
      errorId: whereId,
      errorParams: state.transit.active ? {} : { p1: awayName },
    }
  }
  if (projected.dockedSite !== null) {
    const dockSite = ctx.stations.get(projected.dockedSite)
    const prog = dockSite ? state.stationSites[dockSite.id] : null
    if (!dockSite || !prog || prog.stage < dockSite.tiers.length) {
      const name = dockSite?.name ?? projected.dockedSite
      return {
        error: `「${name}」尚未建成：工地不提供停靠与服务，换驾驶需在母港或已建成的副站进行。`,
        errorId: 'core.shipyard.040',
        errorParams: { p1: name },
      }
    }
  }
  const handover = {
    ...projected,
    shipReturns: { ...projected.shipReturns },
    mining: { ...state.mining, active: false },
    salvaging: { ...state.salvaging, active: false },
    hauling: { ...state.hauling, active: false },
    expedition: { ...state.expedition, active: false },
  }
  if (returning) delete handover.shipReturns[state.shipId]
  return shipOperationBlockReason(handover, ctx, state.shipId, 'cargo')
}

export function changeShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  const blocked = changeShipBlockReason(state, shipId, ctx)
  if (blocked) return { ok: false, ...blocked }
  if (state.shipReturns[state.shipId]) {
    const pending = state.pendingActivityReturn
    if (pending?.kind === 'mining') retireMiningShip(state, ctx, { beltId: pending.id, preserveExisting: true, progress: pending.progress })
    else if (pending?.kind === 'salvaging') retireSalvageShip(state, ctx, { galaxyId: pending.id, preserveExisting: true, progress: pending.progress })
    state.pendingActivityReturn = null
    state.haltedBySwitch = null
    state.awayGalaxy = null
    state.dockedSite = null
  }
  delete state.pendingStationActivity
  if (state.hauling.active) cancelHaulingOnSwitch(state, ctx)
  if (state.expedition.active && state.expedition.phase === 'back') {
    const exp = state.expedition
    const oldShip = state.shipId
    const oldName = shipDisplayName(state, ctx, oldShip)
    const remainMs = Math.max(1, exp.finishAtGameMs - state.gameMs)
    state.shipReturns[oldShip] = { beltId: null, legMs: remainMs, phaseAccMs: 0, reason: 'expedition' }
    if (state.autoLoopAnomalyId !== null) {
      state.autoLoopAnomalyId = null
      addLog(state, 'combat', '重复清剿已停止（返航中切换驾驶）。', 'core.state.009')
    }
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    exp.returnReason = undefined
    detachExpeditionReturn(state)
    addLog(
      state,
      'fleet',
      `远征返航转旧船善后：${oldName} 约 ${Math.max(1, Math.round(remainMs / 1000))} 秒后到港并自动卸货入仓库（战果已在交火结算时入账）。`,
      'core.shipyard.017',
      { p1: oldName, p2: Math.max(1, Math.round(remainMs / 1000)) },
    )
  }
  if (state.mining.active) {
    retireMiningShip(state, ctx)
  }
  if (state.salvaging.active) {
    retireSalvageShip(state, ctx)
  }
  if (shipId in state.aiAssignments) {
    cancelAiTask(state, shipId, ctx)
  }
  detachWorkReturn(state)
  state.shipId = shipId
  addLog(state, 'fleet', `已切换到驾驶 ${shipDisplayName(state, ctx, shipId)}。`, 'core.shipyard.018', {
    p1: shipDisplayName(state, ctx, shipId),
  })
  return { ok: true }
}


export function loseShip(
  state: GameState,
  shipId: string,
  ctx: SimContext,
  reason: string,
  wreckGalaxyId?: string,
  meta?: { cause?: WreckLogCause; wormholeDepth?: number; reasonId?: string },
): void {
  const display = shipDisplayName(state, ctx, shipId)
  const wasCurrent = state.shipId === shipId
  {
    const doomed = state.fleet[shipId]
    const defId = doomed?.defId ?? uidDefId(shipId)
    const seq = (state.wreckLogSeq ?? 0) + 1
    state.wreckLogSeq = seq
    noteWreckLog(state, {
      seq,
      shipId,
      shipName: display,
      ...(ctx.ships.has(defId) ? { defId } : {}),
      cause: meta?.cause ?? 'expedition-lost',
      ...(wreckGalaxyId !== undefined && wreckGalaxyId.length > 0 ? { wreckGalaxyId } : {}),
      ...(meta?.wormholeDepth !== undefined ? { wormholeDepth: meta.wormholeDepth } : {}),
      atGameMs: state.gameMs,
      ...(doomed?.fitted !== undefined ? { fitted: doomed.fitted } : {}),
      ...((doomed?.plugs?.length ?? 0) > 0 ? { plugs: [...(doomed?.plugs ?? [])] } : {}),
      ...(doomed?.damagePlugs?.length ? { damagePlugs: [...doomed.damagePlugs] } : {}),
      ...(doomed?.droneLoad !== undefined ? { droneLoad: doomed.droneLoad } : {}),
    })
  }
  if (wreckGalaxyId !== undefined && wreckGalaxyId.length > 0) {
    const doomed = state.fleet[shipId]
    const defId = doomed?.defId ?? uidDefId(shipId)
    if (ctx.ships.has(defId)) {
      noteShipWreck(state, {
        galaxyId: wreckGalaxyId,
        shipId,
        shipName: display,
        defId,
        customName: doomed?.customName ?? null,
        ...(doomed?.damagePlugs?.length ? { damagePlugs: [...doomed.damagePlugs] } : {}),
        ...(doomed?.durability !== undefined ? { durability: doomed.durability } : {}),
        ...(doomed?.armorPct !== undefined ? { armorPct: doomed.armorPct } : {}),
        ...(doomed?.fitted !== undefined ? { fitted: doomed.fitted } : {}),
        ...(doomed?.droneLoad !== undefined ? { droneLoad: doomed.droneLoad } : {}),
        ...((doomed?.plugs?.length ?? 0) > 0 ? { plugs: [...(doomed?.plugs ?? [])] } : {}),
        reinforceChance: reinforceChanceOfFitted(doomed?.fitted, ctx, doomed?.plugs),
        createdAtWallMs: state.wallMs,
      })
      addLog(state, 'fleet', `${display} 的残骸留在「${ctx.galaxies.get(wreckGalaxyId)?.name ?? wreckGalaxyId}」——48 小时内可打捞回收部分装备。`, 'core.shipyard.033', {
        p1: display,
        p2: ctx.galaxies.get(wreckGalaxyId)?.name ?? wreckGalaxyId,
      })
    }
  }
  delete state.fleet[shipId]
  // 仅真实战沉解除空闲绑定；人员与培养记录保留，实际站内任务锁不在此剪枝。
  const station = state.playerStation
  if (station && !station.shipLocks[shipId]) {
    for (const team of station.crew.teams) if (team.shipId === shipId && (team.activity === 'idle' || team.activity === 'qualifying')) {
      delete team.shipId
      team.planned = false
    }
    if (station.population.plan?.shipId === shipId && station.population.trip?.shipId !== shipId) delete station.population.plan
  }
  addLog(state, 'fleet', `${reason}：${display} 已损毁，船上的货仓与装备一并遗失。`, 'core.shipyard.020', {
    p1: reason,
    ...(meta?.reasonId ? { p1Id: meta.reasonId } : {}),
    p2: display,
  })

  if (wasCurrent) reconcilePilotShip(state, ctx)

  if (state.mining.active && !state.fleet[state.shipId]) {
    state.mining.active = false
    state.mining.phase = 'mining'
    state.mining.phaseAccMs = 0
    state.mining.cycleAccMs = 0
    state.mining.rvLeft = 0
  }
  if (state.salvaging.active && !state.fleet[state.shipId]) {
    state.salvaging.active = false
    state.salvaging.galaxyId = null
    state.salvaging.phase = 'salvaging'
    state.salvaging.phaseAccMs = 0
    state.salvaging.cycleAccMs = 0
    state.salvaging.tripM3 = 0
    state.salvaging.deviceAccMs = {}
  }
}

import { pilotUnavailableReason } from './activityGate'

export function reconcilePilotShip(state: GameState, ctx: SimContext): void {
  const reason = pilotUnavailableReason(state)
  if (reason === null) return
  const wasBusy = state.fleet[state.shipId] !== undefined
  const run = state.wormhole.run
  if (run && run.fleet.includes(state.shipId)) {
    const mate = run.fleet.find((id) => state.fleet[id] !== undefined && state.aiAssignments[id] === undefined)
    if (mate !== undefined) {
      state.shipId = mate
      addLog(
        state,
        'combat',
        '主控在虫洞里战沉——已由同队的 ' + shipDisplayName(state, ctx, mate) + ' 在洞内接任主控。',
        'core.shipyard.021',
        { p1: shipDisplayName(state, ctx, mate) },
      )
      return
    }
  }
  const idle = Object.keys(state.fleet).find((id) => state.aiAssignments[id] === undefined)
  if (idle !== undefined) {
    state.shipId = idle
    addLog(
      state,
      'fleet',
      wasBusy
        ? '驾驶中的舰船正被 AI 执勤占用——已自动改派驾驶 ' + shipDisplayName(state, ctx, idle) + '。'
        : '舰队里找不到正在驾驶的舰船——已自动改派驾驶 ' + shipDisplayName(state, ctx, idle) + '。',
      wasBusy ? 'core.shipyard.022' : 'core.shipyard.023',
      { p1: shipDisplayName(state, ctx, idle) },
    )
    return
  }
  state.shipId = addShipToFleet(state, DEFAULT_START_SHIP_ID)
  addLog(
    state,
    'fleet',
    '协会补助：一艘全新的磷虾级采矿艇已停靠机库（保底舰船；其余舰船正被 AI 执勤占用或已全损）。',
    'core.shipyard.024',
  )
}

export function durabilityOf(state: GameState, shipId: string): number {
  return state.fleet[shipId]?.durability ?? 0
}


function repairTierWeight(def: { priceIsk: number; armorHp?: number; hullHp?: number }): number {
  const price = def.priceIsk ?? 0
  const poolKey = (def.armorHp ?? 0) + (def.hullHp ?? 0)
  const key = price > 0 ? price : poolKey
  if (price > 0 ? key < 200_000 : key < 200) return 0.4
  if (price > 0 ? key < 800_000 : key < 400) return 0.7
  if (price > 0 ? key < 1_500_000 : key < 700) return 1.0
  return 1.4
}

function layerCaps(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { capA: number; capH: number; baseA: number; baseH: number } | null {
  const spec = createPlayerSpec(state, ctx, shipId)
  const def = fleetDefOf(state, ctx, shipId)
  if (!spec || !def) return null
  return { capA: spec.hp.a, capH: spec.hp.h, baseA: def.armorHp ?? 0, baseH: def.hullHp ?? 0 }
}

export function hullLayerCaps(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { capA: number; capH: number; baseA: number; baseH: number } | null {
  return layerCaps(state, ctx, shipId)
}

function kitHealFor(
  state: GameState,
  ctx: SimContext,
  baseHp: number,
  caps: { capA: number; capH: number; baseA: number; baseH: number } | null,
): { a: number; h: number } {
  const skill = quickRepairFactor(state, ctx)
  const aMult = caps && caps.baseA > 0 ? caps.capA / caps.baseA : 1
  const hMult = caps && caps.baseH > 0 ? caps.capH / caps.baseH : 1
  return { a: Math.max(1, ceilFinalQuantity(baseHp * aMult * skill)), h: Math.max(1, ceilFinalQuantity(baseHp * hMult * skill)) }
}

export function repairCostIsk(state: GameState, shipId: string, ctx: SimContext): number {
  const fleetShip = state.fleet[shipId]
  const def = fleetDefOf(state, ctx, shipId)
  if (!fleetShip || !def) return 0
  const caps = layerCaps(state, ctx, shipId)
  if (!caps) return 0
  const missingHp =
    Math.max(0, 1 - fleetShip.durability) * caps.capH + Math.max(0, 1 - (fleetShip.armorPct ?? 1)) * caps.capA
  const engLv = Math.min(5, state.skills.trained['repair-engineering'] ?? 0)
  const protoLv = Math.min(5, state.skills.trained['station-protocol'] ?? 0)
  const disc = Math.max(0, (1 - 0.1 * engLv) * (1 - 0.05 * protoLv))
  return Math.ceil(missingHp * ctx.balance.repair.perHpCost * repairTierWeight(def) * disc)
}

export function repairShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  const blocked = shipOperationBlockReason(state, ctx, shipId, 'repair')
  if (blocked) return { ok: false, ...blocked }
  const fleetShip = state.fleet[shipId]
  const def = fleetDefOf(state, ctx, shipId)
  const name = shipDisplayName(state, ctx, shipId)
  if (!fleetShip || !def) return { ok: false, error: `机库里没有 ${name}。`, errorId: 'core.shipyard.041', errorParams: { p1: name } }
  if (fleetShip.durability >= 1 && (fleetShip.armorPct ?? 1) >= 1) {
    return { ok: false, error: `${name} 状态完好，无需维修。`, errorId: 'core.shipyard.044', errorParams: { p1: name } }
  }
  const cost = repairCostIsk(state, shipId, ctx)
  if (state.wallet.isk < cost) {
    return {
      ok: false,
      error: `维修费不足：需要 ${cost.toLocaleString('zh-CN')} 信用点。`,
      errorId: 'core.shipyard.045',
      errorParams: { p1: cost.toLocaleString('zh-CN') },
    }
  }
  state.wallet.isk -= cost
  fleetShip.durability = 1
  fleetShip.armorPct = 1
  bumpFirst(state, 'repairs')
  addLog(
    state,
    'trade',
    `已完成 ${name} 的全面维修（${cost.toLocaleString('zh-CN')} 信用点），结构/装甲恢复至 100%。`,
    'core.shipyard.025',
    { p1: name, p2: cost.toLocaleString('zh-CN') },
  )
  return { ok: true }
}

export interface FleetRepairPlan {
  repairableShipIds: string[]
  totalCost: number
  fullCount: number
  blockedCount: number
}

export function fleetRepairPlan(state: GameState, ctx: SimContext): FleetRepairPlan {
  const repairableShipIds: string[] = []
  let totalCost = 0
  let fullCount = 0
  let blockedCount = 0

  for (const shipId of Object.keys(state.fleet)) {
    const fleetShip = state.fleet[shipId]!
    if (shipOperationBlockReason(state, ctx, shipId, 'repair')) {
      blockedCount += 1
      continue
    }
    const armorPct = fleetShip.armorPct ?? 1
    const isFull = fleetShip.durability >= 1 && armorPct >= 1
    if (isFull) fullCount += 1
    if (isFull || !Number.isFinite(fleetShip.durability) || !Number.isFinite(armorPct)) continue
    if (!fleetDefOf(state, ctx, shipId) || !layerCaps(state, ctx, shipId)) continue

    const cost = repairCostIsk(state, shipId, ctx)
    if (!Number.isFinite(cost) || cost < 0) continue
    repairableShipIds.push(shipId)
    totalCost += cost
  }

  return { repairableShipIds, totalCost, fullCount, blockedCount }
}

export type FleetRepairResult =
  | { ok: true; repairedCount: number; totalCost: number; fullCount: number; blockedCount: number }
  | CommandResult

export function repairFleet(state: GameState, ctx: SimContext): FleetRepairResult {
  const plan = fleetRepairPlan(state, ctx)
  if (plan.repairableShipIds.length === 0) {
    return { ok: false, error: '舰队中没有可修复的受损舰船。' }
  }

  let checkedCost = 0
  for (const shipId of plan.repairableShipIds) {
    const fleetShip = state.fleet[shipId]
    const cost = repairCostIsk(state, shipId, ctx)
    if (
      !fleetShip ||
      !fleetDefOf(state, ctx, shipId) ||
      !layerCaps(state, ctx, shipId) ||
      !Number.isFinite(fleetShip.durability) ||
      !Number.isFinite(fleetShip.armorPct ?? 1) ||
      (fleetShip.durability >= 1 && (fleetShip.armorPct ?? 1) >= 1) ||
      shipOperationBlockReason(state, ctx, shipId, 'repair') !== null ||
      !Number.isFinite(cost) ||
      cost < 0
    ) {
      return { ok: false, error: '舰队维修计划已失效，请重新确认。' }
    }
    checkedCost += cost
  }

  if (!Number.isFinite(checkedCost) || checkedCost !== plan.totalCost) {
    return { ok: false, error: '舰队维修计划已失效，请重新确认。' }
  }
  if (!Number.isFinite(state.wallet.isk) || state.wallet.isk < checkedCost) {
    const amount = checkedCost.toLocaleString('zh-CN')
    return {
      ok: false,
      error: `维修费不足：需要 ${amount} 信用点。`,
      errorId: 'core.shipyard.045',
      errorParams: { p1: amount },
    }
  }

  for (const shipId of plan.repairableShipIds) {
    const result = repairShip(state, shipId, ctx)
    if (!result.ok) return { ok: false, error: '舰队维修计划已失效，请重新确认。' }
  }

  return {
    ok: true,
    repairedCount: plan.repairableShipIds.length,
    totalCost: checkedCost,
    fullCount: plan.fullCount,
    blockedCount: plan.blockedCount,
  }
}


export interface RepairWithKitsResult {
  used: number
  reachedTarget: boolean
  outOfKits: boolean
  hasDevice: boolean
  kitIds: string[]
}

export function repairKitIdsOf(state: GameState, ctx: SimContext, shipId: string): string[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  const out: string[] = []
  for (const d of allFittedModules(ship.fitted, ctx)) {
    const kit = d.repairKit
    if (typeof kit === 'string' && kit.length > 0 && !out.includes(kit)) out.push(kit)
  }
  return out
}

export function repairWithKitsFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  target = 0.5,
  source: 'cargo' | 'cargo+warehouse' = 'cargo',
): RepairWithKitsResult {
  const lock = shipLockedReason(state, shipId, '用维修装置修它')
  if (lock) return { used: 0, reachedTarget: true, outOfKits: false, hasDevice: false, kitIds: [] }
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return { used: 0, reachedTarget: true, outOfKits: false, hasDevice: false, kitIds: [] }
  const caps = layerCaps(state, ctx, shipId)
  const damaged = (): boolean => fleetShip.durability < target || (fleetShip.armorPct ?? 1) < target
  const kitIds = repairKitIdsOf(state, ctx, shipId)
  if (kitIds.length === 0) {
    return { used: 0, reachedTarget: !damaged(), outOfKits: false, hasDevice: false, kitIds: [] }
  }
  let used = 0
  const usedByType: Record<string, number> = {}
  let guard = 0
  while (damaged() && guard < 1000) {
    guard += 1
    const kitId = takeRepairKit(state, ctx, shipId, source, kitIds)
    if (kitId === null) break
    const def = ctx.items.get(kitId)!
    const heal = kitHealFor(state, ctx, def.repairRestore!, caps)
    bumpFirst(state, 'repairs')
    if (caps) {
      fleetShip.durability = Math.min(1, Math.round((fleetShip.durability + heal.h / caps.capH) * 1000) / 1000)
      fleetShip.armorPct = Math.min(1, Math.round(((fleetShip.armorPct ?? 1) + heal.a / caps.capA) * 1000) / 1000)
    }
    used += 1
    noteOfflineRepairKits(state, 1)
    usedByType[kitId] = (usedByType[kitId] ?? 0) + 1
  }
  if (used > 0) {
    const kinds = Object.entries(usedByType)
      .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} ×${n}`)
      .join('、')
    addLog(
      state,
      'fleet',
      `自动使用修理组件 ×${used}（${kinds}）：${shipDisplayName(state, ctx, shipId)} 结构恢复至 ${Math.round(fleetShip.durability * 100)}%、装甲 ${Math.round((fleetShip.armorPct ?? 1) * 100)}%。`,
      'core.shipyard.026',
      {
        p1: used,
        p2: kinds,
        p3: shipDisplayName(state, ctx, shipId),
        p4: Math.round(fleetShip.durability * 100),
        p5: Math.round((fleetShip.armorPct ?? 1) * 100),
      },
    )
  }
  const reached = !damaged()
  return { used, reachedTarget: reached, outOfKits: !reached, hasDevice: true, kitIds }
}

function takeRepairKit(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  source: 'cargo' | 'cargo+warehouse',
  allowed: readonly string[],
): string | null {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  void ctx
  for (const id of allowed) {
    const inCargo = fleetShip.cargo[id] ?? 0
    if (inCargo > 0) {
      if (inCargo <= 1) delete fleetShip.cargo[id]
      else fleetShip.cargo[id] = inCargo - 1
      return id
    }
    if (source === 'cargo+warehouse' && countWare(state, id) > 0) {
      removeWare(state, id, 1)
      return id
    }
  }
  return null
}

export function repairWithKits(state: GameState, ctx: SimContext, target = 0.5): RepairWithKitsResult {
  return repairWithKitsFor(state, ctx, state.shipId, target, 'cargo')
}

export function useOneRepairKit(state: GameState, ctx: SimContext): CommandResult {
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) return { ok: false, error: '舰队里找不到当前舰船。', errorId: 'core.shipyard.007' }
  if (fleetShip.durability >= 1 && (fleetShip.armorPct ?? 1) >= 1) {
    return { ok: false, error: '结构/装甲状态完好，无需修理组件。', errorId: 'core.shipyard.008' }
  }
  const order = ['repairkit-civ', 'repairkit-mil'] as const
  let kitId: string | null = null
  for (const id of order) {
    if ((fleetShip.cargo[id] ?? 0) > 0) {
      kitId = id
      break
    }
  }
  if (kitId === null) {
    return {
      ok: false,
      error: '货仓里没有修理组件——市场购入或蓝图自制后装入货仓。',
      errorId: 'core.shipyard.009',
    }
  }
  const def = ctx.items.get(kitId)
  if (!def || typeof def.repairRestore !== 'number') {
    return { ok: false, error: '修理组件异常。', errorId: 'core.shipyard.010' }
  }
  const caps = layerCaps(state, ctx, state.shipId)
  const heal = kitHealFor(state, ctx, def.repairRestore, caps)
  const left = fleetShip.cargo[kitId]!
  if (left <= 1) delete fleetShip.cargo[kitId]
  else fleetShip.cargo[kitId] = left - 1
  if (caps) {
    fleetShip.durability = Math.min(1, Math.round((fleetShip.durability + heal.h / caps.capH) * 1000) / 1000)
    fleetShip.armorPct = Math.min(1, Math.round(((fleetShip.armorPct ?? 1) + heal.a / caps.capA) * 1000) / 1000)
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  bumpFirst(state, 'repairs')
  addLog(
    state,
    'fleet',
    `✚ 使用 ${def.name} ×1：${shipName} 结构恢复至 ${Math.round(fleetShip.durability * 100)}%、装甲 ${Math.round((fleetShip.armorPct ?? 1) * 100)}%。`,
    'core.shipyard.027',
    {
      p1: def.name,
      p2: shipName,
      p3: Math.round(fleetShip.durability * 100),
      p4: Math.round((fleetShip.armorPct ?? 1) * 100),
    },
  )
  return { ok: true }
}

export function lockShip(state: GameState, shipId: string, locked: boolean, ctx: SimContext): CommandResult {
  if (!ownsShip(state, shipId)) return { ok: false, error: `机库里没有这艘船。`, errorId: 'core.shipyard.001' }
  const name = shipDisplayName(state, ctx, shipId)
  if (locked) {
    if (isShipLocked(state, shipId)) {
      return { ok: false, error: `${name} 已处于锁定状态。`, errorId: 'core.shipyard.013', errorParams: { p1: name } }
    }
    state.shipLocks[shipId] = true
    addLog(state, 'fleet', `已锁定 ${name}：此船不可移入舰船仓库（可随时在舰船页解锁）。`, 'core.shipyard.028', {
      p1: name,
    })
  } else {
    if (!isShipLocked(state, shipId)) {
      return { ok: false, error: `${name} 当前未锁定。`, errorId: 'core.shipyard.014', errorParams: { p1: name } }
    }
    delete state.shipLocks[shipId]
    addLog(state, 'fleet', `已解锁 ${name}：恢复可移入舰船仓库。`, 'core.shipyard.029', { p1: name })
  }
  return { ok: true }
}


export function shipOwnedCount(state: GameState, defId: string): number {
  let n = shipStoredCount(state, defId)
  for (const [uid, s] of Object.entries(state.fleet)) {
    if ((s.defId ?? uidDefId(uid)) === defId) n += 1
  }
  return n
}

export function shipStorable(
  state: GameState,
  uid: string,
): {
  ok: boolean
  reason?: string
  reasonId?: string
  reasonParams?: Record<string, string | number>
  named?: boolean
} {
  const ship = state.fleet[uid]
  if (!ship) return { ok: false, reason: '机库里没有这艘船。', reasonId: 'core.shipyard.046' }
  const binding = stationShipRemovalBlock(state, uid)
  if (binding) return { ok: false, reason: binding.error, reasonId: binding.errorId }
  if (state.shipId === uid) return { ok: false, reason: '正在驾驶的船不能入仓：先换到别的船上。', reasonId: 'core.shipyard.047' }
  if (state.aiAssignments[uid]) return { ok: false, reason: 'AI 任务执行中的船不能入仓，先取消指派。', reasonId: 'core.shipyard.048' }
  if (isShipLocked(state, uid)) return { ok: false, reason: '该船已锁定（防误操作）：先到舰船页解锁。', reasonId: 'core.shipyard.049' }
  if (uid in state.shipReturns) return { ok: false, reason: '该船正在返航卸货（换船善后），到港后才能入仓。', reasonId: 'core.shipyard.050' }
  const cargoUnits = Object.values(ship.cargo).reduce((a, b) => a + b, 0)
  if (cargoUnits > 0) return { ok: false, reason: '货仓里有物品，请先清空。', reasonId: 'core.shipyard.051' }
  if (allFittedIds(ship.fitted).length > 0) return { ok: false, reason: '还装着模块，请先卸下。' }
  const plugBlock = plugBlockReasonOf(state, uid)
  if (plugBlock) return { ok: false, reason: plugBlock.text, reasonId: plugBlock.textId, reasonParams: plugBlock.params }
  if ((ship.durability ?? 1) < 1 || (ship.armorPct ?? 1) < 1) {
    return { ok: false, reason: '只有满耐久（结构与装甲都完好）的船才能入仓：先维修。', reasonId: 'core.shipyard.052' }
  }
  if (ship.customName) return { ok: false, reason: '该船有自定义名——入仓会清掉它。', reasonId: 'core.shipyard.053', named: true }
  return { ok: true }
}

export function storeShip(
  state: GameState,
  uid: string,
  ctx: SimContext,
  opts?: { clearName?: boolean },
): CommandResult {
  const lock = shipLockedReason(state, uid, '移入舰船仓库')
  if (lock) return { ok: false, error: lock }
  const check = shipStorable(state, uid)
  if (!check.ok && !(check.named === true && opts?.clearName === true)) {
    return { ok: false, error: check.reason ?? '这艘船不能入仓。', errorId: check.reasonId ?? 'core.shipyard.054', errorParams: check.reasonParams }
  }
  const ship = state.fleet[uid]!
  const defId = ship.defId ?? uidDefId(uid)
  const name = shipDisplayName(state, ctx, uid)
  delete state.fleet[uid]
  delete state.shipLocks[uid]
  state.shipStore = state.shipStore ?? {}
  state.shipStore[defId] = shipStoredCount(state, defId) + 1
  addLog(
    state,
    'fleet',
    check.named === true
      ? `${name} 已移入舰船仓库（自定义名随之清除）：仓库现有 ${state.shipStore[defId]} 艘。`
      : `${name} 已移入舰船仓库：仓库现有 ${state.shipStore[defId]} 艘。`,
    check.named === true ? 'core.shipyard.030' : 'core.shipyard.031',
    { p1: name, p2: state.shipStore[defId] },
  )
  return { ok: true }
}

export function unstoreShip(state: GameState, defId: string, ctx: SimContext): CommandResult {
  const n = shipStoredCount(state, defId)
  if (n <= 0) return { ok: false, error: '舰船仓库里没有这一型。', errorId: 'core.shipyard.011' }
  const def = ctx.ships.get(defId)
  if (!def) return { ok: false, error: `未知舰船：${defId}。`, errorId: 'core.shipyard.012', errorParams: { p1: defId } }
  state.shipStore![defId] = n - 1
  if (state.shipStore![defId] <= 0) delete state.shipStore![defId]
  const uid = addShipToFleet(state, defId)
  addLog(state, 'fleet', `${shipDisplayName(state, ctx, uid)} 已从舰船仓库转入舰队（机库）。`, 'core.shipyard.032', {
    p1: shipDisplayName(state, ctx, uid),
  })
  return { ok: true }
}
