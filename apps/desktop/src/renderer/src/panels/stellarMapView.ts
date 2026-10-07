export const STELLAR_MAP_WIDTH = 1000
export const STELLAR_MAP_HEIGHT = 700
export const STELLAR_MAP_CENTER = { x: 500, y: 350 }
export const STELLAR_ZOOM_MIN = 1
export const STELLAR_ZOOM_MAX = 4
export const STELLAR_DRAG_THRESHOLD = 6

export interface MapPoint { x: number; y: number }
export interface MapMatrix { a: number; b: number; c: number; d: number; e: number; f: number }
export interface StellarMapView { zoom: number; pan: MapPoint }
export interface StellarViewBox extends MapPoint { width: number; height: number }
export interface MapPointer extends MapPoint { id: number }
export interface StellarGesture {
  pointers: readonly MapPointer[]
  view: StellarMapView
  inverse: MapMatrix
  moved: boolean
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n))
const finite = (n: number, fallback: number): number => Number.isFinite(n) ? n : fallback

export function stellarViewBox(view: StellarMapView): StellarViewBox {
  const width = STELLAR_MAP_WIDTH / view.zoom
  const height = STELLAR_MAP_HEIGHT / view.zoom
  return { x: STELLAR_MAP_CENTER.x + view.pan.x - width / 2,
    y: STELLAR_MAP_CENTER.y + view.pan.y - height / 2, width, height }
}

export function clampStellarView(view: StellarMapView): StellarMapView {
  const zoom = clamp(finite(view.zoom, 1), STELLAR_ZOOM_MIN, STELLAR_ZOOM_MAX)
  if (zoom === STELLAR_ZOOM_MIN) return { zoom, pan: { x: 0, y: 0 } }
  const width = STELLAR_MAP_WIDTH / zoom
  const height = STELLAR_MAP_HEIGHT / zoom
  // 放大后保留半个视口的边缘余量，最外侧天体也能定位到中央。
  const marginX = Math.min(width / 2, (STELLAR_MAP_WIDTH - width) / 2)
  const marginY = Math.min(height / 2, (STELLAR_MAP_HEIGHT - height) / 2)
  const maxX = (STELLAR_MAP_WIDTH - width) / 2 + marginX
  const maxY = (STELLAR_MAP_HEIGHT - height) / 2 + marginY
  return { zoom, pan: { x: clamp(finite(view.pan.x, 0), -maxX, maxX),
    y: clamp(finite(view.pan.y, 0), -maxY, maxY) } }
}

export function zoomStellarView(view: StellarMapView, zoom: number, anchor: MapPoint): StellarMapView {
  const nextZoom = clamp(finite(zoom, view.zoom), STELLAR_ZOOM_MIN, STELLAR_ZOOM_MAX)
  const ratio = view.zoom / nextZoom
  return clampStellarView({ zoom: nextZoom, pan: {
    x: anchor.x - STELLAR_MAP_CENTER.x + (STELLAR_MAP_CENTER.x + view.pan.x - anchor.x) * ratio,
    y: anchor.y - STELLAR_MAP_CENTER.y + (STELLAR_MAP_CENTER.y + view.pan.y - anchor.y) * ratio,
  } })
}

export function locateStellarView(view: StellarMapView, point: MapPoint): StellarMapView {
  return clampStellarView({ zoom: view.zoom, pan: {
    x: point.x - STELLAR_MAP_CENTER.x, y: point.y - STELLAR_MAP_CENTER.y,
  } })
}

export function mapPointThrough(point: MapPoint, matrix: MapMatrix): MapPoint {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f }
}

export function inverseMapMatrix(matrix: MapMatrix): MapMatrix | null {
  const det = matrix.a * matrix.d - matrix.b * matrix.c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  return { a: matrix.d / det, b: -matrix.b / det, c: -matrix.c / det, d: matrix.a / det,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / det,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / det }
}

export function reframeMapInverse(inverse: MapMatrix, rendered: StellarViewBox, next: StellarViewBox): MapMatrix {
  const scaleX = next.width / rendered.width, scaleY = next.height / rendered.height
  return { a: inverse.a * scaleX, b: inverse.b * scaleY, c: inverse.c * scaleX, d: inverse.d * scaleY,
    e: next.x + (inverse.e - rendered.x) * scaleX, f: next.y + (inverse.f - rendered.y) * scaleY }
}

export function mapInverseScale(inverse: MapMatrix): number {
  const sum = inverse.a ** 2 + inverse.b ** 2 + inverse.c ** 2 + inverse.d ** 2
  const det = inverse.a * inverse.d - inverse.b * inverse.c
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * det ** 2))) / 2)
}

export function stellarHitRadius(screenInverse: MapMatrix, logicalInverse?: MapMatrix | null): number {
  return 20 * Math.max(mapInverseScale(screenInverse), logicalInverse ? mapInverseScale(logicalInverse) : 0)
}

const midpoint = (a: MapPoint, b: MapPoint): MapPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: MapPoint, b: MapPoint): number => Math.hypot(a.x - b.x, a.y - b.y)

export function beginStellarGesture(pointers: readonly MapPointer[], view: StellarMapView,
  inverse: MapMatrix, moved = false): StellarGesture {
  return { pointers: pointers.slice(0, 2).map(p => ({ ...p })),
    view: { zoom: view.zoom, pan: { ...view.pan } }, inverse: { ...inverse }, moved: moved || pointers.length > 1 }
}

export function moveStellarGesture(gesture: StellarGesture, pointers: readonly MapPointer[]): {
  view: StellarMapView; moved: boolean
} {
  const start = gesture.pointers
  const current = start.map(p => pointers.find(next => next.id === p.id))
  if (!start.length || current.some(p => !p)) return { view: gesture.view, moved: gesture.moved }
  const a = start[0]!, nextA = current[0]!
  if (start.length === 1) {
    const moved = gesture.moved || distance(a, nextA) >= STELLAR_DRAG_THRESHOLD
    if (!moved) return { view: gesture.view, moved: false }
    const worldStart = mapPointThrough(a, gesture.inverse), worldNow = mapPointThrough(nextA, gesture.inverse)
    return { moved, view: clampStellarView({ zoom: gesture.view.zoom, pan: {
      x: gesture.view.pan.x - (worldNow.x - worldStart.x),
      y: gesture.view.pan.y - (worldNow.y - worldStart.y),
    } }) }
  }
  const b = start[1]!, nextB = current[1]!
  const initialDistance = distance(a, b)
  const ratio = initialDistance > 1 ? distance(nextA, nextB) / initialDistance : 1
  const zoom = clamp(gesture.view.zoom * ratio, STELLAR_ZOOM_MIN, STELLAR_ZOOM_MAX)
  const worldStart = mapPointThrough(midpoint(a, b), gesture.inverse)
  const worldNow = mapPointThrough(midpoint(nextA, nextB), gesture.inverse)
  const scale = gesture.view.zoom / zoom
  return { moved: true, view: clampStellarView({ zoom, pan: {
    x: worldStart.x - STELLAR_MAP_CENTER.x + (STELLAR_MAP_CENTER.x + gesture.view.pan.x - worldNow.x) * scale,
    y: worldStart.y - STELLAR_MAP_CENTER.y + (STELLAR_MAP_CENTER.y + gesture.view.pan.y - worldNow.y) * scale,
  } }) }
}

export function nextStellarBodyId(bodies: readonly { planetId: string; ordinal: number }[],
  selectedId: string | undefined, direction: -1 | 1): string | undefined {
  const ordered = [...bodies].sort((a, b) => a.ordinal - b.ordinal || a.planetId.localeCompare(b.planetId))
  if (!ordered.length) return undefined
  const index = ordered.findIndex(body => body.planetId === selectedId)
  if (index < 0) return ordered[direction === 1 ? 0 : ordered.length - 1]!.planetId
  return ordered[(index + direction + ordered.length) % ordered.length]!.planetId
}

export function stellarBodyAt(bodies: readonly (MapPoint & { planetId: string; radius?: number })[], point: MapPoint,
  radius: number): string | undefined {
  let nearest: string | undefined, best = Infinity
  for (const body of bodies) {
    const gap = distance(body, point)
    if (gap <= Math.max(radius, body.radius ?? 0) && gap < best) { nearest = body.planetId; best = gap }
  }
  return nearest
}

interface LabelBody extends MapPoint { planetId: string; ordinal: number; radius: number }
interface LabelRect extends MapPoint { width: number; height: number }
export interface StellarLabel extends LabelRect { planetId: string }
const overlaps = (a: LabelRect, b: LabelRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y

export function stellarOrdinalLabels(bodies: readonly LabelBody[], box: StellarViewBox,
  unit: number, selectedId?: string, stars: readonly { x: number; y: number; radius: number }[] = []): StellarLabel[] {
  const labels: StellarLabel[] = []
  const obstacles = [...bodies, ...stars].map(body => ({ x: body.x - body.radius - 3 * unit,
    y: body.y - body.radius - 3 * unit, width: 2 * body.radius + 6 * unit, height: 2 * body.radius + 6 * unit }))
  const ordered = [...bodies].sort((a, b) => Number(b.planetId === selectedId) - Number(a.planetId === selectedId)
    || a.ordinal - b.ordinal)
  for (const body of ordered) {
    const width = (String(body.ordinal).length + 1) * 8 * unit, height = 16 * unit
    const gap = body.radius + 7 * unit
    const candidates: MapPoint[] = [
      { x: body.x - width / 2, y: body.y + gap },
      { x: body.x - width / 2, y: body.y - gap - height },
      { x: body.x + gap, y: body.y - height / 2 },
      { x: body.x - gap - width, y: body.y - height / 2 },
    ]
    const position = candidates.find(point => {
      const rect = { ...point, width, height }
      return point.x >= box.x && point.y >= box.y && point.x + width <= box.x + box.width
        && point.y + height <= box.y + box.height && !obstacles.some(other => overlaps(rect, other))
        && !labels.some(other => overlaps(rect, other))
    })
    if (position) labels.push({ ...position, width, height, planetId: body.planetId })
  }
  return labels
}
