export interface HaulFleetLeg {
  version: 1
  targetM3: number
  shipIds: string[]
  loadedByShip: { shipId: string; loadedM3: number }[]
  loadedM3: number
  baseRewardIsk: number
  positioning: boolean
  stopAtArrival: boolean
  returning: boolean
  abortAfterBattle?: true
  path: { galaxyId: string; durationMs: number; progressMs: number }[]
  pathIndex: number
}

export function cleanHaulFleetLeg(raw: unknown): HaulFleetLeg | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as HaulFleetLeg
  const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  if (r.version !== 1 || !integer(r.targetM3) || !r.targetM3 || !integer(r.loadedM3) || !Array.isArray(r.shipIds) || !r.shipIds.length || r.shipIds.length > 64 || r.shipIds.some(id => typeof id !== 'string' || !id.length || id.length > 128) || new Set(r.shipIds).size !== r.shipIds.length) return undefined
  if (!Array.isArray(r.loadedByShip) || r.loadedByShip.length !== r.shipIds.length || r.loadedByShip.some((row, i) => !row || row.shipId !== r.shipIds[i] || !Number.isFinite(row.loadedM3) || row.loadedM3 < 0) || Math.abs(r.loadedByShip.reduce((sum, row) => sum + row.loadedM3, 0) - r.loadedM3) > 1e-7) return undefined
  if (!Array.isArray(r.path) || !r.path.length || r.path.length > 256 || r.path.some(row => !row || typeof row.galaxyId !== 'string' || !row.galaxyId.length || !integer(row.durationMs) || !row.durationMs || !integer(row.progressMs) || row.progressMs > row.durationMs) || !integer(r.pathIndex) || r.pathIndex >= r.path.length) return undefined
  if (!integer(r.baseRewardIsk)) return undefined
  return { version: 1, targetM3: r.targetM3, shipIds: [...r.shipIds], loadedByShip: r.loadedByShip.map(row => ({ shipId: row.shipId, loadedM3: row.loadedM3 })), loadedM3: r.loadedM3, baseRewardIsk: r.baseRewardIsk, positioning: r.positioning === true, stopAtArrival: r.stopAtArrival === true, returning: r.returning === true,
    ...(r.abortAfterBattle === true ? { abortAfterBattle: true as const } : {}),
    path: r.path.map(row => ({ galaxyId: row.galaxyId, durationMs: row.durationMs, progressMs: row.progressMs })), pathIndex: r.pathIndex }
}
