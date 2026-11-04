import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudApiError } from '../../../apps/desktop/src/renderer/src/features/cloud/api'
import type { CloudChatHistory, CloudChatMessage } from '../../../apps/desktop/src/renderer/src/features/cloud/api'
import type { CloudPreferences } from '../../../apps/desktop/src/renderer/src/features/cloud/preferences'
import { runSaveModule } from './helpers/save-shell'

type Channel = 'zh' | 'en'
interface Message { id: number | null; clientId?: string; text: string; own: boolean; delivery?: string }
interface View {
  activate(): void
  authenticated: boolean
  channel: Channel
  draft: string
  dismiss(id: string): void
  hasMore: boolean
  historyLoaded: boolean
  historyLoading: boolean
  olderLoading: boolean
  locale: string
  messages: Message[]
  onlineCount: number | null
  retry(id: string, text: string): void
  selectChannel(channel: Channel): void
  send(text: string): boolean
  setDraft(text: string): void
  session: CloudPreferences['session']
  loadOlder(): Promise<void>
}

const account = { playerId: 7, username: 'pilot', nickname: 'Pilot', token: 'first-token' }
const otherAccount = { playerId: 8, username: 'other', nickname: 'Other', token: 'second-token' }
const row = (id: number, text = `message-${id}`, nickname = 'Remote'): CloudChatMessage => ({ id, text, nickname, created_at: id * 1000 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class Events {
  listeners = new Map<string, Set<(event: any) => void>>()
  addEventListener = (name: string, callback: (event: any) => void) => {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(callback)
  }
  removeEventListener = (name: string, callback: (event: any) => void) => { this.listeners.get(name)?.delete(callback) }
  emit(name: string, event: unknown = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event) }
  count() { return [...this.listeners.values()].reduce((count, values) => count + values.size, 0) }
}

// 只替换 React 调度器和浏览器/网络边界，运行真实 hook 与真实队列，不引入 DOM 类型或环境。
function fixture() {
  type Slot = { value?: any; deps?: unknown[]; cleanup?: () => void; effect?: () => (() => void) | undefined }
  const slots: Slot[] = []
  let index = 0
  let dirty = false
  let effects: Array<() => void> = []
  let mounted = true
  const same = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, at) => Object.is(value, b[at]))
  const hooks = {
    useState(initial: any) {
      const at = index++
      if (!slots[at]) slots[at] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[at]!.value, (next: any) => {
        const value = typeof next === 'function' ? next(slots[at]!.value) : next
        if (!Object.is(value, slots[at]!.value)) { slots[at]!.value = value; dirty = true }
      }]
    },
    useRef(value: unknown) {
      const at = index++
      if (!slots[at]) slots[at] = { value: { current: value } }
      return slots[at]!.value
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const at = index++
      if (same(slots[at]?.deps, deps)) return
      const old = slots[at]
      slots[at] = { deps, effect }
      effects.push(() => { old?.cleanup?.(); slots[at]!.cleanup = effect() })
    },
  }
  const window = new Events()
  const document = Object.assign(new Events(), { visibilityState: 'visible' })
  let preferences: CloudPreferences = { server: 'https://chat.example', session: account }
  let storagePreferences = preferences
  const refresh = vi.fn((_key?: string | null) => { preferences = storagePreferences; return preferences })
  const saveSession = vi.fn((server: string, session: CloudPreferences['session']) => {
    preferences = { server, session }
    window.emit('session-change')
  })
  const api = {
    profile: vi.fn(async (_signal?: AbortSignal) => account),
    chatHistory: vi.fn(async (channel: Channel, _limit?: number, _before?: number, _signal?: AbortSignal): Promise<CloudChatHistory> => ({ channel, messages: [], nextBeforeId: null })),
  }
  const factory = vi.fn((_options: { server: string; token: string }) => api)
  const sockets: Socket[] = []
  class Socket {
    static OPEN = 1
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    frames: Array<Record<string, any>> = []
    send = vi.fn((text: string) => { this.frames.push(JSON.parse(text)) })
    close = vi.fn(() => { this.readyState = 3 })
    constructor(readonly url: string) { sockets.push(this) }
    open() { this.readyState = 1; this.onopen?.() }
    receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
    hello(online = ['Pilot']) { this.open(); this.receive({ type: 'hello', nickname: 'Pilot', online, channels: ['zh', 'en'] }) }
    disconnect() { this.readyState = 3; this.onclose?.() }
    batches() { return this.frames.filter(frame => frame.type === 'batch') }
  }
  const toast = vi.fn()
  const module = runSaveModule<{ useOnlineChat(locale: string, onToast: (text: string, warn?: boolean) => void): View }>('apps/desktop/src/renderer/src/features/cloud/useOnlineChat.ts', {
    react: hooks,
    './api': { CloudApiError, createCloudApi: factory, cloudChatSocketUrl: (server: string, token: string) => `${server.replace('https:', 'wss:')}/api/chat/ws?token=${token}` },
    './preferences': { CLOUD_SESSION_CHANGE_EVENT: 'session-change', readCloudPreferences: () => preferences, refreshCloudPreferences: refresh, saveCloudSession: saveSession },
    '../../i18n/locale': { futureTr: (id: string) => id },
  }, { window, document, WebSocket: Socket, AbortController, setTimeout, clearTimeout, Date, crypto: { randomUUID } })
  let view!: View
  function render() {
    index = 0; dirty = false; effects = []
    view = module.useOnlineChat('zh', toast)
    for (const effect of effects) effect()
  }
  async function flush() { for (let tick = 0; tick < 40; tick++) { await Promise.resolve(); if (dirty && mounted) render() } }
  async function advance(ms: number) { await vi.advanceTimersByTimeAsync(ms); await flush() }
  async function start() { view.activate(); await flush(); sockets.at(-1)!.hello(); await flush(); return sockets.at(-1)! }
  function unmount() { if (!mounted) return; mounted = false; for (const slot of slots) slot.cleanup?.() }
  render()
  const f = { api, factory, saveSession, refresh, sockets, window, document, toast, render, flush, advance, start, unmount, view: () => view,
    replayEffects() { for (const slot of slots) slot.cleanup?.(); for (const slot of slots) if (slot.effect) slot.cleanup = slot.effect() },
    change(session: CloudPreferences['session'], server = preferences.server) { preferences = { server, session }; window.emit('session-change') },
    storage(session: CloudPreferences['session'], key: string | null) { storagePreferences = { ...preferences, session }; window.emit('storage', { key }) },
    visible(visible: boolean) { document.visibilityState = visible ? 'visible' : 'hidden'; document.emit('visibilitychange') },
  }
  cleanups.push(unmount)
  return f
}

const cleanups: Array<() => void> = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000) })
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('actual online chat transport lifecycle', () => {
  it('uses null for unknown counts, prefers explicit count and falls back to distinct legacy online names', async () => {
    const f = fixture(); await f.flush()
    expect(f.view().onlineCount).toBeNull()
    f.view().activate(); await f.flush()
    let ws = f.sockets.at(-1)!
    ws.hello(['same', 'same', 'other']); await f.flush()
    expect(f.view().onlineCount).toBe(2)
    ws.disconnect(); await f.flush(); expect(f.view().onlineCount).toBeNull()
    await f.advance(1000); ws = f.sockets.at(-1)!; ws.open()
    ws.receive({ type: 'hello', onlineCount: 7, nickname: 'Pilot', online: ['Pilot'], channels: ['zh', 'en'] }); await f.flush()
    expect(f.view().onlineCount).toBe(7)
    f.change(null); await f.flush(); expect(f.view().onlineCount).toBeNull()
  })

  it('is lazy, holds one App connection across navigation and uses account-aggregated counts only', async () => {
    const f = fixture(); await f.flush()
    expect(f.api.profile).not.toHaveBeenCalled()
    const ws = await f.start()
    f.view().activate(); f.render(); f.view().selectChannel('en'); await f.flush()
    expect(f.sockets).toHaveLength(1)
    expect(f.api.profile).toHaveBeenCalledTimes(1)
    ws.receive({ type: 'hello', nickname: 'Pilot', online: ['duplicate', 'duplicate'], channels: ['zh', 'en'] })
    ws.receive({ type: 'presence', event: 'join', nickname: 'Remote', onlineCount: 9 }); await f.flush()
    expect(f.view().onlineCount).toBe(9)
    expect(f.view().messages).toEqual([])
    expect(f.toast).not.toHaveBeenCalled()
    expect(Object.keys(f.view()).sort()).toEqual(['activate', 'authenticated', 'channel', 'draft', 'dismiss', 'hasMore', 'historyLoaded', 'historyLoading', 'olderLoading', 'locale', 'messages', 'onlineCount', 'retry', 'selectChannel', 'send', 'setDraft', 'session', 'loadOlder'].sort())
  })

  it('keeps a healthy background connection and verifies/pings before resuming in foreground', async () => {
    const f = fixture(); const ws = await f.start()
    f.visible(false); await f.advance(90_000)
    expect(ws.close).not.toHaveBeenCalled()
    f.visible(true); await f.flush()
    expect(f.api.profile).toHaveBeenCalledTimes(2)
    expect(ws.frames).toEqual([{ type: 'ping' }])
    expect(f.sockets).toHaveLength(1)
    ws.receive({ type: 'pong' }); await f.flush()
    await f.advance(8000)
    expect(ws.close).not.toHaveBeenCalled()
    expect(f.toast).not.toHaveBeenCalled()
  })

  it('detects a half-open connection with pong timeout and reconnects without clearing login', async () => {
    const f = fixture(); const ws = await f.start()
    f.visible(false); f.visible(true); await f.flush()
    await f.advance(7999); expect(ws.close).not.toHaveBeenCalled()
    await f.advance(1); expect(ws.close).toHaveBeenCalledTimes(1)
    await f.advance(1000); expect(f.sockets).toHaveLength(2)
    expect(f.saveSession).not.toHaveBeenCalled()
  })

  it('does not fail a healthy socket when a foreground check is suspended by another background transition', async () => {
    const f = fixture(); const ws = await f.start()
    const pending = deferred<typeof account>()
    f.api.profile.mockReturnValueOnce(pending.promise)
    f.visible(false); f.visible(true); await f.flush()
    const signal = f.api.profile.mock.calls.at(-1)![0]!
    f.visible(false); await f.advance(20_000)
    expect(signal.aborted).toBe(true)
    expect(ws.close).not.toHaveBeenCalled()
    pending.reject(new CloudApiError(401, 'invalid_token', '')); await f.flush()
    expect(f.saveSession).not.toHaveBeenCalled()
    f.visible(true); await f.flush(); ws.receive({ type: 'pong' }); await f.flush()
    expect(f.sockets).toHaveLength(1)
  })

  it('keeps unsent queue and drafts through React effect cleanup/replay without duplicate transport', async () => {
    const f = fixture(); const ws = await f.start()
    f.view().send('not sent'); f.view().setDraft('typing')
    f.replayEffects(); await f.flush()
    expect(ws.close).toHaveBeenCalledTimes(1)
    expect(f.sockets).toHaveLength(2)
    const next = f.sockets.at(-1)!; next.hello(); await f.flush()
    await f.advance(3000)
    expect(next.batches()[0]!.messages).toEqual(['not sent'])
    expect(f.view().draft).toBe('typing')
  })

  it('bounds profile, socket connection and hello waits, ignoring late completion', async () => {
    const f = fixture(); const pending = deferred<typeof account>()
    f.api.profile.mockReturnValueOnce(pending.promise)
    f.view().activate(); await f.flush()
    const signal = f.api.profile.mock.calls[0]![0]!
    await f.advance(10_000); expect(signal.aborted).toBe(true)
    await f.advance(1000); expect(f.sockets).toHaveLength(1)
    pending.resolve(account); await f.flush(); expect(f.sockets).toHaveLength(1)
    const first = f.sockets[0]!
    await f.advance(10_000); expect(first.close).toHaveBeenCalled()
    await f.advance(2000); const second = f.sockets[1]!
    second.open()
    await f.advance(10_000); expect(second.close).toHaveBeenCalled()
    await f.advance(4000); expect(f.sockets).toHaveLength(3)
  })

  it('backs off repeated short connections even when open and hello succeed', async () => {
    const f = fixture(); let ws = await f.start()
    for (const delay of [1000, 2000, 4000, 8000]) {
      ws.disconnect(); await f.advance(delay - 1)
      const count = f.sockets.length
      await f.advance(1); expect(f.sockets).toHaveLength(count + 1)
      ws = f.sockets.at(-1)!; ws.hello(); await f.flush()
    }
  })

  it('clears login only on 401 and preserves session on network failure', async () => {
    const f = fixture()
    f.api.profile.mockRejectedValueOnce(new CloudApiError(0, 'network_error', ''))
    f.view().activate(); await f.flush()
    expect(f.saveSession).not.toHaveBeenCalled()
    f.api.profile.mockRejectedValueOnce(new CloudApiError(401, 'invalid_token', ''))
    await f.advance(1000)
    expect(f.saveSession).toHaveBeenCalledWith('https://chat.example', null)
    expect(f.view().authenticated).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes external storage but does not recreate transport for unchanged session events', async () => {
    const f = fixture(); const ws = await f.start()
    f.window.emit('session-change'); f.storage(account, 'unrelated'); await f.flush()
    expect(f.refresh).toHaveBeenCalledWith('unrelated')
    expect(ws.close).not.toHaveBeenCalled()
    f.storage(otherAccount, null); await f.flush()
    expect(f.refresh).toHaveBeenLastCalledWith(null)
    expect(ws.close).toHaveBeenCalledTimes(1)
    expect(f.sockets).toHaveLength(2)
    expect(f.factory).toHaveBeenLastCalledWith({ server: 'https://chat.example', token: 'second-token' })
  })

  it('isolates old socket callbacks and requests from a new account and cleans unmount', async () => {
    const f = fixture(); const history = deferred<CloudChatHistory>()
    f.api.chatHistory.mockReturnValueOnce(history.promise)
    const ws = await f.start()
    const oldMessage = ws.onmessage!
    const oldClose = ws.onclose!
    const historySignal = f.api.chatHistory.mock.calls[0]![3]!
    f.view().setDraft('old account draft'); f.view().send('queued old account')
    f.change(otherAccount); await f.flush()
    expect(historySignal.aborted).toBe(true)
    oldMessage({ data: JSON.stringify({ type: 'presence', onlineCount: 999 }) }); oldClose()
    history.reject(new CloudApiError(401, 'invalid_token', '')); await f.flush()
    expect(f.saveSession).not.toHaveBeenCalled()
    expect(f.view().draft).toBe('')
    expect(f.view().messages).toEqual([])
    expect(f.view().onlineCount).toBeNull()
    const next = f.sockets.at(-1)!
    f.unmount(); await f.advance(60_000)
    expect(next.close).toHaveBeenCalledTimes(1)
    expect(f.window.count() + f.document.count()).toBe(0)
    expect(f.sockets).toHaveLength(2)
  })
})

describe('actual online chat history and delivery', () => {
  it('deduplicates history/live/echo by database ID and matches only local outbox client IDs', async () => {
    const f = fixture(); const pending = deferred<CloudChatHistory>()
    f.api.chatHistory.mockReturnValueOnce(pending.promise)
    const ws = await f.start()
    f.view().send('mine'); await f.advance(3000)
    const id = ws.batches()[0]!.clientMessageIds[0]
    ws.receive({ type: 'batch', channel: 'zh', nickname: 'Pilot', messages: ['mine'], ids: ['11'], clientMessageIds: [id], ts: 11_000 })
    ws.receive({ type: 'batch', channel: 'zh', nickname: 'Remote', messages: ['other'], ids: ['12'], clientMessageIds: ['foreign-id'], ts: 12_000 })
    ws.receive({ type: 'batch', channel: 'zh', nickname: 'Pilot', messages: ['mine'], ids: ['13'], clientMessageIds: ['foreign-id-2'], ts: 11_001 })
    pending.resolve({ channel: 'zh', messages: [row(11, 'mine', 'Pilot'), row(12, 'other'), row(13, 'mine', 'Pilot')], nextBeforeId: null }); await f.flush()
    ws.receive({ type: 'batch', channel: 'zh', nickname: 'Pilot', messages: ['mine'], ids: ['11'], clientMessageIds: [id], ts: 11_000 }); await f.flush()
    expect(f.view().messages).toHaveLength(3)
    expect(f.view().messages[0]).toMatchObject({ id: 11, own: true, delivery: 'delivered', clientId: id })
    expect(f.view().messages[1]).toMatchObject({ id: 12, own: false })
    expect(f.view().messages[1]).not.toHaveProperty('clientId')
    expect(f.view().messages[2]).toMatchObject({ id: 13, own: false, text: 'mine' })
  })

  it('refreshes both channels after reconnect, pages through a missed gap and preserves older cursor', async () => {
    const f = fixture()
    f.api.chatHistory.mockImplementation(async channel => ({ channel, messages: [row(channel === 'zh' ? 10 : 5)], nextBeforeId: channel === 'zh' ? 10 : 5 }))
    const ws = await f.start()
    expect(f.view().historyLoaded).toBe(true)
    f.api.chatHistory.mockImplementation(async (channel, _limit, before) => {
      if (channel === 'en') return { channel, messages: [row(5), row(8)], nextBeforeId: 5 }
      const range = before === undefined ? [150, 249] : before === 150 ? [50, 149] : [1, 49]
      return { channel, messages: Array.from({ length: range[1]! - range[0]! + 1 }, (_, at) => row(range[0]! + at)), nextBeforeId: before === 50 ? null : range[0]! }
    })
    ws.disconnect(); await f.advance(1000); f.sockets.at(-1)!.hello(); await f.flush()
    expect(f.view().messages.map(message => message.id)).toEqual(Array.from({ length: 249 }, (_, at) => at + 1))
    expect(f.view().hasMore).toBe(true)
    await f.view().loadOlder(); await f.flush()
    expect(f.api.chatHistory).toHaveBeenCalledWith('zh', 100, 10, expect.any(AbortSignal))
    expect(f.api.chatHistory).toHaveBeenCalledWith('zh', 100, 150, expect.any(AbortSignal))
    expect(f.api.chatHistory).toHaveBeenCalledWith('zh', 100, 50, expect.any(AbortSignal))
    f.view().selectChannel('en'); await f.flush()
    expect(f.view().messages.map(message => message.id)).toEqual([5, 8])
    expect(f.view().hasMore).toBe(true)
  })

  it('loads older once for the captured channel and bounds history hangs without clearing session', async () => {
    const f = fixture()
    f.api.chatHistory.mockImplementation(async channel => ({ channel, messages: [row(10)], nextBeforeId: 10 }))
    await f.start()
    const older = deferred<CloudChatHistory>()
    f.api.chatHistory.mockReturnValueOnce(older.promise)
    void f.view().loadOlder(); void f.view().loadOlder(); await f.flush()
    expect(f.api.chatHistory.mock.calls.filter(call => call[2] === 10)).toHaveLength(1)
    f.view().selectChannel('en'); await f.flush()
    await f.advance(10_000)
    expect(f.toast).toHaveBeenCalledWith('ui.chat.027', true)
    expect(f.saveSession).not.toHaveBeenCalled()
    f.view().selectChannel('zh'); await f.flush()
    expect(f.view().olderLoading).toBe(false)
    older.resolve({ channel: 'zh', messages: [row(1)], nextBeforeId: null }); await f.flush()
    expect(f.view().messages.map(message => message.id)).toEqual([10])
  })

  it('does not advance the gap anchor after a partial refresh fails', async () => {
    const f = fixture()
    f.api.chatHistory.mockImplementation(async channel => ({ channel, messages: [row(10)], nextBeforeId: 10 }))
    const ws = await f.start()
    let failGap = true
    f.api.chatHistory.mockImplementation(async (channel, _limit, before) => {
      if (channel === 'en') return { channel, messages: [], nextBeforeId: null }
      if (before === 150 && failGap) throw new CloudApiError(0, 'network_error', '')
      return before === undefined
        ? { channel, messages: [row(150), row(249)], nextBeforeId: 150 }
        : { channel, messages: [row(10), row(90)], nextBeforeId: 10 }
    })
    ws.disconnect(); await f.advance(1000); f.sockets.at(-1)!.hello(); await f.flush()
    expect(f.view().messages.map(message => message.id)).toEqual([10, 150, 249])
    failGap = false
    f.view().selectChannel('zh'); await f.flush()
    expect(f.view().messages.map(message => message.id)).toEqual([10, 90, 150, 249])
    expect(f.api.chatHistory.mock.calls.filter(call => call[0] === 'zh' && call[2] === 150)).toHaveLength(2)
  })

  it('keeps channel drafts, rejects oversize without data loss and pauses pending offline sends', async () => {
    const f = fixture(); const ws = await f.start()
    const long = String.fromCodePoint(0x1f680).repeat(251)
    f.view().setDraft(long); await f.flush()
    expect(f.view().send(long)).toBe(false)
    expect(f.view().draft).toBe(long)
    f.view().selectChannel('en'); f.view().setDraft('English draft'); await f.flush()
    f.view().selectChannel('zh'); await f.flush(); expect(f.view().draft).toBe(long)
    f.view().setDraft('not yet sent'); await f.flush()
    expect(f.view().send('not yet sent')).toBe(true); await f.flush()
    f.view().setDraft('new typing'); ws.disconnect(); await f.advance(1000)
    const next = f.sockets.at(-1)!
    await f.advance(2000); expect(next.batches()).toEqual([])
    next.hello(); await f.flush(); await f.advance(2999); expect(next.batches()).toEqual([])
    await f.advance(1); expect(next.batches()[0]!.messages).toEqual(['not yet sent'])
    expect(f.view().draft).toBe('new typing')
    expect(ws.batches()).toEqual([])
  })

  it('exposes queued delivery for cancellation when send is accepted offline', async () => {
    const f = fixture(); const ws = await f.start()
    ws.disconnect(); await f.flush()
    f.view().setDraft('offline draft'); await f.flush()
    expect(f.view().send(f.view().draft)).toBe(true); await f.flush()
    const queued = f.view().messages[0]!
    expect(queued).toMatchObject({ text: 'offline draft', delivery: 'queued' })
    expect(f.view().draft).toBe('')
    f.view().dismiss(queued.clientId!); await f.flush()
    expect(f.view().messages).toEqual([])
    await f.advance(1000)
    const next = f.sockets.at(-1)!; next.hello(); await f.flush()
    await f.advance(3000)
    expect(next.batches()).toEqual([])
  })

  it('spaces all channel frames by three seconds, limits five and never replays uncertain frames', async () => {
    const f = fixture(); const ws = await f.start()
    for (let at = 0; at < 6; at++) f.view().send(`zh-${at}`)
    f.view().selectChannel('en'); f.view().send('en-1'); await f.advance(2999)
    expect(ws.batches()).toEqual([])
    await f.advance(1); expect(ws.batches()[0]!.messages).toHaveLength(5)
    await f.advance(2999); expect(ws.batches()).toHaveLength(1)
    await f.advance(1); expect(ws.batches()[1]!.messages).toEqual(['zh-5'])
    const uncertainId = ws.batches()[0]!.clientMessageIds[0]
    ws.disconnect(); await f.advance(1000); const next = f.sockets.at(-1)!
    next.hello(); await f.flush()
    f.view().selectChannel('zh'); await f.flush()
    expect(f.view().messages.every(message => message.delivery === 'uncertain')).toBe(true)
    f.view().retry(uncertainId, 'zh-0'); await f.advance(3000)
    expect(next.batches()).toEqual([{ type: 'batch', channel: 'en', messages: ['en-1'], clientMessageIds: expect.any(Array) }])
  })

  it('ignores unknown errors and permits retry after explicit storage_error rejection', async () => {
    const f = fixture(); const ws = await f.start()
    f.view().send('first in-flight'); await f.advance(3000)
    f.view().send('rejected'); await f.advance(3000)
    const id = ws.batches()[1]!.clientMessageIds[0]
    ws.receive({ type: 'error', code: 'internal_error' }); await f.flush()
    expect(f.view().messages.map(message => message.delivery)).toEqual(['sent', 'sent'])
    ws.receive({ type: 'error', code: 'storage_error', clientMessageIds: [id] }); await f.flush()
    expect(f.view().messages.map(message => message.delivery)).toEqual(['sent', 'failed'])
    f.view().setDraft('keep typing'); f.view().retry(id, 'changed by caller'); await f.advance(3000)
    expect(ws.batches()[2]!.messages).toEqual(['rejected'])
    expect(f.view().draft).toBe('keep typing')
  })

  it('keeps explicitly rejected messages and blocks retry while the socket is offline', async () => {
    const f = fixture(); const ws = await f.start()
    f.view().send('rejected'); await f.advance(3000)
    const id = ws.batches()[0]!.clientMessageIds[0]
    ws.receive({ type: 'error', code: 'bad_batch', clientMessageIds: [id] }); await f.flush()
    ws.disconnect(); f.view().retry(id, 'changed by caller'); await f.flush()
    expect(f.view().messages[0]).toMatchObject({ text: 'rejected', delivery: 'failed' })
    expect(f.toast).toHaveBeenCalledWith('ui.chat.023', true)
  })

  it('matches delayed rejection IDs and leaves uncorrelated errors uncertain', async () => {
    const f = fixture(); const ws = await f.start()
    f.view().send('older'); await f.advance(3000)
    f.view().send('newer'); await f.advance(3000)
    const older = ws.batches()[0]!.clientMessageIds[0]
    const newer = ws.batches()[1]!.clientMessageIds[0]
    ws.receive({ type: 'error', code: 'storage_error' }); await f.flush()
    ws.receive({ type: 'error', code: 'storage_error', clientMessageIds: [older, newer] }); await f.flush()
    expect(f.view().messages.map(message => message.delivery)).toEqual(['sent', 'sent'])
    ws.receive({ type: 'error', code: 'storage_error', clientMessageIds: [older] }); await f.flush()
    expect(f.view().messages.map(message => message.delivery)).toEqual(['failed', 'sent'])
    ws.disconnect(); await f.flush()
    expect(f.view().messages.map(message => message.delivery)).toEqual(['failed', 'uncertain'])
  })

  it('marks missing echoes uncertain without replay, including a throwing socket.send', async () => {
    const f = fixture(); await f.start()
    f.view().send('no echo'); await f.advance(3000)
    await f.advance(15_000)
    expect(f.view().messages[0]!.delivery).toBe('uncertain')
    await f.advance(9000); const next = f.sockets.at(-1)!; next.hello(); await f.flush()
    f.view().send('throwing send')
    next.send.mockImplementationOnce(() => { throw new Error('transport failed') })
    await f.advance(3000)
    expect(f.view().messages.at(-1)!.delivery).toBe('uncertain')
    await f.advance(2000); const third = f.sockets.at(-1)!; third.hello(); await f.flush()
    await f.advance(3000); expect(third.batches()).toEqual([])
  })

  it('keeps background missing echoes uncertain, accepts late echoes before pong and does not replay them', async () => {
    const f = fixture(); const ws = await f.start()
    f.view().send('delayed echo'); await f.advance(3000)
    const id = ws.batches()[0]!.clientMessageIds[0]
    f.visible(false); await f.advance(60_000)
    expect(ws.close).not.toHaveBeenCalled()
    expect(f.view().messages[0]!.delivery).toBe('uncertain')
    f.visible(true); await f.flush()
    ws.receive({ type: 'batch', channel: 'zh', nickname: 'Pilot', messages: ['delayed echo'], ids: ['31'], clientMessageIds: [id], ts: 31_000 })
    ws.receive({ type: 'pong' }); await f.flush()
    expect(f.view().messages).toHaveLength(1)
    expect(f.view().messages[0]).toMatchObject({ id: 31, delivery: 'delivered' })
    await f.advance(3000); expect(ws.batches()).toHaveLength(1)
  })
})
