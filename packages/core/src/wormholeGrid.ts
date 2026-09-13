/**
 * **终局玩法「虫洞」· 层内网格探索（F3a · 2026-09-13 船长确认）**。
 *
 * 船长口径（原话要点，见设计稿 §十一）：
 * - **探索采用网格地图**，整体**呈圆型**；玩家**随机出现在一个入口**；**下一层入口在随机位置**；
 * - **靠扫描获取周围信号**：残骸 / 舰船 / 资源 / 雷达四类；**只有到达后才知道确切信息**，否则只显示信号；
 * - **可前往任意位置（含未扫描）**，但前往未扫描点要**警告玩家**；
 * - **初始扫描范围 1 格**（可依靠其他方式增加）；
 * - **空地点（什么都没有）至少占 50%**；**遗迹概率 30%**（残骸信号的两支：舰船墓场 70% / 遗迹 30%）；
 * - 回合：**扫描 1 · 移动 1 · 激活 1**；**谜质效果挂起**（本批只出地点与物品，不接增强）。
 *
 * 本文件只做**纯几何 + 确定性生成 + 信号遮蔽**（可单测、可存档），
 * 不碰回合扣费与战斗触发（那两块在 `wormhole.ts` / F3b）。
 */
import type { WormholeFoeKind } from './wormholeFoes'

/* ═══════════ 一、六边形网格几何（轴向坐标 q/r） ═══════════ */

/** 轴向坐标的一格（`|q|,|r|,|q+r|` 三个数的最大值 = 到中心的六边形距离） */
export interface HexCell {
  q: number
  r: number
}

/** 格的稳定键（存档用字符串；**不要**用对象做键） */
export function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

/** 解析键（坏值 ⇒ null） */
export function parseHexKey(key: string): HexCell | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key)
  if (!m) return null
  return { q: Number(m[1]), r: Number(m[2]) }
}

/** 六边形距离（= 需要几步走到；盘 = 到中心距离 ≤ 半径） */
export function hexDistance(a: HexCell, b: HexCell): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

/** 轴向坐标的 6 个邻居方向（顺序固定，便于确定性生成与测试） */
export const HEX_DIRS: readonly HexCell[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** 某格的 6 个邻居（按 `HEX_DIRS` 顺序） */
export function hexNeighbors(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }))
}

/** 半径 R 的**圆盘**全部格（行优先：r 从 -R 到 R，q 从 -R 到 R；共 `3R(R+1)+1` 格） */
export function hexDiskCells(radius: number): HexCell[] {
  const R = Math.max(0, Math.floor(radius))
  const out: HexCell[] = []
  for (let r = -R; r <= R; r++) {
    const qLo = Math.max(-R, -r - R)
    const qHi = Math.min(R, -r + R)
    for (let q = qLo; q <= qHi; q++) out.push({ q, r })
  }
  return out
}

/** 半径 R 盘内的格数（= `hexDiskCells(R).length`，公式口径便于断言） */
export function hexDiskCount(radius: number): number {
  const R = Math.max(0, Math.floor(radius))
  return 3 * R * (R + 1) + 1
}

/** 以 `center` 为中心、半径 `radius` 内（**含中心**）的全部格 */
export function hexDiskAround(center: HexCell, radius: number): HexCell[] {
  return hexDiskCells(radius).map((c) => ({ q: c.q + center.q, r: c.r + center.r }))
}

/** **只取一圈**（到中心距离恰为 `radius`；`radius=0` ⇒ 只有中心格） */
export function hexRingAround(center: HexCell, radius: number): HexCell[] {
  const R = Math.max(0, Math.floor(radius))
  if (R === 0) return [{ q: center.q, r: center.r }]
  return hexDiskAround(center, R).filter((c) => hexDistance(c, center) === R)
}

/* ═══════════ 二、信号与地点（信号遮蔽真相） ═══════════ */

/** **扫描能看到的东西**（四类信号；未扫描 = 未知） */
export type WormholeSignal = 'wreck' | 'ship' | 'resource' | 'radar'

/** **到达后才知道的真相**：空地点 / 舰船墓场 / 遗迹 / 舰船 / 矿脉 / 谜质 */
export type WormholePlace = 'empty' | 'graveyard' | 'ruins' | 'ship' | 'vein' | 'matter'

/** 四类信号的权重（**已扣除空地点**后的相对权重；船长确认：空 ≥50%、遗迹 30%） */
export const WORMHOLE_SIGNAL_WEIGHTS: Readonly<Record<WormholeSignal, number>> = {
  ship: 30,
  wreck: 30,
  resource: 25,
  radar: 15,
}

/** **空地点占比下限**（船长：「添加空信息地点（目标地点什么都没有）至少要占 50%」） */
export const WORMHOLE_EMPTY_MIN_SHARE = 0.5

/** **遗迹占残骸信号的比重**（船长：「遗迹概率降低到 30%」⇒ 舰船墓场 70%） */
export const WORMHOLE_RUINS_SHARE = 0.3

/** 地点 → 对外信号（`empty` 无信号；`graveyard`/`ruins` 都表现为「残骸信号」） */
export function signalOfPlace(place: WormholePlace): WormholeSignal | null {
  switch (place) {
    case 'empty':
      return null
    case 'graveyard':
    case 'ruins':
      return 'wreck'
    case 'ship':
      return 'ship'
    case 'vein':
      return 'resource'
    case 'matter':
      return 'radar'
  }
}

/**
 * **每层网格半径**（船长确认「其他按推荐」）：第 1 层 R=2（19 格），**每 2 层 +1**，上限 **R=4**（61 格）。
 * 依据：与现有回合预算（4×T3 = 29~42 回合/趟）相配，一层可行动作约 8~12 次。
 */
export const WORMHOLE_GRID_R_MIN = 2
export const WORMHOLE_GRID_R_MAX = 4
export function wormholeGridRadiusFor(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.min(WORMHOLE_GRID_R_MAX, WORMHOLE_GRID_R_MIN + Math.floor((d - 1) / 2))
}

/** **初始扫描半径 = 1 格**（船长原话；后续可由装备/谜质/技能提升——字段留着） */
export const WORMHOLE_SCAN_RADIUS_BASE = 1

/* ═══════════ 三、每层网格状态（可存档的纯数据） ═══════════ */

/** 一格（真相随档；**信号遮蔽靠"未扫描不展示"实现**，不是靠不存） */
export interface WormholeGridCell {
  key: string
  q: number
  r: number
  /** 真相：到达后才知道 */
  place: WormholePlace
}

export interface WormholeGridState {
  /** 本层半径（决定盘内格数） */
  radius: number
  /** 入口格（玩家初始随机落点，落在外圈） */
  start: HexCell
  /** **下一层入口**（随机位置；到达并激活 ⇒ 触发层末守卫战，F3b 接） */
  exit: HexCell
  /** 玩家当前所在格 */
  pos: HexCell
  /** 当前扫描半径（船长：初始 1 格，可提升） */
  scanRadius: number
  /** **已扫描**的格（只是"知道信号"，不等于到过） */
  scanned: string[]
  /** **已到达**的格（到达即揭示真相） */
  visited: string[]
  /** **已激活**的格（打捞/挖矿/战斗/取谜质各自只算一次，重复来不重复计） */
  activated: string[]
  /** 全部格（真相在这里；对外按 `scanned`/`visited` 决定展示到什么程度） */
  cells: WormholeGridCell[]
}

/** 该格此刻**对外可见的信息**（未知 / 只有信号 / 已知真相） */
export type WormholeCellReveal =
  | { kind: 'unknown' }
  | { kind: 'signal'; signal: WormholeSignal }
  | { kind: 'known'; signal: WormholeSignal | null; place: WormholePlace }

/** 查格（坏键 ⇒ undefined） */
export function gridCellAt(grid: WormholeGridState, cell: HexCell): WormholeGridCell | undefined {
  return grid.cells.find((c) => c.key === hexKey(cell.q, cell.r))
}

/** 某格对外揭示到什么程度（**这条是"信号遮蔽"的唯一判据**） */
export function revealOf(grid: WormholeGridState, cell: HexCell): WormholeCellReveal {
  const c = gridCellAt(grid, cell)
  if (!c) return { kind: 'unknown' }
  if (grid.visited.includes(c.key)) return { kind: 'known', signal: signalOfPlace(c.place), place: c.place }
  if (grid.scanned.includes(c.key)) return { kind: 'signal', signal: signalOfPlace(c.place) ?? 'ship' }
  return { kind: 'unknown' }
}

/** 一次的扫描会揭示哪些格（当前格 + 周围一圈；**不含**已扫过的） */
export function gridScanTargets(grid: WormholeGridState): HexCell[] {
  const r = Math.max(0, Math.floor(grid.scanRadius))
  return hexDiskAround(grid.pos, r).filter((c) => {
    const cell = gridCellAt(grid, c)
    return !!cell && !grid.scanned.includes(cell.key)
  })
}

/** 到某格需要几回合（船长：前往其他地点消耗 1 回合 ⇒ 与距离无关） */
export const WORMHOLE_TURN_PER_MOVE = 1
/** 扫描一次消耗（船长：扫描需要消耗一回合） */
export const WORMHOLE_TURN_PER_SCAN = 1
/** 激活一个地点消耗（船长：打捞/挖矿/战斗等各 1 回合） */
export const WORMHOLE_TURN_PER_ACTIVATE = 1

/* ═══════════ 四、确定性生成（同 seed+depth ⇒ 同盘） ═══════════ */

/** 轻量确定性随机（与 `wormholeMakeNode` 同款口径：纯函数、不占存档 rng、可复现） */
function makeRng(seed: number): () => number {
  let s = (Math.floor(seed) % 2147483647) || 1
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** 按权重挑一个信号（权重表可覆写；坏表 ⇒ 回退舰船信号） */
export function pickSignal(rnd: number, weights: Readonly<Record<WormholeSignal, number>> = WORMHOLE_SIGNAL_WEIGHTS): WormholeSignal {
  const order: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar']
  const total = order.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0)
  if (!(total > 0)) return 'ship'
  let acc = rnd * total
  for (const k of order) {
    acc -= Math.max(0, weights[k] ?? 0)
    if (acc < 0) return k
  }
  return order[order.length - 1]!
}

/**
 * **按信号 + 概率定真相**：
 * - `wreck` ⇒ 70% 舰船墓场 / **30% 遗迹**（船长：遗迹概率降到 30%）；
 * - `ship`/`resource`/`radar` ⇒ 一一对应（舰船 / 矿脉 / 谜质）。
 */
export function pickPlace(signal: WormholeSignal, rnd: number): WormholePlace {
  switch (signal) {
    case 'ship':
      return 'ship'
    case 'resource':
      return 'vein'
    case 'radar':
      return 'matter'
    case 'wreck':
      return rnd < WORMHOLE_RUINS_SHARE ? 'ruins' : 'graveyard'
  }
}

/**
 * **生成一层的网格**（确定性：同 `(seed, depth)` 必得同盘）：
 * 1. 半径按 `wormholeGridRadiusFor(depth)`；
 * 2. **入口格**：随机落在**外圈**（盘最外层）；
 * 3. **下一层入口**：从盘内其余格随机取一格（保证 ≠ 入口格）；
 * 4. 其余格先按 **空 ≥50%** 铺空地点，再把剩下的格按四类权重分配（**用最大余数法**保证格子数取整后仍可复现）；
 * 5. 残骸信号再按 70/30 分墓场/遗迹。
 */
export function wormholeMakeGrid(seed: number, depth: number): WormholeGridState {
  const rng = makeRng(seed * 7919 + depth * 104729)
  const radius = wormholeGridRadiusFor(depth)
  const all = hexDiskCells(radius)
  const outer = all.filter((c) => hexDistance(c, { q: 0, r: 0 }) === radius)
  const start = outer[Math.min(outer.length - 1, Math.floor(rng() * outer.length))]!
  const rest = all.filter((c) => !(c.q === start.q && c.r === start.r))
  const exit = rest[Math.min(rest.length - 1, Math.floor(rng() * rest.length))]!
  // 除入口/终点外的格：先定"是否为空"，再定信号
  const others = all.filter((c) => !(c.q === exit.q && c.r === exit.r))
  const nAll = all.length
  const emptyCount = Math.max(0, Math.ceil(nAll * WORMHOLE_EMPTY_MIN_SHARE))
  // 洗牌（Fisher–Yates，确定性）后取前 emptyCount 个当"空"（入口/终点也照此参与 ⇒ 它们也可能是空的）
  const shuffled = [...others]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = t
  }
  const emptyKeys = new Set(shuffled.slice(0, emptyCount).map((c) => hexKey(c.q, c.r)))
  // 剩余格按权重分配信号（最大余数法：先按比例取整，余额给余数最大的）
  const pool = others.filter((c) => !emptyKeys.has(hexKey(c.q, c.r)))
  const order: WormholeSignal[] = ['ship', 'wreck', 'resource', 'radar']
  const totalW = order.reduce((s, k) => s + WORMHOLE_SIGNAL_WEIGHTS[k], 0)
  const quota = order.map((k) => {
    const exact = (pool.length * WORMHOLE_SIGNAL_WEIGHTS[k]) / totalW
    return { k, n: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let left = pool.length - quota.reduce((s, q) => s + q.n, 0)
  for (const q of [...quota].sort((a, b) => b.frac - a.frac || order.indexOf(a.k) - order.indexOf(b.k))) {
    if (left <= 0) break
    q.n += 1
    left -= 1
  }
  const signalOfCell = new Map<string, WormholeSignal>()
  let at = 0
  const poolShuffled = pool // 已按上面洗牌后的相对顺序（确定性）
  for (const q of order) {
    const bucket = quota.find((x) => x.k === q)!
    for (let i = 0; i < bucket.n; i++) {
      const c = poolShuffled[at++]
      if (c) signalOfCell.set(hexKey(c.q, c.r), q)
    }
  }
  const cells: WormholeGridCell[] = all.map((c) => {
    const key = hexKey(c.q, c.r)
    const sig = signalOfCell.get(key)
    const place: WormholePlace = sig ? pickPlace(sig, rng()) : 'empty'
    return { key, q: c.q, r: c.r, place }
  })
  return {
    radius,
    start: { q: start.q, r: start.r },
    exit: { q: exit.q, r: exit.r },
    pos: { q: start.q, r: start.r },
    scanRadius: WORMHOLE_SCAN_RADIUS_BASE,
    // 落点与"到达即揭示"：入口格一开始就算**已到达**（玩家就在那儿）、终点格在到达前不揭示
    scanned: [hexKey(start.q, start.r)],
    visited: [hexKey(start.q, start.r)],
    activated: [],
    cells,
  }
}

/* ═══════════ 五、看板读数（界面与战报共用，避免两处各算一遍） ═══════════ */

/** 一层的盘点读数：格数 / 空地点 / 各信号计数 / 真相计数（**校准与用例的单一出处**） */
export function gridTally(grid: WormholeGridState): {
  total: number
  empty: number
  bySignal: Record<WormholeSignal, number>
  byPlace: Record<WormholePlace, number>
} {
  const bySignal: Record<WormholeSignal, number> = { wreck: 0, ship: 0, resource: 0, radar: 0 }
  const byPlace: Record<WormholePlace, number> = { empty: 0, graveyard: 0, ruins: 0, ship: 0, vein: 0, matter: 0 }
  for (const c of grid.cells) {
    byPlace[c.place] += 1
    const s = signalOfPlace(c.place)
    if (s) bySignal[s] += 1
  }
  return { total: grid.cells.length, empty: byPlace.empty, bySignal, byPlace }
}

/** 该格是否"该层末守卫"（= 下一层入口） */
export function isExitCell(grid: WormholeGridState, cell: HexCell): boolean {
  return grid.exit.q === cell.q && grid.exit.r === cell.r
}

/** 层末守卫战的用途键（与现有 `WormholeFoeKind` 对齐，F3b 接战斗时直接用） */
export const WORMHOLE_EXIT_KIND: WormholeFoeKind = 'boss'
