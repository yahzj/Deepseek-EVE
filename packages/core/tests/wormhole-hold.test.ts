/**
 * **虫洞 · 货仓格管理（F4 · 2026-09-13 船长逐条裁定）**。
 *
 * 锁住六组口径（设计稿 §十二）：
 * ① **格数 = ⌊编队合计货仓 ÷ 500⌋**（仍 500 m³/格；**现算** ⇒ 沉船后立刻变小）；
 * ② **形状件**（遗迹安全货柜 2×2 = 4 格）走 `run.hold`，**可叠加散货照旧走 `bag`**（一类一格，不参与拼装）；
 * ③ 放置：**整件拒收**（放不下就不装、不改状态）· 拖动越界/重叠拒 · 整理只重排不丢件；
 * ④ **超载**：已用 > 可用 ⇒ 不许扫描/前往/激活/打捞/拾取；撤离与深入要先把货抛到容量内；
 * ⑤ **沉船后手动抛货**（船长裁定 8）：**不再自动丢货**，只提示超载；抛货随时可用（不软锁）；
 * ⑥ 随档（新增可选字段 `run.hold` ⇒ 零迁移）：坏件丢弃、重叠丢弃、**越界保留**（那才是超载态）。
 *
 * ⚠ 施工期铁律：虫洞对玩家不可见；本文件不产生玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { WORMHOLE_ORE_ITEM_ID, wormholeEnter } from '../src/wormhole'
import type { WormholeHoldState } from '../src/wormholeHold'
import { canPlace, cargoBlockArea, cargoShapesFor, findFreeSpot, holdAdd, holdAddCargo, holdCellsUsed, holdCompact, holdMove, holdRemove, holdRows, makeHoldState } from '../src/wormholeHold'
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
} from '../src/wormholeSalvage'
import { wormholeActivateAt, wormholeTravelTo } from '../src/wormholeBattle'
import { gridCellAt } from '../src/wormholeGrid'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
const BOX = 'box-relic-a'

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
   * **宽货条读档不丢**（2026-09-13 修的真 BUG）：
   * 散货条天生可以到 8 格宽（`cargoShapesFor` 给 1×n），而存档清洗原先卡 `w ≤ 4`
   * ⇒ 一条 6 格母矿条**读档后被当坏值丢掉**：货还在 `bag` 里、网格里却没有它，
   * `unplacedCells` 凭空冒出来 ⇒ **假超载**（玩家会被"先抛货"挡住，甚至抛掉其实还在船上的货）。
   */
  it('**宽散货条过存档往返不丢**（1×6 母矿条）：reads 后仍在网格里、不产生"放不下"', () => {
    const state = enterRun(2, 911)
    const run = state.wormhole.run!
    setBag(state, [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 3_000 }]) // 6 格 ⇒ 1×6 横条
    const before = wormholeHoldUsage(state, ctx)
    expect(before.cargoCells).toBe(6)
    expect(before.unplacedCells).toBe(0)
    const shape = (run.hold?.placements ?? []).find((p) => p.kind === 'cargo')!
    expect(shape.w).toBe(6) // 恰好是旧口径会丢掉的那种形状（w > 4）
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    const after = wormholeHoldUsage(back, ctx)
    expect(back.wormhole.run!.hold!.placements.length).toBe(1)
    expect(after.cargoCells).toBe(6)
    expect(after.unplacedCells, '读档后凭空多出"放不下"的格数 = 假超载').toBe(0)
    expect(after.overload).toBe(false)
  })

  /**
   * **散货形状 = 矩形**（船长 2026-09-13：「单件超 4 格的就是矩形方块」＋「必须是矩形」）。
   * 锁三件事：① ≤4 格仍是细条（老观感）；② >4 格走矩形方块（宽高都 ≥ 2）；
   * ③ 单件上限比改判前的硬上限 8 格高一档（20 格仓里 9/12/16 格装得下，17 格装不下）。
   */
  it('**散货形状**：≤4 格 = 细条；>4 格 = 矩形方块（且单件上限不再是 8 格）', () => {
    // ① ≤4 格：细条（`n×1` 优先，其次 `n×1` 的竖条）
    expect(cargoShapesFor(3)[0]).toEqual({ w: 3, h: 1 })
    expect(cargoShapesFor(4)).toContainEqual({ w: 1, h: 4 })
    // ② >4 格：首选是**方块**（宽高都 ≥ 2）
    for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 20, 24]) {
      const first = cargoShapesFor(n)[0]!
      expect(first.w, `${n} 格的首选形状 ${first.w}×${first.h} 应是方块`).toBeGreaterThan(1)
      expect(first.h, `${n} 格的首选形状 ${first.w}×${first.h} 应是方块`).toBeGreaterThan(1)
    }
    // 规范占格：凑不出整矩形就向上取整（11 → 12）；5~8 格细条更省 ⇒ 等于格数
    expect(cargoBlockArea(11)).toBe(12)
    expect(cargoBlockArea(13)).toBe(14)
    expect(cargoBlockArea(20)).toBe(20)
    expect(cargoBlockArea(5)).toBe(5)
    expect(cargoBlockArea(9)).toBe(9)
    // ③ 单件上限：20 格仓（8 列 × 3 行，末行 4 个锁定格）里 9/12/16 格装得下、17 格装不下
    const mk = (): WormholeHoldState => makeHoldState()
    expect(holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 9 * 500, 9, 20).ok).toBe(true)
    expect(holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 12 * 500, 12, 20).ok).toBe(true)
    const big = holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 16 * 500, 16, 20)
    expect(big.ok, big.error ?? '').toBe(true)
    expect([big.placement!.w, big.placement!.h]).toEqual([8, 2]) // 8 列 × 2 行
    expect(holdAddCargo(mk(), WORMHOLE_ORE_ITEM_ID, 17 * 500, 17, 20).ok).toBe(false)
    // 27 格仓（4 行整行 + 3 格）能放下一件 24 格（8×3）——改判前 8 格就顶天了
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
    setBag(state, [{ itemId: 'ore-voidmother', units: 12 * 500 }]) // 12 格 > 10
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
  })

  it('散货可按量抛（只差一两格时不用整条丢）；形状件单独抛', () => {
    const state = enterRun(2)
    const run = state.wormhole.run!
    setBag(state, [
      { itemId: 'ore-voidmother', units: 6 * 500 },
      { itemId: 'wreck-wh-pirate-scout', units: 6 * 500 },
    ]) // 共 12 格 > 10
    const dropped = wormholeDiscardCargo(state, ctx, 'wreck-wh-pirate-scout', 2 * 500)
    expect(dropped.ok).toBe(true)
    expect(dropped.dropped).toBe(1000)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // **F5 起货柜要真有空位**（散货也占真实格）：10 格被散货占满 ⇒ 装 4 格货柜**当场拒收**（整件拒收）
    const blocked = wormholeHoldStow(state, ctx, BOX)
    expect(blocked.ok).toBe(false)
    expect(blocked.error ?? '').toContain('装不下')
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false) // 被拒 ≠ 超载：状态没动
    // 腾出 4 格（抛掉 2000 单位残骸）⇒ 货柜装得下
    expect(wormholeDiscardCargo(state, ctx, 'wreck-wh-pirate-scout').ok).toBe(true)
    const stow = wormholeHoldStow(state, ctx, BOX)
    expect(stow.ok).toBe(true)
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ cargoCells: 6, shapeCells: 4, used: 10 })
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // 再塞 4 格散货（2000 单位母矿）⇒ 母矿条从 6 格涨到 10 格、网格里摆不下 ⇒ **整条**算"没位置" ⇒ 超载
    setBag(state, [...run.bag, { itemId: 'ore-voidmother', units: 4 * 500 }])
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(10)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(true)
    // 抛掉货柜 ⇒ 散货立刻有位（对齐一次）⇒ 恢复
    const disc = wormholeHoldDiscard(state, ctx, stow.placementId!)
    expect(disc.ok).toBe(true)
    wormholeHoldSyncCargo(state, ctx)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(run.hold!.placements.filter((p) => p.kind === 'box')).toHaveLength(0)
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
