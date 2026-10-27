import { BOUNTY_MC_RUNS, estimateBountyWinOn } from '@whale/core'
import type { SimContext } from '@whale/core'
import type { BountyWinRequest, BountyWinResponse } from './bountyWinProtocol'

/** 无UI与文件读写的worker任务；每张卡仍跑原三点各10局。 */
export function createBountyWinTask(context: (locale: 'zh' | 'en') => SimContext, now: () => number) {
  let session: Extract<BountyWinRequest, { kind: 'init' }> | null = null
  let ctx: SimContext | null = null
  return (request: BountyWinRequest): BountyWinResponse | null => {
    if (request.kind === 'init') {
      session = request
      ctx = context(request.locale)
      return null
    }
    try {
      if (!session || !ctx || request.generation !== session.generation) throw new Error('bounty-worker-session-stale')
      const anomaly = ctx.anomalies.get(request.id)
      if (!anomaly) throw new Error('bounty-worker-card-missing')
      const started = now()
      const result = estimateBountyWinOn(session.snapshot.ev, ctx, anomaly, session.snapshot.uid, BOUNTY_MC_RUNS)
      return { kind: 'result', generation: request.generation, id: request.id, result, computeMs: now() - started }
    } catch (error) {
      return { kind: 'error', generation: request.generation, id: request.id, message: String(error) }
    }
  }
}
