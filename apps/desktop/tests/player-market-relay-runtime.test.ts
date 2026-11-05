import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, type GameState, type MarketRelayRequest, type MarketRelayResponse } from '@whale/core'
import { MarketRelayRuntime } from '../src/renderer/src/features/market/relay/runtime'

const mocks = vi.hoisted(() => ({
  marketRelaySync: vi.fn(),
  preferences: {
    server: 'https://game.example.test',
    session: { playerId: 7, token: 'token-1', username: 'pilot', nickname: 'pilot' },
  },
}))

vi.mock('../src/renderer/src/features/cloud/api', () => ({
  createCloudApi: () => ({ marketRelaySync: mocks.marketRelaySync }),
  normalizeCloudServerURL: (server: string) => new URL(server).origin,
}))

vi.mock('../src/renderer/src/features/cloud/preferences', () => ({
  CLOUD_SESSION_CHANGE_EVENT: 'whale-cloud-session-change',
  readCloudPreferences: () => mocks.preferences,
  refreshCloudPreferences: () => mocks.preferences,
}))

const policy = { version: 1, scarceMultiplier: 5, sampleRatio: 0.1, maxOffers: 10, maxPriceRatio: 1000, offerTtlMs: 300000 } as const
const microtask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function responseFor(request: MarketRelayRequest, settlements: MarketRelayResponse['settlements'] = []): MarketRelayResponse {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    serverTime: 100,
    policy,
    offers: [],
    settlements,
    acknowledgedSettlementIds: [...request.settlementAcks],
    acknowledgedFillIds: request.fills.map(fill => fill.fillId),
  }
}

function makeHarness() {
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  const listeners = new Set<() => void>()
  const persisted: GameState[] = []
  const applied: GameState[] = []
  const engine = {
    state,
    ctx: {} as never,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    saveWriteState: vi.fn(() => 'ok' as const),
    persist: vi.fn(async () => true),
    marketRelayReady: (candidate: GameState) => engine.state === candidate && engine.saveWriteState() === 'ok',
    marketRelayPending: (candidate: GameState, scope: string) => {
      const relay = candidate.market.relay
      return engine.marketRelayReady(candidate) && relay?.scope === scope ? relay.pending ?? null : null
    },
    persistMarketRelay: vi.fn(async (candidate: GameState) => {
      persisted.push(candidate)
      return engine.marketRelayReady(candidate)
    }),
    prepareMarketRelay: vi.fn((candidate: GameState, scope: string, ids: { saveId: string; requestId: string; orderId: () => string }) => {
      const relay = candidate.market.relay ??= {
        scope,
        saveId: ids.saveId,
        fillSeq: 0,
        requestSeq: 0,
        fills: [],
        settlementAcks: [],
        receipts: [],
        quoteHistory: [],
        quotes: [],
      }
      if (relay.scope !== scope || relay.saveId !== ids.saveId || relay.pending) return null
      const request: MarketRelayRequest = {
        protocolVersion: 1,
        requestId: ids.requestId,
        scope,
        saveId: relay.saveId,
        snapshotSeq: ++relay.requestSeq,
        snapshotComplete: true,
        orders: [],
        fills: [...relay.fills],
        settlementAcks: [...relay.settlementAcks],
      }
      relay.pending = request
      return request
    }),
    applyMarketRelay: vi.fn((candidate: GameState, scope: string, requestId: string, result: MarketRelayResponse) => {
      const relay = candidate.market.relay
      if (!engine.marketRelayReady(candidate) || relay?.scope !== scope || relay.pending?.requestId !== requestId || result.requestId !== requestId) return false
      applied.push(candidate)
      relay.settlementAcks.push(...result.settlements.map(settlement => settlement.settlementId))
      relay.pending = undefined
      return true
    }),
  }
  return { engine, state, listeners, persisted, applied }
}

const runtimeInternals = (runtime: MarketRelayRuntime) => runtime as unknown as { run(): Promise<void> }

let windowListeners: Map<string, Set<EventListener>>
let documentListeners: Map<string, Set<EventListener>>
let mountedCleanup: Array<() => void>

function dispatchWindow(type: string): void {
  for (const listener of windowListeners.get(type) ?? []) listener(new Event(type))
}

async function mountRuntime(engine: ReturnType<typeof makeHarness>['engine']): Promise<MarketRelayRuntime> {
  const runtime = new MarketRelayRuntime(engine)
  mountedCleanup.push(runtime.mount())
  await microtask()
  await microtask()
  return runtime
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.preferences = {
    server: 'https://game.example.test',
    session: { playerId: 7, token: 'token-1', username: 'pilot', nickname: 'pilot' },
  }
  mocks.marketRelaySync.mockImplementation((request: MarketRelayRequest) => Promise.resolve(responseFor(request)))
  windowListeners = new Map()
  documentListeners = new Map()
  mountedCleanup = []
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: EventListener) => {
      const set = windowListeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      windowListeners.set(type, set)
    },
    removeEventListener: (type: string, listener: EventListener) => windowListeners.get(type)?.delete(listener),
  })
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (type: string, listener: EventListener) => {
      const set = documentListeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      documentListeners.set(type, set)
    },
    removeEventListener: (type: string, listener: EventListener) => documentListeners.get(type)?.delete(listener),
  })
})

afterEach(() => {
  for (const cleanup of mountedCleanup.reverse()) cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('market relay runtime lifecycle', () => {
  it('sets busy before awaiting persistence and ignores a concurrent run', async () => {
    const { engine } = makeHarness()
    let finishSave!: (saved: boolean) => void
    engine.persistMarketRelay.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
      .mockResolvedValue(true)
    const runtime = await mountRuntime(engine)

    const first = runtimeInternals(runtime).run()
    const second = runtimeInternals(runtime).run()
    expect(engine.prepareMarketRelay).toHaveBeenCalledOnce()
    expect(engine.persistMarketRelay).toHaveBeenCalledOnce()
    finishSave(true)
    await Promise.all([first, second])
    expect(mocks.marketRelaySync).toHaveBeenCalledOnce()
  })

  it('hashes only normalized server and player id, aborts a token change, and preserves the pending identity', async () => {
    const { engine, state, applied } = makeHarness()
    let finishFirst!: (value: MarketRelayResponse) => void
    let firstSignal!: AbortSignal
    mocks.marketRelaySync
      .mockImplementationOnce((_request: MarketRelayRequest, signal: AbortSignal) => {
        firstSignal = signal
        return new Promise(resolve => { finishFirst = resolve })
      })
      .mockImplementationOnce((request: MarketRelayRequest) => Promise.resolve(responseFor(request)))
    const runtime = await mountRuntime(engine)

    const oldRun = runtimeInternals(runtime).run()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledOnce())
    const firstRequest = mocks.marketRelaySync.mock.calls[0][0] as MarketRelayRequest
    const saveId = firstRequest.saveId
    const expectedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('https://game.example.test|7'))
    const expectedScope = Array.from(new Uint8Array(expectedDigest), byte => byte.toString(16).padStart(2, '0')).join('')
    expect(firstRequest.scope).toBe(expectedScope)
    expect(firstRequest.scope).not.toContain('token-1')

    mocks.preferences = { ...mocks.preferences, session: { ...mocks.preferences.session!, token: 'token-2' } }
    dispatchWindow('whale-cloud-session-change')
    await microtask()
    await microtask()
    expect(firstSignal.aborted).toBe(true)
    finishFirst(responseFor(firstRequest))
    await oldRun

    const newRun = runtimeInternals(runtime).run()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledTimes(2))
    const retried = mocks.marketRelaySync.mock.calls[1][0] as MarketRelayRequest
    expect(retried).toEqual(firstRequest)
    expect(retried.scope).toBe(expectedScope)
    expect(retried.saveId).toBe(saveId)
    await newRun
    expect(applied).toEqual([state])
  })

  it('keeps failed request id and payload for retry on the next market refresh', async () => {
    const { engine, state } = makeHarness()
    mocks.marketRelaySync.mockRejectedValueOnce(new Error('network'))
      .mockImplementationOnce((request: MarketRelayRequest) => Promise.resolve(responseFor(request)))
    const runtime = await mountRuntime(engine)

    await runtimeInternals(runtime).run()
    const firstRequest = mocks.marketRelaySync.mock.calls[0][0] as MarketRelayRequest
    state.market.lastTickGameMs = 60_000
    for (const listener of [...engine.subscribe.mock.calls.map(([listener]) => listener)]) listener()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledTimes(2))

    const retry = mocks.marketRelaySync.mock.calls[1][0] as MarketRelayRequest
    expect(retry).toEqual(firstRequest)
    expect(retry.requestId).toBe(firstRequest.requestId)
    expect(retry.saveId).toBe(firstRequest.saveId)
  })

  it('persists applied settlements before sending their acknowledgement', async () => {
    const { engine, state, persisted } = makeHarness()
    mocks.marketRelaySync.mockImplementationOnce((request: MarketRelayRequest) => Promise.resolve(responseFor(request, [{
      settlementId: 'settlement-1', orderId: 'remote-order', goodKey: 'item', side: 'sell', price: 10, qty: 1,
    }])))
      .mockImplementation((request: MarketRelayRequest) => Promise.resolve(responseFor(request)))
    const runtime = await mountRuntime(engine)

    await runtimeInternals(runtime).run()
    expect(state.market.relay?.settlementAcks).toEqual(['settlement-1'])
    expect(persisted).toEqual([state, state])
    expect(mocks.marketRelaySync).toHaveBeenCalledOnce()

    state.market.lastTickGameMs = 60_000
    for (const listener of [...engine.subscribe.mock.calls.map(([listener]) => listener)]) listener()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledTimes(2))
    expect(mocks.marketRelaySync.mock.calls[1][0].settlementAcks).toEqual(['settlement-1'])
    expect(persisted).toHaveLength(4)
  })

  it('does not apply an old response after the engine switches saves', async () => {
    const { engine, state, listeners, applied, persisted } = makeHarness()
    let finish!: (value: MarketRelayResponse) => void
    mocks.marketRelaySync.mockImplementationOnce((request: MarketRelayRequest) => new Promise(resolve => {
      finish = () => resolve(responseFor(request))
    }))
    const runtime = await mountRuntime(engine)
    const cleanup = mountedCleanup[mountedCleanup.length - 1]
    const oldRun = runtimeInternals(runtime).run()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledOnce())

    const nextState = createInitialState({ nowWallMs: 0, seed: 18 })
    engine.state = nextState
    for (const listener of listeners) listener()
    cleanup()
    finish(responseFor(mocks.marketRelaySync.mock.calls[0][0] as MarketRelayRequest))
    await oldRun

    expect(applied).not.toContain(state)
    expect(persisted.every(candidate => candidate !== nextState)).toBe(true)
  })

  it('can remount after cleanup while an earlier request is still settling', async () => {
    const { engine, state, applied } = makeHarness()
    let finishOld!: (value: MarketRelayResponse) => void
    mocks.marketRelaySync.mockImplementationOnce((request: MarketRelayRequest) => new Promise(resolve => {
      finishOld = () => resolve(responseFor(request))
    })).mockImplementationOnce((request: MarketRelayRequest) => Promise.resolve(responseFor(request)))
    const runtime = new MarketRelayRuntime(engine)
    const cleanup = runtime.mount()
    mountedCleanup.push(cleanup)
    await microtask()
    await microtask()

    const oldRun = runtimeInternals(runtime).run()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledOnce())
    cleanup()
    const remountCleanup = runtime.mount()
    mountedCleanup.push(remountCleanup)
    await microtask()
    await microtask()

    const newRun = runtimeInternals(runtime).run()
    await vi.waitFor(() => expect(mocks.marketRelaySync).toHaveBeenCalledTimes(2))
    finishOld(responseFor(mocks.marketRelaySync.mock.calls[0][0] as MarketRelayRequest))
    await Promise.all([oldRun, newRun])
    expect(applied).toEqual([state])
  })
})
