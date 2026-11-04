import type { GameState } from '../state'
import type { MarketGoodDef, SimContext } from '../types'
import { addWare, countWare, removeWare } from '../inventory'
import { addModule, countModule, removeModule } from '../equipment'
import { addShipToFleet } from '../fleetBook'
import { countAiCore, gainAiCore, spendAiCores } from '../aiCores'

/** 买入商品入对应库存（物品→物品仓库；装备→装备库；蓝图→蓝图书；核心→核心库；船→舰队）。
 * 返回：kind=ship 时为本次入队的舰船实例 uid（最后加入的一艘；多艘同批时取末艘），其余返回 null */
export function depositGood(state: GameState, ctx: SimContext, goodKey: string, qty: number): string | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return null
  if (def.kind === 'item') addWare(state, def.refId, qty)
  else if (def.kind === 'module') addModule(state, def.refId, qty)
  else if (def.kind === 'blueprint') state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + qty
  else if (def.kind === 'aicore') gainAiCore(state, def.refId as never, qty)
  // v17（T5-B）：船按"艘"实例化——买几艘进几艘（同型多艘自动编号）；返回最后加入的实例 uid
  else if (def.kind === 'ship') {
    const n = Math.max(1, Math.min(50, Math.floor(qty)))
    let uid: string | null = null
    for (let i = 0; i < n; i += 1) uid = addShipToFleet(state, def.refId)
    return uid
  }
  return null
}

/** 按商品类别退回库存（撤单/取回用） */
export function refundToStorage(state: GameState, ctx: SimContext, goodKey: string, qty: number): void {
  if (qty <= 0) return
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return
  if (def.kind === 'item') addWare(state, def.refId, qty)
  else if (def.kind === 'module') addModule(state, def.refId, qty)
  else if (def.kind === 'blueprint') state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + qty
  else if (def.kind === 'aicore') gainAiCore(state, def.refId as never, qty)
}

/** 从"自然库存"扣货并计入 escrow（物品→仓库、装备→装备库、蓝图→蓝图书架、核心→核心库）；数量不足返回 false */
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

/** 退还锁进 escrow 的自然库存（市价卖出簿空等场景回滚用；与 lockNaturalStock 互逆；含 AI 核心回库） */
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

/** 自然库存持有量（市场页展示"我的可卖"用：物品→仓库、装备→装备库、蓝图→书架、核心→核心库） */
export function naturalHoldings(state: GameState, def: MarketGoodDef): number {
  if (def.kind === 'item') return countWare(state, def.refId)
  if (def.kind === 'module') return countModule(state, def.refId)
  if (def.kind === 'blueprint') return state.blueprintStock[def.refId] ?? 0
  if (def.kind === 'aicore') return countAiCore(state, def.refId as never)
  return 0
}
