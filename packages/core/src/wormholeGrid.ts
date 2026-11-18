import type { WormholeFoeKind } from './wormholeFoes'
import type { WormholeArchetype } from './state'


export interface HexCell {
  q: number
  r: number
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

export function parseHexKey(key: string): HexCell | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key)
  if (!m) return null
  return { q: Number(m[1]), r: Number(m[2]) }
}

export function hexDistance(a: HexCell, b: HexCell): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

export const HEX_DIRS: readonly HexCell[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function hexNeighbors(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }))
}

export function hexDiskCells(radius: number): HexCell[] {
  const R = Math.max(0, Math.floor(radius))
  const out: HexCell[] = []
  for (let r = -R; r <= R; r++) {
    const qLo = Math.max(-R, -r - R)
    const qHi = Math.min(R, -r + R)
    for (let q = qLo; q <= qHi; q++) out.push({ q, r })
  }
  return out
}

export function hexDiskCount(radius: number): number {
  const R = Math.max(0, Math.floor(radius))
  return 3 * R * (R + 1) + 1
}

export function hexDiskAround(center: HexCell, radius: number): HexCell[] {
  return hexDiskCells(radius).map((c) => ({ q: c.q + center.q, r: c.r + center.r }))
}

export function hexRingAround(center: HexCell, radius: number): HexCell[] {
  const R = Math.max(0, Math.floor(radius))
  if (R === 0) return [{ q: center.q, r: center.r }]
  return hexDiskAround(center, R).filter((c) => hexDistance(c, center) === R)
}

function cubeRound(q: number, r: number): HexCell {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return { q: rq, r: rr }
}

export function hexLine(a: HexCell, b: HexCell): HexCell[] {
  const swap = a.q > b.q || (a.q === b.q && a.r > b.r)
  const from = swap ? b : a
  const to = swap ? a : b
  const n = hexDistance(from, to)
  if (n === 0) return [{ q: from.q, r: from.r }]
  const fq = from.q
  const fr = from.r
  const tq = to.q
  const tr = to.r
  const out: HexCell[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push(cubeRound(fq + (tq - fq) * t, fr + (tr - fr) * t))
  }
  return swap ? out.reverse() : out
}


export type WormholeSignal = 'wreck' | 'ship' | 'resource' | 'radar' | 'beacon' | 'research'

export type WormholePlace = 'empty' | 'graveyard' | 'ruins' | 'ship' | 'vein' | 'matter' | 'beacon' | 'research'

export type WormholeEventKey = 'maintenance' | 'transport' | 'controller' | 'relay' | 'storm' | 'distress'
export const WORMHOLE_EVENT_KEYS: readonly WormholeEventKey[] = ['maintenance', 'transport', 'controller', 'relay', 'storm', 'distress']
export function isWormholeEventKey(value: unknown): value is WormholeEventKey {
  return WORMHOLE_EVENT_KEYS.some(key => key === value)
}

export const WORMHOLE_SIGNAL_WEIGHTS: Readonly<Record<WormholeSignal, number>> = {
  ship: 28,
  wreck: 28,
  resource: 22,
  radar: 12,
  beacon: 10,
  research: 0,
}


export const WORMHOLE_ARCHETYPES: readonly WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']

export const WORMHOLE_ARCHETYPE_WEIGHTS: Readonly<Record<WormholeArchetype, number>> = {
  balanced: 40,
  wreck: 20,
  ruins: 15,
  vein: 15,
  combat: 10,
}

export const WORMHOLE_ARCHETYPE_LABELS: Readonly<Record<WormholeArchetype, string>> = {
  balanced: '均衡深区',
  wreck: '残骸富集',
  ruins: '遗迹密集',
  vein: '母矿脉',
  combat: '交火密集',
}

export const WORMHOLE_ARCHETYPE_IDS: Readonly<Record<WormholeArchetype, string>> = {
  balanced: 'core.wormholeArch.001',
  wreck: 'core.wormholeArch.002',
  ruins: 'core.wormholeArch.003',
  vein: 'core.wormholeArch.004',
  combat: 'core.wormholeArch.005',
}

const ARCHETYPE_ORDER: readonly WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']

export function wormholeArchetypeOf(seed: number): WormholeArchetype {
  let total = 0
  for (const k of ARCHETYPE_ORDER) total += WORMHOLE_ARCHETYPE_WEIGHTS[k]
  const r = wormholeStream(seed * 2654435761 + 17)() * total
  let acc = 0
  for (const k of ARCHETYPE_ORDER) {
    acc += WORMHOLE_ARCHETYPE_WEIGHTS[k]
    if (r < acc) return k
  }
  return 'balanced'
}

export function wormholeSignalWeightsFor(archetype: WormholeArchetype): Readonly<Record<WormholeSignal, number>> {
  const base = WORMHOLE_SIGNAL_WEIGHTS
  const mul: Record<Exclude<WormholeSignal, 'research'>, number> =
    archetype === 'wreck'
      ? { ship: 1, wreck: 2, resource: 1, radar: 1, beacon: 1 }
      : archetype === 'ruins'
        ? { ship: 1, wreck: 1.4, resource: 1, radar: 1, beacon: 1 }
        : archetype === 'vein'
          ? { ship: 1, wreck: 1, resource: 2.2, radar: 1, beacon: 1 }
          : archetype === 'combat'
            ? { ship: 2, wreck: 1, resource: 1, radar: 1, beacon: 1 }
            : { ship: 1, wreck: 1, resource: 1, radar: 1, beacon: 1 }
  const keys = ['ship', 'wreck', 'resource', 'radar'] as const
  const raw = keys.map((k) => base[k] * mul[k])
  const rawTotal = raw.reduce((s, v) => s + v, 0)
  const target = base.ship + base.wreck + base.resource + base.radar
  const out = { ...base } as Record<WormholeSignal, number>
  let used = 0
  keys.forEach((k, i) => {
    if (i === keys.length - 1) {
      out[k] = Math.max(0, Math.round((target - used) * 10) / 10)
      return
    }
    const v = Math.max(0, Math.round((raw[i]! / rawTotal) * target * 10) / 10)
    out[k] = v
    used += v
  })
  return out
}

export function wormholeRuinsShareFor(archetype: WormholeArchetype): number {
  return archetype === 'ruins' ? 0.5 : WORMHOLE_RUINS_SHARE
}

export function wormholeRuinsFloorBonusFor(archetype: WormholeArchetype): number {
  return archetype === 'ruins' ? 1 : 0
}

export const WORMHOLE_EMPTY_MIN_SHARE = 0.5

export const WORMHOLE_EMPTY_SHARE_PER_DEPTH = 0.01
export const WORMHOLE_EMPTY_SHARE_FLOOR = 0.32
export function wormholeEmptyShareFor(depth: number, blankShareFactor = 1): number {
  const d = Math.max(1, Math.floor(depth))
  const base = Math.max(WORMHOLE_EMPTY_SHARE_FLOOR, WORMHOLE_EMPTY_MIN_SHARE - WORMHOLE_EMPTY_SHARE_PER_DEPTH * (d - 1))
  return base * Math.max(0, blankShareFactor)
}

export const WORMHOLE_RUINS_FLOOR_MIN_DEPTH = 3

export function wormholeRuinsFloorFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_RUINS_FLOOR_MIN_DEPTH) return 0
  return 1 + Math.floor((d - 1) / 2)
}

export const WORMHOLE_NEBULA_MIN_DEPTH = 4
export const WORMHOLE_NEBULA_SHARE = 0.2
export const WORMHOLE_NEBULA_SHARE_STEP = 0.02
export const WORMHOLE_NEBULA_SHARE_CAP = 0.8

export function wormholeNebulaShareFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_NEBULA_MIN_DEPTH) return 0
  return Math.min(WORMHOLE_NEBULA_SHARE_CAP, WORMHOLE_NEBULA_SHARE + WORMHOLE_NEBULA_SHARE_STEP * (d - WORMHOLE_NEBULA_MIN_DEPTH))
}

export const WORMHOLE_RUINS_SHARE = 0.3

export const WORMHOLE_MATTER_FLOOR = 1

export function signalOfPlace(place: WormholePlace): WormholeSignal | null {
  switch (place) {
    case 'empty':
      return null
    case 'graveyard':
    case 'ruins':
      return 'wreck'
    case 'research':
      return 'research'
    case 'ship':
      return 'ship'
    case 'vein':
      return 'resource'
    case 'matter':
      return 'radar'
    case 'beacon':
      return 'beacon'
  }
}

export const WORMHOLE_GRID_R_MIN = 2
export function wormholeGridRadiusFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return WORMHOLE_GRID_R_MIN + Math.floor((d - 1) / 2)
}

export const WORMHOLE_BEACON_RATE = 0.5

export const WORMHOLE_GRID_SAVE_MAX_R = 64

export const WORMHOLE_SCAN_RADIUS_BASE = 1


export interface WormholeCellPile {
  itemId: string
  units: number
}

export interface WormholeEventInstance {
  identity?: 'genuine' | 'ambush'
  verified?: boolean
  intelKey?: string
  ruinsKey?: string
  containerId?: string
  supply?: Record<string, number>
  battle?: 'pending' | 'won'
  choice?: string
}

export interface WormholeGridCell {
  key: string
  q: number
  r: number
  place: WormholePlace
  eventKey?: WormholeEventKey
  eventResolved?: boolean
  event?: WormholeEventInstance
  elite?: boolean
  combatCleared?: boolean
  alarmDisabled?: boolean
  piles?: WormholeCellPile[]
  resourcePilesGenerated?: true
  nebula?: boolean
  foe?: { card: string; seq: number; cleared?: boolean; patrolId?: number }
}

export interface WormholeGridState {
  radius: number
  start: HexCell
  exit: HexCell
  pos: HexCell
  scanRadius: number
  scanned: string[]
  visited: string[]
  activated: string[]
  ruinsRolled?: string[]
  exitKnown?: boolean
  dispersed?: string[]
  spawnSeq?: number
  cells: WormholeGridCell[]
}

export type WormholeCellReveal =
  | { kind: 'unknown' }
  | { kind: 'signal'; signal: WormholeSignal | null; elite?: true }
  | { kind: 'nebula' }
  | { kind: 'foe'; under: WormholeCellReveal }
  | { kind: 'known'; signal: WormholeSignal | null; place: WormholePlace; elite?: true }

export function gridCellAt(grid: WormholeGridState, cell: HexCell): WormholeGridCell | undefined {
  return grid.cells.find((c) => c.key === hexKey(cell.q, cell.r))
}

export function markExitKnown(grid: WormholeGridState): void {
  grid.exitKnown = true
  const key = hexKey(grid.exit.q, grid.exit.r)
  if (!grid.scanned.includes(key)) grid.scanned.push(key)
}

export function revealNearestMatterCell(
  grid: WormholeGridState,
  from: HexCell,
): { cell: WormholeGridCell; nebulaDispersed: boolean } | null {
  let best: WormholeGridCell | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const c of grid.cells) {
    if (c.place !== 'matter') continue
    if (grid.scanned.includes(c.key)) continue
    if (grid.visited.includes(c.key)) continue
    const d = hexDistance(from, { q: c.q, r: c.r })
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  if (!best) return null
  grid.scanned.push(best.key)
  const nebulaDispersed = isNebulaFogged(grid, best)
  if (nebulaDispersed) disperseNebulae(grid, [{ q: best.q, r: best.r }])
  return { cell: best, nebulaDispersed }
}

export function triggerBeaconEffect(
  grid: WormholeGridState,
  cell: WormholeGridCell,
): { kind: 'exit' } | { kind: 'matter'; cell: WormholeGridCell; nebulaDispersed: boolean } | { kind: 'empty' } {
  if (cell.place !== 'beacon' || grid.activated.includes(cell.key)) return { kind: 'empty' }
  const beaconNo = grid.activated.filter(key => grid.cells.find(c => c.key === key)?.place === 'beacon').length + 1
  grid.activated.push(cell.key)
  if (beaconNo <= 1) {
    markExitKnown(grid)
    return { kind: 'exit' }
  }
  const reveal = revealNearestMatterCell(grid, cell)
  return reveal ? { kind: 'matter', ...reveal } : { kind: 'empty' }
}


export const WORMHOLE_SPAWN_MIN_DEPTH = 7

export const WORMHOLE_SPAWN_CAP_SHARE = 0.5

export function hasLiveFoe(cell: WormholeGridCell): boolean {
  return cell.foe !== undefined && cell.foe.cleared !== true
}

export function spawnAliveCount(grid: WormholeGridState): number {
  return grid.cells.reduce((n, c) => n + (hasLiveFoe(c) ? 1 : 0), 0)
}

export function spawnCapOf(grid: WormholeGridState): number {
  return Math.floor(grid.cells.length * WORMHOLE_SPAWN_CAP_SHARE)
}

export function spawnTargetsOf(grid: WormholeGridState): WormholeGridCell[] {
  const exitKey = hexKey(grid.exit.q, grid.exit.r)
  return grid.cells.filter((c) => {
    if (c.key === exitKey) return false
    if (hasLiveFoe(c)) return false
    if (c.place === 'ship' && !grid.activated.includes(c.key)) return false
    if (c.foe?.cleared === true) return false
    return true
  })
}


export function wormholePathInterceptAt(
  grid: WormholeGridState,
  target: HexCell,
): WormholeGridCell | undefined {
  const line = hexLine(grid.pos, target)
  for (let i = 1; i < line.length - 1; i++) {
    const cell = gridCellAt(grid, line[i]!)
    if (!cell) continue
    const liveFoe = hasLiveFoe(cell)
    if (cell.place !== 'ship' && !liveFoe) continue
    if (cell.place === 'ship' && !liveFoe && grid.activated.includes(cell.key)) continue
    if (cell.combatCleared && !liveFoe) continue
    return cell
  }
  return undefined
}

export function revealOf(grid: WormholeGridState, cell: HexCell): WormholeCellReveal {
  const c = gridCellAt(grid, cell)
  if (!c) return { kind: 'unknown' }
  const under = revealWithoutFoe(grid, c)
  if (hasLiveFoe(c)) return { kind: 'foe', under }
  return under
}

function revealWithoutFoe(grid: WormholeGridState, c: WormholeGridCell): WormholeCellReveal {
  if (grid.visited.includes(c.key)) return { kind: 'known', signal: signalOfCell(c), place: c.place, ...(c.elite ? { elite: true as const } : {}) }
  if (grid.scanned.includes(c.key)) {
    if (c.nebula === true && !(grid.dispersed ?? []).includes(c.key)) return { kind: 'nebula' }
    return { kind: 'signal', signal: signalOfCell(c), ...(c.elite ? { elite: true as const } : {}) }
  }
  return { kind: 'unknown' }
}

export function signalOfCell(cell: WormholeGridCell): WormholeSignal | null {
  return cell.eventKey ? 'radar' : signalOfPlace(cell.place)
}


export function isNebulaFogged(grid: WormholeGridState, cell: WormholeGridCell): boolean {
  return cell.nebula === true && !(grid.dispersed ?? []).includes(cell.key)
}

export function gridNebulaTargets(grid: WormholeGridState, extraRadius = 0): HexCell[] {
  const r = Math.max(0, Math.floor(grid.scanRadius + extraRadius))
  return hexDiskAround(grid.pos, r).filter((c) => {
    const cell = gridCellAt(grid, c)
    return !!cell && grid.scanned.includes(cell.key) && isNebulaFogged(grid, cell)
  })
}

export function gridNebulaDisperseTargets(
  grid: WormholeGridState,
  extraRadius = 0,
  extraCount = 0,
): HexCell[] {
  const inRing = gridNebulaTargets(grid, extraRadius)
  if (extraCount <= 0) return inRing
  const r = Math.max(0, Math.floor(grid.scanRadius + extraRadius))
  const keys = new Set(inRing.map((c) => hexKey(c.q, c.r)))
  const outside = grid.cells
    .filter((c) => !keys.has(c.key) && grid.scanned.includes(c.key) && isNebulaFogged(grid, c))
    .filter((c) => hexDistance(grid.pos, c) > r)
    .sort((a, b) => hexDistance(grid.pos, a) - hexDistance(grid.pos, b) || (a.key < b.key ? -1 : 1))
    .slice(0, Math.max(0, Math.floor(extraCount)))
  return [...inRing, ...outside.map((c) => ({ q: c.q, r: c.r }))]
}

export function disperseNebulae(grid: WormholeGridState, cells: readonly HexCell[]): string[] {
  const done: string[] = []
  for (const c of cells) {
    const cell = gridCellAt(grid, c)
    if (!cell || !isNebulaFogged(grid, cell)) continue
    grid.dispersed = [...(grid.dispersed ?? []), cell.key]
    done.push(cell.key)
  }
  return done
}

export function gridScanTargets(grid: WormholeGridState, extraRadius = 0): HexCell[] {
  const r = Math.max(0, Math.floor(grid.scanRadius + extraRadius))
  return hexDiskAround(grid.pos, r).filter((c) => {
    const cell = gridCellAt(grid, c)
    return !!cell && !grid.scanned.includes(cell.key)
  })
}

export const WORMHOLE_TURN_PER_MOVE = 1
export const WORMHOLE_TURN_PER_SCAN = 1
export const WORMHOLE_TURN_PER_WORK = 1
export const WORMHOLE_TURN_PER_PICK = 1


export function wormholeRng(seed: number): () => number {
  let s = (Math.floor(seed) % 2147483647) || 1
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function wormholeHash32(n: number): number {
  let x = Math.floor(n) | 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

export function wormholeStream(seed: number): () => number {
  return wormholeRng(wormholeHash32(seed))
}

export function pickSignal(rnd: number, weights: Readonly<Record<WormholeSignal, number>> = WORMHOLE_SIGNAL_WEIGHTS): WormholeSignal {
  const order: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar', 'beacon']
  const total = order.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0)
  if (!(total > 0)) return 'ship'
  let acc = rnd * total
  for (const k of order) {
    acc -= Math.max(0, weights[k] ?? 0)
    if (acc < 0) return k
  }
  return order[order.length - 1]!
}

export function pickPlace(signal: WormholeSignal, rnd: number, ruinsShare: number = WORMHOLE_RUINS_SHARE): WormholePlace {
  switch (signal) {
    case 'ship':
      return 'ship'
    case 'resource':
      return 'vein'
    case 'radar':
      return 'matter'
    case 'beacon':
      return 'beacon'
    case 'research':
      return 'research'
    case 'wreck':
      return rnd < ruinsShare ? 'ruins' : 'graveyard'
  }
}

export function wormholeMakeGrid(seed: number, depth: number, extraScanRadius = 0, blankShareFactor = 1, expeditionRules?: number, legacyAuto = false): WormholeGridState {
  const rng = wormholeStream(seed * 7919 + depth * 104729)
  const radius = expeditionRules === 2 ? (depth <= 2 ? 2 : depth <= 4 ? 3 : 4) : wormholeGridRadiusFor(depth)
  const all = hexDiskCells(radius)
  const outer = all.filter((c) => hexDistance(c, { q: 0, r: 0 }) === radius)
  const start = outer[Math.min(outer.length - 1, Math.floor(rng() * outer.length))]!
  const rest = all.filter((c) => !(c.q === start.q && c.r === start.r))
  const exit = rest[Math.min(rest.length - 1, Math.floor(rng() * rest.length))]!
  const others = all.filter((c) => !(c.q === exit.q && c.r === exit.r))
  const nAll = all.length
  const emptyCount = Math.max(0, Math.ceil((nAll - 1) * wormholeEmptyShareFor(depth, blankShareFactor)))
  const shuffled = [...others]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = t
  }
  const emptyKeys = new Set(shuffled.slice(0, emptyCount).map((c) => hexKey(c.q, c.r)))
  const pool = others.filter((c) => !emptyKeys.has(hexKey(c.q, c.r)))
  const order: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar', 'beacon']
  const archetype = wormholeArchetypeOf(seed)
  const signalWeights = wormholeSignalWeightsFor(archetype)
  const ruinsShare =
    depth < WORMHOLE_RUINS_FLOOR_MIN_DEPTH
      ? depth === 1
        ? 0
        : WORMHOLE_RUINS_SHARE
      : wormholeRuinsShareFor(archetype)
  const totalW = order.reduce((s, k) => s + signalWeights[k], 0)
  const quota = order.map((k) => {
    const exact = (pool.length * signalWeights[k]) / totalW
    return { k, n: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let left = pool.length - quota.reduce((s, q) => s + q.n, 0)
  for (const q of [...quota].sort((a, b) => b.frac - a.frac || order.indexOf(a.k) - order.indexOf(b.k))) {
    if (left <= 0) break
    q.n += 1
    left -= 1
  }
  const quotaOf = (k: WormholeSignal): { n: number; frac: number } => quota.find((q) => q.k === k)!
  const ruinsFloorWanted = expeditionRules === 2 ? Math.min(5, wormholeRuinsFloorFor(depth) + wormholeRuinsFloorBonusFor(archetype)) : wormholeRuinsFloorFor(depth) + wormholeRuinsFloorBonusFor(archetype)
  let wreckN = quotaOf('wreck').n
  while (Math.round(wreckN * ruinsShare) < ruinsFloorWanted && wreckN < pool.length) {
    const donor = quotaOf('resource').n > 1 ? 'resource' : quotaOf('radar').n > 1 ? 'radar' : null
    if (!donor) break
    quotaOf(donor).n -= 1
    wreckN += 1
  }
  quotaOf('wreck').n = wreckN
  {
    const beaconSlots = quotaOf('beacon').n
    const beaconRng = wormholeStream(seed * 7919 + depth * 104729 + 29)
    let beaconN = 0
    for (let i = 0; i < beaconSlots; i++) if (beaconRng() < WORMHOLE_BEACON_RATE) beaconN += 1
    if (beaconSlots > 0 && beaconN === 0) beaconN = 1
    quotaOf('beacon').n = beaconN
    const freed = beaconSlots - beaconN
    if (freed > 0) {
      const rest = order.filter((k) => k !== 'beacon')
      const restW = rest.reduce((s, k) => s + signalWeights[k], 0)
      const add = rest.map((k) => {
        const exact = (freed * signalWeights[k]) / restW
        return { k, n: Math.floor(exact), frac: exact - Math.floor(exact) }
      })
      let restLeft = freed - add.reduce((s, a) => s + a.n, 0)
      for (const a of [...add].sort((x, y) => y.frac - x.frac || order.indexOf(x.k) - order.indexOf(y.k))) {
        if (restLeft <= 0) break
        a.n += 1
        restLeft -= 1
      }
      for (const a of add) quotaOf(a.k).n += a.n
    }
  }
  const signalOfCell = new Map<string, WormholeSignal>()
  let at = 0
  const poolShuffled = [...pool]
  const orderRng = wormholeStream(seed * 7919 + depth * 104729 + 17)
  for (let i = poolShuffled.length - 1; i > 0; i--) {
    const j = Math.floor(orderRng() * (i + 1))
    const t = poolShuffled[i]!
    poolShuffled[i] = poolShuffled[j]!
    poolShuffled[j] = t
  }
  for (const q of order) {
    const bucket = quota.find((x) => x.k === q)!
    for (let i = 0; i < bucket.n; i++) {
      const c = poolShuffled[at++]
      if (c) signalOfCell.set(hexKey(c.q, c.r), q)
    }
  }
  const startKey = hexKey(start.q, start.r)
  if (signalOfCell.get(startKey) === 'beacon') {
    const swap = all.find((c) => {
      const k = hexKey(c.q, c.r)
      if (k === startKey) return false
      if (c.q === exit.q && c.r === exit.r) return false
      const s = signalOfCell.get(k)
      return s !== undefined && s !== 'beacon'
    })
    if (swap) {
      const swapKey = hexKey(swap.q, swap.r)
      signalOfCell.set(startKey, signalOfCell.get(swapKey)!)
      signalOfCell.set(swapKey, 'beacon')
    }
  }
  const cells: WormholeGridCell[] = all.map((c) => {
    const key = hexKey(c.q, c.r)
    const sig = signalOfCell.get(key)
    const place: WormholePlace = sig ? pickPlace(sig, rng(), ruinsShare) : 'empty'
    return { key, q: c.q, r: c.r, place }
  })
  const ruinsFloor = depth >= WORMHOLE_RUINS_FLOOR_MIN_DEPTH ? ruinsFloorWanted : 0
  let ruinsNow = cells.filter((c) => c.place === 'ruins').length
  if (ruinsNow < ruinsFloor) {
    for (const c of cells) {
      if (ruinsNow >= ruinsFloor) break
      if (c.place !== 'graveyard') continue
      c.place = 'ruins'
      ruinsNow += 1
    }
  }
  if (depth >= 1) {
    let matterNow = cells.filter((c) => c.place === 'matter').length
    if (matterNow < WORMHOLE_MATTER_FLOOR) {
      for (const c of cells) {
        if (matterNow >= WORMHOLE_MATTER_FLOOR) break
        if (c.key === startKey) continue
        if (c.q === exit.q && c.r === exit.r) continue
        if (c.place !== 'empty') continue
        c.place = 'matter'
        matterNow += 1
      }
    }
  }
  if (depth >= WORMHOLE_NEBULA_MIN_DEPTH) {
    const exitKey = hexKey(exit.q, exit.r)
    const candidates = cells.filter((c) => c.place !== 'empty' && c.key !== exitKey)
    const quotaN = Math.ceil(candidates.length * wormholeNebulaShareFor(depth))
    if (quotaN > 0) {
      const nebRng = wormholeStream(seed * 6619 + depth * 81173)
      const idx = candidates.map((_, i) => i)
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(nebRng() * (i + 1))
        const t = idx[i]!
        idx[i] = idx[j]!
        idx[j] = t
      }
      for (const i of idx.slice(0, quotaN)) candidates[i]!.nebula = true
    }
  }
  if (expeditionRules === 2) {
    const ordinaryCap = depth <= 3 ? 2 : depth <= 6 ? 3 : 4
    for (const cell of cells.filter(c => c.place === 'ship').slice(ordinaryCap)) { cell.place = 'empty'; delete cell.nebula }
    const candidates = cells.filter(c => c.place === 'empty' && c.key !== startKey && c.key !== hexKey(exit.q, exit.r))
    const rngEvent = wormholeStream(seed * 31 + depth * 7919 + 131)
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rngEvent() * (i + 1)); const cell = candidates[i]!; candidates[i] = candidates[j]!; candidates[j] = cell
    }
    if (candidates.length < (depth >= 3 ? 3 : 2)) throw new Error('虫洞事件配额无法满足')
    candidates[0]!.eventKey = rngEvent() < 0.5 ? 'maintenance' : 'transport'
    const choices: WormholeEventKey[] = cells.some(c => c.place === 'ruins') ? ['controller', 'relay', 'storm', 'distress'] : ['relay', 'storm', 'distress']
    candidates[1]!.eventKey = choices[Math.floor(rngEvent() * choices.length)]!
    const ruins = cells.filter(c => c.place === 'ruins')
    const supply = candidates[0]!
    const risk = candidates[1]!
    supply.event = {}
    risk.event = {
      ...(risk.eventKey === 'distress' ? { identity: rngEvent() < 0.5 ? 'genuine' as const : 'ambush' as const, intelKey: ruins[0]?.key ?? supply.key } : {}),
      ...(risk.eventKey === 'controller' ? { ruinsKey: ruins[Math.floor(rngEvent() * ruins.length)]!.key } : {}),
    }
    if (depth >= 3) {
      const elite = candidates[2]!
      elite.place = 'ship'
      elite.elite = true
    }
  }
  if (depth >= 8 && expeditionRules === undefined && !legacyAuto) {
    const labRng = wormholeStream(seed * 9973 + depth * 8647 + 501)
    const eligible = cells.filter(c => c.place === 'empty' && !c.eventKey && c.key !== startKey && c.key !== hexKey(exit.q, exit.r))
    if (labRng() < 0.4 && eligible.length > 0) {
      const cell = eligible[Math.floor(labRng() * eligible.length)]!
      cell.place = 'research'
    }
  }
  return {
    radius,
    start: { q: start.q, r: start.r },
    exit: { q: exit.q, r: exit.r },
    pos: { q: start.q, r: start.r },
    scanRadius: WORMHOLE_SCAN_RADIUS_BASE + Math.max(0, Math.floor(extraScanRadius)),
    scanned: [hexKey(start.q, start.r)],
    visited: [hexKey(start.q, start.r)],
    activated: [],
    exitKnown: false,
    cells,
  }
}


export function gridTally(grid: WormholeGridState): {
  total: number
  empty: number
  bySignal: Record<WormholeSignal, number>
  byPlace: Record<WormholePlace, number>
} {
  const bySignal: Record<WormholeSignal, number> = { wreck: 0, ship: 0, resource: 0, radar: 0, beacon: 0, research: 0 }
  const byPlace: Record<WormholePlace, number> = { empty: 0, graveyard: 0, ruins: 0, ship: 0, vein: 0, matter: 0, beacon: 0, research: 0 }
  for (const c of grid.cells) {
    byPlace[c.place] += 1
    const s = signalOfPlace(c.place)
    if (s) bySignal[s] += 1
  }
  return { total: grid.cells.length, empty: byPlace.empty, bySignal, byPlace }
}

export function isExitCell(grid: WormholeGridState, cell: HexCell): boolean {
  return grid.exit.q === cell.q && grid.exit.r === cell.r
}

export function gridContentIndex(grid: WormholeGridState, cell: HexCell = grid.pos): number {
  const n = Math.abs(cell.q * 7 + cell.r * 13 + grid.radius * 3)
  return n % 8
}

export const WORMHOLE_EXIT_KIND: WormholeFoeKind = 'boss'
