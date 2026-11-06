import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CloudApiError, cloudChatSocketUrl, createCloudApi, normalizeCloudServerURL } from '../../../apps/desktop/src/renderer/src/features/cloud/api'
import { DEFAULT_CLOUD_SERVER, FALLBACK_CLOUD_SERVER, readCloudPreferences, saveCloudServer, saveCloudSession } from '../../../apps/desktop/src/renderer/src/features/cloud/preferences'
import type { CloudStorage } from '../../../apps/desktop/src/renderer/src/features/cloud/preferences'
import type { CloudAuthResponse } from '../../../apps/desktop/src/renderer/src/features/cloud/types'

const profile = { playerId: 7, username: 'pilot', nickname: 'Pilot' }
const auth = { ...profile, token: 'secret-token', recoveryCode: 'ABCD-EFGH' } satisfies CloudAuthResponse
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})
const fetchMock = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response)

class MemoryStorage implements CloudStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
  entries() { return [...this.values.entries()] }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const memoryStorage = new MemoryStorage()

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  memoryStorage.clear()
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  saveCloudServer('')
})

describe('cloud API', () => {
  it('normalizes service origins and rejects an explicitly empty API server', () => {
    expect(normalizeCloudServerURL('')).toBe('')
    expect(normalizeCloudServerURL('  https://CLOUD.example:443/  ')).toBe('https://cloud.example')
    expect(normalizeCloudServerURL('http://[::1]:8787/')).toBe('http://[::1]:8787')
    expect(() => createCloudApi({ server: '' })).toThrow(CloudApiError)
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(() => normalizeCloudServerURL('http://localhost:8787')).toThrowError(expect.objectContaining({ code: 'insecure_server' }))
  })

  it.each([
    'not a URL',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com/?x=1',
    'https://example.com/#fragment',
    'http://example.com',
  ])('rejects unsafe server URL %s before fetch', server => {
    const fetchImpl = vi.fn<typeof fetch>()
    expect(() => createCloudApi({ server, fetchImpl })).toThrow(CloudApiError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787', 'https://cloud.example'])('accepts server %s', server => {
    const fetchImpl = fetchMock(jsonResponse({ version: 0, data: null }))
    return expect(createCloudApi({ server, fetchImpl }).saveLatest()).resolves.toEqual({ version: 0, data: null })
  })

  it('sends bearer auth and never sends credentials to a different configured service', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage })
    saveCloudSession('https://one.example', auth)
    saveCloudServer('https://one.example')
    const sameFetch = fetchMock(jsonResponse(profile))
    await createCloudApi({ server: 'https://one.example', fetchImpl: sameFetch }).profile()
    expect(new Headers(sameFetch.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer secret-token')

    const otherFetch = fetchMock(jsonResponse(profile))
    await createCloudApi({ server: 'https://two.example', fetchImpl: otherFetch }).profile()
    expect(new Headers(otherFetch.mock.calls[0]![1]?.headers).has('authorization')).toBe(false)
  })

  it('uses an explicit token for authenticated requests', async () => {
    const fetchImpl = fetchMock(jsonResponse(profile))
    await createCloudApi({ server: 'https://cloud.example', token: 'explicit', fetchImpl }).profile()
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer explicit')
  })

  it('retries default IP network failures on the fallback without changing the IP session', async () => {
    saveCloudServer(DEFAULT_CLOUD_SERVER)
    saveCloudSession(DEFAULT_CLOUD_SERVER, auth)
    saveCloudSession(FALLBACK_CLOUD_SERVER, { ...auth, token: 'other-token' })
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(jsonResponse(profile))
    await expect(createCloudApi({ server: DEFAULT_CLOUD_SERVER, fetchImpl }).profile()).resolves.toEqual(profile)
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `${DEFAULT_CLOUD_SERVER}/api/profile`, `${FALLBACK_CLOUD_SERVER}/api/profile`,
    ])
    for (const [, init] of fetchImpl.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token')
    }
    expect(readCloudPreferences()).toMatchObject({ server: DEFAULT_CLOUD_SERVER, session: { token: auth.token } })
    expect(new URL(cloudChatSocketUrl(readCloudPreferences().server, readCloudPreferences().session!.token)).toString())
      .toBe('wss://game.bajibaji.party:8443/api/chat/ws?token=secret-token')
  })

  it.each([401, 500])('does not retry a default IP HTTP %i response', async status => {
    const fetchImpl = fetchMock(jsonResponse({ code: 'failure' }, status))
    await expect(createCloudApi({ server: DEFAULT_CLOUD_SERVER, fetchImpl }).profile()).rejects.toMatchObject({ status, code: 'failure' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not retry malformed responses or custom server network failures', async () => {
    const malformed = fetchMock(jsonResponse({ playerId: 'bad' }))
    await expect(createCloudApi({ server: DEFAULT_CLOUD_SERVER, fetchImpl: malformed }).profile()).rejects.toMatchObject({ code: 'malformed_response' })
    expect(malformed).toHaveBeenCalledOnce()
    const network = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'))
    await expect(createCloudApi({ server: 'https://custom.example', fetchImpl: network }).profile()).rejects.toMatchObject({ code: 'network_error' })
    expect(network).toHaveBeenCalledOnce()
  })

  it('retries a default IP timeout but not a caller cancellation', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      }))
      .mockResolvedValueOnce(jsonResponse(profile))
    const pending = createCloudApi({ server: DEFAULT_CLOUD_SERVER, timeoutMs: 15, fetchImpl }).profile()
    await vi.advanceTimersByTimeAsync(15)
    await expect(pending).resolves.toEqual(profile)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const caller = new AbortController()
    const cancelledFetch = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const cancelled = createCloudApi({ server: DEFAULT_CLOUD_SERVER, fetchImpl: cancelledFetch }).profile(caller.signal)
    caller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'timeout' })
    expect(cancelledFetch).toHaveBeenCalledOnce()
  })

  it.each(['login', 'signup'] as const)('isolates %s credentials from redirects, cookies, cache and referrers', async method => {
    const fetchImpl = fetchMock(jsonResponse(auth))
    await createCloudApi({ server: 'https://cloud.example', fetchImpl })[method]('pilot', 'private-password')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ username: 'pilot', password: 'private-password' })
  })

  it.each([307, 308])('does not retry a redirected login (%i)', async status => {
    const fetchImpl = fetchMock(new Response(null, { status, headers: { location: 'https://other.example' } }))
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl }).login('pilot', 'private-password'))
      .rejects.toMatchObject({ status, code: 'request_failed' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([401, 409, 429])('maps HTTP %i errors without exposing server message', async status => {
    const fetchImpl = fetchMock(jsonResponse({ code: 'save_conflict', message: 'sensitive remote text', password: 'secret' }, status))
    const error = await createCloudApi({ server: 'https://cloud.example', fetchImpl }).saveLatest().catch(reason => reason)
    expect(error).toBeInstanceOf(CloudApiError)
    expect(error).toMatchObject({ status, code: 'save_conflict', message: 'save_conflict' })
    expect(String(error)).not.toContain('sensitive remote text')
    expect(JSON.stringify(error)).not.toContain('secret')
  })

  it.each([
    { body: { retryAfterMs: 1200 }, header: '9', expected: 1200 },
    { body: {}, header: '9', expected: 9000 },
    { body: { retryAfterMs: -1 }, header: 'bad', expected: undefined },
    { body: { retryAfterMs: 'password' }, header: '-5', expected: undefined },
    { body: { retryAfterMs: Number.MAX_SAFE_INTEGER + 1 }, header: '99999999999999999999', expected: undefined },
  ])('only exposes safe numeric retry delays: $expected', async ({ body, header, expected }) => {
    const response = jsonResponse({ code: 'rate_limited', message: 'private-password', password: 'private-password', ...body }, 429)
    response.headers.set('Retry-After', header)
    const error = await createCloudApi({ server: 'https://cloud.example', fetchImpl: fetchMock(response) })
      .login('pilot', 'private-password').catch(reason => reason)
    expect(error.extra?.retryAfterMs).toBe(expected)
    expect(JSON.stringify(error)).not.toContain('private-password')
  })

  it('converts an HTTP-date Retry-After to milliseconds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 3))
    const response = jsonResponse({ code: 'rate_limited' }, 429)
    response.headers.set('Retry-After', new Date(Date.UTC(2026, 10, 3, 0, 0, 3)).toUTCString())
    try {
      await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: fetchMock(response) }).profile())
        .rejects.toMatchObject({ extra: { retryAfterMs: 3000 } })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('maps fetch abort to timeout and preserves caller abort signal', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const pending = createCloudApi({ server: 'https://cloud.example', timeoutMs: 15, fetchImpl }).saveLatest()
      .then(() => null, error => error)
    await vi.advanceTimersByTimeAsync(15)
    await expect(pending).resolves.toMatchObject({ code: 'timeout' })

    vi.useRealTimers()
    const caller = new AbortController()
    const pendingCaller = createCloudApi({ server: 'https://cloud.example', fetchImpl }).saveLatest(caller.signal)
    caller.abort()
    await expect(pendingCaller).rejects.toMatchObject({ code: 'timeout' })
  })

  it('rejects malformed JSON and malformed success payloads', async () => {
    const malformedJson = vi.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 200 }))
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: malformedJson }).profile())
      .rejects.toMatchObject({ code: 'malformed_response' })
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: fetchMock(jsonResponse({ playerId: '7' })) }).profile())
      .rejects.toMatchObject({ code: 'malformed_response' })
  })

  it('always sends a valid non-negative baseVersion and checks save string type', async () => {
    const fetchImpl = fetchMock(jsonResponse({ version: 2, size: 12 }))
    const api = createCloudApi({ server: 'https://cloud.example', fetchImpl })
    await expect(api.uploadSave('{}', 1)).resolves.toEqual({ version: 2, size: 12 })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ data: '{}', baseVersion: 1 })
    expect(() => api.uploadSave('{}', -1)).toThrowError(expect.objectContaining({ code: 'invalid_base_version' }))
    expect(() => api.uploadSave('{}', 1.5)).toThrowError(expect.objectContaining({ code: 'invalid_base_version' }))
    expect(() => api.uploadSave({} as unknown as string, 1)).toThrowError(expect.objectContaining({ code: 'save_too_large' }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('builds the authenticated WSS chat URL and loads paginated chat history', async () => {
    expect(cloudChatSocketUrl('https://shit.fuckrapper.online', 'token with space'))
      .toBe('wss://shit.fuckrapper.online/api/chat/ws?token=token+with+space')
    const fetchImpl = fetchMock(jsonResponse({
      channel: 'zh',
      messages: [{ id: 8, nickname: 'Pilot', text: 'Hello', created_at: 1234 }],
      nextBeforeId: 8,
    }))
    const api = createCloudApi({ server: 'https://shit.fuckrapper.online', token: 'session-token', fetchImpl })
    await expect(api.chatHistory('zh', 100, 10)).resolves.toEqual({
      channel: 'zh',
      messages: [{ id: 8, nickname: 'Pilot', text: 'Hello', created_at: 1234 }],
      nextBeforeId: 8,
    })
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://shit.fuckrapper.online/api/chat/history?channel=zh&limit=100&beforeId=10')
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer session-token')
  })

  it('maps the default HTTPS socket to WSS and preserves loopback behavior', () => {
    expect(cloudChatSocketUrl(`${DEFAULT_CLOUD_SERVER}/`, 'ip&token'))
      .toBe('wss://game.bajibaji.party:8443/api/chat/ws?token=ip%26token')
    expect(cloudChatSocketUrl('http://127.0.0.1:8787', 'local'))
      .toBe('ws://127.0.0.1:8787/api/chat/ws?token=local')
    expect(cloudChatSocketUrl('http://[::1]:8787', 'local'))
      .toBe('ws://[::1]:8787/api/chat/ws?token=local')
    expect(() => cloudChatSocketUrl('http://123.207.188.193', 'token'))
      .toThrowError(expect.objectContaining({ code: 'insecure_server' }))
  })

  it.each([false, true])('bounds chat history on the primary and fallback attempt (fallback: %s)', async fallback => {
    const cancel = vi.fn()
    const chunk = new Uint8Array(512 * 1024 + 1).fill(32)
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(chunk) }, cancel }))
    const fetchImpl = vi.fn<typeof fetch>()
    if (fallback) fetchImpl.mockRejectedValueOnce(new TypeError('network'))
    fetchImpl.mockResolvedValueOnce(response)
    const error = await createCloudApi({ server: DEFAULT_CLOUD_SERVER, fetchImpl }).chatHistory('zh').catch(reason => reason)
    expect(error.code).toBe(fallback ? 'network_error' : 'response_too_large')
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledTimes(fallback ? 2 : 1)
  })

  it('rejects invalid chat cursors before any request and keeps token encoding inside the socket query', () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const api = createCloudApi({ server: 'https://cloud.example', fetchImpl })
    for (const limit of [0, -1, 1.5, 101]) {
      expect(() => api.chatHistory('zh', limit)).toThrowError(expect.objectContaining({ code: 'invalid_chat_cursor' }))
    }
    for (const cursor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => api.chatHistory('en', 100, cursor)).toThrowError(expect.objectContaining({ code: 'invalid_chat_cursor' }))
    }
    expect(() => cloudChatSocketUrl('https://cloud.example', '')).toThrowError(expect.objectContaining({ code: 'missing_token' }))
    const url = new URL(cloudChatSocketUrl('https://cloud.example', 'a&channel=en#private'))
    expect(url.pathname).toBe('/api/chat/ws')
    expect(url.searchParams.get('token')).toBe('a&channel=en#private')
    expect(url.searchParams.get('channel')).toBeNull()
    expect(url.hash).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    { channel: 'en', messages: [], nextBeforeId: null },
    { channel: 'zh', messages: [{ id: 0, nickname: 'Pilot', text: 'x', created_at: 1 }], nextBeforeId: null },
    { channel: 'zh', messages: [{ id: 1, nickname: 'Pilot', text: 'x'.repeat(501), created_at: 1 }], nextBeforeId: null },
    { channel: 'zh', messages: [], nextBeforeId: -1 },
  ])('rejects malformed chat history', async (body) => {
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: fetchMock(jsonResponse(body)) }).chatHistory('zh'))
      .rejects.toMatchObject({ code: 'malformed_response' })
  })

  it('accepts a 10 MiB decoded save even with sixfold JSON escaping', async () => {
    const data = '\u0000'.repeat(10 * 1024 * 1024)
    const fetchImpl = fetchMock(jsonResponse({ version: 1, data }))
    const result = await createCloudApi({ server: 'https://cloud.example', fetchImpl }).saveLatest()
    expect(result.data?.length).toBe(data.length)
    expect(result.data).toBe(data)
    const upload = fetchMock(jsonResponse({ version: 2, size: data.length }))
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: upload }).uploadSave(data, 1))
      .resolves.toEqual({ version: 2, size: data.length })
    expect(JSON.parse(String(upload.mock.calls[0]![1]?.body)).baseVersion).toBe(1)
  }, 15_000)

  it('rejects decoded UTF-8 saves over 10 MiB on download and upload', async () => {
    const data = '\u00e9'.repeat(5 * 1024 * 1024) + 'x'
    const fetchImpl = fetchMock(jsonResponse({ version: 1, data }))
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl }).saveLatest())
      .rejects.toMatchObject({ code: 'malformed_response' })
    const upload = vi.fn<typeof fetch>()
    expect(() => createCloudApi({ server: 'https://cloud.example', fetchImpl: upload }).uploadSave(data, 0))
      .toThrowError(expect.objectContaining({ code: 'save_too_large' }))
    expect(upload).not.toHaveBeenCalled()
  })

  it.each([{ version: 0, data: '' }, { version: 0, data: '{}' }, { version: 1, data: null }, { version: 1, data: '' }])
  ('rejects inconsistent save version/data $version/$data', async body => {
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: fetchMock(jsonResponse(body)) }).saveLatest())
      .rejects.toMatchObject({ code: 'malformed_response' })
  })

  it('cancels a stream that exceeds the raw envelope limit', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32)
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(chunk) }, cancel }))
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl: fetchMock(response) }).saveLatest())
      .rejects.toMatchObject({ code: 'response_too_large' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not persist a recovery code and generates a valid transient device code', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage })
    const fetchImpl = fetchMock(jsonResponse({ token: 'new-token', playerId: 9, nickname: 'Recovered', recovered: true }))
    const recovered = await createCloudApi({ server: 'https://cloud.example', fetchImpl }).redeemRecovery('one-time-code')
    expect(recovered).toMatchObject({ playerId: 9, username: null })
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as Record<string, string>
    expect(sent.recoveryCode).toBe('one-time-code')
    expect(sent.deviceCode).toMatch(/^[a-f0-9]{48}$/)
    expect(readCloudPreferences().session).toBeNull()
    expect(memoryStorage.entries().map(([, value]) => value).join()).not.toContain('one-time-code')
    expect(memoryStorage.entries().map(([, value]) => value).join()).not.toContain(sent.deviceCode)
  })

  it('strips recovery codes before persisting a session', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage })
    saveCloudServer('https://cloud.example')
    saveCloudSession('https://cloud.example', auth)
    const stored = memoryStorage.entries().map(([, value]) => value).join()
    expect(stored).toContain('secret-token')
    expect(stored).not.toContain('ABCD-EFGH')
    expect(readCloudPreferences().session).not.toHaveProperty('recoveryCode')
  })

  it('keeps session clears and server switches authoritative with readonly storage', async () => {
    vi.resetModules()
    const preferences = await import('../../../apps/desktop/src/renderer/src/features/cloud/preferences')
    const values = new Map([
      ['whale.cloud.server', 'https://readonly.example'],
      ['whale.cloud.session:https://readonly.example', JSON.stringify(auth)],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => { throw new Error('readonly') },
      removeItem: () => { throw new Error('readonly') },
    })
    expect(preferences.readCloudPreferences().session?.token).toBe(auth.token)
    preferences.saveCloudSession('https://readonly.example', null)
    expect(preferences.readCloudPreferences().session).toBeNull()
    preferences.saveCloudServer('https://new.example')
    preferences.saveCloudSession('https://new.example', { ...auth, token: 'new-token' })
    expect(preferences.readCloudPreferences()).toMatchObject({ server: 'https://new.example', session: { token: 'new-token' } })
    preferences.saveCloudServer('https://readonly.example')
    expect(preferences.readCloudPreferences().session).toBeNull()
    preferences.saveCloudServer('')
    expect(preferences.readCloudPreferences()).toEqual({ server: '', session: null })
    expect(values.get('whale.cloud.server')).toBe('https://readonly.example')
  })

  it('refreshes cached credentials only for a matching cross-window storage event', async () => {
    vi.resetModules()
    const preferences = await import('../../../apps/desktop/src/renderer/src/features/cloud/preferences')
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    preferences.saveCloudServer('https://cross-window.example')
    preferences.saveCloudSession('https://cross-window.example', auth)
    const key = 'whale.cloud.session:https://cross-window.example'
    values.delete(key)
    expect(preferences.readCloudPreferences().session?.token).toBe(auth.token)
    expect(preferences.refreshCloudPreferences('unrelated').session?.token).toBe(auth.token)
    expect(preferences.refreshCloudPreferences(key).session).toBeNull()
    values.set('whale.cloud.server', 'https://other-window.example')
    expect(preferences.refreshCloudPreferences('whale.cloud.server').server).toBe('https://other-window.example')
  })

  it('notifies same-window consumers with no credential payload even when storage is unavailable', async () => {
    vi.resetModules()
    const preferences = await import('../../../apps/desktop/src/renderer/src/features/cloud/preferences')
    vi.stubGlobal('localStorage', undefined)
    const dispatch = vi.fn(() => true)
    vi.stubGlobal('dispatchEvent', dispatch)
    preferences.saveCloudServer('https://memory-only.example')
    preferences.saveCloudSession('https://memory-only.example', auth)
    preferences.saveCloudSession('https://memory-only.example', null)
    expect(dispatch).toHaveBeenCalledTimes(3)
    for (const [event] of dispatch.mock.calls as unknown as Array<[Event]>) {
      expect(event.type).toBe(preferences.CLOUD_SESSION_CHANGE_EVENT)
      expect(JSON.stringify(event)).not.toContain(auth.token)
    }
    expect(preferences.readCloudPreferences().session).toBeNull()
  })

  it('defaults only absent configuration to the default server and preserves explicit configured servers', async () => {
    vi.resetModules()
    const preferences = await import('../../../apps/desktop/src/renderer/src/features/cloud/preferences')
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    expect(preferences.DEFAULT_CLOUD_SERVER).toBe('https://game.bajibaji.party:8443')
    expect(preferences.FALLBACK_CLOUD_SERVER).toBe('http://123.207.188.192')
    expect(preferences.readCloudPreferences()).toEqual({ server: preferences.DEFAULT_CLOUD_SERVER, session: null })
    values.set('whale.cloud.server', 'https://configured.example')
    expect(preferences.readCloudPreferences().server).toBe('https://configured.example')
    values.set('whale.cloud.server', '')
    expect(preferences.readCloudPreferences().server).toBe('')
    preferences.saveCloudServer('http://127.0.0.1:34567')
    preferences.saveCloudSession('http://127.0.0.1:34567', auth)
    expect(preferences.readCloudPreferences()).toMatchObject({ server: 'http://127.0.0.1:34567', session: { token: auth.token } })
    preferences.saveCloudServer('http://127.0.0.1:34568')
    expect(preferences.readCloudPreferences().session).toBeNull()
  })

  it.each(['apps/desktop/src/renderer/index.html', 'web/index.html'])('allows only the cloud host and loopback in %s', path => {
    const html = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const csp = html.match(/content="(default-src [^"]+)"/)![1]!
    const directives = csp.split(';').map(value => value.trim())
    expect(directives.slice(0, -1)).toEqual([
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "media-src 'self' blob:",
    ])
    const connect = directives.at(-1)?.split(' ') ?? []
    expect(connect).toContain('https:')
    if (path.startsWith('apps/')) expect(connect).toContain('ws:')
    else expect(connect).not.toContain('ws:')
    expect(connect).toContain('wss://game.bajibaji.party:8443')
    expect(connect).toContain('http://123.207.188.192')
    expect(connect).toContain(DEFAULT_CLOUD_SERVER)
    expect(connect.some(value => value === 'https:' || value === FALLBACK_CLOUD_SERVER)).toBe(true)
    expect(connect.some(value => value === 'wss:' || value === FALLBACK_CLOUD_SERVER.replace('https:', 'wss:'))).toBe(true)
    // IPv6 通配不是合法 CSP source（383f1ac9 已从桌面 HTML 移除）；网页版仍有历史遗留，测试不强制要求。
    expect(connect).toEqual(expect.arrayContaining(['connect-src', "'self'", 'http://localhost:*', 'http://127.0.0.1:*']))
    expect(connect.includes('ws:') || ['ws://localhost:*', 'ws://127.0.0.1:*', 'ws://[::1]:*'].every(value => connect.includes(value))).toBe(true)
  })
})
