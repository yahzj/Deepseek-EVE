import type { GameState } from '../state'
import type { SimContext } from '../types'
import { nextRandom } from '../rng'
import { advanceLimitedSupply } from '../marketLimitedSupply'
import { ensureMarket } from './initialize'
import { refreshGoodOrders, slowSupplyDraw } from './supply'
import { RARE_DRAW_PERIOD_MS, PRICE_SAMPLE_MS, PRICE_HISTORY_LIMIT } from './constants'
import { matchPlayerOrders, absorbViaStation } from './matching'
import { priceLevel } from './pricing'
import { referenceVol } from './book'
import { pruneRelayOffers } from './relayLedger'


export function advanceMarket(state: GameState, deltaMs: number, ctx: SimContext): void {
  if (deltaMs <= 0) return
  ensureMarket(state, ctx, { openAtGameMs: state.gameMs - deltaMs })
  let guard = 0
  const mk = state.market
  const tick = ctx.balance.market.tickMs
  while (mk.lastTickGameMs + tick <= state.gameMs && guard < 20000) {
    guard++
    processWindow(state, ctx)
  }
}

function processWindow(state: GameState, ctx: SimContext): void {
  const mk = state.market
  const bal = ctx.balance.market
  const dt = bal.tickMs
  const nextNow = mk.lastTickGameMs + dt
  pruneRelayOffers(state, nextNow)
  const regenK = 1 - Math.pow(0.5, dt / bal.poolRegenHalfMs)
  const decayK = 1 - Math.pow(0.5, dt / bal.shockDecayHalfMs)
  const noiseK = 1 - Math.pow(0.5, dt / bal.noiseHalfLifeMs)

  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    const pool = mk.pools[key]!
    const buyList = mk.npcBuy[key]!
    const sellList = mk.npcSell[key]!

    for (let i = buyList.length - 1; i >= 0; i--) if (buyList[i]!.expiresAtGameMs <= nextNow) buyList.splice(i, 1)
    for (let i = sellList.length - 1; i >= 0; i--) if (sellList[i]!.expiresAtGameMs <= nextNow) sellList.splice(i, 1)

    if (def.playerBuyable === false && def.playerSellable === false && def.blackMarketBuyable === false && def.demandMultiplier === 0) continue

    if (def.poolTarget && def.poolTarget > 0) pool.q += (def.poolTarget - pool.q) * regenK
    advanceLimitedSupply(pool, def, dt, nextNow)
    pool.shock *= 1 - decayK
    pool.noise = Math.max(-0.4, Math.min(0.4, pool.noise * (1 - noiseK) + (nextRandom(state.rng) - 0.5) * bal.noiseStep))

    const dig = mk.digest[key]!
    if (dig.qty > 0) {
      dig.qty = Math.max(0, dig.qty - dig.perWindow)
      if (dig.qty === 0) {
        dig.price = 0
        dig.perWindow = 0
      }
    }

    refreshGoodOrders(state, ctx, def, pool.q, nextNow)
  }

  if ((mk.slowDrawLastGameMs ?? 0) + RARE_DRAW_PERIOD_MS <= nextNow) {
    mk.slowDrawLastGameMs = nextNow
    slowSupplyDraw(state, ctx, nextNow)
  }

  matchPlayerOrders(state, ctx, nextNow)
  absorbViaStation(state, ctx)

  const sampleNow = Math.floor(nextNow / PRICE_SAMPLE_MS) !== Math.floor(mk.lastTickGameMs / PRICE_SAMPLE_MS)
  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    const pool = mk.pools[key]!
    if (def.playerBuyable === false && def.playerSellable === false && def.blackMarketBuyable === false && def.demandMultiplier === 0) continue
    const hist = mk.priceHistory[key]!
    if (sampleNow || hist.length === 0) {
      hist.push(priceLevel(state, ctx, def, pool.q))
      if (hist.length > PRICE_HISTORY_LIMIT) hist.shift()
    }
    const ref = referenceVol(def, bal.referenceVolRatio)
    if (ref > 0 && Math.abs(pool.netVol) > ref * bal.shockTriggerRatio) {
      pool.shock += Math.sign(pool.netVol) * bal.shockPerTrigger
    }
    pool.netVol = 0
  }

  mk.lastTickGameMs = nextNow
}
