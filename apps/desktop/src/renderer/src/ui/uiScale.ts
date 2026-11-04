/**
 * **界面缩放 / 字号偏好的单点**（2026-09-05 船长令：设置里的「界面缩放」「字体大小」）。
 *
 * 口径：
 * - 两者都是**本机偏好**，存 `localStorage`（键 `whale-idle:ui-zoom` / `whale-idle:ui-fs`），不进存档；
 * - 「界面缩放」= 整窗 `zoom`（挂 `.app-root`，几何与文字一起放大缩小）；
 * - 「字体大小」= 字号族系数 `--ui-fs`，**必须写在 `<html>`（`:root`）上**：
 *   `packages/ui/src/index.css` 的 `--wui-fs-*` 字阶是 `calc(Npx * var(--ui-fs, 1))`，
 *   `var()` 在**声明该自定义属性的元素**上解析 ⇒ 写到 `.app-root` 上会解析不到（2026-11-02 实踩：
 *   玩家拖字体滑块看不出变化，一是覆盖面小、二是启动时压根没应用）。
 * - 启动时的应用由 `game/boot.ts` 的 `prebootRenderer()` 接线（两个入口共用）；设置面板里拖动时也写一次
 *   ⇒ 即时预览 + 重启后仍是玩家选的档位。
 */
export const ZOOM_KEY = 'whale-idle:ui-zoom'
export const FS_KEY = 'whale-idle:ui-fs'
/** 缩放范围（与设置面板滑块 min/max 一致） */
export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.25
/** 字号范围（2026-09-22 船长令「按推荐来」：上限 150%，默认 100%） */
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

/** 读取界面缩放系数（0.8~1.25，默认 1） */
export function readZoom(): number {
  return readNum(ZOOM_KEY, 1, ZOOM_MIN, ZOOM_MAX)
}

/** 读取字号系数（0.85~1.5，默认 1） */
export function readFontScale(): number {
  return readNum(FS_KEY, 1, FS_MIN, FS_MAX)
}

/**
 * 应用字号系数：写 `<html>` 的 `--ui-fs`（幂等；非浏览器环境安全）。
 * `undefined` ⇒ 从本机偏好读；设置面板拖动时传当前滑块值。
 */
export function applyFontScale(fs: number = readFontScale()): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.style.setProperty('--ui-fs', String(fs))
}

/** 应用界面缩放：写 `.app-root` 的 `zoom`（元素可能还没挂载 ⇒ 传 null 时静默跳过） */
export function applyZoom(el: HTMLElement | null, zoom: number = readZoom()): void {
  if (!el) return
  ;(el.style as { zoom?: string }).zoom = String(zoom)
}
