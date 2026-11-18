import type { GameState } from '../state'
import type { MarketGoodDef, SimContext } from '../types'
import { addWare, countWare, removeWare } from '../inventory'
import { addModule, countModule, removeModule } from '../equipment'
import { addShipToFleet } from '../fleetBook'
import { countAiCore, gainAiCore, spendAiCores } from '../aiCores'

export function depositGood(state: GameState, ctx: SimContext, goodKey: string, qty: number): string | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return null
  if (def.kind === 'item') addWare(state, def.refId, qty)
  else if (def.kind === 'module') addModule(state, def.refId, qty)
  else if (def.kind === 'blueprint') state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + qty
  else if (def.kind === 'aicore') gainAiCore(state, def.refId as never, qty)
  else if (def.kind === 'ship') {
    const n = Math.max(1, Math.min(50, Math.floor(qty)))
    let uid: string | null = null
    for (let i = 0; i < n; i += 1) uid = addShipToFleet(state, def.refId)
    return uid
  }
  return null
}

export function refundToStorage(state: GameState, ctx: SimContext, goodKey: string, qty: number): void {
  if (qty <= 0) return
  const def = ctx.marketGoods.get(goodKey)
  if (!def) {
    if (ctx.blueprints.has(goodKey) || ctx.shipBlueprints.has(goodKey)) {
      state.blueprintStock[goodKey] = (state.blueprintStock[goodKey] ?? 0) + qty
    }
    return
  }
  if (def.kind === 'item') addWare(state, def.refId, qty)
  else if (def.kind === 'module') addModule(state, def.refId, qty)
  else if (def.kind === 'blueprint') state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + qty
  else if (def.kind === 'aicore') gainAiCore(state, def.refId as never, qty)
}

export function lockNaturalStock(state: GameState, def: MarketGoodDef, n: number): boolean {
  if (n <= 0) return false
  let ok = false
  if (def.kind === 'item') ok = removeWare(state, def.refId, n)
  else if (def.kind === 'module') ok = removeModule(state, def.refId, n)
  else if (def.kind === 'blueprint') {
    const c = state.blueprintStock[def.refId] ?? 0
    if (c >= n) {
      state.blueprintStock[def.refId] = c - n
      if (state.blueprintStock[def.refId] === 0) delete state.blueprintStock[def.refId]
      ok = true
    }
  } else if (def.kind === 'aicore') ok = spendAiCores(state, def.refId as never, n)
  if (ok) state.escrowItems[def.key] = (state.escrowItems[def.key] ?? 0) + n
  return ok
}

export function unlockNaturalStock(state: GameState, def: MarketGoodDef, n: number): void {
  if (n <= 0) return
  if (def.kind === 'item') addWare(state, def.refId, n)
  else if (def.kind === 'module') addModule(state, def.refId, n)
  else if (def.kind === 'blueprint') {
    state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + n
  } else if (def.kind === 'aicore') {
    const t = def.refId as never
    state.aiCores[t] = (state.aiCores[t] ?? 0) + n
  }
  state.escrowItems[def.key] = Math.max(0, (state.escrowItems[def.key] ?? 0) - n)
}

export function naturalHoldings(state: GameState, def: MarketGoodDef): number {
  if (def.kind === 'item') return countWare(state, def.refId)
  if (def.kind === 'module') return countModule(state, def.refId)
  if (def.kind === 'blueprint') return state.blueprintStock[def.refId] ?? 0
  if (def.kind === 'aicore') return countAiCore(state, def.refId as never)
  return 0
}
