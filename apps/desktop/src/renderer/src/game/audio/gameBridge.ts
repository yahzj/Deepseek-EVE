/**
 * **游戏状态 → 音效的桥**（2026-11-02，只读，不改 core）。
 *
 * 两个来源：
 * 1. **日志增量**：引擎本局内存日志 `state.logs`（带稳定 `textId`）→ 语义 id（规则见 `rules.ts`）；
 * 2. **生产进度**：只读 `refineRuns[].batchesDone` / `labRuns[].finishAtGameMs` 的增量
 *    —— 这两类"每批完成"不写日志，但引擎每次 `notify()` 都能看到计数变化。
 *
 * 纪律：不新增判定、不消费随机、不改状态；启动时只记基线（**不补播历史**）。
 */
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

/** 挂上引擎订阅；返回退订函数（页面卸载/测试用） */
export function attachGameSfx(engine: Pick<GameEngine, 'state' | 'subscribe'>): () => void {
  const initialLogs = engine.state.logs as readonly LogLike[]
  /** 启动基线：只看之后新增的日志，不补播读档前的历史 */
  let lastLogId = initialLogs.length > 0 ? (initialLogs[initialLogs.length - 1]?.id ?? 0) : 0
  let prevProduction: ProductionSnapshot = productionSnapshot(engine.state)

  const step = (): void => {
    const state = engine.state
    const logs = state.logs as readonly LogLike[]
    if (logs.length === 0) {
      // 日志被清空（导入/重置）⇒ 重写 id 会从头开始，游标一起归零
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
      /* 音效层异常不许影响引擎推进 */
    }
  })
}
