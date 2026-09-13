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
import { wormholeEnter } from '../src/wormhole'
import type { WormholeHoldState } from '../src/wormholeHold'
import { canPlace, findFreeSpot, holdAdd, holdCellsUsed, holdCompact, holdMove, holdRemove, holdRows, makeHoldState } from '../src/wormholeHold'
import {
  wormholeDiscardCargo,
  wormholeDiscardToFit,
  wormholeHoldCapacityOf,
  wormholeHoldDiscard,
  wormholeHoldOverloaded,
  wormholeHoldStow,
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

describe('虫洞 · 货仓格几何（纯逻辑）', () => {
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
    run.bag = [{ itemId: 'ore-voidmother', units: 1500 }] // 3 格
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
    run.bag = [{ itemId: 'ore-voidmother', units: 12 * 500 }] // 12 格 > 10
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
    run.bag = [
      { itemId: 'ore-voidmother', units: 6 * 500 },
      { itemId: 'wreck-wh-pirate-scout', units: 6 * 500 },
    ] // 共 12 格 > 10
    const dropped = wormholeDiscardCargo(state, ctx, 'wreck-wh-pirate-scout', 2 * 500)
    expect(dropped.ok).toBe(true)
    expect(dropped.dropped).toBe(1000)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // 形状件：装一件占 4 格 ⇒ 10 + 4 = 14 > 10 ⇒ **立刻超载**（格管理要留位置）
    const stow = wormholeHoldStow(state, ctx, BOX)
    expect(stow.ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(true)
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ cargoCells: 10, shapeCells: 4, used: 14 })
    // 再抛 4 格散货（2000 单位残骸）⇒ 恢复
    expect(wormholeDiscardCargo(state, ctx, 'wreck-wh-pirate-scout').ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // 抛掉货柜也恢复（形状件单独抛）：再塞 2000 单位母矿（4 格）⇒ 散货 10 格 + 货柜 4 格 = 14 > 10
    run.bag = [...run.bag, { itemId: 'ore-voidmother', units: 4 * 500 }]
    expect(wormholeHoldOverloaded(state, ctx)).toBe(true)
    const disc = wormholeHoldDiscard(state, ctx, stow.placementId!)
    expect(disc.ok).toBe(true)
    expect(wormholeHoldUsage(state, ctx).used).toBe(10) // 抛掉货柜 ⇒ 正好回到容量
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(run.hold!.placements).toHaveLength(0)
  })

  it('放不下形状件时**整件拒收**（并提示要几格）', () => {
    const state = enterRun(1) // 1×T3 = 5 格
    const run = state.wormhole.run!
    run.bag = [{ itemId: 'ore-voidmother', units: 2 * 500 }] // 占 2 格 ⇒ 剩 3 格，放不下 4 格货柜
    const r = wormholeHoldStow(state, ctx, BOX)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('4 格')
    expect(run.hold?.placements ?? []).toHaveLength(0)
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
    run.hold.placements.push({ id: 'x1', itemId: BOX, x: 0, y: 5, w: 2, h: 2 })
    const back2 = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back2.hold?.placements.some((p) => p.id === 'x1')).toBe(true)
    // 重叠件丢弃
    run.hold.placements.push({ id: 'x2', itemId: BOX, x: 0, y: 0, w: 2, h: 2 })
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
