import type { BattleState, GameState } from './state'
import type { SimContext } from './types'
import { WORMHOLE_SLOT_M3 } from './wormholeHold'

export interface WormholeSupplyLedger {
  items: Record<string, number>
  carried: Record<string, number>
  consumed: Record<string, number>
  deployed: Record<string, number>
  recovered: Record<string, number>
  leftBehind: Record<string, number>
  found: Record<string, number>
}

export function wormholeSupplyForBattle(state: GameState, battle: BattleState | null | undefined): WormholeSupplyLedger | undefined {
  const run = state.wormhole.run
  if (!battle?.wormhole || !run || (run.supplyVersion !== 1 && run.expeditionRules === undefined)) return undefined
  return run.supplies ?? (run.supplies = { items: {}, carried: {}, consumed: {}, deployed: {}, recovered: {}, leftBehind: {}, found: {} })
}

export function takeWormholeSupply(ledger: WormholeSupplyLedger, id: string, count: number): number {
  const need = Number.isSafeInteger(count) && count > 0 ? count : 0
  const got = Math.min(ledger.items[id] ?? 0, need)
  if (got > 0) {
    const left = (ledger.items[id] ?? 0) - got
    if (left > 0) ledger.items[id] = left
    else delete ledger.items[id]
    ledger.consumed[id] = (ledger.consumed[id] ?? 0) + got
  }
  return got
}

export function restoreWormholeSupply(ledger: WormholeSupplyLedger, id: string, count: number): number {
  if (!Number.isSafeInteger(count) || count <= 0) return 0
  const got = Math.min(ledger.consumed[id] ?? 0, Math.max(0, Math.floor(count)))
  if (got > 0) {
    ledger.items[id] = (ledger.items[id] ?? 0) + got
    const left = (ledger.consumed[id] ?? 0) - got
    if (left > 0) ledger.consumed[id] = left
    else delete ledger.consumed[id]
  }
  return got
}

export function deployWormholeSupply(ledger: WormholeSupplyLedger, id: string, count: number): number {
  const got = takeWormholeSupply(ledger, id, count)
  if (got > 0) {
    const used = (ledger.consumed[id] ?? 0) - got
    if (used > 0) ledger.consumed[id] = used
    else delete ledger.consumed[id]
    ledger.deployed[id] = (ledger.deployed[id] ?? 0) + got
  }
  return got
}

export function returnWormholeDroneSupply(ledger: WormholeSupplyLedger, id: string, count: number): void {
  if (!Number.isSafeInteger(count) || count <= 0) return
  ledger.items[id] = (ledger.items[id] ?? 0) + count
  ledger.recovered[id] = (ledger.recovered[id] ?? 0) + count
}

export function settleWormholeDroneRevives(state: GameState, battle: BattleState): void {
  const supply = wormholeSupplyForBattle(state, battle)
  const ammo = battle.expeditionAmmo
  if (!supply || !ammo || ammo.revivesSettled) return
  for (const book of Object.values(battle.droneRevive ?? {})) {
    if (book.printing) continue
    for (const [id, n] of Object.entries(book.v)) deployWormholeSupply(supply, id, n)
  }
  ammo.revivesSettled = true
}

export function wormholeSupplyCells(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (run?.supplyVersion !== 1 || !run.supplies) return 0
  const items = { ...run.supplies.items }
  for (const [id, n] of Object.entries(run.battle?.expeditionAmmo?.stock ?? {})) {
    items[id] = (items[id] ?? 0) + n
  }
  return Object.entries(items).reduce((sum, [id, n]) => {
    const volume = ctx.items.get(id)?.unitM3 ?? 0
    return sum + (n > 0 && volume > 0 ? Math.ceil(n * volume / WORMHOLE_SLOT_M3) : 0)
  }, 0)
}
