import type { WeekendWreckBucket, WeekendWreckRecord } from './state'
import type { FoeFamily } from './types'
import { wreckGroupOfAnomaly } from './wreckGroups'

export const FOE_FAMILY_CODES: readonly FoeFamily[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'R']

export function asFoeFamily(value: string | undefined): FoeFamily | undefined {
  return value !== undefined && (FOE_FAMILY_CODES as readonly string[]).includes(value) ? value as FoeFamily : undefined
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function bucketOf(value: unknown): WeekendWreckBucket | undefined {
  const raw = recordOf(value)
  if (typeof raw.decayAccMs !== 'number' || !Number.isFinite(raw.decayAccMs) || raw.decayAccMs < 0) return undefined
  const density = typeof raw.density === 'number' && Number.isFinite(raw.density) ? Math.max(0, raw.density) : 0
  const rareBy: Record<string, number> = {}
  for (const [cardId, n] of Object.entries(recordOf(raw.rareBy))) {
    if (cardId && typeof n === 'number' && Number.isFinite(n) && n >= 1) rareBy[cardId] = Math.floor(n)
  }
  const rare = Math.max(
    typeof raw.rare === 'number' && Number.isFinite(raw.rare) ? Math.max(0, Math.floor(raw.rare)) : 0,
    Object.values(rareBy).reduce((sum, n) => sum + n, 0),
  )
  if (density <= 0 && rare <= 0) return undefined
  return { density, decayAccMs: raw.decayAccMs, ...(rare > 0 ? { rare } : {}), ...(Object.keys(rareBy).length > 0 ? { rareBy } : {}) }
}

/** 读档与运行时边界共用：旧单桶折入来源族，未知来源绝不借用当前活动族。 */
export function normalizeWeekendWreckRecord(value: unknown): WeekendWreckRecord {
  const raw = recordOf(value)
  const byFamily: Record<string, WeekendWreckBucket> = {}
  if (raw.byFamily !== undefined) {
    for (const [key, value] of Object.entries(recordOf(raw.byFamily))) {
      if (key !== '?' && asFoeFamily(key) === undefined) continue
      const bucket = bucketOf(value)
      if (bucket) byFamily[key] = bucket
    }
  } else {
    const bucket = bucketOf(raw)
    if (bucket) {
      const key = typeof raw.family === 'string' ? asFoeFamily(raw.family) ?? '?' : '?'
      const attributed = Object.values(bucket.rareBy ?? {}).reduce((sum, n) => sum + n, 0)
      const unclaimed = Math.max(0, (bucket.rare ?? 0) - attributed)
      if (bucket.density > 0 || unclaimed > 0) {
        byFamily[key] = { density: bucket.density, decayAccMs: bucket.decayAccMs, ...(unclaimed > 0 ? { rare: unclaimed } : {}) }
      }
      for (const [cardId, count] of Object.entries(bucket.rareBy ?? {})) {
        const source = wreckGroupOfAnomaly(cardId)?.family ?? key
        const own = byFamily[source] ?? { density: 0, decayAccMs: bucket.decayAccMs }
        byFamily[source] = { ...own, rare: (own.rare ?? 0) + count, rareBy: { ...own.rareBy, [cardId]: count } }
      }
    }
  }
  return { byFamily }
}
