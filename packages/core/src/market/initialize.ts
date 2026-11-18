import type { GameState } from '../state'
import type { SimContext } from '../types'
import { ensureLimitedSupply, hasLimitedSupply } from '../marketLimitedSupply'
import { RARE_DRAW_PERIOD_MS } from './constants'
import { seedCommonBook, refreshLimitedSupplyBook } from './supply'
import { priceLevel } from './pricing'
import { pruneRelayOffers } from './relayLedger'
import { refundToStorage } from './stock'


export function ensureMarket(state: GameState, ctx: SimContext, opts?: { openAtGameMs?: number }): void {
  const mk = state.market
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const order = state.orders[i]!
    const bp = ctx.blueprints.get(order.good)
    if (ctx.marketGoods.has(order.good) || ctx.modules.get(bp?.moduleId ?? '')?.slot !== 'plug') continue
    if (order.side === 'buy') state.wallet.isk += order.escrowIsk ?? 0
    else {
      const held = Math.min(order.qty, state.escrowItems[order.good] ?? 0)
      refundToStorage(state, ctx, order.good, held)
      state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - held)
    }
    state.orders.splice(i, 1)
  }
  pruneRelayOffers(state, opts?.openAtGameMs ?? state.gameMs)
  const freshInit = mk.lastTickGameMs === 0 && mk.orderSeq === 0 && Object.keys(mk.pools).length === 0
  const openAt = opts?.openAtGameMs !== undefined ? Math.max(0, Math.floor(opts.openAtGameMs)) : state.gameMs
  if (mk.slowDrawLastGameMs === undefined) mk.slowDrawLastGameMs = Math.max(0, openAt - RARE_DRAW_PERIOD_MS)
  const addedKeys: string[] = []
  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    if (!(key in mk.pools)) {
      mk.pools[key] = { q: def.poolTarget ?? 0, shock: 0, netVol: 0, lastHistoryGameMs: 0, noise: 0 }
      addedKeys.push(key)
    }
    mk.pools[key]!.noise = mk.pools[key]!.noise ?? 0
    mk.npcBuy[key] ??= []
    mk.npcSell[key] ??= []
    if (def.playerBuyable === false && mk.npcSell[key]!.length > 0) mk.npcSell[key] = mk.npcSell[key]!.filter(o => o.relay)
    mk.digest[key] ??= { qty: 0, price: 0, perWindow: 0 }
    mk.priceHistory[key] ??= []
  }
  if (freshInit) {
    for (const def of ctx.marketGoods.values()) {
      if (def.rarity === 'common' && (mk.npcBuy[def.key]?.length ?? 0) === 0) {
        seedCommonBook(state, ctx, def, openAt)
      }
    }
    for (const def of ctx.marketGoods.values()) {
      const hist = mk.priceHistory[def.key]
      if (def.basePrice > 0 && !(def.playerBuyable === false && def.playerSellable === false && def.blackMarketBuyable === false && def.demandMultiplier === 0) && hist && hist.length === 0) hist.push(priceLevel(state, ctx, def, mk.pools[def.key]?.q ?? 0))
    }
    mk.lastTickGameMs = openAt
  }
  for (const key of addedKeys) {
    const def = ctx.marketGoods.get(key)
    if (def && def.rarity === 'common' && (mk.npcBuy[key]?.length ?? 0) === 0) {
      seedCommonBook(state, ctx, def, state.gameMs)
    }
  }
  for (const def of ctx.marketGoods.values()) {
    if (!hasLimitedSupply(def)) continue
    const pool = mk.pools[def.key]!
    const fresh = ensureLimitedSupply(pool, def, openAt)
    const qty = mk.npcSell[def.key]!.reduce((sum, order) => sum + (order.relay ? 0 : order.qty), 0)
    if (fresh || qty !== pool.limitedSupply!.remaining) refreshLimitedSupplyBook(state, ctx, def, openAt)
  }
}
