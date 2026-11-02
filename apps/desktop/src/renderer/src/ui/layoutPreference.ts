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
