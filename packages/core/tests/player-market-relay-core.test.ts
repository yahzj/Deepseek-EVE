import { describe, expect, it } from 'vitest'
import type { MarketRelayResponse } from '../src/market/relayTypes'
import { applyMarketRelayResponse, marketRelayPendingRequest, prepareMarketRelayRequest } from '../src/market/relay'
import { ensureMarket } from '../src/market/initialize'
import { createInitialState } from '../src/state'
import type { GameState, PlayerOrder } from '../src/state'
import type { SimContext } from '../src/types'
import { MARKET_RELAY_POLICY } from '../src/market/relayTypes'
import { makeTestCtx } from './helpers'

const scope = 'relay-scope'
const item = { key: 'relay-ore', kind: 'item' as const, refId: 'relay-ore', rarity: 'common' as const, basePrice: 10,
  playerBuyable: true, standingReq: 0, limitedSupplyCap: 3, limitedSupplyEveryMs: 60_000 }

function world(opts: { standingReq?: number } = {}): { state: GameState; ctx: SimContext } {
  const ctx = makeTestCtx({ marketGoods: [{ ...item, standingReq: opts.standingReq ?? 0 }] })
  const state = createInitialState({ nowWallMs: 0, seed: 31 })
  ensureMarket(state, ctx)
  state.market.pools[item.key]!.limitedSupply!.remaining = 0
  return { state, ctx }
}

function buyOrder(state: GameState, qty = 5): PlayerOrder {
  const order: PlayerOrder = {
    id: 1, relayId: 'owner-order', side: 'buy', good: item.key, price: 10, qty, filled: 0,
    placedAtGameMs: 0, escrowIsk: qty * 10,
  }
  state.orders.push(order)
  return order
}

function prepare(state: GameState, ctx: SimContext, requestId: string) {
  return prepareMarketRelayRequest(state, ctx, scope, { saveId: 'save', requestId, orderId: () => 'owner-order' })!
}

function response(requestId: string, settlements: MarketRelayResponse['settlements']): MarketRelayResponse {
  return {
    protocolVersion: 1, requestId, serverTime: 0, policy: MARKET_RELAY_POLICY, offers: [], settlements,
    acknowledgedSettlementIds: [], acknowledgedFillIds: [],
  }
}

describe('player market relay core', () => {
  it('keeps a pending request and its nested snapshots immutable until response application', () => {
    const { state, ctx } = world()
    buyOrder(state)
    const first = prepare(state, ctx, 'request-1')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.orders)).toBe(true)
    expect(Object.isFrozen(first.orders[0])).toBe(true)
    expect(() => { (first.orders[0] as { qty: number }).qty = 99 }).toThrow()
    state.orders[0]!.qty = 4
    expect(prepare(state, ctx, 'request-2')).toBe(first)
    expect(marketRelayPendingRequest(state, scope)?.orders[0]?.qty).toBe(5)
  })

  it('applies only the snapshot and escrow quantity once across multiple settlements, bypassing NPC limited stock', () => {
    const { state, ctx } = world()
    const order = buyOrder(state)
    const pending = prepare(state, ctx, 'request-cap')
    const applied = applyMarketRelayResponse(state, ctx, scope, pending.requestId, response(pending.requestId, [
      { settlementId: 'settle-a', orderId: 'owner-order', goodKey: item.key, side: 'buy', qty: 4, price: 10 },
      { settlementId: 'settle-b', orderId: 'owner-order', goodKey: item.key, side: 'buy', qty: 4, price: 10 },
    ]))
    expect(applied).toBe(true)
    expect(order.filled).toBe(5)
    expect(order.remoteApplied).toBe(5)
    expect(state.warehouse.items[item.refId]).toBe(5)
    expect(state.market.pools[item.key]!.limitedSupply!.remaining).toBe(0)
    expect(state.orders).toHaveLength(0)
  })

  it('keeps the standing gate on relay buys even though remote settlement bypasses NPC limited supply', () => {
    const { state, ctx } = world({ standingReq: 5 })
    const order = buyOrder(state)
    const pending = prepare(state, ctx, 'request-standing')
    expect(applyMarketRelayResponse(state, ctx, scope, pending.requestId, response(pending.requestId, [
      { settlementId: 'settle-locked', orderId: 'owner-order', goodKey: item.key, side: 'buy', qty: 3, price: 10 },
    ]))).toBe(true)
    expect(order.filled).toBe(0)
    expect(order.remoteApplied).toBeUndefined()
    expect(state.warehouse.items[item.refId]).toBeUndefined()
    expect(state.market.pools[item.key]!.limitedSupply!.remaining).toBe(0)
  })

  it('does not replay a stale response or apply the same settlement receipt twice', () => {
    const { state, ctx } = world()
    const order = buyOrder(state)
    const pending = prepare(state, ctx, 'request-dedupe')
    const settlement = { settlementId: 'settle-once', orderId: 'owner-order', goodKey: item.key, side: 'buy' as const, qty: 2, price: 10 }
    const payload = response(pending.requestId, [settlement])
    expect(applyMarketRelayResponse(state, ctx, scope, pending.requestId, payload)).toBe(true)
    expect(order.filled).toBe(2)
    expect(applyMarketRelayResponse(state, ctx, scope, pending.requestId, payload)).toBe(false)

    const retry = prepare(state, ctx, 'request-retry')
    expect(applyMarketRelayResponse(state, ctx, scope, retry.requestId, response(retry.requestId, [settlement]))).toBe(true)
    expect(order.filled).toBe(2)
    expect(order.remoteApplied).toBe(2)
    expect(state.warehouse.items[item.refId]).toBe(2)
  })
})
