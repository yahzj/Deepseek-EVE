/**
 * **CRT 显示器效果**（2026-11-11 船长令：「我想在设置加一个 CRT 效果，整体界面像看老式 CRT 显示器那种，
 * 小丑牌那种效果」）—— 设置 · 界面页的开关，本机偏好、即时生效、**不进存档**
 * （与语言/字体/配色同一类：存档保持外观中立）。
 *
 * 口径：
 * - 存 `localStorage`（键 `whale-idle:ui-crt`，与 `whale-idle:ui-font` / `:ui-zoom` / `:ui-fs` 同族），
 *   点选即落盘，下次启动由 `game/boot.ts` 的 `prebootRenderer()` 读回并应用；
 * - 生效方式 = 在 `<html>` 上写 `data-ui-crt="on"`；样式钩子收在 `styles.css` 的 CRT 一节
 *   （扫描线 + 暗角 + 玻璃反光 + 荧光带滚动与呼吸闪烁，纯 CSS 双层伪元素、`pointer-events: none`，
 *   不引入全屏 `filter`/`backdrop-filter` —— 那会让每帧重绘的星图/战场付出整屏合成代价）；
 * - 关闭时撤掉 `data-ui-crt` ⇒ 覆层全部消失，回到原界面。
 *
 * 本模块环境安全：非浏览器（工具/测试/SSR）没有 `document` / `localStorage` 时直接返回。
 */
import { readLayoutPref } from './layoutPreference'

export type CrtEffect = 'off' | 'on'

/** 偏好键（与 `whale-idle:ui-font` 同族；本机偏好，不进存档） */
export const CRT_KEY = 'whale-idle:ui-crt'
/** 新版（科幻未来）界面的 CRT 独立偏好键（2026-11-12 船长令） */
export const CRT_KEY_MODERN = 'whale-idle:ui-crt-modern'
/** 旧版（经典）界面的 CRT 独立偏好键（2026-11-12 船长令） */
export const CRT_KEY_CLASSIC = 'whale-idle:ui-crt-classic'

function crtStorageKey(isModern: boolean): string {
  return isModern ? CRT_KEY_MODERN : CRT_KEY_CLASSIC
}

/**
 * 读取本机 CRT 偏好（2026-11-12 船长令口径）：
 * - 新版界面（modern）：默认开启 'on'；玩家第一次选择新版界面时默认即开启；
 *   若玩家在设置里显式关掉，持久化记忆 'off'（后续保持关闭）；
 * - 旧版界面（classic）：默认关闭 'off'；仅在玩家显式开启时开启。
 */
export function readCrtEffect(): CrtEffect {
  try {
    if (typeof localStorage === 'undefined') return 'off'
    const isModern = readLayoutPref() === 'modern'
    const key = crtStorageKey(isModern)
    const stored = localStorage.getItem(key)
    if (stored === 'on') return 'on'
    if (stored === 'off') return 'off'

    // 默认行为：新版默认开启，旧版默认关闭
    return isModern ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/** 保存本机 CRT 偏好（按当前布局独立落盘持久化） */
export function saveCrtEffect(effect: CrtEffect): void {
  try {
    if (typeof localStorage === 'undefined') return
    const isModern = readLayoutPref() === 'modern'
    const key = crtStorageKey(isModern)
    localStorage.setItem(key, effect)
    // 兼容全局单键读取
    localStorage.setItem(CRT_KEY, effect)
  } catch {
    /* 存不了就算了：本次会话内仍然生效（与字体/缩放的处理一致） */
  }
}

/** SVG 滤镜 id：CRT 覆层的 `backdrop-filter: url(#…)` 引用它（styles.css 同名，单点） */
export const CRT_WARP_FILTER_ID = 'whale-crt-warp'

/**
 * 缓存的数学级「桶形球面位移贴图」（Barrel Distortion Displacement Map）。
 *
 * 核心原理（对标 Balatro / RetroArch CRT-geom 显像管几何畸变）：
 * - feDisplacementMap 以 128 (0x80) 为中位（0 位移）：
 *   - R 通道控制 X 位移（<128 向左，>128 向右）；
 *   - G 通道控制 Y 位移（<128 向上，>128 向下）；
 * - 中心核心可读区（r^2 接近 0）：位移量接近 0（R=128, G=128），文字保持锐利可读，绝不出现随机波浪或模糊；
 * - 越靠近四周与四角（r^2 增大）：以二次/三次方向外平滑递增，形成标准的显像管凸透镜几何曲率；
 * - 仅在初次启用时用离屏 Canvas 计算一次（256×256，耗时 ~1ms），转为 DataURL 驻留 GPU 纹理。
 */
let cachedBarrelMapDataUrl: string | null = null

function getBarrelDisplacementDataUrl(): string {
  if (cachedBarrelMapDataUrl !== null) return cachedBarrelMapDataUrl
  try {
    if (typeof document === 'undefined') return ''
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const imgData = ctx.createImageData(size, size)
    const d = imgData.data
    // 畸变曲率：中心 ~60% 设为严格平坦死区（r <= 0.58 位移精确为 0，R=128, G=128），
    // 杜绝亚像素插值，确保中央所有文字与读数保持 100% 点对点刀锋锐利；
    // 仅屏幕边缘 40% 与四角向外平滑拱起，呈现老式显像管凸透镜边缘弯曲。
    const deadzone = 0.58
    const maxR = 1.414 // 角落最大距离
    const range = maxR - deadzone
    for (let y = 0; y < size; y++) {
      const ny = (y / (size - 1)) * 2 - 1
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1
        const r = Math.sqrt(nx * nx + ny * ny)
        let factor = 0
        if (r > deadzone) {
          const t = (r - deadzone) / range
          // 平滑二次方上升
          factor = t * t * 0.42
        }
        const dx = nx * factor
        const dy = ny * factor
        const rVal = Math.min(255, Math.max(0, Math.round(128 + dx * 127)))
        const gVal = Math.min(255, Math.max(0, Math.round(128 + dy * 127)))
        const idx = (y * size + x) * 4
        d[idx] = rVal
        d[idx + 1] = gVal
        d[idx + 2] = 128
        d[idx + 3] = 255
      }
    }
    ctx.putImageData(imgData, 0, 0)
    cachedBarrelMapDataUrl = canvas.toDataURL('image/png')
    return cachedBarrelMapDataUrl
  } catch {
    return ''
  }
}

/**
 * 注入「显像管几何曲面」滤镜定义（**幂等**；关闭 CRT 时不删除，空滤镜零渲染成本）。
 *
 * 做法：
 * - 采用数学级球形桶形位移贴图（`feImage` ＋ `feDisplacementMap`）取代无序波浪噪声；
 * - 末尾 `feGaussianBlur` 轻微柔化像素硬边（0.35px）、`feColorMatrix` 轻微增色与微冷光；
 * - 仅 Chromium 的 `backdrop-filter: url()` 真正渲染；不支持的浏览器该层就是普通透明层，
 *   其余 CRT 层（扫描线/噪点/暗角）不受影响。
 */
function ensureWarpFilterDef(): void {
  try {
    if (document.getElementById(CRT_WARP_FILTER_ID) !== null) return
    const mapHref = getBarrelDisplacementDataUrl()
    if (!mapHref) return

    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    svg.style.overflow = 'hidden'
    const filter = document.createElementNS(NS, 'filter')
    filter.setAttribute('id', CRT_WARP_FILTER_ID)
    // 覆盖区外扩 6%：位移后边缘不会被裁成黑框
    filter.setAttribute('x', '-6%')
    filter.setAttribute('y', '-6%')
    filter.setAttribute('width', '112%')
    filter.setAttribute('height', '112%')
    filter.setAttribute('color-interpolation-filters', 'sRGB')

    const bmap = document.createElementNS(NS, 'feImage')
    bmap.setAttribute('id', 'whale-crt-barrel-map')
    bmap.setAttribute('result', 'barrelMap')
    bmap.setAttribute('preserveAspectRatio', 'none')
    bmap.setAttribute('href', mapHref)

    const warp = document.createElementNS(NS, 'feDisplacementMap')
    warp.setAttribute('in', 'SourceGraphic')
    warp.setAttribute('in2', 'barrelMap')
    warp.setAttribute('scale', '24')
    warp.setAttribute('xChannelSelector', 'R')
    warp.setAttribute('yChannelSelector', 'G')
    warp.setAttribute('result', 'warped')

    const sat = document.createElementNS(NS, 'feColorMatrix')
    sat.setAttribute('in', 'warped')
    sat.setAttribute('type', 'matrix')
    // 零模糊：绝不引入任何高斯模糊，纯粹微调对比度与荧光冷光，保证字迹纯净锐利
    sat.setAttribute('values', '1.04 0 0 0 0  0 1.05 0 0 0  0 0 1.08 0 0  0 0 0 1 0')

    filter.append(bmap, warp, sat)
    svg.appendChild(filter)
    document.body.appendChild(svg)
  } catch {
    /* 注入失败：该层退回无滤镜，其余 CRT 层不受影响 */
  }
}

/** 把 CRT 效果应用到界面（**幂等**；非浏览器环境直接返回） */
export function applyCrtEffect(effect: CrtEffect): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  if (effect === 'on') {
    ensureWarpFilterDef()
    root.dataset.uiCrt = 'on'
  } else delete root.dataset.uiCrt
}

/** 玩家在设置里点选：**即时生效 + 本机落盘**（两步同一个入口，避免调用点各写一半） */
export function chooseCrtEffect(effect: CrtEffect): void {
  saveCrtEffect(effect)
  applyCrtEffect(effect)
}
