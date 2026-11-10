/**
 * 公司账本流水上报器（docs/design/stock-gameplay-integration-20261109.md）
 *
 * 玩家在市场与 NPC 的即时成交由游侧调用 `reportCompanyFlow()` 记入本地队列，
 * 每 60 秒或攒满 20 条批量 POST `/api/exchange/company-flow`。
 * - 只上报商品 key / 方向 / 金额，不上报任何玩法细节；身份由 Bearer token 决定。
 * - 网络失败保留队列下次重试；队列上限 200 条（超出丢最旧，防内存膨胀）。
 * - 未登录（游客）不上报：公司账本按账号记账。
 * - 第一版只记即时成交（doBuy/doSell/doSellAll 的成交回执），挂单延迟成交不记。
 */
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

/** 记录一笔玩家↔市场的即时成交（成交成功后调用）。 */
export function reportCompanyFlow(good: string, side: 'buy' | 'sell', amount: number): void {
  if (!good || !Number.isFinite(amount) || amount <= 0) return
  queue.push({ good, side, amount: Math.round(amount), count: 1 })
  if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT)
  ensureTimer()
  if (queue.length >= FLUSH_BATCH) void flushCompanyFlows()
}

/** 立即发送队列（失败保留，稍后重试）。 */
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
    // 网络失败：保留队列，下个周期重试。
  } finally {
    flushing = false
  }
}

/** 仅测试/诊断用：清空队列与定时器。 */
export function resetCompanyFlowsForTest(): void {
  queue = []
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}
