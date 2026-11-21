export type LayoutKind = 'modern' | 'classic' | 'cosmic'

export const LAYOUT_KEY = 'whale-idle:layout'
export const LAYOUT_SET_KEY = 'whale-idle:layout-set'

export function readLayoutPref(): LayoutKind {
  try {
    if (localStorage.getItem(LAYOUT_SET_KEY) !== '1') return 'modern'
    const val = localStorage.getItem(LAYOUT_KEY)
    if (val === 'modern' || val === 'cosmic') return 'modern'
    return 'classic'
  } catch {
    return 'classic'
  }
}

export function isModernLayout(): boolean {
  if (typeof document !== 'undefined') {
    const root = document.querySelector('.app-root')
    if (root) {
      if (root.classList.contains('is-layout-modern')) return true
      if (root.classList.contains('is-layout-classic')) return false
    }
  }
  return readLayoutPref() === 'modern'
}
