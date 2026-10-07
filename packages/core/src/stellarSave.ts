import type { StellarBody, StellarSearch, StellarState, StellarSystem } from './stellarTypes'

function id(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 128
    && !['__proto__', 'constructor', 'prototype'].includes(raw)
}
function record(raw: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null)
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) if (id(key)) result[key] = value
  }
  return result
}
function finite(raw: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max
}
function integer(raw: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): raw is number {
  return finite(raw, min, max) && Number.isSafeInteger(raw)
}
function count(raw: unknown): number { return integer(raw) ? raw : 0 }

const SYSTEM_KINDS: readonly StellarSystem['kind'][] = ['single', 'binary', 'white-dwarf', 'neutron', 'black-hole', 'rogue']
const STAR_CLASSES: readonly StellarSystem['starClass'][] = ['yellow', 'orange', 'red', 'blue', 'white', 'neutron', 'black-hole', 'none']
const BODY_KINDS: readonly StellarBody['kind'][] = ['rocky', 'desert', 'ice', 'ocean', 'lava', 'temperate', 'gas']
const MAX_SEARCH_MS = 6 * 60 * 60 * 1000

function cleanStellarSystem(raw: unknown, key: string): StellarSystem | undefined {
  const s = record(raw)
  if (s.id !== key || !integer(s.generationVersion, 1) || !integer(s.seed, 0, 0xffffffff)
    || !SYSTEM_KINDS.includes(s.kind as StellarSystem['kind'])
    || !STAR_CLASSES.includes(s.starClass as StellarSystem['starClass'])
    || !finite(s.routeMinutes, 20, 120) || !Array.isArray(s.stars) || s.stars.length > 2
    || !Array.isArray(s.bodies) || s.bodies.length < 2 || s.bodies.length > 8) return undefined
  // 未来规则的身份格式不可按当前版本重写，也不能由种子重建快照。
  if (s.generationVersion === 1 && key !== `system-v1-${s.seed}`) return undefined
  if (s.generationVersion === 1) {
    const starCount = s.kind === 'rogue' ? 0 : s.kind === 'binary' ? 2 : 1
    const classes = s.kind === 'single' || s.kind === 'binary' ? ['yellow', 'orange', 'red', 'blue']
      : [s.kind === 'white-dwarf' ? 'white' : s.kind === 'rogue' ? 'none' : s.kind]
    if (s.stars.length !== starCount || !classes.includes(s.starClass as string)) return undefined
  }
  const stars: StellarSystem['stars'] = []
  for (const value of s.stars) {
    const star = record(value)
    if (!finite(star.x) || !finite(star.y) || !finite(star.radius, Number.MIN_VALUE)) return undefined
    stars.push({ x: star.x, y: star.y, radius: star.radius })
  }
  const bodies: StellarBody[] = []
  const ordinals = new Set<number>(), planetIds = new Set<string>()
  for (const value of s.bodies) {
    const body = record(value)
    if (!id(body.planetId) || !integer(body.ordinal, 1, 8) || ordinals.has(body.ordinal) || planetIds.has(body.planetId)
      || !BODY_KINDS.includes(body.kind as StellarBody['kind']) || !finite(body.orbit, Number.MIN_VALUE)
      || !finite(body.x) || !finite(body.y)) return undefined
    ordinals.add(body.ordinal); planetIds.add(body.planetId)
    bodies.push({ planetId: body.planetId, ordinal: body.ordinal, kind: body.kind as StellarBody['kind'],
      orbit: body.orbit, x: body.x, y: body.y })
  }
  return {
    id: key, generationVersion: s.generationVersion as StellarSystem['generationVersion'], seed: s.seed,
    kind: s.kind as StellarSystem['kind'], starClass: s.starClass as StellarSystem['starClass'],
    stars, bodies, routeMinutes: s.routeMinutes,
    ...(typeof s.developed === 'boolean' ? { developed: s.developed } : {}),
  }
}

function cleanStellarSearch(raw: unknown): StellarSearch | undefined {
  const s = record(raw)
  if (!integer(s.seq, 1) || (s.mode !== 'random' && s.mode !== 'specified') || !integer(s.seed, 0, 0xffffffff)
    || !finite(s.durationMs, 1000, MAX_SEARCH_MS) || !finite(s.progressMs, 0, s.durationMs)
    || typeof s.paused !== 'boolean') return undefined
  return { seq: s.seq, mode: s.mode, seed: s.seed, durationMs: s.durationMs, progressMs: s.progressMs, paused: s.paused }
}

export function cleanStellarState(raw: unknown): StellarState | undefined {
  const root = record(raw)
  const systems: StellarState['systems'] = {}
  const planetIds = new Set<string>()
  for (const [key, value] of Object.entries(record(root.systems))) {
    const system = cleanStellarSystem(value, key)
    if (!system || system.bodies.some(body => planetIds.has(body.planetId))) continue
    systems[key] = system
    for (const body of system.bodies) planetIds.add(body.planetId)
  }
  const search = cleanStellarSearch(root.search)
  const pendingSeq = record(root.search).seq
  const searchSeq = Math.max(count(root.searchSeq), count(pendingSeq))
  const stoppedReason = root.stoppedReason === 'capacity' || root.stoppedReason === 'probe-stock' ? root.stoppedReason : undefined
  if (!Object.keys(systems).length && !search && !searchSeq && typeof root.autoSearch !== 'boolean' && !stoppedReason) return undefined
  return { systems, searchSeq, autoSearch: root.autoSearch === true,
    ...(search ? { search } : {}), ...(stoppedReason ? { stoppedReason } : {}) }
}
