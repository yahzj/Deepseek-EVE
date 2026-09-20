/**
 * **虫洞探索地图的几何口径（纯函数 · 无 React / 无导入）**——从 `panels/Wormhole.tsx` 抽出来，
 * 好让"拖动可达性 / 自动缩放"这类**读数**能用探针直接核对（面板本身 import 了 `spaceBg` 的
 * `import.meta.glob`，在纯 node 下加载不了）。
 *
 * 三把尺子：
 * - `wormholeMapBoxOf`：viewBox 尺寸（`0 0 w h`）；
 * - `wormholeMapAnchorOf`：玩家所在格的坐标（缩放锚点 = 舰影落点 = 拖动夹取的基准）；
 * - `wormholeMapPanClamp`：拖动平移量的夹取区间（**按锚点到两侧边缘的距离分轴算**）。
 * 它们与 `WhGridMap` 里的格子换算**必须同源**：格心 = `cx + √3·size·(q + r/2)`、`cy + 1.5·size·r`。
 */

/** 探索地图的缩放档（1 = 适应窗口；每档 +25%，上限 250%）——左侧 ＋/－ 按这个步进 */
export const WORMHOLE_MAP_ZOOM_FIT = 1
export const WORMHOLE_MAP_ZOOM_STEP = 0.25
/** 滚轮一格的步长（比按钮细一半：滚轮是连续输入，粗档会一跳一跳） */
export const WORMHOLE_MAP_ZOOM_WHEEL_STEP = 0.125
export const WORMHOLE_MAP_ZOOM_MAX = 2.5

/** 地图坐标系的单格边长（viewBox 用户单位；地图框 300px 定高，实际屏幕像素按 viewBox 等比缩放） */
export const WORMHOLE_MAP_CELL_PX = 30

/** **地图画布尺寸**（viewBox 的 `0 0 w h`）——留白按半径算，六边形顶点正好落在边界上会显得挤 */
export function wormholeMapBoxOf(radius: number): { w: number; h: number } {
  const R = Math.max(1, Math.floor(radius))
  return {
    w: Math.sqrt(3) * WORMHOLE_MAP_CELL_PX * (2 * R + 1.3),
    h: WORMHOLE_MAP_CELL_PX * (3 * R + 2.4),
  }
}

/** **玩家所在格在 viewBox 里的坐标**（舰影落点、拖动夹取、路径折线共用同一把尺） */
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

/**
 * **盘面过大 ⇒ 自动聚焦**（船长 2026-09-20 确认的界面配套）。
 *
 * 为什么需要：地图是"**固定 300px 高的框 ＋ viewBox 随半径放大**"（船长 2026-09-13：「窗口高度固定」）
 * ⇒ 单格屏幕高度 ≈ `600 / (3R + 2.4)` px：R=4 约 42px · R=8 约 23px · **R=11 约 17px** · R=21 约 9px。
 * 口径：**半径 > 8 时，换层自动把缩放设到"单格约 20px"**（`(3R + 2.4) / 30`，夹在 FIT~MAX 之间）；
 * R ≤ 8 恒为 1（适应窗口，观感与改造前一致）。自动只在**换层/进出洞**时发生，玩家随时可手动 ＋/－ 或滚轮改。
 */
export const WORMHOLE_MAP_AUTOZOOM_MIN_R = 8
/** 自动缩放的换算基准：`(3R + 2.4) / 30` ⇒ R=9 约 1.0 · R=11 约 1.18 · R=21 约 2.18（再大夹到 MAX） */
export function wormholeMapAutoZoom(radius: number): number {
  if (!(radius > WORMHOLE_MAP_AUTOZOOM_MIN_R)) return WORMHOLE_MAP_ZOOM_FIT
  const z = (3 * radius + 2.4) / 30
  return Math.min(WORMHOLE_MAP_ZOOM_MAX, Math.max(WORMHOLE_MAP_ZOOM_FIT, +z.toFixed(2)))
}

/**
 * **拖动地图的平移量夹取**（**船长 2026-09-20**：「**以及允许玩家拖动虫洞探索地图**」）。
 *
 * 缩放层是"**以玩家所在格为锚点**"放大（见 `WhGridMap` 的 `app-wh-zoomlayer`）：
 * 屏幕位移 = `(z−1)·(内容点 − 锚点)` ⇒ 离锚点越远的内容被推得越开 —— 站在盘底时，
 * **盘顶被推上去 `(z−1)·锚点y` 那么多**。所以可拖范围**不是对称的 ±(z−1)·半幅**，而是
 * **按锚点到两侧边缘的距离分别算**：
 * - 上/左方向最多 `k·锚点`（正好能把对侧边缘拉到框边）；
 * - 下/右方向最多 `k·(幅 − 锚点)`（同理）。
 *
 * 这个区间同时满足两条：**① 盘面任何一格都拖得到**（含站在盘底看盘顶）；
 * **② 怎么拖都不会露出框外的空白**（内容始终盖满地图框）。
 * ⚠ **2026-09-20 报障修正**：首版写成对称的 `±(z−1)·半幅`，站在盘底时只够拖到"盘顶离框一半"，
 * 另一半永远看不到（船长报障：「无法放大后拖动查看地图上方的位置」）。
 * `pan` 单位 = viewBox 用户单位（与缩放层 transform 同一坐标系）；指针像素在拖动处按
 * `viewBox ÷ 元素像素` 换算（见 `onPointerDown` 里记下的 `kx/ky`）。
 */
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

/** 拖动判定阈值（px）：低于它算"点击格子"，不进入拖动 —— 免得手一抖就把点格变成拖图 */
export const WORMHOLE_MAP_DRAG_THRESHOLD_PX = 4
