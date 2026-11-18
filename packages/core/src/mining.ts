import { ceilFinalQuantity } from './quantity'
import { tuningMul } from './tuning'
import { addLog, HOME_GALAXY_ID, miningHalt } from './state'
import { applyActivityGate } from './activityGate'
import { beginDeparture, consumeDeparture, cancelDeparture, departureOrigin, departureArrivalLog, reconcileDeparture } from './departure'
import { bumpFirst } from './firstTasks'
import { pilotUnavailableReason } from './activityGate'
import type { CommandResult } from './engine'
import type { GameState, WorkReturnProgress } from './state'
import type { BeltDef, ItemDef, ShipDef, SimContext } from './types'
import { nextRandom, pickWeighted } from './rng'
import { isMineableItem } from './labels'
import { addItem, cargoUnitM3, freeCargoM3Of, unloadCargoOfShipToWarehouse, unloadWorkFleetToWarehouse } from './inventory'
import { workFleetShipIds, workFleetReturnMs } from './workFleet'
import { DSI_FACTION_ID, standingOf } from './standing'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { actionBlockReason, markExplored } from './explore'
import { miningReturnLegMs, nearestStationGalaxyId, builtSiteAtGalaxy } from './location'
import { fleetDefOf, shipDisplayName } from './instances'
import { familyModules } from './equipment'
import { workReturnLeg } from './trips'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from './jumpFuel'

export interface MiningParams {
  ship: ShipDef
  belt: BeltDef
  ore: ItemDef
  cycleMs: number
  unitsPerCycle: number
}

export function richVeinFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['rich-vein-prospecting'] ?? 0)
  return 1 + 0.2 * lv
}

export function richVeinP(cycleMs: number, state: GameState, ctx: SimContext): number {
  return Math.min(1, (Math.max(0, cycleMs) / 60_000) * ctx.balance.richVeinChance * richVeinFactor(state))
}

export function getMiningParams(
  state: GameState,
  ctx: SimContext,
  opts?: { shipId?: string; beltId?: string },
): MiningParams | null {
  const shipId = opts?.shipId ?? state.shipId
  const ship = fleetDefOf(state, ctx, shipId)
  if (!ship) return null
  const beltId = opts?.beltId ?? state.mining.beltId
  if (!beltId) return null
  const belt = ctx.belts.get(beltId)
  if (!belt) return null
  const ore = ctx.items.get(belt.oreId)
  if (!ore) return null

  const bal = ctx.balance.mining
  const timeLevel = state.skills.trained[bal.timeSkillId] ?? 0
  const yieldLevel = state.skills.trained[bal.yieldSkillId] ?? 0
  const timeRatio = Math.max(0, 1 - bal.timePerLevel * timeLevel)
  const cycleMul = tuningMul(state, 'miningCycleMs')
  const cycleMs = state.debugQuick ? 1000 : Math.max(1, Math.round(ship.cycleSeconds * 1000 * timeRatio * cycleMul))
  const minerDefs = familyModules(state, ctx, shipId, 'miner')
  let minerBonus = 0
  for (const def of minerDefs) minerBonus += def.bonus ?? 0
  let prodMult = 1 + bal.yieldPerLevel * yieldLevel
  const astroLv = Math.min(5, state.skills.trained['astro-geology'] ?? 0)
  if (astroLv > 0) prodMult *= 1 + 0.04 * astroLv
  if ((ore.baseSellPriceIsk ?? 0) <= 55) {
    const blastLv = Math.min(5, state.skills.trained['deep-hole-blasting'] ?? 0)
    if (blastLv > 0) prodMult *= 1 + 0.06 * blastLv
  }
  if (ore.kind === 'gas' || ore.kind === 'ice') {
    const deepLv = Math.min(5, state.skills.trained['deep-space-harvesting'] ?? 0)
    if (deepLv > 0) prodMult *= 1 + 0.05 * deepLv
  }
  if (ship.role === 'industrial') {
    const opsLv = Math.min(5, state.skills.trained['industrial-ops'] ?? 0)
    if (opsLv > 0) prodMult *= 1 + 0.04 * opsLv
  }
  const unitsPerCycle = Math.max(
    1,
    ceilFinalQuantity(
      (ship.oreUnitsPerCycle * prodMult * (1 + minerBonus) * tuningMul(state, 'miningYield')) /
        Math.max(0.01, ore.unitM3 ?? 1),
    ),
  )
  return { ship, belt, ore, cycleMs, unitsPerCycle }
}

export interface BeltYieldRow {
  itemId: string
  perHour: number
}

export function beltYieldRows(state: GameState, ctx: SimContext, belt: BeltDef): BeltYieldRow[] | null {
  const workers = workFleetShipIds(state, !state.mining.active || state.mining.beltId !== belt.id)
    .flatMap(shipId => { const mp = getMiningParams(state, ctx, { shipId, beltId: belt.id }); return mp ? [mp] : [] })
  if (!workers.length) return null
  const total = workers.reduce((sum, mp) => sum + (mp.unitsPerCycle * 3_600_000) / mp.cycleMs, 0)
  const outs = belt.outputs?.length ? belt.outputs : [{ itemId: belt.oreId, weight: 1 }]
  const wsum = outs.reduce((s, r) => s + r.weight, 0)
  if (!(wsum > 0)) return [{ itemId: belt.oreId, perHour: total }]
  return outs.map((r) => ({ itemId: r.itemId, perHour: (total * r.weight) / wsum }))
}

export function beltValuePerHour(
  state: GameState,
  ctx: SimContext,
  belt: BeltDef,
  priceOf: (itemId: string) => number | null,
): number | null {
  const rows = beltYieldRows(state, ctx, belt)
  if (!rows) return null
  let total = 0
  for (const r of rows) {
    const live = priceOf(r.itemId)
    const unit = live !== null && live > 0 ? live : ctx.items.get(r.itemId)?.baseSellPriceIsk ?? 0
    total += r.perHour * unit
  }
  return Math.round(total)
}

export function rollBeltOutput(state: GameState, ctx: SimContext, belt: BeltDef | undefined): ItemDef | null {
  const fallback = belt ? ctx.items.get(belt.oreId) ?? null : null
  if (!belt || !belt.outputs || belt.outputs.length < 2) return fallback
  let total = 0
  for (const o of belt.outputs) total += Math.max(0, o.weight)
  if (total <= 0) return fallback
  const hit = pickWeighted(state.rng, belt.outputs, (o) => o.weight)
  return hit ? ctx.items.get(hit.itemId) ?? fallback : fallback
}

export function beltTravelMinutes(ctx: SimContext, belt: BeltDef | undefined, from?: string | null): number {
  if (!belt?.galaxyId) return 0
  const mins = shortestTravelMinutes(ctx, from && from !== HOME_GALAXY_ID ? from : HOME_GALAXY_ID, belt.galaxyId)
  if (!Number.isFinite(mins)) return 0
  return Math.max(0, mins)
}

export function oneLegMs(
  state: GameState,
  ctx: SimContext,
  beltId?: string | null,
  shipId?: string,
  origin?: string | null,
): number {
  if (state.debugQuick) return 1000
  const belt = beltId ? ctx.belts.get(beltId) : undefined
  const mins = beltTravelMinutes(ctx, belt, origin)
  return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, mins, shipId))
}

export function oneOutboundLegMs(
  state: GameState,
  ctx: SimContext,
  beltId?: string | null,
  shipId?: string,
  origin?: string | null,
): number {
  if (state.debugQuick) return 1000
  return Math.max(1, Math.round(oneLegMs(state, ctx, beltId, shipId, origin) / 2))
}

function miningPreflight(state: GameState, beltId: string, ctx: SimContext): CommandResult {
  const belt = ctx.belts.get(beltId)
  if (!belt) {
    return { ok: false, error: `未知采集点：${beltId}。`, errorId: 'core.mining.001', errorParams: { p1: beltId } }
  }
  const ore = ctx.items.get(belt.oreId)
  if (!isMineableItem(ore)) {
    return {
      ok: false,
      error: `采集点「${belt.name}」没有对应的可采集资源数据。`,
      errorId: 'core.mining.002',
      errorParams: { p1: belt.name },
    }
  }
  const needStanding = belt.standingReq ?? 0
  if (needStanding > 0) {
    const have = standingOf(state, DSI_FACTION_ID)
    if (have < needStanding) {
      return {
        ok: false,
        error: `采集点「${belt.name}」需要「深空工业协会」声望 ${needStanding}（累计 ${have}）——多完成悬赏任务攒声望。`,
        errorId: 'core.mining.003',
        errorParams: { p1: belt.name, p2: needStanding, p3: have },
      }
    }
  }
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  const block = actionBlockReason(state, belt.galaxyId)
  if (block) return { ok: false, error: block }
  if (belt.galaxyId && belt.galaxyId !== HOME_GALAXY_ID) {
    const travel = shortestTravelMinutes(ctx, HOME_GALAXY_ID, belt.galaxyId)
    if (!Number.isFinite(travel)) {
      return {
        ok: false,
        error: `「${belt.name}」所在星系没有从母港可达的航线，无法前往开采。`,
        errorId: 'core.mining.005',
        errorParams: { p1: belt.name },
      }
    }
  }
  return { ok: true }
}

export function startMining(state: GameState, beltId: string, ctx: SimContext): CommandResult {
  reconcileDeparture(state)
  if (state.departure) return { ok: false, errorId: 'core.departure.001' }
  const departureFrom = departureOrigin(state, ctx)
  const pre = miningPreflight(state, beltId, ctx)
  if (!pre.ok) return pre
  const belt = ctx.belts.get(beltId)!
  const oldReturn = state.shipReturns[state.shipId]
  const restartingReturn = !state.mining.active && !state.salvaging.active &&
    (oldReturn?.reason === 'miningStop' || oldReturn?.reason === 'salvageStop')
  if (state.mining.active) {
    const prevBelt = state.mining.beltId ? ctx.belts.get(state.mining.beltId) : undefined
    const prevName = prevBelt?.name ?? '原矿带'
    const info = miningHalt(state)
    addLog(
      state,
      'warn',
      `已切换矿带：停掉「${prevName}」的开采（本趟 ${info?.tripUnits ?? 0} 单位留在船上），改采「${belt.name}」。`,
      'core.mining.037',
      { p1: prevName, p2: belt.name, p3: info?.tripUnits ?? 0 },
    )
  }
  const gateSkip = applyActivityGate(state, 'mining', ctx)
  if (gateSkip) return gateSkip
  if (!departureFrom.docked && state.pendingActivityReturn) {
    delete state.shipReturns[state.shipId]
    state.pendingActivityReturn = null
    state.haltedBySwitch = null
  }
  if (restartingReturn) { state.pendingActivityReturn = null; state.haltedBySwitch = null }
  if (state.haltedBySwitch?.kind === 'mining') {
  state.haltedBySwitch = null
} else {
  delete state.shipReturns[state.shipId]
  state.haltedBySwitch = null
}

  const fromField = state.awayGalaxy !== null ? state.awayGalaxy : null
  state.awayGalaxy = null

  const m = state.mining
  m.active = true
  m.beltId = beltId
  m.phase = 'mining'
  delete m.fuelMul
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.autoCycle = m.autoCycle !== false
  m.stopAfterTrip = m.stopAfterTrip === true
  m.originGalaxy = fromField
  m.rvLeft = 0
  delete m.shipProgress
  beginDeparture(state, ctx, 'mining', belt.galaxyId ?? HOME_GALAXY_ID, departureFrom)

  const params = getMiningParams(state, ctx)
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const cycleNote = params ? `（约 ${Math.round(params.cycleMs / 100) / 10} 秒/循环，每循环 ${params.unitsPerCycle} 单位）` : ''
  const outSec = Math.max(1, Math.round(oneOutboundLegMs(state, ctx, beltId, undefined, fromField) / 1000))
  const retSec = Math.max(1, Math.round(oneLegMs(state, ctx, beltId) / 1000))
  const travelStatic = beltTravelMinutes(ctx, belt, fromField)
  const travelNote = travelStatic > 0 ? '（远带矿带：返航已含往返航程）' : ''
  const travelNoteId = travelStatic > 0 ? 'core.mining.013' : undefined
  const tripNote = m.autoCycle
    ? ' 已启用自动循环：满舱自动返航空间站卸货，卸完自动开始下一趟。'
    : ' 自动循环已关闭：货舱满后将停在矿带。'
  departureArrivalLog(
    state,
    'industry',
    `开始开采：${belt.name}。${shipName} 已抵达矿带，立即开始采掘${cycleNote}（满载返航约 ${retSec + outSec} 秒，去程时间已并入返航${travelNote}）。${tripNote}`,
    'core.mining.016',
    {
      p1: belt.name,
      p2: shipName,
      p3: cycleNote,
      p4: retSec + outSec,
      p5: travelNoteId !== undefined ? travelNote : '',
      p6: tripNote,
    },
  )
  return { ok: true }
}

import { recallExpedition } from './expedition/recall'
export { recallExpedition } from './expedition/recall'

export function startMiningFromExpedition(state: GameState, beltId: string, ctx: SimContext): CommandResult {
  const pre = miningPreflight(state, beltId, ctx)
  if (!pre.ok) return pre
  const exp = state.expedition
  if (!exp.active) return startMining(state, beltId, ctx)
  if (exp.phase === 'battle') {
    return {
      ok: false,
      error: '交火中无法抽身采矿——请先让战斗分出胜负，或撤退脱离。',
      errorId: 'core.mining.017',
    }
  }
  if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
    state.autoLoopAnomalyId = null
    addLog(state, 'combat', '重复清剿已停止（转开采）。', 'core.mining.018')
  }
  const recalled = recallExpedition(state, ctx)
  if (!recalled.ok) return recalled
  return startMining(state, beltId, ctx)
}

function armMiningReturnLeg(state: GameState, ctx: SimContext, beltId: string, progress: WorkReturnProgress): number | null {
  const ship = state.fleet[state.shipId]
  if (!ship) return null
  const baseMs = progress.phase === 'returning' ? activeMiningReturnMs(state, ctx, beltId, progress)
    : workFleetReturnMs(state, ctx, id => oneLegMs(state, ctx, beltId, id) + oneOutboundLegMs(state, ctx, beltId, id))
  const leg = workReturnLeg(state, 'mine', baseMs, progress)
  state.shipReturns[state.shipId] = { beltId: null, ...leg, reason: 'miningStop' }
  return Math.max(0, Math.round((leg.legMs - leg.phaseAccMs) / 1000))
}

function activeMiningReturnMs(state: GameState, ctx: SimContext, beltId: string, progress: WorkReturnProgress): number {
  const galaxyId = ctx.belts.get(beltId)?.galaxyId
  const station = galaxyId ? nearestStationGalaxyId(state, ctx, galaxyId) : HOME_GALAXY_ID
  return workFleetReturnMs(state, ctx, id => oneLegMs(state, ctx, beltId, id, station)
    + oneOutboundLegMs(state, ctx, beltId, id, progress.originGalaxy ?? station))
}

export function stopMining(state: GameState, ctx: SimContext): boolean {
  const stayedAtPort = cancelDeparture(state, 'mining')
  const info = miningHalt(state)
  if (info === null) return false
  const belt = info.beltId ? ctx.belts.get(info.beltId) : undefined
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const oreName = ore ? ore.name : ''
  const phaseNote =
    info.phase === 'returning' ? '（返航途中，货物留在船上）' : info.phase === 'outbound' ? '（出航途中）' : ''
  const tripUnits = info.tripUnits
  const beltName = belt ? belt.name : '矿带'
  addLog(
    state,
    'industry',
    `已停止开采（${beltName}）。本趟共采得 ${tripUnits} 单位${oreName}${phaseNote}。`,
    'core.mining.021',
    { p1: beltName, p2: tripUnits, p3: oreName, p4: phaseNote },
  )
  if (info.beltId !== null && !stayedAtPort) {
    const remainSec = armMiningReturnLeg(state, ctx, info.beltId, info)
    if (remainSec !== null) {
      const shipName = shipDisplayName(state, ctx, state.shipId)
      const haveCargo = tripUnits > 0
      addLog(
        state,
        'industry',
        `开采已停止：${shipName} 从「${beltName}」返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSec} 秒后到港。`,
        'core.mining.042',
        {
          p1: shipName,
          p2: beltName,
          p3: haveCargo ? '（卸空货仓）' : '',
          ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
          p4: remainSec,
        },
      )
    }
  }
  return true
}

export function advanceMining(state: GameState, deltaMs: number, ctx: SimContext): void {
  const m = state.mining
  if (!m.active || deltaMs <= 0) return
  if (!state.fleet[state.shipId]) {
    m.active = false
    m.beltId = null
    m.phase = 'mining'
    m.rvLeft = 0
    delete m.shipProgress
    addLog(state, 'warn', '舰队里找不到当前舰船，采矿作业已停止。', 'core.mining.022')
    return
  }

  let remaining = deltaMs
  while (m.active && remaining > 0) {
    remaining = consumeDeparture(state, 'mining', remaining)
    if (remaining <= 0) break
    if (m.phase === 'returning' || m.phase === 'outbound') {
      const beltDef = m.beltId ? ctx.belts.get(m.beltId) : undefined
      const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
      const outFull = oneOutboundLegMs(state, ctx, m.beltId, undefined, m.originGalaxy ?? stGal)
      const leg =
        m.phase === 'outbound'
          ? outFull
          : workFleetReturnMs(state, ctx, id => oneLegMs(state, ctx, m.beltId, id, stGal)
              + oneOutboundLegMs(state, ctx, m.beltId, id, m.originGalaxy ?? stGal), m.fuelMul)
      const need = leg - m.phaseAccMs
      if (remaining < need) {
        m.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      m.phaseAccMs = 0
      if (m.phase === 'returning') {
        const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
        const ore = belt ? ctx.items.get(belt.oreId) : undefined
        const oreName = ore ? ore.name : '货物'
        const trip = m.tripUnits
        const moved = unloadWorkFleetToWarehouse(state, ctx)
        addLog(
          state,
          'industry',
          `自动返港：已把货仓全部卸入物品仓库（共 ${moved.toLocaleString('zh-CN')} 单位，本趟采得 ${oreName}×${trip}）。`,
          'core.mining.024',
          { p1: moved.toLocaleString('zh-CN'), p2: oreName, p3: trip },
        )
        if (m.stopAfterTrip || !m.autoCycle) {
          m.active = false
          m.beltId = null
          m.phase = 'mining'
          m.cycleAccMs = 0
          m.tripUnits = 0
          m.rvLeft = 0
          delete m.shipProgress
          addLog(state, 'industry', '自动循环已结束（按设定返港后停止）。', 'core.mining.025')
          break
        }
        m.phase = 'mining'
        m.cycleAccMs = 0
        for (const progress of Object.values(m.shipProgress ?? {})) progress.cycleAccMs = 0
        m.tripUnits = 0
        m.originGalaxy = null
        delete m.fuelMul
        beginDeparture(state, ctx, 'mining', belt?.galaxyId ?? HOME_GALAXY_ID,
          { galaxy: stGal, site: stGal === HOME_GALAXY_ID ? null : builtSiteAtGalaxy(state, ctx, stGal), docked: true })
      } else {
        const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
        if (belt?.galaxyId) markExplored(state, belt.galaxyId)
        m.phase = 'mining'
        m.cycleAccMs = 0
        m.originGalaxy = null
      }
      continue
    }

    const workers = workFleetShipIds(state).flatMap(shipId => {
      const params = getMiningParams(state, ctx, { shipId })
      if (!params) return []
      const progress = shipId === state.shipId ? m
        : (m.shipProgress ??= {})[shipId] ??= { cycleAccMs: 0, rvLeft: 0 }
      return [{ shipId, params, progress }]
    })
    if (!workers.length) {
      m.active = false
      m.beltId = null
      m.phase = 'mining'
      m.cycleAccMs = 0
      m.rvLeft = 0
      delete m.shipProgress
      addLog(state, 'warn', '矿带已不存在，采矿作业已停止。', 'core.mining.026')
      return
    }
    const need = Math.min(...workers.map(({ params, progress }) => Math.max(0, params.cycleMs - progress.cycleAccMs)))
    const take = Math.min(remaining, need)
    for (const { progress } of workers) progress.cycleAccMs += take
    remaining -= take
    if (take < need) break
    for (const { shipId, params, progress } of workers) {
      if (progress.cycleAccMs < params.cycleMs) continue
      progress.cycleAccMs = 0

      const beltDef = m.beltId ? ctx.belts.get(m.beltId) : undefined
      const oreNow = rollBeltOutput(state, ctx, beltDef)
      if (!oreNow) {
        m.active = false
        m.beltId = null
        m.phase = 'mining'
        m.cycleAccMs = 0
        m.rvLeft = 0
        delete m.shipProgress
        addLog(state, 'warn', '矿带产物记录缺失，采矿作业已停止。', 'core.mining.027')
        return
      }

      const oreM3PerCycle = params.unitsPerCycle * cargoUnitM3(state, oreNow)
      const freeM3 = freeCargoM3Of(state, ctx, shipId)
      if (oreM3PerCycle > freeM3) {
        if (m.autoCycle) {
          m.phase = 'returning'
          m.phaseAccMs = 0
          const stGalNow = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
          const baseMs = workFleetReturnMs(state, ctx, id => oneLegMs(state, ctx, m.beltId, id, stGalNow)
            + oneOutboundLegMs(state, ctx, m.beltId, id, m.originGalaxy ?? stGalNow))
          m.fuelMul = beginJumpFuelLeg(state, 'mine', baseMs)
          const mergedMs = jumpFuelLegMsOf(baseMs, m.fuelMul)
          addLog(
            state,
            'industry',
            `货舱装不下下一循环（余 ${Math.round(freeM3)} m³ ／ 每循环 ${Math.round(oreM3PerCycle)} m³）：自动返航空间站卸货（本趟 ${m.tripUnits} 单位${oreNow.name}，返航约 ${Math.max(1, Math.round(mergedMs / 1000))} 秒，去程已并入返航）。`,
            'core.mining.028',
            {
              p1: Math.round(freeM3),
              p2: Math.round(oreM3PerCycle),
              p3: m.tripUnits,
              p4: oreNow.name,
              p5: Math.max(1, Math.round(mergedMs / 1000)),
            },
          )
          break
        }
        m.active = false
        m.beltId = null
        m.phase = 'mining'
        m.cycleAccMs = 0
        m.rvLeft = 0
        delete m.shipProgress
        addLog(
          state,
          'warn',
          `货舱装不下下一循环（余 ${Math.round(freeM3)} m³ ／ 每循环 ${Math.round(oreM3PerCycle)} m³）：开采自动停止（本趟 ${m.tripUnits} 单位${oreNow.name}，未开启自动循环）。`,
          'core.mining.029',
          {
            p1: Math.round(freeM3),
            p2: Math.round(oreM3PerCycle),
            p3: m.tripUnits,
            p4: oreNow.name,
          },
        )
        return
      }

      let units = params.unitsPerCycle
      const rvLeft = progress.rvLeft ?? 0
      const rich = rvLeft === 0 && nextRandom(state.rng) < richVeinP(params.cycleMs, state, ctx)
      if (rvLeft > 0 || rich) {
        units *= 3
        progress.rvLeft = rich ? 1 : rvLeft - 1
      }
      units = Math.min(units, Math.floor(freeM3 / cargoUnitM3(state, oreNow)))
      if (rich) {
        addLog(
          state,
          'industry',
          `富矿脉！连续 2 个循环产量 ×3，本循环获得 ${units} 单位${oreNow.name}。`,
          'core.mining.030',
          { p1: units, p2: oreNow.name },
        )
      }
      addItem(state, oreNow.id, units, shipId)
      bumpFirst(state, 'mineUnits', units)
      m.tripUnits += units
    }
  }
}

export interface MiningView {
  active: boolean
  beltId: string | null
  beltName: string
  oreName: string
  shipName: string
  phase: 'mining' | 'returning' | 'outbound'
  phaseLabel: string
  cycleMs: number
  cycleAccMs: number
  unitsPerCycle: number
  percent: number
  remainingMs: number | null
  tripUnits: number
  autoCycle: boolean
  stopAfterTrip: boolean
  richVeinChance: number
  legMs: number
  outboundLegMs: number
}

export function miningStatus(state: GameState, ctx: SimContext): MiningView {
  const m = state.mining
  const params = getMiningParams(state, ctx)
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const stGal = belt?.galaxyId ? nearestStationGalaxyId(state, ctx, belt.galaxyId) : HOME_GALAXY_ID
  const leg = oneLegMs(state, ctx, m.beltId, undefined, stGal)
  const outLeg = oneOutboundLegMs(state, ctx, m.beltId, undefined, m.originGalaxy ?? stGal)
  const phaseLeg =
    m.phase === 'returning'
      ? workFleetReturnMs(state, ctx, id => oneLegMs(state, ctx, m.beltId, id, stGal)
          + oneOutboundLegMs(state, ctx, m.beltId, id, m.originGalaxy ?? stGal), m.fuelMul)
      : m.phase === 'outbound'
        ? outLeg
        : leg

  const phaseLabel =
    m.phase === 'returning' ? '返航卸货中' : m.phase === 'outbound' ? '出航中' : '采掘中'

  if (!m.active) {
    return {
      active: false,
      beltId: m.beltId,
      beltName: belt?.name ?? '',
      oreName: ore?.name ?? '',
      shipName: shipName,
      phase: 'mining',
      phaseLabel: '',
      cycleMs: params?.cycleMs ?? 1,
      cycleAccMs: m.cycleAccMs,
      unitsPerCycle: params?.unitsPerCycle ?? 0,
      percent: 0,
      remainingMs: null,
      tripUnits: m.tripUnits,
      autoCycle: m.autoCycle,
      stopAfterTrip: m.stopAfterTrip,
      richVeinChance: ctx.balance.richVeinChance * richVeinFactor(state),
      legMs: leg,
      outboundLegMs: outLeg,
    }
  }

  let percent = 0
  let remainingMs: number | null = null
  if (m.phase === 'mining' && params) {
    percent = Math.min(100, (m.cycleAccMs / params.cycleMs) * 100)
    remainingMs = Math.max(0, params.cycleMs - m.cycleAccMs)
  } else if (m.phase !== 'mining') {
    percent = Math.min(100, (m.phaseAccMs / phaseLeg) * 100)
    remainingMs = Math.max(0, phaseLeg - m.phaseAccMs)
  }
  return {
    active: true,
    beltId: m.beltId,
    beltName: belt?.name ?? '',
    oreName: ore?.name ?? '',
    shipName: shipName,
    phase: m.phase,
    phaseLabel,
    cycleMs: params?.cycleMs ?? 1,
    cycleAccMs: m.cycleAccMs,
    unitsPerCycle: params?.unitsPerCycle ?? 0,
    percent,
    remainingMs,
    tripUnits: m.tripUnits,
    autoCycle: m.autoCycle,
    stopAfterTrip: m.stopAfterTrip,
    richVeinChance: ctx.balance.richVeinChance * richVeinFactor(state),
    legMs: leg,
    outboundLegMs: outLeg,
  }
}

export function setMiningAutoCycle(state: GameState, autoCycle: boolean): void {
  state.mining.autoCycle = autoCycle
  if (!autoCycle) state.mining.stopAfterTrip = false
}

export function setMiningStopAfterTrip(state: GameState, stopAfterTrip: boolean): void {
  state.mining.stopAfterTrip = stopAfterTrip
  if (stopAfterTrip) state.mining.autoCycle = true
}


export function shipInReturn(state: GameState, shipId: string): boolean {
  return shipId in state.shipReturns
}

export function advanceShipReturns(state: GameState, deltaMs: number, ctx: SimContext): void {
  if (deltaMs <= 0) return
  for (const shipId of Object.keys(state.shipReturns)) {
    const r = state.shipReturns[shipId]
    if (!r) continue
    r.phaseAccMs = Math.min(r.legMs, r.phaseAccMs + deltaMs)
    if (r.phaseAccMs >= r.legMs) {
      const workReturn = r.reason === undefined || r.reason === 'miningStop' || r.reason === 'salvageStop' || r.reason === 'salvage'
      let moved = workReturn ? unloadWorkFleetToWarehouse(state, ctx, shipId) : 0
      delete state.shipReturns[shipId]
      if (!workReturn) moved = unloadCargoOfShipToWarehouse(state, ctx, shipId)
      const name = shipDisplayName(state, ctx, shipId)
      if (r.reason === 'expedition') {
        addLog(
          state,
          'industry',
          moved > 0
            ? `${name} 已随远征善后返航到港：货仓已卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。`
            : `${name} 已随远征善后返航到港（货仓为空）。`,
          moved > 0 ? 'core.mining.031' : 'core.mining.032',
          moved > 0 ? { p1: name, p2: moved.toLocaleString('zh-CN') } : { p1: name },
        )
        continue
      }
      if (r.reason === 'salvage') {
        addLog(
          state,
          'industry',
          moved > 0
            ? `${name} 已随打捞善后返航到港：残骸已卸入物品仓库（${moved.toLocaleString('zh-CN')} m³ 当量）。`
            : `${name} 已随打捞善后返航到港（货仓为空）。`,
          moved > 0 ? 'core.mining.033' : 'core.mining.034',
          moved > 0 ? { p1: name, p2: moved.toLocaleString('zh-CN') } : { p1: name },
        )
        continue
      }
      if (r.reason === 'salvageStop') {
        addLog(
          state,
          'industry',
          moved > 0
            ? `${name} 已随打捞停止返航到港：残骸已卸入物品仓库（${moved.toLocaleString('zh-CN')} m³ 当量）。`
            : `${name} 已随打捞停止返航到港（货仓为空）。`,
          moved > 0 ? 'core.mining.039' : 'core.mining.040',
          moved > 0 ? { p1: name, p2: moved.toLocaleString('zh-CN') } : { p1: name },
        )
        continue
      }
      if (r.reason === 'miningStop') {
        addLog(
          state,
          'industry',
          moved > 0
            ? `${name} 已随开采停止返航到港：原矿已卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。`
            : `${name} 已随开采停止返航到港（货仓为空）。`,
          moved > 0 ? 'core.mining.038' : 'core.mining.041',
          moved > 0 ? { p1: name, p2: moved.toLocaleString('zh-CN') } : { p1: name },
        )
        continue
      }
      addLog(
        state,
        'industry',
        moved > 0
          ? `${name} 已返港并卸货（换船善后）：${moved.toLocaleString('zh-CN')} 单位已入物品仓库。`
          : `${name} 已随换船善后返港（货仓为空）。`,
        moved > 0 ? 'core.mining.035' : 'core.mining.036',
        moved > 0 ? { p1: name, p2: moved.toLocaleString('zh-CN') } : { p1: name },
      )
    }
  }
}

export function retireMiningShip(
  state: GameState,
  ctx: SimContext,
  opts?: { beltId?: string; preserveExisting?: boolean; fallbackLegMs?: number; progress?: WorkReturnProgress },
): boolean {
  const m = state.mining
  const auto = opts?.beltId !== undefined
  const snapshot = opts?.progress ?? (auto ? state.pendingActivityReturn?.progress : undefined)
  const progress = snapshot ?? m
  if (opts?.preserveExisting === true && state.shipId in state.shipReturns) {
    const ret = state.shipReturns[state.shipId]!
    const baseMs = progress.phase === 'returning' ? activeMiningReturnMs(state, ctx, opts.beltId!, progress)
      : workFleetReturnMs(state, ctx, id => miningReturnLegMs(state, ctx, opts.beltId!, id))
    const leg = workReturnLeg(state, 'mine', baseMs, progress)
    ret.legMs = leg.legMs
    ret.phaseAccMs = snapshot ? leg.phaseAccMs : Math.min(leg.legMs, Math.max(ret.phaseAccMs, leg.phaseAccMs))
    const beltFix = ctx.belts.get(opts.beltId!)
    const beltNameFix = beltFix?.name ?? '矿井'
    const shipNameFix = shipDisplayName(state, ctx, state.shipId)
    const haveCargo = Object.keys(state.fleet[state.shipId]?.cargo ?? {}).some((k) => (state.fleet[state.shipId]!.cargo[k] ?? 0) > 0)
    const remainSecFix = Math.max(0, Math.round((ret.legMs - ret.phaseAccMs) / 1000))
    addLog(
      state,
      'industry',
      `开采已停止：${shipNameFix} 从「${beltNameFix}」返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSecFix} 秒后到港。`,
      'core.mining.042',
      {
        p1: shipNameFix,
        p2: beltNameFix,
        p3: haveCargo ? '（卸空货仓）' : '' ,
        ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
        p4: remainSecFix,
      },
    )
    m.active = false
    m.beltId = null
    delete m.fuelMul
    return true
  }
  if (!auto && (!m.active || !m.beltId)) return false
  const beltId = opts?.beltId ?? m.beltId!
  const belt = ctx.belts.get(beltId)
  const beltName = belt?.name ?? '矿带'
  const baseMs = progress.phase === 'returning' ? activeMiningReturnMs(state, ctx, beltId, progress)
    : opts?.fallbackLegMs !== undefined ? Math.max(1, Math.round(opts.fallbackLegMs)) : workFleetReturnMs(state, ctx, id => miningReturnLegMs(state, ctx, beltId, id))
  const { legMs, phaseAccMs } = workReturnLeg(state, 'mine', baseMs, progress)
  const oldShip = state.fleet[state.shipId]
  const haveCargo = oldShip ? Object.keys(oldShip.cargo).some((k) => (oldShip.cargo[k] ?? 0) > 0) : false
  state.shipReturns[state.shipId] = {
    beltId,
    legMs: Math.max(1, legMs),
    phaseAccMs: Math.min(legMs, Math.max(0, phaseAccMs)),
    reason: 'miningStop',
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const remainSec = Math.max(0, Math.round((legMs - phaseAccMs) / 1000))
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0
  delete m.shipProgress
  delete m.fuelMul
  const logText = auto
    ? `开采已停止：${shipName} 从「${beltName}」返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSec} 秒后到港。`
    : `采矿已随换船结束：${shipName} 从「${beltName}」自动返航空间站${haveCargo ? '（卸空货仓）' : ''}——约 ${remainSec} 秒后到港。`
  addLog(
    state,
    'industry',
    logText,
    auto ? 'core.mining.042' : 'core.shipyard.019',
    {
      p1: shipName,
      p2: beltName,
      p3: haveCargo ? '（卸空货仓）' : '',
      ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
      p4: remainSec,
    },
  )
  return true
}
