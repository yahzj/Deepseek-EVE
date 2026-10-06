import type { BattleState, GameState } from './state'
import type { SimContext } from './types'
import { WORMHOLE_SLOT_M3 } from './wormholeHold'

/** 本趟物资数量账；格板与战斗预载只保存位置，不复制数量。 */
export interface WormholeSupplyLedger {
  items: Record<string, number>
  carried: Record<string, number>
  consumed: Record<string, number>
  deployed: Record<string, number>
  /** 战后机体回到本趟货仓的累计量，含超额回收或受机舱/CPU限制的存活机，不计战利品。 */
  recovered: Record<string, number>
  leftBehind: Record<string, number>
  found: Record<string, number>
}

export function wormholeSupplyForBattle(state: GameState, battle: BattleState | null | undefined): WormholeSupplyLedger | undefined {
  const run = state.wormhole.run
  if (!battle?.wormhole || !run || (run.supplyVersion !== 1 && run.expeditionRules === undefined)) return undefined
  // 新规则的缺字段异常不能重新打开洞外供货，也不能补造库存。
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

/** 已耗弹药的回收；不允许回收超出已记消耗的数量。 */
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

/** 备用机离开货仓进入机舱，记录转移而非当成凭空销毁。 */
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

/** 先核销全队复位，包括随后沉没的舰；逐舰战损与独立收口共用。 */
export function settleWormholeDroneRevives(state: GameState, battle: BattleState): void {
  const supply = wormholeSupplyForBattle(state, battle)
  const ammo = battle.expeditionAmmo
  if (!supply || !ammo || ammo.revivesSettled) return
  for (const book of Object.values(battle.droneRevive ?? {})) {
    for (const [id, n] of Object.entries(book.v)) deployWormholeSupply(supply, id, n)
  }
  ammo.revivesSettled = true
}

/** 可用与预载按同id合并后占格，预载转移本身不腾空间。 */
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
