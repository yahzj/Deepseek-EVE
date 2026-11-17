
export const WORMHOLE_MAP_ZOOM_FIT = 1
export const WORMHOLE_MAP_ZOOM_STEP = 0.25
export const WORMHOLE_MAP_ZOOM_WHEEL_STEP = 0.125
export const WORMHOLE_MAP_ZOOM_MAX = 2.5

export const WORMHOLE_MAP_CELL_PX = 30

export function wormholeMapBoxOf(radius: number): { w: number; h: number } {
  const R = Math.max(1, Math.floor(radius))
  return {
    w: Math.sqrt(3) * WORMHOLE_MAP_CELL_PX * (2 * R + 1.3),
    h: WORMHOLE_MAP_CELL_PX * (3 * R + 2.4),
  }
}

export function wormholeMapAnchorOf(grid: {
  radius: number
  pos: { q: number; r: number }
}): { x: number; y: number } {
  const { w, h } = wormholeMapBoxOf(grid.radius)
  return {
    x: w / 2 + Math.sqrt(3) * WORMHOLE_MAP_CELL_PX * (grid.pos.q + grid.pos.r / 2),
    y: h / 2 + 1.5 * WORMHOLE_MAP_CELL_PX * grid.pos.r,
  }
}

export const WORMHOLE_MAP_AUTOZOOM_MIN_R = 8
export function wormholeMapAutoZoom(radius: number): number {
  if (!(radius > WORMHOLE_MAP_AUTOZOOM_MIN_R)) return WORMHOLE_MAP_ZOOM_FIT
  const z = (3 * radius + 2.4) / 30
  return Math.min(WORMHOLE_MAP_ZOOM_MAX, Math.max(WORMHOLE_MAP_ZOOM_FIT, +z.toFixed(2)))
}

export function wormholeMapPanClamp(
  pan: { x: number; y: number },
  zoom: number,
  box: { w: number; h: number },
  anchor: { x: number; y: number },
): { x: number; y: number } {
  const k = Math.max(0, zoom - 1)
  const loX = -k * (box.w - anchor.x)
  const hiX = k * anchor.x
  const loY = -k * (box.h - anchor.y)
  const hiY = k * anchor.y
  return {
    x: Math.min(hiX, Math.max(loX, pan.x)),
    y: Math.min(hiY, Math.max(loY, pan.y)),
  }
}

export const WORMHOLE_MAP_DRAG_THRESHOLD_PX = 4
