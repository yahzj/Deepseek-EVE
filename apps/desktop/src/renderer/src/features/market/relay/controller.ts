import type { MarketRelayRequest, MarketRelayResponse } from '@whale/core'
import { marketRelayJsonWithinLimit, marketRelayRequestShape, marketRelayResponseShape } from './protocol'

export interface MarketRelaySession {
  server: string
  playerId: number
  token: string
}

export type MarketRelayTransport = (session: MarketRelaySession, request: MarketRelayRequest, signal: AbortSignal) => Promise<unknown>

export type MarketRelayResult =
  | { kind: 'response'; response: MarketRelayResponse }
  | { kind: 'invalid' | 'blocked' | 'stale' | 'failed' }

function freezePayload<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezePayload(child)
  }
  return value
}

/** 窗口失败后仍记作已尝试；仅下一个市场窗口可重试，调用方负责落盘与状态应用。 */
export class MarketRelayController {
  private session: MarketRelaySession | null = null
  private generation = 0
  private abort: AbortController | null = null
  private attemptedWindow: number | null = null
  private blockedToken: string | null = null

  constructor(private readonly transport: MarketRelayTransport) {}

  setSession(session: MarketRelaySession | null): void {
    const previous = this.session
    if (previous?.server === session?.server && previous?.playerId === session?.playerId && previous?.token === session?.token) return
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.session = session ? { ...session } : null
    this.attemptedWindow = null
    if (previous?.token !== session?.token) this.blockedToken = null
  }

  invalidatePending(): void {
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.attemptedWindow = null
  }

  async send(windowId: number, request: MarketRelayRequest): Promise<MarketRelayResult> {
    const session = this.session
    if (!session || !session.server.trim() || !session.token.trim() || !Number.isSafeInteger(session.playerId) || session.playerId <= 0
      || !Number.isSafeInteger(windowId)) return { kind: 'blocked' }
    if (!marketRelayRequestShape(request) || !marketRelayJsonWithinLimit(request)) return { kind: 'invalid' }
    if (this.abort || this.attemptedWindow === windowId || this.blockedToken === session.token) return { kind: 'blocked' }
    const payload = freezePayload(structuredClone(request))
    this.attemptedWindow = windowId
    const generation = this.generation
    const controller = new AbortController()
    this.abort = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      timer = setTimeout(() => controller.abort(), 15_000)
    })
    try {
      const response = await Promise.race([this.transport(session, payload, controller.signal), cancelled])
      if (generation !== this.generation) return { kind: 'stale' }
      if (!marketRelayJsonWithinLimit(response) || !marketRelayResponseShape(response, payload)) return { kind: 'invalid' }
      return { kind: 'response', response }
    } catch (error) {
      if (generation !== this.generation) return { kind: 'stale' }
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
      if (status === 401) this.blockedToken = session.token
      return { kind: 'failed' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (this.abort === controller) this.abort = null
    }
  }

  dispose(): void { this.setSession(null) }
}
