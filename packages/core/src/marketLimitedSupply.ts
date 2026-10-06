/** 限额慢补货：NPC出售额度独立于经济库存池，成交通道共用一份余额。 */
import type { MarketPoolState } from './state'
import type { MarketGoodDef } from './types'

export function hasLimitedSupply(def: MarketGoodDef | undefined): boolean {
  return !!def && def.rarity === 'common' && def.playerBuyable !== false &&
    Number.isSafeInteger(def.limitedSupplyCap) && (def.limitedSupplyCap ?? 0) > 0 &&
    Number.isSafeInteger(def.limitedSupplyEveryMs) && (def.limitedSupplyEveryMs ?? 0) > 0 &&
    Number.isSafeInteger(def.limitedSupplyUnits ?? 1) && (def.limitedSupplyUnits ?? 1) > 0
}

/** 只在首次启用时发初始库存；已经存在的零余额不重新赠送。 */
export function ensureLimitedSupply(pool: MarketPoolState, def: MarketGoodDef, nowGameMs = 0): boolean {
  if (!hasLimitedSupply(def)) return false
  const cap = def.limitedSupplyCap!
  const fresh = pool.limitedSupply === undefined
  pool.limitedSupply ??= { remaining: cap, refillProgressMs: 0, lastRefillGameMs: nowGameMs }
  const stock = pool.limitedSupply
  stock.remaining = Math.min(cap, Math.max(0, Math.floor(Number.isFinite(stock.remaining) ? stock.remaining : 0)))
  stock.refillProgressMs = stock.remaining >= cap ? 0 :
    Math.max(0, Math.floor(Number.isFinite(stock.refillProgressMs) ? stock.refillProgressMs : 0)) % def.limitedSupplyEveryMs!
  stock.lastRefillGameMs ??= nowGameMs
  return fresh
}

export function advanceLimitedSupply(pool: MarketPoolState, def: MarketGoodDef, deltaMs: number, nowGameMs?: number): void {
  if (!hasLimitedSupply(def) || !pool.limitedSupply || deltaMs <= 0) return
  const stock = pool.limitedSupply
  const now = nowGameMs ?? (stock.lastRefillGameMs ?? 0) + deltaMs
  const passed = Math.max(0, now - (stock.lastRefillGameMs ?? now - deltaMs))
  stock.lastRefillGameMs = Math.max(stock.lastRefillGameMs ?? 0, now)
  const cap = def.limitedSupplyCap!
  if (stock.remaining >= cap) {
    stock.refillProgressMs = 0
    return
  }
  const elapsed = stock.refillProgressMs + passed
  const every = def.limitedSupplyEveryMs!
  const units = Math.max(1, Math.floor(def.limitedSupplyUnits ?? 1))
  stock.remaining = Math.min(cap, stock.remaining + Math.floor(elapsed / every) * units)
  stock.refillProgressMs = stock.remaining >= cap ? 0 : elapsed % every
}

/** 普通商品不受此规则限制；限额商品的全部NPC成交从这里核销。 */
export function limitedSupplyAvailable(pool: MarketPoolState | undefined, def: MarketGoodDef | undefined): number {
  return hasLimitedSupply(def) ? (pool?.limitedSupply?.remaining ?? 0) : Infinity
}

export function consumeLimitedSupply(pool: MarketPoolState | undefined, def: MarketGoodDef | undefined, qty: number, nowGameMs: number): void {
  if (!hasLimitedSupply(def) || !pool?.limitedSupply || qty <= 0) return
  // 满额后的第一次消费从成交时刻开始补货，不能把成交前的分钟余量借给补货。
  if (pool.limitedSupply.remaining >= def!.limitedSupplyCap!) pool.limitedSupply.lastRefillGameMs = nowGameMs
  pool.limitedSupply.remaining = Math.max(0, pool.limitedSupply.remaining - qty)
}
