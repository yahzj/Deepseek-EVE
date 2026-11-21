import type { ExchangeClient } from './client'
import { DEFAULT_CLOUD_SERVER, FALLBACK_CLOUD_SERVER, readCloudPreferences } from '../cloud/preferences'
import { HttpExchangeClient } from './http/HttpExchangeClient'
import { RendererTransport } from './http/RendererTransport'
import { ExchangeOfflineError, NotConnectedTransport, type Transport } from './http/transport'

export type ExchangeAuth = 'account' | 'guest'

export interface ExchangeSourceInfo {
  serverUrl: string
  auth: ExchangeAuth
}

export interface ExchangeClientOptions {
  serverUrl?: string | null
  transport?: Transport
  guest?: boolean
}

export interface ExchangeClientBundle {
  client: ExchangeClient
  source: ExchangeSourceInfo
  error: ExchangeOfflineError | null
}

export function resolveExchangeSource(opts: ExchangeClientOptions = {}): ExchangeSourceInfo {
  const prefs = readCloudPreferences()
  const configured =
    typeof opts.serverUrl === 'string' ? opts.serverUrl.trim() : prefs.server.trim()
  const serverUrl = configured === '' ? DEFAULT_CLOUD_SERVER : configured
  const guest = opts.guest ?? !prefs.session?.token
  return { serverUrl, auth: guest ? 'guest' : 'account' }
}

let sharedHttp: { key: string; client: HttpExchangeClient } | null = null

export function createExchangeClient(opts: ExchangeClientOptions = {}): ExchangeClientBundle {
  const source = resolveExchangeSource(opts)
  const guest = source.auth === 'guest'

  let transport = opts.transport
  if (!transport) {
    try {
      transport = new RendererTransport({
        serverUrl: source.serverUrl,
        fallbackServerUrl: FALLBACK_CLOUD_SERVER,
        allowAnonymous: true,
      })
    } catch (err) {
      return {
        client: new HttpExchangeClient(new NotConnectedTransport(), '/api/exchange', true),
        source,
        error:
          err instanceof ExchangeOfflineError
            ? err
            : new ExchangeOfflineError('交易所服务器地址不可用：请检查云端设置里的服务器地址'),
      }
    }
  }

  const playerId = readCloudPreferences().session?.playerId ?? 'anon'
  const key = `${source.serverUrl}|${source.auth}|${playerId}|${transport.constructor.name}`
  if (sharedHttp === null || sharedHttp.key !== key) {
    sharedHttp?.client.dispose()
    sharedHttp = { key, client: new HttpExchangeClient(transport, '/api/exchange', guest) }
  }
  return { client: sharedHttp.client, source, error: null }
}
