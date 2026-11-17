import type { GameEngine } from '../engine'
import { matchLogCue, productionCompletedCount, productionSnapshot } from './rules'
import type { ProductionSnapshot } from './rules'
import { playCue } from './player'

interface LogLike {
  id: number
  kind: string
  textId?: string
  textParams?: Record<string, unknown>
}

export function attachGameSfx(engine: Pick<GameEngine, 'state' | 'subscribe'>): () => void {
  const initialLogs = engine.state.logs as readonly LogLike[]
  let lastLogId = initialLogs.length > 0 ? (initialLogs[initialLogs.length - 1]?.id ?? 0) : 0
  let prevProduction: ProductionSnapshot = productionSnapshot(engine.state)

  const step = (): void => {
    const state = engine.state
    const logs = state.logs as readonly LogLike[]
    if (logs.length === 0) {
      lastLogId = 0
    } else {
      const tail = logs[logs.length - 1]!.id
      if (tail < lastLogId) lastLogId = 0
      for (const log of logs) {
        if (log.id <= lastLogId) continue
        const cue = matchLogCue(log.kind, log.textId, log.textParams)
        if (cue !== null) playCue(cue)
      }
      lastLogId = tail
    }
    const nextProduction = productionSnapshot(state)
    if (productionCompletedCount(prevProduction, nextProduction) > 0) playCue('industry-done')
    prevProduction = nextProduction
  }

  return engine.subscribe(() => {
    try {
      step()
    } catch {
    }
  })
}
