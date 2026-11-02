import type { SimContext } from '../types'
import { shortestTravelPath } from '../travel'

/** 快递沿冻结总航时分配逐跳暴露；战斗推迟到站时刻但不推进航程。 */
export function timedRouteExposureOf(ctx: SimContext, from: string, to: string, durationMs: number, progressMs: number): { galaxyId: string; remainingMs: number } | null {
  const route = shortestTravelPath(ctx, from, to)
  const total = route.hopMinutes.reduce((sum, value) => sum + value, 0)
  if (!total || !(durationMs > 0)) return null
  let end = 0
  for (let i = 0; i < route.hopMinutes.length; i++) {
    end += durationMs * route.hopMinutes[i]! / total
    if (progressMs >= end && i + 1 < route.hopMinutes.length) continue
    const a = route.galaxies[i]!, b = route.galaxies[i + 1]!
    return { galaxyId: (ctx.galaxies.get(a)?.security ?? 1) < (ctx.galaxies.get(b)?.security ?? 1) ? a : b, remainingMs: Math.max(1, Math.ceil(end - progressMs)) }
  }
  return null
}
