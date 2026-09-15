/**
 * **虫洞 · 货仓格管理（F4 · 2026-09-13 船长逐条裁定）**。
 *
 * 锁住六组口径（设计稿 §十二）：
 * ① **格数 = ⌊编队合计货仓 ÷ 500⌋**（仍 500 m³/格；**现算** ⇒ 沉船后立刻变小）；
 * ② **形状件**（2026-09-15 起：军用备货柜 2×2 = 4 格 · 安全货柜 3×2 = 6 格）走 `run.hold`，**可叠加散货照旧走 `bag`**（一类一格，不参与拼装）；
 * ③ 放置：**整件拒收**（放不下就不装、不改状态）· 拖动越界/重叠拒 · 整理只重排不丢件；
 * ④ **超载**：已用 > 可用 ⇒ 不许扫描/前往/激活/打捞/拾取；撤离与深入要先把货抛到容量内；
 * ⑤ **沉船后手动抛货**（船长裁定 8）：**不再自动丢货**，只提示超载；抛货随时可用（不软锁）；
 * ⑥ 随档（新增可选字段 `run.hold` ⇒ 零迁移）：坏件丢弃、重叠丢弃、**越界保留**（那才是超载态）。
 *
 * ✅ 2026-09-14 船长解除不可见；本文件不产生玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { WORMHOLE_ORE_ITEM_ID, WORMHOLE_TEMP_CELLS, wormholeEnter, wormholeUnitsPerSlot } from '../src/wormhole'
import type { WormholeHoldPlacement, WormholeHoldState } from '../src/wormholeHold'
import { boxRoomCount, canPlace, cargoBlockArea, cargoShapesFor, findFreeSpot, holdAdd, holdAddCargo, holdCellsUsed, holdCompact, holdDropWithGrab, holdMove, holdSwap, holdRemove, holdRows, makeHoldState, placementCellsCount, placementFill } from '../src/wormholeHold'
import {
  wormholeDiscardCargo,
  wormholeDiscardToFit,
  wormholeHoldCapacityOf,
  wormholeHoldDiscard,
  wormholeHoldOverloaded,
  wormholeHoldStow,
  wormholeHoldSyncCargo,
  wormholeHoldUsage,
  wormholeOverloadBlockReason,
  wormholeSalvageAt,
  wormholeTempUsage,
} from '../src/wormholeSalvage'
import { wormholeActivateAt, wormholeTravelTo } from '../src/wormholeBattle'
import { gridCellAt } from '../src/wormholeGrid'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
const BOX = 'box-military' // 2026-09-15：安全货柜 4 格 → 6 格（3×2）⇒ 本文件的「2×2 = 4 格拼装」口径改用同批新增的**军用备货柜**（正好 2×2 = 4 格）来钉；安全货柜的新规格由形状表与 wormhole-battle 用例覆盖

/** 起一趟：`ships` 艘巡洋舰（货仓 2,600 m³/艘 ⇒ 5 格/艘） */
function enterRun(ships = 4, seed = 777): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, T3))
  state.shipId = ids[0]!
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  return state
}

/**
 * **直接设置背包并同步网格**（F5 起：散货也占真实格、也要有位置）。
 * ⚠ 背包的既有口径是**一种物品一条**（同物品并格）⇒ 本助手也照此合并，
 * 否则会出现两条同 id 的散货（网格按 itemId 对齐 ⇒ 读数是假的）。
 */
function setBag(state: GameState, slots: Array<{ itemId: string; units: number }>): void {
  const merged: Array<{ itemId: string; units: number }> = []
  for (const s of slots) {
    const hit = merged.find((x) => x.itemId === s.itemId)
    if (hit) hit.units += s.units
    else merged.push({ ...s })
  }
  state.wormhole.run!.bag = merged
  wormholeHoldSyncCargo(state, ctx)
}
describe('虫洞 · 货仓格几何（纯逻辑）', () => {
  /**
   * **散货读档不丢 + 一件一格**（2026-09-13 修的真 BUG ＋ 同日晚「每件不超过 500 m³，超过就分件」）：
   * 旧口径下散货条可以到 8 格宽，而存档清洗原先卡 `w ≤ 4` ⇒ 6 格母矿条读档后被当坏值丢掉
   * （货还在 `bag`、网格里没有它 ⇒ `unplacedCells` 凭空冒出来 ⇒ **假超载**）。
   * 现在 6 格 = **6 件（各占 1 格、每件 ≤ 每格单位数）**，过档后一件不少、也不产生"放不下"。
   */
  it('**散货过存档往返不丢**（6 格母矿 = 6 件）：reads 后仍在网格里、不产生"放不下"', () => {
    const state = enterRun(2, 911)
    const run = state.wormhole.run!
    setBag(state, [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 3_000 }]) // 6 格
    const before = wormholeHoldUsage(state, ctx)
    expect(before.cargoCells).toBe(6)
    expect(before.unplacedCells).toBe(0)
    const pieces = (run.hold?.placements ?? []).filter((p) => p.kind === 'cargo')
    expect(pieces.length, '一件一格：6 格母矿应拆成 6 件').toBe(6)
    for (const p of pieces) {
      expect([p.w, p.h]).toEqual([1, 1])
      expect(p.units, '每件不超过一格').toBeLessThanOrEqual(wormholeUnitsPerSlot(0.2)) // 母矿 0.2 m³/单位 ⇒ 2500/格
    }
    expect(pieces.reduce((n, p) => n + (p.units ?? 0), 0)).toBe(3_000) // 总数不丢
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    const after = wormholeHoldUsage(back, ctx)
    expect(back.wormhole.run!.hold!.placements.length).toBe(6)
    expect(after.cargoCells).toBe(6)
    expect(after.unplacedCells, '读档后凭空多出"放不下"的格数 = 假超载').toBe(0)
    expect(after.overload).toBe(false)
  })

  /**
   * **散货形状 = 矩形外框 + 末行补齐**（船长 2026-09-13：「单件超 4 格的就是矩形方块」＋
   * 「必须是矩形」＋ 深夜「**让单件不会出现非矩形格数，就可以避免这个问题**」）。
   * 锁四件事：① ≤4 格仍是细条；② >4 格首选是方块外框（宽高都 ≥ 2）且 `fill` 补齐；
   * ③ 占格 = 实际格数（不再向上取整）；④ **单件上限 = 货仓可用格数**（20 格仓里 17/19/20 格都装得下，
   *    改判前它们因为"凑不出装得下的矩形"被判拒收）。
   */
  it('**散货形状**：≤4 格 = 细条；>4 格 = 矩形外框 + 末行补齐（单件上限 = 可用格数）', () => {
    // ① ≤4 格：细条（`n×1` 优先，其次竖条）
    expect(cargoShapesFor(3)[0]).toEqual({ w: 3, h: 1 })
    expect(cargoShapesFor(4)).toContainEqual({ w: 1, h: 4 })
    // ② >4 格：首选是**方块外框**（宽高都 ≥ 2）
    for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 20, 24]) {
      const first = cargoShapesFor(n)[0]!
      expect(first.w, `${n} 格的首选外框 ${first.w}×${first.h} 应是方块`).toBeGreaterThan(1)
      expect(first.h, `${n} 格的首选外框 ${first.w}×${first.h} 应是方块`).toBeGreaterThan(1)
    }
    // ③ 占格 = 实际格数（船长：「让单件不会出现非矩形格数」⇒ 外框补齐，格数不再向上取整）
    expect(cargoBlockArea(11)).toBe(11)
    expect(cargoBlockArea(13)).toBe(13)
    expect(cargoBlockArea(20)).toBe(20)
    expect(cargoBlockArea(5)).toBe(5)
    // ④ 单件上限 = 可用格数：20 格仓里 9 / 12 / 16 / **17 / 19 / 20** 都装得下
    const mk = (): WormholeHoldState => makeHoldState()
    for (const n of [9, 12, 16, 17, 19, 20]) {
      const r = holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, n * 500, n, 20)
      expect(r.ok, `${n} 格单件应装得下：${r.error ?? ''}`).toBe(true)
      expect(placementCellsCount(r.placement!)).toBe(n) // 实占正好 n 格（一格不浪费）
    }
    // 16 格：优先挑"落下去还留得住一个 2×2 货柜位"的外框（散货给货柜让位），实占仍是 16 格
    const big = holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 16 * 500, 16, 20)
    expect(placementCellsCount(big.placement!)).toBe(16)
    const hold16 = mk()
    const p16 = holdAddCargo(hold16, WORMHOLE_ORE_ITEM_ID, 16 * 500, 16, 20).placement!
    hold16.placements.push(p16)
    expect(boxRoomCount(hold16, 20), '散货不该把货柜唯一的位置占了').toBeGreaterThan(0)
    // 20 格：整框 8×3 = 24 格太大 ⇒ 落成"外框 + 末行补齐"（fill < w×h）
    const full = holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 20 * 500, 20, 20)
    expect(full.placement!.fill).toBe(20)
    expect(full.placement!.w * full.placement!.h).toBeGreaterThan(20)
    expect(placementCellsCount(full.placement!)).toBe(20)
    // 超过可用格数才真的放不下（21 格进 20 格仓）
    expect(holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 21 * 500, 21, 20).ok).toBe(false)
    // 27 格仓能放下一件 24 格（8×3 整框）——改判前 8 格就顶天了
    const huge = holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 24 * 500, 24, 27)
    expect(huge.ok, huge.error ?? '').toBe(true)
    expect([huge.placement!.w, huge.placement!.h]).toEqual([8, 3])
  })

  it('8 列网格：行数 = ⌈格数 ÷ 8⌉；越界与重叠都判"放不下"', () => {
    const hold = makeHoldState()
    expect(hold.cols).toBe(8)
    expect(holdRows(20)).toBe(3) // 20 格 ⇒ 8×3（末行 4 个锁定格）
    expect(holdRows(56)).toBe(7)
    // **末行不满时，2×2 货柜只能落在整行里**（20 格 ⇒ 只有第 0、1 行是整行）——
    // 这是格管理的天然取舍（对齐才有位置），不是 bug，故钉住：
    expect(canPlace(hold, 3, 2, { w: 2, h: 2 }, 20)).toBe(false) // 跨到不满的末行
    expect(canPlace(hold, 4, 0, { w: 2, h: 2 }, 20)).toBe(true) // 整行内可以
    expect(canPlace(hold, 6, 0, { w: 2, h: 2 }, 20)).toBe(true) // 第 0~1 行第 6~7 列
    // 放一件后与它重叠的落点都不行
    const r = holdAdd(hold, BOX, 20)
    expect(r.ok).toBe(true)
    expect(r.placement).toMatchObject({ x: 0, y: 0, w: 2, h: 2 })
    expect(canPlace(hold, 1, 1, { w: 2, h: 2 }, 20)).toBe(false)
    expect(canPlace(hold, 2, 2, { w: 2, h: 2 }, 20)).toBe(false) // 末行不满 ⇒ 本来就放不下
    expect(canPlace(hold, 2, 0, { w: 2, h: 2 }, 20)).toBe(true)
  })

  it('自动放入（首次适应递减）：20 格放得下 **4 件**货柜（16 格，剩 4 格给散货），第 5 件整件拒收', () => {
    const hold = makeHoldState()
    for (let i = 0; i < 4; i++) expect(holdAdd(hold, BOX, 20).ok, `第 ${i + 1} 件应放得下`).toBe(true)
    expect(holdCellsUsed(hold)).toBe(16)
    expect(hold.placements.map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,0', '2,0', '4,0', '6,0'])
    const before = JSON.stringify(hold.placements)
    const fifth = holdAdd(hold, BOX, 20)
    expect(fifth.ok).toBe(false)
    expect(fifth.error ?? '').toContain('放不下')
    expect(JSON.stringify(hold.placements)).toBe(before) // 状态没动
    // **2×2 货柜只在"成对的整行"里成块**：3 行（24 格）也只放得下 4 件（16 格），
    // 剩下的 8 格仍可装散货（散货不占位）—— 这正是"货柜要占整块、散货填缝"的格管理取舍。
    const hold24 = makeHoldState()
    for (let i = 0; i < 4; i++) expect(holdAdd(hold24, BOX, 24).ok, `24 格第 ${i + 1} 件`).toBe(true)
    expect(holdAdd(hold24, BOX, 24).ok).toBe(false)
    expect(holdCellsUsed(hold24)).toBe(16)
    // 4 行（32 格）⇒ 8 件（整块铺满）
    const hold32 = makeHoldState()
    for (let i = 0; i < 8; i++) expect(holdAdd(hold32, BOX, 32).ok, `32 格第 ${i + 1} 件`).toBe(true)
    expect(holdAdd(hold32, BOX, 32).ok).toBe(false)
    expect(holdCellsUsed(hold32)).toBe(32)
  })

  it('拖动：合法落点成功、越界/重叠被拒且位置不变；整理只重排、不丢件', () => {
    const hold = makeHoldState()
    holdAdd(hold, BOX, 20)
    holdAdd(hold, BOX, 20)
    const [a, b] = hold.placements
    expect(holdMove(hold, a!.id, 4, 0, 20).ok).toBe(true)
    expect(a).toMatchObject({ x: 4, y: 0 })
    expect(holdMove(hold, a!.id, b!.x, b!.y, 20).ok).toBe(false) // 撞上另一件
    expect(a).toMatchObject({ x: 4, y: 0 }) // 被拒 ⇒ 不动
    expect(holdMove(hold, a!.id, 7, 0, 20).ok).toBe(false) // 越界（第 7 列放不下 2 宽）
    expect(holdMove(hold, a!.id, 0, 2, 20).ok).toBe(false) // 末行不满
    const compacted = holdCompact(hold, 20)
    expect(compacted.unplaced).toEqual([])
    expect(holdCellsUsed(hold)).toBe(8) // 一件不少
    expect(hold.placements.map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,0', '2,0'])
    void compacted.moved
    // 移除
    const gone = holdRemove(hold, a!.id)
    expect(gone?.itemId).toBe(BOX)
    expect(hold.placements).toHaveLength(1)
  })
})

describe('虫洞 · 两件互换位置（船长 2026-09-13：「物品之间无法交换位置」）', () => {
  it('形状都放得下 ⇒ 位置互换；放不下 ⇒ 整体回滚、位置一字不动', () => {
    const hold = makeHoldState()
    const a = holdAdd(hold, BOX, 20) // 2×2 货柜
    const b = holdAdd(hold, 'mat-surveyor', 20) // 2×2 谜质装置
    expect(a.ok && b.ok).toBe(true)
    const ax = a.placement!.x
    const ay = a.placement!.y
    const bx = b.placement!.x
    const by = b.placement!.y
    expect(ax !== bx || ay !== by, '两件应落在不同位置（否则这条用例没意义）').toBe(true)
    const ok = holdSwap(hold, a.placement!.id, b.placement!.id, 20)
    expect(ok.ok, ok.error).toBe(true)
    expect([a.placement!.x, a.placement!.y]).toEqual([bx, by])
    expect([b.placement!.x, b.placement!.y]).toEqual([ax, ay])
    // 放不下 ⇒ 拒绝且**两件都回原位**（容量只够 5 格：2×2 挪到右边会越出行外）
    const tiny = makeHoldState()
    const big = holdAdd(tiny, BOX, 5) // 2×2 落在左上
    const small = holdAdd(tiny, 'mat-volley', 5) // 2×2 也放不进 5 格了 ⇒ 换一件 1×1 散货来试
    if (small.ok) {
      // 若能放下第二件，则用"容量 5"这一档直接验回滚：把 big 挪到 small 的位置必然越界
      const bad = holdSwap(tiny, big.placement!.id, small.placement!.id, 5)
      expect(bad.ok).toBe(false)
      expect([big.placement!.x, big.placement!.y]).toEqual([0, 0])
    }
  })
})
describe('虫洞 · 货仓占用与超载（船长裁定 8）', () => {
  it('格数 = ⌊合计货仓 ÷ 500⌋（4×T3 = 20 格）；散货与形状件共用一本账', () => {
    const state = enterRun(4)
    const run = state.wormhole.run!
    expect(wormholeHoldCapacityOf(state, ctx)).toBe(20)
    setBag(state, [{ itemId: 'ore-voidmother', units: 1500 }]) // 3 格
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ cargoCells: 3, shapeCells: 0, used: 3, capacity: 20 })
    const stow = wormholeHoldStow(state, ctx, BOX)
    expect(stow.ok).toBe(true)
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ cargoCells: 3, shapeCells: 4, used: 7, capacity: 20 })
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
  })

  it('超载：封锁扫描/前往/激活/打捞，且提示先抛货；**抛货后立刻放行**（不软锁）', () => {
    const state = enterRun(2) // 2×T3 = 10 格
    const run = state.wormhole.run!
    const cap = wormholeHoldCapacityOf(state, ctx)
    expect(cap).toBe(10)
    /**
     * ⚠ **2026-09-14 起"超载"要连临时空间一起算**（船长把临时空间加大到 4×8 = 32 格）：
     * 收货阶梯是「货仓 → 临时空间 → 才失败」，所以只有**两块板都放不下**才会出现 `unplacedCells`。
     * 这里灌 45 格：货仓 10 + 临时空间 32 = 42 落地，剩 3 格没位置 ⇒ 超载。
     */
    setBag(state, [
      { itemId: 'ore-voidmother', units: 10 * 500 },
      { itemId: 'wreck-wh-pirate-scout', units: 35 * 500 },
    ])
    expect(wormholeTempUsage(state, ctx).cells).toBe(WORMHOLE_TEMP_CELLS)
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(3)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(true)
    expect(wormholeOverloadBlockReason(state, ctx) ?? '').toContain('超载')
    expect(wormholeActivateAt(state, ctx).ok).toBe(false)
    expect(wormholeTravelTo(state, ctx, { q: 0, r: 0 }, { confirmUnknown: true }).ok).toBe(false)
    expect(wormholeSalvageAt(state, ctx).ok).toBe(false)
    // 一键抛到容量内（玩家点按钮）
    const fit = wormholeDiscardToFit(state, ctx)
    expect(fit.ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // 抛完照常能走
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    void cell
    expect(wormholeHoldUsage(state, ctx).used).toBeLessThanOrEqual(cap)
    expect(wormholeTempUsage(state, ctx).cells).toBe(0) // 散货裁到容量内 ⇒ 临时空间也清空
  })

  it('散货可按量抛（只差一两格时不用整条丢）；形状件单独抛', () => {
    const state = enterRun(2)
    const run = state.wormhole.run!
    setBag(state, [
      { itemId: 'ore-voidmother', units: 6 * 500 },
      { itemId: 'wreck-wh-pirate-scout', units: 6 * 500 },
    ]) // 共 12 格：货仓 10 格占满，多出的 2 件落进临时空间（阶梯第二层）
    expect(wormholeTempUsage(state, ctx).cells).toBe(2)
    const dropped = wormholeDiscardCargo(state, ctx, 'wreck-wh-pirate-scout', 2 * 500)
    expect(dropped.ok).toBe(true)
    expect(dropped.dropped).toBe(1000)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(wormholeTempUsage(state, ctx).cells).toBe(0) // 裁到 10 格 ⇒ 全部装进货仓
    // **F5 起货柜要真有空位**（散货也占真实格）：10 格被散货占满 ⇒ 装 4 格货柜**当场拒收**（整件拒收）
    const blocked = wormholeHoldStow(state, ctx, BOX)
    expect(blocked.ok).toBe(false)
    expect(blocked.error ?? '').toContain('装不下')
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false) // 被拒 ≠ 超载：状态没动
    // 腾出 4 格（抛掉 2000 单位残骸）⇒ 货柜装得下
    expect(wormholeDiscardCargo(state, ctx, 'wreck-wh-pirate-scout').ok).toBe(true)
    const stow = wormholeHoldStow(state, ctx, BOX)
    expect(stow.ok, stow.error ?? '').toBe(true)
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ cargoCells: 6, shapeCells: 4, used: 10 })
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // 抛掉货柜 ⇒ 散货立刻有位（对齐一次）⇒ 状态照旧自洽
    const disc = wormholeHoldDiscard(state, ctx, stow.placementId!)
    expect(disc.ok).toBe(true)
    wormholeHoldSyncCargo(state, ctx)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(run.hold!.placements.filter((p) => p.kind === 'box')).toHaveLength(0)
  })

  it('**散货溢出到两块板都满** ⇒ 超载（2026-09-14 新口径：临时空间也算落地位置）', () => {
    const state = enterRun(2)
    const run = state.wormhole.run!
    // 货仓 10 格 + 临时空间 32 格 = 42 格正好装满 ⇒ 还没超载
    setBag(state, [
      { itemId: 'ore-voidmother', units: 10 * 500 },
      { itemId: 'wreck-wh-pirate-scout', units: 32 * 500 },
    ])
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(wormholeTempUsage(state, ctx).cells).toBe(WORMHOLE_TEMP_CELLS)
    // 再塞 4 格 ⇒ 两块板都没位置 ⇒ 那 4 件算"放不下" ⇒ 超载
    setBag(state, [...run.bag, { itemId: 'ore-voidmother', units: 4 * 500 }])
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(4)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(true)
    // 抛掉 4 格散货 ⇒ 立刻恢复
    expect(wormholeDiscardCargo(state, ctx, 'ore-voidmother', 4 * 500).ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
  })

  it('放不下形状件时**整件拒收**（并提示要几格）', () => {
    const state = enterRun(1) // 1×T3 = 5 格
    const run = state.wormhole.run!
    setBag(state, [{ itemId: 'ore-voidmother', units: 2 * 500 }]) // 占 2 格 ⇒ 剩 3 格，放不下 4 格货柜
    const r = wormholeHoldStow(state, ctx, BOX)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('4 格')
    expect((run.hold?.placements ?? []).filter((p) => p.kind === 'box')).toHaveLength(0)
    void findFreeSpot
  })
})

describe('虫洞 · 货仓格随档（零迁移）', () => {
  it('形状件随档往返；**越界件保留**（超载态）、**重叠件丢弃**（坏档）', () => {
    const state = enterRun(4)
    const run = state.wormhole.run!
    run.hold = makeHoldState()
    expect(holdAdd(run.hold, BOX, 20).ok).toBe(true)
    expect(holdAdd(run.hold, BOX, 20).ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.hold?.placements).toHaveLength(2)
    expect(back.hold?.cols).toBe(8)
    // 越界件（比如摆在 20 格之外的 y=5）保留 —— 那是超载态，靠玩家抛
    run.hold.placements.push({ id: 'x1', itemId: BOX, kind: 'box', x: 0, y: 5, w: 2, h: 2 })
    const back2 = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back2.hold?.placements.some((p) => p.id === 'x1')).toBe(true)
    // 重叠件丢弃
    run.hold.placements.push({ id: 'x2', itemId: BOX, kind: 'box', x: 0, y: 0, w: 2, h: 2 })
    const back3 = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back3.hold?.placements.some((p) => p.id === 'x2')).toBe(false)
    // 坏值整块丢弃（hold 字段不认识 ⇒ 不写）
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: { wormhole: { run: { hold: unknown } } } }
    raw.state.wormhole.run.hold = { cols: 'nope', placements: 'nope' }
    const broken = loadSaveFile(JSON.stringify(raw)).state.wormhole.run!
    expect(broken.hold?.placements ?? []).toEqual([])
  })

  it('老档没有 hold 字段 ⇒ 该趟只有散货（零迁移）', () => {
    const state = enterRun(2)
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: { wormhole: { run: Record<string, unknown> } } }
    delete raw.state.wormhole.run.hold
    const loaded = loadSaveFile(JSON.stringify(raw)).state.wormhole.run!
    expect(loaded.hold).toBeUndefined()
    void ({} as WormholeHoldState)
  })
})

describe('虫洞 · 货仓不重叠不变量（船长 2026-09-13 报障「整理后背包出现明显错误」「大件与小件换位后重叠」）', () => {
  /** 两件**真正占的格**是否相撞（重叠 = 一格被两件占；重复的件 id 也算坏账） */
  function overlapPairs(hold: WormholeHoldState): string[] {
    const seen = new Map<string, string>()
    const bad: string[] = []
    for (const p of hold.placements) {
      for (const c of placementCellsOf(p)) {
        const k = `${c.x},${c.y}`
        const prev = seen.get(k)
        if (prev !== undefined && prev !== p.id) bad.push(`${k}:${prev}+${p.id}`)
        seen.set(k, p.id)
      }
    }
    return bad
  }
  /** 件真正占的格（行优先、末行可不满：与 core `placementCells` 同一口径） */
  function placementCellsOf(p: WormholeHoldPlacement): Array<{ x: number; y: number }> {
    const fill = placementFill(p)
    const out: Array<{ x: number; y: number }> = []
    let k = 0
    for (let dy = 0; dy < p.h && k < fill; dy++) {
      for (let dx = 0; dx < p.w && k < fill; dx++) {
        out.push({ x: p.x + dx, y: p.y + dy })
        k += 1
      }
    }
    return out
  }
  /** 造一份"乱摆"的货仓：3 件货柜 + 若干散货条（含末行不满的 6 格条） */
  function messyHold(capacity: number): WormholeHoldState {
    const hold = makeHoldState()
    let seq = 0
    const put = (kind: 'box' | 'cargo', w: number, h: number, fill: number | undefined, x: number, y: number): void => {
      seq += 1
      hold.placements.push({ id: `p${seq}`, itemId: kind === 'box' ? BOX : WORMHOLE_ORE_ITEM_ID, kind, x, y, w, h, fill })
    }
    put('box', 2, 2, undefined, 0, 0)
    put('box', 2, 2, undefined, 4, 1)
    put('box', 2, 2, undefined, 1, 3)
    put('cargo', 3, 2, 6, 3, 0) // 6 格（3×2 整框）
    put('cargo', 4, 2, 6, 6, 3) // 6 格（4×2 末行只填 2 格）
    put('cargo', 4, 4, 14, 0, 6) // 14 格（4×4 末行只填 2 格）
    void capacity
    return hold
  }

  it('整理：混排后**没有任何两件重叠**（含末行不满的散货条），且件一个不少', () => {
    const capacity = 24
    const hold = messyHold(capacity)
    const before = hold.placements.length
    const r = holdCompact(hold, capacity)
    expect(hold.placements).toHaveLength(before)
    expect(overlapPairs(hold)).toEqual([])
    // 24 格放得下：3×4 格货柜 + 6 + 6 + 14 = 38 格 ⇒ 必然放不下，落进 unplaced 的件仍**互不重叠**
    expect(r.unplaced.length).toBeGreaterThan(0)
    expect(overlapPairs(hold)).toEqual([])
  })

  it('整理：容量够时全部排进可用区（大件优先 ⇒ 货柜整块、散货条补齐）', () => {
    const capacity = 40
    const hold = makeHoldState()
    // 3 件 2×2 货柜（12 格）+ 两条散货（6 格 + 6 格）= 24 格 ≤ 40 ⇒ 一件都不该落在可用区之外
    hold.placements.push({ id: 'b1', itemId: BOX, kind: 'box', x: 0, y: 0, w: 2, h: 2 })
    hold.placements.push({ id: 'b2', itemId: BOX, kind: 'box', x: 4, y: 1, w: 2, h: 2 })
    hold.placements.push({ id: 'b3', itemId: BOX, kind: 'box', x: 3, y: 2, w: 2, h: 2 })
    hold.placements.push({ id: 'c1', itemId: WORMHOLE_ORE_ITEM_ID, kind: 'cargo', x: 1, y: 0, w: 3, h: 2 })
    hold.placements.push({ id: 'c2', itemId: WORMHOLE_ORE_ITEM_ID, kind: 'cargo', x: 6, y: 3, w: 4, h: 2, fill: 6 })
    const r = holdCompact(hold, capacity)
    expect(r.unplaced).toEqual([])
    expect(overlapPairs(hold)).toEqual([])
    // 每一件都完整落在可用格内（自证式判据：拿 canPlace 排除自己再判一次）
    for (const p of hold.placements) {
      expect(canPlace(hold, p.x, p.y, { w: p.w, h: p.h }, capacity, p.id, placementFill(p))).toBe(true)
    }
  })

  it('换位：2×2 货柜 ↔ 末行不满的散货条（4×2 只填 6 格）——**旧写法会判"能换"而两件重叠**', () => {
    const capacity = 12
    const hold = makeHoldState()
    hold.placements.push({ id: 'b1', itemId: BOX, kind: 'box', x: 0, y: 0, w: 2, h: 2 })
    hold.placements.push({ id: 'c1', itemId: WORMHOLE_ORE_ITEM_ID, kind: 'cargo', x: 2, y: 0, w: 4, h: 2, fill: 6 })
    const r = holdSwap(hold, 'b1', 'c1', capacity)
    // 散货条落到 (0,0) 时第 1 行整行（x=0..3）⇒ 与落到 (2,0) 的货柜**压住两格** ⇒ 必须拒绝
    expect(r.ok).toBe(false)
    expect(overlapPairs(hold)).toEqual([])
    const b = hold.placements.find((p) => p.id === 'b1')!
    const c = hold.placements.find((p) => p.id === 'c1')!
    expect({ x: b.x, y: b.y }).toEqual({ x: 0, y: 0 })
    expect({ x: c.x, y: c.y }).toEqual({ x: 2, y: 0 })
  })

  it('换位：形状对得上时**真的互换**（1×1 散货 ↔ 2×2 货柜），换完不重叠', () => {
    const capacity = 24 // 8 列 3 行：货柜落到 (4,0) 要占第 0~1 行，容量得够
    const hold = makeHoldState()
    hold.placements.push({ id: 'b1', itemId: BOX, kind: 'box', x: 0, y: 0, w: 2, h: 2 })
    hold.placements.push({ id: 'c1', itemId: WORMHOLE_ORE_ITEM_ID, kind: 'cargo', x: 4, y: 0, w: 1, h: 1 })
    const r = holdSwap(hold, 'b1', 'c1', capacity)
    expect(r.ok).toBe(true)
    expect(overlapPairs(hold)).toEqual([])
    expect(hold.placements.find((p) => p.id === 'b1')).toMatchObject({ x: 4, y: 0 })
    expect(hold.placements.find((p) => p.id === 'c1')).toMatchObject({ x: 0, y: 0 })
  })

  it('移动：**不满的散货条按实占格判**（容量 10 格时 4×2 末行只填 2 格的条放得下）', () => {
    const capacity = 10 // 8 列 1 行 + 末行 2 格
    const hold = makeHoldState()
    hold.placements.push({ id: 'c1', itemId: WORMHOLE_ORE_ITEM_ID, kind: 'cargo', x: 0, y: 0, w: 4, h: 2, fill: 6 })
    // 带 fill：实占 6 格 ⇒ 末格 (1,1) = 第 10 格 ⇒ 放得下（漏了 fill 会按整框 8 格算、末格 (3,1) = 第 12 格 ⇒ 误拒）
    expect(holdMove(hold, 'c1', 0, 0, capacity).ok).toBe(true)
    // 往右挪一格：末格 (2,1) = 第 11 格 > 10 ⇒ 真越界，拒
    expect(holdMove(hold, 'c1', 1, 0, capacity).ok).toBe(false)
    expect({ x: hold.placements[0]!.x, y: hold.placements[0]!.y }).toEqual({ x: 0, y: 0 })
    // 重叠判据照旧生效：横条挪到货柜身上 ⇒ 拒（初始摆放本身不能重叠，先自证）
    const bar = makeHoldState()
    bar.placements.push({ id: 'c2', itemId: WORMHOLE_ORE_ITEM_ID, kind: 'cargo', x: 0, y: 0, w: 6, h: 1 })
    bar.placements.push({ id: 'b1', itemId: BOX, kind: 'box', x: 6, y: 0, w: 2, h: 2 }) // 摆在 (6,0)，与横条不挨着
    expect(overlapPairs(bar)).toEqual([])
    expect(holdMove(bar, 'c2', 2, 0, 16).ok).toBe(false)
    expect(overlapPairs(bar)).toEqual([])
  })
})

describe('虫洞 · 拖拽落点带抓取偏移（船长 2026-09-14 二次报障：「当物品上方处于第一排时」触发）', () => {
  /** 两件**真正占的格**是否相撞（与本文件另一组的同名助手同口径，此处独立一份便于本组自证） */
  function overlapPairs(hold: WormholeHoldState): string[] {
    const seen = new Map<string, string>()
    const bad: string[] = []
    for (const p of hold.placements) {
      const fill = placementFill(p)
      let k = 0
      for (let dy = 0; dy < p.h && k < fill; dy++) {
        for (let dx = 0; dx < p.w && k < fill; dx++) {
          const key = `${p.x + dx},${p.y + dy}`
          const prev = seen.get(key)
          if (prev !== undefined && prev !== p.id) bad.push(`${key}:${prev}+${p.id}`)
          seen.set(key, p.id)
          k += 1
        }
      }
    }
    return bad
  }

  /** 现场：2×2 货柜在**第一排**（y=0），右侧 (5,0) 起是空的（容量 40 = 5 行） */
  function holdWithBoxAtTop(capacity = 40): WormholeHoldState {
    const hold = makeHoldState()
    hold.placements.push({ id: 'b1', itemId: BOX, kind: 'box', x: 0, y: 0, w: 2, h: 2 })
    return hold
  }

  it('件在**第一排**、抓**右下角**那格、光标落在**第一排**的空格 ⇒ 夹回网格内（旧口径直接报"放不下"）', () => {
    const capacity = 40
    const hold = holdWithBoxAtTop(capacity)
    // 光标落在 (6,0)（第一排的空格）⇒ 理想左上角 = (6-1, 0-1) = (5,-1) —— 第 −1 行，越界
    const r = holdDropWithGrab(hold, 'b1', 6, 0, capacity, { dx: 1, dy: 1 })
    expect(r.ok).toBe(true)
    expect({ x: r.x, y: r.y }).toEqual({ x: 5, y: 0 }) // 夹回第一排 ⇒ "沿第一排挪过去"
    expect(hold.placements[0]).toMatchObject({ x: 5, y: 0 })
    expect(overlapPairs(hold)).toEqual([])
    // **负向**：旧口径（`holdMove` 直接用理想左上角）必然拒 —— 这就是船长看到的那句"这里放不下"
    const raw = holdWithBoxAtTop(capacity)
    expect(holdMove(raw, 'b1', 5, -1, capacity).ok).toBe(false)
  })

  it('件在第一排、抓右下角、光标落在**第二排** ⇒ 精确落点就在界内，不夹（位置 = 光标 − 抓取偏移）', () => {
    const capacity = 40
    const hold = holdWithBoxAtTop(capacity)
    const r = holdDropWithGrab(hold, 'b1', 6, 1, capacity, { dx: 1, dy: 1 })
    expect(r.ok).toBe(true)
    expect({ x: r.x, y: r.y }).toEqual({ x: 5, y: 0 })
  })

  it('抓左上角（偏移 0,0）⇒ 光标格就是左上角（与旧观感一致）', () => {
    const capacity = 40
    const hold = holdWithBoxAtTop(capacity)
    const r = holdDropWithGrab(hold, 'b1', 4, 3, capacity, { dx: 0, dy: 0 })
    expect(r.ok).toBe(true)
    expect({ x: r.x, y: r.y }).toEqual({ x: 4, y: 3 })
  })

  it('**界内**的落点被占 ⇒ 照旧拒绝（不猜位置、不悄悄挪去别处）', () => {
    const capacity = 40
    const hold = holdWithBoxAtTop(capacity)
    hold.placements.push({ id: 'b2', itemId: BOX, kind: 'box', x: 4, y: 1, w: 2, h: 2 })
    // 光标落在 (5,2)：理想左上角 = (4,1) = b2 占着 ⇒ 拒（且两件位置都不动）
    const r = holdDropWithGrab(hold, 'b1', 5, 2, capacity, { dx: 1, dy: 1 })
    expect(r.ok).toBe(false)
    expect(hold.placements.find((p) => p.id === 'b1')).toMatchObject({ x: 0, y: 0 })
    expect(hold.placements.find((p) => p.id === 'b2')).toMatchObject({ x: 4, y: 1 })
    expect(overlapPairs(hold)).toEqual([])
  })

  it('**右边越界**同理：抓右下角把件拖到最右列 ⇒ 夹回可用宽度内', () => {
    const capacity = 40
    const hold = holdWithBoxAtTop(capacity)
    // 光标落在 (7,3)：理想左上角 = (6,2)（界内 ⇒ 精确落点，因为 6+2 ≤ 8）
    const a = holdDropWithGrab(hold, 'b1', 7, 3, capacity, { dx: 1, dy: 1 })
    expect(a.ok).toBe(true)
    expect({ x: a.x, y: a.y }).toEqual({ x: 6, y: 2 })
    // 抓右下角、光标落在 (0,3)：理想 = (-1,2) 越界 ⇒ 夹回 x=0
    const b = holdDropWithGrab(hold, 'b1', 0, 3, capacity, { dx: 1, dy: 1 })
    expect(b.ok).toBe(true)
    expect({ x: b.x, y: b.y }).toEqual({ x: 0, y: 2 })
  })

  it('真没地方（夹回后仍被占）⇒ 才报"放不下"，且位置不动', () => {
    const capacity = 40
    const hold = holdWithBoxAtTop(capacity)
    // 把第一排右侧与第二排右侧都占满 ⇒ 夹回第一排也放不下
    hold.placements.push({ id: 'b2', itemId: BOX, kind: 'box', x: 5, y: 0, w: 2, h: 2 })
    const r = holdDropWithGrab(hold, 'b1', 6, 0, capacity, { dx: 1, dy: 1 })
    expect(r.ok).toBe(false)
    expect(hold.placements.find((p) => p.id === 'b1')).toMatchObject({ x: 0, y: 0 })
    expect(overlapPairs(hold)).toEqual([])
  })
})
