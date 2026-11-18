import { ceilFinalQuantity } from '../quantity'
import type { GameState } from '../state'
import type { MarketBalance, MarketGoodDef, MarketRarity, SimContext } from '../types'
import { DSI_FACTION_ID, standingOf } from '../standing'


export function builtStationCount(state: GameState, ctx: SimContext): number {
  let n = 0
  for (const site of ctx.stations.values()) {
    const p = state.stationSites[site.id]
    if (p && p.stage >= site.tiers.length) n += 1
  }
  return n
}

export function builtSellBoost(state: GameState, ctx: SimContext): number {
  return Math.pow(ctx.balance.market.builtSellMulPerSite, builtStationCount(state, ctx))
}

export function sellStandingMult(state: GameState, def: MarketGoodDef | undefined): number {
  if (!def || def.kind !== 'item') return 1
  return 1 + Math.min(0.15, standingOf(state, DSI_FACTION_ID) * 0.01)
}

export function salesTaxRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.market
  const lvA = state.skills.trained[bal.taxSkillAId] ?? 0
  const lvB = state.skills.trained[bal.taxSkillBId] ?? 0
  const cut = bal.taxCutPerLevel * (lvA + lvB)
  return Math.max(0, bal.salesTaxRate * (1 - cut))
}

export function netAfterTax(state: GameState, ctx: SimContext, gross: number): number {
  return gross - ceilFinalQuantity(gross * salesTaxRate(state, ctx))
}


export function dumpBuyVolumeMul(pool: { shock?: number } | undefined, bal: MarketBalance): number {
  const shock = pool?.shock ?? 0
  if (!(shock < 0)) return 1
  const layers = Math.abs(shock) / Math.max(1e-9, bal.shockPerTrigger)
  return Math.pow(1 + bal.dumpBuyVolumePerLayer, layers)
}

export function dumpSellVolumeMul(pool: { shock?: number } | undefined, bal: MarketBalance): number {
  const shock = pool?.shock ?? 0
  if (!(shock < 0)) return 1
  const layers = Math.abs(shock) / Math.max(1e-9, bal.shockPerTrigger)
  return Math.max(0.1, Math.pow(1 - bal.dumpSellVolumePerLayer, layers))
}

export function priceLevel(state: GameState, ctx: SimContext, def: MarketGoodDef, poolQ: number): number {
  const bal = ctx.balance.market
  const pool = state.market.pools[def.key]!
  let pressure = 1
  if (def.poolTarget && def.poolTarget > 0) {
    pressure = 1 - 0.5 * ((poolQ - def.poolTarget) / def.poolTarget)
    pressure = Math.max(0.4, Math.min(1.6, pressure))
  }
  const noise = Math.max(-0.4, Math.min(0.4, pool.noise ?? 0))
  const level = def.basePrice * pressure * (1 + pool.shock) * (1 + noise)
  return Math.round(Math.min(def.basePrice * bal.maxPriceRatio, Math.max(def.basePrice * bal.minPriceRatio, level)))
}

export const BUY_TIER: Record<MarketRarity, number> = {
  common: 0.6,
  rare: 0.65,
  exotic: 1.0,
}

export function acquisitionFactorOf(def: MarketGoodDef): number {
  return def.demandMultiplier ?? BUY_TIER[def.rarity]
}

export function buyLineOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const poolQ = state.market.pools[goodKey]?.q ?? 0
  return ceilFinalQuantity(buyPrice(def, priceLevel(state, ctx, def, poolQ)))
}

export function askLineOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const poolQ = state.market.pools[goodKey]?.q ?? 0
  return ceilFinalQuantity(sellPrice(def, priceLevel(state, ctx, def, poolQ)))
}

export function buyPrice(def: MarketGoodDef, L: number, delta = 0): number {
  const tier = def.poolTarget && def.poolTarget > 0 ? (def.demandMultiplier ?? 1) : acquisitionFactorOf(def)
  return ceilFinalQuantity(L * tier * (1 + delta))
}

export function sellPrice(def: MarketGoodDef, L: number, delta = 0): number {
  const base = def.poolTarget && def.poolTarget > 0 ? Math.max(L * 1.06, L + 1) : L * (def.supplyMultiplier ?? 1)
  return ceilFinalQuantity(base * (1 + delta))
}

export function levelOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const q = state.market.pools[goodKey]?.q ?? def.poolTarget ?? 0
  return priceLevel(state, ctx, def, q)
}


export function marketSellSkillMult(state: GameState, kind: MarketGoodDef['kind'] | undefined): number {
  let mult = 1
  const mktLv = Math.min(5, state.skills.trained['marketing'] ?? 0)
  if (mktLv > 0) mult *= 1 + 0.012 * mktLv
  if (kind === 'blueprint') {
    const shLv = Math.min(5, state.skills.trained['secondhand-market'] ?? 0)
    if (shLv > 0) mult *= 1 + 0.08 * shLv
  }
  return mult
}
