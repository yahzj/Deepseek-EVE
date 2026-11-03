/** 启动样式与应用状态共用的布局偏好，不加载 CSS 或启动引擎。 */
export type LayoutKind = 'modern' | 'classic' | 'cosmic'

export const LAYOUT_KEY = 'whale-idle:layout'
export const LAYOUT_SET_KEY = 'whale-idle:layout-set'

export function readLayoutPref(): LayoutKind {
  try {
    if (localStorage.getItem(LAYOUT_SET_KEY) !== '1') return 'classic'
    const val = localStorage.getItem(LAYOUT_KEY)
    if (val === 'modern' || val === 'cosmic') return 'modern'
    return 'classic'
  } catch {
    return 'classic'
  }
}

/** 探测当前运行时是否处于「科幻未来」（modern）布局（DOM 探测优先，回落偏好读取） */
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
