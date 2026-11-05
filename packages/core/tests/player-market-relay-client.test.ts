import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketRelayRequest, MarketRelayResponse } from '@whale/core'
import { MarketRelayController } from '../../../apps/desktop/src/renderer/src/features/market/relay/controller'
import { marketRelayRequestShape, marketRelayResponseShape } from '../../../apps/desktop/src/renderer/src/features/market/relay/protocol'

const session = { server: 'https://game.bajibaji.party', playerId: 7, token: 'private' }
const request: MarketRelayRequest = {
  protocolVersion: 1, requestId: 'request-1', scope: 'a'.repeat(64), saveId: 'save-1', snapshotSeq: 1, snapshotComplete: true,
  orders: [{ orderId: 'order-1', goodKey: 'item', side: 'sell', price: 10, originalQty: 2, qty: 2, localFilled: 0, filled: 0, remoteApplied: 0 }],
  fills: [{ fillId: 'fill-1', quoteId: 'quote-1', qty: 1 }],
  settlementAcks: ['settlement-old'],
}
const response: MarketRelayResponse = {
  protocolVersion: 1, requestId: 'request-1', serverTime: 100,
  policy: { version: 1, scarceMultiplier: 5, sampleRatio: 0.1, maxOffers: 10, maxPriceRatio: 1000, offerTtlMs: 300000 },
  offers: [{ quoteId: 'quote-2', goodKey: 'item', side: 'buy', price: 10, qty: 2, expiresAt: 200 }],
  settlements: [{ settlementId: 'settlement-1', orderId: 'order-1', goodKey: 'item', side: 'sell', price: 10, qty: 1 }],
  acknowledgedSettlementIds: ['settlement-old'],
  acknowledgedFillIds: ['fill-1'],
}

afterEach(() => vi.useRealTimers())

describe('isolated market relay network controller', () => {
  it('only sends when explicitly invoked, and once per market window', async () => {
    const transport = vi.fn(async () => response)
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    expect(transport).not.toHaveBeenCalled()
    expect(await controller.send(10, request)).toEqual({ kind: 'response', response })
    expect(await controller.send(10, request)).toEqual({ kind: 'blocked' })
    expect(await controller.send(11, request)).toEqual({ kind: 'response', response })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('retries the same payload and request id only in the next window after failure', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(response)
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    expect(await controller.send(1, request)).toEqual({ kind: 'failed' })
    expect(await controller.send(1, request)).toEqual({ kind: 'blocked' })
    expect(await controller.send(2, request)).toEqual({ kind: 'response', response })
    expect(transport.mock.calls.map(call => call[1])).toEqual([request, request])
  })

  it('does not retry a failed request again in the same market window', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('network'))
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    expect(await controller.send(4, request)).toEqual({ kind: 'failed' })
    expect(await controller.send(4, request)).toEqual({ kind: 'blocked' })
    expect(transport).toHaveBeenCalledOnce()
  })

  it.each(['playerId', 'server', 'token'] as const)('cancels and rejects stale responses on %s change', async field => {
    let complete!: (value: unknown) => void
    let signal!: AbortSignal
    const transport = vi.fn((_session, _request, current: AbortSignal) => {
      signal = current
      return new Promise(resolve => { complete = resolve })
    })
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    const pending = controller.send(1, request)
    controller.setSession({ ...session, [field]: field === 'playerId' ? 8 : 'different' })
    expect(signal.aborted).toBe(true)
    complete(response)
    expect(await pending).toEqual({ kind: 'stale' })
  })

  it('blocks the rejected token after 401 and resumes with a new token', async () => {
    const transport = vi.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValue(response)
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    expect(await controller.send(1, request)).toEqual({ kind: 'failed' })
    expect(await controller.send(2, request)).toEqual({ kind: 'blocked' })
    controller.setSession({ ...session, token: 'new-token' })
    expect(await controller.send(2, request)).toEqual({ kind: 'response', response })
  })

  it.each([404, 503])('retries HTTP %i on the next market window', async status => {
    const transport = vi.fn().mockRejectedValueOnce({ status }).mockResolvedValue(response)
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    expect(await controller.send(1, request)).toEqual({ kind: 'failed' })
    expect(await controller.send(2, request)).toEqual({ kind: 'response', response })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('cancels after 15 seconds even if the injected transport ignores cancellation', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const controller = new MarketRelayController((_session, _request, current) => {
      signal = current
      return new Promise(() => {})
    })
    controller.setSession(session)
    const pending = controller.send(1, request)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal.aborted).toBe(true)
    expect(await pending).toEqual({ kind: 'failed' })
  })

  it('rejects malformed and overlarge responses without exposing transport errors', async () => {
    const transport = vi.fn().mockResolvedValueOnce({ ...response, requestId: 'other' })
      .mockResolvedValueOnce({ ...response, extra: 'x'.repeat(512 * 1024) })
      .mockRejectedValueOnce({ status: 500, token: 'private' })
    const controller = new MarketRelayController(transport)
    controller.setSession(session)
    expect(await controller.send(1, request)).toEqual({ kind: 'invalid' })
    expect(await controller.send(2, request)).toEqual({ kind: 'invalid' })
    expect(await controller.send(3, request)).toEqual({ kind: 'failed' })
  })
})

describe('market relay protocol validation', () => {
  it('checks ids, safe integer amounts, lengths and duplicates', () => {
    expect(marketRelayRequestShape(request)).toBe(true)
    expect(marketRelayRequestShape({ ...request, saveId: ' ' })).toBe(false)
    expect(marketRelayRequestShape({ ...request, orders: [{ ...request.orders[0], price: Number.MAX_SAFE_INTEGER, qty: 2 }] })).toBe(false)
    expect(marketRelayRequestShape({ ...request, orders: Array(129).fill(request.orders[0]) })).toBe(false)
    expect(marketRelayRequestShape({ ...request, fills: [request.fills[0], request.fills[0]] })).toBe(false)
    expect(marketRelayResponseShape(response, request)).toBe(true)
    expect(marketRelayResponseShape({ ...response, offers: [response.offers[0], response.offers[0]] }, request)).toBe(false)
    expect(marketRelayResponseShape({ ...response, settlements: [response.settlements[0], response.settlements[0]] }, request)).toBe(false)
    expect(marketRelayResponseShape({ ...response, policy: { ...response.policy, version: 2 } }, request)).toBe(false)
    expect(marketRelayResponseShape({ ...response, acknowledgedSettlementIds: ['unexpected'] }, request)).toBe(false)
  })
})
