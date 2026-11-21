
export const WORMHOLE_HOLD_COLS = 8
export const WORMHOLE_SLOT_M3 = 500
export const WORMHOLE_CARGO_BAR_MAX = 4
export const WORMHOLE_CARGO_PIECE: WormholeHoldShape = { w: 1, h: 1 }

export interface WormholeHoldShape {
  w: number
  h: number
}

export const WORMHOLE_SHAPE_STACK: WormholeHoldShape = { w: 1, h: 1 }
export const WORMHOLE_SHAPE_CONTAINER: WormholeHoldShape = { w: 2, h: 2 }
export const WORMHOLE_SHAPE_BPBOX: WormholeHoldShape = { w: 2, h: 1 }
export const WORMHOLE_SHAPE_CONTAINER6: WormholeHoldShape = { w: 3, h: 2 }
export const WORMHOLE_SHAPE_CORE: WormholeHoldShape = { w: 1, h: 1 }

export const WORMHOLE_HOLD_SHAPES: Readonly<Record<string, WormholeHoldShape>> = {
  'box-relic-a': WORMHOLE_SHAPE_CONTAINER6,
  'box-relic-c': WORMHOLE_SHAPE_CONTAINER6,
  'box-relic-d': WORMHOLE_SHAPE_CONTAINER6,
  'box-relic-e': WORMHOLE_SHAPE_CONTAINER6,
  'box-relic-g': WORMHOLE_SHAPE_CONTAINER6,
  'box-valuables': WORMHOLE_SHAPE_CONTAINER,
  'box-military': WORMHOLE_SHAPE_CONTAINER,
  'box-bp-shallow': WORMHOLE_SHAPE_BPBOX,
  'box-bp-mid': WORMHOLE_SHAPE_BPBOX,
  'box-bp-deep': WORMHOLE_SHAPE_BPBOX,
  'box-encrypted-a': WORMHOLE_SHAPE_BPBOX,
  'box-encrypted-c': WORMHOLE_SHAPE_BPBOX,
  'box-encrypted-d': WORMHOLE_SHAPE_BPBOX,
  'box-encrypted-e': WORMHOLE_SHAPE_BPBOX,
  'box-encrypted-g': WORMHOLE_SHAPE_BPBOX,
  'ai-core-gamma': WORMHOLE_SHAPE_CORE,
  'ai-core-beta': WORMHOLE_SHAPE_CORE,
  'ai-core-alpha': WORMHOLE_SHAPE_CORE,
  'mat-surveyor': WORMHOLE_SHAPE_CONTAINER,
  'mat-chrono': WORMHOLE_SHAPE_CONTAINER,
  'mat-crane': WORMHOLE_SHAPE_CONTAINER,
  'mat-drill': WORMHOLE_SHAPE_CONTAINER,
  'mat-nebula': WORMHOLE_SHAPE_CONTAINER,
  'mat-enricher': WORMHOLE_SHAPE_CONTAINER,
  'mat-expander': WORMHOLE_SHAPE_CONTAINER,
  'mat-suppressor': WORMHOLE_SHAPE_CONTAINER,
  'mat-boss-analyzer': WORMHOLE_SHAPE_CONTAINER,
  'mat-extract-cover': WORMHOLE_SHAPE_CONTAINER,
  'mat-shield-res': WORMHOLE_SHAPE_CONTAINER,
  'mat-armor-res': WORMHOLE_SHAPE_CONTAINER,
  'mat-hull-res': WORMHOLE_SHAPE_CONTAINER,
  'mat-tracker': WORMHOLE_SHAPE_CONTAINER,
  'mat-gyro': WORMHOLE_SHAPE_CONTAINER,
  'mat-jammer': WORMHOLE_SHAPE_CONTAINER,
  'mat-rangefinder': WORMHOLE_SHAPE_CONTAINER,
  'mat-blindspot': WORMHOLE_SHAPE_CONTAINER,
  'mat-ammo-dmg': WORMHOLE_SHAPE_CONTAINER,
  'mat-reload': WORMHOLE_SHAPE_CONTAINER,
  'mat-volley': WORMHOLE_SHAPE_CONTAINER,
  'mat-ammo-back': WORMHOLE_SHAPE_CONTAINER,
  'mat-drone-net': WORMHOLE_SHAPE_CONTAINER,
  'mat-field-repair': WORMHOLE_SHAPE_CONTAINER,
}

export function wormholeIsShapedItem(itemId: string): boolean {
  return WORMHOLE_HOLD_SHAPES[itemId] !== undefined
}

export function wormholeShapeOf(itemId: string): WormholeHoldShape {
  return WORMHOLE_HOLD_SHAPES[itemId] ?? WORMHOLE_SHAPE_STACK
}

export interface WormholeHoldPlacement {
  id: string
  itemId: string
  kind: 'box' | 'cargo'
  units?: number
  supply?: true
  x: number
  y: number
  w: number
  h: number
  fill?: number
}

export interface WormholeHoldState {
  cols: number
  placements: WormholeHoldPlacement[]
}

export function makeHoldState(cols: number = WORMHOLE_HOLD_COLS): WormholeHoldState {
  return { cols: Math.max(1, Math.floor(cols)), placements: [] }
}

export function cargoShapesFor(cells: number): WormholeHoldShape[] {
  const n = Math.max(1, Math.floor(cells))
  if (n === 1) return [{ w: 1, h: 1 }]
  if (n <= WORMHOLE_CARGO_BAR_MAX) {
    return [
      { w: n, h: 1 },
      { w: 1, h: n },
    ]
  }
  const set = new Map<string, WormholeHoldShape>()
  const push = (w: number, h: number): void => {
    if (w < 1 || h < 1 || w > WORMHOLE_HOLD_COLS || h > 64) return
    set.set(`${w}x${h}`, { w, h })
  }
  for (let w = 2; w <= WORMHOLE_HOLD_COLS; w++) {
    const h = Math.max(2, Math.ceil(n / w))
    push(w, h)
    push(h, w)
  }
  push(WORMHOLE_HOLD_COLS, Math.max(1, Math.ceil(n / WORMHOLE_HOLD_COLS)))
  push(n, 1)
  push(1, n)
  return [...set.values()].sort((a, b) => {
    const blocky = (s: WormholeHoldShape): number => (s.w >= 2 && s.h >= 2 ? 0 : 1)
    return blocky(a) - blocky(b) || a.w * a.h - b.w * b.h || a.h - b.h || b.w - a.w
  })
}

export function cargoBlockArea(cells: number): number {
  return Math.max(1, Math.floor(cells))
}

export function placementFill(p: WormholeHoldPlacement): number {
  const box = Math.max(0, p.w) * Math.max(0, p.h)
  if (p.fill === undefined) return box
  return Math.max(0, Math.min(box, Math.floor(p.fill)))
}

export function cargoShapeFits(cells: number, shape: WormholeHoldShape, fill?: number): boolean {
  const n = Math.max(1, Math.floor(cells))
  if (!cargoShapesFor(n).some((s) => s.w === shape.w && s.h === shape.h)) return false
  return (fill === undefined ? shape.w * shape.h : Math.max(0, Math.floor(fill))) === n
}


export function placementCells(p: WormholeHoldPlacement): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  const n = placementFill(p)
  let k = 0
  for (let dy = 0; dy < p.h && k < n; dy++) {
    for (let dx = 0; dx < p.w && k < n; dx++) {
      out.push({ x: p.x + dx, y: p.y + dy })
      k += 1
    }
  }
  return out
}

export function placementCellsCount(p: WormholeHoldPlacement): number {
  return placementFill(p)
}

export function holdCellsUsed(hold: WormholeHoldState | undefined): number {
  if (!hold) return 0
  return hold.placements.reduce((s, p) => s + placementCellsCount(p), 0)
}

export function holdRows(capacity: number, cols: number = WORMHOLE_HOLD_COLS): number {
  return Math.max(1, Math.ceil(Math.max(0, capacity) / Math.max(1, cols)))
}

export function placementInBounds(
  x: number,
  y: number,
  shape: WormholeHoldShape,
  capacity: number,
  cols: number = WORMHOLE_HOLD_COLS,
  fill?: number,
): boolean {
  if (x < 0 || y < 0 || shape.w <= 0 || shape.h <= 0) return false
  if (x + shape.w > cols) return false
  const box = shape.w * shape.h
  const n = fill === undefined ? box : Math.max(0, Math.min(box, Math.floor(fill)))
  if (n <= 0) return false
  const lastDy = Math.floor((n - 1) / shape.w)
  const lastDx = (n - 1) % shape.w
  const last = (y + lastDy) * cols + (x + lastDx)
  return last < capacity
}

export function placementOverlaps(
  hold: WormholeHoldState,
  x: number,
  y: number,
  shape: WormholeHoldShape,
  skipId?: string,
  fill?: number,
): boolean {
  const occupied = new Set<string>()
  for (const p of hold.placements) {
    if (skipId !== undefined && p.id === skipId) continue
    for (const c of placementCells(p)) occupied.add(`${c.x},${c.y}`)
  }
  const box = shape.w * shape.h
  const n = fill === undefined ? box : Math.max(0, Math.min(box, Math.floor(fill)))
  let k = 0
  for (let dy = 0; dy < shape.h && k < n; dy++) {
    for (let dx = 0; dx < shape.w && k < n; dx++) {
      if (occupied.has(`${x + dx},${y + dy}`)) return true
      k += 1
    }
  }
  return false
}

export function canPlace(
  hold: WormholeHoldState,
  x: number,
  y: number,
  shape: WormholeHoldShape,
  capacity: number,
  skipId?: string,
  fill?: number,
): boolean {
  if (!placementInBounds(x, y, shape, capacity, hold.cols, fill)) return false
  return !placementOverlaps(hold, x, y, shape, skipId, fill)
}


let placementSeq = 0
function nextPlacementId(): string {
  placementSeq += 1
  return `h${Date.now().toString(36)}${placementSeq.toString(36)}`
}

export function findFreeSpot(
  hold: WormholeHoldState,
  shape: WormholeHoldShape,
  capacity: number,
  reverse = false,
  fill?: number,
): { x: number; y: number } | null {
  const rows = holdRows(capacity, hold.cols)
  const ys = reverse ? Array.from({ length: rows }, (_, i) => rows - 1 - i) : Array.from({ length: rows }, (_, i) => i)
  for (const y of ys) {
    const xs = reverse
      ? Array.from({ length: hold.cols }, (_, i) => hold.cols - 1 - i)
      : Array.from({ length: hold.cols }, (_, i) => i)
    for (const x of xs) {
      if (x + shape.w > hold.cols) continue
      if (canPlace(hold, x, y, shape, capacity, undefined, fill)) return { x, y }
    }
  }
  return null
}

export function boxRoomCount(hold: WormholeHoldState, capacity: number): number {
  const rows = holdRows(capacity, hold.cols)
  let n = 0
  for (let y = 0; y + 2 <= rows; y++) {
    for (let x = 0; x + 2 <= hold.cols; x++) {
      if (canPlace(hold, x, y, WORMHOLE_SHAPE_CONTAINER, capacity)) n += 1
    }
  }
  return n
}

export function findCargoSpot(
  hold: WormholeHoldState,
  shape: WormholeHoldShape,
  fill: number | undefined,
  capacity: number,
): { x: number; y: number } | null {
  const rows = holdRows(capacity, hold.cols)
  const spots: Array<{ x: number; y: number }> = []
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = hold.cols - 1; x >= 0; x--) {
      if (x + shape.w > hold.cols) continue
      if (canPlace(hold, x, y, shape, capacity, undefined, fill)) spots.push({ x, y })
    }
  }
  if (spots.length === 0) return null
  const n = fill === undefined ? shape.w * shape.h : Math.max(0, Math.min(shape.w * shape.h, Math.floor(fill)))
  let best = spots[0]!
  let bestRoom = -1
  for (const s of spots) {
    const probe: WormholeHoldState = {
      cols: hold.cols,
      placements: [
        ...hold.placements,
        { id: '__probe', itemId: '', kind: 'cargo', units: 0, x: s.x, y: s.y, w: shape.w, h: shape.h, fill: n },
      ],
    }
    const room = boxRoomCount(probe, capacity)
    if (room > bestRoom) {
      bestRoom = room
      best = s
      if (room > 0) break
    }
  }
  return best
}

function roomAfter(
  hold: WormholeHoldState,
  shape: WormholeHoldShape,
  fill: number,
  capacity: number,
  spot: { x: number; y: number },
): number {
  const probe: WormholeHoldState = {
    cols: hold.cols,
    placements: [
      ...hold.placements,
      { id: '__probe', itemId: '', kind: 'cargo', units: 0, x: spot.x, y: spot.y, w: shape.w, h: shape.h, fill },
    ],
  }
  return boxRoomCount(probe, capacity)
}

export function bestCargoPlacement(
  hold: WormholeHoldState,
  cells: number,
  capacity: number,
): { shape: WormholeHoldShape; fill: number; spot: { x: number; y: number } } | null {
  const n = Math.max(1, Math.floor(cells))
  let fallback: { shape: WormholeHoldShape; fill: number; spot: { x: number; y: number } } | null = null
  for (const shape of cargoShapesFor(n)) {
    const fill = Math.min(n, shape.w * shape.h)
    const spot = findCargoSpot(hold, shape, fill, capacity)
    if (!spot) continue
    if (roomAfter(hold, shape, fill, capacity, spot) > 0) return { shape, fill, spot }
    if (!fallback) fallback = { shape, fill, spot }
  }
  return fallback
}

export function holdAdd(
  hold: WormholeHoldState,
  itemId: string,
  capacity: number,
): { ok: boolean; placement?: WormholeHoldPlacement; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const shape = wormholeShapeOf(itemId)
  if (!wormholeIsShapedItem(itemId)) {
    return { ok: false, error: '这件东西是可叠加散货：应该走散货条（holdAddCargo）。', errorId: 'core.wormholeHold.001' }
  }
  if (capacity <= 0) {
    return { ok: false, error: '货仓格数为 0：放不下任何形状件。', errorId: 'core.wormholeHold.002' }
  }
  const spot = findFreeSpot(hold, shape, capacity)
  if (!spot) {
    return {
      ok: false,
      error: `货仓放不下：这件要占 ${shape.w}×${shape.h} = ${shape.w * shape.h} 格。`,
      errorId: 'core.wormholeHold.003',
      errorParams: { p1: shape.w, p2: shape.h, p3: shape.w * shape.h },
    }
  }
  const p: WormholeHoldPlacement = {
    id: nextPlacementId(),
    itemId,
    kind: 'box',
    x: spot.x,
    y: spot.y,
    w: shape.w,
    h: shape.h,
  }
  hold.placements.push(p)
  return { ok: true, placement: p }
}

export function holdAddCargo(
  hold: WormholeHoldState,
  itemId: string,
  units: number,
  cells: number,
  capacity: number,
): { ok: boolean; placement?: WormholeHoldPlacement; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const n = Math.max(1, Math.floor(cells))
  if (capacity <= 0) {
    return { ok: false, error: '货仓格数为 0：放不下任何东西。', errorId: 'core.wormholeHold.004' }
  }
  const pick = bestCargoPlacement(hold, n, capacity)
  if (pick) {
    const p: WormholeHoldPlacement = {
      id: nextPlacementId(),
      itemId,
      kind: 'cargo',
      units: Math.max(0, Math.floor(units)),
      x: pick.spot.x,
      y: pick.spot.y,
      w: pick.shape.w,
      h: pick.shape.h,
      ...(pick.fill === pick.shape.w * pick.shape.h ? {} : { fill: pick.fill }),
    }
    hold.placements.push(p)
    return { ok: true, placement: p }
  }
  return {
    ok: false,
    error: `货仓放不下：这件散货要占 ${n} 格（货仓只剩更少可用格）。`,
    errorId: 'core.wormholeHold.005',
    errorParams: { p1: n },
  }
}

export function holdMove(
  hold: WormholeHoldState,
  id: string,
  x: number,
  y: number,
  capacity: number,
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const p = hold.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '没有这个件。', errorId: 'core.wormholeHold.006' }
  if (!canPlace(hold, x, y, { w: p.w, h: p.h }, capacity, id, placementFill(p))) {
    return { ok: false, error: '这里放不下。', errorId: 'core.wormholeHold.007' }
  }
  p.x = x
  p.y = y
  return { ok: true }
}

export function holdSwap(
  hold: WormholeHoldState,
  idA: string,
  idB: string,
  capacity: number,
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const a = hold.placements.find((q) => q.id === idA)
  const b = hold.placements.find((q) => q.id === idB)
  if (!a || !b) return { ok: false, error: '没有这个件。', errorId: 'core.wormholeHold.006' }
  if (a.id === b.id) return { ok: true }
  const ax = a.x
  const ay = a.y
  const bx = b.x
  const by = b.y
  const others = hold.placements.filter((p) => p.id !== a.id && p.id !== b.id)
  const trialA: WormholeHoldState = { cols: hold.cols, placements: [...others, { ...a, x: bx, y: by }] }
  const okB = canPlace(trialA, ax, ay, { w: b.w, h: b.h }, capacity, b.id, placementFill(b))
  const trialB: WormholeHoldState = { cols: hold.cols, placements: [...others, { ...b, x: ax, y: ay }] }
  const okA = canPlace(trialB, bx, by, { w: a.w, h: a.h }, capacity, a.id, placementFill(a))
  if (okA && okB) {
    a.x = bx
    a.y = by
    b.x = ax
    b.y = ay
    return { ok: true }
  }
  return {
    ok: false,
    error: '两件的形状对不上：换过去会互相压住（先把一件挪开，或点「整理」）。',
    errorId: 'core.wormholeHold.008',
  }
}
export function holdDropWithGrab(
  hold: WormholeHoldState,
  id: string,
  x: number,
  y: number,
  capacity: number,
  grab: { dx: number; dy: number },
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>>; x?: number; y?: number } {
  const p = hold.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '没有这个件。', errorId: 'core.wormholeHold.006' }
  const spot = pickDropSpot(hold, { w: p.w, h: p.h }, placementFill(p), x, y, capacity, grab, p.id)
  if (!spot) {
    return { ok: false, error: '这里放不下（它周围没有能摆下这块地方的位置）。', errorId: 'core.wormholeHold.009' }
  }
  p.x = spot.x
  p.y = spot.y
  return { ok: true, x: spot.x, y: spot.y }
}

export function holdTransferTo(
  from: WormholeHoldState,
  to: WormholeHoldState,
  id: string,
  toCapacity: number,
  x?: number,
  y?: number,
  grab?: { dx: number; dy: number },
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>>; x?: number; y?: number } {
  const p = from.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '没有这个件。', errorId: 'core.wormholeHold.006' }
  const shape = { w: p.w, h: p.h }
  const fill = placementFill(p)
  const spot =
    x === undefined || y === undefined
      ? findFreeSpot(to, shape, toCapacity, false, fill)
      : pickDropSpot(to, shape, fill, x, y, toCapacity, grab ?? { dx: 0, dy: 0 })
  if (!spot) {
    return { ok: false, error: '那边放不下这件东西（先整理或丢弃腾位置）。', errorId: 'core.wormholeHold.010' }
  }
  from.placements = from.placements.filter((q) => q.id !== id)
  p.x = spot.x
  p.y = spot.y
  to.placements.push(p)
  return { ok: true, x: spot.x, y: spot.y }
}

export function pickDropSpot(
  board: WormholeHoldState,
  shape: WormholeHoldShape,
  fill: number | undefined,
  x: number,
  y: number,
  capacity: number,
  grab: { dx: number; dy: number },
  skipId?: string,
): { x: number; y: number } | null {
  const maxX = Math.max(0, board.cols - shape.w)
  const maxY = Math.max(0, holdRows(capacity, board.cols) - shape.h)
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
  const dx = Math.max(0, Math.floor(grab.dx))
  const dy = Math.max(0, Math.floor(grab.dy))
  const ix = x - dx
  const iy = y - dy
  const strict = placementInBounds(ix, iy, shape, capacity, board.cols, fill)
  const cands: Array<[number, number]> = strict
    ? [[ix, iy]]
    : [
        [ix, iy],
        [clamp(ix, maxX), clamp(iy, maxY)],
        [x, y],
        [clamp(x, maxX), clamp(y, maxY)],
      ]
  const tried = new Set<string>()
  for (const [cx, cy] of cands) {
    const k = `${cx},${cy}`
    if (tried.has(k)) continue
    tried.add(k)
    if (!canPlace(board, cx, cy, shape, capacity, skipId, fill)) continue
    return { x: cx, y: cy }
  }
  return null
}

export function holdRemove(hold: WormholeHoldState, id: string): WormholeHoldPlacement | undefined {
  const i = hold.placements.findIndex((p) => p.id === id)
  if (i < 0) return undefined
  return hold.placements.splice(i, 1)[0]
}

export function holdCompact(
  hold: WormholeHoldState,
  capacity: number,
): { moved: number; unplaced: string[] } {
  const sorted = [...hold.placements].sort(
    (a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
  )
  const staged: WormholeHoldState = { cols: hold.cols, placements: [] }
  const unplaced: string[] = []
  let moved = 0
  for (const p of sorted) {
    const spot = findFreeSpot(staged, { w: p.w, h: p.h }, capacity, false, placementFill(p))
    if (!spot) {
      const overflow = findFreeSpot(
        staged,
        { w: p.w, h: p.h },
        capacity + hold.cols * (sorted.length + 2),
        false,
        placementFill(p),
      )
      staged.placements.push(overflow ? { ...p, x: overflow.x, y: overflow.y } : { ...p })
      unplaced.push(p.id)
      continue
    }
    if (spot.x !== p.x || spot.y !== p.y) moved += 1
    staged.placements.push({ ...p, x: spot.x, y: spot.y })
  }
  hold.placements = staged.placements
  return { moved, unplaced }
}


export function cleanHoldPlacement(raw: unknown): WormholeHoldPlacement | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN)
  const x = num(o.x)
  const y = num(o.y)
  const w = num(o.w)
  const h = num(o.h)
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : null
  const itemId = typeof o.itemId === 'string' && o.itemId.length > 0 ? o.itemId : null
  if (!id || !itemId) return null
  if (!(x >= 0 && y >= 0 && w >= 1 && w <= WORMHOLE_HOLD_COLS && h >= 1 && h <= 64)) return null
  const kind = o.kind === 'cargo' ? 'cargo' : 'box'
  const units = num(o.units)
  const rawFill = num(o.fill)
  const fill = kind === 'cargo' && Number.isFinite(rawFill) && rawFill >= 1 && rawFill < w * h ? rawFill : undefined
  return {
    id,
    itemId,
    kind,
    ...(o.supply === true ? { supply: true as const } : {}),
    ...(kind === 'cargo' && Number.isFinite(units) && units > 0 ? { units } : {}),
    x,
    y,
    w,
    h,
    ...(fill !== undefined ? { fill } : {}),
  }
}
