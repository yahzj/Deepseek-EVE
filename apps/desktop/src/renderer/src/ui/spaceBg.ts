/// <reference types="vite/client" />
/**
 * 宇宙背景（2026-09-10 船长：把 `docs/Small 512x512` 的 32 张宇宙图**平铺**用作游戏背景，
 * 只作界面底、不动舰船图形与战斗背景；同日追加"设置里可更换"）。
 *
 * 口径（船长 2026-09-10 确认）：
 * - 图源与用量：三套星云（蓝/绿/紫）+ 星野，共 32 张 512×512 **无缝贴图**（逐张量过边缘像素差，
 *   1.6~3.2/255，平铺无接缝）；**每次启动随机抽一张**，整场会话固定（同一张才无缝，
 *   混图平铺必然出现接缝——所以"随机"发生在启动/换图时，而不是每屏）；
 * - 设置面板（顶栏「设置」）可**换一张**：立即换成另一张随机底图（本次会话内有效；
 *   下次启动仍走随机——"每次启动随机"是船长选定的默认行为，不写入偏好）；
 * - 落点：整个界面壳层最底层（`.app-root` 的 background 层，见 styles.css）。
 *   战斗画面（自带不透明深色底 + 星野视差层）与序章（纯黑底）都是**不透明**覆盖层，
 *   底图不会透进去；舰船/无人机等 SVG 图形一律不动；
 * - 亮度：底图之上压一层约 72% 的深色（同色系 #060b13），保证面板与文字可读性。
 *
 * 资源：源图是 PNG（7.5 MB），这类照片型图 PNG 编码吃亏——入库时统一转 JPEG(q85) 收进
 * `assets/space/`（合计 0.96 MB）；原 PNG 仍留在 `docs/Small 512x512/` 作为源图，不进包。
 *
 * 检索入口：`grep spaceBg|rerollSpaceBg|--space-bg`。
 */
const TILES = import.meta.glob('../assets/space/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

/** 全部背景图的**源路径键**（按文件名排序，顺序与 URL 表一致；用于推玩家向短名） */
const TILE_KEYS: readonly string[] = Object.keys(TILES).sort()

/** 全部背景图 URL（构建后为相对资源的 URL 字符串；缺图时为空数组） */
const TILE_URLS: readonly string[] = TILE_KEYS.map((k) => TILES[k]!).filter(
  (u): u is string => typeof u === 'string' && u.length > 0,
)

/** 玩家向的短名（设置面板里显示"当前是哪张"）：蓝星云 03 / 星野 04 … */
const TILE_SETS: ReadonlyArray<{ prefix: string; text: string }> = [
  { prefix: 'nebula-blue', text: '蓝星云' },
  { prefix: 'nebula-green', text: '绿星云' },
  { prefix: 'nebula-purple', text: '紫星云' },
  { prefix: 'starfield', text: '星野' },
]

function shortNameOf(key: string, index: number): string {
  const base = key.split('/').pop() ?? ''
  for (const s of TILE_SETS) {
    if (base.startsWith(`${s.prefix}-`)) return `${s.text} ${base.slice(s.prefix.length + 1).replace(/\.jpg$/i, '')}`
  }
  return `背景 ${index + 1}`
}

/** 当前底图信息（设置面板显示用） */
export interface SpaceBgInfo {
  /** 写进 `--space-bg` 的资源 URL */
  url: string
  /** 玩家向短名（如「蓝星云 03」） */
  label: string
  /** 在 32 张里的下标（0 起） */
  index: number
  /** 总张数 */
  total: number
}

/** 当前抽中的下标（null = 尚未抽；模块级状态：设置面板关闭再打开仍显示同一张） */
let currentIndex: number | null = null

/** 抽一个下标；给了 exclude 就保证不会抽到同一张（只有一张时除外） */
function pickIndex(exclude?: number): number {
  const n = TILE_URLS.length
  if (n <= 1) return 0
  let i = Math.floor(Math.random() * n)
  if (exclude !== undefined && i === exclude) {
    let guard = 0
    while (i === exclude && guard < 32) {
      i = Math.floor(Math.random() * n)
      guard++
    }
    if (i === exclude) i = (exclude + 1) % n // 兜底：真撞上就顺延一张
  }
  return i
}

/** 当前底图（未抽过时返回 null） */
export function currentSpaceBg(): SpaceBgInfo | null {
  if (currentIndex === null || TILE_URLS.length === 0) return null
  const index = currentIndex
  return {
    url: TILE_URLS[index]!,
    label: shortNameOf(TILE_KEYS[index] ?? '', index),
    index,
    total: TILE_URLS.length,
  }
}

/**
 * 应用底图：不传下标 = 随机抽一张；写入 CSS 变量 `--space-bg`（挂 documentElement，
 * `.app-root` 与手机横屏的旋转盒都能继承）。启动时在首帧渲染前调用，避免闪一下纯色底。
 */
export function applySpaceBg(index?: number): SpaceBgInfo | null {
  if (TILE_URLS.length === 0) return null
  currentIndex = index ?? pickIndex()
  const info = currentSpaceBg()!
  document.documentElement.style.setProperty('--space-bg', `url("${info.url}")`)
  return info
}

/**
 * 设置里的「换一张」：换成**另一张**随机底图并立即生效（本次会话内有效；下次启动仍随机）。
 * 平铺必须整场用同一张（混铺会出接缝），所以这里换的是"整层底图"，不是局部。
 */
export function rerollSpaceBg(): SpaceBgInfo | null {
  if (TILE_URLS.length === 0) return null
  return applySpaceBg(pickIndex(currentIndex ?? undefined))
}
