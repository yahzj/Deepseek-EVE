import { describe, expect, it } from 'vitest'
import { CHAT_BATCH_INTERVAL_MS, CHAT_MAX_PER_FRAME, CHAT_MAX_MESSAGE_CHARS, createChatQueue } from '../../../apps/desktop/src/renderer/src/features/cloud/chatQueue'
import type { QueuedChatMessage } from '../../../apps/desktop/src/renderer/src/features/cloud/chatQueue'

function clock() {
  let now = 10_000
  let nextId = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const setTimer = ((callback: () => void, delay: number) => {
    const id = ++nextId
    timers.set(id, { at: now + delay, callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  const clearTimer = ((handle: ReturnType<typeof setTimeout>) => {
    timers.delete(handle as unknown as number)
  }) as typeof clearTimeout
  return {
    now: () => now,
    setTimer,
    clearTimer,
    timerCount: () => timers.size,
    advance(ms: number) {
      const end = now + ms
      let guard = 0
      while (guard++ < 100) {
        const next = [...timers.entries()].filter(([, task]) => task.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0])
        now = next[1].at
        next[1].callback()
      }
      now = end
    },
  }
}

function makeQueue(send: (channel: 'zh' | 'en', messages: QueuedChatMessage[]) => boolean, time = clock()) {
  const queue = createChatQueue({
    send: (channel, messages) => send(channel, messages),
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  })
  return { queue, time }
}

describe('online chat outbound batching', () => {
  it('waits three seconds, limits each frame to five and spaces subsequent frames', () => {
    const sent: Array<{ channel: string; messages: string[] }> = []
    const { queue, time } = makeQueue((channel, messages) => {
      sent.push({ channel, messages: messages.map((message) => message.text) })
      return true
    })
    for (let index = 0; index < 6; index++) queue.push(`message-${index}`, 'zh')
    expect(queue.nextDelay()).toBe(CHAT_BATCH_INTERVAL_MS)
    time.advance(CHAT_BATCH_INTERVAL_MS - 1)
    expect(sent).toHaveLength(0)
    time.advance(1)
    expect(sent[0]!.messages).toHaveLength(CHAT_MAX_PER_FRAME)
    expect(sent).toEqual([{ channel: 'zh', messages: ['message-0', 'message-1', 'message-2', 'message-3', 'message-4'] }])
    expect(queue.pending()).toHaveLength(1)
    time.advance(CHAT_BATCH_INTERVAL_MS - 1)
    expect(sent).toHaveLength(1)
    time.advance(1)
    expect(sent[1]).toEqual({ channel: 'zh', messages: ['message-5'] })
  })

  it('does not mix channels into one protocol frame', () => {
    const sent: Array<{ channel: string; messages: string[] }> = []
    const { queue, time } = makeQueue((channel, messages) => {
      sent.push({ channel, messages: messages.map((message) => message.text) })
      return true
    })
    queue.push('中文', 'zh')
    queue.push('English', 'en')
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(sent[0]).toEqual({ channel: 'zh', messages: ['中文'] })
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(sent[1]).toEqual({ channel: 'en', messages: ['English'] })
  })

  it('keeps a frame when transport is unavailable and pauses it until resume', () => {
    let online = false
    const sent: string[][] = []
    const { queue, time } = makeQueue((_channel, messages) => {
      if (!online) return false
      sent.push(messages.map((message) => message.text))
      return true
    })
    const id = queue.push('keep me', 'zh')!
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(queue.pending().map((message) => message.id)).toEqual([id])
    queue.pause()
    online = true
    time.advance(CHAT_BATCH_INTERVAL_MS * 2)
    expect(sent).toHaveLength(0)
    queue.resume()
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(sent).toEqual([['keep me']])
  })

  it('tracks in-flight batches, acknowledges them and rejects a whole failed frame', () => {
    const { queue, time } = makeQueue(() => true)
    const first = queue.push('first', 'zh')!
    const second = queue.push('second', 'zh')!
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(queue.inFlight().map((message) => message.id)).toEqual([first, second])
    expect(queue.reject([first, second]).map((message) => message.id)).toEqual([first, second])
    expect(queue.inFlight()).toHaveLength(0)

    const third = queue.push('third', 'en')!
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(queue.inFlight().map((message) => message.id)).toEqual([third])
    queue.acknowledge([third])
    expect(queue.inFlight()).toHaveLength(0)
  })

  it('associates a delayed frame rejection by exact IDs rather than send order', () => {
    const { queue, time } = makeQueue(() => true)
    const older = queue.push('older', 'zh')!
    time.advance(CHAT_BATCH_INTERVAL_MS)
    const newer = queue.push('newer', 'en')!
    time.advance(CHAT_BATCH_INTERVAL_MS)
    expect(queue.reject([older, newer])).toEqual([])
    expect(queue.reject([older]).map(message => message.id)).toEqual([older])
    expect(queue.inFlight().map(message => message.id)).toEqual([newer])
    expect(queue.reject([newer, newer])).toEqual([])
    expect(queue.reject(['unknown'])).toEqual([])
  })

  it('trims whitespace but rejects rather than truncates the server UTF-16 limit', () => {
    const { queue } = makeQueue(() => true)
    expect(queue.push('界'.repeat(CHAT_MAX_MESSAGE_CHARS + 1), 'zh')).toBeNull()
    const astral = String.fromCodePoint(0x1f680)
    expect(queue.push(astral.repeat(251), 'en')).toBeNull()
    expect(queue.pending()).toHaveLength(0)
    expect(queue.push(`  ${astral.repeat(250)}  `, 'en')).toBeTruthy()
    expect(queue.pending()[0]!.text.length).toBe(500)
    expect(queue.push('  trimmed  ', 'zh')).toBeTruthy()
    expect(queue.pending()[1]!.text).toBe('trimmed')
  })

  it('uses one socket-wide cadence even after idle, pause and channel changes', () => {
    const sent: Array<{ channel: string; at: number }> = []
    const time = clock()
    const { queue } = makeQueue(channel => { sent.push({ channel, at: time.now() }); return true }, time)
    queue.push('first', 'zh')
    time.advance(3000)
    time.advance(100)
    queue.push('second', 'en')
    queue.pause()
    time.advance(1000)
    queue.resume()
    time.advance(1899)
    expect(sent).toEqual([{ channel: 'zh', at: 13000 }])
    time.advance(1)
    expect(sent).toEqual([{ channel: 'zh', at: 13000 }, { channel: 'en', at: 16000 }])
  })

  it('never replays uncertain frames and ignores acknowledgements for unsent IDs', () => {
    const sent: string[][] = []
    const { queue, time } = makeQueue((_channel, batch) => { sent.push(batch.map(item => item.id)); return true })
    const first = queue.push('first', 'zh')!
    const pending = queue.push('second', 'en')!
    queue.acknowledge([pending])
    expect(queue.pending()).toHaveLength(2)
    time.advance(3000)
    queue.pause()
    expect(queue.takeUncertain().map(item => item.id)).toEqual([first])
    expect(queue.reject([first])).toEqual([])
    queue.resume()
    time.advance(3000)
    expect(sent).toEqual([[first], [pending]])
    expect(queue.inFlight().map(item => item.id)).toEqual([pending])
  })

  it('clears all state and timers on stop and cannot resume a stopped queue', () => {
    const { queue, time } = makeQueue(() => true)
    queue.push('first', 'zh')
    time.advance(3000)
    queue.push('second', 'en')
    expect(time.timerCount()).toBe(1)
    queue.stop()
    queue.resume()
    expect(queue.push('third', 'zh')).toBeNull()
    expect(queue.pending()).toEqual([])
    expect(queue.inFlight()).toEqual([])
    expect(time.timerCount()).toBe(0)
  })
})
