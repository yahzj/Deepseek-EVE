/** 功能域职责拆分，保持原计算与顺序。 */

export type Pt = [number, number]

/** 折线：点列 → `M… L…`（每段 ≥2 点；`Pt` 会被规范成坐标对） */
export function line(...pts: Pt[]): string {
  return `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')}`
}

/** 闭合多边形（首点自动回环） */
export function poly(...pts: Pt[]): string {
  return `${line(...pts)} Z`
}

/** 把若干子路径串成一条 path：可传点列（折线）、单个点（接着上一点连）、或 `Z` 这类单指令字符串 */
export function s(...parts: (string | Pt | Pt[])[]): string {
  return parts.reduce<string>((acc, it) => {
    if (typeof it === 'string') return acc ? `${acc} ${it}` : it
    const pts: Pt[] = typeof it[0] === 'number' ? [it as Pt] : (it as Pt[])
    const seg = pts.length >= 2 ? line(...pts) : ''
    if (!seg) return acc
    return acc ? `${acc} ${seg}` : seg
  }, '')
}

/** 推进器喷口：矩形管 + 尾缘两条短线；`engines` 挂点取矩形**左缘中点** */
export function nozzle(x: number, y: number, w: number, h: number): string {
  return s(poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]), [[x + 1, y + 1], [x + 1, y + h - 1]], [[x + 3, y + 1], [x + 3, y + h - 1]])
}

/** 炮座：矩形基座 + 一条上抬炮管，管口即 `muzzles` 挂点（管端 6×4） */
export function turret(x: number, y: number, bw: number, bh: number, bl: number, cy: number): string {
  return s(poly([x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]), poly([x + bw, cy - 2], [x + bw + bl, cy - 2], [x + bw + bl, cy + 2], [x + bw, cy + 2]))
}

/** 方框（面板 / 舱门 / 外挂块 / 集装箱） */
export function box(x: number, y: number, w: number, h: number): string {
  return poly([x, y], [x + w, y], [x + w, y + h], [x, y + h])
}

/** 舱段圆柱：外框 + 若干横向肋环（泰坦巨构用） */
export function cyl(x0: number, x1: number, y0: number, y1: number, ribs: number[]): string {
  return s(box(x0, y0, x1 - x0, y1 - y0), ...ribs.map((rx): Pt[] => [[rx, y0], [rx, y1]]))
}

/** 舰桥塔：`tiers` 自下而上逐层递收（塔顶信标另写，坐标要进挂点） */
export function bridge(x0: number, x1: number, y0: number, tiers: { h: number; i: number }[]): string {
  const out: string[] = []
  let a = x0
  let b = x1
  let y = y0
  for (const t of tiers) {
    out.push(box(a, y - t.h, b - a, t.h))
    y -= t.h
    a += t.i
    b -= t.i
  }
  return out.join(' ')
}

/** 蜂窝六边舱（G 族签名）：以 (cx,cy) 为心的六边形 */
export function hex(cx: number, cy: number, r: number): string {
  const w = r * 0.866
  return poly([cx - w, cy - r], [cx + w, cy - r], [cx + w * 2, cy], [cx + w, cy + r], [cx - w, cy + r], [cx - w * 2, cy])
}

/** 孢子囊 / 静滞舱（C、D 族用）：椭圆近似六边胶囊 */
export function pod(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy} Q${cx - rx} ${cy - ry} ${cx} ${cy - ry} Q${cx + rx} ${cy - ry} ${cx + rx} ${cy} Q${cx + rx} ${cy + ry} ${cx} ${cy + ry} Q${cx - rx} ${cy + ry} ${cx - rx} ${cy} Z`
}

/** 单边：`k` 为向 `side` 一侧鼓出的上限（0 = 直线）；控制点落在**原顶点**上 ⇒ 曲线自然向里收，转角自动圆化。
 *  ⚠ 外移量按**边长自适应**（`min(k, 边长×0.35)`）：小附肢不该鼓成大肚皮，否则读成"折纸"。 */
export function edge(a: Pt, b: Pt, k: number, side: number): string {
  if (!k) return line(a, b)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const kk = Math.min(k, len * 0.35)
  const mx = (a[0] + b[0]) / 2 + nx * kk * side
  const my = (a[1] + b[1]) / 2 + ny * kk * side
  return `Q${mx} ${my} ${b[0]} ${b[1]}`
}

/**
 * **有机圆角轮廓**（C 族专用）：点列按序首尾相接成**一条闭合曲线**——
 * `k` 为各边向"外侧"鼓出的量（`k>0` 时整条边变弧，转角随之自然圆化）。
 *
 * 实现口径（踩过的坑）：曲线**控制点落在原顶点上**（`Q 中点的外移点 → 下个顶点`）。
 * 早先的写法是把每条边两端各内缩 `r`、再在中段画线/弧——**相邻两边之间会漏出 `2r` 的缺口**，
 * 闭合轮廓在 `fill:none` 下就裂成一圈碎线段（2026-09-26 船长「C 组敌人没有封闭外形」正是此症）。
 * ⇒ **轮廓线一律不许留缝**：要圆角就靠这条 Q 曲线，不许靠"内缩 + 补线"。
 *
 * 为什么 C 族单独要它：异形族是**生物体**，直角多边形会读成机械舰；
 * ⚠ 突出口外的部件（獠牙/节肢/骨刺）**一律用闭合楔形**（`poly`/`blob`），不许用开放折线——
 * 开放折线在 `fill:none` 的渲染下就是"没封闭的线"。
 */
export function blob(pts: Pt[], k = 4): string {
  const n = pts.length
  let cx = 0
  let cy = 0
  for (const [x, y] of pts) {
    cx += x
    cy += y
  }
  cx /= n
  cy /= n
  const first = pts[0]!
  const out: string[] = [`M${first[0]} ${first[1]}`]
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const side = (mx - cx) * (b[1] - a[1]) - (my - cy) * (b[0] - a[0]) >= 0 ? 1 : -1
    out.push(edge(a, b, k, side))
  }
  return `${out.join(' ')} Z`
}
