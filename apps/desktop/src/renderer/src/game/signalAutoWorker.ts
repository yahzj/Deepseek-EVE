import type { GameState } from '@whale/core'
import type { SignalAutoEstimate } from '../../../../../../packages/core/src/signalAuto/types'

export interface SignalAutoWorker {
  onmessage: ((event: { data: { estimate?: SignalAutoEstimate } }) => void) | null
  onerror: (() => void) | null
  onmessageerror: (() => void) | null
  postMessage(value: { state: GameState; stockId: string; shipIds: string[] }): void
  terminate(): void
}

/** 每次派队独立Worker；取消、超时、出错和成功均终止自建任务。 */
export function computeSignalAuto(state: GameState, stockId: string, shipIds: readonly string[], signal: AbortSignal | undefined,
  createWorker: () => SignalAutoWorker): Promise<SignalAutoEstimate | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined)
  return new Promise(resolve => {
    let worker: SignalAutoWorker
    try { worker = createWorker() }
    catch { resolve(undefined); return }
    let settled = false
    const finish = (estimate?: SignalAutoEstimate) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      worker.terminate()
      resolve(estimate)
    }
    const cancel = () => finish()
    const timer = setTimeout(cancel, 60_000)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { finish(); return }
    worker.onmessage = event => finish(event.data.estimate)
    worker.onerror = cancel
    worker.onmessageerror = cancel
    try { worker.postMessage({ state, stockId, shipIds: [...shipIds] }) } catch { finish() }
  })
}
