/**
 * **终局玩法「虫洞」· 货仓格管理**（F4 批 · 船长 2026-09-13 提出并逐条裁定）。
 *
 * 船长原话：「我想制作类似**背包英雄**那种需要管理的背包格（**但是没有背包，货仓直接代表背包大小**）」
 * 逐条裁定（见设计稿 §十二）：**500 m³/格** · 母矿/残骸照旧叠加（一类一格，**不参与形状拼装**）·
 * 装备与图纸改走中间件「**遗迹安全货柜**」（2000 m³ = **4 格 / 2×2**）· 旋转与拆解本批不做 ·
 * 手动拖拽 + 自动放入 + 整理 · 无相邻效果 · 放不下整件拒收 · **沉船后玩家手动抛弃货物** · 零迁移。
 *
 * 分工（**这一层只管"占形状的东西"**）：
 * - **可叠加散货**（虚空母矿、普通/稀有残骸）仍走 `run.bag`：一条记录 = 一种物品，体积按 ⌈单位数 ÷ 每格单位数⌉ 占格；
 * - **形状件**（安全货柜）走 `run.hold.placements`：一个件占 `w×h` 个格、**不可拆分**；
 * - **可用格数** = ⌊编队合计货仓 ÷ 500⌋（**现算**，沉船后立刻变小 ⇒ 超载）；
 * - **已用格数** = 散货占格 + 形状件占格；**超载** = 已用 > 可用（此时不能再装新东西、撤离/深入前须先抛货）。
 *
 * ⚠ 本模块**不依赖任何重模块**（纯几何 + 纯数据）：`wormhole.ts` 要引它的类型，一旦反向依赖会成环。
 */

/** 货仓网格的固定列数（船长口径"按推荐"：8 列；行数 = ⌈可用格数 ÷ 8⌉） */
export const WORMHOLE_HOLD_COLS = 8

/** 形状（宽 × 高，单位 = 格） */
export interface WormholeHoldShape {
  w: number
  h: number
}

/** 当前只用到的两种形状：可叠加散货 = 1×1（不建 placement 条目），安全货柜 = 2×2 */
export const WORMHOLE_SHAPE_STACK: WormholeHoldShape = { w: 1, h: 1 }
export const WORMHOLE_SHAPE_CONTAINER: WormholeHoldShape = { w: 2, h: 2 }

/**
 * **形状表**（物品 id → 形状）。**没登记的物品 = 可叠加散货**（走 `run.bag`，不占形状条目）。
 * 做成表而不是散落的 if：将来加"大件装备""一次性图纸"只改数据，不动放置逻辑。
 */
export const WORMHOLE_HOLD_SHAPES: Readonly<Record<string, WormholeHoldShape>> = {
  // 遗迹安全货柜（按族各一种；F4d 落数据，这里先登记形状）
  'box-relic-a': WORMHOLE_SHAPE_CONTAINER,
  'box-relic-c': WORMHOLE_SHAPE_CONTAINER,
  'box-relic-d': WORMHOLE_SHAPE_CONTAINER,
  'box-relic-e': WORMHOLE_SHAPE_CONTAINER,
  'box-relic-g': WORMHOLE_SHAPE_CONTAINER,
}

/** 该物品是不是**占形状的件**（是 ⇒ 走 `run.hold`，不是 ⇒ 走 `run.bag` 叠加） */
export function wormholeIsShapedItem(itemId: string): boolean {
  return WORMHOLE_HOLD_SHAPES[itemId] !== undefined
}

/** 某物品的形状（未登记 ⇒ 1×1 叠加件，仅作读数用） */
export function wormholeShapeOf(itemId: string): WormholeHoldShape {
  return WORMHOLE_HOLD_SHAPES[itemId] ?? WORMHOLE_SHAPE_STACK
}

/**
 * 网格里的一个**摆放件**。
 * - `box` = 形状件（遗迹安全货柜 2×2，不可拆）；
 * - `cargo` = **可叠加散货的一条**（船长 2026-09-13：「散货也在货仓背包内，并允许玩家拖拽移动」）
 *   —— 占格由数量现算（`units ÷ 每格单位数`），形状 = 1×N 横条（放不下时自动改 N×1 竖条）。
 */
export interface WormholeHoldPlacement {
  /** 件 id（同一物品可以有多个件 ⇒ 必须各自有 id） */
  id: string
  itemId: string
  /** 件类型：形状件 / 散货条 */
  kind: 'box' | 'cargo'
  /** 散货条的数量（单位数；`box` 不带此字段） */
  units?: number
  /** 左上角（列 x 从 0 起、行 y 从 0 起） */
  x: number
  y: number
  w: number
  h: number
}

/**
 * 货仓网格状态（随档；**可选字段 ⇒ 零迁移**：老档没有 = 该趟只有散货、没有摆放记录）。
 * ⚠ **不存"可用格数"**：它由编队货仓现算（沉船后自动变小 ⇒ 才能表达"超载"）。
 */
export interface WormholeHoldState {
  /** 列数（当前恒 8；存下来是为了将来改宽度也能读旧档） */
  cols: number
  /** 摆放件（散货条 + 形状件；**所有占格的东西都在这**） */
  placements: WormholeHoldPlacement[]
}

export function makeHoldState(): WormholeHoldState {
  return { cols: WORMHOLE_HOLD_COLS, placements: [] }
}

/** 散货条的目标形状：先横条（1×N）、放不下再竖条（N×1）——两条都试过才算"放不下" */
export function cargoShapesFor(cells: number): WormholeHoldShape[] {
  const n = Math.max(1, Math.floor(cells))
  return n === 1 ? [{ w: 1, h: 1 }] : [
    { w: n, h: 1 },
    { w: 1, h: n },
  ]
}

/* ═══════════ 二、占用与合法性（纯几何） ═══════════ */

/** 该件覆盖的格（按 (x,y) 列表；供碰撞与界面高亮用） */
export function placementCells(p: WormholeHoldPlacement): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) out.push({ x: p.x + dx, y: p.y + dy })
  return out
}

/** 形状件占几格 */
export function placementCellsCount(p: WormholeHoldPlacement): number {
  return Math.max(0, p.w) * Math.max(0, p.h)
}

/** 形状件合计占格 */
export function holdCellsUsed(hold: WormholeHoldState | undefined): number {
  if (!hold) return 0
  return hold.placements.reduce((s, p) => s + placementCellsCount(p), 0)
}

/** 网格行数（显示用；末行不足的位置是"锁定格"） */
export function holdRows(capacity: number, cols: number = WORMHOLE_HOLD_COLS): number {
  return Math.max(1, Math.ceil(Math.max(0, capacity) / Math.max(1, cols)))
}

/** 放在 `(x,y)` 且形状 `shape` 的件，是否落在**可用格**内（可用格 = 行优先前 `capacity` 个） */
export function placementInBounds(
  x: number,
  y: number,
  shape: WormholeHoldShape,
  capacity: number,
  cols: number = WORMHOLE_HOLD_COLS,
): boolean {
  if (x < 0 || y < 0 || shape.w <= 0 || shape.h <= 0) return false
  if (x + shape.w > cols) return false
  const last = (y + shape.h - 1) * cols + (x + shape.w - 1)
  return last < capacity
}

/** 与已有件是否重叠（`skipId` = 移动自己时排除自己） */
export function placementOverlaps(
  hold: WormholeHoldState,
  x: number,
  y: number,
  shape: WormholeHoldShape,
  skipId?: string,
): boolean {
  const occupied = new Set<string>()
  for (const p of hold.placements) {
    if (skipId !== undefined && p.id === skipId) continue
    for (const c of placementCells(p)) occupied.add(`${c.x},${c.y}`)
  }
  for (let dy = 0; dy < shape.h; dy++) {
    for (let dx = 0; dx < shape.w; dx++) {
      if (occupied.has(`${x + dx},${y + dy}`)) return true
    }
  }
  return false
}

/** 能不能放下（越界 / 重叠 / 可用格不够都算放不下） */
export function canPlace(
  hold: WormholeHoldState,
  x: number,
  y: number,
  shape: WormholeHoldShape,
  capacity: number,
  skipId?: string,
): boolean {
  if (!placementInBounds(x, y, shape, capacity, hold.cols)) return false
  return !placementOverlaps(hold, x, y, shape, skipId)
}

/* ═══════════ 三、放置 / 移动 / 移除 / 整理 ═══════════ */

let placementSeq = 0
/** 件 id（**只求同一趟内唯一**；随档保存，故用"时间戳 + 序号"避免读档后重号） */
function nextPlacementId(): string {
  placementSeq += 1
  return `h${Date.now().toString(36)}${placementSeq.toString(36)}`
}

/**
 * **首次适应递减**找一个能放下的位置（行优先扫描；找不到 ⇒ null）。
 * `reverse: true` = **从右下往左上找**（散货条用它 ⇒ 散货自己靠底排、把整行留给货柜，
 * 小货仓也能摆下 2×2 的货柜；这也是"散货给货柜让位"的落点）。
 */
export function findFreeSpot(
  hold: WormholeHoldState,
  shape: WormholeHoldShape,
  capacity: number,
  reverse = false,
): { x: number; y: number } | null {
  const rows = holdRows(capacity, hold.cols)
  const ys = reverse ? Array.from({ length: rows }, (_, i) => rows - 1 - i) : Array.from({ length: rows }, (_, i) => i)
  for (const y of ys) {
    const xs = reverse
      ? Array.from({ length: hold.cols }, (_, i) => hold.cols - 1 - i)
      : Array.from({ length: hold.cols }, (_, i) => i)
    for (const x of xs) {
      if (x + shape.w > hold.cols) continue
      if (canPlace(hold, x, y, shape, capacity)) return { x, y }
    }
  }
  return null
}

/**
 * **自动放入一个形状件**（货柜；放不下 ⇒ `ok:false`，**不改状态**——船长口径"整件拒收"）。
 * 散货条走 `holdAddCargo`（形状由数量现算）。
 */
export function holdAdd(
  hold: WormholeHoldState,
  itemId: string,
  capacity: number,
): { ok: boolean; placement?: WormholeHoldPlacement; error?: string } {
  const shape = wormholeShapeOf(itemId)
  if (!wormholeIsShapedItem(itemId)) return { ok: false, error: '这件东西是可叠加散货：应该走散货条（holdAddCargo）。' }
  if (capacity <= 0) return { ok: false, error: '货仓格数为 0：放不下任何形状件。' }
  const spot = findFreeSpot(hold, shape, capacity)
  if (!spot) return { ok: false, error: `货仓放不下：这件要占 ${shape.w}×${shape.h} = ${shape.w * shape.h} 格。` }
  const p: WormholeHoldPlacement = {
    id: nextPlacementId(),
    itemId,
    kind: 'box',
    x: spot.x,
    y: spot.y,
    w: shape.w,
    h: shape.h,
  }
  hold.placements.push(p)
  return { ok: true, placement: p }
}

/**
 * **自动放入一条散货**（船长 2026-09-13：「散货也在货仓背包内，并允许玩家拖拽移动」）。
 * 形状 = 1×N 横条，放不下自动改 N×1 竖条；两条都放不下 ⇒ `ok:false`（调用方据此拒绝这次拾取/打捞）。
 */
export function holdAddCargo(
  hold: WormholeHoldState,
  itemId: string,
  units: number,
  cells: number,
  capacity: number,
): { ok: boolean; placement?: WormholeHoldPlacement; error?: string } {
  const n = Math.max(1, Math.floor(cells))
  if (capacity <= 0) return { ok: false, error: '货仓格数为 0：放不下任何东西。' }
  for (const shape of cargoShapesFor(n)) {
    const spot = findFreeSpot(hold, shape, capacity, true)
    if (spot) {
      const p: WormholeHoldPlacement = {
        id: nextPlacementId(),
        itemId,
        kind: 'cargo',
        units: Math.max(0, Math.floor(units)),
        x: spot.x,
        y: spot.y,
        w: shape.w,
        h: shape.h,
      }
      hold.placements.push(p)
      return { ok: true, placement: p }
    }
  }
  return { ok: false, error: `货仓放不下：这条散货要占 ${n} 格（横竖都试过了）。` }
}

/** 移动一件（拖拽落点非法 ⇒ 拒绝，不改状态） */
export function holdMove(
  hold: WormholeHoldState,
  id: string,
  x: number,
  y: number,
  capacity: number,
): { ok: boolean; error?: string } {
  const p = hold.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '没有这个件。' }
  if (!canPlace(hold, x, y, { w: p.w, h: p.h }, capacity, id)) return { ok: false, error: '这里放不下。' }
  p.x = x
  p.y = y
  return { ok: true }
}

/** 移除一件（**抛弃**就是它；返回被移除的件供日志/读数） */
export function holdRemove(hold: WormholeHoldState, id: string): WormholeHoldPlacement | undefined {
  const i = hold.placements.findIndex((p) => p.id === id)
  if (i < 0) return undefined
  return hold.placements.splice(i, 1)[0]
}

/**
 * **整理**：把所有形状件按"首次适应递减"重排（大件优先），让碎片最小。
 * 整理**只重排位置、不丢东西**：若某件重排后无处可放，则保持原位（返回 `unplaced`）。
 */
export function holdCompact(
  hold: WormholeHoldState,
  capacity: number,
): { moved: number; unplaced: string[] } {
  const sorted = [...hold.placements].sort(
    (a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
  )
  const staged: WormholeHoldState = { cols: hold.cols, placements: [] }
  const unplaced: string[] = []
  let moved = 0
  for (const p of sorted) {
    const spot = findFreeSpot(staged, { w: p.w, h: p.h }, capacity)
    if (!spot) {
      // 放不下（超载态常见）⇒ 保持原位（不丢、也不硬塞）
      staged.placements.push({ ...p })
      unplaced.push(p.id)
      continue
    }
    if (spot.x !== p.x || spot.y !== p.y) moved += 1
    staged.placements.push({ ...p, x: spot.x, y: spot.y })
  }
  hold.placements = staged.placements
  return { moved, unplaced }
}

/* ═══════════ 四、读档容错（save.ts 与用例共用） ═══════════ */

/**
 * 清洗一个 placement（坏值 ⇒ null）：坐标/形状必须是整数、尺寸在**网格允许的范围内**；
 * **越界不丢**（超载态本来就允许"摆在可用格之外"，由超载判据去提示玩家抛货），但**重叠要丢**。
 *
 * ⚠ **2026-09-13 修一个真 BUG**：这里原先卡 `w,h ≤ 4`，而**散货条天生可以很宽/很高** ——
 * `cargoShapesFor(n)` 给的是 `1×n` 横条或 `n×1` 竖条（n 可以到 8 格宽、甚至十几格高）
 * ⇒ 一条 6 格的母矿条在**读档时被当坏值丢掉**：货还在 `run.bag` 里，网格里却没有它，
 * 于是 `wormholeHoldUsage.unplacedCells` 冒出一堆"放不下"的格数 ⇒ **凭空超载**
 * （探针实测：6 格母矿条读档后 `placements` 空了、`unplacedCells = 6`），
 * 玩家会被"先抛货"挡住，甚至把其实还在船上的货抛掉。
 * ⇒ 现在按**货仓的真实几何**校验：宽 ≤ 列数（8）、高 ≤ 64（够放下任何一趟的竖条）。
 */
export function cleanHoldPlacement(raw: unknown): WormholeHoldPlacement | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN)
  const x = num(o.x)
  const y = num(o.y)
  const w = num(o.w)
  const h = num(o.h)
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : null
  const itemId = typeof o.itemId === 'string' && o.itemId.length > 0 ? o.itemId : null
  if (!id || !itemId) return null
  if (!(x >= 0 && y >= 0 && w >= 1 && w <= WORMHOLE_HOLD_COLS && h >= 1 && h <= 64)) return null
  const kind = o.kind === 'cargo' ? 'cargo' : 'box'
  const units = num(o.units)
  return {
    id,
    itemId,
    kind,
    ...(kind === 'cargo' && Number.isFinite(units) && units > 0 ? { units } : {}),
    x,
    y,
    w,
    h,
  }
}
