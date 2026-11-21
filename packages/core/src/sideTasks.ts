import { ceilFinalQuantity } from './quantity'
import { rewardMulOf } from './tuning'
import { addLog, HOME_GALAXY_ID } from './state'
import { applyActivityGate } from './activityGate'
import type { CourierDeliveryState, GameState, SideTask, SideTasksState } from './state'
import type { CommandResult } from './engine'
import { beginDeparture } from './departure'
import type { BeltDef, MarketGoodDef, SimContext, StationSiteDef } from './types'
import { nextInt, nextRandom } from './rng'
import { marketQuote, levelOf } from './market'
import { isGalaxyStationBuilt } from './station'
import { isSiteBuilt } from './state'
import { isExplored } from './explore'
import { countWare, removeWare, cargoCapacityM3Of, unloadCargoOfShipToWarehouse } from './inventory'
import { shortestTravelMinutes, travelLegMs, travelMinutesEff, warpSpeedAus } from './travel'
import { isAtHome, originGalaxyOf } from './location'
import { factionBaseRewardIsk, isLairCandidate, lairNameOf, lairTaskRewardIsk } from './lairs'
import type { LairTier } from './lairs'
import { rollBountyBoard, bountyTaskStandingGain } from './expedition/bountyBoard'
import { noteStandingEarned, DSI_FACTION_ID } from './standing'
export { BOUNTY_ZONE_PLAN, BOUNTY_TASKS_PER_ROUND } from './expedition/bountyBoard'
import type { AnomalyDef } from './types'
import { securityZoneOf } from './securityZone'

export type SideTaskLevel = 1 | 2 | 3 | 4 | 5
export const SIDE_TASK_LEVELS: readonly SideTaskLevel[] = [1, 2, 3, 4, 5]

export const SIDE_TASK_LEVEL_SCALE: Record<SideTaskLevel, number> = { 1: 1, 2: 1.7, 3: 3, 4: 5, 5: 8 }

export const RESOURCE_TASK_LEVEL_MARGIN: Record<SideTaskLevel, number> = { 1: 1.1, 2: 1.15, 3: 1.2, 4: 1.25, 5: 1.3 }

export const COURIER_TASK_LEVEL_FREIGHT_ISK: Record<SideTaskLevel, number> = {
  1: 180_000,
  2: 459_000,
  3: 1_170_000,
  4: 2_850_000,
  5: 6_480_000,
}

export const COURIER_TASK_LEVEL_VOLUME: Record<SideTaskLevel, number> = {
  1: 1_000,
  2: 2_100,
  3: 4_500,
  4: 9_500,
  5: 20_000,
}

export const COURIER_TIMED_VOLUME_RATIO = 0.5

export const COURIER_TIMED_WARP_REQ: readonly number[] = [6.2, 7.44, 8.37, 10.91]

export const COURIER_TIMED_CHANCE = 0.5

export const COURIER_TIMED_PREMIUM = 1.5

export const SIDE_TASK_BASE_COUNT = 4

export const RESOURCE_NEED_HOUR_FRACTION = 1

export const SIDE_TASK_COUNT_PER_STATION = 2

export const COURIER_ACCEPT_MAX = 4

const COURIER_TRIP_MINUTES_REF = 10
const COURIER_TRIP_FACTOR_MIN = 0.5

const TIMED_COURIER_GRACE = 1.05

export const SPAWN_SHOCK_STEP = 0.05

export const SPAWN_SUPPLY_CUT = 0.25

function boardPeriodMs(ctx: SimContext): number {
  return ctx.balance.market.orderLifeMs.common
}

export const COURIER_BOARD_PERIOD_MS = 120 * 60_000

export function courierDueAtWindow(windowMs: number): boolean {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return false
  return windowMs % COURIER_BOARD_PERIOD_MS === 0
}

export function courierDeadlineMs(windowMs: number): number {
  const P = COURIER_BOARD_PERIOD_MS
  if (!Number.isFinite(windowMs) || windowMs <= 0) return P
  return courierDueAtWindow(windowMs) ? windowMs + P : Math.ceil(windowMs / P) * P
}

function beltProduces(belt: BeltDef, itemId: string): boolean {
  if (belt.oreId === itemId) return true
  const outputs = belt.outputs
  if (outputs) {
    for (const o of outputs) if (o.itemId === itemId) return true
  }
  return false
}

function anyProducingBeltExplored(state: GameState, ctx: SimContext, itemId: string): boolean {
  for (const belt of ctx.belts.values()) {
    if (!beltProduces(belt, itemId)) continue
    if (isExplored(state, belt.galaxyId ?? HOME_GALAXY_ID)) return true
  }
  return false
}

export function sideTaskCandidateGoods(state: GameState, ctx: SimContext): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'common' || def.kind !== 'item' || (def.poolTarget ?? 0) <= 0) continue
    const itemId = def.refId
    if (ctx.items.get(itemId)?.kind === 'wreck') continue
    if ((state.warehouse.items[itemId] ?? 0) > 0) {
      out.push(def)
      continue
    }
    const item = ctx.items.get(itemId)
    if (!item) {
      out.push(def)
      continue
    }
    if (item.kind === 'ore' || item.kind === 'gas' || item.kind === 'ice') {
      if (anyProducingBeltExplored(state, ctx, itemId)) out.push(def)
      continue
    }
    if (item.kind === 'mineral') {
      let sourceFound = false
      for (const src of ctx.items.values()) {
        if (src.kind !== 'ore' && src.kind !== 'gas' && src.kind !== 'ice') continue
        const refine = src.refine
        if (!refine) continue
        let produces = false
        for (const row of refine) {
          if (row.mineralId === itemId) {
            produces = true
            break
          }
        }
        if (produces) {
          sourceFound = true
          if (anyProducingBeltExplored(state, ctx, src.id)) {
            out.push(def)
            break
          }
        }
      }
      if (!sourceFound) out.push(def)
      continue
    }
    out.push(def)
  }
  return out
}

export function courierTaskUnlocked(state: GameState, ctx: SimContext): boolean {
  for (const site of ctx.stations.values()) {
    if (isSiteBuilt(state, site)) return true
  }
  return false
}

function builtStationTargets(state: GameState, ctx: SimContext): Array<{ site: StationSiteDef }> {
  const out: Array<{ site: StationSiteDef }> = []
  for (const site of ctx.stations.values()) {
    if (!isSiteBuilt(state, site)) continue
    if (!ctx.galaxies.has(site.galaxyId)) continue
    out.push({ site })
  }
  return out
}

function resolveCourierTarget(state: GameState, ctx: SimContext, task: SideTask): StationSiteDef | null {
  if (task.stationId) {
    const site = ctx.stations.get(task.stationId)
    if (site && isSiteBuilt(state, site) && ctx.galaxies.has(site.galaxyId)) return site
  }
  let best: StationSiteDef | null = null
  let bestMin = Number.POSITIVE_INFINITY
  const from = HOME_GALAXY_ID
  for (const { site } of builtStationTargets(state, ctx)) {
    const m = shortestTravelMinutes(ctx, from, site.galaxyId)
    if (Number.isFinite(m) && m < bestMin) {
      bestMin = m
      best = site
    }
  }
  return best
}

function drawDistinctGoods(state: GameState, pool: MarketGoodDef[], count: number): MarketGoodDef[] {
  const n = Math.min(count, pool.length)
  const idx = pool.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = nextInt(state.rng, i + 1)
    const tmp = idx[i]!
    idx[i] = idx[j]!
    idx[j] = tmp
  }
  return idx.slice(0, n).map((i) => pool[i]!)
}

export function hourlySupplyOf(_state: GameState, ctx: SimContext, itemId: string): number {
  const ORE_PER_HOUR = 18_000
  const item = ctx.items.get(itemId)
  if (!item) return 1_000
  if (item.kind === 'ore' || item.kind === 'gas' || item.kind === 'ice') return ORE_PER_HOUR
  if (item.kind === 'mineral') {
    let best = 0
    for (const belt of ctx.belts.values()) {
      if ((belt.standingReq ?? 0) > 0) continue
      const def = ctx.items.get(belt.oreId)
      for (const row of def?.refine ?? []) {
        if (row.mineralId === itemId && row.perOre > best) best = row.perOre
      }
    }
    return best > 0 ? ORE_PER_HOUR * best : 1_000
  }
  for (const g of ctx.marketGoods.values()) {
    if (g.refId === itemId && (g.poolTarget ?? 0) > 0) return (g.poolTarget ?? 0) * 0.01
  }
  return 1_000
}

function rollResourceNeed(state: GameState, ctx: SimContext, def: MarketGoodDef, level: SideTaskLevel): number {
  const hourly = hourlySupplyOf(state, ctx, def.refId)
  const raw = hourly * RESOURCE_NEED_HOUR_FRACTION * SIDE_TASK_LEVEL_SCALE[level]
  return Math.max(10, Math.round(raw / 10) * 10)
}

export function courierVolumeFor(level: SideTaskLevel, timed = false): number {
  const base = COURIER_TASK_LEVEL_VOLUME[level]
  return Math.round(timed ? base * COURIER_TIMED_VOLUME_RATIO : base)
}

export function courierWarpReqOf(level: SideTaskLevel): number {
  const idx = Math.max(0, Math.min(COURIER_TIMED_WARP_REQ.length - 1, level - 2))
  return COURIER_TIMED_WARP_REQ[idx]!
}

function resourceRewardIskFor(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  need: number,
  level: SideTaskLevel,
): number {
  const quote = marketQuote(state, ctx, goodKey)
  const base = quote.buy !== undefined && quote.buy > 0 ? quote.buy : Math.max(1, levelOf(state, ctx, goodKey))
  let reward = Math.max(100, Math.floor((need * base * RESOURCE_TASK_LEVEL_MARGIN[level]) / 100) * 100)
  if (quote.sell !== undefined && reward >= need * quote.sell) {
    reward = Math.min(reward, Math.floor((need * quote.sell - 1) / 100) * 100)
  }
  return Math.max(0, ceilFinalQuantity(reward * rewardMulOf(state)))
}

function courierRewardIskFor(
  state: GameState,
  level: SideTaskLevel,
  nominalMinutes: number,
  timed: boolean,
): number {
  const trip = Math.max(
    COURIER_TRIP_FACTOR_MIN,
    (Number.isFinite(nominalMinutes) ? nominalMinutes : 10) / COURIER_TRIP_MINUTES_REF,
  )
  const premium = timed ? COURIER_TIMED_PREMIUM : 1
  const raw = COURIER_TASK_LEVEL_FREIGHT_ISK[level] * trip * premium
  return Math.max(0, ceilFinalQuantity(Math.max(100, Math.floor(raw / 100) * 100) * rewardMulOf(state)))
}

function applySpawnMarketImpact(state: GameState, def: MarketGoodDef): void {
  const pool = state.market.pools[def.key]
  if (!pool) return
  const sellList = state.market.npcSell[def.key]
  if (sellList) {
    let total = 0
    for (const o of sellList) total += o.qty
    if (total > 0) {
      const removeQty = Math.round(total * SPAWN_SUPPLY_CUT)
      let rem = removeQty
      for (let i = sellList.length - 1; i >= 0 && rem > 0; i--) {
        const o = sellList[i]!
        const take = Math.min(o.qty, rem)
        o.qty -= take
        rem -= take
        if (o.qty <= 0) sellList.splice(i, 1)
      }
      pool.q = Math.max(0, pool.q - removeQty)
    }
  }
  pool.shock = Math.min(0.4, (pool.shock ?? 0) + SPAWN_SHOCK_STEP)
}

export function refundSpawnShock(state: GameState, goodKey: string): void {
  const pool = state.market.pools[goodKey]
  if (!pool) return
  pool.shock = Math.max(0, (pool.shock ?? 0) - SPAWN_SHOCK_STEP)
}

function refreshBoard(state: GameState, ctx: SimContext, boundaryMs: number, courierDue: boolean, courierBoundaryMs: number): void {
  const board = state.sideTasks
  board.window = boundaryMs
  board.resource = []
  const pool = sideTaskCandidateGoods(state, ctx)

  const counts = taskCountsFor(state, ctx)
  const levels = rollLevels(state, Math.max(counts.resource, counts.courier))
  const affected = new Set<string>()

  const resGoods = drawDistinctGoods(state, pool, Math.min(counts.resource, pool.length))
  for (let i = 0; i < resGoods.length; i += 1) {
    const def = resGoods[i]!
    const level = levels[i % levels.length]!
    const need = rollResourceNeed(state, ctx, def, level)
    const rewardIsk = resourceRewardIskFor(state, ctx, def.key, need, level)
    board.seq += 1
    affected.add(def.key)
    board.resource.push({ id: board.seq, kind: 'resource', goodKey: def.key, refId: def.refId, need, rewardIsk, level })
  }

  if (courierDue) refreshCourierBoard(state, ctx, courierBoundaryMs, levels)

  for (const key of affected) {
    const def = ctx.marketGoods.get(key)
    if (def) applySpawnMarketImpact(state, def)
  }
}

function refreshCourierBoard(state: GameState, ctx: SimContext, boundaryMs: number, levels?: SideTaskLevel[]): void {
  const board = state.sideTasks
  board.courier = []
  board.courierWindow = boundaryMs
  const courierTargets = builtStationTargets(state, ctx)
  if (courierTargets.length > 0) {
    const count = taskCountsFor(state, ctx).courier
    const choices = levels ?? rollLevels(state, count)
    for (let i = 0; i < count; i += 1) {
      const level = choices[i % choices.length]!
      const picked = courierTargets[nextInt(state.rng, courierTargets.length)]!
      const timed = nextRandom(state.rng) < COURIER_TIMED_CHANCE
      const volumeM3 = courierVolumeFor(level, timed)
      const warpReqAus = timed ? courierWarpReqOf(level) : null
      const nominal = shortestTravelMinutes(ctx, HOME_GALAXY_ID, picked.site.galaxyId)
      const rewardIsk = courierRewardIskFor(state, level, nominal, timed)
      const timeLimitMs =
        warpReqAus === null
          ? undefined
          : Math.round(
              Math.max(1, nominal) * (ctx.balance.travel.warpRefAus / warpReqAus) * 60_000 * TIMED_COURIER_GRACE,
            )
      board.seq += 1
      board.courier.push({
        id: board.seq,
        kind: 'courier',
        goodKey: '',
        refId: '',
        need: 0,
        rewardIsk,
        level,
        volumeM3,
        stationId: picked.site.id,
        galaxyId: picked.site.galaxyId,
        ...(warpReqAus === null ? {} : { timed: true, warpReqAus, timeLimitMs }),
      })
    }
  }
}

export function builtStationCount(state: GameState, ctx: SimContext): number {
  let n = 0
  for (const site of ctx.stations.values()) if (isSiteBuilt(state, site)) n += 1
  return n
}

export function taskCountsFor(state: GameState, ctx: SimContext): { resource: number; courier: number } {
  const n = SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION * builtStationCount(state, ctx)
  return { resource: n, courier: n }
}

function rollLevels(state: GameState, count: number): SideTaskLevel[] {
  const out: SideTaskLevel[] = []
  for (const lv of SIDE_TASK_LEVELS) {
    if (out.length >= count) break
    if (lv <= 4) out.push(lv)
  }
  const weights: Array<[SideTaskLevel, number]> = [
    [1, 10],
    [2, 15],
    [3, 20],
    [4, 25],
    [5, 30],
  ]
  const total = weights.reduce((a, [, w]) => a + w, 0)
  while (out.length < count) {
    let r = nextRandom(state.rng) * total
    let picked: SideTaskLevel = 5
    for (const [lv, w] of weights) {
      r -= w
      if (r < 0) {
        picked = lv
        break
      }
    }
    out.push(picked)
  }
  return out
}

function spawnBountyTasks(state: GameState, ctx: SimContext): void {
  const board = state.sideTasks
  for (const { card: pick, tier } of rollBountyBoard(state, ctx, factionGalaxyId(state))) {
    board.seq += 1
    board.bounty.push({
      id: board.seq,
      kind: 'bounty',
      goodKey: '',
      refId: '',
      need: 0,
      rewardIsk: Math.max(0, ceilFinalQuantity(lairTaskRewardIsk(pick, tier) * rewardMulOf(state))),
      anomalyId: pick.id,
      galaxyId: pick.galaxyId,
      lairTier: tier,
      lairName: lairNameOf(pick, tier),
    })
  }
}

function advanceCourierDeliveries(state: GameState, ctx: SimContext): void {
  const d = state.sideTasks.deliver
  if (!d) return
  if (state.gameMs < d.arriveAtGameMs) return
  settleCourierDelivery(state, ctx, d)
}

export function advanceSideTasks(state: GameState, ctx: SimContext, nowWallMs?: number): void {
  advanceCourierDeliveries(state, ctx)
  advanceBountyBoard(state, ctx, nowWallMs)
  advanceFactionActivity(state, ctx, nowWallMs)
  const board = state.sideTasks
  const period = boardPeriodMs(ctx)
  const nowBoundary = state.market.lastTickGameMs
  const resourceDue = nowBoundary >= board.window + period
  const targetBoundary = resourceDue
    ? board.window + Math.floor((nowBoundary - board.window) / period) * period
    : Math.floor(nowBoundary / period) * period
  const courierBoundary = Math.floor(nowBoundary / period) * period
  const courierDue = (resourceDue || board.window > 0) && courierBoundary > 0 &&
    (board.courierWindow === undefined || nowBoundary >= courierDeadlineMs(board.courierWindow) ||
      (resourceDue && board.courier.length === 0))
  if (resourceDue) refreshBoard(state, ctx, targetBoundary, courierDue, courierBoundary)
  else if (courierDue) refreshCourierBoard(state, ctx, courierBoundary)
}


export const BOUNTY_BOARD_PERIOD_MS = 24 * 3_600_000

export function bountyDayStartWallMs(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function factionNoonWallMs(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  d.setHours(12, 0, 0, 0)
  if (d.getTime() > nowWallMs) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function factionSwitchRemainingMs(nowWallMs: number): number {
  if (!Number.isFinite(nowWallMs) || nowWallMs <= 0) return 0
  const next = factionNoonWallMs(nowWallMs) + BOUNTY_BOARD_PERIOD_MS
  return Math.max(0, next - nowWallMs)
}

export function bountyBoardRemainingMs(nowWallMs: number): number {
  if (!Number.isFinite(nowWallMs) || nowWallMs <= 0) return 0
  const next = bountyDayStartWallMs(nowWallMs) + BOUNTY_BOARD_PERIOD_MS
  return Math.max(0, next - nowWallMs)
}

function advanceBountyBoard(state: GameState, ctx: SimContext, nowWallMs?: number): void {
  const board = state.sideTasks
  const now = nowWallMs ?? state.savedAtWallMs
  if (!Number.isFinite(now) || now <= 0) return
  const dayStart = bountyDayStartWallMs(now)
  const last = board.bountyWindow ?? 0
  if (dayStart <= last) return
  board.bounty = []
  board.bountyWindow = dayStart
  if ((board.factionWindow ?? 0) < factionNoonWallMs(now)) {
    spawnFactionActivity(state, ctx)
    board.factionWindow = factionNoonWallMs(now)
  }
  spawnBountyTasks(state, ctx)
}

function advanceFactionActivity(state: GameState, ctx: SimContext, nowWallMs?: number): void {
  const board = state.sideTasks
  const now = nowWallMs ?? state.savedAtWallMs
  if (!Number.isFinite(now) || now <= 0) return
  const noon = factionNoonWallMs(now)
  if (noon <= (board.factionWindow ?? 0)) return
  board.factionWindow = noon
  spawnFactionActivity(state, ctx)
}


export function factionSuppressedByInvasion(state: GameState): boolean {
  const ev = state.weekendEvent
  return ev !== undefined && ev.endedAtWallMs === undefined
}

function occupiedByInvasion(state: GameState, galaxyId: string): boolean {
  const ev = state.weekendEvent
  if (ev === undefined || ev.endedAtWallMs !== undefined) return false
  return galaxyId === ev.coreId || ev.peripheryIds.includes(galaxyId)
}

export function factionPoolOf(state: GameState, ctx: SimContext): AnomalyDef[] {
  const byGalaxy = new Map<string, AnomalyDef[]>()
  for (const a of ctx.anomalies.values()) {
    if (!isLairCandidate(a)) continue
    if (!(a.rewardIsk > 0)) continue
    if (!state.exploredGalaxies.includes(a.galaxyId)) continue
    if (securityZoneOf(ctx, a.galaxyId) === '高安') continue
    if (isGalaxyStationBuilt(state, ctx, a.galaxyId)) continue
    if (occupiedByInvasion(state, a.galaxyId)) continue
    const arr = byGalaxy.get(a.galaxyId) ?? []
    arr.push(a)
    byGalaxy.set(a.galaxyId, arr)
  }
  const pool: AnomalyDef[] = []
  for (const arr of byGalaxy.values()) {
    pool.push(arr.length === 1 ? arr[0]! : arr[nextInt(state.rng, arr.length)]!)
  }
  return pool
}

function spawnFactionActivity(state: GameState, ctx: SimContext): void {
  const board = state.sideTasks
  const taken = new Set(board.bounty.map((t) => t.galaxyId).filter((g): g is string => typeof g === 'string' && g !== ''))
  const pool = factionPoolOf(state, ctx).filter((a) => !taken.has(a.galaxyId))
  board.faction = null
  if (pool.length === 0) return
  const pick = pool[nextInt(state.rng, pool.length)]!
  board.seq += 1
  board.faction = {
    id: board.seq,
    kind: 'faction',
    goodKey: '',
    refId: '',
    need: 0,
    rewardIsk: Math.max(0, ceilFinalQuantity(factionBaseRewardIsk(pick) * rewardMulOf(state))),
    anomalyId: pick.id,
    galaxyId: pick.galaxyId,
    factionAnomalyName: pick.name,
  }
}

export function factionGalaxyId(state: GameState): string | null {
  if (factionSuppressedByInvasion(state)) return null
  const f = state.sideTasks.faction
  return f && f.galaxyId ? f.galaxyId : null
}

export function isFactionBounty(state: GameState, anomaly: AnomalyDef): boolean {
  const gid = factionGalaxyId(state)
  return gid !== null && anomaly.galaxyId === gid && anomaly.hidden !== true
}

export interface SideTaskDeliveryView {
  taskId: number
  refId: string
  need: number
  volumeM3: number
  level: 1 | 2 | 3 | 4 | 5
  timed: boolean
  stationId: string
  galaxyId: string
  stationName: string
  galaxyName: string
  remainingMs: number
  deadlineRemainingMs: number | null
}

export interface SideTaskBoardView {
  resource: readonly SideTask[]
  courier: readonly SideTask[]
  accepted: readonly SideTask[]
  bounty: readonly SideTask[]
  faction: SideTask | null
  courierUnlocked: boolean
  deliver: SideTaskDeliveryView | null
  opened: boolean
  remainingMs: number
  courierRemainingMs: number
  bountyOpened: boolean
  bountyRemainingMs: number
  factionRemainingMs: number
  bountyFresh: boolean
  bountyNewCount: number
}

export function sideTaskBoard(state: GameState, ctx: SimContext, nowWallMs?: number): SideTaskBoardView {
  const board = state.sideTasks
  const period = boardPeriodMs(ctx)
  const opened = board.window > 0
  let remainingMs: number
  if (opened) {
    remainingMs = Math.max(0, board.window + period - state.gameMs)
  } else {
    const nextPoint = (Math.floor(state.gameMs / period) + 1) * period
    remainingMs = Math.max(0, nextPoint - state.gameMs)
  }
  const bountyWindow = board.bountyWindow ?? 0
  const now = nowWallMs ?? state.savedAtWallMs
  const bountyOpened = bountyWindow > 0
  const bountyFresh = bountyOpened && bountyWindow > (board.bountySeenWindow ?? 0)
  const d = board.deliver
  return {
    resource: board.resource,
    courier: board.courier,
    accepted: board.accepted ?? [],
    bounty: board.bounty,
    faction: factionSuppressedByInvasion(state) ? null : (board.faction ?? null),
    courierUnlocked: courierTaskUnlocked(state, ctx),
    deliver: d
      ? {
          taskId: d.taskId,
          refId: d.refId,
          need: d.need,
          volumeM3: d.volumeM3 ?? 0,
          level: d.level ?? 1,
          timed: d.timed === true,
          stationId: d.stationId,
          galaxyId: d.galaxyId,
          stationName: ctx.stations.get(d.stationId)?.name ?? d.stationId,
          galaxyName: ctx.galaxies.get(d.galaxyId)?.name ?? d.galaxyId,
          remainingMs: Math.max(0, d.arriveAtGameMs - state.gameMs),
          deadlineRemainingMs:
            d.deadlineAtGameMs === undefined ? null : d.deadlineAtGameMs - state.gameMs,
        }
      : null,
    opened,
    remainingMs,
    courierRemainingMs: Math.max(0, courierDeadlineMs(board.courierWindow ?? board.window) - state.gameMs),
    bountyOpened,
    bountyRemainingMs: bountyOpened ? bountyBoardRemainingMs(now) : 0,
    factionRemainingMs: factionSwitchRemainingMs(now),
    bountyFresh,
    bountyNewCount: bountyFresh ? board.bounty.length : 0,
  }
}

export function sideTasksMarkBountySeen(state: GameState): boolean {
  const board = state.sideTasks
  const day = board.bountyWindow ?? 0
  if (day <= 0) return false
  if ((board.bountySeenWindow ?? 0) >= day) return false
  board.bountySeenWindow = day
  return true
}

export function settleBountyTaskVictory(
  state: GameState,
  ctx: SimContext,
  anomalyId: string,
  rareGain: number,
  completedTier?: LairTier,
): void {
  const board = state.sideTasks
  const idx = (board.bounty ?? []).findIndex(t => t.anomalyId === anomalyId &&
    (completedTier === undefined || (t.lairTier ?? 1) === completedTier))
  if (idx < 0) return
  const task = board.bounty[idx]!
  board.bounty.splice(idx, 1)
  state.wallet.isk += task.rewardIsk
  const standingGain = bountyTaskStandingGain(task.lairTier ?? 1)
  if (standingGain > 0) noteStandingEarned(state, DSI_FACTION_ID, standingGain)
  const galaxyId = task.galaxyId ?? ctx.anomalies.get(anomalyId)?.galaxyId ?? ''
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  addLog(
    state,
    'trade',
    `赏金任务完成：${task.lairName ?? anomalyId} 已肃清（${galaxyName}），酬金 ${task.rewardIsk.toLocaleString('zh-CN')} 信用点已入账；` +
      `战场留下稀有残骸 ×${rareGain}——可前往该星系打捞（回站用回收炉解体可得额外战利品）。`,
  )
}

export function courierDelivering(state: GameState): boolean {
  return state.sideTasks.deliver !== null
}

export function completeSideTask(
  state: GameState,
  ctx: SimContext,
  kind: SideTask['kind'],
  id: number,
): CommandResult {
  if (kind === 'courier') {
    return {
      ok: false,
      error: '快递任务需先「出发投送」——货物由出发时从仓库锁定扣出，按真实航程到站后自动结算。',
      errorId: 'core.sideTasks.001',
    }
  }
  const board = state.sideTasks
  const list = board.resource
  const idx = list.findIndex((t) => t.id === id)
  if (idx < 0) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。', errorId: 'core.sideTasks.002' }
  }
  const task = list[idx]!
  if (state.gameMs >= board.window + boardPeriodMs(ctx)) {
    return { ok: false, error: '该任务已到期——新一批任务即将刷新。', errorId: 'core.sideTasks.003' }
  }
  const name = ctx.items.get(task.refId)?.name ?? task.refId
  const have = countWare(state, task.refId)
  if (have < task.need) {
    return {
      ok: false,
      error: `物品仓库中的 ${name} 不足：还差 ${(task.need - have).toLocaleString('zh-CN')} 单位（任务需 ${task.need.toLocaleString('zh-CN')}，现有 ${have.toLocaleString('zh-CN')}）。`,
      errorId: 'core.sideTasks.005',
      errorParams: {
        p1: name,
        p2: (task.need - have).toLocaleString('zh-CN'),
        p3: task.need.toLocaleString('zh-CN'),
        p4: have.toLocaleString('zh-CN'),
      },
    }
  }
  if (!removeWare(state, task.refId, task.need)) {
    return { ok: false, error: `${name} 出库失败（库存不足）。`, errorId: 'core.sideTasks.006', errorParams: { p1: name } }
  }
  list.splice(idx, 1)
  state.wallet.isk += task.rewardIsk
  refundSpawnShock(state, task.goodKey)
  addLog(
    state,
    'trade',
    `资源任务完成（L${task.level ?? 1}）：协会收购 ${name}×${task.need.toLocaleString('zh-CN')}（自仓库交付），` +
      `奖励 ${task.rewardIsk.toLocaleString('zh-CN')} 信用点已入账。`,
  )
  return { ok: true }
}

function settleCourierDelivery(state: GameState, ctx: SimContext, d: CourierDeliveryState): void {
  const board = state.sideTasks
  state.awayGalaxy = null
  const site = ctx.stations.get(d.stationId)
  if (site && isSiteBuilt(state, site) && ctx.galaxies.has(d.galaxyId)) {
    state.dockedSite = site.id
  } else {
    state.dockedSite = null
  }
  const idx = board.courier.findIndex((t) => t.id === d.taskId)
  if (idx >= 0) board.courier.splice(idx, 1)
  const aIdx = (board.accepted ?? []).findIndex((t) => t.id === d.taskId)
  if (aIdx >= 0) board.accepted!.splice(aIdx, 1)
  const siteName = ctx.stations.get(d.stationId)?.name ?? d.stationId
  const galaxyName = ctx.galaxies.get(d.galaxyId)?.name ?? d.galaxyId
  const vol = d.volumeM3 ?? 0
  const timedOut = d.timed === true && d.deadlineAtGameMs !== undefined && state.gameMs > d.deadlineAtGameMs
  if (timedOut) {
    board.deliver = null
    addLog(
      state,
      'warn',
      `限时快递超时：${vol.toLocaleString('zh-CN')} m³ 已送达「${siteName}」（${galaxyName}），` +
        `但未在时限内抵达——本单无报酬（L${d.level ?? 1} 限时快递作废）。`,
    )
    return
  }
  state.wallet.isk += d.rewardIsk
  board.deliver = null
  addLog(
    state,
    'trade',
    `快递投送完成（L${d.level ?? 1}${d.timed === true ? ' · 限时' : ''}）：${vol.toLocaleString('zh-CN')} m³ 已送达` +
      `「${siteName}」（${galaxyName}），运费 ${d.rewardIsk.toLocaleString('zh-CN')} 信用点已入账。`,
  )
}

export function courierOccupiedM3(state: GameState): number {
  return state.sideTasks.deliver?.volumeM3 ?? 0
}

export function acceptCourierTask(state: GameState, id: number): CommandResult {
  const board = state.sideTasks
  const idx = board.courier.findIndex((t) => t.id === id)
  if (idx < 0) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。', errorId: 'core.sideTasks.002' }
  }
  if (state.gameMs >= courierDeadlineMs(board.courierWindow ?? board.window)) {
    return { ok: false, error: '该任务已到期——新一批任务即将刷新。', errorId: 'core.sideTasks.003' }
  }
  const accepted = (board.accepted ??= [])
  if (accepted.length >= COURIER_ACCEPT_MAX) {
    return {
      ok: false,
      error: `已接单 ${COURIER_ACCEPT_MAX} 单（上限）：先出发完成一单，或放弃一单再来接。`,
      errorId: 'core.sideTasks.007',
      errorParams: { p1: COURIER_ACCEPT_MAX },
    }
  }
  const task = board.courier[idx]!
  board.courier.splice(idx, 1)
  accepted.push(task)
  addLog(
    state,
    'info',
    `已接单（L${task.level ?? 1} 快递 · ${(task.volumeM3 ?? 0).toLocaleString('zh-CN')} m³）：` +
      `此单不再随任务板刷新消失，随时可出发投送。`,
  )
  return { ok: true }
}

export function abandonAcceptedCourierTask(state: GameState, id: number): CommandResult {
  const accepted = state.sideTasks.accepted ?? []
  const idx = accepted.findIndex((t) => t.id === id)
  if (idx < 0) return { ok: false, error: '该单不在"已接单"列表里。', errorId: 'core.sideTasks.008' }
  accepted.splice(idx, 1)
  return { ok: true }
}

function findCourierTask(state: GameState, id: number): { task: SideTask; accepted: boolean } | null {
  const board = state.sideTasks
  const onBoard = board.courier.find((t) => t.id === id)
  if (onBoard) return { task: onBoard, accepted: false }
  const acc = (board.accepted ?? []).find((t) => t.id === id)
  return acc ? { task: acc, accepted: true } : null
}

export function startCourierDelivery(state: GameState, ctx: SimContext, id: number): CommandResult {
  const board = state.sideTasks
  if (board.deliver !== null) {
    return {
      ok: false,
      error: '快递投送途中：同一时间只能投送一笔——请先等当前投送到站结算，再出发下一单。',
      errorId: 'core.sideTasks.009',
    }
  }
  const found = findCourierTask(state, id)
  if (!found) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。', errorId: 'core.sideTasks.002' }
  }
  const task = found.task
  if (!found.accepted && state.gameMs >= courierDeadlineMs(board.courierWindow ?? board.window)) {
    return {
      ok: false,
      error: '该任务已到期——新一批任务即将刷新（可先「接单」保住它）。',
      errorId: 'core.sideTasks.004',
    }
  }
  const targetSite = resolveCourierTarget(state, ctx, task)
  if (!targetSite) {
    return {
      ok: false,
      error: '目标副站不可用（未建成或星系未知）——暂时无法投送该单。',
      errorId: 'core.sideTasks.015',
    }
  }
  const vol = task.volumeM3 ?? 0
  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  if (vol > cap) {
    return {
      ok: false,
      error: `当前舰船货舱不足：本单需 ${vol.toLocaleString('zh-CN')} m³，本舰货舱 ${cap.toLocaleString('zh-CN')} m³——换一艘更大的船再来。`,
      errorId: 'core.sideTasks.016',
      errorParams: { p1: vol.toLocaleString('zh-CN'), p2: cap.toLocaleString('zh-CN') },
    }
  }
  if (task.timed === true && task.warpReqAus !== undefined) {
    const warp = warpSpeedAus(state, ctx, state.shipId)
    if (warp + 1e-9 < task.warpReqAus) {
      return {
        ok: false,
        error: `限时快递要求跃迁速度 ≥ ${task.warpReqAus} AU/s（当前舰船 ${warp.toFixed(2)} AU/s）——换船或装跃迁计算机。`,
        errorId: 'core.sideTasks.017',
        errorParams: { p1: task.warpReqAus, p2: warp.toFixed(2) },
      }
    }
  }
  const from = HOME_GALAXY_ID
  const travelMin = shortestTravelMinutes(ctx, from, targetSite.galaxyId)
  if (!Number.isFinite(travelMin)) {
    const targetName = ctx.galaxies.get(targetSite.galaxyId)?.name ?? targetSite.galaxyId
    return {
      ok: false,
      error: `「${targetName}」不在当前可达航路内，无法出发投送。`,
      errorId: 'core.sideTasks.018',
      errorParams: { p1: targetName },
    }
  }
  const gateSkip = applyActivityGate(state, 'deliver', ctx)
  if (gateSkip) return gateSkip
  const unloaded = unloadCargoOfShipToWarehouse(state, ctx, state.shipId)
  const returnedHome = !isAtHome(state)
  if (returnedHome) {
    const fromName = ctx.galaxies.get(originGalaxyOf(state, ctx))?.name ?? '外边'
    state.awayGalaxy = null
    state.dockedSite = null
    state.transit.active = false
    state.transit.fromGalaxy = null
    state.transit.toGalaxy = null
    state.transit.finishAtGameMs = 0
    state.transit.legMs = 0
    state.transit.delivery = null
    addLog(
      state,
      'info',
      `快递出发：舰船先自动返航母港（自「${fromName}」），再按母港航线投送。`,
      'core.sideTasks.020',
      { p1: fromName },
    )
  }
  const departAt = state.gameMs + beginDeparture(state, ctx, 'deliver', targetSite.galaxyId,
    { galaxy: HOME_GALAXY_ID, site: null, docked: true })
  const arriveAt = departAt + travelLegMs(state, ctx, travelMin)
  const deadlineAt = task.timed === true && task.timeLimitMs !== undefined ? departAt + task.timeLimitMs : undefined
  const d: CourierDeliveryState = {
    taskId: task.id,
    goodKey: '',
    refId: '',
    need: 0,
    stationId: targetSite.id,
    galaxyId: targetSite.galaxyId,
    departAtGameMs: departAt,
    arriveAtGameMs: arriveAt,
    flightDurationMs: Math.max(0, arriveAt - departAt),
    rewardIsk: task.rewardIsk,
    volumeM3: vol,
    level: task.level ?? 1,
    ...(deadlineAt === undefined ? {} : { timed: true, deadlineAtGameMs: deadlineAt }),
  }
  const siteName = ctx.stations.get(targetSite.id)?.name ?? targetSite.id
  const galaxyName = ctx.galaxies.get(targetSite.galaxyId)?.name ?? targetSite.galaxyId
  if (arriveAt <= state.gameMs) {
    board.deliver = d
    settleCourierDelivery(state, ctx, d)
    return { ok: true }
  }
  board.deliver = d
  const limitNote =
    deadlineAt === undefined
      ? ''
      : `（限时快递：需在 ${Math.max(1, Math.round((deadlineAt - departAt) / 60_000))} 分钟内抵达，超时无报酬）`
  addLog(
    state,
    'info',
    `快递出发（L${d.level ?? 1}）：虚拟货物 ${vol.toLocaleString('zh-CN')} m³ 已装舱` +
      `${unloaded > 0 ? `（原有货物 ${unloaded} 单位已卸入仓库）` : ''}，驶往「${siteName}」（${galaxyName}），` +
      `预计航行约 ${Math.max(1, travelMinutesEff(state, ctx, travelMin))} 分钟${limitNote}。`,
  )
  return { ok: true }
}

export function sideTasksStateOf(state: GameState): SideTasksState {
  return state.sideTasks
}
