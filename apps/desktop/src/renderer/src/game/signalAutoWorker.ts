import type { GameState } from '@whale/core'
import type { SignalAutoEstimate } from '../../../../../../packages/core/src/signalAuto/types'
import type { CommandResult } from '@whale/core'

export type SignalAutoWorkerResult = { estimate: SignalAutoEstimate } | { failure: CommandResult }

export interface SignalAutoWorker {
  onmessage: ((event: { data: { estimate?: SignalAutoEstimate; failure?: CommandResult } }) => void) | null
  onerror: (() => void) | null
  onmessageerror: (() => void) | null
  postMessage(value: { state: GameState; stockId: string; shipIds: string[] }): void
  terminate(): void
}

/** 每次派队独立Worker；取消、超时、出错和成功均终止自建任务。 */
export function computeSignalAuto(state: GameState, stockId: string, shipIds: readonly string[], signal: AbortSignal | undefined,
  createWorker: () => SignalAutoWorker): Promise<SignalAutoWorkerResult> {
  const failure = (errorId: string): SignalAutoWorkerResult => ({ failure: { ok: false, errorId } })
  if (signal?.aborted) return Promise.resolve(failure('core.signalDispatch.001'))
  return new Promise(resolve => {
    let worker: SignalAutoWorker
    try { worker = createWorker() }
    catch { resolve(failure('core.signalDispatch.002')); return }
    let settled = false
    const finish = (result: SignalAutoWorkerResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      worker.terminate()
      resolve(result)
    }
    const cancel = () => finish(failure('core.signalDispatch.001'))
    const timer = setTimeout(() => finish(failure('core.signalDispatch.003')), 60_000)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    worker.onmessage = event => finish(event.data.failure && !event.data.failure.ok && (event.data.failure.error || event.data.failure.errorId)
      ? { failure: event.data.failure }
      : event.data.estimate ? { estimate: event.data.estimate } : failure('core.signalDispatch.004'))
    worker.onerror = () => finish(failure('core.signalDispatch.004'))
    worker.onmessageerror = () => finish(failure('core.signalDispatch.004'))
    try { worker.postMessage({ state, stockId, shipIds: [...shipIds] }) } catch { finish(failure('core.signalDispatch.004')) }
  })
}
