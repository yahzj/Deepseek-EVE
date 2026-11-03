import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CloudApiError, createCloudApi, normalizeCloudServerURL } from '../../../apps/desktop/src/renderer/src/features/cloud/api'
import { readCloudPreferences, saveCloudServer, saveCloudSession } from '../../../apps/desktop/src/renderer/src/features/cloud/preferences'
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
    await expect(createCloudApi({ server: 'https://cloud.example', fetchImpl }).saveVersion(1))
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

  it('defaults only absent configuration to loopback and preserves explicit configured servers', async () => {
    vi.resetModules()
    const preferences = await import('../../../apps/desktop/src/renderer/src/features/cloud/preferences')
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    expect(preferences.DEFAULT_CLOUD_SERVER).toBe('http://123.207.188.192')
    expect(preferences.FALLBACK_CLOUD_SERVER).toBe('https://shit.fuckrapper.online')
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

  it.each(['apps/desktop/src/renderer/index.html', 'web/index.html'])('only expands connect-src in %s', path => {
    const html = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    const csp = html.match(/content="(default-src [^"]+)"/)![1]!
    const directives = csp.split(';').map(value => value.trim())
    expect(directives.slice(0, -1)).toEqual([
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "media-src 'self' blob:",
    ])
    expect(directives.at(-1)?.split(' ')).toEqual([
      'connect-src', "'self'", ...(path.startsWith('apps/') ? ['ws:'] : []),
      'https:', 'http://123.207.188.192', 'http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*',
    ])
  })
})
