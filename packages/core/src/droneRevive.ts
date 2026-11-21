import type { BattleState, GameState } from './state'
import type { SimContext } from './types'
import { fleetDefOf } from './instances'
import { moduleAllowedOnShip } from './shipFitting'
import { wormholeSupplyForBattle } from './wormholeSupplies'
import { equipmentCycleMsOf } from './equipment'
import { requeueDroneLaunch } from './droneLaunch'
import { plugModulesOf } from './plugs'

export function droneReviveCyclesOf(state: GameState, ctx: SimContext, shipId: string): number[] {
  const high = state.fleet[shipId]?.fitted?.high ?? []
  const out: number[] = []
  for (const modId of high) {
    if (!modId) continue
    const mod = ctx.modules.get(modId)
    if (!mod || !moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), mod)) continue
    const ms = mod.droneReviveCycleMs
    if (typeof ms === 'number' && ms > 0) out.push(droneReviveCycleMsOf(state, ctx, shipId, ms))
  }
  return out.sort((a, b) => a - b)
}

export function droneReviveCycleMsOf(state: GameState, ctx: SimContext, shipId: string, baseMs: number): number {
  const printing = plugModulesOf(state, ctx, shipId).find(p => p.dronePrinting)?.dronePrinting
  return Math.ceil(equipmentCycleMsOf(state, ctx, shipId, baseMs) * (printing?.deckCycleMul ?? 1))
}

export function initDroneReviveStock(
  state: GameState,
  ctx: SimContext,
  battle: BattleState,
  shipIds: readonly string[],
): void {
  const withDeck = shipIds.filter((id) => droneReviveCyclesOf(state, ctx, id).length > 0 &&
    !plugModulesOf(state, ctx, id).some(p => p.dronePrinting))
  if (withDeck.length === 0) return
  const kinds = new Set<string>()
  for (const p of Object.values(battle.dronePools ?? {})) {
    if (p.artId) kinds.add(p.artId)
  }
  const stock: Record<string, number> = {}
  const supply = wormholeSupplyForBattle(state, battle)
  for (const id of kinds) {
    let n = supply ? supply.items[id] ?? 0 : state.warehouse.items[id] ?? 0
    if (!supply) for (const shipId of withDeck) n += state.fleet[shipId]?.cargo[id] ?? 0
    if (n > 0) stock[id] = n
  }
  battle.droneReviveStock = stock
}

export function initDroneRevive(
  state: GameState,
  ctx: SimContext,
  battle: BattleState,
  shipId: string,
  tag: string,
): void {
  const c = droneReviveCyclesOf(state, ctx, shipId)
  if (c.length === 0) return
  const book = { ...(battle.droneRevive ?? {}) }
  book[tag] = { q: [], t: c.map(() => undefined), c, v: {}, shipId,
    ...(plugModulesOf(state, ctx, shipId).some(p => p.dronePrinting) ? { printing: true } : {}) }
  battle.droneRevive = book
}

function budgetOf(battle: BattleState, artId: string | undefined): number {
  if (artId === undefined || artId === '') return 0
  return battle.droneReviveStock?.[artId] ?? 0
}

function reviveOne(state: GameState, battle: BattleState, e: NonNullable<BattleState['droneRevive']>[string]): boolean {
  void state
  const pools = battle.dronePools
  if (!pools) return false
  let pick = -1
  for (let i = 0; i < e.q.length; i++) {
    const p = pools[e.q[i]!]
    if (!p) {
      e.q.splice(i, 1)
      i -= 1
      continue
    }
    if (e.printing || budgetOf(battle, p.artId) > 0) {
      pick = i
      break
    }
  }
  if (pick < 0) return false
  const key = e.q[pick]!
  const pool = pools[key]
  e.q.splice(pick, 1)
  if (!pool || pool.artId === undefined) return false
  if (!e.printing) {
    const stock = { ...(battle.droneReviveStock ?? {}) }
    const left = budgetOf(battle, pool.artId) - 1
    if (left > 0) stock[pool.artId] = left
    else delete stock[pool.artId]
    battle.droneReviveStock = stock
  }
  pool.alive = true
  pool.inHangar = false
  pool.readyAtMs = undefined
  pool.s = pool.maxS ?? pool.s
  pool.a = pool.maxA ?? pool.a
  pool.h = pool.maxH ?? pool.h
  requeueDroneLaunch(battle, key)
  e.v[pool.artId] = (e.v[pool.artId] ?? 0) + 1
  return true
}

function revivableCount(battle: BattleState, e: NonNullable<BattleState['droneRevive']>[string]): number {
  const pools = battle.dronePools
  if (!pools) return 0
  let n = 0
  for (const key of e.q) {
    const p = pools[key]
    if (p && (e.printing || budgetOf(battle, p.artId) > 0)) n += 1
  }
  return n
}

function startCycles(battle: BattleState, e: NonNullable<BattleState['droneRevive']>[string], nowMs: number): void {
  let running = e.t.filter((x) => x !== undefined).length
  let need = revivableCount(battle, e)
  for (let k = 0; k < e.t.length && running < need; k++) {
    if (e.t[k] !== undefined) continue
    e.t[k] = nowMs + e.c[k]!
    running += 1
    need = revivableCount(battle, e)
  }
}

export function droneReviveNoteLoss(state: GameState, battle: BattleState, poolKey: string, nowMs: number): void {
  void state
  const book = battle.droneRevive
  if (!book) return
  const tag = poolKey.slice(0, poolKey.indexOf(':'))
  const e = book[tag]
  if (!e) return
  e.q.push(poolKey)
  startCycles(battle, e, nowMs)
}

export function resolveDroneRevive(state: GameState, ctx: SimContext, battle: BattleState, nowMs: number): void {
  const book = battle.droneRevive
  if (!book) return
  for (const [tag, e] of Object.entries(book)) {
    const owner = battle.units[tag]
    if (e.printing && owner && owner.hp.s + owner.hp.a + owner.hp.h <= 0) continue
    const cycles = droneReviveCyclesOf(state, ctx, e.shipId)
    if (cycles.length === e.c.length) e.c = cycles
    for (let k = 0; k < e.t.length; k++) {
      let at = e.t[k]
      if (at === undefined) continue
      let guard = 0
      while (nowMs >= at && guard < 512) {
        guard += 1
        if (!reviveOne(state, battle, e)) break
        at = at + e.c[k]!
      }
      e.t[k] = revivableCount(battle, e) > 0 ? at : undefined
    }
    startCycles(battle, e, nowMs)
  }
}

export function droneReviveStockSnapshotOf(battle: BattleState | null | undefined): Record<string, number> {
  return battle?.droneReviveStock ?? {}
}

export function droneRevivedOf(battle: BattleState | null | undefined, tag: string): Record<string, number> {
  return battle?.droneRevive?.[tag]?.v ?? {}
}

export function droneRevivedCount(battle: BattleState | null | undefined, tag: string): number {
  return Object.values(droneRevivedOf(battle, tag)).reduce((s, n) => s + n, 0)
}
