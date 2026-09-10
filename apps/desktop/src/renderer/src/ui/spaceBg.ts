/// <reference types="vite/client" />
/**
 * 宇宙背景（2026-09-10 船长：把 `docs/Small 512x512` 的 32 张宇宙图**平铺**用作游戏背景，
 * 只作界面底、不动舰船图形与战斗背景）。
 *
 * 口径（船长 2026-09-10 三项确认）：
 * - 图源与用量：三套星云（蓝/绿/紫）+ 星野，共 32 张 512×512 **无缝贴图**（逐张量过边缘像素差，
 *   1.6~3.2/255，平铺无接缝）；**每次启动随机抽一张**，整场会话固定（同一张才无缝，
 *   混图平铺必然出现接缝——所以"随机"发生在启动时，而不是每屏）；
 * - 落点：整个界面壳层最底层（`.app-root` 的 background 层，见 styles.css）。
 *   战斗画面（自带不透明深色底 + 星野视差层）与序章（纯黑底）都是**不透明**覆盖层，
 *   底图不会透进去；舰船/无人机等 SVG 图形一律不动；
 * - 亮度：底图之上压一层约 72% 的深色（同色系 #060b13），保证面板与文字可读性。
 *
 * 资源：源图是 PNG（7.5 MB），这类照片型图 PNG 编码吃亏——入库时统一转 JPEG(q85) 收进
 * `assets/space/`（合计 0.96 MB）；原 PNG 仍留在 `docs/Small 512x512/` 作为源图，不进包。
 *
 * 检索入口：`grep spaceBg|--space-bg`。
 */
const TILES = import.meta.glob('../assets/space/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

/** 全部背景图 URL（按文件名排序，便于对照“第几张”；缺图时为空数组） */
export const SPACE_TILE_URLS: readonly string[] = Object.keys(TILES)
  .sort()
  .map((k) => TILES[k]!)
  .filter((u): u is string => typeof u === 'string' && u.length > 0)

/** 本次会话抽中的背景（首次调用时抽，之后固定——平铺必须整场用同一张，混用会出接缝） */
let picked: string | null = null

/** 抽一张背景图 URL（无图返回 null：CSS 层的 var 兜底为 none，界面退回原深色底） */
export function spaceBgUrl(): string | null {
  if (SPACE_TILE_URLS.length === 0) return null
  if (picked === null) picked = SPACE_TILE_URLS[Math.floor(Math.random() * SPACE_TILE_URLS.length)]!
  return picked
}

/**
 * 启动时把抽中的背景写进 CSS 变量 `--space-bg`（在首次渲染**之前**调用，避免先闪一下纯色底）。
 * 变量挂在 documentElement 上：`.app-root` 与手机横屏的旋转盒都能继承到。
 */
export function applySpaceBg(): void {
  const url = spaceBgUrl()
  if (!url) return
  document.documentElement.style.setProperty('--space-bg', `url("${url}")`)
}
