import type { MarketPoolState } from './state'
import type { MarketGoodDef } from './types'

export function hasLimitedSupply(def: MarketGoodDef | undefined): boolean {
  return !!def && def.rarity === 'common' && def.playerBuyable !== false &&
    Number.isSafeInteger(def.limitedSupplyCap) && (def.limitedSupplyCap ?? 0) > 0 &&
    Number.isSafeInteger(def.limitedSupplyEveryMs) && (def.limitedSupplyEveryMs ?? 0) > 0 &&
    Number.isSafeInteger(def.limitedSupplyUnits ?? 1) && (def.limitedSupplyUnits ?? 1) > 0
}

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

export function limitedSupplyAvailable(pool: MarketPoolState | undefined, def: MarketGoodDef | undefined): number {
  return hasLimitedSupply(def) ? (pool?.limitedSupply?.remaining ?? 0) : Infinity
}

export function consumeLimitedSupply(pool: MarketPoolState | undefined, def: MarketGoodDef | undefined, qty: number, nowGameMs: number): void {
  if (!hasLimitedSupply(def) || !pool?.limitedSupply || qty <= 0) return
  if (pool.limitedSupply.remaining >= def!.limitedSupplyCap!) pool.limitedSupply.lastRefillGameMs = nowGameMs
  pool.limitedSupply.remaining = Math.max(0, pool.limitedSupply.remaining - qty)
}
