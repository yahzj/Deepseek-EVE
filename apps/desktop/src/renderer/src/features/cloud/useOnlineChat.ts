import { useEffect, useRef, useState } from 'react'
import { CloudApiError, cloudChatSocketUrl, createCloudApi } from './api'
import type { CloudChatHistory } from './api'
import { CLOUD_SESSION_CHANGE_EVENT, readCloudPreferences, refreshCloudPreferences, saveCloudSession } from './preferences'
import type { CloudPreferences } from './preferences'
import { createChatQueue } from './chatQueue'
import type { QueuedChatMessage } from './chatQueue'
import type { Locale } from '../../i18n/locale'
import { futureTr } from '../../i18n/locale'

type Channel = 'zh' | 'en'
type Delivery = 'queued' | 'sent' | 'uncertain' | 'failed' | 'delivered'
type Timer = ReturnType<typeof setTimeout>

export interface OnlineChatMessage {
  id: number | null
  clientId?: string
  nickname: string
  text: string
  ts: number
  own: boolean
  delivery?: Delivery
  error?: string
}

export type OnlineChatController = ReturnType<typeof useOnlineChat>

interface ChannelState {
  messages: OnlineChatMessage[]
  draft: string
  historyLoaded: boolean
  historyLoading: boolean
  olderLoading: boolean
  before: number | null | undefined
  historyAnchor: number
}

const CHANNELS = ['zh', 'en'] as const
const REQUEST_TIMEOUT_MS = 10_000
const PONG_TIMEOUT_MS = 8_000
const HEARTBEAT_MS = 30_000
const ECHO_TIMEOUT_MS = 15_000
const HISTORY_PAGE_SIZE = 100
const freshChannel = (): ChannelState => ({ messages: [], draft: '', historyLoaded: false, historyLoading: false, olderLoading: false, before: undefined, historyAnchor: 0 })
const identity = (value: CloudPreferences) => JSON.stringify([value.server, value.session?.token, value.session?.playerId])

function messageId(value: unknown): number | null {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 由 App 持有；页面导航只消费快照，应用 hook 卸载才释放传输。
class ChatRuntime {
  preferences = readCloudPreferences()
  channel: Channel
  channels: Record<Channel, ChannelState> = { zh: freshChannel(), en: freshChannel() }
  onlineCount: number | null = null
  private active = false
  private mounted = false
  private generation = 0
  private retries = 0
  private connecting = false
  private ready = false
  private socket: WebSocket | null = null
  private retryTimer: Timer | null = null
  private heartbeat: Timer | null = null
  private probeTimer: Timer | null = null
  private finishProbe: (() => void) | null = null
  private probeRequest: AbortController | null = null
  private echoOverdue = false
  private timers = new Set<Timer>()
  private requests = new Set<AbortController>()
  private history = new Map<Channel, Promise<void>>()
  private refreshAgain = new Set<Channel>()
  private outbox = new Map<string, OnlineChatMessage & { channel: Channel }>()
  private queue = this.makeQueue()
  private notify = () => {}
  private toast = (_id: string) => {}

  constructor(locale: Locale) { this.channel = locale === 'en' ? 'en' : 'zh' }

  private current(scope: number) { return this.mounted && scope === this.generation }
  private later(callback: () => void, delay: number): Timer {
    const scope = this.generation
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (this.current(scope)) callback()
    }, delay)
    this.timers.add(timer)
    return timer
  }
  private cancel(timer: Timer | null) {
    if (timer === null) return
    clearTimeout(timer)
    this.timers.delete(timer)
  }

  mount(notify: () => void, toast: (id: string) => void) {
    this.mounted = true
    this.notify = notify
    this.toast = toast
    window.addEventListener('storage', this.storageChanged)
    window.addEventListener(CLOUD_SESSION_CHANGE_EVENT, this.readPreferences)
    window.addEventListener('online', this.foreground)
    document.addEventListener('visibilitychange', this.visibility)
    this.readPreferences()
    return () => {
      this.mounted = false
      window.removeEventListener('storage', this.storageChanged)
      window.removeEventListener(CLOUD_SESSION_CHANGE_EVENT, this.readPreferences)
      window.removeEventListener('online', this.foreground)
      document.removeEventListener('visibilitychange', this.visibility)
      this.clearTransport()
      this.notify = () => {}
    }
  }

  private storageChanged = (event: StorageEvent) => { this.applyPreferences(refreshCloudPreferences(event.key)) }
  private readPreferences = () => { this.applyPreferences(readCloudPreferences()) }
  private applyPreferences(next: CloudPreferences) {
    if (identity(next) !== identity(this.preferences)) {
      this.clearTransport()
      this.queue.stop()
      this.queue = this.makeQueue()
      this.outbox.clear()
      this.channels = { zh: freshChannel(), en: freshChannel() }
      this.onlineCount = null
      this.retries = 0
    }
    this.preferences = next
    this.notify()
    this.connect()
  }

  activate = () => {
    this.active = true
    this.readPreferences()
  }

  private clearTransport() {
    this.generation++
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.retryTimer = this.heartbeat = this.probeTimer = null
    this.finishProbe = null
    this.probeRequest = null
    this.echoOverdue = false
    for (const controller of this.requests) controller.abort()
    this.requests.clear()
    this.history.clear()
    this.refreshAgain.clear()
    this.ready = this.connecting = false
    this.onlineCount = null
    this.queue.pause()
    this.setDelivery(this.queue.takeUncertain(), 'uncertain')
    for (const target of CHANNELS) {
      this.channels[target].historyLoading = false
      this.channels[target].olderLoading = false
    }
    const old = this.socket
    this.socket = null
    if (old) {
      old.onopen = old.onmessage = old.onerror = old.onclose = null
      old.close()
    }
  }

  private fail = () => {
    this.clearTransport()
    this.notify()
    if (!this.mounted || !this.active || !this.preferences.session) return
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retries++, 5))
    this.retryTimer = this.later(() => { this.retryTimer = null; this.connect() }, delay)
  }

  private unauthorized(scope: number, error: unknown): boolean {
    if (!this.current(scope)) return true
    if (!(error instanceof CloudApiError) || error.status !== 401) return false
    // 事件回调同步切换身份；旧请求不能删除刚写入的新账号会话。
    if (identity(readCloudPreferences()) !== identity(this.preferences)) { this.readPreferences(); return true }
    saveCloudSession(this.preferences.server, null)
    this.readPreferences()
    return true
  }

  private async checkProfile(scope: number, controller = new AbortController()): Promise<boolean> {
    this.requests.add(controller)
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('profile aborted'))
      controller.signal.addEventListener('abort', abort, { once: true })
    })
    const timer = this.later(() => { controller.abort(); this.fail() }, REQUEST_TIMEOUT_MS)
    try {
      const { server, session } = this.preferences
      await Promise.race([createCloudApi({ server, token: session!.token }).profile(controller.signal), cancelled])
      return this.current(scope) && !controller.signal.aborted
    } catch (error) {
      if (!controller.signal.aborted && this.current(scope) && !this.unauthorized(scope, error)) this.fail()
      return false
    } finally {
      this.cancel(timer)
      controller.signal.removeEventListener('abort', abort)
      this.requests.delete(controller)
    }
  }

  private connect = () => {
    if (!this.mounted || !this.active || !this.preferences.session || !this.preferences.server
      || this.connecting || this.socket || this.retryTimer !== null || document.visibilityState === 'hidden') return
    this.connecting = true
    const scope = this.generation
    void this.checkProfile(scope).then((valid) => {
      if (!valid || !this.current(scope)) return
      try {
        const ws = new WebSocket(cloudChatSocketUrl(this.preferences.server, this.preferences.session!.token))
        this.socket = ws
        let deadline = this.later(this.fail, REQUEST_TIMEOUT_MS)
        ws.onopen = () => {
          if (!this.current(scope)) return
          this.cancel(deadline)
          deadline = this.later(this.fail, REQUEST_TIMEOUT_MS)
        }
        ws.onmessage = (event) => {
          if (!this.current(scope)) return
          let frame: unknown
          try { frame = JSON.parse(event.data) } catch { return }
          if (!record(frame)) return
          if (frame.type === 'hello') {
            if (this.ready || !Array.isArray(frame.online) || !frame.online.every(name => typeof name === 'string')
              || typeof frame.nickname !== 'string' || !Array.isArray(frame.channels)
              || !CHANNELS.every(channel => (frame.channels as unknown[]).includes(channel))) return
            this.cancel(deadline)
            this.connecting = false
            this.ready = true
            this.onlineCount = Number.isSafeInteger(frame.onlineCount) && Number(frame.onlineCount) >= 0
              ? Number(frame.onlineCount) : new Set(frame.online).size
            this.queue.resume(3000)
            // 只有持续稳定的连接才重置退避，短连接的 hello 不重置。
            this.later(() => { this.retries = 0 }, HEARTBEAT_MS)
            this.scheduleHeartbeat()
            for (const target of CHANNELS) void this.loadHistory(target)
          } else if (frame.type === 'pong') {
            this.finishProbe?.()
          } else if (frame.type === 'presence' && this.ready) {
            if (Number.isSafeInteger(frame.onlineCount) && Number(frame.onlineCount) >= 0) this.onlineCount = Number(frame.onlineCount)
          } else if (frame.type === 'batch' && this.ready) {
            this.receiveBatch(frame)
          } else if (frame.type === 'error' && ['bad_batch', 'bad_channel', 'rate_limited', 'storage_error'].includes(String(frame.code))) {
            const ids = frame.clientMessageIds
            const failed = Array.isArray(ids) && ids.length <= 5 && ids.every(id => typeof id === 'string')
              ? this.queue.reject(ids) : []
            this.setDelivery(failed, 'failed')
            if (failed.length) this.toast('ui.chat.022')
          }
          this.notify()
        }
        ws.onclose = ws.onerror = () => { if (this.current(scope)) this.fail() }
      } catch { if (this.current(scope)) this.fail() }
    })
  }

  private scheduleHeartbeat() {
    this.cancel(this.heartbeat)
    this.heartbeat = null
    if (document.visibilityState !== 'hidden') this.heartbeat = this.later(() => this.probe(false), HEARTBEAT_MS)
  }
  private probe(verify: boolean) {
    if (!this.ready) { this.connect(); return }
    if (this.socket?.readyState !== WebSocket.OPEN) { this.fail(); return }
    if (this.probeTimer !== null) return
    const scope = this.generation
    this.cancel(this.heartbeat)
    this.heartbeat = null
    this.queue.pause()
    let pong = false
    let checked = !verify
    const finish = () => {
      if (!this.current(scope) || this.finishProbe !== onPong || !pong || !checked) return
      this.cancel(this.probeTimer)
      this.probeTimer = null
      this.finishProbe = null
      this.probeRequest = null
      // 同一 TCP 流中 pong 排在此前批次响应后；仍无回执者只标未确认，不重放。
      if (this.echoOverdue) {
        this.setDelivery(this.queue.takeUncertain(), 'uncertain')
        this.echoOverdue = false
        this.notify()
      }
      this.queue.resume()
      this.scheduleHeartbeat()
      if (verify) for (const target of CHANNELS) void this.loadHistory(target)
    }
    const onPong = () => { pong = true; finish() }
    this.finishProbe = onPong
    this.probeTimer = this.later(this.fail, PONG_TIMEOUT_MS)
    if (verify) {
      this.probeRequest = new AbortController()
      void this.checkProfile(scope, this.probeRequest).then(valid => { if (valid) { checked = true; finish() } })
    }
    try { this.socket.send(JSON.stringify({ type: 'ping' })) } catch { this.fail() }
  }
  private foreground = () => {
    if (document.visibilityState === 'hidden') return
    this.readPreferences()
    if (this.ready && this.socket?.readyState !== WebSocket.OPEN) this.fail()
    else this.probe(true)
  }
  private visibility = () => {
    if (document.visibilityState !== 'hidden') { this.foreground(); return }
    this.cancel(this.heartbeat)
    this.heartbeat = null
    // 后台挂起不作为网络故障；恢复时重新探活。
    this.cancel(this.probeTimer)
    this.probeTimer = null
    this.finishProbe = null
    this.probeRequest?.abort()
    this.probeRequest = null
  }

  private makeQueue() {
    const queue = createChatQueue({ send: (channel, batch) => {
      if (!this.ready) return false
      if (this.socket?.readyState !== WebSocket.OPEN) { this.fail(); return false }
      const scope = this.generation
      try {
        this.socket.send(JSON.stringify({ type: 'batch', channel, messages: batch.map(item => item.text), clientMessageIds: batch.map(item => item.id) }))
      } catch {
        // send 抛出后也不重放：保守视为结果不明，离开当前发送栈后统一清理。
        void Promise.resolve().then(() => { if (this.current(scope)) this.fail() })
      }
      this.setDelivery(batch, 'sent')
      this.notify()
      this.later(() => {
        const missing = batch.filter(item => this.outbox.get(item.id)?.delivery === 'sent')
        if (!missing.length) return
        this.echoOverdue = true
        this.queue.pause()
        this.setDelivery(missing, 'uncertain')
        this.notify()
        if (document.visibilityState !== 'hidden') this.probe(false)
      }, ECHO_TIMEOUT_MS)
      return true
    } })
    queue.pause()
    return queue
  }
  private setDelivery(items: QueuedChatMessage[], delivery: Delivery) {
    for (const item of items) {
      const local = this.outbox.get(item.id)
      if (!local || local.delivery === 'delivered') continue
      const next = { ...local, delivery, ...(delivery === 'failed' ? { error: futureTr('ui.chat.026') } : {}) }
      this.outbox.set(item.id, next)
      const state = this.channels[item.channel]
      state.messages = state.messages.map(message => message.clientId === item.id ? next : message)
    }
  }

  private merge(target: Channel, incoming: OnlineChatMessage[]) {
    const state = this.channels[target]
    const confirmed = new Map<number, OnlineChatMessage>()
    const local = new Map<string, OnlineChatMessage>()
    for (const item of [...state.messages, ...incoming]) {
      if (item.id !== null) {
        const previous = confirmed.get(item.id)
        confirmed.set(item.id, { ...previous, ...item, own: Boolean(previous?.own || item.own),
          ...(previous?.clientId ? { clientId: previous.clientId, delivery: 'delivered' as const } : {}) })
      } else if (item.clientId) local.set(item.clientId, item)
    }
    for (const item of confirmed.values()) if (item.clientId) local.delete(item.clientId)
    state.messages = [...confirmed.values()].sort((a, b) => a.id! - b.id!).concat([...local.values()])
  }
  private receiveBatch(frame: Record<string, unknown>) {
    if ((frame.channel !== 'zh' && frame.channel !== 'en') || typeof frame.nickname !== 'string'
      || !Array.isArray(frame.messages) || !Array.isArray(frame.ids) || frame.messages.length !== frame.ids.length
      || typeof frame.ts !== 'number' || !Number.isFinite(frame.ts)) return
    const clientIds = Array.isArray(frame.clientMessageIds) ? frame.clientMessageIds : []
    const rows: OnlineChatMessage[] = []
    frame.messages.forEach((text: unknown, index: number) => {
      const id = messageId((frame.ids as unknown[])[index])
      if (typeof text !== 'string' || id === null) return
      const clientId = clientIds[index]
      const own = typeof clientId === 'string' ? this.outbox.get(clientId) : undefined
      const matched = own && own.channel === frame.channel && own.text === text
        && own.nickname === frame.nickname && (own.delivery === 'sent' || own.delivery === 'uncertain' || own.delivery === 'delivered')
      if (matched) {
        this.queue.acknowledge([clientId])
        this.outbox.set(clientId, { ...own, id, delivery: 'delivered' })
      }
      rows.push({ id, nickname: frame.nickname as string, text, ts: frame.ts as number, own: Boolean(matched),
        ...(matched ? { clientId, delivery: 'delivered' as const } : {}) })
    })
    this.merge(frame.channel, rows)
  }

  private async historyPage(target: Channel, before: number | undefined, scope: number): Promise<CloudChatHistory> {
    const controller = new AbortController()
    this.requests.add(controller)
    let timer: Timer | null = null
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = this.later(() => { controller.abort(); reject(new Error('history timeout')) }, REQUEST_TIMEOUT_MS)
      controller.signal.addEventListener('abort', () => reject(new Error('history aborted')), { once: true })
    })
    try {
      const { server, session } = this.preferences
      const result = await Promise.race([createCloudApi({ server, token: session!.token }).chatHistory(target, HISTORY_PAGE_SIZE, before, controller.signal), timeout])
      if (!this.current(scope)) throw new Error('obsolete history')
      return result
    } finally { this.cancel(timer); this.requests.delete(controller) }
  }

  private loadHistory(target: Channel, older = false): Promise<void> {
    if (!this.ready || !this.preferences.session) return Promise.resolve()
    const existing = this.history.get(target)
    if (existing) { if (!older) this.refreshAgain.add(target); return existing }
    const state = this.channels[target]
    if (older && (state.before === null || state.before === undefined)) return Promise.resolve()
    const scope = this.generation
    // 只推进完整补齐后的锚点；部分页面成功、后续失败时仍须回补原缺口。
    const anchor = state.historyAnchor
    const initial = !state.historyLoaded
    let before = older ? state.before! : undefined
    state[older ? 'olderLoading' : 'historyLoading'] = true
    this.notify()
    const work = (async () => {
      try {
        do {
          const result = await this.historyPage(target, before, scope)
          if (!this.current(scope)) return
          const min = Math.min(Infinity, ...result.messages.map(row => row.id))
          const next = result.nextBeforeId === undefined
            ? result.messages.length >= HISTORY_PAGE_SIZE ? min : null : result.nextBeforeId
          this.merge(target, result.messages.map(row => ({ id: row.id, nickname: row.nickname, text: row.text, ts: row.created_at, own: false })))
          if (older || (initial && before === undefined)) state.before = next
          state.historyLoaded = true
          if (older || anchor === 0 || min <= anchor || next === null || (before !== undefined && next >= before)) break
          before = next
        } while (this.current(scope))
        if (!older && this.current(scope)) state.historyAnchor = Math.max(0, ...state.messages.map(message => message.id ?? 0))
      } catch (error) {
        if (this.current(scope) && !this.unauthorized(scope, error)) this.toast('ui.chat.027')
      } finally {
        if (this.current(scope)) {
          state[older ? 'olderLoading' : 'historyLoading'] = false
          this.history.delete(target)
          this.notify()
          if (this.refreshAgain.delete(target)) void this.loadHistory(target)
        }
      }
    })()
    this.history.set(target, work)
    return work
  }

  selectChannel = (channel: Channel) => {
    if (!CHANNELS.includes(channel)) return
    this.channel = channel
    this.notify()
    void this.loadHistory(channel)
  }
  setDraft = (draft: string | ((value: string) => string)) => {
    const state = this.channels[this.channel]
    state.draft = typeof draft === 'function' ? draft(state.draft) : draft
    this.notify()
  }
  send = (text: string): boolean => {
    if (!this.mounted || !this.active || !this.preferences.session) return false
    const clientId = this.queue.push(text, this.channel)
    if (!clientId) return false
    const state = this.channels[this.channel]
    const item = { id: null, clientId, channel: this.channel, nickname: this.preferences.session.nickname,
      text: text.trim(), ts: Date.now(), own: true, delivery: 'queued' as const }
    this.outbox.set(clientId, item)
    state.messages = [...state.messages, item]
    if (state.draft === text) state.draft = ''
    this.notify()
    this.connect()
    return true
  }
  retry = (clientId: string, _text: string) => {
    const old = this.outbox.get(clientId)
    if (!old || old.delivery !== 'failed') return
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) { this.toast('ui.chat.023'); return }
    const id = this.queue.push(old.text, old.channel)
    if (!id) return
    this.dismiss(clientId)
    const next = { ...old, id: null, clientId: id, delivery: 'queued' as const, error: undefined, ts: Date.now() }
    this.outbox.set(id, next)
    this.channels[old.channel].messages = [...this.channels[old.channel].messages, next]
    this.notify()
  }
  dismiss = (clientId: string) => {
    const item = this.outbox.get(clientId)
    if (!item || (item.delivery !== 'failed' && item.delivery !== 'queued')) return
    this.queue.discard(clientId)
    this.outbox.delete(clientId)
    this.channels[item.channel].messages = this.channels[item.channel].messages.filter(message => message.clientId !== clientId)
    this.notify()
  }
  loadOlder = () => this.loadHistory(this.channel, true)
}

export function useOnlineChat(locale: Locale, onToast: (text: string, warn?: boolean) => void) {
  const [runtime] = useState(() => new ChatRuntime(locale))
  const [, render] = useState(0)
  const toast = useRef(onToast)
  toast.current = onToast
  useEffect(() => runtime.mount(() => render(value => value + 1), id => toast.current(futureTr(id), true)), [runtime])
  const state = runtime.channels[runtime.channel]
  return {
    activate: runtime.activate,
    authenticated: Boolean(runtime.preferences.session),
    channel: runtime.channel,
    draft: state.draft,
    dismiss: runtime.dismiss,
    hasMore: state.before !== null,
    historyLoaded: state.historyLoaded,
    historyLoading: state.historyLoading,
    olderLoading: state.olderLoading,
    locale,
    messages: state.messages,
    onlineCount: runtime.onlineCount,
    retry: runtime.retry,
    selectChannel: runtime.selectChannel,
    send: runtime.send,
    setDraft: runtime.setDraft,
    session: runtime.preferences.session,
    loadOlder: runtime.loadOlder,
  }
}
