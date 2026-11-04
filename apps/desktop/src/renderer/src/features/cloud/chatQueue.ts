export const CHAT_BATCH_INTERVAL_MS = 3000
export const CHAT_MAX_PER_FRAME = 5
export const CHAT_MAX_MESSAGE_CHARS = 500

export interface QueuedChatMessage {
  id: string
  text: string
  channel: 'zh' | 'en'
}

export function createChatQueue(options: {
  send: (channel: 'zh' | 'en', messages: QueuedChatMessage[]) => boolean
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}) {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  let pending: QueuedChatMessage[] = []
  let inFlight: QueuedChatMessage[] = []
  let inFlightBatches: QueuedChatMessage[][] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSentAt: number | null = null
  let notBefore = 0
  let stopped = false
  let paused = false

  const clearSchedule = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const schedule = () => {
    if (stopped || paused || timer !== null || pending.length === 0) return
    const delay = Math.max(notBefore - now(), lastSentAt === null ? CHAT_BATCH_INTERVAL_MS : Math.max(0, CHAT_BATCH_INTERVAL_MS - (now() - lastSentAt)))
    timer = setTimer(() => {
      timer = null
      flush()
    }, delay)
  }

  const flush = () => {
    clearSchedule()
    if (stopped || paused || pending.length === 0) return
    if (now() < notBefore || (lastSentAt !== null && now() - lastSentAt < CHAT_BATCH_INTERVAL_MS)) { schedule(); return }
    const channel = pending[0]!.channel
    const batch = pending.filter((item) => item.channel === channel).slice(0, CHAT_MAX_PER_FRAME)
    if (!options.send(channel, batch)) { paused = true; return }
    const sent = new Set(batch.map((item) => item.id))
    pending = pending.filter((item) => !sent.has(item.id))
    inFlight.push(...batch)
    inFlightBatches.push(batch)
    lastSentAt = now()
    schedule()
  }

  return {
    push(text: string, channel: 'zh' | 'en') {
      const normalized = text.trim()
      if (stopped || !normalized || normalized.length > CHAT_MAX_MESSAGE_CHARS) return null
      const item = { id: crypto.randomUUID(), channel, text: normalized }
      pending.push(item)
      schedule()
      return item.id
    },
    acknowledge(ids: readonly string[]) {
      if (ids.length === 0) return
      const accepted = new Set(ids)
      inFlight = inFlight.filter((item) => !accepted.has(item.id))
      inFlightBatches = inFlightBatches
        .map((batch) => batch.filter((item) => !accepted.has(item.id)))
        .filter((batch) => batch.length > 0)
      if (pending.length === 0) clearSchedule()
    },
    reject(ids: readonly string[]): QueuedChatMessage[] {
      const rejected = new Set(ids)
      if (!ids.length || rejected.size !== ids.length) return []
      const index = inFlightBatches.findIndex(batch => batch.length === ids.length && batch.every(item => rejected.has(item.id)))
      if (index < 0) return []
      const [batch] = inFlightBatches.splice(index, 1)
      if (!batch) return []
      inFlight = inFlight.filter((item) => !batch.some((failed) => failed.id === item.id))
      return batch
    },
    takeUncertain(): QueuedChatMessage[] {
      const result = inFlight
      inFlight = []
      inFlightBatches = []
      return result
    },
    pause() {
      paused = true
      clearSchedule()
    },
    resume(waitMs = 0) {
      if (stopped) return
      notBefore = Math.max(notBefore, now() + waitMs)
      paused = false
      schedule()
    },
    discard(id: string) {
      pending = pending.filter((item) => item.id !== id)
      inFlight = inFlight.filter((item) => item.id !== id)
      inFlightBatches = inFlightBatches.map((batch) => batch.filter((item) => item.id !== id)).filter((batch) => batch.length > 0)
      if (pending.length === 0) clearSchedule()
    },
    stop() {
      stopped = true
      clearSchedule()
      pending = []
      inFlight = []
      inFlightBatches = []
    },
    pending() {
      return pending.slice()
    },
    inFlight() {
      return inFlight.slice()
    },
    nextDelay() {
      return pending.length === 0 ? null : Math.max(notBefore - now(), lastSentAt === null ? CHAT_BATCH_INTERVAL_MS : Math.max(0, CHAT_BATCH_INTERVAL_MS - (now() - lastSentAt)))
    },
  }
}
