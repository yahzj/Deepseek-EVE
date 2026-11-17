export const ZOOM_KEY = 'whale-idle:ui-zoom'
export const FS_KEY = 'whale-idle:ui-fs'
export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.25
export const FS_MIN = 0.85
export const FS_MAX = 1.5

function readNum(key: string, def: number, min: number, max: number): number {
  try {
    if (typeof localStorage === 'undefined') return def
    const v = Number.parseFloat(localStorage.getItem(key) ?? '')
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
  } catch {
    return def
  }
}

export function readZoom(): number {
  return readNum(ZOOM_KEY, 1, ZOOM_MIN, ZOOM_MAX)
}

export function readFontScale(): number {
  return readNum(FS_KEY, 1, FS_MIN, FS_MAX)
}

export function applyFontScale(fs: number = readFontScale()): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.style.setProperty('--ui-fs', String(fs))
}

export function applyZoom(el: HTMLElement | null, zoom: number = readZoom()): void {
  if (!el) return
  ;(el.style as { zoom?: string }).zoom = String(zoom)
}
