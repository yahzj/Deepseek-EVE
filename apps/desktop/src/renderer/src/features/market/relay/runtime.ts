import type { GameState, MarketRelayRequest, MarketRelayResponse } from '@whale/core'
import type { GameEngine } from '../../../game/engine'
import { createCloudApi, normalizeCloudServerURL } from '../../cloud/api'
import { CLOUD_SESSION_CHANGE_EVENT, readCloudPreferences, refreshCloudPreferences } from '../../cloud/preferences'
import { MarketRelayController } from './controller'

type RelayEngine = Pick<GameEngine, 'state' | 'ctx' | 'subscribe' | 'saveWriteState' | 'persist'> & {
  marketRelayReady(state: GameState): boolean
  marketRelayPending(state: GameState, scope: string): MarketRelayRequest | null
  persistMarketRelay(state: GameState): Promise<boolean>
  prepareMarketRelay(state: GameState, scope: string, ids: { saveId: string; requestId: string; orderId: () => string }): MarketRelayRequest | null
  applyMarketRelay(state: GameState, scope: string, requestId: string, response: MarketRelayResponse): boolean
}

const WINDOW_MS = 60_000

function freezePayload<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezePayload(child)
  }
  return value
}

async function relayScopeOf(server: string, playerId: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${server}|${playerId}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  if (!cryptoApi?.getRandomValues) throw new Error('crypto_unavailable')
  return Array.from(cryptoApi.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('')
}

function idFactory(prefix: string): () => string {
  let sequence = 0
  return () => `${prefix}:${++sequence}:${randomId()}`
}

export class MarketRelayRuntime {
  private readonly controller = new MarketRelayController(async (session, payload, signal) =>
    createCloudApi({ server: session.server, token: session.token }).marketRelaySync(payload, signal))
  private readonly saveIdByState = new WeakMap<GameState, string>()
  private readonly requestId = idFactory('relay-request')
  private readonly orderId = idFactory('relay-order')
  private readonly subscriptions: Array<() => void> = []
  private generation = 0
  private sessionRead = 0
  private mounted = false
  private runSequence = 0
  private activeRun = 0
  private activeIdentity = ''
  private activeScope = ''
  private observedState: GameState | null = null
  private dirtyState: GameState | null = null
  private busy = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastWindow: number | null = null
  private lastTick: number | null = null
  private readonly refresh = () => this.readSession()
  private readonly storage = (event: StorageEvent) => {
    this.readSession(event.key)
  }
  private readonly foreground = () => this.schedule(true)

  constructor(private readonly engine: RelayEngine) {}

  mount(): () => void {
    if (this.mounted) return () => this.unmount()
    this.mounted = true
    this.observedState = this.engine.state
    void this.readSession()
    this.subscriptions.push(this.engine.subscribe(() => this.onEngineChange()))
    window.addEventListener(CLOUD_SESSION_CHANGE_EVENT, this.refresh)
    window.addEventListener('storage', this.storage)
    window.addEventListener('online', this.foreground)
    window.addEventListener('focus', this.foreground)
    document.addEventListener('visibilitychange', this.foreground)
    return () => this.unmount()
  }

  private unmount(): void {
    if (!this.mounted) return
    this.mounted = false
    this.generation++
    this.controller.dispose()
    this.sessionRead++
    this.activeIdentity = ''
    this.activeScope = ''
    this.observedState = null
    this.dirtyState = null
    this.busy = false
    this.activeRun = 0
    this.runSequence++
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe()
    window.removeEventListener(CLOUD_SESSION_CHANGE_EVENT, this.refresh)
    window.removeEventListener('storage', this.storage)
    window.removeEventListener('online', this.foreground)
    window.removeEventListener('focus', this.foreground)
    document.removeEventListener('visibilitychange', this.foreground)
  }

  private async readSession(storageKey?: string | null): Promise<void> {
    const prefs = storageKey === undefined ? readCloudPreferences() : refreshCloudPreferences(storageKey)
    let server = ''
    try {
      server = normalizeCloudServerURL(prefs.server)
    } catch {
      // Invalid server preferences are treated as a signed-out relay session.
    }
    const session = prefs.session
    const read = ++this.sessionRead
    const nextIdentity = server && session?.token && Number.isSafeInteger(session.playerId)
      ? `${server}|${session.playerId}|${session.token}` : ''
    if (nextIdentity !== this.activeIdentity) {
      this.activeIdentity = nextIdentity
      this.activeScope = ''
      this.generation++
      this.controller.setSession(nextIdentity && session ? { server, playerId: session.playerId, token: session.token } : null)
      this.lastWindow = null
      this.lastTick = this.engine.state.market.lastTickGameMs
    }
    if (!nextIdentity || !session || this.activeScope) return
    try {
      const scope = await relayScopeOf(server, session.playerId)
      if (read === this.sessionRead && nextIdentity === this.activeIdentity) this.activeScope = scope
    } catch {
      this.activeScope = ''
    }
    // Session binding never triggers an immediate relay send.
  }

  onEngineChange(): void {
    this.syncEngineState()
    if (!this.mounted || !this.activeIdentity) return
    if (!this.engine.marketRelayReady(this.engine.state)) return
    const tick = this.engine.state.market.lastTickGameMs
    if (tick === this.lastTick) return
    this.lastTick = tick
    const windowId = Math.floor(tick / WINDOW_MS)
    if (this.lastWindow === windowId) return
    this.lastWindow = windowId
    this.schedule(false)
  }

  private schedule(force: boolean): void {
    if (!this.mounted || !this.activeIdentity || this.engine.saveWriteState() !== 'ok') return
    if (!force && document.visibilityState === 'hidden') return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, 0)
  }

  private syncEngineState(): void {
    const state = this.engine.state
    if (this.observedState === state) return
    this.observedState = state
    this.generation++
    this.controller.invalidatePending()
    this.dirtyState = null
    this.lastWindow = null
    this.lastTick = state.market.lastTickGameMs
  }

  private current(state: GameState, generation: number, identity: string): boolean {
    this.syncEngineState()
    return this.mounted && generation === this.generation && identity === this.activeIdentity
      && this.engine.state === state && this.engine.marketRelayReady(state)
  }

  private async persistDirty(state: GameState, generation: number, identity: string): Promise<boolean> {
    if (this.dirtyState !== state || !this.current(state, generation, identity) || this.engine.saveWriteState() !== 'ok') return false
    const ok = await this.engine.persistMarketRelay(state)
    const isCurrent = this.current(state, generation, identity)
    if (ok && isCurrent && this.dirtyState === state) this.dirtyState = null
    return ok && isCurrent
  }

  private async run(): Promise<void> {
    if (this.busy || !this.mounted || !this.activeIdentity) return
    this.syncEngineState()
    const state = this.engine.state
    if (!this.engine.marketRelayReady(state)) return
    if (!this.activeScope) return
    this.busy = true
    const run = ++this.runSequence
    this.activeRun = run
    const generation = this.generation
    const identity = this.activeIdentity
    const scope = this.activeScope
    const windowId = Math.floor(state.market.lastTickGameMs / WINDOW_MS)
    try {
      if (this.dirtyState && !(await this.persistDirty(this.dirtyState, generation, identity))) return
      if (!this.current(state, generation, identity)) return

      let pending = this.engine.marketRelayPending(state, scope)
      if (!pending) {
        const saveId = this.saveIdByState.get(state) ?? state.market.relay?.saveId ?? randomId()
        const prepared = this.engine.prepareMarketRelay(state, scope, { saveId, requestId: this.requestId(), orderId: this.orderId })
        if (!prepared) return
        freezePayload(prepared)
        this.saveIdByState.set(state, prepared.saveId)
        this.dirtyState = state
        if (!(await this.persistDirty(state, generation, identity))) return
        pending = this.engine.marketRelayPending(state, scope)
        if (!pending || pending.requestId !== prepared.requestId || JSON.stringify(pending) !== JSON.stringify(prepared)) return
      } else {
        freezePayload(pending)
      }
      if (!this.current(state, generation, identity)) return
      const result = await this.controller.send(windowId, pending)
      if (result.kind !== 'response' || !this.current(state, generation, identity)) return
      if (!this.engine.applyMarketRelay(state, scope, pending.requestId, result.response)) return
      this.dirtyState = state
      await this.persistDirty(state, generation, identity)
    } finally {
      if (this.activeRun === run) {
        this.activeRun = 0
        this.busy = false
        if (this.mounted && this.engine.state !== state) this.schedule(true)
      }
    }
  }
}
