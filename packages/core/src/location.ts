import { addLog, HOME_GALAXY_ID } from './state'
import { applyActivityGate, gateMainActivity, type MainActivityKind } from './activityGate'
import { beginDeparture, cancelDeparture, departureOrigin } from './departure'
import type { CoreBlockReason } from './engine'
import { shipActuallyDocked } from './shipActionPolicy'
import { queueStationActivity, stationActivityWaitsForReturn } from './stationActivityPending'
import { pilotUnavailableReason } from './activityGate'
import type { GameState } from './state'
import type { CommandResult } from './engine'
import type { AiCoreType, SimContext, StationSiteDef } from './types'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { deliverStationResources, noteStationSiteAt, tierRemaining, stationBillView, stationBillText, billNeedOf, billRemainingOf } from './station'
import { siteProgress } from './state'
import { cargoCapacityM3Of, cargoOfShip, cargoUsedM3Of, unloadCargoOfShipToWarehouse } from './inventory'

const LOCATION_LOG_IDS = new Set([
  'core.location.035',
  'core.location.042',
  'core.location.043',
  'core.location.055',
  'core.location.056',
  'core.station.010',
  'core.station.011',
])

function dockUnloadNote(state: GameState, ctx: SimContext, shipId: string): { text: string; id?: string; unit?: string } {
  const moved = unloadCargoOfShipToWarehouse(state, ctx, shipId)
  const unit = moved.toLocaleString('zh-CN')
  return moved > 0
    ? { text: `货仓已自动卸入物品仓库（${unit} 单位）。`, id: 'core.location.037', unit }
    : { text: '' }
}

export function stationGalaxyIds(state: GameState, ctx: SimContext): string[] {
  const out = [HOME_GALAXY_ID]
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites[site.id]
    if (prog && prog.stage >= site.tiers.length) out.push(site.galaxyId)
  }
  return out
}

export function nearestStationGalaxyId(state: GameState, ctx: SimContext, fromGalaxy: string): string {
  let best = HOME_GALAXY_ID
  let bestMin = shortestTravelMinutes(ctx, fromGalaxy, HOME_GALAXY_ID)
  if (!Number.isFinite(bestMin)) bestMin = Number.POSITIVE_INFINITY
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites[site.id]
    if (!prog || prog.stage < site.tiers.length) continue
    const m = shortestTravelMinutes(ctx, fromGalaxy, site.galaxyId)
    if (Number.isFinite(m) && m < bestMin) {
      bestMin = m
      best = site.galaxyId
    }
  }
  return best
}

export function builtSiteAtGalaxy(state: GameState, ctx: SimContext, galaxyId: string): string | null {
  for (const site of ctx.stations.values()) {
    if (site.galaxyId !== galaxyId) continue
    const prog = state.stationSites[site.id]
    if (prog && prog.stage >= site.tiers.length) return site.id
  }
  return null
}

export function miningReturnLegMs(state: GameState, ctx: SimContext, beltId: string | null | undefined, shipId = state.shipId): number {
  if (state.debugQuick) return 1000
  const belt = beltId ? ctx.belts.get(beltId) : undefined
  const stGal = belt?.galaxyId ? nearestStationGalaxyId(state, ctx, belt.galaxyId) : HOME_GALAXY_ID
  const mins = belt && belt.galaxyId ? shortestTravelMinutes(ctx, stGal, belt.galaxyId) : 0
  const travel = Number.isFinite(mins) ? travelLegMs(state, ctx, mins, shipId) : 0
  return Math.max(1, ctx.balance.mining.localLegMs + travel)
}

export function dockedStation(state: GameState): { siteId: string | null; galaxyId: string } {
  if (state.awayGalaxy !== null) return { siteId: null, galaxyId: '' }
  return { siteId: state.dockedSite, galaxyId: state.dockedSite ? '' : HOME_GALAXY_ID }
}

export function isAtStation(state: GameState): boolean {
  return state.awayGalaxy === null
}

export function isAtHome(state: GameState): boolean {
  return state.awayGalaxy === null && state.dockedSite === null
}

export function isAtHomeLike(state: GameState, ctx: SimContext): boolean {
  return shipActuallyDocked(state, ctx)
}

export function stationActivityReturnSite(state: GameState, ctx: SimContext): string | null {
  const ret = state.shipReturns[state.shipId]
  const salvage = state.salvaging.active || ret?.reason === 'salvageStop' || state.pendingActivityReturn?.kind === 'salvaging'
  if (salvage) return null
  const beltId = state.mining.beltId ?? ret?.beltId ?? (state.pendingActivityReturn?.kind === 'mining' ? state.pendingActivityReturn.id : null)
  const galaxyId = beltId ? ctx.belts.get(beltId)?.galaxyId : undefined
  if (galaxyId) {
    const galaxy = nearestStationGalaxyId(state, ctx, galaxyId)
    return galaxy === HOME_GALAXY_ID ? null : builtSiteAtGalaxy(state, ctx, galaxy)
  }
  const site = state.dockedSite ? ctx.stations.get(state.dockedSite) : undefined
  return site && (state.stationSites[site.id]?.stage ?? 0) >= site.tiers.length ? site.id : null
}

export function stationActivityStartState(state: GameState, next: MainActivityKind, ctx: SimContext): GameState {
  const verdict = gateMainActivity(state, next)
  let projected = state
  if ((verdict.action === 'halt' || verdict.action === 'confirm') && verdict.current) {
    if (verdict.current === 'hauling') projected = { ...state, awayGalaxy: null, dockedSite: state.hauling.fromSiteId,
      hauling: { ...state.hauling, active: false } }
    if (verdict.current === 'standby') projected = { ...state, awayGalaxy: null, standby: { ...state.standby, active: false } }
    if (verdict.current === 'siteDeliver') projected = { ...state, awayGalaxy: null, dockedSite: null, transit: { ...state.transit, active: false } }
  }
  if (verdict.action !== 'reject' && stationActivityWaitsForReturn(state)) {
    const returns = { ...state.shipReturns }
    delete returns[state.shipId]
    projected = { ...state, awayGalaxy: null, dockedSite: stationActivityReturnSite(state, ctx),
      mining: { ...state.mining, active: false }, salvaging: { ...state.salvaging, active: false },
      shipReturns: returns, pendingActivityReturn: null }
  }
  return projected
}

export function stationActivityStartBlockReason(state: GameState, ctx: SimContext, next: MainActivityKind): CoreBlockReason | null {
  const verdict = gateMainActivity(state, next)
  if (verdict.action === 'reject') return { error: verdict.message ?? '', errorId: verdict.messageId, errorParams: verdict.messageParams }
  if (!shipActuallyDocked(stationActivityStartState(state, next, ctx), ctx)) {
    if (next === 'manufacturing') return { error: '组装机随协会基地网络运转：需停靠空间站（母港或已建成副站）才能开工制造（AI 核心驱动不受此限）。', errorId: 'core.manufacturing.001' }
    if (next === 'lab') return { error: '实验室随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。', errorId: 'core.lab.013' }
    if (next === 'hauling') return { error: '舰船在野外：先返航到空间站再安排长途运输。', errorId: 'core.hauling.002' }
    if (next === 'siteDeliver') return { error: '舰船在野外：请先「返航空间站」（母港或已建成副站），再从空间站下达「前往工地交付」。', errorId: 'core.location.012' }
    return { error: '精炼炉随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。', errorId: 'core.industry.084' }
  }
  return null
}
export function stationIndustryBlocked(worker: 'pilot' | AiCoreType, state: GameState, ctx: SimContext): boolean {
  return worker === 'pilot' && !isAtHomeLike(state, ctx)
}

export function siteDeliverFreeCargoM3(state: GameState, ctx: SimContext): number {
  const used = stationActivityWaitsForReturn(state) ? 0 : cargoUsedM3Of(state, ctx, state.shipId)
  return Math.max(0, Math.floor(cargoCapacityM3Of(state, ctx, state.shipId) - used))
}

export function originGalaxyOf(state: GameState, ctx: SimContext): string {
  if (state.awayGalaxy !== null) return state.awayGalaxy
  if (state.dockedSite !== null) {
    const site = ctx.stations.get(state.dockedSite)
    if (site) return site.galaxyId
  }
  return HOME_GALAXY_ID
}

export function isIdleField(state: GameState): boolean {
  return (
    state.awayGalaxy !== null &&
    !state.transit.active &&
    !state.expedition.active &&
    !state.mining.active &&
    !state.standby.active &&
    !state.salvaging.active
  )
}

export function startTransitHome(state: GameState, ctx: SimContext): CommandResult {
  if (state.hauling.active) return { ok: false, error: '长途运输进行中：中断本趟就拿不到本趟报酬（报酬到站才结）。请先到活动栏点「停止运输」。', errorId: 'core.location.001' }
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：舰船正在执行投送航行，到站后再返航。', errorId: 'core.location.002' }
  if (state.awayGalaxy === null) return { ok: false, error: '舰船已停靠空间站，无需返航。', errorId: 'core.location.003' }
  if (state.standby.active) return { ok: false, error: '掩护巡逻进行中——请先取消（顶部活动栏）。', errorId: 'core.location.004' }
  if (state.transit.active) return { ok: false, error: '返航行程进行中。', errorId: 'core.location.005' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先处理远征。', errorId: 'core.location.006' }
  if (state.mining.active) return { ok: false, error: '采矿作业中：请先停止开采，或直接换船（旧船会自动返航）。', errorId: 'core.location.007' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业中：请先停止打捞，或让作业自然结束（满仓自动返航）。', errorId: 'core.location.008' }
  const from = state.awayGalaxy
  const target = nearestStationGalaxyId(state, ctx, from)
  const mins = shortestTravelMinutes(ctx, from, target)
  if (!Number.isFinite(mins)) return { ok: false, error: '最近空间站不在已知航路内，无法返航。', errorId: 'core.location.009' }
  const t = state.transit
  const fromName = ctx.galaxies.get(from)?.name ?? from
  const toName = ctx.galaxies.get(target)?.name ?? '空间站'
  t.active = false
  t.fromGalaxy = null
  t.toGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  t.delivery = null
  state.awayGalaxy = null
  state.dockedSite = null
  const unloadNote = dockUnloadNote(state, ctx, state.shipId)
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites[site.id]
    if (prog && prog.stage >= site.tiers.length && site.galaxyId === target) {
      state.dockedSite = site.id
      addLog(state, 'fleet', `返航完成：舰船已即时停靠「${site.name}」（副空间站）。${unloadNote.text}`, 'core.location.039', {
        p1: site.name,
        p2: unloadNote.text,
        ...(unloadNote.id !== undefined && unloadNote.unit !== undefined
          ? { p2Id: unloadNote.id, p2p1: unloadNote.unit }
          : {}),
      })
      return { ok: true }
    }
  }
  addLog(state, 'fleet', `返航完成：舰船已即时停靠「${toName}」（自「${fromName}」归来）。${unloadNote.text}`, 'core.location.040', {
      p1: toName,
      p2: fromName,
      p3: unloadNote.text,
      ...(unloadNote.id !== undefined && unloadNote.unit !== undefined
        ? { p3Id: unloadNote.id, p3p1: unloadNote.unit }
        : {}),
    })
  return { ok: true }
}

export function advanceTransit(state: GameState, ctx: SimContext): void {
  const t = state.transit
  if (!t.active) return
  if (state.gameMs < t.finishAtGameMs) return
  const d = t.delivery
  const toGalaxy = t.toGalaxy
  const toName = toGalaxy ? ctx.galaxies.get(toGalaxy)?.name ?? toGalaxy : '空间站'
  t.active = false
  t.fromGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  t.toGalaxy = null
  t.delivery = null
  if (d && d.phase === 'to-site') {
    arriveDeliverSite(state, ctx, d.siteId, d.loaded)
    return
  }
  state.awayGalaxy = null
  state.dockedSite = null
  const unloadNote = dockUnloadNote(state, ctx, state.shipId)
  let dockedName: string | null = null
  if (toGalaxy) {
    for (const site of ctx.stations.values()) {
      const prog = state.stationSites[site.id]
      if (prog && prog.stage >= site.tiers.length && site.galaxyId === toGalaxy) {
        state.dockedSite = site.id
        dockedName = site.name
        break
      }
    }
  }
  if (d && d.phase === 'to-station') {
    addLog(
      state,
      'fleet',
      `交付任务收尾：舰船已返航停靠「${dockedName ?? toName}」${dockedName ? '（副空间站）' : ''}。${unloadNote.text}`,
      'core.location.046',
      {
        p1: dockedName ?? toName,
        p2: dockedName ? '（副空间站）' : '',
        ...(dockedName ? { p2Id: 'core.location.047' } : {}),
      p3: unloadNote.text,
      ...(unloadNote.id !== undefined && unloadNote.unit !== undefined
        ? { p3Id: unloadNote.id, p3p1: unloadNote.unit }
        : {}),
      },
    )
    continueDeliverLoop(state, ctx, d.siteId)
    return
  }
  addLog(
    state,
    'fleet',
    `返航完成：舰船已停靠「${dockedName ?? toName}」${dockedName ? '（副空间站）' : ''}。${unloadNote.text}`,
    'core.location.048',
    {
      p1: dockedName ?? toName,
      p2: dockedName ? '（副空间站）' : '',
      ...(dockedName ? { p2Id: 'core.location.047' } : {}),
      p3: unloadNote.text,
      ...(unloadNote.id !== undefined && unloadNote.unit !== undefined
        ? { p3Id: unloadNote.id, p3p1: unloadNote.unit }
        : {}),
    },
  )
}


function loadDeliverCargo(state: GameState, ctx: SimContext, site: StationSiteDef): Record<string, number> {
  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  const used = cargoUsedM3Of(state, ctx, state.shipId)
  let freeM3 = Math.max(0, Math.floor(cap - used))
  if (freeM3 <= 0) return {}
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return {}
  const ware = state.warehouse.items
  const cargo = cargoOfShip(state, state.shipId)
  const loaded: Record<string, number> = {}
  for (let k = prog.stage; k < site.tiers.length; k += 1) {
    const tier = site.tiers[k]!
    let tierLoaded = true
    for (const item of tier.bill) {
      const id = item.itemId
      const rem = k === prog.stage
        ? billRemainingOf(state, site, k, item.itemId)
        : billNeedOf(state, site, k, item.itemId)
      if (rem <= 0) continue
      const unitM3 = Math.max(0.01, ctx.items.get(id)?.unitM3 ?? 1)
      const take = Math.max(0, Math.min(ware[id] ?? 0, Math.floor(freeM3 / unitM3), rem))
      if (take < rem) tierLoaded = false
      if (take <= 0) continue
      ware[id] = (ware[id] ?? 0) - take
      if (ware[id] <= 0) delete ware[id]
      cargo[id] = (cargo[id] ?? 0) + take
      loaded[id] = (loaded[id] ?? 0) + take
      freeM3 -= Math.round(take * unitM3)
    }
    if (!tierLoaded || freeM3 <= 0) break
  }
  return loaded
}

function hasLoadableDeliverWare(state: GameState, site: StationSiteDef): boolean {
  const prog = siteProgress(state, site.id)
  for (let k = prog.stage; k < site.tiers.length; k += 1) {
    let missing = false
    for (const item of site.tiers[k]!.bill) {
      const remaining = k === prog.stage
        ? billRemainingOf(state, site, k, item.itemId)
        : billNeedOf(state, site, k, item.itemId)
      if (remaining > 0 && (state.warehouse.items[item.itemId] ?? 0) > 0) return true
      if (remaining > 0) missing = true
    }
    if (missing) return false
  }
  return false
}

export function startSiteDeliverTrip(state: GameState, ctx: SimContext, siteId: string): CommandResult {
  const site = ctx.stations.get(siteId)
  if (!site) return { ok: false, error: `未知建站点：${siteId}。`, errorId: 'core.location.010', errorParams: { p1: siteId } }
  const prog = state.stationSites[siteId] ?? { stage: 0, delivered: {} }
  if (prog.stage >= site.tiers.length) return { ok: false, error: `「${site.name}」已建成并网，无需再交付建材。`, errorId: 'core.location.011', errorParams: { p1: site.name } }
  const capV = cargoCapacityM3Of(state, ctx, state.shipId)
  const usedV = cargoUsedM3Of(state, ctx, state.shipId)
  const freeV = siteDeliverFreeCargoM3(state, ctx)
  if (freeV <= 0) {
    return { ok: false, error: '货仓没有空闲空间：先卸货入仓库腾出位置（物品页「全部卸入仓库」），再安排交付循环。', errorId: 'core.location.020' }
  }
  const preflight = { ...state, stationSites: { ...state.stationSites } }
  const billNow = stationBillText(preflight, ctx, site)
  if (!hasLoadableDeliverWare(preflight, site)) {
    return {
      ok: false,
      error: `仓库没有可装载的建材（当前档需要：${billNow}）——备料后再一键出发。`,
      errorId: 'core.location.021',
      errorParams: { p1: billNow },
    }
  }
  const dockBlock = stationActivityStartBlockReason(state, ctx, 'siteDeliver')
  if (dockBlock) return { ok: false, ...dockBlock }
  if (state.transit.active) return { ok: false, error: '已有进行中的行程（返航/交付航线）。', errorId: 'core.location.014' }
  if (!state.exploredGalaxies.includes(site.galaxyId)) {
    const g = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
    return { ok: false, error: `「${g}」尚未探明——先对其执行扫描探索，才能规划交付航线。`, errorId: 'core.location.018', errorParams: { p1: g } }
  }
  const from = originGalaxyOf(stationActivityStartState(state, 'siteDeliver', ctx), ctx)
  const mins = shortestTravelMinutes(ctx, from, site.galaxyId)
  if (!Number.isFinite(mins)) return { ok: false, error: `「${site.galaxyId}」不在已知航路内，无法规划航线。`, errorId: 'core.location.019', errorParams: { p1: site.galaxyId } }
  const queued = queueStationActivity(state, ctx, { kind: 'siteDeliver', siteId })
  if (queued) return queued
  const gateSkip = applyActivityGate(state, 'siteDeliver', ctx)
  if (gateSkip) return gateSkip
  const loaded = loadDeliverCargo(state, ctx, site)
  const loadedTotal = Object.values(loaded).reduce((s, n) => s + n, 0)
  if (loadedTotal <= 0) {
    return {
      ok: false,
      error: `仓库没有可装载的建材（当前档需要：${billNow}）——备料后再一键出发。`,
      errorId: 'core.location.021',
      errorParams: { p1: billNow },
    }
  }
  const fromName = ctx.galaxies.get(from)?.name ?? '空间站'
  const toGalaxyName = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
  const legMs = travelLegMs(state, ctx, mins)
  const departureMs = beginDeparture(state, ctx, 'siteDeliver', site.galaxyId, departureOrigin(state, ctx))
  state.dockedSite = null
  state.awayGalaxy = from
  const t = state.transit
  t.active = true
  t.fromGalaxy = from
  t.toGalaxy = site.galaxyId
  t.finishAtGameMs = state.gameMs + departureMs + legMs
  t.legMs = legMs
  t.delivery = { siteId: site.id, phase: 'to-site', loaded }
  const durTxt = legMs <= 1000 ? '约片刻' : `约 ${Math.max(1, Math.round(legMs / 60_000))} 分钟`
  addLog(
    state,
    'fleet',
    `⚑ 建站交付航线：舰船自「${fromName}」启程，驶往「${toGalaxyName}」的「${site.name}」工地（${durTxt}航程）——本趟装载建材 ${loadedTotal.toLocaleString('zh-CN')} 单位随船（货仓 ${usedV.toLocaleString('zh-CN')}/${capV.toLocaleString('zh-CN')} m³）；到点自动清仓交付，仓库还有建材就自动续趟，全部建完或建材耗尽自动终止。可随时取消（= 停止整个循环）。`,
    'core.location.049',
    {
      p1: fromName,
      p2: toGalaxyName,
      p3: site.name,
      p4: durTxt,
      p5: loadedTotal.toLocaleString('zh-CN'),
      p6: usedV.toLocaleString('zh-CN'),
      p7: capV.toLocaleString('zh-CN'),
    },
  )
  return { ok: true }
}

export function cancelSiteDeliverTrip(state: GameState, ctx: SimContext): CommandResult {
  const t = state.transit
  if (!t.active || !t.delivery) return { ok: false, error: '当前没有进行中的建站交付航线。', errorId: 'core.location.022' }
  const departure = state.departure?.kind === 'siteDeliver' ? { ...state.departure } : undefined
  const stayedAtPort = cancelDeparture(state, 'siteDeliver')
  const phase = t.delivery.phase
  const site = ctx.stations.get(t.delivery.siteId)
  const baseFrom = phase === 'to-site' ? (t.fromGalaxy ?? site?.galaxyId ?? HOME_GALAXY_ID) : (t.toGalaxy ?? HOME_GALAXY_ID)
  const base = nearestStationGalaxyId(state, ctx, baseFrom)
  t.active = false
  t.fromGalaxy = null
  t.toGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  t.delivery = null
  state.awayGalaxy = null
  state.dockedSite = null
  if (stayedAtPort && departure) {
    state.dockedSite = departure.fromSite
    unloadCargoOfShipToWarehouse(state, ctx, state.shipId)
    delete state.combatEscort
    return { ok: true }
  }
  let dockedName: string | null = null
  for (const s of ctx.stations.values()) {
    const prog = state.stationSites[s.id]
    if (prog && prog.stage >= s.tiers.length && s.galaxyId === base) {
      state.dockedSite = s.id
      dockedName = s.name
      break
    }
  }
  const moved = unloadCargoOfShipToWarehouse(state, ctx, state.shipId)
  addLog(
    state,
    'warn',
    `交付航线已取消（无惩罚）：已停止交付循环，舰船立即返航，已停靠「${dockedName ?? (ctx.galaxies.get(base)?.name ?? '母港')}」${dockedName ? '（副空间站）' : ''}${moved > 0 ? `；货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : '。'}`,
    moved > 0 ? 'core.location.051' : 'core.location.050',
    moved > 0
      ? {
          p1: dockedName ?? (ctx.galaxies.get(base)?.name ?? '母港'),
          p2: dockedName ? '（副空间站）' : '',
          ...(dockedName ? { p2Id: 'core.location.047' } : {}),
          p3: moved.toLocaleString('zh-CN'),
        }
      : {
          p1: dockedName ?? (ctx.galaxies.get(base)?.name ?? '母港'),
          p2: dockedName ? '（副空间站）' : '',
          ...(dockedName ? { p2Id: 'core.location.047' } : {}),
        },
  )
  return { ok: true }
}

function continueDeliverLoop(state: GameState, ctx: SimContext, siteId: string): void {
  const site = ctx.stations.get(siteId)
  if (!site) return
  const prog = siteProgress(state, siteId)
  if (prog.stage >= site.tiers.length) return
  const remain = tierRemaining(state, site)
  if (remain <= 0) return
  const r = startSiteDeliverTrip(state, ctx, siteId)
  if (r.ok) return
  const remainTxt = remain.toLocaleString('zh-CN')
  const note =
    r.error && r.error.includes('仓库没有可装载的建材')
      ? `「${site.name}」交付循环已结束：仓库建材已运完，工地还差 ${remainTxt} 单位——备料后再一键出发即可续建。`
      : `「${site.name}」交付循环已中断：${r.error ?? '无法续运'}`.slice(0, 200)
  addLog(state, 'warn', note)
  state.deliveryNotice = note
}

function arriveDeliverSite(
  state: GameState,
  ctx: SimContext,
  siteId: string,
  loaded?: Record<string, number>,
): void {
  const site = ctx.stations.get(siteId)
  if (!site) {
    state.awayGalaxy = null
    state.dockedSite = null
    addLog(state, 'warn', '交付航线异常：工地已不存在，舰船已直接返航母港。', 'core.location.034')
    return
  }
  const galaxyName = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
  state.awayGalaxy = site.galaxyId
  state.dockedSite = null
  addLog(
      state,
      'fleet',
      `⚑ 交付航线：舰船已抵达「${galaxyName}」——「${site.name}」工地，本趟装载的建材自动清仓交付中。`,
      'core.location.035',
      { p1: galaxyName, p2: site.name },
    )
  noteStationSiteAt(state, ctx, site.galaxyId)
  const ledger: Record<string, number> = {}
  const cargo = cargoOfShip(state, state.shipId)
  if (loaded && Object.keys(loaded).length > 0) {
    for (const id of Object.keys(loaded)) ledger[id] = loaded[id] ?? 0
  } else {
    for (const row of stationBillView(state, ctx, site)) ledger[row.itemId] = cargo[row.itemId] ?? 0
  }
  let delivered = 0
  let guard = 0
  while (guard++ < 80) {
    const rows = stationBillView(state, ctx, site)
    if (rows.length === 0) break
    let any = false
    for (const row of rows) {
      if (row.remaining <= 0) continue
      const onHand = Math.max(0, Math.min(
        ledger[row.itemId] ?? 0, cargo[row.itemId] ?? 0,
        billRemainingOf(state, site, siteProgress(state, site.id).stage, row.itemId),
      ))
      if (onHand <= 0) continue
      const r = deliverStationResources(state, ctx, site.id, row.itemId, onHand, { cargoOnly: true })
      if (r.ok) {
        ledger[row.itemId] = (ledger[row.itemId] ?? 0) - onHand
        any = true
        delivered += onHand
      }
    }
    if (!any) break
  }
  const progAfter = siteProgress(state, site.id)
  if (progAfter.stage >= site.tiers.length) {
    state.awayGalaxy = null
    state.dockedSite = site.id
    const unloadNote = dockUnloadNote(state, ctx, state.shipId)
    addLog(
      state,
      'fleet',
      `本次交付达成「建成」档：舰船已停靠新落成的「${site.name}」（副空间站）。${unloadNote.text}`,
      'core.location.052',
      {
        p1: site.name,
      p2: unloadNote.text,
      ...(unloadNote.id !== undefined && unloadNote.unit !== undefined
        ? { p2Id: unloadNote.id, p2p1: unloadNote.unit }
        : {}),
      },
    )
    return
  }
  const remain = tierRemaining(state, site)
  if (delivered > 0) {
    addLog(
      state,
      'fleet',
      `本次清仓交付建材 ${delivered.toLocaleString('zh-CN')} 单位，当前档还差 ${remain.toLocaleString('zh-CN')} 单位（仓库有料将自动续趟）。`,
      'core.location.041',
      { p1: delivered.toLocaleString('zh-CN'), p2: remain.toLocaleString('zh-CN') },
    )
  } else {
    addLog(state, 'fleet', `本趟未交付任何建材（工地当前需求与货仓装载不匹配）——自动返航。`, 'core.location.036')
  }
  const baseGal = nearestStationGalaxyId(state, ctx, site.galaxyId)
  const mins = shortestTravelMinutes(ctx, site.galaxyId, baseGal)
  const legMs = Number.isFinite(mins) ? travelLegMs(state, ctx, mins) : 0
  const baseName = ctx.galaxies.get(baseGal)?.name ?? '母港'
  if (legMs <= 0) {
    state.awayGalaxy = null
    state.dockedSite = null
    let dockedName: string | null = null
    for (const s of ctx.stations.values()) {
      const prog = state.stationSites[s.id]
      if (prog && prog.stage >= s.tiers.length && s.galaxyId === baseGal) {
        state.dockedSite = s.id
        dockedName = s.name
        break
      }
    }
    const unloadNote = dockUnloadNote(state, ctx, state.shipId)
    addLog(
      state,
      'fleet',
      `交付任务收尾：舰船已返航停靠「${dockedName ?? baseName}」${dockedName ? '（副空间站）' : ''}。${unloadNote.text}`,
      'core.location.053',
      {
        p1: dockedName ?? baseName,
        p2: dockedName ? '（副空间站）' : '',
        ...(dockedName ? { p2Id: 'core.location.047' } : {}),
      p3: unloadNote.text,
      ...(unloadNote.id !== undefined && unloadNote.unit !== undefined
        ? { p3Id: unloadNote.id, p3p1: unloadNote.unit }
        : {}),
      },
    )
    if (site && progAfter.stage < site.tiers.length) continueDeliverLoop(state, ctx, site.id)
    return
  }
  const t = state.transit
  t.active = true
  t.fromGalaxy = site.galaxyId
  t.toGalaxy = baseGal
  t.finishAtGameMs = state.gameMs + legMs
  t.legMs = legMs
  t.delivery = { siteId: site.id, phase: 'to-station' }
  addLog(
    state,
    'fleet',
    `交付任务收尾：自动返航「${baseName}」（约 ${Math.max(1, Math.round(legMs / 60_000))} 分钟航程）——到站后如仓库还有建材将自动续趟，可随时取消（= 停止整个循环）。`,
    'core.location.054',
    { p1: baseName, p2: Math.max(1, Math.round(legMs / 60_000)) },
  )
}

export function reconcileDockSanity(state: GameState, ctx: SimContext): void {
  const ds = state.dockedSite
  if (ds === null) return
  const site = ctx.stations.get(ds)
  if (site && siteProgress(state, ds).stage >= site.tiers.length) return
  const galaxyId = site?.galaxyId ?? null
  state.dockedSite = null
  state.awayGalaxy = galaxyId ?? HOME_GALAXY_ID
  const galaxyName = galaxyId ? (ctx.galaxies.get(galaxyId)?.name ?? galaxyId) : '母港'
  addLog(
    state,
    'warn',
    site
      ? `「${site.name}」尚未建成：工地不提供停靠——舰船已转为「${galaxyName}」工地现场停留（交付建材可现场提交）。`
      : '停靠的副站已不存在：舰船已返回母港。',
    site ? 'core.location.055' : 'core.location.056',
    site ? { p1: site.name, p2: galaxyName } : undefined,
  )
}

export interface TransitView {
  active: boolean
  fromGalaxy: string | null
  fromName: string
  toGalaxy: string | null
  toName: string
  remainingMs: number
  percent: number
  trip: 'dock' | 'deliver-to-site' | 'deliver-to-station' | null
  siteName: string | null
}

export function transitStatus(state: GameState, ctx: SimContext): TransitView {
  const t = state.transit
  const fromName = t.fromGalaxy ? ctx.galaxies.get(t.fromGalaxy)?.name ?? t.fromGalaxy : ''
  const toName = t.toGalaxy ? ctx.galaxies.get(t.toGalaxy)?.name ?? t.toGalaxy : '空间站'
  const remainingMs = t.active ? Math.max(0, t.finishAtGameMs - state.gameMs) : 0
  const percent = t.legMs > 0 ? Math.min(100, Math.max(0, ((t.legMs - remainingMs) / t.legMs) * 100)) : 0
  const site = t.delivery ? ctx.stations.get(t.delivery.siteId) : undefined
  return {
    active: t.active,
    fromGalaxy: t.fromGalaxy,
    fromName,
    toGalaxy: t.toGalaxy,
    toName,
    remainingMs,
    percent,
    trip: t.delivery
      ? t.delivery.phase === 'to-site'
        ? 'deliver-to-site'
        : 'deliver-to-station'
      : t.active
        ? 'dock'
        : null,
    siteName: site ? site.name : null,
  }
}


export function goStandbyAt(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const target = ctx.galaxies.get(galaxyId)
  if (!target) return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.location.033', errorParams: { p1: galaxyId } }
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  const s = state.standby
  if (s.active) return { ok: false, error: '掩护巡逻进行中：请先取消（顶部活动栏）。', errorId: 'core.location.024' }
  if (isExploredOf(state, galaxyId) === false) return { ok: false, error: `「${target.name}」尚未探明——先对其执行扫描探索。`, errorId: 'core.location.028', errorParams: { p1: target.name } }
  const from = originGalaxyOf(state, ctx)
  if (from === galaxyId && state.awayGalaxy === null) {
    return { ok: false, error: `舰船已停靠「${target.name}」，无需前往。`, errorId: 'core.location.029', errorParams: { p1: target.name } }
  }
  if (state.awayGalaxy === galaxyId && isIdleField(state)) {
    return { ok: false, error: `舰船已在「${target.name}」掩护巡逻。`, errorId: 'core.location.030', errorParams: { p1: target.name } }
  }
  const mins = shortestTravelMinutes(ctx, from, galaxyId)
  if (!Number.isFinite(mins)) return { ok: false, error: `「${target.name}」不在已知航路内。`, errorId: 'core.location.031', errorParams: { p1: target.name } }
  const gateSkip = applyActivityGate(state, 'standby', ctx)
  if (gateSkip) return gateSkip
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  state.awayGalaxy = galaxyId
  noteStationSiteAt(state, ctx, galaxyId)
  addLog(
    state,
    'fleet',
    `⚐ 掩护巡逻：舰船已抵达「${target.name}」并留守该星系（低安星系可能遭遇巡逻/伏击；可随时返航空间站，或从该处继续采矿/出击）。`,
    'core.location.042',
    { p1: target.name },
  )
  return { ok: true }
}

export function advanceStandby(state: GameState, ctx: SimContext): void {
  const s = state.standby
  if (s.active) {
    if (cancelStandby(state, ctx).ok) state.dockedSite = null
    return
  }
  if (!isLegacyPatrolStay(state, ctx)) return
  startTransitHome(state, ctx)
}

function isLegacyPatrolStay(state: GameState, ctx: SimContext): boolean {
  const galaxyId = state.awayGalaxy
  if (
    galaxyId === null ||
    state.transit.active ||
    state.expedition.active ||
    state.mining.active ||
    state.salvaging.active ||
    state.hauling.active ||
    state.sideTasks.deliver !== null ||
    state.encounter.active ||
    state.wormhole.run !== null ||
    state.wormholeScan?.active === true ||
    stationActivityWaitsForReturn(state)
  ) {
    return false
  }

  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  let lastLocationLog: (typeof state.logs)[number] | undefined
  for (let i = state.logs.length - 1; i >= 0; i -= 1) {
    const log = state.logs[i]!
    if (
      LOCATION_LOG_IDS.has(log.textId ?? '') ||
      (log.textId === undefined && log.text.includes('已抵达') && log.text.includes('掩护巡逻'))
    ) {
      lastLocationLog = log
      break
    }
  }
  if (!lastLocationLog) return false
  const patrolArrival = lastLocationLog.textId === 'core.location.042' ||
    lastLocationLog.textId === 'core.location.043' ||
    (lastLocationLog.textId === undefined && lastLocationLog.text.includes('掩护巡逻') && lastLocationLog.text.includes('已抵达'))
  if (!patrolArrival) return false
  const loggedGalaxy = lastLocationLog.textParams?.p1
  return loggedGalaxy === galaxyName || lastLocationLog.text.includes(`「${galaxyName}」`)
}

export function cancelStandby(state: GameState, ctx: SimContext): CommandResult {
  const s = state.standby
  if (!s.active || s.galaxyId === null) return { ok: false, error: '当前没有进行中的掩护巡逻行程。', errorId: 'core.location.032' }
  const name = ctx.galaxies.get(s.galaxyId)?.name ?? s.galaxyId
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  state.awayGalaxy = null
  const moved = unloadCargoOfShipToWarehouse(state, ctx, state.shipId)
  addLog(
    state,
    'warn',
    `掩护巡逻行程已取消：舰船返回母港（未抵达「${name}」）${moved > 0 ? `；货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : '。'}`,
    moved > 0 ? 'core.location.044' : 'core.location.045',
    moved > 0 ? { p1: name, p2: moved.toLocaleString('zh-CN') } : { p1: name },
  )
  return { ok: true }
}

export interface StandbyView {
  active: boolean
  galaxyId: string | null
  targetName: string
  remainingMs: number
  percent: number
}

export function standbyStatus(state: GameState, ctx: SimContext): StandbyView {
  const s = state.standby
  const remainingMs = s.active ? Math.max(0, s.finishAtGameMs - state.gameMs) : 0
  const percent = s.legMs > 0 ? Math.min(100, Math.max(0, ((s.legMs - remainingMs) / s.legMs) * 100)) : 0
  return {
    active: s.active,
    galaxyId: s.galaxyId,
    targetName: s.galaxyId ? ctx.galaxies.get(s.galaxyId)?.name ?? s.galaxyId : '',
    remainingMs,
    percent,
  }
}

function isExploredOf(state: GameState, galaxyId: string): boolean {
  return state.exploredGalaxies.includes(galaxyId)
}
