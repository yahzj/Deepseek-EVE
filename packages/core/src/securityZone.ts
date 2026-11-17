import type { SimContext } from './types'

export type SecurityZone = '高安' | '中安' | '低安'

export function securityZoneOf(ctx: SimContext, galaxyId: string): SecurityZone {
  const sec = ctx.galaxies.get(galaxyId)?.security
  const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0.5
  if (v >= 0.5) return '高安'
  if (v > 0) return '中安'
  return '低安'
}
