import { createExchangeClient } from './factory'
import type { CompanyFlowEntry } from './client'

const FLUSH_INTERVAL_MS = 60_000
const FLUSH_BATCH = 20
const QUEUE_LIMIT = 200

let queue: CompanyFlowEntry[] = []
let timer: number | null = null
let flushing = false

function ensureTimer(): void {
  if (timer !== null) return
  timer = window.setInterval(() => {
    void flushCompanyFlows()
  }, FLUSH_INTERVAL_MS)
}

export function reportCompanyFlow(good: string, side: 'buy' | 'sell', amount: number): void {
  if (!good || !Number.isFinite(amount) || amount <= 0) return
  queue.push({ good, side, amount: Math.round(amount), count: 1 })
  if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT)
  ensureTimer()
  if (queue.length >= FLUSH_BATCH) void flushCompanyFlows()
}

export async function flushCompanyFlows(): Promise<void> {
  if (flushing || queue.length === 0) return
  const bundle = createExchangeClient()
  if (bundle.error !== null || !bundle.client.submitCompanyFlows) return
  if (bundle.source.auth === 'guest') return
  flushing = true
  const batch = queue.slice(0, FLUSH_BATCH)
  try {
    await bundle.client.submitCompanyFlows(batch)
    queue = queue.slice(batch.length)
  } catch {
  } finally {
    flushing = false
  }
}

export function resetCompanyFlowsForTest(): void {
  queue = []
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}
