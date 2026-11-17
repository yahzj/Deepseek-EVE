import { ceilFinalQuantity } from '../quantity'
import type { GameState } from '../state'
import type { MarketBalance, MarketGoodDef, SimContext } from '../types'
import { nextInt, nextRandom, pickWeighted } from '../rng'
import { ironmanCommonFlowMul, ironmanExoticCapBonus, ironmanExoticWeightMul, ironmanRareWeightMul } from '../ironman'
import { hasLimitedSupply } from '../marketLimitedSupply'
import { priceLevel, sellPrice, dumpBuyVolumeMul, buyPrice, dumpSellVolumeMul, builtSellBoost } from './pricing'
import { bestBuy, npcPushSell, npcPushBuy } from './book'
import { SWEEP_PER_LEVEL, SECONDHAND_PER_LEVEL, RARE_PCT_MIN, RARE_PCT_MAX, RARE_LIFE_MUL, RARE_LOCKED_WEIGHT, EXOTIC_CAP_PER_DRAW } from './constants'
import { bmGateLocked } from './access'

function rareTierWeight(def: MarketGoodDef, ctx: SimContext): number {
  const m = ctx.balance.market
  if (def.rarityTier === 5) return m.rareTier5Weight ?? 0.05
  if (def.rarityTier === 4) return m.rareTier4Weight ?? 0.2
  return def.rarityTier === 3 ? (m.rareTier3Weight ?? 0.5) : 1
}

export function blueprintWeight(def: MarketGoodDef, ctx: SimContext): number {
  if (def.kind !== 'blueprint') return 1
  const refId = def.refId
  if (refId && ctx.shipBlueprints?.get(refId)?.singleUse === true) {
    return ctx.balance.market.singleUseBlueprintWeight ?? 0.5
  }
  return ctx.balance.market.blueprintWeight ?? 0.05
}

export function refreshLimitedSupplyBook(state: GameState, ctx: SimContext, def: MarketGoodDef, now: number): void {
  const pool = state.market.pools[def.key]!
  const remaining = pool.limitedSupply?.remaining ?? 0
  const L = priceLevel(state, ctx, def, pool.q)
  const base = Math.max(sellPrice(def, L), (bestBuy(state.market.npcBuy[def.key]!.filter(o => !o.relay)) ?? 0) + 1)
  const step = Math.max(1, ceilFinalQuantity(base * 0.04))
  const shares = [Math.ceil(remaining * 0.3), Math.floor(remaining * 0.35)]
  shares.push(remaining - shares[0]! - shares[1]!)
  state.market.npcSell[def.key] = [...state.market.npcSell[def.key]!.filter(o => o.relay), ...shares.flatMap((qty, i) => qty > 0 ? [{
    price: base + i * step, qty, expiresAtGameMs: now + orderLifeMsOf(def, ctx.balance.market),
  }] : [])]
}

export function seedCommonBook(state: GameState, ctx: SimContext, def: MarketGoodDef, openAtMs: number): void {
  const mk = state.market
  const life = ctx.balance.market.orderLifeMs.common
  const now = openAtMs
  const L = priceLevel(state, ctx, def, def.poolTarget ?? 0)
  const sellable = def.playerSellable !== false
  const buyable = def.playerBuyable !== false
  const buyVolMul = dumpBuyVolumeMul(state.market.pools[def.key], ctx.balance.market)
  if (def.poolTarget && def.poolTarget > 0) {
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))
    if (sellable) {
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L), qty: Math.max(1, ceilFinalQuantity(flow * buyVolMul)), expiresAtGameMs: now + life })
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L, -0.01), qty: Math.max(1, ceilFinalQuantity(flow * 1.25 * buyVolMul)), expiresAtGameMs: now + life })
    }
    if (buyable && !hasLimitedSupply(def)) {
      mk.npcSell[def.key]!.push({ price: sellPrice(def, L), qty: Math.max(1, ceilFinalQuantity(flow * 0.8)), expiresAtGameMs: now + life })
    }
    mk.pools[def.key]!.q = def.poolTarget
  } else {
    if (sellable) {
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L), qty: 3, expiresAtGameMs: now + life })
    }
    if (buyable && !hasLimitedSupply(def)) {
      mk.npcSell[def.key]!.push({ price: sellPrice(def, L), qty: 1, expiresAtGameMs: now + life })
      mk.npcSell[def.key]!.push({ price: sellPrice(def, L, 0.02), qty: 1, expiresAtGameMs: now + life })
    }
  }
}


function sweepMul(state: GameState): number {
  return 1 + SWEEP_PER_LEVEL * Math.min(5, state.skills.trained['source-sweeping'] ?? 0)
}

function secondhandMul(state: GameState): number {
  return 1 - SECONDHAND_PER_LEVEL * Math.min(5, state.skills.trained['secondhand-market'] ?? 0)
}

function rarePoolStats(state: GameState, ctx: SimContext): { unlockedN: number; lockedN: number } {
  let unlockedN = 0
  let lockedN = 0
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'rare') continue
    if (bmGateLocked(state, def)) lockedN += 1
    else unlockedN += 1
  }
  return { unlockedN, lockedN }
}

function rareDrawCount(state: GameState, stat: { unlockedN: number; lockedN: number }): number {
  if (stat.unlockedN + stat.lockedN <= 0) return 0
  const r = RARE_PCT_MIN + (RARE_PCT_MAX - RARE_PCT_MIN) * nextRandom(state.rng)
  return Math.max(1, ceilFinalQuantity(r * stat.unlockedN * sweepMul(state) * ironmanRareWeightMul(state)))
}

function priceJitter(state: GameState): number {
  return 1 + (nextRandom(state.rng) - 0.5) * 0.04
}

function orderLifeMsOf(def: MarketGoodDef, bal: MarketBalance): number {
  if (def.kind === 'blueprint' && def.rarity === 'rare') return Math.round(bal.blueprintLifeMs)
  return Math.round(bal.orderLifeMs[def.rarity] * (def.rarity === 'rare' ? RARE_LIFE_MUL : 1))
}

function spawnRareSupply(state: GameState, ctx: SimContext, def: MarketGoodDef, now: number, locked: boolean): void {
  const poolQ = state.market.pools[def.key]?.q ?? 0
  const L = priceLevel(state, ctx, def, poolQ)
  const lifeMs = orderLifeMsOf(def, ctx.balance.market)
  if (def.kind !== 'ship') void nextInt(state.rng, 3)
  const qty = def.kind === 'ship' ? 1 : Math.max(1, ceilFinalQuantity(def.rareQtyMul ?? 1))
  const price = ceilFinalQuantity(sellPrice(def, L) * priceJitter(state) * secondhandMul(state) * (locked ? 4 : 1))
  npcPushSell(state, ctx, def, poolQ, now, lifeMs, price, qty, locked)
}

function spawnExoticSupply(state: GameState, ctx: SimContext, def: MarketGoodDef, now: number): void {
  const poolQ = state.market.pools[def.key]?.q ?? 0
  const L = priceLevel(state, ctx, def, poolQ)
  const lifeMs = orderLifeMsOf(def, ctx.balance.market)
  const price = ceilFinalQuantity(sellPrice(def, L) * priceJitter(state))
  npcPushSell(state, ctx, def, poolQ, now, lifeMs, price, 1, false)
}

export function slowSupplyDraw(state: GameState, ctx: SimContext, now: number): void {
  const stat = rarePoolStats(state, ctx)
  const n = rareDrawCount(state, stat)
  if (n > 0) {
    const defs: MarketGoodDef[] = []
    let totalW = 0
    const wOf = (def: MarketGoodDef): number =>
      blueprintWeight(def, ctx) *
      (bmGateLocked(state, def) ? RARE_LOCKED_WEIGHT : 1) *
      rareTierWeight(def, ctx) *
      Math.max(1, def.rareWeightMul ?? 1)
    for (const def of ctx.marketGoods.values()) {
      if (def.rarity !== 'rare' || def.playerBuyable === false) continue
      defs.push(def)
      totalW += wOf(def)
    }
    for (let i = 0; i < n; i++) {
      const picked = pickWeighted(state.rng, defs, wOf)
      if (picked) spawnRareSupply(state, ctx, picked, now, bmGateLocked(state, picked))
    }
  }
  const sweep = sweepMul(state)
  const winners: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'exotic' || def.playerBuyable === false) continue
    const chance = ctx.balance.market.exoticWindowChance * sweep * blueprintWeight(def, ctx) * ironmanExoticWeightMul(state)
    if (nextRandom(state.rng) < chance) winners.push(def)
  }
  while (winners.length > EXOTIC_CAP_PER_DRAW + ironmanExoticCapBonus(state)) {
    winners.splice(nextInt(state.rng, winners.length), 1)
  }
  for (const def of winners) spawnExoticSupply(state, ctx, def, now)
}

export function refreshGoodOrders(state: GameState, ctx: SimContext, def: MarketGoodDef, poolQ: number, now: number): void {
  const mk = state.market
  const bal = ctx.balance.market
  const sellList = mk.npcSell[def.key]!
  const sellable = def.playerSellable !== false
  const lifeMs = orderLifeMsOf(def, bal)
  const L = priceLevel(state, ctx, def, poolQ)
  const buyVolMul = dumpBuyVolumeMul(mk.pools[def.key], bal)
  const sellVolMul = dumpSellVolumeMul(mk.pools[def.key], bal)
  const locked = def.rarity === 'rare' && bmGateLocked(state, def)
  const priceMul = locked ? 4 : 1

  if (def.rarity === 'common') {
    if (def.poolTarget && def.poolTarget > 0) {
      const flow = (def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))) * ironmanCommonFlowMul(state)
      const avail = Math.max(0.05, Math.min(1.5, poolQ / def.poolTarget))
      const buyBase = ceilFinalQuantity(buyPrice(def, L))
      const sellBase = ceilFinalQuantity(sellPrice(def, L))
      const buyStep = Math.max(1, ceilFinalQuantity(buyBase * 0.04))
      const sellStep = Math.max(1, ceilFinalQuantity(sellBase * 0.04))
      for (let i = 0; i < 3; i += 1) {
        const price = Math.max(1, buyBase - i * buyStep)
        const qty = Math.max(1, ceilFinalQuantity(flow * (0.5 + 0.35 * i) * buyVolMul))
        npcPushBuy(state, ctx, def, now, lifeMs, price, qty)
      }
      if (hasLimitedSupply(def)) {
        refreshLimitedSupplyBook(state, ctx, def, now)
      } else if (def.playerBuyable !== false) {
        for (let i = 0; i < 3; i += 1) {
          const price = Math.max(1, sellBase + i * sellStep)
          const qty = Math.max(1, ceilFinalQuantity(flow * avail * (0.5 + 0.35 * i) * sellVolMul))
          npcPushSell(state, ctx, def, poolQ, now, lifeMs, price, qty)
        }
      }
    } else {
      const boost = builtSellBoost(state, ctx)
      if (nextRandom(state.rng) < 0.85) npcPushBuy(state, ctx, def, now, lifeMs, ceilFinalQuantity(buyPrice(def, L) * priceJitter(state)), Math.max(1, ceilFinalQuantity(3 * boost * buyVolMul)))
      const sellChance = def.kind === 'blueprint' ? 0.425 : 0.85
      if (hasLimitedSupply(def)) refreshLimitedSupplyBook(state, ctx, def, now)
      else if (
        def.playerBuyable !== false &&
        (def.kind === 'blueprint' ? nextRandom(state.rng) < sellChance : sellList.filter(o => !o.relay).length < 2 || nextRandom(state.rng) < sellChance)
      ) {
        npcPushSell(state, ctx, def, poolQ, now, lifeMs, ceilFinalQuantity(sellPrice(def, L) * priceJitter(state)), 1)
      }
    }
  } else if (def.rarity === 'rare') {
    const boost = builtSellBoost(state, ctx)
    const wMul = Math.max(1, def.rareWeightMul ?? 1)
    const qMul = Math.max(1, ceilFinalQuantity(def.rareQtyMul ?? 1))
    if (sellable && nextRandom(state.rng) < Math.min(0.9, 0.03 * boost * rareTierWeight(def, ctx) * wMul)) {
      npcPushBuy(state, ctx, def, now, lifeMs, ceilFinalQuantity(buyPrice(def, L) * priceMul), Math.max(1, ceilFinalQuantity(2 * boost * buyVolMul * qMul)), locked)
    }
  } else if (def.rarity === 'exotic') {
    const boost = builtSellBoost(state, ctx)
    if (sellable && nextRandom(state.rng) < Math.min(0.9, 0.01 * boost)) {
      npcPushBuy(state, ctx, def, now, lifeMs, ceilFinalQuantity(buyPrice(def, L)), Math.max(1, ceilFinalQuantity(boost * buyVolMul)))
    }
  }
}
