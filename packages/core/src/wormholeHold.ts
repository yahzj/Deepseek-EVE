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
/** **细条上限**（历史常量）：≤ 4 格曾沿用"一条细条"的观感、> 4 格改矩形方块。
 *  ⚠ 2026-09-13 深夜船长再定「**每件散货不超过 500 m³（= 一格），超过就分件**」⇒
 *  散货一律 `1×1`；本常量只对**老档落形**（读档兼容）还有意义。 */
export const WORMHOLE_CARGO_BAR_MAX = 4
/**
 * **一件散货的落形 = 一格**（船长 2026-09-13 深夜：「残骸和母矿不应该合并超过 500 立方米，
 * 当超过时，分作 2 个单独的物品格并允许单独丢弃或者移动」）⇒ 散货**不再有跨格形状**，
 * "矩形块 / 末行补齐"那套只留给 2×2 货柜这类形状件。
 */
export const WORMHOLE_CARGO_PIECE: WormholeHoldShape = { w: 1, h: 1 }

/** 形状（宽 × 高，单位 = 格） */
export interface WormholeHoldShape {
  w: number
  h: number
}

/** 当前只用到的形状：可叠加散货 = 1×1（不建 placement 条目），货柜 = 2×1（图纸） / 2×2（贵重品·军用） / 3×2（安全货柜），AI 核心 = 1×1，谜质储存器 = 2×2 */
export const WORMHOLE_SHAPE_STACK: WormholeHoldShape = { w: 1, h: 1 }
export const WORMHOLE_SHAPE_CONTAINER: WormholeHoldShape = { w: 2, h: 2 }
/** **图纸货柜**（2026-09-14 船长定「占 2 格大小」）—— 2 宽 × 1 高 = 2 格 */
export const WORMHOLE_SHAPE_BPBOX: WormholeHoldShape = { w: 2, h: 1 }
/** **6 格货柜**（2026-09-15 船长「将安全货柜大小增加到6格」）：3×2 = 6 格（安全货柜 3000 m³） */
export const WORMHOLE_SHAPE_CONTAINER6: WormholeHoldShape = { w: 3, h: 2 }
/**
 * **AI 核心**（2026-09-14 船长定「AI 核心单独占 1 格」）—— 1×1 = 1 格。
 *
 * ⚠ 它是**形状件**（走 `hold.placements`、`kind: 'box'`）而不是可叠加散货（走 `run.bag`）：
 * 散货按 `units ÷ 每格单位数` 合并占格，那就成了"多枚核心挤一格"，与"单独占 1 格"不符
 * ⇒ 每一枚核心 = 独立一件、各自 1 格（洞内实物形态见 `packages/data/src/items.ts` 的 `AI_CORE_ITEMS`）。
 */
export const WORMHOLE_SHAPE_CORE: WormholeHoldShape = { w: 1, h: 1 }

/**
 * **形状表**（物品 id → 形状）。**没登记的物品 = 可叠加散货**（走 `run.bag`，不占形状条目）。
 * 做成表而不是散落的 if：将来加"大件装备""一次性图纸"只改数据，不动放置逻辑。
 */
export const WORMHOLE_HOLD_SHAPES: Readonly<Record<string, WormholeHoldShape>> = {
  // 遗迹安全货柜（按族各一种；F4d 落数据，这里先登记形状）
  'box-relic-a': WORMHOLE_SHAPE_CONTAINER6, // 2026-09-15：安全货柜 4 格 → 6 格
  'box-relic-c': WORMHOLE_SHAPE_CONTAINER6, // 2026-09-15：安全货柜 4 格 → 6 格
  'box-relic-d': WORMHOLE_SHAPE_CONTAINER6, // 2026-09-15：安全货柜 4 格 → 6 格
  'box-relic-e': WORMHOLE_SHAPE_CONTAINER6, // 2026-09-15：安全货柜 4 格 → 6 格
  'box-relic-g': WORMHOLE_SHAPE_CONTAINER6, // 2026-09-15：安全货柜 4 格 → 6 格
  // 图纸货柜（三种 = 层档；2026-09-14 船长定「占 2 格大小」）
  // 2026-09-15 新增两个货柜（船长）：军用备货 2×2 = 4 格
  // ⚠ 2026-09-16 船长「**奢侈品货柜调整为2*2**」：贵重品货柜 **2×1 = 2 格 → 2×2 = 4 格**
  //（与军用备货同形；体积同步 1000 → 2000 m³ = 500 m³/格 × 4 格，见 `data/items.ts` 与
  //  `content:check` 的「贵重品/军用货柜契约」）
  'box-valuables': WORMHOLE_SHAPE_CONTAINER,
  'box-military': WORMHOLE_SHAPE_CONTAINER,
  'box-bp-shallow': WORMHOLE_SHAPE_BPBOX,
  'box-bp-mid': WORMHOLE_SHAPE_BPBOX,
  'box-bp-deep': WORMHOLE_SHAPE_BPBOX,
  // AI 核心（遗迹打捞掉落；每种核心各占 1 格 —— 与 `AI_CORE_ITEMS` 三处同序）
  'ai-core-gamma': WORMHOLE_SHAPE_CORE,
  'ai-core-beta': WORMHOLE_SHAPE_CORE,
  'ai-core-alpha': WORMHOLE_SHAPE_CORE,
  /**
   * **谜质储存器**（F3c · 船长 2026-09-13「在货仓内显示为4格的『谜质储存器』」）：
   * 与货柜同形（2×2），但**只在本趟虫洞内生效、随趟消失**（效果表 = `wormholeMatter.ts`）。
   * 清单与 `packages/data/src/items.ts` 的 `MATTER_DEVICES`、`WORMHOLE_MATTER_DEVICE_IDS` 三处同序。
   */
  'mat-surveyor': WORMHOLE_SHAPE_CONTAINER,
  'mat-chrono': WORMHOLE_SHAPE_CONTAINER,
  'mat-crane': WORMHOLE_SHAPE_CONTAINER,
  'mat-drill': WORMHOLE_SHAPE_CONTAINER,
  'mat-nebula': WORMHOLE_SHAPE_CONTAINER,
  'mat-enricher': WORMHOLE_SHAPE_CONTAINER,
  'mat-expander': WORMHOLE_SHAPE_CONTAINER,
  /* B1 批：威胁类 3 台 ＋ 战斗类 10 台（同形 2×2） */
  'mat-suppressor': WORMHOLE_SHAPE_CONTAINER,
  'mat-boss-analyzer': WORMHOLE_SHAPE_CONTAINER,
  'mat-extract-cover': WORMHOLE_SHAPE_CONTAINER,
  'mat-shield-res': WORMHOLE_SHAPE_CONTAINER,
  'mat-armor-res': WORMHOLE_SHAPE_CONTAINER,
  'mat-hull-res': WORMHOLE_SHAPE_CONTAINER,
  'mat-tracker': WORMHOLE_SHAPE_CONTAINER,
  'mat-gyro': WORMHOLE_SHAPE_CONTAINER,
  'mat-jammer': WORMHOLE_SHAPE_CONTAINER,
  'mat-rangefinder': WORMHOLE_SHAPE_CONTAINER,
  'mat-blindspot': WORMHOLE_SHAPE_CONTAINER,
  'mat-ammo-dmg': WORMHOLE_SHAPE_CONTAINER,
  'mat-reload': WORMHOLE_SHAPE_CONTAINER,
  'mat-volley': WORMHOLE_SHAPE_CONTAINER,
  'mat-ammo-back': WORMHOLE_SHAPE_CONTAINER,
  'mat-drone-net': WORMHOLE_SHAPE_CONTAINER,
  'mat-field-repair': WORMHOLE_SHAPE_CONTAINER,
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
 * - `cargo` = **可叠加散货的一件**（船长 2026-09-13：「散货也在货仓背包内，并允许玩家拖拽移动」）
 *   —— 占格由数量现算（`units ÷ 每格单位数`），形状 = **矩形 + 末行补齐**（见 `cargoShapesFor`）。
 */
export interface WormholeHoldPlacement {
  /** 件 id（同一物品可以有多个件 ⇒ 必须各自有 id） */
  id: string
  itemId: string
  /** 件类型：形状件 / 散货件 */
  kind: 'box' | 'cargo'
  /** 散货件的数量（单位数；`box` 不带此字段） */
  units?: number
  /** 左上角（列 x 从 0 起、行 y 从 0 起） */
  x: number
  y: number
  w: number
  h: number
  /**
   * **实际占几格**（行优先、从左上角起数；缺省 = `w×h` 全占）。
   *
   * 船长 2026-09-13 深夜裁定「**矩形 + 末行补齐**：让单件不会出现非矩形格数，就可以避免这个问题」
   * ⇒ 散货件的**外框**永远是矩形（宽 ≤ 8 列），格数不足一整框时**只填到第 `fill` 格**：
   * 前 `h-1` 行整行、末行按需填 —— 这样任何格数（17、19、20…）都能一次装下，
   * 不再出现"凑不出装得下的矩形 ⇒ 整件拒收"（旧口径的取整损耗随之作废）。
   */
  fill?: number
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

/** 造一块新的格板（**货仓 8 列** 与 **临时空间 4 列** 用同一个类型、同一套几何） */
export function makeHoldState(cols: number = WORMHOLE_HOLD_COLS): WormholeHoldState {
  return { cols: Math.max(1, Math.floor(cols)), placements: [] }
}

/**
 * **散货的目标形状**（船长 2026-09-13：「**单件超 4 格的就是矩形方块**」＋「**必须是矩形**」
 * ＋ 深夜追加「**矩形 + 末行补齐**：让单件不会出现非矩形格数，就可以避免这个问题」）。
 *
 * 口径（与 `cargoBlockArea` 同一把尺，全仓只此一份）：
 * - **1~4 格** = 细条（`n×1` 横条 / `n×1` 的竖条，沿用原观感）；
 * - **>4 格** = **矩形外框 + 末行补齐**：外框候选 = 所有 `w ∈ [2,8]`、`h = ⌈n÷w⌉`（含转置），
 *   按 **① 面积小 ② 方块优先 ③ 行数少 ④ 列数多** 排序；摆放层拿第一个装得下的，
 *   实际只占 `n` 格（前几行整行、末行填到第 n 格）⇒ **任何格数都装得下**（只要 n ≤ 可用格数），
 *   不再有"凑不出整矩形 ⇒ 拒收"的取整损耗；
 * - 细条仍留作最后兜底（它本身也是矩形，只是薄），且**老档里的 1×n 落形依然合法**（读档不重排）。
 */
export function cargoShapesFor(cells: number): WormholeHoldShape[] {
  const n = Math.max(1, Math.floor(cells))
  if (n === 1) return [{ w: 1, h: 1 }]
  if (n <= WORMHOLE_CARGO_BAR_MAX) {
    return [
      { w: n, h: 1 },
      { w: 1, h: n },
    ]
  }
  const set = new Map<string, WormholeHoldShape>()
  const push = (w: number, h: number): void => {
    if (w < 1 || h < 1 || w > WORMHOLE_HOLD_COLS || h > 64) return
    set.set(`${w}x${h}`, { w, h })
  }
  // ① 矩形外框（宽高都 ≥ 2）：宽 2~8、高 = ⌈n ÷ w⌉，含转置 —— 末行不足由 `fill` 表达
  for (let w = 2; w <= WORMHOLE_HOLD_COLS; w++) {
    const h = Math.max(2, Math.ceil(n / w))
    push(w, h)
    push(h, w)
  }
  // ② 整行外框（宽 = 8 列、高 = ⌈n ÷ 8⌉）：小货仓"整行 + 不满的末行"就靠它
  push(WORMHOLE_HOLD_COLS, Math.max(1, Math.ceil(n / WORMHOLE_HOLD_COLS)))
  // ③ 细条兜底（本身就是矩形，只是薄）：老档/小货仓都能落到它
  push(n, 1)
  push(1, n)
  return [...set.values()].sort((a, b) => {
    // **方块优先**（船长口径：「超 4 格就是矩形方块」）；同族再比面积、行数、列数
    const blocky = (s: WormholeHoldShape): number => (s.w >= 2 && s.h >= 2 ? 0 : 1)
    return blocky(a) - blocky(b) || a.w * a.h - b.w * b.h || a.h - b.h || b.w - a.w
  })
}

/**
 * 散货**规范后的占格数** = 它自己的格数（船长 2026-09-13 深夜「矩形 + 末行补齐」后，
 * 不再需要"向上取整到矩形面积"：外框是矩形、末行按需填 ⇒ 任何格数都装得下、一格不浪费）。
 * 保留这个函数是为了**全仓一把尺**（临时空间 / `unplacedCells` / 界面读数都走它）。
 */
export function cargoBlockArea(cells: number): number {
  return Math.max(1, Math.floor(cells))
}

/** 一个摆放件**实际占几格**（行优先，末行可以不满） */
export function placementFill(p: WormholeHoldPlacement): number {
  const box = Math.max(0, p.w) * Math.max(0, p.h)
  if (p.fill === undefined) return box
  return Math.max(0, Math.min(box, Math.floor(p.fill)))
}

/**
 * 这个外框是不是 `cells` 格散货的合法落形（读档/整理时判断"用不用重放"）。
 * `fill` 缺省时按整框算（老档没有这个字段）。
 */
export function cargoShapeFits(cells: number, shape: WormholeHoldShape, fill?: number): boolean {
  const n = Math.max(1, Math.floor(cells))
  if (!cargoShapesFor(n).some((s) => s.w === shape.w && s.h === shape.h)) return false
  return (fill === undefined ? shape.w * shape.h : Math.max(0, Math.floor(fill))) === n
}

/* ═══════════ 二、占用与合法性（纯几何） ═══════════ */

/** 该件覆盖的格（按 (x,y) 列表；**行优先填到 `fill` 格**——末行可以不满） */
export function placementCells(p: WormholeHoldPlacement): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  const n = placementFill(p)
  let k = 0
  for (let dy = 0; dy < p.h && k < n; dy++) {
    for (let dx = 0; dx < p.w && k < n; dx++) {
      out.push({ x: p.x + dx, y: p.y + dy })
      k += 1
    }
  }
  return out
}

/** 这件占几格（散货按 `fill`、形状件按整框） */
export function placementCellsCount(p: WormholeHoldPlacement): number {
  return placementFill(p)
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

/**
 * 放在 `(x,y)`、外框 `shape`、实占 `fill` 格的件，是否落在**可用格**内
 * （可用格 = 行优先前 `capacity` 个；末行不满的件只算它**真正占的那几格**）。
 */
export function placementInBounds(
  x: number,
  y: number,
  shape: WormholeHoldShape,
  capacity: number,
  cols: number = WORMHOLE_HOLD_COLS,
  fill?: number,
): boolean {
  if (x < 0 || y < 0 || shape.w <= 0 || shape.h <= 0) return false
  if (x + shape.w > cols) return false
  const box = shape.w * shape.h
  const n = fill === undefined ? box : Math.max(0, Math.min(box, Math.floor(fill)))
  if (n <= 0) return false
  // 第 n 格（行优先）的落点：行 = ⌊(n-1) ÷ w⌋、列 = (n-1) mod w
  const lastDy = Math.floor((n - 1) / shape.w)
  const lastDx = (n - 1) % shape.w
  const last = (y + lastDy) * cols + (x + lastDx)
  return last < capacity
}

/** 与已有件是否重叠（`skipId` = 移动自己时排除自己；**只比真正占的格**） */
export function placementOverlaps(
  hold: WormholeHoldState,
  x: number,
  y: number,
  shape: WormholeHoldShape,
  skipId?: string,
  fill?: number,
): boolean {
  const occupied = new Set<string>()
  for (const p of hold.placements) {
    if (skipId !== undefined && p.id === skipId) continue
    for (const c of placementCells(p)) occupied.add(`${c.x},${c.y}`)
  }
  const box = shape.w * shape.h
  const n = fill === undefined ? box : Math.max(0, Math.min(box, Math.floor(fill)))
  let k = 0
  for (let dy = 0; dy < shape.h && k < n; dy++) {
    for (let dx = 0; dx < shape.w && k < n; dx++) {
      if (occupied.has(`${x + dx},${y + dy}`)) return true
      k += 1
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
  fill?: number,
): boolean {
  if (!placementInBounds(x, y, shape, capacity, hold.cols, fill)) return false
  return !placementOverlaps(hold, x, y, shape, skipId, fill)
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
  fill?: number,
): { x: number; y: number } | null {
  const rows = holdRows(capacity, hold.cols)
  const ys = reverse ? Array.from({ length: rows }, (_, i) => rows - 1 - i) : Array.from({ length: rows }, (_, i) => i)
  for (const y of ys) {
    const xs = reverse
      ? Array.from({ length: hold.cols }, (_, i) => hold.cols - 1 - i)
      : Array.from({ length: hold.cols }, (_, i) => i)
    for (const x of xs) {
      if (x + shape.w > hold.cols) continue
      if (canPlace(hold, x, y, shape, capacity, undefined, fill)) return { x, y }
    }
  }
  return null
}

/**
 * 现在还能摆下几个 **2×2 货柜**（散货落点用）。
 *
 * 为什么需要它：货仓是"整行 + 不满的末行"，**2×2 货柜对落点最挑**（小仓里往往只有一个位）。
 * 散货如果只顾自己往右下角挤（`findFreeSpot(reverse)`），可能把货柜唯一的位置占了 ——
 * 玩家就会遇到"明明还有空格，却提示货柜装不下"。所以散货选落点时**优先保住一个货柜位**。
 */
export function boxRoomCount(hold: WormholeHoldState, capacity: number): number {
  const rows = holdRows(capacity, hold.cols)
  let n = 0
  for (let y = 0; y + 2 <= rows; y++) {
    for (let x = 0; x + 2 <= hold.cols; x++) {
      if (canPlace(hold, x, y, WORMHOLE_SHAPE_CONTAINER, capacity)) n += 1
    }
  }
  return n
}

/**
 * **散货落点**：在"放得下"的所有位置里挑一个 —— 先按 `reverse`（右下往左上）的既有观感排，
 * 但**只要某个落点还留得住一个 2×2 货柜位，就用它**（见 `boxRoomCount`）。
 */
export function findCargoSpot(
  hold: WormholeHoldState,
  shape: WormholeHoldShape,
  fill: number | undefined,
  capacity: number,
): { x: number; y: number } | null {
  const rows = holdRows(capacity, hold.cols)
  const spots: Array<{ x: number; y: number }> = []
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = hold.cols - 1; x >= 0; x--) {
      if (x + shape.w > hold.cols) continue
      if (canPlace(hold, x, y, shape, capacity, undefined, fill)) spots.push({ x, y })
    }
  }
  if (spots.length === 0) return null
  const n = fill === undefined ? shape.w * shape.h : Math.max(0, Math.min(shape.w * shape.h, Math.floor(fill)))
  let best = spots[0]!
  let bestRoom = -1
  for (const s of spots) {
    const probe: WormholeHoldState = {
      cols: hold.cols,
      placements: [
        ...hold.placements,
        { id: '__probe', itemId: '', kind: 'cargo', units: 0, x: s.x, y: s.y, w: shape.w, h: shape.h, fill: n },
      ],
    }
    const room = boxRoomCount(probe, capacity)
    if (room > bestRoom) {
      bestRoom = room
      best = s
      if (room > 0) break // 已经能保住一个货柜位 ⇒ 按 reverse 观感取最先的那个
    }
  }
  return best
}

/**
 * 把某个落点放上去之后，还剩几个 2×2 货柜位（`__probe` 临时件用完即丢，不进真正的状态）。
 */
function roomAfter(
  hold: WormholeHoldState,
  shape: WormholeHoldShape,
  fill: number,
  capacity: number,
  spot: { x: number; y: number },
): number {
  const probe: WormholeHoldState = {
    cols: hold.cols,
    placements: [
      ...hold.placements,
      { id: '__probe', itemId: '', kind: 'cargo', units: 0, x: spot.x, y: spot.y, w: shape.w, h: shape.h, fill },
    ],
  }
  return boxRoomCount(probe, capacity)
}

/**
 * **散货落点总入口**：先按 `cargoShapesFor` 的外框优先序挑 ——
 * **能保住一个 2×2 货柜位的外框优先**，其次才轮到"装得下就行"（`fallback`）。
 * 这样"散货给货柜让位"这条老设计意图在最挑落点的小货仓里也成立。
 */
export function bestCargoPlacement(
  hold: WormholeHoldState,
  cells: number,
  capacity: number,
): { shape: WormholeHoldShape; fill: number; spot: { x: number; y: number } } | null {
  const n = Math.max(1, Math.floor(cells))
  let fallback: { shape: WormholeHoldShape; fill: number; spot: { x: number; y: number } } | null = null
  for (const shape of cargoShapesFor(n)) {
    const fill = Math.min(n, shape.w * shape.h)
    const spot = findCargoSpot(hold, shape, fill, capacity)
    if (!spot) continue
    if (roomAfter(hold, shape, fill, capacity, spot) > 0) return { shape, fill, spot }
    if (!fallback) fallback = { shape, fill, spot }
  }
  return fallback
}

/**
 * **自动放入一个形状件**（货柜；放不下 ⇒ `ok:false`，**不改状态**——船长口径"整件拒收"）。
 * 散货件走 `holdAddCargo`（外框由数量现算）。
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
 * **自动放入一件散货**（船长 2026-09-13：「散货也在货仓背包内，并允许玩家拖拽移动」）。
 * 外框由 `cargoShapesFor` 现算（≤4 格 = 细条；>4 格 = **矩形外框 + 末行补齐**）：
 * 逐个候选试落点，全都放不下 ⇒ `ok:false`（调用方据此拒绝这次拾取/打捞）。
 * ⚠ 只有 `n > 可用格数` 才可能真的放不下——**"凑不出矩形"不再是拒收理由**（船长 2026-09-13 深夜裁定）。
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
  const pick = bestCargoPlacement(hold, n, capacity)
  if (pick) {
    const p: WormholeHoldPlacement = {
      id: nextPlacementId(),
      itemId,
      kind: 'cargo',
      units: Math.max(0, Math.floor(units)),
      x: pick.spot.x,
      y: pick.spot.y,
      w: pick.shape.w,
      h: pick.shape.h,
      // 末行补齐：外框可能比 n 大，实际只占 n 格（`w×h === n` 时不写这个字段，兼容老档形状）
      ...(pick.fill === pick.shape.w * pick.shape.h ? {} : { fill: pick.fill }),
    }
    hold.placements.push(p)
    return { ok: true, placement: p }
  }
  return { ok: false, error: `货仓放不下：这件散货要占 ${n} 格（货仓只剩更少可用格）。` }
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
  // ⚠ 判据必须带 `fill`（散货件按"真正占的格数"算）：漏了它，移动一条不满的散货会被误判越界/重叠
  if (!canPlace(hold, x, y, { w: p.w, h: p.h }, capacity, id, placementFill(p))) {
    return { ok: false, error: '这里放不下。' }
  }
  p.x = x
  p.y = y
  return { ok: true }
}

/**
 * **两件互换位置**（船长 2026-09-13：「物品之间无法交换位置」）。
 *
 * 判据与 `holdMove` 同一把尺（`canPlace`），且**两件要互不相撞**。做法：先在**试算账**上把
 * 对方摆到自己的原位，再判自己能不能落到对方的原位 —— 两份试算都过才真改状态（**任一件放不下就整体回滚**，
 * 位置一字不动），形状对不上（例如 2×2 货柜与末行不满的散货条在窄缝里）⇒ 拒绝并说明。
 *
 * ⚠ **2026-09-13 修一个真 BUG**（船长报障：「大件物品和小件物品换位后，会出现重叠情况」）：
 * 旧写法把两件都挪到网格外的哨兵位再各自试落 —— 于是**判自己时看不见对方**：一件 4×2 的散货条
 * （末行只填 2 格）与 2×2 货柜正好能"各自都放得下"却**互相压住**（`2,0`、`3,0` 两格被两件同时占）。
 * 现在改为**互相作为障碍物**试算，重叠不可能再溜过去；哨兵位的原地改动也一并不需要了。
 */
export function holdSwap(
  hold: WormholeHoldState,
  idA: string,
  idB: string,
  capacity: number,
): { ok: boolean; error?: string } {
  const a = hold.placements.find((q) => q.id === idA)
  const b = hold.placements.find((q) => q.id === idB)
  if (!a || !b) return { ok: false, error: '没有这个件。' }
  if (a.id === b.id) return { ok: true }
  const ax = a.x
  const ay = a.y
  const bx = b.x
  const by = b.y
  const others = hold.placements.filter((p) => p.id !== a.id && p.id !== b.id)
  // 试算①：A 先落到 B 的原位 ⇒ 再看 B 能不能落到 A 的原位（既判越界、也判与 A 及其余件重叠）
  const trialA: WormholeHoldState = { cols: hold.cols, placements: [...others, { ...a, x: bx, y: by }] }
  const okB = canPlace(trialA, ax, ay, { w: b.w, h: b.h }, capacity, b.id, placementFill(b))
  // 试算②：反过来再来一遍（两件都要"自己放得下"，不能只看单向）
  const trialB: WormholeHoldState = { cols: hold.cols, placements: [...others, { ...b, x: ax, y: ay }] }
  const okA = canPlace(trialB, bx, by, { w: a.w, h: a.h }, capacity, a.id, placementFill(a))
  if (okA && okB) {
    a.x = bx
    a.y = by
    b.x = ax
    b.y = ay
    return { ok: true }
  }
  return { ok: false, error: '两件的形状对不上：换过去会互相压住（先把一件挪开，或点「整理」）。' }
}
/**
 * **按「抓取偏移」落件**（界面拖拽专用）：玩家抓的是件内第 `(dx,dy)` 格、光标落在 `(x,y)` 格。
 *
 * 语义 = 「**抓着的那一格跟着光标走**」（与浏览器拖动影像一致）：理想左上角 = `(x−dx, y−dy)`。
 *
 * ⚠ **2026-09-14 修船长报障**（探针在真 DOM 里复现）：件在**第一排**（`y = 0`）时抓它下面那格往第一排里拖，
 * 理想左上角落到 **第 −1 行** ⇒ 旧写法直接判「这里放不下」，可玩家的意思明明是「**沿第一排把它挪过去**」。
 * ⇒ 现在**越界就把件夹回网格内**（先夹再判），候选顺序：
 * ① 精确落点 → ② **夹回网格** → ③ 光标格当左上角 → ④ 夹回后的光标格；第一个放得下的就用它。
 * 全部放不下才报错 —— 手抓的位置偏了不该白报"放不下"。
 */
export function holdDropWithGrab(
  hold: WormholeHoldState,
  id: string,
  x: number,
  y: number,
  capacity: number,
  grab: { dx: number; dy: number },
): { ok: boolean; error?: string; x?: number; y?: number } {
  const p = hold.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '没有这个件。' }
  const spot = pickDropSpot(hold, { w: p.w, h: p.h }, placementFill(p), x, y, capacity, grab, p.id)
  if (!spot) return { ok: false, error: '这里放不下（它周围没有能摆下这块地方的位置）。' }
  p.x = spot.x
  p.y = spot.y
  return { ok: true, x: spot.x, y: spot.y }
}

/**
 * **一件东西从一块格板搬到另一块**（船长 2026-09-14：临时空间与货仓之间来回拖）：
 * 目标板上按同一套"抓取偏移 + 越界夹回"找落点（`pickDropSpot`），**找得到才真搬**
 * （先从来源板摘掉、再落到目标板；失败 ⇒ 两块板都不动）。
 *
 * 形状/实占格（`fill`）原样带过去 ⇒ 形状件仍是 2×2、末行不满的散货件仍只占它那几格。
 * `x/y` 省略 = **不指定落点**（找目标板上第一个放得下的空位，供"放进货仓"这类按钮用）。
 */
export function holdTransferTo(
  from: WormholeHoldState,
  to: WormholeHoldState,
  id: string,
  toCapacity: number,
  x?: number,
  y?: number,
  grab?: { dx: number; dy: number },
): { ok: boolean; error?: string; x?: number; y?: number } {
  const p = from.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '没有这个件。' }
  const shape = { w: p.w, h: p.h }
  const fill = placementFill(p)
  const spot =
    x === undefined || y === undefined
      ? findFreeSpot(to, shape, toCapacity, false, fill)
      : pickDropSpot(to, shape, fill, x, y, toCapacity, grab ?? { dx: 0, dy: 0 })
  if (!spot) return { ok: false, error: '那边放不下这件东西（先整理或丢弃腾位置）。' }
  from.placements = from.placements.filter((q) => q.id !== id)
  p.x = spot.x
  p.y = spot.y
  to.placements.push(p)
  return { ok: true, x: spot.x, y: spot.y }
}

/**
 * **落点候选**（拖拽落位的唯一几何判据 · 两块格板共用）：
 * **界内就严格、越界才夹** —— 理想左上角 = 光标格 − 抓取偏移；
 * - 理想落点落在**可用格**里 ⇒ 只试它一个（不把玩家想放的那格悄悄换成别处）；
 * - 越界 ⇒ 依次试「夹回网格」「光标格当左上角」「夹回后的光标格」，取第一个放得下的。
 */
export function pickDropSpot(
  board: WormholeHoldState,
  shape: WormholeHoldShape,
  fill: number | undefined,
  x: number,
  y: number,
  capacity: number,
  grab: { dx: number; dy: number },
  skipId?: string,
): { x: number; y: number } | null {
  const maxX = Math.max(0, board.cols - shape.w)
  const maxY = Math.max(0, holdRows(capacity, board.cols) - shape.h)
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
  const dx = Math.max(0, Math.floor(grab.dx))
  const dy = Math.max(0, Math.floor(grab.dy))
  const ix = x - dx
  const iy = y - dy
  const strict = placementInBounds(ix, iy, shape, capacity, board.cols, fill)
  const cands: Array<[number, number]> = strict
    ? [[ix, iy]]
    : [
        [ix, iy],
        [clamp(ix, maxX), clamp(iy, maxY)],
        [x, y],
        [clamp(x, maxX), clamp(y, maxY)],
      ]
  const tried = new Set<string>()
  for (const [cx, cy] of cands) {
    const k = `${cx},${cy}`
    if (tried.has(k)) continue
    tried.add(k)
    if (!canPlace(board, cx, cy, shape, capacity, skipId, fill)) continue
    return { x: cx, y: cy }
  }
  return null
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
    const spot = findFreeSpot(staged, { w: p.w, h: p.h }, capacity, false, placementFill(p))
    if (!spot) {
      /**
       * 放不下（超载态常见）⇒ **改排到「可用区之外」的空位**，不再「原坐标不动」。
       *
       * ⚠ 2026-09-13 船长报障「整理后背包出现明显错误」的真因：原先写的是「保持原位（不丢、也不硬塞）」，
       * 可原位很可能**已经被先排好的件占住**（staged 是重排后的新账）⇒ 两件坐标重叠、界面上一件压另一件。
       * 现在：在「容量放开」的口径下再找一次空位（落在已排好件的下方，彼此不重叠），仍记进 unplaced
       * 供界面提示「超载、先抛货」。
       */
      const overflow = findFreeSpot(
        staged,
        { w: p.w, h: p.h },
        // 放开容量 = 容量 + 每件一行（最坏情况一件占一行也够排）⇒ 扫描行数有界、不拖慢
        capacity + hold.cols * (sorted.length + 2),
        false,
        placementFill(p),
      )
      staged.placements.push(overflow ? { ...p, x: overflow.x, y: overflow.y } : { ...p })
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
  /**
   * `fill`（末行补齐的实际格数）：只对散货件有意义，必须是 `1..w×h` 的整数；
   * **坏值就退回整框**（`undefined`）——宁可多占一格，也不能把玩家的货当坏档丢掉。
   */
  const rawFill = num(o.fill)
  const fill = kind === 'cargo' && Number.isFinite(rawFill) && rawFill >= 1 && rawFill < w * h ? rawFill : undefined
  return {
    id,
    itemId,
    kind,
    ...(kind === 'cargo' && Number.isFinite(units) && units > 0 ? { units } : {}),
    x,
    y,
    w,
    h,
    ...(fill !== undefined ? { fill } : {}),
  }
}
